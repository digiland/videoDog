'use client';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Leading text inside the box, e.g. a currency code. */
  prefix?: string;
};

/** Label above, hint or error below. Errors replace the hint and are announced. */
export function Field({ label, hint, error, prefix, id, className, ...input }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const describedBy = `${inputId}-desc`;
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div
        className={`flex items-center h-11 rounded border bg-surface px-3 gap-2 focus-within:border-accent ${
          error ? 'border-danger' : 'border-line'
        }`}
      >
        {prefix && <span className="text-sm text-ink-3 num">{prefix}</span>}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? describedBy : undefined}
          className="flex-1 min-w-0 bg-transparent text-base text-ink placeholder:text-ink-3 outline-none focus-visible:outline-none num"
          {...input}
        />
      </div>
      {(error || hint) && (
        <p
          id={describedBy}
          role={error ? 'alert' : undefined}
          className={`text-xs ${error ? 'text-danger' : 'text-ink-3'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
