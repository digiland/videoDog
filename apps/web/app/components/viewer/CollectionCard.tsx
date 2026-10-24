import Link from 'next/link';
import { formatRunningTime } from '../../../src/lib/format';
import type { AccessMode, CollectionSummary } from '../../../src/types/api';
import { Avatar, channelHref, creatorLabel } from '../../../src/ui/avatar';
import { Icon } from '../../../src/ui/icon';

const MODE_WORDS: Record<AccessMode, string> = {
  free: 'free',
  ppv: 'pay once',
  premium: 'Premium',
  premium_buyable: 'Premium or buy',
};

/** "3 free · 7 Premium": what the lessons cost, before the tap. */
export function accessSummary(modes: CollectionSummary['access_modes']): string {
  return (Object.entries(modes) as [AccessMode, number][])
    .filter(([, n]) => n > 0)
    .map(([m, n]) => `${n} ${MODE_WORDS[m]}`)
    .join(' · ');
}

export function collectionMeta(c: CollectionSummary): string {
  const unit = c.kind === 'course' ? 'lesson' : 'video';
  const parts = [`${c.video_count} ${unit}${c.video_count === 1 ? '' : 's'}`];
  if (c.duration_seconds > 0) parts.push(formatRunningTime(c.duration_seconds));
  return parts.join(' · ');
}

/**
 * Course / playlist tile, YouTube's playlist shape: the cover with a stacked edge and a
 * count panel, then title, channel and what the lessons cost.
 */
export default function CollectionCard({ collection: c }: { collection: CollectionSummary }) {
  const href = `/collections/${c.id}`;
  const channel = channelHref(c.creator);
  const summary = accessSummary(c.access_modes);
  return (
    <article className="flex min-w-0 flex-col gap-3">
      <Link href={href} tabIndex={-1} aria-hidden="true" className="relative block pt-2">
        <span className="absolute inset-x-4 top-0 h-2 rounded-t-lg bg-surface-2" />
        <span className="absolute inset-x-2 top-1 h-2 rounded-t-lg border-t border-line bg-surface" />
        <div className="relative aspect-video overflow-hidden rounded-lg bg-surface-2">
          {c.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed thumbnail URL (see VideoCard).
            <img
              src={c.thumbnail_url}
              alt=""
              width={640}
              height={360}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : null}
          <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-scrim px-1.5 text-xs font-semibold leading-5 text-ink num">
            <Icon name={c.kind === 'course' ? 'course' : 'playlist'} size={14} />
            {c.video_count} {c.kind === 'course' ? 'lessons' : 'videos'}
          </span>
        </div>
      </Link>
      <div className="flex min-w-0 gap-3">
        {channel ? (
          <Link href={channel} tabIndex={-1} aria-hidden="true" className="shrink-0">
            <Avatar creator={c.creator} />
          </Link>
        ) : (
          <Avatar creator={c.creator} />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-ink md:text-sm md:leading-5">
            <Link href={href} className="hover:text-accent">
              {c.title}
            </Link>
          </h3>
          <div className="flex flex-col text-sm text-ink-3 md:text-xs md:leading-5">
            {channel ? (
              <Link href={channel} className="truncate hover:text-ink">
                {creatorLabel(c.creator)}
              </Link>
            ) : (
              <span className="truncate">{creatorLabel(c.creator)}</span>
            )}
            <span className="truncate num">
              {c.kind === 'course' ? 'Course' : 'Playlist'} · {collectionMeta(c)}
            </span>
            {summary && <span className="truncate">{summary}</span>}
          </div>
        </div>
      </div>
    </article>
  );
}
