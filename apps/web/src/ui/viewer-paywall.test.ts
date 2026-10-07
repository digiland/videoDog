import { describe, expect, it } from 'vitest';
import { cheapestPlan, compareMoney, planPeriod, primaryOption } from './viewer-paywall';

const usd = (n: string) => ({ amount_minor: n, currency: 'USD' });
const zwg = (n: string) => ({ amount_minor: n, currency: 'ZWG' });

describe('viewer paywall helpers', () => {
  it('compares money only within one currency', () => {
    expect(compareMoney(usd('99'), usd('100'))).toBe(-1);
    expect(compareMoney(usd('100'), usd('100'))).toBe(0);
    expect(compareMoney(usd('9007199254740993'), usd('9007199254740992'))).toBe(1);
    expect(compareMoney(usd('1'), zwg('1'))).toBeNull();
  });

  it('names plan periods', () => {
    expect(planPeriod({ code: 'day_pass', price: usd('99') })).toBe('day');
    expect(planPeriod({ code: 'x', duration_days: 30, price: usd('99') })).toBe('month');
    expect(planPeriod({ code: 'x', duration_days: 90, price: usd('99') })).toBe('90 days');
  });

  it('finds the cheapest plan', () => {
    const plans = [
      { code: 'month', price: usd('149') },
      { code: 'day_pass', price: usd('99') },
      { code: 'week', price: usd('119') },
    ];
    expect(cheapestPlan(plans)?.code).toBe('day_pass');
    expect(cheapestPlan([])).toBeNull();
  });

  it('makes the cheaper path primary', () => {
    const day = { code: 'day_pass', price: usd('99') };
    expect(primaryOption({ price: usd('100') }, day)).toBe('subscribe');
    expect(primaryOption({ price: usd('50') }, day)).toBe('buy');
    expect(primaryOption({ price: usd('99') }, day)).toBe('buy');
    expect(primaryOption(undefined, day)).toBe('subscribe');
    expect(primaryOption({ price: usd('50') }, null)).toBe('buy');
    // Different charged currencies: fall back to the display quote, else buy.
    expect(primaryOption({ price: zwg('2600') }, day)).toBe('buy');
    expect(
      primaryOption(
        { price: zwg('5000'), display_price: usd('190') },
        { ...day, display_price: usd('99') },
      ),
    ).toBe('subscribe');
  });
});
