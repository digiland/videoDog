'use client';
import { useEffect, useId, useRef, useState } from 'react';

/** Description clamped to three lines; "More" appears only when there is more to show. */
export default function Description({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col items-start gap-1">
      <p
        ref={ref}
        id={id}
        className={`whitespace-pre-line text-sm leading-6 text-ink-2 ${open ? '' : 'line-clamp-3'}`}
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="-ml-2 inline-flex h-11 items-center rounded px-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}
