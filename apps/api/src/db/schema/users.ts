import { sql } from 'drizzle-orm';
import { char, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['viewer', 'creator', 'admin']);
export const kycState = pgEnum('kyc_state', ['none', 'phone_verified', 'id_verified']);
export const creatorAppState = pgEnum('creator_app_state', [
  'none',
  'pending',
  'approved',
  'rejected',
]);

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  phoneE164: text('phone_e164').notNull().unique(),
  handle: text('handle').unique(),
  displayName: text('display_name'),
  role: userRole('role').notNull().default('viewer'),
  kycState: kycState('kyc_state').notNull().default('none'),
  preferredDisplayCurrency: char('preferred_display_currency', { length: 3 })
    .notNull()
    .default('USD'),
  preferredPayoutCurrency: char('preferred_payout_currency', { length: 3 }),
  canonicalPricingCurrency: char('canonical_pricing_currency', { length: 3 }),
  payoutMsisdn: text('payout_msisdn'),
  creatorApplicationState: creatorAppState('creator_application_state').notNull().default('none'),
  creatorApplicationPitch: text('creator_application_pitch'),
  creatorApplicationAt: timestamp('creator_application_at', { withTimezone: true }),
  creatorApplicationDecidedAt: timestamp('creator_application_decided_at', {
    withTimezone: true,
  }),
  creatorApplicationDecidedBy: uuid('creator_application_decided_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
