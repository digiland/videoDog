import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { connect, hasDb, makeUser } from '../../test/harness';
import { UsersService } from './users.service';
import { OtpService } from '../auth/otp.service';
import { nationalIds, otpChallenges, users } from '../../db/schema';
import type { Db } from '../../db/db.module';
import type { WhatsAppClient } from '../notifications/whatsapp.client';
import type { SmsClient } from '../notifications/sms.client';

describe.skipIf(!hasDb)('users: payout number, KYC, OTP (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let otp: OtpService;
  let usersSvc: UsersService;

  beforeAll(() => {
    process.env.KYC_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    ({ db, close } = connect());
    otp = new OtpService(db, {} as WhatsAppClient, {} as SmsClient);
    usersSvc = new UsersService(db, otp);
  });
  afterAll(async () => close());

  /** Plant a known OTP challenge for `phone`. */
  async function plantOtp(phone: string, code = '123456') {
    await db.insert(otpChallenges).values({
      phoneE164: phone,
      codeHash: await bcrypt.hash(code, 4),
      channel: 'whatsapp',
      expiresAt: new Date(Date.now() + 600_000),
    });
  }

  it('locks after 5 attempts even when guesses arrive in parallel', async () => {
    const user = await makeUser(db);
    await plantOtp(user.phoneE164, '123456');
    const guesses = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => otp.verify(user.phoneE164, String(100000 + i))),
    );
    expect(guesses.every((g) => g.status === 'rejected')).toBe(true);
    const [c] = await db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.phoneE164, user.phoneE164));
    expect(c!.attempts).toBe(5);
    // The right code no longer works once locked.
    await expect(otp.verify(user.phoneE164, '123456')).rejects.toThrow();
  });

  it('changes the payout number only with a valid OTP, and not via PATCH', async () => {
    const user = await makeUser(db);
    await expect(usersSvc.update(user.id, { payout_msisdn: '+263771234567' })).rejects.toThrow(
      /payout-msisdn/,
    );
    await plantOtp(user.phoneE164, '654321');
    await expect(
      usersSvc.setPayoutMsisdn(user.id, { msisdn: '+263771234567', otp_code: '000000' }),
    ).rejects.toThrow();
    // the wrong guess used an attempt; the right code still works (under the limit)
    const out = await usersSvc.setPayoutMsisdn(user.id, {
      msisdn: '+263771234567',
      otp_code: '654321',
    });
    expect(out.payout_msisdn).toBe('+263771234567');
    // the code is single-use
    await expect(
      usersSvc.setPayoutMsisdn(user.id, { msisdn: '+263779999999', otp_code: '654321' }),
    ).rejects.toThrow();
  });

  it('stores national IDs encrypted, once per person, and admin-verifies them', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const admin = await makeUser(db, { role: 'admin' });
    const id = `63-${String(Date.now()).slice(-7)} F 42`;

    await expect(usersSvc.submitNationalId(a.id, { national_id: 'not an id!' })).rejects.toThrow();
    await usersSvc.submitNationalId(a.id, { national_id: id });

    const [row] = await db.select().from(nationalIds).where(eq(nationalIds.userId, a.id));
    expect(row!.ciphertext.toString('utf8')).not.toContain(id.replace(/[\s-]/g, ''));

    await expect(
      usersSvc.submitNationalId(b.id, { national_id: id.toLowerCase() }),
    ).rejects.toThrow(/another account/);

    await usersSvc.verifyNationalId(a.id, admin.id);
    const [u] = await db.select().from(users).where(eq(users.id, a.id));
    expect(u!.kycState).toBe('id_verified');
  });
});
