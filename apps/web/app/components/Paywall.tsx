'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getRefreshToken, isAuthenticated } from '../../src/lib/auth';
import { signInHref } from '../../src/lib/return-to';
import type { PaywallPayload } from '../../src/types/api';
import { LinkButton } from '../../src/ui/button';
import { Icon } from '../../src/ui/icon';
import { PriceWithLocal } from '../../src/ui/price';
import {
  cheapestPlan,
  type PlanQuoteJson,
  planPeriod,
  primaryOption,
} from '../../src/ui/viewer-paywall';

interface PaywallProps {
  payload: PaywallPayload;
  videoId: string;
}

/** "day" → "Day pass". */
function passName(period: string): string {
  return `${period.charAt(0).toUpperCase()}${period.slice(1)} pass`;
}

type Row = {
  key: 'buy' | 'subscribe';
  price: PlanQuoteJson['price'];
  local?: PlanQuoteJson['display_price'];
  caption: string;
  action: string;
  href: string;
};

/**
 * One decision, inside the player box: the ways in, cheapest first with the big button.
 * Prices are the real charge, with a render-only "≈" local amount when the API quotes one.
 */
export default function Paywall({ payload, videoId }: PaywallProps) {
  // Read auth on the client only (cookies), after mount, to avoid hydration mismatches.
  const [signedIn, setSignedIn] = useState(true);
  useEffect(() => {
    setSignedIn(isAuthenticated() || Boolean(getRefreshToken()));
  }, []);

  const returnTo = `/v/${videoId}`;
  const buy = payload.options.buy;
  const plans = (payload.options.subscribe?.plans ?? []) as PlanQuoteJson[];
  const plan = cheapestPlan(plans);
  const primary = primaryOption(buy, plan);

  const rows: Row[] = [];
  if (buy) {
    const purchase = `/purchase/${videoId}`;
    rows.push({
      key: 'buy',
      price: buy.price,
      local: buy.display_price,
      caption: 'This video, yours to rewatch',
      action: 'Buy',
      // Signed out: sign in first, then land straight on checkout.
      href: signedIn ? purchase : signInHref(purchase),
    });
  }
  if (plan) {
    rows.push({
      key: 'subscribe',
      price: plan.price,
      local: plan.display_price,
      caption: `${passName(planPeriod(plan))} · all Premium videos`,
      action: 'Get Premium',
      href: `/pricing?return_to=${encodeURIComponent(returnTo)}`,
    });
  }
  rows.sort((a, b) => (a.key === primary ? -1 : b.key === primary ? 1 : 0));

  const heading =
    buy && plan
      ? 'Buy it or watch with Premium'
      : buy
        ? 'Unlock this video'
        : 'Included with Premium';
  const sub =
    buy && plan
      ? 'Pay once for this video, or get every Premium video for a while.'
      : buy
        ? 'Pay once with EcoCash. Rewatch any time.'
        : 'A pass unlocks every Premium video while it lasts.';

  return (
    <section aria-labelledby="paywall-heading" className="flex w-full max-w-md flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <h2
          id="paywall-heading"
          className="flex items-center gap-2 text-base font-bold leading-6 text-ink"
        >
          <Icon name="lock" size={18} className="shrink-0 text-accent" />
          {heading}
        </h2>
        <p className="hidden text-sm text-ink-2 sm:block">{sub}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">This video can&apos;t be unlocked right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between gap-3 rounded border border-line bg-surface px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <PriceWithLocal price={r.price} local={r.local} />
                <span className="truncate text-xs text-ink-3">{r.caption}</span>
              </div>
              <LinkButton
                href={r.href}
                variant={r.key === primary ? 'primary' : 'secondary'}
                className="shrink-0"
              >
                {r.action}
              </LinkButton>
            </li>
          ))}
        </ul>
      )}

      {!signedIn && (
        <p className="text-sm text-ink-2">
          Already paid?{' '}
          <Link
            href={signInHref(returnTo)}
            className="inline-flex h-11 items-center font-semibold text-accent hover:underline"
          >
            Sign in
          </Link>
        </p>
      )}
    </section>
  );
}
