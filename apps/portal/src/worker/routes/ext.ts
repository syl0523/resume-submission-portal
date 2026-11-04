import {
  aiAnswerSchema,
  type ExtLookupResponse,
  type ExtProfileResponse,
  type ExtSaveResponse,
  extLookupQuerySchema,
  extSaveJobSchema,
} from '@jsp/core';
import { analyzeJobUrl } from '@jsp/integrations';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { applications, profiles } from '../db/schema';
import type { AppEnv } from '../env';
import { toProfile } from '../lib/mappers';
import { nowIso } from '../lib/time';
import { validate } from '../lib/validate';
import { answerQuestion, requireAi } from '../services/ai';
import { prepareAnswerInput } from '../services/answers';
import {
  assertResumeOwned,
  createApplication,
  findExistingApplication,
  getApplicationListItem,
  transitionStatus,
} from '../services/applications';
import { getResumeRow, listResumes, resumeFileResponse } from '../services/resumes';
import { listSavedSearches } from '../services/searches';

/**
 * Browser-extension API (KAN-19). Bearer-token auth and CORS are applied in app.ts. Mounted at
 * /api/ext. The extension never submits applications: it saves jobs and reads autofill data.
 */
export const extRoutes = new Hono<AppEnv>();

extRoutes.get('/ping', (c) => c.json({ ok: true, email: c.var.user.email }));

extRoutes.get('/profile', async (c) => {
  const db = c.var.db;
  const user = c.var.user;
  const [profileRow, resumes, searches] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.userId, user.id)).get(),
    listResumes(db, user.id),
    listSavedSearches(db, user.id),
  ]);
  const body: ExtProfileResponse = {
    user: { email: user.email, name: user.name },
    profile: toProfile(profileRow, user.email),
    resumes,
    searches,
  };
  return c.json(body);
});

extRoutes.get('/lookup', validate('query', extLookupQuerySchema), async (c) => {
  const info = analyzeJobUrl(c.req.valid('query').url);
  const id = info
    ? await findExistingApplication(c.var.db, c.var.user.id, {
        urlKey: info.key,
        source: info.source,
        externalId: info.externalId,
      })
    : null;
  const body: ExtLookupResponse = {
    application: id ? await getApplicationListItem(c.var.db, c.var.user.id, id) : null,
  };
  return c.json(body);
});

extRoutes.post('/jobs', validate('json', extSaveJobSchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const body = c.req.valid('json');
  const result = await createApplication(db, c.env, userId, {
    job: body.job,
    status: body.markApplied ? 'applied' : 'saved',
    capturedVia: 'extension',
    source: 'extension',
    resumeId: body.resumeId ?? null,
    appliedVia: body.appliedVia ?? null,
    notes: body.notes ?? null,
    fitScore: body.fitScore ?? null,
  });

  if (result.duplicate && body.markApplied) {
    const moved = await transitionStatus(db, c.env, userId, result.applicationId, {
      proposed: 'applied',
      source: 'extension',
      summary: 'Marked applied from the extension',
    });
    if (moved.changed && (body.resumeId || body.appliedVia)) {
      // Record what was sent, without overwriting anything already set.
      if (body.resumeId) await assertResumeOwned(db, userId, body.resumeId);
      const current = await db
        .select({ resumeId: applications.resumeId, appliedVia: applications.appliedVia })
        .from(applications)
        .where(and(eq(applications.id, result.applicationId), eq(applications.userId, userId)))
        .get();
      await db
        .update(applications)
        .set({
          resumeId: current?.resumeId ?? body.resumeId ?? null,
          appliedVia: current?.appliedVia ?? body.appliedVia ?? null,
          updatedAt: nowIso(),
        })
        .where(and(eq(applications.id, result.applicationId), eq(applications.userId, userId)));
    }
  }

  const response: ExtSaveResponse = {
    application: await getApplicationListItem(db, userId, result.applicationId),
    duplicate: result.duplicate,
    portalUrl: `${new URL(c.req.url).origin}/applications/${result.applicationId}`,
  };
  return c.json(response, result.duplicate ? 200 : 201);
});

extRoutes.get('/resumes/:id/file', async (c) =>
  resumeFileResponse(c.env, await getResumeRow(c.var.db, c.var.user.id, c.req.param('id'))),
);

extRoutes.post('/answer', validate('json', aiAnswerSchema), async (c) => {
  requireAi(c.env);
  const input = await prepareAnswerInput(c.var.db, c.var.user, c.req.valid('json'));
  return c.json(await answerQuestion(c.env, input));
});
