import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Extension API tokens. Mounted at /api/tokens. Owner: api-core agent (KAN-17). See docs/api.md.
 */
export const tokenRoutes = new Hono<AppEnv>();
