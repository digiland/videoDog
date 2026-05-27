import Link from 'next/link';
import type { Video, VideoListResponse } from '../src/types/api';
import CatalogClient from './components/CatalogClient';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

async function fetchVideos(mode?: string): Promise<VideoListResponse> {
  try {
    const params = new URLSearchParams({ limit: '20', state: 'published' });
    if (mode && mode !== 'all') params.set('mode', mode);
    const res = await fetch(`${API_BASE}/videos?${params.toString()}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return { items: [], next_cursor: null };
    return res.json() as Promise<VideoListResponse>;
  } catch {
    return { items: [], next_cursor: null };
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const params = await searchParams;
  const mode = params.mode ?? 'all';
  const data = await fetchVideos(mode);
  const featured: Video | undefined = data.items[0];

  return (
    <div>
      {/* Hero banner */}
      <section className="relative h-[60vh] min-h-[420px] max-h-[640px] w-full overflow-hidden border-b border-line">
        {featured?.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={featured.thumbnail_url}
            alt={featured.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-bg-elev via-bg to-accent/10" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/40 to-transparent" />

        <div className="relative max-w-screen-2xl mx-auto h-full px-6 flex flex-col justify-end pb-12">
          <div className="max-w-2xl fade-up">
            <p className="text-accent text-sm font-semibold tracking-wider uppercase mb-3">
              {featured ? 'Featured' : 'Welcome to StreamZW'}
            </p>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight">
              {featured?.title ?? "Watch Zimbabwe's creators."}
            </h1>
            <p className="mt-4 text-ink-mute text-base md:text-lg max-w-xl">
              {featured?.description ??
                'Free episodes, pay-per-view drops, and a $1.49 monthly pass that unlocks every premium video.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {featured ? (
                <Link
                  href={`/v/${featured.id}`}
                  className="bg-ink text-bg hover:bg-ink-mute font-semibold rounded-md px-6 py-3 text-sm flex items-center gap-2 transition"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Watch now
                </Link>
              ) : null}
              <Link
                href="/pricing"
                className="bg-accent hover:bg-accent-hot text-bg font-semibold rounded-md px-6 py-3 text-sm transition"
              >
                Start a subscription
              </Link>
              <Link
                href="/?mode=free"
                className="bg-surface/80 hover:bg-surface text-ink font-semibold rounded-md px-6 py-3 text-sm transition border border-line"
              >
                Browse free
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Catalogue */}
      <section className="max-w-screen-2xl mx-auto px-6 py-10">
        <CatalogClient
          initialItems={data.items}
          initialCursor={data.next_cursor}
          currentMode={mode}
        />
      </section>
    </div>
  );
}
