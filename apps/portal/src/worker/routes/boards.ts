import {
  type BoardPosting,
  type BoardSyncAllResponse,
  boardCreateSchema,
  jobInputSchema,
  type ListResponse,
} from '@jsp/core';
import {
  fetchBoardJobs,
  fetchJobFromUrl,
  parseBoardUrl,
  prettifyToken,
  UpstreamError,
} from '@jsp/integrations';
import { and, count, desc, eq, gt, gte, isNull, type SQL, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { runBatch } from '../db/client';
import { boardPostings, watchedBoards } from '../db/schema';
import { type AppEnv, outboundFetch } from '../env';
import { newId } from '../lib/crypto';
import { HttpError, notFound } from '../lib/errors';
import { addDays, nowIso } from '../lib/time';
import { validate } from '../lib/validate';
import { createApplication, getApplicationDetail } from '../services/applications';
import {
  getBoardRow,
  listBoards,
  NEW_WINDOW_DAYS,
  postingStatements,
  syncAllBoards,
  syncBoard,
  toBoardPosting,
  toWatchedBoard,
} from '../services/boards';

/** Watched company boards and their postings (KAN-24). Mounted at /api/boards. */

const postingsQuerySchema = z.object({
  boardId: z.string().trim().max(64).optional(),
  onlyNew: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const saveSchema = z.object({ status: z.enum(['saved', 'applied']).default('saved') });

export const boardRoutes = new Hono<AppEnv>();

boardRoutes.get('/', async (c) => c.json(await listBoards(c.var.db, c.var.user.id)));

boardRoutes.post('/', validate('json', boardCreateSchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const body = c.req.valid('json');
  const ref = body.url
    ? parseBoardUrl(body.url)
    : body.provider && body.token
      ? { provider: body.provider, token: body.token }
      : null;
  if (!ref) {
    throw new HttpError(
      400,
      'invalid_request',
      'This careers page is not hosted on Greenhouse, Lever, Ashby or SmartRecruiters',
    );
  }
  const existing = await db
    .select({ id: watchedBoards.id })
    .from(watchedBoards)
    .where(
      and(
        eq(watchedBoards.userId, userId),
        eq(watchedBoards.provider, ref.provider),
        eq(watchedBoards.token, ref.token),
      ),
    )
    .get();
  if (existing)
    throw new HttpError(409, 'duplicate', 'You already watch this board', { boardId: existing.id });

  let jobs: Awaited<ReturnType<typeof fetchBoardJobs>>;
  try {
    jobs = await fetchBoardJobs(ref.provider, ref.token, {
      fetch: outboundFetch(c.env),
      signal: AbortSignal.timeout(20_000),
      companyName: body.companyName ?? null,
      descriptions: false,
    });
  } catch (err) {
    if (err instanceof UpstreamError) throw new HttpError(502, 'upstream_error', err.message);
    throw err;
  }

  const now = nowIso();
  const board = {
    id: newId(),
    userId,
    provider: ref.provider,
    token: ref.token,
    companyName: body.companyName?.trim() || jobs[0]?.job.company || prettifyToken(ref.token),
    lastSyncedAt: now,
    lastError: null,
    createdAt: now,
  };
  // Baseline: everything open today is "already there", so nothing is flagged new yet.
  await runBatch(db, [
    db.insert(watchedBoards).values(board),
    ...postingStatements(db, board, jobs, new Map(), now, now),
  ]);
  return c.json(
    toWatchedBoard(board, { open: jobs.filter((j) => j.job.url).length, fresh: 0 }),
    201,
  );
});

// Postings routes come before `/:id`.
boardRoutes.get('/postings', validate('query', postingsQuerySchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const query = c.req.valid('query');
  const now = nowIso();
  const conditions: SQL[] = [
    eq(boardPostings.userId, userId),
    eq(boardPostings.dismissed, false),
    sql`${boardPostings.lastSeenAt} = ${watchedBoards.lastSyncedAt}`,
  ];
  if (query.boardId) conditions.push(eq(boardPostings.boardId, query.boardId));
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(
      sql`(${boardPostings.title} LIKE ${pattern} ESCAPE '\\' OR ${boardPostings.location} LIKE ${pattern} ESCAPE '\\' OR ${watchedBoards.companyName} LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (query.onlyNew === 'true') {
    conditions.push(
      gt(boardPostings.firstSeenAt, watchedBoards.createdAt),
      gte(boardPostings.firstSeenAt, addDays(now, -NEW_WINDOW_DAYS)),
      isNull(boardPostings.savedApplicationId),
    );
  }
  const where = and(...conditions);
  const [rows, total] = await Promise.all([
    db
      .select({ posting: boardPostings, board: watchedBoards })
      .from(boardPostings)
      .innerJoin(watchedBoards, eq(watchedBoards.id, boardPostings.boardId))
      .where(where)
      .orderBy(desc(boardPostings.firstSeenAt), boardPostings.title)
      .limit(query.limit)
      .offset(query.offset)
      .all(),
    db
      .select({ n: count() })
      .from(boardPostings)
      .innerJoin(watchedBoards, eq(watchedBoards.id, boardPostings.boardId))
      .where(where)
      .get(),
  ]);
  const body: ListResponse<BoardPosting> = {
    items: rows.map((r) => toBoardPosting(r.posting, r.board, now)),
    total: total?.n ?? 0,
  };
  return c.json(body);
});

async function postingWithBoard(c: { var: AppEnv['Variables'] }, id: string) {
  const row = await c.var.db
    .select({ posting: boardPostings, board: watchedBoards })
    .from(boardPostings)
    .innerJoin(watchedBoards, eq(watchedBoards.id, boardPostings.boardId))
    .where(and(eq(boardPostings.id, id), eq(boardPostings.userId, c.var.user.id)))
    .get();
  if (!row) throw notFound('Posting');
  return row;
}

boardRoutes.post('/postings/:id/save', validate('json', saveSchema), async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const { posting, board } = await postingWithBoard(c, c.req.param('id'));
  const { status } = c.req.valid('json');

  let full = null;
  try {
    full = await fetchJobFromUrl(posting.url, {
      fetch: outboundFetch(c.env),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    full = null;
  }
  const job = jobInputSchema.parse({
    title: posting.title,
    url: posting.url,
    source: board.provider,
    externalId: posting.externalId,
    location: posting.location,
    postedAt: posting.postedAt,
    ...(full ?? {}),
    // The watched board's name beats a name guessed from its URL token.
    company: board.companyName,
  });
  const result = await createApplication(db, c.env, userId, {
    job,
    status,
    capturedVia: 'board',
    source: 'manual',
    summary: `Saved from the ${board.companyName} careers page`,
  });
  await db
    .update(boardPostings)
    .set({ savedApplicationId: result.applicationId })
    .where(eq(boardPostings.id, posting.id));
  return c.json(
    await getApplicationDetail(db, userId, result.applicationId),
    result.duplicate ? 200 : 201,
  );
});

boardRoutes.post('/postings/:id/dismiss', async (c) => {
  const { posting } = await postingWithBoard(c, c.req.param('id'));
  await c.var.db
    .update(boardPostings)
    .set({ dismissed: true })
    .where(eq(boardPostings.id, posting.id));
  return c.body(null, 204);
});

// Sync every watched board now (KAN-69). Registered before the `/:id` routes.
boardRoutes.post('/sync', async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const { synced, failed } = await syncAllBoards(db, c.env, userId);
  const body: BoardSyncAllResponse = { synced, failed, boards: await listBoards(db, userId) };
  return c.json(body);
});

boardRoutes.post('/:id/sync', async (c) => {
  const board = await getBoardRow(c.var.db, c.var.user.id, c.req.param('id'));
  if (!board) throw notFound('Board');
  try {
    await syncBoard(c.var.db, c.env, board);
  } catch {
    // lastError is stored on the board and shown in the response.
  }
  const fresh = (await listBoards(c.var.db, c.var.user.id)).find((b) => b.id === board.id);
  if (!fresh) throw notFound('Board');
  return c.json(fresh);
});

boardRoutes.delete('/:id', async (c) => {
  const board = await getBoardRow(c.var.db, c.var.user.id, c.req.param('id'));
  if (!board) throw notFound('Board');
  await c.var.db.delete(watchedBoards).where(eq(watchedBoards.id, board.id));
  return c.body(null, 204);
});
