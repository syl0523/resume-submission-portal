# ADR 0001: One Cloudflare Worker for API, app, email and cron

- Status: accepted (2026-11-03)
- Jira: KAN-4

## Context

A personal portal needs a REST API, a web app, a database, file storage for resumes, an inbound email
endpoint and a daily scheduled job. It should cost close to nothing and need no server maintenance.

## Decision

A single Cloudflare Worker (TypeScript, Hono) with:

- static assets for the React app (`run_worker_first` for `/api/*`),
- D1 (SQLite) via Drizzle ORM, R2 for files,
- `email()` handler fed by Cloudflare Email Routing,
- `scheduled()` handler for the daily cron,
- Cloudflare Access in front for sign-in.

Built with Vite and the Cloudflare Vite plugin; tested in Node against real local D1/R2 from Miniflare.

## Alternatives considered

| Option                                                         | Why not                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Next.js on Vercel + Supabase + Postmark inbound + a job runner | Four vendors and four bills for one person's data; inbound email needs another service. |
| Container on a VPS (Node + Postgres)                           | Always-on cost and patching.                                                            |
| Separate API and web deployments                               | CORS and cookie handling for no benefit at this size.                                   |

## Consequences

- One deploy, same-origin API, free tier covers personal use.
- D1 limits apply: no interactive transactions (use `batch`), 100 bound parameters per statement.
- Email Routing needs a domain on Cloudflare; without one, the Inbox "paste an email" path still works.
