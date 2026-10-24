/**
 * Live ABR ladder. Live goes higher than VOD (up to 2160p) because event streams — concerts,
 * matches, church services — are where creators bring 4K cameras; the phone renditions
 * stay so a viewer on a bundle can still watch at 240p. Bitrates are per rendition.
 */
export const LIVE_LADDER = [
  { height: 240, videoKbps: 300, audioKbps: 64 },
  { height: 480, videoKbps: 800, audioKbps: 64 },
  { height: 720, videoKbps: 1800, audioKbps: 96 },
  { height: 1080, videoKbps: 3500, audioKbps: 128 },
  { height: 1440, videoKbps: 8000, audioKbps: 128 },
  { height: 2160, videoKbps: 16000, audioKbps: 160 },
] as const;

export type LiveRendition = (typeof LIVE_LADDER)[number];

/** Highest live rendition we produce. Sources above it are scaled down to it. */
export const LIVE_MAX_HEIGHT = 2160;

/**
 * Renditions for a source of `sourceHeight`: every rung at or below it (never upscale),
 * always at least 240p. The top rung may be the source itself (copied, not re-encoded).
 */
export function liveLadderFor(sourceHeight: number): LiveRendition[] {
  const fits = LIVE_LADDER.filter((r) => r.height <= Math.min(sourceHeight, LIVE_MAX_HEIGHT));
  return fits.length > 0 ? [...fits] : [LIVE_LADDER[0]];
}

/** "4K" / "1440p" / "1080p" — how a source resolution is labelled to people. */
export function resolutionLabel(height: number | null | undefined): string | null {
  if (!height) return null;
  if (height >= 2160) return '4K';
  return `${height}p`;
}

/** MediaMTX path for a stream: `live/<stream id>` (RTMP app `live`, SRT `publish:live/...`). */
export function livePath(streamId: string): string {
  return `live/${streamId}`;
}

/** The stream id from a MediaMTX path, or null if it isn't one of ours. */
export function streamIdFromPath(path: string): string | null {
  const m = /^live\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
  return m ? m[1]!.toLowerCase() : null;
}
