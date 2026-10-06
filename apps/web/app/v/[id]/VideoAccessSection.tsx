'use client';
import dynamic from 'next/dynamic';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../src/lib/api';
import type {
  PaywallPayload,
  PlayablePlaylist,
  PlaylistResponse,
  Video,
} from '../../../src/types/api';
import { LinkButton } from '../../../src/ui/button';
import { Icon } from '../../../src/ui/icon';
import Paywall from '../../components/Paywall';
import VideoMeta from './VideoMeta';

/** The player (and hls.js) load only once access is granted: no player bytes for a paywall. */
const Player = dynamic(() => import('../../components/Player'), {
  ssr: false,
  loading: () => <Pending />,
});

type AccessState =
  | { status: 'loading' }
  | { status: 'playable'; playlist: PlayablePlaylist }
  | { status: 'denied'; paywall: PaywallPayload }
  | { status: 'unavailable' };

interface Props {
  videoId: string;
  initialThumbnailUrl: string | null;
  /** False when the anonymous server fetch failed (e.g. owner viewing an unpublished video). */
  hasServerMetadata: boolean;
}

function isDenied(
  res: PlaylistResponse,
): res is Extract<PlaylistResponse, { access_denied: true }> {
  return 'access_denied' in res && res.access_denied === true;
}

function Pending() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <Icon name="spinner" size={28} className="text-ink-2" label="Loading" />
    </div>
  );
}

/**
 * The 16:9 stage. Player, paywall and loading states all render inside it, so nothing below
 * moves when access is decided. Content stacks over a 16:9 spacer in one grid cell: if the
 * paywall needs more height on a narrow phone, the box grows instead of clipping text.
 */
function Stage({ thumbnailUrl, children }: { thumbnailUrl: string | null; children: ReactNode }) {
  return (
    <div className="relative grid grid-cols-1 overflow-hidden bg-surface md:rounded-md">
      <div className="aspect-video [grid-area:1/1]" aria-hidden="true" />
      {thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed thumbnail URL (see VideoCard).
        <img
          src={thumbnailUrl}
          alt=""
          width={1280}
          height={720}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="relative flex min-w-0 [grid-area:1/1]">{children}</div>
    </div>
  );
}

/**
 * Decides player vs paywall using the viewer's own auth (via the `api` helper, so tokens
 * and refresh work). The API's playlist endpoint runs VideosService.checkAccess — this
 * component only renders its verdict and never re-implements the access rules.
 */
export default function VideoAccessSection({
  videoId,
  initialThumbnailUrl,
  hasServerMetadata,
}: Props) {
  const [state, setState] = useState<AccessState>({ status: 'loading' });
  const [video, setVideo] = useState<Video | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchPlaylist = useCallback(
    () => api.get<PlaylistResponse>(`/videos/${encodeURIComponent(videoId)}/playlist`),
    [videoId],
  );

  const checkAccess = useCallback(async () => {
    try {
      const res = await fetchPlaylist();
      setState(
        isDenied(res)
          ? { status: 'denied', paywall: res.paywall }
          : { status: 'playable', playlist: res },
      );
    } catch {
      setState({ status: 'unavailable' });
    }
  }, [fetchPlaylist]);

  // Initial load. When the server couldn't render metadata anonymously, fetch it with auth.
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      if (!hasServerMetadata) {
        try {
          const v = await api.get<Video>(`/videos/${encodeURIComponent(videoId)}`);
          if (!cancelled) setVideo(v);
        } catch {
          if (!cancelled) setState({ status: 'unavailable' });
          return;
        }
      }
      if (!cancelled) await checkAccess();
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId, hasServerMetadata, checkAccess]);

  // Re-check while locked: after paying in another tab / on the phone and coming back,
  // or after signing in elsewhere. Checkout itself redirects back here (fresh mount).
  useEffect(() => {
    function recheckIfDenied() {
      if (document.visibilityState === 'visible' && stateRef.current.status === 'denied') {
        void checkAccess();
      }
    }
    document.addEventListener('visibilitychange', recheckIfDenied);
    window.addEventListener('streamzw:auth-change', recheckIfDenied);
    return () => {
      document.removeEventListener('visibilitychange', recheckIfDenied);
      window.removeEventListener('streamzw:auth-change', recheckIfDenied);
    };
  }, [checkAccess]);

  // Signed playlist URL expired mid-session: fetch a fresh one (Player resumes position).
  const handlePlaylistExpired = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetchPlaylist();
      if (isDenied(res)) {
        // Access lapsed (e.g. day pass expired) — show the paywall instead.
        setState({ status: 'denied', paywall: res.paywall });
        return true;
      }
      setState({ status: 'playable', playlist: res });
      return true;
    } catch {
      return false;
    }
  }, [fetchPlaylist]);

  const thumbnailUrl = video?.thumbnail_url ?? initialThumbnailUrl;

  return (
    <>
      {state.status === 'playable' ? (
        <div className="relative aspect-video overflow-hidden bg-surface md:rounded-md">
          <Player
            videoId={videoId}
            src={state.playlist.url}
            kind={state.playlist.kind}
            captions={state.playlist.captions}
            poster={thumbnailUrl}
            onPlaylistExpired={handlePlaylistExpired}
          />
        </div>
      ) : (
        <Stage thumbnailUrl={thumbnailUrl}>
          {state.status === 'loading' ? (
            <Pending />
          ) : state.status === 'denied' ? (
            <div className="flex w-full items-center justify-center bg-scrim">
              <Paywall payload={state.paywall} videoId={videoId} />
            </div>
          ) : (
            <div className="flex w-full flex-col items-center justify-center gap-3 bg-scrim p-4 text-center">
              <p className="text-base font-semibold text-ink">This video isn&apos;t available</p>
              <p className="text-sm text-ink-2">
                It may have been removed, or the connection dropped.
              </p>
              <LinkButton href="/" variant="secondary">
                Browse videos
              </LinkButton>
            </div>
          )}
        </Stage>
      )}
      {!hasServerMetadata && video && <VideoMeta video={video} />}
    </>
  );
}
