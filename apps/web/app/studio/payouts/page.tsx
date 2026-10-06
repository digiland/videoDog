'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../src/lib/api';
import { isAuthenticated } from '../../../src/lib/auth';
import { formatMoney } from '../../../src/lib/format';
import { minorToJsonNumber, parseMajorToMinor } from '../../../src/lib/money-input';
import PayoutNumberSetup from '../../components/PayoutNumberSetup';

interface Balance {
  currency: string;
  balance_minor: string;
}

type PayoutCurrency = 'USD' | 'ZWG';

/** ZAR is listed but disabled: there is no ZAR payout rail yet (the API rejects it). */
const CURRENCY_OPTIONS: ReadonlyArray<{ code: string; available: PayoutCurrency | null }> = [
  { code: 'USD', available: 'USD' },
  { code: 'ZWG', available: 'ZWG' },
  { code: 'ZAR', available: null },
];
const MIN_PAYOUT: Record<PayoutCurrency, { minor: bigint; display: string }> = {
  USD: { minor: 500n, display: '$5.00' },
  ZWG: { minor: 15000n, display: 'ZWG 150' },
};

export default function PayoutsPage() {
  const router = useRouter();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [currency, setCurrency] = useState<PayoutCurrency>('USD');
  const [amount, setAmount] = useState('');
  // Payouts always go to the number saved on the profile (changed only with an OTP).
  const [savedMsisdn, setSavedMsisdn] = useState<string | null>(null);
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
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
      const [data, me] = await Promise.all([
        api.get<{ balances: Array<{ currency: string; balance_minor: string }> }>(
          '/wallet/balance',
        ),
        api.get<{ payout_msisdn: string | null; phone_e164: string }>('/users/me'),
      ]);
      setBalances(data.balances);
      setSavedMsisdn(me.payout_msisdn);
      setAccountPhone(me.phone_e164);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load balances');
    }
  }

  // Earnings are held in USD; ZWG payouts are converted from it at the day's rate,
  // so only a USD request can be checked against the balance here.
  const usdBalance = balances?.find((b) => b.currency === 'USD');
  const balanceMinor = usdBalance ? BigInt(usdBalance.balance_minor) : 0n;
  const min = MIN_PAYOUT[currency];
  const requestedMinor = parseMajorToMinor(amount);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (requestedMinor === null) throw new Error('Enter a valid amount.');
      // JSON number only at the API boundary; payout amounts are far below 2^53.
      await api.post('/wallet/payout', {
        amount_minor: minorToJsonNumber(requestedMinor),
        currency,
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
    requestedMinor !== null &&
    requestedMinor >= min.minor &&
    (currency !== 'USD' || requestedMinor <= balanceMinor) &&
    savedMsisdn !== null;

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

      {/* Payout number */}
      <section className="mt-8 bg-bg-elev border border-line rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Payout number</h2>
        {accountPhone ? (
          <PayoutNumberSetup
            key={savedMsisdn ?? 'unset'}
            accountPhone={accountPhone}
            savedMsisdn={savedMsisdn}
            onSaved={setSavedMsisdn}
          />
        ) : (
          <p className="text-sm text-ink-dim">Loading…</p>
        )}
      </section>

      {/* Request form */}
      <section className="mt-8 bg-bg-elev border border-line rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Request a payout</h2>

        <form onSubmit={(e) => void handleRequest(e)} className="space-y-4">
          <fieldset>
            <legend className="block text-sm font-medium mb-1.5">Currency</legend>
            <div className="flex gap-2">
              {CURRENCY_OPTIONS.map(({ code, available }) => (
                <button
                  key={code}
                  type="button"
                  disabled={!available}
                  onClick={() => available && setCurrency(available)}
                  className={`text-sm font-medium px-4 py-2 rounded-md transition disabled:cursor-not-allowed ${
                    currency === code
                      ? 'bg-accent text-bg'
                      : available
                        ? 'bg-surface text-ink-mute hover:text-ink'
                        : 'bg-surface text-ink-dim opacity-60'
                  }`}
                >
                  {code}
                  {!available && <span className="ml-1 text-[10px] uppercase">coming soon</span>}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="payout-amount" className="block text-sm font-medium mb-1.5">
              Amount
            </label>
            <input
              id="payout-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-surface border border-line focus:border-accent text-ink rounded-md px-4 py-2 placeholder:text-ink-dim focus:outline-none transition"
            />
            <p className="mt-1 text-xs text-ink-dim">
              Minimum {min.display}. Available:{' '}
              {formatMoney(usdBalance?.balance_minor ?? '0', 'USD')}
              {currency !== 'USD' && ' (converted at the current rate)'}.
            </p>
          </div>

          {!savedMsisdn && (
            <p className="text-sm text-ink-mute">
              Set a payout number below before requesting a payout.
            </p>
          )}

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
