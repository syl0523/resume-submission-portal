import { ACTIVE_STATUSES } from '@jsp/core';
import { and, eq, gte, inArray, isNotNull, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { applicationEvents, applications, jobs, users } from '../db/schema';
import type { AppEnv } from '../env';
import { notFound } from '../lib/errors';
import { buildCalendar, type IcsEvent } from '../lib/ics';
import { addDays, nowIso } from '../lib/time';

/**
 * Private iCalendar feed (KAN-44): interviews and follow-up reminders. No session; the secret
 * token in the URL (MeResponse.calendarUrl) authenticates. Mounted at /api/calendar.
 */
export const calendarRoutes = new Hono<AppEnv>().get('/:file', async (c) => {
  const file = c.req.param('file');
  if (!file.endsWith('.ics')) throw notFound('Calendar');
  const token = file.slice(0, -4);
  const db = c.var.db;
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.calendarToken, token))
    .get();
  if (!user) throw notFound('Calendar');

  const now = nowIso();
  const origin = new URL(c.req.url).origin;
  const [interviews, followUps] = await Promise.all([
    db
      .select({
        id: applicationEvents.id,
        applicationId: applicationEvents.applicationId,
        summary: applicationEvents.summary,
        scheduledAt: applicationEvents.scheduledAt,
        company: jobs.company,
        title: jobs.title,
      })
      .from(applicationEvents)
      .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(
        and(
          eq(applicationEvents.userId, user.id),
          eq(applicationEvents.type, 'interview'),
          gte(applicationEvents.scheduledAt, addDays(now, -30)),
          notInArray(applications.status, ['withdrawn']),
        ),
      )
      .all(),
    db
      .select({
        id: applications.id,
        nextFollowUpAt: applications.nextFollowUpAt,
        company: jobs.company,
        title: jobs.title,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(
        and(
          eq(applications.userId, user.id),
          inArray(applications.status, [...ACTIVE_STATUSES]),
          isNotNull(applications.nextFollowUpAt),
        ),
      )
      .all(),
  ]);

  const events: IcsEvent[] = [];
  for (const i of interviews) {
    if (!i.scheduledAt) continue;
    events.push({
      uid: `interview-${i.id}@resume-portal`,
      summary: `Interview: ${i.title} at ${i.company}`,
      description: i.summary,
      url: `${origin}/applications/${i.applicationId}`,
      start: i.scheduledAt,
      minutes: 60,
    });
  }
  for (const f of followUps) {
    if (!f.nextFollowUpAt) continue;
    events.push({
      uid: `follow-up-${f.id}@resume-portal`,
      summary: `Follow up: ${f.title} at ${f.company}`,
      url: `${origin}/applications/${f.id}`,
      date: f.nextFollowUpAt,
    });
  }

  return c.body(buildCalendar('Job search', events, now), 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': 'inline; filename="job-search.ics"',
    'cache-control': 'private, max-age=300',
  });
});
