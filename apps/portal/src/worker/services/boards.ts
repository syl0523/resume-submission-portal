import type { BoardPosting, WatchedBoard } from '@jsp/core';
import { type BoardJob, fetchBoardJobs, UpstreamError } from '@jsp/integrations';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { chunk, type Db, runBatch } from '../db/client';
import {
  type BoardPostingRow,
  boardPostings,
  type WatchedBoardRow,
  watchedBoards,
} from '../db/schema';
import { type Env, outboundFetch } from '../env';
import { newId } from '../lib/crypto';
import { describeError } from '../lib/errors';
import { addDays, nowIso } from '../lib/time';

/**
 * Watched company boards (KAN-24, KAN-25). A posting is open when the latest sync saw it, and new
 * when it first appeared after the board's baseline sync, within the last 7 days, and is unsaved.
 */

export const NEW_WINDOW_DAYS = 7;
const SYNC_TIMEOUT_MS = 20_000;
/** Boards fetched at the same time by a multi-board sync. */
const SYNC_CONCURRENCY = 4;
/**
 * Most boards one "Sync all" request syncs (KAN-69): stays inside the Workers Free plan's 50 outbound
 * requests per invocation.
 */
export const SYNC_ALL_MAX = 40;

export function isNewPosting(
  posting: Pick<BoardPostingRow, 'firstSeenAt' | 'savedApplicationId'>,
  board: Pick<WatchedBoardRow, 'createdAt'>,
  now: string,
): boolean {
  return (
    posting.firstSeenAt > board.createdAt &&
    posting.firstSeenAt >= addDays(now, -NEW_WINDOW_DAYS) &&
    !posting.savedApplicationId
  );
}

export function isOpen(
  posting: Pick<BoardPostingRow, 'lastSeenAt'>,
  board: Pick<WatchedBoardRow, 'lastSyncedAt'>,
) {
  return board.lastSyncedAt !== null && posting.lastSeenAt === board.lastSyncedAt;
}

export function toBoardPosting(p: BoardPostingRow, b: WatchedBoardRow, now: string): BoardPosting {
  return {
    id: p.id,
    boardId: p.boardId,
    companyName: b.companyName,
    provider: b.provider,
    externalId: p.externalId,
    title: p.title,
    location: p.location,
    url: p.url,
    postedAt: p.postedAt,
    firstSeenAt: p.firstSeenAt,
    isNew: isNewPosting(p, b, now),
    savedApplicationId: p.savedApplicationId,
  };
}

/** Boards with open / new posting counts. */
export async function listBoards(db: Db, userId: string, now = nowIso()): Promise<WatchedBoard[]> {
  const since = addDays(now, -NEW_WINDOW_DAYS);
  const [boards, counts] = await Promise.all([
    db
      .select()
      .from(watchedBoards)
      .where(eq(watchedBoards.userId, userId))
      .orderBy(watchedBoards.companyName)
      .all(),
    db
      .select({
        boardId: boardPostings.boardId,
        open: sql<number>`coalesce(sum(case when ${boardPostings.lastSeenAt} = ${watchedBoards.lastSyncedAt} and ${boardPostings.dismissed} = 0 then 1 else 0 end), 0)`,
        fresh: sql<number>`coalesce(sum(case when ${boardPostings.lastSeenAt} = ${watchedBoards.lastSyncedAt} and ${boardPostings.dismissed} = 0 and ${boardPostings.savedApplicationId} is null and ${boardPostings.firstSeenAt} > ${watchedBoards.createdAt} and ${boardPostings.firstSeenAt} >= ${since} then 1 else 0 end), 0)`,
      })
      .from(boardPostings)
      .innerJoin(watchedBoards, eq(watchedBoards.id, boardPostings.boardId))
      .where(eq(boardPostings.userId, userId))
      .groupBy(boardPostings.boardId)
      .all(),
  ]);
  const byBoard = new Map(counts.map((c) => [c.boardId, c]));
  return boards.map((b) => toWatchedBoard(b, byBoard.get(b.id)));
}

export function toWatchedBoard(
  b: WatchedBoardRow,
  counts?: { open: number; fresh: number },
): WatchedBoard {
  return {
    id: b.id,
    provider: b.provider,
    token: b.token,
    companyName: b.companyName,
    lastSyncedAt: b.lastSyncedAt,
    lastError: b.lastError,
    openPostings: Number(counts?.open ?? 0),
    newPostings: Number(counts?.fresh ?? 0),
    createdAt: b.createdAt,
  };
}

/** Insert new postings and refresh seen ones for a board, all marked as seen at `seenAt`. */
export function postingStatements(
  db: Db,
  board: Pick<WatchedBoardRow, 'id' | 'userId'>,
  jobs: BoardJob[],
  existing: Map<string, string>,
  seenAt: string,
  firstSeenAt: string,
): BatchItem<'sqlite'>[] {
  const statements: BatchItem<'sqlite'>[] = [];
  const fresh = jobs
    .filter((j) => !existing.has(j.externalId) && j.job.url)
    .map((j) => ({
      id: newId(),
      userId: board.userId,
      boardId: board.id,
      externalId: j.externalId,
      title: j.job.title,
      location: j.job.location ?? null,
      url: j.job.url ?? '',
      postedAt: j.job.postedAt ?? null,
      firstSeenAt,
      lastSeenAt: seenAt,
    }));
  // 10 columns per row: 9 rows keep a statement under D1's 100 bound parameters.
  for (const rows of chunk(fresh, 9))
    statements.push(db.insert(boardPostings).values(rows).onConflictDoNothing());
  const seenIds = jobs
    .map((j) => existing.get(j.externalId))
    .filter((id): id is string => Boolean(id));
  for (const ids of chunk(seenIds, 90)) {
    statements.push(
      db.update(boardPostings).set({ lastSeenAt: seenAt }).where(inArray(boardPostings.id, ids)),
    );
  }
  return statements;
}

/**
 * Fetch a board's postings and record what is open now. Upstream errors are stored on the board
 * (`lastError`) and rethrown, so one failing board can be reported without stopping the others.
 */
export async function syncBoard(
  db: Db,
  env: Env,
  board: WatchedBoardRow,
  now = nowIso(),
): Promise<WatchedBoardRow> {
  let jobs: BoardJob[];
  try {
    jobs = await fetchBoardJobs(board.provider, board.token, {
      fetch: outboundFetch(env),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      companyName: board.companyName,
      descriptions: false,
    });
  } catch (err) {
    const message = err instanceof UpstreamError ? err.message : 'The board could not be read';
    await db
      .update(watchedBoards)
      .set({ lastError: message })
      .where(eq(watchedBoards.id, board.id));
    throw err;
  }
  const rows = await db
    .select({ id: boardPostings.id, externalId: boardPostings.externalId })
    .from(boardPostings)
    .where(eq(boardPostings.boardId, board.id))
    .all();
  const existing = new Map(rows.map((r) => [r.externalId, r.id]));
  // The first successful sync is the baseline (as when a board is added through the API): what is
  // open then dates from when the board was added, so none of it is flagged new.
  const firstSeenAt = board.lastSyncedAt ? now : board.createdAt;
  await runBatch(db, [
    ...postingStatements(db, board, jobs, existing, now, firstSeenAt),
    db
      .update(watchedBoards)
      .set({ lastSyncedAt: now, lastError: null })
      .where(eq(watchedBoards.id, board.id)),
  ]);
  return { ...board, lastSyncedAt: now, lastError: null };
}

export async function getBoardRow(
  db: Db,
  userId: string,
  id: string,
): Promise<WatchedBoardRow | undefined> {
  return db
    .select()
    .from(watchedBoards)
    .where(and(eq(watchedBoards.id, id), eq(watchedBoards.userId, userId)))
    .get();
}

/** Sync order for several boards: healthy before failing (so broken boards cannot starve the rest), oldest sync first. */
export function boardSyncOrder(): SQL[] {
  return [
    sql`${watchedBoards.lastError} is not null`,
    sql`coalesce(${watchedBoards.lastSyncedAt}, '')`,
    asc(watchedBoards.createdAt),
  ];
}

/** Sync several boards, a few at a time. Failures are stored on each board (`lastError`) and counted. */
export async function syncBoards(
  db: Db,
  env: Env,
  boards: WatchedBoardRow[],
  now = nowIso(),
): Promise<{ synced: number; failed: number }> {
  const result = { synced: 0, failed: 0 };
  let next = 0;
  const worker = async () => {
    for (let board = boards[next++]; board; board = boards[next++]) {
      try {
        await syncBoard(db, env, board, now);
        result.synced += 1;
      } catch (err) {
        result.failed += 1;
        console.warn(`Board ${board.provider}/${board.token} failed to sync`, describeError(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, boards.length) }, worker));
  return result;
}

/** "Sync all" (KAN-69): every board the user watches, up to SYNC_ALL_MAX, in sync order. */
export async function syncAllBoards(
  db: Db,
  env: Env,
  userId: string,
  now = nowIso(),
): Promise<{ synced: number; failed: number }> {
  const boards = await db
    .select()
    .from(watchedBoards)
    .where(eq(watchedBoards.userId, userId))
    .orderBy(...boardSyncOrder())
    .limit(SYNC_ALL_MAX)
    .all();
  return syncBoards(db, env, boards, now);
}
