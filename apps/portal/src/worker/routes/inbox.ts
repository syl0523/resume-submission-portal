import {
  EMAIL_KIND_TO_STATUS,
  INBOX_STATUSES,
  type InboxItem,
  type IngestResult,
  jobInputSchema,
  type ListResponse,
  linkInboxSchema,
  pasteEmailSchema,
} from '@jsp/core';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { applications, inboundEmails, jobs } from '../db/schema';
import type { AppEnv } from '../env';
import { sha256Hex } from '../lib/crypto';
import { HttpError, notFound } from '../lib/errors';
import { toInboxItem } from '../lib/mappers';
import { nowIso, toIso } from '../lib/time';
import { validate } from '../lib/validate';
import { createApplication } from '../services/applications';
import {
  applyEmailToApplication,
  getInboxItem,
  ingestEmail,
  providerChannel,
  providerSource,
} from '../services/ingest';
import { parseRawEmail } from '../services/mime';

/** Inbox (KAN-22): emails the pipeline processed, plus paste / link / create / ignore. */

const listQuerySchema = z.object({
  status: z.enum(['all', ...INBOX_STATUSES]).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const inboxRoutes = new Hono<AppEnv>();

inboxRoutes.get('/', validate('query', listQuerySchema), async (c) => {
  const { status, limit, offset } = c.req.valid('query');
  const db = c.var.db;
  const conditions: SQL[] = [eq(inboundEmails.userId, c.var.user.id)];
  if (status !== 'all') conditions.push(eq(inboundEmails.status, status));
  const where = and(...conditions);
  const [rows, total] = await Promise.all([
    db
      .select({ inbox: inboundEmails, app: applications, job: jobs })
      .from(inboundEmails)
      .leftJoin(applications, eq(applications.id, inboundEmails.applicationId))
      .leftJoin(jobs, eq(jobs.id, applications.jobId))
      .where(where)
      .orderBy(desc(inboundEmails.receivedAt), desc(inboundEmails.createdAt))
      .limit(limit)
      .offset(offset)
      .all(),
    db.select({ n: count() }).from(inboundEmails).where(where).get(),
  ]);
  const body: ListResponse<InboxItem> = {
    items: rows.map((r) =>
      toInboxItem(
        r.inbox,
        r.app && r.job
          ? { id: r.app.id, company: r.job.company, title: r.job.title, status: r.app.status }
          : null,
      ),
    ),
    total: total?.n ?? 0,
  };
  return c.json(body);
});

inboxRoutes.post('/paste', validate('json', pasteEmailSchema), async (c) => {
  const body = c.req.valid('json');
  const receivedAt = toIso(body.receivedAt ?? null) ?? nowIso();
  let result: IngestResult;
  if (body.raw) {
    const parsed = await parseRawEmail(body.raw);
    const fallbackId = `sha256:${await sha256Hex(body.raw)}`;
    result = await ingestEmail(c.var.db, c.env, c.var.user, {
      message: parsed.message,
      messageId: parsed.messageId ?? fallbackId,
      receivedAt: parsed.date ?? receivedAt,
      raw: body.raw,
    });
  } else {
    const message = {
      from: body.from?.trim() || 'unknown sender',
      subject: body.subject ?? '',
      text: body.text ?? null,
      html: body.html ?? null,
      date: receivedAt,
    };
    const hash = await sha256Hex(
      [message.from, message.subject, message.text ?? '', message.html ?? ''].join('\u0000'),
    );
    result = await ingestEmail(c.var.db, c.env, c.var.user, {
      message,
      messageId: `sha256:${hash}`,
      receivedAt,
    });
  }
  return c.json(result, 201);
});

async function inboxRow(c: { var: AppEnv['Variables'] }, id: string) {
  const row = await c.var.db
    .select()
    .from(inboundEmails)
    .where(and(eq(inboundEmails.id, id), eq(inboundEmails.userId, c.var.user.id)))
    .get();
  if (!row) throw notFound('Inbox item');
  return row;
}

inboxRoutes.post('/:id/link', validate('json', linkInboxSchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const row = await inboxRow(c, c.req.param('id'));
  const { applicationId } = c.req.valid('json');
  const owned = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .get();
  if (!owned) throw notFound('Application');

  const alreadyLinked =
    row.applicationId === applicationId && (row.status === 'matched' || row.status === 'created');
  if (!alreadyLinked) {
    await applyEmailToApplication(db, c.env, userId, applicationId, {
      kind: row.kind,
      provider: row.provider,
      subject: row.subject,
      occurredAt: row.receivedAt,
      inboundEmailId: row.id,
    });
    await db
      .update(inboundEmails)
      .set({ status: 'matched', applicationId, error: null })
      .where(eq(inboundEmails.id, row.id));
  }
  return c.json(await getInboxItem(db, userId, row.id));
});

inboxRoutes.post('/:id/create', async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const row = await inboxRow(c, c.req.param('id'));
  if (!row.company || !row.jobTitle) {
    throw new HttpError(
      422,
      'unprocessable',
      'This email does not name both a company and a job title. Add the application by hand.',
    );
  }
  const result = await createApplication(db, c.env, userId, {
    job: jobInputSchema.parse({
      title: row.jobTitle,
      company: row.company,
      source: providerSource(row.provider),
    }),
    status: EMAIL_KIND_TO_STATUS[row.kind] ?? 'applied',
    capturedVia: 'email',
    source: 'email',
    appliedAt: row.receivedAt,
    appliedVia: providerChannel(row.provider),
    occurredAt: row.receivedAt,
    eventType: 'email',
    summary: `Added from an email: “${row.subject}”`,
    inboundEmailId: row.id,
  });
  await db
    .update(inboundEmails)
    .set({ status: 'created', applicationId: result.applicationId, error: null })
    .where(eq(inboundEmails.id, row.id));
  const body: IngestResult = {
    item: await getInboxItem(db, userId, row.id),
    applicationId: result.applicationId,
    created: !result.duplicate,
    statusChanged: false,
  };
  return c.json(body, 201);
});

inboxRoutes.post('/:id/ignore', async (c) => {
  const row = await inboxRow(c, c.req.param('id'));
  await c.var.db
    .update(inboundEmails)
    .set({ status: 'ignored' })
    .where(eq(inboundEmails.id, row.id));
  return c.json(await getInboxItem(c.var.db, c.var.user.id, row.id));
});
