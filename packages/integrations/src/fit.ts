import type { JobFit, JobInputParsed, SearchProfileParsed } from '@jsp/core';

export type FitJob = Pick<
  JobInputParsed,
  | 'title'
  | 'company'
  | 'description'
  | 'location'
  | 'remoteType'
  | 'salaryMin'
  | 'salaryMax'
  | 'postedAt'
>;

/**
 * Deterministic resume-to-job fit, 0-100: title similarity to the target titles, skill coverage in the
 * posting text, work-mode and location fit, salary floor, freshness. Exclude keywords mark the posting
 * `excluded`. Runs in the Worker and in the extension popup, so no I/O.
 * TODO(integrations agent, Job Match): implement.
 */
export function scoreJobFit(
  profile: SearchProfileParsed,
  job: FitJob,
  now: Date = new Date(),
): JobFit {
  void profile;
  void job;
  void now;
  return {
    score: 0,
    titleMatch: 0,
    matchedSkills: [],
    missingSkills: [],
    reasons: [],
    flags: [],
    excluded: false,
  };
}
