'use client';
import { useId } from 'react';
import { dataPerMinuteMb } from '@streamzw/shared';
import { useDataSaver } from '../../../src/ui/data-saver';
import { Icon } from '../../../src/ui/icon';

/** Data Saver on/off as one large row: the whole row is the switch. Applies immediately. */
export function DataSaverToggle() {
  const [on, setOn] = useDataSaver();
  const descId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-describedby={descId}
      onClick={() => setOn(!on)}
      className="flex items-center gap-3 w-full min-h-[64px] px-4 py-3 text-left hover:bg-surface-2 transition-colors"
    >
      <Icon name="data" size={22} className={`shrink-0 ${on ? 'text-accent' : 'text-ink-3'}`} />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-base font-semibold text-ink">Data Saver</span>
        <span id={descId} className="text-sm text-ink-2">
          Play at 240p and save data — about {dataPerMinuteMb(240)} MB per minute
        </span>
      </span>
      <span
        aria-hidden
        className={`relative inline-flex w-12 h-7 shrink-0 rounded-full border transition-colors ${
          on ? 'bg-accent border-accent' : 'bg-surface-2 border-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 w-[22px] h-[22px] rounded-full ${
            on ? 'left-[22px] bg-on-accent' : 'left-0.5 bg-ink-3'
          }`}
        />
      </span>
    </button>
  );
}
