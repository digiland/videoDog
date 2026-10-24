import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import { Roles } from '../auth/roles.guard';
import { RolesGuard } from '../auth/roles.guard';
import { FxService } from './fx.service';
import { z } from 'zod';
import { ValidationError } from '../auth/errors';
import { CURRENCY_CODES } from '@streamzw/shared';

const OverrideSchema = z.object({
  base: z.enum(CURRENCY_CODES),
  quote: z.enum(CURRENCY_CODES),
  rate: z.string().regex(/^\d+\.?\d*$/, 'rate must be a numeric string'),
  effective_until: z.string().datetime().optional(),
  notes: z.string().optional(),
});

@Controller()
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('fx/rates')
  async getRates(@Query('base') base?: string, @Query('quote') quote?: string) {
    const b = z.enum(CURRENCY_CODES).safeParse(base ?? 'USD');
    const q = z.enum(CURRENCY_CODES).safeParse(quote ?? 'ZWG');
    if (!b.success || !q.success)
      throw new ValidationError('base and quote must be currency codes');
    const rate = await this.fx.rate(b.data, q.data);
    // The stored row may be the reverse pair; report what the rate actually means.
    return { base: rate.base, quote: rate.quote, rate: rate.rate, source: rate.source };
  }

  @Post('admin/fx/override')
  @UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
  @Roles('admin')
  async override(@Body() body: unknown) {
    const parsed = OverrideSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    const dto = parsed.data;

    // Close existing manual rates for this pair
    await this.fx.closeCurrentRates(dto.base, dto.quote, 'manual');

    const inserted = await this.fx.insertRate({
      base: dto.base,
      quote: dto.quote,
      rate: dto.rate,
      source: 'manual',
      sourcePriority: 100,
      notes: dto.notes,
    });

    return inserted;
  }
}
