import { type ApiTokenInfo, type CreatedApiToken, tokenCreateSchema } from '@jsp/core';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { apiTokens } from '../db/schema';
import type { AppEnv } from '../env';
import { newApiToken, newId, sha256Hex } from '../lib/crypto';
import { notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { validate } from '../lib/validate';

/**
 * Personal API tokens for the browser extension (KAN-17). Mounted at /api/tokens.
 * The token is returned once at creation; only its SHA-256 is stored.
 */
export const tokenRoutes = new Hono<AppEnv>();

tokenRoutes.get('/', async (c) => {
  const rows: ApiTokenInfo[] = await c.var.db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, c.var.user.id))
    .orderBy(desc(apiTokens.createdAt))
    .all();
  return c.json(rows);
});

tokenRoutes.post('/', validate('json', tokenCreateSchema), async (c) => {
  const token = newApiToken();
  const row = {
    id: newId(),
    userId: c.var.user.id,
    name: c.req.valid('json').name,
    tokenHash: await sha256Hex(token),
    createdAt: nowIso(),
    lastUsedAt: null,
  };
  await c.var.db.insert(apiTokens).values(row);
  const body: CreatedApiToken = {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: null,
    token,
  };
  return c.json(body, 201, { 'cache-control': 'no-store' });
});

tokenRoutes.delete('/:id', async (c) => {
  const deleted = await c.var.db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, c.req.param('id')), eq(apiTokens.userId, c.var.user.id)))
    .returning({ id: apiTokens.id });
  if (deleted.length === 0) throw notFound('Token');
  return c.body(null, 204);
});
