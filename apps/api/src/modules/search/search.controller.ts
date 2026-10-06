import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { VideosService } from '../videos/videos.service';

/**
 * Postgres full-text search over published videos. Same serialisation as /videos, so no
 * internal fields (storage keys) leak and thumbnails are signed.
 */
@Controller('search')
@UseGuards(JwtGuard)
export class SearchController {
  constructor(private readonly videos: VideosService) {}

  @Get()
  async search(
    @Query('q') q?: string,
    @Query('mode') mode?: string,
    @Query('limit') limit?: string,
  ) {
    const { items } = await this.videos.list({
      q: q?.trim() || undefined,
      mode,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
    return { items, total: items.length };
  }
}
