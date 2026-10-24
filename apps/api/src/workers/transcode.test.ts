import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ladderFor, listFiles, probe, transcodeToHls, extractThumbnail } from './transcode';

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('ladderFor', () => {
  it('never upscales and always yields at least one rendition', () => {
    expect(ladderFor(1080).map((r) => r.height)).toEqual([240, 480, 720, 1080]);
    expect(ladderFor(720).map((r) => r.height)).toEqual([240, 480, 720]);
    expect(ladderFor(500).map((r) => r.height)).toEqual([240, 480]);
    expect(ladderFor(144).map((r) => r.height)).toEqual([240]);
  });
});

describe.skipIf(!hasFfmpeg())('transcodeToHls (real ffmpeg)', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-test-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  function makeSource(name: string, size: string, withAudio: boolean, seconds = 13): string {
    const out = path.join(dir, name);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${size}:rate=25:duration=${seconds}`,
    ];
    if (withAudio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
    if (withAudio) args.push('-c:a', 'aac', '-shortest');
    args.push(out);
    execFileSync('ffmpeg', args);
    return out;
  }

  it('builds a 240p+480p ladder from a 480p source with a master playlist', async () => {
    const src = makeSource('in480.mp4', '854x480', true);
    const meta = await probe(src);
    expect(meta).toMatchObject({ height: 480, hasAudio: true, durationSeconds: 13 });

    const out = path.join(dir, 'out480');
    fs.mkdirSync(out);
    const ladder = ladderFor(meta.height);
    await transcodeToHls(src, out, ladder, meta.hasAudio);

    const files = listFiles(out);
    expect(files).toContain('master.m3u8');
    expect(files).toContain('240p/index.m3u8');
    expect(files).toContain('480p/index.m3u8');
    expect(files.some((f) => f.startsWith('720p/'))).toBe(false);

    const master = fs.readFileSync(path.join(out, 'master.m3u8'), 'utf8');
    expect(master).toMatch(/RESOLUTION=\d+x240/);
    expect(master).toMatch(/RESOLUTION=854x480/);
    expect(master).toMatch(/CODECS="avc1\.[0-9a-f]+,mp4a\.40\.2"/);
    expect(master).toContain('240p/index.m3u8');

    // Aligned 6s segments: 13s → 3 segments in each rendition.
    for (const h of ['240p', '480p']) {
      const pl = fs.readFileSync(path.join(out, h, 'index.m3u8'), 'utf8');
      expect(pl).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
      expect(pl.match(/^seg\d{3}\.ts$/gm)).toHaveLength(3);
    }
  }, 120_000);

  it('handles silent sources and makes a poster frame', async () => {
    const src = makeSource('silent.mp4', '640x360', false, 4);
    const meta = await probe(src);
    expect(meta.hasAudio).toBe(false);
    const out = path.join(dir, 'outSilent');
    fs.mkdirSync(out);
    await transcodeToHls(src, out, ladderFor(meta.height), false);
    expect(listFiles(out)).toContain('240p/index.m3u8');

    const thumb = path.join(dir, 'thumb.jpg');
    await extractThumbnail(src, thumb, meta.durationSeconds);
    expect(fs.statSync(thumb).size).toBeGreaterThan(1000);
  }, 120_000);
});
