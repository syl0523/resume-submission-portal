import type { Env } from '../env';

/**
 * Daily cron (wrangler.jsonc triggers.crons).
 * TODO(api agent): sync watched boards, mark follow-ups due, set "no response" (ghosted)
 * on applications idle for GHOST_AFTER_DAYS.
 */
export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  void env;
  void ctx;
  console.log('Cron fired; jobs not implemented yet', controller.cron);
}
