import { type DashboardStats, jobInputSchema, type MeResponse } from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { savedSearches, searchHits } from '../db/schema';
import { createTestContext, type TestContext } from '../test/harness';
import { addEvent, createApplication, transitionStatus } from './applications';
import { getDashboardStats } from './stats';

const NOW = new Date('2026-11-04T12:00:00.000Z'); // a Wednesday; its week starts Monday 2026-11-02

describe('dashboard stats', () => {
  let t: TestContext;
  let db: Db;
  let userId: string;
  let stats: DashboardStats;

  const add = async (
    company: string,
    url: string | null,
    status: 'saved' | 'applied',
    appliedAt: string | null,
  ) => {
    const { applicationId } = await createApplication(db, t.env, userId, {
      job: jobInputSchema.parse({ title: 'HR Generalist', company, url }),
      status,
      capturedVia: 'manual',
      source: 'manual',
      appliedAt,
      occurredAt: appliedAt ?? '2026-11-01T10:00:00.000Z',
    });
    return applicationId;
  };

  beforeAll(async () => {
    t = await createTestContext();
    db = createDb(t.env.DB);
    userId = (await t.json<MeResponse>('/api/me')).body.user.id;

    await add('Alpha', null, 'saved', null);
    const beta = await add(
      'Beta',
      'https://www.linkedin.com/jobs/view/4000000001/',
      'applied',
      '2026-11-03T09:00:00.000Z',
    );
    await transitionStatus(db, t.env, userId, beta, {
      proposed: 'viewed',
      source: 'email',
      eventType: 'email',
      alwaysRecord: true,
      occurredAt: '2026-11-04T08:00:00.000Z',
    });

    const gamma = await add(
      'Gamma',
      'https://job-boards.greenhouse.io/gamma/jobs/123',
      'applied',
      '2026-10-20T09:00:00.000Z',
    );
    await transitionStatus(db, t.env, userId, gamma, {
      proposed: 'interview',
      source: 'manual',
      occurredAt: '2026-10-28T09:00:00.000Z',
    });
    await addEvent(db, userId, gamma, {
      type: 'interview',
      source: 'manual',
      summary: 'Panel interview',
      scheduledAt: '2026-11-06T15:00:00.000Z',
      occurredAt: '2026-10-29T10:00:00.000Z',
    });

    const delta = await add('Delta', null, 'applied', '2026-09-01T09:00:00.000Z');
    await transitionStatus(db, t.env, userId, delta, {
      proposed: 'screening',
      source: 'manual',
      occurredAt: '2026-09-10T09:00:00.000Z',
    });
    await transitionStatus(db, t.env, userId, delta, {
      proposed: 'rejected',
      source: 'email',
      eventType: 'email',
      occurredAt: '2026-09-20T09:00:00.000Z',
    });
    await addEvent(db, userId, delta, {
      type: 'interview',
      source: 'manual',
      summary: 'Cancelled',
      scheduledAt: '2026-11-05T15:00:00.000Z',
      occurredAt: '2026-09-21T10:00:00.000Z',
    });

    await add(
      'Epsilon',
      'https://www.linkedin.com/jobs/view/4000000002/',
      'applied',
      '2026-10-01T09:00:00.000Z',
    );

    const searchId = crypto.randomUUID();
    await db.insert(savedSearches).values({
      id: searchId,
      userId,
      name: 'HR, Austin',
      titles: ['HR Generalist'],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const hit = (urlKey: string, dismissed: boolean) => ({
      id: crypto.randomUUID(),
      userId,
      searchId,
      urlKey,
      provider: 'adzuna' as const,
      sourceLabel: 'Adzuna',
      job: jobInputSchema.parse({ title: 'HR Generalist', company: 'Zeta' }),
      fit: {
        score: 70,
        titleMatch: 1,
        matchedSkills: [],
        missingSkills: [],
        reasons: [],
        flags: [],
        excluded: false,
      },
      fitScore: 70,
      firstSeenAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      isNew: true,
      dismissed,
    });
    await db.insert(searchHits).values([hit('a', false), hit('b', true)]);

    stats = await getDashboardStats(db, userId, NOW);
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('counts statuses, active and submitted applications', () => {
    expect(stats.total).toBe(5);
    expect(stats.counts).toMatchObject({
      saved: 1,
      applied: 1,
      viewed: 1,
      interview: 1,
      rejected: 1,
      offer: 0,
    });
    expect(stats.active).toBe(3);
    expect(stats.appliedLast7Days).toBe(1);
    expect(stats.appliedLast30Days).toBe(2);
  });

  it('computes response and interview rates over submitted applications', () => {
    // Beta viewed, Gamma interview, Delta rejected, out of 4 submitted.
    expect(stats.responseRate).toBe(0.75);
    // Gamma (interview) and Delta (reached screening before the rejection).
    expect(stats.interviewRate).toBe(0.5);
  });

  it('lists follow-ups due, oldest first, and upcoming interviews for live applications', () => {
    expect(stats.followUpsDue.map((a) => a.job.company)).toEqual(['Epsilon', 'Gamma']);
    expect(stats.upcomingInterviews).toEqual([
      expect.objectContaining({
        company: 'Gamma',
        summary: 'Panel interview',
        scheduledAt: '2026-11-06T15:00:00.000Z',
      }),
    ]);
  });

  it('buckets 12 ISO weeks of applications and employer responses', () => {
    expect(stats.weekly).toHaveLength(12);
    expect(stats.weekly[0]?.weekStart).toBe('2026-08-17');
    expect(stats.weekly[11]?.weekStart).toBe('2026-11-02');
    const week = (d: string) => stats.weekly.find((w) => w.weekStart === d);
    expect(week('2026-11-02')).toEqual({ weekStart: '2026-11-02', applied: 1, responses: 1 });
    expect(week('2026-10-26')).toEqual({ weekStart: '2026-10-26', applied: 0, responses: 1 });
    expect(week('2026-10-19')?.applied).toBe(1);
    expect(week('2026-09-28')?.applied).toBe(1);
    expect(week('2026-08-31')?.applied).toBe(1);
    expect(week('2026-09-07')?.responses).toBe(1);
    expect(week('2026-09-14')?.responses).toBe(1);
  });

  it('reports sources, recent activity and new matches', () => {
    expect(stats.bySource).toEqual([
      { source: 'linkedin', count: 2 },
      { source: 'manual', count: 2 },
      { source: 'greenhouse', count: 1 },
    ]);
    // 11 timeline entries in total (the list is capped at 15), newest first.
    expect(stats.recentEvents).toHaveLength(11);
    expect(stats.recentEvents[0]).toMatchObject({
      company: 'Beta',
      type: 'email',
      toStatus: 'viewed',
    });
    expect(stats.newMatches).toBe(1);
  });

  it('serves the stats over HTTP, scoped to the user', async () => {
    const mine = await t.json<DashboardStats>('/api/stats');
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(5);
    const other = await t.json<DashboardStats>('/api/stats', {
      headers: { 'x-dev-user': 'other@example.com' },
    });
    expect(other.body.total).toBe(0);
    expect(other.body.responseRate).toBe(0);
    expect(other.body.weekly).toHaveLength(12);
  });
});
