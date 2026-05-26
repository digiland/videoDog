import { sql } from 'drizzle-orm';
import {
  char,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    base: char('base', { length: 3 }).notNull(),
    quote: char('quote', { length: 3 }).notNull(),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    source: text('source').notNull(),
    sourcePriority: smallint('source_priority').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [index('fx_rates_lookup_idx').on(t.base, t.quote, t.effectiveFrom)],
);
