import type { ReactNode } from 'react';
import type { Video } from '../../../src/types/api';
import VideoCard from '../VideoCard';

/** 2 columns at 360px, 3 from 640px, 4 from 1024px — whole rows for a 24-item page. */
export const GRID = 'grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4';

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

export function GridSection({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-screen-xl flex-col gap-4 px-4 pt-4">{children}</div>;
}
