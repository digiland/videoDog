'use client';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

async function refreshTokens(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
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

async function fetchWithAuth<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && retry) {
    const errBody = (await res
      .clone()
      .json()
      .catch(() => ({}))) as { code?: string };
    if (errBody.code === 'AUTH_TOKEN_REUSED') {
      clearTokens();
      window.location.href = '/sign-in';
      throw new Error('AUTH_TOKEN_REUSED');
    }
    if (errBody.code === 'AUTH_TOKEN_EXPIRED') {
      const ok = await refreshTokens();
      if (ok) return fetchWithAuth<T>(path, options, false);
      clearTokens();
      window.location.href = '/sign-in';
      throw new Error('AUTH_TOKEN_EXPIRED');
    }
    // Generic 401 — redirect to sign-in
    clearTokens();
    window.location.href = '/sign-in';
    throw new Error('UNAUTHORIZED');
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ message: 'Unknown error' }))) as {
      message?: string;
      code?: string;
    };
    throw Object.assign(new Error(err.message ?? 'Request failed'), {
      code: err.code,
      status: res.status,
    });
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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
