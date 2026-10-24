import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { videos, watchSessions } from '../../db/schema';

type AccessMode = (typeof videos.$inferSelect)['accessMode'];
type Category = (typeof videos.$inferSelect)['category'];

/** Raw-SQL video queries (CLAUDE.md §9: raw SQL only in repositories). */
@Injectable()
export class VideosRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Published videos matching `q` via the generated `search_doc` tsvector, best first. */
  searchPublished(
    q: string,
    modes: AccessMode[] | undefined,
    category: Category | undefined,
    limit: number,
  ) {
    const query = sql`websearch_to_tsquery('english', ${q})`;
    return this.db
      .select()
      .from(videos)
      .where(
        and(
          eq(videos.state, 'published'),
          sql`${videos}.search_doc @@ ${query}`,
          modes ? inArray(videos.accessMode, modes) : undefined,
          category ? eq(videos.category, category) : undefined,
        ),
      )
      .orderBy(sql`ts_rank(${videos}.search_doc, ${query}) DESC`, videos.id)
      .limit(limit);
  }

  /**
   * Views per video: watch sessions past two counted heartbeats (~30s of playback), not
   * counting the creator's own plays. Uses the partial index from migration 0016.
   */
  async viewCounts(videoIds: string[]): Promise<Map<string, number>> {
    if (videoIds.length === 0) return new Map();
    const rows = await this.db
      .select({ videoId: watchSessions.videoId, n: count() })
      .from(watchSessions)
      .innerJoin(videos, eq(videos.id, watchSessions.videoId))
      .where(
        and(
          inArray(watchSessions.videoId, videoIds),
          gte(watchSessions.heartbeatCount, 2),
          or(isNull(watchSessions.userId), ne(watchSessions.userId, videos.ownerId)),
        ),
      )
      .groupBy(watchSessions.videoId);
    return new Map(rows.map((r) => [r.videoId, Number(r.n)]));
  }
}
