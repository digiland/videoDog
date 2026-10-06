import Link from 'next/link';
import { MODES, type ModeKey } from './catalog';

/**
 * Access-mode filter as plain links: they work before JS loads, the filter is in the URL
 * (shareable, back button works), and the server renders the first page of each.
 */
export default function ModeChips({
  active,
  hrefFor,
  label = 'Filter by price',
}: {
  active: ModeKey;
  hrefFor: (mode: ModeKey) => string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto no-scrollbar">
      <ul className="flex w-max gap-2 px-4">
        {MODES.map((m) => {
          const on = m.key === active;
          return (
            <li key={m.key}>
              <Link
                href={hrefFor(m.key)}
                replace
                scroll={false}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
                  on
                    ? 'border-accent bg-surface-2 text-ink'
                    : 'border-line text-ink-2 hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {m.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
