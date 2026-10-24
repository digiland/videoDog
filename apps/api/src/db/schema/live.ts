import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { videos } from './videos';

// A live stream is backed by a videos row (access, price, title); see migration 0017.
export const liveState = pgEnum('live_state', ['scheduled', 'live', 'ended', 'cancelled']);
export const recordingState = pgEnum('recording_state', ['none', 'pending', 'ready', 'failed']);

export const liveStreams = pgTable(
  'live_streams',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    videoId: uuid('video_id').notNull().unique(),
    ownerId: uuid('owner_id').notNull(),
    state: liveState('state').notNull().default('scheduled'),
    streamKeyHash: text('stream_key_hash').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    record: boolean('record').notNull().default(true),
    recordingState: recordingState('recording_state').notNull().default('none'),
    ingestConnected: boolean('ingest_connected').notNull().default(false),
    lastIngestAt: timestamp('last_ingest_at', { withTimezone: true }),
    sourceWidth: integer('source_width'),
    sourceHeight: integer('source_height'),
    sourceFps: integer('source_fps'),
    sourceCodec: text('source_codec'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.videoId, t.ownerId],
      foreignColumns: [videos.id, videos.ownerId],
    }).onDelete('cascade'),
    index('live_streams_state_idx').on(t.state, t.scheduledAt),
    index('live_streams_owner_idx').on(t.ownerId, t.createdAt),
  ],
);
