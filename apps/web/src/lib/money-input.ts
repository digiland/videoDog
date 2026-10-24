/**
 * Exact conversions between user-typed decimal strings and integer minor units.
 *
 * CLAUDE.md §3: money is bigint minor units; never float math. These helpers parse
 * and print the decimal string digit-by-digit, so "0.29" is always 29n (whereas
 * `Math.round(parseFloat('0.29') * 100)` relies on float rounding to get there).
 */

const MAX_DECIMALS = 18;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`decimals must be an integer in [0, ${MAX_DECIMALS}]`);
  }
}

/**
 * Parse a major-unit decimal string ("12", "12.5", "0.99", ".5") into minor units.
 *
 * Returns `null` for anything that is not a plain non-negative decimal: empty input,
 * signs, exponents, thousands separators, whitespace inside the number, or more
 * fractional digits than `decimals`. Leading/trailing whitespace is ignored.
 * Zero is valid (returns 0n) — callers enforce their own minimums.
 */
export function parseMajorToMinor(input: string, decimals = 2): bigint | null {
  assertDecimals(decimals);
  const s = input.trim();
  const match = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!match) return null;
  const intPart = match[1] ?? '';
  const fracPart = match[2] ?? '';
  if (intPart === '' && fracPart === '') return null; // "", "."
  if (fracPart.length > decimals) return null;

  const scale = 10n ** BigInt(decimals);
  const whole = intPart === '' ? 0n : BigInt(intPart);
  const frac = fracPart === '' ? 0n : BigInt(fracPart.padEnd(decimals, '0'));
  return whole * scale + frac;
}

/**
 * Print minor units as a plain major-unit decimal string suitable for an `<input>`
 * value (no currency symbol, no grouping): 150n → "1.50", 5n → "0.05".
 */
export function formatMinorToMajorInput(minor: bigint | string, decimals = 2): string {
  assertDecimals(decimals);
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  if (decimals === 0) return `${negative ? '-' : ''}${abs.toString()}`;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * Convert minor units to a JSON number at the API boundary only. The API's request
 * schemas take `amount_minor` / `ppv_price_minor_units` as JSON numbers; the values
 * involved (PPV prices, payout requests) are far below 2^53, so this is lossless.
 * Throws rather than silently losing precision if that ever stops being true.
 */
export function minorToJsonNumber(minor: bigint): number {
  const n = Number(minor);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('Amount is too large to send as a JSON number');
  }
  return n;
}
