import {
  type JobFit,
  type RunSearchResponse,
  SEARCH_PROVIDERS,
  type SearchHit,
  type SearchProvider,
} from '@jsp/core';
import {
  analyzeJobUrl,
  buildDeepLinks,
  dedupeJobs,
  normalizeCompany,
  normalizeTitle,
  planQueries,
  scoreJobFit,
} from '@jsp/integrations';
import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { chunk, type Db, runBatch } from '../db/client';
import { type SavedSearchRow, savedSearches, searchHits } from '../db/schema';
import type { Env } from '../env';
import { newId } from '../lib/crypto';
import { toSearchHit } from '../lib/mappers';
import { aiEnabled, rerankHits } from './ai';
import { applicationIndex, fanOut } from './search';
import { criteriaOf, listSavedSearches } from './searches';

/** Job Match runs (KAN-39..41). Steps follow docs/api.md, "How a run works". */

const RERANK_TOP = 20;

export interface RunOptions {
  providers?: SearchProvider[];
  aiRerank: boolean;
  maxQueries: number;
  now?: Date;
}

function hitKey(job: { url?: string | null; company: string; title: string }): string {
  const fromUrl = job.url ? analyzeJobUrl(job.url)?.key : undefined;
  return fromUrl ?? `nourl:${normalizeCompany(job.company)}|${normalizeTitle(job.title)}`;
}

export function rankHits<T extends { fit: JobFit; aiFit: { score: number } | null }>(
  hits: T[],
): T[] {
  return [...hits].sort(
    (a, b) =>
      Number(a.fit.excluded) - Number(b.fit.excluded) ||
      (b.aiFit?.score ?? b.fit.score) - (a.aiFit?.score ?? a.fit.score),
  );
}

export async function runSavedSearch(
  db: Db,
  env: Env,
  userId: string,
  search: SavedSearchRow,
  opts: RunOptions,
): Promise<RunSearchResponse> {
  const now = (opts.now ?? new Date()).toISOString();
  const criteria = criteriaOf(search);
  const queries = planQueries(criteria, opts.maxQueries);
  const providers = opts.providers ?? [...SEARCH_PROVIDERS];

  const { items, outcomes } = await fanOut(db, env, userId, queries, providers);
  const merged = dedupeJobs(items);
  const scored = merged.map((item) => ({
    ...item,
    fit: scoreJobFit(criteria, item.job, opts.now ?? new Date()),
    aiFit: null as { score: number; reason: string } | null,
  }));

  if (opts.aiRerank && aiEnabled(env)) {
    const top = rankHits(scored)
      .filter((s) => !s.fit.excluded)
      .slice(0, RERANK_TOP);
    try {
      const reranked = await rerankHits(env, criteria, top);
      top.forEach((item, i) => {
        item.aiFit = reranked[i] ?? null;
      });
    } catch (err) {
      console.warn('AI re-rank failed', err);
    }
  }

  const [existingRows, appsByKey] = await Promise.all([
    db.select().from(searchHits).where(eq(searchHits.searchId, search.id)).all(),
    applicationIndex(db, userId),
  ]);
  const existing = new Map(existingRows.map((h) => [h.urlKey, h]));
  const firstRun = search.lastRunAt === null;
  const statements: BatchItem<'sqlite'>[] = [
    db.update(searchHits).set({ isNew: false }).where(eq(searchHits.searchId, search.id)),
  ];
  const inserts: (typeof searchHits.$inferInsert)[] = [];
  const runHits: SearchHit[] = [];
  const seen = new Set<string>();

  for (const item of scored) {
    const key = hitKey(item.job);
    if (seen.has(key)) continue;
    seen.add(key);
    const linked =
      appsByKey.get(`url:${key}`) ??
      (item.job.externalId
        ? appsByKey.get(`id:${item.job.source}:${item.job.externalId}`)
        : undefined) ??
      null;
    const prior = existing.get(key);
    if (prior) {
      const aiFit = item.aiFit ?? prior.aiFit ?? null;
      const applicationId = prior.applicationId ?? linked;
      statements.push(
        db
          .update(searchHits)
          .set({
            provider: item.provider,
            sourceLabel: item.sourceLabel,
            job: item.job,
            fit: item.fit,
            fitScore: item.fit.score,
            aiFit,
            lastSeenAt: now,
            applicationId,
          })
          .where(eq(searchHits.id, prior.id)),
      );
      runHits.push(
        toSearchHit({
          ...prior,
          provider: item.provider,
          sourceLabel: item.sourceLabel,
          job: item.job,
          fit: item.fit,
          fitScore: item.fit.score,
          aiFit,
          lastSeenAt: now,
          isNew: false,
          applicationId,
        }),
      );
    } else {
      const row = {
        id: newId(),
        userId,
        searchId: search.id,
        urlKey: key,
        provider: item.provider,
        sourceLabel: item.sourceLabel,
        job: item.job,
        fit: item.fit,
        fitScore: item.fit.score,
        aiFit: item.aiFit,
        firstSeenAt: now,
        lastSeenAt: now,
        isNew: !firstRun,
        dismissed: false,
        applicationId: linked,
      };
      inserts.push(row);
      runHits.push(toSearchHit(row));
    }
  }
  // 15 columns per row: 6 rows keep a statement under D1's 100 bound parameters.
  for (const rows of chunk(inserts, 6)) statements.push(db.insert(searchHits).values(rows));
  statements.push(
    db.update(savedSearches).set({ lastRunAt: now }).where(eq(savedSearches.id, search.id)),
  );
  for (const group of chunk(statements, 50)) await runBatch(db, group);

  const [fresh] = await listSavedSearches(db, userId, search.id);
  if (!fresh) throw new Error(`Saved search ${search.id} vanished during its run`);
  return {
    search: fresh,
    hits: rankHits(runHits.filter((h) => !h.dismissed)),
    queries: queries.map((q) => ({ title: q.title, location: q.location })),
    providers: outcomes,
    deepLinks: buildDeepLinks(criteria),
  };
}

/** Daily refresh of every saved search with alerts on (2 queries per provider, no AI). */
export async function refreshAlertSearches(
  db: Db,
  env: Env,
  now: Date,
): Promise<{ run: number; errors: number }> {
  const searches = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.alertsEnabled, true))
    .all();
  let run = 0;
  let errors = 0;
  for (const search of searches) {
    try {
      await runSavedSearch(db, env, search.userId, search, { aiRerank: false, maxQueries: 2, now });
      run += 1;
    } catch (err) {
      errors += 1;
      console.warn(`Saved search ${search.id} failed`, err);
    }
  }
  return { run, errors };
}
