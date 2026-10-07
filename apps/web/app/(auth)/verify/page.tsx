'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { setTokens } from '../../../src/lib/auth';
import { isE164 } from '../../../src/lib/payments';
import { safeReturnTo, signInHref } from '../../../src/lib/return-to';
import { Button } from '../../../src/ui/button';
import { Icon } from '../../../src/ui/icon';
import { AuthShell, AuthShellFallback } from '../../components/account/AuthShell';
import { readApiError } from '../../components/account/errors';
import { formatPhone, rememberPhone } from '../../../src/lib/phone';
import { clock, useCountdown } from '../../components/account/useCountdown';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
const CODE_LENGTH = 6;
/** The API allows one code per number per minute. */
const RESEND_AFTER_S = 60;

// useSearchParams() needs a Suspense boundary so the page can be statically prerendered.
export default function VerifyPage() {
  return (
    <Suspense fallback={<AuthShellFallback />}>
      <VerifyForm />
    </Suspense>
  );
}

/** What went wrong, in words, from the API's error code. */
function codeError(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'OTP_INVALID':
      return 'That code is wrong. Check the latest message and try again.';
    case 'OTP_EXPIRED':
      return 'That code has expired. Send a new one below.';
    case 'OTP_LOCKED':
      return 'Too many wrong tries. Wait 15 minutes, then send a new code.';
    default:
      return message ?? 'Could not check the code. Try again.';
  }
}

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') ?? '';
  const returnTo = safeReturnTo(searchParams.get('return_to'));
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const { left, restart } = useCountdown(RESEND_AFTER_S);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef<string | null>(null);

  const validPhone = isE164(phone);
  const changeHref = signInHref(returnTo);

  useEffect(() => {
    if (!validPhone) router.replace(changeHref);
  }, [validPhone, changeHref, router]);

  // The one job on this page: open the number pad straight away, and again after a miss
  // (the input is disabled while checking, so this waits for that to finish).
  useEffect(() => {
    if (validPhone && !loading) inputRef.current?.focus();
  }, [validPhone, loading]);

  async function submitCode(value: string) {
    if (submittedRef.current === value) return; // same code already in flight
    submittedRef.current = value;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: value }),
      });
      if (!res.ok) {
        const err = await readApiError(res);
        setError(codeError(err.code, err.message));
        setCode('');
        submittedRef.current = null;
        return;
      }
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      setTokens(data.access_token, data.refresh_token);
      rememberPhone(phone);
      window.location.assign(returnTo ?? '/');
    } catch {
      submittedRef.current = null;
      setError('No connection. Check your data or Wi-Fi and try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleChange(raw: string) {
    // Keyboards, autofill and pasted messages can bring spaces or text along with digits.
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length === CODE_LENGTH) void submitCode(digits);
  }

  async function handleResend() {
    setResending(true);
    setResent(false);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const err = await readApiError(res);
        setError(
          err.message?.includes('per hour')
            ? 'Too many codes asked for this number. Try again in an hour.'
            : (err.message ?? 'Could not send a new code. Try again.'),
        );
      } else {
        setResent(true);
        setCode('');
        inputRef.current?.focus();
      }
      restart(RESEND_AFTER_S);
    } catch {
      setError('No connection. Check your data or Wi-Fi and try again.');
    } finally {
      setResending(false);
    }
  }

  if (!validPhone) return <AuthShellFallback />;

  return (
    <AuthShell
      title="Enter the code"
      back={
        <Link
          href={changeHref}
          className="inline-flex items-center gap-1 -ml-1 h-11 self-start text-sm font-semibold text-ink-2 hover:text-ink"
        >
          <Icon name="chevronLeft" size={18} />
          Change number
        </Link>
      }
      lead={
        <>
          Code sent by WhatsApp (or SMS) to{' '}
          <span className="num font-semibold text-ink whitespace-nowrap">{formatPhone(phone)}</span>
          .
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === CODE_LENGTH) void submitCode(code);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="otp" className="text-sm font-medium text-ink">
            6-digit code
          </label>
          <input
            ref={inputRef}
            id="otp"
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH + 4}
            value={code}
            onChange={(e) => handleChange(e.target.value)}
            disabled={loading}
            placeholder="••••••"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'otp-error' : undefined}
            className={`h-14 w-full rounded border bg-surface px-4 text-center text-3xl font-bold tracking-[0.5em] indent-[0.5em] num text-ink placeholder:text-ink-3 disabled:opacity-60 ${
              error ? 'border-danger' : 'border-line'
            }`}
          />
          {error && (
            <p id="otp-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          block
          loading={loading}
          disabled={code.length < CODE_LENGTH}
        >
          {loading ? 'Checking' : 'Verify'}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-1 text-sm" aria-live="polite">
        {resent && left > 0 && <p className="text-sage">New code sent.</p>}
        {left > 0 ? (
          <p className="h-11 flex items-center text-ink-3 num">
            Didn&rsquo;t get it? Resend in {clock(left)}
          </p>
        ) : (
          <Button variant="ghost" onClick={() => void handleResend()} loading={resending}>
            Resend code
          </Button>
        )}
      </div>
    </AuthShell>
  );
}
