import type { JobInputParsed, SeniorityLevel } from '@jsp/core';

/** One title x location query, built from a search profile by `planQueries`. */
export interface SearchQuery {
  title: string;
  /** "Austin, TX", a ZIP code, or null for anywhere in the US. */
  location: string | null;
  remote: boolean;
  postedWithinDays: number;
  seniority?: SeniorityLevel | null;
  page?: number;
}

export interface SearchResultItem {
  job: JobInputParsed;
  /** Badge text: "LinkedIn", "Indeed", "Company site", "Adzuna", "USAJOBS"… */
  sourceLabel: string;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
}
