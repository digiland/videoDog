import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { accounts, ledgerEntries, payouts } from '../../db/schema';
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
  msisdn: z.string().regex(/^\+[1-9]\d{1,14}$/, 'msisdn must be E.164'),
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

    const conditions = [...userAccounts.map((acc) => eq(ledgerEntries.accountId, acc.id))];
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

  async requestPayout(userId: string, body: unknown) {
    const parsed = PayoutRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    const currency = dto.currency as CurrencyCode;
    const requestedAmount = BigInt(dto.amount_minor);

    // Check minimum threshold
    const threshold = PAYOUT_THRESHOLDS[currency];
    if (threshold && requestedAmount < threshold) {
      throw new ValidationError(`Minimum payout for ${currency} is ${threshold} minor units`);
    }

    // Check balance
    const accountId = await this.ledger.findOrCreateAccount({
      scope: 'user',
      ownerId: userId,
      code: 'creator_balance',
      currency,
    });

    const bal = await this.ledger.balance(accountId);
    if (bal < requestedAmount) throw new InsufficientBalanceError();

    // Get USD equivalent
    const amountMoney = new Money(requestedAmount, currency);
    const { usd, fxRate } = await this.fx.convertToUsd(amountMoney);

    // Insert payout row
    const [payout] = await this.db
      .insert(payouts)
      .values({
        creatorId: userId,
        requestedAmountMinor: String(requestedAmount),
        payoutCurrency: currency,
        usdEquivalentMinor: String(usd.amount),
        fxRateId: fxRate.id === 'identity' ? null : fxRate.id,
        msisdn: dto.msisdn,
        state: 'requested',
      })
      .returning();

    // Write ledger: Dr creator_balance, Cr payout_pending
    const payoutPendingAcc = await this.ledger.findOrCreateAccount({
      scope: 'system',
      code: 'payout_pending',
      currency,
    });

    await this.ledger.recordTransaction([
      {
        accountId,
        debitMinor: requestedAmount,
        creditMinor: 0n,
        currency,
        usdEquivalentMinor: usd.amount,
        fxRateId: fxRate.id === 'identity' ? undefined : fxRate.id,
        refType: 'payout',
        refId: payout!.id,
      },
      {
        accountId: payoutPendingAcc,
        debitMinor: 0n,
        creditMinor: requestedAmount,
        currency,
        usdEquivalentMinor: usd.amount,
        fxRateId: fxRate.id === 'identity' ? undefined : fxRate.id,
        refType: 'payout',
        refId: payout!.id,
      },
    ]);

    return { payout_id: payout!.id, status: 'requested' };
  }
}
