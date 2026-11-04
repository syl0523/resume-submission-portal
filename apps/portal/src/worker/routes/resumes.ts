import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Resume vault on R2. Mounted at /api/resumes. Owner: api-core agent (KAN-17). See docs/api.md.
 */
export const resumeRoutes = new Hono<AppEnv>();
