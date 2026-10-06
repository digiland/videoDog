'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dataPerMinuteMb } from '@streamzw/shared';
import { api } from '../../src/lib/api';
import { getRefreshToken, isAuthenticated } from '../../src/lib/auth';
import { formatMoney } from '../../src/lib/format';
import { safeReturnTo, signInHref } from '../../src/lib/return-to';
import type { MoneyDTO, SubscriptionPlan, User } from '../../src/types/api';
import { LinkButton } from '../../src/ui/button';
import { Icon, type IconName } from '../../src/ui/icon';
import { Notice } from '../../src/ui/notice';
import { PriceWithLocal } from '../../src/ui/price';
import { Skeleton } from '../../src/ui/state';
import Checkout from '../components/Checkout';
import { errorText } from '../components/account/errors';
import {
  type CurrentSubscription,
  fetchSubscription,
  planLength,
  planName,
  untilText,
} from '../components/account/subscription';

/** Approximations are fetched for every currency someone can pay in besides USD. */
const QUOTE_CURRENCIES = ['ZWG', 'ZAR'] as const;

/** Only same-site video pages are accepted as a post-subscribe destination. */
function videoReturnTo(raw: string | null): string | null {
  const safe = safeReturnTo(raw);
  return safe && /^\/v\/[A-Za-z0-9-]+$/.test(safe) ? safe : null;
}

function signedIn(): boolean {
  return isAuthenticated() || Boolean(getRefreshToken());
}

function asPlans(data: SubscriptionPlan[] | { items: SubscriptionPlan[] }): SubscriptionPlan[] {
  return Array.isArray(data) ? data : data.items;
}

/** Per-day price, rounded half-up in minor units (bigint; no float money math). */
function perDay(p: SubscriptionPlan): MoneyDTO | null {
  if (p.duration_days <= 1) return null;
  const a = BigInt(p.base_price.amount_minor);
  const d = BigInt(p.duration_days);
  return { amount_minor: ((a * 2n + d) / (2n * d)).toString(), currency: p.base_price.currency };
}

/** The plan with the lowest per-day cost, marked "Best value". */
function bestValueId(plans: SubscriptionPlan[]): string | null {
  if (plans.length < 2) return null;
  let best: SubscriptionPlan | null = null;
  for (const p of plans) {
    // Compare a/d < b/e as a*e < b*d, so no division and no rounding.
    if (
      !best ||
      BigInt(p.base_price.amount_minor) * BigInt(best.duration_days) <
        BigInt(best.base_price.amount_minor) * BigInt(p.duration_days)
    ) {
      best = p;
    }
  }
  return best?.id ?? null;
}

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, MoneyDTO[]>>({});
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [current, setCurrent] = useState<CurrentSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlan | null>(null);
  const [success, setSuccess] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [wantedPlan, setWantedPlan] = useState<string | null>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // The checkout opens under the plans; bring it into view on phones.
  useEffect(() => {
    if (checkoutPlan && window.matchMedia('(max-width: 767px)').matches) {
      checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [checkoutPlan]);

  // Paid: the checkout closes, so show the confirmation where the eye goes next.
  useEffect(() => {
    if (success) topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [success]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnTo(videoReturnTo(params.get('return_to')));
    setWantedPlan(params.get('plan'));
    // Back from a card payment via /checkout/return, which only redirects here once paid.
    if (params.get('subscribed') === '1') setSuccess(true);
  }, []);

  /** Where /checkout/return lands after a completed card payment. */
  function cardReturnPath(): string {
    const params = new URLSearchParams({ subscribed: '1' });
    if (returnTo) params.set('return_to', returnTo);
    return `/pricing?${params.toString()}`;
  }

  const load = useCallback(async () => {
    const isIn = signedIn();
    const mePromise = isIn
      ? api.get<Pick<User, 'preferred_display_currency'>>('/users/me').catch(() => null)
      : Promise.resolve(null);
    const subPromise = isIn ? fetchSubscription() : Promise.resolve(null);
    try {
      // One request per quote currency (each ~0.5 KB); USD prices come with every response.
      const lists = await Promise.all(
        QUOTE_CURRENCIES.map((c) =>
          api.get<SubscriptionPlan[] | { items: SubscriptionPlan[] }>(
            `/subscriptions/plans?currency=${c}`,
          ),
        ),
      );
      const all = lists.map(asPlans);
      const base = [...(all[0] ?? [])].sort((a, b) => a.duration_days - b.duration_days);
      const q: Record<string, MoneyDTO[]> = {};
      for (const list of all) {
        for (const p of list) {
          if (p.display_price && p.display_price.currency !== p.base_price.currency) {
            q[p.id] = [...(q[p.id] ?? []), p.display_price];
          }
        }
      }
      setPlans(base);
      setQuotes(q);
    } catch (err: unknown) {
      setError(errorText(err, 'Plans did not load. Check your connection and try again.'));
    }
    const [me, sub] = await Promise.all([mePromise, subPromise]);
    if (me?.preferred_display_currency) setDisplayCurrency(me.preferred_display_currency);
    setCurrent(sub);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Signed in from a plan tap: open that plan's checkout straight away.
  useEffect(() => {
    if (!plans || !wantedPlan || !signedIn()) return;
    const p = plans.find((x) => x.code === wantedPlan);
    if (p) setCheckoutPlan(p);
    setWantedPlan(null);
  }, [plans, wantedPlan]);

  function choosePlan(plan: SubscriptionPlan) {
    if (!signedIn()) {
      // Come back here with this plan picked (keeping ?return_to=/v/…) after signing in.
      const params = new URLSearchParams({ plan: plan.code });
      if (returnTo) params.set('return_to', returnTo);
      router.push(signInHref(`/pricing?${params.toString()}`));
      return;
    }
    setSuccess(false);
    setCheckoutPlan(plan);
  }

  const best = plans ? bestValueId(plans) : null;
  const local = (p: SubscriptionPlan) =>
    quotes[p.id]?.find((q) => q.currency === displayCurrency) ?? null;
  const currentPlan = current && plans?.find((p) => p.id === current.planId);

  return (
    <div className="max-w-screen-lg mx-auto px-4 pt-6 pb-10 grid gap-8 md:grid-cols-2 md:gap-12 md:pt-12">
      <header className="flex flex-col gap-3 md:col-start-1 md:row-start-1">
        <p className="inline-flex items-center gap-1.5 self-start h-6 px-2 rounded-full bg-surface-2 text-xs font-semibold text-gold">
          Premium
        </p>
        <h1 className="text-3xl font-bold text-ink">Every Premium video, one small price</h1>
        <p className="text-base text-ink-2">
          Pick a pass, approve it on your phone, and start watching. It ends on its own date. No
          contract.
        </p>
      </header>

      <div
        ref={topRef}
        className="flex flex-col gap-4 scroll-mt-20 md:col-start-2 md:row-start-1 md:row-span-2"
      >
        {success && (
          <Notice
            tone="success"
            action={
              returnTo ? (
                <LinkButton href={returnTo} size="sm" icon="play">
                  Back to video
                </LinkButton>
              ) : undefined
            }
          >
            <span className="font-semibold">Payment confirmed.</span> You have Premium
            {current ? (
              <>
                {' '}
                until <span className="num">{untilText(current.expiresAt)}</span>.
              </>
            ) : (
              '.'
            )}
          </Notice>
        )}
        {current && !success && (
          <Notice tone="success">
            <span className="font-semibold">You have Premium</span>
            {currentPlan ? ` (${planName(currentPlan.code)})` : ''} until{' '}
            <span className="num">{untilText(current.expiresAt)}</span>.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <fieldset className="flex flex-col gap-3 min-w-0">
          <legend className="text-sm font-medium text-ink mb-3">Choose a pass</legend>
          {plans === null && !error
            ? [0, 1].map((k) => <Skeleton key={k} className="h-[76px]" />)
            : plans?.map((p) => {
                const selected = checkoutPlan?.id === p.id;
                const day = perDay(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => choosePlan(p)}
                    className={`flex items-center gap-3 min-h-[76px] w-full rounded border px-4 py-3 text-left transition-colors ${
                      selected
                        ? 'border-accent bg-surface-2'
                        : 'border-line bg-surface hover:border-line-strong'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex items-center justify-center w-5 h-5 shrink-0 rounded-full border-2 ${
                        selected ? 'border-accent' : 'border-line-strong'
                      }`}
                    >
                      {selected && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-ink">{planName(p.code)}</span>
                        {p.id === best && (
                          <span className="h-5 px-2 inline-flex items-center rounded-full bg-surface-2 text-xs font-semibold text-sage">
                            Best value
                          </span>
                        )}
                      </span>
                      <span className="text-sm text-ink-3 num">
                        {planLength(p.duration_days)}
                        {day && ` · ${formatMoney(day.amount_minor, day.currency)} a day`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-lg">
                      <PriceWithLocal price={p.base_price} local={local(p)} />
                    </span>
                  </button>
                );
              })}
        </fieldset>
        {plans && !checkoutPlan && !success && (
          <p className="text-sm text-ink-3">Tap a pass to pay. You approve it on your phone.</p>
        )}

        {checkoutPlan && !success && (
          <div
            ref={checkoutRef}
            className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 scroll-mt-20"
          >
            <Checkout
              key={checkoutPlan.id}
              target={{ kind: 'subscription', planId: checkoutPlan.id }}
              item={{
                caption: `Premium · ${planLength(checkoutPlan.duration_days)}`,
                title: `${planName(checkoutPlan.code)} pass`,
              }}
              returnPath={cardReturnPath()}
              listPrice={checkoutPlan.base_price}
              quotes={quotes[checkoutPlan.id]}
              onCompleted={() => {
                setSuccess(true);
                setCheckoutPlan(null);
                void load();
              }}
            />
          </div>
        )}
      </div>

      <section className="flex flex-col gap-6 md:col-start-1 md:row-start-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-ink">What you get</h2>
          <ul className="flex flex-col gap-3 text-sm text-ink-2">
            <Point icon="check" tone="text-sage">
              <b className="text-ink font-semibold">Every video marked Premium</b>, as often as you
              like while your pass lasts.
            </Point>
            <Point icon="check" tone="text-sage">
              <b className="text-ink font-semibold">Premium videos with a price too</b> are
              included. You don&rsquo;t pay for them again.
            </Point>
            <Point icon="check" tone="text-sage">
              <b className="text-ink font-semibold">55% goes to creators</b>, shared by the minutes
              people watch their videos.
            </Point>
            <Point icon="close" tone="text-ink-3">
              Pay-per-view videos (copper price tag, no Premium label) are bought one at a time.
            </Point>
            <Point icon="data" tone="text-ink-3">
              Data is separate. Data Saver plays at 240p, about {dataPerMinuteMb(240)} MB a minute.
            </Point>
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-bold text-ink">Paying</h2>
          <p className="text-sm text-ink-2">
            EcoCash in USD or ZiG (ZWG), or a Visa/Mastercard in USD or rand. Your pass starts the
            moment the payment is confirmed. Prices marked ≈ are a guide at today&rsquo;s rate.
          </p>
        </div>
      </section>
    </div>
  );
}

function Point({
  icon,
  tone,
  children,
}: {
  icon: IconName;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <Icon name={icon} size={18} className={`mt-0.5 shrink-0 ${tone}`} />
      <span>{children}</span>
    </li>
  );
}
