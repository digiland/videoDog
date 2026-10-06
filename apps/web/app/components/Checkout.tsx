'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/api';
import { getRefreshToken, isAuthenticated } from '../../src/lib/auth';
import { formatMoney } from '../../src/lib/format';
import {
  type PaymentMethod,
  isE164,
  isSafeRedirectUrl,
  methodsFor,
  newIdempotencyKey,
  normaliseMsisdn,
  providerFor,
  stashPendingCardPayment,
} from '../../src/lib/payments';
import { currentPath, signInHref } from '../../src/lib/return-to';
import type {
  CreatePaymentResponse,
  CreatePurchaseResponse,
  CreateSubscriptionResponse,
  MoneyDTO,
  PaymentCurrencyCode,
  PaymentState,
  User,
} from '../../src/types/api';
import DevSimulatePayment from './DevSimulatePayment';
import { type PollOutcome, usePaymentPolling } from './usePaymentPolling';

const CURRENCIES: readonly PaymentCurrencyCode[] = ['USD', 'ZWG', 'ZAR'];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  ecocash: 'EcoCash',
  card: 'Card (Paystack)',
};

export type CheckoutTarget =
  | { kind: 'purchase'; videoId: string }
  | { kind: 'subscription'; planId: string };

interface Props {
  target: CheckoutTarget;
  /** Listed price, shown before the order is created. The server decides the charge. */
  listPrice?: MoneyDTO;
  initialCurrency?: string;
  /**
   * Same-origin path to land on after a card payment completes (the browser leaves for
   * Paystack and comes back via /checkout/return, so `onCompleted` can't run).
   */
  returnPath: string;
  /** Called when an in-page (EcoCash) payment is confirmed `completed`. */
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
  | { name: 'redirecting' }
  | { name: 'awaiting'; paymentId: string; amount: MoneyDTO }
  | { name: 'timeout'; paymentId: string; amount: MoneyDTO }
  | { name: 'failed'; message: string }
  | { name: 'completed' };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function asPaymentCurrency(c: string | undefined): PaymentCurrencyCode {
  return c === 'ZWG' || c === 'ZAR' ? c : 'USD';
}

export default function Checkout({
  target,
  listPrice,
  initialCurrency,
  returnPath,
  onCompleted,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: 'init' });
  const [currency, setCurrency] = useState<PaymentCurrencyCode>(asPaymentCurrency(initialCurrency));
  const [preferredMethod, setPreferredMethod] = useState<PaymentMethod>('ecocash');
  const [msisdn, setMsisdn] = useState('');
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const methods = methodsFor(currency);
  const method: PaymentMethod = methods.includes(preferredMethod)
    ? preferredMethod
    : (methods[0] ?? 'ecocash');

  const orderRef = useRef<Order | null>(null);
  // One idempotency key per payment attempt; reused if the same attempt is retried
  // (e.g. POST /payments timed out), replaced once that attempt has definitively failed.
  const attemptRef = useRef<{ key: string; fingerprint: string } | null>(null);
  const mountedRef = useRef(true);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleOutcome = useCallback((outcome: PollOutcome, paymentId: string) => {
    if (!mountedRef.current) return;
    if (outcome === 'completed') {
      attemptRef.current = null;
      setPhase({ name: 'completed' });
      onCompletedRef.current();
      return;
    }
    if (outcome === 'timeout') {
      setPhase((p) =>
        p.name === 'awaiting' ? { name: 'timeout', paymentId, amount: p.amount } : p,
      );
      return;
    }
    attemptRef.current = null; // next try is a new attempt with a new key
    setPhase({
      name: 'failed',
      message:
        outcome === 'reversed'
          ? 'The payment was reversed. You have not been charged.'
          : 'The payment was declined or cancelled. You have not been charged.',
    });
  }, []);

  const poller = usePaymentPolling(handleOutcome);

  // Sign-in gate + number prefill from the profile phone.
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
        setAccountPhone(me.phone_e164);
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

  function startWaiting(paymentId: string, amount: MoneyDTO, initial: PaymentState | null) {
    setPhase({ name: 'awaiting', paymentId, amount });
    poller.start(paymentId, initial); // a terminal `initial` settles immediately
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
    const provider = providerFor(currency, method);
    if (!provider) {
      setFormError(`${METHOD_LABEL[method]} isn't available for ${currency}.`);
      return;
    }
    // The API needs an MSISDN for every payment: the EcoCash wallet to prompt, or (for
    // cards) the account's own phone for the provider's records.
    const typed = normaliseMsisdn(msisdn.trim());
    const number = method === 'card' && accountPhone ? accountPhone : typed;
    if (!isE164(number)) {
      setFormError(
        method === 'card'
          ? 'Enter your phone number in international format, e.g. +263771234567.'
          : 'Enter your EcoCash number in international format, e.g. +263771234567.',
      );
      return;
    }
    if (method === 'ecocash') setMsisdn(number);
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

      if (payment.status !== 'initiated' && payment.status !== 'pending') {
        // Already settled (e.g. an idempotent replay of an attempt that finished).
        startWaiting(payment.payment_id, order.amount, payment.status);
        return;
      }

      if (method === 'card') {
        if (!isSafeRedirectUrl(payment.redirect_url)) {
          // e.g. an idempotent replay of an earlier attempt, which carries no redirect URL.
          attemptRef.current = null;
          setFormError('Could not open the card checkout. Please try again.');
          setPhase({ name: 'form' });
          return;
        }
        // Best-effort: if storage is blocked, /checkout/return explains what happened.
        stashPendingCardPayment({
          payment_id: payment.payment_id,
          return_path: returnPath,
          retry_path: currentPath(),
        });
        setPhase({ name: 'redirecting' });
        window.location.assign(payment.redirect_url);
        return;
      }

      startWaiting(payment.payment_id, order.amount, null);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      // Keep attemptRef: retrying this same attempt must reuse its idempotency key.
      setFormError(errorMessage(err, 'Could not start the payment. Please try again.'));
      setPhase({ name: 'form' });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (phase.name === 'init' || phase.name === 'redirecting') {
    return (
      <div className="flex flex-col items-center gap-3 py-10" aria-live="polite">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        {phase.name === 'redirecting' && (
          <p className="text-sm text-ink-mute">Taking you to secure card checkout…</p>
        )}
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
                onClick={() => startWaiting(phase.paymentId, phase.amount, null)}
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
        <DevSimulatePayment
          paymentId={phase.paymentId}
          onSimulated={() =>
            phase.name === 'awaiting'
              ? poller.pollNow()
              : startWaiting(phase.paymentId, phase.amount, null)
          }
        />
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
  const showNumberInput = method === 'ecocash' || !accountPhone;
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
              Charged in {currency} at today&rsquo;s rate; the exact amount is confirmed before you
              pay.
            </span>
          )}
        </p>
      )}

      <fieldset>
        <legend className="block text-sm font-medium mb-1.5">Pay in</legend>
        <div className="flex flex-wrap gap-2">
          {CURRENCIES.map((code) => (
            <button
              key={code}
              type="button"
              disabled={busy}
              aria-pressed={currency === code}
              onClick={() => setCurrency(code)}
              className={`text-sm font-medium px-4 py-2 rounded-md transition ${
                currency === code ? 'bg-accent text-bg' : 'bg-surface text-ink-mute hover:text-ink'
              }`}
            >
              {code}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="block text-sm font-medium mb-1.5">Pay with</legend>
        <div className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              aria-pressed={method === m}
              onClick={() => setPreferredMethod(m)}
              className={`text-sm font-medium px-4 py-2 rounded-md transition ${
                method === m ? 'bg-accent text-bg' : 'bg-surface text-ink-mute hover:text-ink'
              }`}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {method === 'card' && (
          <p className="mt-1 text-xs text-ink-dim">
            Visa / Mastercard via Paystack. You&rsquo;ll be sent to Paystack&rsquo;s secure page and
            brought back here.
          </p>
        )}
      </fieldset>

      {showNumberInput && (
        <div>
          <label htmlFor="checkout-msisdn" className="block text-sm font-medium mb-1.5">
            {method === 'ecocash' ? 'EcoCash number' : 'Phone number'}
          </label>
          <input
            id="checkout-msisdn"
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
          {method === 'ecocash' && (
            <p className="mt-1 text-xs text-ink-dim">
              You&rsquo;ll get a prompt on this phone to approve with your EcoCash PIN.
            </p>
          )}
        </div>
      )}

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
        {busy
          ? 'Starting payment…'
          : method === 'card'
            ? 'Continue to card payment'
            : 'Pay with EcoCash'}
      </button>
    </form>
  );
}
