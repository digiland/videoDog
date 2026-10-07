'use client';
import { useState } from 'react';
import { api } from '../../src/lib/api';
import { Button } from '../../src/ui/button';

/** Inlined at build time; the API also refuses simulate unless DEV_SIMULATE_PAYMENTS=true. */
const ENABLED = process.env.NEXT_PUBLIC_DEV_SIMULATE_PAYMENTS === 'true';

/** Dev-only: settle a pending payment without a provider (POST /dev/payments/:id/simulate). */
export default function DevSimulatePayment({
  paymentId,
  onSimulated,
}: {
  paymentId: string;
  onSimulated: () => void;
}) {
  const [busy, setBusy] = useState<'completed' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!ENABLED) return null;

  async function simulate(status: 'completed' | 'failed') {
    setBusy(status);
    setError(null);
    try {
      await api.post(`/dev/payments/${encodeURIComponent(paymentId)}/simulate`, { status });
      onSimulated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Simulate failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-dashed border-line px-3 py-2">
      <p className="text-xs font-semibold text-gold">Dev only: no real provider</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={busy === 'completed'}
          disabled={busy !== null}
          onClick={() => void simulate('completed')}
        >
          Simulate success
        </Button>
        <Button
          variant="secondary"
          size="sm"
          loading={busy === 'failed'}
          disabled={busy !== null}
          onClick={() => void simulate('failed')}
        >
          Simulate failure
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
