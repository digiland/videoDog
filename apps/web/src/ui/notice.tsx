import type { ReactNode } from 'react';
import { Icon } from './icon';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, string> = {
  info: 'text-ink-2',
  success: 'text-sage',
  warning: 'text-gold',
  error: 'text-danger',
};

/** Inline status message. Says what happened and what to do next; no apologies. */
export function Notice({
  tone = 'info',
  children,
  action,
}: {
  tone?: Tone;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex items-start gap-3 rounded border border-line bg-surface px-4 py-3 text-sm"
    >
      <Icon
        name={tone === 'success' ? 'check' : 'alert'}
        size={18}
        className={`mt-0.5 shrink-0 ${TONES[tone]}`}
      />
      <div className="flex-1 min-w-0 text-ink">{children}</div>
      {action}
    </div>
  );
}
