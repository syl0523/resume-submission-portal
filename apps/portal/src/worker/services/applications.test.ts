import type { MeResponse } from '@jsp/core';
import { jobInputSchema } from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { createTestContext, type TestContext } from '../test/harness';
import {
  addEvent,
  createApplication,
  getApplicationDetail,
  prepareJob,
  transitionStatus,
} from './applications';

const job = (over: Record<string, unknown> = {}) =>
  jobInputSchema.parse({
    title: 'HR Business Partner',
    company: 'Acme Logistics, Inc.',
    url: 'https://www.linkedin.com/jobs/view/hr-business-partner-at-acme-4012345678/?trk=x',
    ...over,
  });

describe('application service', () => {
  let t: TestContext;
  let db: Db;
  let userId: string;

  beforeAll(async () => {
    t = await createTestContext();
    db = createDb(t.env.DB);
    userId = (await t.json<MeResponse>('/api/me')).body.user.id;
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('canonicalises URLs and infers source and company key', () => {
    const p = prepareJob(job({ source: 'manual' }));
    expect(p.url).toBe('https://www.linkedin.com/jobs/view/4012345678/');
    expect(p.source).toBe('linkedin');
    expect(p.externalId).toBe('4012345678');
    expect(p.companyKey).toBe('acme logistics');
  });

  it('creates job, application and timeline, then dedupes', async () => {
    const first = await createApplication(db, t.env, userId, {
      job: job(),
      status: 'applied',
      capturedVia: 'extension',
      source: 'extension',
      appliedVia: 'linkedin_easy_apply',
      occurredAt: '2026-10-01T15:00:00.000Z',
    });
    expect(first.duplicate).toBe(false);

    const detail = await getApplicationDetail(db, userId, first.applicationId);
    expect(detail.application.status).toBe('applied');
    expect(detail.application.appliedAt).toBe('2026-10-01T15:00:00.000Z');
    expect(detail.application.nextFollowUpAt).toBe('2026-10-08T15:00:00.000Z');
    expect(detail.job.source).toBe('linkedin');
    expect(detail.events).toHaveLength(1);

    const again = await createApplication(db, t.env, userId, {
      job: job({ url: 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678' }),
      status: 'saved',
      capturedVia: 'manual',
      source: 'manual',
    });
    expect(again).toEqual({ applicationId: first.applicationId, duplicate: true });
  });

  it('moves forward, ignores backwards automation, records emails', async () => {
    const { applicationId } = await createApplication(db, t.env, userId, {
      job: job({ url: 'https://jobs.lever.co/acme/1f2e3d4c-5b6a-4987-8a1b-2c3d4e5f6a7b' }),
      status: 'saved',
      capturedVia: 'manual',
      source: 'manual',
    });

    const applied = await transitionStatus(db, t.env, userId, applicationId, {
      proposed: 'applied',
      source: 'manual',
    });
    expect(applied.changed).toBe(true);

    const viewed = await transitionStatus(db, t.env, userId, applicationId, {
      proposed: 'interview',
      source: 'email',
      eventType: 'email',
      alwaysRecord: true,
      summary: 'Interview invitation',
    });
    expect(viewed).toMatchObject({ changed: true, from: 'applied', to: 'interview' });

    const back = await transitionStatus(db, t.env, userId, applicationId, {
      proposed: 'viewed',
      source: 'email',
      eventType: 'email',
      alwaysRecord: true,
      summary: 'Your application was viewed',
    });
    expect(back.changed).toBe(false);
    expect(back.eventId).not.toBeNull();

    await addEvent(db, userId, applicationId, {
      type: 'interview',
      source: 'manual',
      summary: 'Phone screen',
      scheduledAt: '2026-11-10T14:00:00-05:00',
    });

    const detail = await getApplicationDetail(db, userId, applicationId);
    expect(detail.application.status).toBe('interview');
    expect(detail.application.appliedAt).not.toBeNull();
    expect(detail.events.map((e) => e.type).sort()).toEqual(
      ['created', 'email', 'email', 'interview', 'status_change'].sort(),
    );
    expect(detail.events.find((e) => e.type === 'interview')?.scheduledAt).toBe(
      '2026-11-10T19:00:00.000Z',
    );
  });

  it('scopes everything to the user', async () => {
    const other = (
      await t.json<MeResponse>('/api/me', { headers: { 'x-dev-user': 'other@x.com' } })
    ).body.user.id;
    const { applicationId } = await createApplication(db, t.env, userId, {
      job: job({ url: 'https://example.com/careers/42' }),
      status: 'saved',
      capturedVia: 'manual',
      source: 'manual',
    });
    await expect(getApplicationDetail(db, other, applicationId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      transitionStatus(db, t.env, other, applicationId, { proposed: 'applied', source: 'manual' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
