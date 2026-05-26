import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { purchases, subscriptions, subscriptionPlans } from '../../db/schema';
import { Money } from '@streamzw/shared';
import type { CurrencyCode } from '@streamzw/shared';

type User = { id: string; preferredDisplayCurrency: string };

type VideoForAccess = {
  id: string;
  accessMode: 'free' | 'ppv' | 'premium' | 'premium_buyable';
  inPremiumPool: boolean | null;
  ppvPriceMinorUnits: string | null;
  ppvPriceCurrency: string | null;
};

export interface PlanQuote {
  plan_id: string;
  code: string;
  price: ReturnType<Money['toJSON']>;
}

export type PaywallPayload = {
  reasons: ('not_subscribed' | 'not_purchased')[];
  options: {
    buy?: { price: ReturnType<Money['toJSON']> };
    subscribe?: { plans: PlanQuote[] };
  };
};

export type AccessResult = { ok: true } | { ok: false; paywall: PaywallPayload };

/**
 * Invariant §9: checkAccess is the ONLY place that evaluates view permission.
 * Never inline access logic in controllers, repositories, or UI.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async checkAccess(user: User | null, video: VideoForAccess): Promise<AccessResult> {
    if (video.accessMode === 'free') return { ok: true };

    if (user) {
      const inPool =
        video.inPremiumPool === true ||
        video.accessMode === 'premium' ||
        video.accessMode === 'premium_buyable';

      if (inPool) {
        const isSubbed = await this.isActiveSubscriber(user.id);
        if (isSubbed) return { ok: true };
      }

      const hasPurchased = await this.hasPurchased(user.id, video.id);
      if (hasPurchased) return { ok: true };
    }

    const displayCurrency = (user?.preferredDisplayCurrency as CurrencyCode | undefined) ?? 'USD';
    const paywall = await this.buildPaywall(video, displayCurrency);
    return { ok: false, paywall };
  }

  async isActiveSubscriber(userId: string): Promise<boolean> {
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

  async hasPurchased(userId: string, videoId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.videoId, videoId),
          eq(purchases.state, 'completed'),
        ),
      )
      .limit(1);
    return !!row;
  }

  private async buildPaywall(
    video: VideoForAccess,
    displayCurrency: CurrencyCode,
  ): Promise<PaywallPayload> {
    const reasons: PaywallPayload['reasons'] = [];
    const options: PaywallPayload['options'] = {};

    if (video.accessMode === 'ppv' || video.accessMode === 'premium_buyable') {
      reasons.push('not_purchased');
      if (video.ppvPriceMinorUnits && video.ppvPriceCurrency) {
        const price = new Money(
          BigInt(video.ppvPriceMinorUnits),
          video.ppvPriceCurrency as CurrencyCode,
        );
        options.buy = { price: price.toJSON() };
      }
    }

    if (video.accessMode === 'premium' || video.accessMode === 'premium_buyable') {
      reasons.push('not_subscribed');
      const plans = await this.getActivePlans(displayCurrency);
      options.subscribe = { plans };
    }

    return { reasons, options };
  }

  private async getActivePlans(displayCurrency: CurrencyCode): Promise<PlanQuote[]> {
    const rows = await this.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.active, true));

    return rows.map((p) => {
      const price = new Money(BigInt(p.basePriceMinorUnits), p.baseCurrency as CurrencyCode);
      return {
        plan_id: p.id,
        code: p.code,
        price: price.toJSON(),
        display_currency: displayCurrency,
      };
    });
  }
}
