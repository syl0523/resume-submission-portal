import type {
  AiAnswer,
  ApiErrorBody,
  ApplicationDetail,
  FitReport,
  IngestResult,
  Profile,
  Resume,
  SavedSearchDraft,
} from '@jsp/core';
import { jobInputSchema, searchProfileSchema } from '@jsp/core';
import { scoreJobFit } from '@jsp/integrations';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rerankHits } from '../services/ai';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

// A fake Messages API: each test queues replies and inspects the requests it received.
interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}
type Reply = { status?: number; json: unknown; headers?: Record<string, string> };

const seen: Seen[] = [];
const replies: Reply[] = [];

const message = (model: string, text: string, stop = 'end_turn'): Reply => ({
  json: {
    id: `msg_${seen.length}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  },
});

const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const body =
    typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  seen.push({ url, headers: new Headers(init?.headers), body });
  const reply = replies.shift() ?? {
    status: 500,
    json: { type: 'error', error: { type: 'api_error', message: 'no reply queued' } },
  };
  return new Response(JSON.stringify(reply.json), {
    status: reply.status ?? 200,
    headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
  });
}) as typeof fetch;

const PDF = new TextEncoder().encode('%PDF-1.7\n% synthetic resume for tests\n%%EOF\n');

describe('AI features (fake Messages API)', () => {
  let t: TestContext;
  let resume: Resume;
  let appId: string;

  beforeAll(async () => {
    t = await createTestContext({ OUTBOUND_FETCH: fakeFetch, ANTHROPIC_API_KEY: 'sk-ant-test' });
    const form = new FormData();
    form.set('file', new File([PDF], 'jane.pdf', { type: 'application/pdf' }));
    resume = (await t.json<Resume>('/api/resumes', { method: 'POST', body: form })).body;
    appId = (
      await t.json<ApplicationDetail>(
        '/api/applications',
        jsonBody('POST', {
          job: {
            title: 'HR Generalist',
            company: 'Northwind Freight',
            url: null,
            description: 'Own onboarding and employee relations. Workday experience required.',
          },
          status: 'applied',
        }),
      )
    ).body.application.id;
  });

  beforeEach(() => {
    seen.length = 0;
    replies.length = 0;
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('asks the fast model for a second opinion on uncertain emails', async () => {
    const globex = await t.json<ApplicationDetail>(
      '/api/applications',
      jsonBody('POST', {
        job: { title: 'Office Manager', company: 'Globex', url: null },
        status: 'applied',
      }),
    );
    replies.push(
      message(
        'claude-haiku-5-5',
        JSON.stringify({
          kind: 'screening',
          company: 'Globex',
          jobTitle: 'Office Manager',
          interviewAt: null,
          confidence: 0.82,
        }),
      ),
    );
    const { body } = await t.json<IngestResult>(
      '/api/inbox/paste',
      jsonBody('POST', {
        from: 'Sam Lee <sam@globex.example>',
        subject: 'Tuesday?',
        text: 'Hi Jane, any chance you are free Tuesday afternoon? Sam, Globex',
      }),
    );
    expect(body.item).toMatchObject({
      kind: 'screening',
      classifier: 'ai',
      status: 'matched',
      confidence: 0.82,
    });
    expect(body.applicationId).toBe(globex.body.application.id);

    expect(seen).toHaveLength(1);
    const req = seen[0];
    expect(req?.url).toContain('/v1/messages');
    expect(req?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(req?.body.fallbacks).toBeUndefined();
  });

  it('writes a fit report with the resume PDF as a cached document, then serves it from cache', async () => {
    const report = {
      score: 78,
      summary: 'Strong HR generalist fit.',
      strengths: ['Onboarding'],
      gaps: ['Workday'],
      missingKeywords: ['Workday'],
      suggestions: ['Mention HRIS work'],
      coverLetter: null,
    };
    replies.push(message('claude-opus-5-5', JSON.stringify(report)));
    const first = await t.json<FitReport>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: appId }),
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      score: 78,
      model: 'claude-opus-5-5',
      coverLetter: null,
      gaps: ['Workday'],
    });

    const req = seen[0];
    expect(req?.body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      output_config: { effort: 'high' },
    });
    expect(req?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const messages = (req?.body.messages ?? []) as { content: Record<string, unknown>[] }[];
    const content = messages[0]?.content ?? [];
    expect(content[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf' },
      cache_control: { type: 'ephemeral' },
    });

    const cached = await t.json<FitReport>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: appId }),
    );
    expect(cached.body.score).toBe(78);
    expect(seen).toHaveLength(1);

    replies.push(
      message(
        'claude-opus-5-5',
        JSON.stringify({ ...report, score: 81, coverLetter: 'Dear hiring team, …' }),
      ),
    );
    const withLetter = await t.json<FitReport>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: appId, resumeId: resume.id, coverLetter: true }),
    );
    expect(withLetter.body).toMatchObject({ score: 81, coverLetter: 'Dear hiring team, …' });
    expect(seen).toHaveLength(2);
  });

  it('explains what a fit report needs', async () => {
    const bare = await t.json<ApplicationDetail>(
      '/api/applications',
      jsonBody('POST', {
        job: { title: 'Recruiter', company: 'Fabrikam', url: null },
        status: 'saved',
      }),
    );
    const res = await t.json<ApiErrorBody>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: bare.body.application.id }),
    );
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/job description/);
    expect(seen).toHaveLength(0);
  });

  it('answers application questions in plain text', async () => {
    replies.push(message('claude-opus-5-5', 'I have six years of HR experience in logistics.'));
    const { status, body } = await t.json<AiAnswer>(
      '/api/ai/answer',
      jsonBody('POST', {
        question: 'Why are you a fit for this role?',
        applicationId: appId,
        maxWords: 80,
      }),
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      answer: 'I have six years of HR experience in logistics.',
      model: 'claude-opus-5-5',
    });
    const text = JSON.stringify(seen[0]?.body.messages);
    expect(text).toContain('Why are you a fit for this role?');
    expect(text).toContain('at most 80 words');
    expect(text).toContain('Northwind Freight');
  });

  it('drafts a profile from the resume, cleaning links and dates', async () => {
    replies.push(
      message(
        'claude-opus-5-5',
        JSON.stringify({
          fullName: 'Jane Doe',
          headline: 'HR Generalist | HRIS',
          email: 'jane.doe@example.com',
          phone: '+1 512 555 0100',
          location: 'Austin, TX',
          linkedinUrl: 'linkedin.com/in/jane-doe-example',
          websiteUrl: 'not a url',
          githubUrl: null,
          summary: 'HR generalist with six years in logistics.',
          skills: ['Workday', 'Onboarding'],
          languages: ['English'],
          experience: [
            {
              title: 'HR Generalist',
              company: 'Example Freight',
              location: null,
              start: '2021-03',
              end: 'present',
              current: true,
              highlights: ['Rolled out Workday'],
            },
          ],
          education: [
            {
              school: 'Example State University',
              degree: 'BA',
              field: null,
              start: null,
              end: '2019',
            },
          ],
        }),
      ),
    );
    const { status, body } = await t.json<Profile>(
      '/api/profile/draft-from-resume',
      jsonBody('POST', { resumeId: resume.id }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      fullName: 'Jane Doe',
      linkedinUrl: 'https://linkedin.com/in/jane-doe-example',
      websiteUrl: null,
      skills: ['Workday', 'Onboarding'],
      experience: [{ company: 'Example Freight', start: '2021-03', end: null, current: true }],
    });
    // Not saved: the profile itself is unchanged until the user PUTs it.
    expect((await t.json<Profile>('/api/profile')).body.fullName).toBeNull();
  });

  it('drafts a saved search from the resume with sensible defaults', async () => {
    replies.push(
      message(
        'claude-opus-5-5',
        JSON.stringify({
          name: 'HR Generalist, Austin',
          titles: ['HR Generalist', 'Senior HR Generalist', 'HR Business Partner'],
          skills: ['Workday', 'Employee relations'],
          seniority: 'mid_senior',
          locations: ['Austin, TX', 'Remote'],
          workMode: 'any',
          keywords: ['logistics'],
          summary: 'HR generalist, 6 years, logistics',
        }),
      ),
    );
    const { status, body } = await t.json<SavedSearchDraft>(
      '/api/searches/draft-from-resume',
      jsonBody('POST', { resumeId: resume.id }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      name: 'HR Generalist, Austin',
      resumeId: resume.id,
      titles: ['HR Generalist', 'Senior HR Generalist', 'HR Business Partner'],
      postedWithinDays: 7,
      needsSponsorship: false,
      alertsEnabled: true,
      excludeKeywords: [],
    });
  });

  it('turns refusals into 422 and exhausted rate limits into 502', async () => {
    replies.push(message('claude-opus-5-5', '', 'refusal'));
    const refused = await t.json<ApiErrorBody>(
      '/api/ai/answer',
      jsonBody('POST', { question: 'Tell me something' }),
    );
    expect(refused.status).toBe(422);

    const busy: Reply = {
      status: 429,
      json: { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } },
      headers: { 'retry-after-ms': '1' },
    };
    replies.push(busy, busy, busy);
    const limited = await t.json<ApiErrorBody>(
      '/api/ai/answer',
      jsonBody('POST', { question: 'Tell me something' }),
    );
    expect(limited.status).toBe(502);
    expect(limited.body.error.code).toBe('upstream_error');
    expect(seen.length).toBe(4);
  });

  it('re-ranks postings with the fast model, one score per posting', async () => {
    const criteria = searchProfileSchema.parse({
      titles: ['HR Generalist'],
      skills: ['Workday'],
      locations: [],
      keywords: [],
      excludeKeywords: [],
    });
    const items = ['HR Generalist', 'Forklift Operator'].map((title) => {
      const job = jobInputSchema.parse({ title, company: 'Acme' });
      return { job, fit: scoreJobFit(criteria, job) };
    });
    replies.push(
      message(
        'claude-haiku-5-5',
        JSON.stringify({ results: [{ index: 0, score: 91.4, reason: 'Exact title match' }] }),
      ),
    );
    const result = await rerankHits(t.env, criteria, items);
    expect(result).toEqual([{ score: 91, reason: 'Exact title match' }, null]);
    expect(seen[0]?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { effort: 'low' },
    });
  });
});
