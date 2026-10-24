import { describe, expect, it } from 'vitest';
import { liveLadderFor } from '@streamzw/shared';
import { buildLiveArgs, copyRung, type LiveSource } from './ffmpeg-args';
import { finalizePlaylist, fixMasterBandwidth, playlistDuration, segmentNames } from './playlist';

const src4k: LiveSource = { width: 3840, height: 2160, codec: 'h264', fps: 30, hasAudio: true };

function base(source: LiveSource, extra: Partial<Parameters<typeof buildLiveArgs>[0]> = {}) {
  return buildLiveArgs({
    input: 'rtsp://127.0.0.1:8554/live/abc',
    outDir: '/var/hls/abc',
    ladder: liveLadderFor(source.height),
    source,
    encoder: 'libx264',
    record: true,
    ...extra,
  });
}

describe('live ffmpeg args', () => {
  it('copies a 4K H.264 source and encodes the five lower rungs', () => {
    const args = base(src4k);
    const joined = args.join(' ');
    expect(copyRung(liveLadderFor(2160), src4k)).toBe(5);
    expect(joined).toContain('-map 0:v:0 -c:v:5 copy');
    expect(joined).toContain('[0:v]split=5[s0][s1][s2][s3][s4]');
    expect(joined).toContain('[s0]scale=-2:240,format=yuv420p[v0]');
    expect(joined).toContain('-c:v:3 libx264 -b:v:3 3500k');
    expect(joined).not.toContain('-c:v:5 libx264');
    expect(args).toContain(
      'v:0,a:0,name:240p v:1,a:1,name:480p v:2,a:2,name:720p v:3,a:3,name:1080p v:4,a:4,name:1440p v:5,a:5,name:2160p',
    );
    expect(joined).toContain('-rtsp_transport tcp');
    expect(joined).toContain('-hls_playlist_type event');
    expect(joined).toContain('append_list');
  });

  it('re-encodes HEVC sources and uses the GPU path with NVENC', () => {
    const hevc = { ...src4k, codec: 'hevc' };
    const args = base(hevc, { encoder: 'h264_nvenc' }).join(' ');
    expect(copyRung(liveLadderFor(2160), hevc)).toBeNull();
    expect(args).toContain('-hwaccel cuda -hwaccel_output_format cuda');
    expect(args).toContain('split=6');
    expect(args).toContain('[s5]scale_cuda=-2:2160[v5]');
    expect(args).toContain('-c:v:5 h264_nvenc -b:v:5 16000k');
    expect(args).toContain('-preset:v:5 p4 -tune:v:5 ll');
  });

  it('encodes everything for an off-ladder height, and runs a rolling window without audio', () => {
    const odd = { width: 2880, height: 1620, codec: 'h264', fps: 30, hasAudio: false };
    const args = base(odd, { record: false }).join(' ');
    expect(args).not.toContain(' copy');
    expect(args).toContain('name:1440p');
    expect(args).not.toContain('name:2160p');
    expect(args).not.toContain('-c:a:');
    expect(args).toContain('-hls_list_size 15');
    expect(args).toContain('delete_segments');
  });
});

describe('replay playlists', () => {
  const event = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:4',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    '#EXT-X-PROGRAM-DATE-TIME:2026-10-24T18:00:00.000+0000',
    '#EXTINF:4.000000,',
    'seg00000.ts',
    '#EXTINF:3.600000,',
    'seg00001.ts',
  ].join('\n');

  it('becomes VOD with an end tag, and reports duration and segments', () => {
    const vod = finalizePlaylist(event);
    expect(vod).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(vod).not.toContain('PROGRAM-DATE-TIME');
    expect(vod.trimEnd().endsWith('#EXT-X-ENDLIST')).toBe(true);
    expect(finalizePlaylist(vod)).toBe(vod);
    expect(playlistDuration(event)).toBe(8);
    expect(segmentNames(event)).toEqual(['seg00000.ts', 'seg00001.ts']);
  });
});

describe('master bandwidth', () => {
  it('lifts a copied 4K rung above the encoded ones, never lowering real figures', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=400400,RESOLUTION=426x240,CODECS="avc1.64000d,mp4a.40.2"',
      '240p/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=176000,RESOLUTION=3840x2160,CODECS="avc1.640033,mp4a.40.2"',
      '2160p/index.m3u8',
    ].join('\n');
    const out = fixMasterBandwidth(master, liveLadderFor(2160));
    expect(out).toContain('BANDWIDTH=400400,RESOLUTION=426x240');
    expect(out).toContain('BANDWIDTH=17760000,RESOLUTION=3840x2160');
  });
});
