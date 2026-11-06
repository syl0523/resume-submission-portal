import type { Resume, SavedSearchDraft } from '@jsp/core';
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
  return new Response('{}', { status: 404 });
}) as typeof fetch;

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
});
