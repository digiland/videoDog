import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import { Roles } from '../auth/roles.guard';
import { RolesGuard } from '../auth/roles.guard';
import { DB, type Db } from '../../db/db.module';
import { Inject } from '@nestjs/common';
import { purchases, subscriptions } from '../../db/schema';
import { z } from 'zod';
import { ValidationError } from '../auth/errors';

const GrantPurchaseSchema = z.object({
  user_id: z.string().uuid(),
  video_id: z.string().uuid(),
});

const GrantSubSchema = z.object({
  user_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  days: z.number().int().min(1).max(366).default(30),
});

@Controller('admin')
@UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
@Roles('admin')
export class AdminGrantsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post('purchases/grant')
  async grantPurchase(@Body() body: unknown) {
    const parsed = GrantPurchaseSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    const [purchase] = await this.db
      .insert(purchases)
      .values({
        userId: dto.user_id,
        videoId: dto.video_id,
        state: 'completed',
        paidAmountMinor: '0',
        paidCurrency: 'USD',
        usdEquivalentMinor: '0',
        completedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    return purchase ?? { message: 'Already granted' };
  }

  @Post('subs/grant')
  async grantSubscription(@Body() body: unknown) {
    const parsed = GrantSubSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + dto.days * 24 * 60 * 60 * 1000);

    const [sub] = await this.db
      .insert(subscriptions)
      .values({
        userId: dto.user_id,
        planId: dto.plan_id,
        state: 'active',
        chargedAmountMinor: '0',
        chargedCurrency: 'USD',
        usdEquivalentMinor: '0',
        startedAt: now,
        expiresAt,
        autoRenew: false,
      })
      .returning();

    return sub!;
  }
}
