import { CATEGORY_LABELS, CONTENT_CATEGORIES, type ContentCategory } from '@streamzw/shared';
import Link from 'next/link';
import { MODES, type ModeKey } from './catalog';

function Chip({ href, on, children }: { href: string; on: boolean; children: string }) {
  return (
    <li className="shrink-0">
      <Link
        href={href}
        replace
        scroll={false}
        aria-current={on ? 'page' : undefined}
        className={`inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold transition-colors ${
          on ? 'bg-ink text-bg' : 'bg-surface-2 text-ink hover:bg-line'
        }`}
      >
        {children}
      </Link>
    </li>
  );
}

/**
 * YouTube's chip bar: topics first, then price. Plain links, so filters work before JS
 * loads, live in the URL (shareable, back button works) and the server renders each.
 */
export default function FilterChips({
  category,
  mode,
  hrefFor,
  showModes = true,
}: {
  category: ContentCategory | null;
  mode: ModeKey;
  hrefFor: (f: { category: ContentCategory | null; mode: ModeKey }) => string;
  showModes?: boolean;
}) {
  return (
    <nav aria-label="Filters" className="no-scrollbar -mx-4 overflow-x-auto md:-mx-6">
      <ul className="flex w-max items-center gap-3 px-4 md:px-6">
        <Chip href={hrefFor({ category: null, mode })} on={category === null}>
          All
        </Chip>
        {CONTENT_CATEGORIES.filter((c) => c !== 'other').map((c) => (
          <Chip key={c} href={hrefFor({ category: c, mode })} on={category === c}>
            {CATEGORY_LABELS[c]}
          </Chip>
        ))}
        {showModes && (
          <>
            <li aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
            {MODES.filter((m) => m.key !== 'all').map((m) => (
              <Chip
                key={m.key}
                href={hrefFor({ category, mode: mode === m.key ? 'all' : m.key })}
                on={mode === m.key}
              >
                {m.label}
              </Chip>
            ))}
          </>
        )}
      </ul>
    </nav>
  );
}
