/** Helpers shared by the EcoCash checkout flow. */

export type PaymentCurrency = 'USD' | 'ZWG' | 'ZAR';
export type PaymentProvider = 'ecocash_usd' | 'ecocash_zwg' | 'paystack';
/** How the viewer pays: EcoCash mobile money, or a card via Paystack (diaspora). */
export type PaymentMethod = 'ecocash' | 'card';

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

/**
 * Rails per currency: EcoCash is per currency (USD / ZWG wallets); Paystack cards charge
 * USD and ZAR. ZWG is EcoCash-only and ZAR is card-only.
 */
export function providerFor(
  currency: PaymentCurrency,
  method: PaymentMethod,
): PaymentProvider | null {
  if (method === 'card') return currency === 'USD' || currency === 'ZAR' ? 'paystack' : null;
  switch (currency) {
    case 'USD':
      return 'ecocash_usd';
    case 'ZWG':
      return 'ecocash_zwg';
    default:
      return null;
  }
}

/** Payment methods available for a currency, in display order. */
export function methodsFor(currency: PaymentCurrency): PaymentMethod[] {
  return (['ecocash', 'card'] as const).filter((m) => providerFor(currency, m) !== null);
}

/** Only http(s) URLs are followed for card checkout redirects. */
export function isSafeRedirectUrl(raw: string | undefined | null): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ── Pending card payment (survives the round trip to Paystack) ─────────────────

const PENDING_CARD_KEY = 'streamzw:pending-card-payment';

export interface PendingCardPayment {
  payment_id: string;
  /** Where to go once the payment completes (same-origin path). */
  return_path: string;
  /** Where to go to try again if it fails (the checkout page). */
  retry_path: string;
}

function isPendingCardPayment(v: unknown): v is PendingCardPayment {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.payment_id === 'string' &&
    typeof o.return_path === 'string' &&
    typeof o.retry_path === 'string'
  );
}

/** Best-effort: sessionStorage can be unavailable (private mode, blocked storage). */
export function stashPendingCardPayment(p: PendingCardPayment): boolean {
  try {
    sessionStorage.setItem(PENDING_CARD_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function readPendingCardPayment(): PendingCardPayment | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CARD_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingCardPayment(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingCardPayment(): void {
  try {
    sessionStorage.removeItem(PENDING_CARD_KEY);
  } catch {
    // ignore
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
