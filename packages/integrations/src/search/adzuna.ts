import type { FetchOptions } from '../boards';
import { NotImplementedError } from '../errors';
import type { SearchResult } from './types';

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

/**
 * Search jobs through Adzuna's official API (https://developer.adzuna.com), US index by default.
 * TODO(integrations agent, KAN-24): implement.
 */
export async function searchAdzuna(
  params: AdzunaSearchParams,
  opts: FetchOptions = {},
): Promise<SearchResult> {
  void params;
  void opts;
  throw new NotImplementedError('searchAdzuna');
}
