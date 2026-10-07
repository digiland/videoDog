import type { ReactNode } from 'react';

/** Empty or error state: a plain sentence, then the one useful next step. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-12 px-4">
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <p className="text-sm text-ink-2 max-w-sm">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Static placeholder block with the final element's shape, so nothing jumps on load. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded ${className ?? ''}`} />;
}
