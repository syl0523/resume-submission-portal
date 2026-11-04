import type { ApplicationStatus, EmailClassification, JobSource } from '@jsp/core';

/** An existing application the Worker loaded as a possible match for an email. */
export interface MatchCandidate {
  id: string;
  company: string;
  title: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  lastActivityAt: string;
  url?: string | null;
  externalId?: string | null;
  source?: JobSource;
}

export interface MatchResult {
  applicationId: string;
  /** 0..1 */
  score: number;
  reason: string;
}

/** Minimum score for an automatic match. Below it, the email lands in the Inbox as "unmatched". */
export const MATCH_THRESHOLD = 0.72;

/**
 * Pick the application an email is about.
 *
 * TODO(integrations agent): implement. Exact externalJobId / URL match wins; otherwise
 * company similarity (normalizeCompany + similarity) weighted with title similarity and
 * recency, preferring active applications. Return null when nothing clears MATCH_THRESHOLD
 * or when two candidates are too close to call.
 */
export function matchApplication(
  email: Pick<
    EmailClassification,
    'company' | 'jobTitle' | 'jobUrl' | 'externalJobId' | 'provider'
  >,
  candidates: MatchCandidate[],
): MatchResult | null {
  void email;
  void candidates;
  return null;
}
