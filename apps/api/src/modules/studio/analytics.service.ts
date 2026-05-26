import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { watchMinutesDaily, watchSessions, purchases } from '../../db/schema';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async watchMinutes(videoId: string, from: Date, to: Date): Promise<bigint> {
    // Try daily aggregates first
    const fromDate = from.toISOString().slice(0, 10);
    const toDate = to.toISOString().slice(0, 10);

    const [row] = await this.db
      .select({ total: sql<string>`COALESCE(SUM(minutes::bigint), 0)` })
      .from(watchMinutesDaily)
      .where(
        and(
          eq(watchMinutesDaily.videoId, videoId),
          gte(watchMinutesDaily.date, fromDate),
          lte(watchMinutesDaily.date, toDate),
        ),
      );

    if (row && row.total !== '0') return BigInt(row.total);

    // Fallback: sum from watch_sessions
    const [fallback] = await this.db
      .select({ total: sql<string>`COALESCE(SUM(minutes_watched), 0)` })
      .from(watchSessions)
      .where(
        and(
          eq(watchSessions.videoId, videoId),
          gte(watchSessions.startedAt, from),
          lte(watchSessions.startedAt, to),
        ),
      );

    return BigInt(fallback?.total ?? '0');
  }

  async conversionRate(videoId: string, from: Date, to: Date) {
    const [watchersRow] = await this.db
      .select({ count: sql<string>`COUNT(DISTINCT user_id)` })
      .from(watchSessions)
      .where(
        and(
          eq(watchSessions.videoId, videoId),
          gte(watchSessions.startedAt, from),
          lte(watchSessions.startedAt, to),
        ),
      );

    const [purchasesRow] = await this.db
      .select({ count: sql<string>`COUNT(*)` })
      .from(purchases)
      .where(
        and(
          eq(purchases.videoId, videoId),
          eq(purchases.state, 'completed'),
          gte(purchases.completedAt, from),
          lte(purchases.completedAt, to),
        ),
      );

    const watchers = parseInt(watchersRow?.count ?? '0', 10);
    const bought = parseInt(purchasesRow?.count ?? '0', 10);

    return {
      unique_watchers: watchers,
      purchases: bought,
      conversion_rate: watchers > 0 ? (bought / watchers).toFixed(4) : '0',
    };
  }
}
