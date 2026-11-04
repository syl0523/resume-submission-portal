# Working in this repo

Resume Submission Portal: a personal job-application portal. One Cloudflare Worker serves the REST API, the
React app, an inbound-email handler and a daily cron. A Chrome extension clips job pages and autofills
company application forms. See `docs/architecture.md` for the why, `docs/api.md` for the contract.

## Layout

| Path                     | What                                                                               | Runtime                            |
| ------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/core`          | Enums, Zod request schemas, response types, status engine                          | anywhere                           |
| `packages/integrations`  | Pure logic: URL analysis, email classification, CSV import, board + Adzuna clients | anywhere (no DOM, no Workers APIs) |
| `apps/portal/src/worker` | Hono API, email + cron handlers, Drizzle/D1, R2                                    | Cloudflare Workers                 |
| `apps/portal/src/client` | React 19 SPA                                                                       | browser                            |
| `apps/extension`         | Chrome MV3 extension (esbuild)                                                     | browser                            |

## Commands

```bash
pnpm install
pnpm check                      # biome + typecheck + tests, run before every commit
pnpm dev                        # portal at http://localhost:5173 (dev user, local D1)
pnpm --filter @jsp/portal test  # one package
pnpm --filter @jsp/portal db:generate   # after editing src/worker/db/schema.ts
pnpm format                     # biome --write
```

## Rules

- **The contract is `packages/core` + `docs/api.md`.** Change both together, in the same commit, or not at all.
- **Status changes go through `decideTransition`** (packages/core/src/status.ts). Never write `status` directly.
- **Every query is scoped by `user_id`.** Another user's id is a 404.
- **D1 limits:** no interactive transactions (use `db.batch([...])` for atomic writes); max 100 bound
  parameters per statement (use `chunk()` from `db/client.ts` for multi-row inserts).
- **No LinkedIn/Indeed automation.** No server-side fetching of their pages, no auto-submit, no autofill on
  their sites. See `docs/adr/0002-assisted-apply-not-automation.md`.
- **Test fixtures are synthetic.** Never commit real emails, resumes or personal data.
- **Integrations take an injectable `fetch`** and never read env vars; the Worker passes keys in.
- Worker tests use `src/worker/test/harness.ts` (real local D1/R2 via Miniflare). Pure logic gets unit tests next to the file.
- Errors: throw `HttpError(status, code, message)`; validate with `validate('json', schema)` from `lib/validate.ts`.
- TypeScript strict with `noUncheckedIndexedAccess`; no `any`, no non-null assertions on parsed input.

## Tracking

Jira project **KAN** at https://roysunsyl.atlassian.net (epics KAN-4..KAN-11). Confluence space **JSP**.
Branch names and PR titles start with the Jira key (`KAN-16-applications-api`, `KAN-16 Applications API`),
commit messages too (`KAN-16: add dedupe on create`), so GitHub for Jira links them.
