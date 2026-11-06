import { jobInputSchema, type ProviderOutcome, type SearchProvider } from '@jsp/core';
import {
  matchPlace,
  type SearchQuery,
  type SearchResult,
  type SearchResultItem,
  searchAdzuna,
  searchJSearch,
  searchMuse,
  searchUsaJobs,
  titleSimilarity,
} from '@jsp/integrations';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { applications, boardPostings, jobs, watchedBoards } from '../db/schema';
import { type Env, outboundFetch } from '../env';
import {
  searchWeb,
  WEB_SEARCH_MAX_QUERIES,
  WEB_SEARCH_TIMEOUT_MS,
  webSearchEnabled,
} from './websearch';

/**
 * Provider fan-out shared by Discover and Job Match runs (docs/api.md): every requested provider
 * that is configured, in parallel, 10 s per call (The Muse 15 s for its pages, Claude web search
 * 90 s). One failing provider never fails the search.
 */

export interface FoundItem extends SearchResultItem {
  provider: SearchProvider;
}

const CALL_TIMEOUT_MS = 10_000;
/** The Muse: pages per category for manual runs and Discover, and for the daily refresh. */
const MUSE_PAGES = 2;
const MUSE_PAGES_SCHEDULED = 1;
const MUSE_TIMEOUT_MS = 15_000;

export interface FanOutOptions {
  /** Adzuna country index. */
  country?: string;
  /** The daily refresh: fewer pages, no paid AI sources. */
  scheduled?: boolean;
  /** Discover keyword search: sources without keyword search also match descriptions. */
  keywordSearch?: boolean;
}

export function providerAvailability(env: Env): Record<SearchProvider, boolean> {
  return {
    jsearch: Boolean(env.JSEARCH_API_KEY?.trim()),
    adzuna: Boolean(env.ADZUNA_APP_ID?.trim() && env.ADZUNA_APP_KEY?.trim()),
    usajobs: Boolean(env.USAJOBS_API_KEY?.trim() && env.USAJOBS_USER_AGENT?.trim()),
    boards: true,
    // Public API, no key (KAN-66).
    muse: true,
    // Claude web search (KAN-63): billed to the Anthropic key, so the key itself is required.
    websearch: webSearchEnabled(env),
  };
}

/** Open postings on the user's watched boards whose titles resemble the query. */
async function searchBoards(db: Db, userId: string, queries: SearchQuery[]): Promise<SearchResult> {
  const rows = await db
    .select({ posting: boardPostings, board: watchedBoards })
    .from(boardPostings)
    .innerJoin(watchedBoards, eq(watchedBoards.id, boardPostings.boardId))
    .where(
      and(
        eq(boardPostings.userId, userId),
        eq(boardPostings.dismissed, false),
        sql`${boardPostings.lastSeenAt} = ${watchedBoards.lastSyncedAt}`,
      ),
    )
    .all();
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();
  for (const { posting, board } of rows) {
    const location = posting.location ?? '';
    const remote = /remote/i.test(location);
    const fits = queries.some((q) => {
      if (titleSimilarity(q.title, posting.title) < 0.55) return false;
      if (q.remote) return remote || !location;
      if (!q.location || !location || remote) return true;
      // A metro covers its cities ("San Francisco Bay Area" keeps "Oakland, CA").
      const fit = matchPlace(q.location, location);
      return fit === 'match' || fit === 'unknown';
    });
    if (!fits || seen.has(posting.id)) continue;
    seen.add(posting.id);
    const parsed = jobInputSchema.safeParse({
      title: posting.title,
      company: board.companyName,
      url: posting.url,
      source: board.provider,
      externalId: posting.externalId,
      location: posting.location,
      remoteType: remote ? 'remote' : 'unknown',
      postedAt: posting.postedAt,
    });
    if (parsed.success)
      items.push({ job: parsed.data, sourceLabel: `${board.companyName} careers` });
  }
  return { items, total: items.length };
}

export async function fanOut(
  db: Db,
  env: Env,
  userId: string,
  queries: SearchQuery[],
  providers: readonly SearchProvider[],
  opts: FanOutOptions = {},
): Promise<{ items: FoundItem[]; outcomes: ProviderOutcome[] }> {
  const available = providerAvailability(env);
  const fetchImpl = outboundFetch(env);

  // The Muse has no keyword search: one call covers every title and place (bounded pages).
  const museCall = (): Promise<SearchResult> => {
    const pages = opts.scheduled ? MUSE_PAGES_SCHEDULED : MUSE_PAGES;
    const firstPage = Math.max(1, queries[0]?.page ?? 1);
    const places = [...new Set(queries.filter((q) => !q.remote).map((q) => q.location ?? null))];
    return searchMuse(
      {
        titles: [...new Set(queries.map((q) => q.title))],
        places,
        remote: queries.some((q) => q.remote),
        seniority: queries[0]?.seniority ?? null,
        page: (firstPage - 1) * pages,
        maxPages: pages,
        matchDescription: opts.keywordSearch === true,
      },
      { fetch: fetchImpl, signal: AbortSignal.timeout(MUSE_TIMEOUT_MS) },
    );
  };

  const callsFor = (provider: SearchProvider): (() => Promise<SearchResult>)[] => {
    if (provider === 'muse') return [museCall];
    if (provider === 'websearch') {
      // Paid per search: manual runs only, first page only, the most important queries only.
      if (opts.scheduled || (queries[0]?.page ?? 1) > 1) return [];
      return queries.slice(0, WEB_SEARCH_MAX_QUERIES).map((q) => () => call(provider, q));
    }
    return queries.map((q) => () => call(provider, q));
  };

  const call = (provider: SearchProvider, q: SearchQuery): Promise<SearchResult> => {
    const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
    switch (provider) {
      case 'jsearch':
        return searchJSearch(
          {
            apiKey: env.JSEARCH_API_KEY ?? '',
            host: env.JSEARCH_HOST,
            query: q.title,
            location: q.location,
            remote: q.remote,
            page: q.page,
            postedWithinDays: q.postedWithinDays,
            seniority: q.seniority,
          },
          { fetch: fetchImpl, signal },
        );
      case 'adzuna':
        return searchAdzuna(
          {
            appId: env.ADZUNA_APP_ID ?? '',
            appKey: env.ADZUNA_APP_KEY ?? '',
            country: opts.country ?? env.ADZUNA_COUNTRY ?? 'us',
            what: q.remote ? `${q.title} remote` : q.title,
            where: q.location,
            page: q.page,
            maxDaysOld: q.postedWithinDays,
          },
          { fetch: fetchImpl, signal },
        );
      case 'usajobs':
        return searchUsaJobs(
          {
            apiKey: env.USAJOBS_API_KEY ?? '',
            userAgent: env.USAJOBS_USER_AGENT ?? '',
            keyword: q.title,
            location: q.location,
            remote: q.remote,
            page: q.page,
            postedWithinDays: q.postedWithinDays,
          },
          { fetch: fetchImpl, signal },
        );
      case 'boards':
        return searchBoards(db, userId, [q]);
      case 'muse':
        return museCall();
      case 'websearch':
        return searchWeb(env, q, { signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS) });
    }
  };

  const perProvider = await Promise.all(
    providers.map(async (provider) => {
      if (!available[provider]) {
        return {
          provider,
          items: [] as FoundItem[],
          outcome: { provider, total: 0, error: 'not_configured' },
        };
      }
      const settled = await Promise.allSettled(callsFor(provider).map((run) => run()));
      const ok = settled.filter(
        (s): s is PromiseFulfilledResult<SearchResult> => s.status === 'fulfilled',
      );
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
      const items = ok.flatMap((s) => s.value.items.map((i) => ({ ...i, provider })));
      const error =
        ok.length === 0 && failed
          ? failed.reason instanceof Error
            ? failed.reason.message
            : 'The provider failed'
          : null;
      return {
        provider,
        items,
        outcome: { provider, total: ok.reduce((sum, s) => sum + s.value.total, 0), error },
      };
    }),
  );
  return {
    items: perProvider.flatMap((p) => p.items),
    outcomes: perProvider.map((p) => p.outcome),
  };
}

/** Map URL key / source+job id → the user's application id, for "already saved" badges. */
export async function applicationIndex(db: Db, userId: string) {
  const rows = await db
    .select({
      id: applications.id,
      urlKey: jobs.urlKey,
      source: jobs.source,
      externalId: jobs.externalId,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(applications.userId, userId))
    .all();
  const byKey = new Map<string, string>();
  for (const r of rows) {
    if (r.urlKey) byKey.set(`url:${r.urlKey}`, r.id);
    if (r.externalId) byKey.set(`id:${r.source}:${r.externalId}`, r.id);
  }
  return byKey;
}
