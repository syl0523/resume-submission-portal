import type {
  Address,
  ApplicationStatus,
  ApplyChannel,
  BoardProvider,
  CaptureMethod,
  Classifier,
  CustomAnswer,
  EducationEntry,
  EmailKind,
  EmailProvider,
  EventSource,
  EventType,
  ExperienceEntry,
  InboxStatus,
  JobFit,
  JobInputParsed,
  JobSource,
  RemoteType,
  SearchProvider,
  SeniorityLevel,
  WorkMode,
} from '@jsp/core';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * D1 (SQLite) schema. Conventions:
 * - ids are random UUIDs (text), timestamps are ISO-8601 UTC strings (text)
 * - every user-owned row carries user_id so queries are always scoped to the signed-in user
 * - *_key columns hold normalised values used for dedupe and matching
 */

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    /** Local part of this user's inbound address: <alias>@INBOUND_EMAIL_DOMAIN */
    inboundAlias: text('inbound_alias').notNull(),
    /** Secret in the private calendar feed URL (/api/calendar/<token>.ics). */
    calendarToken: text('calendar_token').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_inbound_alias_uq').on(t.inboundAlias),
    uniqueIndex('users_calendar_token_uq').on(t.calendarToken),
  ],
);

export const profiles = sqliteTable('profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  fullName: text('full_name'),
  headline: text('headline'),
  email: text('email'),
  phone: text('phone'),
  location: text('location'),
  linkedinUrl: text('linkedin_url'),
  websiteUrl: text('website_url'),
  githubUrl: text('github_url'),
  workAuthorization: text('work_authorization'),
  summary: text('summary'),
  address: text('address', { mode: 'json' }).$type<Address>(),
  skills: text('skills', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  languages: text('languages', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  experience: text('experience', { mode: 'json' })
    .$type<ExperienceEntry[]>()
    .notNull()
    .default(sql`'[]'`),
  education: text('education', { mode: 'json' })
    .$type<EducationEntry[]>()
    .notNull()
    .default(sql`'[]'`),
  customAnswers: text('custom_answers', { mode: 'json' })
    .$type<CustomAnswer[]>()
    .notNull()
    .default(sql`'[]'`),
  updatedAt: text('updated_at').notNull(),
});

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** SHA-256 hex of the token. The token itself is shown once and never stored. */
    tokenHash: text('token_hash').notNull(),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
  },
  (t) => [
    uniqueIndex('api_tokens_hash_uq').on(t.tokenHash),
    index('api_tokens_user_idx').on(t.userId),
  ],
);

export const resumes = sqliteTable(
  'resumes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** R2 object key: resumes/<userId>/<resumeId>/<fileName> */
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    textContent: text('text_content'),
    /** Archived versions are hidden in pickers but kept: applications reference what was sent. */
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('resumes_user_idx').on(t.userId)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').$type<JobSource>().notNull(),
    externalId: text('external_id'),
    url: text('url'),
    /** analyzeJobUrl(url).key: dedupe key, unique per user. */
    urlKey: text('url_key'),
    title: text('title').notNull(),
    company: text('company').notNull(),
    /** normalizeCompany(company): used to match emails to applications. */
    companyKey: text('company_key').notNull(),
    location: text('location'),
    remoteType: text('remote_type').$type<RemoteType>().notNull().default('unknown'),
    employmentType: text('employment_type'),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    salaryCurrency: text('salary_currency'),
    description: text('description'),
    postedAt: text('posted_at'),
    capturedVia: text('captured_via').$type<CaptureMethod>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('jobs_user_url_key_uq').on(t.userId, t.urlKey),
    uniqueIndex('jobs_user_source_external_uq').on(t.userId, t.source, t.externalId),
    index('jobs_user_company_idx').on(t.userId, t.companyKey),
  ],
);

/** One application per saved job (1:1 with jobs). Status `saved` = wishlist. */
export const applications = sqliteTable(
  'applications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    resumeId: text('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    status: text('status').$type<ApplicationStatus>().notNull(),
    appliedAt: text('applied_at'),
    appliedVia: text('applied_via').$type<ApplyChannel>(),
    lastActivityAt: text('last_activity_at').notNull(),
    nextFollowUpAt: text('next_follow_up_at'),
    notes: text('notes'),
    fitScore: integer('fit_score'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('applications_job_uq').on(t.jobId),
    index('applications_user_status_idx').on(t.userId, t.status),
    index('applications_user_activity_idx').on(t.userId, t.lastActivityAt),
  ],
);

export const applicationEvents = sqliteTable(
  'application_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: text('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    type: text('type').$type<EventType>().notNull(),
    fromStatus: text('from_status').$type<ApplicationStatus>(),
    toStatus: text('to_status').$type<ApplicationStatus>(),
    source: text('source').$type<EventSource>().notNull(),
    summary: text('summary').notNull(),
    inboundEmailId: text('inbound_email_id'),
    /** For interview events: when the interview takes place (feeds the calendar). */
    scheduledAt: text('scheduled_at'),
    occurredAt: text('occurred_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('events_application_idx').on(t.applicationId, t.occurredAt),
    index('events_user_idx').on(t.userId, t.occurredAt),
    index('events_user_scheduled_idx').on(t.userId, t.scheduledAt),
  ],
);

export const inboundEmails = sqliteTable(
  'inbound_emails',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Message-ID header; makes re-delivery idempotent. */
    messageId: text('message_id'),
    fromAddress: text('from_address').notNull(),
    subject: text('subject').notNull(),
    receivedAt: text('received_at').notNull(),
    provider: text('provider').$type<EmailProvider>().notNull(),
    kind: text('kind').$type<EmailKind>().notNull(),
    company: text('company'),
    jobTitle: text('job_title'),
    confidence: real('confidence').notNull(),
    classifier: text('classifier').$type<Classifier>().notNull().default('rules'),
    applicationId: text('application_id').references(() => applications.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<InboxStatus>().notNull(),
    error: text('error'),
    /** First ~500 characters of the body, for the Inbox review screen. */
    snippet: text('snippet'),
    /** R2 key of the raw MIME message, when stored. */
    rawKey: text('raw_key'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('inbound_user_message_uq').on(t.userId, t.messageId),
    index('inbound_user_status_idx').on(t.userId, t.status, t.receivedAt),
  ],
);

export const watchedBoards = sqliteTable(
  'watched_boards',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<BoardProvider>().notNull(),
    token: text('token').notNull(),
    companyName: text('company_name').notNull(),
    lastSyncedAt: text('last_synced_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('boards_user_provider_token_uq').on(t.userId, t.provider, t.token)],
);

export const boardPostings = sqliteTable(
  'board_postings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: text('board_id')
      .notNull()
      .references(() => watchedBoards.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    location: text('location'),
    url: text('url').notNull(),
    postedAt: text('posted_at'),
    firstSeenAt: text('first_seen_at').notNull(),
    /** Postings not seen in the latest sync are closed. */
    lastSeenAt: text('last_seen_at').notNull(),
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
    savedApplicationId: text('saved_application_id').references(() => applications.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('postings_board_external_uq').on(t.boardId, t.externalId),
    index('postings_user_seen_idx').on(t.userId, t.firstSeenAt),
  ],
);

/** Saved searches (Job Match tracks): criteria drafted from a resume, refreshed daily when alertsEnabled. */
export const savedSearches = sqliteTable(
  'saved_searches',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    resumeId: text('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    titles: text('titles', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    skills: text('skills', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    locations: text('locations', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    workMode: text('work_mode').$type<WorkMode>().notNull().default('any'),
    seniority: text('seniority').$type<SeniorityLevel>(),
    keywords: text('keywords', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    excludeKeywords: text('exclude_keywords', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    minSalary: integer('min_salary'),
    postedWithinDays: integer('posted_within_days').notNull().default(7),
    needsSponsorship: integer('needs_sponsorship', { mode: 'boolean' }).notNull().default(false),
    summary: text('summary'),
    alertsEnabled: integer('alerts_enabled', { mode: 'boolean' }).notNull().default(true),
    lastRunAt: text('last_run_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('searches_user_idx').on(t.userId)],
);

/** Postings found by a saved search, deduped by URL key; kept to detect what is new. */
export const searchHits = sqliteTable(
  'search_hits',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    searchId: text('search_id')
      .notNull()
      .references(() => savedSearches.id, { onDelete: 'cascade' }),
    urlKey: text('url_key').notNull(),
    provider: text('provider').$type<SearchProvider>().notNull(),
    sourceLabel: text('source_label').notNull(),
    job: text('job', { mode: 'json' }).$type<JobInputParsed>().notNull(),
    fit: text('fit', { mode: 'json' }).$type<JobFit>().notNull(),
    fitScore: integer('fit_score').notNull(),
    aiFit: text('ai_fit', { mode: 'json' }).$type<{ score: number; reason: string }>(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    /** True when first seen on a run after the search's first run. */
    isNew: integer('is_new', { mode: 'boolean' }).notNull().default(false),
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
    applicationId: text('application_id').references(() => applications.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('hits_search_url_uq').on(t.searchId, t.urlKey),
    index('hits_user_search_score_idx').on(t.userId, t.searchId, t.fitScore),
  ],
);

/** Cached AI outputs (fit reports, cover letters) so the same request is not paid for twice. */
export const aiReports = sqliteTable(
  'ai_reports',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: text('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    resumeId: text('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    kind: text('kind').$type<'fit'>().notNull(),
    model: text('model').notNull(),
    output: text('output', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('ai_reports_application_idx').on(t.applicationId, t.kind)],
);

export type UserRow = typeof users.$inferSelect;
export type SavedSearchRow = typeof savedSearches.$inferSelect;
export type SearchHitRow = typeof searchHits.$inferSelect;
export type AiReportRow = typeof aiReports.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type ResumeRow = typeof resumes.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type ApplicationEventRow = typeof applicationEvents.$inferSelect;
export type InboundEmailRow = typeof inboundEmails.$inferSelect;
export type WatchedBoardRow = typeof watchedBoards.$inferSelect;
export type BoardPostingRow = typeof boardPostings.$inferSelect;
