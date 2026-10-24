import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { contentCategory, videos } from './videos';

// Courses and playlists group a creator's own videos. Grouping only — access stays
// per video through VideosService.checkAccess. Ordering rules live in migration 0015.
export const collectionKind = pgEnum('collection_kind', ['course', 'playlist']);
export const collectionState = pgEnum('collection_state', ['draft', 'published', 'unpublished']);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    kind: collectionKind('kind').notNull(),
    category: contentCategory('category').notNull().default('other'),
    title: text('title').notNull(),
    description: text('description'),
    thumbnailKey: text('thumbnail_key'),
    state: collectionState('state').notNull().default('draft'),
    // search_doc is GENERATED ALWAYS — not mapped for writes
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('collections_id_owner_key').on(t.id, t.ownerId),
    unique('collections_id_kind_key').on(t.id, t.kind),
    index('collections_owner_idx').on(t.ownerId, t.createdAt),
    index('collections_published_idx').on(t.publishedAt),
  ],
);

// Course sections only — collection_kind is pinned to 'course' in the DB.
export const collectionSections = pgTable(
  'collection_sections',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    collectionId: uuid('collection_id').notNull(),
    collectionKind: collectionKind('collection_kind').notNull().default('course'),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.collectionId, t.collectionKind],
      foreignColumns: [collections.id, collections.kind],
    }).onDelete('cascade'),
    unique('collection_sections_id_collection_key').on(t.id, t.collectionId),
    unique('collection_sections_position_key').on(t.collectionId, t.position),
  ],
);

export const collectionItems = pgTable(
  'collection_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    collectionId: uuid('collection_id').notNull(),
    // Shared by both FKs below, so the video must belong to the collection's owner.
    ownerId: uuid('owner_id').notNull(),
    videoId: uuid('video_id').notNull(),
    sectionId: uuid('section_id'), // NULL for playlists / unsectioned course items
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.collectionId, t.ownerId],
      foreignColumns: [collections.id, collections.ownerId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.videoId, t.ownerId],
      foreignColumns: [videos.id, videos.ownerId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.sectionId, t.collectionId],
      foreignColumns: [collectionSections.id, collectionSections.collectionId],
    }),
    unique('collection_items_video_key').on(t.collectionId, t.videoId),
    unique('collection_items_position_key')
      .on(t.collectionId, t.sectionId, t.position)
      .nullsNotDistinct(),
    index('collection_items_video_idx').on(t.videoId),
  ],
);
