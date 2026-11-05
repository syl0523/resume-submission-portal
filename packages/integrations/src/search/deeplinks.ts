import type { DeepLinkGroup, SearchProfileParsed, SeniorityLevel } from '@jsp/core';

/**
 * Pre-filled search URLs on LinkedIn Jobs, Indeed and Google Jobs for each title x location in the
 * profile (US-wide when no location). Plain links the user opens; no API, no scraping.
 */

const LINKEDIN_LEVEL: Record<SeniorityLevel, string> = {
  internship: '1',
  entry: '2',
  associate: '3',
  mid_senior: '4',
  director: '5',
  executive: '6',
};

const GOOGLE_DATE: Record<number, string> = {
  1: 'today',
  3: '3days',
  7: 'week',
  14: 'month',
  30: 'month',
};

/** Indeed's "Remote" filter value. */
const INDEED_REMOTE = '032b3046-06a3-4876-8dfd-474eb5e7ed11';

const MAX_LINKS = 12;

export function buildDeepLinks(
  profile: Pick<
    SearchProfileParsed,
    'titles' | 'locations' | 'workMode' | 'seniority' | 'postedWithinDays'
  >,
): DeepLinkGroup[] {
  const remote = profile.workMode === 'remote' || profile.locations.some((l) => /remote/i.test(l));
  const places = profile.locations.filter((l) => !/remote/i.test(l));
  const targets: { title: string; place: string | null; remote: boolean }[] = [];
  for (const title of profile.titles) {
    for (const place of places) targets.push({ title, place, remote: false });
    if (remote || places.length === 0) targets.push({ title, place: null, remote });
  }
  const picked = targets.slice(0, MAX_LINKS);
  const days = profile.postedWithinDays;
  const label = (t: (typeof picked)[number]) =>
    `${t.title} · ${t.place ?? (t.remote ? 'Remote (US)' : 'United States')}`;

  const linkedin = picked.map((t) => {
    const u = new URL('https://www.linkedin.com/jobs/search/');
    u.searchParams.set('keywords', t.title);
    u.searchParams.set('location', t.place ?? 'United States');
    u.searchParams.set('f_TPR', `r${days * 86_400}`);
    if (t.remote) u.searchParams.set('f_WT', '2');
    else if (profile.workMode === 'hybrid') u.searchParams.set('f_WT', '3');
    else if (profile.workMode === 'onsite') u.searchParams.set('f_WT', '1');
    if (profile.seniority) u.searchParams.set('f_E', LINKEDIN_LEVEL[profile.seniority]);
    return { label: label(t), url: u.toString() };
  });

  const indeed = picked.map((t) => {
    const u = new URL('https://www.indeed.com/jobs');
    u.searchParams.set('q', t.title);
    u.searchParams.set('l', t.place ?? 'United States');
    u.searchParams.set('fromage', String(Math.min(days, 14)));
    if (t.remote) u.searchParams.set('remotejob', INDEED_REMOTE);
    return { label: label(t), url: u.toString() };
  });

  const google = picked.map((t) => {
    const u = new URL('https://www.google.com/search');
    const where = t.place ?? (t.remote ? 'remote' : 'United States');
    u.searchParams.set('q', `${t.title} jobs ${where}`);
    u.searchParams.set('ibp', 'htl;jobs');
    u.searchParams.set('htichips', `date_posted:${GOOGLE_DATE[days] ?? 'week'}`);
    return { label: label(t), url: u.toString() };
  });

  return [
    { site: 'linkedin', label: 'LinkedIn Jobs', links: linkedin },
    { site: 'indeed', label: 'Indeed', links: indeed },
    { site: 'google', label: 'Google Jobs', links: google },
  ];
}
