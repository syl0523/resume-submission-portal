import type { ApplicationStatus, EmailKind, EventSource } from './enums';

/** Forward order of the pipeline. Side states (rejected, withdrawn, ghosted) are not ranked. */
export const PIPELINE_ORDER = [
  'saved',
  'applied',
  'viewed',
  'screening',
  'interview',
  'offer',
] as const;

const RANK: Partial<Record<ApplicationStatus, number>> = {
  saved: 0,
  applied: 1,
  viewed: 2,
  screening: 3,
  interview: 4,
  offer: 5,
};

/** Statuses that count as "in flight" for follow-ups, ghosting and dashboards. */
export const ACTIVE_STATUSES: readonly ApplicationStatus[] = [
  'applied',
  'viewed',
  'screening',
  'interview',
];

/** Statuses that only a person can leave. Automation never moves an application out of these. */
export const FINAL_STATUSES: readonly ApplicationStatus[] = ['offer', 'rejected', 'withdrawn'];

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger' | 'muted';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  description: string;
}

export const STATUS_META: Record<ApplicationStatus, StatusMeta> = {
  saved: { label: 'Saved', tone: 'neutral', description: 'Bookmarked, not applied yet' },
  applied: { label: 'Applied', tone: 'info', description: 'Application submitted' },
  viewed: { label: 'Viewed', tone: 'info', description: 'The employer opened your application' },
  screening: {
    label: 'Screening',
    tone: 'progress',
    description: 'Recruiter screen or assessment',
  },
  interview: { label: 'Interview', tone: 'progress', description: 'Interviewing' },
  offer: { label: 'Offer', tone: 'success', description: 'Offer received' },
  rejected: { label: 'Rejected', tone: 'danger', description: 'Not moving forward' },
  withdrawn: { label: 'Withdrawn', tone: 'muted', description: 'You withdrew' },
  ghosted: {
    label: 'No response',
    tone: 'muted',
    description: 'No reply within the follow-up window',
  },
};

/** What each kind of inbound email implies for the application status (null = timeline only). */
export const EMAIL_KIND_TO_STATUS: Record<EmailKind, ApplicationStatus | null> = {
  application_received: 'applied',
  application_viewed: 'viewed',
  screening: 'screening',
  assessment: 'screening',
  interview: 'interview',
  offer: 'offer',
  rejection: 'rejected',
  other: null,
};

export function pipelineRank(status: ApplicationStatus): number | null {
  return RANK[status] ?? null;
}

export function isActive(status: ApplicationStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isFinal(status: ApplicationStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

export interface TransitionDecision {
  apply: boolean;
  reason: string;
}

/**
 * Decide whether a proposed status change should be applied.
 *
 * Rules (see docs/adr/0003-email-forwarding-for-status.md):
 * - Manual changes always apply.
 * - Automation (email, import, extension, system) only moves an application forward,
 *   never out of a final status, and never sets `withdrawn`.
 * - A rejection can arrive at any non-final point.
 * - `ghosted` is set only by the system, and only for active applications; any later
 *   activity revives a ghosted application.
 */
export function decideTransition(
  current: ApplicationStatus,
  proposed: ApplicationStatus,
  source: EventSource,
): TransitionDecision {
  if (current === proposed) return { apply: false, reason: 'Status unchanged' };
  if (source === 'manual') return { apply: true, reason: 'Changed manually' };

  if (proposed === 'withdrawn') {
    return { apply: false, reason: 'Only you can withdraw an application' };
  }
  if (isFinal(current)) {
    return { apply: false, reason: `${STATUS_META[current].label} is final unless you change it` };
  }
  if (proposed === 'ghosted') {
    return source === 'system' && isActive(current)
      ? { apply: true, reason: 'No activity within the follow-up window' }
      : { apply: false, reason: 'No-response is only set automatically for active applications' };
  }
  if (proposed === 'rejected') return { apply: true, reason: 'Rejection detected' };

  const to = pipelineRank(proposed);
  if (to === null) return { apply: false, reason: 'Unsupported transition' };

  if (current === 'ghosted') {
    return to >= (RANK.applied ?? 1)
      ? { apply: true, reason: 'New activity after a quiet period' }
      : { apply: false, reason: 'Cannot move a submitted application back to saved' };
  }

  const from = pipelineRank(current);
  if (from === null) return { apply: false, reason: 'Unsupported transition' };
  return to > from
    ? { apply: true, reason: 'Moved forward' }
    : { apply: false, reason: 'Automated updates never move an application backwards' };
}

/** Follow-up date for a fresh application: `days` after it was submitted. */
export function followUpDate(appliedAt: string, days: number): string {
  const d = new Date(appliedAt);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
