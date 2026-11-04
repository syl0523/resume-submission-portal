import { describe, expect, it } from 'vitest';
import { detectCsvFormat, parseImportCsv, parseLooseDate, parseStatus } from './index';

// Synthetic exports: fictional companies, made-up job ids.

const LINKEDIN = `Application Date,Contact Email,Contact Phone Number,Company Name,Job Title,Job Url,Resume Name,Question And Answers
"10/23/26, 3:15 PM",jane.doe@example.com,,Northwind Freight,HR Generalist,https://www.linkedin.com/jobs/view/4012345678/,Jane Doe HR.pdf,
"10/24/26, 9:02 AM",jane.doe@example.com,,"Contoso, Ltd.",People Operations Manager,https://www.linkedin.com/jobs/view/4012345679/,Jane Doe HR.pdf,"Q: Years of experience?
A: 6"
"10/25/26, 11:00 AM",jane.doe@example.com,,,Missing Company,https://www.linkedin.com/jobs/view/4012345680/,,
`;

const TRACKER = `﻿Company,Position,Link,Date Applied,Status,Notes,Location
Fabrikam,Recruiter,https://jobs.lever.co/fabrikam/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab,2026-10-02,Phone screen done,"Spoke with ""Sam""",Remote
Tailspin Toys,Payroll Specialist,,Oct 5 2026,Rejected,,Dallas TX
Litware,Talent Partner,not a url,,Wishlist,,
,Office Manager,,10/7/2026,Applied,,
Proseware,HR Business Partner,,10/8/26,Interviewing,,Austin
`;

describe('import parsers', () => {
  it('detects LinkedIn exports by their header row', () => {
    expect(detectCsvFormat(LINKEDIN)).toBe('linkedin');
    expect(detectCsvFormat(TRACKER)).toBe('generic');
  });

  it('parses the LinkedIn export, multi-line cells included, with row-level errors', () => {
    const result = parseImportCsv(LINKEDIN);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      status: 'applied',
      appliedAt: '2026-10-23T15:15:00.000Z',
      appliedVia: 'linkedin_easy_apply',
      resumeName: 'Jane Doe HR.pdf',
      job: {
        company: 'Northwind Freight',
        title: 'HR Generalist',
        source: 'linkedin',
        url: 'https://www.linkedin.com/jobs/view/4012345678/',
      },
    });
    expect(result.rows[1]?.job.company).toBe('Contoso, Ltd.');
    expect(result.errors).toEqual([{ row: 4, message: 'Missing company name or job title' }]);
  });

  it('parses tracker spreadsheets with flexible headers, statuses and dates', () => {
    const result = parseImportCsv(TRACKER, 'auto');
    expect(result.rows.map((r) => [r.job.company, r.status, r.appliedAt])).toEqual([
      ['Fabrikam', 'screening', '2026-10-02T12:00:00.000Z'],
      ['Tailspin Toys', 'rejected', '2026-10-05T12:00:00.000Z'],
      ['Litware', 'saved', null],
      ['Proseware', 'interview', '2026-10-08T12:00:00.000Z'],
    ]);
    expect(result.rows[0]?.job).toMatchObject({ source: 'lever', location: 'Remote' });
    expect(result.rows[0]?.notes).toBe('Spoke with "Sam"');
    expect(result.rows[2]?.job.url).toBeNull();
    expect(result.errors).toEqual([{ row: 5, message: 'Missing company' }]);
  });

  it('explains a file without the needed columns', () => {
    const result = parseImportCsv('Name,Amount\nx,1\n', 'generic');
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/no company or title column/);
  });

  it('reads loose dates and statuses', () => {
    expect(parseLooseDate('2026年10月6日')).toBe('2026-10-06T12:00:00.000Z');
    expect(parseLooseDate('6 Oct 2026')).toBe('2026-10-06T12:00:00.000Z');
    expect(parseLooseDate('46301')).toBe('2026-10-06T12:00:00.000Z');
    expect(parseLooseDate('2/30/2026')).toBeNull();
    expect(parseLooseDate('soon')).toBeNull();
    expect(parseStatus('Got an offer!')).toBe('offer');
    expect(parseStatus('No response')).toBe('ghosted');
    expect(parseStatus('已投递')).toBe('applied');
    expect(parseStatus('???')).toBeNull();
  });
});
