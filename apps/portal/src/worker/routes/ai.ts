import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * /ai/fit, /ai/answer, /profile/draft-from-resume. Mounted at /api. Owner: api-automation agent (KAN-33, KAN-44, KAN-45). See docs/api.md.
 */
export const aiRoutes = new Hono<AppEnv>();
