import { draftFromResumeSchema, profileSchema } from '@jsp/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { profiles } from '../db/schema';
import type { AppEnv } from '../env';
import { toProfile } from '../lib/mappers';
import { nowIso } from '../lib/time';
import { validate } from '../lib/validate';
import { draftProfileFromResume, requireAi } from '../services/ai';
import { getResumeRow } from '../services/resumes';

/** Autofill profile (KAN-17, KAN-44). Mounted at /api/profile. PUT replaces the whole profile. */
export const profileRoutes = new Hono<AppEnv>();

profileRoutes.get('/', async (c) => {
  const row = await c.var.db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, c.var.user.id))
    .get();
  return c.json(toProfile(row, c.var.user.email));
});

profileRoutes.put('/', validate('json', profileSchema), async (c) => {
  const body = c.req.valid('json');
  const user = c.var.user;
  const fields = {
    fullName: body.fullName ?? null,
    headline: body.headline ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    location: body.location ?? null,
    address: body.address ?? null,
    linkedinUrl: body.linkedinUrl ?? null,
    websiteUrl: body.websiteUrl ?? null,
    githubUrl: body.githubUrl ?? null,
    workAuthorization: body.workAuthorization ?? null,
    summary: body.summary ?? null,
    skills: body.skills,
    languages: body.languages,
    experience: body.experience,
    education: body.education,
    customAnswers: body.customAnswers,
    updatedAt: nowIso(),
  };
  await c.var.db
    .insert(profiles)
    .values({ userId: user.id, ...fields })
    .onConflictDoUpdate({ target: profiles.userId, set: fields });
  return c.json(toProfile({ userId: user.id, ...fields }, user.email));
});

/** A draft read from the resume by AI. Not saved: the user reviews it and PUTs the profile. */
profileRoutes.post('/draft-from-resume', validate('json', draftFromResumeSchema), async (c) => {
  requireAi(c.env);
  const db = c.var.db;
  const user = c.var.user;
  const resume = await getResumeRow(db, user.id, c.req.valid('json').resumeId);
  const row = await db.select().from(profiles).where(eq(profiles.userId, user.id)).get();
  return c.json(await draftProfileFromResume(c.env, resume, toProfile(row, user.email)));
});
