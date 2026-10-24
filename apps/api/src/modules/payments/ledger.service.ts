import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sum } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DB, type Db, type DbOrTx } from '../../db/db.module';
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
   * Insert all entries of one ledger transaction in a single INSERT (atomic on its own).
   * Pass `exec` to make the entries part of a wider DB transaction — callers settling a
   * payment must do so, so the ledger and the payment state commit or roll back together.
   * Asserts sum(debit) == sum(credit) per currency before inserting.
   * Invariant §8: balanced per currency.
   */
  async recordTransaction(entries: LedgerEntryInput[], exec: DbOrTx = this.db): Promise<string> {
    this.assertBalance(entries);
    const txId = randomUUID();

    await exec.insert(ledgerEntries).values(
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
  async findOrCreateAccount(
    params: {
      scope: string;
      ownerId?: string | null;
      code: string;
      currency: string;
    },
    exec: DbOrTx = this.db,
  ): Promise<string> {
    const conditions = [
      eq(accounts.scope, params.scope),
      eq(accounts.code, params.code),
      eq(accounts.currency, params.currency),
      params.ownerId ? eq(accounts.ownerId, params.ownerId) : isNull(accounts.ownerId),
    ];

    const [existing] = await exec
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(...conditions))
      .limit(1);

    if (existing) return existing.id;

    const [created] = await exec
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
    const [retry] = await exec
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(...conditions))
      .limit(1);
    return retry!.id;
  }

  async balance(accountId: string, exec: DbOrTx = this.db): Promise<bigint> {
    const [row] = await exec
      .select({ credit: sum(ledgerEntries.creditMinor), debit: sum(ledgerEntries.debitMinor) })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId));
    return BigInt(row?.credit ?? 0) - BigInt(row?.debit ?? 0);
  }

  /** Net debits minus credits for a currency across the whole ledger; 0 when balanced (§8). */
  async trialBalance(currency: string): Promise<bigint> {
    const [row] = await this.db
      .select({ credit: sum(ledgerEntries.creditMinor), debit: sum(ledgerEntries.debitMinor) })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.currency, currency));
    return BigInt(row?.debit ?? 0) - BigInt(row?.credit ?? 0);
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
