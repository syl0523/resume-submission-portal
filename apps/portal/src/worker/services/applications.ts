import {
  type ApplicationDetail,
  type ApplicationEvent,
  type ApplicationListItem,
  type ApplicationStatus,
  type ApplyChannel,
  type CaptureMethod,
  decideTransition,
  type EventSource,
  type EventType,
  followUpDate,
  isActive,
  isFinal,
  type JobInputParsed,
  type JobSource,
  STATUS_META,
} from '@jsp/core';
import { analyzeJobUrl, normalizeCompany } from '@jsp/integrations';
import { and, desc, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { type Db, runBatch } from '../db/client';
import { applicationEvents, applications, jobs, resumes } from '../db/schema';
import { type Env, numberVar } from '../env';
import { newId } from '../lib/crypto';
import { HttpError, notFound } from '../lib/errors';
import { toApplication, toEvent, toJob, toListItem, toResume } from '../lib/mappers';
import { nowIso, toIso } from '../lib/time';

/**
 * The one place applications are created and moved between statuses. Routes, email ingest, imports,
 * saved-search hits and the extension all go through here, so dedupe, follow-up dates and the
 * timeline behave the same everywhere.
 */

export interface PreparedJob extends JobInputParsed {
  url: string | null;
  urlKey: string | null;
  externalId: string | null;
  companyKey: string;
  postedAt: string | null;
}

/** Canonical URL + dedupe key, source/externalId inferred from the URL, normalised company key. */
export function prepareJob(job: JobInputParsed): PreparedJob {
  const info = job.url ? analyzeJobUrl(job.url) : null;
  const source: JobSource =
    info && (job.source === 'manual' || job.source === 'other') ? info.source : job.source;
  return {
    ...job,
    source,
    url: info?.url ?? job.url ?? null,
    urlKey: info?.key ?? null,
    externalId: job.externalId?.trim() || info?.externalId || null,
    companyKey: normalizeCompany(job.company) || job.company.trim().toLowerCase(),
    postedAt: toIso(job.postedAt ?? null),
  };
}

/** The user's application for the same posting (same URL key, or same source + external id). */
export async function findExistingApplication(
  db: Db,
  userId: string,
  job: Pick<PreparedJob, 'urlKey' | 'source' | 'externalId'>,
): Promise<string | null> {
  if (job.urlKey) {
    const byUrl = await db
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(and(eq(jobs.userId, userId), eq(jobs.urlKey, job.urlKey)))
      .get();
    if (byUrl) return byUrl.id;
  }
  if (job.externalId) {
    const byExternal = await db
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(
        and(
          eq(jobs.userId, userId),
          eq(jobs.source, job.source),
          eq(jobs.externalId, job.externalId),
        ),
      )
      .get();
    if (byExternal) return byExternal.id;
  }
  return null;
}

export async function assertResumeOwned(db: Db, userId: string, resumeId: string): Promise<void> {
  const row = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
    .get();
  if (!row) throw new HttpError(400, 'invalid_request', 'Unknown resume');
}

export interface CreateApplicationParams {
  job: JobInputParsed;
  status: ApplicationStatus;
  capturedVia: CaptureMethod;
  /** Timeline source: manual (portal), extension, email, import or system. */
  source: EventSource;
  resumeId?: string | null;
  appliedAt?: string | null;
  appliedVia?: ApplyChannel | null;
  notes?: string | null;
  fitScore?: number | null;
  /** When it happened (e.g. the confirmation email's date). Defaults to now. */
  occurredAt?: string | null;
  /** Timeline entry type for the creation event. */
  eventType?: Extract<EventType, 'created' | 'import' | 'email'>;
  summary?: string;
  inboundEmailId?: string | null;
}

export interface CreateApplicationResult {
  applicationId: string;
  /** True when the posting was already saved; nothing was written. */
  duplicate: boolean;
}

/** Create job + application + creation event atomically, or return the existing duplicate. */
export async function createApplication(
  db: Db,
  env: Env,
  userId: string,
  params: CreateApplicationParams,
): Promise<CreateApplicationResult> {
  const job = prepareJob(params.job);
  const existing = await findExistingApplication(db, userId, job);
  if (existing) return { applicationId: existing, duplicate: true };
  if (params.resumeId) await assertResumeOwned(db, userId, params.resumeId);

  const now = nowIso();
  const occurredAt = toIso(params.occurredAt) ?? now;
  const submitted = params.status !== 'saved' && params.status !== 'withdrawn';
  const appliedAt = toIso(params.appliedAt) ?? (submitted ? occurredAt : null);
  const nextFollowUpAt =
    appliedAt && isActive(params.status)
      ? followUpDate(appliedAt, numberVar(env.FOLLOW_UP_AFTER_DAYS, 7))
      : null;

  const jobId = newId();
  const applicationId = newId();
  const statements: BatchItem<'sqlite'>[] = [
    db.insert(jobs).values({
      id: jobId,
      userId,
      source: job.source,
      externalId: job.externalId,
      url: job.url,
      urlKey: job.urlKey,
      title: job.title,
      company: job.company,
      companyKey: job.companyKey,
      location: job.location ?? null,
      remoteType: job.remoteType,
      employmentType: job.employmentType ?? null,
      salaryMin: job.salaryMin ?? null,
      salaryMax: job.salaryMax ?? null,
      salaryCurrency: job.salaryCurrency ?? null,
      description: job.description ?? null,
      postedAt: job.postedAt,
      capturedVia: params.capturedVia,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(applications).values({
      id: applicationId,
      userId,
      jobId,
      resumeId: params.resumeId ?? null,
      status: params.status,
      appliedAt,
      appliedVia: params.appliedVia ?? null,
      lastActivityAt: occurredAt,
      nextFollowUpAt,
      notes: params.notes ?? null,
      fitScore: params.fitScore ?? null,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(applicationEvents).values({
      id: newId(),
      userId,
      applicationId,
      type: params.eventType ?? 'created',
      fromStatus: null,
      toStatus: params.status,
      source: params.source,
      summary:
        params.summary ??
        (params.status === 'saved'
          ? 'Saved'
          : `Added as ${STATUS_META[params.status].label.toLowerCase()}`),
      inboundEmailId: params.inboundEmailId ?? null,
      scheduledAt: null,
      occurredAt,
      createdAt: now,
    }),
  ];

  try {
    await runBatch(db, statements);
  } catch (err) {
    // A concurrent save of the same posting trips the unique index: report it as a duplicate.
    const again = await findExistingApplication(db, userId, job);
    if (again) return { applicationId: again, duplicate: true };
    throw err;
  }
  return { applicationId, duplicate: false };
}

export interface TransitionParams {
  proposed: ApplicationStatus;
  source: EventSource;
  occurredAt?: string | null;
  /** Timeline text. Defaults to "Applied → Viewed" (plus the note, if any). */
  summary?: string;
  note?: string | null;
  eventType?: Extract<EventType, 'status_change' | 'email' | 'import'>;
  /** Write a timeline event even when the status does not change (every email leaves a trace). */
  alwaysRecord?: boolean;
  inboundEmailId?: string | null;
}

export interface TransitionResult {
  changed: boolean;
  reason: string;
  from: ApplicationStatus;
  to: ApplicationStatus;
  eventId: string | null;
}

/**
 * Apply a proposed status through `decideTransition`, keeping appliedAt, follow-up date, activity
 * time and the timeline consistent. Scoped to the user; unknown ids are a 404.
 */
export async function transitionStatus(
  db: Db,
  env: Env,
  userId: string,
  applicationId: string,
  p: TransitionParams,
): Promise<TransitionResult> {
  const app = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .get();
  if (!app) throw notFound('Application');

  const decision = decideTransition(app.status, p.proposed, p.source);
  const now = nowIso();
  const occurredAt = toIso(p.occurredAt) ?? now;
  // biome-ignore lint/complexity/useMathMinMax: ISO strings compare lexicographically; Math.max would give NaN
  const latestActivity = occurredAt > app.lastActivityAt ? occurredAt : app.lastActivityAt;
  const statements: BatchItem<'sqlite'>[] = [];

  if (decision.apply) {
    const to = p.proposed;
    const submitted = to !== 'saved' && to !== 'withdrawn';
    const appliedAt = app.appliedAt ?? (submitted ? occurredAt : null);
    let nextFollowUpAt = app.nextFollowUpAt;
    if (isFinal(to) || to === 'ghosted' || to === 'saved') nextFollowUpAt = null;
    else if (!nextFollowUpAt && appliedAt) {
      nextFollowUpAt = followUpDate(appliedAt, numberVar(env.FOLLOW_UP_AFTER_DAYS, 7));
    }
    statements.push(
      db
        .update(applications)
        .set({
          status: to,
          appliedAt,
          nextFollowUpAt,
          lastActivityAt: latestActivity,
          updatedAt: now,
        })
        .where(eq(applications.id, app.id)),
    );
  } else if (p.alwaysRecord && p.eventType === 'email') {
    statements.push(
      db
        .update(applications)
        .set({ lastActivityAt: latestActivity, updatedAt: now })
        .where(eq(applications.id, app.id)),
    );
  }

  let eventId: string | null = null;
  if (decision.apply || p.alwaysRecord) {
    eventId = newId();
    const transitionText = `${STATUS_META[app.status].label} → ${STATUS_META[p.proposed].label}`;
    const base = p.summary ?? (decision.apply ? transitionText : decision.reason);
    statements.push(
      db.insert(applicationEvents).values({
        id: eventId,
        userId,
        applicationId: app.id,
        type: p.eventType ?? 'status_change',
        fromStatus: decision.apply ? app.status : null,
        toStatus: decision.apply ? p.proposed : null,
        source: p.source,
        summary: p.note ? `${base}: ${p.note}` : base,
        inboundEmailId: p.inboundEmailId ?? null,
        scheduledAt: null,
        occurredAt,
        createdAt: now,
      }),
    );
  }

  await runBatch(db, statements);
  return {
    changed: decision.apply,
    reason: decision.reason,
    from: app.status,
    to: decision.apply ? p.proposed : app.status,
    eventId,
  };
}

export interface AddEventParams {
  type: EventType;
  source: EventSource;
  summary: string;
  scheduledAt?: string | null;
  occurredAt?: string | null;
  inboundEmailId?: string | null;
}

/** Append a timeline entry (note, interview, email without a status change…). */
export async function addEvent(
  db: Db,
  userId: string,
  applicationId: string,
  e: AddEventParams,
): Promise<ApplicationEvent> {
  const owned = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .get();
  if (!owned) throw notFound('Application');
  const now = nowIso();
  const row = {
    id: newId(),
    userId,
    applicationId,
    type: e.type,
    fromStatus: null,
    toStatus: null,
    source: e.source,
    summary: e.summary,
    inboundEmailId: e.inboundEmailId ?? null,
    scheduledAt: toIso(e.scheduledAt ?? null),
    occurredAt: toIso(e.occurredAt ?? null) ?? now,
    createdAt: now,
  };
  await db.insert(applicationEvents).values(row);
  return toEvent(row);
}

/** Application + job + resume + timeline (newest first). */
export async function getApplicationDetail(
  db: Db,
  userId: string,
  applicationId: string,
): Promise<ApplicationDetail> {
  const row = await db
    .select({ app: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .get();
  if (!row) throw notFound('Application');

  const [events, resume] = await Promise.all([
    db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, applicationId))
      .orderBy(desc(applicationEvents.occurredAt), desc(applicationEvents.createdAt))
      .all(),
    row.app.resumeId
      ? db.select().from(resumes).where(eq(resumes.id, row.app.resumeId)).get()
      : Promise.resolve(undefined),
  ]);

  return {
    application: toApplication(row.app),
    job: toJob(row.job),
    resume: resume ? toResume(resume) : null,
    events: events.map(toEvent),
  };
}

/** One application with its job summary (list/Kanban shape). */
export async function getApplicationListItem(
  db: Db,
  userId: string,
  applicationId: string,
): Promise<ApplicationListItem> {
  const row = await db
    .select({ app: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .get();
  if (!row) throw notFound('Application');
  return toListItem(row.app, row.job);
}
