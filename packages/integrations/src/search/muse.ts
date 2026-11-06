import { jobInputSchema, type SeniorityLevel } from '@jsp/core';
import { UpstreamError } from '../errors';
import { expandTitle, mentions, titleSimilarity } from '../fit';
import { asArray, clip, type FetchOptions, getJson, num, str } from '../http';
import { findMetro, isNationwide, isRemotePlace, matchPlace } from '../locations';
import { htmlToText } from '../text';
import type { SearchResult, SearchResultItem } from './types';

/**
 * The Muse public jobs API (KAN-66), no key needed: https://www.themuse.com/developers/api/v2
 *
 *   GET https://www.themuse.com/api/public/jobs?page=0&category=…&level=…&location=…
 *
 * `page` is required and 0-based; a full page has 20 results; `page_count` and `total` come back
 * with `results`. Without an api_key the limit is 500 requests per hour (403 when exceeded), so a
 * call is bounded: at most MAX_CATEGORIES categories x `maxPages` pages. The API has no keyword
 * search, so titles pick categories and postings are kept when their title resembles a target.
 */

const MUSE_URL = 'https://www.themuse.com/api/public/jobs';
const REMOTE_LOCATION = 'Flexible / Remote';
const PAGE_SIZE = 20;
const MAX_CATEGORIES = 3;
const MAX_PAGES = 5;
const DEFAULT_MIN_TITLE_MATCH = 0.55;

/** Current Muse categories (the API also lists legacy names such as "HR" or "IT" that match nothing). */
export const MUSE_CATEGORIES = [
  'Accounting and Finance',
  'Account Management/Customer Success',
  'Administration and Office',
  'Advertising and Marketing',
  'Business Operations',
  'Computer and IT',
  'Customer Service',
  'Data and Analytics',
  'Design and UX',
  'Human Resources and Recruitment',
  'Legal Services',
  'Management',
  'Manufacturing and Warehouse',
  'Product Management',
  'Project Management',
  'Sales',
  'Science and Engineering',
  'Software Engineering',
  'Transportation and Logistics',
] as const;
export type MuseCategory = (typeof MUSE_CATEGORIES)[number];

/** First rule that matches a title (abbreviations expanded) picks its categories. */
const CATEGORY_RULES: [RegExp, MuseCategory[]][] = [
  [
    /\b(site reliability|reliability engineer(ing)?|production (support|engineer(ing)?|operations)|application support|incident|major incident|devops|platform engineer|infrastructure|observability)\b/,
    ['Software Engineering', 'Computer and IT'],
  ],
  [
    /\b(software|developer|programmer|engineering manager|backend|frontend|full stack|machine learning|data engineer)\b/,
    ['Software Engineering'],
  ],
  [
    /\b(it|information technology|systems? (administrator|engineer)|network|security|cyber|help ?desk|service desk|technical support|cloud|database administrator)\b/,
    ['Computer and IT'],
  ],
  [/\b(data|analytics|business intelligence|data scientist)\b/, ['Data and Analytics']],
  [
    /\b(human resources|people|talent|recruit(er|ing)?|benefits|compensation|payroll|hris|employee relations)\b/,
    ['Human Resources and Recruitment'],
  ],
  [/\bproduct (manager|owner|management)\b/, ['Product Management']],
  [/\b(project|program) manag/, ['Project Management']],
  [
    /\b(warehouse|logistics|supply chain|transportation|fulfillment|distribution|fleet)\b/,
    ['Transportation and Logistics', 'Manufacturing and Warehouse'],
  ],
  [/\b(operations|business operations|chief of staff)\b/, ['Business Operations']],
  [
    /\b(accountant|accounting|finance|financial analyst|controller|audit(or)?|tax)\b/,
    ['Accounting and Finance'],
  ],
  [/\b(sales|account executive|business development)\b/, ['Sales']],
  [/\b(marketing|seo|content|brand)\b/, ['Advertising and Marketing']],
  [
    /\b(customer (service|support|success)|support specialist)\b/,
    ['Customer Service', 'Account Management/Customer Success'],
  ],
  [/\b(designer|ux|ui|user experience)\b/, ['Design and UX']],
  [/\b(legal|counsel|attorney|paralegal|compliance)\b/, ['Legal Services']],
  [
    /\b(administrative assistant|executive assistant|office manager|receptionist)\b/,
    ['Administration and Office'],
  ],
  [/\b(manager|director|head of|vice president)\b/, ['Management']],
];

/** Muse categories for target titles, most important first, at most MAX_CATEGORIES. */
export function museCategoriesFor(titles: readonly string[]): MuseCategory[] {
  const out: MuseCategory[] = [];
  for (const title of titles) {
    const t = expandTitle(title);
    const rule = CATEGORY_RULES.find(([re]) => re.test(t));
    for (const c of rule?.[1] ?? []) if (!out.includes(c)) out.push(c);
  }
  return out.slice(0, MAX_CATEGORIES);
}

const LEVELS: Record<SeniorityLevel, string[]> = {
  internship: ['Internship'],
  entry: ['Entry Level'],
  associate: ['Entry Level', 'Mid Level'],
  mid_senior: ['Senior Level', 'Mid Level'],
  director: ['management', 'Senior Level'],
  executive: ['management'],
};

/** Muse `location` values for search places: a metro becomes its cities ("Oakland, CA"…). */
export function museLocationsFor(places: readonly (string | null)[], remote: boolean): string[] {
  if (places.some((p) => p === null || isNationwide(p))) return [];
  const out: string[] = [];
  for (const place of places) {
    if (place === null || isRemotePlace(place)) continue;
    const metro = findMetro(place);
    const names = metro
      ? metro.cities.map((c) => `${c.name}, ${metro.state.toUpperCase()}`)
      : [place.trim()];
    for (const n of names) if (n && !out.includes(n)) out.push(n);
  }
  if (remote) out.push(REMOTE_LOCATION);
  return out;
}

export interface MuseSearchParams {
  /** Target titles. Postings are kept when their title resembles one (no keyword search upstream). */
  titles: string[];
  /** Search places; a metro expands to its cities. null or "United States" = anywhere. */
  places?: (string | null)[];
  /** Include "Flexible / Remote" postings. */
  remote?: boolean;
  seniority?: SeniorityLevel | null;
  /** Override the categories picked from the titles. */
  categories?: string[];
  /** First page to fetch (0-based, as the API counts). */
  page?: number;
  /** Pages per category (default 2, at most 5). */
  maxPages?: number;
  /** Also keep postings whose description mentions a target (keyword searches). */
  matchDescription?: boolean;
  /** 0..1 title similarity needed to keep a posting (default 0.55). */
  minTitleMatch?: number;
}

interface MuseJob {
  id?: number | string;
  name?: string;
  contents?: string;
  publication_date?: string;
  locations?: { name?: string }[];
  levels?: { name?: string }[];
  categories?: { name?: string }[];
  refs?: { landing_page?: string };
  company?: { name?: string };
}

interface MusePage {
  page?: number;
  page_count?: number;
  results?: unknown;
}

/** Locations that match the search first, so the posting's location shows (and scores) them. */
function orderLocations(names: string[], places: readonly (string | null)[]): string[] {
  const wanted = places.filter((p): p is string => p !== null && !isRemotePlace(p));
  const rank = (n: string) =>
    wanted.some((p) => matchPlace(p, n) === 'match') ? 0 : n === REMOTE_LOCATION ? 1 : 2;
  return [...names].sort((a, b) => rank(a) - rank(b));
}

function toItem(j: MuseJob, places: readonly (string | null)[]): SearchResultItem | null {
  const names = asArray<{ name?: string }>(j.locations)
    .map((l) => str(l.name))
    .filter((n): n is string => n !== null);
  const remote = names.some((n) => /remote/i.test(n));
  const parsed = jobInputSchema.safeParse({
    title: clip(str(j.name), 300),
    company: clip(str(j.company?.name), 200) ?? 'Unknown company',
    url: str(j.refs?.landing_page),
    source: 'other',
    externalId: j.id != null ? String(j.id) : null,
    location: clip(orderLocations(names, places).join('; ') || null, 200),
    remoteType: remote ? 'remote' : 'unknown',
    description: j.contents ? clip(htmlToText(j.contents), 100_000) : null,
    postedAt: str(j.publication_date),
  });
  return parsed.success ? { job: parsed.data, sourceLabel: 'The Muse' } : null;
}

/**
 * Search The Muse for postings like the target titles in the given places. One request per
 * category and page (categories in parallel, pages in order until the last page), so a call
 * makes at most 3 x `maxPages` requests.
 */
export async function searchMuse(
  params: MuseSearchParams,
  opts: FetchOptions = {},
): Promise<SearchResult> {
  const titles = params.titles.map((t) => t.trim()).filter(Boolean);
  if (titles.length === 0) return { items: [], total: 0 };
  const places = params.places ?? [];
  const categories = (params.categories ?? museCategoriesFor(titles)).slice(0, MAX_CATEGORIES);
  const levels = params.seniority ? LEVELS[params.seniority] : [];
  const locations = museLocationsFor(places, params.remote ?? false);
  const first = Math.max(0, params.page ?? 0);
  const pages = Math.min(MAX_PAGES, Math.max(1, params.maxPages ?? 2));

  const fetchCategory = async (category: string | null): Promise<MuseJob[]> => {
    const jobs: MuseJob[] = [];
    for (let page = first; page < first + pages; page++) {
      const q = new URLSearchParams({ page: String(page) });
      if (category) q.append('category', category);
      for (const l of levels) q.append('level', l);
      for (const l of locations) q.append('location', l);
      let data: MusePage;
      try {
        data = await getJson<MusePage>(`${MUSE_URL}?${q}`, opts, {}, 'The Muse');
      } catch (err) {
        if (err instanceof UpstreamError && err.status === 403) {
          throw new UpstreamError('The Muse answered 403 (hourly rate limit reached)', 403);
        }
        throw err;
      }
      if (!Array.isArray(data.results)) {
        throw new UpstreamError('The Muse returned an unexpected answer');
      }
      jobs.push(...asArray<MuseJob>(data.results));
      const count = num(data.page_count);
      if (data.results.length < PAGE_SIZE || (count !== null && page + 1 >= count)) break;
    }
    return jobs;
  };

  const settled = await Promise.allSettled(
    (categories.length > 0 ? categories : [null]).map(fetchCategory),
  );
  const ok = settled.filter(
    (s): s is PromiseFulfilledResult<MuseJob[]> => s.status === 'fulfilled',
  );
  if (ok.length === 0) {
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    throw failed?.reason instanceof Error
      ? failed.reason
      : new UpstreamError('The Muse is unreachable');
  }

  const threshold = params.minTitleMatch ?? DEFAULT_MIN_TITLE_MATCH;
  const seen = new Set<string>();
  const items: SearchResultItem[] = [];
  for (const j of ok.flatMap((s) => s.value)) {
    const key = String(j.id ?? `${j.company?.name}|${j.name}`);
    if (seen.has(key)) continue;
    seen.add(key);
    const name = str(j.name);
    if (!name) continue;
    const relevant =
      titles.some((t) => titleSimilarity(t, name) >= threshold) ||
      (params.matchDescription === true &&
        titles.some((t) => mentions(`${name}\n${htmlToText(j.contents ?? '')}`, t)));
    if (!relevant) continue;
    const item = toItem(j, places);
    if (item) items.push(item);
  }
  return { items, total: items.length };
}
