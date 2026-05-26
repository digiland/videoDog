import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { DB, type Db } from '../../db/db.module';
import { sql } from 'drizzle-orm';
import { videos } from '../../db/schema';
import { and, eq } from 'drizzle-orm';

@Controller('search')
@UseGuards(JwtGuard)
export class SearchController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async search(
    @Query('q') q?: string,
    @Query('mode') mode?: string,
    @Query('limit') limit?: string,
  ) {
    const maxLimit = Math.min(parseInt(limit ?? '20', 10), 100);

    if (!q || q.trim().length === 0) {
      // Return recent published videos
      const conditions = [eq(videos.state, 'published')];
      if (mode) {
        conditions.push(
          eq(videos.accessMode, mode as 'free' | 'ppv' | 'premium' | 'premium_buyable'),
        );
      }
      const rows = await this.db
        .select()
        .from(videos)
        .where(and(...conditions))
        .limit(maxLimit);
      return { results: rows, total: rows.length };
    }

    // Full-text search via Postgres tsvector
    const conditions = [
      eq(videos.state, 'published'),
      sql`${videos}.search_doc @@ plainto_tsquery('english', ${q})`,
    ];
    if (mode) {
      conditions.push(
        eq(videos.accessMode, mode as 'free' | 'ppv' | 'premium' | 'premium_buyable'),
      );
    }

    const rows = await this.db
      .select()
      .from(videos)
      .where(and(...conditions))
      .orderBy(sql`ts_rank(${videos}.search_doc, plainto_tsquery('english', ${q})) DESC`)
      .limit(maxLimit);

    return { results: rows, total: rows.length };
  }
}
