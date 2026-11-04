import {
  type ApplicationStatus,
  type EmailClassification,
  isActive,
  isFinal,
  type JobSource,
} from '@jsp/core';
import { normalizeCompany, normalizeTitle, similarity } from './text';
import { analyzeJobUrl } from './url';

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

/** Two candidates closer than this are "too close to call": better unmatched than wrong. */
const AMBIGUITY_MARGIN = 0.05;

/** 1 for the same key, 0.92 when one name contains the other as whole words, else bigram similarity. */
export function companySimilarity(a: string, b: string): number {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)) return 0.92;
  return similarity(x, y);
}

/**
 * Pick the application an email is about (KAN-21).
 *
 * 1. Same job id (source + external id) or the same canonical job URL wins outright.
 * 2. Otherwise company similarity, combined with title similarity when the email names a role,
 *    nudged up for active and recent applications and down for final ones.
 * Returns null when nothing clears MATCH_THRESHOLD or two candidates are too close to call, so
 * the email waits in the Inbox instead of updating the wrong application.
 */
export function matchApplication(
  email: Pick<
    EmailClassification,
    'company' | 'jobTitle' | 'jobUrl' | 'externalJobId' | 'provider'
  >,
  candidates: MatchCandidate[],
  now: Date = new Date(),
): MatchResult | null {
  if (candidates.length === 0) return null;

  const emailUrl = email.jobUrl ? analyzeJobUrl(email.jobUrl) : null;
  if (email.externalJobId) {
    const byId = candidates.find(
      (c) =>
        c.externalId === email.externalJobId &&
        (!emailUrl || !c.source || c.source === emailUrl.source),
    );
    if (byId) return { applicationId: byId.id, score: 1, reason: 'Same job id' };
  }
  if (emailUrl) {
    const byUrl = candidates.find((c) => c.url && analyzeJobUrl(c.url)?.key === emailUrl.key);
    if (byUrl) return { applicationId: byUrl.id, score: 1, reason: 'Same job link' };
  }

  if (!email.company || !normalizeCompany(email.company)) return null;
  const wantTitle = email.jobTitle ? normalizeTitle(email.jobTitle) : '';

  const scored = candidates
    .map((c) => {
      const cs = companySimilarity(email.company ?? '', c.company);
      if (cs < 0.6) return null;
      const ts = wantTitle ? similarity(wantTitle, normalizeTitle(c.title)) : null;
      let score = ts === null ? cs * 0.86 : cs * 0.6 + ts * 0.4;
      if (isActive(c.status)) score += 0.05;
      else if (isFinal(c.status)) score -= 0.08;
      const days = (now.getTime() - Date.parse(c.lastActivityAt)) / 86_400_000;
      if (days <= 45) score += 0.03;
      else if (days > 180) score -= 0.05;
      return { c, ts, score: Math.max(0, Math.min(1, score)) };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.score - a.score);

  const [best, second] = scored;
  if (!best || best.score < MATCH_THRESHOLD) return null;
  if (second && best.score - second.score < AMBIGUITY_MARGIN) return null;
  return {
    applicationId: best.c.id,
    score: Math.round(best.score * 100) / 100,
    reason: best.ts === null ? 'Company matches' : 'Company and job title match',
  };
}
