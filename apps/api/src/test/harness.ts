import { randomUUID, createHmac } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type Redis from 'ioredis';
import * as schema from '../db/schema';
import type { Db } from '../db/db.module';
import { LedgerService } from '../modules/payments/ledger.service';
import { FxService } from '../modules/fx/fx.service';

/**
 * Integration-test harness: a real Postgres (migrated with `pnpm --filter api migrate`)
 * and the services wired by hand. Tests are skipped when DATABASE_URL is not set.
 */
export const hasDb = !!process.env.DATABASE_URL;

export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
process.env.ECOCASH_WEBHOOK_SECRET = WEBHOOK_SECRET;

export function connect() {
  const client = postgres(process.env.DATABASE_URL!, { max: 10, onnotice: () => {} });
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

/** FxService reads through a Redis cache; tests use a no-op cache. */
export const noCache = {
  get: async () => null,
  setex: async () => 'OK',
} as unknown as Redis;

export function services(db: Db) {
  const ledger = new LedgerService(db);
  const fx = new FxService(db, noCache);
  return { ledger, fx };
}

let phoneSeq = 0;
export function uniquePhone(): string {
  phoneSeq += 1;
  const n = (Date.now() % 1_000_000) * 100 + phoneSeq;
  return `+26377${String(n).padStart(8, '0').slice(-8)}`;
}

export async function makeUser(db: Db, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({ phoneE164: uniquePhone(), kycState: 'phone_verified', ...overrides })
    .returning();
  return user!;
}

export async function makeVideo(
  db: Db,
  ownerId: string,
  overrides: Partial<typeof schema.videos.$inferInsert> = {},
) {
  const [video] = await db
    .insert(schema.videos)
    .values({
      ownerId,
      title: `Test video ${randomUUID().slice(0, 8)}`,
      accessMode: 'ppv',
      ppvPriceMinorUnits: '150',
      ppvPriceCurrency: 'USD',
      state: 'published',
      publishedAt: new Date(),
      ...overrides,
    })
    .returning();
  return video!;
}

export function sign(payload: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
}

export function webhookBody(reference: string, status = 'COMPLETED'): string {
  return JSON.stringify({ reference, provider_ref: `prov-${randomUUID()}`, status });
}
