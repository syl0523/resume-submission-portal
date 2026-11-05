import type { JobDraft, JobFit, SavedSearch } from '@jsp/core';
import {
  analyzeJobUrl,
  type FitJob,
  jobFromJsonLd,
  parseBoardUrl,
  prettifyToken,
  scoreJobFit,
  similarity,
} from '@jsp/integrations';
import type { BoardFields, PageSnapshot } from './page';

/** Where the popup's prefilled fields came from, shown as a hint. */
export type JobOrigin = 'json-ld' | 'linkedin' | 'indeed' | 'page';

export interface PageJob {
  job: JobDraft;
  origin: JobOrigin;
}

/** Below this the selection is a stray word or two, not a job description. */
const MIN_SELECTION = 200;

function fromBoard(board: BoardFields | null): JobDraft {
  if (!board) return {};
  return {
    title: board.title ?? undefined,
    company: board.company ?? undefined,
    location: board.location,
    description: board.description,
    remoteType: board.location && /\bremote\b/i.test(board.location) ? 'remote' : undefined,
  };
}

/** Last resort on pages without structured data: Open Graph tags, the main heading, the title. */
function fromMeta(page: PageSnapshot): JobDraft {
  const company = page.meta['og:site_name'] ?? null;
  const title = page.meta['og:title'] ?? page.h1 ?? page.title;
  return {
    title: title || undefined,
    company: company ?? undefined,
    description: page.meta['og:description'] ?? page.meta.description ?? null,
  };
}

/**
 * The job on the page, best source first: JSON-LD (what job sites publish for Google for Jobs),
 * then LinkedIn's or Indeed's own job pane, then page metadata. On LinkedIn and Indeed the pane
 * wins, and JSON-LD for a different job than the pane (search result pages) is ignored.
 */
export function jobFromSnapshot(page: PageSnapshot): PageJob {
  const info = analyzeJobUrl(page.url);
  const onBoard = info?.source === 'linkedin' || info?.source === 'indeed';
  let ld = jobFromJsonLd(page.jsonLd, page.url);
  const board = fromBoard(page.board);
  if (onBoard && ld?.title && board.title && similarity(ld.title, board.title) < 0.5) ld = null;

  const layers: [JobOrigin, JobDraft][] = onBoard
    ? [
        [info?.source === 'linkedin' ? 'linkedin' : 'indeed', board],
        ['json-ld', ld ?? {}],
      ]
    : [
        ['json-ld', ld ?? {}],
        ['page', fromMeta(page)],
      ];
  const pick = <K extends keyof JobDraft>(key: K): JobDraft[K] | undefined => {
    for (const [, layer] of layers) {
      const value = layer[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  };
  const origin = layers.find(([, layer]) => layer.title)?.[0] ?? 'page';

  // ATS pages without JSON-LD still name the company in the URL (jobs.lever.co/acme/…).
  const boardRef = parseBoardUrl(page.url);
  const company = pick('company') ?? (boardRef ? prettifyToken(boardRef.token) : undefined);
  const selection =
    page.selection && page.selection.length >= MIN_SELECTION ? page.selection : null;

  return {
    origin,
    job: {
      title: pick('title'),
      company,
      location: pick('location') ?? null,
      remoteType: pick('remoteType') ?? 'unknown',
      employmentType: pick('employmentType') ?? null,
      salaryMin: pick('salaryMin') ?? null,
      salaryMax: pick('salaryMax') ?? null,
      salaryCurrency: pick('salaryCurrency') ?? null,
      description: selection ?? pick('description') ?? null,
      postedAt: pick('postedAt') ?? null,
      url: info?.url ?? ld?.url ?? page.url,
      source: info?.source ?? ld?.source ?? 'company_site',
      externalId: info?.externalId ?? ld?.externalId ?? null,
    },
  };
}

/** The saved search this job fits best, scored the same way the portal scores search results. */
export function bestFit(
  searches: SavedSearch[],
  job: JobDraft,
  now: Date = new Date(),
): { fit: JobFit; search: SavedSearch } | null {
  if (!job.title || searches.length === 0) return null;
  const fitJob: FitJob = {
    title: job.title,
    company: job.company ?? '',
    description: job.description ?? null,
    location: job.location ?? null,
    remoteType: job.remoteType ?? 'unknown',
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    postedAt: job.postedAt ?? null,
    employmentType: job.employmentType ?? null,
  };
  let best: { fit: JobFit; search: SavedSearch } | null = null;
  for (const search of searches) {
    const fit = scoreJobFit(search, fitJob, now);
    if (!best || fit.score > best.fit.score) best = { fit, search };
  }
  return best;
}

/** Base64 for the autofill message, in chunks so a 5 MB resume does not overflow the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
