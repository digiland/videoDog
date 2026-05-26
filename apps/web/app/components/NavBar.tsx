'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clearTokens, getUser, isAuthenticated } from '../../src/lib/auth';
import { api } from '../../src/lib/api';

export default function NavBar() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<{
    id: string;
    role: string;
  } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const authState = isAuthenticated();
    setAuthed(authState);
    if (authState) {
      setUser(getUser());
    }
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
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  }

  async function handleSignOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    clearTokens();
    router.push('/sign-in');
  }

  return (
    <nav className="sticky top-0 z-50 bg-[#1a1a2e] border-b border-[#16213e] px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="text-xl font-bold text-white shrink-0 flex items-center gap-1">
          <span className="text-[#e94560]">Stream</span>
          <span>ZW</span>
        </Link>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-xl mx-auto">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search videos..."
            className="bg-[#16213e] border border-gray-700 text-white rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#e94560] text-sm placeholder:text-gray-500 transition"
          />
        </form>

        {/* Auth */}
        <div className="shrink-0">
          {authed ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className="flex items-center gap-2 bg-[#16213e] hover:bg-[#1a2744] rounded-lg px-3 py-2 text-sm font-medium text-white transition"
              >
                <div className="w-7 h-7 rounded-full bg-[#e94560] flex items-center justify-center text-xs font-bold">
                  {user?.role?.[0]?.toUpperCase() ?? 'U'}
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-[#16213e] rounded-xl border border-gray-700 shadow-xl py-1 z-50">
                  <Link
                    href="/me"
                    className="block px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-[#1a2744] transition"
                    onClick={() => setDropdownOpen(false)}
                  >
                    Profile
                  </Link>
                  {user?.role === 'creator' || user?.role === 'admin' ? (
                    <Link
                      href="/studio"
                      className="block px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-[#1a2744] transition"
                      onClick={() => setDropdownOpen(false)}
                    >
                      Creator Studio
                    </Link>
                  ) : null}
                  <hr className="border-gray-700 my-1" />
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      void handleSignOut();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-[#1a2744] transition"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2 px-4 rounded-lg transition text-sm"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
