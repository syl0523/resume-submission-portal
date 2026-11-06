import {
  DEFAULT_SEARCH_LOCATION,
  type DiscoverResponse,
  discoverQuerySchema,
  SEARCH_PROVIDERS,
} from '@jsp/core';
import { analyzeJobUrl, canonicalPlace, dedupeJobs } from '@jsp/integrations';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { validate } from '../lib/validate';
import { applicationIndex, fanOut } from '../services/search';

/** Keyword search across the same providers as Job Match, not fit-scored (KAN-24). */
export const discoverRoutes = new Hono<AppEnv>().get(
  '/',
  validate('query', discoverQuerySchema),
  async (c) => {
    const q = c.req.valid('query');
    // Claude web search is slow and paid per search: only when picked as the source (KAN-63).
    const providers =
      q.provider === 'all' ? SEARCH_PROVIDERS.filter((p) => p !== 'websearch') : [q.provider];
    // Empty `where`: the default place (KAN-65), unless the search is remote-only (US-wide).
    // "United States" searches the whole country; a metro alias becomes the metro's name.
    const where = q.where ? canonicalPlace(q.where) : q.remote ? null : DEFAULT_SEARCH_LOCATION;
    const [{ items, outcomes }, saved] = await Promise.all([
      fanOut(
        c.var.db,
        c.env,
        c.var.user.id,
        [
          {
            title: q.q,
            location: where,
            remote: q.remote ?? false,
            postedWithinDays: 30,
            page: q.page,
          },
        ],
        providers,
        { country: q.country, keywordSearch: true },
      ),
      applicationIndex(c.var.db, c.var.user.id),
    ]);
    const body: DiscoverResponse = {
      items: dedupeJobs(items).map((item) => {
        const key = item.job.url ? analyzeJobUrl(item.job.url)?.key : undefined;
        return {
          provider: item.provider,
          sourceLabel: item.sourceLabel,
          job: item.job,
          existingApplicationId:
            (key ? saved.get(`url:${key}`) : undefined) ??
            (item.job.externalId
              ? saved.get(`id:${item.job.source}:${item.job.externalId}`)
              : undefined) ??
            null,
        };
      }),
      total: outcomes.reduce((sum, o) => sum + o.total, 0),
      page: q.page,
      providers: outcomes,
    };
    return c.json(body);
  },
);
