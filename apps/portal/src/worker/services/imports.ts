import type { ImportedApplication, ImportResult } from '@jsp/core';
import { normalizeTitle } from '@jsp/integrations';
import { and, eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../db/client';
import { applications, jobs, resumes } from '../db/schema';
import type { Env } from '../env';
import {
  buildCreateStatements,
  buildTransitionStatements,
  prepareJob,
  type TransitionTarget,
} from './applications';

/**
 * Bulk import (KAN-23). Reads the user's applications once, then writes in D1 batches, so a
 * thousand-row LinkedIn export stays within Worker query limits.
 *
 * A row matches an existing application by URL key, else by source + job id, else by company key
 * + normalised title. Matches move forward through decideTransition(..., 'import') and get an
 * empty appliedAt filled; new rows create a job and application with an `import` event.
 */

const ROWS_PER_BATCH = 25;

interface Known extends TransitionTarget {
  urlKey: string | null;
  source: string;
  externalId: string | null;
  companyKey: string;
  title: string;
}

export async function importApplications(
  db: Db,
  env: Env,
  userId: string,
  rows: ImportedApplication[],
  label: string,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const [known, resumeRows] = await Promise.all([
    db
      .select({
        id: applications.id,
        status: applications.status,
        appliedAt: applications.appliedAt,
        nextFollowUpAt: applications.nextFollowUpAt,
        lastActivityAt: applications.lastActivityAt,
        urlKey: jobs.urlKey,
        source: jobs.source,
        externalId: jobs.externalId,
        companyKey: jobs.companyKey,
        title: jobs.title,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(eq(applications.userId, userId))
      .all(),
    db
      .select({ id: resumes.id, label: resumes.label, fileName: resumes.fileName })
      .from(resumes)
      .where(eq(resumes.userId, userId))
      .all(),
  ]);

  const byUrl = new Map<string, Known>();
  const byExternal = new Map<string, Known>();
  const byName = new Map<string, Known>();
  const remember = (k: Known) => {
    if (k.urlKey) byUrl.set(k.urlKey, k);
    if (k.externalId) byExternal.set(`${k.source}|${k.externalId}`, k);
    byName.set(`${k.companyKey}|${normalizeTitle(k.title)}`, k);
  };
  for (const k of known) remember(k);

  const resumeByName = new Map<string, string>();
  for (const r of resumeRows) {
    resumeByName.set(r.label.toLowerCase(), r.id);
    resumeByName.set(r.fileName.toLowerCase(), r.id);
  }

  const pending: {
    label: string;
    statements: BatchItem<'sqlite'>[];
    outcome: 'created' | 'updated';
  }[] = [];

  for (const row of rows) {
    const job = prepareJob(row.job);
    const match =
      (job.urlKey ? byUrl.get(job.urlKey) : undefined) ??
      (job.externalId ? byExternal.get(`${job.source}|${job.externalId}`) : undefined) ??
      byName.get(`${job.companyKey}|${normalizeTitle(job.title)}`);

    if (match) {
      const statements: BatchItem<'sqlite'>[] = [];
      let changed = false;
      if (row.status !== match.status) {
        const built = buildTransitionStatements(db, env, userId, match, {
          proposed: row.status,
          source: 'import',
          eventType: 'import',
          occurredAt: row.appliedAt,
          note: label,
        });
        if (built.result.changed) {
          statements.push(...built.statements);
          changed = true;
          match.status = built.result.to;
          match.appliedAt = match.appliedAt ?? row.appliedAt;
        }
      }
      if (!changed && !match.appliedAt && row.appliedAt && row.status !== 'saved') {
        statements.push(
          db
            .update(applications)
            .set({ appliedAt: row.appliedAt })
            .where(and(eq(applications.id, match.id), isNull(applications.appliedAt))),
        );
        match.appliedAt = row.appliedAt;
        changed = true;
      }
      if (changed)
        pending.push({ label: `${job.company} – ${job.title}`, statements, outcome: 'updated' });
      else result.skipped += 1;
      continue;
    }

    const resumeId = row.resumeName
      ? (resumeByName.get(row.resumeName.toLowerCase()) ?? null)
      : null;
    const built = buildCreateStatements(
      db,
      env,
      userId,
      {
        job: row.job,
        status: row.status,
        capturedVia: 'import',
        source: 'import',
        appliedAt: row.appliedAt,
        appliedVia: row.appliedVia,
        notes: row.notes,
        resumeId,
        occurredAt: row.appliedAt,
        eventType: 'import',
        summary: label,
      },
      job,
    );
    remember({
      id: built.applicationId,
      status: row.status,
      appliedAt: row.appliedAt,
      nextFollowUpAt: null,
      lastActivityAt: row.appliedAt ?? new Date().toISOString(),
      urlKey: job.urlKey,
      source: job.source,
      externalId: job.externalId,
      companyKey: job.companyKey,
      title: job.title,
    });
    pending.push({
      label: `${job.company} – ${job.title}`,
      statements: built.statements,
      outcome: 'created',
    });
  }

  for (let i = 0; i < pending.length; i += ROWS_PER_BATCH) {
    const group = pending.slice(i, i + ROWS_PER_BATCH);
    const statements = group.flatMap((g) => g.statements);
    const [first, ...rest] = statements;
    if (!first) continue;
    try {
      await db.batch([first, ...rest]);
      for (const g of group) result[g.outcome] += 1;
    } catch {
      // Find the bad row(s): retry one by one so the rest of the group still lands.
      for (const g of group) {
        const [one, ...more] = g.statements;
        if (!one) continue;
        try {
          await db.batch([one, ...more]);
          result[g.outcome] += 1;
        } catch {
          result.errors.push({ row: 0, message: `Could not save “${g.label}”` });
        }
      }
    }
  }
  return result;
}
