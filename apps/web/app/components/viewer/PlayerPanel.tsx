'use client';
import { dataPerMinuteMb } from '@streamzw/shared';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Icon } from '../../../src/ui/icon';

/**
 * Settings sheet inside the player. On phones it covers the whole 16:9 box (a popover would
 * not fit in ~200px of height); from md up it is a small panel above the control bar.
 */
export function PlayerPanel({
  label,
  onClose,
  header,
  children,
}: {
  label: string;
  onClose: () => void;
  header?: ReactNode;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <dialog
      open
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-0 z-20 m-0 flex h-auto max-h-none w-auto max-w-none flex-col gap-2 overflow-y-auto border-0 bg-surface p-2 text-ink md:inset-auto md:bottom-16 md:right-2 md:w-80 md:rounded-lg md:border md:border-line"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {header ?? <p className="px-2 text-sm font-semibold text-ink">{label}</p>}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="close" size={20} label={`Close ${label.toLowerCase()}`} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

type Choice = { value: string; label: string; note?: string; disabled?: boolean };

/** One-of-many choice on native radios (arrow keys, screen readers), as 44px tiles. */
export function ChoiceGrid({
  legend,
  value,
  choices,
  onChange,
}: {
  legend: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-1">
        {choices.map((c) => (
          <label key={c.value} className={c.disabled ? 'opacity-40' : 'cursor-pointer'}>
            <input
              type="radio"
              name={name}
              value={c.value}
              checked={c.value === value}
              disabled={c.disabled}
              onChange={() => onChange(c.value)}
              className="peer sr-only"
            />
            <span className="flex h-11 items-center justify-between gap-2 rounded border border-line px-3 text-sm font-semibold text-ink-2 transition-colors peer-checked:border-accent peer-checked:bg-surface-2 peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              <span className="num">{c.label}</span>
              {c.note && (
                <span className="truncate text-xs font-normal text-ink-3 num">{c.note}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The Data Saver switch: caps playback at 240p everywhere (shared preference). */
export function DataSaverSwitch({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex h-11 w-full items-center gap-3 rounded px-2 text-left transition-colors hover:bg-surface-2"
    >
      <Icon name="data" size={18} className={on ? 'text-accent' : 'text-ink-3'} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-sm font-semibold text-ink">Data Saver {on ? 'on' : 'off'}</span>
        <span className="truncate text-xs text-ink-3 num">
          {on ? `240p max · ${dataPerMinuteMb(240)} MB/min` : 'Tap to cap at 240p'}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors ${
          on ? 'border-accent bg-accent' : 'border-line-strong bg-surface-2'
        }`}
      >
        <span
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full ${
            on ? 'right-0.5 bg-on-accent' : 'left-0.5 bg-ink-3'
          }`}
        />
      </span>
    </button>
  );
}
