import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * LinkedIn export / CSV import. Mounted at /api/imports. Owner: api-automation agent (KAN-23). See docs/api.md.
 */
export const importRoutes = new Hono<AppEnv>();
