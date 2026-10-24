'use client';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/api';
import { getRefreshToken, isAuthenticated } from '../../src/lib/auth';
import { formatMoney } from '../../src/lib/format';
import {
  isSafeRedirectUrl,
  newIdempotencyKey,
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
import { Button } from '../../src/ui/button';
import { Field } from '../../src/ui/field';
import { Icon } from '../../src/ui/icon';
import { Notice } from '../../src/ui/notice';
import { Price, PriceWithLocal } from '../../src/ui/price';
import { Segmented } from '../../src/ui/segmented';
import { Skeleton } from '../../src/ui/state';
import { PayStatus } from './account/PayStatus';
import { errorText } from './account/errors';
import {
  PAY_OPTIONS,
  type PayOption,
  optionFor,
  optionLabel,
  readLastOption,
  rememberOption,
  splitOption,
} from './account/payOptions';
import { formatPhone, parsePhone } from '../../src/lib/phone';
import { clock, useCountdown } from './account/useCountdown';
import DevSimulatePayment from './DevSimulatePayment';
import { type PollOutcome, usePaymentPolling } from './usePaymentPolling';

/** An EcoCash prompt lives about a minute; offer a fresh one only after that. */
const RESEND_PROMPT_AFTER_S = 60;

export type CheckoutTarget =
  | { kind: 'purchase'; videoId: string }
  | { kind: 'subscription'; planId: string };

/** What is being bought, shown at the top of every checkout state. */
export interface CheckoutItem {
  /** "Pay once, watch any time" / "Premium · 30 days" */
  caption: string;
  title: string;
  thumbnailUrl?: string | null;
  /** Extra line under the title, e.g. data cost. */
  meta?: ReactNode;
}

interface Props {
  target: CheckoutTarget;
  item?: CheckoutItem;
  /** Listed price, shown before the order is created. The server decides the charge. */
  listPrice?: MoneyDTO;
  /** Render-only approximations of the price in other currencies ("≈ ZWG 40.18"). */
  quotes?: MoneyDTO[];
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
  | { name: 'completed'; amount: MoneyDTO | null };

export default function Checkout({
  target,
  item,
  listPrice,
  quotes,
  initialCurrency,
  returnPath,
  onCompleted,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: 'init' });
  const [option, setOption] = useState<PayOption>('ecocash:USD');
  const [msisdn, setMsisdn] = useState('');
  const [editingNumber, setEditingNumber] = useState(false);
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const resendTimer = useCountdown(0);

  const { currency, method } = splitOption(option);

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
      setPhase((p) => ({
        name: 'completed',
        amount: p.name === 'awaiting' || p.name === 'timeout' ? p.amount : null,
      }));
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
          ? 'The payment was reversed, so the money is back with you.'
          : 'It was declined or cancelled on the phone. You have not been charged.',
    });
  }, []);

  const poller = usePaymentPolling(handleOutcome);

  // Sign-in gate, number prefill from the profile, and the way they paid last time.
  useEffect(() => {
    if (!isAuthenticated() && !getRefreshToken()) {
      // Come back to this checkout (purchase page or pricing) after signing in.
      router.replace(signInHref(currentPath()));
      return;
    }
    let cancelled = false;
    void (async () => {
      let profileCurrency: string | null = null;
      try {
        const me =
          await api.get<Pick<User, 'phone_e164' | 'preferred_display_currency'>>('/users/me');
        if (cancelled) return;
        setAccountPhone(me.phone_e164);
        setMsisdn((cur) => cur || me.phone_e164);
        profileCurrency = me.preferred_display_currency;
      } catch {
        // Prefill is a convenience; the number can still be typed.
        if (!cancelled) setEditingNumber(true);
      }
      if (cancelled) return;
      setOption(
        readLastOption() ??
          optionFor(initialCurrency) ??
          optionFor(profileCurrency) ??
          'ecocash:USD',
      );
      setPhase({ name: 'form' });
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

  async function pay() {
    setFormError(null);
    const provider = providerFor(currency, method);
    if (!provider) {
      setFormError(`${optionLabel(option)} isn't available. Pick another way to pay.`);
      return;
    }
    // The API needs an MSISDN for every payment: the EcoCash wallet to prompt, or (for
    // cards) the account's own phone for the provider's records.
    const typed = parsePhone(msisdn);
    const number = method === 'card' && accountPhone ? accountPhone : typed;
    if (!number) {
      setEditingNumber(true);
      setFormError(
        method === 'card'
          ? 'Enter your phone number, like 077 123 4567.'
          : 'Enter the EcoCash number to charge, like 077 123 4567.',
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
      rememberOption(option);
      setEditingNumber(false);

      if (payment.status !== 'initiated' && payment.status !== 'pending') {
        // Already settled (e.g. an idempotent replay of an attempt that finished).
        startWaiting(payment.payment_id, order.amount, payment.status);
        return;
      }

      if (method === 'card') {
        if (!isSafeRedirectUrl(payment.redirect_url)) {
          // e.g. an idempotent replay of an earlier attempt, which carries no redirect URL.
          attemptRef.current = null;
          setFormError('The card page did not open. Try again.');
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

      resendTimer.restart(RESEND_PROMPT_AFTER_S);
      startWaiting(payment.payment_id, order.amount, null);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      // Keep attemptRef: retrying this same attempt must reuse its idempotency key.
      setFormError(
        errorText(err, 'The payment did not start. Check your connection and try again.'),
      );
      setPhase({ name: 'form' });
    }
  }

  /**
   * A new EcoCash prompt for the same number. Only offered after the first prompt has had
   * time to lapse; it is a new attempt (new key). If both somehow go through, the API books
   * the second as a refund due rather than charging for the video twice.
   */
  function resendPrompt() {
    poller.stop();
    attemptRef.current = null;
    void pay();
  }

  function changeNumber() {
    // Keep the attempt's key: resubmitting the same number/currency returns this same
    // payment instead of sending a second charge. A different number is a new attempt.
    poller.stop();
    setEditingNumber(true);
    setPhase({ name: 'form' });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const exact = listPrice && listPrice.currency === currency ? listPrice : null;
  const approx = exact ? null : (quotes?.find((q) => q.currency === currency) ?? null);
  const settledAmount =
    phase.name === 'awaiting' || phase.name === 'timeout'
      ? phase.amount
      : phase.name === 'completed'
        ? phase.amount
        : null;

  const summary = (item || listPrice) && (
    <div className="flex items-start gap-3 pb-4 border-b border-line">
      {item?.thumbnailUrl && (
        <img
          src={item.thumbnailUrl}
          alt=""
          width={96}
          height={54}
          loading="lazy"
          decoding="async"
          className="w-24 aspect-video shrink-0 rounded-md object-cover bg-surface-2"
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {item && <p className="text-xs font-semibold text-ink-3">{item.caption}</p>}
        {item && <p className="font-semibold text-ink line-clamp-2 break-words">{item.title}</p>}
        {item?.meta}
      </div>
      {(settledAmount ?? listPrice) && (
        <div className="shrink-0 text-right text-lg">
          {settledAmount ? (
            <Price money={settledAmount} className="font-bold text-ink" />
          ) : (
            listPrice && <PriceWithLocal price={listPrice} local={approx} />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {summary}
      {renderBody()}
    </div>
  );

  function renderBody() {
    if (phase.name === 'init') {
      return (
        <div className="flex flex-col gap-5" aria-busy>
          <Skeleton className="h-[100px]" />
          <Skeleton className="h-11" />
          <Skeleton className="h-12" />
        </div>
      );
    }

    if (phase.name === 'redirecting') {
      return (
        <PayStatus tone="wait" title="Opening the card page">
          <p>Paystack&rsquo;s secure page will ask for your card. You come back here after.</p>
        </PayStatus>
      );
    }

    if (phase.name === 'completed') {
      return (
        <PayStatus tone="success" title="Paid">
          <p>
            {phase.amount ? (
              <>
                <Price money={phase.amount} className="font-semibold text-ink" /> received.{' '}
              </>
            ) : null}
            You&rsquo;re all set.
          </p>
        </PayStatus>
      );
    }

    if (phase.name === 'awaiting' || phase.name === 'timeout') {
      const where = method === 'ecocash' ? formatPhone(msisdn) : null;
      const dev = (
        <DevSimulatePayment
          paymentId={phase.paymentId}
          onSimulated={() =>
            phase.name === 'awaiting'
              ? poller.pollNow()
              : startWaiting(phase.paymentId, phase.amount, null)
          }
        />
      );
      if (phase.name === 'timeout') {
        return (
          <>
            <PayStatus
              tone="info"
              title={
                method === 'ecocash' ? 'No answer from EcoCash yet' : 'No answer from the card yet'
              }
              actions={
                <>
                  <Button
                    size="lg"
                    block
                    onClick={() => startWaiting(phase.paymentId, phase.amount, null)}
                  >
                    Check again
                  </Button>
                  {method === 'ecocash' && (
                    <Button variant="secondary" size="lg" block onClick={changeNumber}>
                      Use another number
                    </Button>
                  )}
                </>
              }
            >
              <p>
                If you approved it, confirmation can take a few minutes. Checking again never
                charges you twice.
              </p>
            </PayStatus>
            {dev}
          </>
        );
      }
      return (
        <>
          <PayStatus
            tone="wait"
            title={method === 'ecocash' ? 'Check your phone' : 'Confirming your card payment'}
          >
            {where ? (
              <>
                <p className="text-base text-ink">
                  Approve the prompt on <span className="num font-semibold">{where}</span>. Enter
                  your EcoCash PIN on your phone.
                </p>
                <p>This page updates by itself once EcoCash confirms.</p>
              </>
            ) : (
              <p>This page updates by itself.</p>
            )}
          </PayStatus>
          {method === 'ecocash' && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="text-sm text-ink-3">Didn&rsquo;t get the prompt?</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  disabled={resendTimer.left > 0}
                  onClick={resendPrompt}
                  className="num"
                >
                  {resendTimer.left > 0 ? `Resend in ${clock(resendTimer.left)}` : 'Resend'}
                </Button>
                <Button variant="secondary" onClick={changeNumber}>
                  Change number
                </Button>
              </div>
            </div>
          )}
          {dev}
        </>
      );
    }

    if (phase.name === 'failed') {
      return (
        <PayStatus
          tone="error"
          title={method === 'ecocash' ? 'EcoCash payment failed' : 'Card payment failed'}
          actions={
            <>
              <Button size="lg" block onClick={() => setPhase({ name: 'form' })}>
                Try again
              </Button>
              {method === 'ecocash' && (
                <Button variant="ghost" block onClick={changeNumber}>
                  Use another number
                </Button>
              )}
            </>
          }
        >
          <p>{phase.message}</p>
        </PayStatus>
      );
    }

    const busy = phase.name === 'submitting';
    const showNumberField = method === 'ecocash' ? editingNumber || !msisdn : !accountPhone;
    const amountText = exact
      ? formatMoney(exact.amount_minor, exact.currency)
      : approx
        ? `≈ ${formatMoney(approx.amount_minor, approx.currency)}`
        : listPrice
          ? `in ${currency}`
          : '';
    const payLabel = `Pay${amountText ? ` ${amountText}` : ''} ${
      method === 'ecocash' ? 'with EcoCash' : 'by card'
    }`;

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void pay();
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        <Segmented<PayOption>
          legend="Pay with"
          value={option}
          options={PAY_OPTIONS.map((o) => ({ value: o, label: optionLabel(o), disabled: busy }))}
          onChange={(o) => {
            setOption(o);
            setFormError(null);
          }}
        />

        {method === 'ecocash' &&
          (showNumberField ? (
            <Field
              label="EcoCash number"
              name="msisdn"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="077 123 4567"
              value={msisdn.startsWith('+263') ? formatPhone(msisdn) : msisdn}
              onChange={(e) => {
                setMsisdn(e.target.value);
                setFormError(null);
              }}
              disabled={busy}
              hint="The approval prompt goes to this phone."
            />
          ) : (
            <div className="flex items-center gap-3 min-h-11 rounded border border-line bg-surface pl-3 pr-1">
              <Icon name="phone" size={18} className="text-ink-3 shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col leading-tight py-1.5">
                <span className="text-xs text-ink-3">Prompt goes to</span>
                <span className="num font-semibold text-ink">{formatPhone(msisdn)}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditingNumber(true)}>
                Change
              </Button>
            </div>
          ))}

        {method === 'card' && !accountPhone && (
          <Field
            label="Phone number"
            name="msisdn"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+27 82 123 4567"
            value={msisdn}
            onChange={(e) => {
              setMsisdn(e.target.value);
              setFormError(null);
            }}
            disabled={busy}
          />
        )}

        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="flex flex-col gap-2">
          <Button type="submit" size="lg" block loading={busy}>
            {busy ? 'Starting payment' : payLabel}
          </Button>
          <p className="text-xs text-ink-3 text-center">
            {method === 'ecocash'
              ? 'You approve it on your phone with your EcoCash PIN.'
              : 'Opens Paystack’s secure card page, then brings you back.'}
            {!exact && listPrice && (
              <>
                {' '}
                Charged in {currency} at today&rsquo;s rate; the exact amount shows before you
                approve.
              </>
            )}
          </p>
        </div>
      </form>
    );
  }
}
