import type { CurrencyCode } from './currency.js';

// Stub type — populated by the FX module in M7. Domain code references FxRate.id to satisfy
// invariant §3.4 (every monetary record snapshots the FX rate used at the time of the txn).
export type FxRate = {
  id: string;
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: string; // numeric(20,10) — string to avoid float drift; parsed inside Money math
  source: 'rbz' | 'openexchangerates' | 'manual' | 'identity';
};
