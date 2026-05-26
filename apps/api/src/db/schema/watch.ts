import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { videos } from './videos';

export const watchSessions = pgTable(
  'watch_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }).notNull().defaultNow(),
    minutesWatched: integer('minutes_watched').notNull().default(0),
    ended: boolean('ended').notNull().default(false),
  },
  (t) => [index('watch_sessions_user_idx').on(t.userId, t.startedAt)],
);

export const watchMinutesDaily = pgTable(
  'watch_minutes_daily',
  {
    date: date('date').notNull(),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id),
    // bigint stored as text in drizzle; parsed in app
    minutes: text('minutes').notNull().default('0'),
  },
  (t) => [index('watch_minutes_daily_video_idx').on(t.videoId, t.date)],
);
