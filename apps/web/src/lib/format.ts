/**
 * Format minor units for display. Exact (bigint) — no float division — so large
 * balances and odd amounts never pick up rounding drift. Call only at the leaf.
 */
export function formatMoney(amountMinor: number | string | bigint, currency: string): string {
  const value = BigInt(amountMinor.toString());
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / 100n).toLocaleString('en-US');
  const cents = (abs % 100n).toString().padStart(2, '0');
  const n = `${whole}.${cents}`;
  const sign = negative ? '-' : '';
  switch (currency) {
    case 'USD':
      return `${sign}$${n}`;
    case 'ZWG':
      return `${sign}ZWG ${n}`;
    case 'ZAR':
      return `${sign}R ${n}`;
    case 'EUR':
      return `${sign}€${n}`;
    case 'GBP':
      return `${sign}£${n}`;
    default:
      return `${sign}${currency} ${n}`;
  }
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
