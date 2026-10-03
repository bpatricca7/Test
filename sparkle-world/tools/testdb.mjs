// A database for the accounts tests (docs/ACCOUNTS.md §12.2), picked in this order:
//
//   1. SW_TEST_DATABASE_URL (CI's Postgres 16 service): a fresh database per openTestDb()
//      (`create database sw_t_<random>`), dropped at close().
//   2. Postgres binaries on this machine (PATH, /usr/lib/postgresql/<v>/bin, or SW_PG_BIN):
//      a throwaway cluster (initdb into a temp directory, a random port on 127.0.0.1, fsync
//      off), one per process, a fresh database per openTestDb(). Postgres refuses to run as
//      root, so as root it runs as the `postgres` system user when there is one.
//   3. @electric-sql/pglite (a devDependency): in-process Postgres behind the same interface.
//      It has no URL, so a server started as its own process cannot use it (`needUrl`).
//   4. Otherwise: exit with "No Postgres for the tests: set SW_TEST_DATABASE_URL" (never a
//      silent pass).
//
// Force one with SW_TEST_DB=url|cluster|pglite (or the `kind` option).
//
//   import { openTestDb } from './testdb.mjs';
//   const t = await openTestDb();          // { db, url, kind, reset(), close() }, migrated
//   await t.reset();                       // empties every table (not schema_migrations)
//   await t.close();
//
// As a program, `node tools/testdb.mjs [--migrate]` starts one (cluster or URL kind), prints
// `DATABASE_URL=…` and keeps it until Ctrl+C (for trying the server by hand).

import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { openDb } from '../server/db.mjs';
import { migrate as runMigrations } from '../server/migrate.mjs';

const run = promisify(execFile);

/**
 * @param {{ kind?: 'auto'|'url'|'cluster'|'pglite', migrate?: boolean, needUrl?: boolean, log?: Function }} [o]
 */
export async function openTestDb({ kind = process.env.SW_TEST_DB || 'auto', migrate = true, needUrl = false, log = () => {} } = {}) {
  const want = String(kind).toLowerCase();
  let made = null;
  if ((want === 'auto' || want === 'url') && process.env.SW_TEST_DATABASE_URL) made = await fromUrl(process.env.SW_TEST_DATABASE_URL);
  else if (want === 'url') fail('SW_TEST_DB=url but SW_TEST_DATABASE_URL is not set');
  if (!made && (want === 'auto' || want === 'cluster')) {
    const why = clusterUnavailable();
    if (!why) made = await fromCluster();
    else if (want === 'cluster') fail(`SW_TEST_DB=cluster but ${why}`);
  }
  if (!made && (want === 'auto' || want === 'pglite') && !needUrl) {
    if (await hasPglite()) made = await fromPglite();
    else if (want === 'pglite') fail('SW_TEST_DB=pglite but @electric-sql/pglite is not installed (npm ci)');
  }
  if (!made) fail(needUrl ? 'No Postgres for this test (it needs a database URL): set SW_TEST_DATABASE_URL or install Postgres' : 'No Postgres for the tests: set SW_TEST_DATABASE_URL');
  if (migrate) await runMigrations(made.db, { log });
  return {
    ...made,
    reset: () => truncateAll(made.db),
  };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** Empty every table of the public schema except schema_migrations (like POST /api/test/reset). */
export async function truncateAll(db) {
  const r = await db.query("select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'");
  if (!r.rows.length) return;
  await db.exec(`truncate ${r.rows.map((x) => `"${x.tablename}"`).join(', ')} restart identity cascade`);
}

const dbName = () => 'sw_t_' + randomBytes(6).toString('hex');

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = '/' + name;
  return u.toString();
}

async function adminQuery(url, sql) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

// ---- 1. a given server ----

async function fromUrl(adminUrl) {
  const name = dbName();
  await adminQuery(adminUrl, `create database ${name}`);
  const url = withDatabase(adminUrl, name);
  const db = await openDb(url);
  return {
    kind: 'url',
    db,
    url,
    async close() {
      await db.close();
      await adminQuery(adminUrl, `drop database if exists ${name} with (force)`).catch(() => {});
    },
  };
}

// ---- 2. a throwaway cluster ----

function pgBinDir() {
  const has = (d) => d && existsSync(path.join(d, 'initdb')) && existsSync(path.join(d, 'postgres'));
  if (process.env.SW_PG_BIN) return has(process.env.SW_PG_BIN) ? process.env.SW_PG_BIN : null;
  for (const d of (process.env.PATH || '').split(path.delimiter)) if (has(d)) return d;
  const root = '/usr/lib/postgresql';
  if (existsSync(root)) {
    const versions = readdirSync(root).filter((v) => /^\d+$/.test(v)).sort((a, b) => b - a);
    for (const v of versions) if (has(path.join(root, v, 'bin'))) return path.join(root, v, 'bin');
  }
  return null;
}

/** uid/gid to run Postgres as: ours, or the `postgres` system user's when we are root. */
function pgUser() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return {};
  try {
    const line = readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.startsWith('postgres:'));
    if (!line) return null;
    const [, , uid, gid] = line.split(':');
    return { uid: +uid, gid: +gid };
  } catch {
    return null;
  }
}

function clusterUnavailable() {
  if (!pgBinDir()) return 'no Postgres binaries were found (initdb, postgres)';
  if (!pgUser()) return 'running as root and there is no postgres system user to run Postgres as';
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let cluster = null; // one per process: { url(name), stop(), users }

async function startCluster() {
  const bin = pgBinDir();
  const who = pgUser();
  const dir = mkdtempSync(path.join(tmpdir(), 'sw-pg-'));
  if (who.uid !== undefined) chownSync(dir, who.uid, who.gid);
  const data = path.join(dir, 'data');
  const env = { PATH: process.env.PATH, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
  const as = who.uid !== undefined ? { uid: who.uid, gid: who.gid } : {};
  await run(path.join(bin, 'initdb'), ['-D', data, '-U', 'sw', '-A', 'trust', '-E', 'UTF8', '--locale=C', '-N'], { env, ...as });
  const port = await freePort();
  const child = spawn(path.join(bin, 'postgres'), [
    '-D', data, '-p', String(port), '-h', '127.0.0.1', '-k', dir, '-F',
    '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'max_connections=200', '-c', 'shared_buffers=32MB',
  ], { env, ...as, stdio: ['ignore', 'ignore', 'pipe'] });
  let errText = '';
  child.stderr.on('data', (d) => (errText = (errText + d.toString()).slice(-4000)));
  const kill = () => {
    try {
      child.kill('SIGQUIT');
    } catch {}
  };
  process.once('exit', kill);
  const base = `postgresql://sw@127.0.0.1:${port}/postgres`;
  const end = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('testdb: postgres exited: ' + errText.trim().split('\n').slice(-3).join(' | '));
    try {
      await adminQuery(base, 'select 1');
      break;
    } catch {
      if (Date.now() > end) {
        kill();
        throw new Error('testdb: postgres did not start: ' + errText.trim().split('\n').slice(-3).join(' | '));
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    base,
    users: 0,
    async stop() {
      process.removeListener('exit', kill);
      if (child.exitCode === null) {
        await new Promise((resolve) => {
          child.once('exit', resolve);
          child.kill('SIGINT'); // fast shutdown
          setTimeout(() => child.kill('SIGQUIT'), 5000).unref();
        });
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function fromCluster() {
  if (!cluster) cluster = startCluster();
  const c = await cluster;
  c.users++;
  const name = dbName();
  await adminQuery(c.base, `create database ${name}`);
  const url = withDatabase(c.base, name);
  const db = await openDb(url);
  return {
    kind: 'cluster',
    db,
    url,
    async close() {
      await db.close();
      await adminQuery(c.base, `drop database if exists ${name} with (force)`).catch(() => {});
      if (--c.users === 0) {
        cluster = null;
        await c.stop();
      }
    },
  };
}

// ---- 3. PGlite ----

async function hasPglite() {
  try {
    await import('@electric-sql/pglite');
    return true;
  } catch {
    return false;
  }
}

async function fromPglite() {
  const db = await openDb('pglite:');
  return { kind: 'pglite', db, url: null, close: () => db.close() };
}

// ---- the log spy (docs/ACCOUNTS.md §12.7), for every accounts suite ----

/**
 * Keep every console line (and whatever is passed to `spy.log`, the log function to give the
 * servers under test), so a suite can check at its end that no email address, token, code,
 * nickname, world name or IP address was ever logged:
 *
 *   const spy = installLogSpy();          // at the top of the test file
 *   spy.remember(email, code, token);     // everything secret the suite handles
 *   createAccounts(cfg, { log: spy.log }); createServer({ ..., log: spy.log });
 *   spy.check();                          // the last test: throws naming the first 3 characters
 *
 * Lines are printed as well only with SW_TEST_VERBOSE=1.
 */
export function installLogSpy({ passThrough = process.env.SW_TEST_VERBOSE === '1' } = {}) {
  const lines = [];
  const secrets = new Set();
  const fmt = (v) => (typeof v === 'string' ? v : v instanceof Error ? `${v.name}: ${v.message}` : (() => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  })());
  const log = (...a) => lines.push(a.map(fmt).join(' '));
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      log(...a);
      if (passThrough) orig(...a);
    };
  }
  return {
    lines,
    secrets,
    log,
    /** Values of 4 or more characters that must never be logged. */
    remember(...values) {
      for (const v of values) if (v !== null && v !== undefined && String(v).length >= 4) secrets.add(String(v));
    },
    check() {
      const text = lines.join('\n');
      for (const s of secrets) if (text.includes(s)) throw new Error(`log spy: a secret was logged (${s.slice(0, 3)}…)`);
      const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.exec(text);
      if (email) throw new Error(`log spy: an email address was logged (${email[0].slice(0, 3)}…)`);
      const ip = /\b(?:\d{1,3}\.){3}\d{1,3}\b/.exec(text);
      if (ip) throw new Error(`log spy: an IP address was logged (${ip[0].slice(0, 3)}…)`);
      return lines.length;
    },
  };
}

// ---- as a program ----

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const t = await openTestDb({ needUrl: true, migrate: process.argv.includes('--migrate'), log: console.log });
  console.log(`DATABASE_URL=${t.url}`);
  console.log(`(${t.kind}; Ctrl+C removes it)`);
  const stop = async () => {
    await t.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);
}
