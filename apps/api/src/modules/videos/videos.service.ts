import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { DB, type Db } from '../../db/db.module';
import { captions, users as schema_users, videos } from '../../db/schema';
import { StorageService } from '../../storage/storage.service';
import { AccessService } from './access.service';
import { assertTransition } from './state';
import { originalKey } from '@streamzw/shared';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { z } from 'zod';

const CreateVideoSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  access_mode: z.enum(['free', 'ppv', 'premium', 'premium_buyable']),
  ppv_price_minor_units: z.number().int().min(10).max(200).optional(),
  ppv_price_currency: z.enum(['USD', 'ZWG', 'ZAR', 'EUR', 'GBP']).optional(),
});

const UpdateVideoSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  access_mode: z.enum(['free', 'ppv', 'premium', 'premium_buyable']).optional(),
  ppv_price_minor_units: z.number().int().min(10).max(200).optional().nullable(),
  ppv_price_currency: z.enum(['USD', 'ZWG', 'ZAR', 'EUR', 'GBP']).optional().nullable(),
});

@Injectable()
export class VideosService {
  private readonly transcodeQueue: Queue;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly access: AccessService,
  ) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.transcodeQueue = new Queue('transcode', {
      connection: { url: redisUrl } as any,
    });
  }

  async createUploadSession(ownerId: string, body: unknown) {
    const parsed = CreateVideoSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');

    const dto = parsed.data;
    if (
      (dto.access_mode === 'ppv' || dto.access_mode === 'premium_buyable') &&
      (!dto.ppv_price_minor_units || !dto.ppv_price_currency)
    ) {
      throw new ValidationError(
        'ppv_price_minor_units and ppv_price_currency required for ppv/premium_buyable',
      );
    }

    const [video] = await this.db
      .insert(videos)
      .values({
        ownerId,
        title: dto.title,
        description: dto.description,
        accessMode: dto.access_mode,
        ppvPriceMinorUnits: dto.ppv_price_minor_units ? String(dto.ppv_price_minor_units) : null,
        ppvPriceCurrency: dto.ppv_price_currency ?? null,
        state: 'uploading',
      })
      .returning();

    if (!video) throw new Error('Failed to create video');

    const key = originalKey(video.id);
    const presignedUrl = await this.storage.getPresignedPutUrl(this.storage.videoBucketName, key);

    return {
      video_id: video.id,
      presigned_url: presignedUrl,
      key,
    };
  }

  async completeUpload(videoId: string, ownerId: string) {
    const video = await this.getOwned(videoId, ownerId);

    const key = originalKey(videoId);
    const exists = await this.storage.objectExists(this.storage.videoBucketName, key);
    if (!exists) {
      throw new ValidationError('Upload not found in storage; PUT to presigned URL first');
    }

    const transcodeEnabled = process.env.TRANSCODE_ENABLED !== 'false';

    if (transcodeEnabled) {
      assertTransition(video.state, 'processing');
      await this.db
        .update(videos)
        .set({ state: 'processing', updatedAt: new Date() })
        .where(eq(videos.id, videoId));

      await this.transcodeQueue.add(
        'transcode',
        { videoId },
        {
          jobId: `transcode-${videoId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );

      return { status: 'processing' };
    }

    // Transcode disabled — serve original mp4 directly (MVP mode).
    assertTransition(video.state, 'ready');
    await this.db
      .update(videos)
      .set({ state: 'ready', hlsPlaylistKey: key, updatedAt: new Date() })
      .where(eq(videos.id, videoId));

    return { status: 'ready' };
  }

  async publish(videoId: string, ownerId: string) {
    const video = await this.getOwned(videoId, ownerId);
    assertTransition(video.state, 'published');

    const [updated] = await this.db
      .update(videos)
      .set({ state: 'published', publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(videos.id, videoId))
      .returning();

    return updated!;
  }

  async update(videoId: string, ownerId: string, body: unknown) {
    const parsed = UpdateVideoSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');

    await this.getOwned(videoId, ownerId);

    const dto = parsed.data;
    const [updated] = await this.db
      .update(videos)
      .set({
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.access_mode !== undefined && { accessMode: dto.access_mode }),
        ...(dto.ppv_price_minor_units !== undefined && {
          ppvPriceMinorUnits: dto.ppv_price_minor_units ? String(dto.ppv_price_minor_units) : null,
        }),
        ...(dto.ppv_price_currency !== undefined && { ppvPriceCurrency: dto.ppv_price_currency }),
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId))
      .returning();

    return updated!;
  }

  async findById(videoId: string, userId?: string) {
    const [video] = await this.db.select().from(videos).where(eq(videos.id, videoId)).limit(1);

    if (!video) throw new ResourceNotFoundError('Video');

    let accessCheckResult = null;
    if (userId) {
      const user = { id: userId, preferredDisplayCurrency: 'USD' };
      accessCheckResult = await this.access.checkAccess(user, video);
    } else {
      accessCheckResult = await this.access.checkAccess(null, video);
    }

    const creator = await this.db
      .select({
        id: schema_users.id,
        handle: schema_users.handle,
        displayName: schema_users.displayName,
      })
      .from(schema_users)
      .where(eq(schema_users.id, video.ownerId))
      .limit(1)
      .then((rows) => rows[0]);

    return {
      ...(await this.serialize(video)),
      creator: creator
        ? { id: creator.id, handle: creator.handle, display_name: creator.displayName }
        : null,
      access_check_result: accessCheckResult,
    };
  }

  private async serialize(v: typeof videos.$inferSelect) {
    return {
      id: v.id,
      owner_id: v.ownerId,
      title: v.title,
      description: v.description,
      access_mode: v.accessMode,
      ppv_price_minor_units: v.ppvPriceMinorUnits != null ? Number(v.ppvPriceMinorUnits) : null,
      ppv_price_currency: v.ppvPriceCurrency,
      in_premium_pool: v.inPremiumPool,
      state: v.state,
      duration_seconds: v.durationSeconds,
      hls_playlist_key: v.hlsPlaylistKey,
      thumbnail_key: v.thumbnailKey,
      thumbnail_url: await this.thumbnailUrl(v.thumbnailKey),
      published_at: v.publishedAt,
      created_at: v.createdAt,
      updated_at: v.updatedAt,
    };
  }

  private async thumbnailUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    if (/^https?:\/\//i.test(key)) return key;
    try {
      return await this.storage.getPresignedGetUrl(this.storage.thumbBucketName, key, 3600);
    } catch {
      return null;
    }
  }

  async list(filters: {
    mode?: string;
    creatorId?: string;
    q?: string;
    cursor?: string;
    limit?: number;
    includeUnpublished?: boolean;
  }) {
    const limit = Math.min(filters.limit ?? 20, 100);
    const conditions = [];
    if (!filters.includeUnpublished) {
      conditions.push(eq(videos.state, 'published'));
    }

    if (filters.mode) {
      conditions.push(
        eq(videos.accessMode, filters.mode as 'free' | 'ppv' | 'premium' | 'premium_buyable'),
      );
    }
    if (filters.creatorId) {
      conditions.push(eq(videos.ownerId, filters.creatorId));
    }

    const rows = await this.db
      .select()
      .from(videos)
      .where(and(...conditions))
      .orderBy(desc(videos.publishedAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    // Join creators in one shot
    const ownerIds = Array.from(new Set(slice.map((v) => v.ownerId)));
    const creators = ownerIds.length
      ? await this.db
          .select({
            id: schema_users.id,
            handle: schema_users.handle,
            displayName: schema_users.displayName,
          })
          .from(schema_users)
          .where(inArray(schema_users.id, ownerIds))
      : [];
    const byId = new Map(creators.map((c) => [c.id, c]));

    const items = await Promise.all(
      slice.map(async (v) => {
        const c = byId.get(v.ownerId);
        return {
          ...(await this.serialize(v)),
          creator: c ? { id: c.id, handle: c.handle, display_name: c.displayName } : null,
        };
      }),
    );
    const next_cursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return { items, next_cursor };
  }

  async getSignedPlaylistUrl(
    videoId: string,
    user: { id: string; preferredDisplayCurrency: string } | null,
  ) {
    const [video] = await this.db.select().from(videos).where(eq(videos.id, videoId)).limit(1);

    if (!video) throw new ResourceNotFoundError('Video');
    if (!video.hlsPlaylistKey) throw new ResourceNotFoundError('HLS playlist');

    const access = await this.access.checkAccess(user, video);
    if (!access.ok) return { access_denied: true, paywall: access.paywall };

    // Pass-through full URLs (used by test seed data); otherwise treat as a
    // storage object key and sign a 5-minute GET.
    const url = /^https?:\/\//i.test(video.hlsPlaylistKey)
      ? video.hlsPlaylistKey
      : await this.storage.getPresignedGetUrl(
          this.storage.videoBucketName,
          video.hlsPlaylistKey,
          300,
        );

    const captionRows = await this.db
      .select()
      .from(captions)
      .where(and(eq(captions.videoId, videoId), eq(captions.ready, true)));

    const signedCaptions = await Promise.all(
      captionRows.map(async (c) => ({
        id: c.id,
        language: c.language,
        label: c.label,
        kind: c.kind,
        is_default: c.isDefault,
        url: await this.storage.getPresignedGetUrl(this.storage.videoBucketName, c.key, 300),
      })),
    );

    return { url, captions: signedCaptions };
  }

  async listCaptions(videoId: string) {
    const rows = await this.db.select().from(captions).where(eq(captions.videoId, videoId));
    return rows.map((c) => ({
      id: c.id,
      language: c.language,
      label: c.label,
      kind: c.kind,
      is_default: c.isDefault,
      ready: c.ready,
      created_at: c.createdAt,
    }));
  }

  async createCaption(
    videoId: string,
    ownerId: string,
    dto: { language: string; label: string; kind?: 'subtitles' | 'captions'; is_default?: boolean },
  ) {
    await this.getOwned(videoId, ownerId);

    if (dto.is_default) {
      await this.db
        .update(captions)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(captions.videoId, videoId), eq(captions.kind, dto.kind ?? 'subtitles')));
    }

    const key = `captions/${videoId}/${dto.language}-${Date.now()}.vtt`;
    const uploadUrl = await this.storage.getPresignedPutUrl(this.storage.videoBucketName, key, 900);

    const [row] = await this.db
      .insert(captions)
      .values({
        videoId,
        language: dto.language,
        label: dto.label,
        kind: dto.kind ?? 'subtitles',
        key,
        isDefault: dto.is_default ?? false,
        ready: false,
      })
      .returning();

    return {
      caption_id: row!.id,
      upload_url: uploadUrl,
      key,
      content_type: 'text/vtt',
    };
  }

  async completeCaption(videoId: string, ownerId: string, captionId: string) {
    await this.getOwned(videoId, ownerId);
    const [updated] = await this.db
      .update(captions)
      .set({ ready: true, updatedAt: new Date() })
      .where(and(eq(captions.id, captionId), eq(captions.videoId, videoId)))
      .returning();
    if (!updated) throw new ResourceNotFoundError('Caption');
    return updated;
  }

  async deleteCaption(videoId: string, ownerId: string, captionId: string) {
    await this.getOwned(videoId, ownerId);
    await this.db
      .delete(captions)
      .where(and(eq(captions.id, captionId), eq(captions.videoId, videoId)));
    return { ok: true };
  }

  private async getOwned(videoId: string, ownerId: string) {
    const [video] = await this.db
      .select()
      .from(videos)
      .where(and(eq(videos.id, videoId), eq(videos.ownerId, ownerId)))
      .limit(1);
    if (!video) throw new ResourceNotFoundError('Video');
    return video;
  }
}
