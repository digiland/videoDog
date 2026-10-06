import { Price } from '../../../src/ui/price';
import { Skeleton } from '../../../src/ui/state';
import { type LedgerEntry, ledgerAmount, ledgerLabel, shortDate } from './studio-data';

/** Money in and out of the balance, newest first. Signs and colour both say the direction. */
export function LedgerList({ entries, empty }: { entries: LedgerEntry[] | null; empty: string }) {
  if (entries === null) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="rounded border border-line bg-surface px-4 py-6 text-center text-sm text-ink-2">
        {empty}
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded border border-line bg-surface">
      {entries.map((e) => {
        const { money, incoming } = ledgerAmount(e);
        return (
          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{ledgerLabel(e)}</p>
              <p className="num text-xs text-ink-3">{shortDate(e.occurredAt)}</p>
            </div>
            <span
              className={`num shrink-0 text-base font-semibold ${incoming ? 'text-sage' : 'text-ink'}`}
            >
              {incoming ? '+' : '−'}
              <Price money={money} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
