import { jobInputSchema } from '@jsp/core';
import { roleFamily } from '../fit';
import { clip } from '../http';
import { analyzeJobUrl } from '../url';
import type { SearchQuery, SearchResultItem } from './types';

/**
 * Claude web search as a job source (KAN-63): the pure half. The Worker sends the request
 * (services/websearch.ts); this module holds the domain allow-list, the prompt and the mapping
 * from Claude's reported postings to jobs. Only employers' careers sites and ATS job boards are
 * searched, never LinkedIn or Indeed (docs/adr/0002).
 */

/**
 * Web search `allowed_domains`, most important first. Entries are bare domains with an optional
 * path; subdomains are included automatically and wildcards are not allowed in the domain
 * ("myworkdayjobs.com" covers nvidia.wd5.myworkdayjobs.com, salesforce.wd12.myworkdayjobs.com…).
 */
export const WEB_SEARCH_ALLOWED_DOMAINS: readonly string[] = [
  // Big tech careers sites
  'google.com/about/careers',
  'careers.google.com',
  'careers.microsoft.com',
  'amazon.jobs',
  'jobs.apple.com',
  'metacareers.com',
  'jobs.netflix.net',
  'jobs.netflix.com',
  'careers.salesforce.com',
  'jobs.uber.com',
  'uber.com/global/en/careers',
  'uber.com/us/en/careers',
  // Applicant tracking systems (NVIDIA, Salesforce, Adobe, Intel and many banks use Workday)
  'myworkdayjobs.com',
  'myworkdaysite.com',
  'job-boards.greenhouse.io',
  'boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.ashbyhq.com',
  'jobs.smartrecruiters.com',
];

const NEVER = /(^|\.)(linkedin\.com|indeed\.[a-z.]+)$/i;

/** Is this URL on one of the allowed domains (host and path prefix), and never LinkedIn/Indeed? */
export function isAllowedJobUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (NEVER.test(host)) return false;
  const path = u.pathname.toLowerCase();
  return WEB_SEARCH_ALLOWED_DOMAINS.some((entry) => {
    const slash = entry.indexOf('/');
    const domain = slash < 0 ? entry : entry.slice(0, slash);
    const prefix = slash < 0 ? '' : entry.slice(slash);
    const onDomain = host === domain || host.endsWith(`.${domain}`);
    return onDomain && (!prefix || path === prefix || path.startsWith(`${prefix}/`));
  });
}

/** A posting as Claude reports it (validated by the Worker before it gets here). */
export interface WebSearchPosting {
  title: string;
  company: string;
  location: string | null;
  url: string;
  /** YYYY-MM-DD when the page shows it. */
  postedAt: string | null;
  snippet: string | null;
}

/** Comparable forms of a URL: the job-URL key (ATS-aware) and host + path. */
function urlForms(url: string): string[] {
  const forms: string[] = [];
  const key = analyzeJobUrl(url)?.key;
  if (key) forms.push(key);
  try {
    const u = new URL(url);
    forms.push(`${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`);
  } catch {
    // not a URL
  }
  return forms;
}

/**
 * Jobs from Claude's report. A posting is kept only when its URL is on an allowed domain and was
 * one of the search results (so it is a page Claude actually found, not a guessed link).
 */
export function webSearchItems(
  postings: readonly WebSearchPosting[],
  resultUrls: readonly string[],
  max = 10,
): SearchResultItem[] {
  const found = new Set(resultUrls.flatMap(urlForms));
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();
  for (const p of postings) {
    if (items.length >= max) break;
    if (!isAllowedJobUrl(p.url)) continue;
    const forms = urlForms(p.url);
    if (!forms.some((f) => found.has(f))) continue;
    const info = analyzeJobUrl(p.url);
    if (!info || seen.has(info.key)) continue;
    seen.add(info.key);
    const posted = p.postedAt && !Number.isNaN(Date.parse(p.postedAt)) ? p.postedAt : null;
    const parsed = jobInputSchema.safeParse({
      title: clip(p.title, 300),
      company: clip(p.company, 200),
      url: clip(info.url, 2000),
      source: info.source === 'other' ? 'company_site' : info.source,
      externalId: info.externalId,
      location: clip(p.location, 200),
      remoteType: p.location && /remote/i.test(p.location) ? 'remote' : 'unknown',
      description: clip(p.snippet, 2000),
      postedAt: posted,
    });
    if (parsed.success) items.push({ job: parsed.data, sourceLabel: 'Web search' });
  }
  return items;
}

const BIG_TECH = 'Google, Microsoft, Amazon, Apple, Meta, NVIDIA, Netflix, Salesforce and Uber';

export const WEB_SEARCH_SYSTEM = `You find currently open job postings for a US job seeker on employers' own careers sites and applicant-tracking-system job boards, including the careers sites of large technology companies (${BIG_TECH}).
Use the web_search tool, then call record_job_postings exactly once with what you found.
Only report individual job posting pages (not search, listing or blog pages) that appeared in your search results, with the URL copied exactly from the result.
Skip postings that look closed, expired or outside the requested location. Never report LinkedIn or Indeed pages.
title, company and location as the posting states them; postedAt as YYYY-MM-DD only when the page shows a date, else null; snippet: one or two sentences on the role from the result, else null.
If nothing fits, call record_job_postings with an empty list.`;

/** The user turn for one title x location query. */
export function webSearchPrompt(q: SearchQuery, maxSearches: number): string {
  const where = q.remote
    ? 'that are remote in the United States'
    : q.location
      ? `in or near ${q.location}`
      : 'in the United States';
  const level = q.seniority ? ` Seniority: ${q.seniority.replace('_', '-')}.` : '';
  const variants =
    roleFamily(q.title) === 'reliability'
      ? '\nClose variants of the title count: Site Reliability Engineer (SRE), Production Support, Application Support, Incident Manager, Reliability Engineer.'
      : '';
  return `Find currently open job postings for "${q.title}" ${where}, posted within about the last ${q.postedWithinDays} days where the page shows a date.${level}${variants}
Use at most ${maxSearches} searches and report up to 10 postings.`;
}
