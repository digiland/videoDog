import type { Metadata } from 'next';
import Link from 'next/link';
import { LinkButton } from '../../src/ui/button';
import { EmptyState } from '../../src/ui/state';
import { fetchCollections, parseCategory } from '../components/viewer/catalog';
import FilterChips from '../components/viewer/FilterChips';
import { CollectionGrid, GridSection } from '../components/viewer/VideoGrid';

export const metadata: Metadata = { title: 'Courses & playlists · StreamZW' };

const KINDS = [
  { key: null, label: 'All' },
  { key: 'course', label: 'Courses' },
  { key: 'playlist', label: 'Playlists' },
] as const;

function href(f: { category: string | null; kind: string | null; cursor?: string | null }) {
  const p = new URLSearchParams();
  if (f.category) p.set('category', f.category);
  if (f.kind) p.set('kind', f.kind);
  if (f.cursor) p.set('cursor', f.cursor);
  const s = p.toString();
  return s ? `/courses?${s}` : '/courses';
}

/** Every published course and playlist, filterable by topic and kind. */
export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; kind?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const category = parseCategory(sp.category);
  const kind = sp.kind === 'course' || sp.kind === 'playlist' ? sp.kind : null;
  const data = await fetchCollections(
    { category, kind, cursor: sp.cursor, limit: '24' },
    { next: { revalidate: 60 } },
  );

  return (
    <GridSection>
      <div className="flex flex-col gap-1 pt-2">
        <h1 className="text-2xl font-bold text-ink">Courses &amp; playlists</h1>
        <p className="text-sm text-ink-3">
          Lessons and series from Zimbabwean creators. Many start free.
        </p>
      </div>
      <FilterChips
        category={category}
        mode="all"
        showModes={false}
        hrefFor={(f) => href({ category: f.category, kind })}
      />
      <nav aria-label="Kind" className="-mt-2 flex gap-4 border-b border-line text-sm">
        {KINDS.map((k) => (
          <Link
            key={k.label}
            href={href({ category, kind: k.key })}
            aria-current={kind === k.key ? 'page' : undefined}
            className={`-mb-px border-b-2 px-1 pb-2 font-semibold ${
              kind === k.key
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {k.label}
          </Link>
        ))}
      </nav>
      {data === null ? (
        <EmptyState title="Couldn't load courses">
          Check your connection, then try again.
        </EmptyState>
      ) : data.items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          action={
            (category || kind) && (
              <LinkButton href="/courses" variant="secondary">
                Show everything
              </LinkButton>
            )
          }
        >
          New courses and playlists show up here as creators publish them.
        </EmptyState>
      ) : (
        <>
          <CollectionGrid collections={data.items} label="Courses and playlists" />
          {data.next_cursor && (
            <div className="flex justify-center">
              <LinkButton
                href={href({ category, kind, cursor: data.next_cursor })}
                variant="secondary"
              >
                More
              </LinkButton>
            </div>
          )}
        </>
      )}
    </GridSection>
  );
}
