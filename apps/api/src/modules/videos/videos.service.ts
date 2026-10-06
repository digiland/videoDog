import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { DB, type Db } from '../../db/db.module';
import { captions, users as schema_users, videos, purchases } from '../../db/schema';
import { StorageService } from '../../storage/storage.service';
import { AccessService } from './access.service';
import { PlaybackService } from './playback.service';
import { VideosRepository } from './videos.repository';
import { FxService } from '../fx/fx.service';
import { assertTransition } from './state';
import { CURRENCY_CODES, originalKey, Money } from '@streamzw/shared';
import type { CurrencyCode } from '@streamzw/shared';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { z } from 'zod';
import { bullmqConnection } from '../../common/bullmq-connection';

const CreateVideoSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  access_mode: z.enum(['free', 'ppv', 'premium', 'premium_buyable']),
  ppv_price_minor_units: z.number().int().min(10).max(200).optional(),
  ppv_price_currency: z.enum(CURRENCY_CODES).optional(),
});

const UpdateVideoSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  access_mode: z.enum(['free', 'ppv', 'premium', 'premium_buyable']).optional(),
  ppv_price_minor_units: z.number().int().min(10).max(200).optional().nullable(),
  ppv_price_currency: z.enum(CURRENCY_CODES).optional().nullable(),
});

/** Who is asking. `null` = anonymous. */
export type Viewer = { id: string; role: string } | null;

const AccessModeSchema = z.enum(['free', 'ppv', 'premium', 'premium_buyable']);

@Injectable()
export class VideosService {
  private readonly transcodeQueue: Queue;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly access: AccessService,
    private readonly fx: FxService,
    private readonly playback: PlaybackService,
    private readonly repo: VideosRepository,
  ) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.transcodeQueue = new Queue('transcode', {
      connection: bullmqConnection(redisUrl),
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

    await this.assertPricingCurrency(ownerId, dto.ppv_price_currency);

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
    await this.assertPricingCurrency(ownerId, dto.ppv_price_currency);
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

  /**
   * §3.5: prices are in the creator's canonical currency, locked when they became a
   * creator. Viewers see conversions at render time; we never store a converted price.
   */
  private async assertPricingCurrency(ownerId: string, currency: string | null | undefined) {
    if (!currency) return;
    const [owner] = await this.db
      .select({ canonical: schema_users.canonicalPricingCurrency })
      .from(schema_users)
      .where(eq(schema_users.id, ownerId))
      .limit(1);
    if (owner?.canonical && owner.canonical !== currency) {
      throw new ValidationError(`Prices must be in your pricing currency (${owner.canonical})`);
    }
  }

  async findById(videoId: string, viewer: Viewer) {
    const video = await this.getVisible(videoId, viewer);
    const accessCheckResult = await this.access.checkAccess(await this.accessUser(viewer), video);

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
    const limit = Math.min(Math.max(Number.isFinite(filters.limit) ? filters.limit! : 20, 1), 100);
    const mode = filters.mode ? AccessModeSchema.safeParse(filters.mode) : undefined;
    if (mode && !mode.success) {
      throw new ValidationError('mode must be free, ppv, premium or premium_buyable');
    }

    // Text search: ranked by relevance, one page (rank order has no stable cursor).
    const q = filters.q?.trim();
    if (q) {
      const rows = await this.repo.searchPublished(q.slice(0, 200), mode?.data, limit);
      return { items: await this.withCreators(rows), next_cursor: null };
    }

    const conditions = [];
    if (!filters.includeUnpublished) {
      conditions.push(eq(videos.state, 'published'));
    }

    if (mode?.data) conditions.push(eq(videos.accessMode, mode.data));
    if (filters.creatorId) {
      conditions.push(eq(videos.ownerId, filters.creatorId));
    }

    // Keyset pagination on (sort column, id). Public lists sort by publish time; a creator's
    // own list (which includes drafts with no publish time) sorts by creation time.
    const sortCol = filters.includeUnpublished ? videos.createdAt : videos.publishedAt;
    if (filters.cursor) {
      const [anchor] = await this.db
        .select({ id: videos.id, at: sortCol })
        .from(videos)
        .where(eq(videos.id, filters.cursor))
        .limit(1);
      if (!anchor?.at) throw new ValidationError('Invalid cursor');
      conditions.push(
        or(lt(sortCol, anchor.at), and(eq(sortCol, anchor.at), lt(videos.id, anchor.id)))!,
      );
    }

    const rows = await this.db
      .select()
      .from(videos)
      .where(and(...conditions))
      .orderBy(desc(sortCol), desc(videos.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const items = await this.withCreators(slice);
    const next_cursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return { items, next_cursor };
  }

  private async withCreators(rows: (typeof videos.$inferSelect)[]) {
    const ownerIds = Array.from(new Set(rows.map((v) => v.ownerId)));
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
    return Promise.all(
      rows.map(async (v) => {
        const c = byId.get(v.ownerId);
        return {
          ...(await this.serialize(v)),
          creator: c ? { id: c.id, handle: c.handle, display_name: c.displayName } : null,
        };
      }),
    );
  }

  async getSignedPlaylistUrl(videoId: string, viewer: Viewer, apiBase: string) {
    const video = await this.getVisible(videoId, viewer);
    if (!video.hlsPlaylistKey) throw new ResourceNotFoundError('Playable video');

    const access = await this.access.checkAccess(await this.accessUser(viewer), video);
    if (!access.ok) return { access_denied: true, paywall: access.paywall };

    const grant = await this.playback.grant(video.id, video.hlsPlaylistKey, apiBase);

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
        url: await this.playback.captionUrl(c.key),
      })),
    );

    return { ...grant, captions: signedCaptions };
  }

  /**
   * Load a video the viewer may see at all: published videos for everyone; anything else
   * only for its owner or an admin. Others get 404, so drafts don't leak.
   */
  async getVisible(videoId: string, viewer: Viewer) {
    const [video] = await this.db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
    if (!video) throw new ResourceNotFoundError('Video');
    const privileged = viewer && (viewer.id === video.ownerId || viewer.role === 'admin');
    if (video.state !== 'published' && !privileged) throw new ResourceNotFoundError('Video');
    return video;
  }

  /** The user shape AccessService needs, with their display currency for paywall quotes. */
  private async accessUser(viewer: Viewer) {
    if (!viewer) return null;
    const [u] = await this.db
      .select({ id: schema_users.id, currency: schema_users.preferredDisplayCurrency })
      .from(schema_users)
      .where(eq(schema_users.id, viewer.id))
      .limit(1);
    return u ? { id: u.id, preferredDisplayCurrency: u.currency } : null;
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

  async createPurchase(userId: string, body: unknown) {
    const CreatePurchaseSchema = z.object({
      video_id: z.string().uuid(),
      payment_currency: z.enum(['USD', 'ZWG', 'ZAR']),
    });

    const parsed = CreatePurchaseSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    const [video] = await this.db.select().from(videos).where(eq(videos.id, dto.video_id)).limit(1);
    if (!video || video.state !== 'published') throw new ResourceNotFoundError('Video');

    if (video.accessMode !== 'ppv' && video.accessMode !== 'premium_buyable') {
      throw new ValidationError('Video is not available for individual purchase');
    }

    // Check if already purchased
    const [existing] = await this.db
      .select()
      .from(purchases)
      .where(and(eq(purchases.userId, userId), eq(purchases.videoId, dto.video_id)))
      .limit(1);

    if (existing) {
      if (existing.state === 'completed') {
        throw new ValidationError('Video already purchased');
      }
    }

    const paymentCurrency = dto.payment_currency as CurrencyCode;
    const baseMoney = new Money(
      BigInt(video.ppvPriceMinorUnits!),
      video.ppvPriceCurrency as CurrencyCode,
    );

    let chargedAmount: Money;
    let usdEquiv: Money;
    let fxRateId: string | null = null;

    if (paymentCurrency === video.ppvPriceCurrency) {
      chargedAmount = baseMoney;
      usdEquiv =
        baseMoney.currency === 'USD'
          ? baseMoney
          : await (async () => {
              const r = await this.fx.convertToUsd(baseMoney);
              fxRateId = r.fxRate.id === 'identity' ? null : r.fxRate.id;
              return r.usd;
            })();
    } else {
      const { converted, fxRate } = await this.fx.convert(baseMoney, paymentCurrency);
      fxRateId = fxRate.id === 'identity' ? null : fxRate.id;
      chargedAmount = converted;
      const usdResult = await this.fx.convertToUsd(chargedAmount);
      usdEquiv = usdResult.usd;
      if (!fxRateId && usdResult.fxRate.id !== 'identity') fxRateId = usdResult.fxRate.id;
    }

    const [row] = await this.db
      .insert(purchases)
      .values({
        userId,
        videoId: video.id,
        state: 'pending',
        paidAmountMinor: String(chargedAmount.amount),
        paidCurrency: paymentCurrency,
        usdEquivalentMinor: String(usdEquiv.amount),
        fxRateId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [purchases.userId, purchases.videoId],
        set: {
          state: 'pending',
          paidAmountMinor: String(chargedAmount.amount),
          paidCurrency: paymentCurrency,
          usdEquivalentMinor: String(usdEquiv.amount),
          fxRateId,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      purchase_id: row!.id,
      paid_amount: chargedAmount.toJSON(),
      usd_equivalent: usdEquiv.toJSON(),
    };
  }

  async getThumbnailUploadUrl(videoId: string, ownerId: string) {
    await this.getOwned(videoId, ownerId);
    const key = `thumbnails/${videoId}-${Date.now()}.jpg`;
    const uploadUrl = await this.storage.getPresignedPutUrl(
      this.storage.thumbBucketName,
      key,
      3600,
    );
    return { upload_url: uploadUrl, key };
  }

  async completeThumbnailUpload(videoId: string, ownerId: string, key: string) {
    await this.getOwned(videoId, ownerId);

    const exists = await this.storage.objectExists(this.storage.thumbBucketName, key);
    if (!exists) throw new ValidationError('Thumbnail file not uploaded to storage yet');

    const [updated] = await this.db
      .update(videos)
      .set({ thumbnailKey: key, updatedAt: new Date() })
      .where(eq(videos.id, videoId))
      .returning();

    return this.serialize(updated!);
  }
}
