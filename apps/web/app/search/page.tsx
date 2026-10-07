import type { Metadata } from 'next';
import type { Video } from '../../src/types/api';
import { EmptyState } from '../../src/ui/state';
import { API_BASE, apiMode, type ModeKey, parseMode } from '../components/viewer/catalog';
import ModeChips from '../components/viewer/ModeChips';
import VideoGrid, { GridSection } from '../components/viewer/VideoGrid';
import SearchForm from './SearchForm';

export const metadata: Metadata = { title: 'Search · StreamZW' };

async function searchVideos(q: string, mode: ModeKey): Promise<Video[] | null> {
  try {
    const params = new URLSearchParams({ q, limit: '48' });
    const api = apiMode(mode);
    if (api) params.set('mode', api);
    const res = await fetch(`${API_BASE}/search?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Video[] };
    return data.items ?? [];
  } catch {
    return null;
  }
}

function href(q: string, mode: ModeKey): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (mode !== 'all') params.set('mode', mode);
  const s = params.toString();
  return s ? `/search?${s}` : '/search';
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 200);
  const mode = parseMode(params.mode);
  const videos = q ? await searchVideos(q, mode) : [];

  return (
    <GridSection>
      <h1 className="sr-only">Search</h1>
      <div className="flex flex-col gap-3 md:max-w-xl">
        <SearchForm key={q} initialQuery={q} mode={mode} />
      </div>
      {q && <ModeChips active={mode} hrefFor={(m) => href(q, m)} />}

      {!q ? (
        <EmptyState title="Find something to watch">
          Search by title, topic or creator, like &ldquo;mbira&rdquo; or &ldquo;football&rdquo;.
        </EmptyState>
      ) : videos === null ? (
        <EmptyState title="Search isn't working right now">
          Check your connection, then search again.
        </EmptyState>
      ) : videos.length === 0 ? (
        <EmptyState title={`Nothing found for “${q}”`}>
          {mode === 'all'
            ? 'Try fewer or different words.'
            : 'Try another filter, or fewer or different words.'}
        </EmptyState>
      ) : (
        <section aria-labelledby="results-heading" className="flex flex-col gap-3">
          <h2 id="results-heading" className="text-sm text-ink-3 num">
            {videos.length} {videos.length === 1 ? 'result' : 'results'} for &ldquo;{q}&rdquo;
          </h2>
          <VideoGrid videos={videos} label="Search results" />
        </section>
      )}
    </GridSection>
  );
}
