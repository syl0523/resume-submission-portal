import { jobInputSchema } from '@jsp/core';
import { UpstreamError } from '../errors';
import { asArray, clip, type FetchOptions, getJson, num, str } from '../http';
import { htmlToText } from '../text';
import type { SearchResult, SearchResultItem } from './types';

export interface AdzunaSearchParams {
  appId: string;
  appKey: string;
  /** ISO 3166-1 alpha-2, lower case. Default "us". */
  country?: string;
  what: string;
  where?: string | null;
  page?: number;
  resultsPerPage?: number;
  /** Only postings newer than this many days (Adzuna `max_days_old`). */
  maxDaysOld?: number;
}

interface AdzunaJob {
  id?: string | number;
  title?: string;
  description?: string;
  created?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string | number;
  contract_time?: string;
  contract_type?: string;
}

const roundOrNull = (n: number | null) => (n === null ? null : Math.round(n));

const CURRENCY: Record<string, string> = {
  us: 'USD',
  ca: 'CAD',
  gb: 'GBP',
  au: 'AUD',
  de: 'EUR',
  fr: 'EUR',
};

/** Search jobs through Adzuna's official API (https://developer.adzuna.com), US index by default. */
export async function searchAdzuna(
  params: AdzunaSearchParams,
  opts: FetchOptions = {},
): Promise<SearchResult> {
  const country = (params.country ?? 'us').toLowerCase();
  const q = new URLSearchParams({
    app_id: params.appId,
    app_key: params.appKey,
    what: params.what,
    results_per_page: String(params.resultsPerPage ?? 20),
    'content-type': 'application/json',
  });
  if (params.where) q.set('where', params.where);
  if (params.maxDaysOld) q.set('max_days_old', String(params.maxDaysOld));
  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/${params.page ?? 1}?${q}`;
  const data = await getJson<{ count?: number; results?: unknown }>(url, opts, {}, 'Adzuna');
  if (!Array.isArray(data.results)) throw new UpstreamError('Adzuna returned an unexpected answer');

  const items: SearchResultItem[] = [];
  for (const r of asArray<AdzunaJob>(data.results)) {
    const title = str(r.title) ? htmlToText(r.title ?? '') : null;
    const location = str(r.location?.display_name);
    const predicted = String(r.salary_is_predicted ?? '0') === '1';
    const parsed = jobInputSchema.safeParse({
      title: clip(title, 300),
      company: clip(str(r.company?.display_name), 200) ?? 'Unknown company',
      url: str(r.redirect_url),
      source: 'adzuna',
      externalId: r.id != null ? String(r.id) : null,
      location: clip(location, 200),
      remoteType: /remote/i.test(`${title} ${location}`) ? 'remote' : 'unknown',
      employmentType: clip(
        [r.contract_time, r.contract_type].filter(Boolean).join(', ').replace(/_/g, '-') || null,
        60,
      ),
      salaryMin: predicted ? null : roundOrNull(num(r.salary_min)),
      salaryMax: predicted ? null : roundOrNull(num(r.salary_max)),
      salaryCurrency: predicted ? null : (CURRENCY[country] ?? null),
      description: r.description ? clip(htmlToText(r.description), 100_000) : null,
      postedAt: str(r.created),
    });
    if (parsed.success) items.push({ job: parsed.data, sourceLabel: 'Adzuna' });
  }
  return { items, total: num(data.count) ?? items.length };
}
