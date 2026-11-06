import type { FitFlag, JobFit, JobInputParsed, SearchProfileParsed } from '@jsp/core';
import { isNationwide, isRemotePlace, matchPlace } from './locations';
import { normalizeTitle, similarity } from './text';

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
  [/\bsre\b/g, 'site reliability engineer'],
  [/\bprod\b/g, 'production'],
  [/\bapp\b/g, 'application'],
];

const LEVEL_WORDS =
  /\b(senior|junior|lead|principal|staff|chief|head|entry level|entry|intern|internship|associate|i|ii|iii|iv|1|2|3)\b/g;

/** Normalised title with abbreviations spelled out ("Sr. SRE" → "senior site reliability engineer"). */
export function expandTitle(title: string): string {
  let t = normalizeTitle(title);
  for (const [re, full] of TITLE_SYNONYMS) t = t.replace(re, full);
  return t;
}

export function titleKey(title: string): string {
  return expandTitle(title).replace(LEVEL_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Families of titles that employers use for the same work. Two titles in one family are close
 * variants (similarity at least FAMILY_SIMILARITY) even when they share no words.
 */
export const ROLE_FAMILIES: { id: string; pattern: RegExp }[] = [
  {
    // Reliability and production operations: SRE, production / application support, incidents.
    id: 'reliability',
    pattern:
      /\b(site reliability|reliability engineer(ing)?|production (support|engineer(ing)?|operations)|application support|incident (manager|management|commander|coordinator|lead|response manager)|major incident)\b/,
  },
];

const FAMILY_SIMILARITY = 0.8;

/** The role family a title belongs to (see ROLE_FAMILIES), or null. */
export function roleFamily(title: string): string | null {
  const t = expandTitle(title);
  return ROLE_FAMILIES.find((f) => f.pattern.test(t))?.id ?? null;
}

/**
 * 0..1: bigram similarity, or word overlap when the posting adds words ("HR Generalist II,
 * Benefits"); at least 0.8 for close variants in one role family ("SRE" ~ "Production Support").
 */
export function titleSimilarity(a: string, b: string): number {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return 0;
  const dice = similarity(x, y);
  const wx = new Set(x.split(' '));
  const wy = new Set(y.split(' '));
  const shared = [...wy].filter((w) => wx.has(w)).length;
  const containment = wy.size > 0 ? shared / wy.size : 0;
  const base = Math.max(dice, containment * 0.95);
  const family = roleFamily(a);
  return family && family === roleFamily(b) ? Math.max(base, FAMILY_SIMILARITY) : base;
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
  const wantsRemote = profile.workMode === 'remote' || profile.locations.some(isRemotePlace);
  const acceptsRemote = wantsRemote || profile.workMode === 'any';
  const places = profile.locations.filter((l) => !isRemotePlace(l) && !isNationwide(l));
  // "United States" in the list: anywhere in the US is acceptable, the named places preferred.
  const usWide = job.remoteType === 'unknown' ? 0.6 : 0.8;
  const anywhere = places.length === 0 || profile.locations.some(isNationwide);
  let placeFit = 0.5;
  if (job.remoteType === 'remote' && acceptsRemote) {
    placeFit = 1;
    reasons.push(wantsRemote ? 'Remote, as preferred' : 'Remote');
  } else if (profile.workMode === 'remote' && job.remoteType === 'onsite') {
    placeFit = 0;
  } else if (places.length === 0) {
    placeFit = usWide;
  } else if (job.location) {
    // Whole places, not single words (locations.ts): "San Francisco Bay Area" covers "San Jose, CA"
    // but not "San Diego, CA"; "New York" does not match "New Orleans".
    const fits = places.map((p) => matchPlace(p, job.location ?? ''));
    if (fits.includes('match')) {
      placeFit = 1;
      reasons.push(`In ${job.location}`);
    } else if (fits.includes('same_state') || fits.every((f) => f === 'unknown')) {
      placeFit = 0.5;
    } else {
      placeFit = 0.2;
    }
    if (anywhere && placeFit < 1) placeFit = Math.max(placeFit, usWide);
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
