import { resumeUpdateSchema } from '@jsp/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { Hono } from 'hono';
import { z } from 'zod';
import { runBatch } from '../db/client';
import { resumes } from '../db/schema';
import type { AppEnv } from '../env';
import { newId } from '../lib/crypto';
import { HttpError } from '../lib/errors';
import { toResume } from '../lib/mappers';
import { nowIso } from '../lib/time';
import { validate } from '../lib/validate';
import {
  getResumeRow,
  listResumes,
  MAX_RESUME_BYTES,
  promoteDefault,
  resumeFileResponse,
  resumeInUse,
  resumeKey,
  resumeMimeType,
  safeFileName,
} from '../services/resumes';

/**
 * Resume vault on R2 (KAN-17). Mounted at /api/resumes. Versions that an application used are
 * archived instead of deleted, so every application keeps pointing at exactly what was sent.
 */

const listQuerySchema = z.object({ includeArchived: z.enum(['true', 'false']).optional() });

const MAX_LABEL = 120;
const MAX_TEXT = 100_000;

const tooLarge = () => new HttpError(413, 'payload_too_large', 'Resumes can be at most 5 MB');

export const resumeRoutes = new Hono<AppEnv>();

resumeRoutes.get('/', validate('query', listQuerySchema), async (c) => {
  const { includeArchived } = c.req.valid('query');
  return c.json(await listResumes(c.var.db, c.var.user.id, includeArchived === 'true'));
});

resumeRoutes.post('/', async (c) => {
  if (!/^multipart\/form-data/i.test(c.req.header('content-type') ?? '')) {
    throw new HttpError(415, 'unsupported_media_type', 'Upload the resume as multipart/form-data');
  }
  // Refuse obviously oversized bodies before reading them (multipart adds a little overhead).
  if (Number(c.req.header('content-length') ?? 0) > MAX_RESUME_BYTES + 256 * 1024) throw tooLarge();

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) {
    throw new HttpError(400, 'invalid_request', 'Attach the resume file as "file"');
  }
  if (file.size === 0) throw new HttpError(400, 'invalid_request', 'The file is empty');
  if (file.size > MAX_RESUME_BYTES) throw tooLarge();

  const fileName = safeFileName(file.name);
  const mimeType = resumeMimeType(fileName, file.type);
  const label =
    (typeof form.label === 'string' ? form.label.trim() : '') || fileName.replace(/\.[^.]+$/, '');
  if (label.length > MAX_LABEL) {
    throw new HttpError(400, 'invalid_request', `The label can be at most ${MAX_LABEL} characters`);
  }
  const text = typeof form.text === 'string' && form.text.trim() ? form.text : null;
  if (text && text.length > MAX_TEXT) {
    throw new HttpError(400, 'invalid_request', 'The resume text is too long');
  }

  const db = c.var.db;
  const userId = c.var.user.id;
  const currentDefault = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.userId, userId), isNull(resumes.archivedAt), eq(resumes.isDefault, true)))
    .get();
  const isDefault = form.isDefault === 'true' || !currentDefault;

  const id = newId();
  const fileKey = resumeKey(userId, id, fileName);
  await c.env.FILES.put(fileKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: mimeType },
  });

  const row = {
    id,
    userId,
    label,
    fileKey,
    fileName,
    mimeType,
    sizeBytes: file.size,
    isDefault,
    textContent: text,
    archivedAt: null,
    createdAt: nowIso(),
  };
  const statements: BatchItem<'sqlite'>[] = [];
  if (isDefault) {
    statements.push(
      db
        .update(resumes)
        .set({ isDefault: false })
        .where(and(eq(resumes.userId, userId), eq(resumes.isDefault, true))),
    );
  }
  statements.push(db.insert(resumes).values(row));
  try {
    await runBatch(db, statements);
  } catch (err) {
    await c.env.FILES.delete(fileKey);
    throw err;
  }
  return c.json(toResume(row), 201);
});

resumeRoutes.get('/:id/file', async (c) =>
  resumeFileResponse(c.env, await getResumeRow(c.var.db, c.var.user.id, c.req.param('id'))),
);

resumeRoutes.patch('/:id', validate('json', resumeUpdateSchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const row = await getResumeRow(db, userId, c.req.param('id'));
  const body = c.req.valid('json');

  const archived = body.archived ?? row.archivedAt !== null;
  if (body.isDefault === true && archived) {
    throw new HttpError(422, 'unprocessable', 'An archived resume cannot be the default');
  }

  const set: Partial<typeof resumes.$inferInsert> = {};
  if (body.label !== undefined) set.label = body.label;
  if (body.textContent !== undefined)
    set.textContent = body.textContent?.trim() ? body.textContent : null;
  if (body.archived !== undefined)
    set.archivedAt = body.archived ? (row.archivedAt ?? nowIso()) : null;
  if (body.isDefault !== undefined) set.isDefault = body.isDefault;
  if (archived) set.isDefault = false;

  const statements: BatchItem<'sqlite'>[] = [];
  if (set.isDefault === true && !row.isDefault) {
    statements.push(
      db
        .update(resumes)
        .set({ isDefault: false })
        .where(and(eq(resumes.userId, userId), eq(resumes.isDefault, true))),
    );
  }
  if (Object.keys(set).length > 0) {
    statements.push(db.update(resumes).set(set).where(eq(resumes.id, row.id)));
  }
  await runBatch(db, statements);
  if (row.isDefault && archived) await promoteDefault(db, userId, row.id);

  return c.json(toResume(await getResumeRow(db, userId, row.id)));
});

resumeRoutes.delete('/:id', async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const row = await getResumeRow(db, userId, c.req.param('id'));
  if (await resumeInUse(db, userId, row.id)) {
    await db
      .update(resumes)
      .set({ archivedAt: row.archivedAt ?? nowIso(), isDefault: false })
      .where(eq(resumes.id, row.id));
  } else {
    await db.delete(resumes).where(eq(resumes.id, row.id));
    await c.env.FILES.delete(row.fileKey);
  }
  if (row.isDefault) await promoteDefault(db, userId, row.id);
  return c.body(null, 204);
});
