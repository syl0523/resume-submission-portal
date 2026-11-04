/** RFC 4180 CSV for downloads (CRLF line ends, quotes doubled). */

export type CsvCell = string | number | boolean | null | undefined;

/** Text that a spreadsheet would run as a formula when the file is opened. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Neutralise formula injection from job text (a title like "=HYPERLINK(...)").
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly CsvCell[][]): string {
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
