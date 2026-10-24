/**
 * Post-sign-in return paths. Only same-origin relative paths are allowed, so a crafted
 * `?return_to=` link can't bounce a freshly signed-in user to another site.
 */

const AUTH_PAGES = ['/sign-in', '/verify'];

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Returns `raw` if it is a safe same-origin path, else null. Accepted: starts with exactly
 * one "/" (not "//" or "/\", which browsers treat as protocol-relative), no scheme, no
 * whitespace or control characters, and not an auth page (avoids sign-in loops).
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\s\\]/.test(raw) || hasControlChar(raw)) return null;
  // Resolve against a dummy origin as a final guard against parser quirks.
  let url: URL;
  try {
    url = new URL(raw, 'https://streamzw.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://streamzw.invalid') return null;
  if (AUTH_PAGES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
    return null;
  }
  return raw;
}

/** `/sign-in`, carrying `returnTo` along when it is safe. */
export function signInHref(returnTo?: string | null): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `/sign-in?return_to=${encodeURIComponent(safe)}` : '/sign-in';
}

/** Current path + query, for use as a return path from client code. */
export function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}
