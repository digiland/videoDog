import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { connect, hasDb, makeUser, makeVideo } from '../../test/harness';
import { WatchService } from './watch.service';
import { watchSessions } from '../../db/schema';
import type { Db } from '../../db/db.module';

describe.skipIf(!hasDb)('watch heartbeats (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let watch: WatchService;

  beforeAll(() => {
    ({ db, close } = connect());
    watch = new WatchService(db);
  });
  afterAll(async () => close());

  /** Pretend the previous heartbeat arrived `secondsAgo` seconds ago. */
  async function rewind(sessionId: string, secondsAgo: number) {
    await db
      .update(watchSessions)
      .set({ lastHeartbeat: sql`now() - make_interval(secs => ${secondsAgo})` })
      .where(eq(watchSessions.id, sessionId));
  }

  async function session(sessionId: string) {
    const [row] = await db.select().from(watchSessions).where(eq(watchSessions.id, sessionId));
    return row!;
  }

  it('counts four 15s heartbeats as one minute, not four', async () => {
    const creator = await makeUser(db, { role: 'creator' });
    const video = await makeVideo(db, creator.id);
    const { session_id } = await watch.startSession(null, video.id);

    for (let i = 0; i < 4; i++) {
      await rewind(session_id, 15);
      await watch.heartbeat(session_id, null);
    }
    const s = await session(session_id);
    expect(s.heartbeatCount).toBe(4);
    expect(s.minutesWatched).toBe(1);
  });

  it('ignores early and duplicate heartbeats, and concurrent ones count once', async () => {
    const creator = await makeUser(db, { role: 'creator' });
    const video = await makeVideo(db, creator.id);
    const { session_id } = await watch.startSession(null, video.id);

    await watch.heartbeat(session_id, null); // 0s after start: too early
    expect((await session(session_id)).heartbeatCount).toBe(0);

    await rewind(session_id, 15);
    await Promise.all([1, 2, 3].map(() => watch.heartbeat(session_id, null)));
    expect((await session(session_id)).heartbeatCount).toBe(1);
  });

  it('re-anchors without counting after a long gap', async () => {
    const creator = await makeUser(db, { role: 'creator' });
    const video = await makeVideo(db, creator.id);
    const { session_id } = await watch.startSession(null, video.id);

    await rewind(session_id, 300);
    await watch.heartbeat(session_id, null);
    expect((await session(session_id)).heartbeatCount).toBe(0);

    await rewind(session_id, 15);
    await watch.heartbeat(session_id, null);
    expect((await session(session_id)).heartbeatCount).toBe(1);
  });
});
