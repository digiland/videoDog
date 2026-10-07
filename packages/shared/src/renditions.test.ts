import { describe, expect, it } from 'vitest';
import { dataCostMb, dataPerMinuteMb } from './renditions.js';

describe('data cost', () => {
  it('estimates per-minute cost from the ladder', () => {
    expect(dataPerMinuteMb(240)).toBe(2.7); // 364 kbps
    expect(dataPerMinuteMb(480)).toBe(5.7);
    expect(dataPerMinuteMb(1080)).toBe(23.5);
  });
  it('estimates a whole video, never below 1 MB', () => {
    expect(dataCostMb(240, 600)).toBe(27); // 10 minutes at 240p
    expect(dataCostMb(720, 600)).toBe(120); // 1596 kbps × 600 s ≈ 119.7 MB
    expect(dataCostMb(240, 2)).toBe(1);
  });
});
