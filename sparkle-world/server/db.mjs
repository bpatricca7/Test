// The database (docs/ACCOUNTS.md §3.1): one small interface over a `pg` Pool (Railway
// Postgres) or an in-process PGlite (development and tests), so every module and test uses the
// same calls:
//
//   const db = await openDb(url, { log })     url: postgres(ql)://…, or pglite: / pglite:<dir>
//   await db.query(sql, params) → { rows, rowCount }     one statement, $1…$n parameters
//   await db.one(sql, params)   → the first row or null
//   await db.exec(sql)          → runs a script of several statements (migrations), no params
//   await db.tx(async (q) => …) → BEGIN … COMMIT (ROLLBACK and rethrow on error); q has
//                                  query/one/exec. Inside the callback use ONLY q (a db.query
//                                  there runs outside the transaction on pg and waits forever
//                                  on PGlite, which has one connection).
//   await db.tryLock(name, fn)  → { ok: true, value } after running fn while holding
//                                  pg_try_advisory_lock(hashtext(name)), or { ok: false } when
//                                  another instance holds it (jobs, §13.7)
//   await db.lock(name, fn)     → the same, waiting for the lock (migrations, §3.2)
//   await db.ping(ms)           → true when `select 1` answers within ms
//   await db.close()
//
// Values: int8 (bigint, count(*)) comes back as a Number, bytea as a Buffer, timestamptz as a
// Date, jsonb as parsed JSON, for both drivers. Pass jsonb parameters as JSON.stringify(value)
// (pg would turn a JS array into a Postgres array), bytea as a Buffer, times as a Date made
// from the app clock (`new Date(clock.now())`, §3.1).
//
// Errors are logged by name only (never SQL parameters: they hold emails and tokens).

import pg from 'pg';

const INT8 = 20;
const BYTEA = 17;

/** Open the database named by `url`. */
export async function openDb(url, { log = () => {}, max = 10 } = {}) {
  if (typeof url === 'string' && /^pglite:/i.test(url)) return openPglite(url.slice('pglite:'.length).replace(/^\/\//, '') || null, { log });
  return openPg(url, { log, max });
}

// ---------------------------------------------------------------------------------------------
// pg (production, CI, the tests' throwaway cluster)

const pgTypes = {
  getTypeParser(oid, format) {
    if (oid === INT8) return (v) => (v === null ? null : Number(v)); // revs and epoch ms stay below 2^53
    return pg.types.getTypeParser(oid, format);
  },
};

export async function openPg(url, { log = () => {}, max = 10 } = {}) {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    types: pgTypes,
  });
  // an idle client losing its connection (a database restart) must not end the process
  pool.on('error', (err) => log(`db: idle connection error ${err && err.code ? err.code : err && err.name ? err.name : 'Error'}`));
  const norm = (r) => ({ rows: r.rows || [], rowCount: r.rowCount ?? (r.rows ? r.rows.length : 0) });
  const q = (runner) => ({
    query: async (sql, params = []) => norm(await runner.query(sql, params)),
    one: async (sql, params = []) => (await runner.query(sql, params)).rows?.[0] ?? null,
    exec: async (sql) => {
      await runner.query(sql); // no parameters: the simple protocol runs several statements
    },
  });
  const base = q(pool);
  let closed = false;

  async function withLock(name, fn, wait) {
    const client = await pool.connect();
    let locked = false;
    try {
      if (wait) await client.query('set statement_timeout = 0'); // waiting for another instance is not a slow query
      const r = await client.query(`select ${wait ? 'pg_advisory_lock' : 'pg_try_advisory_lock'}(hashtext($1)) as ok`, [name]);
      locked = wait ? true : r.rows[0].ok === true;
      if (!locked) return { ok: false };
      return { ok: true, value: await fn() };
    } finally {
      if (locked) {
        try {
          await client.query('select pg_advisory_unlock(hashtext($1))', [name]);
        } catch {}
      }
      if (wait) {
        try {
          await client.query('reset statement_timeout');
        } catch {}
      }
      client.release();
    }
  }

  return {
    kind: 'pg',
    ...base,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const value = await fn(q(client));
        await client.query('commit');
        return value;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch {}
        throw err;
      } finally {
        client.release();
      }
    },
    tryLock: (name, fn) => withLock(name, fn, false),
    lock: (name, fn) => withLock(name, fn, true).then((r) => r.value),
    ping: (ms = 2000) => ping(base, ms),
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
    pool,
  };
}

// ---------------------------------------------------------------------------------------------
// PGlite (in-process Postgres: `npm run dev:accounts` without a database, and tests when no
// real Postgres is available). A devDependency, loaded only here and only when asked for.
// One connection, so advisory locks are kept in memory (per db object) instead.

export async function openPglite(dataDir = null, { log = () => {} } = {}) {
  let mod;
  try {
    mod = await import('@electric-sql/pglite');
  } catch {
    throw new Error('pglite: @electric-sql/pglite is not installed (it is a devDependency: npm ci without --omit=dev)');
  }
  const { PGlite, types } = mod;
  const pgl = await PGlite.create({
    ...(dataDir ? { dataDir } : {}),
    parsers: {
      [types.INT8]: (v) => (v === null ? null : Number(v)),
      [types.BYTEA]: (v) => (typeof v === 'string' && v.startsWith('\\x') ? Buffer.from(v.slice(2), 'hex') : Buffer.from(v)),
    },
  });
  const norm = (r) => ({ rows: r.rows || [], rowCount: r.affectedRows ?? r.rowCount ?? (r.rows ? r.rows.length : 0) });
  const q = (runner) => ({
    query: async (sql, params = []) => norm(await runner.query(sql, params)),
    one: async (sql, params = []) => (await runner.query(sql, params)).rows?.[0] ?? null,
    exec: async (sql) => {
      await runner.exec(sql);
    },
  });
  const base = q(pgl);
  const held = new Map(); // lock name -> promise that resolves when released
  let closed = false;

  async function withLock(name, fn, wait) {
    while (held.has(name)) {
      if (!wait) return { ok: false };
      await held.get(name);
    }
    let release;
    held.set(name, new Promise((r) => (release = r)));
    try {
      return { ok: true, value: await fn() };
    } finally {
      held.delete(name);
      release();
    }
  }

  return {
    kind: 'pglite',
    ...base,
    tx: (fn) => pgl.transaction((t) => fn(q(t))),
    tryLock: (name, fn) => withLock(name, fn, false),
    lock: (name, fn) => withLock(name, fn, true).then((r) => r.value),
    ping: (ms = 2000) => ping(base, ms),
    async close() {
      if (closed) return;
      closed = true;
      await pgl.close();
    },
    pglite: pgl,
  };
}

async function ping(base, ms) {
  let timer;
  try {
    const r = await Promise.race([
      base.one('select 1 as ok'),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
    return !!r && r.ok === 1;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
