import type {
  DiscoverResponse,
  Resume,
  RunSearchResponse,
  SavedSearch,
  SavedSearchDraft,
} from '@jsp/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { refreshAlertSearches } from '../services/jobmatch';
import { providerAvailability } from '../services/search';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

// Search sources and defaults that need a fake Messages API (synthetic data only).

interface Seen {
  url: string;
  body: Record<string, unknown>;
}

const seen: Seen[] = [];
const replies: unknown[] = [];

const message = (content: unknown[], stop = 'end_turn') => ({
  id: `msg_${seen.length}`,
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const body =
    typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  seen.push({ url, body });
  if (url.includes('api.anthropic.com')) {
    const reply = replies.shift() as { __status?: number } | undefined;
    if (reply?.__status) {
      return new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'rate_limit_error', message: 'Slow down' },
        }),
        {
          status: reply.__status,
          headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
        },
      );
    }
    return reply
      ? json(reply)
      : json({ type: 'error', error: { type: 'api_error', message: 'no reply queued' } }, 500);
  }
  if (url.startsWith('https://www.themuse.com/api/public/jobs')) {
    const category = new URL(url).searchParams.get('category');
    return json({
      page: Number(new URL(url).searchParams.get('page')),
      page_count: 1,
      total: 2,
      results: category === 'Software Engineering' ? MUSE_RESULTS : [],
    });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const MUSE_RESULTS = [
  {
    id: 7001,
    name: 'Production Support Lead',
    contents: '<p>Lead incident response for payments. PagerDuty, Splunk.</p>',
    publication_date: new Date(Date.now() - 86_400_000).toISOString(),
    locations: [{ name: 'Charlotte, NC' }, { name: 'San Francisco, CA' }],
    refs: { landing_page: 'https://www.themuse.com/jobs/examplebank/production-support-lead' },
    company: { name: 'Example Bank' },
  },
  {
    id: 7002,
    name: 'Account Executive',
    contents: '<p>Sell things.</p>',
    publication_date: new Date().toISOString(),
    locations: [{ name: 'Oakland, CA' }],
    refs: { landing_page: 'https://www.themuse.com/jobs/contoso/account-executive' },
    company: { name: 'Contoso' },
  },
];

const PDF = new TextEncoder().encode('%PDF-1.7\n% synthetic resume for tests\n%%EOF\n');

describe('search defaults with AI (fake Messages API)', () => {
  let t: TestContext;
  let resume: Resume;

  beforeAll(async () => {
    t = await createTestContext({ OUTBOUND_FETCH: fakeFetch, ANTHROPIC_API_KEY: 'sk-ant-test' });
    const form = new FormData();
    form.set('file', new File([PDF], 'sre.pdf', { type: 'application/pdf' }));
    resume = (await t.json<Resume>('/api/resumes', { method: 'POST', body: form })).body;
  });

  beforeEach(() => {
    seen.length = 0;
    replies.length = 0;
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('starts a resume draft without a place in the San Francisco Bay Area', async () => {
    const draft = (locations: string[]) =>
      message([
        {
          type: 'text',
          text: JSON.stringify({
            name: 'SRE Lead',
            titles: ['SRE Lead', 'Incident Manager'],
            skills: ['Kubernetes', 'PagerDuty'],
            seniority: 'mid_senior',
            locations,
            workMode: 'any',
            keywords: ['financial services'],
            summary: 'SRE and incident management, financial services',
          }),
        },
      ]);
    replies.push(draft(['Remote']), draft(['Austin, TX']));
    const remoteOnly = await t.json<SavedSearchDraft>(
      '/api/searches/draft-from-resume',
      jsonBody('POST', { resumeId: resume.id }),
    );
    expect(remoteOnly.status).toBe(200);
    expect(remoteOnly.body.locations).toEqual(['San Francisco Bay Area', 'Remote']);
    const withPlace = await t.json<SavedSearchDraft>(
      '/api/searches/draft-from-resume',
      jsonBody('POST', { resumeId: resume.id }),
    );
    expect(withPlace.body.locations).toEqual(['Austin, TX']);
  });

  it('runs a saved search against The Muse without a key', async () => {
    const created = await t.json<SavedSearch>(
      '/api/searches',
      jsonBody('POST', {
        name: 'SRE, Bay Area',
        titles: ['SRE Lead', 'Incident Manager'],
        skills: ['PagerDuty', 'Splunk'],
        keywords: [],
        excludeKeywords: [],
        seniority: 'mid_senior',
      }),
    );
    const { status, body } = await t.json<RunSearchResponse>(
      `/api/searches/${created.body.id}/run`,
      jsonBody('POST', { providers: ['muse'] }),
    );
    expect(status).toBe(200);
    expect(body.providers).toEqual([{ provider: 'muse', total: 1, error: null }]);
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({
      provider: 'muse',
      sourceLabel: 'The Muse',
      job: { title: 'Production Support Lead', location: 'San Francisco, CA; Charlotte, NC' },
    });
    expect(body.hits[0]?.fit.reasons).toEqual(
      expect.arrayContaining(['Title matches “SRE Lead”', 'In San Francisco, CA; Charlotte, NC']),
    );
    const museCalls = seen.filter((s) => s.url.includes('themuse.com'));
    // Two categories for the reliability family, one page each (both answers are short).
    expect(museCalls.map((s) => new URL(s.url).searchParams.get('category'))).toEqual([
      'Software Engineering',
      'Computer and IT',
    ]);
    expect(new URL(museCalls[0]?.url ?? '').searchParams.getAll('location')).toContain(
      'Oakland, CA',
    );
  });

  it('includes The Muse in Discover', async () => {
    const { body } = await t.json<DiscoverResponse>(
      '/api/discover?q=Incident+Manager&provider=muse',
    );
    expect(body.providers).toEqual([{ provider: 'muse', total: 1, error: null }]);
    expect(body.items.map((i) => i.sourceLabel)).toEqual(['The Muse']);
  });

  it('searches careers sites with Claude web search on manual runs', async () => {
    const created = await t.json<SavedSearch>(
      '/api/searches',
      jsonBody('POST', {
        name: 'SRE via web search',
        titles: ['SRE Lead', 'Incident Manager'],
        skills: ['PagerDuty'],
        keywords: [],
        excludeKeywords: [],
        alertsEnabled: false,
      }),
    );
    replies.push(
      webSearchReply(
        'srvtoolu_1',
        [GREENHOUSE_URL, LINKEDIN_URL],
        [
          reported(GREENHOUSE_URL, 'Site Reliability Engineer'),
          reported(LINKEDIN_URL, 'SRE'),
          reported('https://jobs.apple.com/en-us/details/200500999/sre', 'SRE (not a result)'),
        ],
      ),
      webSearchReply('srvtoolu_2', [META_URL], [reported(META_URL, 'Production Engineer')]),
    );
    const { status, body } = await t.json<RunSearchResponse>(
      `/api/searches/${created.body.id}/run`,
      jsonBody('POST', { providers: ['websearch'], maxQueries: 4 }),
    );
    expect(status).toBe(200);
    expect(body.providers).toEqual([{ provider: 'websearch', total: 2, error: null }]);
    expect(body.hits.map((h) => h.job.url).sort()).toEqual([
      'https://job-boards.greenhouse.io/examplepay/jobs/4000001',
      'https://www.metacareers.com/jobs/1000000001',
    ]);
    expect(body.hits.every((h) => h.sourceLabel === 'Web search')).toBe(true);

    // One Claude request per query, capped at two queries per run.
    const calls = seen.filter((s) => s.url.includes('api.anthropic.com'));
    expect(calls).toHaveLength(2);
    const request = calls[0]?.body as {
      model: string;
      tools: Record<string, unknown>[];
      messages: { content: string }[];
    };
    expect(request.model).toBe('claude-haiku-5-5');
    expect(request.tools[0]).toMatchObject({
      type: 'web_search_20260318',
      name: 'web_search',
      max_uses: 3,
      allowed_callers: ['direct'],
      user_location: { type: 'approximate', city: 'San Francisco', country: 'US' },
    });
    const domains = request.tools[0]?.allowed_domains as string[];
    expect(domains).toEqual(
      expect.arrayContaining(['amazon.jobs', 'myworkdayjobs.com', 'job-boards.greenhouse.io']),
    );
    expect(domains.some((d) => /linkedin|indeed/.test(d))).toBe(false);
    expect(request.tools[1]).toMatchObject({ name: 'record_job_postings', strict: true });
    expect(request.messages[0]?.content).toContain('in or near San Francisco Bay Area');
  });

  it('continues a paused search turn, and only uses web search when picked in Discover', async () => {
    replies.push(
      message(
        [serverToolUse('srvtoolu_3'), searchResults('srvtoolu_3', [GREENHOUSE_URL])],
        'pause_turn',
      ),
      message(
        [
          {
            type: 'tool_use',
            id: 'toolu_9',
            name: 'record_job_postings',
            input: { postings: [reported(GREENHOUSE_URL, 'Incident Manager')] },
          },
        ],
        'tool_use',
      ),
    );
    const picked = await t.json<DiscoverResponse>(
      '/api/discover?q=Incident+Manager&provider=websearch',
    );
    expect(picked.body.providers).toEqual([{ provider: 'websearch', total: 1, error: null }]);
    expect(picked.body.items[0]?.job).toMatchObject({
      title: 'Incident Manager',
      source: 'greenhouse',
    });
    const calls = seen.filter((s) => s.url.includes('api.anthropic.com'));
    expect(calls).toHaveLength(2);
    const continued = calls[1]?.body as { messages: { role: string }[] };
    expect(continued.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    seen.length = 0;
    const all = await t.json<DiscoverResponse>('/api/discover?q=Incident+Manager');
    expect(all.body.providers.map((p) => p.provider)).not.toContain('websearch');
    // Page 2 never pays for another web search.
    const page2 = await t.json<DiscoverResponse>(
      '/api/discover?q=Incident+Manager&provider=websearch&page=2',
    );
    expect(page2.body.providers).toEqual([{ provider: 'websearch', total: 0, error: null }]);
    expect(seen.some((s) => s.url.includes('api.anthropic.com'))).toBe(false);
  });

  it('skips web search in the daily refresh and without an Anthropic key', async () => {
    const result = await refreshAlertSearches(createDb(t.env.DB), t.env, new Date());
    expect(result.errors).toBe(0);
    expect(result.run).toBeGreaterThan(0);
    expect(seen.some((s) => s.url.includes('api.anthropic.com'))).toBe(false);
    expect(seen.some((s) => s.url.includes('themuse.com'))).toBe(true);
    expect(providerAvailability({ ...t.env, ANTHROPIC_API_KEY: ' ' }).websearch).toBe(false);
    expect(providerAvailability(t.env).websearch).toBe(true);
  });

  it('reports web search failures without failing the run', async () => {
    replies.push({ __status: 429 }, { __status: 429 });
    const { status, body } = await t.json<DiscoverResponse>(
      '/api/discover?q=SRE&provider=websearch',
    );
    expect(status).toBe(200);
    expect(body.providers[0]).toMatchObject({ provider: 'websearch', total: 0 });
    expect(body.providers[0]?.error).toMatch(/rate limited/);
  });
});

const GREENHOUSE_URL = 'https://job-boards.greenhouse.io/examplepay/jobs/4000001';
const META_URL = 'https://www.metacareers.com/jobs/1000000001/';
const LINKEDIN_URL = 'https://www.linkedin.com/jobs/view/4000000002/';

function reported(url: string, title: string) {
  return {
    title,
    company: 'Example Payments',
    location: 'San Francisco, CA',
    url,
    postedAt: '2026-11-01',
    snippet: 'Own reliability and incident response for payments.',
  };
}

function serverToolUse(id: string) {
  return {
    type: 'server_tool_use',
    id,
    name: 'web_search',
    input: { query: 'site reliability engineer jobs San Francisco' },
    caller: { type: 'direct' },
  };
}

function searchResults(id: string, urls: string[]) {
  return {
    type: 'web_search_tool_result',
    tool_use_id: id,
    caller: { type: 'direct' },
    content: urls.map((url) => ({
      type: 'web_search_result',
      url,
      title: 'Job posting',
      encrypted_content: 'synthetic',
      page_age: null,
    })),
  };
}

function webSearchReply(id: string, urls: string[], postings: unknown[]) {
  return message(
    [
      serverToolUse(id),
      searchResults(id, urls),
      { type: 'text', text: 'Here is what I found.' },
      {
        type: 'tool_use',
        id: `toolu_${id}`,
        name: 'record_job_postings',
        input: { postings },
        caller: { type: 'direct' },
      },
    ],
    'tool_use',
  );
}
