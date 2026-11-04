import type { SearchProfileParsed } from '@jsp/core';
import type { SearchQuery } from './types';

/**
 * Turn a search profile into at most `maxQueries` title x location queries, most important first
 * (titles in profile order, interleaved across places; "Remote" in locations or workMode=remote
 * adds a US-wide remote query; no places at all means US-wide).
 */
export function planQueries(profile: SearchProfileParsed, maxQueries: number): SearchQuery[] {
  const wantsRemote =
    profile.workMode === 'remote' || profile.locations.some((l) => /remote/i.test(l));
  const places: { location: string | null; remote: boolean }[] = profile.locations
    .filter((l) => !/remote/i.test(l))
    .map((location) => ({ location, remote: false }));
  if (wantsRemote) places.push({ location: null, remote: true });
  if (places.length === 0) places.push({ location: null, remote: false });

  const queries: SearchQuery[] = [];
  // Breadth first: every title in the first place before the second place of the first title.
  const rounds = Math.max(profile.titles.length, places.length);
  outer: for (let round = 0; round < rounds; round++) {
    for (let t = 0; t < profile.titles.length; t++) {
      for (let p = 0; p < places.length; p++) {
        if (Math.max(t, p) !== round) continue;
        const title = profile.titles[t];
        const place = places[p];
        if (!title || !place) continue;
        queries.push({
          title,
          location: place.location,
          remote: place.remote,
          postedWithinDays: profile.postedWithinDays,
          seniority: profile.seniority ?? null,
        });
        if (queries.length >= maxQueries) break outer;
      }
    }
  }
  return queries;
}
