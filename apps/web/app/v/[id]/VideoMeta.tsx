import { CATEGORY_LABELS } from '@streamzw/shared';
import Link from 'next/link';
import { formatViews } from '../../../src/lib/format';
import type { Channel, Video } from '../../../src/types/api';
import { AccessChip } from '../../../src/ui/access-chip';
import { Avatar, channelHref } from '../../../src/ui/avatar';
import { DataCost } from '../../../src/ui/data-cost';
import { creatorName, videoPrice } from '../../components/VideoCard';
import Description from '../../components/viewer/Description';
import ShareButton from './ShareButton';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Harare',
  });
}

/**
 * Under the player, YouTube's order: title; channel row with share; then a description
 * panel led by views, date and topic — plus what it costs in money and in data.
 */
export default function VideoMeta({ video, channel }: { video: Video; channel?: Channel | null }) {
  const href = channelHref(video.creator);
  return (
    <div className="flex flex-col gap-3 px-4 pt-3 lg:px-0">
      <h1 className="text-lg font-bold leading-snug text-ink md:text-xl">{video.title}</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {href ? (
            <Link href={href} tabIndex={-1} aria-hidden="true">
              <Avatar creator={video.creator} size={40} />
            </Link>
          ) : (
            <Avatar creator={video.creator} size={40} />
          )}
          <div className="flex min-w-0 flex-col">
            {href ? (
              <Link href={href} className="truncate font-semibold text-ink hover:text-accent">
                {creatorName(video)}
              </Link>
            ) : (
              <span className="truncate font-semibold text-ink">{creatorName(video)}</span>
            )}
            {channel && (
              <span className="text-xs text-ink-3 num">
                {channel.video_count} {channel.video_count === 1 ? 'video' : 'videos'}
              </span>
            )}
          </div>
          {href && (
            <Link
              href={href}
              className="ml-2 inline-flex h-9 shrink-0 items-center rounded-full bg-ink px-4 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
            >
              View channel
            </Link>
          )}
        </div>
        <ShareButton title={video.title} />
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-surface p-3">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink num">
          {video.view_count ? <span>{formatViews(video.view_count)}</span> : null}
          {video.published_at && (
            <time dateTime={video.published_at}>{formatDate(video.published_at)}</time>
          )}
          {video.category && video.category !== 'other' && (
            <Link href={`/?category=${video.category}`} className="text-accent hover:underline">
              #{CATEGORY_LABELS[video.category]}
            </Link>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <AccessChip mode={video.access_mode} price={videoPrice(video)} />
          <DataCost seconds={video.duration_seconds} />
        </div>
        {video.description && <Description text={video.description} />}
      </div>
    </div>
  );
}
