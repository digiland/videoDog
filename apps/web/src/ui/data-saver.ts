'use client';
import { useEffect, useState } from 'react';

const KEY = 'streamzw:data-saver';
const EVENT = 'streamzw:data-saver-change';

type NetworkInfo = { saveData?: boolean; effectiveType?: string };

/** True if the browser asks to save data or the connection is 2G/slow-2G. */
function networkWantsSaving(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: NetworkInfo }).connection;
  return !!c && (c.saveData === true || c.effectiveType === '2g' || c.effectiveType === 'slow-2g');
}

function read(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

/**
 * Data Saver: caps playback at 240p and stops previews from loading video. The viewer's own
 * choice wins; until they make one, it follows the browser's Save-Data / 2G signal.
 */
export function useDataSaver(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(read() ?? networkWantsSaving());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const set = (value: boolean) => {
    try {
      localStorage.setItem(KEY, value ? '1' : '0');
    } catch {
      // storage blocked: the choice lasts for this page only
    }
    setOn(value);
    window.dispatchEvent(new Event(EVENT));
  };

  return [on, set];
}
