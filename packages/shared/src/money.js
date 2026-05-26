'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.Money = void 0;
const errors_js_1 = require('./errors.js');
/**
 * Bigint-safe money value object.
 *
 * Invariant §3.1: every monetary value is `amount_minor: bigint` + 3-char currency.
 * Invariant §3.2: domain code uses this class, never raw numbers.
 *
 * Rounding mode for `mul`: HALF_UP (commercial rounding). Documented on the method.
 */
class Money {
  constructor(amount, currency) {
    if (typeof amount !== 'bigint') {
      throw new TypeError(`Money.amount must be bigint, got ${typeof amount}`);
    }
    this.amount = amount;
    this.currency = currency;
  }
  static of(amount, currency) {
    return new Money(amount, currency);
  }
  static zero(currency) {
    return new Money(0n, currency);
  }
  equals(other) {
    return this.currency === other.currency && this.amount === other.amount;
  }
  add(other) {
    if (this.currency !== other.currency) {
      throw new errors_js_1.CurrencyMismatchError(this.currency, other.currency);
    }
    return new Money(this.amount + other.amount, this.currency);
  }
  sub(other) {
    if (this.currency !== other.currency) {
      throw new errors_js_1.CurrencyMismatchError(this.currency, other.currency);
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
  mul(factor) {
    if (!Number.isFinite(factor)) {
      throw new RangeError(`Money.mul factor must be finite, got ${factor}`);
    }
    const SCALE = 1000000000n; // 10^9
    const scaled = BigInt(Math.round(factor * 1e9));
    const product = this.amount * scaled;
    const halved = SCALE / 2n;
    const rounded = product >= 0n ? (product + halved) / SCALE : -((-product + halved) / SCALE);
    return new Money(rounded, this.currency);
  }
  /**
   * Convert to USD using a snapshotted FxRate (caller is responsible for storing `rate.id`
   * alongside the resulting amount per invariant §3.4).
   */
  toUsdEquivalent(rate) {
    if (this.currency === 'USD') return new Money(this.amount, 'USD');
    let factor;
    if (rate.base === this.currency && rate.quote === 'USD') {
      factor = parseFloat(rate.rate);
    } else if (rate.base === 'USD' && rate.quote === this.currency) {
      const r = parseFloat(rate.rate);
      if (r === 0) throw new RangeError('FxRate.rate cannot be zero');
      factor = 1 / r;
    } else {
      throw new Error(`FxRate ${rate.base}->${rate.quote} cannot convert ${this.currency} to USD`);
    }
    const SCALE = 1000000000n;
    const scaled = BigInt(Math.round(factor * 1e9));
    const product = this.amount * scaled;
    const halved = SCALE / 2n;
    const rounded = product >= 0n ? (product + halved) / SCALE : -((-product + halved) / SCALE);
    return new Money(rounded, 'USD');
  }
  format() {
    const major = Number(this.amount) / 100;
    const fmt = (n) =>
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
  toJSON() {
    return { amount_minor: this.amount.toString(), currency: this.currency };
  }
}
exports.Money = Money;
//# sourceMappingURL=money.js.map
