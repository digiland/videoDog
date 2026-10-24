/**
 * Promote an existing account to admin (admins approve creators and verify IDs).
 * The person signs in once with their phone first, so the account exists.
 *
 * Usage: pnpm --filter api make-admin +263771234567
 *   in production: docker compose ... exec api node apps/api/dist/scripts/make-admin.js +263…
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';

config({ path: resolve(__dirname, '..', '..', '..', '..', '.env') });

async function main() {
  const phone = process.argv[2];
  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new Error('Pass the phone number in E.164, e.g. +263771234567');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    const [user] = await db
      .update(schema.users)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(eq(schema.users.phoneE164, phone))
      .returning({ id: schema.users.id });
    if (!user) throw new Error(`No account for ${phone}: sign in once on the site first`);
    console.log(`${phone} is now an admin (${user.id})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
