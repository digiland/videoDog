import type { Metadata } from 'next';
import Link from 'next/link';
import type { Video } from '../../src/types/api';
import { Icon } from '../../src/ui/icon';
import { EmptyState } from '../../src/ui/state';
import { API_BASE } from '../components/viewer/catalog';
import VideoGrid, { GridSection } from '../components/viewer/VideoGrid';

export const metadata: Metadata = { title: 'Live · StreamZW' };

async function streams(state: 'live' | 'upcoming'): Promise<Video[] | null> {
  try {
    const res = await fetch(`${API_BASE}/live?state=${state}`, { next: { revalidate: 15 } });
    if (!res.ok) return null;
    return ((await res.json()) as { items?: Video[] }).items ?? [];
  } catch {
    return null;
  }
}

/** Live now and coming up: concerts, matches, services and premieres. */
export default async function LivePage() {
  const [live, upcoming] = await Promise.all([streams('live'), streams('upcoming')]);
  const onAir = live ?? [];
  const soon = upcoming ?? [];
  const none = onAir.length + soon.length === 0;

  return (
    <GridSection>
      <div className="flex flex-col gap-1 pt-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
          <Icon name="live" size={26} className="text-danger" />
          Live
        </h1>
        <p className="text-sm text-ink-3">
          Watch as it happens. Paid streams can be bought before they start; recorded streams stay
          to rewatch.
        </p>
      </div>
      {live === null && upcoming === null ? (
        <EmptyState title="Couldn't load live streams">
          Check your connection, then try again.
        </EmptyState>
      ) : none ? (
        <EmptyState title="Nothing live right now">
          Streams appear here when creators go live or schedule one.{' '}
          <Link href="/" className="font-semibold text-accent hover:underline">
            Browse videos
          </Link>
        </EmptyState>
      ) : (
        <>
          {onAir.length > 0 && (
            <section aria-label="Live now" className="flex flex-col gap-3">
              <h2 className="text-xl font-bold text-ink">Live now</h2>
              <VideoGrid videos={onAir} label="Live now" />
            </section>
          )}
          {soon.length > 0 && (
            <section aria-label="Upcoming" className="flex flex-col gap-3">
              <h2 className="text-xl font-bold text-ink">Coming up</h2>
              <VideoGrid videos={soon} label="Upcoming" />
            </section>
          )}
        </>
      )}
    </GridSection>
  );
}
