'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { api } from '../../../src/lib/api';
import { clearTokens, getRefreshToken } from '../../../src/lib/auth';
import { signInHref } from '../../../src/lib/return-to';
import { isCreatorRole, useSession } from '../../../src/lib/session';
import { LinkButton } from '../../../src/ui/button';
import { Icon, type IconName } from '../../../src/ui/icon';
import {
  COURSES,
  CREATOR,
  EXPLORE,
  HOME,
  LIBRARY,
  type NavItem,
  PREMIUM,
  PRIMARY,
  STUDIO,
  YOU,
} from './nav-items';

const SIDEBAR_KEY = 'streamzw:sidebar';

export function Wordmark() {
  return (
    <span className="text-lg font-bold tracking-tight text-ink">
      Stream<span className="text-accent">ZW</span>
    </span>
  );
}

/** Pages where the video owns the width and the guide is a drawer, as on YouTube. */
function isImmersive(pathname: string) {
  return pathname.startsWith('/v/');
}

/**
 * App shell, YouTube's layout on Kopje's tokens:
 * - top bar: menu, wordmark, a centred search box, upload and account;
 * - a guide on the left: full width from lg, an icon rail at md, a drawer on phones and on
 *   the watch page (the menu button toggles it);
 * - phones also get a bottom tab bar in thumb reach.
 */
export default function AppShell({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const user = useSession();
  const immersive = isImmersive(pathname);
  const [collapsed, setCollapsed] = useState(false);
  // The drawer remembers the page it was opened on, so navigating closes it.
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const drawer = drawerAt === pathname;
  const setDrawer = (open: boolean) => setDrawerAt(open ? pathname : null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === 'mini');
    } catch {
      // storage blocked: default to expanded
    }
  }, []);

  function toggleGuide() {
    if (immersive || window.matchMedia('(max-width: 767px)').matches) {
      setDrawer(!drawer);
      return;
    }
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? 'full' : 'mini');
      } catch {
        // ignore
      }
      return !c;
    });
  }

  return (
    <>
      <TopBar onMenu={toggleGuide} />
      <div className="flex">
        {!immersive && (
          <aside
            aria-label="Guide"
            className={`sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 overflow-y-auto no-scrollbar md:block ${
              collapsed ? 'w-[72px]' : 'w-[72px] lg:w-60'
            }`}
          >
            <Suspense fallback={null}>
              <Guide mini={collapsed ? 'always' : 'below-lg'} />
            </Suspense>
          </aside>
        )}
        <div className="min-w-0 flex-1">
          <main>{children}</main>
          {footer}
        </div>
      </div>

      {drawer && (
        <dialog
          open
          aria-modal="true"
          aria-label="Guide"
          onKeyDown={(e) => e.key === 'Escape' && setDrawer(false)}
          className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 h-full w-full bg-scrim"
          />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-bg">
            <div className="flex h-14 shrink-0 items-center gap-2 px-2">
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-2"
              >
                <Icon name="menu" size={22} label="Close menu" />
              </button>
              <Link href="/" aria-label="StreamZW home" onClick={() => setDrawer(false)}>
                <Wordmark />
              </Link>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Suspense fallback={null}>
                <Guide mini="never" />
              </Suspense>
            </div>
          </div>
        </dialog>
      )}

      <BottomTabs isCreator={isCreatorRole(user)} signedIn={!!user} />
    </>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const user = useSession();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isCreator = isCreatorRole(user);

  // Phones: opening search swaps the bar for the box and brings up the keyboard.
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

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
      // Send the refresh token so the server revokes it, not just this browser's copy.
      await api.post('/auth/logout', { refresh_token: getRefreshToken() });
    } catch {
      // signing out locally is what matters
    }
    clearTokens();
    window.location.assign('/');
  }

  const searchForm = (
    <search className="flex min-w-0 flex-1 justify-center">
      <form
        className="flex w-full max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) {
            setSearching(false);
            router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          }
        }}
      >
        <label htmlFor="top-search" className="sr-only">
          Search videos, courses and creators
        </label>
        <input
          id="top-search"
          type="search"
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="h-10 min-w-0 flex-1 rounded-l-full border border-line bg-bg px-4 text-base text-ink placeholder:text-ink-3 outline-none focus:border-accent md:text-sm"
        />
        <button
          type="submit"
          className="inline-flex h-10 w-16 shrink-0 items-center justify-center rounded-r-full border border-l-0 border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="search" size={20} label="Search" />
        </button>
      </form>
    </search>
  );

  return (
    <header className="sticky z-40 bg-bg" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      {searching ? (
        <div className="flex h-14 items-center gap-2 px-2 md:hidden">
          <button
            type="button"
            onClick={() => setSearching(false)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface-2"
          >
            <Icon name="chevronLeft" size={22} label="Back" />
          </button>
          {searchForm}
        </div>
      ) : null}
      <div
        className={`h-14 items-center gap-2 px-2 md:gap-4 md:px-4 ${searching ? 'hidden md:flex' : 'flex'}`}
      >
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onMenu}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-2"
          >
            <Icon name="menu" size={22} label="Menu" />
          </button>
          <Link href="/" aria-label="StreamZW home" className="px-1">
            <Wordmark />
          </Link>
        </div>

        <div className="hidden min-w-0 flex-1 md:flex">{searchForm}</div>

        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0 md:gap-2">
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface-2 md:hidden"
          >
            <Icon name="search" size={22} label="Search" />
          </button>
          {isCreator && (
            <LinkButton
              href="/studio/upload"
              size="sm"
              variant="secondary"
              icon="upload"
              className="hidden rounded-full sm:inline-flex"
            >
              Upload
            </LinkButton>
          )}
          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface-2"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-2">
                  <Icon name="user" size={18} label="Account" />
                </span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1 w-56 rounded-lg border border-line bg-surface py-2 text-sm"
                >
                  <MenuLink href="/library" icon="library" onPick={() => setMenuOpen(false)}>
                    Library
                  </MenuLink>
                  <MenuLink href="/me" icon="user" onPick={() => setMenuOpen(false)}>
                    Profile &amp; settings
                  </MenuLink>
                  {isCreator && (
                    <MenuLink href="/studio" icon="studio" onPick={() => setMenuOpen(false)}>
                      Studio
                    </MenuLink>
                  )}
                  {user.role === 'admin' && (
                    <MenuLink
                      href="/admin/applications"
                      icon="check"
                      onPick={() => setMenuOpen(false)}
                    >
                      Creator applications
                    </MenuLink>
                  )}
                  <div className="my-2 border-t border-line" />
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => void signOut()}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-ink-2 hover:bg-surface-2"
                  >
                    <Icon name="chevronLeft" size={18} />
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
              icon="user"
              className="rounded-full"
            >
              Sign in
            </LinkButton>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuLink({
  href,
  icon,
  onPick,
  children,
}: {
  href: string;
  icon: IconName;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      role="menuitem"
      href={href}
      onClick={onPick}
      className="flex items-center gap-3 px-4 py-2 text-ink hover:bg-surface-2"
    >
      <Icon name={icon} size={18} className="text-ink-2" />
      {children}
    </Link>
  );
}

/**
 * The guide's links. `mini`: 'always' = icon rail; 'below-lg' = rail at md, full from lg;
 * 'never' = full (the drawer).
 */
function Guide({ mini }: { mini: 'always' | 'below-lg' | 'never' }) {
  const pathname = usePathname() ?? '/';
  const search = useSearchParams() ?? new URLSearchParams();
  const user = useSession();
  const isCreator = isCreatorRole(user);
  const full = mini === 'never' ? 'flex' : mini === 'below-lg' ? 'hidden lg:flex' : 'hidden';
  const rail = mini === 'never' ? 'hidden' : mini === 'below-lg' ? 'flex lg:hidden' : 'flex';

  const railItems: NavItem[] = [HOME, COURSES, isCreator ? STUDIO : PREMIUM, LIBRARY];

  const section = (title: string | null, items: NavItem[]) => (
    <div className="flex flex-col border-b border-line py-3 last:border-0">
      {title && <p className="px-6 pb-1 pt-1 text-sm font-semibold text-ink">{title}</p>}
      {items.map((item) => {
        const active = item.match(pathname, new URLSearchParams(search.toString()));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`mx-3 flex h-10 items-center gap-5 rounded-lg px-3 text-sm transition-colors ${
              active
                ? 'bg-surface-2 font-semibold text-ink'
                : 'text-ink-2 hover:bg-surface hover:text-ink'
            }`}
          >
            <Icon name={item.icon} size={20} className={active ? 'text-accent' : undefined} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <>
      <nav aria-label="Main" className={`${full} flex-col pb-6`}>
        {section(null, PRIMARY)}
        {section('You', YOU)}
        {isCreator && section('Create', CREATOR)}
        {section('Explore', EXPLORE)}
        <p className="px-6 pt-4 text-xs leading-5 text-ink-3">
          © {new Date().getFullYear()} StreamZW
          <br />
          Made in Zimbabwe
        </p>
      </nav>
      <nav aria-label="Main" className={`${rail} flex-col items-stretch gap-1 px-1 pt-1`}>
        {railItems.map((item) => {
          const active = item.match(pathname, new URLSearchParams(search.toString()));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 rounded-lg py-4 text-[10px] transition-colors ${
                active ? 'text-ink' : 'text-ink-2 hover:bg-surface'
              }`}
            >
              <Icon name={item.icon} size={22} className={active ? 'text-accent' : undefined} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function BottomTabs({ isCreator, signedIn }: { isCreator: boolean; signedIn: boolean }) {
  const pathname = usePathname() ?? '/';
  const tabs: { href: string; label: string; icon: IconName; active: boolean }[] = [
    {
      href: '/',
      label: 'Home',
      icon: 'home',
      active: pathname === '/' || pathname.startsWith('/v/'),
    },
    {
      href: '/courses',
      label: 'Courses',
      icon: 'course',
      active: pathname.startsWith('/courses') || pathname.startsWith('/collections'),
    },
    ...(isCreator
      ? [
          {
            href: '/studio',
            label: 'Studio',
            icon: 'studio' as IconName,
            active: pathname.startsWith('/studio'),
          },
        ]
      : []),
    {
      href: '/library',
      label: 'Library',
      icon: 'library',
      active: pathname.startsWith('/library'),
    },
    {
      href: signedIn ? '/me' : signInHref(pathname),
      label: signedIn ? 'You' : 'Sign in',
      icon: 'user',
      active: pathname.startsWith('/me') || pathname.startsWith('/sign-in'),
    },
  ];
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="flex h-16">
        {tabs.map((t) => (
          <li key={t.label} className="flex-1">
            <Link
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              className={`flex h-full flex-col items-center justify-center gap-1 text-[11px] ${
                t.active ? 'font-semibold text-ink' : 'text-ink-3'
              }`}
            >
              <Icon name={t.icon} size={22} className={t.active ? 'text-accent' : undefined} />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
