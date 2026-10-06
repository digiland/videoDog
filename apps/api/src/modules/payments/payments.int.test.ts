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
});
