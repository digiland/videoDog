import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtGuard, RequireAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('balance')
  async balance(@Req() req: AuthenticatedRequest) {
    return this.wallet.balance(req.user.id);
  }

  @Get('ledger')
  async ledger(
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.wallet.ledgerHistory(
      req.user.id,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post('payout')
  async payout(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.wallet.requestPayout(req.user.id, body);
  }
}
