import type { CurrencyCode } from './currency.js';
import type { FxRate } from './fx-rate.js';
/**
 * Bigint-safe money value object.
 *
 * Invariant §3.1: every monetary value is `amount_minor: bigint` + 3-char currency.
 * Invariant §3.2: domain code uses this class, never raw numbers.
 *
 * Rounding mode for `mul`: HALF_UP (commercial rounding). Documented on the method.
 */
export declare class Money {
  readonly amount: bigint;
  readonly currency: CurrencyCode;
  constructor(amount: bigint, currency: CurrencyCode);
  static of(amount: bigint, currency: CurrencyCode): Money;
  static zero(currency: CurrencyCode): Money;
  equals(other: Money): boolean;
  add(other: Money): Money;
  sub(other: Money): Money;
  /**
   * Multiply by a fractional factor with bigint precision.
   *
   * Why: bigint cannot multiply by `number` directly. We scale the factor to a 10^9-precision
   * integer, multiply via bigint, then divide back with half-up rounding. This avoids float
   * drift across chained multiplications (the M10 premium-pool allocation depends on this).
   */
  mul(factor: number): Money;
  /**
   * Convert to USD using a snapshotted FxRate (caller is responsible for storing `rate.id`
   * alongside the resulting amount per invariant §3.4).
   */
  toUsdEquivalent(rate: FxRate): Money;
  format(): string;
  toJSON(): {
    amount_minor: string;
    currency: CurrencyCode;
  };
}
//# sourceMappingURL=money.d.ts.map
