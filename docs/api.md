# API contract

All endpoints live under `/api` on the portal's own origin. Request bodies are validated with the Zod
schemas in `packages/core/src/schemas.ts`; responses use the types in `packages/core/src/types.ts`.
Timestamps are ISO-8601 UTC strings. Ids are UUIDs.

## Conventions

| Topic            | Rule                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Auth (portal)    | Cloudflare Access session (`Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie). Local dev: fixed user, localhost only. |
| Auth (extension) | `Authorization: Bearer jsp_…` personal token from Settings. CORS `*`, no cookies.                                                 |
| Errors           | `{ "error": { "code": string, "message": string, "details"?: unknown } }` with a matching HTTP status.                            |
| Validation       | 400 `invalid_request`, `details` = Zod issues.                                                                                    |
| Scoping          | Every query is scoped to the signed-in user. Another user's id returns 404, never 403.                                            |
| Empty values     | Clients send `null` (not `""`) for empty optional fields.                                                                         |
| Lists            | `ListResponse<T> = { items: T[]; total: number }` with `limit`/`offset` query params where noted.                                 |

Error codes: `invalid_request` 400 · `unauthenticated` / `missing_token` / `invalid_token` 401 ·
`dev_auth_remote` 403 · `not_found` 404 · `duplicate` 409 · `payload_too_large` 413 ·
`unsupported_media_type` 415 · `unprocessable` 422 · `feature_disabled` 501 · `upstream_error` 502 ·
`auth_not_configured` / `internal` 500.

## Platform

| Method & path     | Body / query | Response                       |
| ----------------- | ------------ | ------------------------------ |
| `GET /api/health` | –            | `{ ok: true, time }` (no auth) |
| `GET /api/me`     | –            | `MeResponse`                   |

## Applications

One application per saved job. Status `saved` is the wishlist.

| Method & path                           | Body / query               | Response                                                               |
| --------------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `GET /api/applications`                 | `ListApplicationsQuery`    | `ListResponse<ApplicationListItem>`                                    |
| `POST /api/applications`                | `CreateApplicationRequest` | 201 `ApplicationDetail` · 409 `duplicate` with `details.applicationId` |
| `POST /api/applications/resolve-url`    | `ResolveUrlRequest`        | `ResolveUrlResponse`                                                   |
| `GET /api/applications/:id`             | –                          | `ApplicationDetail` (events newest first)                              |
| `PATCH /api/applications/:id`           | `UpdateApplicationRequest` | `ApplicationDetail`                                                    |
| `DELETE /api/applications/:id`          | –                          | 204 (deletes the job too)                                              |
| `POST /api/applications/:id/status`     | `StatusChangeRequest`      | `ApplicationDetail`                                                    |
| `POST /api/applications/:id/notes`      | `NoteRequest`              | 201 `ApplicationEvent`                                                 |
| `POST /api/applications/:id/interviews` | `InterviewRequest`         | 201 `ApplicationEvent` (type `interview`, in the calendar feed)        |
| `GET /api/applications/export.csv`      | same filters as the list   | CSV download of every matching application (register before `/:id`)    |

Rules:

- **List**: `q` matches title, company, location and notes (case-insensitive). `status` takes one value or a
  comma-separated list. `sort`: `activity` (default, `lastActivityAt` desc), `created`, `applied`
  (`appliedAt` desc, nulls last), `company` (A→Z), `fit` (`fitScore` desc, nulls last). Default `limit` 100, max 500.
- **Create / dedupe**: the URL is canonicalised with `analyzeJobUrl`; `source` and `externalId` are filled from
  the URL when the client sent `manual`/`other` or omitted them. A job is a duplicate when the user already has
  the same `url_key`, or the same `source` + `externalId`. `companyKey = normalizeCompany(company)`. Without
  `fitScore`, the job is scored against the user's saved searches (the best `scoreJobFit` score; null when there
  are none).
- **Applied**: creating with a status past `saved`, or moving to `applied`, sets `appliedAt` (if empty) to now and
  `nextFollowUpAt = appliedAt + FOLLOW_UP_AFTER_DAYS`. Moving to a final status clears `nextFollowUpAt`.
- **Status changes** from this endpoint are `manual` and go through `decideTransition`; a no-op returns 200 with
  no new event. Moving to `interview` with `interviewAt` also adds an `interview` event (`scheduledAt`). Every applied change writes a `status_change` event (`fromStatus`, `toStatus`, `source`).
- **`lastActivityAt`** moves on creation, status changes and emails. Notes do not move it (it measures
  employer silence for the no-response rule).
- **Resolve URL**: canonicalises the URL, fetches details from the official board API when the URL belongs to
  Greenhouse, Lever, Ashby or SmartRecruiters (`fetched: true`), and reports an existing application for the
  same URL. LinkedIn and Indeed URLs are never fetched server-side; `message` explains that the extension or
  manual entry fills in the details. When the board lookup fails, `fetched` is false and `message` says so; a 404
  from the board says the posting may have closed.

## Resumes

| Method & path               | Body / query                                                          | Response                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/resumes`          | `includeArchived` (`true`/`false`)                                    | `Resume[]` (default first, then newest; archived hidden unless asked)                                                                       |
| `POST /api/resumes`         | multipart: `file` (required), `label`, `isDefault` (`"true"`), `text` | 201 `Resume`                                                                                                                                |
| `GET /api/resumes/:id/file` | –                                                                     | the file (`Content-Disposition: attachment`)                                                                                                |
| `PATCH /api/resumes/:id`    | `ResumeUpdateRequest`                                                 | `Resume`                                                                                                                                    |
| `DELETE /api/resumes/:id`   | –                                                                     | 204. Deletes the file when no application used it; otherwise archives it, because applications must keep pointing at exactly what was sent. |

Files: max 5 MB; PDF, DOC, DOCX, ODT, RTF or TXT (checked by extension and MIME type), else 415. The first
resume becomes the default; setting `isDefault: true` clears it on the others. R2 key:
`resumes/<userId>/<resumeId>/<fileName>`.

## Profile (autofill data)

| Method & path                         | Body / query             | Response                                                                                                                                                      |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/profile`                    | –                        | `Profile` (all null when unset; `email` defaults to the account email)                                                                                        |
| `PUT /api/profile`                    | `ProfileRequest`         | `Profile`                                                                                                                                                     |
| `POST /api/profile/draft-from-resume` | `DraftFromResumeRequest` | `Profile` draft, **not saved**: contact details, headline, summary, skills, languages, work history and education read from the resume by AI (501 without AI) |

## Dashboard

`GET /api/stats` → `DashboardStats`

- `submitted` = applications not in `saved`. `responded` = submitted applications currently in `viewed`,
  `screening`, `interview`, `offer` or `rejected`. `responseRate = responded / submitted` (0 when none).
- `interviewRate` = submitted applications that ever reached `screening`, `interview` or `offer` (current
  status, or any timeline entry that moved them there: manual, email or import) / submitted.
- `appliedLast7Days` / `appliedLast30Days`: applications with `appliedAt` in the last 7 / 30 days.
- `followUpsDue`: active applications with `nextFollowUpAt <= now`, oldest first, max 10.
- `upcomingInterviews`: `interview` events scheduled from now on, soonest first, max 10, leaving out
  rejected and withdrawn applications.
- `recentEvents`: latest 15 events with company and title.
- `weekly`: last 12 ISO weeks (Monday, UTC), oldest first. `applied` = applications with `appliedAt` in the
  week; `responses` = status changes into a responded status in the week, however they arrived (timeline
  entries with `fromStatus` set: manual `status_change`, `email` or `import`).
- `bySource`: application count per job source, descending.

## Inbox (email-based status tracking)

| Method & path                | Body / query                                                     | Response                                                                                          |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/inbox`             | `status` (`all` default, or an `InboxStatus`), `limit`, `offset` | `ListResponse<InboxItem>` (newest first)                                                          |
| `POST /api/inbox/paste`      | `PasteEmailRequest`                                              | 201 `IngestResult`                                                                                |
| `POST /api/inbox/:id/link`   | `LinkInboxRequest`                                               | `InboxItem` (applies the implied status, adds an `email` event)                                   |
| `POST /api/inbox/:id/create` | –                                                                | 201 `IngestResult` (new application from the email's company and title; 422 if either is missing) |
| `POST /api/inbox/:id/ignore` | –                                                                | `InboxItem`                                                                                       |

### Ingest pipeline (inbound email and paste share it)

1. Decode (postal-mime for raw MIME), then `unwrapForwarded`.
2. `classifyEmail`. If `confidence < 0.6` and AI is configured, ask the AI classifier and keep the more
   confident answer (`classifier: 'ai'`).
3. Idempotency: an existing `(userId, messageId)` returns the stored item without reprocessing.
4. Kind `other` → inbox status `ignored` (kept for review).
5. `matchApplication` against the user's applications (most recent 500 by activity).
6. Match → `EMAIL_KIND_TO_STATUS[kind]` through `decideTransition(current, proposed, 'email')`; always add an
   `email` timeline event (with `fromStatus`/`toStatus` when the status changed). Interview emails with
   `interviewAt` also add an `interview` event (calendar). Inbox status `matched`.
7. No match and kind `application_received` with company and title → create the job (`capturedVia: 'email'`,
   source from the provider: linkedin, indeed, greenhouse, lever, ashby, workday, smartrecruiters, else
   `email`) and an `applied` application (`appliedAt` = email date; `appliedVia` = `linkedin_easy_apply`,
   `indeed_apply` or `company_site`). Inbox status `created`.
8. Otherwise inbox status `unmatched`. Processing errors are stored with status `error`, never thrown to the
   email sender.

Inbound email (Cloudflare Email Routing → Worker `email()` handler): the recipient local part is the user's
`inboundAlias` (`jobs-xxxxxxxx@INBOUND_EMAIL_DOMAIN`). Unknown aliases are rejected with
`message.setReject('Unknown recipient')`. Raw messages are stored at
`inbound/<userId>/<yyyy>/<mm>/<inboxId>.eml` in R2.

## Imports

`POST /api/imports` — multipart: `file` (CSV, max 2 MB), `format` = `auto` (default) | `linkedin` | `generic`
→ `ImportResult`.

A row matches an existing application by URL key, else by `companyKey` + normalised title. Matches are
updated (status forward via `decideTransition(..., 'import')`, empty `appliedAt` filled) and counted as
`updated`, or `skipped` when nothing changes. New rows create a job (`capturedVia: 'import'`) and an
application with an `import` event, scored against your saved searches like `POST /api/applications`.
Row-level problems go to `errors`.

## Watched company boards

| Method & path                           | Body / query                                                  | Response                                                                                          |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/boards`                       | –                                                             | `WatchedBoard[]`                                                                                  |
| `POST /api/boards`                      | `BoardCreateRequest`                                          | 201 `WatchedBoard` (fetches once to validate and baseline; 409 `duplicate`; 502 `upstream_error`) |
| `DELETE /api/boards/:id`                | –                                                             | 204                                                                                               |
| `POST /api/boards/:id/sync`             | –                                                             | `WatchedBoard`                                                                                    |
| `GET /api/boards/postings`              | `boardId`, `onlyNew` (`true`/`false`), `q`, `limit`, `offset` | `ListResponse<BoardPosting>` (open, not dismissed)                                                |
| `POST /api/boards/postings/:id/save`    | `{ status?: 'saved' \| 'applied' }`                           | 201 `ApplicationDetail` (200 with the existing application when the job was already saved)        |
| `POST /api/boards/postings/:id/dismiss` | –                                                             | 204                                                                                               |

Open = seen in the latest sync. `isNew` = first seen after the board's baseline sync, within the last 7
days, and not saved. The baseline is the board's first successful sync (on create, or the first cron sync
of a board that has never synced). Syncs store titles, locations and links only (Greenhouse is listed
without descriptions); saving fetches full details with `fetchJobFromUrl` when possible. A failed sync keeps
the previous postings and records the reason in `lastError`. The daily cron syncs every board not synced in
the last 20 hours (at most 30 a day: healthy boards first, then failing ones, oldest sync first) and marks
active applications with no activity for `GHOST_AFTER_DAYS` (default 21) as `ghosted` (source `system`,
`lastActivityAt` unchanged).

## Saved searches (Job Match, US-first)

A saved search is a named track ("HR Manager, remote US") with criteria drafted from a resume. Each run
stores its postings as hits, so the portal can show what is new.

| Method & path                            | Body / query             | Response                                                                                                                                     |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/searches`                      | –                        | `SavedSearch[]`                                                                                                                              |
| `POST /api/searches`                     | `SavedSearchRequest`     | 201 `SavedSearch`                                                                                                                            |
| `POST /api/searches/draft-from-resume`   | `DraftFromResumeRequest` | `SavedSearchDraft`, **not saved** (501 without AI; 422 when the resume has no usable content)                                                |
| `GET /api/searches/:id`                  | –                        | `SavedSearch`                                                                                                                                |
| `PUT /api/searches/:id`                  | `SavedSearchRequest`     | `SavedSearch`                                                                                                                                |
| `DELETE /api/searches/:id`               | –                        | 204 (hits go with it)                                                                                                                        |
| `POST /api/searches/:id/run`             | `RunSearchRequest`       | `RunSearchResponse`                                                                                                                          |
| `GET /api/searches/:id/hits`             | `ListHitsQuery`          | `ListResponse<SearchHit>`                                                                                                                    |
| `GET /api/searches/:id/links`            | –                        | `DeepLinkGroup[]` (pre-filled LinkedIn / Indeed / Google Jobs searches)                                                                      |
| `POST /api/searches/hits/:hitId/save`    | `SaveHitRequest`         | 201 `ApplicationDetail` (`capturedVia: "search"`, `fitScore` from the hit; 200 with the existing application when the job was already saved) |
| `POST /api/searches/hits/:hitId/dismiss` | –                        | 204                                                                                                                                          |

How a run works (`POST /api/searches/:id/run`):

1. `planQueries(criteria, maxQueries)` → title x location queries (remote flag from `workMode` or a "Remote"
   location).
2. Fan out to every requested provider that is configured, in parallel (`Promise.allSettled`), 10 s timeout per
   call: `jsearch` (LinkedIn, Indeed and company sites via Google for Jobs), `adzuna` (country
   `ADZUNA_COUNTRY`, default `us`), `usajobs` (federal), `boards` (open postings on watched company boards,
   filtered locally by title similarity). Unconfigured providers report `error: "not_configured"`; one failing
   provider never fails the run.
3. `dedupeJobs` merges the same job seen on several sites (URL key, then company + similar title + location),
   keeping the employer's own apply link and the richest description.
4. `scoreJobFit(criteria, job)` on every posting; `needsSponsorship` turns sponsorship/citizenship/clearance
   flags into exclusions.
5. `aiRerank: true` and AI configured → a fast AI model (Claude Haiku, or Workers AI) re-scores the top 20 with a one-line reason.
6. Upsert hits by `(searchId, urlKey)`: clear `isNew` on the search's previous hits, then mark postings never
   seen before as new (except on the search's first run). Link hits to existing applications by URL key.
   Update `lastRunAt`.
7. Return this run's hits ranked by fit (AI score where present), excluded last, plus `deepLinks`.

The daily cron runs every search with `alertsEnabled` (at most 2 queries per provider, to protect quotas).
`DashboardStats.newMatches` counts new, undismissed, unsaved hits.

`POST /api/searches/draft-from-resume` sends the resume to the AI engine (Claude: PDF as a document block;
Workers AI: PDF/DOCX converted to text; other files use the stored text) and asks for a track name, titles (current level, one step up and adjacent roles), skills,
seniority, US locations, work mode and a one-line summary. The user reviews and saves it.

## Discover (keyword search)

`GET /api/discover` — `DiscoverQuery` → `DiscoverResponse`. Same providers as Job Match, but for one keyword
query (`q`, `where`, `remote`, `provider=all|jsearch|adzuna|usajobs|boards`). Items are not fit-scored.

## AI assist (optional)

| Method & path         | Body / query      | Response    |
| --------------------- | ----------------- | ----------- |
| `POST /api/ai/fit`    | `FitRequest`      | `FitReport` |
| `POST /api/ai/answer` | `AiAnswerRequest` | `AiAnswer`  |

- **Fit**: uses `resumeId`, else the application's resume, else the default resume. PDFs are sent as a
  document; other files need stored text (`textContent`). Cached per application + resume in `ai_reports`;
  `refresh: true` recomputes, `coverLetter: true` always recomputes. 422 `unprocessable` without a job
  description or usable resume.
- **Answer**: drafts an answer to an application question from the profile (summary, experience, skills,
  saved answers) and the job (`applicationId` or `jobDescription`), within `maxWords`. Truthful to the
  profile; never invents experience.
- Engine, per call: Claude when `ANTHROPIC_API_KEY` is set; otherwise Cloudflare Workers AI through the
  `AI` binding (KAN-67). Every AI route returns 501 `feature_disabled` only when neither is available.
  `MeResponse.features.ai` is true with either engine.
- Claude models: `AI_MODEL_SMART` (default `claude-opus-5-5`) writes fit reports, cover letters, answers and
  the profile / saved-search drafts; `AI_MODEL_FAST` (default `claude-haiku-5-5`) handles the email second
  opinion and Job Match re-ranking. Structured answers use JSON-schema outputs; resumes go in as a PDF
  document block (other files: their stored text), marked for prompt caching. Opus/Sonnet requests opt into
  server-side refusal fallback (`fallbacks: "default"`).
- Workers AI: `AI_MODEL_WORKERS` (default `@cf/google/gemma-4-26b-a4b-it`) serves every feature. Resumes
  are converted to text with `env.AI.toMarkdown` (PDF, DOCX; otherwise the stored text), capped at 40,000
  characters. Structured answers use JSON mode plus the schema in the prompt, are validated with Zod and
  retried once when invalid. The `model` field of AI responses then holds the `@cf/...` model id. Scanned
  (image-only) PDFs have no text: paste the text on the Resumes page.
- A declined request is 422 `unprocessable`; an AI service failure (after the SDK's retries) is 502
  `upstream_error`.

## Calendar feed

`GET /api/calendar/:token.ics` → `text/calendar` (no session; the secret token in `MeResponse.calendarUrl`
authenticates). Contains `interview` events (`scheduledAt`, 60 minutes, "Interview: {title} at {company}",
link back to the application) and all-day follow-up reminders (`nextFollowUpAt`) for active applications.
Unknown token → 404. With Cloudflare Access in front, add a bypass policy for `/api/calendar/*` (as for
`/api/ext/*`).

## Extension API tokens

| Method & path            | Body / query         | Response                                                                       |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------ |
| `GET /api/tokens`        | –                    | `ApiTokenInfo[]`                                                               |
| `POST /api/tokens`       | `TokenCreateRequest` | 201 `CreatedApiToken` (the token is returned once; only its SHA-256 is stored) |
| `DELETE /api/tokens/:id` | –                    | 204                                                                            |

## Extension endpoints (bearer token)

| Method & path                   | Body / query        | Response                                                                                                                                                    |
| ------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/ext/ping`             | –                   | `{ ok: true, email }`                                                                                                                                       |
| `GET /api/ext/profile`          | –                   | `ExtProfileResponse` (includes saved searches for the popup's fit badge)                                                                                    |
| `GET /api/ext/lookup`           | `url`               | `ExtLookupResponse`                                                                                                                                         |
| `POST /api/ext/jobs`            | `ExtSaveJobRequest` | 201 `ExtSaveResponse` (new) · 200 with `duplicate: true` (existing; `markApplied` still moves `saved` → `applied` via `decideTransition(..., 'extension')`) |
| `GET /api/ext/resumes/:id/file` | –                   | the file (for attaching during autofill)                                                                                                                    |
| `POST /api/ext/answer`          | `AiAnswerRequest`   | `AiAnswer` (the popup's "Suggest an answer")                                                                                                                |

`portalUrl` = `<request origin>/applications/<id>`.
