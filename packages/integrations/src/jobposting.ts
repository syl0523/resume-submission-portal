import type { JobDraft, RemoteType } from '@jsp/core';
import { clip, num, str } from './http';
import { decodeEntities, htmlToText } from './text';
import { analyzeJobUrl } from './url';

/**
 * Build a job draft from schema.org JobPosting JSON-LD found on a page (most job sites embed it for
 * Google for Jobs). `blocks` are the parsed contents of every `<script type="application/ld+json">`.
 * Handles arrays and @graph, hiringOrganization, jobLocation / applicantLocationRequirements,
 * jobLocationType TELECOMMUTE, baseSalary, employmentType, datePosted, identifier and HTML descriptions.
 */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function typesOf(node: Json): string[] {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

/** Every object in the blocks, flattening arrays and @graph. */
function nodes(value: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 6) return out;
  if (Array.isArray(value)) {
    for (const v of value) nodes(v, out, depth + 1);
  } else if (isObject(value)) {
    out.push(value);
    if (Array.isArray(value['@graph'])) nodes(value['@graph'], out, depth + 1);
  }
  return out;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return str(decodeEntities(value));
  if (isObject(value)) return text(value.name ?? value['@value']);
  if (Array.isArray(value)) return text(value[0]);
  return null;
}

function place(value: unknown): string | null {
  const list = Array.isArray(value) ? value : [value];
  const names = list
    .map((loc) => {
      if (typeof loc === 'string') return loc.trim();
      if (!isObject(loc)) return null;
      const address = isObject(loc.address) ? loc.address : loc;
      const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
        .map((p) => text(p))
        .filter((p): p is string => Boolean(p));
      return parts.length > 0 ? parts.join(', ') : text(loc.name);
    })
    .filter((n): n is string => Boolean(n));
  return names.length > 0 ? [...new Set(names)].slice(0, 3).join(' · ') : null;
}

function salary(value: unknown): {
  min: number | null;
  max: number | null;
  currency: string | null;
} {
  const none = { min: null, max: null, currency: null };
  if (!isObject(value)) return none;
  const currency = str(value.currency);
  const v = isObject(value.value) ? value.value : value;
  const unit = (str(v.unitText) ?? 'YEAR').toUpperCase();
  const factor =
    unit === 'YEAR' ? 1 : unit === 'MONTH' ? 12 : unit === 'HOUR' ? 2080 : unit === 'WEEK' ? 52 : 0;
  if (!factor) return none;
  const scale = (n: number | null) => (n === null ? null : Math.round(n * factor));
  const single = num(v.value);
  return {
    min: scale(num(v.minValue) ?? single),
    max: scale(num(v.maxValue) ?? single),
    currency: currency && currency.length === 3 ? currency.toUpperCase() : null,
  };
}

function employment(value: unknown): string | null {
  const list = (Array.isArray(value) ? value : [value])
    .map((v) => text(v))
    .filter((v): v is string => Boolean(v));
  if (list.length === 0) return null;
  return list
    .map((v) =>
      v
        .replace(/_/g, '-')
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase()),
    )
    .join(', ')
    .slice(0, 60);
}

export function jobFromJsonLd(blocks: unknown[], pageUrl: string): JobDraft | null {
  const posting = nodes(blocks).find((n) => typesOf(n).includes('JobPosting'));
  if (!posting) return null;
  const title = text(posting.title) ?? text(posting.name);
  if (!title) return null;

  const company = text(posting.hiringOrganization);
  const remote =
    /telecommute/i.test(String(posting.jobLocationType ?? '')) ||
    (posting.applicantLocationRequirements !== undefined && posting.jobLocation === undefined);
  const location =
    place(posting.jobLocation) ??
    (remote ? (place(posting.applicantLocationRequirements) ?? 'Remote') : null);
  const pay = salary(posting.baseSalary ?? posting.estimatedSalary);
  const urlCandidate = str(posting.url) ?? pageUrl;
  const info = analyzeJobUrl(urlCandidate) ?? analyzeJobUrl(pageUrl);
  const identifier = isObject(posting.identifier)
    ? text(posting.identifier.value)
    : text(posting.identifier);
  const description =
    typeof posting.description === 'string'
      ? htmlToText(decodeEntities(posting.description))
      : null;
  const remoteType: RemoteType = remote
    ? 'remote'
    : location && /hybrid/i.test(location)
      ? 'hybrid'
      : 'unknown';
  const posted = str(posting.datePosted);

  return {
    title: clip(title, 300) ?? title,
    company: clip(company, 200) ?? undefined,
    url: info?.url ?? null,
    source: info?.source,
    externalId: info?.externalId ?? clip(identifier, 200),
    location: clip(location, 200),
    remoteType,
    employmentType: employment(posting.employmentType),
    salaryMin: pay.min,
    salaryMax: pay.max,
    salaryCurrency: pay.min !== null || pay.max !== null ? pay.currency : null,
    description: clip(description, 100_000),
    postedAt: posted && !Number.isNaN(Date.parse(posted)) ? new Date(posted).toISOString() : null,
  };
}
