'use client';
import { Field } from '../../../src/ui/field';
import { Segmented } from '../../../src/ui/segmented';
import { type AccessMode, needsPrice, priceRangeHint } from './studio-data';

const MODES: { value: AccessMode; label: string; explain: string }[] = [
  { value: 'free', label: 'Free', explain: 'Anyone can watch. Viewers can still tip you.' },
  {
    value: 'ppv',
    label: 'Pay once',
    explain: 'Viewers pay once to unlock it, with EcoCash or card.',
  },
  {
    value: 'premium',
    label: 'Premium',
    explain: 'Only Premium subscribers watch. You earn from the monthly pool by minutes watched.',
  },
  {
    value: 'premium_buyable',
    label: 'Premium + pay once',
    explain: 'Subscribers watch free; everyone else can pay once to unlock.',
  },
];

/**
 * Who can watch, and the price when there is one. The price is typed in the creator's
 * pricing currency (the API rejects any other) and parsed exactly by the caller.
 */
export function AccessModePicker({
  mode,
  onMode,
  price,
  onPrice,
  currency,
  error,
  idPrefix,
}: {
  mode: AccessMode;
  onMode: (m: AccessMode) => void;
  price: string;
  onPrice: (p: string) => void;
  currency: string;
  error?: string | null;
  idPrefix: string;
}) {
  const current = MODES.find((m) => m.value === mode);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Segmented
          legend="Who can watch"
          value={mode}
          options={MODES.map(({ value, label }) => ({ value, label }))}
          onChange={onMode}
        />
        <p className="text-sm text-ink-2">{current?.explain}</p>
      </div>
      {needsPrice(mode) && (
        <Field
          id={`${idPrefix}-price`}
          label="Price to unlock"
          prefix={currency}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.50"
          value={price}
          onChange={(e) => onPrice(e.target.value)}
          hint={priceRangeHint(currency)}
          error={error}
          className="max-w-xs"
        />
      )}
    </div>
  );
}
