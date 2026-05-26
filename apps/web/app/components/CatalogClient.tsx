'use client';
import { useState } from 'react';
import type { Video } from '../../src/types/api';
import VideoCard from './VideoCard';

const MODES = [
  { key: 'all', label: 'All' },
  { key: 'free', label: 'Free' },
  { key: 'ppv', label: 'PPV' },
  { key: 'premium', label: 'Premium' },
];

interface CatalogClientProps {
  initialItems: Video[];
  initialCursor: string | null;
  currentMode: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export default function CatalogClient({
  initialItems,
  initialCursor,
  currentMode,
}: CatalogClientProps) {
  const [videos, setVideos] = useState<Video[]>(initialItems ?? []);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [activeMode, setActiveMode] = useState(currentMode);
  const [loading, setLoading] = useState(false);

  async function handleModeChange(mode: string) {
    setActiveMode(mode);
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20', state: 'published' });
      if (mode !== 'all') params.set('mode', mode);
      const res = await fetch(`${API_BASE}/videos?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as {
          items: Video[];
          next_cursor: string | null;
        };
        setVideos(data.items);
        setCursor(data.next_cursor);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '20',
        state: 'published',
        cursor,
      });
      if (activeMode !== 'all') params.set('mode', activeMode);
      const res = await fetch(`${API_BASE}/videos?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as {
          items: Video[];
          next_cursor: string | null;
        };
        setVideos((prev) => [...prev, ...data.items]);
        setCursor(data.next_cursor);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => void handleModeChange(m.key)}
            className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeMode === m.key
                ? 'bg-[#e94560] text-white'
                : 'bg-[#16213e] text-gray-400 hover:text-white hover:bg-[#1a2744]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
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
                d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M4 6h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z"
              />
            </svg>
          </div>
          <p className="text-gray-400 text-lg font-medium">No videos yet</p>
          <p className="text-gray-600 text-sm mt-1">Check back soon for fresh content.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}

      {/* Load more */}
      {cursor && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => void loadMore()}
            disabled={loading}
            className="bg-[#16213e] hover:bg-[#1a2744] text-white font-semibold py-3 px-8 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </>
  );
}
