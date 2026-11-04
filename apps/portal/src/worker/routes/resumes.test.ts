import type { ApiErrorBody, ApplicationDetail, Resume } from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_RESUME_BYTES, resumeMimeType, safeFileName } from '../services/resumes';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n% synthetic test resume\n%%EOF\n');

function upload(
  file: File | null,
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
): RequestInit {
  const form = new FormData();
  if (file) form.set('file', file);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { method: 'POST', body: form, headers };
}

describe('resume file checks', () => {
  it('accepts known extensions with matching or generic MIME types', () => {
    expect(resumeMimeType('cv.pdf', 'application/pdf')).toBe('application/pdf');
    expect(resumeMimeType('cv.DOCX', 'application/octet-stream')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(resumeMimeType('cv.txt', 'text/plain; charset=utf-8')).toBe('text/plain');
    expect(resumeMimeType('cv.rtf', 'text/rtf')).toBe('text/rtf');
  });

  it('rejects other types and mismatched MIME types', () => {
    expect(() => resumeMimeType('cv.exe', 'application/octet-stream')).toThrow(/PDF/);
    expect(() => resumeMimeType('cv.pdf', 'image/png')).toThrow(/PDF/);
    expect(() => resumeMimeType('cv', 'application/pdf')).toThrow(/PDF/);
  });

  it('cleans file names for storage keys and headers', () => {
    expect(safeFileName('C:\\Users\\me\\Résumé "final".pdf')).toBe('Résumé final.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('   ')).toBe('resume');
  });
});

describe('resumes API', () => {
  let t: TestContext;

  const list = async (qs = '') => (await t.json<Resume[]>(`/api/resumes${qs}`)).body;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('stores the first upload on R2 as the default', async () => {
    const { status, body } = await t.json<Resume>(
      '/api/resumes',
      upload(new File([PDF_BYTES], 'Jane Doe - HR.pdf', { type: 'application/pdf' })),
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({
      label: 'Jane Doe - HR',
      fileName: 'Jane Doe - HR.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF_BYTES.byteLength,
      isDefault: true,
      hasText: false,
      archived: false,
    });
    const me = await t.json<{ user: { id: string } }>('/api/me');
    const object = await t.env.FILES.get(`resumes/${me.body.user.id}/${body.id}/Jane Doe - HR.pdf`);
    expect(object).not.toBeNull();
    await object?.arrayBuffer();
  });

  it('moves the default when a new upload asks for it', async () => {
    const { status, body } = await t.json<Resume>(
      '/api/resumes',
      upload(new File(['Jane Doe\nHR Business Partner'], 'jane.docx', { type: '' }), {
        label: 'HRBP version',
        isDefault: 'true',
        text: 'Jane Doe — HR Business Partner, 6 years',
      }),
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({ label: 'HRBP version', isDefault: true, hasText: true });
    expect(body.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const all = await list();
    expect(all.map((r) => [r.label, r.isDefault])).toEqual([
      ['HRBP version', true],
      ['Jane Doe - HR', false],
    ]);
  });

  it('rejects bad uploads', async () => {
    const exe = await t.json<ApiErrorBody>(
      '/api/resumes',
      upload(new File(['MZ'], 'tool.exe', { type: 'application/octet-stream' })),
    );
    expect(exe.status).toBe(415);
    expect(exe.body.error.code).toBe('unsupported_media_type');

    const big = await t.json<ApiErrorBody>(
      '/api/resumes',
      upload(
        new File([new Uint8Array(MAX_RESUME_BYTES + 1)], 'big.pdf', { type: 'application/pdf' }),
      ),
    );
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('payload_too_large');

    const missing = await t.json<ApiErrorBody>('/api/resumes', upload(null, { label: 'x' }));
    expect(missing.status).toBe(400);

    const json = await t.json<ApiErrorBody>('/api/resumes', jsonBody('POST', { file: 'x' }));
    expect(json.status).toBe(415);
  });

  it('downloads the file as an attachment, only for its owner', async () => {
    const pdf = (await list()).find((r) => r.fileName.endsWith('.pdf'));
    const res = await t.fetch(`/api/resumes/${pdf?.id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(
      'attachment; filename="Jane Doe - HR.pdf"',
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);

    const other = await t.fetch(`/api/resumes/${pdf?.id}/file`, {
      headers: { 'x-dev-user': 'other@example.com' },
    });
    expect(other.status).toBe(404);
    await other.arrayBuffer();
  });

  it('updates label and text, and archiving hands the default to the newest active resume', async () => {
    const [current, older] = await list();
    const renamed = await t.json<Resume>(
      `/api/resumes/${older?.id}`,
      jsonBody('PATCH', { label: 'General HR', textContent: 'Plain text version' }),
    );
    expect(renamed.body).toMatchObject({ label: 'General HR', hasText: true, isDefault: false });

    const archived = await t.json<Resume>(
      `/api/resumes/${current?.id}`,
      jsonBody('PATCH', { archived: true }),
    );
    expect(archived.body).toMatchObject({ archived: true, isDefault: false });
    expect((await list()).map((r) => [r.label, r.isDefault])).toEqual([['General HR', true]]);
    expect(await list('?includeArchived=true')).toHaveLength(2);

    const refused = await t.json<ApiErrorBody>(
      `/api/resumes/${current?.id}`,
      jsonBody('PATCH', { isDefault: true }),
    );
    expect(refused.status).toBe(422);

    const restored = await t.json<Resume>(
      `/api/resumes/${current?.id}`,
      jsonBody('PATCH', { archived: false, isDefault: true }),
    );
    expect(restored.body).toMatchObject({ archived: false, isDefault: true });
    expect((await list()).filter((r) => r.isDefault)).toHaveLength(1);
  });

  it('archives a resume an application used, and deletes an unused one with its file', async () => {
    const [used, unused] = await list();
    const app = await t.json<ApplicationDetail>(
      '/api/applications',
      jsonBody('POST', {
        job: { title: 'HR Manager', company: 'Tailspin Toys', url: null },
        status: 'applied',
        resumeId: used?.id,
      }),
    );
    expect(app.body.resume?.id).toBe(used?.id);

    expect((await t.fetch(`/api/resumes/${used?.id}`, { method: 'DELETE' })).status).toBe(204);
    const all = await list('?includeArchived=true');
    expect(all.find((r) => r.id === used?.id)?.archived).toBe(true);
    const stillThere = await t.fetch(`/api/resumes/${used?.id}/file`);
    expect(stillThere.status).toBe(200);
    await stillThere.arrayBuffer();
    expect((await list()).map((r) => [r.id, r.isDefault])).toEqual([[unused?.id, true]]);

    expect((await t.fetch(`/api/resumes/${unused?.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await list('?includeArchived=true')).map((r) => r.id)).toEqual([used?.id]);
    const gone = await t.fetch(`/api/resumes/${unused?.id}/file`);
    expect(gone.status).toBe(404);
  });
});
