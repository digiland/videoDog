import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { VideosService, type Viewer } from './videos.service';
import { z } from 'zod';
import { ValidationError } from '../auth/errors';

/** JwtGuard attaches `{ id: '' }` for anonymous requests. */
function viewerOf(req: AuthenticatedRequest): Viewer {
  return req.user?.id ? { id: req.user.id, role: req.user.role } : null;
}

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

  @Post(':id/upload/multipart')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async startMultipart(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.videos.startMultipartUpload(id, req.user.id, body);
  }

  @Get(':id/upload/multipart/:uploadId')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async multipartStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('uploadId') uploadId: string,
    @Query('part_count') partCount: string,
  ) {
    const n = Number.parseInt(partCount ?? '', 10);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) {
      throw new ValidationError('part_count must be 1–10000');
    }
    return this.videos.multipartStatus(id, req.user.id, uploadId, n);
  }

  @Post(':id/upload/multipart/:uploadId/complete')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async completeMultipart(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.videos.completeMultipartUpload(id, req.user.id, uploadId);
  }

  @Post(':id/upload/multipart/:uploadId/abort')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async abortMultipart(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.videos.abortMultipartUpload(id, req.user.id, uploadId);
  }

  @Post(':id/complete-upload')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async completeUpload(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.videos.completeUpload(id, req.user.id);
  }

  @Post(':id/unpublish')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async unpublish(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.videos.unpublish(id, req.user.id);
  }

  @Delete(':id')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.videos.deleteDraft(id, req.user.id);
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
    @Req() req: AuthenticatedRequest,
    @Query('mode') mode?: string,
    @Query('creator') creatorId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (creatorId === 'me') {
      if (!req.user?.id) throw new ValidationError('Authentication required for creator=me');
      creatorId = req.user.id;
    }
    return this.videos.list({
      mode,
      creatorId,
      q,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
      includeUnpublished: creatorId === req.user?.id,
    });
  }

  @Get(':id')
  async findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.videos.findById(id, viewerOf(req));
  }

  @Get(':id/playlist')
  async playlist(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const apiBase = process.env.PUBLIC_API_BASE ?? `${req.protocol}://${req.get('host')}`;
    return this.videos.getSignedPlaylistUrl(id, viewerOf(req), apiBase);
  }

  @Get(':id/captions')
  async listCaptions(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.videos.getVisible(id, viewerOf(req));
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

  @Post(':id/thumbnail')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async getThumbnailUploadUrl(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.videos.getThumbnailUploadUrl(id, req.user.id);
  }

  @Post(':id/thumbnail/complete')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async completeThumbnailUpload(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = z.object({ key: z.string().min(1) }).safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    return this.videos.completeThumbnailUpload(id, req.user.id, parsed.data.key);
  }
}

@Controller('purchases')
@UseGuards(JwtGuard, RequireAuthGuard)
export class PurchasesController {
  constructor(private readonly videos: VideosService) {}

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.videos.createPurchase(req.user.id, body);
  }
}
