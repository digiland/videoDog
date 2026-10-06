'use client';
import { useEffect, useState } from 'react';
import type { Earnings } from '../../../src/types/api';
import { LinkButton } from '../../../src/ui/button';
import { Icon } from '../../../src/ui/icon';
import { Notice } from '../../../src/ui/notice';
import { type MoneyJson, Price } from '../../../src/ui/price';
import { Skeleton } from '../../../src/ui/state';
import { LedgerList } from '../_components/LedgerList';
import {
  type BalanceResponse,
  type LedgerEntry,
  errorMessage,
  fetchBalance,
  fetchEarnings,
  fetchLedger,
  monthLabel,
  thisMonth,
  usdBalance,
} from '../_components/studio-data';
import { PageTitle, SectionTitle } from '../_components/ui';

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return thisMonth(new Date(y ?? 2000, (m ?? 1) - 1 + by, 1));
}

const MIN_USD_MINOR = 500n;
const MONTH_BTN =
  'inline-flex h-11 w-11 items-center justify-center rounded text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:pointer-events-none';

export default function EarningsPage() {
  const current = thisMonth();
  const [month, setMonth] = useState(current);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEarnings(null);
    fetchEarnings(month)
      .then(setEarnings)
      .catch((err) => setError(errorMessage(err, 'Network error')));
  }, [month]);

  useEffect(() => {
    fetchBalance()
      .then(setBalance)
      .catch(() => undefined);
    fetchLedger(30)
      .then((r) => setLedger(r.entries))
      .catch(() => setLedger([]));
  }, []);

  const bal = balance ? usdBalance(balance) : null;
  const canWithdraw = bal ? BigInt(bal.amount_minor) >= MIN_USD_MINOR : false;

  return (
    <div className="flex flex-col gap-8">
      <PageTitle title="Earnings">
        Everything is counted in US dollars. You choose USD or ZWG when you withdraw.
      </PageTitle>

      {error && <Notice tone="error">Earnings didn&rsquo;t load: {error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section
          aria-label="This month"
          className="flex flex-col gap-5 rounded border border-line bg-surface p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className={MONTH_BTN}
            >
              <Icon name="chevronLeft" size={20} label="Previous month" />
            </button>
            <h2 className="text-base font-semibold text-ink" aria-live="polite">
              {monthLabel(month)}
            </h2>
            <button
              type="button"
              disabled={month >= current}
              onClick={() => setMonth(shiftMonth(month, 1))}
              className={MONTH_BTN}
            >
              <Icon name="chevronRight" size={20} label="Next month" />
            </button>
          </div>

          <div className="flex flex-col items-start gap-1">
            <span className="text-xs font-semibold text-ink-3">Total earned</span>
            {earnings ? (
              <Price money={earnings.total} className="text-4xl font-bold leading-none text-ink" />
            ) : (
              <Skeleton className="h-10 w-40" />
            )}
          </div>

          <dl className="flex flex-col divide-y divide-line border-t border-line">
            <Line
              label="Pay-once sales"
              note="You keep 70% of each sale"
              money={earnings?.ppv_amount}
            />
            <Line
              label="Premium pool"
              note={'Monthly share of subscriptions, by minutes watched'}
              money={earnings?.premium_pool_estimate}
            />
            <Line label="Tips" note="You keep 90% of each tip" money={earnings?.tips_amount} />
          </dl>
        </section>

        <section
          aria-label="Balance"
          className="flex flex-col gap-4 rounded border border-line bg-surface p-4 sm:p-5"
        >
          <span className="text-xs font-semibold text-ink-3">Balance you can withdraw</span>
          {bal ? (
            <Price money={bal} className="text-4xl font-bold leading-none text-ink" />
          ) : (
            <Skeleton className="h-10 w-32" />
          )}
          <p className="text-sm text-ink-2">
            Withdraw to EcoCash from <span className="num font-semibold text-ink">$5.00</span> (USD)
            or <span className="num font-semibold text-ink">ZWG 150</span>.
          </p>
          {canWithdraw ? (
            <LinkButton href="/studio/payouts" icon="wallet" size="lg" block>
              Withdraw
            </LinkButton>
          ) : (
            <LinkButton href="/studio/payouts" variant="secondary" icon="wallet" block>
              Payouts
            </LinkButton>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <SectionTitle>Recent activity</SectionTitle>
        <LedgerList
          entries={ledger}
          empty="No money in or out yet. Sales, tips and Premium pool payments show here."
        />
      </section>
    </div>
  );
}

function Line({ label, note, money }: { label: string; note: string; money?: MoneyJson }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <dt className="text-sm font-semibold text-ink">{label}</dt>
        <dd className="text-xs text-ink-3">{note}</dd>
      </div>
      <dd className="shrink-0 text-lg font-semibold text-ink">
        {money ? <Price money={money} /> : <Skeleton className="h-6 w-16" />}
      </dd>
    </div>
  );
}
