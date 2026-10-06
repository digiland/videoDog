import type { Video } from '../../../src/types/api';
import { formatDuration } from '../../../src/lib/format';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const MODE_BADGE: Record<Video['access_mode'], string> = {
  free: 'bg-green-900/60 text-green-300 border-green-700/50',
  ppv: 'bg-yellow-900/60 text-yellow-300 border-yellow-700/50',
  premium_buyable: 'bg-blue-900/60 text-blue-300 border-blue-700/50',
  premium: 'bg-purple-900/60 text-purple-300 border-purple-700/50',
};

/** Title / creator / description block. Pure markup: usable from server and client. */
export default function VideoMeta({ video }: { video: Video }) {
  const creatorName = video.creator?.display_name ?? video.creator?.handle ?? 'Creator';
  return (
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
          className={`capitalize px-2 py-0.5 rounded-full text-xs font-semibold border ${MODE_BADGE[video.access_mode]}`}
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
  );
}
