import { Icon } from './icon';
import { Price, type MoneyJson } from './price';

export type AccessMode = 'free' | 'ppv' | 'premium' | 'premium_buyable';

/**
 * What a video costs, at a glance, everywhere a video appears. Colour carries meaning:
 * sage = free, copper = pay once, gold = included with Premium. Text always says it too.
 */
export function AccessChip({ mode, price }: { mode: AccessMode; price?: MoneyJson | null }) {
  const base = 'inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-semibold num';
  if (mode === 'free') {
    return <span className={`${base} bg-surface-2 text-sage`}>Free</span>;
  }
  if (mode === 'premium') {
    return <span className={`${base} bg-surface-2 text-gold`}>Premium</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      {mode === 'premium_buyable' && (
        <span className={`${base} bg-surface-2 text-gold`}>Premium</span>
      )}
      <span className={`${base} bg-surface-2 text-accent`}>
        <Icon name="lock" size={12} />
        {price ? <Price money={price} /> : 'Buy'}
      </span>
    </span>
  );
}
