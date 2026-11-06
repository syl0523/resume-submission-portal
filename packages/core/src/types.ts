import type {
  ApplicationStatus,
  ApplyChannel,
  BoardProvider,
  CaptureMethod,
  Classifier,
  DeepLinkSite,
  EmailKind,
  EmailProvider,
  EventSource,
  EventType,
  FitFlag,
  InboxStatus,
  JobSource,
  RemoteType,
  SearchProvider,
} from './enums';
import type {
  Address,
  EducationEntry,
  ExperienceEntry,
  JobInputParsed,
  SearchProfileParsed,
} from './schemas';

/** API response shapes. All timestamps are ISO-8601 strings in UTC. */

export interface User {
  id: string;
  email: string;
  name: string | null;
  inboundAlias: string;
  createdAt: string;
}

export interface Job {
  id: string;
  source: JobSource;
  externalId: string | null;
  url: string | null;
  title: string;
  company: string;
  location: string | null;
  remoteType: RemoteType;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  description: string | null;
  postedAt: string | null;
  capturedVia: CaptureMethod;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  jobId: string;
  resumeId: string | null;
  status: ApplicationStatus;
  appliedAt: string | null;
  appliedVia: ApplyChannel | null;
  lastActivityAt: string;
  nextFollowUpAt: string | null;
  notes: string | null;
  /** Resume-fit score (0-100) captured when the job was saved from Job Match or the extension. */
  fitScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export type JobSummary = Pick<
  Job,
  | 'id'
  | 'title'
  | 'company'
  | 'location'
  | 'source'
  | 'url'
  | 'remoteType'
  | 'salaryMin'
  | 'salaryMax'
  | 'salaryCurrency'
>;

export interface ApplicationListItem extends Application {
  job: JobSummary;
}

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  type: EventType;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus | null;
  source: EventSource;
  summary: string;
  /** For `interview` events: when the interview takes place. */
  scheduledAt: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface Resume {
  id: string;
  label: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isDefault: boolean;
  /** True when a plain-text version is stored (used for AI features on non-PDF files). */
  hasText: boolean;
  /** Archived versions stay downloadable from the applications that used them. */
  archived: boolean;
  createdAt: string;
}

export interface ApplicationDetail {
  application: Application;
  job: Job;
  resume: Resume | null;
  events: ApplicationEvent[];
}

export interface CustomAnswer {
  question: string;
  answer: string;
}

export interface Profile {
  fullName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  address: Address | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  githubUrl: string | null;
  workAuthorization: string | null;
  summary: string | null;
  skills: string[];
  languages: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  customAnswers: CustomAnswer[];
  updatedAt: string | null;
}

export interface MeResponse {
  user: User;
  /** Address to forward application emails to, or null when inbound email is not configured. */
  inboundAddress: string | null;
  /** Private iCalendar feed of interviews and follow-ups (subscribe from Outlook / Google Calendar). */
  calendarUrl: string;
  features: {
    ai: boolean;
    adzuna: boolean;
    usajobs: boolean;
    jsearch: boolean;
    inboundEmail: boolean;
  };
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

export interface InboxItem {
  id: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  provider: EmailProvider;
  kind: EmailKind;
  company: string | null;
  jobTitle: string | null;
  confidence: number;
  classifier: Classifier;
  status: InboxStatus;
  applicationId: string | null;
  application: { id: string; company: string; title: string; status: ApplicationStatus } | null;
  snippet: string | null;
  error: string | null;
  createdAt: string;
}

export interface IngestResult {
  item: InboxItem;
  applicationId: string | null;
  /** True when this email created a new application (e.g. an Easy Apply confirmation). */
  created: boolean;
  statusChanged: boolean;
}

export interface RecentEvent extends ApplicationEvent {
  company: string;
  title: string;
}

export interface WeeklyPoint {
  /** Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  applied: number;
  /** Status changes into an employer-response status (viewed or beyond, or rejected) that week. */
  responses: number;
}

export interface UpcomingInterview {
  eventId: string;
  applicationId: string;
  company: string;
  title: string;
  summary: string;
  scheduledAt: string;
}

export interface DashboardStats {
  counts: Record<ApplicationStatus, number>;
  total: number;
  active: number;
  appliedLast7Days: number;
  appliedLast30Days: number;
  /** Share of submitted applications that got any employer response (0..1). */
  responseRate: number;
  /** Share of submitted applications that reached screening or later (0..1). */
  interviewRate: number;
  followUpsDue: ApplicationListItem[];
  upcomingInterviews: UpcomingInterview[];
  recentEvents: RecentEvent[];
  /** Last 12 weeks, oldest first. */
  weekly: WeeklyPoint[];
  bySource: { source: JobSource; count: number }[];
  /** New, undismissed saved-search hits across all searches. */
  newMatches: number;
}

export interface WatchedBoard {
  id: string;
  provider: BoardProvider;
  token: string;
  companyName: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  openPostings: number;
  newPostings: number;
  createdAt: string;
}

/** `POST /api/boards/sync`: every watched board synced now (KAN-69). */
export interface BoardSyncAllResponse {
  synced: number;
  failed: number;
  /** All watched boards after the sync, as `GET /api/boards` returns them. */
  boards: WatchedBoard[];
}

export interface BoardPosting {
  id: string;
  boardId: string;
  companyName: string;
  provider: BoardProvider;
  externalId: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: string | null;
  firstSeenAt: string;
  isNew: boolean;
  savedApplicationId: string | null;
}

/** A job found by search or URL resolution, not yet saved. */
export type JobDraft = Partial<JobInputParsed> & { url?: string | null };

export interface ProviderOutcome {
  provider: SearchProvider;
  total: number;
  /** Null on success; "not_configured" when the provider has no API key; otherwise a short message. */
  error: string | null;
}

export interface DiscoverItem {
  provider: SearchProvider;
  /** Badge text: "LinkedIn", "Indeed", "Company site", "Adzuna", "USAJOBS"… */
  sourceLabel: string;
  job: JobInputParsed;
  existingApplicationId: string | null;
}

export interface DiscoverResponse {
  items: DiscoverItem[];
  /** Sum of provider totals (approximate; providers count differently). */
  total: number;
  page: number;
  providers: ProviderOutcome[];
}

/** Deterministic resume-to-job fit (packages/integrations scoreJobFit). */
export interface JobFit {
  /** 0-100 */
  score: number;
  /** 0..1 similarity between the posting title and the closest target title. */
  titleMatch: number;
  matchedSkills: string[];
  missingSkills: string[];
  /** Short human-readable reasons, e.g. "Remote, as preferred", "Posted 2 days ago". */
  reasons: string[];
  /** Warnings, e.g. no visa sponsorship, clearance required, salary below your minimum. */
  flags: FitFlag[];
  /** True when an exclude keyword, the salary floor or a sponsorship rule rules the posting out. */
  excluded: boolean;
}

export interface SavedSearch extends SearchProfileParsed {
  id: string;
  name: string;
  alertsEnabled: boolean;
  lastRunAt: string | null;
  totalHits: number;
  newHits: number;
  createdAt: string;
  updatedAt: string;
}

/** Draft returned by AI from a resume; not saved until the user PUTs/POSTs it. */
export type SavedSearchDraft = SearchProfileParsed & { name: string; alertsEnabled: boolean };

export interface SearchHit {
  id: string;
  searchId: string;
  provider: SearchProvider;
  sourceLabel: string;
  job: JobInputParsed;
  fit: JobFit;
  /** Present when the run used aiRerank and AI is configured. */
  aiFit: { score: number; reason: string } | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** First seen in the most recent run (and not on the search's first run). */
  isNew: boolean;
  dismissed: boolean;
  /** Set once saved; also set when the same job already exists as an application. */
  applicationId: string | null;
}

export interface DeepLink {
  label: string;
  url: string;
}

export interface DeepLinkGroup {
  site: DeepLinkSite;
  label: string;
  links: DeepLink[];
}

export interface RunSearchResponse {
  search: SavedSearch;
  /** Hits from this run, ranked by fit (AI score when re-ranked), excluded last. */
  hits: SearchHit[];
  /** The title x location queries that were run. */
  queries: { title: string; location: string | null }[];
  providers: ProviderOutcome[];
  /** Pre-filled LinkedIn / Indeed / Google Jobs searches for the same criteria. */
  deepLinks: DeepLinkGroup[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedApiToken extends ApiTokenInfo {
  /** Shown once. Only a hash is stored. */
  token: string;
}

export interface FitReport {
  /** 0-100 */
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  missingKeywords: string[];
  suggestions: string[];
  coverLetter: string | null;
  model: string;
  createdAt: string;
}

export interface AiAnswer {
  answer: string;
  model: string;
}

export interface ResolveUrlResponse {
  job: JobDraft;
  /** True when details were fetched from an official board API. */
  fetched: boolean;
  message: string | null;
  existingApplicationId: string | null;
}

export interface ExtSaveResponse {
  application: ApplicationListItem;
  duplicate: boolean;
  portalUrl: string;
}

export interface ExtProfileResponse {
  user: Pick<User, 'email' | 'name'>;
  profile: Profile;
  resumes: Resume[];
  /** Saved searches; the popup shows the best fit across them for the job on the current tab. */
  searches: SavedSearch[];
}

export interface ExtLookupResponse {
  application: ApplicationListItem | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Output of the email parsers (packages/integrations). */
export interface EmailClassification {
  provider: EmailProvider;
  kind: EmailKind;
  company: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  externalJobId: string | null;
  /** For interview emails that state a time: ISO-8601 (UTC). */
  interviewAt: string | null;
  /** 0..1. Below 0.6 the Worker asks the AI classifier (when configured) for a second opinion. */
  confidence: number;
  /** Ids of the rules that fired, for explainability in the Inbox UI. */
  signals: string[];
}

/** One row parsed from an import file (LinkedIn data export or a generic CSV). */
export interface ImportedApplication {
  job: JobInputParsed;
  status: ApplicationStatus;
  appliedAt: string | null;
  appliedVia: ApplyChannel | null;
  resumeName: string | null;
  notes: string | null;
}

export interface ImportParseResult {
  rows: ImportedApplication[];
  errors: { row: number; message: string }[];
}
