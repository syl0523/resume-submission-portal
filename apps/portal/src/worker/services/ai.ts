import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  type AiAnswer,
  EMAIL_KINDS,
  type EmailClassification,
  type FitReport,
  type JobFit,
  type JobInputParsed,
  type Profile,
  profileSchema,
  type SavedSearchDraft,
  SENIORITY_LEVELS,
  type SearchProfileParsed,
  savedSearchSchema,
  urlSchema,
  WORK_MODES,
} from '@jsp/core';
import { type EmailMessage, emailBodyText, truncate } from '@jsp/integrations';
import { z } from 'zod';
import type { ResumeRow } from '../db/schema';
import { type Env, outboundFetch } from '../env';
import { HttpError, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';

/**
 * Claude-powered helpers (KAN-32, KAN-33, KAN-39, KAN-44, KAN-45): email second opinion, fit report
 * and cover letter, answers to application questions, profile and saved-search drafts from a
 * resume, Job Match re-ranking. All optional: without ANTHROPIC_API_KEY the routes answer 501.
 *
 * Models: AI_MODEL_SMART (default claude-opus-5-5) for writing and resume reading;
 * AI_MODEL_FAST (default claude-haiku-5-5) for the quick, high-volume classification and re-rank.
 */

export const DEFAULT_SMART_MODEL = 'claude-opus-5-5';
export const DEFAULT_FAST_MODEL = 'claude-haiku-5-5';

type Effort = 'low' | 'medium' | 'high';

export function aiEnabled(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export function requireAi(env: Env): void {
  if (!aiEnabled(env)) {
    throw new HttpError(501, 'feature_disabled', 'AI is not configured (set ANTHROPIC_API_KEY)');
  }
}

const smartModel = (env: Env) => env.AI_MODEL_SMART?.trim() || DEFAULT_SMART_MODEL;
const fastModel = (env: Env) => env.AI_MODEL_FAST?.trim() || DEFAULT_FAST_MODEL;

function client(env: Env): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    fetch: outboundFetch(env),
    timeout: 90_000,
    maxRetries: 2,
  });
}

/** Typed SDK errors → the portal's error shape. Retryable ones were already retried by the SDK. */
function toHttpError(err: unknown): Error {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new HttpError(
      502,
      'upstream_error',
      'The AI service is busy right now. Try again in a minute.',
    );
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new HttpError(
      502,
      'upstream_error',
      'The AI service rejected the API key (check ANTHROPIC_API_KEY).',
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new HttpError(
      502,
      'upstream_error',
      `The AI service could not handle this request: ${err.message}`,
    );
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new HttpError(502, 'upstream_error', 'The AI service could not be reached.');
  }
  if (err instanceof Anthropic.APIError) {
    return new HttpError(
      502,
      'upstream_error',
      `The AI service failed (${err.status ?? 'network error'}).`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Haiku has no server-side refusal fallback; Opus and Sonnet re-run declined requests on another model. */
function fallbackParams(model: string) {
  return /haiku/i.test(model)
    ? {}
    : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
}

interface CallOptions {
  model: string;
  effort: Effort;
  system: string;
  content: BetaContentBlockParam[];
  maxTokens: number;
}

/** One request with a JSON-schema output, validated by the SDK against the Zod schema. */
async function structured<S extends z.ZodType>(
  env: Env,
  schema: S,
  opts: CallOptions,
): Promise<{ data: z.infer<S>; model: string }> {
  let response: Awaited<ReturnType<Anthropic['beta']['messages']['parse']>>;
  try {
    response = await client(env).beta.messages.parse({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.content }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(schema) },
      ...fallbackParams(opts.model),
    });
  } catch (err) {
    throw toHttpError(err);
  }
  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, 'unprocessable', 'The AI declined to help with this request.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new HttpError(502, 'upstream_error', 'The AI answer was cut off. Try again.');
  }
  const parsed = schema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new HttpError(502, 'upstream_error', 'The AI returned an answer in an unexpected shape.');
  }
  return { data: parsed.data, model: response.model };
}

/** One request answered in plain text. */
async function plainText(env: Env, opts: CallOptions): Promise<{ text: string; model: string }> {
  let response: Awaited<ReturnType<Anthropic['beta']['messages']['create']>>;
  try {
    response = await client(env).beta.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.content }],
      output_config: { effort: opts.effort },
      stream: false,
      ...fallbackParams(opts.model),
    });
  } catch (err) {
    throw toHttpError(err);
  }
  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, 'unprocessable', 'The AI declined to help with this request.');
  }
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
  if (!text) throw new HttpError(502, 'upstream_error', 'The AI returned an empty answer.');
  return { text, model: response.model };
}

// ---------------------------------------------------------------------------------------------
// Resume input: PDFs go in as document blocks; other files need their stored plain text.
// ---------------------------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The resume as a cacheable document block (repeated fit reports reuse the cached prefix). */
export async function resumeBlock(env: Env, resume: ResumeRow): Promise<BetaContentBlockParam> {
  if (resume.mimeType === 'application/pdf') {
    const object = await env.FILES.get(resume.fileKey);
    if (!object) throw notFound('Resume file');
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: toBase64(new Uint8Array(await object.arrayBuffer())),
      },
      title: resume.fileName,
      cache_control: { type: 'ephemeral' },
    };
  }
  let text = resume.textContent?.trim() ?? '';
  if (!text && resume.mimeType === 'text/plain') {
    text = (await (await env.FILES.get(resume.fileKey))?.text())?.trim() ?? '';
  }
  if (!text) {
    throw new HttpError(
      422,
      'unprocessable',
      'This resume has no readable text. Upload it as a PDF, or paste its plain text on the Resumes page.',
    );
  }
  return {
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: text },
    title: resume.fileName,
    cache_control: { type: 'ephemeral' },
  };
}

// ---------------------------------------------------------------------------------------------
// KAN-32: second opinion on uncertain emails
// ---------------------------------------------------------------------------------------------

const emailSchema = z.object({
  kind: z.enum(EMAIL_KINDS),
  company: z.string().nullable(),
  jobTitle: z.string().nullable(),
  interviewAt: z.string().nullable(),
  confidence: z.number(),
});

const EMAIL_SYSTEM = `You classify emails that a job seeker forwarded to their job-application tracker.
Decide what the email means for their application:
- application_received: confirms an application was submitted
- application_viewed: the employer opened or reviewed the application
- screening: a recruiter call or phone screen
- assessment: a test, take-home or questionnaire
- interview: an interview invitation, scheduling or confirmation
- offer: a job offer
- rejection: the employer is not moving forward
- other: job alerts, newsletters, receipts and anything else
Give the employer's name and the job title only when the email states them; otherwise null.
interviewAt is the interview start as an ISO-8601 UTC timestamp, only when the email states a date, a time and a time zone; otherwise null.
confidence is how sure you are of the kind, from 0 to 1.`;

/**
 * Second opinion for an email the rules are unsure about (confidence < 0.6). Returns null when
 * the model declines; throws on service errors (the ingest pipeline catches and keeps the rules).
 */
export async function classifyEmailWithAi(
  env: Env,
  message: EmailMessage,
  rules: EmailClassification,
): Promise<EmailClassification | null> {
  if (!aiEnabled(env)) return null;
  const body = truncate(emailBodyText(message).replace(/\n{3,}/g, '\n\n'), 8000);
  try {
    const { data } = await structured(env, emailSchema, {
      model: fastModel(env),
      effort: 'low',
      system: EMAIL_SYSTEM,
      maxTokens: 4096,
      content: [
        {
          type: 'text',
          text: `From: ${message.from}\nSubject: ${message.subject}\nDate: ${message.date ?? 'unknown'}\n\n${body}`,
        },
      ],
    });
    const interviewAt =
      data.interviewAt && !Number.isNaN(Date.parse(data.interviewAt))
        ? new Date(data.interviewAt).toISOString()
        : rules.interviewAt;
    return {
      ...rules,
      kind: data.kind,
      company: data.company?.trim().slice(0, 200) || rules.company,
      jobTitle: data.jobTitle?.trim().slice(0, 300) || rules.jobTitle,
      interviewAt,
      confidence: Math.round(Math.max(0, Math.min(1, data.confidence)) * 100) / 100,
      signals: [...rules.signals, 'ai'],
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 422) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// KAN-33: fit report and cover letter
// ---------------------------------------------------------------------------------------------

export const fitReportSchema = z.object({
  score: z.number(),
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  suggestions: z.array(z.string()),
  coverLetter: z.string().nullable(),
});

/** A report as cached in ai_reports. */
export const storedFitReportSchema = fitReportSchema.extend({
  model: z.string(),
  createdAt: z.string(),
});

const FIT_SYSTEM = `You are a candid career coach. Compare the candidate's resume with one job posting.
Be specific and honest: do not flatter, and never claim experience the resume does not show.
score: 0-100, how well the resume as written fits this job (not the candidate's potential).
summary: two or three sentences. strengths and gaps: concrete, tied to the posting's requirements.
missingKeywords: terms from the posting that the resume lacks and that applicant tracking systems search for.
suggestions: specific edits to the resume for this job, truthful to the candidate's experience.
coverLetter: null unless the request asks for one.`;

export interface FitInput {
  resume: ResumeRow;
  job: { title: string; company: string; description: string };
  coverLetter: boolean;
}

export async function fitReport(env: Env, input: FitInput): Promise<FitReport> {
  requireAi(env);
  const ask = input.coverLetter
    ? 'Write the fit report, and a cover letter of 250-350 words in plain text: first person, specific to this job, using only facts from the resume, no placeholders for facts the resume lacks.'
    : 'Write the fit report. coverLetter must be null.';
  const { data, model } = await structured(env, fitReportSchema, {
    model: smartModel(env),
    effort: 'high',
    system: FIT_SYSTEM,
    maxTokens: 16000,
    content: [
      await resumeBlock(env, input.resume),
      {
        type: 'text',
        text: `Job posting: ${input.job.title} at ${input.job.company}\n\n${truncate(input.job.description, 30_000)}`,
      },
      { type: 'text', text: ask },
    ],
  });
  const list = (items: string[], n: number) =>
    items
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, n);
  return {
    score: Math.max(0, Math.min(100, Math.round(data.score))),
    summary: data.summary.trim(),
    strengths: list(data.strengths, 8),
    gaps: list(data.gaps, 8),
    missingKeywords: list(data.missingKeywords, 15),
    suggestions: list(data.suggestions, 8),
    coverLetter: input.coverLetter ? data.coverLetter?.trim() || null : null,
    model,
    createdAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------------------------
// KAN-45: answers to application questions
// ---------------------------------------------------------------------------------------------

export interface AnswerQuestionInput {
  question: string;
  maxWords: number;
  profile: Profile;
  job: { title: string; company: string; description: string | null } | null;
}

const ANSWER_SYSTEM = `You help a job seeker answer questions on job applications, in their own voice.
Use only facts from their profile; never invent employers, titles, numbers, dates or credentials.
When the profile does not support part of an answer, keep that part short and honest and add a bracketed note such as [add a specific example].
Write plain text in the first person, with no greeting, sign-off or heading.`;

function profileForPrompt(p: Profile): string {
  const facts = {
    name: p.fullName,
    headline: p.headline,
    location: p.location,
    summary: p.summary,
    workAuthorization: p.workAuthorization,
    skills: p.skills,
    languages: p.languages,
    experience: p.experience,
    education: p.education,
    previousAnswers: p.customAnswers,
  };
  return JSON.stringify(facts, null, 1);
}

/** Draft an answer to an application question, grounded in the profile. */
export async function answerQuestion(env: Env, input: AnswerQuestionInput): Promise<AiAnswer> {
  requireAi(env);
  const job = input.job
    ? `Job: ${[input.job.title, input.job.company].filter(Boolean).join(' at ') || 'see description'}\n${truncate(input.job.description ?? '', 8000)}`
    : 'No job posting was given.';
  const { text, model } = await plainText(env, {
    model: smartModel(env),
    effort: 'medium',
    system: ANSWER_SYSTEM,
    maxTokens: 8000,
    content: [
      { type: 'text', text: `Candidate profile (JSON):\n${profileForPrompt(input.profile)}` },
      { type: 'text', text: job },
      {
        type: 'text',
        text: `Question: ${input.question}\n\nAnswer in at most ${input.maxWords} words.`,
      },
    ],
  });
  return { answer: text, model };
}

// ---------------------------------------------------------------------------------------------
// KAN-44: profile draft from a resume
// ---------------------------------------------------------------------------------------------

const draftProfileSchema = z.object({
  fullName: z.string().nullable(),
  headline: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  summary: z.string().nullable(),
  skills: z.array(z.string()),
  languages: z.array(z.string()),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      current: z.boolean(),
      highlights: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
    }),
  ),
});

const PROFILE_SYSTEM = `Read the resume and extract the candidate's profile for filling in job applications.
Copy facts as written. Use null, or an empty list, for anything the resume does not state.
headline: one line such as "HR Generalist | HRIS | Logistics". summary: two or three sentences in the first person.
Dates: YYYY or YYYY-MM. For the current role, end is null and current is true. URLs must be full https:// links.`;

const MONTH = /^\d{4}(-\d{2})?$/;
const cleanUrl = (u: string | null) => {
  if (!u) return null;
  const withScheme = /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`;
  return urlSchema.safeParse(withScheme).success ? withScheme : null;
};
const cleanMonth = (m: string | null) => (m && MONTH.test(m.trim()) ? m.trim() : null);
const clipText = (s: string | null, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);
const clipList = (items: string[], count: number, length: number) =>
  items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, count)
    .map((s) => s.slice(0, length));

/**
 * Read contact details, headline, summary, skills, languages, experience and education from a
 * resume, merged over `current` (work authorization, address and saved answers are kept). Not saved.
 */
export async function draftProfileFromResume(
  env: Env,
  resume: ResumeRow,
  current: Profile,
): Promise<Profile> {
  requireAi(env);
  const { data } = await structured(env, draftProfileSchema, {
    model: smartModel(env),
    effort: 'medium',
    system: PROFILE_SYSTEM,
    maxTokens: 16000,
    content: [await resumeBlock(env, resume), { type: 'text', text: 'Extract the profile.' }],
  });
  const email = data.email?.trim();
  const merged = {
    fullName: clipText(data.fullName, 200) ?? current.fullName,
    headline: clipText(data.headline, 200) ?? current.headline,
    email: email && z.email().safeParse(email).success ? email : current.email,
    phone: clipText(data.phone, 40) ?? current.phone,
    location: clipText(data.location, 200) ?? current.location,
    address: current.address,
    linkedinUrl: cleanUrl(data.linkedinUrl) ?? current.linkedinUrl,
    websiteUrl: cleanUrl(data.websiteUrl) ?? current.websiteUrl,
    githubUrl: cleanUrl(data.githubUrl) ?? current.githubUrl,
    workAuthorization: current.workAuthorization,
    summary: clipText(data.summary, 5000) ?? current.summary,
    skills: data.skills.length > 0 ? clipList(data.skills, 80, 80) : current.skills,
    languages: data.languages.length > 0 ? clipList(data.languages, 10, 80) : current.languages,
    experience:
      data.experience.length > 0
        ? data.experience.slice(0, 30).flatMap((e) =>
            e.title.trim() && e.company.trim()
              ? [
                  {
                    title: e.title.trim().slice(0, 200),
                    company: e.company.trim().slice(0, 200),
                    location: clipText(e.location, 200),
                    start: cleanMonth(e.start),
                    end: e.current ? null : cleanMonth(e.end),
                    current: e.current,
                    highlights: clipList(e.highlights, 12, 500),
                  },
                ]
              : [],
          )
        : current.experience,
    education:
      data.education.length > 0
        ? data.education.slice(0, 10).flatMap((e) =>
            e.school.trim()
              ? [
                  {
                    school: e.school.trim().slice(0, 200),
                    degree: clipText(e.degree, 200),
                    field: clipText(e.field, 200),
                    start: cleanMonth(e.start),
                    end: cleanMonth(e.end),
                  },
                ]
              : [],
          )
        : current.education,
    customAnswers: current.customAnswers,
  };
  const valid = profileSchema.safeParse(merged);
  if (!valid.success)
    throw new HttpError(502, 'upstream_error', 'The AI draft could not be used. Try again.');
  const d = valid.data;
  return {
    fullName: d.fullName ?? null,
    headline: d.headline ?? null,
    email: d.email ?? current.email,
    phone: d.phone ?? null,
    location: d.location ?? null,
    address: d.address ?? null,
    linkedinUrl: d.linkedinUrl ?? null,
    websiteUrl: d.websiteUrl ?? null,
    githubUrl: d.githubUrl ?? null,
    workAuthorization: d.workAuthorization ?? null,
    summary: d.summary ?? null,
    skills: d.skills,
    languages: d.languages,
    experience: d.experience,
    education: d.education,
    customAnswers: d.customAnswers,
    updatedAt: current.updatedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// KAN-39: saved-search draft from a resume, and re-ranking
// ---------------------------------------------------------------------------------------------

const searchDraftSchema = z.object({
  name: z.string(),
  titles: z.array(z.string()),
  skills: z.array(z.string()),
  seniority: z.enum(SENIORITY_LEVELS).nullable(),
  locations: z.array(z.string()),
  workMode: z.enum(WORK_MODES),
  keywords: z.array(z.string()),
  summary: z.string(),
});

const SEARCH_SYSTEM = `You set up saved job searches for a US job seeker from their resume.
titles: target job titles in priority order (up to 6): their current level, one step up, and adjacent roles they qualify for, as employers title them.
skills: skills, tools and certifications from the resume that employers search for (up to 20).
seniority: the level that fits the resume.
locations: US places from the resume as "City, ST", plus "Remote" when remote work suits them; an empty list means anywhere in the US.
keywords: a few industry or domain words that should appear in good matches.
name: a short track name such as "HR Generalist, Austin". summary: one line describing the candidate.`;

/** Draft a Job Match track from a resume. Not saved: the user reviews and saves it. */
export async function draftSearchFromResume(
  env: Env,
  resume: ResumeRow,
): Promise<SavedSearchDraft> {
  requireAi(env);
  const { data } = await structured(env, searchDraftSchema, {
    model: smartModel(env),
    effort: 'medium',
    system: SEARCH_SYSTEM,
    maxTokens: 8000,
    content: [await resumeBlock(env, resume), { type: 'text', text: 'Draft the saved search.' }],
  });
  const titles = clipList(data.titles, 8, 80);
  if (titles.length === 0) {
    throw new HttpError(422, 'unprocessable', 'No target roles could be read from this resume.');
  }
  const draft = savedSearchSchema.safeParse({
    name: data.name.trim().slice(0, 80) || titles[0],
    resumeId: resume.id,
    titles,
    skills: clipList(data.skills, 40, 80),
    locations: clipList(data.locations, 5, 120),
    workMode: data.workMode,
    seniority: data.seniority,
    keywords: clipList(data.keywords, 20, 80),
    excludeKeywords: [],
    summary: data.summary.trim().slice(0, 1000) || null,
    alertsEnabled: true,
  });
  if (!draft.success)
    throw new HttpError(502, 'upstream_error', 'The AI draft could not be used. Try again.');
  return draft.data;
}

const rerankSchema = z.object({
  results: z.array(z.object({ index: z.number(), score: z.number(), reason: z.string() })),
});

const RERANK_SYSTEM = `You re-rank job postings for one saved job search.
For each posting give a 0-100 fit score and one short reason (at most 15 words) that a recruiter would agree with.
Weigh the target titles and seniority most, then skills, then location and work mode.`;

/** Re-score the top postings with the fast model. One entry per input; null where none came back. */
export async function rerankHits(
  env: Env,
  criteria: SearchProfileParsed,
  items: { job: JobInputParsed; fit: JobFit }[],
): Promise<({ score: number; reason: string } | null)[]> {
  if (!aiEnabled(env) || items.length === 0) return items.map(() => null);
  const postings = items.map((item, index) => ({
    index,
    title: item.job.title,
    company: item.job.company,
    location: item.job.location,
    workArrangement: item.job.remoteType,
    ruleScore: item.fit.score,
    excerpt: truncate((item.job.description ?? '').replace(/\s+/g, ' '), 600),
  }));
  const { data } = await structured(env, rerankSchema, {
    model: fastModel(env),
    effort: 'low',
    system: RERANK_SYSTEM,
    maxTokens: 8000,
    content: [
      {
        type: 'text',
        text: `Search: ${JSON.stringify({
          titles: criteria.titles,
          seniority: criteria.seniority,
          skills: criteria.skills,
          locations: criteria.locations,
          workMode: criteria.workMode,
        })}\n\nPostings: ${JSON.stringify(postings)}`,
      },
    ],
  });
  const byIndex = new Map(data.results.map((r) => [r.index, r]));
  return items.map((_, i) => {
    const r = byIndex.get(i);
    return r
      ? {
          score: Math.max(0, Math.min(100, Math.round(r.score))),
          reason: r.reason.trim().slice(0, 140),
        }
      : null;
  });
}
