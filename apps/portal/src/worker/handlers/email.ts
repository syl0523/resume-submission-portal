import { createDb } from '../db/client';
import type { Env } from '../env';
import { nowIso } from '../lib/time';
import { ingestEmail } from '../services/ingest';
import { parseRawEmail } from '../services/mime';
import { findUserByInboundAlias } from '../services/users';

/** Larger messages are refused (application emails are small; this caps R2 and CPU use). */
export const MAX_INBOUND_BYTES = 10 * 1024 * 1024;

/** "jobs-k3x9q2ab+linkedin@jobs.example.com" → "jobs-k3x9q2ab". */
export function aliasFromRecipient(to: string): string {
  const local = to.trim().toLowerCase().split('@')[0] ?? '';
  return local.split('+')[0] ?? '';
}

/**
 * Cloudflare Email Routing handler (KAN-22): every message sent to <alias>@INBOUND_EMAIL_DOMAIN.
 * Unknown recipients are rejected. Everything after that is recorded in the Inbox; processing
 * errors never bounce back to the sender.
 */
export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  void ctx;
  const db = createDb(env.DB);
  const user = await findUserByInboundAlias(db, aliasFromRecipient(message.to));
  if (!user) {
    message.setReject('Unknown recipient');
    return;
  }
  if (message.rawSize > MAX_INBOUND_BYTES) {
    message.setReject('Message too large');
    return;
  }
  try {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await parseRawEmail(raw);
    await ingestEmail(db, env, user, {
      message: parsed.message,
      messageId: parsed.messageId,
      receivedAt: nowIso(),
      raw,
    });
  } catch (err) {
    console.error('Inbound email could not be processed', err);
  }
}
