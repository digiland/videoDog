import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { UsersService } from './users.service';
import { z } from 'zod';
import { ValidationError } from '../auth/errors';

const BecomeCreatorSchema = z.object({
  canonical_currency: z.enum(['USD', 'ZWG', 'ZAR', 'EUR', 'GBP']),
});

@Controller('users')
@UseGuards(JwtGuard, RequireAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@Req() req: AuthenticatedRequest) {
    return this.users.findById(req.user.id);
  }

  @Patch('me')
  async update(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.users.update(req.user.id, body);
  }

  @Post('me/become-creator')
  async becomeCreator(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = BecomeCreatorSchema.safeParse(body);
    if (!parsed.success)
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'canonical_currency required');
    return this.users.upgradeToCreator(req.user.id, parsed.data.canonical_currency);
  }
}
