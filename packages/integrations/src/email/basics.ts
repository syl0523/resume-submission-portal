import { htmlToText } from '../text';
import type { EmailAddress, EmailMessage } from './types';

/**
 * Parse `"Name" <addr@host>` or `addr@host` into its parts. Address is lower-cased.
 * Index scans instead of one big regex: the From header comes from whoever sends the email, and
 * a padded value must not cost more than a quick pass.
 */
export function parseAddress(from: string): EmailAddress {
  // Real From values are short; anything past the first 1,000 characters is junk.
  const value = from.slice(0, 1000).trim();
  const open = value.lastIndexOf('<');
  const close = open >= 0 ? value.indexOf('>', open + 1) : -1;
  if (close > open && !value.slice(close + 1).trim()) {
    const address = value
      .slice(open + 1, close)
      .trim()
      .toLowerCase();
    if (address) {
      const name = value
        .slice(0, open)
        .trim()
        .replace(/^["“']+/, '')
        .replace(/["”']+$/, '');
      return { name: name.trim() || null, address };
    }
  }
  const bare = /[^\s<>"]+@[^\s<>"]+/.exec(value)?.[0];
  return { name: null, address: (bare ?? value).toLowerCase() };
}

/** Best plain-text body: the text part, else the HTML part converted to text. */
export function emailBodyText(msg: EmailMessage): string {
  if (msg.text?.trim()) return msg.text;
  if (msg.html?.trim()) return htmlToText(msg.html);
  return '';
}

/** Domain of an address, lower-cased ("" when there is none). */
export function domainOf(address: string): string {
  return address.split('@')[1]?.trim().toLowerCase() ?? '';
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export function monthNumber(name: string): number | null {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? null;
}

/**
 * Normalise the date strings mail clients write into forward headers to ISO-8601 UTC:
 * "Mon, Oct 6, 2026 at 9:14 AM", "October 6, 2026 at 9:14:03 AM EDT", RFC 2822,
 * "2026年10月6日 9:14", "2026年10月6日周一 下午2:30". Times without a zone are read as UTC.
 */
export function normalizeEmailDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  const zh =
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^\d上下]*(上午|下午|晚上|凌晨)?\s*(\d{1,2})?[:：]?(\d{2})?/.exec(
      s,
    );
  if (zh) {
    const [, y, mo, d, half, h, mi] = zh;
    let hour = Number(h ?? 0);
    if ((half === '下午' || half === '晚上') && hour < 12) hour += 12;
    const iso = `${y}-${pad(Number(mo))}-${pad(Number(d))}T${pad(hour)}:${pad(Number(mi ?? 0))}:00Z`;
    return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
  }
  const cleaned = s
    .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '')
    .replace(/\s+at\s+/i, ' ')
    .replace(/\s+\([^)]*\)\s*$/, '');
  // No zone written: read it as UTC (the Workers clock) rather than the machine's local time.
  const hasZone = /([+-]\d{2}:?\d{2}|\b(utc|gmt|z|[ecmp][sd]t)\b)\s*$/i.test(cleaned);
  for (const candidate of [hasZone ? cleaned : `${cleaned} UTC`, s]) {
    const t = Date.parse(candidate);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
