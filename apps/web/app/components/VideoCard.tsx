import Link from 'next/link';
import { formatDuration } from '../../src/lib/format';
import type { Video } from '../../src/types/api';
import { AccessChip } from '../../src/ui/access-chip';

export function creatorName(video: Pick<Video, 'creator'>): string {
  return video.creator?.display_name ?? video.creator?.handle ?? 'StreamZW creator';
}

/** The card's AccessChip price, from the video's own canonical price (never converted). */
export function videoPrice(video: Video) {
  return video.ppv_price_minor_units && video.ppv_price_currency
    ? { amount_minor: String(video.ppv_price_minor_units), currency: video.ppv_price_currency }
    : null;
}

/**
 * Video tile (DESIGN.md pattern): 16:9 thumbnail, duration, title, creator, and the price
 * before the tap. Thumbnails load lazily and are decorative (alt="": the title follows);
 * no hover-preview video — previews would spend the viewer's bundle without asking.
 */
export default function VideoCard({ video }: { video: Video }) {
  const initial = video.title.trim().charAt(0).toUpperCase() || '·';
  return (
    <Link href={`/v/${video.id}`} className="group flex flex-col gap-2 rounded-md min-w-0">
      <div className="relative aspect-video overflow-hidden rounded-md bg-surface-2">
        {video.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- thumbnails are short-lived signed S3/BunnyCDN URLs (per-deployment host, query changes per request); next/image's optimizer would miss its cache on every new signature.
          <img
            src={video.thumbnail_url}
            alt=""
            width={640}
            height={360}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center border border-line rounded-md"
          >
            <span className="text-3xl font-bold text-ink-3">{initial}</span>
          </div>
        )}
        {video.duration_seconds != null && (
          <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-scrim px-1.5 text-xs font-semibold leading-5 text-ink num">
            {formatDuration(video.duration_seconds)}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-ink transition-colors group-hover:text-accent">
          {video.title}
        </h3>
        <p className="truncate text-xs text-ink-3">{creatorName(video)}</p>
        <div className="flex">
          <AccessChip mode={video.access_mode} price={videoPrice(video)} />
        </div>
      </div>
    </Link>
  );
}
