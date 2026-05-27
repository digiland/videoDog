import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import { Roles } from '../auth/roles.guard';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { VideosService } from './videos.service';
import { z } from 'zod';
import { ValidationError } from '../auth/errors';

const CompleteUploadSchema = z.object({
  upload_id: z.string(),
  parts: z.array(z.object({ ETag: z.string(), PartNumber: z.number().int() })).default([]),
});

@Controller('videos')
@UseGuards(JwtGuard)
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post()
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.videos.createUploadSession(req.user.id, body);
  }

  @Post(':id/complete-upload')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async completeUpload(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = CompleteUploadSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    return this.videos.completeUpload(id, req.user.id, parsed.data.upload_id, parsed.data.parts);
  }

  @Patch(':id')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.videos.update(id, req.user.id, body);
  }

  @Post(':id/publish')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async publish(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.videos.publish(id, req.user.id);
  }

  @Get()
  async list(
    @Query('mode') mode?: string,
    @Query('creator') creatorId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.videos.list({
      mode,
      creatorId,
      q,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get(':id')
  async findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.videos.findById(id, req.user?.id || undefined);
  }

  @Get(':id/playlist')
  async playlist(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const user = req.user?.id ? { id: req.user.id, preferredDisplayCurrency: 'USD' } : null;
    return this.videos.getSignedPlaylistUrl(id, user);
  }

  @Get(':id/captions')
  async listCaptions(@Param('id') id: string) {
    return { items: await this.videos.listCaptions(id) };
  }

  @Post(':id/captions')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async createCaption(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({
        language: z.string().min(2).max(10),
        label: z.string().min(1).max(60),
        kind: z.enum(['subtitles', 'captions']).optional(),
        is_default: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    return this.videos.createCaption(id, req.user.id, parsed.data);
  }

  @Post(':id/captions/:captionId/complete')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async completeCaption(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('captionId') captionId: string,
  ) {
    return this.videos.completeCaption(id, req.user.id, captionId);
  }

  @Delete(':id/captions/:captionId')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async deleteCaption(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('captionId') captionId: string,
  ) {
    return this.videos.deleteCaption(id, req.user.id, captionId);
  }
}
