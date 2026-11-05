import { ACTIVE_STATUSES } from '@jsp/core';
import { and, inArray, lt } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { createDb, type Db } from '../db/client';
import { applications, watchedBoards } from '../db/schema';
import { type Env, numberVar } from '../env';
import { describeError } from '../lib/errors';
import { addDays } from '../lib/time';
import { buildTransitionStatements } from './applications';
import { syncBoard } from './boards';

/**
 * The daily cron (KAN-25, 11:00 UTC): sync every watched board, mark silent applications as
 * "No response", and refresh saved searches with alerts on. One failure never stops the rest.
 */

export interface DailyReport {
  boardsSynced: number;
  boardErrors: number;
  ghosted: number;
  searchesRun: number;
  searchErrors: number;
}

export type SearchRefresher = (
  db: Db,
  env: Env,
  now: Date,
) => Promise<{ run: number; errors: number }>;

/** Active applications with no activity for GHOST_AFTER_DAYS move to `ghosted` (status engine, source system). */
export async function markGhosted(db: Db, env: Env, now: Date): Promise<number> {
  const days = numberVar(env.GHOST_AFTER_DAYS, 21);
  const cutoff = addDays(now.toISOString(), -days);
  const idle = await db
    .select({
      id: applications.id,
      userId: applications.userId,
      status: applications.status,
      appliedAt: applications.appliedAt,
      nextFollowUpAt: applications.nextFollowUpAt,
      lastActivityAt: applications.lastActivityAt,
    })
    .from(applications)
    .where(
      and(
        inArray(applications.status, [...ACTIVE_STATUSES]),
        lt(applications.lastActivityAt, cutoff),
      ),
    )
    .all();

  let ghosted = 0;
  let batch: BatchItem<'sqlite'>[] = [];
  const flush = async () => {
    const [first, ...rest] = batch;
    batch = [];
    if (first) await db.batch([first, ...rest]);
  };
  for (const app of idle) {
    const built = buildTransitionStatements(db, env, app.userId, app, {
      proposed: 'ghosted',
      source: 'system',
      occurredAt: now.toISOString(),
      summary: `No response for ${days} days`,
    });
    if (!built.result.changed) continue;
    batch.push(...built.statements);
    ghosted += 1;
    if (batch.length >= 100) await flush();
  }
  await flush();
  return ghosted;
}

export async function runDailyJobs(
  env: Env,
  now: Date = new Date(),
  refreshSearches?: SearchRefresher,
): Promise<DailyReport> {
  const db = createDb(env.DB);
  const report: DailyReport = {
    boardsSynced: 0,
    boardErrors: 0,
    ghosted: 0,
    searchesRun: 0,
    searchErrors: 0,
  };

  const boards = await db.select().from(watchedBoards).all();
  for (const board of boards) {
    try {
      await syncBoard(db, env, board, now.toISOString());
      report.boardsSynced += 1;
    } catch (err) {
      report.boardErrors += 1;
      console.warn(`Board ${board.provider}/${board.token} failed to sync`, describeError(err));
    }
  }

  try {
    report.ghosted = await markGhosted(db, env, now);
  } catch (err) {
    console.error('No-response marking failed', describeError(err));
  }

  if (refreshSearches) {
    try {
      const searches = await refreshSearches(db, env, now);
      report.searchesRun = searches.run;
      report.searchErrors = searches.errors;
    } catch (err) {
      console.error('Saved-search refresh failed', describeError(err));
    }
  }
  return report;
}
