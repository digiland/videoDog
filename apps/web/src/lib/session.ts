'use client';
import { useEffect, useState } from 'react';
import { getUser, isAuthenticated } from './auth';

export type Role = 'viewer' | 'creator' | 'admin';
export interface SessionUser {
  id: string;
  role: Role;
}

/** The signed-in user from the token, kept in sync across tabs and sign-in/out. */
export function useSession(): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    const refresh = () => setUser(isAuthenticated() ? (getUser() as SessionUser | null) : null);
    refresh();
    window.addEventListener('streamzw:auth-change', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('streamzw:auth-change', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return user;
}

export function isCreatorRole(user: SessionUser | null): boolean {
  return user?.role === 'creator' || user?.role === 'admin';
}
