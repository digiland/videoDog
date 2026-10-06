'use client';
import { useState } from 'react';
import { api } from '../../src/lib/api';
import { isE164, normaliseMsisdn } from '../../src/lib/payments';
import type { User } from '../../src/types/api';

interface Props {
  /** The account's own phone (E.164): the OTP that authorises the change goes here. */
  accountPhone: string;
  savedMsisdn: string | null;
  onSaved: (msisdn: string | null) => void;
}

type Step = { name: 'view' } | { name: 'enter' } | { name: 'code'; msisdn: string };

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
      setError('Enter the EcoCash number in international format, e.g. +263771234567.');
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

  const inputClass =
    'w-full bg-surface border border-line focus:border-accent text-ink rounded-md px-4 py-2 placeholder:text-ink-dim focus:outline-none transition font-mono';
  const primaryBtn =
    'bg-accent hover:bg-accent-hot text-bg font-semibold py-2 px-4 rounded-md text-sm transition disabled:opacity-50';
  const secondaryBtn =
    'bg-surface hover:bg-surface-2 border border-line font-semibold py-2 px-4 rounded-md text-sm transition disabled:opacity-50';

  return (
    <div className="space-y-3">
      {step.name === 'view' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Payouts go to EcoCash <span className="font-mono">{savedMsisdn ?? 'not set'}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep({ name: 'enter' });
            }}
            className={secondaryBtn}
          >
            {savedMsisdn ? 'Change payout number' : 'Set payout number'}
          </button>
        </div>
      )}

      {step.name === 'enter' && (
        <form onSubmit={(e) => void handleSendCode(e)} className="space-y-3">
          <div>
            <label htmlFor="payout-msisdn" className="block text-sm font-medium mb-1.5">
              {savedMsisdn ? 'New payout EcoCash number' : 'Payout EcoCash number'}
            </label>
            <input
              id="payout-msisdn"
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
              className={inputClass}
            />
            <p className="mt-1 text-xs text-ink-dim">
              To confirm it&rsquo;s you, we&rsquo;ll send a code to your account phone{' '}
              <span className="font-mono">{accountPhone}</span>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
            {savedMsisdn && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep({ name: 'view' })}
                className={secondaryBtn}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {step.name === 'code' && (
        <form onSubmit={(e) => void handleSave(e, step.msisdn)} className="space-y-3">
          <p className="text-sm text-ink-mute">
            Enter the 6-digit code sent to <span className="font-mono">{accountPhone}</span> to set{' '}
            <span className="font-mono text-ink">{step.msisdn}</span> as your payout number.
          </p>
          <div>
            <label htmlFor="payout-otp" className="block text-sm font-medium mb-1.5">
              Code
            </label>
            <input
              id="payout-otp"
              type="text"
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
              className={`${inputClass} tracking-widest`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || code.length !== 6} className={primaryBtn}>
              {busy ? 'Saving…' : 'Save payout number'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep({ name: 'enter' })}
              className={secondaryBtn}
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleResend()}
              className="text-xs text-ink-dim hover:text-accent transition disabled:opacity-50"
            >
              {resent ? 'Code resent' : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
