import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { SubscriptionsService } from './subscriptions.service';
import { isCurrencyCode } from '@streamzw/shared';

@Controller('subscriptions')
@UseGuards(JwtGuard)
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('plans')
  async getPlans(@Query('currency') currency?: string) {
    return this.subs.getPlans(isCurrencyCode(currency) ? currency : 'USD');
  }

  @Post()
  @UseGuards(RequireAuthGuard)
  async checkout(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.subs.checkout(req.user.id, body);
  }

  @Get('me')
  @UseGuards(RequireAuthGuard)
  async current(@Req() req: AuthenticatedRequest) {
    const sub = await this.subs.getCurrent(req.user.id);
    // Same snake_case shape as every other endpoint; empty body when there is none.
    return sub
      ? {
          id: sub.id,
          plan_id: sub.planId,
          state: sub.state,
          charged_amount_minor: sub.chargedAmountMinor,
          charged_currency: sub.chargedCurrency,
          started_at: sub.startedAt,
          expires_at: sub.expiresAt,
          auto_renew: sub.autoRenew,
          cancelled_at: sub.cancelledAt,
        }
      : null;
  }

  @Post('me/cancel')
  @UseGuards(RequireAuthGuard)
  async cancel(@Req() req: AuthenticatedRequest) {
    return this.subs.cancel(req.user.id);
  }
}
