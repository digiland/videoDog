import { notFound } from 'next/navigation';
import type { Video, AccessResult, PlaylistResponse } from '../../../src/types/api';
import { formatDuration } from '../../../src/lib/format';
import VideoPlayerSection from './VideoPlayerSection';
import Paywall from '../../components/Paywall';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

async function getVideo(id: string): Promise<Video | null> {
  try {
    const res = await fetch(`${API_BASE}/videos/${id}`, {
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json() as Promise<Video>;
  } catch {
    return null;
  }
}

interface PlaylistWithCaptions extends PlaylistResponse {
  url: string;
  captions?: Array<{
    id: string;
    language: string;
    label: string;
    kind: 'subtitles' | 'captions';
    is_default: boolean;
    url: string;
  }>;
}

async function getPlaylist(id: string): Promise<PlaylistWithCaptions | null> {
  try {
    const res = await fetch(`${API_BASE}/videos/${id}/playlist`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as PlaylistWithCaptions;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await getVideo(id);

  if (!video) return notFound();

  const access = video.access_check_result as AccessResult | undefined;
  const canPlay = access?.ok === true;

  const playlist = canPlay ? await getPlaylist(id) : null;
  const playlistUrl = playlist?.url ?? null;

  const creatorName = video.creator?.display_name ?? video.creator?.handle ?? 'Creator';

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Player or Paywall */}
      <div className="mb-6">
        {canPlay && playlistUrl ? (
          <VideoPlayerSection
            src={playlistUrl}
            videoId={video.id}
            captions={playlist?.captions ?? []}
          />
        ) : access?.ok === false ? (
          <div className="aspect-video bg-[#16213e] rounded-xl overflow-hidden relative">
            {/* Blurred thumbnail background */}
            {video.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={video.thumbnail_url}
                alt=""
                className="w-full h-full object-cover blur-sm opacity-30"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="w-full max-w-lg">
                <Paywall payload={access.paywall} videoId={video.id} />
              </div>
            </div>
          </div>
        ) : (
          // No access info — free video not playable or error
          <div className="aspect-video bg-[#16213e] rounded-xl flex items-center justify-center">
            <p className="text-gray-500">Video unavailable</p>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div>
        <h1 className="text-2xl font-bold text-white">{video.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-400">
          <span>{creatorName}</span>
          {video.duration_seconds != null && (
            <>
              <span>·</span>
              <span>{formatDuration(video.duration_seconds)}</span>
            </>
          )}
          {video.published_at && (
            <>
              <span>·</span>
              <span>{formatDate(video.published_at)}</span>
            </>
          )}
          <span>·</span>
          <span
            className={`capitalize px-2 py-0.5 rounded-full text-xs font-semibold border ${
              video.access_mode === 'free'
                ? 'bg-green-900/60 text-green-300 border-green-700/50'
                : video.access_mode === 'ppv'
                  ? 'bg-yellow-900/60 text-yellow-300 border-yellow-700/50'
                  : video.access_mode === 'premium_buyable'
                    ? 'bg-blue-900/60 text-blue-300 border-blue-700/50'
                    : 'bg-purple-900/60 text-purple-300 border-purple-700/50'
            }`}
          >
            {video.access_mode.replace(/_/g, ' ')}
          </span>
        </div>

        {video.description && (
          <p className="mt-4 text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
            {video.description}
          </p>
        )}
      </div>
    </div>
  );
}
