'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../src/lib/api';
import { signInHref } from '../../src/lib/return-to';
import { useSession } from '../../src/lib/session';
import type { Video } from '../../src/types/api';
import { LinkButton } from '../../src/ui/button';
import { Icon } from '../../src/ui/icon';
import { Notice } from '../../src/ui/notice';
import { EmptyState, Skeleton } from '../../src/ui/state';
import VideoCard from '../components/VideoCard';
import {
  type CurrentSubscription,
  fetchSubscription,
  untilText,
} from '../components/account/subscription';
import { GRID } from '../components/viewer/VideoGrid';

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

/**
 * The viewer's library: Premium status, what they've watched, and what they've bought
 * (bought videos stay watchable even if the creator unpublishes them).
 */
export default function LibraryPage() {
  const user = useSession();
  const [checked, setChecked] = useState(false);
  const [history, setHistory] = useState<Load<Video[]>>({ status: 'loading' });
  const [bought, setBought] = useState<Load<Video[]>>({ status: 'loading' });
  const [sub, setSub] = useState<CurrentSubscription | null>(null);

  useEffect(() => setChecked(true), []);
  useEffect(() => {
    if (!user) return;
    api
      .get<{ items: Video[] }>('/watch/history?limit=24')
      .then((r) => setHistory({ status: 'ok', data: r.items }))
      .catch(() => setHistory({ status: 'error' }));
    api
      .get<{ items: Video[] }>('/purchases/me')
      .then((r) => setBought({ status: 'ok', data: r.items }))
      .catch(() => setBought({ status: 'error' }));
    void fetchSubscription().then(setSub);
  }, [user]);

  if (!checked) return null;
  if (!user) {
    return (
      <EmptyState
        title="Your library"
        action={
          <LinkButton href={signInHref('/library')} icon="user">
            Sign in
          </LinkButton>
        }
      >
        Sign in to see what you&apos;ve watched and the videos you&apos;ve bought.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-10 px-4 pt-6 md:px-6">
      <h1 className="text-2xl font-bold text-ink">Library</h1>

      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-4">
        <Icon name="premium" size={22} className="text-gold" />
        {sub ? (
          <p className="text-sm text-ink">
            Premium is active until <strong className="num">{untilText(sub.expiresAt)}</strong>.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              Premium unlocks every Premium video and course lesson. From $0.99 a day.
            </p>
            <LinkButton href="/pricing" size="sm" variant="secondary" className="ml-auto">
              See passes
            </LinkButton>
          </>
        )}
      </div>

      <Shelf title="History" icon="history" load={history} empty="Videos you watch show up here." />
      <Shelf
        title="Purchased"
        icon="lock"
        load={bought}
        empty="Videos you buy once are yours to rewatch. They show up here."
      />
    </div>
  );
}

function Shelf({
  title,
  icon,
  load,
  empty,
}: {
  title: string;
  icon: 'history' | 'lock';
  load: Load<Video[]>;
  empty: string;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
        <Icon name={icon} size={22} />
        {title}
      </h2>
      {load.status === 'loading' ? (
        <div className={GRID}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-video rounded-lg" />
          ))}
        </div>
      ) : load.status === 'error' ? (
        <Notice tone="error">Couldn&apos;t load this. Check your connection.</Notice>
      ) : load.data.length === 0 ? (
        <p className="text-sm text-ink-3">
          {empty}{' '}
          <Link href="/" className="font-semibold text-accent hover:underline">
            Browse videos
          </Link>
        </p>
      ) : (
        <ul className={GRID}>
          {load.data.map((v) => (
            <li key={v.id} className="min-w-0">
              <VideoCard video={v} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
