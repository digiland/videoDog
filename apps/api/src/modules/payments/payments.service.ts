import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DB, type Db } from '../../db/db.module';
import { payments, purchases } from '../../db/schema';
import { LedgerService } from './ledger.service';
import { FxService } from '../fx/fx.service';
import { Money } from '@streamzw/shared';
import type { CurrencyCode } from '@streamzw/shared';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { EcocashUsdClient, EcocashZwgClient } from '../../integrations/ecocash';
import { z } from 'zod';

const CreatePaymentSchema = z.object({
  provider: z.enum(['ecocash_usd', 'ecocash_zwg', 'zipit', 'paystack']),
  intent: z.enum(['purchase', 'subscription', 'tip', 'topup']),
  intent_ref_id: z.string().uuid().optional(),
  amount_minor: z.number().int().positive(),
  currency: z.enum(['USD', 'ZWG', 'ZAR']),
  msisdn: z.string().regex(/^\+[1-9]\d{1,14}$/),
  idempotency_key: z.string().min(1).optional(),
});

const PLATFORM_SHARE = 0.3;
const TIP_PLATFORM_SHARE = 0.1;

@Injectable()
export class PaymentsService {
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

    const idempotencyKey = dto.idempotency_key ?? randomUUID();
    const currency = dto.currency as CurrencyCode;
    const amountMoney = new Money(BigInt(dto.amount_minor), currency);

    const { usd, fxRate } = await this.fx.convertToUsd(amountMoney);

    // Create payment row first
    const [payment] = await this.db
      .insert(payments)
      .values({
        userId,
        provider: dto.provider,
        amountMinor: String(dto.amount_minor),
        currency,
        usdEquivalentMinor: String(usd.amount),
        fxRateId: fxRate.id === 'identity' ? null : fxRate.id,
        intent: dto.intent,
        intentRefId: dto.intent_ref_id ?? null,
        state: 'initiated',
        idempotencyKey,
      })
      .returning();

    if (!payment) throw new Error('Failed to create payment');

    // Call provider
    let providerRef: string;
    try {
      if (dto.provider === 'ecocash_usd') {
        const result = await this.ecocashUsd.createCharge({
          msisdn: dto.msisdn,
          amountMinor: BigInt(dto.amount_minor),
          currency: 'USD',
          reference: idempotencyKey,
        });
        providerRef = result.provider_ref;
      } else if (dto.provider === 'ecocash_zwg') {
        const result = await this.ecocashZwg.createCharge({
          msisdn: dto.msisdn,
          amountMinor: BigInt(dto.amount_minor),
          currency: 'ZWG',
          reference: idempotencyKey,
        });
        providerRef = result.provider_ref;
      } else {
        // zipit / paystack — stub
        providerRef = `stub-${randomUUID()}`;
      }

      await this.db
        .update(payments)
        .set({ state: 'pending', providerRef, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    } catch (err) {
      await this.db
        .update(payments)
        .set({ state: 'failed', updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      throw err;
    }

    return { payment_id: payment.id, provider_ref: providerRef, status: 'pending' };
  }

  /**
   * Idempotent webhook handler for EcoCash.
   * Invariants §11, §12.
   */
  async handleEcocashWebhook(
    payload: string,
    signature: string,
    provider: 'ecocash_usd' | 'ecocash_zwg',
  ) {
    // Verify HMAC
    const client = provider === 'ecocash_usd' ? this.ecocashUsd : this.ecocashZwg;
    if (!client.verifyWebhookSignature(payload, signature)) {
      throw new ValidationError('Invalid webhook signature');
    }

    const data = JSON.parse(payload) as {
      reference: string;
      provider_ref: string;
      status: string;
    };

    // Find payment by idempotency_key (=reference)
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, data.reference))
      .limit(1);

    if (!payment) throw new ResourceNotFoundError('Payment');

    // Idempotency: already processed
    if (payment.state === 'completed' || payment.state === 'failed') {
      return { ok: true, idempotent: true };
    }

    if (data.status !== 'COMPLETED') {
      await this.db
        .update(payments)
        .set({
          state: 'failed',
          rawCallback: JSON.parse(payload) as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));
      return { ok: true };
    }

    // Mark payment completed
    await this.db
      .update(payments)
      .set({
        state: 'completed',
        providerRef: data.provider_ref,
        rawCallback: JSON.parse(payload) as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    // Write ledger + complete purchase/subscription
    if (payment.intent === 'purchase' && payment.intentRefId) {
      await this.settlePurchase(payment);
    } else if (payment.intent === 'subscription' && payment.intentRefId) {
      await this.settleSubscription(payment);
    } else if (payment.intent === 'tip') {
      await this.settleTip(payment);
    }

    return { ok: true };
  }

  private async settlePurchase(payment: typeof payments.$inferSelect) {
    // Mark purchase completed
    await this.db
      .update(purchases)
      .set({
        state: 'completed',
        paymentId: payment.id,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, payment.intentRefId!));

    // Find creator from purchase→video→owner
    const [purchase] = await this.db
      .select()
      .from(purchases)
      .where(eq(purchases.id, payment.intentRefId!))
      .limit(1);

    if (!purchase) return;

    const paidAmount = BigInt(payment.amountMinor);
    const paidCurrency = payment.currency as CurrencyCode;
    const usdEquiv = BigInt(payment.usdEquivalentMinor);
    const fxRateId = payment.fxRateId ?? undefined;
    const isUsd = paidCurrency === 'USD';

    // Get video owner (creator)
    const { videos: videosTable } = await import('../../db/schema');
    const [video] = await this.db
      .select({ ownerId: videosTable.ownerId })
      .from(videosTable)
      .where(eq(videosTable.id, purchase.videoId))
      .limit(1);

    if (!video) return;
    const creatorId = video.ownerId;

    if (isUsd) {
      // Single transaction: payment_received → creator_balance + platform_revenue
      const paidMoney = new Money(paidAmount, 'USD');
      const platformAmount = paidMoney.mul(PLATFORM_SHARE);
      const creatorAmount = new Money(paidAmount - platformAmount.amount, 'USD'); // floor to creator

      const [payRecvAcc, creatorAcc, platformAcc] = await Promise.all([
        this.ledger.findOrCreateAccount({
          scope: 'system',
          code: 'payment_received',
          currency: 'USD',
        }),
        this.ledger.findOrCreateAccount({
          scope: 'user',
          ownerId: creatorId,
          code: 'creator_balance',
          currency: 'USD',
        }),
        this.ledger.findOrCreateAccount({
          scope: 'system',
          code: 'platform_revenue',
          currency: 'USD',
        }),
      ]);

      await this.ledger.recordTransaction([
        {
          accountId: payRecvAcc,
          debitMinor: paidAmount,
          creditMinor: 0n,
          currency: 'USD',
          usdEquivalentMinor: paidAmount,
          fxRateId,
          refType: 'purchase',
          refId: purchase.id,
        },
        {
          accountId: creatorAcc,
          debitMinor: 0n,
          creditMinor: creatorAmount.amount,
          currency: 'USD',
          usdEquivalentMinor: creatorAmount.amount,
          fxRateId,
          refType: 'purchase',
          refId: purchase.id,
        },
        {
          accountId: platformAcc,
          debitMinor: 0n,
          creditMinor: platformAmount.amount,
          currency: 'USD',
          usdEquivalentMinor: platformAmount.amount,
          fxRateId,
          refType: 'purchase',
          refId: purchase.id,
        },
      ]);
    } else {
      // Two transactions: receipt in non-USD + FX conversion
      const [payRecvAcc, fxHoldingNonUsd, fxHoldingUsd, creatorAcc, platformAcc] =
        await Promise.all([
          this.ledger.findOrCreateAccount({
            scope: 'system',
            code: 'payment_received',
            currency: paidCurrency,
          }),
          this.ledger.findOrCreateAccount({
            scope: 'system',
            code: 'fx_holding',
            currency: paidCurrency,
          }),
          this.ledger.findOrCreateAccount({ scope: 'system', code: 'fx_holding', currency: 'USD' }),
          this.ledger.findOrCreateAccount({
            scope: 'user',
            ownerId: creatorId,
            code: 'creator_balance',
            currency: 'USD',
          }),
          this.ledger.findOrCreateAccount({
            scope: 'system',
            code: 'platform_revenue',
            currency: 'USD',
          }),
        ]);

      // Tx 1: receipt
      await this.ledger.recordTransaction([
        {
          accountId: payRecvAcc,
          debitMinor: paidAmount,
          creditMinor: 0n,
          currency: paidCurrency,
          usdEquivalentMinor: usdEquiv,
          fxRateId,
          refType: 'purchase',
          refId: purchase.id,
        },
        {
          accountId: fxHoldingNonUsd,
          debitMinor: 0n,
          creditMinor: paidAmount,
          currency: paidCurrency,
          usdEquivalentMinor: usdEquiv,
          fxRateId,
          refType: 'purchase',
          refId: purchase.id,
        },
      ]);

      // Tx 2: FX conversion to USD
      const usdMoney = new Money(usdEquiv, 'USD');
      const platformAmount = usdMoney.mul(PLATFORM_SHARE);
      const creatorAmount = new Money(usdEquiv - platformAmount.amount, 'USD');

      await this.ledger.recordTransaction([
        {
          accountId: fxHoldingUsd,
          debitMinor: usdEquiv,
          creditMinor: 0n,
          currency: 'USD',
          usdEquivalentMinor: usdEquiv,
          fxRateId,
          refType: 'fx_conversion',
          refId: purchase.id,
        },
        {
          accountId: creatorAcc,
          debitMinor: 0n,
          creditMinor: creatorAmount.amount,
          currency: 'USD',
          usdEquivalentMinor: creatorAmount.amount,
          fxRateId,
          refType: 'purchase',
          refId: purchase.id,
        },
        {
          accountId: platformAcc,
          debitMinor: 0n,
          creditMinor: platformAmount.amount,
          currency: 'USD',
          usdEquivalentMinor: platformAmount.amount,
          fxRateId,
          refType: 'purchase',
          refId: purchase.id,
        },
      ]);
    }
  }

  private async settleSubscription(payment: typeof payments.$inferSelect) {
    const { subscriptions: subsTable } = await import('../../db/schema');
    await this.db
      .update(subsTable)
      .set({ state: 'active', startedAt: new Date(), updatedAt: new Date() })
      .where(eq(subsTable.id, payment.intentRefId!));

    const paidAmount = BigInt(payment.amountMinor);
    const paidCurrency = payment.currency as CurrencyCode;
    const usdEquiv = BigInt(payment.usdEquivalentMinor);
    const fxRateId = payment.fxRateId ?? undefined;

    const [payRecvAcc, premiumPoolAcc] = await Promise.all([
      this.ledger.findOrCreateAccount({
        scope: 'system',
        code: 'payment_received',
        currency: paidCurrency,
      }),
      this.ledger.findOrCreateAccount({ scope: 'system', code: 'premium_pool', currency: 'USD' }),
    ]);

    if (paidCurrency === 'USD') {
      await this.ledger.recordTransaction([
        {
          accountId: payRecvAcc,
          debitMinor: paidAmount,
          creditMinor: 0n,
          currency: 'USD',
          usdEquivalentMinor: paidAmount,
          fxRateId,
          refType: 'subscription',
          refId: payment.intentRefId!,
        },
        {
          accountId: premiumPoolAcc,
          debitMinor: 0n,
          creditMinor: paidAmount,
          currency: 'USD',
          usdEquivalentMinor: paidAmount,
          fxRateId,
          refType: 'subscription',
          refId: payment.intentRefId!,
        },
      ]);
    } else {
      const [fxHoldingNonUsd, fxHoldingUsd] = await Promise.all([
        this.ledger.findOrCreateAccount({
          scope: 'system',
          code: 'fx_holding',
          currency: paidCurrency,
        }),
        this.ledger.findOrCreateAccount({ scope: 'system', code: 'fx_holding', currency: 'USD' }),
      ]);

      await this.ledger.recordTransaction([
        {
          accountId: payRecvAcc,
          debitMinor: paidAmount,
          creditMinor: 0n,
          currency: paidCurrency,
          usdEquivalentMinor: usdEquiv,
          fxRateId,
          refType: 'subscription',
          refId: payment.intentRefId!,
        },
        {
          accountId: fxHoldingNonUsd,
          debitMinor: 0n,
          creditMinor: paidAmount,
          currency: paidCurrency,
          usdEquivalentMinor: usdEquiv,
          fxRateId,
          refType: 'subscription',
          refId: payment.intentRefId!,
        },
      ]);

      await this.ledger.recordTransaction([
        {
          accountId: fxHoldingUsd,
          debitMinor: usdEquiv,
          creditMinor: 0n,
          currency: 'USD',
          usdEquivalentMinor: usdEquiv,
          fxRateId,
          refType: 'fx_conversion',
          refId: payment.intentRefId!,
        },
        {
          accountId: premiumPoolAcc,
          debitMinor: 0n,
          creditMinor: usdEquiv,
          currency: 'USD',
          usdEquivalentMinor: usdEquiv,
          fxRateId,
          refType: 'subscription',
          refId: payment.intentRefId!,
        },
      ]);
    }
  }

  private async settleTip(payment: typeof payments.$inferSelect) {
    // Tips: 10% platform, 90% creator
    // For now just record receipt — creator attribution TBD via intent_ref_id
    const paidAmount = BigInt(payment.amountMinor);
    const usdEquiv = BigInt(payment.usdEquivalentMinor);
    const fxRateId = payment.fxRateId ?? undefined;
    const paidCurrency = payment.currency as CurrencyCode;

    const platformAcc = await this.ledger.findOrCreateAccount({
      scope: 'system',
      code: 'platform_revenue',
      currency: 'USD',
    });

    const tipUsd = new Money(usdEquiv, 'USD');
    const platformTip = tipUsd.mul(TIP_PLATFORM_SHARE);

    if (paidCurrency === 'USD') {
      const creatorTip = new Money(paidAmount - platformTip.amount, 'USD');
      const [payRecvUsdAcc, creatorAcc] = await Promise.all([
        this.ledger.findOrCreateAccount({
          scope: 'system',
          code: 'payment_received',
          currency: 'USD',
        }),
        this.ledger.findOrCreateAccount({
          scope: 'system',
          code: 'tips_clearing',
          currency: 'USD',
        }),
      ]);
      await this.ledger.recordTransaction([
        {
          accountId: payRecvUsdAcc,
          debitMinor: paidAmount,
          creditMinor: 0n,
          currency: 'USD',
          usdEquivalentMinor: paidAmount,
          fxRateId,
          refType: 'tip',
          refId: payment.id,
        },
        {
          accountId: creatorAcc,
          debitMinor: 0n,
          creditMinor: creatorTip.amount,
          currency: 'USD',
          usdEquivalentMinor: creatorTip.amount,
          fxRateId,
          refType: 'tip',
          refId: payment.id,
        },
        {
          accountId: platformAcc,
          debitMinor: 0n,
          creditMinor: platformTip.amount,
          currency: 'USD',
          usdEquivalentMinor: platformTip.amount,
          fxRateId,
          refType: 'tip',
          refId: payment.id,
        },
      ]);
    }
  }
}
