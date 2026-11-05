# Resume Submission Portal

One place to find US jobs that fit your resume, apply with less typing, and know where every application
stands, without handing your LinkedIn or Indeed account to a bot.

## What it does

- **Job Match.** Saved searches drafted from your resume, run across LinkedIn, Indeed and company sites
  (JSearch / Google for Jobs), Adzuna US, USAJOBS and the company boards you watch. Duplicates merged, every
  posting scored for fit, sponsorship and clearance language flagged, new postings highlighted daily. One-click
  pre-filled LinkedIn, Indeed and Google Jobs searches work even with no API keys.
- **Assisted apply.** A Chrome extension saves any job page in one click with its fit score, and autofills
  Greenhouse, Lever and Ashby forms from your profile and resume for you to review and submit. AI drafts
  answers to open questions.
- **Automatic tracking.** Forward application emails to your private portal address; confirmations,
  "viewed" notices, assessments, interview invites, rejections and offers move each application along.
  Interviews go to a calendar feed; follow-ups come due on the dashboard.
- **Your record.** Resume versions are immutable and linked to each application; full timeline; CSV export;
  import your LinkedIn application history.

## Status

Phase 1 runs end to end locally (`pnpm dev`) and is deployed to Cloudflare; turning on sign-in is next. As of November 2026:

| Area                                                                   | State                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| API, data model and status engine                                      | Done                                                     |
| Email forwarding and automatic tracking                                | Done                                                     |
| CSV and LinkedIn import, company boards, daily cron, calendar feed     | Done                                                     |
| Job Match: saved searches, fit scoring, duplicate merging, Discover    | Done                                                     |
| AI (Claude): resume drafts, fit reports, answers, email second opinion | Done                                                     |
| Web app                                                                | Done                                                     |
| Chrome extension: save with fit, mark applied, autofill, AI answers    | Done; Chrome Web Store listing later (KAN-36)            |
| Production on Cloudflare                                               | Deployed; sign-in (Access), keys and email next (KAN-34) |

Tickets are in Jira (KAN); the dated [progress log](https://roysunsyl.atlassian.net/wiki/spaces/RSP/pages/393219)
is in Confluence.

## Architecture in one picture

```text
Browser app ─┐                         ┌─ D1 (SQLite)  R2 (files)
Extension  ──┼─► Cloudflare Worker ────┤
Mail rule ───┘   API · app · email ·   └─ JSearch · Adzuna · USAJOBS · Greenhouse/Lever/Ashby · Claude
                 daily cron
```

TypeScript monorepo: `packages/core` (contract + status engine), `packages/integrations` (pure parsers and
API clients), `apps/portal` (Worker + React), `apps/extension` (Chrome MV3). Details in
[docs/architecture.md](docs/architecture.md).

## Quick start

```bash
pnpm install
pnpm dev     # http://localhost:5173
pnpm check   # lint, typecheck, tests
```

Production setup, email forwarding, LinkedIn import and extension install: [docs/runbook.md](docs/runbook.md).

## Docs

- [Architecture](docs/architecture.md) and decisions ([ADRs](docs/adr))
- [API contract](docs/api.md)
- [Runbook](docs/runbook.md)
- [How work is tracked and built](docs/contributing.md)

Tracking: Jira project [KAN](https://roysunsyl.atlassian.net/jira/software/projects/KAN) · Confluence space
[RSP](https://roysunsyl.atlassian.net/wiki/spaces/RSP)
