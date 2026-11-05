/** Minimal RFC 5545 writer for the private calendar feed. */

export type IcsEvent =
  | {
      uid: string;
      summary: string;
      description?: string;
      url?: string;
      start: string;
      minutes: number;
    }
  | { uid: string; summary: string; description?: string; url?: string; date: string };

/** Escape TEXT values: backslash, semicolon, comma and line breaks (CRLF, LF or a lone CR). */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold content lines longer than 75 octets (UTF-8), never splitting a character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** 2026-11-17T19:00:00.000Z → 20261117T190000Z */
export function icsDateTime(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function icsDate(iso: string, plusDays = 0): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function buildCalendar(
  name: string,
  events: IcsEvent[],
  now = new Date().toISOString(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Resume Submission Portal//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsDateTime(now)}`);
    if ('start' in e) {
      const end = new Date(Date.parse(e.start) + e.minutes * 60_000).toISOString();
      lines.push(`DTSTART:${icsDateTime(e.start)}`, `DTEND:${icsDateTime(end)}`);
    } else {
      lines.push(
        `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
        `DTEND;VALUE=DATE:${icsDate(e.date, 1)}`,
        'TRANSP:TRANSPARENT',
      );
    }
    lines.push(`SUMMARY:${icsText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
