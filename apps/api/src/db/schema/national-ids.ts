import { sql } from 'drizzle-orm';
import { customType, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** Encrypted national IDs (§3.15). Plaintext never reaches the database. */
export const nationalIds = pgTable('national_ids', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  ciphertext: bytea('ciphertext').notNull(),
  iv: bytea('iv').notNull(),
  authTag: bytea('auth_tag').notNull(),
  keyVersion: smallint('key_version').notNull().default(1),
  lookupHash: text('lookup_hash').notNull().unique(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: uuid('verified_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
