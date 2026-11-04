import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Keyword search across providers. Mounted at /api/discover. Owner: api-automation agent (KAN-24). See docs/api.md.
 */
export const discoverRoutes = new Hono<AppEnv>();
