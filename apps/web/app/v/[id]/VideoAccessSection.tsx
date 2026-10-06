'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '../../../src/lib/api';
import type {
  PaywallPayload,
  PlayablePlaylist,
  PlaylistResponse,
  Video,
} from '../../../src/types/api';
import Paywall from '../../components/Paywall';
import VideoMeta from './VideoMeta';

const Player = dynamic(() => import('../../components/Player'), {
  ssr: false,
  loading: () => <Spinner />,
});

function Spinner() {
  return (
    <div className="aspect-video bg-black rounded-xl flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

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
      <div className="mb-6">
        {state.status === 'loading' ? (
          <Spinner />
        ) : state.status === 'playable' ? (
          <Player
            videoId={videoId}
            src={state.playlist.url}
            kind={state.playlist.kind}
            captions={state.playlist.captions}
            onPlaylistExpired={handlePlaylistExpired}
          />
        ) : state.status === 'denied' ? (
          // aspect-ratio box that may grow: on narrow phones the paywall is taller than 16:9.
          <div className="relative aspect-video bg-[#16213e] rounded-xl flex items-center justify-center p-4">
            {thumbnailUrl && (
              <div className="absolute inset-0 overflow-hidden rounded-xl" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails are short-lived presigned MinIO/S3 or BunnyCDN signed URLs whose host is per-deployment and whose query string changes on every request; next/image would need build-time remotePatterns and its optimizer cache would miss on every new signature. */}
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="w-full h-full object-cover blur-sm opacity-30"
                />
              </div>
            )}
            <div className="relative w-full max-w-lg">
              <Paywall payload={state.paywall} videoId={videoId} />
            </div>
          </div>
        ) : (
          <div className="aspect-video bg-[#16213e] rounded-xl flex items-center justify-center">
            <p className="text-gray-500">Video unavailable</p>
          </div>
        )}
      </div>
      {!hasServerMetadata && video && <VideoMeta video={video} />}
    </>
  );
}
