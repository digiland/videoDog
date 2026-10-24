import type { ReactNode } from 'react';
import { Icon } from '../../../src/ui/icon';

type Tone = 'wait' | 'success' | 'error' | 'info';

const ICON: Record<Tone, { name: 'spinner' | 'check' | 'alert'; cls: string }> = {
  wait: { name: 'spinner', cls: 'text-accent' },
  success: { name: 'check', cls: 'text-sage' },
  error: { name: 'alert', cls: 'text-danger' },
  info: { name: 'alert', cls: 'text-ink-3' },
};

/**
 * One payment state (waiting, paid, failed…), laid out the same in the checkout and on the
 * card return page: a status mark, what happened, what to do, then the next step.
 */
export function PayStatus({
  tone,
  title,
  children,
  actions,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const icon = ICON[tone];
  return (
    <div
      className="flex flex-col gap-4"
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-10 h-10 shrink-0 rounded-full bg-surface-2">
          <Icon name={icon.name} size={22} className={icon.cls} />
        </span>
        <div className="flex flex-col gap-1 min-w-0 pt-1.5">
          <p className="text-lg font-bold text-ink leading-tight">{title}</p>
          {children && <div className="text-sm text-ink-2 flex flex-col gap-2">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-col gap-2">{actions}</div>}
    </div>
  );
}
