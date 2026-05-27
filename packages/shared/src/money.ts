import type { CurrencyCode } from './currency.js';
import { CurrencyMismatchError } from './errors.js';
import type { FxRate } from './fx-rate.js';

/**
 * Bigint-safe money value object.
 *
 * Invariant §3.1: every monetary value is `amount_minor: bigint` + 3-char currency.
 * Invariant §3.2: domain code uses this class, never raw numbers.
 *
 * Rounding mode for `mul`: HALF_UP (commercial rounding). Documented on the method.
 */
export class Money {
  readonly amount: bigint;
  readonly currency: CurrencyCode;

  constructor(amount: bigint, currency: CurrencyCode) {
    if (typeof amount !== 'bigint') {
      throw new TypeError(`Money.amount must be bigint, got ${typeof amount}`);
    }
    this.amount = amount;
    this.currency = currency;
  }

  static of(amount: bigint, currency: CurrencyCode): Money {
    return new Money(amount, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
    return new Money(this.amount + other.amount, this.currency);
  }

  sub(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
    return new Money(this.amount - other.amount, this.currency);
  }

  /**
   * Multiply by a fractional factor with bigint precision.
   *
   * Why: bigint cannot multiply by `number` directly. We scale the factor to a 10^9-precision
   * integer, multiply via bigint, then divide back with half-up rounding. This avoids float
   * drift across chained multiplications (the M10 premium-pool allocation depends on this).
   */
  mul(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new RangeError(`Money.mul factor must be finite, got ${factor}`);
    }
    const SCALE = 1_000_000_000n; // 10^9
    const scaled = BigInt(Math.round(factor * 1e9));
    const product = this.amount * scaled;
    const halved = SCALE / 2n;
    const rounded = product >= 0n ? (product + halved) / SCALE : -((-product + halved) / SCALE);
    return new Money(rounded, this.currency);
  }

  /**
   * Convert currency using a snapshotted FxRate with bigint precision.
   * Eliminates float math on money (Invariant §3.1, §3.2).
   */
  convert(rate: FxRate, targetCurrency: CurrencyCode): Money {
    if (this.currency === targetCurrency) return new Money(this.amount, targetCurrency);

    const SCALE = 10_000_000_000n; // 10^10 for Postgres numeric(20,10)
    const rateVal = parseRateToBigInt(rate.rate);

    if (rate.base === this.currency && rate.quote === targetCurrency) {
      // Multiply: target = source * rate
      const product = this.amount * rateVal;
      const halved = SCALE / 2n;
      const rounded = product >= 0n ? (product + halved) / SCALE : -((-product + halved) / SCALE);
      return new Money(rounded, targetCurrency);
    } else if (rate.base === targetCurrency && rate.quote === this.currency) {
      // Divide: target = source / rate
      if (rateVal === 0n) throw new RangeError('FxRate.rate cannot be zero');
      const numerator = this.amount * SCALE;
      const halved = rateVal / 2n;
      const rounded =
        numerator >= 0n ? (numerator + halved) / rateVal : -((-numerator + halved) / rateVal);
      return new Money(rounded, targetCurrency);
    } else {
      throw new Error(
        `FxRate ${rate.base}->${rate.quote} cannot convert ${this.currency} to ${targetCurrency}`,
      );
    }
  }

  /**
   * Convert to USD using a snapshotted FxRate (caller is responsible for storing `rate.id`
   * alongside the resulting amount per invariant §3.4).
   */
  toUsdEquivalent(rate: FxRate): Money {
    return this.convert(rate, 'USD');
  }

  format(): string {
    const major = Number(this.amount) / 100;
    const fmt = (n: number): string =>
      n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    switch (this.currency) {
      case 'USD':
        return `$${fmt(major)}`;
      case 'ZWG':
        return `ZWG ${fmt(major)}`;
      case 'ZAR':
        return `R ${fmt(major)}`;
      case 'EUR':
        return `€${fmt(major)}`;
      case 'GBP':
        return `£${fmt(major)}`;
    }
  }

  toJSON(): { amount_minor: string; currency: CurrencyCode } {
    return { amount_minor: this.amount.toString(), currency: this.currency };
  }
}

function parseRateToBigInt(rateStr: string): bigint {
  const parts = rateStr.split('.');
  const integerPart = parts[0] || '0';
  let fractionalPart = parts[1] || '';
  fractionalPart = fractionalPart.padEnd(10, '0').slice(0, 10);
  return BigInt(integerPart + fractionalPart);
}
