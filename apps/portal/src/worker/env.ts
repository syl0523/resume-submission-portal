import type { Db } from './db/client';

/** Bindings and vars declared in wrangler.jsonc (+ secrets). */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS?: Fetcher;

  /** "access" (Cloudflare Access JWT, production) or "dev" (fixed local user). */
  AUTH_MODE?: string;
  DEV_USER_EMAIL?: string;
  /** e.g. "yourteam.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application. */
  ACCESS_AUD?: string;
  /** Domain routed to this Worker by Email Routing, e.g. "jobs.example.com". */
  INBOUND_EMAIL_DOMAIN?: string;
  FOLLOW_UP_AFTER_DAYS?: string;
  GHOST_AFTER_DAYS?: string;

  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  /** Adzuna country index, default "us". */
  ADZUNA_COUNTRY?: string;
  /** USAJOBS (https://developer.usajobs.gov): API key + the email it was registered with. */
  USAJOBS_API_KEY?: string;
  USAJOBS_USER_AGENT?: string;
  /** JSearch on RapidAPI (Google for Jobs: LinkedIn, Indeed, company sites). */
  JSEARCH_API_KEY?: string;
  JSEARCH_HOST?: string;

  ANTHROPIC_API_KEY?: string;
  AI_MODEL_FAST?: string;
  AI_MODEL_SMART?: string;

  /** Outbound fetch for job-board, search and AI APIs. Tests inject a fake; production omits it. */
  OUTBOUND_FETCH?: typeof fetch;
}

/** The fetch to use for third-party APIs. */
export function outboundFetch(env: Env): typeof fetch {
  return env.OUTBOUND_FETCH ?? ((input, init) => fetch(input, init));
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  inboundAlias: string;
  calendarToken: string;
  createdAt: string;
}

/** Hono generics for every route in the Worker. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Db;
    user: AuthUser;
  };
}

export function numberVar(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
