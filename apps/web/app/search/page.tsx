import type { Video } from '../../src/types/api';
import VideoCard from '../components/VideoCard';
import SearchForm from './SearchForm';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

async function searchVideos(q: string): Promise<Video[]> {
  if (!q.trim()) return [];
  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Video[] } | Video[];
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  } catch {
    return [];
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = params.q ?? '';
  const results = await searchVideos(q);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-4">Search</h1>
        <SearchForm initialQuery={q} />
      </div>

      {q && (
        <p className="text-gray-400 text-sm mb-6">
          {results.length === 0
            ? `No results for "${q}"`
            : `${results.length} result${results.length === 1 ? '' : 's'} for "${q}"`}
        </p>
      )}

      {results.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {results.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      ) : q ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-[#16213e] flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-gray-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <p className="text-gray-400 text-lg font-medium">No results for &ldquo;{q}&rdquo;</p>
          <p className="text-gray-600 text-sm mt-1">Try different keywords or check for typos.</p>
        </div>
      ) : (
        <p className="text-gray-600 text-center py-16">Enter a search term above to find videos.</p>
      )}
    </div>
  );
}
