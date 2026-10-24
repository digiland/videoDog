import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, sql, sum } from 'drizzle-orm';
import { DB, type Db, type DbOrTx, type Tx } from '../../db/db.module';
import { collectionItems, collectionSections, collections, videos } from '../../db/schema';

type AccessMode = (typeof videos.$inferSelect)['accessMode'];

export interface CollectionStats {
  videoCount: number;
  durationSeconds: number;
  accessModes: Partial<Record<AccessMode, number>>;
  /** First published video in play order — the collection's cover until it has its own. */
  coverVideoId: string | null;
}

/** Collection queries that aggregate or order across tables (CLAUDE.md §9). */
@Injectable()
export class CollectionsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Per collection: published video count, total duration, count per access mode and the
   * cover video. Only published videos count, so a draft never shows up in a viewer's tally.
   */
  async stats(collectionIds: string[]): Promise<Map<string, CollectionStats>> {
    const out = new Map<string, CollectionStats>();
    if (collectionIds.length === 0) return out;
    for (const id of collectionIds) {
      out.set(id, { videoCount: 0, durationSeconds: 0, accessModes: {}, coverVideoId: null });
    }

    const published = and(
      inArray(collectionItems.collectionId, collectionIds),
      eq(videos.state, 'published'),
    );
    const byMode = await this.db
      .select({
        collectionId: collectionItems.collectionId,
        mode: videos.accessMode,
        n: count(),
        seconds: sum(videos.durationSeconds),
      })
      .from(collectionItems)
      .innerJoin(videos, eq(videos.id, collectionItems.videoId))
      .where(published)
      .groupBy(collectionItems.collectionId, videos.accessMode);
    for (const r of byMode) {
      const s = out.get(r.collectionId)!;
      s.videoCount += Number(r.n);
      s.durationSeconds += Number(r.seconds ?? 0);
      s.accessModes[r.mode] = Number(r.n);
    }

    // Play order: unsectioned items first, then sections by position, items by position.
    const covers = await this.db
      .selectDistinctOn([collectionItems.collectionId], {
        collectionId: collectionItems.collectionId,
        videoId: collectionItems.videoId,
      })
      .from(collectionItems)
      .innerJoin(videos, eq(videos.id, collectionItems.videoId))
      .leftJoin(collectionSections, eq(collectionSections.id, collectionItems.sectionId))
      .where(published)
      .orderBy(
        collectionItems.collectionId,
        sql`${collectionSections.position} ASC NULLS FIRST`,
        asc(collectionItems.position),
      );
    for (const c of covers) out.get(c.collectionId)!.coverVideoId = c.videoId;
    return out;
  }

  /** Items in play order (unsectioned first, then by section position, then position). */
  orderedItems(collectionId: string) {
    return this.db
      .select({
        id: collectionItems.id,
        videoId: collectionItems.videoId,
        sectionId: collectionItems.sectionId,
        position: collectionItems.position,
      })
      .from(collectionItems)
      .leftJoin(collectionSections, eq(collectionSections.id, collectionItems.sectionId))
      .where(eq(collectionItems.collectionId, collectionId))
      .orderBy(sql`${collectionSections.position} ASC NULLS FIRST`, asc(collectionItems.position));
  }

  /** Published collections containing a video (the watch page's "Part of" links). */
  publishedContaining(videoId: string) {
    return this.db
      .select({ collection: collections })
      .from(collectionItems)
      .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
      .where(and(eq(collectionItems.videoId, videoId), eq(collections.state, 'published')))
      .orderBy(asc(collections.createdAt))
      .limit(10)
      .then((rows) => rows.map((r) => r.collection));
  }

  /** Published collections matching `q` via their generated `search_doc`, best first. */
  searchPublished(q: string, limit: number) {
    const query = sql`websearch_to_tsquery('english', ${q})`;
    return this.db
      .select()
      .from(collections)
      .where(and(eq(collections.state, 'published'), sql`${collections}.search_doc @@ ${query}`))
      .orderBy(sql`ts_rank(${collections}.search_doc, ${query}) DESC`, collections.id)
      .limit(limit);
  }

  /** Next free position at the end of a section (or of the unsectioned list). */
  async nextItemPosition(tx: DbOrTx, collectionId: string, sectionId: string | null) {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${collectionItems.position})` })
      .from(collectionItems)
      .where(
        and(
          eq(collectionItems.collectionId, collectionId),
          sectionId
            ? eq(collectionItems.sectionId, sectionId)
            : sql`${collectionItems.sectionId} IS NULL`,
        ),
      );
    return row?.max == null ? 0 : Number(row.max) + 1;
  }

  async nextSectionPosition(tx: DbOrTx, collectionId: string) {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${collectionSections.position})` })
      .from(collectionSections)
      .where(eq(collectionSections.collectionId, collectionId));
    return row?.max == null ? 0 : Number(row.max) + 1;
  }

  /** Lock the collection row so concurrent appends/reorders serialise. */
  async lock(tx: Tx, collectionId: string) {
    await tx.execute(sql`SELECT 1 FROM collections WHERE id = ${collectionId} FOR UPDATE`);
  }

  /** Let a reorder pass through intermediate duplicate positions within one transaction. */
  async deferPositions(tx: Tx) {
    await tx.execute(
      sql`SET CONSTRAINTS collection_items_position_key, collection_sections_position_key DEFERRED`,
    );
  }
}
