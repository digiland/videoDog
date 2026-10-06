'use client';
import { useState } from 'react';
import { api } from '../../src/lib/api';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ENABLED) return null;

  async function simulate(status: 'completed' | 'failed') {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/dev/payments/${encodeURIComponent(paymentId)}/simulate`, { status });
      onSimulated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Simulate failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-dashed border-warn/50 rounded-md px-3 py-2 text-xs space-y-2">
      <p className="text-warn font-semibold uppercase tracking-wide">Dev only</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void simulate('completed')}
          className="px-2 py-1 rounded bg-surface hover:bg-surface-2 border border-line disabled:opacity-50"
        >
          Simulate success
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void simulate('failed')}
          className="px-2 py-1 rounded bg-surface hover:bg-surface-2 border border-line disabled:opacity-50"
        >
          Simulate failure
        </button>
      </div>
      {error && <p className="text-red-300">{error}</p>}
    </div>
  );
}
