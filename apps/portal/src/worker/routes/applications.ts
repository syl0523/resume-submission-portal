import {
  APPLICATION_STATUSES,
  type ApplicationListItem,
  type ApplicationStatus,
  createApplicationSchema,
  interviewSchema,
  type JobDraft,
  type JobSource,
  type ListResponse,
  listApplicationsQuerySchema,
  noteSchema,
  type ResolveUrlResponse,
  resolveUrlSchema,
  STATUS_META,
  statusChangeSchema,
  updateApplicationSchema,
} from '@jsp/core';
import { analyzeJobUrl, fetchJobFromUrl, normalizeCompany } from '@jsp/integrations';
import { and, type Column, count, desc, eq, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { Hono } from 'hono';
import type { z } from 'zod';
import { type Db, runBatch } from '../db/client';
import { applications, jobs } from '../db/schema';
import { type AppEnv, outboundFetch } from '../env';
import { toCsv } from '../lib/csv';
import { HttpError, notFound } from '../lib/errors';
import { toListItem } from '../lib/mappers';
import { nowIso, toIso } from '../lib/time';
import { validate } from '../lib/validate';
import {
  addEvent,
  assertResumeOwned,
  createApplication,
  findExistingApplication,
  getApplicationDetail,
  transitionStatus,
} from '../services/applications';

/**
 * Applications CRUD, status, notes, interviews, resolve-url and export.csv. Mounted at
 * /api/applications (KAN-16, KAN-44). Creation and status changes go through
 * services/applications.ts so every entry point dedupes and records the timeline the same way.
 */

type ListQuery = z.output<typeof listApplicationsQuerySchema>;
type ListFilters = Pick<ListQuery, 'q' | 'status' | 'source'>;

const exportQuerySchema = listApplicationsQuerySchema.pick({
  q: true,
  status: true,
  source: true,
  sort: true,
});

const EXPORT_LIMIT = 10_000;

const duplicate = (applicationId: string) =>
  new HttpError(409, 'duplicate', 'You already saved this job', { applicationId });

const STATUS_SET: ReadonlySet<string> = new Set(APPLICATION_STATUSES);
const isStatus = (s: string): s is ApplicationStatus => STATUS_SET.has(s);

/** `status=applied,viewed` → validated list; unknown values are a 400. */
function parseStatuses(value: string | undefined): ApplicationStatus[] {
  if (!value) return [];
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = parts.filter((s) => !isStatus(s));
  if (unknown.length > 0) {
    throw new HttpError(400, 'invalid_request', `Unknown status: ${unknown.join(', ')}`);
  }
  return parts.filter(isStatus);
}

/** Case-insensitive substring match (SQLite LIKE), with the user's % and _ taken literally. */
function contains(column: Column, q: string): SQL {
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

function listWhere(userId: string, f: ListFilters): SQL {
  const conditions: SQL[] = [eq(applications.userId, userId)];
  const statuses = parseStatuses(f.status);
  if (statuses.length > 0) conditions.push(inArray(applications.status, statuses));
  if (f.source) conditions.push(eq(jobs.source, f.source));
  if (f.q) {
    const match = or(
      contains(jobs.title, f.q),
      contains(jobs.company, f.q),
      contains(jobs.location, f.q),
      contains(applications.notes, f.q),
    );
    if (match) conditions.push(match);
  }
  return and(...conditions) ?? eq(applications.userId, userId);
}

function listOrder(sort: ListQuery['sort']): SQL[] {
  switch (sort) {
    case 'created':
      return [desc(applications.createdAt)];
    case 'applied':
      return [sql`${applications.appliedAt} DESC NULLS LAST`, desc(applications.createdAt)];
    case 'company':
      return [sql`${jobs.company} COLLATE NOCASE ASC`, desc(applications.lastActivityAt)];
    case 'fit':
      return [sql`${applications.fitScore} DESC NULLS LAST`, desc(applications.lastActivityAt)];
    default:
      return [desc(applications.lastActivityAt), desc(applications.createdAt)];
  }
}

function selectWithJob(db: Db) {
  return db
    .select({ app: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId));
}

/** Another application of this user's that already uses the URL key or source + external id. */
async function findConflict(
  db: Db,
  userId: string,
  jobId: string,
  key: { urlKey: string | null; source: JobSource; externalId: string | null },
): Promise<string | null> {
  const clauses: SQL[] = [];
  if (key.urlKey) clauses.push(eq(jobs.urlKey, key.urlKey));
  const sameExternal = key.externalId
    ? and(eq(jobs.source, key.source), eq(jobs.externalId, key.externalId))
    : undefined;
  if (sameExternal) clauses.push(sameExternal);
  if (clauses.length === 0) return null;
  const row = await db
    .select({ id: applications.id })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(jobs.userId, userId), ne(jobs.id, jobId), or(...clauses)))
    .get();
  return row?.id ?? null;
}

const EXPORT_HEADER = [
  'Company',
  'Title',
  'Status',
  'Applied at',
  'Applied via',
  'Source',
  'Location',
  'Work arrangement',
  'Salary min',
  'Salary max',
  'Currency',
  'URL',
  'Fit score',
  'Last activity',
  'Next follow-up',
  'Notes',
  'Created at',
] as const;

const NEVER_FETCHED: Partial<Record<JobSource, string>> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
};

export const applicationRoutes = new Hono<AppEnv>();

applicationRoutes.get('/', validate('query', listApplicationsQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const db = c.var.db;
  const where = listWhere(c.var.user.id, query);
  const [rows, totalRow] = await Promise.all([
    selectWithJob(db)
      .where(where)
      .orderBy(...listOrder(query.sort))
      .limit(query.limit)
      .offset(query.offset)
      .all(),
    db
      .select({ total: count() })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(where)
      .get(),
  ]);
  const body: ListResponse<ApplicationListItem> = {
    items: rows.map((r) => toListItem(r.app, r.job)),
    total: totalRow?.total ?? 0,
  };
  return c.json(body);
});

// Static paths before `/:id`.
applicationRoutes.get('/export.csv', validate('query', exportQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const rows = await selectWithJob(c.var.db)
    .where(listWhere(c.var.user.id, query))
    .orderBy(...listOrder(query.sort))
    .limit(EXPORT_LIMIT)
    .all();
  const csv = toCsv(
    EXPORT_HEADER,
    rows.map(({ app, job }) => [
      job.company,
      job.title,
      STATUS_META[app.status].label,
      app.appliedAt,
      app.appliedVia,
      job.source,
      job.location,
      job.remoteType,
      job.salaryMin,
      job.salaryMax,
      job.salaryCurrency,
      job.url,
      app.fitScore,
      app.lastActivityAt,
      app.nextFollowUpAt,
      app.notes,
      app.createdAt,
    ]),
  );
  // BOM so Excel opens the UTF-8 file with the right encoding.
  return c.body(`﻿${csv}`, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="applications-${nowIso().slice(0, 10)}.csv"`,
    'cache-control': 'no-store',
  });
});

applicationRoutes.post('/', validate('json', createApplicationSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.var.user.id;
  const result = await createApplication(c.var.db, c.env, userId, {
    job: body.job,
    status: body.status,
    capturedVia: body.capturedVia,
    source: 'manual',
    resumeId: body.resumeId ?? null,
    appliedAt: body.appliedAt ?? null,
    appliedVia: body.appliedVia ?? null,
    notes: body.notes ?? null,
    fitScore: body.fitScore ?? null,
  });
  if (result.duplicate) throw duplicate(result.applicationId);
  return c.json(await getApplicationDetail(c.var.db, userId, result.applicationId), 201);
});

applicationRoutes.post('/resolve-url', validate('json', resolveUrlSchema), async (c) => {
  const { url } = c.req.valid('json');
  const info = analyzeJobUrl(url);
  if (!info) throw new HttpError(400, 'invalid_request', 'This does not look like a job URL');

  const existingApplicationId = await findExistingApplication(c.var.db, c.var.user.id, {
    urlKey: info.key,
    source: info.source,
    externalId: info.externalId,
  });
  const base: JobDraft = { url: info.url, source: info.source, externalId: info.externalId };
  const body: ResolveUrlResponse = {
    job: base,
    fetched: false,
    message: null,
    existingApplicationId,
  };

  const blockedSite = NEVER_FETCHED[info.source];
  if (blockedSite) {
    // ADR 0002: LinkedIn and Indeed pages are never fetched server-side.
    body.message = `${blockedSite} postings are not read by the server. Save it with the browser extension from the posting page, or fill in the details here.`;
    return c.json(body);
  }
  try {
    const draft = await fetchJobFromUrl(info.url, {
      fetch: outboundFetch(c.env),
      signal: AbortSignal.timeout(10_000),
    });
    if (draft) {
      body.job = { ...base, ...draft, url: draft.url ?? info.url };
      body.fetched = true;
    } else {
      body.message =
        'Details for this site cannot be read automatically. Fill them in here, or save the posting with the browser extension.';
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    body.message = `Could not fetch the posting details (${reason}). Fill them in here.`;
  }
  return c.json(body);
});

applicationRoutes.get('/:id', async (c) =>
  c.json(await getApplicationDetail(c.var.db, c.var.user.id, c.req.param('id'))),
);

applicationRoutes.patch('/:id', validate('json', updateApplicationSchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const id = c.req.param('id');
  const patch = c.req.valid('json');

  const row = await selectWithJob(db)
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .get();
  if (!row) throw notFound('Application');
  if (patch.resumeId) await assertResumeOwned(db, userId, patch.resumeId);

  const now = nowIso();
  const statements: BatchItem<'sqlite'>[] = [];
  const j = patch.job;

  if (j && Object.keys(j).length > 0) {
    const set: Partial<typeof jobs.$inferInsert> = { updatedAt: now };
    if (j.title !== undefined) set.title = j.title;
    if (j.company !== undefined) {
      set.company = j.company;
      set.companyKey = normalizeCompany(j.company) || j.company.trim().toLowerCase();
    }
    if (j.source !== undefined) set.source = j.source;
    if (j.externalId !== undefined) set.externalId = j.externalId?.trim() || null;
    if (j.location !== undefined) set.location = j.location ?? null;
    if (j.remoteType !== undefined) set.remoteType = j.remoteType;
    if (j.employmentType !== undefined) set.employmentType = j.employmentType ?? null;
    if (j.salaryMin !== undefined) set.salaryMin = j.salaryMin ?? null;
    if (j.salaryMax !== undefined) set.salaryMax = j.salaryMax ?? null;
    if (j.salaryCurrency !== undefined) set.salaryCurrency = j.salaryCurrency ?? null;
    if (j.description !== undefined) set.description = j.description ?? null;
    if (j.postedAt !== undefined) set.postedAt = toIso(j.postedAt);
    if (j.url !== undefined) {
      const info = j.url ? analyzeJobUrl(j.url) : null;
      set.url = info?.url ?? j.url ?? null;
      set.urlKey = info?.key ?? null;
      const inferable = row.job.source === 'manual' || row.job.source === 'other';
      if (j.source === undefined && info && inferable) set.source = info.source;
      // A different URL is a different posting: the old site id no longer applies.
      if (j.externalId === undefined) set.externalId = info?.externalId ?? null;
    }

    const conflict = await findConflict(db, userId, row.job.id, {
      urlKey: set.urlKey !== undefined ? set.urlKey : row.job.urlKey,
      source: set.source ?? row.job.source,
      externalId: set.externalId !== undefined ? set.externalId : row.job.externalId,
    });
    if (conflict) throw duplicate(conflict);
    statements.push(db.update(jobs).set(set).where(eq(jobs.id, row.job.id)));
  }

  const appSet: Partial<typeof applications.$inferInsert> = { updatedAt: now };
  if (patch.resumeId !== undefined) appSet.resumeId = patch.resumeId ?? null;
  if (patch.appliedAt !== undefined) appSet.appliedAt = toIso(patch.appliedAt);
  if (patch.appliedVia !== undefined) appSet.appliedVia = patch.appliedVia ?? null;
  if (patch.notes !== undefined) appSet.notes = patch.notes ?? null;
  if (patch.nextFollowUpAt !== undefined) appSet.nextFollowUpAt = toIso(patch.nextFollowUpAt);
  if (statements.length > 0 || Object.keys(appSet).length > 1) {
    statements.push(db.update(applications).set(appSet).where(eq(applications.id, row.app.id)));
  }

  await runBatch(db, statements);
  return c.json(await getApplicationDetail(db, userId, id));
});

applicationRoutes.delete('/:id', async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const row = await db
    .select({ jobId: applications.jobId })
    .from(applications)
    .where(and(eq(applications.id, c.req.param('id')), eq(applications.userId, userId)))
    .get();
  if (!row) throw notFound('Application');
  // Foreign keys cascade to the application, its events and AI reports, and unlink inbox items,
  // board postings and search hits.
  await db.delete(jobs).where(and(eq(jobs.id, row.jobId), eq(jobs.userId, userId)));
  return c.body(null, 204);
});

applicationRoutes.post('/:id/status', validate('json', statusChangeSchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const result = await transitionStatus(db, c.env, userId, id, {
    proposed: body.status,
    source: 'manual',
    occurredAt: body.occurredAt ?? null,
    note: body.note ?? null,
  });
  if (result.changed && body.status === 'interview' && body.interviewAt) {
    await addEvent(db, userId, id, {
      type: 'interview',
      source: 'manual',
      summary: 'Interview',
      scheduledAt: body.interviewAt,
    });
  }
  return c.json(await getApplicationDetail(db, userId, id));
});

applicationRoutes.post('/:id/notes', validate('json', noteSchema), async (c) => {
  const event = await addEvent(c.var.db, c.var.user.id, c.req.param('id'), {
    type: 'note',
    source: 'manual',
    summary: c.req.valid('json').text,
  });
  return c.json(event, 201);
});

applicationRoutes.post('/:id/interviews', validate('json', interviewSchema), async (c) => {
  const body = c.req.valid('json');
  const where = body.location ? ` (${body.location})` : '';
  const notes = body.notes ? `: ${body.notes}` : '';
  const event = await addEvent(c.var.db, c.var.user.id, c.req.param('id'), {
    type: 'interview',
    source: 'manual',
    summary: `${body.title}${where}${notes}`,
    scheduledAt: body.scheduledAt,
  });
  return c.json(event, 201);
});
