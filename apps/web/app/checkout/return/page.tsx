'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type PendingCardPayment,
  clearPendingCardPayment,
  readPendingCardPayment,
} from '../../../src/lib/payments';
import { safeReturnTo } from '../../../src/lib/return-to';
import { Button, LinkButton } from '../../../src/ui/button';
import DevSimulatePayment from '../../components/DevSimulatePayment';
import { PayStatus } from '../../components/account/PayStatus';
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
            ? 'The card payment was reversed, so the money is back on your card.'
            : 'The card was declined or the payment was cancelled. You have not been charged.',
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
    <div className="max-w-md mx-auto px-4 pt-6 pb-10 flex flex-col gap-6 sm:pt-16">
      <h1 className="text-2xl font-bold text-ink">Card payment</h1>

      {(view.name === 'loading' || view.name === 'polling') && (
        <PayStatus tone="wait" title="Confirming your card payment">
          <p>This takes a few seconds. Keep this page open; it moves on by itself.</p>
        </PayStatus>
      )}

      {view.name === 'completed' && (
        <PayStatus tone="success" title="Paid">
          <p>Taking you back now.</p>
        </PayStatus>
      )}

      {view.name === 'missing' && (
        <PayStatus
          tone="info"
          title="No payment in progress here"
          actions={
            <LinkButton href="/" size="lg" block>
              Go to home
            </LinkButton>
          }
        >
          <p>
            This browser has no card payment waiting. If you finished paying, the video or your
            Premium pass unlocks within a few minutes.
          </p>
        </PayStatus>
      )}

      {view.name === 'timeout' && pending && (
        <PayStatus
          tone="info"
          title="No answer from the card yet"
          actions={
            <Button
              size="lg"
              block
              onClick={() => {
                setView({ name: 'polling' });
                start(pending.payment_id);
              }}
            >
              Check again
            </Button>
          }
        >
          <p>Confirmation can take a few minutes. Checking again never charges you twice.</p>
        </PayStatus>
      )}

      {view.name === 'failed' && (
        <PayStatus
          tone="error"
          title="Card payment failed"
          actions={
            <LinkButton href={retryPath} size="lg" block>
              Try again
            </LinkButton>
          }
        >
          <p>{view.message}</p>
        </PayStatus>
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
  );
}
