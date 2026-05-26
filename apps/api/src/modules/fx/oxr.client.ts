import { Injectable, Logger } from '@nestjs/common';

export interface OxrRate {
  base: string;
  quote: string;
  rate: string;
}

@Injectable()
export class OxrClient {
  private readonly logger = new Logger(OxrClient.name);

  async fetch(): Promise<OxrRate[]> {
    const appId = process.env.OPENEXCHANGERATES_APP_ID;
    if (!appId) {
      this.logger.warn('OPENEXCHANGERATES_APP_ID not set — skipping OXR fetch');
      return [];
    }

    const symbols = ['ZAR', 'EUR', 'GBP', 'ZWG'];
    const url = `https://openexchangerates.org/api/latest.json?app_id=${appId}&base=USD&symbols=${symbols.join(',')}`;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) {
        this.logger.warn({ status: resp.status }, 'OXR fetch non-OK');
        return [];
      }
      const data = (await resp.json()) as { rates?: Record<string, number> };
      if (!data.rates) return [];

      return Object.entries(data.rates).map(([quote, rate]) => ({
        base: 'USD',
        quote,
        rate: rate.toFixed(10),
      }));
    } catch (err) {
      this.logger.warn({ err }, 'OXR fetch failed — skipping');
      return [];
    }
  }
}
