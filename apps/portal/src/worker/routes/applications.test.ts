import type {
  ApiErrorBody,
  ApplicationDetail,
  ApplicationEvent,
  ApplicationListItem,
  CreateApplicationRequest,
  ListResponse,
  ResolveUrlResponse,
} from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

const OTHER_USER = { 'x-dev-user': 'other@example.com' };

const request = (over: Partial<CreateApplicationRequest> = {}): CreateApplicationRequest => ({
  job: {
    title: 'HR Generalist',
    company: 'Northwind Freight',
    url: 'https://boards.greenhouse.io/northwind/jobs/4001?gh_src=abc',
    location: 'Austin, TX',
  },
  ...over,
});

describe('applications API', () => {
  let t: TestContext;

  const create = async (body: CreateApplicationRequest, headers: Record<string, string> = {}) =>
    t.json<ApplicationDetail>('/api/applications', jsonBody('POST', body, headers));

  const list = async (qs = '', headers: Record<string, string> = {}) =>
    t.json<ListResponse<ApplicationListItem>>(`/api/applications${qs}`, { headers });

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('creates an application with a canonical URL and a timeline entry', async () => {
    const { status, body } = await create(request());
    expect(status).toBe(201);
    expect(body.job.url).toBe('https://job-boards.greenhouse.io/northwind/jobs/4001');
    expect(body.job.source).toBe('greenhouse');
    expect(body.application.status).toBe('saved');
    expect(body.application.appliedAt).toBeNull();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.type).toBe('created');
  });

  it('rejects a duplicate with 409 and the existing id', async () => {
    const first = await list();
    const existing = first.body.items[0]?.id;
    const { status, body } = await t.json<ApiErrorBody>(
      '/api/applications',
      jsonBody(
        'POST',
        request({
          job: { ...request().job, url: 'https://boards.greenhouse.io/northwind/jobs/4001/' },
        }),
      ),
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe('duplicate');
    expect(body.error.details).toEqual({ applicationId: existing });
  });

  it('validates the body', async () => {
    const { status, body } = await t.json<ApiErrorBody>(
      '/api/applications',
      jsonBody('POST', { job: { title: '', company: 'X' } }),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
  });

  it('sets appliedAt and a follow-up when created past saved', async () => {
    const { status, body } = await create(
      request({
        job: { title: 'People Operations Manager', company: 'Contoso', url: null },
        status: 'applied',
        appliedAt: '2026-10-20T14:00:00.000Z',
        appliedVia: 'company_site',
        fitScore: 81,
        notes: 'Referred by a former colleague',
      }),
    );
    expect(status).toBe(201);
    expect(body.application.appliedAt).toBe('2026-10-20T14:00:00.000Z');
    expect(body.application.nextFollowUpAt).toBe('2026-10-27T14:00:00.000Z');
    expect(body.application.fitScore).toBe(81);
  });

  it('lists with filters, search, sorting and totals, scoped to the user', async () => {
    await create(
      request({
        job: {
          title: 'Recruiter (100% remote)',
          company: 'Fabrikam',
          url: null,
          location: 'Remote',
        },
        status: 'interview',
      }),
    );
    await create(
      request({ job: { title: 'Payroll Specialist', company: 'Elsewhere', url: null } }),
      OTHER_USER,
    );

    const all = await list();
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((i) => i.job.company)).toEqual([
      'Fabrikam',
      'Contoso',
      'Northwind Freight',
    ]);

    const active = await list('?status=applied,interview');
    expect(active.body.items.map((i) => i.status).sort()).toEqual(['applied', 'interview']);

    const byNotes = await list('?q=colleague');
    expect(byNotes.body.items.map((i) => i.job.company)).toEqual(['Contoso']);

    const literalPercent = await list('?q=100%25');
    expect(literalPercent.body.items.map((i) => i.job.company)).toEqual(['Fabrikam']);

    const company = await list('?sort=company');
    expect(company.body.items.map((i) => i.job.company)).toEqual([
      'Contoso',
      'Fabrikam',
      'Northwind Freight',
    ]);

    const fit = await list('?sort=fit');
    expect(fit.body.items[0]?.job.company).toBe('Contoso');

    const page = await list('?limit=1&offset=1');
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(3);

    const source = await list('?source=greenhouse');
    expect(source.body.items.map((i) => i.job.company)).toEqual(['Northwind Freight']);

    const other = await list('', OTHER_USER);
    expect(other.body.items.map((i) => i.job.company)).toEqual(['Elsewhere']);

    const bad = await t.json<ApiErrorBody>('/api/applications?status=applied,nope');
    expect(bad.status).toBe(400);
  });

  it("returns 404 for another user's application", async () => {
    const mine = (await list()).body.items[0]?.id;
    const { status } = await t.json<ApiErrorBody>(`/api/applications/${mine}`, {
      headers: OTHER_USER,
    });
    expect(status).toBe(404);
    const patch = await t.json<ApiErrorBody>(
      `/api/applications/${mine}`,
      jsonBody('PATCH', { notes: 'x' }, OTHER_USER),
    );
    expect(patch.status).toBe(404);
  });

  it('patches job and application fields', async () => {
    const target = (await list('?q=Contoso')).body.items[0];
    if (!target) throw new Error('missing fixture');
    const { status, body } = await t.json<ApplicationDetail>(
      `/api/applications/${target.id}`,
      jsonBody('PATCH', {
        job: {
          company: 'Contoso Ltd.',
          url: 'https://jobs.lever.co/contoso/5ac0f2a6-1111-2222-3333-444455556666?lever-source=x',
        },
        notes: null,
        nextFollowUpAt: '2026-11-10T09:00:00.000Z',
      }),
    );
    expect(status).toBe(200);
    expect(body.job.company).toBe('Contoso Ltd.');
    expect(body.job.url).toBe('https://jobs.lever.co/contoso/5ac0f2a6-1111-2222-3333-444455556666');
    expect(body.job.source).toBe('lever');
    expect(body.application.notes).toBeNull();
    expect(body.application.nextFollowUpAt).toBe('2026-11-10T09:00:00.000Z');
  });

  it('refuses a patch that would duplicate another saved job', async () => {
    const target = (await list('?q=Contoso')).body.items[0];
    const northwind = (await list('?q=Northwind')).body.items[0];
    const { status, body } = await t.json<ApiErrorBody>(
      `/api/applications/${target?.id}`,
      jsonBody('PATCH', { job: { url: 'https://boards.greenhouse.io/northwind/jobs/4001' } }),
    );
    expect(status).toBe(409);
    expect(body.error.details).toEqual({ applicationId: northwind?.id });

    const resume = await t.json<ApiErrorBody>(
      `/api/applications/${target?.id}`,
      jsonBody('PATCH', { resumeId: 'not-mine' }),
    );
    expect(resume.status).toBe(400);
  });

  it('changes status manually, records the timeline and schedules the interview', async () => {
    const target = (await list('?q=Northwind')).body.items[0];
    const { status, body } = await t.json<ApplicationDetail>(
      `/api/applications/${target?.id}/status`,
      jsonBody('POST', {
        status: 'interview',
        note: 'Recruiter called',
        interviewAt: '2026-11-12T16:00:00.000Z',
      }),
    );
    expect(status).toBe(200);
    expect(body.application.status).toBe('interview');
    expect(body.application.appliedAt).not.toBeNull();
    const types = body.events.map((e) => e.type);
    expect(types).toContain('status_change');
    expect(types).toContain('interview');
    const change = body.events.find((e) => e.type === 'status_change');
    expect(change).toMatchObject({ fromStatus: 'saved', toStatus: 'interview', source: 'manual' });
    expect(change?.summary).toBe('Saved → Interview: Recruiter called');
    expect(body.events.find((e) => e.type === 'interview')?.scheduledAt).toBe(
      '2026-11-12T16:00:00.000Z',
    );

    const again = await t.json<ApplicationDetail>(
      `/api/applications/${target?.id}/status`,
      jsonBody('POST', { status: 'interview' }),
    );
    expect(again.status).toBe(200);
    expect(again.body.events).toHaveLength(body.events.length);

    const offer = await t.json<ApplicationDetail>(
      `/api/applications/${target?.id}/status`,
      jsonBody('POST', { status: 'offer' }),
    );
    expect(offer.body.application.nextFollowUpAt).toBeNull();
  });

  it('adds notes without moving lastActivityAt, and interviews', async () => {
    const target = (await list('?q=Fabrikam')).body.items[0];
    if (!target) throw new Error('missing fixture');
    const note = await t.json<ApplicationEvent>(
      `/api/applications/${target.id}/notes`,
      jsonBody('POST', { text: 'Ask about the HRIS migration' }),
    );
    expect(note.status).toBe(201);
    expect(note.body).toMatchObject({ type: 'note', summary: 'Ask about the HRIS migration' });

    const interview = await t.json<ApplicationEvent>(
      `/api/applications/${target.id}/interviews`,
      jsonBody('POST', {
        scheduledAt: '2026-11-20T15:30:00Z',
        title: 'Panel interview',
        location: 'Zoom',
      }),
    );
    expect(interview.status).toBe(201);
    expect(interview.body).toMatchObject({
      type: 'interview',
      summary: 'Panel interview (Zoom)',
      scheduledAt: '2026-11-20T15:30:00.000Z',
    });

    const detail = await t.json<ApplicationDetail>(`/api/applications/${target.id}`);
    expect(detail.body.application.lastActivityAt).toBe(target.lastActivityAt);
    expect(detail.body.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['note', 'interview', 'created']),
    );
  });

  it('exports matching applications as CSV', async () => {
    const res = await t.fetch('/api/applications/export.csv?sort=company');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(
      /attachment; filename="applications-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const text = await res.text();
    const lines = text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^Company,Title,Status,Applied at/);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^Contoso Ltd\.,People Operations Manager,Applied,/);
    expect(text).not.toContain('Elsewhere');

    const filtered = await t.fetch('/api/applications/export.csv?status=offer');
    expect((await filtered.text()).trim().split('\r\n')).toHaveLength(2);
  });

  it('resolves URLs without fetching LinkedIn and reports existing applications', async () => {
    const linkedin = await t.json<ResolveUrlResponse>(
      '/api/applications/resolve-url',
      jsonBody('POST', { url: 'https://www.linkedin.com/jobs/view/4012345678/?trk=abc' }),
    );
    expect(linkedin.status).toBe(200);
    expect(linkedin.body.fetched).toBe(false);
    expect(linkedin.body.job).toMatchObject({
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
      source: 'linkedin',
      externalId: '4012345678',
    });
    expect(linkedin.body.message).toContain('browser extension');
    expect(linkedin.body.existingApplicationId).toBeNull();

    const saved = await t.json<ResolveUrlResponse>(
      '/api/applications/resolve-url',
      jsonBody('POST', { url: 'https://boards.greenhouse.io/northwind/jobs/4001' }),
    );
    const northwind = (await list('?q=Northwind')).body.items[0];
    expect(saved.body.existingApplicationId).toBe(northwind?.id);
  });

  it('deletes the application, its job and its timeline', async () => {
    const target = (await list('?q=Fabrikam')).body.items[0];
    const res = await t.fetch(`/api/applications/${target?.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect((await t.fetch(`/api/applications/${target?.id}`)).status).toBe(404);
    const events = await t.env.DB.prepare(
      'SELECT count(*) AS n FROM application_events WHERE application_id = ?',
    )
      .bind(target?.id)
      .first<{ n: number }>();
    expect(events?.n).toBe(0);
    const jobsLeft = await t.env.DB.prepare('SELECT count(*) AS n FROM jobs WHERE id = ?')
      .bind(target?.job.id)
      .first<{ n: number }>();
    expect(jobsLeft?.n).toBe(0);
  });
});
