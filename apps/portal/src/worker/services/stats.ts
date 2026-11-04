import {
  ACTIVE_STATUSES,
  type ApplicationStatus,
  type DashboardStats,
  type JobSource,
  type WeeklyPoint,
} from '@jsp/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client';
import { applicationEvents, applications, jobs, searchHits } from '../db/schema';
import { toEvent, toListItem } from '../lib/mappers';
import { addDays, weekStart } from '../lib/time';

/** Dashboard numbers (KAN-18). Definitions are in docs/api.md, section Dashboard. */

/** Statuses that mean the employer reacted. */
export const RESPONDED_STATUSES: ApplicationStatus[] = [
  'viewed',
  'screening',
  'interview',
  'offer',
  'rejected',
];
/** Statuses that count towards the interview rate. */
const INTERVIEW_STATUSES: ApplicationStatus[] = ['screening', 'interview', 'offer'];

const WEEKS = 12;
const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0);

export async function getDashboardStats(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<DashboardStats> {
  const nowIso = now.toISOString();
  const firstWeek = addDays(`${weekStart(nowIso)}T00:00:00.000Z`, -7 * (WEEKS - 1));
  const mine = eq(applications.userId, userId);
  const eventWithJob = {
    event: applicationEvents,
    company: jobs.company,
    title: jobs.title,
  };

  const [
    statusRows,
    sourceRows,
    appliedWindows,
    interviewReach,
    followUps,
    interviews,
    recent,
    appliedDates,
    responseDates,
    newMatches,
  ] = await Promise.all([
    db
      .select({ status: applications.status, n: count() })
      .from(applications)
      .where(mine)
      .groupBy(applications.status)
      .all(),
    db
      .select({ source: jobs.source, n: count() })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(mine)
      .groupBy(jobs.source)
      .all(),
    db
      .select({
        last7: sql<number>`coalesce(sum(case when ${applications.appliedAt} >= ${addDays(nowIso, -7)} then 1 else 0 end), 0)`,
        last30: sql<number>`coalesce(sum(case when ${applications.appliedAt} >= ${addDays(nowIso, -30)} then 1 else 0 end), 0)`,
      })
      .from(applications)
      .where(and(mine, lte(applications.appliedAt, nowIso)))
      .get(),
    // Submitted applications that ever reached screening or later: current status, or any
    // timeline entry that moved them there (manual, email or import).
    db
      .select({ n: count() })
      .from(applications)
      .where(
        and(
          mine,
          ne(applications.status, 'saved'),
          or(
            inArray(applications.status, INTERVIEW_STATUSES),
            sql`exists (select 1 from ${applicationEvents} where ${applicationEvents.applicationId} = ${applications.id} and ${inArray(applicationEvents.toStatus, INTERVIEW_STATUSES)})`,
          ),
        ),
      )
      .get(),
    db
      .select({ app: applications, job: jobs })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(
        and(
          mine,
          inArray(applications.status, [...ACTIVE_STATUSES]),
          isNotNull(applications.nextFollowUpAt),
          lte(applications.nextFollowUpAt, nowIso),
        ),
      )
      .orderBy(asc(applications.nextFollowUpAt))
      .limit(10)
      .all(),
    db
      .select(eventWithJob)
      .from(applicationEvents)
      .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(
        and(
          eq(applicationEvents.userId, userId),
          eq(applicationEvents.type, 'interview'),
          gte(applicationEvents.scheduledAt, nowIso),
          notInArray(applications.status, ['rejected', 'withdrawn']),
        ),
      )
      .orderBy(asc(applicationEvents.scheduledAt))
      .limit(10)
      .all(),
    db
      .select(eventWithJob)
      .from(applicationEvents)
      .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(eq(applicationEvents.userId, userId))
      .orderBy(desc(applicationEvents.occurredAt), desc(applicationEvents.createdAt))
      .limit(15)
      .all(),
    db
      .select({ at: applications.appliedAt })
      .from(applications)
      .where(and(mine, gte(applications.appliedAt, firstWeek), lte(applications.appliedAt, nowIso)))
      .all(),
    // Real transitions only (fromStatus set), whichever way they arrived.
    db
      .select({ at: applicationEvents.occurredAt })
      .from(applicationEvents)
      .where(
        and(
          eq(applicationEvents.userId, userId),
          isNotNull(applicationEvents.fromStatus),
          inArray(applicationEvents.toStatus, RESPONDED_STATUSES),
          gte(applicationEvents.occurredAt, firstWeek),
          lte(applicationEvents.occurredAt, nowIso),
        ),
      )
      .all(),
    db
      .select({ n: count() })
      .from(searchHits)
      .where(
        and(
          eq(searchHits.userId, userId),
          eq(searchHits.isNew, true),
          eq(searchHits.dismissed, false),
          isNull(searchHits.applicationId),
        ),
      )
      .get(),
  ]);

  const counts: Record<ApplicationStatus, number> = {
    saved: 0,
    applied: 0,
    viewed: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
    ghosted: 0,
  };
  for (const row of statusRows) counts[row.status] = row.n;
  const total = statusRows.reduce((sum, r) => sum + r.n, 0);
  const submitted = total - counts.saved;
  const responded = RESPONDED_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const active = ACTIVE_STATUSES.reduce((sum, s) => sum + counts[s], 0);

  const weekly: WeeklyPoint[] = Array.from({ length: WEEKS }, (_, i) => ({
    weekStart: addDays(firstWeek, 7 * i).slice(0, 10),
    applied: 0,
    responses: 0,
  }));
  const byWeek = new Map(weekly.map((w) => [w.weekStart, w]));
  for (const { at } of appliedDates) {
    const w = at ? byWeek.get(weekStart(at)) : undefined;
    if (w) w.applied += 1;
  }
  for (const { at } of responseDates) {
    const w = byWeek.get(weekStart(at));
    if (w) w.responses += 1;
  }

  const bySource: { source: JobSource; count: number }[] = sourceRows
    .map((r) => ({ source: r.source, count: r.n }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  return {
    counts,
    total,
    active,
    appliedLast7Days: Number(appliedWindows?.last7 ?? 0),
    appliedLast30Days: Number(appliedWindows?.last30 ?? 0),
    responseRate: ratio(responded, submitted),
    interviewRate: ratio(interviewReach?.n ?? 0, submitted),
    followUpsDue: followUps.map((r) => toListItem(r.app, r.job)),
    upcomingInterviews: interviews.map((r) => ({
      eventId: r.event.id,
      applicationId: r.event.applicationId,
      company: r.company,
      title: r.title,
      summary: r.event.summary,
      scheduledAt: r.event.scheduledAt ?? nowIso,
    })),
    recentEvents: recent.map((r) => ({ ...toEvent(r.event), company: r.company, title: r.title })),
    weekly,
    bySource,
    newMatches: newMatches?.n ?? 0,
  };
}
