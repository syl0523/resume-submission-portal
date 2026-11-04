import { z } from 'zod';
import {
  APPLICATION_STATUSES,
  APPLY_CHANNELS,
  BOARD_PROVIDERS,
  CAPTURE_METHODS,
  JOB_SOURCES,
  REMOTE_TYPES,
  SEARCH_PROVIDERS,
  SENIORITY_LEVELS,
  WORK_MODES,
} from './enums';

/**
 * Request validation schemas. The Worker validates every request body/query with these;
 * clients use the `z.input<>` types exported below. Clients send `null` (not "") for empty
 * optional fields.
 */

export const urlSchema = z.url({ protocol: /^https?$/ }).max(2000);

export const isoDateSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Expected an ISO-8601 date');

const idSchema = z.string().trim().min(1).max(64);

const shortList = (maxItems: number, maxLength = 80) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);

const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

// ---------------------------------------------------------------------------------------------
// Jobs and applications
// ---------------------------------------------------------------------------------------------

const jobFields = {
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(200),
  url: urlSchema.nullish(),
  source: z.enum(JOB_SOURCES),
  externalId: z.string().trim().max(200).nullish(),
  location: z.string().trim().max(200).nullish(),
  remoteType: z.enum(REMOTE_TYPES),
  employmentType: z.string().trim().max(60).nullish(),
  salaryMin: z.number().int().nonnegative().max(10_000_000).nullish(),
  salaryMax: z.number().int().nonnegative().max(10_000_000).nullish(),
  salaryCurrency: z.string().trim().length(3).nullish(),
  description: z.string().max(100_000).nullish(),
  postedAt: isoDateSchema.nullish(),
};

/** A job as captured from anywhere (extension, manual form, import, board, search). */
export const jobInputSchema = z.object({
  ...jobFields,
  source: jobFields.source.default('manual'),
  remoteType: jobFields.remoteType.default('unknown'),
});

/** Partial job update. No defaults, so omitted fields are left untouched. */
export const jobPatchSchema = z.object(jobFields).partial();

const fitScoreSchema = z.number().int().min(0).max(100);

export const createApplicationSchema = z.object({
  job: jobInputSchema,
  status: z.enum(APPLICATION_STATUSES).default('saved'),
  resumeId: idSchema.nullish(),
  appliedAt: isoDateSchema.nullish(),
  appliedVia: z.enum(APPLY_CHANNELS).nullish(),
  notes: z.string().max(20_000).nullish(),
  capturedVia: z.enum(CAPTURE_METHODS).default('manual'),
  /** Fit score computed by the client (Job Match or extension), kept for sorting. */
  fitScore: fitScoreSchema.nullish(),
});

export const updateApplicationSchema = z.object({
  job: jobPatchSchema.optional(),
  resumeId: idSchema.nullish(),
  appliedAt: isoDateSchema.nullish(),
  appliedVia: z.enum(APPLY_CHANNELS).nullish(),
  notes: z.string().max(20_000).nullish(),
  nextFollowUpAt: isoDateSchema.nullish(),
});

export const listApplicationsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  /** One status or a comma-separated list, e.g. `applied,viewed`. */
  status: z.string().trim().max(200).optional(),
  source: z.enum(JOB_SOURCES).optional(),
  sort: z.enum(['activity', 'created', 'applied', 'company', 'fit']).default('activity'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const statusChangeSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  note: z.string().trim().max(2000).optional(),
  occurredAt: isoDateSchema.optional(),
  /** When moving to `interview`: the interview time, added to the calendar feed. */
  interviewAt: isoDateSchema.optional(),
});

export const noteSchema = z.object({
  text: z.string().trim().min(1).max(5000),
});

/** A scheduled interview (shows in the calendar feed). */
export const interviewSchema = z.object({
  scheduledAt: isoDateSchema,
  /** e.g. "Phone screen with the recruiter" */
  title: z.string().trim().min(1).max(200).default('Interview'),
  /** Meeting link or address. */
  location: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

// ---------------------------------------------------------------------------------------------
// Profile (autofill + AI context), resumes, tokens
// ---------------------------------------------------------------------------------------------

export const customAnswerSchema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().max(5000),
});

const monthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2})?$/, 'Use YYYY or YYYY-MM');

export const experienceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullish(),
  start: monthSchema.nullish(),
  /** Null with `current: true` for the present role. */
  end: monthSchema.nullish(),
  current: z.boolean().default(false),
  highlights: shortList(12, 500).default([]),
});

export const educationSchema = z.object({
  school: z.string().trim().min(1).max(200),
  degree: z.string().trim().max(200).nullish(),
  field: z.string().trim().max(200).nullish(),
  start: monthSchema.nullish(),
  end: monthSchema.nullish(),
});

export const addressSchema = z.object({
  line1: z.string().trim().max(200).nullish(),
  line2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  /** State / province code, e.g. "TX", "ON". */
  region: z.string().trim().max(120).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  /** ISO 3166-1 alpha-2, e.g. "US", "CA". */
  country: z.string().trim().max(2).nullish(),
});

/** Autofill profile. PUT replaces the whole profile. */
export const profileSchema = z.object({
  fullName: z.string().trim().max(200).nullish(),
  /** One-line professional headline, e.g. "HR Generalist | HRIS | Logistics". */
  headline: z.string().trim().max(200).nullish(),
  email: z.email().max(320).nullish(),
  phone: z.string().trim().max(40).nullish(),
  /** Display location, e.g. "Toronto, ON" or "Austin, TX". */
  location: z.string().trim().max(200).nullish(),
  address: addressSchema.nullish(),
  linkedinUrl: urlSchema.nullish(),
  websiteUrl: urlSchema.nullish(),
  githubUrl: urlSchema.nullish(),
  /** Free text used to answer work-authorization questions; never auto-submitted. */
  workAuthorization: z.string().trim().max(500).nullish(),
  summary: z.string().trim().max(5000).nullish(),
  skills: shortList(80).default([]),
  /** e.g. "English (native)", "Mandarin (fluent)". */
  languages: shortList(10).default([]),
  experience: z.array(experienceSchema).max(30).default([]),
  education: z.array(educationSchema).max(10).default([]),
  customAnswers: z.array(customAnswerSchema).max(50).default([]),
});

export const resumeUpdateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  isDefault: z.boolean().optional(),
  /** Plain-text version of the resume, used for AI features on non-PDF files. */
  textContent: z.string().max(100_000).nullish(),
  /** Archived versions are hidden but kept, because applications reference what was sent. */
  archived: z.boolean().optional(),
});

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

// ---------------------------------------------------------------------------------------------
// Email inbox
// ---------------------------------------------------------------------------------------------

export const pasteEmailSchema = z
  .object({
    /** Full RFC 822 message (.eml contents). Preferred: keeps headers for provider detection. */
    raw: z.string().max(2_000_000).optional(),
    from: z.string().trim().max(320).optional(),
    subject: z.string().max(1000).optional(),
    text: z.string().max(500_000).optional(),
    html: z.string().max(2_000_000).optional(),
    receivedAt: isoDateSchema.optional(),
  })
  .refine(
    (v) => Boolean(v.raw) || Boolean(v.subject && (v.text || v.html)),
    'Paste the raw email (.eml), or a subject and body',
  );

export const linkInboxSchema = z.object({
  applicationId: idSchema,
});

// ---------------------------------------------------------------------------------------------
// Job hunting: watched boards, keyword search, saved searches (Job Match)
// ---------------------------------------------------------------------------------------------

export const boardCreateSchema = z
  .object({
    /** Any careers URL, e.g. https://job-boards.greenhouse.io/acme or https://jobs.lever.co/acme */
    url: urlSchema.optional(),
    provider: z.enum(BOARD_PROVIDERS).optional(),
    token: z.string().trim().min(1).max(120).optional(),
    companyName: z.string().trim().max(200).optional(),
  })
  .refine(
    (v) => Boolean(v.url) || Boolean(v.provider && v.token),
    'Provide a board URL, or a provider and board token',
  );

export const discoverQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  /** City, state or ZIP, e.g. "Austin, TX". Empty = anywhere in the country. */
  where: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(50).default(1),
  /** `all` queries every configured provider and merges the results. */
  provider: z.enum(['all', ...SEARCH_PROVIDERS]).default('all'),
  /** Only remote roles (provider support varies). */
  remote: queryBoolean.optional(),
  /** Adzuna only: ISO 3166-1 alpha-2, lower case. Defaults to ADZUNA_COUNTRY ("us"). */
  country: z.string().trim().length(2).optional(),
});

/** Search criteria: what to look for. Drafted from a resume by AI, edited by the user. */
export const searchProfileSchema = z.object({
  resumeId: idSchema.nullish(),
  /** Target job titles, most important first. Each becomes a search query. */
  titles: shortList(8).min(1),
  /** Skills, tools and certifications used for fit scoring (e.g. "HRIS", "Workday", "PHR"). */
  skills: shortList(40),
  /** US locations: "Austin, TX", "Remote", ZIP codes. Empty = anywhere in the US. */
  locations: shortList(5, 120),
  workMode: z.enum(WORK_MODES).default('any'),
  seniority: z.enum(SENIORITY_LEVELS).nullish(),
  /** Extra words that should appear (industry, domain). */
  keywords: shortList(20),
  /** Words that disqualify a posting (e.g. "clearance", "commission only"). */
  excludeKeywords: shortList(20),
  /** Minimum base salary, USD per year. */
  minSalary: z.number().int().nonnegative().max(2_000_000).nullish(),
  postedWithinDays: z
    .union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)])
    .default(7),
  /** Hide postings that say no visa sponsorship / US citizens only / clearance required. */
  needsSponsorship: z.boolean().default(false),
  /** Free-text summary shown in the UI ("HR generalist, 6 yrs, logistics, bilingual EN/ZH"). */
  summary: z.string().trim().max(1000).nullish(),
});

/** A named search track ("HR Manager, remote US"), refreshed daily when alerts are on. */
export const savedSearchSchema = searchProfileSchema.extend({
  name: z.string().trim().min(1).max(80),
  alertsEnabled: z.boolean().default(true),
});

export const draftFromResumeSchema = z.object({
  resumeId: idSchema,
});

/** Run a saved search now. Omitted fields: every configured provider, no AI re-rank. */
export const runSearchSchema = z.object({
  providers: z.array(z.enum(SEARCH_PROVIDERS)).min(1).optional(),
  /** Ask a fast Claude model to re-score the top results with a one-line reason (costs tokens). */
  aiRerank: z.boolean().default(false),
  /** Upper bound on title x location queries per provider (protects API quotas). */
  maxQueries: z.number().int().min(1).max(8).default(4),
});

export const listHitsQuerySchema = z.object({
  onlyNew: queryBoolean.optional(),
  includeDismissed: queryBoolean.optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(['fit', 'new']).default('fit'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const saveHitSchema = z.object({
  status: z.enum(['saved', 'applied']).default('saved'),
});

// ---------------------------------------------------------------------------------------------
// URL resolution, AI, extension
// ---------------------------------------------------------------------------------------------

export const resolveUrlSchema = z.object({
  url: urlSchema,
});

export const fitRequestSchema = z.object({
  applicationId: idSchema,
  resumeId: idSchema.optional(),
  coverLetter: z.boolean().default(false),
  /** Ignore the cached report for this application + resume. */
  refresh: z.boolean().default(false),
});

/** Draft an answer to an application question from the profile, resume and job. */
export const aiAnswerSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  applicationId: idSchema.optional(),
  /** Job text when there is no saved application (e.g. from the extension). */
  jobDescription: z.string().max(50_000).optional(),
  maxWords: z.number().int().min(30).max(400).default(150),
});

/** Extension: save the job on the current tab, optionally marking it applied. */
export const extSaveJobSchema = z.object({
  job: jobInputSchema,
  markApplied: z.boolean().default(false),
  resumeId: idSchema.nullish(),
  appliedVia: z.enum(APPLY_CHANNELS).nullish(),
  notes: z.string().max(20_000).nullish(),
  fitScore: fitScoreSchema.nullish(),
});

export const extLookupQuerySchema = z.object({
  url: urlSchema,
});

export type JobInput = z.input<typeof jobInputSchema>;
export type JobInputParsed = z.output<typeof jobInputSchema>;
export type JobPatch = z.input<typeof jobPatchSchema>;
export type CreateApplicationRequest = z.input<typeof createApplicationSchema>;
export type UpdateApplicationRequest = z.input<typeof updateApplicationSchema>;
export type ListApplicationsQuery = z.input<typeof listApplicationsQuerySchema>;
export type StatusChangeRequest = z.input<typeof statusChangeSchema>;
export type NoteRequest = z.input<typeof noteSchema>;
export type InterviewRequest = z.input<typeof interviewSchema>;
export type ExperienceEntry = z.output<typeof experienceSchema>;
export type EducationEntry = z.output<typeof educationSchema>;
export type Address = z.output<typeof addressSchema>;
export type ProfileRequest = z.input<typeof profileSchema>;
export type ResumeUpdateRequest = z.input<typeof resumeUpdateSchema>;
export type TokenCreateRequest = z.input<typeof tokenCreateSchema>;
export type PasteEmailRequest = z.input<typeof pasteEmailSchema>;
export type LinkInboxRequest = z.input<typeof linkInboxSchema>;
export type BoardCreateRequest = z.input<typeof boardCreateSchema>;
export type DiscoverQuery = z.input<typeof discoverQuerySchema>;
export type SearchProfileRequest = z.input<typeof searchProfileSchema>;
export type SearchProfileParsed = z.output<typeof searchProfileSchema>;
export type SavedSearchRequest = z.input<typeof savedSearchSchema>;
export type DraftFromResumeRequest = z.input<typeof draftFromResumeSchema>;
export type RunSearchRequest = z.input<typeof runSearchSchema>;
export type ListHitsQuery = z.input<typeof listHitsQuerySchema>;
export type SaveHitRequest = z.input<typeof saveHitSchema>;
export type ResolveUrlRequest = z.input<typeof resolveUrlSchema>;
export type FitRequest = z.input<typeof fitRequestSchema>;
export type AiAnswerRequest = z.input<typeof aiAnswerSchema>;
export type ExtSaveJobRequest = z.input<typeof extSaveJobSchema>;
