import { api } from '../../../src/lib/api';
import type { MoneyDTO } from '../../../src/types/api';

/** The viewer's live subscription, normalised from GET /subscriptions/me. */
export interface CurrentSubscription {
  id: string;
  planId: string | null;
  expiresAt: string;
  autoRenew: boolean;
  charged: MoneyDTO | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null;
}

/** GET /subscriptions/me returns the active subscription (snake_case) or an empty body. */
export function parseSubscription(raw: unknown): CurrentSubscription | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const state = str(o.state);
  const id = str(o.id);
  const expiresAt = str(o.expires_at);
  if (!id || !expiresAt || (state && state !== 'active')) return null;
  if (new Date(expiresAt).getTime() <= Date.now()) return null;
  const amount = str(o.charged_amount_minor);
  const currency = str(o.charged_currency);
  return {
    id,
    planId: str(o.plan_id),
    expiresAt,
    autoRenew: o.auto_renew !== false,
    charged: amount && currency ? { amount_minor: amount, currency } : null,
  };
}

/** The active subscription, or null (none, signed out, or the request failed). */
export async function fetchSubscription(): Promise<CurrentSubscription | null> {
  try {
    return parseSubscription(await api.get<unknown>('/subscriptions/me'));
  } catch {
    return null;
  }
}

const PLAN_NAMES: Record<string, string> = {
  day_pass: 'Day pass',
  week: 'Week',
  month: 'Month',
};

export function planName(code: string): string {
  return PLAN_NAMES[code] ?? code.replace(/_/g, ' ');
}

/** "24 hours", "7 days", "30 days" */
export function planLength(days: number): string {
  if (days === 1) return '24 hours';
  return `${days} days`;
}

/** When a pass ends: a time for anything within two days ("Wed 14:30"), else a date. */
export function untilText(iso: string): string {
  const d = new Date(iso);
  if (d.getTime() - Date.now() < 2 * 86_400_000) {
    return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return shortDate(iso);
}

/** "6 Nov" (or "6 Nov 2027" when not this year), in the viewer's locale. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
