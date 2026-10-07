'use client';
import { useState } from 'react';
import type { Video } from '../../src/types/api';
import { Button, LinkButton } from '../../src/ui/button';
import { Notice } from '../../src/ui/notice';
import { EmptyState } from '../../src/ui/state';
import { fetchCatalog, type ModeKey } from './viewer/catalog';
import VideoGrid from './viewer/VideoGrid';

interface CatalogClientProps {
  initialItems: Video[];
  initialCursor: string | null;
  mode: ModeKey;
  /** The server-side first page failed to load (as opposed to an empty catalogue). */
  failed?: boolean;
}

/**
 * The catalogue grid. The first page arrives server-rendered; more pages load only when
 * the viewer asks ("Load more"), so nobody spends data on thumbnails they never scroll to
 * and the footer stays reachable. Remounted per filter (keyed by mode in the page).
 */
export default function CatalogClient({
  initialItems,
  initialCursor,
  mode,
  failed,
}: CatalogClientProps) {
  const [videos, setVideos] = useState<Video[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  async function loadMore() {
    if (!cursor || status === 'loading') return;
    setStatus('loading');
    const page = await fetchCatalog(mode, cursor);
    if (!page) {
      setStatus('error');
      return;
    }
    setVideos((prev) => {
      const seen = new Set(prev.map((v) => v.id));
      return [...prev, ...page.items.filter((v) => !seen.has(v.id))];
    });
    setCursor(page.next_cursor);
    setStatus('idle');
  }

  if (videos.length === 0) {
    return failed ? (
      <EmptyState
        title="Couldn't load videos"
        action={
          <LinkButton href={mode === 'all' ? '/' : `/?mode=${mode}`} variant="secondary">
            Try again
          </LinkButton>
        }
      >
        Check your connection, then try again.
      </EmptyState>
    ) : (
      <EmptyState
        title="Nothing here yet"
        action={
          mode !== 'all' && (
            <LinkButton href="/" variant="secondary">
              Show all videos
            </LinkButton>
          )
        }
      >
        New videos show up here as soon as creators publish them.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <VideoGrid videos={videos} label="Videos" />
      {status === 'error' && (
        <Notice tone="error">Couldn&apos;t load more videos. Check your connection.</Notice>
      )}
      {cursor && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={status === 'loading'}
            onClick={() => void loadMore()}
            className="w-full sm:w-auto sm:min-w-48"
          >
            {status === 'error' ? 'Try again' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
