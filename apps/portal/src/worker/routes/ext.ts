import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Browser-extension API (bearer-token auth, CORS enabled). Mounted at /api/ext.
 * TODO(api agent): GET /profile, POST /jobs, GET /lookup, GET /resumes/:id/file — see docs/api.md.
 */
export const extRoutes = new Hono<AppEnv>().get('/ping', (c) =>
  c.json({ ok: true, email: c.var.user.email }),
);
