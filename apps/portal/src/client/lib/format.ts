import type { ApplyChannel, JobSource, RemoteType } from '@jsp/core';

const DAY = 86_400_000;

export function formatDate(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...opts,
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "today", "yesterday", "3 days ago", "in 2 days", else a date. */
export function relativeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const startOf = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(t) - startOf(now.getTime())) / DAY);
  if (days === 0) return 'today';
  if (days === -1) return 'yesterday';
  if (days === 1) return 'tomorrow';
  if (days < 0 && days > -14) return `${-days} days ago`;
  if (days > 0 && days < 14) return `in ${days} days`;
  return formatDate(iso);
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatSalary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
      notation: n >= 100_000 ? 'compact' : 'standard',
    }).format(n);
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt((min ?? max) as number);
}

export const SOURCE_LABEL: Record<JobSource, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  smartrecruiters: 'SmartRecruiters',
  adzuna: 'Adzuna',
  usajobs: 'USAJOBS',
  company_site: 'Company site',
  email: 'Email',
  manual: 'Added by hand',
  other: 'Other',
};

export const REMOTE_LABEL: Record<RemoteType, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  unknown: 'Unknown',
};

export const CHANNEL_LABEL: Record<ApplyChannel, string> = {
  linkedin_easy_apply: 'LinkedIn Easy Apply',
  indeed_apply: 'Indeed Apply',
  company_site: 'Company site',
  email: 'Email',
  referral: 'Referral',
  recruiter: 'Recruiter',
  other: 'Other',
};

/** ISO → value for <input type="date">. */
export function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** <input type="date"> value → ISO at local noon (stable across time zones), or null. */
export function fromDateInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → value for <input type="datetime-local">. */
export function toDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateTimeInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const STATE_CODES = new Set(
  (
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY'
  ).split(' '),
);
const STATE_NAMES = new Set(
  (
    'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|district of columbia|' +
    'florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|' +
    'massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|' +
    'new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|' +
    'puerto rico|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|' +
    'washington|west virginia|wisconsin|wyoming'
  ).split('|'),
);
const COUNTRY = /^(usa|us|u\.s\.a?\.?|united states( of america)?)$/i;
const isStateCode = (token: string) => token.length === 2 && STATE_CODES.has(token.toUpperCase());
const isStateName = (token: string) => STATE_NAMES.has(token.toLowerCase());

/**
 * Places typed into one box: "New York, NY, Remote" ⇄ ["New York, NY", "Remote"]. Commas inside a
 * place are kept by joining a state (code or name) or country onto the city before it; semicolons
 * and new lines always separate places. Shown back joined with "; " so editing round-trips.
 */
export function splitLocations(value: string): string[] {
  const places: string[] = [];
  for (const segment of value.split(/[;\n]/)) {
    let place: string[] = [];
    for (const raw of segment.split(',')) {
      const token = raw.trim();
      if (!token) continue;
      const prev = place[place.length - 1];
      // "New York, NY" and "Austin, Texas" are one place; "NY, NJ" and "Texas, California" are two.
      const joinsPrev =
        prev !== undefined &&
        (COUNTRY.test(token) ||
          (isStateCode(token) && !isStateCode(prev) && !COUNTRY.test(prev)) ||
          (isStateName(token) && !isStateCode(prev) && !isStateName(prev) && !COUNTRY.test(prev)));
      if (joinsPrev) {
        place.push(token);
      } else {
        if (place.length > 0) places.push(place.join(', '));
        place = [token];
      }
    }
    if (place.length > 0) places.push(place.join(', '));
  }
  return places;
}

/** "a, b, c" ⇄ ["a", "b", "c"] for comma-separated list inputs. */
export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
