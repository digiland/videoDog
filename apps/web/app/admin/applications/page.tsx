'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../src/lib/api';
import { getUser, isAuthenticated } from '../../../src/lib/auth';

interface Application {
  id: string;
  phoneE164: string;
  handle: string | null;
  displayName: string | null;
  creatorApplicationPitch: string | null;
  creatorApplicationAt: string | null;
  canonicalPricingCurrency: string | null;
}

export default function AdminApplicationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Application[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/sign-in');
      return;
    }
    const u = getUser();
    if (u?.role !== 'admin') {
      router.push('/');
      return;
    }
    void load();
  }, [router]);

  async function load() {
    try {
      const data = await api.get<{ items: Application[] }>('/admin/creator-applications');
      setItems(data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusyId(id);
    try {
      await api.post(`/admin/creator-applications/${id}/${action}`);
      setItems((prev) => prev?.filter((a) => a.id !== id) ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 fade-up">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide bg-warn/15 text-warn px-2 py-0.5 rounded">
          Admin
        </span>
      </div>
      <h1 className="text-3xl font-bold">Creator applications</h1>
      <p className="text-ink-mute mt-1">
        Approve to grant creator privileges and unlock the studio.
      </p>

      {error && (
        <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="mt-8 space-y-4">
        {items === null ? (
          <div className="bg-bg-elev border border-line rounded-lg p-10 text-center text-ink-dim text-sm">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="bg-bg-elev border border-line rounded-lg p-10 text-center">
            <p className="text-lg font-semibold">All clear</p>
            <p className="text-ink-dim text-sm mt-1">No pending applications.</p>
          </div>
        ) : (
          items.map((a) => (
            <article
              key={a.id}
              className="bg-bg-elev border border-line rounded-lg p-6 grid md:grid-cols-12 gap-4"
            >
              <div className="md:col-span-3">
                <p className="text-xs text-ink-dim uppercase tracking-wide">Applicant</p>
                <p className="font-semibold mt-1">{a.displayName ?? a.handle ?? 'Unnamed'}</p>
                <p className="text-xs text-ink-dim font-mono mt-1">{a.phoneE164}</p>
                <div className="mt-3 text-xs text-ink-mute space-y-1">
                  <div>
                    Currency:{' '}
                    <span className="font-mono text-ink">{a.canonicalPricingCurrency ?? '—'}</span>
                  </div>
                  <div>
                    Applied:{' '}
                    {a.creatorApplicationAt
                      ? new Date(a.creatorApplicationAt).toLocaleString()
                      : '—'}
                  </div>
                </div>
              </div>
              <div className="md:col-span-6">
                <p className="text-xs text-ink-dim uppercase tracking-wide">Pitch</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">
                  {a.creatorApplicationPitch ?? '—'}
                </p>
              </div>
              <div className="md:col-span-3 flex md:flex-col gap-2">
                <button
                  onClick={() => void decide(a.id, 'approve')}
                  disabled={busyId === a.id}
                  className="flex-1 bg-ok hover:opacity-90 text-bg font-semibold py-2 px-4 rounded-md text-sm transition disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => void decide(a.id, 'reject')}
                  disabled={busyId === a.id}
                  className="flex-1 bg-surface hover:bg-surface-2 text-ink-mute hover:text-ink font-semibold py-2 px-4 rounded-md text-sm transition disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
