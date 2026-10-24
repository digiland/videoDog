/**
 * Live worker — runs on the live server next to MediaMTX (infra/live).
 *
 *   node dist/live-worker/worker.js            ingest session (MediaMTX runOnReady, MTX_PATH set)
 *   node dist/live-worker/worker.js finalize <streamId>
 *
 * Ingest session: probe the creator's feed, run one ffmpeg that writes the HLS ladder to
 * LIVE_HLS_DIR/<id>/ (served by nginx with secure_link), tell the API once the first
 * segments exist, keep it posted, and stop if the creator ends the stream. When the feed
 * drops it reports `disconnected` and hands over to a detached finalizer, because MediaMTX
 * kills runOnReady commands once the stream is gone.
 *
 * Finalizer: wait out the reconnect grace. If the creator reconnects, a new session takes
 * over and the finalizer leaves. Once the API says the stream ended, claim the recording
 * (only one worker can), turn the playlists into VOD, upload everything to storage under
 * the backing video's keys, and report — or just clean up when there is nothing to keep.
 */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { liveLadderFor, streamIdFromPath, thumbnailKey } from '@streamzw/shared';
import { StorageService } from '../storage/storage.service';
import { listFiles } from '../workers/transcode';
import { buildLiveArgs, type LiveEncoder, type LiveSource } from './ffmpeg-args';
import { finalizePlaylist, playlistDuration } from './playlist';

const log = pino({ base: { service: 'live-worker' } });

const API = (process.env.LIVE_API_BASE ?? 'http://localhost:3001').replace(/\/+$/, '');
const SECRET = process.env.LIVE_INGEST_SECRET ?? 'dev-live-ingest-secret';
const HLS_DIR = process.env.LIVE_HLS_DIR ?? '/var/hls';
const RTSP_BASE = (process.env.LIVE_RTSP_BASE ?? 'rtsp://127.0.0.1:8554').replace(/\/+$/, '');
const ENCODER = (process.env.LIVE_ENCODER ?? 'libx264') as LiveEncoder;
/** Slightly longer than the API's 5-minute reconnect grace, so the API decides first. */
const FINALIZE_WAIT_MS = Number(process.env.LIVE_FINALIZE_WAIT_MS) || 7 * 60_000;
const POLL_MS = Number(process.env.LIVE_POLL_MS) || 10_000;

type Status = {
  id: string;
  video_id: string;
  state: 'scheduled' | 'live' | 'ended' | 'cancelled';
  record: boolean;
  ingest_connected: boolean;
  recording_state: 'none' | 'pending' | 'ready' | 'failed';
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(method: 'GET' | 'POST', p: string, body?: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}${p}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-live-secret': SECRET },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
}

const streamApi = (id: string) => `/live/ingest/streams/${id}`;

/** What the creator is sending: resolution, codec, frame rate, audio. */
export function probeSource(input: string): LiveSource {
  const r = spawnSync(
    'ffprobe',
    [
      ...(input.startsWith('rtsp://') ? ['-rtsp_transport', 'tcp'] : []),
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      input,
    ],
    { timeout: 20_000 },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr?.toString()}`);
  const meta = JSON.parse(r.stdout.toString()) as {
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
    }[];
  };
  const v = meta.streams?.find((s) => s.codec_type === 'video');
  if (!v?.width || !v.height) throw new Error('No video in the feed');
  const [num, den] = (v.avg_frame_rate ?? '0/1').split('/').map(Number);
  const fps = num && den ? Math.round(num / den) : null;
  return {
    width: v.width,
    height: v.height,
    codec: v.codec_name ?? 'unknown',
    fps,
    hasAudio: !!meta.streams?.some((s) => s.codec_type === 'audio'),
  };
}

async function waitForFile(file: string, ms: number, alive: () => boolean): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until && alive()) {
    if (fs.existsSync(file)) return true;
    await sleep(500);
  }
  return fs.existsSync(file);
}

function spawnFinalizer(id: string) {
  const child = spawn(process.execPath, [__filename, 'finalize', id], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

async function ingestSession(mtxPath: string) {
  const id = streamIdFromPath(mtxPath);
  if (!id) throw new Error(`Not a stream path: ${mtxPath}`);
  const status = await api<Status>('GET', streamApi(id));
  if (status.state !== 'scheduled' && status.state !== 'live') {
    log.warn({ id, state: status.state }, 'stream is not open for ingest');
    return;
  }

  const input = `${RTSP_BASE}/${mtxPath}`;
  const source = probeSource(input);
  const ladder = liveLadderFor(source.height);
  const outDir = path.join(HLS_DIR, id);
  for (const r of ladder) fs.mkdirSync(path.join(outDir, `${r.height}p`), { recursive: true });
  log.info({ id, source, ladder: ladder.map((r) => r.height), encoder: ENCODER }, 'ingest');

  const ffmpeg = spawn(
    'ffmpeg',
    buildLiveArgs({ input, outDir, ladder, source, encoder: ENCODER, record: status.record }),
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let running = true;
  ffmpeg.stderr.on('data', (d: Buffer) => log.warn({ id, ffmpeg: d.toString().trim() }));
  const exited = new Promise<number | null>((resolve) =>
    ffmpeg.on('exit', (code) => {
      running = false;
      resolve(code);
    }),
  );
  const stop = () => {
    if (running) ffmpeg.stdin.end('q'); // ffmpeg finishes the current segment cleanly
    setTimeout(() => running && ffmpeg.kill('SIGKILL'), 15_000).unref();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  // Viewers only get a URL once there is something to play.
  const top = path.join(outDir, `${ladder[ladder.length - 1]!.height}p`, 'index.m3u8');
  if (await waitForFile(top, 45_000, () => running)) {
    await api('POST', `${streamApi(id)}/events`, {
      event: 'started',
      width: source.width,
      height: source.height,
      fps: source.fps ?? undefined,
      codec: source.codec,
    });
    log.info({ id }, 'on air');
  }

  const heartbeat = setInterval(() => {
    void api<Status>('POST', `${streamApi(id)}/events`, { event: 'alive' })
      .then((s) => {
        if (s.state !== 'live') {
          log.info({ id, state: s.state }, 'stream closed by the API; stopping');
          stop();
        }
      })
      .catch((err: unknown) => log.error({ id, err }, 'heartbeat failed'));
  }, 15_000);

  const code = await exited;
  clearInterval(heartbeat);
  log.info({ id, code }, 'feed ended');
  await api('POST', `${streamApi(id)}/events`, { event: 'disconnected' }).catch((err: unknown) =>
    log.error({ id, err }, 'could not report disconnect'),
  );
  spawnFinalizer(id);
}

/** Only one finalizer per stream on this box. */
function takeLock(dir: string): boolean {
  const lock = path.join(dir, '.finalizer');
  try {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false; // another finalizer is alive
      } catch {
        // stale lock
      }
    }
  } catch {
    // no lock yet
  }
  fs.writeFileSync(lock, String(process.pid));
  return true;
}

async function finalize(id: string) {
  const dir = path.join(HLS_DIR, id);
  if (!fs.existsSync(dir) || !takeLock(dir)) return;
  const until = Date.now() + FINALIZE_WAIT_MS;
  let status = await api<Status>('GET', streamApi(id));
  while (status.state === 'live' && Date.now() < until) {
    if (status.ingest_connected) {
      log.info({ id }, 'creator reconnected; leaving it to the new session');
      fs.rmSync(path.join(dir, '.finalizer'), { force: true });
      return;
    }
    await sleep(POLL_MS);
    status = await api<Status>('GET', streamApi(id));
  }
  if (status.state !== 'ended') {
    log.warn({ id, state: status.state }, 'stream not ended after the wait; keeping files');
    fs.rmSync(path.join(dir, '.finalizer'), { force: true });
    return;
  }

  const claim = await api<{ claimed: boolean; video_id?: string }>(
    'POST',
    `${streamApi(id)}/recording/claim`,
  );
  if (!claim.claimed || !claim.video_id) {
    // Not recorded (or already handled): give stragglers a minute, then free the disk.
    await sleep(Math.min(60_000, FINALIZE_WAIT_MS));
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }

  try {
    const { duration, thumbnail } = await uploadRecording(dir, claim.video_id);
    await api('POST', `${streamApi(id)}/recording`, {
      status: 'ready',
      duration_seconds: duration,
      thumbnail,
    });
    log.info({ id, video: claim.video_id, duration }, 'replay published');
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    log.error({ id, err }, 'recording upload failed');
    await api('POST', `${streamApi(id)}/recording`, {
      status: 'failed',
      reason: String(err).slice(0, 400),
    }).catch(() => undefined);
  }
}

/** VOD playlists + every file to `videos/<videoId>/…`, a poster to `thumbs/<videoId>.jpg`. */
export async function uploadRecording(
  dir: string,
  videoId: string,
  storage = new StorageService(),
) {
  let duration = 0;
  for (const name of fs.readdirSync(dir)) {
    const playlist = path.join(dir, name, 'index.m3u8');
    if (!fs.existsSync(playlist)) continue;
    const vod = finalizePlaylist(fs.readFileSync(playlist, 'utf8'));
    fs.writeFileSync(playlist, vod);
    duration = Math.max(duration, playlistDuration(vod));
  }

  const files = listFiles(dir).filter((f) => !path.basename(f).startsWith('.'));
  // Segments first, playlists last: the replay never references a missing segment.
  files.sort((a, b) => Number(a.endsWith('.m3u8')) - Number(b.endsWith('.m3u8')));
  const queue = [...files];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        await storage.uploadFile(
          storage.videoBucketName,
          `videos/${videoId}/${f}`,
          path.join(dir, f),
          f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        );
      }
    }),
  );

  // Poster from 10s in (or the start), off the lowest rendition: cheapest to decode.
  const lowest = fs
    .readdirSync(dir)
    .filter((n) => /^\d+p$/.test(n))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))[0];
  let thumbnail = false;
  if (lowest) {
    const thumb = path.join(dir, 'poster.jpg');
    const r = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      duration > 20 ? '10' : '0',
      '-i',
      path.join(dir, lowest, 'index.m3u8'),
      '-frames:v',
      '1',
      '-q:v',
      '3',
      thumb,
    ]);
    if (r.status === 0 && fs.existsSync(thumb)) {
      await storage.uploadFile(storage.thumbBucketName, thumbnailKey(videoId), thumb, 'image/jpeg');
      thumbnail = true;
    }
  }
  return { duration, thumbnail };
}

async function main() {
  const [mode, id] = process.argv.slice(2);
  if (mode === 'finalize' && id) return finalize(id);
  const mtxPath = process.env.MTX_PATH;
  if (!mtxPath) throw new Error('MTX_PATH is not set (run me from MediaMTX runOnReady)');
  return ingestSession(mtxPath);
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      log.error({ err }, 'live worker failed');
      process.exit(1);
    },
  );
}
