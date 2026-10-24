import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { connect, hasDb, makeUser, makeVideo, services } from '../test/harness';
import { runPremiumPool } from './premium-pool.worker';
import { ledgerEntries, premiumPayoutRuns, watchMinutesDaily } from '../db/schema';
import type { Db } from '../db/db.module';
import type { LedgerService } from '../modules/payments/ledger.service';

describe.skipIf(!hasDb)('premium pool (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let ledger: LedgerService;

  // A unique month far in the past, so earlier runs against the same DB don't add revenue.
  const year = 1100 + (Date.now() % 800);
  const month = 3;
  const day = `${year}-03-10`;

  beforeAll(() => {
    ({ db, close } = connect());
    ledger = services(db).ledger;
  });
  afterAll(async () => close());

  it('pays 55% by watch-minutes, moves 45% to platform, and is idempotent', async () => {
    const a = await makeUser(db, { role: 'creator' });
    const b = await makeUser(db, { role: 'creator' });
    const va = await makeVideo(db, a.id, {
      accessMode: 'premium',
      ppvPriceMinorUnits: null,
      ppvPriceCurrency: null,
    });
    const vb = await makeVideo(db, b.id, {
      accessMode: 'premium',
      ppvPriceMinorUnits: null,
      ppvPriceCurrency: null,
    });

    // 1000¢ of subscription revenue, booked mid-month (CAT).
    const occurredAt = new Date(Date.UTC(year, month - 1, 15));
    const [received, pool] = await Promise.all([
      ledger.findOrCreateAccount({ scope: 'system', code: 'payment_received', currency: 'USD' }),
      ledger.findOrCreateAccount({ scope: 'system', code: 'premium_pool', currency: 'USD' }),
    ]);
    const txId = crypto.randomUUID();
    await db.insert(ledgerEntries).values([
      {
        transactionId: txId,
        accountId: received,
        debitMinor: '1000',
        creditMinor: '0',
        currency: 'USD',
        usdEquivalentMinor: '1000',
        refType: 'subscription',
        occurredAt,
      },
      {
        transactionId: txId,
        accountId: pool,
        debitMinor: '0',
        creditMinor: '1000',
        currency: 'USD',
        usdEquivalentMinor: '1000',
        refType: 'subscription',
        occurredAt,
      },
    ]);

    // Video A watched 3× as much as video B.
    await db.insert(watchMinutesDaily).values([
      { date: day, videoId: va.id, minutes: '300' },
      { date: day, videoId: vb.id, minutes: '100' },
    ]);

    await runPremiumPool(db, ledger, year, month);
    await runPremiumPool(db, ledger, year, month); // re-run must be a no-op

    const balanceOf = async (ownerId: string) =>
      ledger.balance(
        await ledger.findOrCreateAccount({
          scope: 'user',
          ownerId,
          code: 'creator_balance',
          currency: 'USD',
        }),
      );
    const aBal = await balanceOf(a.id);
    const bBal = await balanceOf(b.id);
    expect(aBal + bBal).toBe(550n);
    expect(aBal).toBe(413n); // 412.5 → largest remainder
    expect(bBal).toBe(137n);

    // One balanced transaction: Dr pool 1000 | Cr creators 550 | Cr platform 450.
    const [creatorEntry] = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.refType, 'premium_payout'), eq(ledgerEntries.refId, va.id)));
    const runEntries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, creatorEntry!.transactionId));
    const platform = runEntries.find((e) => e.refType === 'premium_platform_share');
    expect(platform?.creditMinor).toBe('450');
    const poolDebit = runEntries.find((e) => e.accountId === pool);
    expect(poolDebit?.debitMinor).toBe('1000');

    const [run] = await db
      .select()
      .from(premiumPayoutRuns)
      .where(and(eq(premiumPayoutRuns.year, year), eq(premiumPayoutRuns.month, month)));
    expect(run?.completedAt).not.toBeNull();
  });
});
