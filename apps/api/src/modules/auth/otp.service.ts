import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { otpChallenges } from '../../db/schema';
import { WhatsAppClient } from '../notifications/whatsapp.client';
import { SmsClient } from '../notifications/sms.client';
import { OtpExpiredError, OtpInvalidError, OtpLockedError } from './errors';

const MAX_ATTEMPTS = 5;
const OTP_TTL_MINUTES = 10;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly whatsApp: WhatsAppClient,
    private readonly sms: SmsClient,
  ) {}

  async request(phone: string): Promise<void> {
    const code = String(randomInt(100000, 999999));
    const hash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.db.insert(otpChallenges).values({
      phoneE164: phone,
      codeHash: hash,
      channel: 'whatsapp',
      expiresAt,
    });

    // Try WhatsApp first, fall back to SMS
    try {
      await this.whatsApp.sendOtp(phone, code);
    } catch (err) {
      this.logger.warn({ phone, err }, 'WhatsApp failed, falling back to SMS');
      await this.sms.sendOtp(phone, code);
    }
  }

  /**
   * Check a code. The attempt is counted with one conditional UPDATE before comparing, so
   * parallel guesses can't share an attempt and the 5-try lock can't be raced past.
   */
  async verify(phone: string, code: string): Promise<void> {
    const now = new Date();
    const [challenge] = await this.db
      .select({ id: otpChallenges.id })
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.phoneE164, phone),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (!challenge) throw new OtpExpiredError();

    const [claimed] = await this.db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(
        and(
          eq(otpChallenges.id, challenge.id),
          lt(otpChallenges.attempts, MAX_ATTEMPTS),
          isNull(otpChallenges.consumedAt),
        ),
      )
      .returning({ attempts: otpChallenges.attempts, codeHash: otpChallenges.codeHash });
    if (!claimed) throw new OtpLockedError();

    const valid = await bcrypt.compare(code, claimed.codeHash);
    if (!valid) {
      if (claimed.attempts >= MAX_ATTEMPTS) throw new OtpLockedError();
      throw new OtpInvalidError();
    }

    // Consume once: a second concurrent correct guess finds it already consumed.
    const [consumed] = await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    if (!consumed) throw new OtpExpiredError();
  }
}
