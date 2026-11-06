import type {
  DiscoverResponse,
  Resume,
  RunSearchResponse,
  SavedSearch,
  SavedSearchDraft,
} from '@jsp/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
    const reply = replies.shift();
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
});
