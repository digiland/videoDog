import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments')
  @UseGuards(JwtGuard, RequireAuthGuard)
  async createPayment(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.payments.createIntent(req.user.id, body);
  }

  @Post('webhooks/ecocash')
  async ecocashWebhook(
    @Req() req: Request,
    @Headers('x-ecocash-signature') sig: string,
    @Body() body: unknown,
  ) {
    const payload = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(body);
    const currency = (body as { currency?: string })?.currency ?? 'USD';
    const provider = currency === 'ZWG' ? 'ecocash_zwg' : 'ecocash_usd';
    return this.payments.handleEcocashWebhook(payload, sig ?? '', provider);
  }

  @Post('webhooks/zipit')
  async zipitWebhook() {
    // ZIPIT stub — full impl in M7+
    return { ok: true, msg: 'ZIPIT webhook received' };
  }

  @Post('webhooks/paystack')
  async paystackWebhook() {
    // Paystack stub — full impl in later milestone
    return { ok: true, msg: 'Paystack webhook received' };
  }
}
