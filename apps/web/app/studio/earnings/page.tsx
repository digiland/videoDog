'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../src/lib/api';
import type { Earnings, WalletBalance } from '../../../src/types/api';
import { formatMoney } from '../../../src/lib/format';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  const [payoutMsisdn, setPayoutMsisdn] = useState('');
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutSuccess, setPayoutSuccess] = useState(false);

  useEffect(() => {
    void loadData();
  }, [month]);

  async function loadData() {
    setLoading(true);
    try {
      const [earningsData, balanceData] = await Promise.allSettled([
        api.get<Earnings>(`/studio/earnings?month=${month}`),
        api.get<WalletBalance>('/wallet/balance'),
      ]);
      if (earningsData.status === 'fulfilled') setEarnings(earningsData.value);
      if (balanceData.status === 'fulfilled') setBalance(balanceData.value);
    } finally {
      setLoading(false);
    }
  }

  async function handlePayout(e: React.FormEvent) {
    e.preventDefault();
    setPayoutError(null);
    if (!payoutAmount || !payoutMsisdn) {
      setPayoutError('Please fill in all fields.');
      return;
    }
    const amountNum = parseFloat(payoutAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setPayoutError('Enter a valid amount.');
      return;
    }
    setPayoutLoading(true);
    try {
      await api.post('/wallet/payout', {
        amount: Math.round(amountNum * 100),
        currency: payoutCurrency,
        msisdn: payoutMsisdn,
        idempotency_key: generateIdempotencyKey(),
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
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount</label>
                    <input
                      type="number"
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(e.target.value)}
                      placeholder="5.00"
                      min="0"
                      step="0.01"
                      className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 w-full focus:outline-none focus:border-[#e94560] transition"
                    />
                  </div>
                  <div className="w-24">
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Currency
                    </label>
                    <select
                      value={payoutCurrency}
                      onChange={(e) => setPayoutCurrency(e.target.value)}
                      className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 w-full focus:outline-none focus:border-[#e94560] transition"
                    >
                      <option value="USD">USD</option>
                      <option value="ZWG">ZWG</option>
                      <option value="ZAR">ZAR</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    EcoCash number (E.164)
                  </label>
                  <input
                    type="tel"
                    value={payoutMsisdn}
                    onChange={(e) => setPayoutMsisdn(e.target.value)}
                    placeholder="+263771234567"
                    className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 w-full focus:outline-none focus:border-[#e94560] transition"
                  />
                </div>

                <p className="text-xs text-gray-600">Minimums: USD $5.00 · ZWG 150 · ZAR 100</p>

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
