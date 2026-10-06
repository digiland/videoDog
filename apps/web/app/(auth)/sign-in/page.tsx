'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeReturnTo } from '../../../src/lib/return-to';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

// useSearchParams() needs a Suspense boundary so the page can be statically prerendered.
export default function SignInPage() {
  return (
    <Suspense fallback={<AuthCardFallback />}>
      <SignInForm />
    </Suspense>
  );
}

function AuthCardFallback() {
  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-6 py-12">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function SignInForm() {
  const router = useRouter();
  const returnTo = safeReturnTo(useSearchParams().get('return_to'));
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validatePhone(p: string): boolean {
    return /^\+[1-9]\d{7,14}$/.test(p.trim());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = phone.trim();
    if (!validatePhone(trimmed)) {
      setError('Enter a valid phone number, e.g. +263771234567');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'Failed to send code. Please try again.');
        return;
      }
      const params = new URLSearchParams({ phone: trimmed });
      if (returnTo) params.set('return_to', returnTo);
      router.push(`/verify?${params.toString()}`);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md bg-bg-elev border border-line rounded-lg p-8 fade-up">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-ink-mute text-sm mt-1">We&rsquo;ll send a 6-digit code to your phone.</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="phone" className="block text-sm font-medium mb-1.5">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError(null);
              }}
              placeholder="+263771234567"
              className="w-full bg-surface border border-line focus:border-accent text-ink rounded-md px-4 py-2.5 placeholder:text-ink-dim focus:outline-none transition"
              autoComplete="tel"
              inputMode="tel"
              disabled={loading}
            />
            <p className="mt-1 text-xs text-ink-dim">
              Include country code, e.g. +263 for Zimbabwe.
            </p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hot text-bg font-semibold py-3 rounded-md transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
                Sending code…
              </>
            ) : (
              'Send code'
            )}
          </button>
        </form>

        <p className="mt-6 text-xs text-ink-dim text-center">
          By continuing you agree to our terms.
        </p>
      </div>
    </div>
  );
}
