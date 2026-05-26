import type { CurrencyCode } from './currency.js';
export type FxRate = {
  id: string;
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: string;
  source: 'rbz' | 'openexchangerates' | 'manual' | 'identity';
};
//# sourceMappingURL=fx-rate.d.ts.map
