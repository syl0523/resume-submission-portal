import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getDashboardStats } from '../services/stats';

/** Dashboard stats (KAN-18). Mounted at /api/stats. */
export const statsRoutes = new Hono<AppEnv>().get('/', async (c) =>
  c.json(await getDashboardStats(c.var.db, c.var.user.id)),
);
