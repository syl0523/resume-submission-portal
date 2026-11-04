import {
  type ApplicationStatus,
  type ImportedApplication,
  type ImportParseResult,
  JOB_SOURCES,
  type JobSource,
  jobInputSchema,
} from '@jsp/core';
import Papa from 'papaparse';
import { monthNumber } from '../email/basics';
import { normalizeForCompare } from '../text';
import { analyzeJobUrl } from '../url';

/**
 * Import parsers (KAN-23): LinkedIn's data export ("Job Applications.csv") and any tracker
 * spreadsheet saved as CSV. Row problems become errors; the rest of the file still imports.
 * Row numbers are spreadsheet rows (the header is row 1).
 */

export type CsvFormat = 'linkedin' | 'generic';

export const MAX_IMPORT_ROWS = 2000;

function readRows(csv: string): string[][] {
  const parsed = Papa.parse<string[]>(csv.replace(/^﻿/, ''), {
    header: false,
    skipEmptyLines: 'greedy',
  });
  return parsed.data.map((row) => row.map((cell) => (cell ?? '').trim()));
}

const key = (header: string) => normalizeForCompare(header).replace(/ /g, '');

/** Guess the format from the header row. */
export function detectCsvFormat(csv: string): CsvFormat {
  const header = (readRows(csv.split(/\r?\n/, 1)[0] ?? '')[0] ?? []).map(key);
  const has = (h: string) => header.includes(h);
  return has('companyname') && has('jobtitle') && (has('applicationdate') || has('joburl'))
    ? 'linkedin'
    : 'generic';
}

/**
 * Dates as people and exports write them: 2026-10-06, 10/6/2026, 10/6/26, "10/23/24, 3:15 PM",
 * "Oct 6, 2026", "6 Oct 2026", 2026年10月6日, or an Excel serial day. Date-only values are pinned
 * to 12:00 UTC so the calendar day survives every US time zone.
 */
export function parseLooseDate(input: string | null | undefined): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  const at = (y: number, m: number, d: number, h = 12, mi = 0) => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    const t = Date.UTC(y, m - 1, d, h, mi);
    const date = new Date(t);
    return date.getUTCDate() === d ? date.toISOString() : null;
  };
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(s);
  if (iso)
    return at(
      +(iso[1] ?? 0),
      +(iso[2] ?? 0),
      +(iso[3] ?? 0),
      iso[4] ? +iso[4] : 12,
      iso[5] ? +iso[5] : 0,
    );
  const us =
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?)?$/i.exec(
      s,
    );
  if (us) {
    let y = +(us[3] ?? 0);
    if (y < 100) y += 2000;
    let h = us[4] ? +us[4] : 12;
    if (us[6] && /^p/i.test(us[6]) && h < 12) h += 12;
    if (us[6] && /^a/i.test(us[6]) && h === 12) h = 0;
    return at(y, +(us[1] ?? 0), +(us[2] ?? 0), h, us[5] ? +us[5] : 0);
  }
  const zh = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(s);
  if (zh) return at(+(zh[1] ?? 0), +(zh[2] ?? 0), +(zh[3] ?? 0));
  const mdy = /^(?:[a-z]+,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
  if (mdy) {
    const m = monthNumber(mdy[1] ?? '');
    if (m) return at(+(mdy[3] ?? 0), m, +(mdy[2] ?? 0));
  }
  const dmy = /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i.exec(s);
  if (dmy) {
    const m = monthNumber(dmy[2] ?? '');
    if (m) return at(+(dmy[3] ?? 0), m, +(dmy[1] ?? 0));
  }
  if (/^\d{5}$/.test(s)) {
    const serial = +s;
    if (serial > 30_000 && serial < 70_000) {
      return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000 + 12 * 3_600_000).toISOString();
    }
  }
  return null;
}

const STATUS_WORDS: [ApplicationStatus, RegExp][] = [
  ['withdrawn', /withdr[ae]w|withdrawn|撤回/i],
  [
    'rejected',
    /reject|declin|not selected|not moving|unsuccessful|turned down|^no$|closed|拒|未通过|不合适/i,
  ],
  ['offer', /offer|accepted|hired|录用/i],
  ['interview', /interview|onsite|on-site|final round|面试/i],
  ['screening', /screen|recruiter call|phone call|assessment|test|笔试|测评/i],
  ['ghosted', /ghost|no (response|reply|answer)|无回复/i],
  ['viewed', /viewed|seen|reviewed|查看/i],
  ['applied', /appl(ied|ication sent)|submitted|sent|已申请|已投递|投递/i],
  ['saved', /saved|wish|interested|bookmark|to apply|planned|draft|收藏/i],
];

/** Free-text status from a spreadsheet → pipeline status (null when unrecognised). */
export function parseStatus(input: string | null | undefined): ApplicationStatus | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  for (const [status, re] of STATUS_WORDS) if (re.test(s)) return status;
  return null;
}

const SOURCE_WORDS: Record<string, JobSource> = {
  linkedin: 'linkedin',
  indeed: 'indeed',
  greenhouse: 'greenhouse',
  lever: 'lever',
  ashby: 'ashby',
  workday: 'workday',
  smartrecruiters: 'smartrecruiters',
  adzuna: 'adzuna',
  usajobs: 'usajobs',
  companysite: 'company_site',
  companywebsite: 'company_site',
  website: 'company_site',
  careerspage: 'company_site',
  email: 'email',
  referral: 'other',
};

function parseSource(input: string | null, url: string | null): JobSource {
  const fromText = input ? SOURCE_WORDS[key(input)] : undefined;
  if (fromText) return fromText;
  if (input && (JOB_SOURCES as readonly string[]).includes(input.toLowerCase())) {
    return input.toLowerCase() as JobSource;
  }
  return url ? (analyzeJobUrl(url)?.source ?? 'manual') : 'manual';
}

type Field =
  | 'company'
  | 'title'
  | 'url'
  | 'appliedAt'
  | 'status'
  | 'notes'
  | 'location'
  | 'source'
  | 'resume';

const HEADER_ALIASES: Record<Field, string[]> = {
  company: [
    'company',
    'companyname',
    'employer',
    'organization',
    'organisation',
    'org',
    '公司',
    '公司名称',
  ],
  title: [
    'title',
    'jobtitle',
    'position',
    'role',
    'job',
    'jobname',
    'positiontitle',
    '职位',
    '岗位',
    '职位名称',
  ],
  url: [
    'url',
    'link',
    'joburl',
    'joblink',
    'posting',
    'postingurl',
    'jobposting',
    'applicationlink',
    '链接',
    '网址',
  ],
  appliedAt: [
    'dateapplied',
    'applied',
    'appliedon',
    'applieddate',
    'applicationdate',
    'date',
    'submitted',
    '申请日期',
    '投递日期',
    '日期',
  ],
  status: ['status', 'stage', 'state', 'outcome', 'result', '状态', '进度'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', '备注'],
  location: ['location', 'city', 'place', '地点', '城市'],
  source: ['source', 'site', 'board', 'platform', 'appliedvia', 'channel', '来源', '渠道'],
  resume: ['resume', 'resumename', 'cv', 'resumeversion', '简历'],
};

function mapHeader(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const k = key(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
      if (out[field] === undefined && aliases.includes(k)) out[field] = i;
    }
  });
  return out;
}

interface RowInput {
  company: string;
  title: string;
  url: string | null;
  appliedAt: string | null;
  status: ApplicationStatus;
  notes: string | null;
  location: string | null;
  source: JobSource;
  resumeName: string | null;
  appliedVia: ImportedApplication['appliedVia'];
}

function toImported(input: RowInput): ImportedApplication {
  const url = input.url && analyzeJobUrl(input.url) ? input.url : null;
  const job = jobInputSchema.parse({
    title: input.title.slice(0, 300),
    company: input.company.slice(0, 200),
    url,
    source: input.source,
    location: input.location?.slice(0, 200) ?? null,
  });
  return {
    job,
    status: input.status,
    appliedAt: input.appliedAt,
    appliedVia: input.appliedVia,
    resumeName: input.resumeName,
    notes: input.notes?.slice(0, 20_000) ?? null,
  };
}

function parseWith(
  csv: string,
  build: (cells: (f: Field) => string | null) => RowInput | string,
  required: Field[],
  formatName: string,
): ImportParseResult {
  const rows = readRows(csv);
  const [header, ...data] = rows;
  if (!header) return { rows: [], errors: [{ row: 1, message: 'The file is empty' }] };
  const columns = mapHeader(header);
  const missing = required.filter((f) => columns[f] === undefined);
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message: `This does not look like a ${formatName}: no ${missing.join(' or ')} column`,
        },
      ],
    };
  }
  const out: ImportParseResult = { rows: [], errors: [] };
  data.slice(0, MAX_IMPORT_ROWS).forEach((cells, i) => {
    const rowNumber = i + 2;
    const cell = (f: Field) => {
      const index = columns[f];
      const v = index === undefined ? '' : (cells[index] ?? '');
      return v.trim() || null;
    };
    try {
      const built = build(cell);
      if (typeof built === 'string') out.errors.push({ row: rowNumber, message: built });
      else out.rows.push(toImported(built));
    } catch {
      out.errors.push({ row: rowNumber, message: 'Could not read this row' });
    }
  });
  if (data.length > MAX_IMPORT_ROWS) {
    out.errors.push({
      row: MAX_IMPORT_ROWS + 2,
      message: `Only the first ${MAX_IMPORT_ROWS} rows are imported; split the file for the rest`,
    });
  }
  return out;
}

/** Parse LinkedIn's data export ("Get a copy of your data" > Job Applications). */
export function parseLinkedInApplicationsCsv(csv: string): ImportParseResult {
  return parseWith(
    csv,
    (cell) => {
      const company = cell('company');
      const title = cell('title');
      if (!company || !title) return 'Missing company name or job title';
      const appliedAt = parseLooseDate(cell('appliedAt'));
      return {
        company,
        title,
        url: cell('url'),
        appliedAt,
        status: 'applied',
        notes: null,
        location: null,
        source: 'linkedin',
        resumeName: cell('resume'),
        appliedVia: 'linkedin_easy_apply',
      };
    },
    ['company', 'title'],
    'LinkedIn applications export',
  );
}

/** Parse a spreadsheet-style tracker with flexible headers. */
export function parseApplicationsCsv(csv: string): ImportParseResult {
  return parseWith(
    csv,
    (cell) => {
      const company = cell('company');
      const title = cell('title');
      if (!company && !title) return 'Missing company and title';
      if (!company) return 'Missing company';
      if (!title) return 'Missing job title';
      const rawDate = cell('appliedAt');
      const appliedAt = parseLooseDate(rawDate);
      const url = cell('url');
      const status = parseStatus(cell('status')) ?? (appliedAt ? 'applied' : 'saved');
      const source = parseSource(cell('source'), url);
      return {
        company,
        title,
        url,
        appliedAt: status === 'saved' ? null : appliedAt,
        status,
        notes: cell('notes'),
        location: cell('location'),
        source,
        resumeName: cell('resume'),
        appliedVia:
          status === 'saved'
            ? null
            : source === 'linkedin'
              ? 'linkedin_easy_apply'
              : source === 'indeed'
                ? 'indeed_apply'
                : null,
      };
    },
    ['company', 'title'],
    'job tracker spreadsheet',
  );
}

/** Parse with an explicit format, or detect it from the header row. */
export function parseImportCsv(
  csv: string,
  format: CsvFormat | 'auto' = 'auto',
): ImportParseResult {
  const chosen = format === 'auto' ? detectCsvFormat(csv) : format;
  return chosen === 'linkedin' ? parseLinkedInApplicationsCsv(csv) : parseApplicationsCsv(csv);
}
