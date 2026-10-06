'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clearTokens, getUser, isAuthenticated } from '../../src/lib/auth';
import { api } from '../../src/lib/api';
import { signInHref } from '../../src/lib/return-to';
import { Icon, type IconName } from '../../src/ui/icon';
import { LinkButton } from '../../src/ui/button';

type Role = 'viewer' | 'creator' | 'admin';

function useSession() {
  const [user, setUser] = useState<{ id: string; role: Role } | null>(null);
  useEffect(() => {
    const refresh = () =>
      setUser(isAuthenticated() ? (getUser() as { id: string; role: Role } | null) : null);
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

export function Wordmark() {
  return (
    <span className="text-lg font-bold tracking-tight text-ink">
      Stream<span className="text-accent">ZW</span>
    </span>
  );
}

/**
 * App shell navigation. Phones get a bottom tab bar in thumb reach (the primary device);
 * wider screens get links and search in the top bar.
 */
export default function NavBar() {
  const user = useSession();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isCreator = user?.role === 'creator' || user?.role === 'admin';

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  async function signOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      // signing out locally is what matters
    }
    clearTokens();
    window.location.assign('/');
  }

  const tabs: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
    { href: '/', label: 'Home', icon: 'home', match: (p) => p === '/' || p.startsWith('/v/') },
    { href: '/search', label: 'Search', icon: 'search', match: (p) => p.startsWith('/search') },
    isCreator
      ? { href: '/studio', label: 'Studio', icon: 'studio', match: (p) => p.startsWith('/studio') }
      : {
          href: '/pricing',
          label: 'Premium',
          icon: 'play',
          match: (p) => p.startsWith('/pricing'),
        },
    {
      href: user ? '/me' : signInHref(pathname),
      label: user ? 'You' : 'Sign in',
      icon: 'user',
      match: (p) => p.startsWith('/me') || p.startsWith('/sign-in'),
    },
  ];

  const desktopLinks = [
    { href: '/', label: 'Home' },
    { href: '/pricing', label: 'Premium' },
    ...(isCreator ? [{ href: '/studio', label: 'Studio' }] : []),
  ];

  return (
    <>
      <header
        className="sticky z-40 bg-bg border-b border-line"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link href="/" aria-label="StreamZW home" className="shrink-0">
            <Wordmark />
          </Link>

          <nav className="hidden md:flex items-center gap-1 text-sm" aria-label="Main">
            {desktopLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 h-9 inline-flex items-center rounded ${
                  (href === '/' ? pathname === '/' : pathname.startsWith(href))
                    ? 'text-ink bg-surface-2'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>

          <search className="hidden md:flex flex-1 max-w-sm ml-auto">
            <form
              className="flex w-full"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
              }}
            >
              <label htmlFor="nav-search" className="sr-only">
                Search videos
              </label>
              <div className="flex items-center w-full h-9 gap-2 px-3 rounded border border-line bg-surface focus-within:border-accent">
                <Icon name="search" size={16} className="text-ink-3" />
                <input
                  id="nav-search"
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search videos and creators"
                  className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none"
                />
              </div>
            </form>
          </search>

          <div className="ml-auto md:ml-0 flex items-center gap-2">
            {isCreator && (
              <LinkButton
                href="/studio/upload"
                size="sm"
                icon="upload"
                className="hidden sm:inline-flex"
              >
                Upload
              </LinkButton>
            )}
            {user ? (
              <div className="relative hidden md:block" ref={menuRef}>
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="h-9 w-9 rounded-full bg-surface-2 text-ink inline-flex items-center justify-center"
                >
                  <Icon name="user" size={18} label="Account" />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-48 rounded border border-line bg-surface py-1 text-sm"
                  >
                    <Link role="menuitem" href="/me" className="block px-3 py-2 hover:bg-surface-2">
                      Profile & settings
                    </Link>
                    {isCreator && (
                      <Link
                        role="menuitem"
                        href="/studio"
                        className="block px-3 py-2 hover:bg-surface-2"
                      >
                        Studio
                      </Link>
                    )}
                    {user.role === 'admin' && (
                      <Link
                        role="menuitem"
                        href="/admin/applications"
                        className="block px-3 py-2 hover:bg-surface-2"
                      >
                        Creator applications
                      </Link>
                    )}
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => void signOut()}
                      className="block w-full text-left px-3 py-2 text-ink-2 hover:bg-surface-2"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <LinkButton
                href={signInHref(pathname)}
                size="sm"
                variant="secondary"
                className="hidden md:inline-flex"
              >
                Sign in
              </LinkButton>
            )}
          </div>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-bg border-t border-line"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <ul className="grid grid-cols-4 h-16">
          {tabs.map((t) => {
            const active = t.match(pathname);
            return (
              <li key={t.label}>
                <Link
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className={`h-full flex flex-col items-center justify-center gap-1 text-xs ${
                    active ? 'text-ink' : 'text-ink-3'
                  }`}
                >
                  <Icon name={t.icon} size={22} className={active ? 'text-accent' : undefined} />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
