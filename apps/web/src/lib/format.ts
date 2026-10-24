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

/** "1.2K views", YouTube style. Whole numbers under 1,000; one decimal under 10K / 10M. */
export function formatViews(n: number): string {
  if (n === 1) return '1 view';
  if (n < 1000) return `${n} views`;
  const [div, unit] = n < 1_000_000 ? [1000, 'K'] : [1_000_000, 'M'];
  const v = n / div;
  const shown = v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v);
  return `${shown}${unit} views`;
}

/** "3 days ago" from an ISO timestamp, relative to `now`. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const secs = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  const steps: [number, string][] = [
    [60 * 60 * 24 * 365, 'year'],
    [60 * 60 * 24 * 30, 'month'],
    [60 * 60 * 24 * 7, 'week'],
    [60 * 60 * 24, 'day'],
    [60 * 60, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of steps) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

/** Total running time for a course: "2 h 14 min" or "45 min". */
export function formatRunningTime(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
