import Cookies from 'js-cookie';

export function getAccessToken(): string | undefined {
  return (
    Cookies.get('access_token') ??
    (typeof localStorage !== 'undefined'
      ? (localStorage.getItem('access_token') ?? undefined)
      : undefined)
  );
}

export function getRefreshToken(): string | undefined {
  return (
    Cookies.get('refresh_token') ??
    (typeof localStorage !== 'undefined'
      ? (localStorage.getItem('refresh_token') ?? undefined)
      : undefined)
  );
}

export function setTokens(access: string, refresh: string): void {
  Cookies.set('access_token', access, { expires: 1 / 96 }); // 15 min
  Cookies.set('refresh_token', refresh, { expires: 30 });
}

export function clearTokens(): void {
  Cookies.remove('access_token');
  Cookies.remove('refresh_token');
}

export function isAuthenticated(): boolean {
  const token = getAccessToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!)) as {
      exp: number;
    };
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function getUser(): { id: string; role: string } | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!)) as {
      sub: string;
      role: string;
    };
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}
