import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  phoneE164: text('phone_e164').notNull(),
  codeHash: text('code_hash').notNull(),
  channel: text('channel').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
