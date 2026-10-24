import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import type {
  Channel,
  CollectionDetail,
  CollectionEntry,
  CollectionSummary,
  Video,
} from '../../../src/types/api';
import { Icon } from '../../../src/ui/icon';
import { VideoRow, videoHref } from '../../components/VideoCard';
import { API_BASE } from '../../components/viewer/catalog';
import { collectionMeta } from '../../components/viewer/CollectionCard';
import VideoAccessSection from './VideoAccessSection';
import VideoMeta from './VideoMeta';

async function getJson<T>(path: string, init: RequestInit = { cache: 'no-store' }) {
  try {
    const res = await fetch(`${API_BASE}${path}`, init);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Anonymous, metadata-only fetch for server rendering (title, description, thumbnail).
 * Access is NOT decided here: the server has no viewer token, so the access check and
 * playlist fetch happen client-side in <VideoAccessSection> with the viewer's auth.
 * Returns null on 404 too — an owner's unpublished video 404s anonymously, and the
 * client section re-fetches it with the owner's token. Wrapped in `cache` so the page and
 * generateMetadata share one request.
 */
const getPublicVideo = cache((id: string) => getJson<Video>(`/videos/${encodeURIComponent(id)}`));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const video = await getPublicVideo(id);
  if (!video) return { title: 'Video · StreamZW' };
  return {
    title: `${video.title} · StreamZW`,
    description: video.description ?? undefined,
    openGraph: video.thumbnail_url ? { images: [video.thumbnail_url] } : undefined,
  };
}

/** A course's videos in play order: unsectioned first, then each section in turn. */
function playOrder(c: CollectionDetail): (CollectionEntry & { section: string | null })[] {
  return [
    ...c.unsectioned.map((e) => ({ ...e, section: null })),
    ...c.sections.flatMap((s) => s.items.map((e) => ({ ...e, section: s.title }))),
  ];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Watch page, YouTube's layout: player and details on the left; on the right (below on
 * phones) the course or playlist being played, then more videos. Player first, edge to
 * edge on phones; the paywall takes the player's place in the same box.
 */
export default async function VideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ list?: string }>;
}) {
  const { id } = await params;
  const { list } = await searchParams;
  const listId = list && UUID.test(list) ? list : null;
  const video = await getPublicVideo(id);

  const creatorId = video?.creator?.id ?? video?.owner_id;
  const [collection, partOf, fromCreator, related, channel] = await Promise.all([
    listId ? getJson<CollectionDetail>(`/collections/${listId}`) : null,
    !listId && video ? getJson<{ items: CollectionSummary[] }>(`/collections?video=${id}`) : null,
    creatorId
      ? getJson<{ items: Video[] }>(`/videos?creator=${creatorId}&exclude=${id}&limit=8`, {
          next: { revalidate: 60 },
        })
      : null,
    video
      ? getJson<{ items: Video[] }>(`/videos?category=${video.category}&exclude=${id}&limit=12`, {
          next: { revalidate: 60 },
        })
      : null,
    creatorId ? getJson<Channel>(`/channels/${creatorId}`, { next: { revalidate: 300 } }) : null,
  ]);

  const partOfItems = partOf?.items ?? [];
  const order = collection ? playOrder(collection) : [];
  const at = order.findIndex((e) => e.video.id === id);
  const nextEntry = at >= 0 ? order[at + 1] : undefined;
  const next = nextEntry
    ? {
        href: videoHref(nextEntry.video, listId),
        title: nextEntry.video.title,
        label: collection?.kind === 'course' ? 'Next lesson' : 'Up next',
      }
    : null;

  // More videos: the creator's first, then the same topic, without repeats.
  const seen = new Set<string>([id, ...order.map((e) => e.video.id)]);
  const more = [...(fromCreator?.items ?? []), ...(related?.items ?? [])].filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  return (
    <div className="mx-auto flex max-w-[1760px] flex-col gap-6 lg:flex-row lg:px-6 lg:pt-6">
      <div className="min-w-0 flex-1">
        <VideoAccessSection
          videoId={id}
          next={next}
          initialThumbnailUrl={video?.thumbnail_url ?? null}
          hasServerMetadata={video !== null}
        />
        {video && <VideoMeta video={video} channel={channel} />}
        {partOfItems.length > 0 && (
          <div className="flex flex-col gap-2 px-4 pt-4 lg:px-0">
            {partOfItems.map((c) => (
              <Link
                key={c.id}
                href={`/v/${id}?list=${c.id}`}
                className="flex items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:bg-surface"
              >
                <Icon
                  name={c.kind === 'course' ? 'course' : 'playlist'}
                  size={22}
                  className="shrink-0 text-accent"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs text-ink-3">
                    Part of this {c.kind === 'course' ? 'course' : 'playlist'}
                  </span>
                  <span className="truncate text-sm font-semibold text-ink">{c.title}</span>
                  <span className="text-xs text-ink-3 num">{collectionMeta(c)}</span>
                </span>
                <Icon name="chevronRight" size={18} className="ml-auto shrink-0 text-ink-3" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <aside
        aria-label="Up next"
        className="flex w-full shrink-0 flex-col gap-4 px-4 lg:w-[402px] lg:px-0"
      >
        {collection && (
          <section
            aria-label={collection.title}
            className="flex max-h-[520px] flex-col overflow-hidden rounded-xl border border-line"
          >
            <header className="flex flex-col gap-0.5 border-b border-line bg-surface px-4 py-3">
              <Link
                href={`/collections/${collection.id}`}
                className="line-clamp-1 font-bold text-ink hover:text-accent"
              >
                {collection.title}
              </Link>
              <p className="text-xs text-ink-3 num">
                {collection.creator?.display_name} · {at >= 0 ? at + 1 : '–'}/{order.length}
              </p>
            </header>
            <ol className="flex flex-col overflow-y-auto py-1">
              {order.map((e, i) => (
                <li key={e.id}>
                  {e.section && order[i - 1]?.section !== e.section && (
                    <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
                      {e.section}
                    </p>
                  )}
                  <VideoRow
                    video={e.video}
                    listId={collection.id}
                    index={i + 1}
                    active={i === at}
                  />
                </li>
              ))}
            </ol>
          </section>
        )}
        {more.length > 0 && (
          <ul className="flex flex-col gap-2">
            {more.map((v) => (
              <li key={v.id}>
                <VideoRow video={v} />
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
