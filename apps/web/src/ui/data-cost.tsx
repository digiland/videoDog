import { dataCostMb, dataPerMinuteMb } from '@streamzw/shared';
import { Icon } from './icon';

/**
 * What watching costs in data, in MB — the unit bundles are sold in. Shown before play so
 * nobody is surprised by an empty bundle.
 */
export function DataCost({ seconds, height = 240 }: { seconds: number | null; height?: number }) {
  const label = seconds
    ? `≈ ${dataCostMb(height, seconds)} MB at ${height}p`
    : `≈ ${dataPerMinuteMb(height)} MB/min at ${height}p`;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-3 num">
      <Icon name="data" size={14} />
      {label}
    </span>
  );
}
