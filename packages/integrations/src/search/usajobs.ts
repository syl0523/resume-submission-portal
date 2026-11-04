import type { FetchOptions } from '../boards';
import { NotImplementedError } from '../errors';
import type { SearchResult } from './types';

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

/**
 * Search US federal jobs through the official USAJOBS Search API (https://developer.usajobs.gov).
 * TODO(integrations agent, KAN-24): implement.
 */
export async function searchUsaJobs(
  params: UsaJobsSearchParams,
  opts: FetchOptions = {},
): Promise<SearchResult> {
  void params;
  void opts;
  throw new NotImplementedError('searchUsaJobs');
}
