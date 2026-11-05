import type { FitFlag, JobFit, JobInputParsed, SearchProfileParsed } from '@jsp/core';
import { normalizeForCompare, normalizeTitle, similarity } from './text';

export type FitJob = Pick<
  JobInputParsed,
  | 'title'
  | 'company'
  | 'description'
  | 'location'
  | 'remoteType'
  | 'salaryMin'
  | 'salaryMax'
  | 'postedAt'
> & { employmentType?: string | null };

/** Common abbreviations in job titles, expanded before comparing. */
const TITLE_SYNONYMS: [RegExp, string][] = [
  [/\bhr\b/g, 'human resources'],
  [/\bhrbp\b/g, 'human resources business partner'],
  [/\bta\b/g, 'talent acquisition'],
  [/\bsr\b/g, 'senior'],
  [/\bjr\b/g, 'junior'],
  [/\bmgr\b/g, 'manager'],
  [/\bops\b/g, 'operations'],
  [/\bswe\b/g, 'software engineer'],
  [/\bdev\b/g, 'developer'],
  [/\beng\b/g, 'engineer'],
  [/\bassoc\b/g, 'associate'],
  [/\bcoord\b/g, 'coordinator'],
  [/\badmin\b/g, 'administrator'],
  [/\bvp\b/g, 'vice president'],
  [/\bpeople ops\b/g, 'people operations'],
];

const LEVEL_WORDS =
  /\b(senior|junior|lead|principal|staff|chief|head|entry level|entry|intern|internship|associate|i|ii|iii|iv|1|2|3)\b/g;

export function titleKey(title: string): string {
  let t = normalizeTitle(title);
  for (const [re, full] of TITLE_SYNONYMS) t = t.replace(re, full);
  return t.replace(LEVEL_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

/** 0..1: bigram similarity, or word overlap when the posting adds words ("HR Generalist II, Benefits"). */
export function titleSimilarity(a: string, b: string): number {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return 0;
  const dice = similarity(x, y);
  const wx = new Set(x.split(' '));
  const wy = new Set(y.split(' '));
  const shared = [...wy].filter((w) => wx.has(w)).length;
  const containment = wy.size > 0 ? shared / wy.size : 0;
  return Math.max(dice, containment * 0.95);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive phrase match that also works for "C++", ".NET" or "SHRM-CP". */
export function mentions(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(p.toLowerCase())}($|[^a-z0-9])`, 'i');
  return re.test(text.toLowerCase());
}

const FLAG_RULES: [FitFlag, RegExp][] = [
  [
    'no_sponsorship',
    /\b(no|not|unable to|cannot|can't|will not|won't|does not|do not)\s+(be\s+)?(able to\s+)?(provide|offer|support|consider)?\s*(visa\s+|h-?1b\s+)?sponsor(ship)?\b|\bsponsorship (is )?not (available|offered|provided)\b|\bwithout (the need for )?(current or future |future |any )?(visa |employment )?sponsorship\b/i,
  ],
  [
    'citizenship_required',
    /\b(u\.?s\.?|united states) citizen(ship)? (is )?(required|only)\b|\bmust be an? (u\.?s\.?|united states) citizen\b|\bus citizens only\b|\bcitizenship is required\b/i,
  ],
  [
    'clearance_required',
    /\b(active |current )?(security|secret|top secret|ts\/sci|public trust) clearance\b|\bclearance (is )?required\b|\bts\/sci\b/i,
  ],
  ['relocation_required', /\brelocation (is )?required\b|\bmust (be willing to )?relocate\b/i],
];

const CONTRACT = /\b(contract|contractor|c2c|corp[- ]to[- ]corp|1099|temporary|temp)\b/i;

const SENIOR_TITLE =
  /\b(senior|sr|lead|principal|staff|director|head of|vp|vice president|chief)\b/i;
const JUNIOR_TITLE = /\b(intern|internship|junior|jr|entry[- ]level|graduate|trainee)\b/i;

/**
 * Metro areas a search can name as one place, with the cities inside them. Only names that are
 * not also well-known places elsewhere (no Dublin, Richmond, Cambridge or Newark).
 */
const METROS: [RegExp, string[]][] = [
  [
    /\b(sf )?bay area\b|\bsilicon valley\b/,
    [
      'san francisco',
      'oakland',
      'berkeley',
      'emeryville',
      'alameda',
      'san jose',
      'santa clara',
      'sunnyvale',
      'mountain view',
      'palo alto',
      'menlo park',
      'redwood city',
      'redwood shores',
      'san mateo',
      'foster city',
      'burlingame',
      'san bruno',
      'millbrae',
      'san carlos',
      'brisbane',
      'daly city',
      'cupertino',
      'milpitas',
      'fremont',
      'hayward',
      'pleasanton',
      'livermore',
      'san ramon',
      'walnut creek',
      'los gatos',
      'campbell',
      'los altos',
      'san rafael',
      'novato',
      'bay area',
      'silicon valley',
    ],
  ],
  [
    /\bnew york city\b|\bnyc\b|\bnew york metro/,
    [
      'new york',
      'nyc',
      'manhattan',
      'brooklyn',
      'queens',
      'bronx',
      'long island city',
      'jersey city',
      'hoboken',
    ],
  ],
  [
    /\b(greater )?seattle area\b|\bpuget sound\b/,
    ['seattle', 'bellevue', 'redmond', 'kirkland', 'bothell'],
  ],
];

/**
 * What a place in a search names: a metro's cities, else the city before the first comma, plus the
 * two-letter state after it ("Austin, TX" → austin + tx). A lone state code names the state.
 */
function placeMatcher(place: string): { names: string[]; state: string | null } {
  const norm = normalizeForCompare(place);
  for (const [re, cities] of METROS) if (re.test(norm)) return { names: cities, state: null };
  const [cityPart = '', ...rest] = place.split(',');
  const city = normalizeForCompare(cityPart);
  const stateToken = rest.map((r) => r.trim()).find((r) => /^[a-z]{2}$/i.test(r));
  const state = stateToken ? stateToken.toLowerCase() : null;
  if (rest.length === 0 && /^[a-z]{2}$/.test(city)) return { names: [], state: city };
  if (!city || /^\d{5}$/.test(city)) return { names: [], state };
  return { names: [city], state };
}

/**
 * Deterministic resume-to-job fit, 0-100 (KAN-41): title similarity to the target titles (40),
 * skill coverage in the posting text (30), work mode and location (15), freshness (10) and the
 * salary floor (5). Work-authorization language is flagged, and rules the posting out when the
 * search needs sponsorship. Runs in the Worker and in the extension popup, so no I/O.
 */
export function scoreJobFit(
  profile: SearchProfileParsed,
  job: FitJob,
  now: Date = new Date(),
): JobFit {
  const text = `${job.title}\n${job.description ?? ''}`;
  const reasons: string[] = [];
  const flags: FitFlag[] = [];

  // Title (40)
  let titleMatch = 0;
  let closest = '';
  for (const target of profile.titles) {
    const s = titleSimilarity(target, job.title);
    if (s > titleMatch) {
      titleMatch = s;
      closest = target;
    }
  }
  titleMatch = Math.round(titleMatch * 100) / 100;
  if (titleMatch >= 0.8) reasons.push(`Title matches “${closest}”`);
  else if (titleMatch >= 0.55) reasons.push(`Close to “${closest}”`);
  let score = 40 * titleMatch;

  // Seniority sanity check.
  if (profile.seniority === 'internship' || profile.seniority === 'entry') {
    if (SENIOR_TITLE.test(job.title)) score -= 10;
  } else if (profile.seniority && JUNIOR_TITLE.test(job.title)) {
    score -= 10;
  }

  // Skills (30)
  const matchedSkills = profile.skills.filter((s) => mentions(text, s));
  const missingSkills = profile.skills.filter((s) => !matchedSkills.includes(s)).slice(0, 8);
  if (profile.skills.length === 0) {
    score += 30 * titleMatch;
  } else if (!job.description) {
    // No description to check (some boards list titles only): neutral half credit.
    score += 15 * Math.min(1, matchedSkills.length / Math.min(profile.skills.length, 8) + 0.5);
  } else {
    const coverage = Math.min(1, matchedSkills.length / Math.min(profile.skills.length, 8));
    score += 30 * coverage;
    if (matchedSkills.length > 0) {
      reasons.push(`Mentions ${matchedSkills.length} of your ${profile.skills.length} skills`);
    }
  }

  // Work mode and location (15)
  const wantsRemote =
    profile.workMode === 'remote' || profile.locations.some((l) => /remote/i.test(l));
  const acceptsRemote = wantsRemote || profile.workMode === 'any';
  const places = profile.locations.filter((l) => !/remote/i.test(l));
  let placeFit = 0.5;
  if (job.remoteType === 'remote' && acceptsRemote) {
    placeFit = 1;
    reasons.push(wantsRemote ? 'Remote, as preferred' : 'Remote');
  } else if (profile.workMode === 'remote' && job.remoteType === 'onsite') {
    placeFit = 0;
  } else if (places.length === 0) {
    placeFit = job.remoteType === 'unknown' ? 0.6 : 0.8;
  } else if (job.location) {
    // Whole places, not single words: "New York" must not match "New Orleans", and "San
    // Francisco Bay Area" must match "San Jose, CA" but not "San Diego, CA".
    const where = normalizeForCompare(job.location);
    const has = (name: string) => new RegExp(`\\b${escapeRe(name)}\\b`).test(where);
    const matchers = places.map(placeMatcher);
    if (matchers.some((m) => m.names.some(has))) {
      placeFit = 1;
      reasons.push(`In ${job.location}`);
    } else if (matchers.some((m) => m.state !== null && has(m.state))) {
      placeFit = 0.5;
    } else if (matchers.every((m) => m.names.length === 0 && m.state === null)) {
      placeFit = 0.5;
    } else {
      placeFit = 0.2;
    }
  }
  if (profile.workMode === 'hybrid' && job.remoteType === 'hybrid')
    placeFit = Math.max(placeFit, 0.9);
  if (profile.workMode === 'onsite' && job.remoteType === 'remote')
    placeFit = Math.min(placeFit, 0.5);
  score += 15 * placeFit;

  // Freshness (10)
  if (job.postedAt && !Number.isNaN(Date.parse(job.postedAt))) {
    const days = Math.max(0, (now.getTime() - Date.parse(job.postedAt)) / 86_400_000);
    const window = profile.postedWithinDays;
    const fresh = days <= window ? 1 : Math.max(0, 1 - (days - window) / 30);
    score += 10 * fresh;
    if (days < 1) reasons.push('Posted today');
    else if (days <= 7)
      reasons.push(`Posted ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} ago`);
    if (days > 30) flags.push('stale_posting');
  } else {
    score += 5;
  }

  // Salary floor (5)
  const top = job.salaryMax ?? job.salaryMin;
  if (profile.minSalary && top) {
    if (top >= profile.minSalary) {
      score += 5;
      reasons.push('Pay meets your minimum');
    } else {
      flags.push('salary_below_min');
    }
  } else {
    score += 2.5;
  }

  for (const [flag, re] of FLAG_RULES) if (re.test(text)) flags.push(flag);
  if (CONTRACT.test(job.title) || (job.employmentType && CONTRACT.test(job.employmentType)))
    flags.push('contract_role');
  const excludedBy = profile.excludeKeywords.find((k) => mentions(text, k));
  if (excludedBy) flags.push('excluded_keyword');
  for (const k of profile.keywords) if (mentions(text, k)) score += 1;

  const authBlock =
    profile.needsSponsorship &&
    (flags.includes('no_sponsorship') ||
      flags.includes('citizenship_required') ||
      flags.includes('clearance_required'));
  const excluded = Boolean(excludedBy) || flags.includes('salary_below_min') || authBlock;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    titleMatch,
    matchedSkills,
    missingSkills,
    reasons,
    flags,
    excluded,
  };
}
