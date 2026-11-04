import type {
  ApiErrorBody,
  ApplicationDetail,
  InboxItem,
  IngestResult,
  ListResponse,
  MeResponse,
} from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleEmail } from '../handlers/email';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

// Synthetic messages only: fictional companies and example.com addresses.

function rawEmail(opts: {
  from: string;
  to?: string;
  subject: string;
  body: string;
  messageId: string;
  date?: string;
}): string {
  return [
    `From: ${opts.from}`,
    `To: ${opts.to ?? 'jobs-test@jobs.test'}`,
    `Subject: ${opts.subject}`,
    `Message-ID: <${opts.messageId}>`,
    `Date: ${opts.date ?? 'Tue, 03 Nov 2026 15:00:00 +0000'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    opts.body,
    '',
  ].join('\r\n');
}

const REJECTION = rawEmail({
  from: 'LinkedIn <jobs-noreply@linkedin.com>',
  subject: 'Your application to Recruiter at Fabrikam',
  body: 'Thank you for your interest in the Recruiter position at Fabrikam. Unfortunately, we will not be moving forward with your application at this time.',
  messageId: 'reject-1@linkedin.example',
});

const EASY_APPLY = rawEmail({
  from: 'LinkedIn <jobs-noreply@linkedin.com>',
  subject: 'Jane, your application was sent to Northwind Freight',
  body: 'Your application was sent to Northwind Freight\n\nHR Generalist\nNorthwind Freight · Austin, TX\n\nhttps://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc',
  messageId: 'sent-1@linkedin.example',
  date: 'Mon, 02 Nov 2026 14:30:00 +0000',
});

describe('inbox API and ingest pipeline', () => {
  let t: TestContext;

  const paste = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    t.json<IngestResult>('/api/inbox/paste', jsonBody('POST', body, headers));

  const createApp = async (company: string, title: string, status = 'applied') =>
    (
      await t.json<ApplicationDetail>(
        '/api/applications',
        jsonBody('POST', { job: { title, company, url: null }, status }),
      )
    ).body.application.id;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('matches a rejection to the application and moves it through the status engine', async () => {
    const appId = await createApp('Fabrikam', 'Recruiter');
    const { status, body } = await paste({ raw: REJECTION });
    expect(status).toBe(201);
    expect(body).toMatchObject({ applicationId: appId, created: false, statusChanged: true });
    expect(body.item).toMatchObject({
      status: 'matched',
      provider: 'linkedin',
      kind: 'rejection',
      company: 'Fabrikam',
      classifier: 'rules',
      application: { id: appId, company: 'Fabrikam', status: 'rejected' },
    });

    const detail = await t.json<ApplicationDetail>(`/api/applications/${appId}`);
    expect(detail.body.application.status).toBe('rejected');
    const emailEvent = detail.body.events.find((e) => e.type === 'email');
    expect(emailEvent).toMatchObject({
      source: 'email',
      fromStatus: 'applied',
      toStatus: 'rejected',
      occurredAt: '2026-11-03T15:00:00.000Z',
    });
    expect(emailEvent?.summary).toBe(
      'Applied → Rejected · Email from LinkedIn: “Your application to Recruiter at Fabrikam”',
    );
  });

  it('is idempotent on Message-ID', async () => {
    const before = (await t.json<ListResponse<InboxItem>>('/api/inbox')).body.total;
    const again = await paste({ raw: REJECTION });
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ created: false, statusChanged: false });
    expect((await t.json<ListResponse<InboxItem>>('/api/inbox')).body.total).toBe(before);
  });

  it('creates the application from an Easy Apply confirmation it cannot match', async () => {
    const { body } = await paste({ raw: EASY_APPLY });
    expect(body).toMatchObject({ created: true, statusChanged: true });
    expect(body.item.status).toBe('created');
    const detail = await t.json<ApplicationDetail>(`/api/applications/${body.applicationId}`);
    expect(detail.body.job).toMatchObject({
      title: 'HR Generalist',
      company: 'Northwind Freight',
      source: 'linkedin',
      capturedVia: 'email',
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
    });
    expect(detail.body.application).toMatchObject({
      status: 'applied',
      appliedVia: 'linkedin_easy_apply',
      appliedAt: '2026-11-02T14:30:00.000Z',
    });
  });

  it('keeps job alerts as ignored', async () => {
    const { body } = await paste({
      from: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
      subject: '30+ new jobs for "HR Generalist"',
      text: 'Jobs you may be interested in',
    });
    expect(body.item).toMatchObject({ status: 'ignored', kind: 'other' });
  });

  it('leaves unknown employers unmatched until linked by hand', async () => {
    const { body } = await paste({
      from: 'LinkedIn <jobs-noreply@linkedin.com>',
      subject: 'Your application was viewed by Globex',
      text: 'Good news! Globex viewed your application.',
    });
    expect(body.item).toMatchObject({
      status: 'unmatched',
      kind: 'application_viewed',
      company: 'Globex',
    });

    const appId = await createApp('Globex Corporation', 'Office Manager');
    const linked = await t.json<InboxItem>(
      `/api/inbox/${body.item.id}/link`,
      jsonBody('POST', { applicationId: appId }),
    );
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({
      status: 'matched',
      application: { id: appId, status: 'viewed' },
    });

    const foreign = await t.json<ApiErrorBody>(
      `/api/inbox/${body.item.id}/link`,
      jsonBody('POST', { applicationId: appId }, { 'x-dev-user': 'other@example.com' }),
    );
    expect(foreign.status).toBe(404);
  });

  it('schedules interviews found in matched emails', async () => {
    const appId = await createApp('Litware', 'Senior Recruiter');
    const { body } = await paste({
      from: 'Litware Recruiting <no-reply@ashbyhq.com>',
      subject: 'Interview confirmation: Litware',
      text: 'Your interview with Litware for the Senior Recruiter role is confirmed for Tuesday, November 17, 2026 at 2:00 PM EST.',
      receivedAt: '2026-11-04T10:00:00Z',
    });
    expect(body).toMatchObject({ applicationId: appId, statusChanged: true });
    const detail = await t.json<ApplicationDetail>(`/api/applications/${appId}`);
    expect(detail.body.application.status).toBe('interview');
    expect(detail.body.events.find((e) => e.type === 'interview')?.scheduledAt).toBe(
      '2026-11-17T19:00:00.000Z',
    );
  });

  it('creates an application from an unmatched email on request, or explains why not', async () => {
    const screening = await paste({
      from: 'Coho Winery <careers@coho.icims.com>',
      subject: 'Phone screen for Office Coordinator',
      text: 'Thanks for applying to Coho Winery. We would like to schedule a phone screen for the Office Coordinator role.',
    });
    expect(screening.body.item.status).toBe('unmatched');
    const created = await t.json<IngestResult>(`/api/inbox/${screening.body.item.id}/create`, {
      method: 'POST',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ created: true, item: { status: 'created' } });
    const detail = await t.json<ApplicationDetail>(
      `/api/applications/${created.body.applicationId}`,
    );
    expect(detail.body.application.status).toBe('screening');
    expect(detail.body.job).toMatchObject({ company: 'Coho Winery', title: 'Office Coordinator' });

    const vague = await paste({
      from: 'Pat Example <pat@example-hr.example>',
      subject: 'Quick chat?',
      text: 'Would love to speak with you this week.',
    });
    const refused = await t.json<ApiErrorBody>(`/api/inbox/${vague.body.item.id}/create`, {
      method: 'POST',
    });
    expect(refused.status).toBe(422);

    const ignored = await t.json<InboxItem>(`/api/inbox/${vague.body.item.id}/ignore`, {
      method: 'POST',
    });
    expect(ignored.body.status).toBe('ignored');
  });

  it('lists newest first with status filters, scoped to the user', async () => {
    const all = await t.json<ListResponse<InboxItem>>('/api/inbox');
    expect(all.body.total).toBeGreaterThanOrEqual(7);
    const created = await t.json<ListResponse<InboxItem>>('/api/inbox?status=created');
    expect(created.body.items.every((i) => i.status === 'created')).toBe(true);
    expect(created.body.total).toBe(2);
    const other = await t.json<ListResponse<InboxItem>>('/api/inbox', {
      headers: { 'x-dev-user': 'other@example.com' },
    });
    expect(other.body.total).toBe(0);
  });

  it('validates pasted emails', async () => {
    const { status } = await t.json<ApiErrorBody>(
      '/api/inbox/paste',
      jsonBody('POST', { subject: 'x' }),
    );
    expect(status).toBe(400);
  });
});

describe('email handler', () => {
  let t: TestContext;
  let alias: string;
  let userId: string;

  const fakeMessage = (to: string, raw: string, rawSize = raw.length) => {
    const setReject = vi.fn();
    const message = {
      from: 'bounce@linkedin.example',
      to,
      raw: new Response(raw).body,
      rawSize,
      headers: new Headers(),
      setReject,
      forward: vi.fn(),
      reply: vi.fn(),
    } as unknown as ForwardableEmailMessage;
    return { message, setReject };
  };

  beforeAll(async () => {
    t = await createTestContext();
    const me = await t.json<MeResponse>('/api/me');
    alias = me.body.user.inboundAlias;
    userId = me.body.user.id;
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('rejects unknown recipients and oversized messages', async () => {
    const unknown = fakeMessage('jobs-nobody@jobs.test', REJECTION);
    await handleEmail(unknown.message, t.env, t.ctx);
    expect(unknown.setReject).toHaveBeenCalledWith('Unknown recipient');

    const big = fakeMessage(`${alias}@jobs.test`, REJECTION, 11 * 1024 * 1024);
    await handleEmail(big.message, t.env, t.ctx);
    expect(big.setReject).toHaveBeenCalledWith('Message too large');
  });

  it('ingests mail for a known alias (plus-tags allowed) and keeps the raw copy', async () => {
    const { message, setReject } = fakeMessage(`${alias}+linkedin@jobs.test`, EASY_APPLY);
    await handleEmail(message, t.env, t.ctx);
    expect(setReject).not.toHaveBeenCalled();

    const inbox = await t.json<ListResponse<InboxItem>>('/api/inbox');
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({ status: 'created', company: 'Northwind Freight' });

    const stored = await t.env.FILES.list({ prefix: `inbound/${userId}/` });
    expect(stored.objects).toHaveLength(1);
    expect(stored.objects[0]?.key).toMatch(
      new RegExp(`^inbound/${userId}/\\d{4}/\\d{2}/[0-9a-f-]+\\.eml$`),
    );
  });

  it('never throws on mail it cannot read', async () => {
    const { message } = fakeMessage(`${alias}@jobs.test`, '\u0000\u0001 not an email');
    await expect(handleEmail(message, t.env, t.ctx)).resolves.toBeUndefined();
  });
});
