import { describe, expect, it } from 'vitest';
import { formatMinorToMajorInput, minorToJsonNumber, parseMajorToMinor } from './money-input';

describe('parseMajorToMinor', () => {
  it.each([
    ['0', 0n],
    ['1', 100n],
    ['1.5', 150n],
    ['1.50', 150n],
    ['0.99', 99n],
    ['0.29', 29n], // 0.29 * 100 = 28.999999999999996 in float
    ['1.1', 110n],
    ['.5', 50n],
    ['5.', 500n],
    ['007.05', 705n],
    ['  2.00  ', 200n],
    ['1000', 100000n],
    ['90071992547409.93', 9007199254740993n], // beyond float precision, still exact
  ])('parses %j → %s', (input, expected) => {
    expect(parseMajorToMinor(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    '.',
    '-1',
    '-0.50',
    '+1',
    '1.234',
    '0.001',
    '1e3',
    '1,000',
    '1 000',
    '1.2.3',
    'abc',
    '$5',
    '5$',
    'NaN',
    'Infinity',
    '0x10',
  ])('rejects %j', (input) => {
    expect(parseMajorToMinor(input)).toBeNull();
  });

  it('respects the decimals argument', () => {
    expect(parseMajorToMinor('1.234', 3)).toBe(1234n);
    expect(parseMajorToMinor('12', 0)).toBe(12n);
    expect(parseMajorToMinor('12.5', 0)).toBeNull();
  });

  it('rejects invalid decimals', () => {
    expect(() => parseMajorToMinor('1', -1)).toThrow(RangeError);
    expect(() => parseMajorToMinor('1', 1.5)).toThrow(RangeError);
  });
});

describe('formatMinorToMajorInput', () => {
  it.each([
    [0n, '0.00'],
    [5n, '0.05'],
    [99n, '0.99'],
    [150n, '1.50'],
    [100000n, '1000.00'],
    [-150n, '-1.50'],
    ['29', '0.29'],
  ] as const)('formats %s → %j', (minor, expected) => {
    expect(formatMinorToMajorInput(minor)).toBe(expected);
  });

  it('round-trips with parseMajorToMinor', () => {
    for (const minor of [0n, 1n, 10n, 99n, 100n, 12345n, 9007199254740993n]) {
      expect(parseMajorToMinor(formatMinorToMajorInput(minor))).toBe(minor);
    }
  });

  it('supports other decimal counts', () => {
    expect(formatMinorToMajorInput(1234n, 3)).toBe('1.234');
    expect(formatMinorToMajorInput(12n, 0)).toBe('12');
  });
});

describe('minorToJsonNumber', () => {
  it('converts safe integers', () => {
    expect(minorToJsonNumber(0n)).toBe(0);
    expect(minorToJsonNumber(100000n)).toBe(100000);
  });

  it('throws when precision would be lost', () => {
    expect(() => minorToJsonNumber(9007199254740993n)).toThrow(RangeError);
  });
});
