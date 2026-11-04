import {
  draftFromResumeSchema,
  type ListResponse,
  listHitsQuerySchema,
  runSearchSchema,
  type SearchHit,
  savedSearchSchema,
  saveHitSchema,
} from '@jsp/core';
import { buildDeepLinks } from '@jsp/integrations';
import { and, count, desc, eq, gte, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';
import { savedSearches, searchHits } from '../db/schema';
import type { AppEnv } from '../env';
import { newId } from '../lib/crypto';
import { notFound } from '../lib/errors';
import { toSearchHit } from '../lib/mappers';
import { nowIso } from '../lib/time';
import { validate } from '../lib/validate';
import { draftSearchFromResume, requireAi } from '../services/ai';
import {
  assertResumeOwned,
  createApplication,
  getApplicationDetail,
} from '../services/applications';
import { runSavedSearch } from '../services/jobmatch';
import { getResumeRow } from '../services/resumes';
import { criteriaOf, listSavedSearches } from '../services/searches';

/** Saved searches (Job Match, KAN-39), runs, hits and deep links. Mounted at /api/searches. */

type SavedSearchInput = z.output<typeof savedSearchSchema>;

function searchValues(body: SavedSearchInput) {
  return {
    name: body.name,
    resumeId: body.resumeId ?? null,
    titles: body.titles,
    skills: body.skills,
    locations: body.locations,
    workMode: body.workMode,
    seniority: body.seniority ?? null,
    keywords: body.keywords,
    excludeKeywords: body.excludeKeywords,
    minSalary: body.minSalary ?? null,
    postedWithinDays: body.postedWithinDays,
    needsSponsorship: body.needsSponsorship,
    summary: body.summary ?? null,
    alertsEnabled: body.alertsEnabled,
  };
}

export const searchRoutes = new Hono<AppEnv>();

async function searchRow(c: { var: AppEnv['Variables'] }, id: string) {
  const row = await c.var.db
    .select()
    .from(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, c.var.user.id)))
    .get();
  if (!row) throw notFound('Saved search');
  return row;
}

async function hitRow(c: { var: AppEnv['Variables'] }, id: string) {
  const row = await c.var.db
    .select()
    .from(searchHits)
    .where(and(eq(searchHits.id, id), eq(searchHits.userId, c.var.user.id)))
    .get();
  if (!row) throw notFound('Search result');
  return row;
}

searchRoutes.get('/', async (c) => c.json(await listSavedSearches(c.var.db, c.var.user.id)));

searchRoutes.post('/', validate('json', savedSearchSchema), async (c) => {
  const body = c.req.valid('json');
  if (body.resumeId) await assertResumeOwned(c.var.db, c.var.user.id, body.resumeId);
  const now = nowIso();
  const id = newId();
  await c.var.db
    .insert(savedSearches)
    .values({ id, userId: c.var.user.id, ...searchValues(body), createdAt: now, updatedAt: now });
  const [created] = await listSavedSearches(c.var.db, c.var.user.id, id);
  return c.json(created, 201);
});

// Static paths before `/:id`.
searchRoutes.post('/draft-from-resume', validate('json', draftFromResumeSchema), async (c) => {
  requireAi(c.env);
  const resume = await getResumeRow(c.var.db, c.var.user.id, c.req.valid('json').resumeId);
  return c.json(await draftSearchFromResume(c.env, resume));
});

searchRoutes.post('/hits/:hitId/save', validate('json', saveHitSchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const hit = await hitRow(c, c.req.param('hitId'));
  const search = await searchRow(c, hit.searchId);
  const result = await createApplication(db, c.env, userId, {
    job: hit.job,
    status: c.req.valid('json').status,
    capturedVia: 'search',
    source: 'manual',
    fitScore: hit.aiFit?.score ?? hit.fitScore,
    resumeId: search.resumeId,
    summary: `Saved from Job Match (${search.name})`,
  });
  await db
    .update(searchHits)
    .set({ applicationId: result.applicationId, isNew: false })
    .where(eq(searchHits.id, hit.id));
  return c.json(
    await getApplicationDetail(db, userId, result.applicationId),
    result.duplicate ? 200 : 201,
  );
});

searchRoutes.post('/hits/:hitId/dismiss', async (c) => {
  const hit = await hitRow(c, c.req.param('hitId'));
  await c.var.db
    .update(searchHits)
    .set({ dismissed: true, isNew: false })
    .where(eq(searchHits.id, hit.id));
  return c.body(null, 204);
});

searchRoutes.get('/:id', async (c) => {
  const [search] = await listSavedSearches(c.var.db, c.var.user.id, c.req.param('id'));
  if (!search) throw notFound('Saved search');
  return c.json(search);
});

searchRoutes.put('/:id', validate('json', savedSearchSchema), async (c) => {
  const row = await searchRow(c, c.req.param('id'));
  const body = c.req.valid('json');
  if (body.resumeId) await assertResumeOwned(c.var.db, c.var.user.id, body.resumeId);
  await c.var.db
    .update(savedSearches)
    .set({ ...searchValues(body), updatedAt: nowIso() })
    .where(eq(savedSearches.id, row.id));
  const [updated] = await listSavedSearches(c.var.db, c.var.user.id, row.id);
  return c.json(updated);
});

searchRoutes.delete('/:id', async (c) => {
  const row = await searchRow(c, c.req.param('id'));
  await c.var.db.delete(savedSearches).where(eq(savedSearches.id, row.id));
  return c.body(null, 204);
});

searchRoutes.post('/:id/run', validate('json', runSearchSchema), async (c) => {
  const row = await searchRow(c, c.req.param('id'));
  const body = c.req.valid('json');
  return c.json(
    await runSavedSearch(c.var.db, c.env, c.var.user.id, row, {
      providers: body.providers,
      aiRerank: body.aiRerank,
      maxQueries: body.maxQueries,
    }),
  );
});

searchRoutes.get('/:id/hits', validate('query', listHitsQuerySchema), async (c) => {
  const row = await searchRow(c, c.req.param('id'));
  const q = c.req.valid('query');
  const conditions: SQL[] = [eq(searchHits.searchId, row.id), eq(searchHits.userId, c.var.user.id)];
  if (q.onlyNew) conditions.push(eq(searchHits.isNew, true));
  if (!q.includeDismissed) conditions.push(eq(searchHits.dismissed, false));
  if (q.minScore !== undefined) conditions.push(gte(searchHits.fitScore, q.minScore));
  const where = and(...conditions);
  const [rows, total] = await Promise.all([
    c.var.db
      .select()
      .from(searchHits)
      .where(where)
      .orderBy(
        ...(q.sort === 'new'
          ? [desc(searchHits.firstSeenAt), desc(searchHits.fitScore)]
          : [desc(searchHits.fitScore), desc(searchHits.firstSeenAt)]),
      )
      .limit(q.limit)
      .offset(q.offset)
      .all(),
    c.var.db.select({ n: count() }).from(searchHits).where(where).get(),
  ]);
  const body: ListResponse<SearchHit> = { items: rows.map(toSearchHit), total: total?.n ?? 0 };
  return c.json(body);
});

searchRoutes.get('/:id/links', async (c) =>
  c.json(buildDeepLinks(criteriaOf(await searchRow(c, c.req.param('id'))))),
);
