'use client';
import { useCallback, useEffect, useState } from 'react';

/** Seconds left until something may be retried (resend a code, re-send a prompt). */
export function useCountdown(initialSeconds: number) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + initialSeconds * 1000);
  const [left, setLeft] = useState(initialSeconds);

  useEffect(() => {
    const remaining = () => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    setLeft(remaining());
    const t = setInterval(() => {
      const l = remaining();
      setLeft(l);
      if (l === 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [endsAt]);

  const restart = useCallback((seconds: number) => {
    setEndsAt(Date.now() + seconds * 1000);
    setLeft(seconds);
  }, []);

  return { left, restart };
}

/** 42 → "0:42" */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
