import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
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

export const accessMode = pgEnum('access_mode', ['free', 'ppv', 'premium', 'premium_buyable']);
export const videoState = pgEnum('video_state', [
  'uploading',
  'processing',
  'ready',
  'published',
  'unpublished',
  'failed',
]);

export const videos = pgTable(
  'videos',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    accessMode: accessMode('access_mode').notNull(),
    ppvPriceMinorUnits: text('ppv_price_minor_units'), // stored as text, cast to bigint in app
    ppvPriceCurrency: char('ppv_price_currency', { length: 3 }),
    // in_premium_pool is GENERATED ALWAYS in DB — read-only; not mapped for writes
    inPremiumPool: boolean('in_premium_pool'),
    state: videoState('state').notNull().default('uploading'),
    durationSeconds: integer('duration_seconds'),
    hlsPlaylistKey: text('hls_playlist_key'),
    thumbnailKey: text('thumbnail_key'),
    // search_doc is GENERATED ALWAYS — not mapped for writes
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('videos_published_idx').on(t.publishedAt),
    index('videos_premium_pool_idx').on(t.inPremiumPool),
  ],
);

export const renditions = pgTable(
  'renditions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    height: integer('height').notNull(),
    bitrateKbps: integer('bitrate_kbps').notNull(),
    key: text('key').notNull(),
    ready: boolean('ready').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.videoId, t.height)],
);
