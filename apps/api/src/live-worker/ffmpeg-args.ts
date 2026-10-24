import * as path from 'path';
import type { LiveRendition } from '@streamzw/shared';

/** Segment length. With OBS keyframes every 2s (what we tell creators), cuts land on 4s. */
export const LIVE_SEGMENT_SECONDS = 4;
/** Without a recording, keep a one-minute window and delete older segments. */
export const LIVE_WINDOW_SEGMENTS = 15;

/**
 * `libx264` runs anywhere (budget ~4 CPU cores per 1080p ladder; a 4K ladder needs a big
 * box). `h264_nvenc` uses an NVIDIA GPU: decode, scale and encode stay on the card, which is
 * how a 4K source with five renditions runs in real time on one server.
 */
export type LiveEncoder = 'libx264' | 'h264_nvenc';

export interface LiveSource {
  width: number;
  height: number;
  codec: string;
  fps: number | null;
  hasAudio: boolean;
}

export interface LiveArgsInput {
  input: string;
  outDir: string;
  ladder: readonly LiveRendition[];
  source: LiveSource;
  encoder: LiveEncoder;
  /** Keep every segment (event playlist → the replay); otherwise a rolling window. */
  record: boolean;
}

/**
 * Pass the source through untouched when it is H.264 at exactly a ladder height: a 4K
 * camera feed reaches 4K viewers without a generation loss or a 4K encode. Everything else
 * is encoded. (HEVC/AV1 sources are re-encoded to H.264 so every phone can play them.)
 */
export function copyRung(ladder: readonly LiveRendition[], source: LiveSource): number | null {
  if (source.codec !== 'h264') return null;
  const top = ladder[ladder.length - 1];
  return top && top.height === source.height ? ladder.length - 1 : null;
}

/** One ffmpeg process: one input, every rendition, HLS out (`<h>p/index.m3u8`, `seg00001.ts`). */
export function buildLiveArgs(o: LiveArgsInput): string[] {
  const copy = copyRung(o.ladder, o.source);
  const encoded = o.ladder.map((r, i) => ({ r, i })).filter(({ i }) => i !== copy);
  const nvenc = o.encoder === 'h264_nvenc';

  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin'];
  if (o.input.startsWith('rtsp://')) args.push('-rtsp_transport', 'tcp');
  if (nvenc) args.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda');
  args.push('-fflags', '+genpts', '-i', o.input);

  if (encoded.length > 0) {
    const scale = nvenc ? 'scale_cuda' : 'scale';
    const split = `[0:v]split=${encoded.length}${encoded.map(({ i }) => `[s${i}]`).join('')}`;
    const scales = encoded.map(({ r, i }) =>
      nvenc
        ? `[s${i}]${scale}=-2:${r.height}[v${i}]`
        : `[s${i}]${scale}=-2:${r.height},format=yuv420p[v${i}]`,
    );
    args.push('-filter_complex', [split, ...scales].join(';'));
  }

  o.ladder.forEach((r, i) => {
    if (i === copy) {
      args.push('-map', '0:v:0', `-c:v:${i}`, 'copy');
    } else {
      args.push(
        '-map',
        `[v${i}]`,
        `-c:v:${i}`,
        o.encoder,
        `-b:v:${i}`,
        `${r.videoKbps}k`,
        `-maxrate:v:${i}`,
        `${Math.round(r.videoKbps * 1.1)}k`,
        `-bufsize:v:${i}`,
        `${r.videoKbps * 2}k`,
        // Encoder options per stream: a global -profile/-preset would also hit the copied
        // rendition, and ffmpeg refuses encoder options on a stream copy.
        `-profile:v:${i}`,
        'high',
        ...(nvenc
          ? [`-preset:v:${i}`, 'p4', `-tune:v:${i}`, 'll', `-rc:v:${i}`, 'cbr']
          : [`-preset:v:${i}`, 'veryfast', `-tune:v:${i}`, 'zerolatency']),
        // Keyframe every 2s, on the same grid as the creator's encoder.
        `-force_key_frames:v:${i}`,
        'expr:gte(t,n_forced*2)',
        `-sc_threshold:v:${i}`,
        '0',
      );
    }
    if (o.source.hasAudio) {
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
    }
  });

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(LIVE_SEGMENT_SECONDS),
    '-hls_segment_filename',
    path.join(o.outDir, '%v', 'seg%05d.ts'),
    '-master_pl_name',
    'master.m3u8',
  );
  if (o.record) {
    // Event playlist: viewers can scrub back (DVR), and on reconnect ffmpeg appends.
    args.push(
      '-hls_list_size',
      '0',
      '-hls_playlist_type',
      'event',
      '-hls_flags',
      'independent_segments+append_list+discont_start+program_date_time',
    );
  } else {
    args.push(
      '-hls_list_size',
      String(LIVE_WINDOW_SEGMENTS),
      '-hls_flags',
      'independent_segments+delete_segments+program_date_time',
    );
  }
  args.push(
    '-var_stream_map',
    o.ladder
      .map((r, i) =>
        o.source.hasAudio ? `v:${i},a:${i},name:${r.height}p` : `v:${i},name:${r.height}p`,
      )
      .join(' '),
    path.join(o.outDir, '%v', 'index.m3u8'),
  );
  return args;
}
