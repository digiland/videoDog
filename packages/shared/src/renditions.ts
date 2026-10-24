/**
 * HLS quality ladder — the single source for the transcoder (what it produces) and the
 * apps (what each quality costs a viewer in data). Bitrates lean low on purpose: most
 * viewers are on prepaid mobile data.
 */
export const RENDITION_LADDER = [
  { height: 240, videoKbps: 300, audioKbps: 64 },
  { height: 480, videoKbps: 700, audioKbps: 64 },
  { height: 720, videoKbps: 1500, audioKbps: 96 },
  { height: 1080, videoKbps: 3000, audioKbps: 128 },
] as const;

export type Rendition = (typeof RENDITION_LADDER)[number];

/**
 * Approximate data used to watch `seconds` at `height`, in whole megabytes (10^6 bytes,
 * as mobile networks bill). Integer maths: no floats near anything people pay for.
 */
export function dataCostMb(height: number, seconds: number): number {
  const r = RENDITION_LADDER.find((x) => x.height === height) ?? RENDITION_LADDER[0];
  const bits = (r.videoKbps + r.audioKbps) * 1000 * Math.max(0, Math.round(seconds));
  return Math.max(1, Math.round(bits / 8 / 1_000_000));
}

/** Data used per minute at `height`, in megabytes, one decimal (e.g. 2.7). */
export function dataPerMinuteMb(height: number): number {
  const r = RENDITION_LADDER.find((x) => x.height === height) ?? RENDITION_LADDER[0];
  return Math.round(((r.videoKbps + r.audioKbps) * 60) / 8 / 100) / 10;
}
