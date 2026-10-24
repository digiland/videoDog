import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { WatchService } from './watch.service';
import { z } from 'zod';
import { ValidationError } from '../auth/errors';

const StartSessionSchema = z.object({ video_id: z.string().uuid() });

@Controller('watch')
@UseGuards(JwtGuard)
export class WatchController {
  constructor(private readonly watch: WatchService) {}

  @Get('history')
  @UseGuards(RequireAuthGuard)
  async history(@Req() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    const n = limit ? Number.parseInt(limit, 10) : undefined;
    return this.watch.history(req.user.id, Number.isFinite(n) ? n : undefined);
  }

  @Post('sessions')
  async start(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = StartSessionSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('video_id required');
    const userId = req.user?.id || null;
    return this.watch.startSession(userId, parsed.data.video_id);
  }

  @Post('sessions/:id/heartbeat')
  async heartbeat(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = req.user?.id || null;
    await this.watch.heartbeat(id, userId);
    return { ok: true };
  }

  @Post('sessions/:id/end')
  async end(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = req.user?.id || null;
    await this.watch.endSession(id, userId);
    return { ok: true };
  }
}
