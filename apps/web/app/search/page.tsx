import Link from 'next/link';
import type { Metadata } from 'next';
import type { Channel, CollectionSummary, Video } from '../../src/types/api';
import { Avatar } from '../../src/ui/avatar';
import { EmptyState } from '../../src/ui/state';
import { VideoRow } from '../components/VideoCard';
import {
  API_BASE,
  apiMode,
  type ModeKey,
  parseCategory,
  parseMode,
} from '../components/viewer/catalog';
import CollectionCard from '../components/viewer/CollectionCard';
import FilterChips from '../components/viewer/FilterChips';
import { GridSection } from '../components/viewer/VideoGrid';
import SearchForm from './SearchForm';

export const metadata: Metadata = { title: 'Search · StreamZW' };

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function href(q: string, f: { category: string | null; mode: ModeKey }): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (f.category) params.set('category', f.category);
  if (f.mode !== 'all') params.set('mode', f.mode);
  const s = params.toString();
  return s ? `/search?${s}` : '/search';
}

/**
 * Results in YouTube's order: matching channels, then courses and playlists, then videos
 * as wide rows (thumbnail left, details right). Topic and price chips narrow the videos.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string; category?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 200);
  const mode = parseMode(params.mode);
  const category = parseCategory(params.category);
  const filtered = mode !== 'all' || category !== null;

  const vp = new URLSearchParams({ q, limit: '48' });
  const api = apiMode(mode);
  if (api) vp.set('mode', api);
  if (category) vp.set('category', category);
  const [videos, collections, channels] = q
    ? await Promise.all([
        getJson<{ items: Video[] }>(`/search?${vp.toString()}`),
        filtered
          ? null
          : getJson<{ items: CollectionSummary[] }>(
              `/collections?q=${encodeURIComponent(q)}&limit=4`,
            ),
        filtered ? null : getJson<{ items: Channel[] }>(`/channels?q=${encodeURIComponent(q)}`),
      ])
    : [null, null, null];
  const vids = videos?.items ?? [];
  const cols = collections?.items ?? [];
  const chans = channels?.items ?? [];
  const nothing = vids.length + cols.length + chans.length === 0;

  return (
    <GridSection>
      <h1 className="sr-only">Search</h1>
      <div className="md:hidden">
        <SearchForm key={q} initialQuery={q} mode={mode} />
      </div>
      {q && <FilterChips category={category} mode={mode} hrefFor={(f) => href(q, f)} />}

      {!q ? (
        <EmptyState title="Find something to watch">
          Search by title, topic or creator, like &ldquo;algebra&rdquo;, &ldquo;mbira&rdquo; or
          &ldquo;football&rdquo;.
        </EmptyState>
      ) : videos === null ? (
        <EmptyState title="Search isn't working right now">
          Check your connection, then search again.
        </EmptyState>
      ) : nothing ? (
        <EmptyState title={`Nothing found for “${q}”`}>
          {filtered
            ? 'Try another filter, or fewer or different words.'
            : 'Try fewer or different words.'}
        </EmptyState>
      ) : (
        <div className="flex max-w-5xl flex-col gap-6">
          {chans.length > 0 && (
            <section aria-label="Channels" className="flex flex-col gap-2">
              {chans.map((c) => (
                <Link
                  key={c.id}
                  href={`/c/${c.handle ?? c.id}`}
                  className="flex items-center gap-4 rounded-lg p-2 hover:bg-surface sm:gap-6"
                >
                  <span className="flex w-24 justify-center sm:w-[360px]">
                    <Avatar creator={c} size={88} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-lg font-semibold text-ink">
                      {c.display_name ?? c.handle}
                    </span>
                    <span className="truncate text-xs text-ink-3 num">
                      {c.handle && `@${c.handle} · `}
                      {c.video_count} {c.video_count === 1 ? 'video' : 'videos'}
                    </span>
                  </span>
                </Link>
              ))}
            </section>
          )}
          {cols.length > 0 && (
            <section aria-label="Courses and playlists" className="flex flex-col gap-3">
              <h2 className="text-base font-bold text-ink">Courses &amp; playlists</h2>
              <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {cols.map((c) => (
                  <li key={c.id}>
                    <CollectionCard collection={c} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {vids.length > 0 && (
            <section aria-label="Videos" className="flex flex-col gap-3">
              <h2 className="text-sm text-ink-3 num">
                {vids.length} {vids.length === 1 ? 'video' : 'videos'} for &ldquo;{q}&rdquo;
              </h2>
              <ul className="flex flex-col gap-3">
                {vids.map((v) => (
                  <li key={v.id}>
                    <VideoRow video={v} size="lg" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </GridSection>
  );
}
