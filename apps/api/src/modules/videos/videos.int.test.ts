import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, hasDb, makeUser, makeVideo, services } from '../../test/harness';
import { VideosService } from './videos.service';
import { AccessService } from './access.service';
import { PlaybackService } from './playback.service';
import { VideosRepository } from './videos.repository';
import { eq } from 'drizzle-orm';
import { purchases, videos as videosTable } from '../../db/schema';
import type { Db } from '../../db/db.module';
import type { StorageService } from '../../storage/storage.service';

const storage = {
  videoBucketName: 'videos',
  thumbBucketName: 'thumbs',
  getPresignedGetUrl: async (_b: string, key: string) => `https://s3.local/${key}?sig=x`,
} as unknown as StorageService;

describe.skipIf(!hasDb)('video visibility and playback grants (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let videos: VideosService;

  beforeAll(() => {
    process.env.PLAYBACK_SIGNING_SECRET = 'playback-secret-for-tests-0123456789';
    ({ db, close } = connect());
    const { fx } = services(db);
    const access = new AccessService(db, fx);
    videos = new VideosService(
      db,
      storage,
      access,
      fx,
      new PlaybackService(storage),
      new VideosRepository(db),
    );
  });
  afterAll(async () => close());

  it('hides drafts from everyone but the owner and admins', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const draft = await makeVideo(db, owner.id, { state: 'ready', publishedAt: null });

    await expect(videos.findById(draft.id, null)).rejects.toThrow(/not found/i);
    const stranger = await makeUser(db);
    await expect(videos.findById(draft.id, { id: stranger.id, role: 'viewer' })).rejects.toThrow(
      /not found/i,
    );
    await expect(
      videos.findById(draft.id, { id: owner.id, role: 'creator' }),
    ).resolves.toBeTruthy();
    await expect(
      videos.findById(draft.id, { id: stranger.id, role: 'admin' }),
    ).resolves.toBeTruthy();
  });

  it('never exposes the storage key', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const v = await makeVideo(db, owner.id, { hlsPlaylistKey: `videos/x/master.m3u8` });
    const out = await videos.findById(v.id, null);
    expect(out).not.toHaveProperty('hls_playlist_key');
  });

  it('paywalls a PPV video and grants playback once purchased', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const viewer = await makeUser(db);
    const v = await makeVideo(db, owner.id);
    await db
      .update(videosTable)
      .set({ hlsPlaylistKey: `videos/${v.id}/master.m3u8` })
      .where(eq(videosTable.id, v.id));

    const viewerRef = { id: viewer.id, role: 'viewer' };
    const denied = await videos.getSignedPlaylistUrl(v.id, viewerRef, 'https://api.test');
    expect(denied).toMatchObject({ access_denied: true });

    await db.insert(purchases).values({
      userId: viewer.id,
      videoId: v.id,
      state: 'completed',
      paidAmountMinor: '150',
      paidCurrency: 'USD',
      usdEquivalentMinor: '150',
    });
    const granted = await videos.getSignedPlaylistUrl(v.id, viewerRef, 'https://api.test');
    expect(granted).toMatchObject({ kind: 'hls' });
    expect((granted as { url: string }).url).toMatch(
      new RegExp(`^https://api\\.test/playback/${v.id}/`),
    );
  });

  it("quotes the paywall in the viewer's display currency (render-only)", async () => {
    // Same steps as the admin override: close the open manual rate, insert the new one.
    const { fx } = services(db);
    await fx.closeCurrentRates('USD', 'ZAR', 'manual');
    await fx.insertRate({
      base: 'USD',
      quote: 'ZAR',
      rate: '18.5000000000',
      source: 'manual',
      sourcePriority: 100,
    });
    const owner = await makeUser(db, { role: 'creator' });
    const viewer = await makeUser(db, { preferredDisplayCurrency: 'ZAR' });
    const v = await makeVideo(db, owner.id, { ppvPriceMinorUnits: '200' });

    const out = await videos.findById(v.id, { id: viewer.id, role: 'viewer' });
    const result = out.access_check_result as {
      ok: false;
      paywall: { options: { buy: { price: unknown; display_price: unknown } } };
    };
    expect(result.paywall.options.buy.price).toEqual({ amount_minor: '200', currency: 'USD' });
    expect(result.paywall.options.buy.display_price).toEqual({
      amount_minor: '3700',
      currency: 'ZAR',
    });
  });

  it('full-text search returns serialised published videos only', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const word = `zebra${Date.now()}`;
    const pub = await makeVideo(db, owner.id, { title: `Mbira lesson ${word}` });
    await makeVideo(db, owner.id, { title: `Draft ${word}`, state: 'ready', publishedAt: null });

    const { items } = await videos.list({ q: word });
    expect(items.map((v) => v.id)).toEqual([pub.id]);
    expect(items[0]).not.toHaveProperty('hls_playlist_key');
    await expect(videos.list({ mode: 'bogus' })).rejects.toThrow(/mode must be/);
  });

  it('pages through the catalogue with the cursor', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    for (let i = 0; i < 3; i++) await makeVideo(db, owner.id);
    const first = await videos.list({ creatorId: owner.id, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = await videos.list({ creatorId: owner.id, limit: 2, cursor: first.next_cursor! });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    expect(second.items[0]!.id).not.toBe(first.items[1]!.id);
  });

  it('deletes only never-published, unsold drafts; unpublish hides from the catalogue', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const draft = await makeVideo(db, owner.id, { state: 'uploading', publishedAt: null });
    await videos.deleteDraft(draft.id, owner.id);
    await expect(videos.findById(draft.id, { id: owner.id, role: 'creator' })).rejects.toThrow(
      /not found/i,
    );

    const live = await makeVideo(db, owner.id);
    await expect(videos.deleteDraft(live.id, owner.id)).rejects.toThrow(/never published/);
    await videos.unpublish(live.id, owner.id);
    await expect(videos.findById(live.id, null)).rejects.toThrow(/not found/i);
  });

  it('filters by a list of access modes', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const both = await makeVideo(db, owner.id, {
      accessMode: 'premium_buyable',
      ppvPriceMinorUnits: '100',
    });
    const { items } = await videos.list({ creatorId: owner.id, mode: 'ppv,premium_buyable' });
    expect(items.map((v) => v.id)).toContain(both.id);
    const free = await videos.list({ creatorId: owner.id, mode: 'free' });
    expect(free.items.map((v) => v.id)).not.toContain(both.id);
  });
});
