import type { DeepLinkGroup, SearchProfileParsed } from '@jsp/core';

/**
 * Pre-filled search URLs on LinkedIn Jobs, Indeed and Google Jobs for each title x location in the
 * profile (US-wide when no location). Plain links the user opens; no API, no scraping.
 * TODO(integrations agent, Job Match): implement.
 */
export function buildDeepLinks(
  profile: Pick<
    SearchProfileParsed,
    'titles' | 'locations' | 'workMode' | 'seniority' | 'postedWithinDays'
  >,
): DeepLinkGroup[] {
  void profile;
  return [];
}
