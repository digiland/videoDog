'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type PendingCardPayment,
  clearPendingCardPayment,
  readPendingCardPayment,
} from '../../../src/lib/payments';
import { safeReturnTo } from '../../../src/lib/return-to';
import DevSimulatePayment from '../../components/DevSimulatePayment';
import { type PollOutcome, usePaymentPolling } from '../../components/usePaymentPolling';

type View =
  | { name: 'loading' }
  | { name: 'missing' }
  | { name: 'polling' }
  | { name: 'timeout' }
  | { name: 'failed'; message: string }
  | { name: 'completed' };

/**
 * Paystack sends the browser back here (`?reference=…`) after the card step. The payment id
 * and destination were stashed in sessionStorage by the checkout before redirecting; the
 * `reference` itself is not trusted for anything — we only poll our own payment by id.
 */
export default function CheckoutReturnPage() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingCardPayment | null>(null);
  const [view, setView] = useState<View>({ name: 'loading' });

  const handleOutcome = useCallback(
    (outcome: PollOutcome) => {
      if (outcome === 'timeout') {
        setView({ name: 'timeout' });
        return;
      }
      clearPendingCardPayment();
      if (outcome === 'completed') {
        setView({ name: 'completed' });
        router.replace(safeReturnTo(pending?.return_path) ?? '/');
        return;
      }
      setView({
        name: 'failed',
        message:
          outcome === 'reversed'
            ? 'The card payment was reversed. You have not been charged.'
            : 'The card payment was declined or cancelled. You have not been charged.',
      });
    },
    [router, pending],
  );

  const poller = usePaymentPolling(handleOutcome);
  const { start } = poller;

  useEffect(() => {
    const stashed = readPendingCardPayment();
    if (!stashed) {
      setView({ name: 'missing' });
      return;
    }
    setPending(stashed);
    setView({ name: 'polling' });
    start(stashed.payment_id);
  }, [start]);

  const retryPath = safeReturnTo(pending?.retry_path) ?? '/';

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-10 fade-up">
      <h1 className="text-2xl font-bold">Card payment</h1>
      <div
        className="mt-6 bg-bg-elev border border-line rounded-lg p-6 space-y-4"
        aria-live="polite"
      >
        {(view.name === 'loading' || view.name === 'polling' || view.name === 'completed') && (
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 shrink-0 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="font-semibold">
              {view.name === 'completed'
                ? 'Payment confirmed — taking you back…'
                : 'Confirming your card payment…'}
            </p>
          </div>
        )}

        {view.name === 'missing' && (
          <>
            <p className="text-sm text-ink-mute">
              We couldn&rsquo;t find a payment in progress in this browser. If you completed a
              payment, it will show up on the video or your subscription shortly.
            </p>
            <Link href="/" className="text-accent text-sm font-semibold hover:underline">
              Go to home
            </Link>
          </>
        )}

        {view.name === 'timeout' && pending && (
          <>
            <p className="text-sm text-ink-mute">
              We haven&rsquo;t received confirmation from the card provider yet. It may take a
              little longer — you will not be charged twice.
            </p>
            <button
              type="button"
              onClick={() => {
                setView({ name: 'polling' });
                start(pending.payment_id);
              }}
              className="bg-accent hover:bg-accent-hot text-bg font-semibold px-4 py-2 rounded-md text-sm transition"
            >
              Check again
            </button>
          </>
        )}

        {view.name === 'failed' && (
          <>
            <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
              {view.message}
            </div>
            <Link
              href={retryPath}
              className="block text-center w-full bg-accent hover:bg-accent-hot text-bg font-semibold py-3 rounded-md text-sm transition"
            >
              Try again
            </Link>
          </>
        )}

        {(view.name === 'polling' || view.name === 'timeout') && pending && (
          <DevSimulatePayment
            paymentId={pending.payment_id}
            onSimulated={() => {
              if (view.name === 'polling') {
                poller.pollNow();
              } else {
                setView({ name: 'polling' });
                start(pending.payment_id);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
