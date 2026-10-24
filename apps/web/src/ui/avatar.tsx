import type { CreatorRef } from '../types/api';

export function creatorLabel(creator: CreatorRef | null | undefined): string {
  return creator?.display_name ?? (creator?.handle ? `@${creator.handle}` : 'StreamZW creator');
}

/** Link target for a creator's channel: `/c/<handle>`, or their id until they pick one. */
export function channelHref(creator: CreatorRef | null | undefined): string | null {
  if (creator?.handle) return `/c/${creator.handle}`;
  if (creator?.id) return `/c/${creator.id}`;
  return null;
}

/**
 * Channel avatar: initials on a neutral disc. No image upload yet, and no literal colours
 * (DESIGN.md) — the initials carry identity.
 */
export function Avatar({
  creator,
  size = 36,
}: {
  creator: CreatorRef | null | undefined;
  size?: number;
}) {
  const name = creator?.display_name ?? creator?.handle ?? '?';
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || '?';
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full bg-surface-2 font-bold text-ink-2"
    >
      {initials}
    </span>
  );
}
