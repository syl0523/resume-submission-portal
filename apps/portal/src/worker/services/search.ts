import { jobInputSchema, type ProviderOutcome, type SearchProvider } from '@jsp/core';
import {
  normalizeForCompare,
  type SearchQuery,
  type SearchResult,
  type SearchResultItem,
  searchAdzuna,
  searchJSearch,
  searchUsaJobs,
  titleSimilarity,
} from '@jsp/integrations';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { applications, boardPostings, jobs, watchedBoards } from '../db/schema';
import { type Env, outboundFetch } from '../env';

/**
 * Provider fan-out shared by Discover and Job Match runs (docs/api.md): every requested provider
 * that is configured, in parallel, 10 s per call. One failing provider never fails the search.
 */

export interface FoundItem extends SearchResultItem {
  provider: SearchProvider;
}

const CALL_TIMEOUT_MS = 10_000;

export function providerAvailability(env: Env): Record<SearchProvider, boolean> {
  return {
    jsearch: Boolean(env.JSEARCH_API_KEY?.trim()),
    adzuna: Boolean(env.ADZUNA_APP_ID?.trim() && env.ADZUNA_APP_KEY?.trim()),
    usajobs: Boolean(env.USAJOBS_API_KEY?.trim() && env.USAJOBS_USER_AGENT?.trim()),
    boards: true,
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
      if (!q.location) return true;
      const wanted = normalizeForCompare(q.location)
        .split(' ')
        .filter((w) => w.length >= 2);
      const where = normalizeForCompare(location);
      return remote || wanted.some((w) => where.includes(w));
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
  opts: { country?: string } = {},
): Promise<{ items: FoundItem[]; outcomes: ProviderOutcome[] }> {
  const available = providerAvailability(env);
  const fetchImpl = outboundFetch(env);
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
      const settled = await Promise.allSettled(queries.map((q) => call(provider, q)));
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
