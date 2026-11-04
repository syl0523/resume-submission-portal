import type { EmailMessage } from '@jsp/integrations';
import PostalMime, { type Address, type Email } from 'postal-mime';
import { toIso } from '../lib/time';

/** Raw RFC 822 → the decoded shape the integrations package works with. */

export interface ParsedEmail {
  message: EmailMessage;
  /** Message-ID of the delivered message (idempotency key). */
  messageId: string | null;
  /** Date header of the delivered message, ISO-8601, when it parses. */
  date: string | null;
}

function formatAddress(a: Address | undefined): string {
  if (!a) return '';
  const box = 'group' in a && a.group ? a.group[0] : a;
  if (!box?.address) return box?.name ?? '';
  return box.name ? `${box.name} <${box.address}>` : box.address;
}

function toMessage(email: Email): EmailMessage {
  const headers: Record<string, string> = {};
  for (const h of email.headers) if (!(h.key in headers)) headers[h.key] = h.value;
  return {
    from: formatAddress(email.from),
    to: email.to?.map(formatAddress).join(', ') ?? null,
    subject: email.subject ?? '',
    text: email.text ?? null,
    html: email.html ?? null,
    date: toIso(email.date ?? null) ?? email.date ?? null,
    headers,
  };
}

/**
 * Parse a raw message. A message whose only content is an attached original ("forward as
 * attachment" in Outlook) is replaced by that original; the delivered Message-ID is kept.
 */
export async function parseRawEmail(raw: string | ArrayBuffer | Uint8Array): Promise<ParsedEmail> {
  const outer = await PostalMime.parse(raw);
  let email = outer;
  const attached = outer.attachments.find((a) => a.mimeType === 'message/rfc822');
  if (attached) {
    try {
      email = await PostalMime.parse(attached.content);
    } catch {
      email = outer;
    }
  }
  return {
    message: toMessage(email),
    messageId: outer.messageId?.trim() || null,
    date: toIso(outer.date ?? null),
  };
}
