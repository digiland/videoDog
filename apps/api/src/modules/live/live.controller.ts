import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { LiveIngestGuard } from './ingest.guard';
import { LiveService } from './live.service';

@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  /** Public: `?state=live` (default) or `?state=upcoming`. */
  @Get()
  async list(@Query('state') state?: string) {
    return this.live.listPublic(state === 'upcoming' ? 'upcoming' : 'live');
  }

  // ─── Creator ─────────────────────────────────────────────────────────────

  @Get('streams/mine')
  @UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async mine(@Req() req: AuthenticatedRequest) {
    return this.live.listMine(req.user.id);
  }

  @Get('streams/:id')
  @UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async one(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.live.getMine(id, req.user.id);
  }

  @Post('streams')
  @UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.live.create(req.user.id, body);
  }

  @Patch('streams/:id')
  @UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.live.update(id, req.user.id, body);
  }

  @Post('streams/:id/key')
  @UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async resetKey(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.live.resetKey(id, req.user.id);
  }

  @Post('streams/:id/cancel')
  @UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.live.cancel(id, req.user.id);
  }

  @Post('streams/:id/end')
  @UseGuards(JwtGuard, RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async end(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.live.end(id, req.user.id);
  }

  // ─── Live server hooks (shared secret) ───────────────────────────────────

  /** MediaMTX authHTTPAddress: 200 allows, 401 refuses. */
  @Post('ingest/auth')
  @HttpCode(200)
  @UseGuards(LiveIngestGuard)
  async auth(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const ok = await this.live.authorizeIngest(body).catch(() => false);
    if (!ok) res.status(401);
    return { ok };
  }

  @Get('ingest/streams/:id')
  @UseGuards(LiveIngestGuard)
  async status(@Param('id', ParseUUIDPipe) id: string) {
    return this.live.workerStatus(id);
  }

  @Post('ingest/streams/:id/events')
  @HttpCode(200)
  @UseGuards(LiveIngestGuard)
  async event(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.live.ingestEvent(id, body);
  }

  @Post('ingest/streams/:id/recording/claim')
  @HttpCode(200)
  @UseGuards(LiveIngestGuard)
  async claim(@Param('id', ParseUUIDPipe) id: string) {
    return this.live.claimRecording(id);
  }

  @Post('ingest/streams/:id/recording')
  @HttpCode(200)
  @UseGuards(LiveIngestGuard)
  async recording(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.live.recordingResult(id, body);
  }
}
