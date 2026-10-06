import { api } from '../../../src/lib/api';
import { formatMoney } from '../../../src/lib/format';
import { parseMajorToMinor } from '../../../src/lib/money-input';
import type { Earnings, User, Video } from '../../../src/types/api';
import type { MoneyJson } from '../../../src/ui/price';

/** GET /wallet/balance as the API sends it (creator_balance accounts; USD canonical). */
export type BalanceRow = { currency: string; balance_minor: string; balance?: MoneyJson };
export type BalanceResponse = { balances: BalanceRow[] };

export type Me = User & { creator_application_state?: string };

export type VideoPage = { items: Video[]; next_cursor: string | null };

export function fetchMe() {
  return api.get<Me>('/users/me');
}

export function fetchBalance() {
  return api.get<BalanceResponse>('/wallet/balance');
}

export function fetchMyVideos(limit = 50) {
  return api.get<VideoPage>(`/videos?creator=me&limit=${limit}`);
}

export function fetchEarnings(month: string) {
  return api.get<Earnings>(`/studio/earnings?month=${month}`);
}

/** Earnings live in creator_balance.USD; a missing row means nothing earned yet. */
export function usdBalance(res: BalanceResponse | null): MoneyJson {
  const row = res?.balances.find((b) => b.currency === 'USD');
  return { amount_minor: row?.balance_minor ?? '0', currency: 'USD' };
}

export function thisMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// --- Pricing -----------------------------------------------------------------------------

export type AccessMode = Video['access_mode'];

/** API range for a single unlock, in minor units of the creator's pricing currency. */
export const PPV_MIN_MINOR = 10n;
export const PPV_MAX_MINOR = 200n;

export function needsPrice(mode: AccessMode): boolean {
  return mode === 'ppv' || mode === 'premium_buyable';
}

export function priceRangeHint(currency: string): string {
  return `Between ${formatMoney(PPV_MIN_MINOR, currency)} and ${formatMoney(PPV_MAX_MINOR, currency)}. You keep 70% of each sale.`;
}

/** Exact parse of a typed price; error copy says what's wrong and what's allowed. */
export function parsePpvPrice(
  input: string,
  currency: string,
): { ok: true; minor: bigint } | { ok: false; error: string } {
  if (!input.trim()) return { ok: false, error: 'Enter a price, e.g. 0.50.' };
  const minor = parseMajorToMinor(input);
  if (minor === null) return { ok: false, error: 'Use digits and a dot, e.g. 0.50.' };
  if (minor < PPV_MIN_MINOR || minor > PPV_MAX_MINOR) {
    return {
      ok: false,
      error: `Price must be ${formatMoney(PPV_MIN_MINOR, currency)} to ${formatMoney(PPV_MAX_MINOR, currency)}.`,
    };
  }
  return { ok: true, minor };
}

// --- Video state -------------------------------------------------------------------------

export type VideoState = Video['state'];

/** What the creator should do next with a video, if anything. */
export type NextAction =
  | { kind: 'publish' }
  | { kind: 'resume-upload' }
  | { kind: 'wait' }
  | { kind: 'reupload' }
  | { kind: 'republish' }
  | { kind: 'none' };

export function nextAction(state: VideoState): NextAction {
  switch (state) {
    case 'ready':
      return { kind: 'publish' };
    case 'uploading':
      return { kind: 'resume-upload' };
    case 'processing':
      return { kind: 'wait' };
    case 'failed':
      return { kind: 'reupload' };
    case 'unpublished':
      return { kind: 'republish' };
    default:
      return { kind: 'none' };
  }
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** "6 Oct" / "6 Oct 2025" — short, local, no time noise. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "+263 77 100 0002" — easier to check at a glance than the raw E.164 string. */
export function formatMsisdn(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+263(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+263 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

// --- Ledger ------------------------------------------------------------------------------

/** One row of GET /wallet/ledger (Drizzle row; amounts are integer strings). */
export type LedgerEntry = {
  id: string;
  debitMinor: string;
  creditMinor: string;
  currency: string;
  refType: string;
  refId: string | null;
  occurredAt: string;
};

export function fetchLedger(limit = 50) {
  return api.get<{ entries: LedgerEntry[] }>(`/wallet/ledger?limit=${limit}`);
}

const LEDGER_LABELS: Record<string, string> = {
  purchase: 'Pay-once sale',
  tip: 'Tip',
  premium_payout: 'Premium pool',
  payout: 'Payout',
};

export function ledgerLabel(e: LedgerEntry): string {
  if (e.refType === 'payout') {
    return BigInt(e.creditMinor) > 0n ? 'Payout returned (it failed)' : 'Payout to EcoCash';
  }
  return LEDGER_LABELS[e.refType] ?? e.refType.replace(/_/g, ' ');
}

/** Signed movement on the balance: credits in, debits out. Exact (bigint). */
export function ledgerAmount(e: LedgerEntry): { money: MoneyJson; incoming: boolean } {
  const credit = BigInt(e.creditMinor);
  const incoming = credit > 0n;
  return {
    incoming,
    money: {
      amount_minor: (incoming ? credit : BigInt(e.debitMinor)).toString(),
      currency: e.currency,
    },
  };
}
