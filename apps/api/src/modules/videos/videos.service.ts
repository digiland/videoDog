import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { DB, type Db } from '../../db/db.module';
import { videos } from '../../db/schema';
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
    const uploadId = await this.storage.createMultipartUpload(this.storage.videoBucketName, key);
    const presignedUrl = await this.storage.getPresignedPutUrl(
      this.storage.videoBucketName,
      key,
      uploadId,
      1,
    );

    return {
      video_id: video.id,
      upload_id: uploadId,
      presigned_url: presignedUrl,
      key,
    };
  }

  async completeUpload(
    videoId: string,
    ownerId: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[],
  ) {
    const video = await this.getOwned(videoId, ownerId);
    assertTransition(video.state, 'processing');

    const key = originalKey(videoId);
    await this.storage.completeMultipartUpload(this.storage.videoBucketName, key, uploadId, parts);

    await this.db
      .update(videos)
      .set({ state: 'processing', updatedAt: new Date() })
      .where(eq(videos.id, videoId));

    await this.transcodeQueue.add(
      'transcode',
      { videoId },
      {
        jobId: `transcode:${videoId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return { status: 'processing' };
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

    return { ...video, access_check_result: accessCheckResult };
  }

  async list(filters: {
    mode?: string;
    creatorId?: string;
    q?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(filters.limit ?? 20, 100);
    const conditions = [eq(videos.state, 'published')];

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
      .limit(limit);

    return rows;
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

    const url = await this.storage.getPresignedGetUrl(
      this.storage.videoBucketName,
      video.hlsPlaylistKey,
      300, // 5 minute signed URL
    );

    return { url };
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
