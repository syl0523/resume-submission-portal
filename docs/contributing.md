# How work is tracked and built

## Tools

| Tool       | Holds                                                   | Link                                                       |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Jira       | Backlog: epics KAN-4..KAN-11 plus Job Match and Phase 2 | https://roysunsyl.atlassian.net/jira/software/projects/KAN |
| Confluence | Architecture, decisions, runbook, progress              | https://roysunsyl.atlassian.net/wiki/spaces/RSP            |
| GitHub     | Code, pull requests, CI, deploys                        | https://github.com/syl0523/resume-submission-portal        |

Install **GitHub for Jira** (Atlassian Marketplace, free) and connect this repository: branches, commits and
PRs that mention a Jira key then appear on the issue's Development panel automatically.

## Flow

1. Pick a Jira task; move it to **In Progress**.
2. Branch from `main`: `KAN-<n>-<short-name>` (one branch may cover several keys of the same epic).
3. Commit with the key: `KAN-16: dedupe applications by canonical URL`.
4. Open a PR titled `KAN-<n> <summary>`; fill the template; CI must be green.
5. Squash-merge; move the Jira task to **Done**; update the Confluence page if behaviour changed.

While the owner is the only developer, changes are committed straight to `main` instead (still with the
key in the message, `pnpm check` green first). CI runs on every push, and a green CI on `main` deploys.
Pull requests remain the way in for Dependabot and anyone else.

## Multi-agent development

The first version was built by an orchestrator agent and four build agents working in parallel:

| Role               | Owns                                                                                       | Jira                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Orchestrator       | `packages/core`, `docs/api.md`, DB schema and migrations, CI, docs, integration and review | KAN-12..KAN-15                                                   |
| API agent          | `apps/portal/src/worker/**`                                                                | KAN-16..KAN-19, KAN-22, KAN-25, KAN-32, KAN-33 + Job Match API   |
| Integrations agent | `packages/integrations/**` (except `jobposting.ts`)                                        | KAN-20, KAN-21, KAN-23, KAN-24 + search, fit, dedupe, deep links |
| Web agent          | `apps/portal/src/client/**`                                                                | KAN-26..KAN-29 + Job Match UI                                    |
| Extension agent    | `apps/extension/**`, `packages/integrations/src/jobposting.ts`                             | KAN-30, KAN-31 + fit badge, answers                              |

Rules that make parallel work safe:

- **Contract first.** Shared types, request schemas and the endpoint list are fixed before agents start.
  An agent that needs a contract change asks the orchestrator instead of editing `packages/core`.
- **Disjoint file ownership.** Each agent edits only its paths, on its own branch and worktree.
- **Stubs with signatures.** Cross-agent dependencies (for example email parsers used by the API) exist as
  typed stubs, so every agent compiles and tests against the final interface from the start.
- **Same bar for everyone.** `pnpm check` green, tests for new logic, synthetic fixtures only.
- **Integration by review.** The orchestrator merges branches in dependency order (integrations → API → web →
  extension), runs the whole suite and the app end to end, and fixes seams.

## Definition of done

- Behaviour matches `docs/api.md` and the Jira acceptance criteria.
- Unit/API tests cover the new logic, including failure paths.
- `pnpm check` passes; no new lint suppressions without a comment explaining why.
- Docs updated; no secrets or personal data committed.
