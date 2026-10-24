import { Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import type { StorageService } from '../storage/storage.service';
import {
  masterPlaylistKey,
  originalKey,
  renditionPlaylistKey,
  thumbnailKey,
} from '@streamzw/shared';
import { videos, renditions } from '../db/schema';
import { bullmqConnection } from '../common/bullmq-connection';
import { extractThumbnail, ladderFor, listFiles, probe, transcodeToHls } from './transcode';

const logger = new Logger('TranscodeWorker');

export const TRANSCODE_ATTEMPTS = 3;

export function createTranscodeWorker(redisUrl: string, db: Db, storage: StorageService): Worker {
  return new Worker(
    'transcode',
    async (job: Job<{ videoId: string }>) => {
      const { videoId } = job.data;
      try {
        await transcodeVideo(db, storage, videoId);
      } catch (err) {
        logger.error({ videoId, attempt: job.attemptsMade + 1, err }, 'Transcode failed');
        // Only give up once BullMQ has no retries left; until then the video stays `processing`.
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? TRANSCODE_ATTEMPTS)) {
          await db
            .update(videos)
            .set({ state: 'failed', updatedAt: new Date() })
            .where(eq(videos.id, videoId));
        }
        throw err;
      }
    },
    { connection: bullmqConnection(redisUrl), concurrency: 1 },
  );
}

/**
 * Original → HLS ladder (240/480/720/1080p, never above the source) + poster frame.
 * The master playlist is uploaded last, so a video only becomes playable once every
 * rendition it references exists.
 */
export async function transcodeVideo(db: Db, storage: StorageService, videoId: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `transcode-${videoId}-`));
  try {
    const inputPath = path.join(tmpDir, 'original');
    await storage.downloadToFile(storage.videoBucketName, originalKey(videoId), inputPath);

    const meta = await probe(inputPath);
    const ladder = ladderFor(meta.height);
    logger.log({ videoId, ...meta, ladder: ladder.map((r) => r.height) }, 'Transcoding');

    const outDir = path.join(tmpDir, 'hls');
    fs.mkdirSync(outDir);
    await transcodeToHls(inputPath, outDir, ladder, meta.hasAudio);

    const files = listFiles(outDir).filter((f) => f !== 'master.m3u8');
    for (const f of files) {
      await storage.uploadFile(
        storage.videoBucketName,
        `videos/${videoId}/${f}`,
        path.join(outDir, f),
        f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      );
    }
    const masterKey = masterPlaylistKey(videoId);
    await storage.uploadFile(
      storage.videoBucketName,
      masterKey,
      path.join(outDir, 'master.m3u8'),
      'application/vnd.apple.mpegurl',
    );

    for (const r of ladder) {
      await db
        .insert(renditions)
        .values({
          videoId,
          height: r.height,
          bitrateKbps: r.videoKbps + (meta.hasAudio ? r.audioKbps : 0),
          key: renditionPlaylistKey(videoId, r.height),
          ready: true,
        })
        .onConflictDoUpdate({
          target: [renditions.videoId, renditions.height],
          set: { ready: true, bitrateKbps: r.videoKbps + (meta.hasAudio ? r.audioKbps : 0) },
        });
    }

    // Poster frame, unless the creator already uploaded their own. Non-fatal.
    const [current] = await db
      .select({ thumbnailKey: videos.thumbnailKey })
      .from(videos)
      .where(eq(videos.id, videoId));
    let thumbKey = current?.thumbnailKey ?? null;
    if (!thumbKey) {
      try {
        const thumbPath = path.join(tmpDir, 'thumb.jpg');
        await extractThumbnail(inputPath, thumbPath, meta.durationSeconds);
        thumbKey = thumbnailKey(videoId);
        await storage.uploadFile(storage.thumbBucketName, thumbKey, thumbPath, 'image/jpeg');
      } catch (err) {
        logger.warn({ videoId, err }, 'Thumbnail extraction failed');
        thumbKey = null;
      }
    }

    await db
      .update(videos)
      .set({
        state: 'ready',
        durationSeconds: meta.durationSeconds,
        hlsPlaylistKey: masterKey,
        thumbnailKey: thumbKey,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));

    logger.log({ videoId }, 'Transcode complete');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
