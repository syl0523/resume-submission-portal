import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../errors';
import { searchAdzuna } from '../search/adzuna';
import { searchJSearch } from '../search/jsearch';
import { searchUsaJobs } from '../search/usajobs';
import { fetchBoardJobs, fetchJobFromUrl, parseBoardUrl } from './index';

// Recorded-shape fixtures (trimmed, synthetic values) served by an injectable fetch.

type Route = { match: string; body: unknown; status?: number };

function fakeFetch(routes: Route[], seen: { url: string; headers: Headers }[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: new Headers(init?.headers) });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('board URLs', () => {
  it('recognises careers pages on supported ATSs', () => {
    expect(parseBoardUrl('https://job-boards.greenhouse.io/Northwind/jobs/123')).toEqual({
      provider: 'greenhouse',
      token: 'northwind',
    });
    expect(parseBoardUrl('https://boards.greenhouse.io/embed/job_board?for=acme')).toEqual({
      provider: 'greenhouse',
      token: 'acme',
    });
    expect(parseBoardUrl('https://jobs.lever.co/fabrikam')).toEqual({
      provider: 'lever',
      token: 'fabrikam',
    });
    expect(parseBoardUrl('https://jobs.ashbyhq.com/Litware/abc')).toEqual({
      provider: 'ashby',
      token: 'Litware',
    });
    expect(parseBoardUrl('https://jobs.smartrecruiters.com/BlueYonder1')).toEqual({
      provider: 'smartrecruiters',
      token: 'BlueYonder1',
    });
    expect(parseBoardUrl('https://www.linkedin.com/company/acme')).toBeNull();
  });
});

describe('board clients', () => {
  it('Greenhouse: lists without descriptions when asked (large boards)', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const fetch = fakeFetch(
      [
        {
          match: '/boards/northwind/jobs',
          body: {
            jobs: [
              {
                id: 7,
                title: 'Site Reliability Engineer',
                absolute_url: 'https://job-boards.greenhouse.io/northwind/jobs/7',
              },
            ],
          },
        },
      ],
      seen,
    );
    const jobs = await fetchBoardJobs('greenhouse', 'northwind', {
      fetch,
      companyName: 'Northwind Freight',
      descriptions: false,
    });
    expect(seen.map((s) => s.url)).toEqual([
      'https://boards-api.greenhouse.io/v1/boards/northwind/jobs',
    ]);
    expect(jobs[0]?.job).toMatchObject({
      title: 'Site Reliability Engineer',
      company: 'Northwind Freight',
    });
    expect(jobs[0]?.job.description ?? null).toBeNull();
  });

  it('Greenhouse: postings with decoded descriptions and the board name', async () => {
    const fetch = fakeFetch([
      {
        match: '/boards/northwind/jobs?content=true',
        body: {
          jobs: [
            {
              id: 4433221,
              title: 'HR Generalist',
              absolute_url: 'https://job-boards.greenhouse.io/northwind/jobs/4433221',
              location: { name: 'Austin, TX (Hybrid)' },
              updated_at: '2026-10-30T12:00:00-04:00',
              first_published: '2026-10-28T09:00:00-04:00',
              content: '&lt;p&gt;Partner with managers &amp;amp; employees.&lt;/p&gt;',
            },
            { title: 'No id, skipped' },
          ],
        },
      },
      { match: '/boards/northwind', body: { name: 'Northwind Freight' } },
    ]);
    const jobs = await fetchBoardJobs('greenhouse', 'northwind', { fetch });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      externalId: '4433221',
      job: {
        title: 'HR Generalist',
        company: 'Northwind Freight',
        source: 'greenhouse',
        remoteType: 'hybrid',
        description: 'Partner with managers & employees.',
        postedAt: '2026-10-28T09:00:00-04:00',
      },
    });
  });

  it('Lever: yearly salary, workplace type and plain descriptions', async () => {
    const fetch = fakeFetch([
      {
        match: 'api.lever.co/v0/postings/fabrikam?mode=json',
        body: [
          {
            id: '0f1e2d3c-aaaa-bbbb-cccc-1234567890ab',
            text: 'Recruiter',
            hostedUrl: 'https://jobs.lever.co/fabrikam/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab',
            createdAt: 1_793_000_000_000,
            categories: { location: 'Remote - US', commitment: 'Full-time' },
            descriptionPlain: 'Hire great people.',
            workplaceType: 'remote',
            salaryRange: { min: 80000, max: 95000, currency: 'USD', interval: 'per-year-salary' },
          },
        ],
      },
    ]);
    const [job] = await fetchBoardJobs('lever', 'fabrikam', { fetch, companyName: 'Fabrikam' });
    expect(job?.job).toMatchObject({
      company: 'Fabrikam',
      remoteType: 'remote',
      employmentType: 'Full-time',
      salaryMin: 80000,
      salaryMax: 95000,
      salaryCurrency: 'USD',
    });
  });

  it('Ashby: listed postings only, compensation from the summary', async () => {
    const fetch = fakeFetch([
      {
        match: 'posting-api/job-board/litware',
        body: {
          jobs: [
            {
              id: '11111111-2222-3333-4444-555555555555',
              title: 'Talent Partner',
              location: 'New York, NY',
              isListed: true,
              workplaceType: 'Hybrid',
              employmentType: 'FullTime',
              descriptionPlain: 'Own hiring.',
              publishedAt: '2026-10-29T10:00:00Z',
              jobUrl: 'https://jobs.ashbyhq.com/litware/11111111-2222-3333-4444-555555555555',
              compensation: {
                summaryComponents: [
                  {
                    compensationType: 'Salary',
                    interval: '1 YEAR',
                    currencyCode: 'USD',
                    minValue: 120000,
                    maxValue: 140000,
                  },
                ],
              },
            },
            { id: 'hidden', title: 'Internal', isListed: false },
          ],
        },
      },
    ]);
    const jobs = await fetchBoardJobs('ashby', 'litware', { fetch });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.job).toMatchObject({
      company: 'Litware',
      remoteType: 'hybrid',
      employmentType: 'Full-Time',
      salaryMin: 120000,
    });
  });

  it('SmartRecruiters: pages through postings', async () => {
    const fetch = fakeFetch([
      {
        match: 'companies/BlueYonder1/postings?limit=100&offset=0',
        body: {
          totalFound: 1,
          content: [
            {
              id: '744000012345678',
              name: 'HR Coordinator',
              releasedDate: '2026-10-27T08:00:00.000Z',
              company: { identifier: 'BlueYonder1', name: 'Blue Yonder Airlines' },
              location: { city: 'Seattle', region: 'WA', country: 'us', remote: false },
              typeOfEmployment: { label: 'Full-time' },
            },
          ],
        },
      },
    ]);
    const [job] = await fetchBoardJobs('smartrecruiters', 'BlueYonder1', { fetch });
    expect(job?.job).toMatchObject({
      company: 'Blue Yonder Airlines',
      location: 'Seattle, WA, US',
      url: 'https://jobs.smartrecruiters.com/BlueYonder1/744000012345678',
    });
  });

  it('turns upstream failures into UpstreamError', async () => {
    const fetch = fakeFetch([{ match: 'boards/missing', body: {}, status: 404 }]);
    await expect(fetchBoardJobs('greenhouse', 'missing', { fetch })).rejects.toBeInstanceOf(
      UpstreamError,
    );
    const broken = fakeFetch([{ match: 'postings/acme', body: { nope: true } }]);
    await expect(fetchBoardJobs('lever', 'acme', { fetch: broken })).rejects.toThrow(
      /unexpected answer/,
    );
  });

  it('fetches one posting by URL, and never for unsupported sites', async () => {
    const fetch = fakeFetch([
      {
        match: '/boards/northwind/jobs/4433221',
        body: {
          id: 4433221,
          title: 'HR Generalist',
          absolute_url: 'https://job-boards.greenhouse.io/northwind/jobs/4433221',
          location: { name: 'Austin, TX' },
        },
      },
      { match: '/boards/northwind', body: { name: 'Northwind Freight' } },
    ]);
    const draft = await fetchJobFromUrl(
      'https://boards.greenhouse.io/northwind/jobs/4433221?gh_src=x',
      { fetch },
    );
    expect(draft).toMatchObject({
      title: 'HR Generalist',
      company: 'Northwind Freight',
      externalId: '4433221',
    });

    const seen: { url: string; headers: Headers }[] = [];
    expect(
      await fetchJobFromUrl('https://www.linkedin.com/jobs/view/4012345678/', {
        fetch: fakeFetch([], seen),
      }),
    ).toBeNull();
    expect(seen).toHaveLength(0);
  });
});

describe('search clients: the San Francisco Bay Area', () => {
  const empty = [
    { match: 'api.adzuna.com', body: { count: 0, results: [] } },
    { match: 'data.usajobs.gov', body: { SearchResult: { SearchResultItems: [] } } },
    { match: 'jsearch.p.rapidapi.com', body: { status: 'OK', data: [] } },
  ];

  it('JSearch asks for "<title> in San Francisco Bay Area"', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    await searchJSearch(
      { apiKey: 'k', query: 'SRE lead', location: 'Bay Area' },
      { fetch: fakeFetch(empty, seen) },
    );
    expect(new URL(seen[0]?.url ?? '').searchParams.get('query')).toBe(
      'SRE lead in San Francisco Bay Area',
    );
  });

  it('Adzuna searches around San Francisco with a radius in km', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    await searchAdzuna(
      { appId: 'id', appKey: 'key', what: 'incident manager', where: 'San Francisco Bay Area' },
      { fetch: fakeFetch(empty, seen) },
    );
    const u = new URL(seen[0]?.url ?? '');
    expect(u.searchParams.get('where')).toBe('San Francisco');
    expect(u.searchParams.get('distance')).toBe('80');
  });

  it('USAJOBS searches around San Francisco, California with a radius in miles', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    await searchUsaJobs(
      {
        apiKey: 'k',
        userAgent: 'a@example.com',
        keyword: 'it specialist',
        location: 'SF Bay Area',
      },
      { fetch: fakeFetch(empty, seen) },
    );
    const u = new URL(seen[0]?.url ?? '');
    expect(u.searchParams.get('LocationName')).toBe('San Francisco, California');
    expect(u.searchParams.get('Radius')).toBe('50');
  });
});

describe('search clients', () => {
  it('Adzuna: US index, actual salaries only', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const fetch = fakeFetch(
      [
        {
          match: 'api.adzuna.com/v1/api/jobs/us/search/1',
          body: {
            count: 1234,
            results: [
              {
                id: '4800000001',
                title: '<strong>HR</strong> Generalist',
                description: 'Support employees…',
                created: '2026-11-01T10:00:00Z',
                redirect_url: 'https://www.adzuna.com/land/ad/4800000001?se=x',
                company: { display_name: 'Tailspin Toys' },
                location: { display_name: 'Dallas, Dallas County' },
                salary_min: 61000.5,
                salary_max: 70000,
                salary_is_predicted: '0',
                contract_time: 'full_time',
              },
            ],
          },
        },
      ],
      seen,
    );
    const r = await searchAdzuna(
      { appId: 'id', appKey: 'key', what: 'hr generalist', where: 'Dallas, TX', maxDaysOld: 7 },
      { fetch },
    );
    expect(r.total).toBe(1234);
    expect(r.items[0]).toMatchObject({
      sourceLabel: 'Adzuna',
      job: {
        title: 'HR Generalist',
        company: 'Tailspin Toys',
        source: 'adzuna',
        salaryMin: 61001,
        salaryCurrency: 'USD',
        employmentType: 'full-time',
      },
    });
    expect(seen[0]?.url).toContain('max_days_old=7');
    expect(seen[0]?.url).toContain('where=Dallas%2C+TX');
  });

  it('USAJOBS: sends the required headers and maps federal postings', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const fetch = fakeFetch(
      [
        {
          match: 'data.usajobs.gov/api/search',
          body: {
            SearchResult: {
              SearchResultCountAll: 1,
              SearchResultItems: [
                {
                  MatchedObjectId: '820000001',
                  MatchedObjectDescriptor: {
                    PositionTitle: 'Human Resources Specialist',
                    PositionURI: 'https://www.usajobs.gov/job/820000001',
                    PositionLocationDisplay: 'Austin, Texas',
                    OrganizationName: 'Department of Example Affairs',
                    PublicationStartDate: '2026-10-30T00:00:00.0000',
                    PositionRemuneration: [
                      { MinimumRange: '72553', MaximumRange: '94317', RateIntervalCode: 'PA' },
                    ],
                    PositionSchedule: [{ Name: 'Full-time' }],
                    UserArea: {
                      Details: { JobSummary: 'Advise managers.', TeleworkEligible: true },
                    },
                  },
                },
              ],
            },
          },
        },
      ],
      seen,
    );
    const r = await searchUsaJobs(
      { apiKey: 'k', userAgent: 'jane.doe@example.com', keyword: 'human resources', remote: true },
      { fetch },
    );
    expect(r.items[0]?.job).toMatchObject({
      source: 'usajobs',
      company: 'Department of Example Affairs',
      remoteType: 'hybrid',
      salaryMin: 72553,
      salaryMax: 94317,
    });
    expect(seen[0]?.headers.get('authorization-key')).toBe('k');
    expect(seen[0]?.headers.get('user-agent')).toBe('jane.doe@example.com');
    expect(seen[0]?.url).toContain('RemoteIndicator=True');
  });

  it('JSearch: publisher-based source and the employer apply link', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const fetch = fakeFetch(
      [
        {
          match: 'jsearch.p.rapidapi.com/search',
          body: {
            status: 'OK',
            data: [
              {
                job_id: 'abc==',
                employer_name: 'Contoso',
                job_publisher: 'LinkedIn',
                job_title: 'People Operations Manager',
                job_apply_link: 'https://www.linkedin.com/jobs/view/4012345679',
                job_is_remote: true,
                job_city: 'Austin',
                job_state: 'TX',
                job_posted_at_datetime_utc: '2026-11-02T12:00:00.000Z',
                job_min_salary: 90000,
                job_max_salary: 110000,
                job_salary_period: 'YEAR',
                job_employment_type: 'FULLTIME',
                apply_options: [
                  {
                    publisher: 'LinkedIn',
                    apply_link: 'https://www.linkedin.com/jobs/view/4012345679',
                    is_direct: false,
                  },
                  {
                    publisher: 'Contoso Careers',
                    apply_link: 'https://job-boards.greenhouse.io/contoso/jobs/777',
                    is_direct: true,
                  },
                ],
              },
              {
                job_id: 'def==',
                employer_name: 'Litware',
                job_publisher: 'Indeed',
                job_title: 'Recruiter',
                job_apply_link: 'https://www.indeed.com/viewjob?jk=0123456789abcdef',
                job_salary_period: 'HOUR',
                job_min_salary: 30,
              },
            ],
          },
        },
      ],
      seen,
    );
    const r = await searchJSearch(
      {
        apiKey: 'k',
        query: 'people operations',
        location: 'Austin, TX',
        postedWithinDays: 7,
        remote: true,
      },
      { fetch },
    );
    expect(r.items[0]).toMatchObject({
      sourceLabel: 'Contoso Careers',
      job: {
        source: 'greenhouse',
        url: 'https://job-boards.greenhouse.io/contoso/jobs/777',
        externalId: '777',
        remoteType: 'remote',
        salaryMin: 90000,
        employmentType: 'full-time',
      },
    });
    expect(r.items[1]).toMatchObject({
      sourceLabel: 'Indeed',
      job: { source: 'indeed', salaryMin: null },
    });
    expect(seen[0]?.headers.get('x-rapidapi-key')).toBe('k');
    expect(seen[0]?.url).toContain('date_posted=week');
    expect(seen[0]?.url).toContain('query=people+operations+in+Austin%2C+TX');
  });
});
