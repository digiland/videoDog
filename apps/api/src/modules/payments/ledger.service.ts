import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DB, type Db } from '../../db/db.module';
import { accounts, ledgerEntries } from '../../db/schema';
import { LedgerImbalanceError } from '../auth/errors';

export interface LedgerEntryInput {
  accountId: string;
  debitMinor: bigint;
  creditMinor: bigint;
  currency: string;
  usdEquivalentMinor: bigint;
  fxRateId?: string;
  refType: string;
  refId?: string;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Insert all entries in one DB transaction.
   * Asserts sum(debit) == sum(credit) per currency before inserting.
   * Invariant §8: balanced per currency.
   */
  async recordTransaction(entries: LedgerEntryInput[]): Promise<string> {
    this.assertBalance(entries);
    const txId = randomUUID();

    await this.db.insert(ledgerEntries).values(
      entries.map((e) => ({
        transactionId: txId,
        accountId: e.accountId,
        debitMinor: String(e.debitMinor),
        creditMinor: String(e.creditMinor),
        currency: e.currency,
        usdEquivalentMinor: String(e.usdEquivalentMinor),
        fxRateId: e.fxRateId ?? null,
        refType: e.refType,
        refId: e.refId ?? null,
      })),
    );

    return txId;
  }

  /**
   * Find or create a named account. System accounts use scope='system', owner_id=NULL.
   * Creator accounts use scope='user', owner_id=creatorId.
   */
  async findOrCreateAccount(params: {
    scope: string;
    ownerId?: string | null;
    code: string;
    currency: string;
  }): Promise<string> {
    const conditions = [
      eq(accounts.scope, params.scope),
      eq(accounts.code, params.code),
      eq(accounts.currency, params.currency),
      params.ownerId ? eq(accounts.ownerId, params.ownerId) : isNull(accounts.ownerId),
    ];

    const [existing] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(...conditions))
      .limit(1);

    if (existing) return existing.id;

    const [created] = await this.db
      .insert(accounts)
      .values({
        scope: params.scope,
        ownerId: params.ownerId ?? null,
        code: params.code,
        currency: params.currency,
      })
      .onConflictDoNothing()
      .returning({ id: accounts.id });

    if (created) return created.id;

    // Race condition: retry select
    const [retry] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(...conditions))
      .limit(1);
    return retry!.id;
  }

  async balance(accountId: string): Promise<bigint> {
    const [row] = await this.db
      .select({
        bal: sql<string>`COALESCE(SUM(credit_minor::bigint), 0) - COALESCE(SUM(debit_minor::bigint), 0)`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId));
    return BigInt(row?.bal ?? '0');
  }

  async trialBalance(currency: string): Promise<bigint> {
    const [row] = await this.db
      .select({
        bal: sql<string>`COALESCE(SUM(debit_minor::bigint), 0) - COALESCE(SUM(credit_minor::bigint), 0)`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.currency, currency));
    return BigInt(row?.bal ?? '0');
  }

  private assertBalance(entries: LedgerEntryInput[]): void {
    const byCurrency = new Map<string, { debit: bigint; credit: bigint }>();
    for (const e of entries) {
      const curr = byCurrency.get(e.currency) ?? { debit: 0n, credit: 0n };
      byCurrency.set(e.currency, {
        debit: curr.debit + e.debitMinor,
        credit: curr.credit + e.creditMinor,
      });
    }
    for (const [ccy, { debit, credit }] of byCurrency) {
      if (debit !== credit) throw new LedgerImbalanceError(ccy);
    }
  }
}
