import { sql } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { videos } from './videos';

export const captionKind = pgEnum('caption_kind', ['subtitles', 'captions']);

export const captions = pgTable(
  'captions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    label: text('label').notNull(),
    kind: captionKind('kind').notNull().default('subtitles'),
    key: text('key').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    ready: boolean('ready').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.videoId, t.language, t.kind)],
);
