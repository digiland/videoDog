import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, hasDb, makeUser, services } from '../../test/harness';
import { WalletService } from './wallet.service';
import type { PaymentsService } from '../payments/payments.service';
import { payouts } from '../../db/schema';
import type { Db } from '../../db/db.module';
import type { LedgerService } from '../payments/ledger.service';

/** Stand-in for the EcoCash disbursement rail; each test sets the outcome. */
let disburseOutcome: 'completed' | 'failed' = 'completed';
const rails = {
  ecocashFor: () => ({
    disburse: async () => ({ provider_ref: 'test-ref', status: disburseOutcome }),
  }),
};

describe.skipIf(!hasDb)('wallet payouts (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let ledger: LedgerService;
  let wallet: WalletService;

  beforeAll(() => {
    ({ db, close } = connect());
    const s = services(db);
    ledger = s.ledger;
    wallet = new WalletService(db, s.ledger, s.fx, rails as unknown as PaymentsService);
  });
  afterAll(async () => close());

  async function fundedCreator(
    balanceMinor: bigint,
    payoutMsisdn: string | null = '+263771111111',
  ) {
    const creator = await makeUser(db, { role: 'creator', payoutMsisdn });
    const [received, balance] = await Promise.all([
      ledger.findOrCreateAccount({ scope: 'system', code: 'payment_received', currency: 'USD' }),
      ledger.findOrCreateAccount({
        scope: 'user',
        ownerId: creator.id,
        code: 'creator_balance',
        currency: 'USD',
      }),
    ]);
    await ledger.recordTransaction([
      {
        accountId: received,
        debitMinor: balanceMinor,
        creditMinor: 0n,
        currency: 'USD',
        usdEquivalentMinor: balanceMinor,
        refType: 'test',
      },
      {
        accountId: balance,
        debitMinor: 0n,
        creditMinor: balanceMinor,
        currency: 'USD',
        usdEquivalentMinor: balanceMinor,
        refType: 'test',
      },
    ]);
    return { creator, balanceAcc: balance };
  }

  it('lets only one of two concurrent payouts spend the same balance', async () => {
    const { creator, balanceAcc } = await fundedCreator(1000n);
    const results = await Promise.allSettled([
      wallet.requestPayout(creator.id, { amount_minor: 600, currency: 'USD' }),
      wallet.requestPayout(creator.id, { amount_minor: 600, currency: 'USD' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ledger.balance(balanceAcc)).toBe(400n);
  });

  it("pays the profile's number, ignoring one in the request", async () => {
    const { creator } = await fundedCreator(1000n, '+263772222222');
    const res = await wallet.requestPayout(creator.id, {
      amount_minor: 500,
      currency: 'USD',
      msisdn: '+263779999999',
    });
    const [row] = await db.select().from(payouts).where(eq(payouts.id, res.payout_id));
    expect(row!.msisdn).toBe('+263772222222');
  });

  it('refuses a payout when no payout number is saved', async () => {
    const { creator } = await fundedCreator(1000n, null);
    await expect(
      wallet.requestPayout(creator.id, { amount_minor: 500, currency: 'USD' }),
    ).rejects.toThrow(/payout number/);
  });

  it('enforces the minimum threshold', async () => {
    const { creator } = await fundedCreator(1000n);
    await expect(
      wallet.requestPayout(creator.id, { amount_minor: 499, currency: 'USD' }),
    ).rejects.toThrow(/Minimum payout/);
  });

  it('refuses ZAR payouts (no rail yet)', async () => {
    const { creator } = await fundedCreator(100_000n);
    await expect(
      wallet.requestPayout(creator.id, { amount_minor: 10_000, currency: 'ZAR' }),
    ).rejects.toThrow(/aren't available/);
  });

  it('completes a payout: balance stays debited, payout marked completed', async () => {
    const { creator, balanceAcc } = await fundedCreator(1000n);
    const { payout_id } = await wallet.requestPayout(creator.id, {
      amount_minor: 600,
      currency: 'USD',
    });
    disburseOutcome = 'completed';
    await wallet.processPayouts(1000);
    const [row] = await db.select().from(payouts).where(eq(payouts.id, payout_id));
    expect(row!.state).toBe('completed');
    expect(await ledger.balance(balanceAcc)).toBe(400n);
  });

  it('a rejected payout restores the creator balance', async () => {
    const { creator, balanceAcc } = await fundedCreator(1000n);
    const { payout_id } = await wallet.requestPayout(creator.id, {
      amount_minor: 600,
      currency: 'USD',
    });
    disburseOutcome = 'failed';
    await wallet.processPayouts(1000);
    const [row] = await db.select().from(payouts).where(eq(payouts.id, payout_id));
    expect(row!.state).toBe('failed');
    expect(await ledger.balance(balanceAcc)).toBe(1000n);
  });
});
