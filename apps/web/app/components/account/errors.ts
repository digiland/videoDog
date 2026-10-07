/** Messages the API client uses when the server said nothing useful. */
const GENERIC = new Set(['Request failed', 'Unknown error', 'Failed to fetch', 'Load failed']);

/** A person-readable message from a thrown API error, or `fallback` if it has none. */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message && !GENERIC.has(err.message)) return err.message;
  return fallback;
}

/** Error code + message from a raw fetch response; accepts `{ error: {…} }` or flat bodies. */
export async function readApiError(res: Response): Promise<{ code?: string; message?: string }> {
  const body: unknown = await res.json().catch(() => null);
  if (typeof body !== 'object' || body === null) return {};
  const outer = body as Record<string, unknown>;
  const inner =
    typeof outer.error === 'object' && outer.error !== null
      ? (outer.error as Record<string, unknown>)
      : outer;
  return {
    code: typeof inner.code === 'string' ? inner.code : undefined,
    message: typeof inner.message === 'string' ? inner.message : undefined,
  };
}
