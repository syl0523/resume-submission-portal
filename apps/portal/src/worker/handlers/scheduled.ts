import type { Env } from '../env';
import { runScheduledJobs } from '../services/cron';
import { refreshAlertSearches } from '../services/jobmatch';

/** Weekly cron (wrangler.jsonc triggers.crons, Mondays 11:00 UTC). See services/cron.ts. */
export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  void ctx;
  const report = await runScheduledJobs(
    env,
    new Date(controller.scheduledTime),
    refreshAlertSearches,
  );
  console.log('Scheduled jobs finished', controller.cron, JSON.stringify(report));
}
