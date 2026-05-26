import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError } from './errors.js';
import type { FxRate } from './fx-rate.js';
import { Money } from './money.js';

describe('Money', () => {
  describe('construction', () => {
    it('requires bigint amount', () => {
      // @ts-expect-error - testing runtime guard
      expect(() => new Money(100, 'USD')).toThrow(TypeError);
    });

    it('stores amount and currency', () => {
      const m = Money.of(149n, 'USD');
      expect(m.amount).toBe(149n);
      expect(m.currency).toBe('USD');
    });

    it('zero returns Money(0n, ccy)', () => {
      expect(Money.zero('ZWG').amount).toBe(0n);
      expect(Money.zero('ZWG').currency).toBe('ZWG');
    });
  });

  describe('add / sub', () => {
    it('adds same-currency', () => {
      expect(Money.of(100n, 'USD').add(Money.of(50n, 'USD')).amount).toBe(150n);
    });

    it('subtracts same-currency', () => {
      expect(Money.of(100n, 'USD').sub(Money.of(30n, 'USD')).amount).toBe(70n);
    });

    it('throws on currency mismatch in add', () => {
      expect(() => Money.of(1n, 'USD').add(Money.of(1n, 'ZWG'))).toThrow(CurrencyMismatchError);
    });

    it('throws on currency mismatch in sub', () => {
      expect(() => Money.of(1n, 'USD').sub(Money.of(1n, 'ZWG'))).toThrow(CurrencyMismatchError);
    });

    it('handles negatives', () => {
      expect(Money.of(50n, 'USD').sub(Money.of(100n, 'USD')).amount).toBe(-50n);
    });

    it('handles bigint values above Number.MAX_SAFE_INTEGER', () => {
      const big = 99999999999999999999n;
      expect(Money.of(big, 'USD').add(Money.of(1n, 'USD')).amount).toBe(big + 1n);
    });
  });

  describe('mul', () => {
    it('multiplies by integer', () => {
      expect(Money.of(100n, 'USD').mul(3).amount).toBe(300n);
    });

    it('multiplies by fraction with half-up rounding', () => {
      expect(Money.of(100n, 'USD').mul(0.5).amount).toBe(50n);
      // 100 * 1/3 = 33.333... → 33
      expect(Money.of(100n, 'USD').mul(1 / 3).amount).toBe(33n);
      // 100 * 2/3 = 66.666... → 67 (half-up at .666)
      expect(Money.of(100n, 'USD').mul(2 / 3).amount).toBe(67n);
    });

    it('handles negative amounts', () => {
      expect(Money.of(-100n, 'USD').mul(0.7).amount).toBe(-70n);
    });

    it('chained mul has no float drift', () => {
      let m = Money.of(1_000_000n, 'USD');
      for (let i = 0; i < 100; i++) m = m.mul(0.99);
      // 1_000_000 * 0.99^100 ≈ 366,032
      expect(m.amount).toBeGreaterThan(365_900n);
      expect(m.amount).toBeLessThan(366_200n);
    });

    it('preserves currency', () => {
      expect(Money.of(100n, 'ZWG').mul(2).currency).toBe('ZWG');
    });

    it('throws on non-finite factor', () => {
      expect(() => Money.of(1n, 'USD').mul(Infinity)).toThrow(RangeError);
      expect(() => Money.of(1n, 'USD').mul(NaN)).toThrow(RangeError);
    });
  });

  describe('format', () => {
    it('formats USD', () => {
      expect(Money.of(149n, 'USD').format()).toBe('$1.49');
    });

    it('formats ZWG', () => {
      expect(Money.of(4470n, 'ZWG').format()).toBe('ZWG 44.70');
    });

    it('formats ZAR', () => {
      expect(Money.of(2780n, 'ZAR').format()).toBe('R 27.80');
    });

    it('formats EUR', () => {
      expect(Money.of(149n, 'EUR').format()).toBe('€1.49');
    });

    it('formats GBP', () => {
      expect(Money.of(149n, 'GBP').format()).toBe('£1.49');
    });

    it('renders thousands separator', () => {
      expect(Money.of(123456n, 'USD').format()).toBe('$1,234.56');
    });
  });

  describe('toUsdEquivalent', () => {
    it('identity for USD regardless of rate', () => {
      const rate: FxRate = {
        id: 'r',
        base: 'USD',
        quote: 'USD',
        rate: '1',
        source: 'identity',
      };
      const m = Money.of(149n, 'USD');
      expect(m.toUsdEquivalent(rate).equals(m)).toBe(true);
    });

    it('converts ZWG to USD via rate stored as USD->ZWG', () => {
      // 1485 ZWG cents at 29.70 ZWG/USD → 50 USD cents
      const rate: FxRate = {
        id: 'r1',
        base: 'USD',
        quote: 'ZWG',
        rate: '29.70',
        source: 'rbz',
      };
      const usd = Money.of(1485n, 'ZWG').toUsdEquivalent(rate);
      expect(usd.currency).toBe('USD');
      expect(usd.amount).toBe(50n);
    });

    it('converts via rate stored as ZWG->USD', () => {
      const rate: FxRate = {
        id: 'r2',
        base: 'ZWG',
        quote: 'USD',
        rate: '0.0336700336',
        source: 'manual',
      };
      const usd = Money.of(1485n, 'ZWG').toUsdEquivalent(rate);
      expect(usd.currency).toBe('USD');
      expect(usd.amount).toBe(50n);
    });

    it('throws on incompatible pair', () => {
      const rate: FxRate = {
        id: 'r',
        base: 'USD',
        quote: 'ZWG',
        rate: '29.70',
        source: 'rbz',
      };
      expect(() => Money.of(100n, 'EUR').toUsdEquivalent(rate)).toThrow();
    });
  });

  describe('toJSON', () => {
    it('serializes amount as string to avoid bigint-in-JSON issues', () => {
      const json = JSON.stringify(Money.of(999n, 'USD'));
      expect(JSON.parse(json)).toEqual({ amount_minor: '999', currency: 'USD' });
    });
  });
});
