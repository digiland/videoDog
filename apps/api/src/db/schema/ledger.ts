import { sql } from 'drizzle-orm';
import { char, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  scope: text('scope').notNull(),
  ownerId: uuid('owner_id'),
  code: text('code').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    transactionId: uuid('transaction_id').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    // bigint stored as text in drizzle; parsed in app
    debitMinor: text('debit_minor').notNull().default('0'),
    creditMinor: text('credit_minor').notNull().default('0'),
    currency: char('currency', { length: 3 }).notNull(),
    usdEquivalentMinor: text('usd_equivalent_minor').notNull(),
    fxRateId: uuid('fx_rate_id'),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_account_idx').on(t.accountId, t.occurredAt),
    index('ledger_transaction_idx').on(t.transactionId),
  ],
);
