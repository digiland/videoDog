import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { UsersService } from './users.service';
import { z } from 'zod';
import { CURRENCY_CODES } from '@streamzw/shared';
import { ValidationError } from '../auth/errors';

const BecomeCreatorSchema = z.object({
  canonical_currency: z.enum(CURRENCY_CODES),
});

const ApplyCreatorSchema = z.object({
  pitch: z.string().min(20, 'Pitch must be at least 20 characters').max(800),
  canonical_currency: z.enum(CURRENCY_CODES),
});

@Controller()
@UseGuards(JwtGuard, RequireAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users/me')
  async me(@Req() req: AuthenticatedRequest) {
    return this.users.findById(req.user.id);
  }

  @Patch('users/me')
  async update(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.users.update(req.user.id, body);
  }

  @Post('users/me/payout-msisdn')
  async setPayoutMsisdn(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.users.setPayoutMsisdn(req.user.id, body);
  }

  @Post('users/me/kyc/id')
  async submitNationalId(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.users.submitNationalId(req.user.id, body);
  }

  @Post('admin/users/:id/kyc/verify')
  async verifyNationalId(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    if (req.user.role !== 'admin') throw new ForbiddenException();
    return this.users.verifyNationalId(id, req.user.id);
  }

  @Post('users/me/apply-creator')
  async applyCreator(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = ApplyCreatorSchema.safeParse(body);
    if (!parsed.success)
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid application');
    return this.users.applyForCreator(
      req.user.id,
      parsed.data.pitch,
      parsed.data.canonical_currency,
    );
  }

  @Post('users/me/become-creator')
  async becomeCreator(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = BecomeCreatorSchema.safeParse(body);
    if (!parsed.success)
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'canonical_currency required');
    return this.users.upgradeToCreator(req.user.id, parsed.data.canonical_currency);
  }

  @Get('admin/creator-applications')
  async listApplications(@Req() req: AuthenticatedRequest) {
    if (req.user.role !== 'admin') throw new ForbiddenException();
    return { items: await this.users.listPendingApplications() };
  }

  @Post('admin/creator-applications/:id/approve')
  async approveApplication(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    if (req.user.role !== 'admin') throw new ForbiddenException();
    return this.users.decideApplication(id, req.user.id, 'approve');
  }

  @Post('admin/creator-applications/:id/reject')
  async rejectApplication(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    if (req.user.role !== 'admin') throw new ForbiddenException();
    return this.users.decideApplication(id, req.user.id, 'reject');
  }
}
