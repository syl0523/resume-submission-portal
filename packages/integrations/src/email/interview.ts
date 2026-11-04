import { monthNumber } from './basics';

/**
 * Find an interview time in an email ("Tuesday, November 12 at 2:00 PM ET",
 * "Nov 12, 2026, 2:00 – 2:45 PM (EST)", "11/12/2026 at 10:30 AM PT", "2026年11月12日 下午2:00 北京时间").
 * Returns ISO-8601 UTC, or null when no time with a time zone is stated: a calendar entry at
 * the wrong hour is worse than none.
 */

const ZONES: Record<string, number | 'us-eastern' | 'us-central' | 'us-mountain' | 'us-pacific'> = {
  utc: 0,
  gmt: 0,
  z: 0,
  est: -5,
  edt: -4,
  et: 'us-eastern',
  eastern: 'us-eastern',
  cst: -6,
  cdt: -5,
  ct: 'us-central',
  central: 'us-central',
  mst: -7,
  mdt: -6,
  mt: 'us-mountain',
  mountain: 'us-mountain',
  pst: -8,
  pdt: -7,
  pt: 'us-pacific',
  pacific: 'us-pacific',
  hst: -10,
  akst: -9,
  akdt: -8,
  bst: 1,
  cet: 1,
  cest: 2,
};

const US_STANDARD = { 'us-eastern': -5, 'us-central': -6, 'us-mountain': -7, 'us-pacific': -8 };

/** US daylight saving: second Sunday of March 2:00 to first Sunday of November 2:00 (local). */
function usDst(year: number, month: number, day: number): boolean {
  const nthSunday = (m: number, n: number) => {
    const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const start = nthSunday(3, 2);
  const end = nthSunday(11, 1);
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  return month === 3 ? day >= start : day < end;
}

function offsetHours(zone: string, y: number, m: number, d: number): number | null {
  const z = zone.toLowerCase().replace(/\./g, '');
  const numeric = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(z);
  if (numeric) {
    const sign = numeric[1] === '-' ? -1 : 1;
    return sign * (Number(numeric[2]) + Number(numeric[3] ?? 0) / 60);
  }
  const known = ZONES[z];
  if (known === undefined) return null;
  if (typeof known === 'number') return known;
  return US_STANDARD[known] + (usDst(y, m, d) ? 1 : 0);
}

function toIso(y: number, m: number, d: number, hour: number, minute: number, offset: number) {
  const t = Date.UTC(y, m - 1, d, hour, minute) - offset * 3_600_000;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function hour24(h: number, half: string | undefined): number {
  const pm = half ? /^p/i.test(half) : false;
  const am = half ? /^a/i.test(half) : false;
  if (pm && h < 12) return h + 12;
  if (am && h === 12) return 0;
  return h;
}

/** Year for a date written without one: the next occurrence on or after (reference - 30 days). */
function inferYear(m: number, d: number, reference: Date): number {
  const y = reference.getUTCFullYear();
  const candidate = Date.UTC(y, m - 1, d);
  return candidate < reference.getTime() - 30 * 86_400_000 ? y + 1 : y;
}

const ZONE_PATTERN =
  '\\(?\\s*((?:utc|gmt)\\s*[+-]\\s*\\d{1,2}(?::?\\d{2})?|[a-z]{1,4}t|eastern|central|mountain|pacific|utc|gmt)\\b';

const MONTH_DATE = new RegExp(
  '(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?' +
    '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?' +
    '(?:,?\\s+(\\d{4}))?' +
    '(?:\\s*,|\\s+at|\\s+@|\\s+from|\\s*[-–|·])?\\s+' +
    '(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?' +
    '(?:\\s*[-–]\\s*\\d{1,2}(?::\\d{2})?\\s*(a\\.?m\\.?|p\\.?m\\.?)?)?' +
    `\\s*${ZONE_PATTERN}`,
  'i',
);

const NUMERIC_DATE = new RegExp(
  '(\\d{1,2})/(\\d{1,2})/(\\d{2,4})(?:\\s*,|\\s+at|\\s+@)?\\s+' +
    '(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?' +
    '(?:\\s*[-–]\\s*\\d{1,2}(?::\\d{2})?\\s*(a\\.?m\\.?|p\\.?m\\.?)?)?' +
    `\\s*${ZONE_PATTERN}`,
  'i',
);

const CHINESE_DATE =
  /(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^\d上下]{0,8}(上午|下午|晚上)?\s*(\d{1,2})[:：](\d{2})[^\n]{0,12}?(北京时间|北京時間)/;

export function parseInterviewTime(text: string, referenceIso?: string | null): string | null {
  const reference = referenceIso ? new Date(referenceIso) : new Date();
  const ref = Number.isNaN(reference.getTime()) ? new Date() : reference;

  const named = MONTH_DATE.exec(text);
  if (named) {
    const [, mon, day, year, h, mi, startHalf, endHalf, zone] = named;
    const half = startHalf ?? endHalf;
    const m = monthNumber(mon ?? '');
    const d = Number(day);
    if (m && zone && (half || Number(h) > 12 || mi)) {
      const y = year ? Number(year) : inferYear(m, d, ref);
      const off = offsetHours(zone, y, m, d);
      if (off !== null) return toIso(y, m, d, hour24(Number(h), half), Number(mi ?? 0), off);
    }
  }

  const numeric = NUMERIC_DATE.exec(text);
  if (numeric) {
    const [, mo, day, year, h, mi, startHalf, endHalf, zone] = numeric;
    const half = startHalf ?? endHalf;
    const m = Number(mo);
    const d = Number(day);
    let y = Number(year);
    if (y < 100) y += 2000;
    if (zone && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const off = offsetHours(zone, y, m, d);
      if (off !== null) return toIso(y, m, d, hour24(Number(h), half), Number(mi ?? 0), off);
    }
  }

  const zh = CHINESE_DATE.exec(text);
  if (zh) {
    const [, year, mo, day, half, h, mi] = zh;
    const m = Number(mo);
    const d = Number(day);
    const y = year ? Number(year) : inferYear(m, d, ref);
    let hour = Number(h);
    if ((half === '下午' || half === '晚上') && hour < 12) hour += 12;
    return toIso(y, m, d, hour, Number(mi), 8);
  }
  return null;
}
