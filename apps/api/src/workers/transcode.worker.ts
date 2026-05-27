import { Logger } from '@nestjs/common';
import { Worker, Queue } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { Db } from '../db/db.module';
import type { StorageService } from '../storage/storage.service';
import { originalKey, masterPlaylistKey, renditionPlaylistKey } from '@streamzw/shared';
import { videos, renditions } from '../db/schema';
import { eq } from 'drizzle-orm';

const logger = new Logger('TranscodeWorker');

const RENDITIONS = [
  { height: 240, bitrate: 400, preset: 'ultrafast' },
  { height: 480, bitrate: 800, preset: 'fast' },
  { height: 720, bitrate: 2000, preset: 'fast' },
];

export function createTranscodeWorker(redisUrl: string, db: Db, storage: StorageService): Worker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = { url: redisUrl } as any;
  const thumbnailQueue = new Queue('thumbnail.extract', { connection: conn });

  return new Worker(
    'transcode',
    async (job) => {
      const { videoId } = job.data as { videoId: string };
      logger.log({ videoId }, 'Starting transcode');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `transcode-${videoId}-`));

      try {
        // 1. Download original
        const inputPath = path.join(tmpDir, 'original.mp4');
        const originalBuf = await storage.download(storage.videoBucketName, originalKey(videoId));
        fs.writeFileSync(inputPath, originalBuf);

        // 2. FFmpeg transcode to HLS per rendition
        const fluent = await import('fluent-ffmpeg');
        const ffmpeg = fluent.default;

        // Probe for duration
        let durationSeconds = 0;
        try {
          durationSeconds = await new Promise<number>((resolve, reject) => {
            ffmpeg(inputPath).ffprobe((err, meta) => {
              if (err) {
                reject(err);
                return;
              }
              resolve(Math.floor(meta.format.duration ?? 0));
            });
          });
        } catch {
          logger.warn({ videoId }, 'ffprobe failed');
        }

        const uploadedKeys: string[] = [];
        const masterLines: string[] = ['#EXTM3U'];

        for (const r of RENDITIONS) {
          const outDir = path.join(tmpDir, `${r.height}p`);
          fs.mkdirSync(outDir, { recursive: true });
          const playlistPath = path.join(outDir, 'index.m3u8');

          await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
              .outputOptions([
                `-vf scale=-2:${r.height}`,
                `-b:v ${r.bitrate}k`,
                '-c:v libx264',
                `-preset ${r.preset}`,
                '-c:a aac',
                '-b:a 128k',
                '-hls_time 6',
                '-hls_playlist_type vod',
                `-hls_segment_filename ${outDir}/seg%03d.ts`,
              ])
              .output(playlistPath)
              .on('end', () => resolve())
              .on('error', reject)
              .run();
          });

          // Upload all files in outDir
          const segFiles = fs.readdirSync(outDir);
          for (const f of segFiles) {
            const filePath = path.join(outDir, f);
            const s3Key =
              f === 'index.m3u8'
                ? renditionPlaylistKey(videoId, r.height)
                : `videos/${videoId}/${r.height}p/${f}`;
            const buf = fs.readFileSync(filePath);
            const ct = f.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
            await storage.uploadBuffer(storage.videoBucketName, s3Key, buf, ct);
            uploadedKeys.push(s3Key);
          }

          // Write rendition to DB
          await db
            .insert(renditions)
            .values({
              videoId,
              height: r.height,
              bitrateKbps: r.bitrate,
              key: renditionPlaylistKey(videoId, r.height),
              ready: true,
            })
            .onConflictDoNothing();

          masterLines.push(
            `#EXT-X-STREAM-INF:BANDWIDTH=${r.bitrate * 1000},RESOLUTION=${r.height === 240 ? '426x240' : r.height === 480 ? '854x480' : '1280x720'}`,
            `${r.height}p/index.m3u8`,
          );
        }

        // 3. Upload master playlist
        const masterContent = masterLines.join('\n');
        const masterKey = masterPlaylistKey(videoId);
        await storage.uploadBuffer(
          storage.videoBucketName,
          masterKey,
          Buffer.from(masterContent),
          'application/x-mpegURL',
        );

        // 4. Update video state
        await db
          .update(videos)
          .set({
            state: 'ready',
            durationSeconds,
            hlsPlaylistKey: masterKey,
            updatedAt: new Date(),
          })
          .where(eq(videos.id, videoId));

        // 5. Enqueue thumbnail extraction
        await thumbnailQueue.add(
          'thumbnail.extract',
          { videoId },
          {
            jobId: `thumb-${videoId}`,
          },
        );

        logger.log({ videoId }, 'Transcode complete');
      } catch (err) {
        logger.error({ videoId, err }, 'Transcode failed');
        await db
          .update(videos)
          .set({ state: 'failed', updatedAt: new Date() })
          .where(eq(videos.id, videoId));
        throw err;
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    {
      connection: conn,
      concurrency: 2,
    },
  );
}
