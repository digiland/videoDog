import { describe, expect, it } from 'vitest';
import { safeReturnTo, signInHref } from './return-to';

describe('safeReturnTo', () => {
  it.each([
    '/',
    '/v/123e4567-e89b-12d3-a456-426614174000',
    '/purchase/abc',
    '/pricing?return_to=%2Fv%2Fabc',
    '/studio/videos#top',
    '/%0a/evil', // percent-encoded: stays a harmless same-origin path
  ])('accepts %j', (p) => {
    expect(safeReturnTo(p)).toBe(p);
  });

  it.each([
    null,
    undefined,
    '',
    'v/abc',
    '//evil.example',
    '//evil.example/path',
    '/\\evil.example',
    '/\\/evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/ /evil',
    '/\t/evil.example',
    '/\n/evil.example',
    '/sign-in',
    '/sign-in?return_to=%2F',
    '/verify?phone=%2B263',
    `/${'a'.repeat(3000)}`,
  ])('rejects %j', (p) => {
    expect(safeReturnTo(p)).toBeNull();
  });
});

describe('signInHref', () => {
  it('encodes a safe return path', () => {
    expect(signInHref('/purchase/abc?x=1')).toBe('/sign-in?return_to=%2Fpurchase%2Fabc%3Fx%3D1');
  });
  it('drops unsafe or missing return paths', () => {
    expect(signInHref('//evil.example')).toBe('/sign-in');
    expect(signInHref(null)).toBe('/sign-in');
  });
});
