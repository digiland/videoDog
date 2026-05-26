import type { VideoListResponse } from '../src/types/api';
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

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white">
          Zimbabwe&apos;s Video Platform
        </h1>
        <p className="mt-2 text-gray-400 text-sm md:text-base">
          Watch, support, and discover creators from Zimbabwe and the diaspora.
        </p>
      </div>

      <CatalogClient
        initialItems={data.items}
        initialCursor={data.next_cursor}
        currentMode={mode}
      />
    </div>
  );
}
