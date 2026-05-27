import Link from 'next/link';
import type { Video } from '../../src/types/api';
import { formatDuration, formatMoney } from '../../src/lib/format';

const BADGE: Record<Video['access_mode'], { label: string; tone: string }> = {
  free: { label: 'Free', tone: 'bg-ok/90 text-bg' },
  ppv: { label: 'Rent', tone: 'bg-warn/90 text-bg' },
  premium: { label: 'Premium', tone: 'bg-accent text-bg' },
  premium_buyable: { label: 'Premium · Rent', tone: 'bg-accent text-bg' },
};

interface VideoCardProps {
  video: Video;
  index?: number;
}

export default function VideoCard({ video, index = 0 }: VideoCardProps) {
  const creatorName = video.creator?.display_name ?? video.creator?.handle ?? 'StreamZW';
  const badge = BADGE[video.access_mode];
  const showPrice =
    (video.access_mode === 'ppv' || video.access_mode === 'premium_buyable') &&
    video.ppv_price_minor_units &&
    video.ppv_price_currency;

  return (
    <Link
      href={`/v/${video.id}`}
      className="group block fade-up"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="relative aspect-video overflow-hidden bg-surface rounded-md ring-0 group-hover:ring-2 ring-accent transition">
        {video.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-2 to-surface">
            <svg className="w-12 h-12 text-ink-dim/40" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-bg/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-ink/90 flex items-center justify-center text-bg">
            <svg className="w-5 h-5 fill-current ml-0.5" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        <span
          className={`absolute top-2 left-2 ${badge.tone} text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded`}
        >
          {badge.label}
        </span>

        {video.duration_seconds != null && (
          <span className="absolute bottom-2 right-2 bg-bg/90 text-ink text-xs font-mono px-1.5 py-0.5 rounded">
            {formatDuration(video.duration_seconds)}
          </span>
        )}
      </div>

      <div className="mt-2">
        <h3 className="font-semibold text-ink leading-snug line-clamp-2 group-hover:text-accent transition">
          {video.title}
        </h3>
        <p className="text-xs text-ink-dim mt-0.5 truncate">{creatorName}</p>
        {showPrice && (
          <p className="text-xs text-ink-mute mt-1">
            From{' '}
            <span className="text-ink font-semibold">
              {formatMoney(video.ppv_price_minor_units!, video.ppv_price_currency!)}
            </span>
          </p>
        )}
      </div>
    </Link>
  );
}
