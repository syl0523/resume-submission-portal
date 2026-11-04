import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { apiTokens, users } from '../db/schema';
import type { AppEnv } from '../env';
import { ensureUser } from '../services/users';
import { sha256Hex } from './crypto';
import { HttpError } from './errors';
import { nowIso } from './time';

type Jwks = ReturnType<typeof createRemoteJWKSet>;
const jwksByIssuer = new Map<string, Jwks>();

function jwksFor(issuer: string): Jwks {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * Portal session auth.
 * - AUTH_MODE=access: verifies the Cloudflare Access JWT (Cf-Access-Jwt-Assertion header or
 *   CF_Authorization cookie) against the team's signing keys and the application AUD.
 * - AUTH_MODE=dev: a fixed local user (DEV_USER_EMAIL, or the x-dev-user header). Only
 *   honoured on localhost, so a mis-deployed dev config fails closed.
 */
export const sessionAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const mode = c.env.AUTH_MODE ?? 'access';
  let email: string | null = null;

  if (mode === 'dev') {
    if (!isLocalHost(new URL(c.req.url).hostname)) {
      throw new HttpError(403, 'dev_auth_remote', 'Dev sign-in only works on localhost');
    }
    email = c.req.header('x-dev-user') ?? c.env.DEV_USER_EMAIL ?? 'dev@example.com';
  } else if (mode === 'access') {
    const team = c.env.ACCESS_TEAM_DOMAIN?.trim();
    const aud = c.env.ACCESS_AUD?.trim();
    if (!team || !aud) {
      throw new HttpError(
        500,
        'auth_not_configured',
        'Cloudflare Access is not configured (set ACCESS_TEAM_DOMAIN and ACCESS_AUD)',
      );
    }
    const token = c.req.header('cf-access-jwt-assertion') ?? getCookie(c, 'CF_Authorization');
    if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in to continue');
    const issuer = `https://${team.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
    try {
      const { payload } = await jwtVerify(token, jwksFor(issuer), { issuer, audience: aud });
      email = typeof payload.email === 'string' ? payload.email : null;
    } catch {
      throw new HttpError(401, 'unauthenticated', 'Your session is invalid or expired');
    }
  } else {
    throw new HttpError(500, 'auth_not_configured', `Unknown AUTH_MODE "${mode}"`);
  }

  if (!email) throw new HttpError(401, 'unauthenticated', 'No email on the session');
  c.set('user', await ensureUser(c.var.db, email));
  await next();
};

/** Extension auth: `Authorization: Bearer jsp_...` personal API token (created in Settings). */
export const bearerAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
  const token = match?.[1];
  if (!token) throw new HttpError(401, 'missing_token', 'Missing API token');

  const tokenHash = await sha256Hex(token);
  const row = await c.var.db
    .select({ tokenId: apiTokens.id, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, tokenHash))
    .get();
  if (!row) throw new HttpError(401, 'invalid_token', 'This API token is invalid or was revoked');

  const touch = c.var.db
    .update(apiTokens)
    .set({ lastUsedAt: nowIso() })
    .where(eq(apiTokens.id, row.tokenId))
    .then(() => undefined);
  try {
    c.executionCtx.waitUntil(touch);
  } catch {
    await touch;
  }

  c.set('user', row.user);
  await next();
};
