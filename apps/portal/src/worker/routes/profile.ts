import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Autofill profile (GET/PUT). Mounted at /api/profile. Owner: api-core agent (KAN-17). See docs/api.md.
 */
export const profileRoutes = new Hono<AppEnv>();
