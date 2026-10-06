import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { watchSessions } from '../../db/schema';
import { ResourceNotFoundError } from '../auth/errors';

const HEARTBEAT_MIN_MS = 10_000; // 10s
const HEARTBEAT_MAX_MS = 25_000; // 25s (15s target ± buffer)
const HEARTBEATS_PER_MINUTE = 4;

@Injectable()
export class WatchService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async startSession(userId: string | null, videoId: string): Promise<{ session_id: string }> {
    const [session] = await this.db
      .insert(watchSessions)
      .values({
        userId,
        videoId,
      })
      .returning();
    return { session_id: session!.id };
  }

  /**
   * Heartbeat (Invariant §10: watch time derives from ~15s heartbeats only).
   *
   * A heartbeat counts only if it arrives 10–25s after the previous one. Four counted
   * heartbeats make one minute: `minutes_watched = heartbeat_count / 4`. The check and the
   * increment are one conditional UPDATE, so duplicate or concurrent heartbeats can't
   * double-count.
   */
  async heartbeat(sessionId: string, userId: string | null): Promise<void> {
    const conditions = [eq(watchSessions.id, sessionId), eq(watchSessions.ended, false)];
    if (userId) conditions.push(eq(watchSessions.userId, userId));

    const inWindow = sql`${watchSessions.lastHeartbeat} BETWEEN now() - make_interval(secs => ${HEARTBEAT_MAX_MS / 1000}) AND now() - make_interval(secs => ${HEARTBEAT_MIN_MS / 1000})`;

    const counted = await this.db
      .update(watchSessions)
      .set({
        lastHeartbeat: sql`now()`,
        heartbeatCount: sql`${watchSessions.heartbeatCount} + 1`,
        minutesWatched: sql`(${watchSessions.heartbeatCount} + 1) / ${HEARTBEATS_PER_MINUTE}`,
      })
      .where(and(...conditions, inWindow))
      .returning({ id: watchSessions.id });
    if (counted.length > 0) return;

    // Too early: ignore entirely (keeps the anchor so spamming can't shift the window).
    // Too late (a pause or dropped connection): re-anchor without counting.
    const reanchored = await this.db
      .update(watchSessions)
      .set({ lastHeartbeat: sql`now()` })
      .where(
        and(
          ...conditions,
          sql`${watchSessions.lastHeartbeat} < now() - make_interval(secs => ${HEARTBEAT_MAX_MS / 1000})`,
        ),
      )
      .returning({ id: watchSessions.id });
    if (reanchored.length > 0) return;

    const [exists] = await this.db
      .select({ id: watchSessions.id })
      .from(watchSessions)
      .where(and(...conditions))
      .limit(1);
    if (!exists) throw new ResourceNotFoundError('Watch session');
  }

  async endSession(sessionId: string, userId: string | null): Promise<void> {
    const conditions = [eq(watchSessions.id, sessionId)];
    if (userId) conditions.push(eq(watchSessions.userId, userId));

    await this.db
      .update(watchSessions)
      .set({ ended: true })
      .where(and(...conditions));
  }
}
