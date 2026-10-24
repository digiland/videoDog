import type { PaymentCurrency, PaymentMethod } from '../../../src/lib/payments';
import { providerFor } from '../../../src/lib/payments';

/** One way to pay: a currency and a rail together, so choosing it is one tap. */
export type PayOption = `${PaymentMethod}:${PaymentCurrency}`;

export const PAY_OPTIONS: readonly PayOption[] = [
  'ecocash:USD',
  'ecocash:ZWG',
  'card:USD',
  'card:ZAR',
];

export function splitOption(o: PayOption): { method: PaymentMethod; currency: PaymentCurrency } {
  const [method, currency] = o.split(':') as [PaymentMethod, PaymentCurrency];
  return { method, currency };
}

export function optionLabel(o: PayOption): string {
  const { method, currency } = splitOption(o);
  return `${method === 'ecocash' ? 'EcoCash' : 'Card'} ${currency}`;
}

function isPayOption(v: unknown): v is PayOption {
  return typeof v === 'string' && (PAY_OPTIONS as readonly string[]).includes(v);
}

/** Default option for a currency: EcoCash where it exists (most viewers), else card. */
export function optionFor(currency: string | null | undefined): PayOption | null {
  if (currency === 'USD' || currency === 'ZWG' || currency === 'ZAR') {
    const method: PaymentMethod = providerFor(currency, 'ecocash') ? 'ecocash' : 'card';
    return `${method}:${currency}`;
  }
  return null;
}

const KEY = 'streamzw:pay-option';

/** The way this viewer paid last time, so the next checkout is already set. */
export function readLastOption(): PayOption | null {
  try {
    const v = localStorage.getItem(KEY);
    return isPayOption(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberOption(o: PayOption): void {
  try {
    localStorage.setItem(KEY, o);
  } catch {
    // storage blocked: they pick again next time
  }
}
