import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, hasDb, makeUser, services } from '../../test/harness';
import { liveStreams, purchases, videos as videosTable } from '../../db/schema';
import { VideosService } from '../videos/videos.service';
import { AccessService } from '../videos/access.service';
import { PlaybackService } from '../videos/playback.service';
import { VideosRepository } from '../videos/videos.repository';
import { LivePlaybackService } from '../videos/live-playback.service';
import { LiveService } from './live.service';
import type { Db } from '../../db/db.module';
import type { StorageService } from '../../storage/storage.service';

const storage = {
  videoBucketName: 'videos',
  thumbBucketName: 'thumbs',
  getPresignedGetUrl: async (_b: string, key: string) => `https://s3.local/${key}?sig=x`,
} as unknown as StorageService;

describe.skipIf(!hasDb)('live streams (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let videos: VideosService;
  let live: LiveService;

  beforeAll(() => {
    ({ db, close } = connect());
    const { fx } = services(db);
    videos = new VideosService(
      db,
      storage,
      new AccessService(db, fx),
      fx,
      new PlaybackService(storage),
      new VideosRepository(db),
      new LivePlaybackService(),
    );
    live = new LiveService(db, videos);
  });
  afterAll(async () => close());

  const apiBase = 'https://api.test';

  it('runs a pay-once stream: schedule, paywall, ingest auth, live grant, end, replay', async () => {
    const creator = await makeUser(db, { role: 'creator', canonicalPricingCurrency: 'USD' });
    const buyer = await makeUser(db);
    const stranger = await makeUser(db);
    const created = await live.create(creator.id, {
      title: 'Gospel night 2026',
      category: 'faith',
      access_mode: 'ppv',
      ppv_price_minor_units: 100,
      ppv_price_currency: 'USD',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(created.state).toBe('scheduled');
    expect(created.stream_key.length).toBeGreaterThan(20);
    expect(created.video?.live?.state).toBe('scheduled');

    // Upcoming and paid: strangers see the paywall (and can pre-buy), buyers see "upcoming".
    const asStranger = { id: stranger.id, role: 'viewer' };
    const asBuyer = { id: buyer.id, role: 'viewer' };
    expect(await videos.getSignedPlaylistUrl(created.video_id, asStranger, apiBase)).toHaveProperty(
      'access_denied',
      true,
    );
    await db.insert(purchases).values({
      userId: buyer.id,
      videoId: created.video_id,
      state: 'completed',
      paidAmountMinor: '100',
      paidCurrency: 'USD',
      usdEquivalentMinor: '100',
      completedAt: new Date(),
    });
    expect(await videos.getSignedPlaylistUrl(created.video_id, asBuyer, apiBase)).toMatchObject({
      upcoming: true,
    });
    expect((await live.listPublic('upcoming')).items.map((v) => v.id)).toContain(created.video_id);

    // Ingest auth: right key publishes, wrong key or path doesn't; reads only from loopback.
    const path = `live/${created.id}`;
    const ok = (body: object) => live.authorizeIngest(body);
    expect(await ok({ action: 'publish', path, password: created.stream_key })).toBe(true);
    expect(
      await ok({ action: 'publish', path, query: `user=key&pass=${created.stream_key}` }),
    ).toBe(true);
    expect(await ok({ action: 'publish', path, password: 'nope' })).toBe(false);
    expect(await ok({ action: 'publish', path: 'live/x', password: created.stream_key })).toBe(
      false,
    );
    expect(await ok({ action: 'read', path, ip: '127.0.0.1' })).toBe(true);
    expect(await ok({ action: 'read', path, ip: '41.57.1.2' })).toBe(false);

    // Worker reports the 4K source: live, signed origin URL for the buyer only.
    await live.ingestEvent(created.id, {
      event: 'started',
      width: 3840,
      height: 2160,
      fps: 30,
      codec: 'h264',
    });
    const grant = (await videos.getSignedPlaylistUrl(created.video_id, asBuyer, apiBase)) as {
      url: string;
      live: boolean;
    };
    expect(grant.live).toBe(true);
    expect(grant.url).toMatch(new RegExp(`/hls/[\\w-]+/\\d+/${created.id}/master\\.m3u8$`));
    expect(await videos.getSignedPlaylistUrl(created.video_id, asStranger, apiBase)).toHaveProperty(
      'access_denied',
      true,
    );
    expect((await live.listPublic('live')).items.map((v) => v.id)).toContain(created.video_id);

    // A key reset locks out the old key; the creator ends the stream.
    const reset = await live.resetKey(created.id, creator.id);
    expect(await ok({ action: 'publish', path, password: created.stream_key })).toBe(false);
    expect(await ok({ action: 'publish', path, password: reset.stream_key })).toBe(true);
    await live.end(created.id, creator.id);
    expect(await ok({ action: 'publish', path, password: reset.stream_key })).toBe(false);

    // Exactly one worker claims the recording; until it's ready the replay is "processing".
    expect(await live.claimRecording(created.id)).toMatchObject({ claimed: true });
    expect(await live.claimRecording(created.id)).toEqual({ claimed: false });
    await expect(
      videos.getSignedPlaylistUrl(created.video_id, asBuyer, apiBase),
    ).rejects.toMatchObject({ code: 'REPLAY_PROCESSING' });
    await live.recordingResult(created.id, {
      status: 'ready',
      duration_seconds: 5400,
      thumbnail: true,
    });
    const replay = (await videos.getSignedPlaylistUrl(created.video_id, asBuyer, apiBase)) as {
      url: string;
      live?: boolean;
    };
    expect(replay.live).toBeUndefined();
    expect(replay.url).toContain(`/playback/${created.video_id}/`);
    const [v] = await db.select().from(videosTable).where(eq(videosTable.id, created.video_id));
    expect(v).toMatchObject({ durationSeconds: 5400, state: 'published' });
  });

  it('sweeps streams whose ingest vanished, and unpublishes unrecorded ones', async () => {
    const creator = await makeUser(db, { role: 'creator' });
    const s = await live.create(creator.id, {
      title: 'Township derby',
      access_mode: 'free',
      record: false,
    });
    await live.ingestEvent(s.id, { event: 'started', width: 1920, height: 1080 });
    await live.ingestEvent(s.id, { event: 'disconnected' });
    expect((await live.sweep()).ended).toBe(0); // still inside the reconnect grace

    await db
      .update(liveStreams)
      .set({ lastIngestAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(liveStreams.id, s.id));
    expect((await live.sweep()).ended).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(liveStreams).where(eq(liveStreams.id, s.id));
    expect(row!.state).toBe('ended');
    const [v] = await db.select().from(videosTable).where(eq(videosTable.id, s.video_id));
    expect(v!.state).toBe('unpublished');
    expect(await live.claimRecording(s.id)).toEqual({ claimed: false });
  });

  it('cancels upcoming streams and guards ownership', async () => {
    const creator = await makeUser(db, { role: 'creator' });
    const other = await makeUser(db, { role: 'creator' });
    const s = await live.create(creator.id, { title: 'Comedy night', access_mode: 'premium' });
    await expect(live.end(s.id, creator.id)).rejects.toThrow(/scheduled → ended/);
    await expect(live.cancel(s.id, other.id)).rejects.toThrow(/not found/);
    expect((await live.cancel(s.id, creator.id)).state).toBe('cancelled');
    await expect(
      live.authorizeIngest({ action: 'publish', path: `live/${s.id}`, password: s.stream_key }),
    ).resolves.toBe(false);
    await expect(live.create(creator.id, { title: 'x', access_mode: 'ppv' })).rejects.toThrow(
      /price/,
    );
  });
});
