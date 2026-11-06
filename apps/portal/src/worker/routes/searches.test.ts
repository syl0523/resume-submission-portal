import type {
  ApiErrorBody,
  ApplicationDetail,
  DashboardStats,
  DeepLinkGroup,
  DiscoverResponse,
  ListResponse,
  RunSearchResponse,
  SavedSearch,
  SavedSearchRequest,
  SearchHit,
} from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { refreshAlertSearches } from '../services/jobmatch';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

// Fake upstreams with synthetic postings. The same Northwind job appears on JSearch (employer link)
// and Adzuna, so the run should merge them.
const upstream = {
  extra: false,
};

function jsearchData() {
  const data = [
    {
      job_id: 'js-1',
      employer_name: 'Northwind Freight',
      job_publisher: 'LinkedIn',
      job_title: 'HR Generalist',
      job_apply_link: 'https://www.linkedin.com/jobs/view/4000000001',
      apply_options: [
        {
          publisher: 'Northwind Careers',
          apply_link: 'https://job-boards.greenhouse.io/northwind/jobs/101',
          is_direct: true,
        },
      ],
      job_description: 'Onboarding, employee relations and Workday HRIS.',
      job_city: 'Austin',
      job_state: 'TX',
      job_posted_at_datetime_utc: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      job_min_salary: 70000,
      job_max_salary: 82000,
      job_salary_period: 'YEAR',
    },
    {
      job_id: 'js-2',
      employer_name: 'Litware',
      job_publisher: 'Indeed',
      job_title: 'Warehouse Associate',
      job_apply_link: 'https://www.indeed.com/viewjob?jk=00000000000000aa',
      job_description: 'Pick and pack.',
      job_city: 'Austin',
      job_state: 'TX',
    },
  ];
  if (upstream.extra) {
    data.push({
      job_id: 'js-3',
      employer_name: 'Contoso',
      job_publisher: 'Contoso Careers',
      job_title: 'Senior HR Generalist',
      job_apply_link: 'https://jobs.lever.co/contoso/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab',
      job_description: 'Employee relations, FMLA, Workday.',
      job_city: 'Austin',
      job_state: 'TX',
    });
  }
  return data;
}

const requested: string[] = [];

const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  requested.push(url);
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.includes('jsearch.p.rapidapi.com/search'))
    return json({ status: 'OK', data: jsearchData() });
  if (url.includes('api.adzuna.com/v1/api/jobs/us/search')) {
    return json({
      count: 2,
      results: [
        {
          id: '4800000001',
          title: 'HR Generalist',
          description: 'Short.',
          redirect_url: 'https://www.adzuna.com/land/ad/4800000001',
          company: { display_name: 'Northwind Freight' },
          location: { display_name: 'Austin, Travis County' },
        },
        {
          id: '4800000002',
          title: 'Human Resources Business Partner',
          description: 'HRBP for a growing team. Workday, employee relations.',
          redirect_url: 'https://www.adzuna.com/land/ad/4800000002',
          company: { display_name: 'Fabrikam' },
          location: { display_name: 'Austin, TX' },
        },
      ],
    });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const SEARCH: SavedSearchRequest = {
  name: 'HR, Austin',
  titles: ['HR Generalist', 'HR Business Partner'],
  skills: ['Workday', 'Employee relations', 'Onboarding', 'FMLA'],
  locations: ['Austin, TX'],
  keywords: [],
  excludeKeywords: [],
};

describe('Job Match and Discover', () => {
  let t: TestContext;
  let search: SavedSearch;
  let firstRun: RunSearchResponse;

  beforeAll(async () => {
    t = await createTestContext({
      OUTBOUND_FETCH: fakeFetch,
      JSEARCH_API_KEY: 'test-key',
      ADZUNA_APP_ID: 'id',
      ADZUNA_APP_KEY: 'key',
    });
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('creates a saved search', async () => {
    const { status, body } = await t.json<SavedSearch>('/api/searches', jsonBody('POST', SEARCH));
    expect(status).toBe(201);
    expect(body).toMatchObject({
      name: 'HR, Austin',
      workMode: 'any',
      postedWithinDays: 7,
      alertsEnabled: true,
      totalHits: 0,
      lastRunAt: null,
    });
    search = body;
  });

  it('runs across providers, merges duplicates and ranks by fit', async () => {
    const { status, body } = await t.json<RunSearchResponse>(
      `/api/searches/${search.id}/run`,
      jsonBody('POST', { providers: ['jsearch', 'adzuna', 'usajobs'], maxQueries: 2 }),
    );
    expect(status).toBe(200);
    firstRun = body;
    expect(body.queries).toEqual([
      { title: 'HR Generalist', location: 'Austin, TX' },
      { title: 'HR Business Partner', location: 'Austin, TX' },
    ]);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'usajobs', error: 'not_configured' }),
        expect.objectContaining({ provider: 'jsearch', error: null }),
        expect.objectContaining({ provider: 'adzuna', error: null }),
      ]),
    );
    // Northwind (merged: employer link kept), Fabrikam HRBP, Litware warehouse.
    expect(body.hits).toHaveLength(3);
    expect(body.hits[0]?.job).toMatchObject({
      company: 'Northwind Freight',
      url: 'https://job-boards.greenhouse.io/northwind/jobs/101',
    });
    expect(body.hits[0]?.fit.score).toBeGreaterThan(body.hits[2]?.fit.score ?? 100);
    expect(body.hits.at(-1)?.job.company).toBe('Litware');
    expect(body.hits.every((h) => !h.isNew)).toBe(true);
    expect(body.search.lastRunAt).not.toBeNull();
    expect(body.deepLinks.map((g) => g.site)).toEqual(['linkedin', 'indeed', 'google']);
  });

  it('flags postings first seen on a later run as new', async () => {
    upstream.extra = true;
    const { body } = await t.json<RunSearchResponse>(
      `/api/searches/${search.id}/run`,
      jsonBody('POST', { providers: ['jsearch', 'adzuna'], maxQueries: 2 }),
    );
    const fresh = body.hits.filter((h) => h.isNew);
    expect(fresh.map((h) => h.job.company)).toEqual(['Contoso']);
    expect(body.search).toMatchObject({ newHits: 1, totalHits: 4 });

    const onlyNew = await t.json<ListResponse<SearchHit>>(
      `/api/searches/${search.id}/hits?onlyNew=true`,
    );
    expect(onlyNew.body.items.map((h) => h.job.company)).toEqual(['Contoso']);
    const stats = await t.json<DashboardStats>('/api/stats');
    expect(stats.body.newMatches).toBe(1);
  });

  it('saves a hit as an application and dismisses another', async () => {
    const hit = firstRun.hits[0];
    const saved = await t.json<ApplicationDetail>(
      `/api/searches/hits/${hit?.id}/save`,
      jsonBody('POST', {}),
    );
    expect(saved.status).toBe(201);
    expect(saved.body.job.capturedVia).toBe('search');
    expect(saved.body.application.fitScore).toBe(hit?.fit.score);
    const again = await t.json<ApplicationDetail>(
      `/api/searches/hits/${hit?.id}/save`,
      jsonBody('POST', {}),
    );
    expect(again.status).toBe(200);

    const litware = firstRun.hits.find((h) => h.job.company === 'Litware');
    expect(
      (await t.fetch(`/api/searches/hits/${litware?.id}/dismiss`, { method: 'POST' })).status,
    ).toBe(204);
    const hits = await t.json<ListResponse<SearchHit>>(`/api/searches/${search.id}/hits`);
    expect(hits.body.items.map((h) => h.job.company)).not.toContain('Litware');
    expect(hits.body.items.find((h) => h.id === hit?.id)?.applicationId).toBe(
      saved.body.application.id,
    );
  });

  it('serves deep links, edits and deletes', async () => {
    const links = await t.json<DeepLinkGroup[]>(`/api/searches/${search.id}/links`);
    expect(links.body[0]?.links[0]?.label).toBe('HR Generalist · Austin, TX');

    const edited = await t.json<SavedSearch>(
      `/api/searches/${search.id}`,
      jsonBody('PUT', {
        ...SEARCH,
        name: 'HR, Austin + remote',
        workMode: 'remote',
        alertsEnabled: false,
      }),
    );
    expect(edited.body).toMatchObject({
      name: 'HR, Austin + remote',
      workMode: 'remote',
      alertsEnabled: false,
    });

    const foreign = await t.json<ApiErrorBody>(`/api/searches/${search.id}`, {
      headers: { 'x-dev-user': 'other@example.com' },
    });
    expect(foreign.status).toBe(404);
  });

  it('refreshes alert searches daily and needs AI for resume drafts', async () => {
    const created = await t.json<SavedSearch>(
      '/api/searches',
      jsonBody('POST', { ...SEARCH, name: 'Alerts on' }),
    );
    const result = await refreshAlertSearches(createDb(t.env.DB), t.env, new Date());
    expect(result).toEqual({ run: 1, errors: 0 });
    const after = await t.json<SavedSearch>(`/api/searches/${created.body.id}`);
    expect(after.body.lastRunAt).not.toBeNull();

    const draft = await t.json<ApiErrorBody>(
      '/api/searches/draft-from-resume',
      jsonBody('POST', { resumeId: 'x' }),
    );
    expect(draft.status).toBe(501);
  });

  it('discovers jobs by keyword and marks ones already saved', async () => {
    const { status, body } = await t.json<DiscoverResponse>(
      '/api/discover?q=HR+Generalist&where=Austin%2C+TX',
    );
    expect(status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.providers.find((p) => p.provider === 'usajobs')?.error).toBe('not_configured');
    const northwind = body.items.find((i) => i.job.company === 'Northwind Freight');
    expect(northwind?.existingApplicationId).not.toBeNull();
    expect(body.items.length).toBeGreaterThanOrEqual(3);
  });

  it('defaults new searches and Discover to the San Francisco Bay Area', async () => {
    const { locations: _omitted, ...noPlace } = SEARCH;
    const created = await t.json<SavedSearch>(
      '/api/searches',
      jsonBody('POST', { ...noPlace, name: 'No place given' }),
    );
    expect(created.status).toBe(201);
    expect(created.body.locations).toEqual(['San Francisco Bay Area']);
    const cleared = await t.json<SavedSearch>(
      `/api/searches/${created.body.id}`,
      jsonBody('PUT', { ...SEARCH, name: 'Cleared', locations: [] }),
    );
    expect(cleared.body.locations).toEqual(['San Francisco Bay Area']);
    const nationwide = await t.json<SavedSearch>(
      `/api/searches/${created.body.id}`,
      jsonBody('PUT', { ...SEARCH, name: 'Whole US', locations: ['United States'] }),
    );
    expect(nationwide.body.locations).toEqual(['United States']);

    const jsearchQueries = () =>
      requested
        .splice(0)
        .filter((u) => u.includes('jsearch.p.rapidapi.com'))
        .map((u) => new URL(u).searchParams.get('query'));
    requested.length = 0;
    await t.json<DiscoverResponse>('/api/discover?q=SRE+Lead&provider=jsearch');
    expect(jsearchQueries()).toEqual(['SRE Lead in San Francisco Bay Area']);
    await t.json<DiscoverResponse>('/api/discover?q=SRE+Lead&provider=jsearch&where=Bay+Area');
    expect(jsearchQueries()).toEqual(['SRE Lead in San Francisco Bay Area']);
    await t.json<DiscoverResponse>('/api/discover?q=SRE+Lead&provider=jsearch&where=United+States');
    expect(jsearchQueries()).toEqual(['SRE Lead']);
    await t.json<DiscoverResponse>('/api/discover?q=SRE+Lead&provider=jsearch&remote=true');
    expect(jsearchQueries()).toEqual(['SRE Lead']);
  });

  it('deletes a saved search with its hits', async () => {
    expect((await t.fetch(`/api/searches/${search.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await t.fetch(`/api/searches/${search.id}`)).status).toBe(404);
  });
});
