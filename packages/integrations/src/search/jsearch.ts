import { type JobSource, jobInputSchema, type SeniorityLevel } from '@jsp/core';
import { UpstreamError } from '../errors';
import { asArray, clip, type FetchOptions, getJson, num, str } from '../http';
import { analyzeJobUrl } from '../url';
import type { SearchResult, SearchResultItem } from './types';

export interface JSearchParams {
  /** RapidAPI key. */
  apiKey: string;
  /** Default "jsearch.p.rapidapi.com". */
  host?: string;
  /** e.g. "HR generalist" (location is passed separately). */
  query: string;
  location?: string | null;
  remote?: boolean;
  page?: number;
  postedWithinDays?: number;
  seniority?: SeniorityLevel | null;
  /** ISO country, default "us". */
  country?: string;
}

interface JSearchJob {
  job_id?: string;
  employer_name?: string;
  job_publisher?: string;
  job_title?: string;
  job_apply_link?: string;
  job_apply_is_direct?: boolean;
  job_description?: string;
  job_is_remote?: boolean;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_location?: string;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_salary_period?: string;
  job_employment_type?: string;
  apply_options?: { publisher?: string; apply_link?: string; is_direct?: boolean }[];
}

const AGGREGATOR =
  /linkedin|indeed|glassdoor|ziprecruiter|monster|simplyhired|talent\.com|careerbuilder|jooble|adzuna|lensa|snagajob|dice/i;

function datePosted(days: number | undefined): string {
  if (!days) return 'all';
  if (days <= 1) return 'today';
  if (days <= 3) return '3days';
  if (days <= 7) return 'week';
  return 'month';
}

function requirements(seniority: SeniorityLevel | null | undefined): string | null {
  if (seniority === 'internship' || seniority === 'entry')
    return 'under_3_years_experience,no_experience';
  if (seniority === 'mid_senior' || seniority === 'director' || seniority === 'executive') {
    return 'more_than_3_years_experience';
  }
  return null;
}

/** The employer's own apply link when JSearch has one; otherwise the listing. */
function bestLink(j: JSearchJob): { url: string | null; publisher: string | null } {
  const options = j.apply_options ?? [];
  const direct =
    options.find((o) => o.is_direct && o.apply_link) ??
    options.find(
      (o) =>
        o.apply_link && !AGGREGATOR.test(o.publisher ?? '') && !AGGREGATOR.test(o.apply_link ?? ''),
    );
  if (direct?.apply_link) return { url: direct.apply_link, publisher: str(direct.publisher) };
  return { url: str(j.job_apply_link), publisher: str(j.job_publisher) };
}

function sourceFor(
  publisher: string | null,
  url: string | null,
): { source: JobSource; label: string } {
  if (publisher && /linkedin/i.test(publisher)) return { source: 'linkedin', label: 'LinkedIn' };
  if (publisher && /indeed/i.test(publisher)) return { source: 'indeed', label: 'Indeed' };
  const fromUrl = url ? analyzeJobUrl(url)?.source : undefined;
  if (fromUrl && fromUrl !== 'other' && fromUrl !== 'company_site') {
    return { source: fromUrl, label: publisher ?? 'Company site' };
  }
  if (publisher && AGGREGATOR.test(publisher)) return { source: 'other', label: publisher };
  return { source: 'company_site', label: 'Company site' };
}

/**
 * Search Google for Jobs listings (LinkedIn, Indeed, Glassdoor, ZipRecruiter, company career sites)
 * through the JSearch API on RapidAPI. Third-party data: we never scrape LinkedIn or Indeed ourselves.
 * The job `source` is set from the publisher (LinkedIn -> linkedin, Indeed -> indeed, else from the
 * apply URL via analyzeJobUrl), preferring the employer's own apply link.
 */
export async function searchJSearch(
  params: JSearchParams,
  opts: FetchOptions = {},
): Promise<SearchResult> {
  const host = params.host?.trim() || 'jsearch.p.rapidapi.com';
  const query = params.location ? `${params.query} in ${params.location}` : params.query;
  const q = new URLSearchParams({
    query,
    page: String(params.page ?? 1),
    num_pages: '1',
    country: (params.country ?? 'us').toLowerCase(),
    date_posted: datePosted(params.postedWithinDays),
  });
  if (params.remote) q.set('work_from_home', 'true');
  const req = requirements(params.seniority);
  if (req) q.set('job_requirements', req);
  const data = await getJson<{ status?: string; data?: unknown }>(
    `https://${host}/search?${q}`,
    opts,
    { headers: { 'X-RapidAPI-Key': params.apiKey, 'X-RapidAPI-Host': host } },
    'JSearch',
  );
  if (!Array.isArray(data.data)) throw new UpstreamError('JSearch returned an unexpected answer');

  const items: SearchResultItem[] = [];
  for (const j of asArray<JSearchJob>(data.data)) {
    const { url, publisher } = bestLink(j);
    const { source, label } = sourceFor(publisher, url);
    const location =
      str(j.job_location) ?? ([j.job_city, j.job_state].filter(Boolean).join(', ') || null);
    const yearly = !j.job_salary_period || /year/i.test(j.job_salary_period);
    const info = url ? analyzeJobUrl(url) : null;
    const parsed = jobInputSchema.safeParse({
      title: clip(str(j.job_title), 300),
      company: clip(str(j.employer_name), 200) ?? 'Unknown company',
      url: info ? clip(url, 2000) : null,
      source,
      externalId: info?.externalId ?? clip(str(j.job_id), 200),
      location: clip(location, 200),
      remoteType: j.job_is_remote ? 'remote' : 'unknown',
      employmentType: clip(
        str(j.job_employment_type)
          ?.toLowerCase()
          .replace('fulltime', 'full-time')
          .replace('parttime', 'part-time') ?? null,
        60,
      ),
      salaryMin: yearly && num(j.job_min_salary) ? Math.round(num(j.job_min_salary) ?? 0) : null,
      salaryMax: yearly && num(j.job_max_salary) ? Math.round(num(j.job_max_salary) ?? 0) : null,
      salaryCurrency: yearly
        ? (str(j.job_salary_currency) ?? (num(j.job_min_salary) ? 'USD' : null))
        : null,
      description: clip(str(j.job_description), 100_000),
      postedAt: str(j.job_posted_at_datetime_utc),
    });
    if (parsed.success) items.push({ job: parsed.data, sourceLabel: label });
  }
  return { items, total: items.length };
}
