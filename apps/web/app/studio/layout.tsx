'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { getUser, isAuthenticated } from '../../src/lib/auth';
import { signInHref } from '../../src/lib/return-to';

const TABS = [
  { href: '/studio', label: 'Overview', exact: true },
  { href: '/studio/upload', label: 'Upload' },
  { href: '/studio/videos', label: 'Videos' },
  { href: '/studio/earnings', label: 'Earnings' },
  { href: '/studio/payouts', label: 'Payouts' },
] as const;

/**
 * Studio sub-navigation is a scrollable tab strip at the top of the studio area, on every
 * screen size: the app's bottom tab bar already owns the thumb zone on phones.
 */
export default function StudioLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/studio';
  const router = useRouter();
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace(signInHref(pathname));
      return;
    }
    const user = getUser();
    if (user && user.role !== 'creator' && user.role !== 'admin') router.replace('/');
  }, [router, pathname]);

  // Keep the current tab in view when the strip is scrolled on a narrow phone.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  return (
    <div className="max-w-screen-xl mx-auto px-4">
      <nav aria-label="Studio" className="-mx-4 border-b border-line md:mx-0">
        <ul className="no-scrollbar flex overflow-x-auto px-2 md:px-0">
          {TABS.map((t) => {
            const active =
              'exact' in t && t.exact ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <li key={t.href} className="shrink-0">
                <Link
                  ref={active ? activeRef : undefined}
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex h-12 items-center px-3 text-sm font-semibold transition-colors ${
                    active ? 'text-ink' : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {t.label}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="py-5 md:py-8">{children}</div>
    </div>
  );
}
