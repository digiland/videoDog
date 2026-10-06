import type { ReactNode } from 'react';
import { Icon } from '../../../src/ui/icon';
import type { VideoState } from './studio-data';

const STATE: Record<VideoState, { label: string; tone: string }> = {
  uploading: { label: 'Uploading', tone: 'text-ink-2' },
  processing: { label: 'Processing', tone: 'text-ink-2' },
  ready: { label: 'Ready', tone: 'text-accent' },
  published: { label: 'Published', tone: 'text-sage' },
  unpublished: { label: 'Unpublished', tone: 'text-ink-3' },
  failed: { label: 'Failed', tone: 'text-danger' },
};

/** Where a video is in its life. Colour backs up the word, never replaces it. */
export function StateChip({ state }: { state: VideoState }) {
  const s = STATE[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-surface-2 text-xs font-semibold ${s.tone}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

/** A number that matters, big and tabular, with a plain label. */
export function Stat({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0 rounded border border-line bg-surface p-4">
      <span className="text-xs font-semibold text-ink-3">{label}</span>
      <span
        className={`num font-bold leading-none truncate ${emphasis ? 'text-3xl text-ink' : 'text-2xl text-ink'}`}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-ink-3 num">{sub}</span>}
    </div>
  );
}

export function PageTitle({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {children && <p className="mt-1 text-sm text-ink-2 max-w-xl">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

/** 16:9 thumbnail or a calm placeholder. Lazy, explicit size, no layout jump. */
export function VideoThumb({ src, className }: { src: string | null; className?: string }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md bg-surface-2 aspect-video ${className ?? ''}`}
    >
      {src ? (
        // Thumbnails are short-lived presigned URLs on a per-deployment host; next/image
        // would need build-time remotePatterns and miss its cache on every new signature.
        <img
          src={src}
          alt=""
          width={160}
          height={90}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-ink-3">
          <Icon name="studio" size={20} />
        </span>
      )}
    </div>
  );
}
