import { type DiscoverResponse, discoverQuerySchema, SEARCH_PROVIDERS } from '@jsp/core';
import { analyzeJobUrl, dedupeJobs } from '@jsp/integrations';
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
    const providers = q.provider === 'all' ? SEARCH_PROVIDERS : [q.provider];
    const [{ items, outcomes }, saved] = await Promise.all([
      fanOut(
        c.var.db,
        c.env,
        c.var.user.id,
        [
          {
            title: q.q,
            location: q.where ?? null,
            remote: q.remote ?? false,
            postedWithinDays: 30,
            page: q.page,
          },
        ],
        providers,
        { country: q.country },
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
