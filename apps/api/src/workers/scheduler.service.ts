import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { FxService } from '../modules/fx/fx.service';
import { RbzScraper } from '../modules/fx/rbz.scraper';
import { OxrClient } from '../modules/fx/oxr.client';
import { SubscriptionsService } from '../modules/subscriptions/subscriptions.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly premiumPoolQueue: Queue;

  constructor(
    private readonly fxService: FxService,
    private readonly rbzScraper: RbzScraper,
    private readonly oxrClient: OxrClient,
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.premiumPoolQueue = new Queue('payouts.calculate_premium_pool', {
      connection: { url: redisUrl } as any,
    });
  }

  /**
   * Daily cron fx.refresh (06:00 CAT / 04:00 UTC)
   */
  @Cron('0 4 * * *')
  async refreshFxRates() {
    this.logger.log('Running daily FX refresh cron...');

    // RBZ
    try {
      const rbzRates = await this.rbzScraper.fetch();
      for (const r of rbzRates) {
        await this.fxService.closeCurrentRates(r.base, r.quote, 'rbz');
        await this.fxService.insertRate({
          base: r.base,
          quote: r.quote,
          rate: r.rate,
          source: 'rbz',
          sourcePriority: 50,
          notes: 'Scraped from RBZ website',
        });
      }
      this.logger.log(`RBZ refresh complete. Processed ${rbzRates.length} rates.`);
    } catch (err) {
      this.logger.error('RBZ refresh failed', err);
    }

    // OXR
    try {
      const oxrRates = await this.oxrClient.fetch();
      for (const r of oxrRates) {
        await this.fxService.closeCurrentRates(r.base, r.quote, 'openexchangerates');
        await this.fxService.insertRate({
          base: r.base,
          quote: r.quote,
          rate: r.rate,
          source: 'openexchangerates',
          sourcePriority: 10,
          notes: 'Fetched from Open Exchange Rates API',
        });
      }
      this.logger.log(`OXR refresh complete. Processed ${oxrRates.length} rates.`);
    } catch (err) {
      this.logger.error('OXR refresh failed', err);
    }
  }

  /**
   * Daily subscription renewals cron (02:00 CAT / 00:00 UTC)
   */
  @Cron('0 0 * * *')
  async runSubscriptionRenewals() {
    this.logger.log('Running daily subscription renewals cron...');
    try {
      await this.subscriptionsService.processRenewals();
      this.logger.log('Subscription renewals processing complete.');
    } catch (err) {
      this.logger.error('Subscription renewals failed', err);
    }
  }

  /**
   * Monthly premium pool cron (01:00 CAT Day 1 / 23:00 UTC Last Day of month)
   */
  @Cron('0 23 28-31 * *') // runs daily in last days to check if today is last day
  async triggerPremiumPoolPayout() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Check if tomorrow is the 1st of the month (which means today is the last day)
    if (tomorrow.getDate() === 1) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1; // getMonth is 0-indexed, so current month is now.getMonth() + 1

      this.logger.log(
        `Last day of month reached. Enqueuing premium pool calculations for ${year}-${month}...`,
      );
      try {
        await this.premiumPoolQueue.add(
          'calculate',
          { year, month },
          { jobId: `payout-pool:${year}-${month}` },
        );
        this.logger.log('Premium pool calculations job enqueued.');
      } catch (err) {
        this.logger.error('Failed to enqueue premium pool calculations job', err);
      }
    }
  }
}
