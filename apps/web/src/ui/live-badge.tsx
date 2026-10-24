import { resolutionLabel } from '@streamzw/shared';
import { startsAt } from '../lib/format';
import type { LiveInfo } from '../types/api';
import { Icon } from './icon';

/** On a thumbnail: LIVE (with 4K/1440p when the feed is that sharp) or the start time. */
export function LiveBadge({ live }: { live: LiveInfo }) {
  if (live.state === 'live') {
    const res =
      live.source_height && live.source_height >= 1440 ? resolutionLabel(live.source_height) : null;
    return (
      <span className="inline-flex items-center gap-1 rounded bg-danger px-1.5 text-xs font-bold leading-5 text-bg">
        <Icon name="live" size={12} />
        LIVE{res ? ` · ${res}` : ''}
      </span>
    );
  }
  if (live.state === 'scheduled') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-scrim px-1.5 text-xs font-semibold leading-5 text-ink">
        {live.scheduled_at ? startsAt(live.scheduled_at) : 'Upcoming'}
      </span>
    );
  }
  return null;
}

/** The stats line for a live video: "Streaming now" / "Starts Today 18:00". */
export function liveStatus(live: LiveInfo | null | undefined): string | null {
  if (!live) return null;
  if (live.state === 'live') return 'Streaming now';
  if (live.state === 'scheduled')
    return live.scheduled_at ? `Starts ${startsAt(live.scheduled_at)}` : 'Upcoming';
  if (live.state === 'ended') return live.replay ? 'Streamed live' : 'Stream ended';
  return null;
}
