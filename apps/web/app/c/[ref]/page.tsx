import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Channel } from '../../../src/types/api';
import { Avatar } from '../../../src/ui/avatar';
import { EmptyState } from '../../../src/ui/state';
import CatalogClient from '../../components/CatalogClient';
import { API_BASE, fetchCatalog, fetchCollections } from '../../components/viewer/catalog';
import { CollectionGrid } from '../../components/viewer/VideoGrid';

const getChannel = cache(async (ref: string): Promise<Channel | null> => {
  try {
    const res = await fetch(`${API_BASE}/channels/${encodeURIComponent(ref)}`, {
      next: { revalidate: 60 },
    });
    return res.ok ? ((await res.json()) as Channel) : null;
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const ch = await getChannel(decodeURIComponent((await params).ref));
  return { title: ch ? `${ch.display_name ?? `@${ch.handle}`} · StreamZW` : 'Channel · StreamZW' };
}

function joined(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Harare',
  });
}

/** A creator's channel: header, then Videos or Courses & playlists tabs. */
export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ref = decodeURIComponent((await params).ref);
  const tab = (await searchParams).tab === 'collections' ? 'collections' : 'videos';
  const channel = await getChannel(ref);
  if (!channel) notFound();

  const filter = { mode: 'all' as const, category: null, creator: channel.id };
  const [videos, collections] = await Promise.all([
    tab === 'videos' ? fetchCatalog(filter, null, { next: { revalidate: 60 } }) : null,
    fetchCollections({ creator: channel.id, limit: '50' }, { next: { revalidate: 60 } }),
  ]);
  const cols = collections?.items ?? [];
  const base = `/c/${encodeURIComponent(channel.handle ?? channel.id)}`;
  const tabs = [
    { key: 'videos', label: 'Videos', href: base },
    ...(cols.length > 0
      ? [{ key: 'collections', label: 'Courses & playlists', href: `${base}?tab=collections` }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 md:px-6">
      <header className="flex items-center gap-4 sm:gap-6">
        <span className="sm:hidden">
          <Avatar creator={channel} size={72} />
        </span>
        <span className="hidden sm:inline-flex">
          <Avatar creator={channel} size={128} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-2xl font-bold text-ink sm:text-4xl">
            {channel.display_name ?? `@${channel.handle}`}
          </h1>
          <p className="flex flex-wrap gap-x-2 text-sm text-ink-3 num">
            {channel.handle && <span className="font-semibold text-ink-2">@{channel.handle}</span>}
            <span>
              {channel.video_count} {channel.video_count === 1 ? 'video' : 'videos'}
            </span>
            <span>Joined {joined(channel.joined_at)}</span>
          </p>
        </div>
      </header>

      <nav aria-label="Channel" className="flex gap-6 border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`-mb-px border-b-2 pb-3 text-sm font-semibold ${
              tab === t.key ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'collections' ? (
        cols.length > 0 ? (
          <CollectionGrid collections={cols} label="Courses and playlists" />
        ) : (
          <EmptyState title="No courses or playlists yet" />
        )
      ) : (
        <CatalogClient
          filter={filter}
          initialItems={videos?.items ?? []}
          initialCursor={videos?.next_cursor ?? null}
          failed={videos === null}
        />
      )}
    </div>
  );
}
