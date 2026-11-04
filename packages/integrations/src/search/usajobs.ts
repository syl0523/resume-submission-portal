import { jobInputSchema } from '@jsp/core';
import { UpstreamError } from '../errors';
import { asArray, clip, type FetchOptions, getJson, num, str } from '../http';
import type { SearchResult, SearchResultItem } from './types';

export interface UsaJobsSearchParams {
  apiKey: string;
  /** The email address the API key was registered with (USAJOBS requires it as User-Agent). */
  userAgent: string;
  keyword: string;
  location?: string | null;
  remote?: boolean;
  page?: number;
  resultsPerPage?: number;
  /** USAJOBS `DatePosted` (days). */
  postedWithinDays?: number;
}

interface Descriptor {
  PositionID?: string;
  PositionTitle?: string;
  PositionURI?: string;
  PositionLocationDisplay?: string;
  OrganizationName?: string;
  DepartmentName?: string;
  PublicationStartDate?: string;
  PositionRemuneration?: {
    MinimumRange?: string;
    MaximumRange?: string;
    RateIntervalCode?: string;
  }[];
  PositionSchedule?: { Name?: string }[];
  UserArea?: {
    Details?: { JobSummary?: string; RemoteIndicator?: boolean; TeleworkEligible?: boolean };
  };
}

/** Search US federal jobs through the official USAJOBS Search API (https://developer.usajobs.gov). */
export async function searchUsaJobs(
  params: UsaJobsSearchParams,
  opts: FetchOptions = {},
): Promise<SearchResult> {
  const q = new URLSearchParams({
    Keyword: params.keyword,
    ResultsPerPage: String(params.resultsPerPage ?? 25),
    Page: String(params.page ?? 1),
  });
  if (params.location) q.set('LocationName', params.location);
  if (params.remote) q.set('RemoteIndicator', 'True');
  if (params.postedWithinDays) q.set('DatePosted', String(Math.min(60, params.postedWithinDays)));
  const data = await getJson<{
    SearchResult?: { SearchResultCountAll?: number; SearchResultItems?: unknown };
  }>(
    `https://data.usajobs.gov/api/search?${q}`,
    opts,
    {
      headers: {
        Host: 'data.usajobs.gov',
        'User-Agent': params.userAgent,
        'Authorization-Key': params.apiKey,
      },
    },
    'USAJOBS',
  );
  const result = data.SearchResult;
  if (!result || !Array.isArray(result.SearchResultItems)) {
    throw new UpstreamError('USAJOBS returned an unexpected answer');
  }

  const items: SearchResultItem[] = [];
  for (const item of asArray<{ MatchedObjectId?: string; MatchedObjectDescriptor?: Descriptor }>(
    result.SearchResultItems,
  )) {
    const d = item.MatchedObjectDescriptor;
    if (!d) continue;
    const pay = d.PositionRemuneration?.find((p) => p.RateIntervalCode === 'PA');
    const remote = d.UserArea?.Details?.RemoteIndicator === true;
    const parsed = jobInputSchema.safeParse({
      title: clip(str(d.PositionTitle), 300),
      company:
        clip(str(d.OrganizationName) ?? str(d.DepartmentName), 200) ?? 'US federal government',
      url: str(d.PositionURI),
      source: 'usajobs',
      externalId: clip(str(item.MatchedObjectId) ?? str(d.PositionID), 200),
      location: clip(str(d.PositionLocationDisplay), 200),
      remoteType: remote ? 'remote' : d.UserArea?.Details?.TeleworkEligible ? 'hybrid' : 'onsite',
      employmentType: clip(str(d.PositionSchedule?.[0]?.Name), 60),
      salaryMin: pay ? Math.round(num(pay.MinimumRange) ?? 0) || null : null,
      salaryMax: pay ? Math.round(num(pay.MaximumRange) ?? 0) || null : null,
      salaryCurrency: pay ? 'USD' : null,
      description: clip(str(d.UserArea?.Details?.JobSummary), 100_000),
      postedAt: str(d.PublicationStartDate),
    });
    if (parsed.success) items.push({ job: parsed.data, sourceLabel: 'USAJOBS' });
  }
  return { items, total: num(result.SearchResultCountAll) ?? items.length };
}
