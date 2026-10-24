'use client';
import { useState } from 'react';
import { api } from '../../src/lib/api';
import { isE164, normaliseMsisdn } from '../../src/lib/payments';
import type { User } from '../../src/types/api';
import { Button } from '../../src/ui/button';
import { Field } from '../../src/ui/field';
import { Icon } from '../../src/ui/icon';
import { Notice } from '../../src/ui/notice';

interface Props {
  /** The account's own phone (E.164): the OTP that authorises the change goes here. */
  accountPhone: string;
  savedMsisdn: string | null;
  onSaved: (msisdn: string | null) => void;
}

type Step = { name: 'view' } | { name: 'enter' } | { name: 'code'; msisdn: string };

/** "+263 77 100 0002": easier to check digit groups than a raw E.164 string. */
function pretty(e164: string): string {
  const m = /^\+263(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+263 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/**
 * Set / change the payout EcoCash number. The API only accepts the change with a one-time
 * code sent to the account's own phone, so a stolen session can't redirect payouts.
 */
export default function PayoutNumberSetup({ accountPhone, savedMsisdn, onSaved }: Props) {
  const [step, setStep] = useState<Step>(savedMsisdn ? { name: 'view' } : { name: 'enter' });
  const [msisdn, setMsisdn] = useState(savedMsisdn ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  function sendCode(): Promise<unknown> {
    return api.post('/auth/otp/request', { phone: accountPhone });
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const number = normaliseMsisdn(msisdn.trim());
    if (!isE164(number)) {
      setError('Enter the EcoCash number with the country code, e.g. +263771234567.');
      return;
    }
    setBusy(true);
    try {
      await sendCode();
      setMsisdn(number);
      setCode('');
      setResent(false);
      setStep({ name: 'code', msisdn: number });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setError(null);
    setBusy(true);
    try {
      await sendCode();
      setResent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent, number: string) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      const me = await api.post<Pick<User, 'payout_msisdn'>>('/users/me/payout-msisdn', {
        msisdn: number,
        otp_code: code,
      });
      onSaved(me.payout_msisdn);
      setStep({ name: 'view' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save the number.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {step.name === 'view' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
              <Icon name="phone" size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-ink-3">EcoCash</p>
              <p className="num text-base font-semibold text-ink">
                {savedMsisdn ? pretty(savedMsisdn) : 'Not set'}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setStep({ name: 'enter' });
            }}
          >
            {savedMsisdn ? 'Change' : 'Set number'}
          </Button>
        </div>
      )}

      {step.name === 'enter' && (
        <form onSubmit={(e) => void handleSendCode(e)} className="flex flex-col gap-3">
          <Field
            id="payout-msisdn"
            label={savedMsisdn ? 'New EcoCash number' : 'EcoCash number for payouts'}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={msisdn}
            onChange={(e) => {
              setMsisdn(e.target.value);
              setError(null);
            }}
            placeholder="+263771234567"
            disabled={busy}
            hint={
              <>
                To confirm it&rsquo;s you, we&rsquo;ll send a code to your account phone{' '}
                <span className="num">{pretty(accountPhone)}</span>.
              </>
            }
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" loading={busy}>
              Send code
            </Button>
            {savedMsisdn && (
              <Button variant="ghost" disabled={busy} onClick={() => setStep({ name: 'view' })}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {step.name === 'code' && (
        <form onSubmit={(e) => void handleSave(e, step.msisdn)} className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            Enter the 6-digit code sent to{' '}
            <span className="num text-ink">{pretty(accountPhone)}</span> to make{' '}
            <span className="num font-semibold text-ink">{pretty(step.msisdn)}</span> your payout
            number.
          </p>
          <Field
            id="payout-otp"
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            placeholder="123456"
            disabled={busy}
            className="max-w-48 [&_input]:tracking-widest"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Save payout number
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStep({ name: 'enter' })}>
              Back
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void handleResend()}>
              {resent ? 'Code sent again' : 'Resend code'}
            </Button>
          </div>
        </form>
      )}

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
