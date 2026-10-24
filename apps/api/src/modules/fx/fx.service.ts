import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import Redis from 'ioredis';
import { DB, type Db } from '../../db/db.module';
import { REDIS } from '../../common/redis.module';
import { fxRates } from '../../db/schema';
import { Money } from '@streamzw/shared';
import type { FxRate } from '@streamzw/shared';
import type { CurrencyCode } from '@streamzw/shared';
import { ResourceNotFoundError } from '../auth/errors';

export interface ConvertResult {
  usd: Money;
  fxRate: FxRate;
}

@Injectable()
export class FxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Best FX rate for base→quote at time `at` (§5 resolution order). Caches 5 min.
   *
   * Feeds store rates as USD→X, so a X→USD lookup falls back to the stored USD→X row;
   * `Money.convert` divides when given the reverse pair. The returned rate keeps its stored
   * base/quote so `fx_rate_id` snapshots point at the real row (§3.4).
   */
  async rate(base: CurrencyCode, quote: CurrencyCode, at?: Date): Promise<FxRate> {
    if (base === quote) {
      return { id: 'identity', base, quote, rate: '1.0000000000', source: 'identity' };
    }

    const now = at ?? new Date();
    const cacheKey = `fx:rate:${base}:${quote}:${now.toISOString().slice(0, 13)}`;
    const cached = at ? null : await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as FxRate;

    const row = (await this.findRow(base, quote, now)) ?? (await this.findRow(quote, base, now));
    if (!row) throw new ResourceNotFoundError(`FX rate ${base}→${quote}`);

    const result: FxRate = {
      id: row.id,
      base: row.base as CurrencyCode,
      quote: row.quote as CurrencyCode,
      rate: row.rate,
      source: row.source as FxRate['source'],
    };
    if (!at) await this.redis.setex(cacheKey, 300, JSON.stringify(result));
    return result;
  }

  private async findRow(base: string, quote: string, at: Date) {
    const [row] = await this.db
      .select()
      .from(fxRates)
      .where(
        and(
          eq(fxRates.base, base),
          eq(fxRates.quote, quote),
          lte(fxRates.effectiveFrom, at),
          or(isNull(fxRates.effectiveUntil), gt(fxRates.effectiveUntil, at)),
        ),
      )
      .orderBy(desc(fxRates.sourcePriority), desc(fxRates.fetchedAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * Convert into any currency. Pairs with no direct rate (e.g. ZAR→ZWG) go through USD;
   * `fxRate` is then the leg into the target currency.
   */
  async convert(
    money: Money,
    target: CurrencyCode,
    at?: Date,
  ): Promise<{ converted: Money; fxRate: FxRate }> {
    if (money.currency === target) {
      return { converted: money, fxRate: await this.rate(target, target) };
    }
    try {
      const fxRate = await this.rate(money.currency, target, at);
      return { converted: money.convert(fxRate, target), fxRate };
    } catch (err) {
      if (!(err instanceof ResourceNotFoundError) || money.currency === 'USD' || target === 'USD') {
        throw err;
      }
    }
    const toUsd = await this.rate(money.currency, 'USD', at);
    const fromUsd = await this.rate('USD', target, at);
    return {
      converted: money.convert(toUsd, 'USD').convert(fromUsd, target),
      fxRate: fromUsd,
    };
  }

  async convertToUsd(money: Money, at?: Date): Promise<ConvertResult> {
    const { converted, fxRate } = await this.convert(money, 'USD', at);
    return { usd: converted, fxRate };
  }

  async closeCurrentRates(base: string, quote: string, source: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(fxRates)
      .set({ effectiveUntil: now })
      .where(
        and(
          eq(fxRates.base, base),
          eq(fxRates.quote, quote),
          eq(fxRates.source, source),
          isNull(fxRates.effectiveUntil),
        ),
      );
  }

  async insertRate(params: {
    base: string;
    quote: string;
    rate: string;
    source: string;
    sourcePriority: number;
    notes?: string;
  }): Promise<FxRate> {
    const [row] = await this.db
      .insert(fxRates)
      .values({
        base: params.base,
        quote: params.quote,
        rate: params.rate,
        source: params.source,
        sourcePriority: params.sourcePriority,
        notes: params.notes,
      })
      .returning();
    return {
      id: row!.id,
      base: row!.base as CurrencyCode,
      quote: row!.quote as CurrencyCode,
      rate: row!.rate,
      source: row!.source as FxRate['source'],
    };
  }

  async getCurrentRate(
    base: string,
    quote: string,
  ): Promise<{ rate: string; source: string; effectiveFrom: Date } | null> {
    const [row] = await this.db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.base, base), eq(fxRates.quote, quote), isNull(fxRates.effectiveUntil)))
      .orderBy(desc(fxRates.sourcePriority), desc(fxRates.fetchedAt))
      .limit(1);

    if (!row) return null;
    return { rate: row.rate, source: row.source, effectiveFrom: row.effectiveFrom };
  }
}
