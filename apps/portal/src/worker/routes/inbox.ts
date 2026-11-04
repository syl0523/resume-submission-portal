import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Inbox: list, paste, link, create, ignore. Mounted at /api/inbox. Owner: api-automation agent (KAN-22). See docs/api.md.
 */
export const inboxRoutes = new Hono<AppEnv>();
