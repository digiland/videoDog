'use client';
import { useEffect, useRef, useState } from 'react';
import type { Video } from '../../src/types/api';
import VideoCard from './VideoCard';

const MODES = [
  { key: 'all', label: 'All' },
  { key: 'free', label: 'Free' },
  { key: 'ppv', label: 'Rent' },
  { key: 'premium', label: 'Premium' },
];

interface CatalogClientProps {
  initialItems: Video[];
  initialCursor: string | null;
  currentMode: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

function SkeletonCard() {
  return (
    <div>
      <div className="aspect-video skeleton rounded-md" />
      <div className="mt-2 h-4 w-3/4 skeleton rounded" />
      <div className="mt-1.5 h-3 w-1/2 skeleton rounded" />
    </div>
  );
}

export default function CatalogClient({
  initialItems,
  initialCursor,
  currentMode,
}: CatalogClientProps) {
  const [videos, setVideos] = useState<Video[]>(initialItems ?? []);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [activeMode, setActiveMode] = useState(currentMode);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<string | null>(initialCursor);
  const loadingRef = useRef(false);
  const modeRef = useRef(currentMode);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  useEffect(() => {
    modeRef.current = activeMode;
  }, [activeMode]);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  async function handleModeChange(mode: string) {
    setActiveMode(mode);
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20', state: 'published' });
      if (mode !== 'all') params.set('mode', mode);
      const res = await fetch(`${API_BASE}/videos?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { items: Video[]; next_cursor: string | null };
        setVideos(data.items);
        setCursor(data.next_cursor);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    const c = cursorRef.current;
    if (!c || loadingRef.current) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20', state: 'published', cursor: c });
      if (modeRef.current !== 'all') params.set('mode', modeRef.current);
      const res = await fetch(`${API_BASE}/videos?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { items: Video[]; next_cursor: string | null };
        setVideos((prev) => [...prev, ...data.items]);
        setCursor(data.next_cursor);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '600px' },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-2xl font-bold">
          {activeMode === 'all'
            ? 'Browse all'
            : activeMode === 'free'
              ? 'Free to watch'
              : activeMode === 'ppv'
                ? 'Rent & own'
                : 'Premium'}
        </h2>
        <div className="flex gap-1 bg-surface rounded-md p-1">
          {MODES.map((m) => {
            const active = activeMode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => void handleModeChange(m.key)}
                className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition ${
                  active ? 'bg-bg text-ink' : 'text-ink-mute hover:text-ink'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && videos.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-8">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-8 opacity-30 pointer-events-none">
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <div className="text-center mt-10">
            <p className="text-xl font-semibold">Nothing here yet</p>
            <p className="text-ink-dim text-sm mt-1">
              New videos will appear here as soon as creators publish.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-8">
          {videos.map((video, i) => (
            <VideoCard key={video.id} video={video} index={i} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-12 mt-6 flex items-center justify-center">
        {loading && cursor && (
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        )}
      </div>
    </>
  );
}
