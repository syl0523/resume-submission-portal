import type { Resume } from '@jsp/core';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { applications, type ResumeRow, resumes } from '../db/schema';
import type { Env } from '../env';
import { HttpError, notFound } from '../lib/errors';
import { toResume } from '../lib/mappers';

/** Resume vault on R2 (KAN-17). Shared by /api/resumes, /api/ext and the AI features. */

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Accepted extensions and the MIME types browsers send for them (first = canonical). */
const RESUME_TYPES: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  odt: ['application/vnd.oasis.opendocument.text'],
  rtf: ['application/rtf', 'text/rtf'],
  txt: ['text/plain'],
};

/** What some browsers and OSes send when they do not know the type. */
const GENERIC_TYPES = new Set(['', 'application/octet-stream']);

/**
 * Check the file by extension and MIME type. Returns the MIME type to store, or throws 415.
 * A generic MIME type is accepted when the extension is known (Windows often sends one for .docx).
 */
export function resumeMimeType(fileName: string, mimeType: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const allowed = RESUME_TYPES[ext];
  const type = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  const canonical = allowed?.[0];
  if (!allowed || !canonical || !(allowed.includes(type) || GENERIC_TYPES.has(type))) {
    throw new HttpError(
      415,
      'unsupported_media_type',
      'Upload a PDF, Word (DOC/DOCX), ODT, RTF or TXT file',
    );
  }
  return allowed.includes(type) ? type : canonical;
}

/** File name safe for an R2 key and a Content-Disposition header (keeps Unicode letters). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'resume').slice(-150);
}

export function resumeKey(userId: string, resumeId: string, fileName: string): string {
  return `resumes/${userId}/${resumeId}/${fileName}`;
}

export async function getResumeRow(db: Db, userId: string, id: string): Promise<ResumeRow> {
  const row = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
    .get();
  if (!row) throw notFound('Resume');
  return row;
}

/** Default first, then newest. Archived versions only when asked. */
export async function listResumes(
  db: Db,
  userId: string,
  includeArchived = false,
): Promise<Resume[]> {
  const rows = await db
    .select()
    .from(resumes)
    .where(
      includeArchived
        ? eq(resumes.userId, userId)
        : and(eq(resumes.userId, userId), isNull(resumes.archivedAt)),
    )
    .orderBy(desc(resumes.isDefault), desc(resumes.createdAt))
    .all();
  return rows.map(toResume);
}

/** True when an application points at this resume (then it must be kept, archived). */
export async function resumeInUse(db: Db, userId: string, resumeId: string): Promise<boolean> {
  const row = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.resumeId, resumeId)))
    .get();
  return Boolean(row);
}

/** After the default was archived or deleted: make the newest remaining active resume the default. */
export async function promoteDefault(db: Db, userId: string, exceptId?: string): Promise<void> {
  const active = and(eq(resumes.userId, userId), isNull(resumes.archivedAt));
  const hasDefault = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(active, eq(resumes.isDefault, true)))
    .get();
  if (hasDefault) return;
  const next = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(exceptId ? and(active, ne(resumes.id, exceptId)) : active)
    .orderBy(desc(resumes.createdAt))
    .get();
  if (next) await db.update(resumes).set({ isDefault: true }).where(eq(resumes.id, next.id));
}

/** RFC 6266 attachment header with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Stream the stored file as a download. */
export async function resumeFileResponse(env: Env, row: ResumeRow): Promise<Response> {
  const object = await env.FILES.get(row.fileKey);
  if (!object) throw notFound('Resume file');
  return new Response(object.body, {
    headers: {
      'content-type': row.mimeType,
      'content-length': String(object.size),
      'content-disposition': contentDisposition(row.fileName),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
