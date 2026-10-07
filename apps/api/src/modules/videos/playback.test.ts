import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { PlaybackService } from './playback.service';
import type { StorageService } from '../../storage/storage.service';

const VIDEO = '11111111-2222-3333-4444-555555555555';

/** In-memory stand-in for the private bucket; presigned URLs are recognisable strings. */
function fakeStorage(files: Record<string, string>): StorageService {
  return {
    videoBucketName: 'videos',
    download: async (_bucket: string, key: string) => {
      if (!(key in files)) throw new Error('NoSuchKey');
      return Buffer.from(files[key]!);
    },
    getPresignedGetUrl: async (_bucket: string, key: string, ttl: number) =>
      `https://s3.local/${key}?sig=x&ttl=${ttl}`,
  } as unknown as StorageService;
}

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=464000\n240p/index.m3u8\n';
const RENDITION =
  '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg000.ts\n#EXTINF:4.2,\nseg001.ts\n#EXT-X-ENDLIST\n';

describe('PlaybackService (API-delivered HLS)', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.PLAYBACK_SIGNING_SECRET = 'playback-secret-for-tests-0123456789';
    delete process.env.BUNNYCDN_PULLZONE;
    delete process.env.BUNNYCDN_SIGNING_KEY;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const storage = fakeStorage({
    [`videos/${VIDEO}/master.m3u8`]: MASTER,
    [`videos/${VIDEO}/240p/index.m3u8`]: RENDITION,
  });

  it('grants a tokenised master URL under the API base', async () => {
    const svc = new PlaybackService(storage);
    const g = await svc.grant(VIDEO, `videos/${VIDEO}/master.m3u8`, 'https://api.example/');
    expect(g.kind).toBe('hls');
    expect(g.url).toMatch(
      new RegExp(`^https://api\\.example/playback/${VIDEO}/\\d+\\.[\\w-]+/master\\.m3u8$`),
    );
  });

  it('serves the master untouched and presigns every segment of a rendition', async () => {
    const svc = new PlaybackService(storage);
    const token = svc.sign(VIDEO, Math.floor(Date.now() / 1000) + 600);

    expect(await svc.playlist(VIDEO, token, 'master.m3u8')).toBe(MASTER);

    const out = await svc.playlist(VIDEO, token, '240p/index.m3u8');
    expect(out).toContain(`https://s3.local/videos/${VIDEO}/240p/seg000.ts?sig=x`);
    expect(out).toContain(`https://s3.local/videos/${VIDEO}/240p/seg001.ts?sig=x`);
    expect(out).toContain('#EXT-X-ENDLIST');
    expect(out).not.toMatch(/^seg\d+\.ts$/m);
  });

  it('rejects expired, tampered or cross-video tokens', async () => {
    const svc = new PlaybackService(storage);
    const exp = Math.floor(Date.now() / 1000) + 600;
    const good = svc.sign(VIDEO, exp);

    await expect(svc.playlist(VIDEO, svc.sign(VIDEO, exp - 1200), 'master.m3u8')).rejects.toThrow();
    await expect(
      svc.playlist(VIDEO, `${exp + 1}.${good.split('.')[1]}`, 'master.m3u8'),
    ).rejects.toThrow();
    await expect(
      svc.playlist('99999999-2222-3333-4444-555555555555', good, 'master.m3u8'),
    ).rejects.toThrow();
  });

  it('only serves playlist paths, never arbitrary objects', async () => {
    const svc = new PlaybackService(storage);
    const token = svc.sign(VIDEO, Math.floor(Date.now() / 1000) + 600);
    await expect(svc.playlist(VIDEO, token, 'original.mp4')).rejects.toThrow();
    await expect(svc.playlist(VIDEO, token, '../other/master.m3u8')).rejects.toThrow();
  });

  it('serves MVP-mode MP4s as progressive presigned URLs', async () => {
    const svc = new PlaybackService(storage);
    const g = await svc.grant(VIDEO, `videos/${VIDEO}/original.mp4`, 'https://api.example');
    expect(g.kind).toBe('progressive');
    expect(g.url).toMatch(/^https:\/\/s3\.local\/videos\/.+\/original\.mp4\?sig=x&ttl=\d+$/);
  });
});

describe('PlaybackService (BunnyCDN)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('signs a directory token in the path so relative HLS URIs inherit it', async () => {
    process.env.BUNNYCDN_PULLZONE = 'streamzw.b-cdn.net';
    process.env.BUNNYCDN_SIGNING_KEY = 'bunny-key';
    const svc = new PlaybackService(fakeStorage({}));
    const g = await svc.grant(VIDEO, `videos/${VIDEO}/master.m3u8`, 'unused');

    const m =
      /^https:\/\/streamzw\.b-cdn\.net\/bcdn_token=([\w-]+)&expires=(\d+)&token_path=([^/]+)(\/.*)$/.exec(
        g.url,
      );
    expect(m).not.toBeNull();
    const [, token, expires, tokenPath, path] = m!;
    expect(decodeURIComponent(tokenPath!)).toBe(`/videos/${VIDEO}/`);
    expect(path).toBe(`/videos/${VIDEO}/master.m3u8`);

    const expected = createHash('sha256')
      .update(`bunny-key/videos/${VIDEO}/${expires}token_path=/videos/${VIDEO}/`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(token).toBe(expected);
  });
});
