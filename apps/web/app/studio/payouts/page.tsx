'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../src/lib/api';
import { formatMoney } from '../../../src/lib/format';
import {
  formatMinorToMajorInput,
  minorToJsonNumber,
  parseMajorToMinor,
} from '../../../src/lib/money-input';
import { Button } from '../../../src/ui/button';
import { Field } from '../../../src/ui/field';
import { Notice } from '../../../src/ui/notice';
import { Price } from '../../../src/ui/price';
import { Segmented } from '../../../src/ui/segmented';
import { Skeleton } from '../../../src/ui/state';
import PayoutNumberSetup from '../../components/PayoutNumberSetup';
import { LedgerList } from '../_components/LedgerList';
import {
  type BalanceResponse,
  type LedgerEntry,
  errorMessage,
  fetchBalance,
  fetchLedger,
  fetchMe,
  formatMsisdn,
  usdBalance,
} from '../_components/studio-data';
import { PageTitle, SectionTitle } from '../_components/ui';

type PayoutCurrency = 'USD' | 'ZWG' | 'ZAR';

/** API minimums (WalletService.requestPayout). ZAR has no payout rail yet. */
const MIN_MINOR: Record<'USD' | 'ZWG', bigint> = { USD: 500n, ZWG: 15000n };

export default function PayoutsPage() {
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [currency, setCurrency] = useState<'USD' | 'ZWG'>('USD');
  const [amount, setAmount] = useState('');
  // Payouts always go to the number saved on the profile (changed only with an OTP).
  const [savedMsisdn, setSavedMsisdn] = useState<string | null>(null);
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, me, l] = await Promise.all([fetchBalance(), fetchMe(), fetchLedger(100)]);
      setBalance(b);
      setSavedMsisdn(me.payout_msisdn);
      setAccountPhone(me.phone_e164);
      if (me.preferred_payout_currency === 'ZWG') setCurrency((c) => (c === 'USD' ? 'ZWG' : c));
      setLedger(l.entries.filter((e) => e.refType === 'payout'));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'Network error'));
      setLedger((l) => l ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Earnings are held in USD; ZWG payouts convert from it at the day's rate, so only a USD
  // request can be checked against the balance here (the server checks both).
  const bal = usdBalance(balance);
  const balMinor = BigInt(bal.amount_minor);
  const min = MIN_MINOR[currency];
  const requested = parseMajorToMinor(amount);

  let problem: string | null = null;
  if (amount.trim() && requested === null) problem = 'Use digits and a dot, e.g. 25.00.';
  else if (requested !== null && requested < min)
    problem = `The minimum is ${formatMoney(min, currency)}.`;
  else if (requested !== null && currency === 'USD' && requested > balMinor)
    problem = `That's more than your balance (${formatMoney(balMinor, 'USD')}).`;

  const canSubmit = requested !== null && !problem && savedMsisdn !== null && balance !== null;

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || requested === null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // JSON number only at the API boundary; payout amounts are far below 2^53.
      await api.post('/wallet/payout', {
        amount_minor: minorToJsonNumber(requested),
        currency,
      });
      setSuccess(
        `${formatMoney(requested, currency)} is on its way to EcoCash ${formatMsisdn(savedMsisdn)}. We'll message you when it lands.`,
      );
      setAmount('');
      await load();
    } catch (err) {
      setError(`Payout not sent: ${errorMessage(err, 'try again')}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageTitle title="Payouts">Withdraw your balance to EcoCash.</PageTitle>

      {loadError && <Notice tone="error">Couldn&rsquo;t load your balance: {loadError}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <section
          aria-labelledby="withdraw-h"
          className="flex flex-col gap-5 rounded border border-line bg-surface p-4 sm:p-5"
        >
          <div className="flex flex-col gap-1">
            <h2 id="withdraw-h" className="text-xs font-semibold text-ink-3">
              Balance
            </h2>
            {balance ? (
              <Price money={bal} className="text-4xl font-bold leading-none text-ink" />
            ) : (
              <Skeleton className="h-10 w-32" />
            )}
          </div>

          <form onSubmit={(e) => void handleRequest(e)} className="flex flex-col gap-4">
            <Segmented<PayoutCurrency>
              legend="Paid in"
              value={currency}
              options={[
                { value: 'USD', label: 'USD' },
                { value: 'ZWG', label: 'ZWG' },
                { value: 'ZAR', label: 'ZAR', disabled: true, note: 'coming soon' },
              ]}
              onChange={(c) => {
                if (c === 'ZAR') return;
                setCurrency(c);
                setError(null);
                setSuccess(null);
              }}
            />
            <div className="flex flex-col gap-2">
              <Field
                id="payout-amount"
                label="Amount"
                prefix={currency}
                inputMode="decimal"
                autoComplete="off"
                placeholder={formatMinorToMajorInput(min)}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                  setSuccess(null);
                }}
                error={problem}
                hint={
                  currency === 'USD'
                    ? `Minimum ${formatMoney(min, 'USD')}.`
                    : `Minimum ${formatMoney(min, 'ZWG')}. Converted from your USD balance at today's rate.`
                }
                className="max-w-xs"
              />
              {currency === 'USD' && balMinor >= min && (
                <button
                  type="button"
                  onClick={() => setAmount(formatMinorToMajorInput(balMinor))}
                  className="inline-flex h-11 w-fit items-center rounded px-1 text-sm font-semibold text-accent hover:underline"
                >
                  Withdraw all ({formatMoney(balMinor, 'USD')})
                </button>
              )}
            </div>

            <p className="text-sm text-ink-2">
              {savedMsisdn ? (
                <>
                  Paid to EcoCash{' '}
                  <span className="num font-semibold text-ink">{formatMsisdn(savedMsisdn)}</span>
                </>
              ) : (
                'Set your EcoCash payout number first.'
              )}
            </p>

            {error && <Notice tone="error">{error}</Notice>}
            {success && <Notice tone="success">{success}</Notice>}

            <Button type="submit" size="lg" block loading={busy} disabled={!canSubmit}>
              {requested !== null && !problem
                ? `Withdraw ${formatMoney(requested, currency)}`
                : 'Withdraw'}
            </Button>
          </form>
        </section>

        <section
          aria-labelledby="number-h"
          className="flex flex-col gap-4 rounded border border-line bg-surface p-4 sm:p-5"
        >
          <h2 id="number-h" className="text-base font-semibold text-ink">
            Payout number
          </h2>
          {accountPhone ? (
            <PayoutNumberSetup
              key={savedMsisdn ?? 'unset'}
              accountPhone={accountPhone}
              savedMsisdn={savedMsisdn}
              onSaved={setSavedMsisdn}
            />
          ) : (
            <Skeleton className="h-11" />
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <SectionTitle>Payout history</SectionTitle>
        <LedgerList
          entries={ledger}
          empty="No payouts yet. Once your balance reaches the minimum, withdraw it here."
        />
      </section>
    </div>
  );
}
