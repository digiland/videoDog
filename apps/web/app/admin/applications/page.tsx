'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../src/lib/api';
import { getUser, isAuthenticated } from '../../../src/lib/auth';
import { Button } from '../../../src/ui/button';
import { Notice } from '../../../src/ui/notice';
import { EmptyState, Skeleton } from '../../../src/ui/state';
import { errorText } from '../../components/account/errors';
import { formatPhone } from '../../../src/lib/phone';
import { shortDate } from '../../components/account/subscription';

interface Application {
  id: string;
  phoneE164: string;
  handle: string | null;
  displayName: string | null;
  creatorApplicationPitch: string | null;
  creatorApplicationAt: string | null;
  canonicalPricingCurrency: string | null;
}

type Decision = 'pending' | 'approved' | 'rejected';

const CHIP: Record<Decision, { label: string; tone: string }> = {
  pending: { label: 'Pending', tone: 'text-gold' },
  approved: { label: 'Approved', tone: 'text-sage' },
  rejected: { label: 'Rejected', tone: 'text-ink-3' },
};

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-full bg-surface-2 text-xs font-semibold num ${tone}`}
    >
      {children}
    </span>
  );
}

export default function AdminApplicationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Application[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/sign-in?return_to=%2Fadmin%2Fapplications');
      return;
    }
    if (getUser()?.role !== 'admin') {
      router.push('/');
      return;
    }
    void (async () => {
      try {
        const data = await api.get<{ items: Application[] }>('/admin/creator-applications');
        setItems(data.items);
      } catch (err: unknown) {
        setError(errorText(err, 'Applications did not load. Try again.'));
        setItems([]);
      }
    })();
  }, [router]);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy({ id, action });
    setError(null);
    try {
      await api.post(`/admin/creator-applications/${encodeURIComponent(id)}/${action}`);
      // Keep the row with its new state, so the list doesn't jump under the next tap.
      setDecisions((d) => ({ ...d, [id]: action === 'approve' ? 'approved' : 'rejected' }));
    } catch (err: unknown) {
      setError(errorText(err, 'That did not go through. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  const pendingCount = items?.filter((a) => !decisions[a.id]).length ?? 0;

  return (
    <div className="max-w-screen-lg mx-auto px-4 pt-6 pb-10 flex flex-col gap-6 sm:pt-10">
      <header className="flex flex-col gap-2">
        <div>
          <Chip tone="text-gold">Admin</Chip>
        </div>
        <h1 className="text-2xl font-bold text-ink">Creator applications</h1>
        <p className="text-base text-ink-2">
          Approving lets them upload, price videos and get paid.{' '}
          {items && items.length > 0 && (
            <span className="num text-ink">{pendingCount} waiting.</span>
          )}
        </p>
      </header>

      {error && <Notice tone="error">{error}</Notice>}

      {items === null ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} className="h-28" />
          ))}
        </div>
      ) : items.length === 0 ? (
        !error && (
          <div className="rounded border border-line">
            <EmptyState title="All clear">No one is waiting for a decision.</EmptyState>
          </div>
        )
      ) : (
        <ul className="flex flex-col rounded border border-line divide-y divide-line">
          {items.map((a) => {
            const state: Decision = decisions[a.id] ?? 'pending';
            const chip = CHIP[state];
            const rowBusy = busy?.id === a.id;
            return (
              <li
                key={a.id}
                className={`flex flex-col gap-3 p-4 md:flex-row md:items-start md:gap-6 ${
                  state === 'pending' ? '' : 'opacity-70'
                }`}
              >
                <div className="flex flex-col gap-1 md:w-60 md:shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-ink break-words">
                      {a.displayName ?? a.handle ?? 'No name yet'}
                    </p>
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  </div>
                  <p className="text-sm text-ink-2 num">{formatPhone(a.phoneE164)}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <Chip tone="text-ink-2">Prices in {a.canonicalPricingCurrency ?? 'USD'}</Chip>
                    {a.creatorApplicationAt && (
                      <span className="num">Applied {shortDate(a.creatorApplicationAt)}</span>
                    )}
                  </div>
                </div>
                <p className="flex-1 min-w-0 text-sm text-ink whitespace-pre-wrap break-words">
                  {a.creatorApplicationPitch ?? (
                    <span className="text-ink-3">No pitch written.</span>
                  )}
                </p>
                {state === 'pending' && (
                  <div className="flex gap-2 md:flex-col md:w-32 md:shrink-0">
                    <Button
                      className="flex-1 md:flex-none"
                      loading={rowBusy && busy?.action === 'approve'}
                      disabled={rowBusy}
                      onClick={() => void decide(a.id, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      className="flex-1 md:flex-none"
                      loading={rowBusy && busy?.action === 'reject'}
                      disabled={rowBusy}
                      onClick={() => void decide(a.id, 'reject')}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
