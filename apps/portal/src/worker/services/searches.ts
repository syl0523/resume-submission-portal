import type { SavedSearch } from '@jsp/core';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { savedSearches, searchHits } from '../db/schema';
import { toSavedSearch } from '../lib/mappers';

/**
 * Saved searches with hit counts. `totalHits` = hits not dismissed; `newHits` = new, not dismissed
 * and not saved yet (the same rule as DashboardStats.newMatches).
 */
export async function listSavedSearches(db: Db, userId: string): Promise<SavedSearch[]> {
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.userId, userId))
      .orderBy(desc(savedSearches.updatedAt))
      .all(),
    db
      .select({
        searchId: searchHits.searchId,
        total: sql<number>`coalesce(sum(case when ${searchHits.dismissed} = 0 then 1 else 0 end), 0)`,
        fresh: sql<number>`coalesce(sum(case when ${searchHits.isNew} = 1 and ${searchHits.dismissed} = 0 and ${searchHits.applicationId} is null then 1 else 0 end), 0)`,
      })
      .from(searchHits)
      .where(eq(searchHits.userId, userId))
      .groupBy(searchHits.searchId)
      .all(),
  ]);
  const bySearch = new Map(counts.map((c) => [c.searchId, c]));
  return rows.map((r) => {
    const c = bySearch.get(r.id);
    return toSavedSearch(r, { totalHits: Number(c?.total ?? 0), newHits: Number(c?.fresh ?? 0) });
  });
}
