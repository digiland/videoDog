import { and, eq, gt, lte, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DB, type Db } from '../../db/db.module';
import { subscriptions, subscriptionPlans, payments } from '../../db/schema';
import { FxService } from '../fx/fx.service';
import { Money } from '@streamzw/shared';
import type { CurrencyCode } from '@streamzw/shared';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { z } from 'zod';

const CheckoutSchema = z.object({
  plan_id: z.string().uuid(),
  payment_currency: z.enum(['USD', 'ZWG', 'ZAR']),
});

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly fx: FxService,
  ) {}

  async getPlans(displayCurrency: CurrencyCode = 'USD') {
    const plans = await this.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.active, true));

    return Promise.all(
      plans.map(async (plan) => {
        const baseMoney = new Money(
          BigInt(plan.basePriceMinorUnits),
          plan.baseCurrency as CurrencyCode,
        );
        let displayPrice = baseMoney.toJSON();
        if (displayCurrency !== plan.baseCurrency) {
          try {
            const rate = await this.fx.rate(plan.baseCurrency as CurrencyCode, displayCurrency);
            const converted = baseMoney.convert(rate, displayCurrency);
            displayPrice = converted.toJSON();
          } catch {
            // Fall back to base price on FX error
          }
        }
        return {
          id: plan.id,
          code: plan.code,
          duration_days: plan.durationDays,
          base_price: baseMoney.toJSON(),
          display_price: displayPrice,
          display_currency: displayCurrency,
        };
      }),
    );
  }

  async checkout(userId: string, body: unknown) {
    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    const [plan] = await this.db
      .select()
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.id, dto.plan_id), eq(subscriptionPlans.active, true)))
      .limit(1);

    if (!plan) throw new ResourceNotFoundError('Subscription plan');

    const paymentCurrency = dto.payment_currency as CurrencyCode;
    const baseMoney = new Money(
      BigInt(plan.basePriceMinorUnits),
      plan.baseCurrency as CurrencyCode,
    );

    let chargedAmount: Money;
    let usdEquiv: Money;
    let fxRateId: string | null = null;

    if (paymentCurrency === plan.baseCurrency) {
      chargedAmount = baseMoney;
      usdEquiv =
        baseMoney.currency === 'USD'
          ? baseMoney
          : await (async () => {
              const r = await this.fx.convertToUsd(baseMoney);
              fxRateId = r.fxRate.id === 'identity' ? null : r.fxRate.id;
              return r.usd;
            })();
    } else {
      const rate = await this.fx.rate(plan.baseCurrency as CurrencyCode, paymentCurrency);
      fxRateId = rate.id === 'identity' ? null : rate.id;
      chargedAmount = baseMoney.convert(rate, paymentCurrency);
      const usdResult = await this.fx.convertToUsd(chargedAmount);
      usdEquiv = usdResult.usd;
      if (!fxRateId && usdResult.fxRate.id !== 'identity') fxRateId = usdResult.fxRate.id;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    const [sub] = await this.db
      .insert(subscriptions)
      .values({
        userId,
        planId: plan.id,
        state: 'pending',
        chargedAmountMinor: String(chargedAmount.amount),
        chargedCurrency: paymentCurrency,
        usdEquivalentMinor: String(usdEquiv.amount),
        fxRateId,
        startedAt: null,
        expiresAt,
        autoRenew: true,
      })
      .returning();

    return {
      subscription_id: sub!.id,
      charged_amount: chargedAmount.toJSON(),
      usd_equivalent: usdEquiv.toJSON(),
      expires_at: expiresAt.toISOString(),
      // Caller must create a payment with intent=subscription, intent_ref_id=sub.id
    };
  }

  async getCurrent(userId: string) {
    const now = new Date();
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.state, 'active'),
          gt(subscriptions.expiresAt, now),
        ),
      )
      .orderBy(subscriptions.expiresAt)
      .limit(1);
    return sub ?? null;
  }

  async cancel(userId: string) {
    const now = new Date();
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.state, 'active'),
          gt(subscriptions.expiresAt, now),
        ),
      )
      .limit(1);

    if (!sub) throw new ResourceNotFoundError('Active subscription');

    const [updated] = await this.db
      .update(subscriptions)
      .set({ autoRenew: false, cancelledAt: now, updatedAt: now })
      .where(eq(subscriptions.id, sub.id))
      .returning();

    return updated!;
  }

  async isActive(userId: string): Promise<boolean> {
    const now = new Date();
    const [row] = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.state, 'active'),
          gt(subscriptions.expiresAt, now),
        ),
      )
      .limit(1);
    return !!row;
  }

  async processRenewals() {
    const now = new Date();
    // 1. Find expired active subscriptions with autoRenew = true
    const expiredActive = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.state, 'active'),
          lte(subscriptions.expiresAt, now),
          eq(subscriptions.autoRenew, true),
        ),
      );

    for (const sub of expiredActive) {
      // Transition to past_due (grace period start)
      await this.db
        .update(subscriptions)
        .set({ state: 'past_due', updatedAt: now })
        .where(eq(subscriptions.id, sub.id));

      // Find the last completed payment to clone MSISDN/provider
      const [lastPayment] = await this.db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.intent, 'subscription'),
            eq(payments.intentRefId, sub.id),
            eq(payments.state, 'completed'),
          ),
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);

      if (lastPayment) {
        const idempotencyKey = `renew-${sub.id}-${now.toISOString().slice(0, 10)}`;
        // Check if renewal payment already exists for today to avoid duplicate runs
        const [existingPayment] = await this.db
          .select()
          .from(payments)
          .where(eq(payments.idempotencyKey, idempotencyKey))
          .limit(1);

        if (!existingPayment) {
          const providerRef = `renew-ref-${randomUUID()}`;
          await this.db.insert(payments).values({
            userId: sub.userId,
            provider: lastPayment.provider,
            amountMinor: sub.chargedAmountMinor,
            currency: sub.chargedCurrency,
            usdEquivalentMinor: sub.usdEquivalentMinor,
            fxRateId: sub.fxRateId,
            intent: 'subscription',
            intentRefId: sub.id,
            state: 'pending',
            idempotencyKey,
            providerRef,
          });
        }
      }
    }

    // 2. Find subscriptions in past_due that have exceeded the 3-day grace period
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    await this.db
      .update(subscriptions)
      .set({ state: 'expired', updatedAt: now })
      .where(and(eq(subscriptions.state, 'past_due'), lte(subscriptions.expiresAt, threeDaysAgo)));
  }
}
