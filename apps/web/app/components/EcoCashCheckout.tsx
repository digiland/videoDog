'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/api';
import { getRefreshToken, isAuthenticated } from '../../src/lib/auth';
import { formatMoney } from '../../src/lib/format';
import { currentPath, signInHref } from '../../src/lib/return-to';
import {
  isE164,
  newIdempotencyKey,
  normaliseMsisdn,
  providerForCurrency,
} from '../../src/lib/payments';
import type {
  CreatePaymentResponse,
  CreatePurchaseResponse,
  CreateSubscriptionResponse,
  MoneyDTO,
  PaymentCurrencyCode,
  PaymentState,
  PaymentStatus,
  User,
} from '../../src/types/api';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 3 * 60_000;

const CURRENCY_OPTIONS: ReadonlyArray<{ code: PaymentCurrencyCode; label: string }> = [
  { code: 'USD', label: 'USD' },
  { code: 'ZWG', label: 'ZWG' },
  { code: 'ZAR', label: 'ZAR' },
];

export type CheckoutTarget =
  | { kind: 'purchase'; videoId: string }
  | { kind: 'subscription'; planId: string };

interface Props {
  target: CheckoutTarget;
  /** Listed price, shown before the order is created. The server decides the charge. */
  listPrice?: MoneyDTO;
  initialCurrency?: string;
  /** Called once the payment is confirmed `completed`. */
  onCompleted: () => void;
}

/** Order created on the API (purchase or subscription) for a given payment currency. */
interface Order {
  id: string;
  currency: PaymentCurrencyCode;
  amount: MoneyDTO;
}

type Phase =
  | { name: 'init' }
  | { name: 'form' }
  | { name: 'submitting' }
  | { name: 'awaiting'; paymentId: string; amount: MoneyDTO }
  | { name: 'timeout'; paymentId: string; amount: MoneyDTO }
  | { name: 'failed'; message: string }
  | { name: 'completed' };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function isTerminalFailure(state: PaymentState): boolean {
  return state === 'failed' || state === 'reversed';
}

function asPaymentCurrency(c: string | undefined): PaymentCurrencyCode {
  return c === 'ZWG' ? 'ZWG' : 'USD';
}

export default function EcoCashCheckout({
  target,
  listPrice,
  initialCurrency,
  onCompleted,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: 'init' });
  const [currency, setCurrency] = useState<PaymentCurrencyCode>(asPaymentCurrency(initialCurrency));
  const [msisdn, setMsisdn] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const orderRef = useRef<Order | null>(null);
  // One idempotency key per payment attempt; reused if the same attempt is retried
  // (e.g. POST /payments timed out), replaced once that attempt has definitively failed.
  const attemptRef = useRef<{ key: string; fingerprint: string } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  // Sign-in gate + EcoCash number prefill from the profile phone.
  useEffect(() => {
    if (!isAuthenticated() && !getRefreshToken()) {
      // Come back to this checkout (purchase page or pricing) after signing in.
      router.replace(signInHref(currentPath()));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const me =
          await api.get<Pick<User, 'phone_e164' | 'preferred_display_currency'>>('/users/me');
        if (cancelled) return;
        setMsisdn((cur) => cur || me.phone_e164);
        if (!initialCurrency) setCurrency(asPaymentCurrency(me.preferred_display_currency));
      } catch {
        // Prefill is a convenience; the number can still be typed.
      }
      if (!cancelled) setPhase({ name: 'form' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, initialCurrency]);

  const handleOutcome = useCallback(
    (state: PaymentState, paymentId: string, amount: MoneyDTO, deadline: number): void => {
      if (!mountedRef.current) return;
      if (state === 'completed') {
        stopPolling();
        attemptRef.current = null;
        setPhase({ name: 'completed' });
        onCompletedRef.current();
        return;
      }
      if (isTerminalFailure(state)) {
        stopPolling();
        attemptRef.current = null; // next try is a new attempt with a new key
        setPhase({
          name: 'failed',
          message:
            state === 'reversed'
              ? 'The payment was reversed. You have not been charged.'
              : 'The payment was declined or cancelled. You have not been charged.',
        });
        return;
      }
      if (Date.now() >= deadline) {
        stopPolling();
        setPhase({ name: 'timeout', paymentId, amount });
        return;
      }
      // Still initiated/pending — poll again.
      pollTimerRef.current = setTimeout(() => {
        void (async () => {
          try {
            const p = await api.get<PaymentStatus>(`/payments/${encodeURIComponent(paymentId)}`);
            handleOutcome(p.state, paymentId, amount, deadline);
          } catch {
            // Transient error: keep polling until the deadline.
            handleOutcome('pending', paymentId, amount, deadline);
          }
        })();
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  function startPolling(paymentId: string, amount: MoneyDTO, initial: PaymentState) {
    stopPolling();
    setPhase({ name: 'awaiting', paymentId, amount });
    handleOutcome(initial, paymentId, amount, Date.now() + POLL_TIMEOUT_MS);
  }

  async function ensureOrder(): Promise<Order> {
    const existing = orderRef.current;
    if (existing && existing.currency === currency) return existing;
    let order: Order;
    if (target.kind === 'purchase') {
      const res = await api.post<CreatePurchaseResponse>('/purchases', {
        video_id: target.videoId,
        payment_currency: currency,
      });
      order = { id: res.purchase_id, currency, amount: res.paid_amount };
    } else {
      const res = await api.post<CreateSubscriptionResponse>('/subscriptions', {
        plan_id: target.planId,
        payment_currency: currency,
      });
      order = { id: res.subscription_id, currency, amount: res.charged_amount };
    }
    orderRef.current = order;
    return order;
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const provider = providerForCurrency(currency);
    if (!provider) {
      setFormError(`${currency} payments are coming soon. Please choose USD or ZWG.`);
      return;
    }
    const number = normaliseMsisdn(msisdn.trim());
    if (!isE164(number)) {
      setFormError('Enter your EcoCash number in international format, e.g. +263771234567.');
      return;
    }
    setMsisdn(number);
    setPhase({ name: 'submitting' });
    try {
      const order = await ensureOrder();
      const intent = target.kind;
      const fingerprint = `${intent}:${order.id}:${provider}:${number}`;
      if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint) {
        attemptRef.current = { key: newIdempotencyKey(), fingerprint };
      }
      const payment = await api.post<CreatePaymentResponse>('/payments', {
        provider,
        intent,
        intent_ref_id: order.id,
        msisdn: number,
        idempotency_key: attemptRef.current.key,
      });
      if (!mountedRef.current) return;
      startPolling(payment.payment_id, order.amount, payment.status);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      // Keep attemptRef: retrying this same attempt must reuse its idempotency key.
      setFormError(errorMessage(err, 'Could not start the payment. Please try again.'));
      setPhase({ name: 'form' });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (phase.name === 'init') {
    return (
      <div className="flex justify-center py-10">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (phase.name === 'completed') {
    return (
      <div className="bg-ok/10 border border-ok/30 rounded-md px-4 py-4 text-sm text-ok">
        Payment confirmed.
      </div>
    );
  }

  if (phase.name === 'awaiting' || phase.name === 'timeout') {
    const amount = formatMoney(phase.amount.amount_minor, phase.amount.currency);
    return (
      <div className="space-y-4" aria-live="polite">
        {phase.name === 'awaiting' ? (
          <>
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 shrink-0 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="font-semibold">Approve the payment on your phone (EcoCash prompt)</p>
            </div>
            <p className="text-sm text-ink-mute">
              We sent a request for <span className="font-semibold text-ink">{amount}</span> to{' '}
              <span className="font-mono">{msisdn}</span>. Enter your EcoCash PIN when prompted.
              This page updates automatically.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold">Still waiting for EcoCash to confirm</p>
            <p className="text-sm text-ink-mute">
              We have not received confirmation for {amount} yet. If you approved it, it may take a
              little longer — check again in a moment. You will not be charged twice.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startPolling(phase.paymentId, phase.amount, 'pending')}
                className="bg-accent hover:bg-accent-hot text-bg font-semibold px-4 py-2 rounded-md text-sm transition"
              >
                Check again
              </button>
              <button
                type="button"
                // Keep the attempt's key: resubmitting the same number/currency returns this
                // same payment instead of sending a second charge. A different number or
                // currency is a new attempt (new key).
                onClick={() => setPhase({ name: 'form' })}
                className="bg-surface hover:bg-surface-2 border border-line font-semibold px-4 py-2 rounded-md text-sm transition"
              >
                Change number or currency
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (phase.name === 'failed') {
    return (
      <div className="space-y-4" aria-live="polite">
        <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
          {phase.message}
        </div>
        <button
          type="button"
          onClick={() => setPhase({ name: 'form' })}
          className="w-full bg-accent hover:bg-accent-hot text-bg font-semibold py-3 rounded-md text-sm transition"
        >
          Try again
        </button>
      </div>
    );
  }

  const busy = phase.name === 'submitting';
  return (
    <form onSubmit={(e) => void handlePay(e)} className="space-y-5">
      {listPrice && (
        <p className="text-sm text-ink-mute">
          Price:{' '}
          <span className="font-semibold text-ink">
            {formatMoney(listPrice.amount_minor, listPrice.currency)}
          </span>
          {currency !== listPrice.currency && (
            <span className="block text-xs text-ink-dim mt-0.5">
              Charged in {currency} at today&rsquo;s rate; the exact amount is shown on the EcoCash
              prompt.
            </span>
          )}
        </p>
      )}

      <fieldset>
        <legend className="block text-sm font-medium mb-1.5">Pay in</legend>
        <div className="flex flex-wrap gap-2">
          {CURRENCY_OPTIONS.map(({ code, label }) => {
            const available = providerForCurrency(code) !== null;
            return (
              <button
                key={code}
                type="button"
                disabled={!available || busy}
                aria-pressed={currency === code}
                onClick={() => setCurrency(code)}
                className={`text-sm font-medium px-4 py-2 rounded-md transition disabled:cursor-not-allowed ${
                  currency === code
                    ? 'bg-accent text-bg'
                    : available
                      ? 'bg-surface text-ink-mute hover:text-ink'
                      : 'bg-surface text-ink-dim opacity-60'
                }`}
              >
                {label}
                {!available && <span className="ml-1 text-[10px] uppercase">coming soon</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="ecocash-msisdn" className="block text-sm font-medium mb-1.5">
          EcoCash number
        </label>
        <input
          id="ecocash-msisdn"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={msisdn}
          onChange={(e) => {
            setMsisdn(e.target.value);
            setFormError(null);
          }}
          placeholder="+263771234567"
          disabled={busy}
          className="w-full bg-surface border border-line focus:border-accent text-ink rounded-md px-4 py-2.5 placeholder:text-ink-dim focus:outline-none transition"
        />
        <p className="mt-1 text-xs text-ink-dim">
          You&rsquo;ll get a prompt on this phone to approve with your EcoCash PIN.
        </p>
      </div>

      {formError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
          {formError}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full bg-accent hover:bg-accent-hot text-bg font-semibold py-3 rounded-md text-sm transition disabled:opacity-50"
      >
        {busy ? 'Starting payment…' : 'Pay with EcoCash'}
      </button>
    </form>
  );
}
