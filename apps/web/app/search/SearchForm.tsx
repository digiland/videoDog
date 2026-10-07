'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../src/ui/icon';

/**
 * The search box. It is the page's only job, so an empty search page focuses it (the
 * phone keyboard opens); with results showing it stays unfocused so they can be read.
 */
export default function SearchForm({ initialQuery, mode }: { initialQuery: string; mode: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initialQuery) inputRef.current?.focus();
  }, [initialQuery]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const params = new URLSearchParams({ q });
    if (mode !== 'all') params.set('mode', mode);
    inputRef.current?.blur();
    router.push(`/search?${params.toString()}`);
  }

  return (
    <search>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="search-q" className="sr-only">
          Search videos and creators
        </label>
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded border border-line bg-surface px-3 focus-within:border-accent">
          <Icon name="search" size={18} className="shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            id="search-q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search videos and creators"
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-11 shrink-0 items-center justify-center rounded bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong"
        >
          Search
        </button>
      </form>
    </search>
  );
}
