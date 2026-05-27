'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/api';
import { getAccessToken } from '../../src/lib/auth';

interface PlanQuote {
  plan_id: string;
  code: string;
  duration_days: number;
  amount: { amount: string; currency: string };
}

interface CurrentSub {
  id: string;
  state: string;
  expires_at: string;
  charged_amount_minor: string;
  charged_currency: string;
}

const CURRENCIES = ['USD', 'ZWG', 'ZAR'];

function formatMoney(minor: string, currency: string) {
  const n = Number(minor) / 100;
  const sym = currency === 'USD' ? '$' : currency === 'ZAR' ? 'R ' : `${currency} `;
  return `${sym}${n.toFixed(2)}`;
}

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanQuote[] | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [current, setCurrent] = useState<CurrentSub | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [currency]);

  async function load() {
    try {
      const data = await api.get<{ items: PlanQuote[] }>(
        `/subscriptions/plans?currency=${currency}`,
      );
      setPlans(data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    }
    if (getAccessToken()) {
      try {
        const sub = await api.get<CurrentSub | null>('/subscriptions/me');
        setCurrent(sub);
      } catch {
        /* not signed in */
      }
    }
  }

  async function subscribe(planId: string) {
    if (!getAccessToken()) {
      router.push('/sign-in');
      return;
    }
    setBusy(planId);
    setError(null);
    setSuccess(null);
    try {
      await api.post('/subscriptions', { plan_id: planId, payment_currency: currency });
      setSuccess('You are subscribed.');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to subscribe');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 fade-up">
      <h1 className="text-3xl font-bold">Choose a plan</h1>
      <p className="text-ink-mute mt-2">
        Unlock every video in the premium pool. Cancel anytime — your pass stays valid until it
        expires.
      </p>

      <div className="mt-6 flex items-center gap-2">
        <span className="text-sm text-ink-dim mr-2">Show prices in</span>
        {CURRENCIES.map((c) => (
          <button
            key={c}
            onClick={() => setCurrency(c)}
            className={`text-sm font-medium px-3 py-1.5 rounded-md transition ${
              currency === c ? 'bg-accent text-bg' : 'bg-surface text-ink-mute hover:text-ink'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {current && current.state === 'active' && (
        <div className="mt-6 bg-ok/10 border border-ok/30 rounded-md px-4 py-3 text-sm">
          <span className="font-semibold text-ok">Active subscription:</span>{' '}
          {formatMoney(current.charged_amount_minor, current.charged_currency)} · renews{' '}
          {new Date(current.expires_at).toLocaleDateString()}
        </div>
      )}

      {error && (
        <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-6 bg-ok/10 border border-ok/30 rounded-md px-4 py-3 text-sm text-ok">
          {success}
        </div>
      )}

      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        {plans === null ? (
          <div className="bg-bg-elev border border-line rounded-lg p-10 text-center text-ink-dim text-sm col-span-2">
            Loading…
          </div>
        ) : (
          plans.map((p, i) => {
            const popular = i === 1;
            return (
              <article
                key={p.plan_id}
                className={`relative bg-bg-elev border ${popular ? 'border-accent' : 'border-line'} rounded-lg p-8`}
              >
                {popular && (
                  <span className="absolute -top-3 left-6 text-[10px] font-bold uppercase tracking-wide bg-accent text-bg px-2 py-1 rounded">
                    Most popular
                  </span>
                )}
                <p className="text-sm text-ink-dim uppercase tracking-wide">
                  {p.code === 'day_pass' ? 'Day pass' : p.code === 'month' ? 'Monthly' : p.code}
                </p>
                <p className="text-5xl font-bold mt-3">
                  {formatMoney(p.amount.amount, p.amount.currency)}
                </p>
                <p className="text-sm text-ink-dim mt-1">
                  Every {p.duration_days} day{p.duration_days === 1 ? '' : 's'}
                </p>

                <ul className="mt-6 space-y-2 text-sm text-ink-mute">
                  <li className="flex items-center gap-2">
                    <svg
                      className="w-4 h-4 text-ok shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Every premium video
                  </li>
                  <li className="flex items-center gap-2">
                    <svg
                      className="w-4 h-4 text-ok shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Tip creators directly
                  </li>
                  <li className="flex items-center gap-2">
                    <svg
                      className="w-4 h-4 text-ok shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Cancel anytime
                  </li>
                </ul>

                <button
                  onClick={() => void subscribe(p.plan_id)}
                  disabled={busy !== null}
                  className={`mt-8 w-full font-semibold py-3 rounded-md text-sm transition disabled:opacity-50 ${
                    popular
                      ? 'bg-accent hover:bg-accent-hot text-bg'
                      : 'bg-surface hover:bg-surface-2 text-ink border border-line'
                  }`}
                >
                  {busy === p.plan_id ? 'Processing…' : 'Subscribe'}
                </button>
              </article>
            );
          })
        )}
      </div>

      <p className="mt-8 text-xs text-ink-dim">
        Demo mode: subscriptions activate instantly without going through a real payment provider.
      </p>
    </div>
  );
}
