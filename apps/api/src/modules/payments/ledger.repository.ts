import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/db.module';

/** Raw-SQL ledger helpers (CLAUDE.md §9: raw SQL only in repositories). */
export const LedgerRepository = {
  /**
   * Serialise writers on one account until `tx` ends. Used where a balance check and the
   * debit that depends on it must not interleave (payouts).
   */
  async lockAccount(tx: Tx, accountId: string): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`);
  },
};
