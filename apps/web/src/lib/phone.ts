import { isE164, normaliseMsisdn } from './payments';

/**
 * Read a phone number the way Zimbabweans type it — "077 123 4567", "77 123 4567",
 * "+263 77 123 4567", "263771234567", "00263…", even "+263 077…" — into E.164. Returns
 * null when it still isn't a usable number.
 */
export function parsePhone(input: string): string | null {
  let n = normaliseMsisdn(input.trim()).replace(/\./g, '');
  if (/^7\d{8}$/.test(n)) n = `+263${n}`;
  else if (/^00[1-9]\d+$/.test(n)) n = `+${n.slice(2)}`;
  else if (/^\+?2630(7\d{8})$/.test(n)) n = `+263${n.replace(/^\+?2630/, '')}`;
  if (!isE164(n)) return null;
  // Zimbabwe numbers are always +263 and nine digits; catch a dropped or extra digit.
  if (n.startsWith('+263') && !/^\+263\d{9}$/.test(n)) return null;
  return n;
}

/** "+263771234567" → "077 123 4567" (how people read their own number); others unchanged. */
export function formatPhone(e164: string): string {
  const zw = /^\+263(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (zw) return `0${zw[1]} ${zw[2]} ${zw[3]}`;
  return e164;
}

/** "+263771234567" → "+263 77 123 4567": the full number, readable, for confirmations. */
export function formatPhoneIntl(e164: string): string {
  const zw = /^\+263(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return zw ? `+263 ${zw[1]} ${zw[2]} ${zw[3]}` : e164;
}

const LAST_PHONE_KEY = 'streamzw:last-phone';

/** The number last signed in with, so a returning viewer doesn't type it again. */
export function readLastPhone(): string | null {
  try {
    const v = localStorage.getItem(LAST_PHONE_KEY);
    return v && isE164(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberPhone(e164: string): void {
  try {
    localStorage.setItem(LAST_PHONE_KEY, e164);
  } catch {
    // storage blocked: they type it next time
  }
}
