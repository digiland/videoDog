'use client';
import { type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/api';
import { clearTokens, getRefreshToken, isAuthenticated } from '../../src/lib/auth';
import type { User } from '../../src/types/api';
import { Button } from '../../src/ui/button';
import { Field } from '../../src/ui/field';
import { Icon } from '../../src/ui/icon';
import { Notice } from '../../src/ui/notice';
import { Price } from '../../src/ui/price';
import { Segmented } from '../../src/ui/segmented';
import { Skeleton } from '../../src/ui/state';
import { DataSaverToggle } from '../components/account/DataSaverToggle';
import { errorText } from '../components/account/errors';
import { formatPhone } from '../../src/lib/phone';
import {
  type CurrentSubscription,
  fetchSubscription,
  untilText,
} from '../components/account/subscription';

type Currency = 'USD' | 'ZWG' | 'ZAR';
const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'ZWG', label: 'ZWG' },
  { value: 'ZAR', label: 'ZAR' },
];

const KYC_LABEL: Record<User['kyc_state'], string> = {
  none: 'Not verified',
  phone_verified: 'Phone verified',
  id_verified: 'ID verified',
};

type Me = User & { creator_application_state?: 'none' | 'pending' | 'approved' | 'rejected' };

function asCurrency(c: string | null | undefined): Currency {
  return c === 'ZWG' || c === 'ZAR' ? c : 'USD';
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [sub, setSub] = useState<CurrentSubscription | null | undefined>(undefined);
  const [displayName, setDisplayName] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!isAuthenticated() && !getRefreshToken()) {
      router.push('/sign-in?return_to=%2Fme');
      return;
    }
    void (async () => {
      try {
        const me = await api.get<Me>('/users/me');
        setUser(me);
        setDisplayName(me.display_name ?? '');
        setCurrency(asCurrency(me.preferred_display_currency));
      } catch {
        router.push('/sign-in?return_to=%2Fme');
        return;
      }
      setSub(await fetchSubscription());
    })();
  }, [router]);

  const dirty =
    !!user &&
    (displayName.trim() !== (user.display_name ?? '') ||
      currency !== asCurrency(user.preferred_display_currency));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const name = displayName.trim();
      await api.patch<User>('/users/me', {
        display_name: name || null,
        preferred_display_currency: currency,
      });
      setUser({ ...user, display_name: name || null, preferred_display_currency: currency });
      setSaved(true);
    } catch (err: unknown) {
      setError(errorText(err, 'Not saved. Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      // The server revokes the refresh token it is given; without one it can't.
      await api.post('/auth/logout', { refresh_token: getRefreshToken() });
    } catch {
      // signing out locally is what matters
    }
    clearTokens();
    window.location.assign('/');
  }

  if (!user) return <MeSkeleton />;

  const appState = user.creator_application_state ?? 'none';
  const name = user.display_name ?? user.handle ?? 'Your account';

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-10 flex flex-col gap-8 sm:pt-10">
      <header className="flex items-center gap-4">
        <span className="flex items-center justify-center w-14 h-14 shrink-0 rounded-full bg-surface-2 text-xl font-bold text-ink">
          {name[0]?.toUpperCase() ?? 'U'}
        </span>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-ink truncate">{name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span className="num">{formatPhone(user.phone_e164)}</span>
            {user.role !== 'viewer' && (
              <span
                className={`inline-flex items-center h-6 px-2 rounded-full bg-surface-2 text-xs font-semibold ${
                  user.role === 'admin' ? 'text-gold' : 'text-accent'
                }`}
              >
                {user.role === 'admin' ? 'Admin' : 'Creator'}
              </span>
            )}
          </p>
        </div>
      </header>

      <Group title="Premium">
        <SubscriptionRow sub={sub} onChange={setSub} />
      </Group>

      <Group title="Playback">
        <DataSaverToggle />
      </Group>

      <Group title="Profile">
        <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-5 p-4">
          <Field
            label="Display name"
            name="display_name"
            autoComplete="nickname"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
            placeholder="The name people see"
            maxLength={60}
          />
          <div className="flex flex-col gap-1.5">
            <Segmented<Currency>
              legend="Show prices in"
              value={currency}
              options={CURRENCIES}
              onChange={(c) => {
                setCurrency(c);
                setSaved(false);
              }}
            />
            <p className="text-xs text-ink-3">
              Other currencies show as ≈ a guide. You still choose how to pay at checkout.
            </p>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex items-center gap-3">
            {(dirty || saving) && (
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
            )}
            {saved && !dirty && (
              <output className="inline-flex items-center gap-1 text-sm text-sage">
                <Icon name="check" size={16} />
                Saved
              </output>
            )}
          </div>
        </form>
      </Group>

      {user.role === 'viewer' && (
        <Group title="Creators">
          <CreatorApplication state={appState} />
        </Group>
      )}

      {user.role === 'creator' && (
        <Group title="Creator">
          <LinkRow
            href="/studio"
            title="Creator studio"
            detail={`Upload, set prices and see earnings. You price in ${user.canonical_pricing_currency ?? 'USD'}.`}
          />
          <KycSection kycState={user.kyc_state} />
        </Group>
      )}

      {user.role === 'admin' && (
        <Group title="Admin">
          <LinkRow
            href="/admin/applications"
            title="Creator applications"
            detail="Review people who asked to publish."
          />
        </Group>
      )}

      <Button
        variant="ghost"
        size="lg"
        icon="close"
        loading={signingOut}
        onClick={() => void handleSignOut()}
        className="self-start -ml-2 text-danger hover:text-danger"
      >
        Sign out
      </Button>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink-3 px-1">{title}</h2>
      <div className="rounded border border-line bg-surface divide-y divide-line overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function LinkRow({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 min-h-[64px] px-4 py-3 hover:bg-surface-2 transition-colors"
    >
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-base font-semibold text-ink">{title}</span>
        <span className="text-sm text-ink-2">{detail}</span>
      </span>
      <Icon name="chevronRight" size={20} className="text-ink-3 shrink-0" />
    </Link>
  );
}

function SubscriptionRow({
  sub,
  onChange,
}: {
  sub: CurrentSubscription | null | undefined;
  onChange: (s: CurrentSubscription | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sub === undefined) {
    return (
      <div className="p-4">
        <Skeleton className="h-10" />
      </div>
    );
  }

  if (!sub) {
    return (
      <LinkRow
        href="/pricing"
        title="Get Premium"
        detail="Every Premium video for one price. Day pass or month."
      />
    );
  }

  async function stopRenewing() {
    if (!sub) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/subscriptions/me/cancel');
      onChange({ ...sub, autoRenew: false });
    } catch (err: unknown) {
      setError(errorText(err, 'Could not change this. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Icon name="check" size={22} className="text-gold shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-base font-semibold text-ink">
            Premium until <span className="num">{untilText(sub.expiresAt)}</span>
          </p>
          <p className="text-sm text-ink-2">
            {sub.charged && (
              <>
                Paid <Price money={sub.charged} />.{' '}
              </>
            )}
            {sub.autoRenew ? 'Renews when it ends.' : 'Won’t renew. It just ends.'}
          </p>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {sub.autoRenew && (
        <Button
          variant="secondary"
          size="md"
          loading={busy}
          onClick={() => void stopRenewing()}
          className="self-start"
        >
          Stop renewing
        </Button>
      )}
    </div>
  );
}

function CreatorApplication({ state }: { state: 'none' | 'pending' | 'approved' | 'rejected' }) {
  if (state === 'pending') {
    return (
      <div className="flex items-start gap-3 p-4">
        <Icon name="alert" size={22} className="text-gold shrink-0 mt-0.5" />
        <div className="flex flex-col">
          <p className="text-base font-semibold text-ink">Application sent</p>
          <p className="text-sm text-ink-2">
            An admin reviews it, usually within 48 hours. We&rsquo;ll message you.
          </p>
        </div>
      </div>
    );
  }
  return (
    <LinkRow
      href="/me/apply"
      title={state === 'rejected' ? 'Apply again to publish' : 'Publish your own videos'}
      detail={
        state === 'rejected'
          ? 'Your last application was not accepted. You can apply again any time.'
          : 'Apply to become a creator and earn from your videos.'
      }
    />
  );
}

function KycSection({ kycState }: { kycState: User['kyc_state'] }) {
  const [nationalId, setNationalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nationalId.trim()) {
      setError('Enter your national ID number.');
      return;
    }
    setBusy(true);
    try {
      await api.post<{ status: string }>('/users/me/kyc/id', { national_id: nationalId.trim() });
      setSubmitted(true);
      setNationalId('');
    } catch (err: unknown) {
      // The API's validation messages are written for people; show them as-is.
      setError(errorText(err, 'Your ID was not sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const verified = kycState === 'id_verified';
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-ink">Verify your identity</p>
        <span
          className={`inline-flex items-center h-6 px-2 rounded-full bg-surface-2 text-xs font-semibold ${
            verified ? 'text-sage' : 'text-ink-2'
          }`}
        >
          {KYC_LABEL[kycState] ?? kycState}
        </span>
      </div>
      {verified ? (
        <p className="text-sm text-ink-2">Your national ID is verified. Payouts are unlocked.</p>
      ) : submitted ? (
        <Notice tone="success">Sent. Our team will review it.</Notice>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <p className="text-sm text-ink-2">
            Add your Zimbabwe national ID so we can verify payouts. It&rsquo;s stored encrypted and
            only our team sees it.
          </p>
          <Field
            label="National ID number"
            name="national_id"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={nationalId}
            onChange={(e) => {
              setNationalId(e.target.value);
              setError(null);
            }}
            placeholder="63-123456 A 12"
            disabled={busy}
            error={error}
          />
          <Button type="submit" variant="secondary" loading={busy} className="self-start">
            Send for review
          </Button>
        </form>
      )}
    </div>
  );
}

function MeSkeleton() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-10 flex flex-col gap-8 sm:pt-10" aria-busy>
      <div className="flex items-center gap-4">
        <Skeleton className="w-14 h-14 rounded-full" />
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <Skeleton className="h-[72px]" />
      <Skeleton className="h-[72px]" />
      <Skeleton className="h-[220px]" />
    </div>
  );
}
