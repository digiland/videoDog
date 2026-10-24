import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { liveLadderFor } from '@streamzw/shared';
import { buildLiveArgs } from './ffmpeg-args';
import { finalizePlaylist, playlistDuration, segmentNames } from './playlist';

function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version']).status === 0;
}

describe.skipIf(!hasFfmpeg())('live ladder (real ffmpeg)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ladder-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('copies a 1080p H.264 feed, encodes 720/480/240, and finalises into a replay', () => {
    const input = path.join(dir, 'feed.mp4');
    const gen = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1920x1080:rate=30:duration=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=6',
      '-c:v',
      'libx264',
      '-g',
      '60',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      input,
    ]);
    expect(gen.status).toBe(0);

    const out = path.join(dir, 'hls');
    const ladder = liveLadderFor(1080);
    for (const r of ladder) fs.mkdirSync(path.join(out, `${r.height}p`), { recursive: true });
    const args = buildLiveArgs({
      input,
      outDir: out,
      ladder,
      source: { width: 1920, height: 1080, codec: 'h264', fps: 30, hasAudio: true },
      encoder: 'libx264',
      record: true,
    });
    const run = spawnSync('ffmpeg', args);
    expect(run.status, run.stderr.toString()).toBe(0);

    const master = fs.readFileSync(path.join(out, 'master.m3u8'), 'utf8');
    for (const h of [240, 480, 720, 1080]) expect(master).toContain(`${h}p/index.m3u8`);
    expect(master).toContain('RESOLUTION=1920x1080');

    const top = fs.readFileSync(path.join(out, '1080p', 'index.m3u8'), 'utf8');
    expect(segmentNames(top).length).toBeGreaterThan(0);
    const vod = finalizePlaylist(top);
    expect(vod).toContain('#EXT-X-ENDLIST');
    expect(playlistDuration(vod)).toBeGreaterThanOrEqual(5);

    // The 240p rendition really is 240 lines tall.
    const seg = path.join(
      out,
      '240p',
      segmentNames(fs.readFileSync(path.join(out, '240p', 'index.m3u8'), 'utf8'))[0]!,
    );
    const probe = spawnSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=height',
      '-of',
      'csv=p=0',
      seg,
    ]);
    expect(probe.stdout.toString().trim().split('\n')[0]).toBe('240');
  }, 60_000);
});
