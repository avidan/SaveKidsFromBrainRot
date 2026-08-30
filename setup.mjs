#!/usr/bin/env node
// One-time interactive setup: deploys your own SaveKidsFromBrainRot stack to
// YOUR Cloudflare account. Safe to re-run — every step is idempotent.
//
//   npm run setup
//
// What it does:
//   1. Installs dependencies (backend + dashboard)
//   2. Logs you into Cloudflare (opens a browser)
//   3. Creates the D1 database and applies the schema
//   4. Builds the dashboard and deploys the Worker (API + dashboard, one URL)
//   5. Stores your Anthropic API key as a Worker secret
//
// Prerequisites: Node 18+, a free Cloudflare account, an Anthropic API key
// (console.anthropic.com). Nothing else.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(ROOT, 'backend');
const DASHBOARD = join(ROOT, 'dashboard');
const DB_NAME = 'skfbr';

const log = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const die = (msg) => {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};

/** Run a command, streaming output to the terminal. Throws on failure. */
function run(cmd, { cwd = ROOT, allowFail = false } = {}) {
  const res = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit' });
  if (res.status !== 0 && !allowFail) die(`Command failed: ${cmd}`);
  return res.status === 0;
}

/** Run a command and capture stdout (stderr streams through). */
function capture(cmd, { cwd = ROOT, input } = {}) {
  const res = spawnSync(cmd, { cwd, shell: true, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
  return { status: res.status, stdout: res.stdout ?? '' };
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

/** Prompt without echoing the input (for API keys). Falls back to visible input on non-TTY. */
function askHidden(question) {
  if (!process.stdin.isTTY) return ask(question);
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value.trim());
        }
        if (ch === '\u0003') { // Ctrl-C
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

// ---------- 0. sanity ----------

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) die(`Node 18+ required (you have ${process.versions.node}).`);
if (!existsSync(join(BACKEND, 'wrangler.toml'))) die('Run this from a full clone of the repository.');

console.log('\n🛡️  SaveKidsFromBrainRot setup — deploys the whole product to your Cloudflare account.');
console.log('   Free Cloudflare tier is plenty. Re-running this script is always safe.');

// ---------- 1. dependencies ----------

log('Installing dependencies');
for (const dir of [BACKEND, DASHBOARD]) {
  if (existsSync(join(dir, 'node_modules'))) {
    ok(`${dir.split('/').pop()}: already installed`);
  } else {
    run('npm install --no-fund --no-audit', { cwd: dir });
  }
}

// ---------- 2. Cloudflare auth ----------

log('Checking Cloudflare login');
const who = capture('npx wrangler whoami', { cwd: BACKEND });
if (who.status !== 0 || /not authenticated/i.test(who.stdout)) {
  console.log('  Opening a browser to log you into Cloudflare (free account: dash.cloudflare.com/sign-up)…');
  run('npx wrangler login', { cwd: BACKEND });
} else {
  ok('already logged in');
}

// ---------- 3. D1 database ----------

log(`Creating the ${DB_NAME} database`);
function findDatabaseId() {
  const list = capture('npx wrangler d1 list --json', { cwd: BACKEND });
  if (list.status !== 0) return null;
  try {
    const jsonStart = list.stdout.indexOf('[');
    const dbs = JSON.parse(list.stdout.slice(jsonStart));
    return dbs.find((d) => d.name === DB_NAME)?.uuid ?? null;
  } catch {
    return null;
  }
}

let dbId = findDatabaseId();
if (dbId) {
  ok(`database exists (${dbId})`);
} else {
  run(`npx wrangler d1 create ${DB_NAME}`, { cwd: BACKEND });
  dbId = findDatabaseId();
  if (!dbId) die('Could not determine the database id. Run "npx wrangler d1 list" and paste the id into backend/wrangler.toml manually.');
  ok(`database created (${dbId})`);
}

const tomlPath = join(BACKEND, 'wrangler.toml');
const toml = readFileSync(tomlPath, 'utf8');
const patched = toml.replace(/database_id = "[^"]*"/, `database_id = "${dbId}"`);
if (patched !== toml) {
  writeFileSync(tomlPath, patched);
  ok('wrangler.toml updated with your database id');
} else {
  ok('wrangler.toml already points at it');
}

log('Applying the database schema');
run(`npx wrangler d1 execute ${DB_NAME} --remote --file=./schema.sql -y`, { cwd: BACKEND });

// ---------- 4. build + deploy ----------

log('Building the dashboard');
run('npm run build', { cwd: DASHBOARD });

log('Deploying the Worker (API + dashboard)');
const deploy = capture('npx wrangler deploy', { cwd: BACKEND });
process.stdout.write(deploy.stdout);
if (deploy.status !== 0) die('Deploy failed — see output above.');
const urlMatch = deploy.stdout.match(/https:\/\/[\w.-]+\.workers\.dev/);
const appUrl = urlMatch ? urlMatch[0] : '(your workers.dev URL from the output above)';

// ---------- 5. Anthropic API key ----------

log('Anthropic API key');
console.log('  The AI filtering runs on YOUR key, billed to you (a family on the default');
console.log('  model is typically a few dollars a month). Create one at console.anthropic.com.');
const key = await askHidden('  Paste your Anthropic API key (starts with sk-ant-, blank to skip): ');
if (key) {
  const put = capture('npx wrangler secret put ANTHROPIC_API_KEY', { cwd: BACKEND, input: key + '\n' });
  if (put.status === 0) ok('key stored as a Worker secret (never leaves Cloudflare)');
  else die('Storing the secret failed — run "npx wrangler secret put ANTHROPIC_API_KEY" in backend/ yourself.');
} else {
  console.log('  Skipped. Filtering will fail-safe (everything "unsure") until you set it:');
  console.log('    cd backend && npx wrangler secret put ANTHROPIC_API_KEY');
}

// ---------- done ----------

console.log(`
\x1b[1m🎉 Done! Your family's stack is live at:\x1b[0m

    ${appUrl}

Next steps:
  1. Open that URL and create your parent account (first tab: write your criteria).
  2. On your kid's computer, install the extension (see SETUP.md), open its
     options page, and enter the URL above plus a pairing code from the
     dashboard's Devices tab.
  3. Optional extras (see SETUP.md): push notifications via ntfy.sh, email
     via Resend, a custom domain, a lockdown profile for Macs.

Re-run "npm run setup" any time — and to ship code updates later, "npm run deploy".
`);
