import type { ReactNode } from 'react';
import type { CollectionSummary, Video } from '../../../src/types/api';
import VideoCard from '../VideoCard';
import CollectionCard from './CollectionCard';

/** YouTube's grid: 1 column on phones, 2 from 640px, 3 from 1024px, 4 from 1440px. */
export const GRID =
  'grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-4';

export default function VideoGrid({ videos, label }: { videos: Video[]; label?: string }) {
  return (
    <ul className={GRID} aria-label={label}>
      {videos.map((v) => (
        <li key={v.id} className="min-w-0">
          <VideoCard video={v} />
        </li>
      ))}
    </ul>
  );
}

export function CollectionGrid({
  collections,
  label,
}: {
  collections: CollectionSummary[];
  label?: string;
}) {
  return (
    <ul className={GRID} aria-label={label}>
      {collections.map((c) => (
        <li key={c.id} className="min-w-0">
          <CollectionCard collection={c} />
        </li>
      ))}
    </ul>
  );
}

/** A horizontally scrolling row of collections (home page shelf). */
export function CollectionShelf({
  title,
  collections,
  action,
}: {
  title: string;
  collections: CollectionSummary[];
  action?: ReactNode;
}) {
  if (collections.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-ink">{title}</h2>
        {action}
      </div>
      <ul className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-1 md:-mx-6 md:scroll-px-6 md:px-6">
        {collections.map((c) => (
          <li key={c.id} className="w-[78vw] max-w-[340px] shrink-0 snap-start sm:w-[300px]">
            <CollectionCard collection={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GridSection({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6 px-4 pt-2 md:px-6">{children}</div>;
}
