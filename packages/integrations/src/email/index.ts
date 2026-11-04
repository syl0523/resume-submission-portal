import type { EmailClassification } from '@jsp/core';
import { htmlToText } from '../text';
import type { EmailAddress, EmailMessage } from './types';

export type { EmailAddress, EmailMessage } from './types';

/** Parse `"Name" <addr@host>` or `addr@host` into its parts. Address is lower-cased. */
export function parseAddress(from: string): EmailAddress {
  const angle = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (angle?.[2]) {
    const name = angle[1]?.trim() || null;
    return { name, address: angle[2].trim().toLowerCase() };
  }
  const bare = /[^\s<>"]+@[^\s<>"]+/.exec(from)?.[0];
  return { name: null, address: (bare ?? from).trim().toLowerCase() };
}

/** Best plain-text body: the text part, else the HTML part converted to text. */
export function emailBodyText(msg: EmailMessage): string {
  if (msg.text?.trim()) return msg.text;
  if (msg.html?.trim()) return htmlToText(msg.html);
  return '';
}

/**
 * If the message is a manual forward ("FW:"/"Fwd:" with an inline original header block),
 * return the original message (original From, Subject and body). Otherwise return the input.
 *
 * TODO(integrations agent): implement. Must handle Outlook/Hotmail, Gmail and Apple Mail
 * forward formats, in English and Chinese clients ("发件人:", "主题:").
 */
export function unwrapForwarded(msg: EmailMessage): EmailMessage {
  return msg;
}

/**
 * Classify an application-related email: who sent it (provider), what it means (kind),
 * and which company / job it is about.
 *
 * TODO(integrations agent): implement provider rules (LinkedIn, Indeed, Greenhouse, Lever,
 * Ashby, Workday, SmartRecruiters, iCIMS, Taleo, SuccessFactors) plus a generic keyword
 * classifier. The placeholder below returns an "other" result with zero confidence.
 */
export function classifyEmail(msg: EmailMessage): EmailClassification {
  void msg;
  return {
    provider: 'generic',
    kind: 'other',
    company: null,
    jobTitle: null,
    jobUrl: null,
    externalJobId: null,
    interviewAt: null,
    confidence: 0,
    signals: ['placeholder'],
  };
}
