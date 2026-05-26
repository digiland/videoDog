import Link from 'next/link';
import type { Video } from '../../src/types/api';
import { formatDuration, formatMoney } from '../../src/lib/format';

const ACCESS_MODE_LABELS: Record<Video['access_mode'], string> = {
  free: 'Free',
  ppv: 'PPV',
  premium: 'Premium',
  premium_buyable: 'Buy / Sub',
};

const ACCESS_MODE_COLORS: Record<Video['access_mode'], string> = {
  free: 'bg-green-900/60 text-green-300 border-green-700/50',
  ppv: 'bg-yellow-900/60 text-yellow-300 border-yellow-700/50',
  premium: 'bg-purple-900/60 text-purple-300 border-purple-700/50',
  premium_buyable: 'bg-blue-900/60 text-blue-300 border-blue-700/50',
};

interface VideoCardProps {
  video: Video;
}

export default function VideoCard({ video }: VideoCardProps) {
  const creatorName = video.creator?.display_name ?? video.creator?.handle ?? 'Creator';

  return (
    <Link href={`/v/${video.id}`} className="group block">
      <div className="bg-[#16213e] rounded-xl border border-[#1a1a2e]/50 overflow-hidden hover:border-[#e94560]/30 transition">
        {/* Thumbnail */}
        <div className="relative aspect-video bg-gray-800 overflow-hidden">
          {video.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnail_url}
              alt={video.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg
                className="w-12 h-12 text-gray-600"
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
          )}

          {/* Duration badge */}
          {video.duration_seconds != null && (
            <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-mono px-1.5 py-0.5 rounded">
              {formatDuration(video.duration_seconds)}
            </span>
          )}

          {/* Access mode badge */}
          <span
            className={`absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full border ${ACCESS_MODE_COLORS[video.access_mode]}`}
          >
            {ACCESS_MODE_LABELS[video.access_mode]}
          </span>
        </div>

        {/* Info */}
        <div className="p-3">
          <h3 className="text-sm font-semibold text-white line-clamp-2 leading-snug">
            {video.title}
          </h3>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-400 truncate">{creatorName}</span>
            {(video.access_mode === 'ppv' || video.access_mode === 'premium_buyable') &&
              video.ppv_price_minor_units &&
              video.ppv_price_currency && (
                <span className="text-xs font-semibold text-[#e94560] shrink-0 ml-2">
                  {formatMoney(video.ppv_price_minor_units, video.ppv_price_currency)}
                </span>
              )}
          </div>
        </div>
      </div>
    </Link>
  );
}
