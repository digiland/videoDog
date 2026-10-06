import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { users } from '../../db/schema';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { z } from 'zod';
import { CURRENCY_CODES, isCurrencyCode } from '@streamzw/shared';
import { nationalIds } from '../../db/schema';
import { OtpService } from '../auth/otp.service';
import { NationalIdCrypto, normaliseZimNationalId } from './national-id.crypto';

const PHONE_E164 = /^\+[1-9]\d{1,14}$/;

const UpdateUserSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  preferred_display_currency: z.enum(CURRENCY_CODES).optional(),
  preferred_payout_currency: z.enum(CURRENCY_CODES).optional(),
});

const SetPayoutMsisdnSchema = z.object({
  msisdn: z.string().regex(PHONE_E164, 'msisdn must be E.164, e.g. +263771234567'),
  otp_code: z.string().regex(/^\d{6}$/, 'otp_code must be the 6-digit code'),
});

const NationalIdSchema = z.object({ national_id: z.string().min(8).max(32) });

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

type UserRow = typeof users.$inferSelect;

function serializeUser(u: UserRow) {
  return {
    id: u.id,
    phone_e164: u.phoneE164,
    handle: u.handle,
    display_name: u.displayName,
    role: u.role,
    kyc_state: u.kycState,
    preferred_display_currency: u.preferredDisplayCurrency,
    preferred_payout_currency: u.preferredPayoutCurrency,
    canonical_pricing_currency: u.canonicalPricingCurrency,
    payout_msisdn: u.payoutMsisdn,
    creator_application_state: u.creatorApplicationState,
    creator_application_pitch: u.creatorApplicationPitch,
    creator_application_at: u.creatorApplicationAt,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
  };
}

@Injectable()
export class UsersService {
  private readonly idCrypto = NationalIdCrypto.fromEnv();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly otp: OtpService,
  ) {
    if (process.env.NODE_ENV === 'production' && !this.idCrypto) {
      throw new Error('KYC_ENCRYPTION_KEY must be set in production');
    }
  }

  async findById(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new ResourceNotFoundError('User');
    return serializeUser(user);
  }

  async findByPhone(phone: string) {
    const [user] = await this.db.select().from(users).where(eq(users.phoneE164, phone)).limit(1);
    return user ?? null;
  }

  async upsertByPhone(phone: string) {
    let [user] = await this.db.select().from(users).where(eq(users.phoneE164, phone)).limit(1);
    if (!user) {
      [user] = await this.db
        .insert(users)
        .values({ phoneE164: phone, kycState: 'phone_verified' })
        .returning();
    }
    return user!;
  }

  async update(id: string, body: unknown) {
    if (body && typeof body === 'object' && 'payout_msisdn' in body) {
      throw new ValidationError('Change the payout number with POST /users/me/payout-msisdn');
    }
    const parsed = UpdateUserSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');

    const dto = parsed.data;
    const [updated] = await this.db
      .update(users)
      .set({
        ...(dto.display_name !== undefined && { displayName: dto.display_name }),
        ...(dto.preferred_display_currency !== undefined && {
          preferredDisplayCurrency: dto.preferred_display_currency,
        }),
        ...(dto.preferred_payout_currency !== undefined && {
          preferredPayoutCurrency: dto.preferred_payout_currency,
        }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    if (!updated) throw new ResourceNotFoundError('User');
    return serializeUser(updated);
  }

  /**
   * Set where payouts go. Requires a fresh OTP sent to the account's own phone (request one
   * with POST /auth/otp/request), so a stolen session alone can't redirect a creator's money.
   */
  async setPayoutMsisdn(id: string, body: unknown) {
    const parsed = SetPayoutMsisdnSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new ResourceNotFoundError('User');

    await this.otp.verify(user.phoneE164, parsed.data.otp_code);

    const [updated] = await this.db
      .update(users)
      .set({ payoutMsisdn: parsed.data.msisdn, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return serializeUser(updated!);
  }

  /** Store a national ID, encrypted, in its own table (§3.15). An admin verifies it. */
  async submitNationalId(id: string, body: unknown) {
    if (!this.idCrypto) throw new ValidationError('ID verification is not configured');
    const parsed = NationalIdSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('national_id required');
    const normalised = normaliseZimNationalId(parsed.data.national_id);
    if (!normalised) throw new ValidationError('That does not look like a Zimbabwe national ID');

    const lookupHash = this.idCrypto.lookupHash(normalised);
    const [taken] = await this.db
      .select({ userId: nationalIds.userId })
      .from(nationalIds)
      .where(eq(nationalIds.lookupHash, lookupHash))
      .limit(1);
    if (taken && taken.userId !== id) {
      throw new ValidationError('This ID is already linked to another account');
    }

    const enc = this.idCrypto.encrypt(normalised, id);
    const now = new Date();
    await this.db
      .insert(nationalIds)
      .values({ userId: id, ...enc, lookupHash })
      .onConflictDoUpdate({
        target: nationalIds.userId,
        // A resubmission replaces the number and clears any earlier verification.
        set: { ...enc, lookupHash, verifiedAt: null, verifiedBy: null, updatedAt: now },
      });
    return { status: 'submitted' };
  }

  /** Admin: mark a submitted ID as checked, which moves the user to `id_verified`. */
  async verifyNationalId(userId: string, adminId: string) {
    const [row] = await this.db
      .update(nationalIds)
      .set({ verifiedAt: new Date(), verifiedBy: adminId, updatedAt: new Date() })
      .where(eq(nationalIds.userId, userId))
      .returning({ id: nationalIds.id });
    if (!row) throw new ResourceNotFoundError('National ID submission');
    await this.db
      .update(users)
      .set({ kycState: 'id_verified', updatedAt: new Date() })
      .where(eq(users.id, userId));
    return { status: 'id_verified' };
  }

  async applyForCreator(id: string, pitch: string, canonicalCurrency: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new ResourceNotFoundError('User');
    if (user.role !== 'viewer')
      throw new ValidationError('Only viewers can apply to become creators');
    if (user.creatorApplicationState === 'pending')
      throw new ValidationError('Application already pending review');
    if (!isCurrencyCode(canonicalCurrency)) throw new ValidationError('Invalid canonical currency');

    const [updated] = await this.db
      .update(users)
      .set({
        creatorApplicationState: 'pending',
        creatorApplicationPitch: pitch.trim(),
        creatorApplicationAt: new Date(),
        canonicalPricingCurrency: canonicalCurrency,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated!;
  }

  async listPendingApplications() {
    return this.db
      .select({
        id: users.id,
        phoneE164: users.phoneE164,
        handle: users.handle,
        displayName: users.displayName,
        creatorApplicationPitch: users.creatorApplicationPitch,
        creatorApplicationAt: users.creatorApplicationAt,
        canonicalPricingCurrency: users.canonicalPricingCurrency,
      })
      .from(users)
      .where(eq(users.creatorApplicationState, 'pending'))
      .orderBy(users.creatorApplicationAt);
  }

  async decideApplication(applicantId: string, adminId: string, decision: 'approve' | 'reject') {
    const [user] = await this.db.select().from(users).where(eq(users.id, applicantId)).limit(1);
    if (!user) throw new ResourceNotFoundError('User');
    if (user.creatorApplicationState !== 'pending')
      throw new ValidationError('No pending application for this user');

    const [updated] = await this.db
      .update(users)
      .set({
        creatorApplicationState: decision === 'approve' ? 'approved' : 'rejected',
        creatorApplicationDecidedAt: new Date(),
        creatorApplicationDecidedBy: adminId,
        ...(decision === 'approve' && { role: 'creator' }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, applicantId))
      .returning();
    return updated!;
  }

  async upgradeToCreator(id: string, canonicalCurrency: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new ResourceNotFoundError('User');
    if (user.kycState === 'none')
      throw new ValidationError('Phone verification required before becoming a creator');
    if (!isCurrencyCode(canonicalCurrency)) throw new ValidationError('Invalid canonical currency');
    if (user.role === 'creator') return user; // idempotent

    const [updated] = await this.db
      .update(users)
      .set({
        role: 'creator',
        canonicalPricingCurrency: canonicalCurrency,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated!;
  }
}
