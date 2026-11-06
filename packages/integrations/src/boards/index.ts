import {
  type BoardProvider,
  type JobDraft,
  type JobInputParsed,
  jobInputSchema,
  type RemoteType,
} from '@jsp/core';
import { UpstreamError } from '../errors';
import { asArray, clip, type FetchOptions, getJson, num, str } from '../http';
import { decodeEntities, htmlToText } from '../text';
import { analyzeJobUrl } from '../url';

export type { FetchOptions } from '../http';

/**
 * Official public job-board APIs (KAN-24): Greenhouse Job Board API, Lever Postings API,
 * Ashby Posting API, SmartRecruiters Posting API. No scraping, no keys needed.
 */

export interface BoardJob {
  externalId: string;
  job: JobInputParsed;
}

export interface BoardRef {
  provider: BoardProvider;
  token: string;
}

export interface BoardFetchOptions extends FetchOptions {
  /** Employer name to put on postings when the API does not say (the watched board's name). */
  companyName?: string | null;
  /**
   * Include full descriptions (default true). Greenhouse sends them only on request, at several MB
   * per large board, so a sync that stores titles and links passes false.
   */
  descriptions?: boolean;
}

const MAX_POSTINGS = 1000;

/** "acme-logistics" → "Acme Logistics" (fallback company name from a board token). */
export function prettifyToken(token: string): string {
  return token
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Recognise a company careers URL hosted on a supported ATS. */
export function parseBoardUrl(url: string): BoardRef | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';

  if (host.endsWith('greenhouse.io')) {
    const forToken = u.searchParams.get('for');
    if (first === 'embed' && forToken)
      return { provider: 'greenhouse', token: forToken.toLowerCase() };
    if (first && first !== 'embed') return { provider: 'greenhouse', token: first.toLowerCase() };
    return null;
  }
  if (/^jobs(\.eu)?\.lever\.co$/.test(host) && first)
    return { provider: 'lever', token: first.toLowerCase() };
  if (host === 'jobs.ashbyhq.com' && first) return { provider: 'ashby', token: first };
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host) && first) {
    return { provider: 'smartrecruiters', token: first };
  }
  return null;
}

function remoteFrom(...hints: (string | null | undefined | boolean)[]): RemoteType {
  for (const h of hints) {
    if (h === true) return 'remote';
    if (typeof h !== 'string') continue;
    const v = h.toLowerCase();
    if (/remote/.test(v)) return 'remote';
    if (/hybrid/.test(v)) return 'hybrid';
    if (/on-?site|in[- ]office/.test(v)) return 'onsite';
  }
  return 'unknown';
}

function toJob(fields: {
  title: string | null;
  company: string;
  url: string | null;
  source: BoardProvider;
  externalId: string;
  location?: string | null;
  remoteType?: RemoteType;
  employmentType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  description?: string | null;
  postedAt?: string | null;
}): JobInputParsed | null {
  if (!fields.title) return null;
  const parsed = jobInputSchema.safeParse({
    title: clip(fields.title, 300),
    company: clip(fields.company, 200) ?? 'Unknown company',
    url: fields.url && analyzeJobUrl(fields.url) ? clip(fields.url, 2000) : null,
    source: fields.source,
    externalId: clip(fields.externalId, 200),
    location: clip(fields.location ?? null, 200),
    remoteType: fields.remoteType ?? 'unknown',
    employmentType: clip(fields.employmentType ?? null, 60),
    salaryMin:
      fields.salaryMin != null && fields.salaryMin >= 0 ? Math.round(fields.salaryMin) : null,
    salaryMax:
      fields.salaryMax != null && fields.salaryMax >= 0 ? Math.round(fields.salaryMax) : null,
    salaryCurrency:
      fields.salaryCurrency?.length === 3 ? fields.salaryCurrency.toUpperCase() : null,
    description: clip(fields.description ?? null, 100_000),
    postedAt:
      fields.postedAt && !Number.isNaN(Date.parse(fields.postedAt)) ? fields.postedAt : null,
  });
  return parsed.success ? parsed.data : null;
}

// ------------------------------------------------------------------------------------------
// Greenhouse: https://developers.greenhouse.io/job-board.html
// ------------------------------------------------------------------------------------------

interface GreenhouseJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  updated_at?: string;
  first_published?: string;
  content?: string;
  company_name?: string;
}

const GH = 'https://boards-api.greenhouse.io/v1/boards';

function greenhouseJob(j: GreenhouseJob, company: string): BoardJob | null {
  if (j.id == null) return null;
  const location = str(j.location?.name);
  const job = toJob({
    title: str(j.title),
    company: str(j.company_name) ?? company,
    url: str(j.absolute_url),
    source: 'greenhouse',
    externalId: String(j.id),
    location,
    remoteType: remoteFrom(location),
    description: j.content ? htmlToText(decodeEntities(j.content)) : null,
    postedAt: str(j.first_published) ?? str(j.updated_at),
  });
  return job ? { externalId: String(j.id), job } : null;
}

async function greenhouseBoardName(token: string, opts: FetchOptions): Promise<string | null> {
  try {
    const board = await getJson<{ name?: string }>(
      `${GH}/${encodeURIComponent(token)}`,
      opts,
      {},
      'Greenhouse',
    );
    return str(board.name);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------
// Lever: https://github.com/lever/postings-api
// ------------------------------------------------------------------------------------------

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  createdAt?: number;
  categories?: { location?: string; commitment?: string; allLocations?: string[] };
  descriptionPlain?: string;
  additionalPlain?: string;
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

function leverJob(p: LeverPosting, company: string): BoardJob | null {
  if (!p.id) return null;
  const location = str(p.categories?.location);
  const yearly = !p.salaryRange?.interval || /year|annual/i.test(p.salaryRange.interval);
  const job = toJob({
    title: str(p.text),
    company,
    url: str(p.hostedUrl),
    source: 'lever',
    externalId: p.id,
    location,
    remoteType: remoteFrom(p.workplaceType, location),
    employmentType: str(p.categories?.commitment),
    salaryMin: yearly ? num(p.salaryRange?.min) : null,
    salaryMax: yearly ? num(p.salaryRange?.max) : null,
    salaryCurrency: yearly ? str(p.salaryRange?.currency) : null,
    description: [p.descriptionPlain, p.additionalPlain].filter(Boolean).join('\n\n') || null,
    postedAt: typeof p.createdAt === 'number' ? new Date(p.createdAt).toISOString() : null,
  });
  return job ? { externalId: p.id, job } : null;
}

// ------------------------------------------------------------------------------------------
// Ashby: https://developers.ashbyhq.com/docs/public-job-posting-api
// ------------------------------------------------------------------------------------------

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  employmentType?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  jobUrl?: string;
  compensation?: {
    summaryComponents?: {
      compensationType?: string;
      interval?: string;
      currencyCode?: string;
      minValue?: number;
      maxValue?: number;
    }[];
  };
}

function ashbyJob(j: AshbyJob, company: string): BoardJob | null {
  if (!j.id || j.isListed === false) return null;
  const salary = j.compensation?.summaryComponents?.find(
    (c) => c.compensationType === 'Salary' && (!c.interval || /year/i.test(c.interval)),
  );
  const job = toJob({
    title: str(j.title),
    company,
    url: str(j.jobUrl),
    source: 'ashby',
    externalId: j.id,
    location: str(j.location),
    remoteType: remoteFrom(j.isRemote === true ? true : null, j.workplaceType, j.location),
    employmentType: str(j.employmentType)?.replace(/([a-z])([A-Z])/g, '$1-$2') ?? null,
    salaryMin: num(salary?.minValue),
    salaryMax: num(salary?.maxValue),
    salaryCurrency: str(salary?.currencyCode),
    description: str(j.descriptionPlain),
    postedAt: str(j.publishedAt),
  });
  return job ? { externalId: j.id, job } : null;
}

// ------------------------------------------------------------------------------------------
// SmartRecruiters: https://developers.smartrecruiters.com/docs/posting-api
// ------------------------------------------------------------------------------------------

interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  releasedDate?: string;
  company?: { identifier?: string; name?: string };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    fullLocation?: string;
  };
  typeOfEmployment?: { label?: string };
  jobAd?: { sections?: Record<string, { text?: string } | undefined> };
}

const SR = 'https://api.smartrecruiters.com/v1/companies';

function smartRecruitersJob(
  p: SmartRecruitersPosting,
  token: string,
  company: string,
): BoardJob | null {
  if (!p.id) return null;
  const l = p.location;
  const location =
    str(l?.fullLocation) ??
    ([l?.city, l?.region, l?.country?.toUpperCase()].filter(Boolean).join(', ') || null);
  const sections = p.jobAd?.sections ?? {};
  const description = Object.values(sections)
    .map((s) => (s?.text ? htmlToText(s.text) : ''))
    .filter(Boolean)
    .join('\n\n');
  const job = toJob({
    title: str(p.name),
    company: str(p.company?.name) ?? company,
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${p.id}`,
    source: 'smartrecruiters',
    externalId: p.id,
    location,
    remoteType: remoteFrom(l?.remote === true ? true : null, location),
    employmentType: str(p.typeOfEmployment?.label),
    description: description || null,
    postedAt: str(p.releasedDate),
  });
  return job ? { externalId: p.id, job } : null;
}

// ------------------------------------------------------------------------------------------

/** List open postings from an ATS's official public job-board API. */
export async function fetchBoardJobs(
  provider: BoardProvider,
  token: string,
  opts: BoardFetchOptions = {},
): Promise<BoardJob[]> {
  const t = encodeURIComponent(token);
  const fallback = opts.companyName?.trim() || prettifyToken(token);
  const keep = (jobs: (BoardJob | null)[]) =>
    jobs.filter((j): j is BoardJob => j !== null).slice(0, MAX_POSTINGS);

  switch (provider) {
    case 'greenhouse': {
      const data = await getJson<{ jobs?: unknown }>(
        `${GH}/${t}/jobs${opts.descriptions === false ? '' : '?content=true'}`,
        opts,
        {},
        'Greenhouse',
      );
      if (!Array.isArray(data.jobs))
        throw new UpstreamError('Greenhouse returned an unexpected answer');
      const company =
        opts.companyName?.trim() || (await greenhouseBoardName(token, opts)) || fallback;
      return keep(asArray<GreenhouseJob>(data.jobs).map((j) => greenhouseJob(j, company)));
    }
    case 'lever': {
      const data = await getJson<unknown>(
        `https://api.lever.co/v0/postings/${t}?mode=json`,
        opts,
        {},
        'Lever',
      );
      if (!Array.isArray(data)) throw new UpstreamError('Lever returned an unexpected answer');
      return keep(asArray<LeverPosting>(data).map((p) => leverJob(p, fallback)));
    }
    case 'ashby': {
      const data = await getJson<{ jobs?: unknown }>(
        `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`,
        opts,
        {},
        'Ashby',
      );
      if (!Array.isArray(data.jobs)) throw new UpstreamError('Ashby returned an unexpected answer');
      return keep(asArray<AshbyJob>(data.jobs).map((j) => ashbyJob(j, fallback)));
    }
    case 'smartrecruiters': {
      const out: (BoardJob | null)[] = [];
      for (let offset = 0; offset < MAX_POSTINGS; offset += 100) {
        const page = await getJson<{ content?: unknown; totalFound?: number }>(
          `${SR}/${t}/postings?limit=100&offset=${offset}`,
          opts,
          {},
          'SmartRecruiters',
        );
        if (!Array.isArray(page.content))
          throw new UpstreamError('SmartRecruiters returned an unexpected answer');
        const items = asArray<SmartRecruitersPosting>(page.content);
        out.push(...items.map((p) => smartRecruitersJob(p, token, fallback)));
        if (items.length < 100 || offset + 100 >= (page.totalFound ?? 0)) break;
      }
      return keep(out);
    }
  }
}

/**
 * Fetch one posting's details from the official API when the URL belongs to a supported ATS.
 * Returns null for unsupported URLs (LinkedIn, Indeed, unknown company sites).
 */
export async function fetchJobFromUrl(
  url: string,
  opts: FetchOptions = {},
): Promise<JobDraft | null> {
  const info = analyzeJobUrl(url);
  const board = parseBoardUrl(info?.url ?? url);
  if (!info?.externalId || !board) return null;
  const t = encodeURIComponent(board.token);
  const id = encodeURIComponent(info.externalId);
  const fallback = prettifyToken(board.token);

  switch (board.provider) {
    case 'greenhouse': {
      const [job, name] = await Promise.all([
        getJson<GreenhouseJob>(`${GH}/${t}/jobs/${id}`, opts, {}, 'Greenhouse'),
        greenhouseBoardName(board.token, opts),
      ]);
      return greenhouseJob(job, name ?? fallback)?.job ?? null;
    }
    case 'lever': {
      const posting = await getJson<LeverPosting>(
        `https://api.lever.co/v0/postings/${t}/${id}`,
        opts,
        {},
        'Lever',
      );
      return leverJob(posting, fallback)?.job ?? null;
    }
    case 'ashby': {
      const data = await getJson<{ jobs?: unknown }>(
        `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`,
        opts,
        {},
        'Ashby',
      );
      const match = asArray<AshbyJob>(data.jobs).find(
        (j) => j.id?.toLowerCase() === info.externalId,
      );
      return match ? (ashbyJob(match, fallback)?.job ?? null) : null;
    }
    case 'smartrecruiters': {
      const posting = await getJson<SmartRecruitersPosting>(
        `${SR}/${t}/postings/${id}`,
        opts,
        {},
        'SmartRecruiters',
      );
      return smartRecruitersJob(posting, board.token, fallback)?.job ?? null;
    }
  }
}
