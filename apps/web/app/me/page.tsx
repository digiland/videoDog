'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/api';
import { clearTokens, isAuthenticated } from '../../src/lib/auth';
import type { User } from '../../src/types/api';

const CURRENCIES = ['USD', 'ZWG', 'ZAR'];
type Role = 'viewer' | 'creator' | 'admin';

const ROLE_BADGE: Record<Role, { label: string; tone: string }> = {
  viewer: { label: 'Viewer', tone: 'bg-surface text-ink-mute' },
  creator: { label: 'Creator', tone: 'bg-accent/15 text-accent' },
  admin: { label: 'Admin', tone: 'bg-warn/15 text-warn' },
};

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<
    | (User & {
        creator_application_state?: 'none' | 'pending' | 'approved' | 'rejected';
      })
    | null
  >(null);
  const [displayName, setDisplayName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/sign-in');
      return;
    }
    void loadUser();
  }, [router]);

  async function loadUser() {
    try {
      const me = await api.get<User & { creator_application_state?: string }>('/users/me');
      setUser(me as never);
      setDisplayName(me.display_name ?? '');
      setCurrency(me.preferred_display_currency ?? 'USD');
    } catch {
      router.push('/sign-in');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch<User>('/users/me', {
        display_name: displayName || null,
        preferred_display_currency: currency,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    clearTokens();
    window.location.assign('/');
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  const role: Role = (user.role as Role) ?? 'viewer';
  const badge = ROLE_BADGE[role];
  const appState = user.creator_application_state ?? 'none';

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 fade-up">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center text-bg font-bold text-2xl">
          {(user.display_name ?? user.phone_e164)[0]?.toUpperCase() ?? 'U'}
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            {user.display_name ?? user.handle ?? 'Your account'}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded ${badge.tone}`}>{badge.label}</span>
            <span className="text-xs text-ink-dim font-mono">{user.phone_e164}</span>
          </div>
        </div>
      </div>

      {/* Profile form */}
      <section className="bg-bg-elev border border-line rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Profile</h2>
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="What viewers see"
              className="w-full bg-surface border border-line focus:border-accent text-ink rounded-md px-4 py-2 placeholder:text-ink-dim focus:outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Display currency</label>
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
          {saved && (
            <div className="bg-ok/10 border border-ok/30 text-ok rounded-md px-4 py-3 text-sm">
              Saved
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="bg-accent hover:bg-accent-hot text-bg font-semibold py-2 px-5 rounded-md transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </section>

      {/* Role-specific card */}
      {role === 'viewer' && (
        <section className="bg-bg-elev border border-line rounded-lg p-6 mb-6">
          {appState === 'pending' ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-warn animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wide text-warn">
                  Application pending
                </span>
              </div>
              <h3 className="text-lg font-semibold">An admin will review shortly.</h3>
              <p className="text-ink-mute text-sm mt-1">
                Usually within 48 hours. You&rsquo;ll be notified.
              </p>
            </>
          ) : appState === 'rejected' ? (
            <>
              <h3 className="text-lg font-semibold">Application not accepted</h3>
              <p className="text-ink-mute text-sm mt-1">You can re-apply at any time.</p>
              <Link
                href="/me/apply"
                className="inline-block mt-3 text-accent text-sm font-semibold hover:underline"
              >
                Re-apply →
              </Link>
            </>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div>
                <h3 className="text-lg font-semibold">Become a creator</h3>
                <p className="text-ink-mute text-sm mt-1">
                  Upload your own videos. Admins review every applicant.
                </p>
              </div>
              <Link
                href="/me/apply"
                className="bg-accent hover:bg-accent-hot text-bg font-semibold py-2 px-5 rounded-md text-sm transition whitespace-nowrap"
              >
                Apply
              </Link>
            </div>
          )}
        </section>
      )}

      {role === 'creator' && (
        <section className="bg-bg-elev border border-line rounded-lg p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h3 className="text-lg font-semibold">Creator studio</h3>
            <p className="text-ink-mute text-sm mt-1">
              Pricing currency:{' '}
              <span className="font-mono text-ink">{user.canonical_pricing_currency ?? 'USD'}</span>
            </p>
          </div>
          <Link
            href="/studio"
            className="bg-accent hover:bg-accent-hot text-bg font-semibold py-2 px-5 rounded-md text-sm transition whitespace-nowrap"
          >
            Open Studio
          </Link>
        </section>
      )}

      {role === 'admin' && (
        <section className="bg-bg-elev border border-line rounded-lg p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h3 className="text-lg font-semibold">Creator applications</h3>
            <p className="text-ink-mute text-sm mt-1">Review pending requests.</p>
          </div>
          <Link
            href="/admin/applications"
            className="bg-warn hover:opacity-90 text-bg font-semibold py-2 px-5 rounded-md text-sm transition whitespace-nowrap"
          >
            Review queue
          </Link>
        </section>
      )}

      <button
        onClick={() => void handleSignOut()}
        className="text-sm text-ink-dim hover:text-accent transition"
      >
        Sign out
      </button>
    </div>
  );
}
