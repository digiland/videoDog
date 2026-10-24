import type { ReactNode } from 'react';
import { Icon } from '../../../src/ui/icon';

/**
 * Frame for sign-in and verify: one narrow column near the top of the screen, so the
 * keyboard never covers the field or the button on a phone.
 */
export function AuthShell({
  title,
  lead,
  back,
  children,
}: {
  title: string;
  lead: ReactNode;
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-10 sm:pt-16 flex flex-col gap-6">
      {back}
      <header className="flex flex-col gap-2">
        <span className="flex items-center justify-center w-11 h-11 rounded-full bg-surface-2 text-accent">
          <Icon name="phone" size={22} />
        </span>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        <div className="text-base text-ink-2">{lead}</div>
      </header>
      {children}
    </div>
  );
}

/** Placeholder while search params resolve; same shape as the form so nothing jumps. */
export function AuthShellFallback() {
  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-10 sm:pt-16 flex flex-col gap-6" aria-busy>
      <div className="flex flex-col gap-2">
        <div className="skeleton w-11 h-11 rounded-full" />
        <div className="skeleton h-8 w-48 rounded" />
        <div className="skeleton h-6 w-full rounded" />
      </div>
      <div className="skeleton h-11 w-full rounded" />
      <div className="skeleton h-12 w-full rounded" />
    </div>
  );
}
