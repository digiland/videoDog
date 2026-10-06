import { describe, expect, it } from 'vitest';
import { isE164, newIdempotencyKey, normaliseMsisdn, providerForCurrency } from './payments';

describe('isE164', () => {
  it.each(['+263771234567', '+27821234567', '+14155550123'])('accepts %j', (n) => {
    expect(isE164(n)).toBe(true);
  });
  it.each(['', '263771234567', '0771234567', '+0771234567', '+263 77 123 4567', '+26377'])(
    'rejects %j',
    (n) => {
      expect(isE164(n)).toBe(false);
    },
  );
});

describe('normaliseMsisdn', () => {
  it.each([
    ['0771234567', '+263771234567'],
    ['077 123 4567', '+263771234567'],
    ['263771234567', '+263771234567'],
    ['+263 77-123-4567', '+263771234567'],
    ['+27821234567', '+27821234567'],
  ])('%j → %j', (input, expected) => {
    expect(normaliseMsisdn(input)).toBe(expected);
  });
});

describe('providerForCurrency', () => {
  it('maps each currency to its EcoCash rail', () => {
    expect(providerForCurrency('USD')).toBe('ecocash_usd');
    expect(providerForCurrency('ZWG')).toBe('ecocash_zwg');
    expect(providerForCurrency('ZAR')).toBeNull();
  });
});

describe('newIdempotencyKey', () => {
  it('generates distinct keys', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });
});
