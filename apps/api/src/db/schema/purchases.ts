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
import { videos } from './videos';

export const purchaseState = pgEnum('purchase_state', [
  'pending',
  'completed',
  'refunded',
  'failed',
]);
export const subscriptionState = pgEnum('subscription_state', [
  'pending',
  'active',
  'expired',
  'cancelled',
  'past_due',
]);

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id),
    state: purchaseState('state').notNull().default('pending'),
    // bigint stored as text; parsed in app
    paidAmountMinor: text('paid_amount_minor').notNull().default('0'),
    paidCurrency: char('paid_currency', { length: 3 }).notNull().default('USD'),
    usdEquivalentMinor: text('usd_equivalent_minor').notNull().default('0'),
    fxRateId: uuid('fx_rate_id'),
    paymentId: uuid('payment_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.videoId)],
);

export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  code: text('code').notNull().unique(),
  durationDays: integer('duration_days').notNull(),
  basePriceMinorUnits: text('base_price_minor_units').notNull(),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('USD'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    planId: uuid('plan_id').references(() => subscriptionPlans.id),
    state: subscriptionState('state').notNull().default('active'),
    chargedAmountMinor: text('charged_amount_minor').notNull(),
    chargedCurrency: char('charged_currency', { length: 3 }).notNull(),
    usdEquivalentMinor: text('usd_equivalent_minor').notNull(),
    fxRateId: uuid('fx_rate_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    autoRenew: boolean('auto_renew').notNull().default(true),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subs_active_idx').on(t.userId, t.expiresAt)],
);
