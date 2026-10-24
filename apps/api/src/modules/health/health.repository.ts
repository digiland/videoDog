import { sql } from 'drizzle-orm';
import type { Db } from '../../db/db.module';

/** Raw-SQL health probe (CLAUDE.md §9: raw SQL only in repositories). */
export async function pingDb(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
