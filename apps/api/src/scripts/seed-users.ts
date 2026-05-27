/**
 * Seed demo users for local development.
 *
 * Creates one user per role (viewer, creator, admin) with deterministic phone
 * numbers. Sign-in is phone + OTP; in dev (NODE_ENV !== 'production') the OTP
 * code is logged to the API console by WhatsAppClient / SmsClient. Request an
 * OTP for one of the seeded phones, then read the code from the API logs.
 *
 * Usage:  pnpm --filter api seed
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';

const DEMO_USERS = [
  {
    phoneE164: '+263771000001',
    handle: 'demo_viewer',
    displayName: 'Demo Viewer',
    role: 'viewer' as const,
    kycState: 'phone_verified' as const,
    preferredDisplayCurrency: 'USD',
  },
  {
    phoneE164: '+263771000002',
    handle: 'demo_creator',
    displayName: 'Demo Creator',
    role: 'creator' as const,
    kycState: 'phone_verified' as const,
    preferredDisplayCurrency: 'USD',
    canonicalPricingCurrency: 'USD',
    preferredPayoutCurrency: 'USD',
    payoutMsisdn: '+263771000002',
  },
  {
    phoneE164: '+263771000099',
    handle: 'demo_admin',
    displayName: 'Demo Admin',
    role: 'admin' as const,
    kycState: 'phone_verified' as const,
    preferredDisplayCurrency: 'USD',
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  for (const u of DEMO_USERS) {
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.phoneE164, u.phoneE164))
      .limit(1);
    if (existing.length) {
      await db.update(schema.users).set(u).where(eq(schema.users.phoneE164, u.phoneE164));
      console.log(`updated ${u.role.padEnd(7)}  ${u.phoneE164}`);
    } else {
      await db.insert(schema.users).values(u);
      console.log(`inserted ${u.role.padEnd(7)} ${u.phoneE164}`);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
