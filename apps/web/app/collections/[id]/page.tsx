import { CATEGORY_LABELS } from '@streamzw/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { CollectionDetail, CollectionEntry } from '../../../src/types/api';
import { Avatar, channelHref, creatorLabel } from '../../../src/ui/avatar';
import { LinkButton } from '../../../src/ui/button';
import { Icon } from '../../../src/ui/icon';
import { VideoRow } from '../../components/VideoCard';
import { API_BASE } from '../../components/viewer/catalog';
import { accessSummary, collectionMeta } from '../../components/viewer/CollectionCard';

const getCollection = cache(async (id: string): Promise<CollectionDetail | null> => {
  try {
    const res = await fetch(`${API_BASE}/collections/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as CollectionDetail) : null;
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const c = await getCollection((await params).id);
  if (!c) return { title: 'Course · StreamZW' };
  return {
    title: `${c.title} · StreamZW`,
    description: c.description ?? undefined,
    openGraph: c.thumbnail_url ? { images: [c.thumbnail_url] } : undefined,
  };
}

/**
 * Course / playlist page, YouTube's playlist layout: a summary panel (cover, title,
 * channel, what it costs, Play all) beside the lessons, grouped by section. Each lesson
 * keeps its own price chip — the course itself is never sold as one item.
 */
export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await getCollection((await params).id);
  if (!c) notFound();

  const first: CollectionEntry | undefined =
    c.unsectioned[0] ?? c.sections.find((s) => s.items[0])?.items[0];
  const channel = channelHref(c.creator);
  const summary = accessSummary(c.access_modes);
  const premiumCount = (c.access_modes.premium ?? 0) + (c.access_modes.premium_buyable ?? 0);
  let n = 0;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pt-4 md:px-6 lg:flex-row lg:items-start">
      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4 lg:sticky lg:top-20 lg:w-[360px] lg:shrink-0 lg:p-6">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-surface-2">
          {c.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed thumbnail URL (see VideoCard).
            <img src={c.thumbnail_url} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
            <Icon name={c.kind === 'course' ? 'course' : 'playlist'} size={14} />
            {c.kind === 'course' ? 'Course' : 'Playlist'}
            {c.category !== 'other' && <> · {CATEGORY_LABELS[c.category]}</>}
          </p>
          <h1 className="text-2xl font-bold leading-tight text-ink">{c.title}</h1>
          <div className="flex items-center gap-2">
            <Avatar creator={c.creator} size={28} />
            {channel ? (
              <Link href={channel} className="text-sm font-semibold text-ink hover:text-accent">
                {creatorLabel(c.creator)}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-ink">{creatorLabel(c.creator)}</span>
            )}
          </div>
          <p className="text-sm text-ink-3 num">{collectionMeta(c)}</p>
          {summary && <p className="text-sm text-ink-2">{summary}</p>}
        </div>
        {first && (
          <LinkButton href={`/v/${first.video.id}?list=${c.id}`} icon="play" block>
            {c.kind === 'course' ? 'Start the course' : 'Play all'}
          </LinkButton>
        )}
        {premiumCount > 0 && (
          <p className="text-xs leading-5 text-ink-3">
            {premiumCount} {premiumCount === 1 ? 'lesson is' : 'lessons are'} included with{' '}
            <Link href="/pricing" className="font-semibold text-accent hover:underline">
              Premium
            </Link>
            . Pay-once lessons unlock individually with EcoCash.
          </p>
        )}
        {c.description && (
          <p className="whitespace-pre-line text-sm leading-6 text-ink-2">{c.description}</p>
        )}
      </section>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {c.unsectioned.length > 0 && (
          <ol className="flex flex-col gap-1">
            {c.unsectioned.map((e) => (
              <li key={e.id}>
                <VideoRow video={e.video} listId={c.id} index={++n} size="md" />
              </li>
            ))}
          </ol>
        )}
        {c.sections
          .filter((s) => s.items.length > 0)
          .map((s) => (
            <section key={s.id} aria-label={s.title} className="flex flex-col gap-1">
              <h2 className="px-1 pb-1 pt-4 text-lg font-bold text-ink">{s.title}</h2>
              <ol className="flex flex-col gap-1">
                {s.items.map((e) => (
                  <li key={e.id}>
                    <VideoRow video={e.video} listId={c.id} index={++n} size="md" />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        {n === 0 && <p className="py-12 text-center text-sm text-ink-3">No videos here yet.</p>}
      </div>
    </div>
  );
}
