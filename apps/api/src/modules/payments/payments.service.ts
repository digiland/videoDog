import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DB, type Db, type Tx } from '../../db/db.module';
import { payments, purchases, subscriptionPlans, subscriptions, videos } from '../../db/schema';
import { LedgerService, type LedgerEntryInput } from './ledger.service';
import { FxService } from '../fx/fx.service';
import { Money } from '@streamzw/shared';
import type { CurrencyCode } from '@streamzw/shared';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { EcocashUsdClient, EcocashZwgClient } from '../../integrations/ecocash';
import { z } from 'zod';

const E164 = /^\+[1-9]\d{1,14}$/;

const BasePaymentSchema = z.object({
  provider: z.enum(['ecocash_usd', 'ecocash_zwg', 'zipit', 'paystack']),
  intent_ref_id: z.string().uuid(),
  msisdn: z.string().regex(E164),
  idempotency_key: z.string().min(1).max(200).optional(),
});

/**
 * The client names WHAT it is paying for; the server decides HOW MUCH.
 * Purchase and subscription amounts come from the pending row the caller owns —
 * any `amount_minor`/`currency` sent for those intents is ignored (stripped by Zod).
 * Only tips carry a client-chosen amount, since the viewer picks it.
 */
const CreatePaymentSchema = z.discriminatedUnion('intent', [
  BasePaymentSchema.extend({ intent: z.literal('purchase') }),
  BasePaymentSchema.extend({ intent: z.literal('subscription') }),
  BasePaymentSchema.extend({
    intent: z.literal('tip'),
    amount_minor: z.number().int().positive().max(100_000),
    currency: z.enum(['USD', 'ZWG', 'ZAR']),
  }),
]);

const EcocashWebhookSchema = z.object({
  reference: z.string().min(1),
  provider_ref: z.string().min(1),
  status: z.string().min(1),
});

/** Currency each live provider rail settles in. ZIPIT / Paystack are not wired up yet. */
const PROVIDER_CURRENCY: Partial<Record<string, CurrencyCode>> = {
  ecocash_usd: 'USD',
  ecocash_zwg: 'ZWG',
};

const PLATFORM_SHARE = 0.3;
const TIP_PLATFORM_SHARE = 0.1;

type Payment = typeof payments.$inferSelect;
type ChargeQuote = {
  amount: Money;
  usdEquivalent: bigint;
  fxRateId: string | null;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly ecocashUsd = new EcocashUsdClient();
  private readonly ecocashZwg = new EcocashZwgClient();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
  ) {}

  async createIntent(userId: string, body: unknown) {
    const parsed = CreatePaymentSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    const providerCurrency = PROVIDER_CURRENCY[dto.provider];
    if (!providerCurrency)
      throw new ValidationError(`Provider ${dto.provider} is not available yet`);

    const idempotencyKey = dto.idempotency_key ?? randomUUID();

    // Client retried the same request: return the existing payment instead of charging twice.
    const [existing] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) {
      if (existing.userId !== userId) throw new ValidationError('idempotency_key already used');
      return {
        payment_id: existing.id,
        provider_ref: existing.providerRef,
        status: existing.state,
      };
    }

    let quote: ChargeQuote;
    if (dto.intent === 'purchase') {
      quote = await this.quotePurchase(userId, dto.intent_ref_id);
    } else if (dto.intent === 'subscription') {
      quote = await this.quoteSubscription(userId, dto.intent_ref_id);
    } else {
      quote = await this.quoteTip(dto.intent_ref_id, dto.amount_minor, dto.currency);
    }

    if (quote.amount.currency !== providerCurrency) {
      throw new ValidationError(
        `${dto.provider} charges in ${providerCurrency}, but this payment is in ${quote.amount.currency}`,
      );
    }

    const [payment] = await this.db
      .insert(payments)
      .values({
        userId,
        provider: dto.provider,
        amountMinor: String(quote.amount.amount),
        currency: quote.amount.currency,
        usdEquivalentMinor: String(quote.usdEquivalent),
        fxRateId: quote.fxRateId,
        intent: dto.intent,
        intentRefId: dto.intent_ref_id,
        payerMsisdn: dto.msisdn,
        state: 'initiated',
        idempotencyKey,
      })
      .returning();
    if (!payment) throw new Error('Failed to create payment');

    const providerRef = await this.initiateCharge(payment, dto.msisdn);
    return { payment_id: payment.id, provider_ref: providerRef, status: 'pending' };
  }

  /**
   * Charge a subscription renewal at the amount locked on the subscription (§3.6), using
   * the payer number and provider of the last completed payment. Idempotent per day.
   */
  async createRenewalCharge(
    sub: typeof subscriptions.$inferSelect,
    lastPayment: Payment,
    idempotencyKey: string,
  ): Promise<void> {
    if (!lastPayment.payerMsisdn) {
      this.logger.warn({ subscription_id: sub.id }, 'No payer number on file; cannot renew');
      return;
    }
    const [payment] = await this.db
      .insert(payments)
      .values({
        userId: sub.userId,
        provider: lastPayment.provider,
        amountMinor: sub.chargedAmountMinor,
        currency: sub.chargedCurrency,
        usdEquivalentMinor: sub.usdEquivalentMinor,
        fxRateId: sub.fxRateId,
        intent: 'subscription',
        intentRefId: sub.id,
        payerMsisdn: lastPayment.payerMsisdn,
        state: 'initiated',
        idempotencyKey,
      })
      .onConflictDoNothing({ target: payments.idempotencyKey })
      .returning();
    if (!payment) return; // this renewal was already attempted
    await this.initiateCharge(payment, lastPayment.payerMsisdn);
  }

  /**
   * Idempotent webhook handler for EcoCash. Invariant §11.
   *
   * The payment row is locked FOR UPDATE and the state change plus every ledger entry
   * commit in one DB transaction, so concurrent or retried deliveries settle exactly once
   * and a crash part-way leaves the payment pending for the retry to finish.
   */
  async handleEcocashWebhook(payload: string, signature: string) {
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      throw new ValidationError('Invalid webhook payload');
    }
    const parsed = EcocashWebhookSchema.safeParse(json);
    if (!parsed.success) throw new ValidationError('Invalid webhook payload');
    const data = parsed.data;

    const [known] = await this.db
      .select({ provider: payments.provider })
      .from(payments)
      .where(eq(payments.idempotencyKey, data.reference))
      .limit(1);
    if (!known) throw new ResourceNotFoundError('Payment');

    // Verify with the rail the payment was actually created on, never a body field.
    const client = known.provider === 'ecocash_zwg' ? this.ecocashZwg : this.ecocashUsd;
    if (!client.verifyWebhookSignature(payload, signature)) {
      throw new ValidationError('Invalid webhook signature');
    }

    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.idempotencyKey, data.reference))
        .for('update')
        .limit(1);
      if (!payment) throw new ResourceNotFoundError('Payment');

      // Completed/reversed are final. A payment we marked failed (e.g. the charge request
      // timed out on our side) can still complete if the provider says the money moved.
      if (payment.state === 'completed' || payment.state === 'reversed') {
        return { ok: true, idempotent: true };
      }

      const now = new Date();
      if (data.status !== 'COMPLETED') {
        if (payment.state === 'failed') return { ok: true, idempotent: true };
        await tx
          .update(payments)
          .set({ state: 'failed', rawCallback: json, updatedAt: now })
          .where(eq(payments.id, payment.id));
        return { ok: true };
      }

      await tx
        .update(payments)
        .set({
          state: 'completed',
          providerRef: data.provider_ref,
          rawCallback: json,
          updatedAt: now,
        })
        .where(eq(payments.id, payment.id));

      if (payment.intent === 'purchase') await this.settlePurchase(tx, payment);
      else if (payment.intent === 'subscription') await this.settleSubscription(tx, payment);
      else if (payment.intent === 'tip') await this.settleTip(tx, payment);
      else throw new Error(`Unsupported payment intent ${payment.intent}`);

      return { ok: true };
    });
  }

  // ─── Quotes ────────────────────────────────────────────────────────────────

  private async quotePurchase(userId: string, purchaseId: string): Promise<ChargeQuote> {
    const [purchase] = await this.db
      .select()
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.userId, userId)))
      .limit(1);
    if (!purchase) throw new ResourceNotFoundError('Purchase');
    if (purchase.state !== 'pending') throw new ValidationError('Purchase is not awaiting payment');
    return {
      amount: new Money(BigInt(purchase.paidAmountMinor), purchase.paidCurrency as CurrencyCode),
      usdEquivalent: BigInt(purchase.usdEquivalentMinor),
      fxRateId: purchase.fxRateId,
    };
  }

  private async quoteSubscription(userId: string, subscriptionId: string): Promise<ChargeQuote> {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!sub) throw new ResourceNotFoundError('Subscription');
    if (sub.state !== 'pending') throw new ValidationError('Subscription is not awaiting payment');
    return {
      amount: new Money(BigInt(sub.chargedAmountMinor), sub.chargedCurrency as CurrencyCode),
      usdEquivalent: BigInt(sub.usdEquivalentMinor),
      fxRateId: sub.fxRateId,
    };
  }

  private async quoteTip(
    videoId: string,
    amountMinor: number,
    currency: CurrencyCode,
  ): Promise<ChargeQuote> {
    const [video] = await this.db
      .select({ accessMode: videos.accessMode, state: videos.state })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1);
    if (!video || video.state !== 'published') throw new ResourceNotFoundError('Video');
    if (video.accessMode !== 'free') throw new ValidationError('Tips are only for free videos');

    const amount = new Money(BigInt(amountMinor), currency);
    const { usd, fxRate } = await this.fx.convertToUsd(amount);
    return {
      amount,
      usdEquivalent: usd.amount,
      fxRateId: fxRate.id === 'identity' ? null : fxRate.id,
    };
  }

  private async initiateCharge(payment: Payment, msisdn: string): Promise<string> {
    try {
      const client = payment.provider === 'ecocash_zwg' ? this.ecocashZwg : this.ecocashUsd;
      const result = await client.createCharge({
        msisdn,
        amountMinor: BigInt(payment.amountMinor),
        currency: payment.currency as 'USD' | 'ZWG',
        reference: payment.idempotencyKey,
      });
      // Only advance initiated → pending: a fast webhook may already have settled it.
      await this.db
        .update(payments)
        .set({ state: 'pending', providerRef: result.provider_ref, updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), eq(payments.state, 'initiated')));
      return result.provider_ref;
    } catch (err) {
      await this.db
        .update(payments)
        .set({ state: 'failed', updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), inArray(payments.state, ['initiated', 'pending'])));
      throw err;
    }
  }

  // ─── Settlement (always inside the webhook's DB transaction) ──────────────

  private async settlePurchase(tx: Tx, payment: Payment) {
    const [purchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, payment.intentRefId!))
      .for('update')
      .limit(1);
    if (!purchase)
      throw new Error(`Purchase ${payment.intentRefId} missing for payment ${payment.id}`);

    if (purchase.state === 'completed') {
      // A second payment for an already-unlocked video: we hold the money, so book it as
      // owed back to the payer rather than crediting the creator twice.
      this.logger.warn(
        { payment_id: payment.id, purchase_id: purchase.id },
        'Duplicate purchase payment; refund due',
      );
      await this.bookRefundDue(tx, payment, 'purchase');
      return;
    }

    await tx
      .update(purchases)
      .set({
        state: 'completed',
        paymentId: payment.id,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, purchase.id));

    const [video] = await tx
      .select({ ownerId: videos.ownerId })
      .from(videos)
      .where(eq(videos.id, purchase.videoId))
      .limit(1);
    if (!video) throw new Error(`Video ${purchase.videoId} missing for purchase ${purchase.id}`);

    await this.creditCreatorAndPlatform(
      tx,
      payment,
      video.ownerId,
      PLATFORM_SHARE,
      'purchase',
      purchase.id,
    );
  }

  private async settleSubscription(tx: Tx, payment: Payment) {
    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, payment.intentRefId!))
      .for('update')
      .limit(1);
    if (!sub)
      throw new Error(`Subscription ${payment.intentRefId} missing for payment ${payment.id}`);

    const [plan] = sub.planId
      ? await tx
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.id, sub.planId))
          .limit(1)
      : [];
    if (!plan) throw new Error(`Plan ${sub.planId} missing for subscription ${sub.id}`);

    const now = new Date();
    // A pending (new) subscription starts now; a renewal extends from the current expiry
    // if it hasn't passed yet, so paying early never loses days.
    const isNew = sub.state === 'pending';
    const baseDate = !isNew && sub.expiresAt > now ? sub.expiresAt : now;
    const expiresAt = new Date(baseDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    await tx
      .update(subscriptions)
      .set({
        state: 'active',
        startedAt: sub.startedAt ?? now,
        expiresAt,
        cancelledAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id));

    // 100% goes to premium_pool; the monthly pool run pays 55% to creators and moves the
    // remaining 45% to platform_revenue (§7).
    const premiumPool = await this.ledger.findOrCreateAccount(
      { scope: 'system', code: 'premium_pool', currency: 'USD' },
      tx,
    );
    await this.receiveInUsd(tx, payment, 'subscription', sub.id, (usd) => [
      { accountId: premiumPool, amount: usd },
    ]);
  }

  private async settleTip(tx: Tx, payment: Payment) {
    const [video] = await tx
      .select({ ownerId: videos.ownerId })
      .from(videos)
      .where(eq(videos.id, payment.intentRefId!))
      .limit(1);
    if (!video) throw new Error(`Video ${payment.intentRefId} missing for tip ${payment.id}`);

    await this.creditCreatorAndPlatform(
      tx,
      payment,
      video.ownerId,
      TIP_PLATFORM_SHARE,
      'tip',
      payment.id,
    );
  }

  private async creditCreatorAndPlatform(
    tx: Tx,
    payment: Payment,
    creatorId: string,
    platformShare: number,
    refType: string,
    refId: string,
  ) {
    const [creatorAcc, platformAcc] = await Promise.all([
      this.ledger.findOrCreateAccount(
        { scope: 'user', ownerId: creatorId, code: 'creator_balance', currency: 'USD' },
        tx,
      ),
      this.ledger.findOrCreateAccount(
        { scope: 'system', code: 'platform_revenue', currency: 'USD' },
        tx,
      ),
    ]);
    await this.receiveInUsd(tx, payment, refType, refId, (usd) => {
      const platform = new Money(usd, 'USD').mul(platformShare).amount;
      return [
        { accountId: creatorAcc, amount: usd - platform },
        { accountId: platformAcc, amount: platform },
      ];
    });
  }

  /**
   * Book a received payment and credit USD accounts with it.
   *
   * USD: one transaction, `Dr payment_received.USD | Cr <credits>`.
   * Non-USD (§3.3, §5): two transactions — the receipt stays in its own currency
   * (`Dr payment_received.X | Cr fx_holding.X`), then the conversion
   * (`Dr fx_holding.USD | Cr <credits>`), so no entry mixes currencies.
   */
  private async receiveInUsd(
    tx: Tx,
    payment: Payment,
    refType: string,
    refId: string,
    splitUsd: (usd: bigint) => { accountId: string; amount: bigint }[],
  ) {
    const paid = BigInt(payment.amountMinor);
    const currency = payment.currency as CurrencyCode;
    const usd = BigInt(payment.usdEquivalentMinor);
    const fxRateId = payment.fxRateId ?? undefined;

    const credits: LedgerEntryInput[] = splitUsd(usd)
      .filter((c) => c.amount > 0n)
      .map((c) => ({
        accountId: c.accountId,
        debitMinor: 0n,
        creditMinor: c.amount,
        currency: 'USD',
        usdEquivalentMinor: c.amount,
        fxRateId,
        refType,
        refId,
      }));

    const receivedAcc = await this.ledger.findOrCreateAccount(
      { scope: 'system', code: 'payment_received', currency },
      tx,
    );

    if (currency === 'USD') {
      await this.ledger.recordTransaction(
        [
          {
            accountId: receivedAcc,
            debitMinor: paid,
            creditMinor: 0n,
            currency,
            usdEquivalentMinor: paid,
            fxRateId,
            refType,
            refId,
          },
          ...credits,
        ],
        tx,
      );
      return;
    }

    const [holdingLocal, holdingUsd] = await Promise.all([
      this.ledger.findOrCreateAccount({ scope: 'system', code: 'fx_holding', currency }, tx),
      this.ledger.findOrCreateAccount({ scope: 'system', code: 'fx_holding', currency: 'USD' }, tx),
    ]);
    await this.ledger.recordTransaction(
      [
        {
          accountId: receivedAcc,
          debitMinor: paid,
          creditMinor: 0n,
          currency,
          usdEquivalentMinor: usd,
          fxRateId,
          refType,
          refId,
        },
        {
          accountId: holdingLocal,
          debitMinor: 0n,
          creditMinor: paid,
          currency,
          usdEquivalentMinor: usd,
          fxRateId,
          refType,
          refId,
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
          fxRateId,
          refType: 'fx_conversion',
          refId,
        },
        ...credits,
      ],
      tx,
    );
  }

  private async bookRefundDue(tx: Tx, payment: Payment, refType: string) {
    const currency = payment.currency as CurrencyCode;
    const paid = BigInt(payment.amountMinor);
    const usd = BigInt(payment.usdEquivalentMinor);
    const fxRateId = payment.fxRateId ?? undefined;
    const [receivedAcc, refundsAcc] = await Promise.all([
      this.ledger.findOrCreateAccount({ scope: 'system', code: 'payment_received', currency }, tx),
      this.ledger.findOrCreateAccount({ scope: 'system', code: 'refunds_due', currency }, tx),
    ]);
    await this.ledger.recordTransaction(
      [
        {
          accountId: receivedAcc,
          debitMinor: paid,
          creditMinor: 0n,
          currency,
          usdEquivalentMinor: usd,
          fxRateId,
          refType,
          refId: payment.id,
        },
        {
          accountId: refundsAcc,
          debitMinor: 0n,
          creditMinor: paid,
          currency,
          usdEquivalentMinor: usd,
          fxRateId,
          refType,
          refId: payment.id,
        },
      ],
      tx,
    );
  }
}
