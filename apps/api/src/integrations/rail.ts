import type { CurrencyCode } from '@streamzw/shared';

export type ProviderStatus = 'pending' | 'completed' | 'failed';

export interface ChargeParams {
  msisdn: string; // E.164 payer phone
  amountMinor: bigint;
  currency: CurrencyCode;
  reference: string; // our idempotency_key
  description?: string;
  /** Card rails need an email; we synthesise one from the user id when none exists. */
  email?: string;
}

export interface ChargeResult {
  provider_ref: string;
  status: ProviderStatus;
  /** Hosted checkout page (card rails). Absent for push-to-phone rails like EcoCash. */
  redirect_url?: string;
}

/** A payment rail the checkout can charge through. */
export interface PaymentRail {
  readonly currencies: readonly CurrencyCode[];
  createCharge(params: ChargeParams): Promise<ChargeResult>;
  /** Provider's view of a charge (§3.12). `null` = can't tell (dev / unknown). */
  getStatus(reference: string): Promise<ProviderStatus | null>;
}

/** 1234n → "12.34": exact, for provider APIs that take decimal amounts. Never via floats. */
export function minorToDecimalString(minor: bigint, decimals = 2): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}
