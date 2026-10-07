import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  connect,
  hasDb,
  makeUser,
  makeVideo,
  services,
  sign,
  webhookBody,
} from '../../test/harness';
import { createHmac } from 'crypto';
import { PaymentsService } from './payments.service';
import { accounts, ledgerEntries, payments, purchases } from '../../db/schema';
import type { Db } from '../../db/db.module';
import type { LedgerService } from './ledger.service';

describe.skipIf(!hasDb)('payments (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let ledger: LedgerService;
  let svc: PaymentsService;

  beforeAll(() => {
    ({ db, close } = connect());
    const s = services(db);
    ledger = s.ledger;
    svc = new PaymentsService(db, s.ledger, s.fx);
  });
  afterAll(async () => close());

  async function pendingPurchase(priceMinor = 150) {
    const creator = await makeUser(db, { role: 'creator' });
    const viewer = await makeUser(db);
    const video = await makeVideo(db, creator.id, { ppvPriceMinorUnits: String(priceMinor) });
    const [purchase] = await db
      .insert(purchases)
      .values({
        userId: viewer.id,
        videoId: video.id,
        state: 'pending',
        paidAmountMinor: String(priceMinor),
        paidCurrency: 'USD',
        usdEquivalentMinor: String(priceMinor),
      })
      .returning();
    return { creator, viewer, video, purchase: purchase! };
  }

  async function creatorBalance(creatorId: string): Promise<bigint> {
    const acc = await ledger.findOrCreateAccount({
      scope: 'user',
      ownerId: creatorId,
      code: 'creator_balance',
      currency: 'USD',
    });
    return ledger.balance(acc);
  }

  it('charges the purchase price, ignoring a client-supplied amount', async () => {
    const { viewer, purchase } = await pendingPurchase(150);
    const res = await svc.createIntent(viewer.id, {
      provider: 'ecocash_usd',
      intent: 'purchase',
      intent_ref_id: purchase.id,
      amount_minor: 1,
      currency: 'USD',
      msisdn: viewer.phoneE164,
    });
    const [payment] = await db.select().from(payments).where(eq(payments.id, res.payment_id));
    expect(payment!.amountMinor).toBe('150');
    expect(payment!.currency).toBe('USD');
    expect(payment!.state).toBe('pending');
  });

  it("refuses to pay for someone else's purchase", async () => {
    const { purchase } = await pendingPurchase();
    const stranger = await makeUser(db);
    await expect(
      svc.createIntent(stranger.id, {
        provider: 'ecocash_usd',
        intent: 'purchase',
        intent_ref_id: purchase.id,
        msisdn: stranger.phoneE164,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses a provider that cannot settle the purchase currency', async () => {
    const { viewer, purchase } = await pendingPurchase();
    await expect(
      svc.createIntent(viewer.id, {
        provider: 'ecocash_zwg',
        intent: 'purchase',
        intent_ref_id: purchase.id,
        msisdn: viewer.phoneE164,
      }),
    ).rejects.toThrow(/charges in ZWG/);
  });

  it('rejects a webhook with a bad signature', async () => {
    const { viewer, purchase } = await pendingPurchase();
    const intent = await svc.createIntent(viewer.id, {
      provider: 'ecocash_usd',
      intent: 'purchase',
      intent_ref_id: purchase.id,
      msisdn: viewer.phoneE164,
    });
    const [payment] = await db.select().from(payments).where(eq(payments.id, intent.payment_id));
    const body = webhookBody(payment!.idempotencyKey);
    await expect(svc.handleEcocashWebhook(body, 'deadbeef')).rejects.toThrow(/signature/i);
    await expect(svc.handleEcocashWebhook(body, '')).rejects.toThrow(/signature/i);
  });

  it('settles exactly once under concurrent duplicate webhooks, 70/30, balanced', async () => {
    const { creator, viewer, purchase } = await pendingPurchase(200);
    const intent = await svc.createIntent(viewer.id, {
      provider: 'ecocash_usd',
      intent: 'purchase',
      intent_ref_id: purchase.id,
      msisdn: viewer.phoneE164,
    });
    const [payment] = await db.select().from(payments).where(eq(payments.id, intent.payment_id));
    const body = webhookBody(payment!.idempotencyKey);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => svc.handleEcocashWebhook(body, sign(body))),
    );
    expect(results.filter((r) => !('idempotent' in r)).length).toBe(1);

    expect(await creatorBalance(creator.id)).toBe(140n);

    const [p] = await db.select().from(purchases).where(eq(purchases.id, purchase.id));
    expect(p!.state).toBe('completed');

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.refType, 'purchase'), eq(ledgerEntries.refId, purchase.id)));
    const debit = entries.reduce((a, e) => a + BigInt(e.debitMinor), 0n);
    const credit = entries.reduce((a, e) => a + BigInt(e.creditMinor), 0n);
    expect(debit).toBe(200n);
    expect(credit).toBe(200n);
  });

  it('a failed-then-completed payment still settles', async () => {
    const { creator, viewer, purchase } = await pendingPurchase(100);
    const intent = await svc.createIntent(viewer.id, {
      provider: 'ecocash_usd',
      intent: 'purchase',
      intent_ref_id: purchase.id,
      msisdn: viewer.phoneE164,
    });
    await db.update(payments).set({ state: 'failed' }).where(eq(payments.id, intent.payment_id));
    const [payment] = await db.select().from(payments).where(eq(payments.id, intent.payment_id));
    const body = webhookBody(payment!.idempotencyKey);
    await svc.handleEcocashWebhook(body, sign(body));
    expect(await creatorBalance(creator.id)).toBe(70n);
  });

  it('credits tips to the creator, 90/10', async () => {
    const creator = await makeUser(db, { role: 'creator' });
    const viewer = await makeUser(db);
    const video = await makeVideo(db, creator.id, {
      accessMode: 'free',
      ppvPriceMinorUnits: null,
      ppvPriceCurrency: null,
    });
    const intent = await svc.createIntent(viewer.id, {
      provider: 'ecocash_usd',
      intent: 'tip',
      intent_ref_id: video.id,
      amount_minor: 100,
      currency: 'USD',
      msisdn: viewer.phoneE164,
    });
    const [payment] = await db.select().from(payments).where(eq(payments.id, intent.payment_id));
    const body = webhookBody(payment!.idempotencyKey);
    await svc.handleEcocashWebhook(body, sign(body));
    expect(await creatorBalance(creator.id)).toBe(90n);
  });

  it('keeps every currency balanced across the whole ledger', async () => {
    const rows = await db
      .select({
        currency: ledgerEntries.currency,
        debit: ledgerEntries.debitMinor,
        credit: ledgerEntries.creditMinor,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(inArray(ledgerEntries.currency, ['USD', 'ZWG', 'ZAR']));
    const net = new Map<string, bigint>();
    for (const r of rows) {
      net.set(r.currency, (net.get(r.currency) ?? 0n) + BigInt(r.debit) - BigInt(r.credit));
    }
    for (const [, v] of net) expect(v).toBe(0n);
  });

  describe('paystack', () => {
    const KEY = 'sk_test_paystack_secret_0123456789';
    type Verify = {
      status: 'completed' | 'failed' | 'pending';
      amountMinor: bigint;
      currency: string;
    } | null;
    let paystackSvc: PaymentsService;
    let verifyResult: Verify = null;

    beforeAll(() => {
      process.env.PAYSTACK_SECRET_KEY = KEY;
      const s2 = services(db);
      paystackSvc = new PaymentsService(db, s2.ledger, s2.fx);
      // Never hit Paystack from tests: stub the verify call.
      const client = (
        paystackSvc as unknown as { paystack: { verify: (r: string) => Promise<Verify> } }
      ).paystack;
      client.verify = async () => verifyResult;
      (client as unknown as { createCharge: () => Promise<unknown> }).createCharge = async () => ({
        provider_ref: 'ps-test',
        status: 'pending',
        redirect_url: 'https://checkout.paystack.test/x',
      });
    });
    afterAll(() => {
      delete process.env.PAYSTACK_SECRET_KEY;
    });

    function signed(body: string) {
      return createHmac('sha512', KEY).update(body).digest('hex');
    }

    async function zarPurchase(priceMinor = 2000) {
      const creator = await makeUser(db, { role: 'creator' });
      const viewer = await makeUser(db);
      const video = await makeVideo(db, creator.id, {
        ppvPriceMinorUnits: String(priceMinor),
        ppvPriceCurrency: 'ZAR',
      });
      const [purchase] = await db
        .insert(purchases)
        .values({
          userId: viewer.id,
          videoId: video.id,
          state: 'pending',
          paidAmountMinor: String(priceMinor),
          paidCurrency: 'ZAR',
          usdEquivalentMinor: '108',
        })
        .returning();
      const intent = await paystackSvc.createIntent(viewer.id, {
        provider: 'paystack',
        intent: 'purchase',
        intent_ref_id: purchase!.id,
        msisdn: viewer.phoneE164,
      });
      const [payment] = await db.select().from(payments).where(eq(payments.id, intent.payment_id));
      return { creator, viewer, purchase: purchase!, payment: payment! };
    }

    it('refuses a forged signature', async () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'x', amount: 1, currency: 'ZAR' },
      });
      await expect(paystackSvc.handlePaystackWebhook(body, 'bad')).rejects.toThrow(/signature/);
    });

    it('does not unlock when Paystack charged a different amount', async () => {
      const { purchase, payment } = await zarPurchase(2000);
      verifyResult = { status: 'completed', amountMinor: 1n, currency: 'ZAR' };
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: payment.idempotencyKey, amount: 1, currency: 'ZAR', status: 'success' },
      });
      const res = await paystackSvc.handlePaystackWebhook(body, signed(body));
      expect(res).toMatchObject({ mismatch: true });
      const [p] = await db.select().from(purchases).where(eq(purchases.id, purchase.id));
      expect(p!.state).toBe('pending');
    });

    it('settles a verified ZAR card payment through fx_holding', async () => {
      const { creator, purchase, payment } = await zarPurchase(2000);
      verifyResult = { status: 'completed', amountMinor: 2000n, currency: 'ZAR' };
      const body = JSON.stringify({
        event: 'charge.success',
        data: {
          reference: payment.idempotencyKey,
          amount: 2000,
          currency: 'ZAR',
          status: 'success',
        },
      });
      await paystackSvc.handlePaystackWebhook(body, signed(body));
      const [p] = await db.select().from(purchases).where(eq(purchases.id, purchase.id));
      expect(p!.state).toBe('completed');
      expect(await creatorBalance(creator.id)).toBe(76n); // 70% of 108 USD-cents, platform rounds half up
    });
  });

  it('only shows a payment to its owner', async () => {
    const { viewer, purchase } = await pendingPurchase();
    const intent = await svc.createIntent(viewer.id, {
      provider: 'ecocash_usd',
      intent: 'purchase',
      intent_ref_id: purchase.id,
      msisdn: viewer.phoneE164,
    });
    await expect(svc.getForUser(viewer.id, intent.payment_id)).resolves.toMatchObject({
      state: 'pending',
    });
    const stranger = await makeUser(db);
    await expect(svc.getForUser(stranger.id, intent.payment_id)).rejects.toThrow(/not found/i);
  });

  it('reconciles a lost webhook from the provider status (§3.12)', async () => {
    const { creator, viewer, purchase } = await pendingPurchase(100);
    const intent = await svc.createIntent(viewer.id, {
      provider: 'ecocash_usd',
      intent: 'purchase',
      intent_ref_id: purchase.id,
      msisdn: viewer.phoneE164,
    });
    const [payment] = await db.select().from(payments).where(eq(payments.id, intent.payment_id));
    const rail = (svc as unknown as { ecocashUsd: { getStatus: () => Promise<string | null> } })
      .ecocashUsd;
    const original = rail.getStatus;
    rail.getStatus = async () => 'completed';
    try {
      await svc.reconcile(payment!);
    } finally {
      rail.getStatus = original;
    }
    expect(await creatorBalance(creator.id)).toBe(70n);
  });

  it('dev simulate is off unless explicitly enabled', async () => {
    const { viewer, purchase } = await pendingPurchase();
    const intent = await svc.createIntent(viewer.id, {
      provider: 'ecocash_usd',
      intent: 'purchase',
      intent_ref_id: purchase.id,
      msisdn: viewer.phoneE164,
    });
    delete process.env.DEV_SIMULATE_PAYMENTS;
    await expect(svc.simulate(viewer.id, intent.payment_id, 'completed')).rejects.toThrow();
  });
});
