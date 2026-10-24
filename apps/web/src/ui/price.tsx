import { formatMoney } from '../lib/format';

export type MoneyJson = { amount_minor: string; currency: string };

/** A money amount, formatted at the leaf (CLAUDE.md §10), digits aligned. */
export function Price({ money, className }: { money: MoneyJson; className?: string }) {
  return (
    <span className={`num ${className ?? ''}`}>
      {formatMoney(money.amount_minor, money.currency)}
    </span>
  );
}

/**
 * Real charge plus an approximate local-currency equivalent. The approximation is
 * render-only (§3.5) and always marked with "≈".
 */
export function PriceWithLocal({ price, local }: { price: MoneyJson; local?: MoneyJson | null }) {
  const showLocal = local && local.currency !== price.currency;
  return (
    <span className="inline-flex flex-col leading-tight">
      <Price money={price} className="font-semibold text-ink" />
      {showLocal && (
        <span className="text-xs text-ink-3">
          ≈ <Price money={local} />
        </span>
      )}
    </span>
  );
}
