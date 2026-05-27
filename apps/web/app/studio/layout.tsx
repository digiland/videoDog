'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { isAuthenticated, getUser } from '../../src/lib/auth';

const NAV_ITEMS = [
  {
    href: '/studio/earnings',
    label: 'Earnings',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    href: '/studio/videos',
    label: 'Videos',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M4 6h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z"
        />
      </svg>
    ),
  },
  {
    href: '/studio/upload',
    label: 'Upload',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
        />
      </svg>
    ),
  },
  {
    href: '/studio/payouts',
    label: 'Payouts',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
        />
      </svg>
    ),
  },
];

export default function StudioLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/sign-in');
      return;
    }
    const user = getUser();
    if (user && user.role !== 'creator' && user.role !== 'admin') {
      router.push('/');
    }
  }, [router]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar (desktop) / Tab bar (mobile) */}
        <aside className="md:w-56 shrink-0">
          <div className="md:bg-[#16213e] md:rounded-xl md:border md:border-[#1a1a2e]/50 md:p-3">
            <p className="hidden md:block text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 mb-2">
              Creator Studio
            </p>

            {/* Mobile: horizontal tabs */}
            <div className="flex md:hidden gap-1 overflow-x-auto pb-1 mb-4">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    pathname === item.href
                      ? 'bg-[#e94560] text-white'
                      : 'bg-[#16213e] text-gray-400 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Desktop: vertical nav */}
            <nav className="hidden md:flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                    pathname === item.href
                      ? 'bg-[#e94560] text-white'
                      : 'text-gray-400 hover:text-white hover:bg-[#1a2744]'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}

              <div className="mt-2 pt-2 border-t border-gray-700/50">
                <Link
                  href="/"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-400 transition"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    />
                  </svg>
                  Back to site
                </Link>
              </div>
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
