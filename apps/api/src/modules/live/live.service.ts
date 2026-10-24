import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { livePath, masterPlaylistKey, streamIdFromPath, thumbnailKey } from '@streamzw/shared';
import { DB, type Db } from '../../db/db.module';
import { liveStreams, videos } from '../../db/schema';
import {
  InvalidStateTransitionError,
  ResourceNotFoundError,
  ValidationError,
} from '../auth/errors';
import { VideosService } from '../videos/videos.service';

/** No ingest for this long while live → the stream is over (covers reconnects and crashes). */
export const INGEST_GRACE_SECONDS = 5 * 60;
/** An ended stream whose recording nobody claimed within this long gets no replay. */
const RECORDING_CLAIM_SECONDS = 30 * 60;

const CreateLiveSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).optional(),
  category: z.string().optional(),
  access_mode: z.enum(['free', 'ppv', 'premium', 'premium_buyable']),
  ppv_price_minor_units: z.number().int().optional(),
  ppv_price_currency: z.string().optional(),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  record: z.boolean().optional(),
});

const UpdateLiveSchema = z.object({
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  record: z.boolean().optional(),
});

/** MediaMTX's HTTP auth request (authMethod: http). */
const MediaMtxAuthSchema = z.object({
  user: z.string().optional().default(''),
  password: z.string().optional().default(''),
  ip: z.string().optional().default(''),
  action: z.string(),
  path: z.string().optional().default(''),
  protocol: z.string().optional(),
  query: z.string().optional().default(''),
});

const IngestEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('started'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive().max(240).optional(),
    codec: z.string().max(40).optional(),
  }),
  z.object({ event: z.literal('alive') }),
  z.object({ event: z.literal('disconnected') }),
]);

const RecordingSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    duration_seconds: z.number().int().nonnegative(),
    thumbnail: z.boolean().optional(),
  }),
  z.object({ status: z.literal('failed'), reason: z.string().max(500).optional() }),
]);

type LiveRow = typeof liveStreams.$inferSelect;

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
  return parsed.data;
}

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Live streams. The viewing side (access, purchases, playback grants, heartbeats) goes
 * through the backing video and VideosService like any upload; this service owns the
 * stream's lifecycle, its stream key, and the hooks the ingest server and live worker call.
 */
@Injectable()
export class LiveService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly videos: VideosService,
  ) {}

  // ─── Creator side ────────────────────────────────────────────────────────

  async create(ownerId: string, body: unknown) {
    const dto = parse(CreateLiveSchema, body);
    const scheduledAt = dto.scheduled_at ? new Date(dto.scheduled_at) : null;
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) {
      throw new ValidationError('Pick a start time in the future (or leave it empty)');
    }
    const key = randomBytes(24).toString('base64url');
    const { scheduled_at: _s, record, ...videoFields } = dto;
    const stream = await this.db.transaction(async (tx) => {
      const video = await this.videos.createLiveVideo(ownerId, videoFields, tx);
      const [row] = await tx
        .insert(liveStreams)
        .values({
          videoId: video.id,
          ownerId,
          streamKeyHash: hashKey(key),
          scheduledAt,
          record: record ?? true,
        })
        .returning();
      return row!;
    });
    return { ...(await this.serialize(stream)), stream_key: key };
  }

  async update(id: string, ownerId: string, body: unknown) {
    const dto = parse(UpdateLiveSchema, body);
    const s = await this.getOwned(id, ownerId);
    if (dto.scheduled_at !== undefined && s.state !== 'scheduled') {
      throw new ValidationError('Only an upcoming stream can be rescheduled');
    }
    const [row] = await this.db
      .update(liveStreams)
      .set({
        ...(dto.scheduled_at !== undefined && {
          scheduledAt: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
        }),
        ...(dto.record !== undefined && { record: dto.record }),
        updatedAt: new Date(),
      })
      .where(eq(liveStreams.id, id))
      .returning();
    return this.serialize(row!);
  }

  /** A new key; the old one stops working at the next connect. */
  async resetKey(id: string, ownerId: string) {
    const s = await this.getOwned(id, ownerId);
    if (s.state === 'ended' || s.state === 'cancelled') {
      throw new ValidationError('This stream is over');
    }
    const key = randomBytes(24).toString('base64url');
    await this.db
      .update(liveStreams)
      .set({ streamKeyHash: hashKey(key), updatedAt: new Date() })
      .where(eq(liveStreams.id, id));
    return { ...(await this.serialize({ ...s, streamKeyHash: hashKey(key) })), stream_key: key };
  }

  async cancel(id: string, ownerId: string) {
    const s = await this.getOwned(id, ownerId);
    if (s.state !== 'scheduled') throw new InvalidStateTransitionError(s.state, 'cancelled');
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(liveStreams)
        .set({ state: 'cancelled', endedAt: now, updatedAt: now })
        .where(eq(liveStreams.id, id));
      // Off the catalogue; anyone who pre-bought keeps the purchase record (refunds are
      // an admin decision, never automatic ledger edits — §3.7).
      await tx
        .update(videos)
        .set({ state: 'unpublished', updatedAt: now })
        .where(eq(videos.id, s.videoId));
    });
    return this.serialize((await this.getOwned(id, ownerId))!);
  }

  /** The creator ends the stream now (the worker stops and hands over the recording). */
  async end(id: string, ownerId: string) {
    const s = await this.getOwned(id, ownerId);
    if (s.state !== 'live') throw new InvalidStateTransitionError(s.state, 'ended');
    await this.finish(s);
    return this.serialize((await this.getOwned(id, ownerId))!);
  }

  async listMine(ownerId: string) {
    const rows = await this.db
      .select()
      .from(liveStreams)
      .where(eq(liveStreams.ownerId, ownerId))
      .orderBy(desc(liveStreams.createdAt))
      .limit(100);
    return { items: await Promise.all(rows.map((r) => this.serialize(r))) };
  }

  async getMine(id: string, ownerId: string) {
    return this.serialize(await this.getOwned(id, ownerId));
  }

  // ─── Viewer side ─────────────────────────────────────────────────────────

  /** Streams on air now, or coming up, as ordinary video items (with their `live` info). */
  async listPublic(state: 'live' | 'upcoming') {
    const rows = await this.db
      .select({ videoId: liveStreams.videoId })
      .from(liveStreams)
      .innerJoin(videos, eq(videos.id, liveStreams.videoId))
      .where(
        and(
          eq(liveStreams.state, state === 'live' ? 'live' : 'scheduled'),
          eq(videos.state, 'published'),
        ),
      )
      .orderBy(state === 'live' ? desc(liveStreams.startedAt) : liveStreams.scheduledAt)
      .limit(50);
    return { items: await this.videos.listByIds(rows.map((r) => r.videoId)) };
  }

  // ─── Ingest server + live worker hooks ───────────────────────────────────

  /**
   * MediaMTX asks before every publish or read. Publishing needs the stream's key as the
   * password (`rtmp://…/live/<id>?user=key&pass=<key>`, or SRT `publish:live/<id>:key:<key>`)
   * while the stream is upcoming or live. Reading is only for the transcoder on the same
   * host; viewers never read from MediaMTX (they get HLS from nginx).
   */
  async authorizeIngest(body: unknown): Promise<boolean> {
    const req = parse(MediaMtxAuthSchema, body);
    if (req.action === 'read' || req.action === 'playback') return LOOPBACK.has(req.ip);
    if (req.action !== 'publish') return false;
    const id = streamIdFromPath(req.path);
    if (!id) return false;
    const key = req.password || new URLSearchParams(req.query).get('pass') || '';
    if (!key) return false;
    const [s] = await this.db.select().from(liveStreams).where(eq(liveStreams.id, id)).limit(1);
    if (!s || (s.state !== 'scheduled' && s.state !== 'live')) return false;
    return sameHash(hashKey(key), s.streamKeyHash);
  }

  /** What the worker needs to know about a stream. */
  async workerStatus(id: string) {
    const s = await this.byId(id);
    return {
      id: s.id,
      video_id: s.videoId,
      state: s.state,
      record: s.record,
      ingest_connected: s.ingestConnected,
      recording_state: s.recordingState,
    };
  }

  async ingestEvent(id: string, body: unknown) {
    const e = parse(IngestEventSchema, body);
    const s = await this.byId(id);
    const now = new Date();
    if (e.event === 'started') {
      if (s.state !== 'scheduled' && s.state !== 'live') {
        throw new InvalidStateTransitionError(s.state, 'live');
      }
      await this.db
        .update(liveStreams)
        .set({
          state: 'live',
          startedAt: s.startedAt ?? now,
          ingestConnected: true,
          lastIngestAt: now,
          sourceWidth: e.width,
          sourceHeight: e.height,
          sourceFps: e.fps ?? null,
          sourceCodec: e.codec ?? null,
          updatedAt: now,
        })
        .where(eq(liveStreams.id, id));
    } else if (e.event === 'alive') {
      if (s.state === 'live') {
        await this.db
          .update(liveStreams)
          .set({ ingestConnected: true, lastIngestAt: now })
          .where(eq(liveStreams.id, id));
      }
    } else {
      await this.db
        .update(liveStreams)
        .set({ ingestConnected: false, lastIngestAt: now, updatedAt: now })
        .where(eq(liveStreams.id, id));
    }
    return this.workerStatus(id);
  }

  /**
   * One worker gets to publish the recording: none → pending, only once the stream has
   * ended and only if the creator wanted it recorded.
   */
  async claimRecording(id: string) {
    const rows = await this.db
      .update(liveStreams)
      .set({ recordingState: 'pending', updatedAt: new Date() })
      .where(
        and(
          eq(liveStreams.id, id),
          eq(liveStreams.state, 'ended'),
          eq(liveStreams.record, true),
          eq(liveStreams.recordingState, 'none'),
        ),
      )
      .returning({ videoId: liveStreams.videoId });
    const row = rows[0];
    return row ? { claimed: true, video_id: row.videoId } : { claimed: false };
  }

  /** The worker uploaded the recording to `videos/<video_id>/…` (and maybe a thumbnail). */
  async recordingResult(id: string, body: unknown) {
    const r = parse(RecordingSchema, body);
    const s = await this.byId(id);
    if (s.recordingState !== 'pending') {
      throw new InvalidStateTransitionError(s.recordingState, `recording ${r.status}`);
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(liveStreams)
        .set({ recordingState: r.status, updatedAt: now })
        .where(eq(liveStreams.id, id));
      if (r.status === 'ready') {
        await tx
          .update(videos)
          .set({
            hlsPlaylistKey: masterPlaylistKey(s.videoId),
            durationSeconds: r.duration_seconds,
            ...(r.thumbnail && { thumbnailKey: thumbnailKey(s.videoId) }),
            updatedAt: now,
          })
          .where(eq(videos.id, s.videoId));
      } else {
        await tx
          .update(videos)
          .set({ state: 'unpublished', updatedAt: now })
          .where(and(eq(videos.id, s.videoId), isNull(videos.hlsPlaylistKey)));
      }
    });
    return this.workerStatus(id);
  }

  /**
   * Every minute: end live streams whose ingest has been gone past the grace period, and
   * give up on recordings nobody claimed. Idempotent.
   */
  async sweep(now = new Date()) {
    const cutoff = new Date(now.getTime() - INGEST_GRACE_SECONDS * 1000);
    const stale = await this.db
      .select()
      .from(liveStreams)
      .where(
        and(
          eq(liveStreams.state, 'live'),
          or(isNull(liveStreams.lastIngestAt), lt(liveStreams.lastIngestAt, cutoff)),
        ),
      );
    for (const s of stale) await this.finish(s, now);

    const claimCutoff = new Date(now.getTime() - RECORDING_CLAIM_SECONDS * 1000);
    const orphaned = await this.db
      .update(liveStreams)
      .set({ recordingState: 'failed', updatedAt: now })
      .where(
        and(
          eq(liveStreams.state, 'ended'),
          eq(liveStreams.recordingState, 'none'),
          eq(liveStreams.record, true),
          lt(liveStreams.endedAt, claimCutoff),
        ),
      )
      .returning({ videoId: liveStreams.videoId });
    if (orphaned.length > 0) {
      await this.db
        .update(videos)
        .set({ state: 'unpublished', updatedAt: now })
        .where(
          and(
            inArray(
              videos.id,
              orphaned.map((o) => o.videoId),
            ),
            isNull(videos.hlsPlaylistKey),
          ),
        );
    }
    return { ended: stale.length, recordings_failed: orphaned.length };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** live → ended. Without a recording to come, the video leaves the catalogue now. */
  private async finish(s: LiveRow, now = new Date()) {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(liveStreams)
        .set({ state: 'ended', endedAt: now, ingestConnected: false, updatedAt: now })
        .where(and(eq(liveStreams.id, s.id), eq(liveStreams.state, 'live')))
        .returning({ id: liveStreams.id });
      if (rows.length > 0 && !s.record) {
        await tx
          .update(videos)
          .set({ state: 'unpublished', updatedAt: now })
          .where(eq(videos.id, s.videoId));
      }
    });
  }

  private async byId(id: string) {
    const [s] = await this.db.select().from(liveStreams).where(eq(liveStreams.id, id)).limit(1);
    if (!s) throw new ResourceNotFoundError('Live stream');
    return s;
  }

  private async getOwned(id: string, ownerId: string) {
    const [s] = await this.db
      .select()
      .from(liveStreams)
      .where(and(eq(liveStreams.id, id), eq(liveStreams.ownerId, ownerId)))
      .limit(1);
    if (!s) throw new ResourceNotFoundError('Live stream');
    return s;
  }

  /** The creator's view: state, ingest health and where to point OBS (never the key). */
  private async serialize(s: LiveRow) {
    const [video] = await this.videos.listByIds([s.videoId], { includeUnpublished: true });
    const host = process.env.LIVE_INGEST_HOST ?? 'localhost';
    const path = livePath(s.id);
    return {
      id: s.id,
      video_id: s.videoId,
      state: s.state,
      scheduled_at: s.scheduledAt,
      started_at: s.startedAt,
      ended_at: s.endedAt,
      record: s.record,
      recording_state: s.recordingState,
      ingest: {
        connected: s.ingestConnected,
        last_seen_at: s.lastIngestAt,
        width: s.sourceWidth,
        height: s.sourceHeight,
        fps: s.sourceFps,
        codec: s.sourceCodec,
        // OBS: Server = rtmp_url, Stream key = `<id>?user=key&pass=<key>` (shown with the key).
        rtmp_url: `rtmp://${host}/live`,
        rtmp_stream_name: s.id,
        // SRT (better on lossy mobile uplinks): append the key as `…:key:<key>`.
        srt_url: `srt://${host}:8890?streamid=publish:${path}`,
      },
      video: video ?? null,
    };
  }
}
