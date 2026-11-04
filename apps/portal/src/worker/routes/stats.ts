import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Dashboard stats. Mounted at /api/stats. Owner: api-core agent (KAN-18). See docs/api.md.
 */
export const statsRoutes = new Hono<AppEnv>();
