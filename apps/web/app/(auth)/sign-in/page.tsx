'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeReturnTo } from '../../../src/lib/return-to';
import { Button } from '../../../src/ui/button';
import { Field } from '../../../src/ui/field';
import { AuthShell, AuthShellFallback } from '../../components/account/AuthShell';
import { readApiError } from '../../components/account/errors';
import { formatPhone, formatPhoneIntl, parsePhone, readLastPhone } from '../../../src/lib/phone';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

// useSearchParams() needs a Suspense boundary so the page can be statically prerendered.
export default function SignInPage() {
  return (
    <Suspense fallback={<AuthShellFallback />}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const returnTo = safeReturnTo(useSearchParams().get('return_to'));
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A returning viewer (token expired) gets their number back: one tap to a new code.
  useEffect(() => {
    const last = readLastPhone();
    if (last) setPhone((cur) => cur || formatPhone(last));
  }, []);

  const parsed = parsePhone(phone);

  function goVerify(e164: string) {
    const params = new URLSearchParams({ phone: e164 });
    if (returnTo) params.set('return_to', returnTo);
    router.push(`/verify?${params.toString()}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!parsed) {
      setError(
        phone.trim()
          ? 'That number looks incomplete. Zimbabwe numbers have 10 digits, like 077 123 4567.'
          : 'Enter your phone number.',
      );
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: parsed }),
      });
      if (!res.ok) {
        const err = await readApiError(res);
        // A code went out less than a minute ago: it is still good, so go and enter it.
        if (err.message?.includes('60 seconds')) {
          goVerify(parsed);
          return;
        }
        setError(
          err.message?.includes('per hour')
            ? 'Too many codes asked for this number. Try again in an hour.'
            : (err.message ?? 'Could not send the code. Try again.'),
        );
        return;
      }
      goVerify(parsed);
    } catch {
      setError('No connection. Check your data or Wi-Fi and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      lead={
        <>
          We&rsquo;ll send a 6-digit code to WhatsApp, or by SMS if this number has no WhatsApp. New
          here? This creates your account.
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
        <Field
          label="Phone number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          enterKeyHint="send"
          placeholder="077 123 4567"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setError(null);
          }}
          disabled={loading}
          error={error}
          hint={
            parsed ? (
              <>
                Code goes to <span className="num text-ink-2">{formatPhoneIntl(parsed)}</span>
              </>
            ) : (
              'Zimbabwe numbers can start with 07. Abroad? Start with + and your country code.'
            )
          }
        />
        <Button type="submit" size="lg" block loading={loading}>
          {loading ? 'Sending code' : 'Send code'}
        </Button>
      </form>
      <p className="text-xs text-ink-3">By continuing you agree to our terms.</p>
    </AuthShell>
  );
}
