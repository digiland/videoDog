import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { Db } from '../db/db.module';
import type { StorageService } from '../storage/storage.service';
import { originalKey, thumbnailKey } from '@streamzw/shared';
import { videos } from '../db/schema';
import { eq } from 'drizzle-orm';

const logger = new Logger('ThumbnailWorker');

export function createThumbnailWorker(redisUrl: string, db: Db, storage: StorageService): Worker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = { url: redisUrl } as any;
  return new Worker(
    'thumbnail.extract',
    async (job) => {
      const { videoId } = job.data as { videoId: string };
      logger.log({ videoId }, 'Extracting thumbnail');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `thumb-${videoId}-`));
      try {
        const inputPath = path.join(tmpDir, 'original.mp4');
        const thumbPath = path.join(tmpDir, 'thumb.jpg');

        const buf = await storage.download(storage.videoBucketName, originalKey(videoId));
        fs.writeFileSync(inputPath, buf);

        const fluent = await import('fluent-ffmpeg');
        const ffmpeg = fluent.default;

        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions(['-ss 1', '-frames:v 1', '-q:v 2'])
            .output(thumbPath)
            .on('end', () => resolve())
            .on('error', reject)
            .run();
        });

        const thumbBuf = fs.readFileSync(thumbPath);
        const key = thumbnailKey(videoId);
        await storage.uploadBuffer(storage.thumbBucketName, key, thumbBuf, 'image/jpeg');

        await db
          .update(videos)
          .set({ thumbnailKey: key, updatedAt: new Date() })
          .where(eq(videos.id, videoId));

        logger.log({ videoId, key }, 'Thumbnail extracted');
      } catch (err) {
        logger.warn({ videoId, err }, 'Thumbnail extraction failed — non-fatal');
        // Non-fatal: don't fail the job chain
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    { connection: conn, concurrency: 4 },
  );
}
