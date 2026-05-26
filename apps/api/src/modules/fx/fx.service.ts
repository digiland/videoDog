import { Inject, Injectable, Logger } from '@nestjs/common';
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

  /** Get the best FX rate for base→quote at time `at`. Caches 5 min. */
  async rate(base: CurrencyCode, quote: CurrencyCode, at?: Date): Promise<FxRate> {
    if (base === quote) {
      return {
        id: 'identity',
        base,
        quote,
        rate: '1.0000000000',
        source: 'identity',
      };
    }

    const now = at ?? new Date();
    const cacheKey = `fx:rate:${base}:${quote}:${now.toISOString().slice(0, 10)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as FxRate;
    }

    const [row] = await this.db
      .select()
      .from(fxRates)
      .where(
        and(
          eq(fxRates.base, base),
          eq(fxRates.quote, quote),
          lte(fxRates.effectiveFrom, now),
          or(isNull(fxRates.effectiveUntil), gt(fxRates.effectiveUntil, now)),
        ),
      )
      .orderBy(desc(fxRates.sourcePriority), desc(fxRates.fetchedAt))
      .limit(1);

    if (!row) throw new ResourceNotFoundError(`FX rate ${base}→${quote}`);

    const result: FxRate = {
      id: row.id,
      base: row.base as CurrencyCode,
      quote: row.quote as CurrencyCode,
      rate: row.rate,
      source: row.source as FxRate['source'],
    };

    await this.redis.setex(cacheKey, 300, JSON.stringify(result));
    return result;
  }

  async convertToUsd(money: Money, at?: Date): Promise<ConvertResult> {
    if (money.currency === 'USD') {
      const identityRate: FxRate = {
        id: 'identity',
        base: 'USD',
        quote: 'USD',
        rate: '1.0000000000',
        source: 'identity',
      };
      return { usd: money, fxRate: identityRate };
    }
    const fxRate = await this.rate(money.currency, 'USD', at);
    const usd = money.toUsdEquivalent(fxRate);
    return { usd, fxRate };
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
