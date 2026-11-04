import { aiAnswerSchema, type FitReport, fitRequestSchema } from '@jsp/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { aiReports, applications, jobs, resumes } from '../db/schema';
import type { AppEnv } from '../env';
import { newId } from '../lib/crypto';
import { HttpError, notFound } from '../lib/errors';
import { validate } from '../lib/validate';
import { answerQuestion, fitReport, requireAi, storedFitReportSchema } from '../services/ai';
import { prepareAnswerInput } from '../services/answers';
import { getResumeRow } from '../services/resumes';

/**
 * AI assist (KAN-33, KAN-45). Mounted at /api. POST /ai/answer shares its context with
 * POST /api/ext/answer. Profile and saved-search drafts live with their own routes.
 */
export const aiRoutes = new Hono<AppEnv>();

aiRoutes.post('/ai/answer', validate('json', aiAnswerSchema), async (c) => {
  requireAi(c.env);
  const input = await prepareAnswerInput(c.var.db, c.var.user, c.req.valid('json'));
  return c.json(await answerQuestion(c.env, input));
});

/**
 * Fit report for an application: the chosen resume, else the application's, else the default.
 * Cached per application + resume; `refresh` recomputes, `coverLetter` always recomputes.
 */
aiRoutes.post('/ai/fit', validate('json', fitRequestSchema), async (c) => {
  requireAi(c.env);
  const db = c.var.db;
  const userId = c.var.user.id;
  const body = c.req.valid('json');

  const row = await db
    .select({ app: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.id, body.applicationId), eq(applications.userId, userId)))
    .get();
  if (!row) throw notFound('Application');
  if (!row.job.description?.trim()) {
    throw new HttpError(422, 'unprocessable', 'Add the job description to this application first.');
  }

  let resumeId = body.resumeId ?? row.app.resumeId;
  if (!resumeId) {
    const fallback = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(
        and(eq(resumes.userId, userId), eq(resumes.isDefault, true), isNull(resumes.archivedAt)),
      )
      .get();
    resumeId = fallback?.id ?? null;
  }
  if (!resumeId) throw new HttpError(422, 'unprocessable', 'Upload a resume first.');
  const resume = await getResumeRow(db, userId, resumeId);

  if (!body.refresh && !body.coverLetter) {
    const cached = await db
      .select()
      .from(aiReports)
      .where(
        and(
          eq(aiReports.applicationId, row.app.id),
          eq(aiReports.resumeId, resume.id),
          eq(aiReports.kind, 'fit'),
        ),
      )
      .orderBy(desc(aiReports.createdAt))
      .get();
    const parsed = cached ? storedFitReportSchema.safeParse(cached.output) : null;
    if (parsed?.success) return c.json<FitReport>(parsed.data);
  }

  const report = await fitReport(c.env, {
    resume,
    job: { title: row.job.title, company: row.job.company, description: row.job.description },
    coverLetter: body.coverLetter,
  });
  await db.insert(aiReports).values({
    id: newId(),
    userId,
    applicationId: row.app.id,
    resumeId: resume.id,
    kind: 'fit',
    model: report.model,
    output: { ...report },
    createdAt: report.createdAt,
  });
  return c.json(report);
});
