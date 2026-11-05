import type {
  ApiErrorBody,
  ApplicationDetail,
  ApplicationListItem,
  ImportResult,
  ListResponse,
  Resume,
} from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

const LINKEDIN = `Application Date,Contact Email,Contact Phone Number,Company Name,Job Title,Job Url,Resume Name,Question And Answers
"10/23/26, 3:15 PM",jane.doe@example.com,,Northwind Freight,HR Generalist,https://www.linkedin.com/jobs/view/4012345678/,jane-hr.pdf,
"10/24/26, 9:02 AM",jane.doe@example.com,,Contoso,People Operations Manager,https://www.linkedin.com/jobs/view/4012345679/,,
"10/25/26, 11:00 AM",jane.doe@example.com,,,Missing Company,,,
`;

const TRACKER = `Company,Position,Link,Date Applied,Status
Contoso,People Operations Manager,https://www.linkedin.com/jobs/view/4012345679/?trk=x,10/24/2026,Interviewing
Fabrikam,Recruiter,,10/02/2026,Applied
Fabrikam,Recruiter,,10/02/2026,Applied
`;

function upload(csv: string, name: string, extra: Record<string, string> = {}): RequestInit {
  const form = new FormData();
  form.set('file', new File([csv], name, { type: 'application/vnd.ms-excel' }));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return { method: 'POST', body: form };
}

describe('imports API', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
    const form = new FormData();
    form.set('file', new File(['%PDF-1.7'], 'jane-hr.pdf', { type: 'application/pdf' }));
    await t.json<Resume>('/api/resumes', { method: 'POST', body: form });
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('imports a LinkedIn export, linking the resume by name', async () => {
    const { status, body } = await t.json<ImportResult>(
      '/api/imports',
      upload(LINKEDIN, 'Job Applications.csv'),
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      created: 2,
      updated: 0,
      skipped: 0,
      errors: [{ row: 4, message: 'Missing company name or job title' }],
    });
    const list = await t.json<ListResponse<ApplicationListItem>>('/api/applications?q=Northwind');
    const app = list.body.items[0];
    expect(app).toMatchObject({
      status: 'applied',
      appliedAt: '2026-10-23T15:15:00.000Z',
      appliedVia: 'linkedin_easy_apply',
    });
    expect(app?.resumeId).not.toBeNull();
    const detail = await t.json<ApplicationDetail>(`/api/applications/${app?.id}`);
    expect(detail.body.job.capturedVia).toBe('import');
    expect(detail.body.events[0]).toMatchObject({
      type: 'import',
      source: 'import',
      summary: 'Imported from LinkedIn',
    });
  });

  it('skips rows it already has and moves matches forward', async () => {
    const again = await t.json<ImportResult>(
      '/api/imports',
      upload(LINKEDIN, 'Job Applications.csv'),
    );
    expect(again.body).toMatchObject({ created: 0, updated: 0, skipped: 2 });

    const tracker = await t.json<ImportResult>(
      '/api/imports',
      upload(TRACKER, 'tracker.csv', { format: 'generic' }),
    );
    // Contoso matches by URL key and moves to interview; Fabrikam is new; its duplicate row is skipped.
    expect(tracker.body).toMatchObject({ created: 1, updated: 1, skipped: 1, errors: [] });
    const contoso = (await t.json<ListResponse<ApplicationListItem>>('/api/applications?q=Contoso'))
      .body.items[0];
    expect(contoso?.status).toBe('interview');
    const detail = await t.json<ApplicationDetail>(`/api/applications/${contoso?.id}`);
    expect(detail.body.events[0]).toMatchObject({
      type: 'import',
      fromStatus: 'applied',
      toStatus: 'interview',
      summary: 'Applied → Interview: Imported from a spreadsheet',
    });
  });

  it('refuses files that are not CSV, too large, or in an unknown format', async () => {
    const form = new FormData();
    form.set('file', new File(['x'], 'photo.png', { type: 'image/png' }));
    expect((await t.fetch('/api/imports', { method: 'POST', body: form })).status).toBe(415);

    const big = await t.json<ApiErrorBody>(
      '/api/imports',
      upload('a'.repeat(2 * 1024 * 1024 + 1), 'big.csv'),
    );
    expect(big.status).toBe(413);

    const badFormat = await t.json<ApiErrorBody>(
      '/api/imports',
      upload(TRACKER, 'x.csv', { format: 'xlsx' }),
    );
    expect(badFormat.status).toBe(400);

    const json = await t.json<ApiErrorBody>('/api/imports', jsonBody('POST', { csv: TRACKER }));
    expect(json.status).toBe(415);
  });

  it('answers 400 for a malformed upload', async () => {
    const bad = await t.json<ApiErrorBody>('/api/imports', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----portal-test' },
      body: 'this is not a multipart body',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_request');
  });
});
