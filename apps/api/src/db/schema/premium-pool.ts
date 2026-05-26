import { integer, pgTable, timestamp } from 'drizzle-orm/pg-core';

export const premiumPayoutRuns = pgTable('premium_payout_runs', {
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
