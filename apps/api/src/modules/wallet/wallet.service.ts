import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte, desc, inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { accounts, ledgerEntries, payouts, users } from '../../db/schema';
import { LedgerService } from '../payments/ledger.service';
import { FxService } from '../fx/fx.service';
import { Money } from '@streamzw/shared';
import type { CurrencyCode } from '@streamzw/shared';
import { InsufficientBalanceError, ValidationError } from '../auth/errors';
import { z } from 'zod';

const PAYOUT_THRESHOLDS: Record<string, bigint> = {
  USD: 500n,
  ZWG: 15000n,
  ZAR: 10000n,
};

const PayoutRequestSchema = z.object({
  amount_minor: z.number().int().positive(),
  currency: z.enum(['USD', 'ZWG', 'ZAR']),
  // `msisdn` is no longer accepted: payouts always go to the profile's payout_msisdn.
});

@Injectable()
export class WalletService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
  ) {}

  async balance(userId: string) {
    // Find all creator_balance accounts for this user
    const userAccounts = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.scope, 'user'),
          eq(accounts.ownerId, userId),
          eq(accounts.code, 'creator_balance'),
        ),
      );

    const balances = await Promise.all(
      userAccounts.map(async (acc) => {
        const bal = await this.ledger.balance(acc.id);
        return {
          currency: acc.currency,
          balance_minor: bal.toString(),
          balance: new Money(bal, acc.currency as CurrencyCode).toJSON(),
        };
      }),
    );

    return { balances };
  }

  async ledgerHistory(userId: string, from?: Date, to?: Date, limit = 50) {
    // Get user's account IDs
    const userAccounts = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.scope, 'user'), eq(accounts.ownerId, userId)));

    if (userAccounts.length === 0) return { entries: [] };

    const ids = userAccounts.map((acc) => acc.id);
    const conditions = [inArray(ledgerEntries.accountId, ids)];
    if (from) conditions.push(gte(ledgerEntries.occurredAt, from));
    if (to) conditions.push(lte(ledgerEntries.occurredAt, to));

    const entries = await this.db
      .select()
      .from(ledgerEntries)
      .where(and(...conditions))
      .orderBy(desc(ledgerEntries.occurredAt))
      .limit(limit);

    return { entries };
  }

  /**
   * Request a payout to the creator's verified payout number.
   *
   * Creator earnings are held in USD (`creator_balance.USD`). The balance check and the
   * debit run in one DB transaction under an advisory lock on the creator's account, so two
   * concurrent requests can't both spend the same balance. A ZWG/ZAR payout converts through
   * `fx_holding` as two single-currency ledger transactions (§3.3).
   */
  async requestPayout(userId: string, body: unknown) {
    const parsed = PayoutRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    const currency = dto.currency as CurrencyCode;
    const requestedAmount = BigInt(dto.amount_minor);

    const threshold = PAYOUT_THRESHOLDS[currency];
    if (threshold && requestedAmount < threshold) {
      throw new ValidationError(`Minimum payout for ${currency} is ${threshold} minor units`);
    }

    // Never pay out to a number supplied in the request: a stolen session could redirect funds.
    const [user] = await this.db
      .select({ payoutMsisdn: users.payoutMsisdn })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.payoutMsisdn) {
      throw new ValidationError('Set a payout number on your profile before requesting a payout');
    }
    const msisdn = user.payoutMsisdn;

    const { usd, fxRate } = await this.fx.convertToUsd(new Money(requestedAmount, currency));
    const usdAmount = usd.amount;
    const fxRateId = fxRate.id === 'identity' ? undefined : fxRate.id;

    return this.db.transaction(async (tx) => {
      const balanceAcc = await this.ledger.findOrCreateAccount(
        { scope: 'user', ownerId: userId, code: 'creator_balance', currency: 'USD' },
        tx,
      );
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${balanceAcc}))`);

      const bal = await this.ledger.balance(balanceAcc, tx);
      if (bal < usdAmount) throw new InsufficientBalanceError();

      const [payout] = await tx
        .insert(payouts)
        .values({
          creatorId: userId,
          requestedAmountMinor: String(requestedAmount),
          payoutCurrency: currency,
          usdEquivalentMinor: String(usdAmount),
          fxRateId: fxRateId ?? null,
          msisdn,
          state: 'requested',
        })
        .returning();
      if (!payout) throw new Error('Failed to create payout');

      const pendingAcc = await this.ledger.findOrCreateAccount(
        { scope: 'system', code: 'payout_pending', currency },
        tx,
      );
      const ref = { refType: 'payout', refId: payout.id, fxRateId };

      if (currency === 'USD') {
        await this.ledger.recordTransaction(
          [
            {
              accountId: balanceAcc,
              debitMinor: usdAmount,
              creditMinor: 0n,
              currency: 'USD',
              usdEquivalentMinor: usdAmount,
              ...ref,
            },
            {
              accountId: pendingAcc,
              debitMinor: 0n,
              creditMinor: usdAmount,
              currency: 'USD',
              usdEquivalentMinor: usdAmount,
              ...ref,
            },
          ],
          tx,
        );
      } else {
        const [holdingUsd, holdingLocal] = await Promise.all([
          this.ledger.findOrCreateAccount(
            { scope: 'system', code: 'fx_holding', currency: 'USD' },
            tx,
          ),
          this.ledger.findOrCreateAccount({ scope: 'system', code: 'fx_holding', currency }, tx),
        ]);
        await this.ledger.recordTransaction(
          [
            {
              accountId: balanceAcc,
              debitMinor: usdAmount,
              creditMinor: 0n,
              currency: 'USD',
              usdEquivalentMinor: usdAmount,
              ...ref,
            },
            {
              accountId: holdingUsd,
              debitMinor: 0n,
              creditMinor: usdAmount,
              currency: 'USD',
              usdEquivalentMinor: usdAmount,
              ...ref,
            },
          ],
          tx,
        );
        await this.ledger.recordTransaction(
          [
            {
              accountId: holdingLocal,
              debitMinor: requestedAmount,
              creditMinor: 0n,
              currency,
              usdEquivalentMinor: usdAmount,
              ...ref,
              refType: 'fx_conversion',
            },
            {
              accountId: pendingAcc,
              debitMinor: 0n,
              creditMinor: requestedAmount,
              currency,
              usdEquivalentMinor: usdAmount,
              ...ref,
            },
          ],
          tx,
        );
      }

      return { payout_id: payout.id, status: 'requested', msisdn };
    });
  }
}
