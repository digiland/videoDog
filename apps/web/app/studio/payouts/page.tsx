'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../src/lib/api';
import { isAuthenticated } from '../../../src/lib/auth';

interface Balance {
  currency: string;
  balance_minor: string;
}

const CURRENCIES = ['USD', 'ZWG', 'ZAR'];
const MIN_PAYOUT: Record<string, { minor: number; display: string }> = {
  USD: { minor: 500, display: '$5.00' },
  ZWG: { minor: 15000, display: 'ZWG 150' },
  ZAR: { minor: 10000, display: 'R 100' },
};

function formatMoney(minor: string | number, currency: string) {
  const n = Number(minor) / 100;
  const sym = currency === 'USD' ? '$' : currency === 'ZAR' ? 'R ' : `${currency} `;
  return `${sym}${n.toFixed(2)}`;
}

export default function PayoutsPage() {
  const router = useRouter();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState('');
  const [msisdn, setMsisdn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/sign-in');
      return;
    }
    void load();
  }, [router]);

  async function load() {
    try {
      const data = await api.get<{ balances: Array<{ currency: string; balance_minor: string }> }>(
        '/wallet/balance',
      );
      setBalances(data.balances);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load balances');
    }
  }

  const balanceForCurrency = balances?.find((b) => b.currency === currency);
  const balanceMinor = balanceForCurrency ? BigInt(balanceForCurrency.balance_minor) : 0n;
  const min = MIN_PAYOUT[currency]!;
  const requestedMinor = Math.round((parseFloat(amount) || 0) * 100);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post('/wallet/payout', {
        amount_minor: requestedMinor,
        currency,
        msisdn: msisdn.trim(),
      });
      setSuccess('Payout requested. You will be notified when it processes.');
      setAmount('');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payout failed');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    requestedMinor >= min.minor &&
    BigInt(requestedMinor) <= balanceMinor &&
    /^\+[1-9]\d{7,14}$/.test(msisdn.trim());

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 fade-up">
      <div className="flex items-center gap-2 text-sm text-ink-mute mb-2">
        <Link href="/studio" className="hover:text-ink">
          Studio
        </Link>
        <span>/</span>
        <span className="text-ink">Payouts</span>
      </div>
      <h1 className="text-3xl font-bold">Payouts</h1>
      <p className="text-ink-mute mt-1 max-w-xl">
        Withdraw earned balance to your EcoCash number. Minimums apply per currency.
      </p>

      {/* Balances */}
      <section className="mt-8 grid sm:grid-cols-3 gap-3">
        {(balances ?? []).map((b) => (
          <div key={b.currency} className="bg-bg-elev border border-line rounded-lg p-5">
            <p className="text-xs text-ink-dim uppercase tracking-wide">{b.currency} balance</p>
            <p className="text-3xl font-bold mt-1">{formatMoney(b.balance_minor, b.currency)}</p>
          </div>
        ))}
        {balances && balances.length === 0 && (
          <div className="col-span-3 bg-bg-elev border border-line rounded-lg p-6 text-center text-ink-mute text-sm">
            No balances yet. Publish videos and earn from views, rents, or the premium pool.
          </div>
        )}
      </section>

      {/* Request form */}
      <section className="mt-8 bg-bg-elev border border-line rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Request a payout</h2>

        <form onSubmit={(e) => void handleRequest(e)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Currency</label>
            <div className="flex gap-2">
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={`text-sm font-medium px-4 py-2 rounded-md transition ${
                    currency === c ? 'bg-accent text-bg' : 'bg-surface text-ink-mute hover:text-ink'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-surface border border-line focus:border-accent text-ink rounded-md px-4 py-2 placeholder:text-ink-dim focus:outline-none transition"
            />
            <p className="mt-1 text-xs text-ink-dim">
              Minimum {min.display}. Available:{' '}
              {formatMoney(balanceForCurrency?.balance_minor ?? '0', currency)}.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">EcoCash number</label>
            <input
              type="tel"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value)}
              placeholder="+263771234567"
              className="w-full bg-surface border border-line focus:border-accent text-ink rounded-md px-4 py-2 placeholder:text-ink-dim focus:outline-none transition font-mono"
            />
            <p className="mt-1 text-xs text-ink-dim">E.164 format with country code.</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-ok/10 border border-ok/30 text-ok rounded-md px-4 py-3 text-sm">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="bg-accent hover:bg-accent-hot text-bg font-semibold py-2.5 px-5 rounded-md text-sm transition disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Request payout'}
          </button>
        </form>
      </section>
    </div>
  );
}
