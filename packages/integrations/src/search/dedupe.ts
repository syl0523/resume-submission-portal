import type { SearchResultItem } from './types';

/**
 * Merge the same job seen on several sites (LinkedIn, Indeed, the company's ATS…): first by URL key,
 * then by normalised company + similar title (similarity >= 0.85) + compatible location. The merged item
 * keeps the employer's own apply URL when one exists (ATS or company site beats LinkedIn/Indeed/aggregators),
 * the longest description, salary when any copy has it, and the earliest postedAt. Input order is kept.
 * TODO(integrations agent, Job Match): implement.
 */
export function dedupeJobs<T extends SearchResultItem>(items: T[]): T[] {
  return items;
}
