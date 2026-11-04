import type {
  ApiErrorBody,
  ApplicationDetail,
  ExtLookupResponse,
  ExtProfileResponse,
  ExtSaveJobRequest,
  ExtSaveResponse,
  MeResponse,
  Resume,
} from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { savedSearches } from '../db/schema';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

const JOB_URL =
  'https://jobs.lever.co/example-co/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab?lever-source=linkedin';

const save = (over: Partial<ExtSaveJobRequest> = {}): ExtSaveJobRequest => ({
  job: {
    title: 'Talent Acquisition Partner',
    company: 'Example Co',
    url: JOB_URL,
    source: 'other',
    location: 'Remote (US)',
    remoteType: 'remote',
  },
  fitScore: 77,
  ...over,
});

describe('extension API', () => {
  let t: TestContext;
  let auth: Record<string, string>;
  let resume: Resume;

  beforeAll(async () => {
    t = await createTestContext();
    auth = { authorization: `Bearer ${await t.createToken()}` };

    const form = new FormData();
    form.set('file', new File(['Jane Doe, HR'], 'jane.txt', { type: 'text/plain' }));
    resume = (await t.json<Resume>('/api/resumes', { method: 'POST', body: form })).body;

    const me = await t.json<MeResponse>('/api/me');
    const now = new Date().toISOString();
    await createDb(t.env.DB)
      .insert(savedSearches)
      .values({
        id: crypto.randomUUID(),
        userId: me.body.user.id,
        name: 'Recruiting, remote US',
        titles: ['Talent Acquisition Partner', 'Recruiter'],
        skills: ['Greenhouse', 'Sourcing'],
        workMode: 'remote',
        createdAt: now,
        updatedAt: now,
      });
    await t.json('/api/profile', jsonBody('PUT', { fullName: 'Jane Doe', skills: ['Sourcing'] }));
  });

  afterAll(async () => {
    await t.settle();
    await t.dispose();
  });

  it('serves the autofill profile, resumes and saved searches', async () => {
    const { status, body } = await t.json<ExtProfileResponse>('/api/ext/profile', {
      headers: auth,
    });
    expect(status).toBe(200);
    expect(body.user.email).toBe('test@example.com');
    expect(body.profile).toMatchObject({ fullName: 'Jane Doe', email: 'test@example.com' });
    expect(body.resumes.map((r) => r.id)).toEqual([resume.id]);
    expect(body.searches).toHaveLength(1);
    expect(body.searches[0]).toMatchObject({
      name: 'Recruiting, remote US',
      workMode: 'remote',
      totalHits: 0,
      newHits: 0,
    });
  });

  it('saves a job, then reports it on lookup', async () => {
    const before = await t.json<ExtLookupResponse>(
      `/api/ext/lookup?url=${encodeURIComponent(JOB_URL)}`,
      { headers: auth },
    );
    expect(before.body.application).toBeNull();

    const { status, body } = await t.json<ExtSaveResponse>(
      '/api/ext/jobs',
      jsonBody('POST', save(), auth),
    );
    expect(status).toBe(201);
    expect(body.duplicate).toBe(false);
    expect(body.application).toMatchObject({ status: 'saved', fitScore: 77 });
    expect(body.application.job.source).toBe('lever');
    expect(body.portalUrl).toBe(`http://localhost/applications/${body.application.id}`);

    const detail = await t.json<ApplicationDetail>(`/api/applications/${body.application.id}`);
    expect(detail.body.job.capturedVia).toBe('extension');
    expect(detail.body.events[0]?.source).toBe('extension');

    const after = await t.json<ExtLookupResponse>(
      `/api/ext/lookup?url=${encodeURIComponent('https://jobs.lever.co/example-co/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab')}`,
      { headers: auth },
    );
    expect(after.body.application?.id).toBe(body.application.id);
  });

  it('marks an already saved job applied and records the resume used', async () => {
    const { status, body } = await t.json<ExtSaveResponse>(
      '/api/ext/jobs',
      jsonBody(
        'POST',
        save({ markApplied: true, resumeId: resume.id, appliedVia: 'company_site' }),
        auth,
      ),
    );
    expect(status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(body.application).toMatchObject({
      status: 'applied',
      resumeId: resume.id,
      appliedVia: 'company_site',
    });
    expect(body.application.appliedAt).not.toBeNull();

    const detail = await t.json<ApplicationDetail>(`/api/applications/${body.application.id}`);
    expect(detail.body.events[0]).toMatchObject({
      type: 'status_change',
      source: 'extension',
      fromStatus: 'saved',
      toStatus: 'applied',
    });

    const again = await t.json<ExtSaveResponse>(
      '/api/ext/jobs',
      jsonBody('POST', save({ markApplied: true }), auth),
    );
    expect(again.status).toBe(200);
    expect(again.body.application.status).toBe('applied');
  });

  it('downloads resumes for autofill, only the token owner’s', async () => {
    const res = await t.fetch(`/api/ext/resumes/${resume.id}/file`, { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe('Jane Doe, HR');

    const otherAuth = { authorization: `Bearer ${await t.createToken('other@example.com')}` };
    const other = await t.fetch(`/api/ext/resumes/${resume.id}/file`, { headers: otherAuth });
    expect(other.status).toBe(404);
    await other.text();
  });

  it('validates input and needs AI for answers', async () => {
    const bad = await t.json<ApiErrorBody>('/api/ext/lookup?url=not-a-url', { headers: auth });
    expect(bad.status).toBe(400);

    const answer = await t.json<ApiErrorBody>(
      '/api/ext/answer',
      jsonBody('POST', { question: 'Why do you want to work here?' }, auth),
    );
    expect(answer.status).toBe(501);
    expect(answer.body.error.code).toBe('feature_disabled');
  });
});
