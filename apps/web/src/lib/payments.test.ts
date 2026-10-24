import { describe, expect, it, vi } from 'vitest';
import {
  clearPendingCardPayment,
  isE164,
  isSafeRedirectUrl,
  methodsFor,
  newIdempotencyKey,
  normaliseMsisdn,
  providerFor,
  readPendingCardPayment,
  stashPendingCardPayment,
} from './payments';

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

describe('providerFor / methodsFor', () => {
  it('maps EcoCash to its per-currency wallet', () => {
    expect(providerFor('USD', 'ecocash')).toBe('ecocash_usd');
    expect(providerFor('ZWG', 'ecocash')).toBe('ecocash_zwg');
    expect(providerFor('ZAR', 'ecocash')).toBeNull();
  });

  it('routes cards through Paystack for USD and ZAR only', () => {
    expect(providerFor('USD', 'card')).toBe('paystack');
    expect(providerFor('ZAR', 'card')).toBe('paystack');
    expect(providerFor('ZWG', 'card')).toBeNull();
  });

  it('lists the methods per currency', () => {
    expect(methodsFor('USD')).toEqual(['ecocash', 'card']);
    expect(methodsFor('ZWG')).toEqual(['ecocash']);
    expect(methodsFor('ZAR')).toEqual(['card']);
  });
});

describe('isSafeRedirectUrl', () => {
  it.each([
    'https://checkout.paystack.com/abc',
    'http://localhost:3000/checkout/return?reference=x',
  ])('accepts %j', (u) => {
    expect(isSafeRedirectUrl(u)).toBe(true);
  });
  it.each(['javascript:alert(1)', 'data:text/html,hi', '/relative', '', undefined, null])(
    'rejects %j',
    (u) => {
      expect(isSafeRedirectUrl(u)).toBe(false);
    },
  );
});

describe('newIdempotencyKey', () => {
  it('generates distinct keys', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });
});

describe('pending card payment stash', () => {
  const pending = { payment_id: 'p1', return_path: '/v/abc', retry_path: '/purchase/abc' };

  it('degrades gracefully when sessionStorage is unavailable', () => {
    // The vitest node environment has no sessionStorage — like blocked storage in a browser.
    expect(stashPendingCardPayment(pending)).toBe(false);
    expect(readPendingCardPayment()).toBeNull();
    expect(() => clearPendingCardPayment()).not.toThrow();
  });

  it('round-trips and validates through sessionStorage', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal('sessionStorage', fake);
    try {
      expect(stashPendingCardPayment(pending)).toBe(true);
      expect(readPendingCardPayment()).toEqual(pending);
      store.set('streamzw:pending-card-payment', '{"payment_id":1}');
      expect(readPendingCardPayment()).toBeNull();
      store.set('streamzw:pending-card-payment', 'not json');
      expect(readPendingCardPayment()).toBeNull();
      clearPendingCardPayment();
      expect(store.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
