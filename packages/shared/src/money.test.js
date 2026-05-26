'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const vitest_1 = require('vitest');
const errors_js_1 = require('./errors.js');
const money_js_1 = require('./money.js');
(0, vitest_1.describe)('Money', () => {
  (0, vitest_1.describe)('construction', () => {
    (0, vitest_1.it)('requires bigint amount', () => {
      // @ts-expect-error - testing runtime guard
      (0, vitest_1.expect)(() => new money_js_1.Money(100, 'USD')).toThrow(TypeError);
    });
    (0, vitest_1.it)('stores amount and currency', () => {
      const m = money_js_1.Money.of(149n, 'USD');
      (0, vitest_1.expect)(m.amount).toBe(149n);
      (0, vitest_1.expect)(m.currency).toBe('USD');
    });
    (0, vitest_1.it)('zero returns Money(0n, ccy)', () => {
      (0, vitest_1.expect)(money_js_1.Money.zero('ZWG').amount).toBe(0n);
      (0, vitest_1.expect)(money_js_1.Money.zero('ZWG').currency).toBe('ZWG');
    });
  });
  (0, vitest_1.describe)('add / sub', () => {
    (0, vitest_1.it)('adds same-currency', () => {
      (0, vitest_1.expect)(
        money_js_1.Money.of(100n, 'USD').add(money_js_1.Money.of(50n, 'USD')).amount,
      ).toBe(150n);
    });
    (0, vitest_1.it)('subtracts same-currency', () => {
      (0, vitest_1.expect)(
        money_js_1.Money.of(100n, 'USD').sub(money_js_1.Money.of(30n, 'USD')).amount,
      ).toBe(70n);
    });
    (0, vitest_1.it)('throws on currency mismatch in add', () => {
      (0, vitest_1.expect)(() =>
        money_js_1.Money.of(1n, 'USD').add(money_js_1.Money.of(1n, 'ZWG')),
      ).toThrow(errors_js_1.CurrencyMismatchError);
    });
    (0, vitest_1.it)('throws on currency mismatch in sub', () => {
      (0, vitest_1.expect)(() =>
        money_js_1.Money.of(1n, 'USD').sub(money_js_1.Money.of(1n, 'ZWG')),
      ).toThrow(errors_js_1.CurrencyMismatchError);
    });
    (0, vitest_1.it)('handles negatives', () => {
      (0, vitest_1.expect)(
        money_js_1.Money.of(50n, 'USD').sub(money_js_1.Money.of(100n, 'USD')).amount,
      ).toBe(-50n);
    });
    (0, vitest_1.it)('handles bigint values above Number.MAX_SAFE_INTEGER', () => {
      const big = 99999999999999999999n;
      (0, vitest_1.expect)(
        money_js_1.Money.of(big, 'USD').add(money_js_1.Money.of(1n, 'USD')).amount,
      ).toBe(big + 1n);
    });
  });
  (0, vitest_1.describe)('mul', () => {
    (0, vitest_1.it)('multiplies by integer', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(100n, 'USD').mul(3).amount).toBe(300n);
    });
    (0, vitest_1.it)('multiplies by fraction with half-up rounding', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(100n, 'USD').mul(0.5).amount).toBe(50n);
      // 100 * 1/3 = 33.333... → 33
      (0, vitest_1.expect)(money_js_1.Money.of(100n, 'USD').mul(1 / 3).amount).toBe(33n);
      // 100 * 2/3 = 66.666... → 67 (half-up at .666)
      (0, vitest_1.expect)(money_js_1.Money.of(100n, 'USD').mul(2 / 3).amount).toBe(67n);
    });
    (0, vitest_1.it)('handles negative amounts', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(-100n, 'USD').mul(0.7).amount).toBe(-70n);
    });
    (0, vitest_1.it)('chained mul has no float drift', () => {
      let m = money_js_1.Money.of(1000000n, 'USD');
      for (let i = 0; i < 100; i++) m = m.mul(0.99);
      // 1_000_000 * 0.99^100 ≈ 366,032
      (0, vitest_1.expect)(m.amount).toBeGreaterThan(365900n);
      (0, vitest_1.expect)(m.amount).toBeLessThan(366200n);
    });
    (0, vitest_1.it)('preserves currency', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(100n, 'ZWG').mul(2).currency).toBe('ZWG');
    });
    (0, vitest_1.it)('throws on non-finite factor', () => {
      (0, vitest_1.expect)(() => money_js_1.Money.of(1n, 'USD').mul(Infinity)).toThrow(RangeError);
      (0, vitest_1.expect)(() => money_js_1.Money.of(1n, 'USD').mul(NaN)).toThrow(RangeError);
    });
  });
  (0, vitest_1.describe)('format', () => {
    (0, vitest_1.it)('formats USD', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(149n, 'USD').format()).toBe('$1.49');
    });
    (0, vitest_1.it)('formats ZWG', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(4470n, 'ZWG').format()).toBe('ZWG 44.70');
    });
    (0, vitest_1.it)('formats ZAR', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(2780n, 'ZAR').format()).toBe('R 27.80');
    });
    (0, vitest_1.it)('formats EUR', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(149n, 'EUR').format()).toBe('€1.49');
    });
    (0, vitest_1.it)('formats GBP', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(149n, 'GBP').format()).toBe('£1.49');
    });
    (0, vitest_1.it)('renders thousands separator', () => {
      (0, vitest_1.expect)(money_js_1.Money.of(123456n, 'USD').format()).toBe('$1,234.56');
    });
  });
  (0, vitest_1.describe)('toUsdEquivalent', () => {
    (0, vitest_1.it)('identity for USD regardless of rate', () => {
      const rate = {
        id: 'r',
        base: 'USD',
        quote: 'USD',
        rate: '1',
        source: 'identity',
      };
      const m = money_js_1.Money.of(149n, 'USD');
      (0, vitest_1.expect)(m.toUsdEquivalent(rate).equals(m)).toBe(true);
    });
    (0, vitest_1.it)('converts ZWG to USD via rate stored as USD->ZWG', () => {
      // 1485 ZWG cents at 29.70 ZWG/USD → 50 USD cents
      const rate = {
        id: 'r1',
        base: 'USD',
        quote: 'ZWG',
        rate: '29.70',
        source: 'rbz',
      };
      const usd = money_js_1.Money.of(1485n, 'ZWG').toUsdEquivalent(rate);
      (0, vitest_1.expect)(usd.currency).toBe('USD');
      (0, vitest_1.expect)(usd.amount).toBe(50n);
    });
    (0, vitest_1.it)('converts via rate stored as ZWG->USD', () => {
      const rate = {
        id: 'r2',
        base: 'ZWG',
        quote: 'USD',
        rate: '0.0336700336',
        source: 'manual',
      };
      const usd = money_js_1.Money.of(1485n, 'ZWG').toUsdEquivalent(rate);
      (0, vitest_1.expect)(usd.currency).toBe('USD');
      (0, vitest_1.expect)(usd.amount).toBe(50n);
    });
    (0, vitest_1.it)('throws on incompatible pair', () => {
      const rate = {
        id: 'r',
        base: 'USD',
        quote: 'ZWG',
        rate: '29.70',
        source: 'rbz',
      };
      (0, vitest_1.expect)(() => money_js_1.Money.of(100n, 'EUR').toUsdEquivalent(rate)).toThrow();
    });
  });
  (0, vitest_1.describe)('toJSON', () => {
    (0, vitest_1.it)('serializes amount as string to avoid bigint-in-JSON issues', () => {
      const json = JSON.stringify(money_js_1.Money.of(999n, 'USD'));
      (0, vitest_1.expect)(JSON.parse(json)).toEqual({ amount_minor: '999', currency: 'USD' });
    });
  });
});
//# sourceMappingURL=money.test.js.map
