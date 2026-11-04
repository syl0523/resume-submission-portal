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

1. **Plan.** Workers Paid ($5/month) is recommended: the free plan's 10 ms CPU per request is too tight for
   email parsing and ranking.
2. **Sign in.** `cd apps/portal && pnpm exec wrangler login`
3. **Database and storage.**

   ```bash
   pnpm exec wrangler d1 create job-portal          # paste the database_id into wrangler.jsonc
   pnpm exec wrangler r2 bucket create job-portal-files
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
8. **Inbound email.** Email → Email Routing → enable for the domain (adds MX/TXT records) → Routing rules →
   **Catch-all** → action **Send to a Worker** → `resume-submission-portal`. Set `INBOUND_EMAIL_DOMAIN` to the
   domain. Your address appears in Settings (`jobs-xxxxxxxx@<domain>`).
9. **Continuous deploy.** GitHub repo → Settings → Secrets and variables → Actions: secrets
   `CLOUDFLARE_API_TOKEN` (Workers + D1 edit) and `CLOUDFLARE_ACCOUNT_ID`; variable `CLOUDFLARE_DEPLOY=true`.
   Every green push to `main` then deploys.

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

Download `job-portal-extension` from the latest CI run (or `pnpm --filter @jsp/extension build`), unzip,
open `chrome://extensions`, enable Developer mode → **Load unpacked** → the folder (`apps/extension/dist`).
Open the extension's options: portal URL plus a token from Settings → Extension tokens.

## API keys

| Provider  | Where                                          | Notes                                                                                  |
| --------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| JSearch   | rapidapi.com → JSearch → Subscribe (free tier) | Covers LinkedIn, Indeed, Glassdoor, ZipRecruiter and company sites via Google for Jobs |
| Adzuna    | developer.adzuna.com                           | `app_id` + `app_key`; US index by default (`ADZUNA_COUNTRY=us`)                        |
| USAJOBS   | developer.usajobs.gov → API request            | Key is emailed; `USAJOBS_USER_AGENT` must be that email                                |
| Anthropic | console.anthropic.com                          | Enables resume drafts, fit reports, answers and email second opinion                   |

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
