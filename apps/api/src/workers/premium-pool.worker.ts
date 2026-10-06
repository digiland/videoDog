import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import type { LedgerEntryInput, LedgerService } from '../modules/payments/ledger.service';
import {
  accounts,
  ledgerEntries,
  premiumPayoutRuns,
  videos,
  watchMinutesDaily,
} from '../db/schema';
import { Money, allocate } from '@streamzw/shared';
import { bullmqConnection } from '../common/bullmq-connection';

const logger = new Logger('PremiumPoolWorker');

/** Share of monthly subscription revenue paid to creators (§7); the rest is platform revenue. */
const CREATOR_POOL_SHARE = 0.55;
const CAT_OFFSET_MS = 2 * 60 * 60 * 1000;

export function createPremiumPoolWorker(redisUrl: string, db: Db, ledger: LedgerService): Worker {
  return new Worker(
    'payouts.calculate_premium_pool',
    async (job) => {
      const { year, month } = job.data as { year: number; month: number };
      await runPremiumPool(db, ledger, year, month);
    },
    { connection: bullmqConnection(redisUrl) },
  );
}

/**
 * Distribute one month's subscription revenue (§7). Idempotent: the run row is locked
 * FOR UPDATE and everything commits in one transaction, so a re-run is a no-op.
 */
export async function runPremiumPool(
  db: Db,
  ledger: LedgerService,
  year: number,
  month: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Upsert to ensure row exists
    await tx
      .insert(premiumPayoutRuns)
      .values({ year, month, startedAt: new Date() })
      .onConflictDoNothing();

    // Lock row FOR UPDATE
    const [run] = await tx
      .select()
      .from(premiumPayoutRuns)
      .where(and(eq(premiumPayoutRuns.year, year), eq(premiumPayoutRuns.month, month)))
      .for('update')
      .limit(1);

    if (run?.completedAt) {
      logger.log({ year, month }, 'Premium pool already distributed — skipping');
      return;
    }

    // Month boundaries in CAT (UTC+2, no DST), independent of the server's timezone.
    const from = new Date(Date.UTC(year, month - 1, 1) - CAT_OFFSET_MS);
    const to = new Date(Date.UTC(year, month, 1) - CAT_OFFSET_MS);
    const fromDate = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
    const toDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

    // 1. Sum subscription revenue from ledger (credits to premium_pool.USD)
    const [premiumPoolAcc] = await tx
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

    const [revenueRow] = await tx
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
      await tx
        .update(premiumPayoutRuns)
        .set({ completedAt: new Date() })
        .where(and(eq(premiumPayoutRuns.year, year), eq(premiumPayoutRuns.month, month)));
      return;
    }

    const pool = new Money(subsRevenue, 'USD').mul(CREATOR_POOL_SHARE);
    const platformShare = subsRevenue - pool.amount;

    // 2. Aggregate watch minutes for premium_pool videos
    const minutesByVideo = await tx
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
      .groupBy(watchMinutesDaily.videoId, videos.ownerId)
      // Stable order: allocate() breaks remainder ties by position, so an unordered
      // GROUP BY could hand the odd cent to a different creator on each run.
      .orderBy(desc(sql`SUM(${watchMinutesDaily.minutes}::bigint)`), watchMinutesDaily.videoId);

    const weights = minutesByVideo.map((r) => BigInt(r.minutes ?? '0'));
    const hasMinutes = weights.some((w) => w > 0n);
    if (!hasMinutes) {
      // Nothing to distribute against: the creators' 55% stays in premium_pool for
      // manual review rather than being guessed at. The platform share still moves.
      logger.warn({ year, month }, 'No premium watch minutes — creator share left in pool');
    }
    const shares = hasMinutes ? allocate(pool.amount, weights) : [];

    // 3. One balanced ledger transaction: Dr premium_pool (whole month's revenue)
    //    | Cr creator_balance per video (55%, by watch-minutes) | Cr platform_revenue (45%).
    const platformAcc = await ledger.findOrCreateAccount(
      { scope: 'system', code: 'platform_revenue', currency: 'USD' },
      tx,
    );
    const entries: LedgerEntryInput[] = [];
    let distributed = 0n;

    for (let i = 0; i < shares.length; i++) {
      const row = minutesByVideo[i]!;
      const share = shares[i]!;
      if (share === 0n) continue;
      const creatorAcc = await ledger.findOrCreateAccount(
        { scope: 'user', ownerId: row.ownerId, code: 'creator_balance', currency: 'USD' },
        tx,
      );
      distributed += share;
      entries.push({
        accountId: creatorAcc,
        debitMinor: 0n,
        creditMinor: share,
        currency: 'USD',
        usdEquivalentMinor: share,
        refType: 'premium_payout',
        refId: row.videoId,
      });
    }
    if (platformShare > 0n) {
      entries.push({
        accountId: platformAcc,
        debitMinor: 0n,
        creditMinor: platformShare,
        currency: 'USD',
        usdEquivalentMinor: platformShare,
        refType: 'premium_platform_share',
        refId: undefined,
      });
    }
    const debit = distributed + platformShare;
    if (debit > 0n) {
      entries.unshift({
        accountId: premiumPoolAcc.id,
        debitMinor: debit,
        creditMinor: 0n,
        currency: 'USD',
        usdEquivalentMinor: debit,
        refType: 'premium_payout',
        refId: undefined,
      });
      await ledger.recordTransaction(entries, tx);
    }

    // 4. Mark completed
    await tx
      .update(premiumPayoutRuns)
      .set({ completedAt: new Date() })
      .where(and(eq(premiumPayoutRuns.year, year), eq(premiumPayoutRuns.month, month)));

    logger.log(
      {
        year,
        month,
        videos: minutesByVideo.length,
        pool: pool.toJSON(),
        distributed: String(distributed),
      },
      'Premium pool distributed',
    );
  });
}
