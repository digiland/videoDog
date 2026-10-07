import { describe, expect, it } from 'vitest';
import { formatPhone, formatPhoneIntl, parsePhone } from './phone';

describe('parsePhone', () => {
  it('reads Zimbabwean numbers however they are typed', () => {
    for (const input of [
      '077 123 4567',
      '0771234567',
      '77 123 4567',
      '+263 77 123 4567',
      '263771234567',
      '00263771234567',
      '+263 077 123 4567',
      '077-123-4567',
    ]) {
      expect(parsePhone(input), input).toBe('+263771234567');
    }
  });

  it('accepts other countries in E.164 (diaspora viewers)', () => {
    expect(parsePhone('+27 82 123 4567')).toBe('+27821234567');
    expect(parsePhone('+44 7700 900123')).toBe('+447700900123');
  });

  it('rejects numbers with a missing or extra digit, and junk', () => {
    expect(parsePhone('077 123 456')).toBeNull();
    expect(parsePhone('+263 77 123 45678')).toBeNull();
    expect(parsePhone('hello')).toBeNull();
    expect(parsePhone('')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('shows Zimbabwean numbers the way people write them', () => {
    expect(formatPhone('+263771234567')).toBe('077 123 4567');
    expect(formatPhoneIntl('+263771234567')).toBe('+263 77 123 4567');
    expect(formatPhone('+27821234567')).toBe('+27821234567');
  });
});
