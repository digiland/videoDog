import Link from 'next/link';
import { formatDuration, formatViews, timeAgo } from '../../src/lib/format';
import type { Video } from '../../src/types/api';
import { AccessChip } from '../../src/ui/access-chip';
import { Avatar, channelHref, creatorLabel } from '../../src/ui/avatar';
import { LiveBadge, liveStatus } from '../../src/ui/live-badge';

export function creatorName(video: Pick<Video, 'creator'>): string {
  return creatorLabel(video.creator);
}

/** The card's AccessChip price, from the video's own canonical price (never converted). */
export function videoPrice(video: Video) {
  return video.ppv_price_minor_units && video.ppv_price_currency
    ? { amount_minor: String(video.ppv_price_minor_units), currency: video.ppv_price_currency }
    : null;
}

export function videoHref(video: Pick<Video, 'id'>, listId?: string | null): string {
  return listId ? `/v/${video.id}?list=${listId}` : `/v/${video.id}`;
}

/** "1.2K views · 3 days ago" — the parts we know. */
export function videoStats(video: Video): string {
  const status = liveStatus(video.live);
  if (status && video.live?.state !== 'ended') return status;
  const parts: string[] = [];
  if (status) parts.push(status);
  if (video.view_count) parts.push(formatViews(video.view_count));
  if (video.published_at) parts.push(timeAgo(video.published_at));
  return parts.join(' · ');
}

export function Thumbnail({
  video,
  sizes,
  className = '',
}: {
  video: Video;
  sizes: string;
  className?: string;
}) {
  const initial = video.title.trim().charAt(0).toUpperCase() || '·';
  return (
    <div className={`relative aspect-video overflow-hidden rounded-lg bg-surface-2 ${className}`}>
      {video.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- thumbnails are short-lived signed S3/BunnyCDN URLs (per-deployment host, query changes per request); next/image's optimizer would miss its cache on every new signature.
        <img
          src={video.thumbnail_url}
          alt=""
          width={640}
          height={360}
          sizes={sizes}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div aria-hidden="true" className="flex h-full w-full items-center justify-center">
          <span className="text-3xl font-bold text-ink-3">{initial}</span>
        </div>
      )}
      {video.live && (video.live.state === 'live' || video.live.state === 'scheduled') ? (
        <span className="absolute bottom-1.5 right-1.5">
          <LiveBadge live={video.live} />
        </span>
      ) : (
        video.duration_seconds != null && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-scrim px-1.5 text-xs font-semibold leading-5 text-ink num">
            {formatDuration(video.duration_seconds)}
          </span>
        )
      )}
    </div>
  );
}

/**
 * Video tile, YouTube's shape: 16:9 thumbnail, then the channel avatar beside a two-line
 * title, channel name, views and age — plus Kopje's price chip, so nobody hits a paywall by
 * surprise. Thumbnails load lazily and are decorative (alt="": the title follows); no
 * hover-preview video, which would spend the viewer's bundle without asking.
 */
export default function VideoCard({ video, listId }: { video: Video; listId?: string | null }) {
  const href = videoHref(video, listId);
  const channel = channelHref(video.creator);
  const stats = videoStats(video);
  return (
    <article className="group flex min-w-0 flex-col gap-3">
      <Link href={href} tabIndex={-1} aria-hidden="true">
        <Thumbnail
          video={video}
          sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </Link>
      <div className="flex min-w-0 gap-3">
        {channel ? (
          <Link href={channel} tabIndex={-1} aria-hidden="true" className="shrink-0">
            <Avatar creator={video.creator} />
          </Link>
        ) : (
          <Avatar creator={video.creator} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-ink md:text-sm md:leading-5">
            <Link href={href} className="hover:text-accent focus-visible:text-accent">
              {video.title}
            </Link>
          </h3>
          <div className="flex flex-col text-sm text-ink-3 md:text-xs md:leading-5">
            {channel ? (
              <Link href={channel} className="truncate hover:text-ink">
                {creatorName(video)}
              </Link>
            ) : (
              <span className="truncate">{creatorName(video)}</span>
            )}
            {stats && <span className="truncate num">{stats}</span>}
          </div>
          <div className="flex pt-0.5">
            <AccessChip mode={video.access_mode} price={videoPrice(video)} />
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Compact row for the watch page's Up next list and search results: thumbnail left,
 * text right. `active` marks the playing video in a course list.
 */
export function VideoRow({
  video,
  listId,
  active,
  index,
  size = 'sm',
}: {
  video: Video;
  listId?: string | null;
  active?: boolean;
  index?: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const href = videoHref(video, listId);
  const stats = videoStats(video);
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`group flex min-w-0 gap-2 rounded-lg p-1 transition-colors hover:bg-surface ${
        active ? 'bg-surface-2' : ''
      } ${size === 'lg' ? 'sm:gap-4' : ''}`}
    >
      {index != null && (
        <span className="flex w-5 shrink-0 items-center justify-center text-xs text-ink-3 num">
          {active ? <span className="text-accent">▶</span> : index}
        </span>
      )}
      <Thumbnail
        video={video}
        sizes={size === 'lg' ? '(min-width: 640px) 360px, 40vw' : size === 'md' ? '240px' : '168px'}
        className={`w-40 shrink-0 self-start ${
          size === 'lg' ? 'sm:w-[360px]' : size === 'md' ? 'sm:w-60' : ''
        }`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
        <h3
          className={`line-clamp-2 font-semibold text-ink group-hover:text-accent ${
            size === 'lg' ? 'text-sm sm:text-lg sm:leading-snug' : 'text-sm leading-5'
          }`}
        >
          {video.title}
        </h3>
        <p className="truncate text-xs text-ink-3">{creatorName(video)}</p>
        {stats && <p className="truncate text-xs text-ink-3 num">{stats}</p>}
        {size === 'lg' && video.description && (
          <p className="hidden line-clamp-2 text-xs text-ink-3 sm:block">{video.description}</p>
        )}
        <div className="flex">
          <AccessChip mode={video.access_mode} price={videoPrice(video)} />
        </div>
      </div>
    </Link>
  );
}
