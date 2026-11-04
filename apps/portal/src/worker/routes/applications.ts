import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Applications CRUD, status, notes, interviews, resolve-url, export.csv. Mounted at /api/applications. Owner: api-core agent (KAN-16, KAN-44). See docs/api.md.
 */
export const applicationRoutes = new Hono<AppEnv>();
