import type { MoneyJson } from './price';

/**
 * Paywall decision helpers (viewer surfaces). Pure and bigint-only: prices are compared in
 * minor units of one currency, never converted or turned into floats (CLAUDE.md §3).
 */

/** A plan quote as the paywall payload sends it. The API keys plans by `plan_id`. */
export type PlanQuoteJson = {
  id?: string;
  plan_id?: string;
  code: string;
  duration_days?: number;
  price: MoneyJson;
  display_price?: MoneyJson;
};

/** "day", "week", "month", or "30 days": what one plan period is called. */
export function planPeriod(plan: PlanQuoteJson): string {
  const byCode: Record<string, string> = {
    day_pass: 'day',
    day: 'day',
    week: 'week',
    month: 'month',
  };
  const named = byCode[plan.code];
  if (named) return named;
  const d = plan.duration_days;
  if (d === 1) return 'day';
  if (d === 7) return 'week';
  if (d !== undefined && d >= 28 && d <= 31) return 'month';
  if (d !== undefined) return `${d} days`;
  return plan.code.replace(/_/g, ' ');
}

/** -1 / 0 / 1 when both are in the same currency; null when they can't be compared. */
export function compareMoney(a: MoneyJson, b: MoneyJson): -1 | 0 | 1 | null {
  if (a.currency !== b.currency) return null;
  const x = BigInt(a.amount_minor);
  const y = BigInt(b.amount_minor);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Cheapest plan by charged price (ties keep API order). */
export function cheapestPlan(plans: PlanQuoteJson[]): PlanQuoteJson | null {
  let best: PlanQuoteJson | null = null;
  for (const p of plans) {
    if (!best) {
      best = p;
      continue;
    }
    const c = compareMoney(p.price, best.price);
    if (c === -1) best = p;
  }
  return best;
}

/**
 * Which option gets the big primary button: the cheaper way in. Compared in the charged
 * currency, else in the display currency when both have a render-only quote; if neither
 * works, buying this one video wins (the smaller commitment).
 */
export function primaryOption(
  buy: { price: MoneyJson; display_price?: MoneyJson } | undefined,
  plan: PlanQuoteJson | null,
): 'buy' | 'subscribe' | null {
  if (!buy && !plan) return null;
  if (!buy) return 'subscribe';
  if (!plan) return 'buy';
  let c = compareMoney(plan.price, buy.price);
  if (c === null && plan.display_price && buy.display_price) {
    c = compareMoney(plan.display_price, buy.display_price);
  }
  return c === -1 ? 'subscribe' : 'buy';
}
