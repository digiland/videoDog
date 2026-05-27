'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../../src/lib/api';

export interface CaptionTrack {
  id: string;
  language: string;
  label: string;
  kind: 'subtitles' | 'captions';
  is_default?: boolean;
  url: string;
}

interface PlayerProps {
  src: string;
  videoId: string;
  sessionId?: string;
  captions?: CaptionTrack[];
}

interface HlsLevel {
  height: number;
  bitrate: number;
}

export default function Player({ src, videoId, captions = [] }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import('hls.js').default | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1); // -1 = auto
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const defaultCaption = captions.find((c) => c.is_default)?.id ?? null;
  const [activeCaptionId, setActiveCaptionId] = useState<string | null>(defaultCaption);
  const [ccMenuOpen, setCcMenuOpen] = useState(false);

  function selectCaption(id: string | null) {
    setActiveCaptionId(id);
    setCcMenuOpen(false);
    const video = videoRef.current;
    if (!video) return;
    Array.from(video.textTracks).forEach((t) => {
      t.mode = t.id === id ? 'showing' : 'disabled';
    });
  }

  const startSession = useCallback(async () => {
    if (sessionIdRef.current) return;
    try {
      const res = await api.post<{ id: string }>('/watch/sessions', {
        video_id: videoId,
      });
      sessionIdRef.current = res.id;
    } catch {
      // non-fatal — session tracking best-effort
    }
  }, [videoId]);

  const sendHeartbeat = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      await api.post(`/watch/sessions/${sessionIdRef.current}/heartbeat`);
    } catch {
      // ignore
    }
  }, []);

  const endSession = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      await api.post(`/watch/sessions/${sessionIdRef.current}/end`);
    } catch {
      // ignore
    }
    sessionIdRef.current = null;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;

    async function initPlayer() {
      if (destroyed || !video) return;

      if (typeof window === 'undefined') return;

      // Plain MP4 / WebM — let the browser handle it directly.
      const isHls = /\.m3u8(\?|$)/i.test(src);
      if (!isHls) {
        video.src = src;
        return;
      }

      // Dynamic import to avoid SSR issues
      const HlsModule = await import('hls.js');
      const Hls = HlsModule.default;

      if (destroyed) return;

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          setLevels(
            data.levels.map((l) => ({
              height: l.height,
              bitrate: l.bitrate,
            })),
          );
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          setCurrentLevel(data.level);
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        video.src = src;
      }
    }

    void initPlayer();

    return () => {
      destroyed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      void endSession();
    };
  }, [src, endSession]);

  function handlePlay() {
    void startSession();
    setPlaying(true);
    heartbeatRef.current = setInterval(() => void sendHeartbeat(), 15_000);
  }

  function handlePause() {
    setPlaying(false);
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }

  function handleEnded() {
    setPlaying(false);
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    void endSession();
  }

  function handleTimeUpdate() {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }

  function handleLoadedMetadata() {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }

  function togglePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const t = Number(e.target.value);
    video.currentTime = t;
    setCurrentTime(t);
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const v = Number(e.target.value);
    video.volume = v;
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
    if (!container) return;
    if (!document.fullscreenElement) {
      await container.requestFullscreen();
      setFullscreen(true);
    } else {
      await document.exitFullscreen();
      setFullscreen(false);
    }
  }

  function handleQualityChange(level: number) {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentLevel(level);
    }
  }

  function formatTime(s: number): string {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function showControlsTemporarily() {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  }

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded-xl overflow-hidden aspect-video group"
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => setShowControls(false)}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-full"
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onClick={togglePlayPause}
        playsInline
        crossOrigin="anonymous"
      >
        {captions.map((c) => (
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

      {/* Controls overlay */}
      <div
        className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity duration-200 ${
          showControls || !playing ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Center play/pause */}
        {!playing && (
          <button
            onClick={togglePlayPause}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="w-16 h-16 rounded-full bg-[#e94560]/90 flex items-center justify-center">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
        )}

        {/* Bottom bar */}
        <div className="px-4 pb-4 pt-2 space-y-2">
          {/* Progress bar */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 accent-[#e94560] cursor-pointer"
          />

          {/* Controls row */}
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              onClick={togglePlayPause}
              className="text-white hover:text-[#e94560] transition min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              {playing ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="text-white hover:text-[#e94560] transition min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                {muted || volume === 0 ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-20 h-1 accent-[#e94560] cursor-pointer hidden sm:block"
              />
            </div>

            {/* Time */}
            <span className="text-white text-xs font-mono flex-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            {/* CC selector */}
            {captions.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setCcMenuOpen((v) => !v)}
                  className={`text-xs font-bold border rounded px-2 py-1 transition ${
                    activeCaptionId
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-gray-500 text-white hover:text-accent hover:border-accent'
                  }`}
                  aria-label="Closed captions"
                >
                  CC
                </button>
                {ccMenuOpen && (
                  <div className="absolute bottom-full mb-2 right-0 bg-bg-elev border border-line rounded-md shadow-2xl py-1 min-w-[160px] z-10">
                    <button
                      onClick={() => selectCaption(null)}
                      className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-surface transition ${
                        activeCaptionId === null ? 'text-accent font-semibold' : 'text-ink-mute'
                      }`}
                    >
                      Off
                    </button>
                    {captions.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectCaption(c.id)}
                        className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-surface transition ${
                          activeCaptionId === c.id ? 'text-accent font-semibold' : 'text-ink-mute'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quality selector */}
            {levels.length > 0 && (
              <select
                value={currentLevel}
                onChange={(e) => handleQualityChange(Number(e.target.value))}
                className="bg-black/60 text-white text-xs rounded px-1.5 py-1 border border-gray-600 focus:outline-none"
              >
                <option value={-1}>Auto</option>
                {levels.map((l, i) => (
                  <option key={i} value={i}>
                    {l.height}p
                  </option>
                ))}
              </select>
            )}

            {/* Fullscreen */}
            <button
              onClick={() => void toggleFullscreen()}
              className="text-white hover:text-[#e94560] transition min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              {fullscreen ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
