'use client';
import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../src/lib/api';
import type { PaymentState, PaymentStatus } from '../../src/types/api';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 3 * 60_000;

export type PollOutcome = 'completed' | 'failed' | 'reversed' | 'timeout';

interface Watch {
  paymentId: string;
  deadline: number;
}

/**
 * Polls GET /payments/:id every 3s for up to ~3 minutes and reports the outcome once.
 * Shared by the in-page EcoCash checkout and the Paystack return page.
 */
export function usePaymentPolling(onOutcome: (outcome: PollOutcome, paymentId: string) => void) {
  const watchRef = useRef<Watch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    watchRef.current = null;
  }, [clearTimer]);

  useEffect(() => stop, [stop]);

  // `check` and `settle` call each other; route through a ref to keep both stable.
  const checkRef = useRef<(w: Watch) => Promise<void>>(async () => undefined);

  const settle = useCallback(
    (w: Watch, state: PaymentState | null) => {
      if (watchRef.current !== w) return; // stopped or restarted meanwhile
      if (state === 'completed' || state === 'failed' || state === 'reversed') {
        stop();
        onOutcomeRef.current(state, w.paymentId);
        return;
      }
      if (Date.now() >= w.deadline) {
        stop();
        onOutcomeRef.current('timeout', w.paymentId);
        return;
      }
      clearTimer();
      timerRef.current = setTimeout(() => void checkRef.current(w), POLL_INTERVAL_MS);
    },
    [stop, clearTimer],
  );

  checkRef.current = async (w: Watch) => {
    let state: PaymentState | null = null;
    try {
      const p = await api.get<PaymentStatus>(`/payments/${encodeURIComponent(w.paymentId)}`);
      state = p.state;
    } catch {
      // Transient: keep polling until the deadline.
    }
    settle(w, state);
  };

  /** Start (or restart) watching a payment; `initial` is a state already known. */
  const start = useCallback(
    (paymentId: string, initial: PaymentState | null = null) => {
      stop();
      const w: Watch = { paymentId, deadline: Date.now() + POLL_TIMEOUT_MS };
      watchRef.current = w;
      settle(w, initial);
    },
    [stop, settle],
  );

  /** Check right away (e.g. after a dev simulate) instead of waiting for the next tick. */
  const pollNow = useCallback(() => {
    const w = watchRef.current;
    if (!w) return;
    clearTimer();
    void checkRef.current(w);
  }, [clearTimer]);

  return { start, stop, pollNow };
}
