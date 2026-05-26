import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { sql, and, eq, gte, lt } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { watchSessions, watchMinutesDaily } from '../db/schema';

const logger = new Logger('WatchAggregateWorker');

export function createWatchAggregateWorker(redisUrl: string, db: Db): Worker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = { url: redisUrl } as any;
  return new Worker(
    'watch.aggregate',
    async (job) => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);
      const dayStart = new Date(dateStr + 'T00:00:00Z');
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      logger.log({ date: dateStr }, 'Aggregating watch minutes');

      const rows = await db
        .select({
          videoId: watchSessions.videoId,
          minutes: sql<string>`SUM(minutes_watched)`,
        })
        .from(watchSessions)
        .where(and(gte(watchSessions.startedAt, dayStart), lt(watchSessions.startedAt, dayEnd)))
        .groupBy(watchSessions.videoId);

      for (const row of rows) {
        await db
          .insert(watchMinutesDaily)
          .values({
            date: dateStr,
            videoId: row.videoId,
            minutes: row.minutes ?? '0',
          })
          .onConflictDoUpdate({
            target: [watchMinutesDaily.date, watchMinutesDaily.videoId],
            set: { minutes: row.minutes ?? '0' },
          });
      }

      logger.log({ date: dateStr, count: rows.length }, 'Watch aggregation complete');
    },
    { connection: conn },
  );
}
