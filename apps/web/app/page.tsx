import { CATEGORY_LABELS } from '@streamzw/shared';
import Link from 'next/link';
import CatalogClient from './components/CatalogClient';
import {
  fetchCatalog,
  fetchCollections,
  homeHref,
  type ModeKey,
  parseCategory,
  parseMode,
} from './components/viewer/catalog';
import FilterChips from './components/viewer/FilterChips';
import { CollectionShelf, GridSection } from './components/viewer/VideoGrid';

const HINTS: Partial<Record<ModeKey, { text: string; link?: { href: string; label: string } }>> = {
  free: { text: 'Free to watch. You only spend data.' },
  premium: {
    text: 'Included with a Premium day, week or month pass.',
    link: { href: '/pricing', label: 'See passes' },
  },
  ppv: { text: 'Pay once with EcoCash, then rewatch any time.' },
};

/**
 * Home: YouTube's layout — a chip bar of topics and prices, a shelf of courses and
 * playlists for the topic, then the video grid. No hero: something to watch within one
 * thumb-scroll.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const filter = { mode: parseMode(sp.mode), category: parseCategory(sp.category) };
  const [data, collections] = await Promise.all([
    fetchCatalog(filter, null, { next: { revalidate: 60 } }),
    filter.mode === 'all'
      ? fetchCollections({ category: filter.category, limit: '12' }, { next: { revalidate: 60 } })
      : Promise.resolve(null),
  ]);
  const hint = HINTS[filter.mode];
  const shelfTitle =
    filter.category === 'education'
      ? 'Courses'
      : filter.category
        ? `${CATEGORY_LABELS[filter.category]} collections`
        : 'Courses & playlists';

  return (
    <GridSection>
      <h1 className="sr-only">
        {filter.category ? CATEGORY_LABELS[filter.category] : 'Watch'} on StreamZW
      </h1>
      <div className="sticky top-14 z-30 -mx-4 bg-bg px-4 py-3 md:-mx-6 md:px-6">
        <FilterChips category={filter.category} mode={filter.mode} hrefFor={(f) => homeHref(f)} />
      </div>
      {hint && (
        <p className="-mt-3 text-sm text-ink-3">
          {hint.text}{' '}
          {hint.link && (
            <Link href={hint.link.href} className="font-semibold text-accent hover:underline">
              {hint.link.label}
            </Link>
          )}
        </p>
      )}
      <CollectionShelf
        title={shelfTitle}
        collections={collections?.items ?? []}
        action={
          <Link
            href={filter.category ? `/courses?category=${filter.category}` : '/courses'}
            className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-accent hover:bg-surface-2"
          >
            See all
          </Link>
        }
      />
      <CatalogClient
        key={homeHref(filter)}
        filter={filter}
        initialItems={data?.items ?? []}
        initialCursor={data?.next_cursor ?? null}
        failed={data === null}
      />
    </GridSection>
  );
}
