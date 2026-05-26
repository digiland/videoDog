import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

export interface RbzRate {
  base: string;
  quote: string;
  rate: string;
}

@Injectable()
export class RbzScraper {
  private readonly logger = new Logger(RbzScraper.name);

  async fetch(): Promise<RbzRate[]> {
    const url =
      process.env.RBZ_FEED_URL ?? 'https://www.rbz.co.zw/index.php/research/markets/exchange-rates';
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) {
        this.logger.warn({ status: resp.status }, 'RBZ fetch returned non-OK status');
        return [];
      }
      const html = await resp.text();
      return this.parse(html);
    } catch (err) {
      this.logger.warn({ err }, 'RBZ scraper failed — skipping');
      return [];
    }
  }

  private parse(html: string): RbzRate[] {
    const $ = cheerio.load(html);
    const rates: RbzRate[] = [];

    // Look for table rows containing USD/ZWG rates
    $('table tr').each((_i, row) => {
      const cells = $(row)
        .find('td')
        .map((_j, cell) => $(cell).text().trim())
        .get();
      if (cells.length < 2) return;

      const text = cells.join(' ').toUpperCase();
      if (text.includes('USD') && text.includes('ZWG')) {
        // Try to extract a numeric rate
        const numMatch = cells.find((c) => /^\d+\.?\d*$/.test(c.replace(/,/g, '')));
        if (numMatch) {
          const rate = parseFloat(numMatch.replace(/,/g, ''));
          if (rate > 0) {
            rates.push({ base: 'USD', quote: 'ZWG', rate: rate.toFixed(10) });
          }
        }
      }
    });

    return rates;
  }
}
