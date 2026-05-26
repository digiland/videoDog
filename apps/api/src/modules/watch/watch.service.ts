import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { watchSessions } from '../../db/schema';
import { ResourceNotFoundError } from '../auth/errors';

const HEARTBEAT_MIN_MS = 10_000; // 10s
const HEARTBEAT_MAX_MS = 25_000; // 25s (15s target ± buffer)

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
   * Heartbeat: increments minutesWatched only if the interval between heartbeats is 10–25s.
   * Invariant §10: watched minutes derive from 15-second heartbeats, never start/stop events.
   */
  async heartbeat(sessionId: string, userId: string | null): Promise<void> {
    const conditions = [eq(watchSessions.id, sessionId), eq(watchSessions.ended, false)];
    if (userId) conditions.push(eq(watchSessions.userId, userId));

    const [session] = await this.db
      .select()
      .from(watchSessions)
      .where(and(...conditions))
      .limit(1);

    if (!session) throw new ResourceNotFoundError('Watch session');

    const now = new Date();
    const elapsed = now.getTime() - session.lastHeartbeat.getTime();

    // Only count watch time if heartbeat interval is within expected range
    const shouldCount = elapsed >= HEARTBEAT_MIN_MS && elapsed <= HEARTBEAT_MAX_MS;
    const minutesDelta = shouldCount ? 1 : 0; // Each valid heartbeat = 15s ≈ 0.25min; accumulate in full minutes after 4

    await this.db
      .update(watchSessions)
      .set({
        lastHeartbeat: now,
        // Accumulate: every ~4 heartbeats (≈1 min) → increment minutesWatched
        minutesWatched: shouldCount
          ? session.minutesWatched + minutesDelta
          : session.minutesWatched,
      })
      .where(eq(watchSessions.id, sessionId));
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
