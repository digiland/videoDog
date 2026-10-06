import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { videos } from '../../db/schema';

type AccessMode = (typeof videos.$inferSelect)['accessMode'];

/** Raw-SQL video queries (CLAUDE.md §9: raw SQL only in repositories). */
@Injectable()
export class VideosRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Published videos matching `q` via the generated `search_doc` tsvector, best first. */
  searchPublished(q: string, mode: AccessMode | undefined, limit: number) {
    const query = sql`websearch_to_tsquery('english', ${q})`;
    return this.db
      .select()
      .from(videos)
      .where(
        and(
          eq(videos.state, 'published'),
          sql`${videos}.search_doc @@ ${query}`,
          mode ? eq(videos.accessMode, mode) : undefined,
        ),
      )
      .orderBy(sql`ts_rank(${videos}.search_doc, ${query}) DESC`, videos.id)
      .limit(limit);
  }
}
