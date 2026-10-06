import { describe, expect, it } from 'vitest';
import { formatMoney } from './format';

describe('formatMoney', () => {
  it.each([
    ['149', 'USD', '$1.49'],
    [5n, 'USD', '$0.05'],
    [0, 'USD', '$0.00'],
    ['2680', 'ZWG', 'ZWG 26.80'],
    ['10000', 'ZAR', 'R 100.00'],
    ['123456789', 'USD', '$1,234,567.89'],
    ['9007199254740993', 'USD', '$90,071,992,547,409.93'],
    ['-250', 'USD', '-$2.50'],
    ['100', 'XYZ', 'XYZ 1.00'],
  ] as const)('formats %s %s → %j', (minor, currency, expected) => {
    expect(formatMoney(minor, currency)).toBe(expected);
  });
});
