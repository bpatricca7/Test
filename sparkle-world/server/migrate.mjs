// The migration runner (docs/ACCOUNTS.md §3.2). Files server/migrations/NNN_name.sql are applied
// in order at start, under pg_advisory_lock(hashtext('sparkle-world:migrate')), each in its own
// transaction, and recorded in schema_migrations. Running it twice changes nothing.
//
// Expand only: a release may add tables, nullable columns, columns with defaults and indexes;
// dropping or renaming waits at least one release after no code reads it (Railway runs the old
// and the new deployment side by side for a moment). A released migration file is never edited.
//
//   await migrate(db, { log })        → { applied: [versions just applied], current }
//   await migrationStatus(db)         → { ok, current, latest }  (ok: nothing left to apply)
//   listMigrations(dir?)              → [{ version, name, file }]
//
// Also a tool: `node server/migrate.mjs` migrates DATABASE_URL and prints what it did.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
export const MIGRATE_LOCK = 'sparkle-world:migrate';

const FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export function listMigrations(dir = MIGRATIONS_DIR) {
  const list = [];
  for (const f of readdirSync(dir).sort()) {
    const m = FILE_RE.exec(f);
    if (!m) continue;
    list.push({ version: +m[1], name: m[2], file: path.join(dir, f) });
  }
  for (let i = 0; i < list.length; i++) {
    if (list[i].version !== i + 1) throw new Error(`migrations: expected version ${i + 1}, found ${path.basename(list[i].file)}`);
  }
  return list;
}

const CREATE_TABLE = `create table if not exists schema_migrations (
  version     int primary key,
  name        text not null,
  applied_at  timestamptz not null default now()
)`;

async function appliedVersions(q) {
  const r = await q.query('select version from schema_migrations order by version');
  return new Set(r.rows.map((x) => x.version));
}

export async function migrate(db, { log = () => {}, dir = MIGRATIONS_DIR } = {}) {
  const files = listMigrations(dir);
  return db.lock(MIGRATE_LOCK, async () => {
    await db.exec(CREATE_TABLE);
    const done = await appliedVersions(db);
    const applied = [];
    for (const m of files) {
      if (done.has(m.version)) continue;
      const sql = readFileSync(m.file, 'utf8');
      await db.tx(async (q) => {
        if (db.kind === 'pg') await q.query('set local statement_timeout = 0'); // a big index may take a while
        await q.exec(sql);
        await q.query('insert into schema_migrations (version, name) values ($1, $2)', [m.version, m.name]);
      });
      applied.push(m.version);
      log(`migrations: applied ${String(m.version).padStart(3, '0')}_${m.name}`);
    }
    const current = Math.max(0, ...(await appliedVersions(db)));
    return { applied, current };
  });
}

export async function migrationStatus(db, { dir = MIGRATIONS_DIR } = {}) {
  const latest = listMigrations(dir).length;
  let current = 0;
  try {
    const r = await db.one('select coalesce(max(version), 0) as v from schema_migrations');
    current = r ? r.v : 0;
  } catch {
    current = 0; // no table yet
  }
  return { ok: current >= latest, current, latest };
}

// ---- run as a program ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { openDb } = await import('./db.mjs');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('migrate: DATABASE_URL is missing');
    process.exit(1);
  }
  const db = await openDb(url, { log: console.log });
  try {
    const r = await migrate(db, { log: console.log });
    console.log(`migrations: at version ${r.current}${r.applied.length ? '' : ' (nothing to do)'}`);
  } finally {
    await db.close();
  }
}
