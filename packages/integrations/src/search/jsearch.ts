import type { SeniorityLevel } from '@jsp/core';
import type { FetchOptions } from '../boards';
import { NotImplementedError } from '../errors';
import type { SearchResult } from './types';

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

/**
 * Search Google for Jobs listings (LinkedIn, Indeed, Glassdoor, ZipRecruiter, company career sites)
 * through the JSearch API on RapidAPI. Third-party data: we never scrape LinkedIn or Indeed ourselves.
 * The job `source` is set from the publisher (LinkedIn -> linkedin, Indeed -> indeed, else from the
 * apply URL via analyzeJobUrl).
 * TODO(integrations agent, KAN-24 / Job Match): implement.
 */
export async function searchJSearch(
  params: JSearchParams,
  opts: FetchOptions = {},
): Promise<SearchResult> {
  void params;
  void opts;
  throw new NotImplementedError('searchJSearch');
}
