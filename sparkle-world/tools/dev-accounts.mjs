// Try family accounts on your own computer (docs/ACCOUNTS.md §12.10): `npm run dev:accounts`.
//
//   node tools/dev-accounts.mjs [--mode=required|optional] [--port=8080] [--fake] [--seed] [--no-build]
//
// Default: a local Postgres (tools/testdb.mjs: SW_TEST_DATABASE_URL, or a throwaway cluster),
// the Stripe fake (tools/stripe-fake/, owner B) and server/server.mjs as its own program with
// SW_ACCOUNTS=<mode>, MAIL_MODE=log (every email is printed here, with its code and link),
// SW_TEST=1 (the test hooks: /api/test/mail, /api/test/clock) and the home page built for that
// mode, on http://localhost:<port>. Open http://localhost:8080/account, type any email, and
// copy the 6-digit code from this terminal. Stripe's pages are the fake's (card 4242).
//
// --fake: no Postgres and no Stripe at all: the server runs in this process with the in-memory
// stand-in (tools/fake-accounts.mjs) for designing the Family page. Codes are printed here too;
// the pretend Checkout and Portal are plain pages with links. --seed adds a demo family (see
// the printed line) with two players, so the dashboard can be seen right away.
//
// Nothing here talks to Stripe or an email provider. Ctrl+C stops everything.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSite } from './site-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const MODE = arg('mode', 'required');
const PORT = +arg('port', 8080);
const ORIGIN = `http://localhost:${PORT}`;
if (!['optional', 'required'].includes(MODE)) {
  console.error('--mode must be optional or required');
  process.exit(1);
}

/** The Stripe fake of owner B, when it is in this tree. */
export async function loadStripeFake() {
  for (const f of ['stripe-fake/index.mjs', 'stripe-fake/server.mjs', 'stripe-fake/fake.mjs']) {
    const file = path.join(ROOT, 'tools', f);
    if (!existsSync(file)) continue;
    const m = await import(pathToFileURL(file).href);
    if (typeof m.startStripeFake === 'function') return m.startStripeFake;
  }
  return null;
}

/** A development environment for the accounts (never production values). */
export function devEnv({ mode, origin, databaseUrl, stripe = null, test = true, mail = 'log' }) {
  return {
    SW_ACCOUNTS: mode,
    NODE_ENV: 'development',
    PUBLIC_ORIGIN: origin,
    DATABASE_URL: databaseUrl,
    SW_SECRET: randomBytes(32).toString('base64'),
    STRIPE_SECRET_KEY: 'sk_test_devaccounts',
    STRIPE_WEBHOOK_SECRET: (stripe && stripe.webhookSecret) || 'whsec_devaccounts',
    STRIPE_PRICE_ID: (stripe && stripe.priceId) || 'price_sparkle_family_monthly',
    ...(stripe && stripe.url ? { STRIPE_API_BASE: stripe.url } : {}),
    MAIL_MODE: mail,
    ...(test ? { SW_TEST: '1' } : {}),
    SW_OPERATOR_NAME: 'The Sparkle Family (development)',
    SW_OPERATOR_EMAIL: 'hello@localhost',
    SW_OPERATOR_ADDRESS: 'PO Box 0, Nowhere',
    SW_OPERATOR_PHONE: '+1 555 0100',
  };
}

async function main() {
  if (!arg('no-build') && !existsSync(path.join(ROOT, 'dist', 'sparkle-world.html'))) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const siteDir = mkdtempSync(path.join(tmpdir(), 'sw-dev-site-'));
  const cleanups = [() => rmSync(siteDir, { recursive: true, force: true })];
  const stop = async () => {
    for (const c of cleanups.reverse()) {
      try {
        await c();
      } catch {}
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (arg('fake')) {
    const env = devEnv({ mode: MODE, origin: ORIGIN, databaseUrl: 'pglite:' });
    await buildSite({ out: siteDir, mode: MODE, env, quiet: true });
    const { createFakeAccounts } = await import('./fake-accounts.mjs');
    const { createServer } = await import('../server/server.mjs');
    const fake = await createFakeAccounts({ mode: MODE, publicOrigin: ORIGIN, log: (l) => console.log(l) });
    const app = createServer({ accounts: fake, siteDir, log: () => {} });
    await app.listen(PORT, '127.0.0.1');
    cleanups.push(() => app.close());
    if (arg('seed')) {
      const f = fake.addFamily({ email: 'grownup@example.com', plan: 'active', consent: 'verified' });
      fake.addPlayer(f, { nickname: 'Lily', friends: true, walkie: true, worlds: 3 });
      fake.addPlayer(f, { nickname: 'Mia', worlds: 1 });
      fake.addSession(f, { kind: 'device', label: "Lily's iPad" });
      console.log('seeded: a family with the plan and two players; sign in as grownup@example.com');
    }
    console.log(`\nSparkle World with FAKE accounts (${MODE}): ${ORIGIN}/account  (the game: ${ORIGIN}/play)`);
    console.log('Sign in with any email; the code is printed here ([mail] …). Ctrl+C stops.\n');
    return;
  }

  const { openTestDb } = await import('./testdb.mjs');
  const t = await openTestDb({ needUrl: true, migrate: false, log: (l) => console.log('  [db] ' + l) });
  cleanups.push(() => t.close());
  const startStripeFake = await loadStripeFake();
  let stripe = null;
  if (startStripeFake) {
    const webhookSecret = 'whsec_' + randomBytes(24).toString('base64url');
    const f = await startStripeFake({ webhookUrl: `${ORIGIN}/api/stripe/webhook`, webhookSecret, publicUrl: null });
    stripe = { url: f.url, webhookSecret, priceId: f.priceId || null };
    cleanups.push(() => f.close());
  } else console.warn('warning: the Stripe fake (tools/stripe-fake/) is not in this tree: checkout will answer stripe_unavailable. Use --fake to try the Family page without it.');
  const env = devEnv({ mode: MODE, origin: ORIGIN, databaseUrl: t.url, stripe });
  await buildSite({ out: siteDir, mode: MODE, env, quiet: true });
  const main = path.join(ROOT, 'server', 'server.mjs');
  const child = spawn(process.execPath, [main], { cwd: ROOT, env: { ...process.env, ...env, PORT: String(PORT), HOST: '127.0.0.1', SW_SITE: siteDir }, stdio: 'inherit' });
  cleanups.push(() => new Promise((r) => {
    if (child.exitCode !== null) return r();
    child.once('exit', r);
    child.kill('SIGTERM');
  }));
  child.on('exit', (code) => {
    console.log(`server exited (${code})`);
    stop();
  });
  console.log(`\nSparkle World with accounts (${MODE}): ${ORIGIN}/account  (the game: ${ORIGIN}/play)`);
  console.log(`database: ${t.kind}; Stripe: ${stripe ? 'the fake at ' + stripe.url : 'none'}; emails: printed below. Ctrl+C stops.\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
