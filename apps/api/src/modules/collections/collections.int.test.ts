import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, hasDb, makeUser, makeVideo, services } from '../../test/harness';
import { watchSessions } from '../../db/schema';
import { VideosService } from '../videos/videos.service';
import { AccessService } from '../videos/access.service';
import { PlaybackService } from '../videos/playback.service';
import { VideosRepository } from '../videos/videos.repository';
import { LivePlaybackService } from '../videos/live-playback.service';
import { CollectionsService } from './collections.service';
import { CollectionsRepository } from './collections.repository';
import { UsersService } from '../users/users.service';
import type { OtpService } from '../auth/otp.service';
import type { Db } from '../../db/db.module';
import type { StorageService } from '../../storage/storage.service';

const storage = {
  videoBucketName: 'videos',
  thumbBucketName: 'thumbs',
  getPresignedGetUrl: async (_b: string, key: string) => `https://s3.local/${key}?sig=x`,
} as unknown as StorageService;

describe.skipIf(!hasDb)('collections (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let videos: VideosService;
  let collections: CollectionsService;
  let users: UsersService;

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
    collections = new CollectionsService(db, videos, new CollectionsRepository(db));
    users = new UsersService(db, {} as OtpService);
  });
  afterAll(async () => close());

  it('builds a course with sections, hides drafts and unpublished videos from viewers', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const viewer = { id: (await makeUser(db)).id, role: 'viewer' };
    const me = { id: owner.id, role: 'creator' };
    const [intro, lesson, draft] = await Promise.all([
      makeVideo(db, owner.id, {
        accessMode: 'free',
        ppvPriceMinorUnits: null,
        ppvPriceCurrency: null,
        durationSeconds: 60,
      }),
      makeVideo(db, owner.id, { durationSeconds: 120 }),
      makeVideo(db, owner.id, { state: 'ready', publishedAt: null }),
    ]);

    const course = await collections.create(owner.id, {
      kind: 'course',
      title: 'O-Level Maths',
      category: 'education',
    });
    await expect(collections.publish(course.id, owner.id)).rejects.toThrow(/at least one/);
    await expect(collections.getById(course.id, viewer)).rejects.toThrow(/not found/);

    const algebra = await collections.addSection(course.id, owner.id, { title: 'Algebra' });
    await collections.addItem(course.id, owner.id, { video_id: intro.id });
    await collections.addItem(course.id, owner.id, { video_id: lesson.id, section_id: algebra.id });
    await collections.addItem(course.id, owner.id, { video_id: draft.id, section_id: algebra.id });
    await expect(collections.addItem(course.id, owner.id, { video_id: intro.id })).rejects.toThrow(
      /already/,
    );

    const published = await collections.publish(course.id, owner.id);
    expect(published).toMatchObject({
      state: 'published',
      video_count: 2,
      duration_seconds: 180,
      access_modes: { free: 1, ppv: 1 },
      cover_video_id: intro.id,
    });

    const seen = await collections.getById(course.id, viewer);
    expect(seen.unsectioned.map((e) => e.video.id)).toEqual([intro.id]);
    expect(seen.sections[0]!.items.map((e) => e.video.id)).toEqual([lesson.id]);

    const ownView = await collections.getById(course.id, me);
    expect(ownView.sections[0]!.items.map((e) => e.video.id)).toEqual([lesson.id, draft.id]);

    const listed = await collections.listPublic({ category: 'education', creator: owner.id });
    expect(listed.items.map((c) => c.id)).toEqual([course.id]);
    const containing = await collections.listPublic({ video: lesson.id });
    expect(containing.items.map((c) => c.id)).toEqual([course.id]);
  });

  it('refuses other creators’ videos and playlist sections', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const other = await makeUser(db, { role: 'creator' });
    const theirs = await makeVideo(db, other.id);
    const playlist = await collections.create(owner.id, { kind: 'playlist', title: 'Best of' });

    await expect(
      collections.addItem(playlist.id, owner.id, { video_id: theirs.id }),
    ).rejects.toThrow(/your own/);
    await expect(collections.addSection(playlist.id, owner.id, { title: 'x' })).rejects.toThrow(
      /Only courses/,
    );
    await expect(collections.update(playlist.id, other.id, { title: 'mine' })).rejects.toThrow(
      /not found/,
    );
  });

  it('reorders the whole layout and rejects a stale one', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const me = { id: owner.id, role: 'creator' };
    const [a, b, c] = await Promise.all([
      makeVideo(db, owner.id),
      makeVideo(db, owner.id),
      makeVideo(db, owner.id),
    ]);
    const course = await collections.create(owner.id, { kind: 'course', title: 'Science' });
    const s1 = await collections.addSection(course.id, owner.id, { title: 'Physics' });
    const s2 = await collections.addSection(course.id, owner.id, { title: 'Chemistry' });
    const ia = await collections.addItem(course.id, owner.id, {
      video_id: a.id,
      section_id: s1.id,
    });
    const ib = await collections.addItem(course.id, owner.id, {
      video_id: b.id,
      section_id: s1.id,
    });
    const ic = await collections.addItem(course.id, owner.id, { video_id: c.id });

    // Chemistry first; b moves into it; a stays in Physics; c stays unsectioned.
    const after = await collections.setLayout(course.id, owner.id, {
      unsectioned: [ic.id],
      sections: [
        { id: s2.id, item_ids: [ib.id] },
        { id: s1.id, item_ids: [ia.id] },
      ],
    });
    expect(after.sections.map((s) => s.title)).toEqual(['Chemistry', 'Physics']);
    expect(after.sections[0]!.items.map((e) => e.video.id)).toEqual([b.id]);

    await expect(
      collections.setLayout(course.id, owner.id, {
        unsectioned: [],
        sections: [
          { id: s2.id, item_ids: [ib.id] },
          { id: s1.id, item_ids: [ia.id] },
        ],
      }),
    ).rejects.toThrow(/changed/);
    await expect(collections.deleteSection(course.id, s1.id, owner.id)).rejects.toThrow(/first/);
    expect((await collections.getById(course.id, me)).sections).toHaveLength(2);
  });

  it('serves channels by handle, counts views and lists watch history', async () => {
    const creator = await makeUser(db, { role: 'creator' });
    const handle = `ch${creator.id.slice(0, 8)}`;
    await users.update(creator.id, { handle: `@${handle.toUpperCase()}` });
    const channel = await users.findChannel(`@${handle}`);
    expect(channel).toMatchObject({ id: creator.id, handle });
    const viewerUser = await makeUser(db);
    await expect(users.findChannel(viewerUser.id)).rejects.toThrow(/not found/);
    await expect(users.update(viewerUser.id, { handle })).rejects.toThrow(/taken/);

    const v = await makeVideo(db, creator.id, { category: 'comedy' });
    await db.insert(watchSessions).values([
      { videoId: v.id, userId: viewerUser.id, heartbeatCount: 3 },
      { videoId: v.id, userId: null, heartbeatCount: 2 },
      { videoId: v.id, userId: null, heartbeatCount: 1 }, // under 30s: not a view
      { videoId: v.id, userId: creator.id, heartbeatCount: 9 }, // the creator's own play
    ]);
    const found = await videos.findById(v.id, null);
    expect(found.view_count).toBe(2);
    expect(found.category).toBe('comedy');

    const comedy = await videos.list({ category: 'comedy', creatorId: creator.id });
    expect(comedy.items.map((x) => x.id)).toEqual([v.id]);
    await expect(videos.list({ category: 'nope' })).rejects.toThrow(/category/);
  });
});
