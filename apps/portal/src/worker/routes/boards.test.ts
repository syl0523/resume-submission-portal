import type {
  ApiErrorBody,
  ApplicationDetail,
  BoardPosting,
  ListResponse,
  MeResponse,
  WatchedBoard,
} from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { watchedBoards } from '../db/schema';
import { markGhosted, runDailyJobs } from '../services/cron';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

// Synthetic Greenhouse board served by a fake upstream; `jobs` changes between syncs.
const upstream = {
  jobs: [
    {
      id: 101,
      title: 'HR Generalist',
      absolute_url: 'https://job-boards.greenhouse.io/northwind/jobs/101',
      location: { name: 'Austin, TX' },
    },
    {
      id: 102,
      title: 'Payroll Specialist',
      absolute_url: 'https://job-boards.greenhouse.io/northwind/jobs/102',
      location: { name: 'Remote' },
    },
  ] as Record<string, unknown>[],
  failLever: true,
};

const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('boards-api.greenhouse.io/v1/boards/northwind/jobs/')) {
    const id = Number(url.split('/').pop());
    const job = upstream.jobs.find((j) => j.id === id);
    return job ? json({ ...job, content: '&lt;p&gt;Full description&lt;/p&gt;' }) : json({}, 404);
  }
  if (url.includes('boards-api.greenhouse.io/v1/boards/northwind/jobs'))
    return json({ jobs: upstream.jobs });
  if (url.includes('boards-api.greenhouse.io/v1/boards/northwind'))
    return json({ name: 'Northwind Freight' });
  if (url.includes('api.lever.co/v0/postings/fabrikam'))
    return upstream.failLever ? json({}, 500) : json([]);
  return json({}, 404);
}) as typeof fetch;

describe('watched boards, daily sync and no-response marking', () => {
  let t: TestContext;
  let board: WatchedBoard;

  const postings = async (qs = '') =>
    (await t.json<ListResponse<BoardPosting>>(`/api/boards/postings${qs}`)).body;

  beforeAll(async () => {
    t = await createTestContext({ OUTBOUND_FETCH: fakeFetch });
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('adds a board from its careers URL and baselines the open postings', async () => {
    const { status, body } = await t.json<WatchedBoard>(
      '/api/boards',
      jsonBody('POST', { url: 'https://boards.greenhouse.io/northwind' }),
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({
      provider: 'greenhouse',
      token: 'northwind',
      companyName: 'Northwind Freight',
      openPostings: 2,
      newPostings: 0,
    });
    board = body;

    const list = await postings();
    expect(list.total).toBe(2);
    expect(list.items.every((p) => !p.isNew)).toBe(true);
  });

  it('refuses duplicates, unsupported pages and failing upstreams', async () => {
    const dup = await t.json<ApiErrorBody>(
      '/api/boards',
      jsonBody('POST', { provider: 'greenhouse', token: 'northwind' }),
    );
    expect(dup.status).toBe(409);
    const unsupported = await t.json<ApiErrorBody>(
      '/api/boards',
      jsonBody('POST', { url: 'https://careers.example.com/jobs' }),
    );
    expect(unsupported.status).toBe(400);
    const upstreamDown = await t.json<ApiErrorBody>(
      '/api/boards',
      jsonBody('POST', { url: 'https://jobs.lever.co/fabrikam' }),
    );
    expect(upstreamDown.status).toBe(502);
    expect(upstreamDown.body.error.code).toBe('upstream_error');
  });

  it('flags postings that appear later as new and drops closed ones', async () => {
    upstream.jobs = [
      upstream.jobs[0] as Record<string, unknown>,
      {
        id: 103,
        title: 'Talent Acquisition Partner',
        absolute_url: 'https://job-boards.greenhouse.io/northwind/jobs/103',
        location: { name: 'Dallas, TX' },
      },
    ];
    const synced = await t.json<WatchedBoard>(`/api/boards/${board.id}/sync`, { method: 'POST' });
    expect(synced.body).toMatchObject({ openPostings: 2, newPostings: 1, lastError: null });

    const fresh = await postings('?onlyNew=true');
    expect(fresh.items.map((p) => p.title)).toEqual(['Talent Acquisition Partner']);
    expect((await postings()).items.map((p) => p.title).sort()).toEqual([
      'HR Generalist',
      'Talent Acquisition Partner',
    ]);
    expect((await postings('?q=dallas')).total).toBe(1);
  });

  it('saves a posting as an application with full details, then dismisses another', async () => {
    const target = (await postings('?onlyNew=true')).items[0];
    const saved = await t.json<ApplicationDetail>(
      `/api/boards/postings/${target?.id}/save`,
      jsonBody('POST', { status: 'applied' }),
    );
    expect(saved.status).toBe(201);
    expect(saved.body.job).toMatchObject({
      title: 'Talent Acquisition Partner',
      company: 'Northwind Freight',
      source: 'greenhouse',
      capturedVia: 'board',
      description: 'Full description',
    });
    expect(saved.body.application.status).toBe('applied');
    expect((await postings('?onlyNew=true')).total).toBe(0);

    const again = await t.json<ApplicationDetail>(
      `/api/boards/postings/${target?.id}/save`,
      jsonBody('POST', {}),
    );
    expect(again.status).toBe(200);
    expect(again.body.application.id).toBe(saved.body.application.id);

    const other = (await postings()).items.find((p) => p.title === 'HR Generalist');
    expect(
      (await t.fetch(`/api/boards/postings/${other?.id}/dismiss`, { method: 'POST' })).status,
    ).toBe(204);
    expect((await postings()).items.map((p) => p.title)).toEqual(['Talent Acquisition Partner']);
  });

  it('the daily job syncs every board, records failures and keeps going', async () => {
    const db = createDb(t.env.DB);
    const me = await t.json<MeResponse>('/api/me');
    const now = new Date().toISOString();
    await db.insert(watchedBoards).values({
      id: crypto.randomUUID(),
      userId: me.body.user.id,
      provider: 'lever',
      token: 'fabrikam',
      companyName: 'Fabrikam',
      lastSyncedAt: null,
      lastError: null,
      createdAt: now,
    });
    const report = await runDailyJobs(t.env, new Date());
    expect(report).toMatchObject({ boardsSynced: 1, boardErrors: 1 });
    const boards = (await t.json<WatchedBoard[]>('/api/boards')).body;
    expect(boards.find((b) => b.token === 'fabrikam')?.lastError).toMatch(
      /Lever answered HTTP 500/,
    );
    expect(boards.find((b) => b.token === 'northwind')?.lastError).toBeNull();
  });

  it('marks silent applications as No response without touching their activity time', async () => {
    const db = createDb(t.env.DB);
    const quiet = await t.json<ApplicationDetail>(
      '/api/applications',
      jsonBody('POST', {
        job: { title: 'Benefits Analyst', company: 'Adventure Works', url: null },
        status: 'applied',
        appliedAt: '2026-09-01T12:00:00Z',
      }),
    );
    // Silent since September; the board application above is fresh.
    await t.env.DB.prepare('UPDATE applications SET last_activity_at = ? WHERE id = ?')
      .bind('2026-09-01T12:00:00.000Z', quiet.body.application.id)
      .run();

    // A clock just after the application was created, so the timeline order is stable on any day.
    const later = new Date(Date.now() + 60_000);
    const count = await markGhosted(db, t.env, later);
    expect(count).toBe(1);
    const detail = await t.json<ApplicationDetail>(
      `/api/applications/${quiet.body.application.id}`,
    );
    expect(detail.body.application).toMatchObject({
      status: 'ghosted',
      nextFollowUpAt: null,
      lastActivityAt: '2026-09-01T12:00:00.000Z',
    });
    expect(detail.body.events[0]).toMatchObject({
      source: 'system',
      toStatus: 'ghosted',
      summary: 'No response for 21 days',
    });

    expect(await markGhosted(db, t.env, later)).toBe(0);
  });

  it('deletes a board with its postings', async () => {
    expect((await t.fetch(`/api/boards/${board.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await postings()).total).toBe(0);
    expect((await t.fetch(`/api/boards/${board.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});
