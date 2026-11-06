import { ACTIVE_STATUSES } from '@jsp/core';
import { and, inArray, isNull, lt, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { createDb, type Db } from '../db/client';
import { applications, watchedBoards } from '../db/schema';
import { type Env, numberVar } from '../env';
import { describeError } from '../lib/errors';
import { addDays } from '../lib/time';
import { buildTransitionStatements } from './applications';
import { boardSyncOrder, syncBoards } from './boards';

/**
 * The daily cron (KAN-25, KAN-68; 11:00 UTC): sync the watched boards that are due, mark silent
 * applications as "No response", and refresh saved searches with alerts on. One failure never
 * stops the rest.
 */

/**
 * Boards synced per daily run. Keeps one run inside the Workers Free plan's 50 outbound requests
 * with room for saved-search providers; boards beyond it (stalest first) roll over to the next day.
 */
export const BOARDS_PER_RUN = 30;
/** A board is due once its last successful sync is this old (boards just added are skipped). */
export const BOARD_STALE_HOURS = 20;

export interface BoardSyncReport {
  boardsSynced: number;
  boardErrors: number;
}

/**
 * Sync up to `limit` due boards: never-synced and stale ones, healthy boards before failing ones
 * (so a few broken boards cannot starve the rest), oldest sync first.
 */
export async function syncDueBoards(
  db: Db,
  env: Env,
  now: Date,
  limit = BOARDS_PER_RUN,
): Promise<BoardSyncReport> {
  const cutoff = new Date(now.getTime() - BOARD_STALE_HOURS * 3_600_000).toISOString();
  const due = await db
    .select()
    .from(watchedBoards)
    .where(or(isNull(watchedBoards.lastSyncedAt), lt(watchedBoards.lastSyncedAt, cutoff)))
    .orderBy(...boardSyncOrder())
    .limit(limit)
    .all();
  const { synced, failed } = await syncBoards(db, env, due, now.toISOString());
  return { boardsSynced: synced, boardErrors: failed };
}

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

  try {
    Object.assign(report, await syncDueBoards(db, env, now));
  } catch (err) {
    console.error('Board sync failed', describeError(err));
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
