import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { connect, hasDb, makeUser, makeVideo } from '../../test/harness';
import { collectionItems, collections, collectionSections, videos } from '.';
import type { Db } from '../db.module';

describe.skipIf(!hasDb)('collections schema (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(() => {
    ({ db, close } = connect());
  });
  afterAll(async () => close());

  async function makeCollection(ownerId: string, kind: 'course' | 'playlist') {
    const [c] = await db
      .insert(collections)
      .values({ ownerId, kind, title: `Test ${kind}` })
      .returning();
    return c!;
  }

  it('only groups videos owned by the collection owner', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const other = await makeUser(db, { role: 'creator' });
    const playlist = await makeCollection(owner.id, 'playlist');
    const theirs = await makeVideo(db, other.id);

    await expect(
      db.insert(collectionItems).values({
        collectionId: playlist.id,
        ownerId: owner.id,
        videoId: theirs.id,
        position: 0,
      }),
    ).rejects.toThrow(/violates/);
    // Claiming the video owner's id instead doesn't match the collection's owner.
    await expect(
      db.insert(collectionItems).values({
        collectionId: playlist.id,
        ownerId: other.id,
        videoId: theirs.id,
        position: 0,
      }),
    ).rejects.toThrow(/violates/);
  });

  it('allows sections on courses only, scoped to their own course', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const playlist = await makeCollection(owner.id, 'playlist');
    const courseA = await makeCollection(owner.id, 'course');
    const courseB = await makeCollection(owner.id, 'course');
    const video = await makeVideo(db, owner.id);

    await expect(
      db.insert(collectionSections).values({ collectionId: playlist.id, title: 'P1', position: 0 }),
    ).rejects.toThrow(/violates/);

    const [sectionB] = await db
      .insert(collectionSections)
      .values({ collectionId: courseB.id, title: 'Paper 1', position: 0 })
      .returning();
    await expect(
      db.insert(collectionItems).values({
        collectionId: courseA.id,
        ownerId: owner.id,
        videoId: video.id,
        sectionId: sectionB!.id,
        position: 0,
      }),
    ).rejects.toThrow(/violates/);

    // A course with sections can't be turned into a playlist.
    await expect(
      db.update(collections).set({ kind: 'playlist' }).where(eq(collections.id, courseB.id)),
    ).rejects.toThrow(/violates/);
  });

  it('keeps positions unique per section, including unsectioned items, and swaps when deferred', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const playlist = await makeCollection(owner.id, 'playlist');
    const [v1, v2] = await Promise.all([makeVideo(db, owner.id), makeVideo(db, owner.id)]);

    const [a, b] = await db
      .insert(collectionItems)
      .values([
        { collectionId: playlist.id, ownerId: owner.id, videoId: v1.id, position: 0 },
        { collectionId: playlist.id, ownerId: owner.id, videoId: v2.id, position: 1 },
      ])
      .returning();

    // NULL section_id still collides (NULLS NOT DISTINCT).
    await expect(
      db.update(collectionItems).set({ position: 0 }).where(eq(collectionItems.id, b!.id)),
    ).rejects.toThrow(/violates/);
    // A video appears once per collection.
    await expect(
      db
        .insert(collectionItems)
        .values({ collectionId: playlist.id, ownerId: owner.id, videoId: v1.id, position: 2 }),
    ).rejects.toThrow(/violates/);

    await db.transaction(async (tx) => {
      await tx.execute(sql`SET CONSTRAINTS collection_items_position_key DEFERRED`);
      await tx.update(collectionItems).set({ position: 1 }).where(eq(collectionItems.id, a!.id));
      await tx.update(collectionItems).set({ position: 0 }).where(eq(collectionItems.id, b!.id));
    });
    const rows = await db
      .select({ videoId: collectionItems.videoId })
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, playlist.id))
      .orderBy(collectionItems.position);
    expect(rows.map((r) => r.videoId)).toEqual([v2.id, v1.id]);
  });

  it('refuses to drop a non-empty section; deleting a video or collection cascades', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    const course = await makeCollection(owner.id, 'course');
    const [v1, v2] = await Promise.all([makeVideo(db, owner.id), makeVideo(db, owner.id)]);
    const [section] = await db
      .insert(collectionSections)
      .values({ collectionId: course.id, title: 'Algebra', position: 0 })
      .returning();
    await db.insert(collectionItems).values([
      {
        collectionId: course.id,
        ownerId: owner.id,
        videoId: v1.id,
        sectionId: section!.id,
        position: 0,
      },
      {
        collectionId: course.id,
        ownerId: owner.id,
        videoId: v2.id,
        sectionId: section!.id,
        position: 1,
      },
    ]);

    await expect(
      db.delete(collectionSections).where(eq(collectionSections.id, section!.id)),
    ).rejects.toThrow(/violates/);

    await db.delete(videos).where(eq(videos.id, v1.id));
    const left = await db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, course.id));
    expect(left.map((r) => r.videoId)).toEqual([v2.id]);

    await db.delete(collections).where(eq(collections.id, course.id));
    const sections = await db
      .select()
      .from(collectionSections)
      .where(eq(collectionSections.collectionId, course.id));
    expect(sections).toHaveLength(0);
  });

  it('requires published_at once published', async () => {
    const owner = await makeUser(db, { role: 'creator' });
    await expect(
      db
        .insert(collections)
        .values({ ownerId: owner.id, kind: 'playlist', title: 'x', state: 'published' }),
    ).rejects.toThrow(/violates/);
  });
});
