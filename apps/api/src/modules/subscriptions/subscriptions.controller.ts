import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { SubscriptionsService } from './subscriptions.service';
import type { CurrencyCode } from '@streamzw/shared';

@Controller('subscriptions')
@UseGuards(JwtGuard)
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('plans')
  async getPlans(@Query('currency') currency?: string) {
    const displayCurrency = (currency as CurrencyCode | undefined) ?? 'USD';
    return this.subs.getPlans(displayCurrency);
  }

  @Post()
  @UseGuards(RequireAuthGuard)
  async checkout(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.subs.checkout(req.user.id, body);
  }

  @Get('me')
  @UseGuards(RequireAuthGuard)
  async current(@Req() req: AuthenticatedRequest) {
    return this.subs.getCurrent(req.user.id);
  }

  @Post('me/cancel')
  @UseGuards(RequireAuthGuard)
  async cancel(@Req() req: AuthenticatedRequest) {
    return this.subs.cancel(req.user.id);
  }
}
