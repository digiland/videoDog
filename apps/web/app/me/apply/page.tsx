'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../src/lib/api';
import { isAuthenticated } from '../../../src/lib/auth';

const CURRENCIES = ['USD', 'ZWG', 'ZAR'];

export default function ApplyCreatorPage() {
  const router = useRouter();
  const [pitch, setPitch] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) router.push('/sign-in');
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/users/me/apply-creator', {
        pitch: pitch.trim(),
        canonical_currency: currency,
      });
      setDone(true);
      setTimeout(() => router.push('/me'), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit application.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center fade-up">
        <div className="w-12 h-12 mx-auto rounded-full bg-ok/20 flex items-center justify-center mb-4">
          <svg
            className="w-6 h-6 text-ok"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">Application submitted</h1>
        <p className="text-ink-mute text-sm mt-2">Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-10 fade-up">
      <h1 className="text-3xl font-bold">Become a creator</h1>
      <p className="text-ink-mute mt-2">
        Tell us what you&rsquo;d publish. Admins approve manually.
      </p>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="mt-8 space-y-5 bg-bg-elev border border-line rounded-lg p-6"
      >
        <div>
          <label className="block text-sm font-medium mb-1.5">What will you make?</label>
          <textarea
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            rows={6}
            placeholder="A weekly series on Harare's music scene…"
            className="w-full bg-surface border border-line focus:border-accent text-ink rounded-md p-3 placeholder:text-ink-dim focus:outline-none transition"
          />
          <p className="mt-1 text-xs text-ink-dim">{pitch.length}/800 · minimum 20 characters</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Pricing currency (locked once approved)
          </label>
          <div className="flex gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                className={`text-sm font-medium px-4 py-2 rounded-md transition ${
                  currency === c ? 'bg-accent text-bg' : 'bg-surface text-ink-mute hover:text-ink'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || pitch.trim().length < 20}
            className="bg-accent hover:bg-accent-hot text-bg font-semibold py-2.5 px-6 rounded-md text-sm transition disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/me')}
            className="text-sm text-ink-mute hover:text-ink transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
