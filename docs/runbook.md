# Runbook

## Run it locally

Prerequisites: Node 22+, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev            # http://localhost:5173 — creates apps/portal/.dev.vars and applies local migrations
pnpm --filter @jsp/portal db:seed:local   # optional demo data
pnpm check          # lint + typecheck + tests (run before every push)
```

Local mode signs you in as `DEV_USER_EMAIL` (localhost only). Optional keys go in `apps/portal/.dev.vars`
(see `.dev.vars.example`).

## Production on Cloudflare

**Fastest path:** `pnpm setup:cloudflare`. It signs you in to Cloudflare, creates the D1 database and R2
bucket (writing the database id into `wrangler.jsonc`), offers to set each API key, then builds and deploys.
It reuses anything that already exists, so it is safe to re-run (for example after filling in the Access
settings). `pnpm setup:cloudflare --dry-run` shows what it would do. Then finish steps 6 to 9 below in the
Cloudflare dashboard; the manual equivalents of steps 2 to 5 are kept for reference.

1. **Plan.** Workers Paid ($5/month) is recommended: the free plan's 10 ms CPU per request is too tight for
   email parsing and ranking.
2. **Sign in.** `cd apps/portal && pnpm exec wrangler login`
3. **Database and storage.**

   ```bash
   pnpm exec wrangler d1 create resume-submission-portal   # paste the database_id into wrangler.jsonc
   pnpm exec wrangler r2 bucket create resume-submission-portal-files
   ```
4. **Secrets** (only the ones you use):

   ```bash
   pnpm exec wrangler secret put ANTHROPIC_API_KEY   # AI: drafts, fit reports, answers, email second opinion
   pnpm exec wrangler secret put JSEARCH_API_KEY     # LinkedIn / Indeed / company sites via Google for Jobs
   pnpm exec wrangler secret put ADZUNA_APP_ID
   pnpm exec wrangler secret put ADZUNA_APP_KEY
   pnpm exec wrangler secret put USAJOBS_API_KEY     # and set USAJOBS_USER_AGENT in wrangler.jsonc vars
   ```
5. **Deploy.** `pnpm --filter @jsp/portal deploy` (builds, applies D1 migrations, deploys).
6. **Domain.** Workers & Pages → resume-submission-portal → Settings → Domains & Routes → add
   `jobs.<your-domain>` (the domain must be on Cloudflare).
7. **Sign-in with Cloudflare Access.** Zero Trust → Access → Applications → Add → Self-hosted:
   - Application `jobs.<your-domain>`, policy **Allow**, include your email(s). Copy the **AUD tag**.
   - Two more applications on the same domain with action **Bypass** (Everyone) for paths `/api/ext/*`
     (extension, bearer token) and `/api/calendar/*` (calendar feed, secret URL).
   - Set vars in `wrangler.jsonc`: `ACCESS_TEAM_DOMAIN` = `<team>.cloudflareaccess.com`, `ACCESS_AUD` = the
     AUD tag. Redeploy.
   - No domain yet? Use the `workers.dev` address (`resume-submission-portal.<subdomain>.workers.dev`) as the
     domain of all three applications. Create them as self-hosted applications rather than with the Worker's
     **Access** tab, which puts sign-in in front of every path, including the two Bypass paths.
8. **Inbound email.** Email → Email Routing → enable for the domain (adds MX/TXT records) → Routing rules →
   **Catch-all** → action **Send to a Worker** → `resume-submission-portal`. Set `INBOUND_EMAIL_DOMAIN` to the
   domain. Your address appears in Settings (`jobs-xxxxxxxx@<domain>`).
9. **Continuous deploy.** Cloudflare → Manage Account → Account API Tokens → Create Token (custom): Workers
   **Admin** across all Workers (the first deploy creates the Worker, which Editor cannot; the older
   "Workers Scripts: Edit" permission also works) and **D1 Edit** (the deploy applies migrations). Then GitHub
   repo → Settings → Secrets and variables → Actions: secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`; variable `CLOUDFLARE_DEPLOY=true`. Every green push to `main` then deploys (or
   start it by hand: Actions → Deploy → Run workflow), and the run ends with a smoke check of the live Worker.

## Forward job emails to the portal

**Outlook.com / Hotmail:** Settings → Mail → Rules → Add new rule

- Condition **From** contains (one per line): `linkedin.com`, `indeed.com`, `indeedemail.com`,
  `greenhouse.io`, `greenhouse-mail.io`, `lever.co`, `ashbyhq.com`, `myworkday.com`, `smartrecruiters.com`,
  `icims.com`, `taleo.net`, `successfactors.com`
- Action **Redirect to** your portal address (Redirect keeps the original sender, which helps matching).
- Optional second rule: **Subject includes** `application`, `interview`, `candidacy`, `your application`
  → Redirect to the same address (catches recruiters writing from company domains).

**Gmail:** Settings → Forwarding and POP/IMAP → Add a forwarding address (your portal address). Gmail
sends a confirmation email: it shows up in the portal Inbox under Ignored; open it, copy the code, confirm.
Then Filters → Create a filter → From: `linkedin.com OR indeed.com OR greenhouse.io OR lever.co OR
ashbyhq.com OR myworkday.com` → Forward it to the portal address.

No domain yet? Paste emails on the Inbox page instead; they go through the same pipeline.

## Import your LinkedIn history

LinkedIn → Me → Settings & Privacy → Data privacy → Get a copy of your data → choose the job
applications data (add Connections too, for the upcoming referral finder) → Request archive. When the email
arrives, download the archive and upload the job applications CSV on the portal's Imports page. Spreadsheet
trackers work too: export as CSV with Company, Title, URL, Date Applied, Status, Notes columns.

## Install the browser extension

Download `resume-portal-extension` from the latest CI run (or `pnpm --filter @jsp/extension build`), unzip,
open `chrome://extensions`, enable Developer mode → **Load unpacked** → the folder (`apps/extension/dist`).
Open the extension's options: the portal address plus a token from Settings → Browser extension.

Click the toolbar icon on a job posting to save it with its fit to your saved searches, tick **I applied** to
record the application and the resume you sent, or draft an answer to an application question with AI. On
Greenhouse, Lever and Ashby application forms, **Autofill for review** fills what your profile knows and
attaches a resume; you check everything and submit yourself. The extension reads a page only when you click
it, and never autofills LinkedIn or Indeed.

## API keys

| Provider  | Where                                          | Notes                                                                                  |
| --------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| JSearch   | rapidapi.com → JSearch → Subscribe (free tier) | Covers LinkedIn, Indeed, Glassdoor, ZipRecruiter and company sites via Google for Jobs |
| Adzuna    | developer.adzuna.com                           | `app_id` + `app_key`; US index by default (`ADZUNA_COUNTRY=us`)                        |
| USAJOBS   | developer.usajobs.gov → API request            | Key is emailed; `USAJOBS_USER_AGENT` must be that email                                |
| Anthropic | console.anthropic.com                          | Enables resume drafts, fit reports, answers and email second opinion                   |

AI uses two models, set as vars in `wrangler.jsonc`: `AI_MODEL_SMART` (default `claude-opus-5-5`) writes fit
reports, answers and resume drafts; `AI_MODEL_FAST` (default `claude-haiku-5-5`) gives the email second
opinion and re-ranks search results. Point `AI_MODEL_SMART` at a cheaper model to cut cost.

## Calendar

Settings → copy the calendar URL. Outlook.com: Calendar → Add calendar → Subscribe from web. Google
Calendar: Other calendars → From URL. Treat the URL like a password; rotate it by asking for a new token
(backlog) if it leaks.

## Troubleshooting

| Symptom                             | Check                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| API returns 401 in the browser      | Access session expired: reload to sign in again                               |
| Extension says the token is invalid | Revoked or mistyped: create a new token in Settings                           |
| Forwarded emails never arrive       | Email Routing → Activity log; the rule must target the catch-all Worker route |
| Email shows as "unmatched"          | Open it in the Inbox and link it, or create the application from it           |
| Search shows `not_configured`       | That provider's key is not set (Settings shows which are enabled)             |
| Search shows a provider error       | Quota or upstream outage; other providers still return results                |

## Backups and data

D1 keeps 30 days of point-in-time history (`wrangler d1 time-travel restore`). Applications → Export gives a
CSV at any time. Resumes and raw emails live in your R2 bucket.
