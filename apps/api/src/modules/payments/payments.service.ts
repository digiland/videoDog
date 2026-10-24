import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DB, type Db, type Tx } from '../../db/db.module';
import { payments, purchases, subscriptionPlans, subscriptions, videos } from '../../db/schema';
import { LedgerService, type LedgerEntryInput } from './ledger.service';
import { FxService } from '../fx/fx.service';
import { Money } from '@streamzw/shared';
import type { CurrencyCode } from '@streamzw/shared';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { EcocashClient } from '../../integrations/ecocash';
import { PaystackClient } from '../../integrations/paystack';
import type { ChargeResult, PaymentRail, ProviderStatus } from '../../integrations/rail';
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

const PaystackWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string().min(1),
    status: z.string().optional(),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
});

const PLATFORM_SHARE = 0.3;
const TIP_PLATFORM_SHARE = 0.1;

/** Don't ask the provider about a payment younger than this — give the webhook a chance. */
const RECONCILE_AFTER_MS = 20_000;

type Payment = typeof payments.$inferSelect;
type Provider = Payment['provider'];
type ChargeQuote = {
  amount: Money;
  usdEquivalent: bigint;
  fxRateId: string | null;
};
type Outcome = { status: ProviderStatus; providerRef?: string; raw?: unknown };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly ecocashUsd = new EcocashClient('USD');
  private readonly ecocashZwg = new EcocashClient('ZWG');
  private readonly paystack = new PaystackClient();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
  ) {}

  /** The rail behind each provider. ZIPIT needs a bank/aggregator integration — not live. */
  private rail(provider: Provider): PaymentRail | null {
    switch (provider) {
      case 'ecocash_usd':
        return this.ecocashUsd;
      case 'ecocash_zwg':
        return this.ecocashZwg;
      case 'paystack':
        return this.paystack;
      default:
        return null;
    }
  }

  ecocashFor(currency: string): EcocashClient {
    return currency === 'ZWG' ? this.ecocashZwg : this.ecocashUsd;
  }

  async createIntent(userId: string, body: unknown) {
    const parsed = CreatePaymentSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    const rail = this.rail(dto.provider);
    if (!rail) throw new ValidationError(`Provider ${dto.provider} is not available yet`);

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

    if (!(rail.currencies as readonly string[]).includes(quote.amount.currency)) {
      throw new ValidationError(
        `${dto.provider} charges in ${rail.currencies.join('/')}, but this payment is in ${quote.amount.currency}`,
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

    const result = await this.initiateCharge(payment, dto.msisdn);
    return {
      payment_id: payment.id,
      provider_ref: result.provider_ref,
      status: 'pending',
      ...(result.redirect_url && { redirect_url: result.redirect_url }),
    };
  }

  /** A payment's state for its owner (the checkout polls this). Reconciles stale ones. */
  async getForUser(userId: string, paymentId: string) {
    let [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.userId, userId)))
      .limit(1);
    if (!payment) throw new ResourceNotFoundError('Payment');

    if (
      (payment.state === 'pending' || payment.state === 'initiated') &&
      Date.now() - payment.createdAt.getTime() > RECONCILE_AFTER_MS
    ) {
      await this.reconcile(payment).catch((err: unknown) =>
        this.logger.warn({ payment_id: payment!.id, err }, 'Reconcile failed'),
      );
      [payment] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    }

    return {
      id: payment!.id,
      state: payment!.state,
      intent: payment!.intent,
      intent_ref_id: payment!.intentRefId,
      amount: new Money(BigInt(payment!.amountMinor), payment!.currency as CurrencyCode).toJSON(),
    };
  }

  /**
   * Ask the provider what happened and apply it (§3.12). Covers lost webhooks; run from
   * status polls and a periodic sweep. A provider that can't tell (dev) changes nothing.
   */
  async reconcile(payment: Payment): Promise<void> {
    const rail = this.rail(payment.provider);
    if (!rail) return;
    const status = await rail.getStatus(payment.idempotencyKey);
    if (!status || status === 'pending') return;
    await this.applyOutcome(payment.idempotencyKey, { status });
  }

  /** Reconcile every payment stuck pending between 2 minutes and 2 days old. */
  async reconcilePending(): Promise<number> {
    const stale = await this.db
      .select()
      .from(payments)
      .where(
        and(
          inArray(payments.state, ['initiated', 'pending']),
          lt(payments.createdAt, new Date(Date.now() - 2 * 60_000)),
          gt(payments.createdAt, new Date(Date.now() - 2 * 24 * 3600_000)),
        ),
      )
      .limit(500);
    for (const p of stale) {
      await this.reconcile(p).catch((err: unknown) =>
        this.logger.warn({ payment_id: p.id, err }, 'Reconcile failed'),
      );
    }
    return stale.length;
  }

  /**
   * Charge a subscription renewal at the amount locked on the subscription (§3.6), using
   * the payer number and EcoCash rail of the last completed payment. Idempotent per day.
   * Card (Paystack) subscriptions can't be charged without the viewer and are left to lapse.
   */
  async createRenewalCharge(
    sub: typeof subscriptions.$inferSelect,
    lastPayment: Payment,
    idempotencyKey: string,
  ): Promise<void> {
    if (lastPayment.provider !== 'ecocash_usd' && lastPayment.provider !== 'ecocash_zwg') return;
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

  /** EcoCash webhook (§11). Signature over the raw body, checked with the payment's own rail. */
  async handleEcocashWebhook(payload: string, signature: string) {
    const json = parseJson(payload);
    const parsed = EcocashWebhookSchema.safeParse(json);
    if (!parsed.success) throw new ValidationError('Invalid webhook payload');
    const data = parsed.data;

    const [known] = await this.db
      .select({ provider: payments.provider })
      .from(payments)
      .where(eq(payments.idempotencyKey, data.reference))
      .limit(1);
    if (!known) throw new ResourceNotFoundError('Payment');
    if (known.provider !== 'ecocash_usd' && known.provider !== 'ecocash_zwg') {
      throw new ValidationError('Not an EcoCash payment');
    }
    const client = known.provider === 'ecocash_zwg' ? this.ecocashZwg : this.ecocashUsd;
    if (!client.verifyWebhookSignature(payload, signature)) {
      throw new ValidationError('Invalid webhook signature');
    }

    // §3.12: the provider's own record wins over the callback when it has one.
    const claimed: ProviderStatus =
      data.status.toUpperCase() === 'COMPLETED' ? 'completed' : 'failed';
    const confirmed = (await client.getStatus(data.reference)) ?? claimed;
    if (confirmed === 'pending') return { ok: true, pending: true };
    if (confirmed !== claimed) {
      this.logger.warn(
        { reference: data.reference, claimed, confirmed },
        'Webhook disagrees with provider',
      );
    }
    return this.applyOutcome(data.reference, {
      status: confirmed,
      providerRef: data.provider_ref,
      raw: json,
    });
  }

  /**
   * Paystack webhook. Signed with HMAC-SHA512 of the raw body. Settles only when Paystack's
   * verify endpoint agrees and the amount and currency match what we asked for.
   */
  async handlePaystackWebhook(payload: string, signature: string) {
    if (!this.paystack.verifyWebhookSignature(payload, signature)) {
      throw new ValidationError('Invalid webhook signature');
    }
    const json = parseJson(payload);
    const parsed = PaystackWebhookSchema.safeParse(json);
    if (!parsed.success) throw new ValidationError('Invalid webhook payload');
    const { event, data } = parsed.data;
    if (event !== 'charge.success') return { ok: true, ignored: event };

    const [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.idempotencyKey, data.reference), eq(payments.provider, 'paystack')))
      .limit(1);
    if (!payment) throw new ResourceNotFoundError('Payment');

    const verified = (await this.paystack.verify(data.reference)) ?? {
      status: 'completed' as const,
      amountMinor: BigInt(data.amount),
      currency: data.currency,
    };
    if (
      verified.status === 'completed' &&
      (verified.amountMinor !== BigInt(payment.amountMinor) ||
        verified.currency !== payment.currency)
    ) {
      // Paid a different amount than we asked: don't unlock anything; needs a human.
      this.logger.error(
        {
          payment_id: payment.id,
          expected: payment.amountMinor,
          got: String(verified.amountMinor),
        },
        'Paystack amount/currency mismatch',
      );
      return { ok: true, mismatch: true };
    }
    if (verified.status === 'pending') return { ok: true, pending: true };
    return this.applyOutcome(data.reference, { status: verified.status, raw: json });
  }

  /**
   * Dev only: settle one of your own payments without a provider, so checkout can be tried
   * end to end locally. Refuses in production regardless of configuration.
   */
  async simulate(userId: string, paymentId: string, status: 'completed' | 'failed') {
    if (process.env.NODE_ENV === 'production' || process.env.DEV_SIMULATE_PAYMENTS !== 'true') {
      throw new ResourceNotFoundError('Route');
    }
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.userId, userId)))
      .limit(1);
    if (!payment) throw new ResourceNotFoundError('Payment');
    return this.applyOutcome(payment.idempotencyKey, { status, raw: { simulated: true } });
  }

  /**
   * The one place a payment changes final state. The payment row is locked FOR UPDATE and
   * the state change plus every ledger entry commit in one DB transaction, so concurrent or
   * retried deliveries settle exactly once and a crash part-way rolls back for the retry.
   */
  private async applyOutcome(reference: string, outcome: Outcome) {
    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.idempotencyKey, reference))
        .for('update')
        .limit(1);
      if (!payment) throw new ResourceNotFoundError('Payment');

      // Completed/reversed are final. A payment we marked failed (e.g. the charge request
      // timed out on our side) can still complete if the provider says the money moved.
      if (payment.state === 'completed' || payment.state === 'reversed') {
        return { ok: true, idempotent: true };
      }

      const now = new Date();
      if (outcome.status !== 'completed') {
        if (payment.state === 'failed') return { ok: true, idempotent: true };
        await tx
          .update(payments)
          .set({ state: 'failed', rawCallback: outcome.raw ?? null, updatedAt: now })
          .where(eq(payments.id, payment.id));
        return { ok: true };
      }

      await tx
        .update(payments)
        .set({
          state: 'completed',
          ...(outcome.providerRef && { providerRef: outcome.providerRef }),
          ...(outcome.raw !== undefined && { rawCallback: outcome.raw }),
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

  private async initiateCharge(payment: Payment, msisdn: string): Promise<ChargeResult> {
    const rail = this.rail(payment.provider);
    if (!rail) throw new ValidationError(`Provider ${payment.provider} is not available yet`);
    try {
      const result = await rail.createCharge({
        msisdn,
        amountMinor: BigInt(payment.amountMinor),
        currency: payment.currency as CurrencyCode,
        reference: payment.idempotencyKey,
        // Card rails require an email; users sign up by phone, so use a non-routable one.
        email: `${payment.userId}@users.streamzw.invalid`,
      });
      // Only advance initiated → pending: a fast webhook may already have settled it.
      await this.db
        .update(payments)
        .set({ state: 'pending', providerRef: result.provider_ref, updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), eq(payments.state, 'initiated')));
      return result;
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

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new ValidationError('Invalid webhook payload');
  }
}
