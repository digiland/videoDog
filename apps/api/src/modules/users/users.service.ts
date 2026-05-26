import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { users } from '../../db/schema';
import { ResourceNotFoundError, ValidationError } from '../auth/errors';
import { z } from 'zod';

const PHONE_E164 = /^\+[1-9]\d{1,14}$/;
const CURRENCY_CODES = ['USD', 'ZWG', 'ZAR', 'EUR', 'GBP'] as const;

const UpdateUserSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  preferred_display_currency: z.enum(CURRENCY_CODES).optional(),
  preferred_payout_currency: z.enum(CURRENCY_CODES).optional(),
  payout_msisdn: z.string().regex(PHONE_E164, 'payout_msisdn must be E.164').optional().nullable(),
});

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findById(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new ResourceNotFoundError('User');
    return user;
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
        ...(dto.payout_msisdn !== undefined && { payoutMsisdn: dto.payout_msisdn }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    if (!updated) throw new ResourceNotFoundError('User');
    return updated;
  }

  async upgradeToCreator(id: string, canonicalCurrency: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new ResourceNotFoundError('User');
    if (user.kycState === 'none')
      throw new ValidationError('Phone verification required before becoming a creator');
    if (!CURRENCY_CODES.includes(canonicalCurrency as (typeof CURRENCY_CODES)[number]))
      throw new ValidationError('Invalid canonical currency');
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
