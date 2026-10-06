import type { Metadata } from 'next';
import { cache } from 'react';
import type { Video } from '../../../src/types/api';
import { API_BASE } from '../../components/viewer/catalog';
import VideoAccessSection from './VideoAccessSection';
import VideoMeta from './VideoMeta';

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

/**
 * Player first, edge to edge on phones (every pixel of a 360px screen goes to the video);
 * the paywall takes the player's place in the same box, then title, price and data cost.
 */
export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await getPublicVideo(id);

  return (
    <div className="mx-auto max-w-4xl md:px-4 md:pt-4">
      <VideoAccessSection
        videoId={id}
        initialThumbnailUrl={video?.thumbnail_url ?? null}
        hasServerMetadata={video !== null}
      />
      {video && <VideoMeta video={video} />}
    </div>
  );
}
