import type {
  AiAnswer,
  ApiErrorBody,
  ApplicationDetail,
  FitReport,
  IngestResult,
  MeResponse,
  Profile,
  Resume,
  SavedSearchDraft,
} from '@jsp/core';
import { jobInputSchema, searchProfileSchema } from '@jsp/core';
import { scoreJobFit } from '@jsp/integrations';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Env } from '../env';
import { HttpError } from '../lib/errors';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';
import {
  aiEnabled,
  aiEngine,
  DEFAULT_WORKERS_MODEL,
  jsonSchemaFor,
  parseJsonAnswer,
  readWorkersOutput,
  requireAi,
  rerankHits,
  workersInput,
} from './ai';

// A fake Workers AI binding: each test queues run() replies and toMarkdown() results.
interface RunCall {
  model: string;
  input: Record<string, unknown>;
}
interface MarkdownCall {
  name: string;
  type: string;
  options: unknown;
}

const runCalls: RunCall[] = [];
const runReplies: unknown[] = [];
const markdownCalls: MarkdownCall[] = [];
const markdownReplies: ConversionResponse[] = [];

const fakeAi = {
  async run(model: string, input: Record<string, unknown>) {
    runCalls.push({ model, input });
    const reply = runReplies.shift();
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new Error('InferenceUpstreamError: no reply queued');
    return reply;
  },
  async toMarkdown(file: { name: string; blob: Blob }, options?: unknown) {
    markdownCalls.push({ name: file.name, type: file.blob.type, options });
    return (
      markdownReplies.shift() ?? {
        id: 'md',
        name: file.name,
        mimeType: file.blob.type,
        format: 'error',
        error: 'no conversion queued',
      }
    );
  },
} as unknown as Ai;

/** A chat-completions reply, the format of the default model. */
const chat = (content: string, finish = 'stop', refusal: string | null = null) => ({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 0,
  model: 'google/gemma-4-26b-a4b-it',
  choices: [{ index: 0, message: { role: 'assistant', content, refusal }, finish_reason: finish }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
});

const markdown = (name: string, data: string): ConversionResponse => ({
  id: 'md',
  name,
  mimeType: 'application/pdf',
  format: 'markdown',
  tokens: 50,
  data,
});

const SYNTHETIC_RESUME =
  '# Jane Doe\nHR Generalist, Example Freight (2021-present)\n- Rolled out Workday';
const PDF = new TextEncoder().encode('%PDF-1.7\n% synthetic resume for tests\n%%EOF\n');
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const userMessage = (call: RunCall | undefined) => {
  const messages = (call?.input.messages ?? []) as { role: string; content: string }[];
  return messages.find((m) => m.role === 'user')?.content ?? '';
};
const systemMessage = (call: RunCall | undefined) => {
  const messages = (call?.input.messages ?? []) as { role: string; content: string }[];
  return messages.find((m) => m.role === 'system')?.content ?? '';
};

const envWith = (vars: Partial<Env>) => vars as Env;

describe('engine selection', () => {
  it('prefers Claude, falls back to Workers AI, else nothing', () => {
    expect(aiEngine(envWith({ ANTHROPIC_API_KEY: 'sk-ant-test' }))).toBe('anthropic');
    expect(aiEngine(envWith({ ANTHROPIC_API_KEY: 'sk-ant-test', AI: fakeAi }))).toBe('anthropic');
    expect(aiEngine(envWith({ AI: fakeAi }))).toBe('workers-ai');
    expect(aiEngine(envWith({ ANTHROPIC_API_KEY: '  ', AI: fakeAi }))).toBe('workers-ai');
    expect(aiEngine(envWith({}))).toBeNull();

    expect(aiEnabled(envWith({ AI: fakeAi }))).toBe(true);
    expect(aiEnabled(envWith({}))).toBe(false);
    expect(() => requireAi(envWith({ AI: fakeAi }))).not.toThrow();
    expect(() => requireAi(envWith({}))).toThrow(HttpError);
  });
});

describe('Workers AI request and answer formats', () => {
  const schema = z.object({ kind: z.enum(['a', 'b']), note: z.string().nullable() });

  it('derives the JSON schema from Zod, without $schema', () => {
    expect(jsonSchemaFor(schema)).toEqual({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['a', 'b'] },
        note: { type: ['string', 'null'] },
      },
      required: ['kind', 'note'],
      additionalProperties: false,
    });
  });

  it('builds chat-completions input for current models', () => {
    const input = workersInput(DEFAULT_WORKERS_MODEL, {
      system: 'sys',
      user: 'usr',
      maxTokens: 4096,
      thinking: false,
      schema: { type: 'object' },
    });
    expect(input).toEqual({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
      max_completion_tokens: 4096,
      chat_template_kwargs: { enable_thinking: false },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', schema: { type: 'object' }, strict: true },
      },
    });
    const plain = workersInput(DEFAULT_WORKERS_MODEL, {
      system: 'sys',
      user: 'usr',
      maxTokens: 100,
      thinking: true,
    });
    expect(plain.response_format).toBeUndefined();
    expect(plain.chat_template_kwargs).toEqual({ enable_thinking: true });
  });

  it('builds legacy JSON Mode input for the models in the JSON Mode docs', () => {
    const input = workersInput('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      system: 'sys',
      user: 'usr',
      maxTokens: 4096,
      thinking: true,
      schema: { type: 'object' },
    });
    expect(input).toEqual({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
      max_tokens: 4096,
      response_format: { type: 'json_schema', json_schema: { type: 'object' } },
    });
  });

  it('reads both output formats', () => {
    expect(readWorkersOutput(chat('{"a":1}'))).toEqual({
      text: '{"a":1}',
      refusal: null,
      cutOff: false,
    });
    expect(readWorkersOutput(chat('{"a":', 'length')).cutOff).toBe(true);
    expect(readWorkersOutput(chat('', 'stop', 'I cannot help')).refusal).toBe('I cannot help');
    expect(
      readWorkersOutput({
        choices: [{ message: { content: [{ text: 'Hello ' }, { text: 'there' }] } }],
      }).text,
    ).toBe('Hello there');
    expect(readWorkersOutput({ response: 'plain' }).text).toBe('plain');
    expect(readWorkersOutput({ response: { a: 1 } }).json).toEqual({ a: 1 });
    expect(readWorkersOutput({ unexpected: true })).toEqual({
      text: '',
      refusal: null,
      cutOff: false,
    });
  });

  it('finds the JSON object in an answer', () => {
    expect(parseJsonAnswer('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonAnswer('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonAnswer('<think>hmm {not json}</think>Here you go: {"a":3} done')).toEqual({
      a: 3,
    });
    expect(parseJsonAnswer('no json here')).toBeUndefined();
    expect(parseJsonAnswer('{"a":')).toBeUndefined();
  });
});

describe('AI features on Workers AI (fake AI binding)', () => {
  let t: TestContext;
  let pdfResume: Resume;
  let appId: string;

  beforeAll(async () => {
    t = await createTestContext({ AI: fakeAi });
    const form = new FormData();
    form.set('file', new File([PDF], 'jane.pdf', { type: 'application/pdf' }));
    pdfResume = (await t.json<Resume>('/api/resumes', { method: 'POST', body: form })).body;
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
          resumeId: pdfResume.id,
        }),
      )
    ).body.application.id;
  });

  beforeEach(() => {
    runCalls.length = 0;
    runReplies.length = 0;
    markdownCalls.length = 0;
    markdownReplies.length = 0;
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('turns the AI feature flag on with only the binding', async () => {
    const { body } = await t.json<MeResponse>('/api/me');
    expect(body.features.ai).toBe(true);
  });

  it('gives a second opinion on uncertain emails, without reasoning', async () => {
    const globex = await t.json<ApplicationDetail>(
      '/api/applications',
      jsonBody('POST', {
        job: { title: 'Office Manager', company: 'Globex', url: null },
        status: 'applied',
      }),
    );
    runReplies.push(
      chat(
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
    expect(body.item).toMatchObject({ kind: 'screening', classifier: 'ai', confidence: 0.82 });
    expect(body.applicationId).toBe(globex.body.application.id);

    expect(runCalls).toHaveLength(1);
    const call = runCalls[0];
    expect(call?.model).toBe(DEFAULT_WORKERS_MODEL);
    expect(call?.input).toMatchObject({
      max_completion_tokens: 4096,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true } },
    });
    expect(systemMessage(call)).toContain('You classify emails');
    expect(systemMessage(call)).toContain('"interviewAt"');
    expect(userMessage(call)).toContain('Subject: Tuesday?');
  });

  it('writes a fit report from the converted PDF, records the model, then serves the cache', async () => {
    const report = {
      score: 74.6,
      summary: 'Good HR generalist fit.',
      strengths: ['Onboarding'],
      gaps: ['Workday'],
      missingKeywords: ['Workday'],
      suggestions: ['Mention HRIS work'],
      coverLetter: null,
    };
    markdownReplies.push(markdown('jane.pdf', SYNTHETIC_RESUME));
    runReplies.push(chat(JSON.stringify(report)));
    const first = await t.json<FitReport>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: appId }),
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      score: 75,
      gaps: ['Workday'],
      coverLetter: null,
      model: DEFAULT_WORKERS_MODEL,
    });

    expect(markdownCalls).toEqual([
      {
        name: 'jane.pdf',
        type: 'application/pdf',
        options: { conversionOptions: { pdf: { metadata: false } } },
      },
    ]);
    const call = runCalls[0];
    expect(call?.input).toMatchObject({
      max_completion_tokens: 16000,
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(systemMessage(call)).toContain('never claim experience the resume does not show');
    const user = userMessage(call);
    expect(user).toContain(`<resume file="jane.pdf">\n${SYNTHETIC_RESUME}\n</resume>`);
    expect(user).toContain('Job posting: HR Generalist at Northwind Freight');
    expect(user).toContain('coverLetter must be null');

    const cached = await t.json<FitReport>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: appId }),
    );
    expect(cached.body).toMatchObject({ score: 75, model: DEFAULT_WORKERS_MODEL });
    expect(runCalls).toHaveLength(1);

    markdownReplies.push(markdown('jane.pdf', SYNTHETIC_RESUME));
    runReplies.push(chat(JSON.stringify({ ...report, coverLetter: 'Dear hiring team, …' })));
    const withLetter = await t.json<FitReport>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: appId, coverLetter: true }),
    );
    expect(withLetter.body.coverLetter).toBe('Dear hiring team, …');
    expect(userMessage(runCalls[1])).toContain('using only facts from the resume');
  });

  it('answers application questions in plain text', async () => {
    runReplies.push(chat('I have six years of HR experience in logistics.'));
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
      model: DEFAULT_WORKERS_MODEL,
    });
    const call = runCalls[0];
    expect(call?.input.response_format).toBeUndefined();
    expect(call?.input).toMatchObject({
      max_completion_tokens: 8000,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(systemMessage(call)).toContain('never invent employers');
    expect(userMessage(call)).toContain('at most 80 words');
    expect(userMessage(call)).toContain('Northwind Freight');
  });

  it('drafts a profile from a DOCX through Markdown Conversion', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([80, 75, 3, 4])], 'jane.docx', { type: DOCX_TYPE }));
    const docx = (await t.json<Resume>('/api/resumes', { method: 'POST', body: form })).body;
    markdownReplies.push({ ...markdown('jane.docx', SYNTHETIC_RESUME), mimeType: DOCX_TYPE });
    runReplies.push(
      chat(
        JSON.stringify({
          fullName: 'Jane Doe',
          headline: 'HR Generalist | HRIS',
          email: 'jane.doe@example.com',
          phone: null,
          location: 'Austin, TX',
          linkedinUrl: 'linkedin.com/in/jane-doe-example',
          websiteUrl: null,
          githubUrl: null,
          summary: 'HR generalist with six years in logistics.',
          skills: ['Workday'],
          languages: [],
          experience: [
            {
              title: 'HR Generalist',
              company: 'Example Freight',
              location: null,
              start: '2021',
              end: null,
              current: true,
              highlights: ['Rolled out Workday'],
            },
          ],
          education: [],
        }),
      ),
    );
    const { status, body } = await t.json<Profile>(
      '/api/profile/draft-from-resume',
      jsonBody('POST', { resumeId: docx.id }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      fullName: 'Jane Doe',
      linkedinUrl: 'https://linkedin.com/in/jane-doe-example',
      experience: [{ company: 'Example Freight', start: '2021', current: true }],
    });
    expect(markdownCalls[0]).toMatchObject({ name: 'jane.docx', type: DOCX_TYPE });
    expect(userMessage(runCalls[0])).toContain(SYNTHETIC_RESUME);
    expect(runCalls[0]?.input.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('falls back to the stored text when conversion fails, and needs some text', async () => {
    const form = new FormData();
    form.set('file', new File([PDF], 'scanned.pdf', { type: 'application/pdf' }));
    form.set('text', 'Jane Doe, HR Generalist (pasted text)');
    const scanned = (await t.json<Resume>('/api/resumes', { method: 'POST', body: form })).body;
    runReplies.push(
      chat(
        JSON.stringify({
          name: 'HR Generalist, Austin',
          titles: ['HR Generalist', 'HR Business Partner'],
          skills: ['Workday'],
          seniority: 'mid_senior',
          locations: ['Austin, TX', 'Remote'],
          workMode: 'any',
          keywords: ['logistics'],
          summary: 'HR generalist, logistics',
        }),
      ),
    );
    const draft = await t.json<SavedSearchDraft>(
      '/api/searches/draft-from-resume',
      jsonBody('POST', { resumeId: scanned.id }),
    );
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({
      name: 'HR Generalist, Austin',
      resumeId: scanned.id,
      titles: ['HR Generalist', 'HR Business Partner'],
      alertsEnabled: true,
    });
    expect(markdownCalls).toHaveLength(1);
    expect(userMessage(runCalls[0])).toContain(
      '<resume file="scanned.pdf">\nJane Doe, HR Generalist (pasted text)\n</resume>',
    );

    const bare = new FormData();
    bare.set('file', new File([PDF], 'image-only.pdf', { type: 'application/pdf' }));
    const imageOnly = (await t.json<Resume>('/api/resumes', { method: 'POST', body: bare })).body;
    const unreadable = await t.json<ApiErrorBody>(
      '/api/searches/draft-from-resume',
      jsonBody('POST', { resumeId: imageOnly.id }),
    );
    expect(unreadable.status).toBe(422);
    expect(unreadable.body.error.message).toMatch(/no readable text/);
    expect(runCalls).toHaveLength(1);
  });

  it('re-ranks postings, one score per posting', async () => {
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
    runReplies.push(
      chat(JSON.stringify({ results: [{ index: 0, score: 91.4, reason: 'Exact title match' }] })),
    );
    expect(await rerankHits(t.env, criteria, items)).toEqual([
      { score: 91, reason: 'Exact title match' },
      null,
    ]);
    expect(runCalls[0]?.input).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
    expect(userMessage(runCalls[0])).toContain('Forklift Operator');
  });

  it('retries once on invalid JSON, without reasoning the second time', async () => {
    const report = {
      score: 60,
      summary: 'Partial fit.',
      strengths: [],
      gaps: ['Workday'],
      missingKeywords: [],
      suggestions: [],
      coverLetter: null,
    };
    markdownReplies.push(markdown('jane.pdf', SYNTHETIC_RESUME));
    runReplies.push(
      chat('Sure! Here is the report: {"score": 60, "summary":'),
      chat(JSON.stringify(report)),
    );
    const res = await t.json<FitReport>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: appId, refresh: true }),
    );
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(60);
    expect(runCalls).toHaveLength(2);
    expect(runCalls[0]?.input.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(runCalls[1]?.input.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(markdownCalls).toHaveLength(1);
  });

  it('retries when JSON Mode cannot be met, then gives up with 502', async () => {
    markdownReplies.push(markdown('jane.pdf', SYNTHETIC_RESUME));
    runReplies.push(
      new Error("InferenceUpstreamError: JSON Mode couldn't be met"),
      chat(JSON.stringify({ name: 'x' })),
    );
    const res = await t.json<ApiErrorBody>(
      '/api/searches/draft-from-resume',
      jsonBody('POST', { resumeId: pdfResume.id }),
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'upstream_error' });
    expect(res.body.error.message).toMatch(/unexpected shape/);
    expect(runCalls).toHaveLength(2);
  });

  it('reports a cut-off answer', async () => {
    markdownReplies.push(markdown('jane.pdf', SYNTHETIC_RESUME));
    runReplies.push(chat('{"name":"HR', 'length'), chat('{"name":"HR', 'length'));
    const res = await t.json<ApiErrorBody>(
      '/api/searches/draft-from-resume',
      jsonBody('POST', { resumeId: pdfResume.id }),
    );
    expect(res.status).toBe(502);
    expect(res.body.error.message).toMatch(/cut off/);
  });

  it('turns refusals into 422 and service errors into 502', async () => {
    runReplies.push(chat('', 'stop', 'I cannot help with that.'));
    const refused = await t.json<ApiErrorBody>(
      '/api/ai/answer',
      jsonBody('POST', { question: 'Tell me something' }),
    );
    expect(refused.status).toBe(422);

    runReplies.push(
      new Error(
        'InferenceUpstreamError: 3036: You have used up your daily free allocation of 10,000 neurons.',
      ),
    );
    const limited = await t.json<ApiErrorBody>(
      '/api/ai/answer',
      jsonBody('POST', { question: 'Tell me something' }),
    );
    expect(limited.status).toBe(502);
    expect(limited.body.error).toMatchObject({ code: 'upstream_error' });
    expect(limited.body.error.message).toMatch(/free Workers AI allowance/);

    runReplies.push(new Error('InferenceUpstreamError: 3040: Capacity temporarily exceeded'));
    const busy = await t.json<ApiErrorBody>(
      '/api/ai/answer',
      jsonBody('POST', { question: 'Tell me something' }),
    );
    expect(busy.status).toBe(502);
    expect(busy.body.error.message).toMatch(/busy/);

    runReplies.push(new Error('Binding AI needs to be run remotely'));
    const local = await t.json<ApiErrorBody>(
      '/api/ai/answer',
      jsonBody('POST', { question: 'Tell me something' }),
    );
    expect(local.status).toBe(502);
    expect(local.body.error.message).toMatch(/wrangler login/);
    // No retry for service errors: one call each.
    expect(runCalls).toHaveLength(4);
  });
});

describe('Workers AI with another model (AI_MODEL_WORKERS)', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext({
      AI: fakeAi,
      AI_MODEL_WORKERS: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    });
  });

  beforeEach(() => {
    runCalls.length = 0;
    runReplies.length = 0;
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('uses the legacy JSON Mode format and records the configured model', async () => {
    const form = new FormData();
    form.set('file', new File(['Jane Doe, HR Generalist'], 'jane.txt', { type: 'text/plain' }));
    const resume = (await t.json<Resume>('/api/resumes', { method: 'POST', body: form })).body;
    const app = await t.json<ApplicationDetail>(
      '/api/applications',
      jsonBody('POST', {
        job: { title: 'Recruiter', company: 'Fabrikam', url: null, description: 'Hire people.' },
        status: 'saved',
        resumeId: resume.id,
      }),
    );
    runReplies.push({
      response: {
        score: 50,
        summary: 'Some fit.',
        strengths: [],
        gaps: [],
        missingKeywords: [],
        suggestions: [],
        coverLetter: null,
      },
    });
    const res = await t.json<FitReport>(
      '/api/ai/fit',
      jsonBody('POST', { applicationId: app.body.application.id }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      score: 50,
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    });
    const call = runCalls[0];
    expect(call?.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(call?.input.max_tokens).toBe(16000);
    expect(call?.input.chat_template_kwargs).toBeUndefined();
    expect(call?.input.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { type: 'object', required: expect.arrayContaining(['score']) },
    });
    expect(userMessage(call)).toContain(
      '<resume file="jane.txt">\nJane Doe, HR Generalist\n</resume>',
    );
  });
});

describe('Claude stays the engine when its key is set', () => {
  let t: TestContext;
  const requests: string[] = [];

  beforeAll(async () => {
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input instanceof Request ? input.url : input));
      return Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'From Claude.' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    }) as typeof fetch;
    t = await createTestContext({
      AI: fakeAi,
      ANTHROPIC_API_KEY: 'sk-ant-test',
      OUTBOUND_FETCH: fakeFetch,
    });
  });

  beforeEach(() => {
    runCalls.length = 0;
    markdownCalls.length = 0;
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('sends the request to the Messages API and never touches Workers AI', async () => {
    const { status, body } = await t.json<AiAnswer>(
      '/api/ai/answer',
      jsonBody('POST', { question: 'Why us?' }),
    );
    expect(status).toBe(200);
    expect(body).toEqual({ answer: 'From Claude.', model: 'claude-opus-5-5' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('/v1/messages');
    expect(runCalls).toHaveLength(0);
    expect(markdownCalls).toHaveLength(0);
  });
});
