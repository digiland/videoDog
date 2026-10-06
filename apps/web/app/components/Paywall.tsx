'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MoneyDTO, PaywallPayload } from '../../src/types/api';
import { formatMoney } from '../../src/lib/format';
import { getRefreshToken, isAuthenticated } from '../../src/lib/auth';
import { signInHref } from '../../src/lib/return-to';

/**
 * Render-only approximation in the viewer's display currency (CLAUDE.md §3.5). Shown only
 * when it differs from the currency actually charged; never used for any calculation.
 */
function ApproxPrice({ price, display }: { price: MoneyDTO; display?: MoneyDTO }) {
  if (!display || display.currency === price.currency) return null;
  return (
    <span className="block text-xs text-gray-400" title="Approximate conversion for reference">
      ≈ {formatMoney(display.amount_minor, display.currency)}{' '}
      <span className="text-gray-500">(approx.)</span>
    </span>
  );
}

interface PaywallProps {
  payload: PaywallPayload;
  videoId: string;
}

export default function Paywall({ payload, videoId }: PaywallProps) {
  const hasBuy = Boolean(payload.options.buy);
  const hasSubscribe = Boolean(payload.options.subscribe?.plans.length);
  // Read auth on the client only (cookies), after mount, to avoid hydration mismatches.
  const [signedIn, setSignedIn] = useState(true);
  useEffect(() => {
    setSignedIn(isAuthenticated() || Boolean(getRefreshToken()));
  }, []);

  return (
    <div className="bg-[#16213e] rounded-xl border border-[#e94560]/20 p-6 text-center">
      {/* Lock icon */}
      <div className="flex justify-center mb-4">
        <div className="w-16 h-16 rounded-full bg-[#e94560]/10 flex items-center justify-center">
          <svg
            aria-hidden="true"
            className="w-8 h-8 text-[#e94560]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
      </div>

      <h2 className="text-xl font-bold text-white mb-2">This video is locked</h2>
      <p className="text-gray-400 text-sm mb-6">
        {hasBuy && hasSubscribe
          ? 'Buy a one-time unlock or subscribe to watch.'
          : hasBuy
            ? 'Purchase a one-time unlock to watch this video.'
            : 'Subscribe to watch this and all premium content.'}
      </p>

      <div
        className={`flex flex-col gap-4 ${hasBuy && hasSubscribe ? 'sm:flex-row' : ''} justify-center`}
      >
        {/* Buy option */}
        {hasBuy && payload.options.buy && (
          <div className="flex-1 bg-[#0f0f23] rounded-xl border border-yellow-700/30 p-5">
            <div className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2">
              One-time unlock
            </div>
            <div className="mb-4">
              <span className="block text-3xl font-bold text-white">
                {formatMoney(
                  payload.options.buy.price.amount_minor,
                  payload.options.buy.price.currency,
                )}
              </span>
              <ApproxPrice
                price={payload.options.buy.price}
                display={payload.options.buy.display_price}
              />
            </div>
            <p className="text-xs text-gray-500 mb-4">Pay once, watch forever</p>
            <Link
              href={`/purchase/${videoId}`}
              className="block w-full bg-yellow-500 hover:bg-yellow-400 text-black font-semibold py-3 px-4 rounded-lg transition text-sm"
            >
              Pay with EcoCash
            </Link>
          </div>
        )}

        {/* Subscribe option */}
        {hasSubscribe && payload.options.subscribe && (
          <div className="flex-1 bg-[#0f0f23] rounded-xl border border-purple-700/30 p-5">
            <div className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">
              Subscribe
            </div>
            <div className="space-y-2 mb-4">
              {payload.options.subscribe.plans.map((plan) => (
                <div key={plan.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-gray-300 capitalize">{plan.code.replace(/_/g, ' ')}</span>
                  <span className="text-right">
                    <span className="block font-semibold text-white">
                      {formatMoney(plan.price.amount_minor, plan.price.currency)}
                    </span>
                    <ApproxPrice price={plan.price} display={plan.display_price} />
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mb-4">Access all premium content</p>
            <Link
              href={`/pricing?return_to=${encodeURIComponent(`/v/${videoId}`)}`}
              className="block w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 px-4 rounded-lg transition text-sm"
            >
              Subscribe now
            </Link>
          </div>
        )}
      </div>

      {!signedIn && (
        <p className="mt-4 text-xs text-gray-600">
          <Link href={signInHref(`/v/${videoId}`)} className="text-[#e94560] hover:underline">
            Sign in
          </Link>{' '}
          if you already have access.
        </p>
      )}
    </div>
  );
}
