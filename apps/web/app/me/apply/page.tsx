'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../src/lib/api';
import { getRefreshToken, isAuthenticated } from '../../../src/lib/auth';
import { Button, LinkButton } from '../../../src/ui/button';
import { Icon } from '../../../src/ui/icon';
import { Notice } from '../../../src/ui/notice';
import { Segmented } from '../../../src/ui/segmented';
import { PayStatus } from '../../components/account/PayStatus';
import { errorText } from '../../components/account/errors';

type Currency = 'USD' | 'ZWG' | 'ZAR';
const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'ZWG', label: 'ZWG' },
  { value: 'ZAR', label: 'ZAR' },
];
const MIN = 20;
const MAX = 800;

export default function ApplyCreatorPage() {
  const router = useRouter();
  const [pitch, setPitch] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isAuthenticated() && !getRefreshToken()) router.push('/sign-in?return_to=%2Fme%2Fapply');
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
    } catch (err: unknown) {
      setError(errorText(err, 'Your application was not sent. Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  const length = pitch.trim().length;
  const tooShort = length < MIN;

  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 pt-10 pb-10">
        <PayStatus
          tone="success"
          title="Application sent"
          actions={
            <LinkButton href="/me" size="lg" block>
              Back to account
            </LinkButton>
          }
        >
          <p>
            An admin reviews every application, usually within 48 hours. We&rsquo;ll message you.
          </p>
        </PayStatus>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-4 pb-10 flex flex-col gap-6">
      <Link
        href="/me"
        className="inline-flex items-center gap-1 -ml-1 h-11 self-start text-sm font-semibold text-ink-2 hover:text-ink"
      >
        <Icon name="chevronLeft" size={18} />
        Account
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-ink">Become a creator</h1>
        <p className="text-base text-ink-2">
          Tell us what you&rsquo;d publish. An admin reads every application. Once approved you can
          upload, set prices and get paid to EcoCash.
        </p>
      </header>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="apply-pitch" className="text-sm font-medium text-ink">
            What will you make?
          </label>
          <textarea
            id="apply-pitch"
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            rows={6}
            maxLength={MAX}
            aria-describedby="apply-pitch-hint"
            placeholder="A weekly series on Harare's music scene…"
            className="w-full rounded border border-line bg-surface p-3 text-base text-ink placeholder:text-ink-3 outline-none focus:border-accent"
          />
          <p id="apply-pitch-hint" className="text-xs text-ink-3 num">
            {tooShort ? `At least ${MIN} characters · ` : ''}
            {length}/{MAX}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Segmented<Currency>
            legend="Price your videos in"
            value={currency}
            options={CURRENCIES}
            onChange={setCurrency}
          />
          <p className="text-xs text-ink-3">
            Locked once you&rsquo;re approved. Viewers can still pay in other currencies at the
            day&rsquo;s rate.
          </p>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <Button type="submit" size="lg" block loading={submitting} disabled={tooShort}>
          Send application
        </Button>
      </form>
    </div>
  );
}
