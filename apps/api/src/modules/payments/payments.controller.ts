import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { PaymentsService } from './payments.service';
import { ValidationError } from '../auth/errors';

const SimulateSchema = z.object({ status: z.enum(['completed', 'failed']) });

/** HMACs must be checked over the exact bytes received; a re-serialised body won't match. */
function rawBodyOf(req: RawBodyRequest<Request>): string {
  if (!req.rawBody) throw new ValidationError('Missing webhook body');
  return req.rawBody.toString('utf8');
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments')
  @UseGuards(JwtGuard, RequireAuthGuard)
  async createPayment(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.payments.createIntent(req.user.id, body);
  }

  @Get('payments/:id')
  @UseGuards(JwtGuard, RequireAuthGuard)
  async getPayment(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.getForUser(req.user.id, id);
  }

  /** Dev only (404 in production): settle your own payment without a provider. */
  @Post('dev/payments/:id/simulate')
  @UseGuards(JwtGuard, RequireAuthGuard)
  async simulate(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = SimulateSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('status must be completed or failed');
    return this.payments.simulate(req.user.id, id, parsed.data.status);
  }

  @Post('webhooks/ecocash')
  async ecocashWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-ecocash-signature') sig: string | undefined,
  ) {
    return this.payments.handleEcocashWebhook(rawBodyOf(req), sig ?? '');
  }

  @Post('webhooks/paystack')
  async paystackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') sig: string | undefined,
  ) {
    return this.payments.handlePaystackWebhook(rawBodyOf(req), sig ?? '');
  }

  // ZIPIT has no public merchant API: it needs a bank or aggregator integration, so there is
  // no webhook until that partner's spec exists. POST /payments refuses provider 'zipit'.
}
