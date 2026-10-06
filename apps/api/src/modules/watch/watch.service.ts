import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { watchSessions } from '../../db/schema';
import { AuthForbiddenError, ResourceNotFoundError } from '../auth/errors';
import { VideosService } from '../videos/videos.service';
import { AccessService } from '../videos/access.service';
import { WatchRepository } from './watch.repository';

const HEARTBEAT_MIN_MS = 10_000; // 10s
const HEARTBEAT_MAX_MS = 25_000; // 25s (15s target ± buffer)
const HEARTBEATS_PER_MINUTE = 4;

@Injectable()
export class WatchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly videos: VideosService,
    private readonly access: AccessService,
    private readonly repo: WatchRepository,
  ) {}

  /**
   * Start counting watch time. Only for a viewer who may actually watch the video
   * (Invariant §9 via AccessService), so nobody can farm premium-pool minutes on videos
   * they can't play. A signed-in viewer has one live stream: starting a session ends their
   * others, so parallel tabs or scripts can't multiply minutes.
   */
  async startSession(userId: string | null, videoId: string): Promise<{ session_id: string }> {
    const viewer = userId ? { id: userId, role: 'viewer' } : null;
    const video = await this.videos.getVisible(videoId, viewer);
    const user = userId ? { id: userId, preferredDisplayCurrency: 'USD' } : null;
    const access = await this.access.checkAccess(user, video);
    if (!access.ok) throw new AuthForbiddenError();

    if (userId) {
      await this.db
        .update(watchSessions)
        .set({ ended: true })
        .where(and(eq(watchSessions.userId, userId), eq(watchSessions.ended, false)));
    }

    const [session] = await this.db.insert(watchSessions).values({ userId, videoId }).returning();
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

    const where = and(...conditions)!;
    const min = HEARTBEAT_MIN_MS / 1000;
    const max = HEARTBEAT_MAX_MS / 1000;

    if (await this.repo.countHeartbeat(where, min, max, HEARTBEATS_PER_MINUTE)) return;
    // Too early: ignored (keeps the anchor so spamming can't shift the window).
    // Too late (a pause or dropped connection): re-anchor without counting.
    if (await this.repo.reanchorIfStale(where, max)) return;
    if (!(await this.repo.exists(where))) throw new ResourceNotFoundError('Watch session');
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
