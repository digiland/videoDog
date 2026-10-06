'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/api';
import { getRefreshToken, isAuthenticated } from '../../src/lib/auth';
import { formatMoney } from '../../src/lib/format';
import { currentPath, safeReturnTo, signInHref } from '../../src/lib/return-to';
import type { MoneyDTO, SubscriptionPlan } from '../../src/types/api';
import EcoCashCheckout from '../components/EcoCashCheckout';

interface CurrentSub {
  id: string;
  state: string;
  expires_at: string;
  charged_amount_minor: string;
  charged_currency: string;
}

const CURRENCIES = ['USD', 'ZWG', 'ZAR'];

/** Only same-site video pages are accepted as a post-subscribe destination. */
function videoReturnTo(raw: string | null): string | null {
  const safe = safeReturnTo(raw);
  return safe && /^\/v\/[A-Za-z0-9-]+$/.test(safe) ? safe : null;
}

function signedIn(): boolean {
  return isAuthenticated() || Boolean(getRefreshToken());
}

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [current, setCurrent] = useState<CurrentSub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlan | null>(null);
  const [success, setSuccess] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const checkoutRef = useRef<HTMLElement>(null);

  // The checkout panel renders above the plan cards; bring it into view on phones.
  useEffect(() => {
    if (checkoutPlan) checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [checkoutPlan]);

  useEffect(() => {
    setReturnTo(videoReturnTo(new URLSearchParams(window.location.search).get('return_to')));
  }, []);

  const load = useCallback(async () => {
    try {
      // GET /subscriptions/plans returns an array of plans; tolerate an `{ items }` envelope.
      const data = await api.get<SubscriptionPlan[] | { items: SubscriptionPlan[] }>(
        `/subscriptions/plans?currency=${currency}`,
      );
      setPlans(Array.isArray(data) ? data : data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    }
    if (signedIn()) {
      try {
        const sub = await api.get<CurrentSub | null>('/subscriptions/me');
        setCurrent(sub);
      } catch {
        /* not signed in */
      }
    }
  }, [currency]);

  useEffect(() => {
    void load();
  }, [load]);

  function choosePlan(plan: SubscriptionPlan) {
    if (!signedIn()) {
      // Return here (keeping ?return_to=/v/…) after signing in.
      router.push(signInHref(currentPath()));
      return;
    }
    setSuccess(false);
    setCheckoutPlan(plan);
  }

  function priceLabel(p: SubscriptionPlan): { charge: MoneyDTO; approx: MoneyDTO | null } {
    const approx =
      p.display_price && p.display_price.currency !== p.base_price.currency
        ? p.display_price
        : null;
    return { charge: p.base_price, approx };
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
            type="button"
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
          Payment confirmed — you are subscribed.
          {returnTo && (
            <>
              {' '}
              <Link href={returnTo} className="font-semibold underline">
                Back to your video
              </Link>
            </>
          )}
        </div>
      )}

      {checkoutPlan && !success && (
        <section
          ref={checkoutRef}
          className="mt-6 bg-bg-elev border border-accent/40 rounded-lg p-6 max-w-lg scroll-mt-20"
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="text-sm text-ink-dim uppercase tracking-wide">Checkout</p>
              <p className="text-lg font-semibold mt-1">
                {checkoutPlan.code === 'day_pass'
                  ? 'Day pass'
                  : checkoutPlan.code === 'month'
                    ? 'Monthly'
                    : checkoutPlan.code}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCheckoutPlan(null)}
              className="text-sm text-ink-mute hover:text-ink"
            >
              Cancel
            </button>
          </div>
          <EcoCashCheckout
            key={checkoutPlan.id}
            target={{ kind: 'subscription', planId: checkoutPlan.id }}
            listPrice={checkoutPlan.base_price}
            initialCurrency={currency}
            onCompleted={() => {
              setSuccess(true);
              setCheckoutPlan(null);
              void load();
            }}
          />
        </section>
      )}

      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        {plans === null ? (
          <div className="bg-bg-elev border border-line rounded-lg p-10 text-center text-ink-dim text-sm col-span-2">
            Loading…
          </div>
        ) : (
          plans.map((p, i) => {
            const popular = i === 1;
            const { charge, approx } = priceLabel(p);
            return (
              <article
                key={p.id}
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
                  {formatMoney(charge.amount_minor, charge.currency)}
                </p>
                {approx && (
                  <p className="text-sm text-ink-mute mt-1">
                    ≈ {formatMoney(approx.amount_minor, approx.currency)}{' '}
                    <span className="text-ink-dim">(approx.)</span>
                  </p>
                )}
                <p className="text-sm text-ink-dim mt-1">
                  Every {p.duration_days} day{p.duration_days === 1 ? '' : 's'}
                </p>

                <ul className="mt-6 space-y-2 text-sm text-ink-mute">
                  <li className="flex items-center gap-2">
                    <svg
                      aria-hidden="true"
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
                      aria-hidden="true"
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
                      aria-hidden="true"
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
                  type="button"
                  onClick={() => choosePlan(p)}
                  disabled={checkoutPlan !== null}
                  className={`mt-8 w-full font-semibold py-3 rounded-md text-sm transition disabled:opacity-50 ${
                    popular
                      ? 'bg-accent hover:bg-accent-hot text-bg'
                      : 'bg-surface hover:bg-surface-2 text-ink border border-line'
                  }`}
                >
                  {checkoutPlan?.id === p.id ? 'Selected' : 'Subscribe'}
                </button>
              </article>
            );
          })
        )}
      </div>

      <p className="mt-8 text-xs text-ink-dim">
        Pay with EcoCash (USD or ZWG). Your subscription starts once the payment is confirmed.
      </p>
    </div>
  );
}
