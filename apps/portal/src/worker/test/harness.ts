import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import app from '../app';
import type { Env } from '../env';
import { newApiToken, sha256Hex } from '../lib/crypto';

/**
 * Runs the Hono app in Node with real local D1 and R2 bindings from Miniflare (workerd).
 * Each context gets its own in-memory database with all migrations applied.
 *
 *   const t = await createTestContext();
 *   const { status, body } = await t.json<MeResponse>('/api/me');
 *   await t.dispose();
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

export interface TestContext {
  env: Env;
  ctx: ExecutionContext;
  mf: Miniflare;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }>;
  /** Await everything passed to ctx.waitUntil so far. */
  settle(): Promise<void>;
  /** Create an extension API token for the user with this email (provisioning the user). */
  createToken(email?: string): Promise<string>;
  dispose(): Promise<void>;
}

export async function createTestContext(vars: Partial<Env> = {}): Promise<TestContext> {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response(null, { status: 404 }); } }',
      compatibilityDate: '2026-10-15',
      d1Databases: { DB: 'test-db' },
      r2Buckets: { FILES: 'test-files' },
    }),
  );
  const DB = (await mf.getD1Database('DB')) as unknown as D1Database;
  const FILES = (await mf.getR2Bucket('FILES')) as unknown as R2Bucket;
  await applyMigrations(DB);

  const pending: Promise<unknown>[] = [];
  const env: Env = {
    DB,
    FILES,
    AUTH_MODE: 'dev',
    DEV_USER_EMAIL: 'test@example.com',
    INBOUND_EMAIL_DOMAIN: 'jobs.test',
    FOLLOW_UP_AFTER_DAYS: '7',
    GHOST_AFTER_DAYS: '21',
    ADZUNA_COUNTRY: 'us',
    ...vars,
  };
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;

  const fetchApp = async (path: string, init?: RequestInit) =>
    app.fetch(new Request(new URL(path, 'http://localhost'), init), env, ctx);

  return {
    env,
    ctx,
    mf,
    fetch: fetchApp,
    async json<T>(path: string, init?: RequestInit) {
      const res = await fetchApp(path, init);
      return { status: res.status, body: (await res.json()) as T };
    },
    async settle() {
      await Promise.allSettled(pending.splice(0));
    },
    async createToken(email = env.DEV_USER_EMAIL ?? 'test@example.com') {
      const me = await fetchApp('/api/me', { headers: { 'x-dev-user': email } });
      const { user } = (await me.json()) as { user: { id: string } };
      const token = newApiToken();
      await DB.prepare(
        'INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(
          crypto.randomUUID(),
          user.id,
          'test',
          await sha256Hex(token),
          new Date().toISOString(),
        )
        .run();
      return token;
    },
    dispose: () => mf.dispose(),
  };
}

async function applyMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const s = statement.trim();
      if (s) await db.prepare(s).run();
    }
  }
}

/** RequestInit for a JSON body. */
export function jsonBody(
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}
