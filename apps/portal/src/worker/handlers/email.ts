import type { Env } from '../env';

/**
 * Cloudflare Email Routing handler: every message sent to <alias>@INBOUND_EMAIL_DOMAIN lands here.
 * TODO(api agent): parse with postal-mime, resolve the user from the recipient alias, run the
 * ingest pipeline (services/ingest.ts), store the raw message in R2.
 */
export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  void env;
  void ctx;
  console.log('Inbound email received; ingest not implemented yet', message.from, message.to);
}
