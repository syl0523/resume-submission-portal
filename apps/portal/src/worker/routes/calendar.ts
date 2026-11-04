import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Private ICS feed (token in URL, no session). Mounted at /api/calendar. Owner: api-core agent (KAN-44). See docs/api.md.
 */
export const calendarRoutes = new Hono<AppEnv>();
