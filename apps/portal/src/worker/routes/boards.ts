import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Watched company boards and postings. Mounted at /api/boards. Owner: api-automation agent (KAN-24, KAN-25). See docs/api.md.
 */
export const boardRoutes = new Hono<AppEnv>();
