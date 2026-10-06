'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../src/lib/api';
import { minorToJsonNumber, parseMajorToMinor } from '../../../src/lib/money-input';
import type { Earnings, WalletBalance } from '../../../src/types/api';
import { formatMoney } from '../../../src/lib/format';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function EarningsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPayoutModal, setShowPayoutModal] = useState(false);

  // Payout modal state
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutCurrency, setPayoutCurrency] = useState('USD');
  // Payouts go to the profile's payout number (set/changed with an OTP on the Payouts page).
  const [payoutMsisdn, setPayoutMsisdn] = useState<string | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutSuccess, setPayoutSuccess] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [earningsData, balanceData, meData] = await Promise.allSettled([
        api.get<Earnings>(`/studio/earnings?month=${month}`),
        api.get<WalletBalance>('/wallet/balance'),
        api.get<{ payout_msisdn: string | null }>('/users/me'),
      ]);
      if (earningsData.status === 'fulfilled') setEarnings(earningsData.value);
      if (balanceData.status === 'fulfilled') setBalance(balanceData.value);
      if (meData.status === 'fulfilled') setPayoutMsisdn(meData.value.payout_msisdn);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handlePayout(e: React.FormEvent) {
    e.preventDefault();
    setPayoutError(null);
    if (!payoutMsisdn) {
      setPayoutError('Set a payout number on the Payouts page first.');
      return;
    }
    if (!payoutAmount) {
      setPayoutError('Enter an amount.');
      return;
    }
    const amountMinor = parseMajorToMinor(payoutAmount);
    if (amountMinor === null || amountMinor <= 0n) {
      setPayoutError('Enter a valid amount, e.g. 25.00 (max 2 decimal places).');
      return;
    }
    setPayoutLoading(true);
    try {
      await api.post('/wallet/payout', {
        // JSON number only at the API boundary; payout amounts are far below 2^53.
        amount_minor: minorToJsonNumber(amountMinor),
        currency: payoutCurrency,
      });
      setPayoutSuccess(true);
      void loadData();
    } catch (err: unknown) {
      setPayoutError(err instanceof Error ? err.message : 'Payout request failed.');
    } finally {
      setPayoutLoading(false);
    }
  }

  const earningsCards = earnings
    ? [
        {
          label: 'PPV Sales',
          value: formatMoney(earnings.ppv_amount.amount_minor, earnings.ppv_amount.currency),
          color: 'text-yellow-300',
        },
        {
          label: 'Premium Pool (est.)',
          value: formatMoney(
            earnings.premium_pool_estimate.amount_minor,
            earnings.premium_pool_estimate.currency,
          ),
          color: 'text-purple-300',
        },
        {
          label: 'Tips',
          value: formatMoney(earnings.tips_amount.amount_minor, earnings.tips_amount.currency),
          color: 'text-green-300',
        },
        {
          label: 'Total',
          value: formatMoney(earnings.total.amount_minor, earnings.total.currency),
          color: 'text-[#e94560]',
        },
      ]
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Earnings</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-[#16213e] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e94560] transition"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#e94560] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Earnings cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {earningsCards.map((card) => (
              <div
                key={card.label}
                className="bg-[#16213e] rounded-xl border border-[#1a1a2e]/50 p-4"
              >
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{card.label}</p>
                <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
            {!earnings && (
              <div className="col-span-4 text-center py-8 text-gray-600">
                No earnings data for this period.
              </div>
            )}
          </div>

          {/* Wallet balance */}
          <div className="bg-[#16213e] rounded-xl border border-[#1a1a2e]/50 p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Wallet Balance</h2>
              <button
                type="button"
                onClick={() => {
                  setShowPayoutModal(true);
                  setPayoutSuccess(false);
                  setPayoutError(null);
                }}
                className="bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2 px-4 rounded-lg transition text-sm"
              >
                Request payout
              </button>
            </div>
            {balance?.balances.length ? (
              <div className="flex flex-wrap gap-4">
                {balance.balances.map((b) => (
                  <div key={b.currency}>
                    <p className="text-xs text-gray-500 uppercase">{b.currency}</p>
                    <p className="text-lg font-semibold text-white">
                      {formatMoney(b.amount_minor, b.currency)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-sm">No balance yet.</p>
            )}
          </div>
        </>
      )}

      {/* Payout modal */}
      {showPayoutModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-[#16213e] rounded-2xl border border-[#1a1a2e]/50 p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-white mb-4">Request Payout</h2>

            {payoutSuccess ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 rounded-full bg-green-900/30 flex items-center justify-center mx-auto mb-3">
                  <svg
                    aria-hidden="true"
                    className="w-6 h-6 text-green-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <p className="text-green-300 font-medium">Payout requested!</p>
                <p className="text-gray-500 text-sm mt-1">
                  Processing typically takes 1-2 business days.
                </p>
                <button
                  type="button"
                  onClick={() => setShowPayoutModal(false)}
                  className="mt-4 bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2 px-6 rounded-lg transition"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handlePayout(e)} className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label
                      htmlFor="earnings-payout-amount"
                      className="block text-sm font-medium text-gray-300 mb-1.5"
                    >
                      Amount
                    </label>
                    <input
                      id="earnings-payout-amount"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(e.target.value)}
                      placeholder="5.00"
                      className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 w-full focus:outline-none focus:border-[#e94560] transition"
                    />
                  </div>
                  <div className="w-24">
                    <label
                      htmlFor="earnings-payout-currency"
                      className="block text-sm font-medium text-gray-300 mb-1.5"
                    >
                      Currency
                    </label>
                    <select
                      id="earnings-payout-currency"
                      value={payoutCurrency}
                      onChange={(e) => setPayoutCurrency(e.target.value)}
                      className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 w-full focus:outline-none focus:border-[#e94560] transition"
                    >
                      <option value="USD">USD</option>
                      <option value="ZWG">ZWG</option>
                      <option value="ZAR" disabled>
                        ZAR (coming soon)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="text-sm text-gray-300">
                  {payoutMsisdn ? (
                    <>
                      Paid to EcoCash <span className="font-mono">{payoutMsisdn}</span>.{' '}
                      <Link href="/studio/payouts" className="text-[#e94560] hover:underline">
                        Change
                      </Link>
                    </>
                  ) : (
                    <>
                      No payout number yet.{' '}
                      <Link href="/studio/payouts" className="text-[#e94560] hover:underline">
                        Set your payout number
                      </Link>{' '}
                      first.
                    </>
                  )}
                </div>

                <p className="text-xs text-gray-600">Minimums: USD $5.00 · ZWG 150</p>

                {payoutError && (
                  <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-sm text-red-300">
                    {payoutError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPayoutModal(false)}
                    className="flex-1 bg-[#0f0f23] hover:bg-[#1a2744] text-gray-400 font-semibold py-2.5 rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={payoutLoading}
                    className="flex-1 bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
                  >
                    {payoutLoading ? 'Submitting...' : 'Request payout'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
