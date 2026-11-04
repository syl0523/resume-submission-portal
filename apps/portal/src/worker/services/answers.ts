import type { aiAnswerSchema } from '@jsp/core';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { applications, jobs, profiles } from '../db/schema';
import type { AuthUser } from '../env';
import { notFound } from '../lib/errors';
import { toProfile } from '../lib/mappers';
import type { AnswerQuestionInput } from './ai';

/**
 * Context for "draft an answer to this application question": the profile plus the job, taken
 * from a saved application (owned by the user) or from text the extension read off the page.
 * Shared by POST /api/ai/answer and POST /api/ext/answer.
 */
export async function prepareAnswerInput(
  db: Db,
  user: AuthUser,
  body: z.output<typeof aiAnswerSchema>,
): Promise<AnswerQuestionInput> {
  const profileRow = await db.select().from(profiles).where(eq(profiles.userId, user.id)).get();
  let job: AnswerQuestionInput['job'] = null;
  if (body.applicationId) {
    const row = await db
      .select({ title: jobs.title, company: jobs.company, description: jobs.description })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(and(eq(applications.id, body.applicationId), eq(applications.userId, user.id)))
      .get();
    if (!row) throw notFound('Application');
    job = row;
  } else if (body.jobDescription?.trim()) {
    job = { title: '', company: '', description: body.jobDescription };
  }
  return {
    question: body.question,
    maxWords: body.maxWords,
    profile: toProfile(profileRow, user.email),
    job,
  };
}
