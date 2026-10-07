'use client';
import { dataPerMinuteMb } from '@streamzw/shared';
import type Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../src/lib/api';
import type { CaptionTrack, PlayablePlaylist } from '../../src/types/api';
import { useDataSaver } from '../../src/ui/data-saver';
import { Icon } from '../../src/ui/icon';
import { ChoiceGrid, DataSaverSwitch, PlayerPanel } from './viewer/PlayerPanel';

export type { CaptionTrack };

const HEARTBEAT_MS = 15_000;
const HIDE_CONTROLS_MS = 3_000;
const SAVER_HEIGHT = 240;

interface PlayerProps {
  videoId: string;
  /** Directly playable URL from GET /videos/:id/playlist (token embedded). */
  src: string;
  kind: PlayablePlaylist['kind'];
  captions?: CaptionTrack[];
  /** Shown until the first frame; nothing else downloads before the viewer presses play. */
  poster?: string | null;
  /**
   * Called when the signed playlist URL has expired mid-session. The parent refetches
   * /videos/:id/playlist and re-renders the player with the new `src`; resolves to
   * false if a fresh URL could not be obtained.
   */
  onPlaylistExpired?: () => Promise<boolean>;
}

interface HlsLevel {
  height: number;
  bitrate: number;
}

function isAuthStatus(code: number | undefined): boolean {
  return code === 401 || code === 403;
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = (total % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Highest level at or below 240p (levels are sorted by bitrate, lowest first). */
function saverCap(levels: HlsLevel[]): number {
  let cap = 0;
  levels.forEach((l, i) => {
    if (l.height > 0 && l.height <= SAVER_HEIGHT) cap = i;
  });
  return cap;
}

const CONTROL =
  'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded text-ink transition-colors hover:bg-surface-2';

/**
 * Video player. Built for prepaid data:
 * - nothing but the manifest loads until the viewer presses play (no fragment preloading);
 * - starts at the lowest rendition so first frames arrive fast, then ABR climbs, capped to
 *   the player's size; Data Saver locks it to 240p;
 * - the forward buffer is capped at 60s, so abandoning a video wastes little data;
 * - quality options show their cost in MB per minute.
 */
export default function Player({
  videoId,
  src,
  kind,
  captions = [],
  poster,
  onPlaylistExpired,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const loadStartedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionPromiseRef = useRef<Promise<string | null> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // Source-expiry recovery: one refetch per failure; re-armed once media loads again.
  const refreshInFlightRef = useRef(false);
  const refreshArmedRef = useRef(true);
  const resumeRef = useRef<{ time: number; play: boolean } | null>(null);
  const onPlaylistExpiredRef = useRef(onPlaylistExpired);
  onPlaylistExpiredRef.current = onPlaylistExpired;

  const [saver, setSaver] = useDataSaver();
  const saverRef = useRef(saver);
  saverRef.current = saver;

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [playingLevel, setPlayingLevel] = useState(-1);
  const [chosenLevel, setChosenLevel] = useState(-1); // -1 = Auto
  const [panel, setPanel] = useState<null | 'quality' | 'captions'>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qualityButtonRef = useRef<HTMLButtonElement>(null);
  const captionsButtonRef = useRef<HTMLButtonElement>(null);
  const firstCaption = captions[0];
  const defaultCaption = captions.find((c) => c.is_default)?.id ?? null;
  const [activeCaptionId, setActiveCaptionId] = useState<string | null>(defaultCaption);

  // ── Watch session + heartbeats ──────────────────────────────────────────────

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const sendHeartbeat = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      await api.post(`/watch/sessions/${id}/heartbeat`);
    } catch {
      // best-effort
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    // Never stack intervals: always clear before starting.
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
  }, [sendHeartbeat, stopHeartbeat]);

  const ensureSession = useCallback((): Promise<string | null> => {
    if (sessionIdRef.current) return Promise.resolve(sessionIdRef.current);
    // De-duplicate concurrent play events so only one session is created.
    if (!sessionPromiseRef.current) {
      sessionPromiseRef.current = api
        .post<{ session_id: string }>('/watch/sessions', { video_id: videoId })
        .then((res) => {
          sessionIdRef.current = res.session_id;
          return res.session_id;
        })
        .catch(() => null) // best-effort; playback continues without tracking
        .finally(() => {
          sessionPromiseRef.current = null;
        });
    }
    return sessionPromiseRef.current;
  }, [videoId]);

  const endSession = useCallback(async () => {
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    if (!id) return;
    try {
      await api.post(`/watch/sessions/${id}/end`);
    } catch {
      // best-effort
    }
  }, []);

  // Session lifetime is the component's (per video), independent of source reloads.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopHeartbeat();
      void endSession();
    };
  }, [stopHeartbeat, endSession]);

  // ── Source loading ──────────────────────────────────────────────────────────

  const recoverExpiredSource = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current;
    const refetch = onPlaylistExpiredRef.current;
    if (!video || !refetch || refreshInFlightRef.current || !refreshArmedRef.current) {
      return false;
    }
    refreshInFlightRef.current = true;
    refreshArmedRef.current = false;
    resumeRef.current = { time: video.currentTime, play: !video.paused };
    try {
      return await refetch(); // parent re-renders with a new `src`, which reloads below
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let destroyed = false;
    let mediaRecoveries = 0;
    loadStartedRef.current = false;
    setPlaybackError(null);

    function rearm() {
      refreshArmedRef.current = true;
    }

    function failExpired(ok: boolean) {
      if (!ok && !destroyed) setPlaybackError('The playback link expired. Reload the page.');
    }

    async function init(el: HTMLVideoElement) {
      if (kind === 'progressive') {
        el.src = src;
        return;
      }

      // Light build: no EME/alt-audio/in-stream subtitles (captions use native <track>).
      const { default: HlsCtor } = await import('hls.js/dist/hls.light.min.js');
      if (destroyed) return;

      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor({
          enableWorker: true,
          lowLatencyMode: false,
          // Fragments load on the first play, not on page view.
          autoStartLoad: false,
          // Lowest rendition first: quick first frame on weak networks; ABR climbs after.
          startLevel: 0,
          capLevelToPlayerSize: !saverRef.current,
          // Don't buffer far ahead: data spent past where the viewer stops is wasted.
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 30,
        });
        hlsRef.current = hls;
        hls.on(HlsCtor.Events.MANIFEST_PARSED, (_event, data) => {
          const parsed = data.levels.map((l) => ({ height: l.height, bitrate: l.bitrate }));
          if (saverRef.current) hls.autoLevelCapping = saverCap(parsed);
          setLevels(parsed);
        });
        hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_event, data) => {
          setPlayingLevel(data.level);
        });
        hls.on(HlsCtor.Events.FRAG_LOADED, rearm);
        hls.on(HlsCtor.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && isAuthStatus(data.response?.code)) {
            void recoverExpiredSource().then(failExpired);
            return;
          }
          if (data.details === HlsCtor.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) {
            setWaiting(false);
            setPlaybackError("This browser can't play this video's format. Try Chrome.");
            return;
          }
          // Decoder hiccup: recover twice at most, then say so instead of spinning forever.
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            mediaRecoveries += 1;
            hls.recoverMediaError();
            return;
          }
          setWaiting(false);
          setPlaybackError('Playback stopped: the video could not load. Check your connection.');
        });
        hls.loadSource(src);
        hls.attachMedia(el);
        // Recovering an expired link mid-watch: carry on loading straight away.
        if (resumeRef.current) {
          hls.startLoad(resumeRef.current.time);
          loadStartedRef.current = true;
        }
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari / iOS without MSE).
        el.src = src;
      } else {
        setPlaybackError("This browser can't play this video. Try Chrome.");
      }
    }

    // Native playback (progressive or Safari HLS) cannot report HTTP status codes, so a
    // network error is treated as a possible token expiry and gets the same single refetch.
    function onNativeError() {
      if (hlsRef.current || !video) return;
      if (video.error?.code === MediaError.MEDIA_ERR_NETWORK) {
        void recoverExpiredSource().then(failExpired);
      } else if (video.error) {
        setPlaybackError('Playback stopped: the video could not load.');
      }
    }

    function onLoadedData() {
      rearm();
      const resume = resumeRef.current;
      if (!resume || !video) return;
      resumeRef.current = null;
      video.currentTime = resume.time;
      if (resume.play) void video.play().catch(() => undefined);
    }

    video.addEventListener('error', onNativeError);
    video.addEventListener('loadeddata', onLoadedData);
    void init(video);

    return () => {
      destroyed = true;
      video.removeEventListener('error', onNativeError);
      video.removeEventListener('loadeddata', onLoadedData);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      setLevels([]);
      setPlayingLevel(-1);
      setChosenLevel(-1);
    };
  }, [src, kind, recoverExpiredSource]);

  // Data Saver: cap ABR at 240p (and drop a manual pick above it); off: fit the player size.
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls || levels.length === 0) return;
    if (saver) {
      const cap = saverCap(levels);
      hls.capLevelToPlayerSize = false;
      hls.autoLevelCapping = cap;
      if (chosenLevel > cap) {
        hls.nextLevel = cap;
        setChosenLevel(cap);
      }
    } else {
      hls.autoLevelCapping = -1;
      hls.capLevelToPlayerSize = true;
    }
  }, [saver, levels, chosenLevel]);

  // ── Controls visibility ─────────────────────────────────────────────────────

  const clearHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  /** Show controls; while playing (and no sheet is open) they hide again after ~3s. */
  const poke = useCallback(() => {
    setControlsVisible(true);
    clearHide();
    const v = videoRef.current;
    if (v && !v.paused && !panel) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), HIDE_CONTROLS_MS);
    }
  }, [clearHide, panel]);

  useEffect(() => {
    if (!playing || panel) {
      clearHide();
      setControlsVisible(true);
    } else {
      poke();
    }
    return clearHide;
  }, [playing, panel, poke, clearHide]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ── Media element events ────────────────────────────────────────────────────

  async function handlePlay() {
    setPlaying(true);
    const hls = hlsRef.current;
    if (hls && !loadStartedRef.current) {
      loadStartedRef.current = true;
      hls.startLoad();
    }
    const id = await ensureSession();
    const video = videoRef.current;
    // Only tick while actually playing; the user may have paused while we waited.
    if (!id || !mountedRef.current || !video || video.paused || video.ended) return;
    startHeartbeat();
  }

  function handlePause() {
    setPlaying(false);
    setWaiting(false);
    stopHeartbeat();
  }

  function handleEnded() {
    setPlaying(false);
    setWaiting(false);
    stopHeartbeat();
    void endSession();
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  function seekTo(t: number) {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(t, video.duration || 0));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  }

  function handleVolumeChange(v: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  async function toggleFullscreen() {
    const container = containerRef.current;
    const video = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!container) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (container.requestFullscreen) {
        await container.requestFullscreen();
        // Phones: turn sideways for a 16:9 video where the browser allows it.
        const orientation = screen.orientation as ScreenOrientation & {
          lock?: (o: string) => Promise<void>;
        };
        await orientation?.lock?.('landscape').catch(() => undefined);
      } else {
        video?.webkitEnterFullscreen?.(); // iOS Safari
      }
    } catch {
      // fullscreen refused (e.g. iframe without permission): stay inline
    }
  }

  function chooseLevel(level: number) {
    const hls = hlsRef.current;
    if (!hls) return;
    // nextLevel switches at the next fragment and keeps what's buffered (no re-download).
    hls.nextLevel = level;
    setChosenLevel(level);
  }

  function selectCaption(id: string | null) {
    setActiveCaptionId(id);
    const video = videoRef.current;
    if (!video) return;
    for (const t of Array.from(video.textTracks)) {
      t.mode = t.id === id ? 'showing' : 'disabled';
    }
  }

  function closePanel() {
    const which = panel;
    setPanel(null);
    (which === 'captions' ? captionsButtonRef : qualityButtonRef).current?.focus();
  }

  /** Tap on the picture: touch toggles the controls; mouse toggles playback. */
  function handleSurfacePointerUp(e: React.PointerEvent) {
    if (panel) return;
    if (e.pointerType === 'mouse') {
      togglePlay();
      poke();
      return;
    }
    if (controlsVisible && playing) {
      clearHide();
      setControlsVisible(false);
    } else {
      poke();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (panel || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT') return; // ranges handle their own arrows
    const video = videoRef.current;
    if (!video) return;
    const actions: Record<string, () => void> = {
      k: togglePlay,
      m: toggleMute,
      f: () => void toggleFullscreen(),
      ArrowLeft: () => seekTo(video.currentTime - 10),
      ArrowRight: () => seekTo(video.currentTime + 10),
      j: () => seekTo(video.currentTime - 10),
      l: () => seekTo(video.currentTime + 10),
    };
    const run = actions[e.key];
    if (!run) return;
    e.preventDefault();
    run();
    poke();
  }

  const showControls = controlsVisible || !playing || panel !== null || playbackError !== null;
  const autoHeight = playingLevel >= 0 ? levels[playingLevel]?.height : undefined;
  const qualityLabel =
    chosenLevel >= 0 ? `${levels[chosenLevel]?.height ?? ''}p` : saver ? '240p' : 'Auto';
  const cap = saverCap(levels);
  const started = playing || currentTime > 0;

  return (
    <div
      ref={containerRef}
      onPointerMove={(e) => e.pointerType === 'mouse' && poke()}
      onFocus={poke}
      onKeyDown={handleKeyDown}
      className={`theme-dark absolute inset-0 overflow-hidden bg-bg ${showControls ? '' : 'cursor-none'}`}
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        poster={poster ?? undefined}
        // MSE: hls.js decides what loads (nothing until play). Progressive: just the header.
        preload={kind === 'progressive' ? 'metadata' : 'auto'}
        onPlay={() => void handlePlay()}
        onPause={handlePause}
        onEnded={handleEnded}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
        onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
        onVolumeChange={() => setMuted(videoRef.current?.muted ?? false)}
        playsInline
        crossOrigin="anonymous"
      >
        {/* Text tracks come from the playlist response. The first sits in a literal <track>
            (empty when the video has none, so it loads nothing); the rest follow. */}
        <track
          kind="captions"
          id={firstCaption?.id}
          label={firstCaption?.label}
          srcLang={firstCaption?.language}
          src={firstCaption?.url}
          default={firstCaption !== undefined && firstCaption.id === defaultCaption}
        />
        {captions.slice(1).map((c) => (
          <track
            key={c.id}
            id={c.id}
            kind={c.kind}
            label={c.label}
            srcLang={c.language}
            src={c.url}
            default={c.id === defaultCaption}
          />
        ))}
      </video>

      {/* Tap/click layer over the picture (keyboard users have the play button and keys). */}
      <div aria-hidden="true" className="absolute inset-0" onPointerUp={handleSurfacePointerUp} />

      {waiting && playing && !playbackError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-scrim p-3">
            <Icon name="spinner" size={28} className="text-ink" label="Loading" />
          </span>
        </div>
      )}

      {!playing && !waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={togglePlay}
            className="pointer-events-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-strong"
          >
            <Icon name="play" size={28} className="ml-1" label={started ? 'Resume' : 'Play'} />
          </button>
        </div>
      )}

      {playbackError && (
        <div
          role="alert"
          className="absolute inset-x-2 top-2 z-10 flex items-start gap-2 rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
        >
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          {playbackError}
        </div>
      )}

      {/* Control bar */}
      <div
        className={`absolute inset-x-0 bottom-0 flex flex-col bg-scrim px-1 ${
          showControls ? '' : 'pointer-events-none opacity-0'
        }`}
      >
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          className="h-6 w-full cursor-pointer px-2 accent-accent"
        />
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={togglePlay} className={CONTROL}>
            <Icon name={playing ? 'pause' : 'play'} size={22} label={playing ? 'Pause' : 'Play'} />
          </button>
          <button type="button" onClick={toggleMute} className={CONTROL}>
            <Icon
              name={muted || volume === 0 ? 'mute' : 'volume'}
              size={22}
              label={muted || volume === 0 ? 'Unmute' : 'Mute'}
            />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            aria-label="Volume"
            className="hidden w-20 cursor-pointer accent-accent sm:block"
          />
          <span className="min-w-0 flex-1 truncate px-2 text-xs text-ink num">
            {duration > 0 && `${formatTime(currentTime)} / ${formatTime(duration)}`}
          </span>

          {captions.length > 0 && (
            <button
              ref={captionsButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={panel === 'captions'}
              onClick={() => setPanel(panel === 'captions' ? null : 'captions')}
              className={`${CONTROL} ${activeCaptionId ? 'text-accent' : ''}`}
            >
              <Icon name="captions" size={22} label="Captions" />
            </button>
          )}

          {levels.length > 0 && (
            <button
              ref={qualityButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={panel === 'quality'}
              onClick={() => setPanel(panel === 'quality' ? null : 'quality')}
              className={`${CONTROL} gap-1 px-2 text-xs font-semibold num`}
            >
              {saver && <Icon name="data" size={16} className="text-accent" />}
              <span className="sr-only">Quality: </span>
              {qualityLabel}
            </button>
          )}

          <button type="button" onClick={() => void toggleFullscreen()} className={CONTROL}>
            <Icon
              name={fullscreen ? 'shrink' : 'expand'}
              size={22}
              label={fullscreen ? 'Exit full screen' : 'Full screen'}
            />
          </button>
        </div>
      </div>

      {panel === 'quality' && (
        <PlayerPanel
          label="Quality"
          onClose={closePanel}
          header={<DataSaverSwitch on={saver} onChange={setSaver} />}
        >
          <ChoiceGrid
            legend="Quality"
            value={String(chosenLevel)}
            onChange={(v) => chooseLevel(Number(v))}
            choices={[
              {
                value: '-1',
                label: 'Auto',
                note: saver ? 'up to 240p' : autoHeight ? `now ${autoHeight}p` : undefined,
              },
              ...levels.map((l, i) => ({
                value: String(i),
                label: `${l.height}p`,
                note: `${dataPerMinuteMb(l.height)} MB/min`,
                disabled: saver && i > cap,
              })),
            ]}
          />
        </PlayerPanel>
      )}

      {panel === 'captions' && (
        <PlayerPanel label="Captions" onClose={closePanel}>
          <ChoiceGrid
            legend="Captions"
            value={activeCaptionId ?? 'off'}
            onChange={(v) => selectCaption(v === 'off' ? null : v)}
            choices={[
              { value: 'off', label: 'Off' },
              ...captions.map((c) => ({ value: c.id, label: c.label })),
            ]}
          />
        </PlayerPanel>
      )}
    </div>
  );
}
