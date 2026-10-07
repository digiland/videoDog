import { Inject, Injectable } from '@nestjs/common';
import { and, sql, type SQL } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { watchSessions } from '../../db/schema';

/** Raw-SQL watch-session updates (CLAUDE.md §9: raw SQL only in repositories). */
@Injectable()
export class WatchRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Count a heartbeat iff the previous one was `minSecs`–`maxSecs` ago, in one conditional
   * UPDATE (no double counting under concurrency). Returns whether it counted.
   */
  async countHeartbeat(where: SQL, minSecs: number, maxSecs: number, perMinute: number) {
    const rows = await this.db
      .update(watchSessions)
      .set({
        lastHeartbeat: sql`now()`,
        heartbeatCount: sql`${watchSessions.heartbeatCount} + 1`,
        minutesWatched: sql`(${watchSessions.heartbeatCount} + 1) / ${perMinute}`,
      })
      .where(
        and(
          where,
          sql`${watchSessions.lastHeartbeat} BETWEEN now() - make_interval(secs => ${maxSecs}) AND now() - make_interval(secs => ${minSecs})`,
        ),
      )
      .returning({ id: watchSessions.id });
    return rows.length > 0;
  }

  /** After a gap longer than `maxSecs` (pause, dropped signal), restart the window. */
  async reanchorIfStale(where: SQL, maxSecs: number) {
    const rows = await this.db
      .update(watchSessions)
      .set({ lastHeartbeat: sql`now()` })
      .where(
        and(where, sql`${watchSessions.lastHeartbeat} < now() - make_interval(secs => ${maxSecs})`),
      )
      .returning({ id: watchSessions.id });
    return rows.length > 0;
  }

  async exists(where: SQL) {
    const [row] = await this.db
      .select({ id: watchSessions.id })
      .from(watchSessions)
      .where(where)
      .limit(1);
    return !!row;
  }
}
