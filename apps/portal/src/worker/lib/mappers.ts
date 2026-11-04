import type {
  Application,
  ApplicationEvent,
  ApplicationListItem,
  Job,
  JobSummary,
  Profile,
  Resume,
  SavedSearch,
  SearchHit,
} from '@jsp/core';
import type {
  ApplicationEventRow,
  ApplicationRow,
  JobRow,
  ProfileRow,
  ResumeRow,
  SavedSearchRow,
  SearchHitRow,
} from '../db/schema';

/** Row -> API shape conversions shared by every route. Keep them pure. */

export function toJob(r: JobRow): Job {
  return {
    id: r.id,
    source: r.source,
    externalId: r.externalId,
    url: r.url,
    title: r.title,
    company: r.company,
    location: r.location,
    remoteType: r.remoteType,
    employmentType: r.employmentType,
    salaryMin: r.salaryMin,
    salaryMax: r.salaryMax,
    salaryCurrency: r.salaryCurrency,
    description: r.description,
    postedAt: r.postedAt,
    capturedVia: r.capturedVia,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toJobSummary(r: JobRow): JobSummary {
  return {
    id: r.id,
    title: r.title,
    company: r.company,
    location: r.location,
    source: r.source,
    url: r.url,
    remoteType: r.remoteType,
    salaryMin: r.salaryMin,
    salaryMax: r.salaryMax,
    salaryCurrency: r.salaryCurrency,
  };
}

export function toApplication(r: ApplicationRow): Application {
  return {
    id: r.id,
    jobId: r.jobId,
    resumeId: r.resumeId,
    status: r.status,
    appliedAt: r.appliedAt,
    appliedVia: r.appliedVia,
    lastActivityAt: r.lastActivityAt,
    nextFollowUpAt: r.nextFollowUpAt,
    notes: r.notes,
    fitScore: r.fitScore,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toListItem(app: ApplicationRow, job: JobRow): ApplicationListItem {
  return { ...toApplication(app), job: toJobSummary(job) };
}

export function toEvent(r: ApplicationEventRow): ApplicationEvent {
  return {
    id: r.id,
    applicationId: r.applicationId,
    type: r.type,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    source: r.source,
    summary: r.summary,
    scheduledAt: r.scheduledAt,
    occurredAt: r.occurredAt,
    createdAt: r.createdAt,
  };
}

export function toResume(r: ResumeRow): Resume {
  return {
    id: r.id,
    label: r.label,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    isDefault: r.isDefault,
    hasText: Boolean(r.textContent?.trim()),
    archived: r.archivedAt !== null,
    createdAt: r.createdAt,
  };
}

/** Profile for a user; an empty profile (account email prefilled) when none is saved yet. */
export function toProfile(r: ProfileRow | undefined, fallbackEmail: string): Profile {
  if (!r) {
    return {
      fullName: null,
      headline: null,
      email: fallbackEmail,
      phone: null,
      location: null,
      address: null,
      linkedinUrl: null,
      websiteUrl: null,
      githubUrl: null,
      workAuthorization: null,
      summary: null,
      skills: [],
      languages: [],
      experience: [],
      education: [],
      customAnswers: [],
      updatedAt: null,
    };
  }
  return {
    fullName: r.fullName,
    headline: r.headline,
    email: r.email ?? fallbackEmail,
    phone: r.phone,
    location: r.location,
    address: r.address ?? null,
    linkedinUrl: r.linkedinUrl,
    websiteUrl: r.websiteUrl,
    githubUrl: r.githubUrl,
    workAuthorization: r.workAuthorization,
    summary: r.summary,
    skills: r.skills,
    languages: r.languages,
    experience: r.experience,
    education: r.education,
    customAnswers: r.customAnswers,
    updatedAt: r.updatedAt,
  };
}

const POSTED_WITHIN = [1, 3, 7, 14, 30] as const;
type PostedWithin = (typeof POSTED_WITHIN)[number];

function toPostedWithin(n: number): PostedWithin {
  return POSTED_WITHIN.find((d) => d >= n) ?? 30;
}

export function toSavedSearch(
  r: SavedSearchRow,
  counts: { totalHits: number; newHits: number },
): SavedSearch {
  return {
    id: r.id,
    name: r.name,
    resumeId: r.resumeId,
    titles: r.titles,
    skills: r.skills,
    locations: r.locations,
    workMode: r.workMode,
    seniority: r.seniority,
    keywords: r.keywords,
    excludeKeywords: r.excludeKeywords,
    minSalary: r.minSalary,
    postedWithinDays: toPostedWithin(r.postedWithinDays),
    needsSponsorship: r.needsSponsorship,
    summary: r.summary,
    alertsEnabled: r.alertsEnabled,
    lastRunAt: r.lastRunAt,
    totalHits: counts.totalHits,
    newHits: counts.newHits,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toSearchHit(r: SearchHitRow): SearchHit {
  return {
    id: r.id,
    searchId: r.searchId,
    provider: r.provider,
    sourceLabel: r.sourceLabel,
    job: r.job,
    fit: r.fit,
    aiFit: r.aiFit ?? null,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    isNew: r.isNew,
    dismissed: r.dismissed,
    applicationId: r.applicationId,
  };
}
