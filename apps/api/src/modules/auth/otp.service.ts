import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
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

  async verify(phone: string, code: string): Promise<void> {
    const now = new Date();
    // Find most recent unconsumed challenge for this phone
    const [challenge] = await this.db
      .select()
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
    if (challenge.attempts >= MAX_ATTEMPTS) throw new OtpLockedError();

    // Increment attempts first
    await this.db
      .update(otpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(otpChallenges.id, challenge.id));

    const valid = await bcrypt.compare(code, challenge.codeHash);
    if (!valid) {
      if (challenge.attempts + 1 >= MAX_ATTEMPTS) throw new OtpLockedError();
      throw new OtpInvalidError();
    }

    // Mark consumed
    await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(eq(otpChallenges.id, challenge.id));
  }
}
