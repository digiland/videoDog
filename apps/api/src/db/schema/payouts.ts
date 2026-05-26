import { sql } from 'drizzle-orm';
import { char, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { fxRates } from './fx-rates';

export const payoutState = pgEnum('payout_state', [
  'requested',
  'processing',
  'completed',
  'failed',
]);

export const payouts = pgTable('payouts', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => users.id),
  requestedAmountMinor: text('requested_amount_minor').notNull(),
  payoutCurrency: char('payout_currency', { length: 3 }).notNull(),
  usdEquivalentMinor: text('usd_equivalent_minor').notNull(),
  fxRateId: uuid('fx_rate_id').references(() => fxRates.id),
  msisdn: text('msisdn').notNull(),
  state: payoutState('state').notNull().default('requested'),
  providerRef: text('provider_ref'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
