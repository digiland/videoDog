import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import type { LedgerService } from '../modules/payments/ledger.service';
import {
  accounts,
  ledgerEntries,
  premiumPayoutRuns,
  videos,
  watchMinutesDaily,
} from '../db/schema';
import { Money, allocate } from '@streamzw/shared';

const logger = new Logger('PremiumPoolWorker');

export function createPremiumPoolWorker(redisUrl: string, db: Db, ledger: LedgerService): Worker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = { url: redisUrl } as any;
  return new Worker(
    'payouts.calculate_premium_pool',
    async (job) => {
      const { year, month } = job.data as { year: number; month: number };

      // Idempotency guard
      const [existing] = await db
        .select()
        .from(premiumPayoutRuns)
        .where(and(eq(premiumPayoutRuns.year, year), eq(premiumPayoutRuns.month, month)))
        .limit(1);

      if (existing?.completedAt) {
        logger.log({ year, month }, 'Premium pool already distributed — skipping');
        return;
      }

      // Mark started
      await db
        .insert(premiumPayoutRuns)
        .values({ year, month, startedAt: new Date() })
        .onConflictDoNothing();

      const from = new Date(year, month - 1, 1);
      const to = new Date(year, month, 1);
      const fromDate = from.toISOString().slice(0, 10);
      const toDate = to.toISOString().slice(0, 10);

      // 1. Sum subscription revenue from ledger (credits to premium_pool.USD)
      const [premiumPoolAcc] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.scope, 'system'),
            eq(accounts.code, 'premium_pool'),
            eq(accounts.currency, 'USD'),
          ),
        )
        .limit(1);

      if (!premiumPoolAcc) {
        logger.warn({ year, month }, 'premium_pool account not found');
        return;
      }

      const [revenueRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(credit_minor::bigint), 0)` })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.accountId, premiumPoolAcc.id),
            gte(ledgerEntries.occurredAt, from),
            lt(ledgerEntries.occurredAt, to),
          ),
        );

      const subsRevenue = BigInt(revenueRow?.total ?? '0');
      if (subsRevenue === 0n) {
        logger.log({ year, month }, 'No subscription revenue — nothing to distribute');
        await db
          .update(premiumPayoutRuns)
          .set({ completedAt: new Date() })
          .where(and(eq(premiumPayoutRuns.year, year), eq(premiumPayoutRuns.month, month)));
        return;
      }

      const pool = new Money(subsRevenue, 'USD').mul(0.55);

      // 2. Aggregate watch minutes for premium_pool videos
      const minutesByVideo = await db
        .select({
          videoId: watchMinutesDaily.videoId,
          ownerId: videos.ownerId,
          minutes: sql<string>`SUM(${watchMinutesDaily.minutes}::bigint)`,
        })
        .from(watchMinutesDaily)
        .innerJoin(videos, eq(watchMinutesDaily.videoId, videos.id))
        .where(
          and(
            eq(videos.inPremiumPool, true),
            gte(watchMinutesDaily.date, fromDate),
            lt(watchMinutesDaily.date, toDate),
          ),
        )
        .groupBy(watchMinutesDaily.videoId, videos.ownerId);

      if (minutesByVideo.length === 0) {
        logger.log({ year, month }, 'No premium watch minutes');
        await db
          .update(premiumPayoutRuns)
          .set({ completedAt: new Date() })
          .where(and(eq(premiumPayoutRuns.year, year), eq(premiumPayoutRuns.month, month)));
        return;
      }

      const weights = minutesByVideo.map((r) => BigInt(r.minutes ?? '0'));
      const shares = allocate(pool.amount, weights);

      // 3. Write ledger entries
      for (let i = 0; i < minutesByVideo.length; i++) {
        const entry = minutesByVideo[i]!;
        const share = shares[i]!;
        if (share === 0n) continue;

        const creatorAccId = await ledger.findOrCreateAccount({
          scope: 'user',
          ownerId: entry.ownerId,
          code: 'creator_balance',
          currency: 'USD',
        });

        await ledger.recordTransaction([
          {
            accountId: premiumPoolAcc.id,
            debitMinor: share,
            creditMinor: 0n,
            currency: 'USD',
            usdEquivalentMinor: share,
            refType: 'premium_payout',
            refId: entry.videoId,
          },
          {
            accountId: creatorAccId,
            debitMinor: 0n,
            creditMinor: share,
            currency: 'USD',
            usdEquivalentMinor: share,
            refType: 'premium_payout',
            refId: entry.videoId,
          },
        ]);
      }

      // 4. Mark completed
      await db
        .update(premiumPayoutRuns)
        .set({ completedAt: new Date() })
        .where(and(eq(premiumPayoutRuns.year, year), eq(premiumPayoutRuns.month, month)));

      logger.log(
        { year, month, videos: minutesByVideo.length, pool: pool.toJSON() },
        'Premium pool distributed',
      );
    },
    { connection: conn },
  );
}
