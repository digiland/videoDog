/** Helpers shared by the EcoCash checkout flow. */

export type PaymentCurrency = 'USD' | 'ZWG' | 'ZAR';
export type EcoCashProvider = 'ecocash_usd' | 'ecocash_zwg';

/** E.164: "+", country code (non-zero first digit), 8–15 digits total. */
export function isE164(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(input);
}

/**
 * Normalise what people type for an EcoCash number into E.164 where it is
 * unambiguous: strips spaces/dashes/brackets and expands a local Zimbabwe
 * number ("0771234567") to "+263771234567". Returns the cleaned string even if
 * it is still invalid, so the caller can validate it with `isE164`.
 */
export function normaliseMsisdn(input: string): string {
  const cleaned = input.replace(/[\s\-()]/g, '');
  if (/^07\d{8}$/.test(cleaned)) return `+263${cleaned.slice(1)}`;
  if (/^2637\d{8}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

/** EcoCash rails are per currency. ZAR has no live rail yet. */
export function providerForCurrency(currency: PaymentCurrency): EcoCashProvider | null {
  switch (currency) {
    case 'USD':
      return 'ecocash_usd';
    case 'ZWG':
      return 'ecocash_zwg';
    default:
      return null;
  }
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (plain-http LAN testing), where randomUUID is absent.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
