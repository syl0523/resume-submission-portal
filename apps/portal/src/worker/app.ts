import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createDb } from './db/client';
import type { AppEnv } from './env';
import { bearerAuth, sessionAuth } from './lib/auth';
import { errorBody, handleError } from './lib/errors';
import { nowIso } from './lib/time';
import { aiRoutes } from './routes/ai';
import { applicationRoutes } from './routes/applications';
import { boardRoutes } from './routes/boards';
import { calendarRoutes } from './routes/calendar';
import { discoverRoutes } from './routes/discover';
import { extRoutes } from './routes/ext';
import { importRoutes } from './routes/imports';
import { inboxRoutes } from './routes/inbox';
import { meRoutes } from './routes/me';
import { profileRoutes } from './routes/profile';
import { resumeRoutes } from './routes/resumes';
import { searchRoutes } from './routes/searches';
import { statsRoutes } from './routes/stats';
import { tokenRoutes } from './routes/tokens';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(handleError);
  app.notFound((c) => c.json(errorBody('not_found', 'Route not found'), 404));

  app.use('/api/*', async (c, next) => {
    c.set('db', createDb(c.env.DB));
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, time: nowIso() }));

  // Extension API: personal bearer token, callable from the extension's origin.
  app.use(
    '/api/ext/*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 86_400,
    }),
  );
  app.use('/api/ext/*', bearerAuth);
  app.route('/api/ext', extRoutes);

  // Portal API: Cloudflare Access session (dev user on localhost). Extension routes use bearer
  // tokens; the calendar feed is authenticated by the secret token in its URL.
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/ext/') || c.req.path.startsWith('/api/calendar/')) {
      return next();
    }
    return sessionAuth(c, next);
  });
  // Public, token-authenticated calendar feed.
  app.route('/api/calendar', calendarRoutes);

  app.route('/api/me', meRoutes);
  app.route('/api/applications', applicationRoutes);
  app.route('/api/resumes', resumeRoutes);
  app.route('/api/profile', profileRoutes);
  app.route('/api/tokens', tokenRoutes);
  app.route('/api/stats', statsRoutes);
  app.route('/api/inbox', inboxRoutes);
  app.route('/api/imports', importRoutes);
  app.route('/api/boards', boardRoutes);
  app.route('/api/discover', discoverRoutes);
  app.route('/api/searches', searchRoutes);
  app.route('/api', aiRoutes);

  return app;
}

const app = createApp();
export default app;
