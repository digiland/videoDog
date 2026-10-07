'use client';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './auth';
import { currentPath, signInHref } from './return-to';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

// Refresh tokens rotate on every use (CLAUDE.md §3.14), so concurrent refreshes with the
// same token would trip the server's reuse detection. All callers share one in-flight refresh.
let refreshInFlight: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefreshTokens().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefreshTokens(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) {
      // A rejected refresh token is dead; drop it so we stop retrying with it.
      if (res.status === 401 || res.status === 403) clearTokens();
      return false;
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
    };
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

/** The API's error envelope is `{ error: { code, message } }` (DomainErrorFilter). */
async function readError(res: Response): Promise<{ code?: string; message?: string }> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as {
    error?: { code?: string; message?: string };
    code?: string;
    message?: string;
  } | null;
  return body?.error ?? body ?? {};
}

async function fetchWithAuth<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  let token = getAccessToken();
  // The access-token cookie expires with the JWT (15 min). If it is gone but we still hold a
  // refresh token, refresh first — otherwise auth-optional endpoints (video access, playlist)
  // would silently treat a signed-in subscriber/buyer as anonymous and show the paywall.
  if (!token && getRefreshToken()) {
    await refreshTokens();
    token = getAccessToken();
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && retry) {
    const errBody = await readError(res);
    if (errBody.code === 'AUTH_TOKEN_REUSED') {
      clearTokens();
      window.location.href = signInHref(currentPath());
      throw new Error('AUTH_TOKEN_REUSED');
    }
    if (errBody.code === 'AUTH_TOKEN_EXPIRED') {
      const ok = await refreshTokens();
      if (ok) return fetchWithAuth<T>(path, options, false);
      clearTokens();
      window.location.href = signInHref(currentPath());
      throw new Error('AUTH_TOKEN_EXPIRED');
    }
    // Generic 401 — redirect to sign-in
    clearTokens();
    window.location.href = signInHref(currentPath());
    throw new Error('UNAUTHORIZED');
  }

  if (!res.ok) {
    const err = await readError(res);
    throw Object.assign(new Error(err.message ?? `Request failed (${res.status})`), {
      code: err.code,
      status: res.status,
    });
  }

  // Some endpoints answer 200 with an empty body (e.g. no current subscription).
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T>(path: string) => fetchWithAuth<T>(path),
  post: <T>(path: string, body?: unknown) =>
    fetchWithAuth<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    fetchWithAuth<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => fetchWithAuth<T>(path, { method: 'DELETE' }),
};

export { API_BASE };
