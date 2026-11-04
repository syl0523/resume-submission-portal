import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Saved searches (Job Match), runs, hits, deep links. Mounted at /api/searches. Owner: api-automation agent (KAN-39). See docs/api.md.
 */
export const searchRoutes = new Hono<AppEnv>();
