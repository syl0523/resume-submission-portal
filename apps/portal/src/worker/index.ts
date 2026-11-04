import app from './app';
import type { Env } from './env';
import { handleEmail } from './handlers/email';
import { handleScheduled } from './handlers/scheduled';

/** One Worker, three entry points: HTTP (API + React app), inbound email, daily cron. */
export default {
  fetch: app.fetch,
  email: handleEmail,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Env>;
