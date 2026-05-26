'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/api';
import { clearTokens, isAuthenticated } from '../../src/lib/auth';
import type { User } from '../../src/types/api';

const CURRENCIES = ['USD', 'ZWG', 'ZAR'];

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
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
      const me = await api.get<User>('/users/me');
      setUser(me);
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
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    clearTokens();
    router.push('/sign-in');
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#e94560] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Your Profile</h1>

      <div className="bg-[#16213e] rounded-2xl border border-[#1a1a2e]/50 p-6 mb-4">
        {/* Account info */}
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-700/50">
          <div className="w-14 h-14 rounded-full bg-[#e94560] flex items-center justify-center text-xl font-bold text-white">
            {(user.display_name ?? user.phone_e164)[0]?.toUpperCase() ?? 'U'}
          </div>
          <div>
            <p className="font-semibold text-white">
              {user.display_name ?? user.handle ?? 'No name set'}
            </p>
            <p className="text-sm text-gray-400 font-mono">{user.phone_e164}</p>
            <span className="text-xs bg-[#0f0f23] text-gray-400 px-2 py-0.5 rounded-full capitalize mt-1 inline-block">
              {user.role}
            </span>
          </div>
        </div>

        {/* Edit form */}
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-300 mb-1.5">
              Display name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your public name"
              className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-4 py-2.5 w-full focus:outline-none focus:border-[#e94560] transition placeholder:text-gray-600"
            />
          </div>

          <div>
            <label htmlFor="currency" className="block text-sm font-medium text-gray-300 mb-1.5">
              Display currency
            </label>
            <select
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-4 py-2.5 w-full focus:outline-none focus:border-[#e94560] transition"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {saved && (
            <div className="bg-green-900/30 border border-green-700/50 rounded-lg px-4 py-3 text-sm text-green-300">
              Profile saved!
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2.5 px-6 rounded-lg transition disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </form>
      </div>

      {/* Sign out */}
      <div className="bg-[#16213e] rounded-2xl border border-[#1a1a2e]/50 p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Account
        </h2>
        <button
          onClick={() => void handleSignOut()}
          className="text-red-400 hover:text-red-300 font-medium text-sm transition"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
