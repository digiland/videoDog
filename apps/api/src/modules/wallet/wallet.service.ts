import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte, desc, inArray } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { accounts, ledgerEntries, payouts, users } from '../../db/schema';
import { LedgerService } from '../payments/ledger.service';
import { LedgerRepository } from '../payments/ledger.repository';
import { PaymentsService } from '../payments/payments.service';
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

/** Currencies we can actually send to a creator (EcoCash USD / ZWG wallets). */
const PAYOUT_RAILS = new Set(['USD', 'ZWG']);

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
    private readonly payments: PaymentsService,
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

    if (!PAYOUT_RAILS.has(currency)) {
      throw new ValidationError(`Payouts in ${currency} aren't available yet; choose USD or ZWG`);
    }

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
      await LedgerRepository.lockAccount(tx, balanceAcc);

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

  /**
   * Send requested payouts. Each is claimed atomically (requested → processing), so
   * overlapping runs can't pay twice; the provider reference is the payout id.
   *
   * - completed → `Dr payout_pending | Cr payment_received` (money left our wallet)
   * - failed    → reverse the request so the creator's balance is restored
   * - no answer → left `processing` for manual reconciliation: the money may have moved.
   */
  async processPayouts(limit = 50): Promise<number> {
    const queued = await this.db
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.state, 'requested'))
      .limit(limit);

    let processed = 0;
    for (const { id } of queued) {
      const [payout] = await this.db
        .update(payouts)
        .set({ state: 'processing', updatedAt: new Date() })
        .where(and(eq(payouts.id, id), eq(payouts.state, 'requested')))
        .returning();
      if (!payout) continue; // another run took it
      processed++;

      let result: { provider_ref: string; status: 'pending' | 'completed' | 'failed' };
      try {
        result = await this.payments.ecocashFor(payout.payoutCurrency).disburse({
          msisdn: payout.msisdn,
          amountMinor: BigInt(payout.requestedAmountMinor),
          reference: payout.id,
        });
      } catch (err) {
        await this.db
          .update(payouts)
          .set({
            failureReason: `Provider error, needs reconciliation: ${String(err).slice(0, 200)}`,
            updatedAt: new Date(),
          })
          .where(eq(payouts.id, payout.id));
        continue;
      }

      if (result.status === 'pending') {
        await this.db
          .update(payouts)
          .set({ providerRef: result.provider_ref, updatedAt: new Date() })
          .where(eq(payouts.id, payout.id));
      } else {
        await this.finishPayout(payout, result.status, result.provider_ref);
      }
    }
    return processed;
  }

  private async finishPayout(
    payout: typeof payouts.$inferSelect,
    status: 'completed' | 'failed',
    providerRef: string,
  ) {
    const currency = payout.payoutCurrency as CurrencyCode;
    const amount = BigInt(payout.requestedAmountMinor);
    const usd = BigInt(payout.usdEquivalentMinor);
    const ref = { refType: 'payout', refId: payout.id, fxRateId: payout.fxRateId ?? undefined };

    await this.db.transaction(async (tx) => {
      const pendingAcc = await this.ledger.findOrCreateAccount(
        { scope: 'system', code: 'payout_pending', currency },
        tx,
      );

      if (status === 'completed') {
        const cashAcc = await this.ledger.findOrCreateAccount(
          { scope: 'system', code: 'payment_received', currency },
          tx,
        );
        await this.ledger.recordTransaction(
          [
            {
              accountId: pendingAcc,
              debitMinor: amount,
              creditMinor: 0n,
              currency,
              usdEquivalentMinor: usd,
              ...ref,
            },
            {
              accountId: cashAcc,
              debitMinor: 0n,
              creditMinor: amount,
              currency,
              usdEquivalentMinor: usd,
              ...ref,
            },
          ],
          tx,
        );
      } else {
        const balanceAcc = await this.ledger.findOrCreateAccount(
          { scope: 'user', ownerId: payout.creatorId, code: 'creator_balance', currency: 'USD' },
          tx,
        );
        if (currency === 'USD') {
          await this.ledger.recordTransaction(
            [
              {
                accountId: pendingAcc,
                debitMinor: amount,
                creditMinor: 0n,
                currency,
                usdEquivalentMinor: usd,
                ...ref,
              },
              {
                accountId: balanceAcc,
                debitMinor: 0n,
                creditMinor: amount,
                currency,
                usdEquivalentMinor: usd,
                ...ref,
              },
            ],
            tx,
          );
        } else {
          // Unwind both legs of the conversion made at request time (§3.3).
          const [holdingLocal, holdingUsd] = await Promise.all([
            this.ledger.findOrCreateAccount({ scope: 'system', code: 'fx_holding', currency }, tx),
            this.ledger.findOrCreateAccount(
              { scope: 'system', code: 'fx_holding', currency: 'USD' },
              tx,
            ),
          ]);
          await this.ledger.recordTransaction(
            [
              {
                accountId: pendingAcc,
                debitMinor: amount,
                creditMinor: 0n,
                currency,
                usdEquivalentMinor: usd,
                ...ref,
              },
              {
                accountId: holdingLocal,
                debitMinor: 0n,
                creditMinor: amount,
                currency,
                usdEquivalentMinor: usd,
                ...ref,
                refType: 'fx_conversion',
              },
            ],
            tx,
          );
          await this.ledger.recordTransaction(
            [
              {
                accountId: holdingUsd,
                debitMinor: usd,
                creditMinor: 0n,
                currency: 'USD',
                usdEquivalentMinor: usd,
                ...ref,
              },
              {
                accountId: balanceAcc,
                debitMinor: 0n,
                creditMinor: usd,
                currency: 'USD',
                usdEquivalentMinor: usd,
                ...ref,
              },
            ],
            tx,
          );
        }
      }

      await tx
        .update(payouts)
        .set({
          state: status,
          providerRef,
          processedAt: new Date(),
          failureReason: status === 'failed' ? 'Rejected by provider' : null,
          updatedAt: new Date(),
        })
        .where(eq(payouts.id, payout.id));
    });
  }
}
