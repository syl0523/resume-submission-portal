import type { JobSource } from '@jsp/core';
import { normalizeCompany, normalizeForCompare, normalizeTitle, similarity } from '../text';
import { analyzeJobUrl } from '../url';
import type { SearchResultItem } from './types';

/** Employer's own apply links rank highest; aggregators lowest. */
function linkRank(source: JobSource, url: string | null | undefined): number {
  if (!url) return -1;
  switch (source) {
    case 'greenhouse':
    case 'lever':
    case 'ashby':
    case 'workday':
    case 'smartrecruiters':
    case 'company_site':
    case 'usajobs':
      return 3;
    case 'linkedin':
    case 'indeed':
      return 2;
    case 'adzuna':
      return 1;
    default:
      return 0;
  }
}

function sameLocation(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  if (/remote/i.test(a) || /remote/i.test(b)) return true;
  const wa = new Set(
    normalizeForCompare(a)
      .split(' ')
      .filter((w) => w.length >= 2),
  );
  return normalizeForCompare(b)
    .split(' ')
    .some((w) => w.length >= 2 && wa.has(w));
}

/**
 * Merge the same job seen on several sites (LinkedIn, Indeed, the company's ATS…): first by URL key,
 * then by normalised company + similar title (similarity >= 0.85) + compatible location. The merged item
 * keeps the employer's own apply URL when one exists (ATS or company site beats LinkedIn/Indeed/aggregators),
 * the longest description, salary when any copy has it, and the earliest postedAt. Input order is kept.
 */
export function dedupeJobs<T extends SearchResultItem>(items: T[]): T[] {
  const groups: T[][] = [];
  const byUrl = new Map<string, T[]>();
  for (const item of items) {
    const key = item.job.url ? analyzeJobUrl(item.job.url)?.key : undefined;
    let group = key ? byUrl.get(key) : undefined;
    if (!group) {
      const company = normalizeCompany(item.job.company);
      const title = normalizeTitle(item.job.title);
      group = groups.find((g) =>
        g.some(
          (o) =>
            normalizeCompany(o.job.company) === company &&
            similarity(normalizeTitle(o.job.title), title) >= 0.85 &&
            sameLocation(o.job.location, item.job.location),
        ),
      );
    }
    if (group) group.push(item);
    else {
      group = [item];
      groups.push(group);
    }
    if (key) byUrl.set(key, group);
  }

  return groups.map((group) => {
    const first = group[0] as T;
    if (group.length === 1) return first;
    const best = group.reduce((a, b) =>
      linkRank(b.job.source, b.job.url) > linkRank(a.job.source, a.job.url) ? b : a,
    );
    const description = group
      .map((g) => g.job.description ?? '')
      .reduce((a, b) => (b.length > a.length ? b : a), '');
    const salary = group.find((g) => g.job.salaryMin != null || g.job.salaryMax != null)?.job;
    const posted = group
      .map((g) => g.job.postedAt)
      .filter((p): p is string => Boolean(p) && !Number.isNaN(Date.parse(p ?? '')))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return {
      ...best,
      job: {
        ...best.job,
        description: description || null,
        salaryMin: best.job.salaryMin ?? salary?.salaryMin ?? null,
        salaryMax: best.job.salaryMax ?? salary?.salaryMax ?? null,
        salaryCurrency: best.job.salaryCurrency ?? salary?.salaryCurrency ?? null,
        postedAt: posted ?? best.job.postedAt ?? null,
        location: best.job.location ?? group.find((g) => g.job.location)?.job.location ?? null,
      },
    };
  });
}
