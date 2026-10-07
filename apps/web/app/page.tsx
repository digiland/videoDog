import Link from 'next/link';
import CatalogClient from './components/CatalogClient';
import { fetchCatalog, parseMode, type ModeKey } from './components/viewer/catalog';
import ModeChips from './components/viewer/ModeChips';
import { GridSection } from './components/viewer/VideoGrid';

const HINTS: Partial<Record<ModeKey, { text: string; link?: { href: string; label: string } }>> = {
  free: { text: 'Free to watch. You only spend data.' },
  premium: {
    text: 'Included with a Premium day, week or month pass.',
    link: { href: '/pricing', label: 'See passes' },
  },
  ppv: { text: 'Pay once with EcoCash, then rewatch any time.' },
};

/**
 * Home: the catalogue itself, no hero. A phone screen shows filters plus two rows of
 * videos with their prices — something to watch within one thumb-scroll.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const mode = parseMode((await searchParams).mode);
  const data = await fetchCatalog(mode, null, { next: { revalidate: 60 } });
  const hint = HINTS[mode];

  return (
    <GridSection>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="sr-only text-xl font-bold text-ink md:not-sr-only">Watch</h1>
        <ModeChips active={mode} hrefFor={(m) => (m === 'all' ? '/' : `/?mode=${m}`)} />
      </div>
      {hint && (
        <p className="-mt-1 text-sm text-ink-3">
          {hint.text}{' '}
          {hint.link && (
            <Link href={hint.link.href} className="font-semibold text-accent hover:underline">
              {hint.link.label}
            </Link>
          )}
        </p>
      )}
      <CatalogClient
        key={mode}
        mode={mode}
        initialItems={data?.items ?? []}
        initialCursor={data?.next_cursor ?? null}
        failed={data === null}
      />
    </GridSection>
  );
}
