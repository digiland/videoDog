'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SearchFormProps {
  initialQuery: string;
}

export default function SearchForm({ initialQuery }: SearchFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 max-w-xl">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search videos..."
        className="bg-[#16213e] border border-gray-700 text-white rounded-lg px-4 py-2.5 flex-1 focus:outline-none focus:border-[#e94560] transition placeholder:text-gray-500"
        autoFocus
      />
      <button
        type="submit"
        className="bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2.5 px-5 rounded-lg transition"
      >
        Search
      </button>
    </form>
  );
}
