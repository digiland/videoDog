import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { PaymentsService } from './payments.service';
import { ValidationError } from '../auth/errors';

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
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-ecocash-signature') sig: string | undefined,
  ) {
    // HMAC must be checked over the exact bytes received; a re-serialised body won't match.
    if (!req.rawBody) throw new ValidationError('Missing webhook body');
    return this.payments.handleEcocashWebhook(req.rawBody.toString('utf8'), sig ?? '');
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
