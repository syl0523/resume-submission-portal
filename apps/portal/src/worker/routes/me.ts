import type { MeResponse } from '@jsp/core';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { aiEnabled } from '../services/ai';
import { inboundAddressFor } from '../services/users';

export const meRoutes = new Hono<AppEnv>().get('/', (c) => {
  const user = c.var.user;
  const inboundAddress = inboundAddressFor(user, c.env.INBOUND_EMAIL_DOMAIN);
  const origin = new URL(c.req.url).origin;
  const body: MeResponse = {
    user,
    inboundAddress,
    calendarUrl: `${origin}/api/calendar/${user.calendarToken}.ics`,
    features: {
      ai: aiEnabled(c.env),
      adzuna: Boolean(c.env.ADZUNA_APP_ID && c.env.ADZUNA_APP_KEY),
      usajobs: Boolean(c.env.USAJOBS_API_KEY && c.env.USAJOBS_USER_AGENT),
      jsearch: Boolean(c.env.JSEARCH_API_KEY),
      inboundEmail: inboundAddress !== null,
    },
  };
  return c.json(body);
});
