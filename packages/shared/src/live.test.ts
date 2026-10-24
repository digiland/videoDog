import { describe, expect, it } from 'vitest';
import { liveLadderFor, resolutionLabel, streamIdFromPath } from './live.js';

describe('live ladder', () => {
  it('keeps every rung up to 4K for a 4K source, phone renditions included', () => {
    expect(liveLadderFor(2160).map((r) => r.height)).toEqual([240, 480, 720, 1080, 1440, 2160]);
  });
  it('never upscales and caps above 4K', () => {
    expect(liveLadderFor(1080).map((r) => r.height)).toEqual([240, 480, 720, 1080]);
    expect(liveLadderFor(4320).at(-1)?.height).toBe(2160);
    expect(liveLadderFor(144).map((r) => r.height)).toEqual([240]);
  });
  it('labels resolutions and parses stream paths', () => {
    expect(resolutionLabel(2160)).toBe('4K');
    expect(resolutionLabel(720)).toBe('720p');
    const id = '0b5e6f2a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(streamIdFromPath(`live/${id}`)).toBe(id);
    expect(streamIdFromPath(`live/${id}/x`)).toBeNull();
    expect(streamIdFromPath('other/abc')).toBeNull();
  });
});
