import type { ApiErrorBody, MeResponse } from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from './app';
import { createTestContext, type TestContext } from './test/harness';

describe('platform', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('serves a health check without auth', async () => {
    const { status, body } = await t.json<{ ok: boolean }>('/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('provisions the dev user with an inbound address on first request', async () => {
    const { status, body } = await t.json<MeResponse>('/api/me');
    expect(status).toBe(200);
    expect(body.user.email).toBe('test@example.com');
    expect(body.inboundAddress).toMatch(/^jobs-[a-z2-9]{8}@jobs\.test$/);
    expect(body.calendarUrl).toMatch(/^http:\/\/localhost\/api\/calendar\/[a-z2-9]{32}\.ics$/);
    expect(body.features).toEqual({
      ai: false,
      adzuna: false,
      usajobs: false,
      jsearch: false,
      inboundEmail: true,
    });

    const again = await t.json<MeResponse>('/api/me');
    expect(again.body.user.id).toBe(body.user.id);
  });

  it('keeps users apart', async () => {
    const a = await t.json<MeResponse>('/api/me', { headers: { 'x-dev-user': 'a@example.com' } });
    const b = await t.json<MeResponse>('/api/me', { headers: { 'x-dev-user': 'b@example.com' } });
    expect(a.body.user.id).not.toBe(b.body.user.id);
    expect(a.body.user.inboundAlias).not.toBe(b.body.user.inboundAlias);
  });

  it('refuses dev auth from a non-local host', async () => {
    const res = await app.fetch(new Request('https://portal.example.com/api/me'), t.env, t.ctx);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('dev_auth_remote');
  });

  it('fails closed when Access is not configured', async () => {
    const res = await app.fetch(
      new Request('https://portal.example.com/api/me'),
      { ...t.env, AUTH_MODE: 'access' },
      t.ctx,
    );
    expect(res.status).toBe(500);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('auth_not_configured');
  });

  it('requires a session token in Access mode', async () => {
    const res = await app.fetch(
      new Request('https://portal.example.com/api/me'),
      {
        ...t.env,
        AUTH_MODE: 'access',
        ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
        ACCESS_AUD: 'aud',
      },
      t.ctx,
    );
    expect(res.status).toBe(401);
  });

  it('protects extension routes with a bearer token', async () => {
    expect((await t.fetch('/api/ext/ping')).status).toBe(401);
    expect(
      (await t.fetch('/api/ext/ping', { headers: { authorization: 'Bearer jsp_nope' } })).status,
    ).toBe(401);

    const token = await t.createToken();
    const { status, body } = await t.json<{ ok: boolean; email: string }>('/api/ext/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.email).toBe('test@example.com');
    await t.settle();
  });

  it('answers extension CORS preflight', async () => {
    const res = await t.fetch('/api/ext/jobs', {
      method: 'OPTIONS',
      headers: {
        origin: 'chrome-extension://abc',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const { status, body } = await t.json<ApiErrorBody>('/api/nope');
    expect(status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });
});
