import type { ApplicationDetail, MeResponse } from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app';
import { foldLine, icsText } from '../lib/ics';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

describe('calendar feed', () => {
  let t: TestContext;
  let calendarPath: string;

  beforeAll(async () => {
    t = await createTestContext();
    const me = await t.json<MeResponse>('/api/me');
    calendarPath = new URL(me.body.calendarUrl).pathname;

    const created = await t.json<ApplicationDetail>(
      '/api/applications',
      jsonBody('POST', {
        job: { title: 'HR Generalist', company: 'Northwind, Freight', url: null },
        status: 'applied',
        appliedAt: new Date().toISOString(),
      }),
    );
    await t.json(
      `/api/applications/${created.body.application.id}/interviews`,
      jsonBody('POST', {
        scheduledAt: '2099-11-17T19:00:00Z',
        title: 'Panel interview',
        location: 'Zoom; link in email',
      }),
    );
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('serves interviews and follow-ups without a session', async () => {
    // Access mode with no session: the token in the URL is the only credential needed.
    const res = await app.fetch(
      new Request(`https://portal.example.com${calendarPath}`),
      {
        ...t.env,
        AUTH_MODE: 'access',
        ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
        ACCESS_AUD: 'aud',
      },
      t.ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    const ics = await res.text();
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain('DTSTART:20991117T190000Z');
    expect(ics).toContain('DTEND:20991117T200000Z');
    expect(ics).toContain('SUMMARY:Interview: HR Generalist at Northwind\\, Freight');
    expect(ics).toContain('DESCRIPTION:Panel interview (Zoom\\; link in email)');
    expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
    expect(ics).toContain('SUMMARY:Follow up: HR Generalist at Northwind\\, Freight');
    expect(ics).toContain('URL:https://portal.example.com/applications/');
  });

  it('returns 404 for unknown tokens and non-ics paths', async () => {
    expect((await t.fetch('/api/calendar/not-a-token.ics')).status).toBe(404);
    expect((await t.fetch(calendarPath.replace('.ics', '.txt'))).status).toBe(404);
  });

  it('escapes text and folds long lines', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    for (const line of folded.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
