import type { Metadata } from 'next';
import { cache } from 'react';
import type { Video } from '../../../src/types/api';
import VideoAccessSection from './VideoAccessSection';
import VideoMeta from './VideoMeta';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

/**
 * Anonymous, metadata-only fetch for server rendering (title, description, thumbnail).
 * Access is NOT decided here: the server has no viewer token, so the access check and
 * playlist fetch happen client-side in <VideoAccessSection> with the viewer's auth.
 * Returns null on 404 too — an owner's unpublished video 404s anonymously, and the
 * client section re-fetches it with the owner's token. Wrapped in `cache` so the page and
 * generateMetadata share one request.
 */
const getPublicVideo = cache(async (id: string): Promise<Video | null> => {
  try {
    const res = await fetch(`${API_BASE}/videos/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Video;
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const video = await getPublicVideo(id);
  if (!video) return { title: 'Video · StreamZW' };
  return {
    title: `${video.title} · StreamZW`,
    description: video.description ?? undefined,
    openGraph: video.thumbnail_url ? { images: [video.thumbnail_url] } : undefined,
  };
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await getPublicVideo(id);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <VideoAccessSection
        videoId={id}
        initialThumbnailUrl={video?.thumbnail_url ?? null}
        hasServerMetadata={video !== null}
      />
      {video && <VideoMeta video={video} />}
    </div>
  );
}
