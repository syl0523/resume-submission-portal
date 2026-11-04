import type { SearchProfileParsed } from '@jsp/core';
import type { SearchQuery } from './types';

/**
 * Turn a search profile into at most `maxQueries` title x location queries, most important first
 * (titles in profile order; "Remote" in locations or workMode=remote becomes remote=true).
 * TODO(integrations agent, Job Match): implement.
 */
export function planQueries(profile: SearchProfileParsed, maxQueries: number): SearchQuery[] {
  void profile;
  void maxQueries;
  return [];
}
