import { sql } from 'drizzle-orm';
import { char, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const paymentProvider = pgEnum('payment_provider', [
  'ecocash_usd',
  'ecocash_zwg',
  'zipit',
  'paystack',
]);
export const paymentState = pgEnum('payment_state', [
  'initiated',
  'pending',
  'completed',
  'failed',
  'reversed',
]);
export const paymentIntentType = pgEnum('payment_intent_type', [
  'purchase',
  'subscription',
  'tip',
  'topup',
]);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: paymentProvider('provider').notNull(),
    providerRef: text('provider_ref'),
    amountMinor: text('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    usdEquivalentMinor: text('usd_equivalent_minor').notNull(),
    fxRateId: uuid('fx_rate_id'),
    intent: paymentIntentType('intent').notNull(),
    intentRefId: uuid('intent_ref_id'),
    state: paymentState('state').notNull().default('initiated'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    rawCallback: jsonb('raw_callback'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payments_provider_ref_idx').on(t.provider, t.providerRef)],
);
