import type { Env } from '../env';
import { runDailyJobs } from '../services/cron';

/** Daily cron (wrangler.jsonc triggers.crons, 11:00 UTC). See services/cron.ts. */
export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  void ctx;
  const report = await runDailyJobs(env, new Date(controller.scheduledTime));
  console.log('Daily jobs finished', controller.cron, JSON.stringify(report));
}
