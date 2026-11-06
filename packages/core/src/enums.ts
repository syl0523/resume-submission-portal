/**
 * Closed vocabularies shared by the Worker, the web portal, the extension and the integrations.
 * Every enum is a readonly tuple so it can feed both Zod (`z.enum(...)`) and TypeScript unions.
 */

/** Where an application sits in the hiring pipeline. */
export const APPLICATION_STATUSES = [
  'saved',
  'applied',
  'viewed',
  'screening',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** The site a job posting lives on. */
export const JOB_SOURCES = [
  'linkedin',
  'indeed',
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'smartrecruiters',
  'adzuna',
  'usajobs',
  'company_site',
  'email',
  'manual',
  'other',
] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

/** How the job got into the portal. */
export const CAPTURE_METHODS = [
  'extension',
  'manual',
  'import',
  'board',
  'search',
  'email',
] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/** How the application was submitted. */
export const APPLY_CHANNELS = [
  'linkedin_easy_apply',
  'indeed_apply',
  'company_site',
  'email',
  'referral',
  'recruiter',
  'other',
] as const;
export type ApplyChannel = (typeof APPLY_CHANNELS)[number];

export const REMOTE_TYPES = ['onsite', 'hybrid', 'remote', 'unknown'] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

/** Timeline entry kinds on an application. */
export const EVENT_TYPES = [
  'created',
  'status_change',
  'note',
  'email',
  'import',
  'interview',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Who or what caused a change. Manual changes always win over automated ones. */
export const EVENT_SOURCES = ['manual', 'email', 'import', 'system', 'extension'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** Sender families recognised by the email parsers. */
export const EMAIL_PROVIDERS = [
  'linkedin',
  'indeed',
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'smartrecruiters',
  'icims',
  'taleo',
  'successfactors',
  'generic',
] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/** What an inbound email means for an application. */
export const EMAIL_KINDS = [
  'application_received',
  'application_viewed',
  'screening',
  'assessment',
  'interview',
  'offer',
  'rejection',
  'other',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Outcome of processing an inbound email. */
export const INBOX_STATUSES = ['matched', 'created', 'unmatched', 'ignored', 'error'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/** Company job boards with official public posting APIs. */
export const BOARD_PROVIDERS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'] as const;
export type BoardProvider = (typeof BOARD_PROVIDERS)[number];

/**
 * Job search sources behind Discover and Job Match (US-first):
 * - jsearch: Google for Jobs aggregate via JSearch (LinkedIn, Indeed, Glassdoor, company sites)
 * - adzuna: Adzuna's US index
 * - usajobs: USAJOBS, US federal jobs (official API)
 * - boards: open postings on the company boards you watch
 * - muse: The Muse public jobs API (no key; filtered by title locally, since it has no keyword search)
 */
export const SEARCH_PROVIDERS = ['jsearch', 'adzuna', 'usajobs', 'boards', 'muse'] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

/** Work arrangement preference in a search profile. */
export const WORK_MODES = ['any', 'remote', 'hybrid', 'onsite'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

/** Seniority, aligned with LinkedIn's experience-level filter. */
export const SENIORITY_LEVELS = [
  'internship',
  'entry',
  'associate',
  'mid_senior',
  'director',
  'executive',
] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

/** Sites we build pre-filled search links for (no API involved). */
export const DEEP_LINK_SITES = ['linkedin', 'indeed', 'google'] as const;
export type DeepLinkSite = (typeof DEEP_LINK_SITES)[number];

export const CLASSIFIERS = ['rules', 'ai', 'manual'] as const;
export type Classifier = (typeof CLASSIFIERS)[number];

/** Warnings scoreJobFit attaches to a posting. */
export const FIT_FLAGS = [
  'no_sponsorship',
  'citizenship_required',
  'clearance_required',
  'relocation_required',
  'contract_role',
  'salary_below_min',
  'stale_posting',
  'excluded_keyword',
] as const;
export type FitFlag = (typeof FIT_FLAGS)[number];
