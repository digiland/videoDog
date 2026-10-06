import { formatDuration } from '../../../src/lib/format';
import type { Video } from '../../../src/types/api';
import { AccessChip } from '../../../src/ui/access-chip';
import { DataCost } from '../../../src/ui/data-cost';
import { creatorName, videoPrice } from '../../components/VideoCard';
import Description from '../../components/viewer/Description';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Harare',
  });
}

/**
 * What's under the player: title, who made it, what it costs in money and in data, then
 * the description. Pure markup, usable from server and client.
 */
export default function VideoMeta({ video }: { video: Video }) {
  return (
    <div className="flex flex-col gap-3 px-4 pt-3 md:px-0 md:pt-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold leading-snug text-ink md:text-2xl">{video.title}</h1>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-3">
          <span className="font-semibold text-ink-2">{creatorName(video)}</span>
          {video.published_at && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={video.published_at}>{formatDate(video.published_at)}</time>
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AccessChip mode={video.access_mode} price={videoPrice(video)} />
        {video.duration_seconds != null && (
          <span className="text-xs text-ink-3 num">{formatDuration(video.duration_seconds)}</span>
        )}
        <DataCost seconds={video.duration_seconds} />
      </div>
      {video.description && <Description text={video.description} />}
    </div>
  );
}
