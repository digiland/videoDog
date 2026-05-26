import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import { Roles } from '../auth/roles.guard';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { EarningsService } from './earnings.service';
import { AnalyticsService } from './analytics.service';

@Controller('studio')
@UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
@Roles('creator', 'admin')
export class StudioController {
  constructor(
    private readonly earnings: EarningsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('earnings')
  async getEarnings(@Req() req: AuthenticatedRequest, @Query('month') month?: string) {
    const m = month ?? new Date().toISOString().slice(0, 7);
    return this.earnings.getEarnings(req.user.id, m);
  }

  @Get('videos/:id/analytics')
  async getAnalytics(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    const [minutes, conversion] = await Promise.all([
      this.analytics.watchMinutes(id, fromDate, toDate),
      this.analytics.conversionRate(id, fromDate, toDate),
    ]);

    return {
      video_id: id,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      watch_minutes: minutes.toString(),
      ...conversion,
    };
  }
}
