import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * HLS ladder. Bitrates lean low on purpose: most viewers are on prepaid mobile data, so
 * 240p/480p must look decent at small sizes, and low renditions carry 64 kbps audio.
 */
export const LADDER = [
  { height: 240, videoKbps: 300, audioKbps: 64 },
  { height: 480, videoKbps: 700, audioKbps: 64 },
  { height: 720, videoKbps: 1500, audioKbps: 96 },
  { height: 1080, videoKbps: 3000, audioKbps: 128 },
] as const;

export type Rendition = (typeof LADDER)[number];

/** Segment length in seconds. Keyframes are forced on this grid in every rendition. */
export const SEGMENT_SECONDS = 6;

export type ProbeResult = { durationSeconds: number; height: number; hasAudio: boolean };

export async function probe(inputPath: string): Promise<ProbeResult> {
  const out = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ]);
  const meta = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: {
      codec_type?: string;
      height?: number;
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
      width?: number;
    }[];
  };
  const video = meta.streams?.find((s) => s.codec_type === 'video');
  if (!video?.height || !video.width) throw new Error('No video stream found');

  // Phone footage is often stored landscape with a rotation flag; ffmpeg auto-rotates, so
  // the displayed height is the stored width.
  const rotation = Math.abs(
    Number(
      video.tags?.rotate ?? video.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0,
    ),
  );
  const displayHeight = rotation === 90 || rotation === 270 ? video.width : video.height;

  return {
    durationSeconds: Math.round(Number(meta.format?.duration ?? 0)),
    height: displayHeight,
    hasAudio: !!meta.streams?.some((s) => s.codec_type === 'audio'),
  };
}

/** Renditions at or below the source height — never upscale. Always at least one. */
export function ladderFor(sourceHeight: number): Rendition[] {
  const fits = LADDER.filter((r) => r.height <= sourceHeight);
  return fits.length > 0 ? fits : [LADDER[0]];
}

/**
 * One ffmpeg pass: decode once, scale into every rendition, write each as an HLS VOD
 * playlist under `<outDir>/<h>p/` plus `master.m3u8` (with BANDWIDTH, RESOLUTION and
 * CODECS, which players need for sensible ABR).
 */
export async function transcodeToHls(
  inputPath: string,
  outDir: string,
  ladder: readonly Rendition[],
  hasAudio: boolean,
): Promise<void> {
  const n = ladder.length;
  for (const r of ladder) fs.mkdirSync(path.join(outDir, `${r.height}p`), { recursive: true });
  const split = `[0:v]split=${n}${ladder.map((_, i) => `[s${i}]`).join('')}`;
  const scales = ladder.map((r, i) => `[s${i}]scale=-2:${r.height}[v${i}]`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath];
  args.push('-filter_complex', [split, ...scales].join(';'));

  ladder.forEach((r, i) => {
    args.push(
      '-map',
      `[v${i}]`,
      `-c:v:${i}`,
      'libx264',
      `-b:v:${i}`,
      `${r.videoKbps}k`,
      `-maxrate:v:${i}`,
      `${Math.round(r.videoKbps * 1.07)}k`,
      `-bufsize:v:${i}`,
      `${r.videoKbps * 2}k`,
    );
    if (hasAudio)
      args.push(
        '-map',
        '0:a:0',
        `-c:a:${i}`,
        'aac',
        `-b:a:${i}`,
        `${r.audioKbps}k`,
        `-ac:a:${i}`,
        '2',
      );
  });

  args.push(
    '-preset',
    'veryfast',
    '-profile:v',
    'main',
    '-pix_fmt',
    'yuv420p',
    // Same keyframe grid in every rendition so players can switch quality at any segment.
    '-force_key_frames',
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    '-sc_threshold',
    '0',
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    path.join(outDir, '%v', 'seg%03d.ts'),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    ladder
      .map((r, i) => (hasAudio ? `v:${i},a:${i},name:${r.height}p` : `v:${i},name:${r.height}p`))
      .join(' '),
    path.join(outDir, '%v', 'index.m3u8'),
  );

  await run('ffmpeg', args);
}

/** Grab a poster frame (10% in, capped at 5s, so very short clips still work). */
export async function extractThumbnail(
  inputPath: string,
  outPath: string,
  durationSeconds: number,
): Promise<void> {
  const at = Math.min(5, Math.max(0, durationSeconds * 0.1));
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    at.toFixed(2),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=-2:480',
    '-q:v',
    '3',
    outPath,
  ]);
}

/** All files under `dir`, relative paths, deepest first is irrelevant — order is stable. */
export function listFiles(dir: string, prefix = ''): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`)
        : [`${prefix}${e.name}`],
    );
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`)),
    );
  });
}
