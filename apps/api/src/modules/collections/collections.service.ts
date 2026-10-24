import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { CONTENT_CATEGORIES } from '@streamzw/shared';
import { DB, type Db } from '../../db/db.module';
import { collectionItems, collectionSections, collections, users, videos } from '../../db/schema';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { VideosService, type Viewer } from '../videos/videos.service';
import { CollectionsRepository } from './collections.repository';

const Title = z.string().trim().min(1, 'Title is required').max(120);

const CreateCollectionSchema = z.object({
  kind: z.enum(['course', 'playlist']),
  title: Title,
  description: z.string().max(5000).optional(),
  category: z.enum(CONTENT_CATEGORIES).optional(),
});

const UpdateCollectionSchema = z.object({
  title: Title.optional(),
  description: z.string().max(5000).nullable().optional(),
  category: z.enum(CONTENT_CATEGORIES).optional(),
});

const SectionSchema = z.object({ title: Title });

const AddItemSchema = z.object({
  video_id: z.string().uuid(),
  section_id: z.string().uuid().nullable().optional(),
});

/** The full order in one request: drag-and-drop UIs send the whole layout back. */
const LayoutSchema = z.object({
  unsectioned: z.array(z.string().uuid()).max(500),
  sections: z
    .array(z.object({ id: z.string().uuid(), item_ids: z.array(z.string().uuid()).max(500) }))
    .max(100),
});

const ListSchema = z.object({
  creator: z.string().uuid().optional(),
  category: z.enum(CONTENT_CATEGORIES).optional(),
  kind: z.enum(['course', 'playlist']).optional(),
  video: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type CollectionRow = typeof collections.$inferSelect;

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
  return parsed.data;
}

/**
 * Courses and playlists: ordered groups of a creator's own videos. Grouping only — a
 * collection has no price, and every video inside keeps its own access mode, checked by
 * VideosService/AccessService as usual (CLAUDE.md §3.9). Viewers only ever see published
 * collections and the published videos inside them.
 */
@Injectable()
export class CollectionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly videos: VideosService,
    private readonly repo: CollectionsRepository,
  ) {}

  // ─── Creator side ────────────────────────────────────────────────────────

  async create(ownerId: string, body: unknown) {
    const dto = parse(CreateCollectionSchema, body);
    const [row] = await this.db
      .insert(collections)
      .values({
        ownerId,
        kind: dto.kind,
        title: dto.title,
        description: dto.description ?? null,
        category: dto.category ?? 'other',
      })
      .returning();
    return (await this.summaries([row!]))[0]!;
  }

  async update(id: string, ownerId: string, body: unknown) {
    const dto = parse(UpdateCollectionSchema, body);
    await this.getOwned(id, ownerId);
    const [row] = await this.db
      .update(collections)
      .set({
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        updatedAt: new Date(),
      })
      .where(eq(collections.id, id))
      .returning();
    return (await this.summaries([row!]))[0]!;
  }

  /** Deleting a collection never touches its videos — they only leave the grouping. */
  async remove(id: string, ownerId: string) {
    await this.getOwned(id, ownerId);
    await this.db.delete(collections).where(eq(collections.id, id));
    return { ok: true };
  }

  async publish(id: string, ownerId: string) {
    const c = await this.getOwned(id, ownerId);
    const stats = (await this.repo.stats([id])).get(id)!;
    if (stats.videoCount === 0) {
      throw new ValidationError('Add at least one published video before publishing');
    }
    const [row] = await this.db
      .update(collections)
      .set({ state: 'published', publishedAt: c.publishedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(collections.id, id))
      .returning();
    return (await this.summaries([row!]))[0]!;
  }

  async unpublish(id: string, ownerId: string) {
    await this.getOwned(id, ownerId);
    const [row] = await this.db
      .update(collections)
      .set({ state: 'unpublished', updatedAt: new Date() })
      .where(eq(collections.id, id))
      .returning();
    return (await this.summaries([row!]))[0]!;
  }

  async addSection(id: string, ownerId: string, body: unknown) {
    const dto = parse(SectionSchema, body);
    const c = await this.getOwned(id, ownerId);
    if (c.kind !== 'course') throw new ValidationError('Only courses have sections');
    const [section] = await this.db.transaction(async (tx) => {
      await this.repo.lock(tx, id);
      const position = await this.repo.nextSectionPosition(tx, id);
      return tx
        .insert(collectionSections)
        .values({ collectionId: id, title: dto.title, position })
        .returning();
    });
    return { id: section!.id, title: section!.title, position: section!.position };
  }

  async renameSection(id: string, sectionId: string, ownerId: string, body: unknown) {
    const dto = parse(SectionSchema, body);
    await this.getOwned(id, ownerId);
    const [section] = await this.db
      .update(collectionSections)
      .set({ title: dto.title, updatedAt: new Date() })
      .where(and(eq(collectionSections.id, sectionId), eq(collectionSections.collectionId, id)))
      .returning();
    if (!section) throw new ResourceNotFoundError('Section');
    return { id: section.id, title: section.title, position: section.position };
  }

  async deleteSection(id: string, sectionId: string, ownerId: string) {
    await this.getOwned(id, ownerId);
    const [used] = await this.db
      .select({ id: collectionItems.id })
      .from(collectionItems)
      .where(eq(collectionItems.sectionId, sectionId))
      .limit(1);
    if (used) throw new ValidationError('Move or remove the videos in this section first');
    const deleted = await this.db
      .delete(collectionSections)
      .where(and(eq(collectionSections.id, sectionId), eq(collectionSections.collectionId, id)))
      .returning({ id: collectionSections.id });
    if (deleted.length === 0) throw new ResourceNotFoundError('Section');
    return { ok: true };
  }

  /** Append one of the owner's videos to the end of a section (or the unsectioned list). */
  async addItem(id: string, ownerId: string, body: unknown) {
    const dto = parse(AddItemSchema, body);
    const c = await this.getOwned(id, ownerId);
    const sectionId = dto.section_id ?? null;
    if (sectionId && c.kind !== 'course') throw new ValidationError('Only courses have sections');

    const [video] = await this.db
      .select({ ownerId: videos.ownerId })
      .from(videos)
      .where(eq(videos.id, dto.video_id))
      .limit(1);
    if (!video || video.ownerId !== c.ownerId) {
      throw new ValidationError('You can only add your own videos');
    }

    const [item] = await this.db.transaction(async (tx) => {
      await this.repo.lock(tx, id);
      if (sectionId) {
        const [s] = await tx
          .select({ id: collectionSections.id })
          .from(collectionSections)
          .where(and(eq(collectionSections.id, sectionId), eq(collectionSections.collectionId, id)))
          .limit(1);
        if (!s) throw new ResourceNotFoundError('Section');
      }
      const [dupe] = await tx
        .select({ id: collectionItems.id })
        .from(collectionItems)
        .where(and(eq(collectionItems.collectionId, id), eq(collectionItems.videoId, dto.video_id)))
        .limit(1);
      if (dupe) throw new ValidationError('That video is already in this collection');
      const position = await this.repo.nextItemPosition(tx, id, sectionId);
      return tx
        .insert(collectionItems)
        .values({
          collectionId: id,
          ownerId: c.ownerId,
          videoId: dto.video_id,
          sectionId,
          position,
        })
        .returning();
    });
    return {
      id: item!.id,
      video_id: item!.videoId,
      section_id: item!.sectionId,
      position: item!.position,
    };
  }

  async removeItem(id: string, itemId: string, ownerId: string) {
    await this.getOwned(id, ownerId);
    const deleted = await this.db
      .delete(collectionItems)
      .where(and(eq(collectionItems.id, itemId), eq(collectionItems.collectionId, id)))
      .returning({ id: collectionItems.id });
    if (deleted.length === 0) throw new ResourceNotFoundError('Item');
    return { ok: true };
  }

  /**
   * Replace the whole order: section order, and which section each item sits in and where.
   * The layout must list every existing section and item exactly once, so a stale editor
   * can't silently drop anything; positions are rewritten as 0..n-1.
   */
  async setLayout(id: string, ownerId: string, body: unknown) {
    const dto = parse(LayoutSchema, body);
    const c = await this.getOwned(id, ownerId);
    if (c.kind !== 'course' && dto.sections.length > 0) {
      throw new ValidationError('Only courses have sections');
    }

    await this.db.transaction(async (tx) => {
      await this.repo.lock(tx, id);
      const [sections, items] = await Promise.all([
        tx
          .select({ id: collectionSections.id })
          .from(collectionSections)
          .where(eq(collectionSections.collectionId, id)),
        tx
          .select({ id: collectionItems.id })
          .from(collectionItems)
          .where(eq(collectionItems.collectionId, id)),
      ]);
      const sentItems = [...dto.unsectioned, ...dto.sections.flatMap((s) => s.item_ids)];
      const sameSet = (have: string[], sent: string[]) =>
        have.length === sent.length &&
        new Set(sent).size === sent.length &&
        sent.every((x) => have.includes(x));
      if (
        !sameSet(
          sections.map((s) => s.id),
          dto.sections.map((s) => s.id),
        ) ||
        !sameSet(
          items.map((i) => i.id),
          sentItems,
        )
      ) {
        throw new ValidationError('This collection changed in another tab. Reload and try again.');
      }

      await this.repo.deferPositions(tx);
      const now = new Date();
      for (const [position, s] of dto.sections.entries()) {
        await tx
          .update(collectionSections)
          .set({ position, updatedAt: now })
          .where(eq(collectionSections.id, s.id));
      }
      const placements: { itemId: string; sectionId: string | null; position: number }[] = [
        ...dto.unsectioned.map((itemId, position) => ({ itemId, sectionId: null, position })),
        ...dto.sections.flatMap((s) =>
          s.item_ids.map((itemId, position) => ({ itemId, sectionId: s.id, position })),
        ),
      ];
      for (const p of placements) {
        await tx
          .update(collectionItems)
          .set({ sectionId: p.sectionId, position: p.position, updatedAt: now })
          .where(eq(collectionItems.id, p.itemId));
      }
    });
    return this.getById(id, { id: ownerId, role: 'creator' });
  }

  /** The creator's own collections, drafts included, newest first. */
  async listMine(ownerId: string) {
    const rows = await this.db
      .select()
      .from(collections)
      .where(eq(collections.ownerId, ownerId))
      .orderBy(desc(collections.createdAt))
      .limit(200);
    return { items: await this.summaries(rows), next_cursor: null };
  }

  // ─── Viewer side ─────────────────────────────────────────────────────────

  /** Published collections, newest first; filter by creator, category, kind or video. */
  async listPublic(query: unknown) {
    const q = parse(ListSchema, query);
    if (q.video) {
      const rows = await this.repo.publishedContaining(q.video);
      return { items: await this.summaries(rows), next_cursor: null };
    }

    const conditions = [eq(collections.state, 'published')];
    if (q.creator) conditions.push(eq(collections.ownerId, q.creator));
    if (q.category) conditions.push(eq(collections.category, q.category));
    if (q.kind) conditions.push(eq(collections.kind, q.kind));
    if (q.cursor) {
      const [anchor] = await this.db
        .select({ id: collections.id, at: collections.publishedAt })
        .from(collections)
        .where(eq(collections.id, q.cursor))
        .limit(1);
      if (!anchor?.at) throw new ValidationError('Invalid cursor');
      conditions.push(
        or(
          lt(collections.publishedAt, anchor.at),
          and(eq(collections.publishedAt, anchor.at), lt(collections.id, anchor.id)),
        )!,
      );
    }
    const rows = await this.db
      .select()
      .from(collections)
      .where(and(...conditions))
      .orderBy(desc(collections.publishedAt), desc(collections.id))
      .limit(q.limit + 1);
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      items: await this.summaries(page),
      next_cursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * One collection with its sections and videos in play order. Non-owners see it only once
   * published, and only its published videos; each video carries its own access mode, so
   * the page can show what each lesson costs before the tap.
   */
  async getById(id: string, viewer: Viewer) {
    const [c] = await this.db.select().from(collections).where(eq(collections.id, id)).limit(1);
    if (!c) throw new ResourceNotFoundError('Collection');
    const privileged = !!viewer && (viewer.id === c.ownerId || viewer.role === 'admin');
    if (c.state !== 'published' && !privileged) throw new ResourceNotFoundError('Collection');

    const [summary] = await this.summaries([c]);
    const [sections, items] = await Promise.all([
      this.db
        .select({
          id: collectionSections.id,
          title: collectionSections.title,
          position: collectionSections.position,
        })
        .from(collectionSections)
        .where(eq(collectionSections.collectionId, id))
        .orderBy(collectionSections.position),
      this.repo.orderedItems(id),
    ]);
    const vids = await this.videos.listByIds(
      items.map((i) => i.videoId),
      { includeUnpublished: privileged },
    );
    const byVideo = new Map(vids.map((v) => [v.id, v]));
    const entries = items.flatMap((i) => {
      const video = byVideo.get(i.videoId);
      return video ? [{ id: i.id, section_id: i.sectionId, position: i.position, video }] : [];
    });

    return {
      ...summary!,
      sections: sections.map((s) => ({
        ...s,
        items: entries.filter((e) => e.section_id === s.id),
      })),
      unsectioned: entries.filter((e) => e.section_id === null),
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async getOwned(id: string, ownerId: string) {
    const [c] = await this.db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.ownerId, ownerId)))
      .limit(1);
    if (!c) throw new ResourceNotFoundError('Collection');
    return c;
  }

  private async summaries(rows: CollectionRow[]) {
    if (rows.length === 0) return [];
    const ownerIds = Array.from(new Set(rows.map((r) => r.ownerId)));
    const [stats, creators] = await Promise.all([
      this.repo.stats(rows.map((r) => r.id)),
      this.db
        .select({ id: users.id, handle: users.handle, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ownerIds)),
    ]);
    const coverIds = Array.from(stats.values()).flatMap((s) => s.coverVideoId ?? []);
    const covers = new Map(
      (await this.videos.listByIds(coverIds)).map((v) => [v.id, v.thumbnail_url]),
    );
    const byCreator = new Map(creators.map((c) => [c.id, c]));

    return rows.map((r) => {
      const s = stats.get(r.id)!;
      const creator = byCreator.get(r.ownerId);
      return {
        id: r.id,
        owner_id: r.ownerId,
        kind: r.kind,
        category: r.category,
        title: r.title,
        description: r.description,
        state: r.state,
        published_at: r.publishedAt,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
        video_count: s.videoCount,
        duration_seconds: s.durationSeconds,
        access_modes: s.accessModes,
        thumbnail_url: s.coverVideoId ? (covers.get(s.coverVideoId) ?? null) : null,
        cover_video_id: s.coverVideoId,
        creator: creator
          ? { id: creator.id, handle: creator.handle, display_name: creator.displayName }
          : null,
      };
    });
  }
}
