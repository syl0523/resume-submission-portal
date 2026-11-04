import type { ImportParseResult } from '@jsp/core';

export type CsvFormat = 'linkedin' | 'generic';

/**
 * Guess the format from the header row.
 * TODO(integrations agent): implement (LinkedIn's "Job Applications.csv" has
 * "Application Date", "Company Name", "Job Title", "Job Url", "Resume Name").
 */
export function detectCsvFormat(csv: string): CsvFormat {
  void csv;
  return 'generic';
}

/**
 * Parse LinkedIn's data export ("Get a copy of your data" > Job Applications).
 * TODO(integrations agent): implement.
 */
export function parseLinkedInApplicationsCsv(csv: string): ImportParseResult {
  void csv;
  return { rows: [], errors: [{ row: 0, message: 'LinkedIn import is not implemented yet' }] };
}

/**
 * Parse a spreadsheet-style tracker (Company, Title/Position, URL/Link, Date Applied, Status, Notes).
 * TODO(integrations agent): implement with flexible header matching.
 */
export function parseApplicationsCsv(csv: string): ImportParseResult {
  void csv;
  return { rows: [], errors: [{ row: 0, message: 'CSV import is not implemented yet' }] };
}
