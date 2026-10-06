import type { VideoListResponse } from '../../../src/types/api';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

/** One page of the catalogue. 24 fills whole rows at 2, 3 and 4 columns. */
export const PAGE_SIZE = 24;

/**
 * Catalogue filters. `api` is what GET /videos receives: a Premium-and-buyable video
 * belongs under both Premium and Pay once, so those filters ask for two modes.
 */
export const MODES = [
  { key: 'all', label: 'All', api: null },
  { key: 'free', label: 'Free', api: 'free' },
  { key: 'premium', label: 'Premium', api: 'premium,premium_buyable' },
  { key: 'ppv', label: 'Pay once', api: 'ppv,premium_buyable' },
] as const;

/** The API `mode` value for a filter, or null for everything. */
export function apiMode(mode: ModeKey): string | null {
  return MODES.find((m) => m.key === mode)?.api ?? null;
}

export type ModeKey = (typeof MODES)[number]['key'];

export function parseMode(raw: string | undefined): ModeKey {
  return MODES.some((m) => m.key === raw) ? (raw as ModeKey) : 'all';
}

export function catalogUrl(mode: ModeKey, cursor?: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  const api = apiMode(mode);
  if (api) params.set('mode', api);
  if (cursor) params.set('cursor', cursor);
  return `${API_BASE}/videos?${params.toString()}`;
}

/** Null on any failure, so callers can tell "nothing published" from "couldn't load". */
export async function fetchCatalog(
  mode: ModeKey,
  cursor?: string | null,
  init?: RequestInit & { next?: { revalidate: number } },
): Promise<VideoListResponse | null> {
  try {
    const res = await fetch(catalogUrl(mode, cursor), init);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<VideoListResponse>;
    return { items: data.items ?? [], next_cursor: data.next_cursor ?? null };
  } catch {
    return null;
  }
}
