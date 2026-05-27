'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clearTokens, getUser, isAuthenticated } from '../../src/lib/auth';
import { api } from '../../src/lib/api';

type Role = 'viewer' | 'creator' | 'admin';

const ROLE_BADGE: Record<Role, { label: string; tone: string }> = {
  viewer: { label: 'Viewer', tone: 'bg-surface text-ink-mute' },
  creator: { label: 'Creator', tone: 'bg-accent/15 text-accent' },
  admin: { label: 'Admin', tone: 'bg-warn/15 text-warn' },
};

export default function NavBar() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<{ id: string; role: Role } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function refresh() {
      const ok = isAuthenticated();
      setAuthed(ok);
      setUser(ok ? (getUser() as { id: string; role: Role } | null) : null);
    }
    refresh();
    window.addEventListener('streamzw:auth-change', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('streamzw:auth-change', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.trim()) router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
  }

  async function handleSignOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    clearTokens();
    window.location.assign('/');
  }

  const role: Role = user?.role ?? 'viewer';
  const badge = ROLE_BADGE[role];
  const canUpload = role === 'creator' || role === 'admin';

  return (
    <nav className="sticky top-0 z-50 bg-bg/95 backdrop-blur border-b border-line">
      <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center gap-6">
        <Link href="/" className="text-xl font-bold tracking-tight shrink-0">
          Stream<span className="text-accent">ZW</span>
        </Link>

        <div className="hidden md:flex items-center gap-5 text-sm text-ink-mute">
          <Link href="/" className="hover:text-ink transition">
            Home
          </Link>
          <Link href="/?mode=free" className="hover:text-ink transition">
            Free
          </Link>
          <Link href="/?mode=premium" className="hover:text-ink transition">
            Premium
          </Link>
          <Link href="/pricing" className="hover:text-ink transition">
            Subscribe
          </Link>
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-md ml-auto">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-dim"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-4.35-4.35M10 17a7 7 0 110-14 7 7 0 010 14z"
              />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search videos, creators…"
              className="w-full bg-surface border border-line focus:border-accent rounded-md pl-9 pr-3 py-1.5 text-sm placeholder:text-ink-dim text-ink focus:outline-none transition"
            />
          </div>
        </form>

        <div className="flex items-center gap-3 shrink-0">
          {authed && canUpload && (
            <Link
              href="/studio/upload"
              className="hidden sm:inline-flex items-center gap-1.5 bg-accent hover:bg-accent-hot text-bg rounded-md px-3 py-1.5 text-sm font-semibold transition"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Upload
            </Link>
          )}

          {authed ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className="flex items-center gap-2 hover:bg-surface rounded-md px-2 py-1.5 transition"
              >
                <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-bg font-bold text-sm">
                  {role[0]?.toUpperCase()}
                </div>
                <span className={`hidden sm:inline text-xs px-2 py-0.5 rounded ${badge.tone}`}>
                  {badge.label}
                </span>
                <svg
                  className="w-3 h-3 text-ink-dim"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-bg-elev border border-line rounded-lg shadow-2xl py-1 z-50 fade-up">
                  <div className="px-4 py-3 border-b border-line">
                    <div className="text-xs text-ink-dim">Signed in as</div>
                    <div
                      className={`text-sm mt-0.5 inline-block px-2 py-0.5 rounded ${badge.tone}`}
                    >
                      {badge.label}
                    </div>
                  </div>
                  <Link
                    href="/me"
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm hover:bg-surface transition"
                  >
                    Your account
                  </Link>
                  {role === 'viewer' && (
                    <Link
                      href="/me/apply"
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm text-accent hover:bg-surface transition"
                    >
                      Become a creator
                    </Link>
                  )}
                  {canUpload && (
                    <Link
                      href="/studio"
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm hover:bg-surface transition"
                    >
                      Creator studio
                    </Link>
                  )}
                  {role === 'admin' && (
                    <Link
                      href="/admin/applications"
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm text-warn hover:bg-surface transition"
                    >
                      Admin · Applications
                    </Link>
                  )}
                  <div className="border-t border-line my-1" />
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      void handleSignOut();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-ink-mute hover:text-ink hover:bg-surface transition"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="bg-accent hover:bg-accent-hot text-bg font-semibold rounded-md px-4 py-1.5 text-sm transition"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
