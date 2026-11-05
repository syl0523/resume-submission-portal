#!/usr/bin/env node
// One-command production setup on Cloudflare (KAN-34).
//
//   pnpm setup:cloudflare            interactive: sign in, create resources, set keys, deploy
//   pnpm setup:cloudflare --dry-run  print what would run, change nothing
//   pnpm setup:cloudflare --no-deploy
//
// Idempotent: existing D1 databases, R2 buckets and secrets are reused, so it is safe to re-run.
// Afterwards it prints the remaining dashboard steps (domain, Access, Email Routing, CI deploys).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTAL = join(ROOT, 'apps', 'portal');
const WRANGLER_CONFIG = join(PORTAL, 'wrangler.jsonc');
const DB_NAME = 'resume-submission-portal';
const BUCKET = 'resume-submission-portal-files';
const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';
const SECRETS = [
  ['ANTHROPIC_API_KEY', 'Claude: resume drafts, fit reports, answers, email second opinion'],
  ['JSEARCH_API_KEY', 'JSearch (RapidAPI): LinkedIn, Indeed and company-site listings'],
  ['ADZUNA_APP_ID', 'Adzuna search (US index)'],
  ['ADZUNA_APP_KEY', 'Adzuna search (US index)'],
  ['USAJOBS_API_KEY', 'USAJOBS federal jobs (also set USAJOBS_USER_AGENT in wrangler.jsonc)'],
];

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const DEPLOY = !args.has('--no-deploy');
const isWindows = process.platform === 'win32';

const say = (msg = '') => process.stdout.write(`${msg}\n`);
const step = (msg) => say(`\n▸ ${msg}`);
const fail = (msg) => {
  process.stderr.write(`\n✖ ${msg}\n`);
  process.exit(1);
};

/** Run wrangler inside apps/portal. `interactive` passes the terminal through (logins, secret prompts). */
function wrangler(argv, { interactive = false, allowFailure = false } = {}) {
  const display = `wrangler ${argv.join(' ')}`;
  if (DRY_RUN) {
    say(`  (dry run) ${display}`);
    return { ok: true, out: '' };
  }
  const res = spawnSync('pnpm', ['exec', 'wrangler', ...argv], {
    cwd: PORTAL,
    shell: isWindows,
    stdio: interactive ? 'inherit' : ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const ok = res.status === 0;
  if (!ok && !allowFailure) fail(`${display} failed:\n${out.trim()}`);
  return { ok, out };
}

function run(cmd, argv, cwd = ROOT) {
  if (DRY_RUN) {
    say(`  (dry run) ${cmd} ${argv.join(' ')}`);
    return;
  }
  const res = spawnSync(cmd, argv, { cwd, stdio: 'inherit', shell: isWindows });
  if (res.status !== 0) fail(`${cmd} ${argv.join(' ')} failed`);
}

/** Replace the placeholder D1 id in wrangler.jsonc, keeping comments and formatting. */
export function setDatabaseId(jsonc, id) {
  const pattern =
    /("database_name"\s*:\s*"resume-submission-portal"[\s\S]*?"database_id"\s*:\s*")([^"]*)(")/;
  if (!pattern.test(jsonc)) throw new Error('Could not find the D1 entry in wrangler.jsonc');
  return jsonc.replace(pattern, `$1${id}$3`);
}

async function ask(rl, question) {
  if (!process.stdin.isTTY) return '';
  return (await rl.question(question)).trim();
}

async function main() {
  say('Resume Submission Portal: Cloudflare setup' + (DRY_RUN ? ' (dry run)' : ''));
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  step('Checking your Cloudflare sign-in');
  let who = wrangler(['whoami'], { allowFailure: true });
  if (!DRY_RUN && /not authenticated|not logged in/i.test(who.out)) {
    say('  Not signed in yet; opening the Cloudflare login page…');
    wrangler(['login'], { interactive: true });
    who = wrangler(['whoami']);
  }
  const accountIds = [...new Set(who.out.match(/\b[0-9a-f]{32}\b/g) ?? [])];
  if (accountIds.length > 1 && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    say(`  Several accounts found: ${accountIds.join(', ')}`);
    fail('Set CLOUDFLARE_ACCOUNT_ID to the one to use, then run this again.');
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? accountIds[0] ?? '(your account id)';
  say(`  Using account ${accountId}`);

  step(`D1 database "${DB_NAME}"`);
  const config = readFileSync(WRANGLER_CONFIG, 'utf8');
  let databaseId = /"database_id"\s*:\s*"([^"]+)"/.exec(config)?.[1] ?? PLACEHOLDER_ID;
  if (databaseId === PLACEHOLDER_ID) {
    const list = wrangler(['d1', 'list', '--json'], { allowFailure: true });
    let existing;
    try {
      existing = JSON.parse(list.out || '[]').find((db) => db.name === DB_NAME);
    } catch {
      existing = undefined;
    }
    if (!existing) wrangler(['d1', 'create', DB_NAME]);
    const info = wrangler(['d1', 'info', DB_NAME, '--json'], { allowFailure: DRY_RUN });
    databaseId = DRY_RUN
      ? '<new-database-id>'
      : (existing?.uuid ?? JSON.parse(info.out).uuid ?? fail('Could not read the database id'));
    if (!DRY_RUN) writeFileSync(WRANGLER_CONFIG, setDatabaseId(config, databaseId));
    say(
      `  ${existing ? 'Reusing' : 'Created'} ${DB_NAME} (${databaseId}); wrangler.jsonc updated.`,
    );
  } else {
    say(`  Already configured (${databaseId}).`);
  }

  step(`R2 bucket "${BUCKET}"`);
  const buckets = wrangler(['r2', 'bucket', 'list'], { allowFailure: true }).out;
  if (new RegExp(`name:\\s+${BUCKET}\\b`).test(buckets)) say('  Already exists.');
  else {
    wrangler(['r2', 'bucket', 'create', BUCKET]);
    say('  Created.');
  }

  step('API keys (each is optional; press Enter to skip)');
  for (const [name, purpose] of SECRETS) {
    const answer = await ask(rl, `  Set ${name}? ${purpose} [y/N] `);
    if (/^y(es)?$/i.test(answer)) wrangler(['secret', 'put', name], { interactive: true });
  }
  rl.close();

  if (DEPLOY) {
    step('Building, applying database migrations and deploying');
    run('pnpm', ['--filter', '@jsp/portal', 'run', 'deploy']);
  }

  say(`
✔ Cloudflare resources are ready${DEPLOY ? ' and the portal is deployed' : ''}.

Remaining dashboard steps (details in docs/runbook.md):
  1. Domain: Workers & Pages → resume-submission-portal → Settings → Domains & Routes → add jobs.<your-domain>.
  2. Sign-in: Zero Trust → Access → Applications → Self-hosted for jobs.<your-domain> (Allow: your email),
     plus Bypass applications for /api/ext/* and /api/calendar/*. Put the team domain and AUD tag in
     wrangler.jsonc (ACCESS_TEAM_DOMAIN, ACCESS_AUD) and run this script again to redeploy.
  3. Inbound email: Email → Email Routing → enable → Catch-all → Send to a Worker → resume-submission-portal.
     Set INBOUND_EMAIL_DOMAIN in wrangler.jsonc.
  4. Automatic deploys from GitHub: repository secrets CLOUDFLARE_API_TOKEN (Workers + D1 edit) and
     CLOUDFLARE_ACCOUNT_ID = ${accountId}; repository variable CLOUDFLARE_DEPLOY = true.
`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
