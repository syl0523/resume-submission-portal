import type { SavedSearch, SearchProfileParsed } from '@jsp/core';
import { type FitJob, scoreJobFit } from '@jsp/integrations';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type SavedSearchRow, savedSearches, searchHits } from '../db/schema';
import { toSavedSearch } from '../lib/mappers';

/**
 * Saved searches with hit counts. `totalHits` = hits not dismissed; `newHits` = new, not dismissed
 * and not saved yet (the same rule as DashboardStats.newMatches).
 */
export async function listSavedSearches(
  db: Db,
  userId: string,
  searchId?: string,
): Promise<SavedSearch[]> {
  const scope = searchId
    ? and(eq(savedSearches.userId, userId), eq(savedSearches.id, searchId))
    : eq(savedSearches.userId, userId);
  const [rows, counts] = await Promise.all([
    db.select().from(savedSearches).where(scope).orderBy(desc(savedSearches.updatedAt)).all(),
    db
      .select({
        searchId: searchHits.searchId,
        total: sql<number>`coalesce(sum(case when ${searchHits.dismissed} = 0 then 1 else 0 end), 0)`,
        fresh: sql<number>`coalesce(sum(case when ${searchHits.isNew} = 1 and ${searchHits.dismissed} = 0 and ${searchHits.applicationId} is null then 1 else 0 end), 0)`,
      })
      .from(searchHits)
      .where(
        searchId
          ? and(eq(searchHits.userId, userId), eq(searchHits.searchId, searchId))
          : eq(searchHits.userId, userId),
      )
      .groupBy(searchHits.searchId)
      .all(),
  ]);
  const bySearch = new Map(counts.map((c) => [c.searchId, c]));
  return rows.map((r) => {
    const c = bySearch.get(r.id);
    return toSavedSearch(r, { totalHits: Number(c?.total ?? 0), newHits: Number(c?.fresh ?? 0) });
  });
}

/** The criteria stored on a saved search, in the shape the matching code expects. */
export function criteriaOf(row: SavedSearchRow): SearchProfileParsed {
  const s = toSavedSearch(row, { totalHits: 0, newHits: 0 });
  return {
    resumeId: s.resumeId,
    titles: s.titles,
    skills: s.skills,
    locations: s.locations,
    workMode: s.workMode,
    seniority: s.seniority,
    keywords: s.keywords,
    excludeKeywords: s.excludeKeywords,
    minSalary: s.minSalary,
    postedWithinDays: s.postedWithinDays,
    needsSponsorship: s.needsSponsorship,
    summary: s.summary,
  };
}

/**
 * A job's best fit (0-100) across the user's saved searches, scored the way Job Match scores its
 * hits. For jobs that arrive without a score (added by hand or imported); null without searches.
 */
export function bestFitScore(
  searches: SavedSearch[],
  job: FitJob,
  now = new Date(),
): number | null {
  if (searches.length === 0) return null;
  return Math.max(...searches.map((s) => scoreJobFit(s, job, now).score));
}
