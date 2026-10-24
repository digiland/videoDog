'use client';
import { useId } from 'react';

type Option<T extends string> = { value: T; label: string; disabled?: boolean; note?: string };

/**
 * One-of-few choice (currency, payment method). Native radios underneath, so arrow keys
 * and screen readers work; styled as large tap targets.
 */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col min-w-0">
      <legend className="text-sm font-medium text-ink mb-1.5">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className={o.disabled ? 'opacity-40' : 'cursor-pointer'}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span className="flex items-center h-11 px-4 rounded border border-line text-sm font-semibold text-ink-2 transition-colors peer-checked:border-accent peer-checked:text-ink peer-checked:bg-surface-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {o.label}
              {o.note && <span className="ml-1.5 text-xs font-normal text-ink-3">{o.note}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
