import type { JobSource } from '@jsp/core';

export interface JobUrlInfo {
  /** Canonical URL with tracking parameters removed. */
  url: string;
  /** Lower-cased dedupe key: no protocol, no trailing slash. */
  key: string;
  source: JobSource;
  /** The site's own job id when the URL carries one (LinkedIn job id, Indeed `jk`, ATS ids). */
  externalId: string | null;
}

const TRACKING_PARAM =
  /^(utm_.+|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|ref|refid|referrer|trk|trkinfo|trackingid|lipi|src|source|gh_src|lever-source|lever-origin|from|tk|vjs|advn|sjdu|ad|xpse|xfps|xkcb|camk|jsa|iaa|alid|ei|cmp|pos|spa|campaign|trid|se|v|feed|hl)$/i;

const AGGREGATOR_HOST =
  /(^|\.)(glassdoor\.[a-z.]+|ziprecruiter\.com|monster\.[a-z.]+|workopolis\.com|jobbank\.gc\.ca|simplyhired\.[a-z.]+|eluta\.ca|talent\.com|careerbuilder\.com|themuse\.com)$/;

function keyFor(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/\/+(\?|$)/, '$1')
    .toLowerCase();
}

function make(url: string, source: JobSource, externalId: string | null): JobUrlInfo {
  return { url, key: keyFor(url), source, externalId };
}

function stripTracking(u: URL): string {
  const kept = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const out = new URL(u.origin + u.pathname.replace(/(.)\/+$/, '$1'));
  for (const [k, v] of kept) out.searchParams.append(k, v);
  return out.toString();
}

/**
 * Canonicalise a job posting URL and recognise the site it belongs to.
 * Returns null for anything that is not an http(s) URL.
 */
export function analyzeJobUrl(input: string): JobUrlInfo | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.protocol = 'https:';
  u.hash = '';
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  // LinkedIn: /jobs/view/<id>, /jobs/view/<slug>-<id>, or ?currentJobId=<id> on search pages.
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const fromPath = /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})(?:\/|$)/.exec(path)?.[1];
    const id = fromPath ?? u.searchParams.get('currentJobId');
    if (id && /^\d{6,}$/.test(id)) {
      return make(`https://www.linkedin.com/jobs/view/${id}/`, 'linkedin', id);
    }
    return make(stripTracking(u), 'linkedin', null);
  }

  // Indeed: any page carrying jk= (or vjk= on search results).
  if (/(^|\.)indeed\.(com|co\.[a-z]{2}|[a-z]{2})$/.test(host)) {
    const jk = u.searchParams.get('jk') ?? u.searchParams.get('vjk');
    if (jk && /^[a-f0-9]{16}$/i.test(jk)) {
      const canonicalHost = host.startsWith('m.') ? `www.${host.slice(2)}` : host;
      return make(
        `https://${canonicalHost}/viewjob?jk=${jk.toLowerCase()}`,
        'indeed',
        jk.toLowerCase(),
      );
    }
    return make(stripTracking(u), 'indeed', null);
  }

  // Greenhouse hosted boards: boards.greenhouse.io/<token>/jobs/<id>, job-boards[.eu].greenhouse.io/...
  if (host.endsWith('greenhouse.io')) {
    const eu = host.includes('.eu.') ? '.eu' : '';
    const m = /^\/([^/]+)\/jobs\/(\d+)/.exec(path);
    if (m?.[1] && m[2]) {
      return make(`https://job-boards${eu}.greenhouse.io/${m[1]}/jobs/${m[2]}`, 'greenhouse', m[2]);
    }
    const forToken = u.searchParams.get('for');
    const jobId = u.searchParams.get('token');
    if (path.startsWith('/embed/') && forToken && jobId && /^\d+$/.test(jobId)) {
      return make(
        `https://job-boards${eu}.greenhouse.io/${forToken}/jobs/${jobId}`,
        'greenhouse',
        jobId,
      );
    }
    return make(stripTracking(u), 'greenhouse', null);
  }

  // Greenhouse embedded on a company careers page: ...?gh_jid=<id>
  const ghJid = u.searchParams.get('gh_jid');
  if (ghJid && /^\d+$/.test(ghJid)) {
    const out = new URL(u.origin + u.pathname.replace(/(.)\/+$/, '$1'));
    out.searchParams.set('gh_jid', ghJid);
    return make(out.toString(), 'greenhouse', ghJid);
  }

  // Lever: jobs[.eu].lever.co/<site>/<uuid>[/apply]
  if (/^jobs(\.eu)?\.lever\.co$/.test(host)) {
    const m = /^\/([^/]+)\/([0-9a-f-]{36})/i.exec(path);
    if (m?.[1] && m[2])
      return make(`https://${host}/${m[1]}/${m[2].toLowerCase()}`, 'lever', m[2].toLowerCase());
    return make(stripTracking(u), 'lever', null);
  }

  // Ashby: jobs.ashbyhq.com/<org>/<uuid>[/application]
  if (host === 'jobs.ashbyhq.com') {
    const m = /^\/([^/]+)\/([0-9a-f-]{36})/i.exec(path);
    if (m?.[1] && m[2])
      return make(`https://${host}/${m[1]}/${m[2].toLowerCase()}`, 'ashby', m[2].toLowerCase());
    return make(stripTracking(u), 'ashby', null);
  }

  // Workday: <tenant>.wdN.myworkdayjobs.com/[locale/]<site>/job/<location>/<title>_<reqId>[/apply...]
  if (/\.myworkday(jobs|site)\.com$/.test(host)) {
    const jobPath = path.replace(/\/apply(\/.*)?$/, '').replace(/\/+$/, '');
    const reqId = /\/job\/.+_([A-Za-z0-9][A-Za-z0-9-]*)$/.exec(jobPath)?.[1] ?? null;
    return make(`https://${host}${jobPath}`, 'workday', reqId);
  }

  // SmartRecruiters: jobs.smartrecruiters.com/<Company>/<id>-<slug>
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host)) {
    const m = /^\/([^/]+)\/(\d{6,})(?:-|\/|$)/.exec(path);
    if (m?.[1] && m[2])
      return make(`https://jobs.smartrecruiters.com/${m[1]}/${m[2]}`, 'smartrecruiters', m[2]);
    return make(stripTracking(u), 'smartrecruiters', null);
  }

  // Adzuna: /details/<id> or /land/ad/<id>
  if (/(^|\.)adzuna\.[a-z.]+$/.test(host)) {
    const id = /\/(?:details|land\/ad)\/(\d+)/.exec(path)?.[1] ?? null;
    if (id) return make(`https://${host}/details/${id}`, 'adzuna', id);
    return make(stripTracking(u), 'adzuna', null);
  }

  return make(stripTracking(u), AGGREGATOR_HOST.test(host) ? 'other' : 'company_site', null);
}

/** Canonical URL, or null when the input is not an http(s) URL. */
export function normalizeUrl(input: string): string | null {
  return analyzeJobUrl(input)?.url ?? null;
}

/** Dedupe key for a job URL, or null when the input is not an http(s) URL. */
export function urlKey(input: string): string | null {
  return analyzeJobUrl(input)?.key ?? null;
}
