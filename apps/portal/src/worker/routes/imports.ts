import type { ImportResult } from '@jsp/core';
import { parseImportCsv } from '@jsp/integrations';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { HttpError } from '../lib/errors';
import { importApplications } from '../services/imports';

/** LinkedIn data export / tracker CSV import (KAN-23). Mounted at /api/imports. */

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const FORMATS: ReadonlySet<string> = new Set(['auto', 'linkedin', 'generic']);
const isFormat = (v: string): v is 'auto' | 'linkedin' | 'generic' => FORMATS.has(v);

export const importRoutes = new Hono<AppEnv>().post('/', async (c) => {
  if (!/^multipart\/form-data/i.test(c.req.header('content-type') ?? '')) {
    throw new HttpError(
      415,
      'unsupported_media_type',
      'Upload the CSV file as multipart/form-data',
    );
  }
  if (Number(c.req.header('content-length') ?? 0) > MAX_CSV_BYTES + 64 * 1024) {
    throw new HttpError(413, 'payload_too_large', 'CSV files can be at most 2 MB');
  }
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File))
    throw new HttpError(400, 'invalid_request', 'Attach the CSV file as "file"');
  if (file.size > MAX_CSV_BYTES)
    throw new HttpError(413, 'payload_too_large', 'CSV files can be at most 2 MB');
  // Windows reports CSV as application/vnd.ms-excel; trust the extension when the type is vague.
  const looksCsv = /\.(csv|txt)$/i.test(file.name) || /csv|text\/plain/i.test(file.type);
  if (!looksCsv) {
    throw new HttpError(
      415,
      'unsupported_media_type',
      'Upload a .csv file (save the spreadsheet as CSV first)',
    );
  }
  const requested = typeof form.format === 'string' ? form.format : 'auto';
  if (!isFormat(requested)) {
    throw new HttpError(400, 'invalid_request', 'format must be auto, linkedin or generic');
  }

  const parsed = parseImportCsv(await file.text(), requested);
  const label =
    /linkedin/i.test(file.name) || parsed.rows.every((r) => r.appliedVia === 'linkedin_easy_apply')
      ? 'Imported from LinkedIn'
      : 'Imported from a spreadsheet';
  const result: ImportResult =
    parsed.rows.length > 0
      ? await importApplications(c.var.db, c.env, c.var.user.id, parsed.rows, label)
      : { created: 0, updated: 0, skipped: 0, errors: [] };
  result.errors = [...parsed.errors, ...result.errors];
  return c.json(result);
});
