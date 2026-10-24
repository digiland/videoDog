import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthenticatedRequest } from '../auth/jwt.guard';
import { RequireAuthGuard } from '../auth/require-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CollectionsService } from './collections.service';

/** JwtGuard attaches `{ id: '' }` for anonymous requests. */
function viewerOf(req: AuthenticatedRequest) {
  return req.user?.id ? { id: req.user.id, role: req.user.role } : null;
}

@Controller('collections')
@UseGuards(JwtGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  /** Public list; `?creator=me` lists the caller's own, drafts included. */
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query() query: Record<string, string>) {
    if (query.creator === 'me') {
      if (!req.user?.id) return { items: [], next_cursor: null };
      return this.collections.listMine(req.user.id);
    }
    return this.collections.listPublic(query);
  }

  @Get(':id')
  async findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.getById(id, viewerOf(req));
  }

  @Post()
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.collections.create(req.user.id, body);
  }

  @Patch(':id')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.collections.update(id, req.user.id, body);
  }

  @Delete(':id')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.remove(id, req.user.id);
  }

  @Post(':id/publish')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async publish(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.publish(id, req.user.id);
  }

  @Post(':id/unpublish')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async unpublish(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.unpublish(id, req.user.id);
  }

  @Post(':id/sections')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async addSection(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.collections.addSection(id, req.user.id, body);
  }

  @Patch(':id/sections/:sectionId')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async renameSection(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() body: unknown,
  ) {
    return this.collections.renameSection(id, sectionId, req.user.id, body);
  }

  @Delete(':id/sections/:sectionId')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async deleteSection(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ) {
    return this.collections.deleteSection(id, sectionId, req.user.id);
  }

  @Post(':id/items')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async addItem(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.collections.addItem(id, req.user.id, body);
  }

  @Delete(':id/items/:itemId')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async removeItem(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.collections.removeItem(id, itemId, req.user.id);
  }

  @Put(':id/layout')
  @UseGuards(RequireAuthGuard, RolesGuard)
  @Roles('creator', 'admin')
  async setLayout(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.collections.setLayout(id, req.user.id, body);
  }
}
