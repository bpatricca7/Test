// Accounts platform tests (docs/ACCOUNTS.md §12.6, owner A): `npm run test:accounts`
// (node:test; the database from tools/testdb.mjs; no network).
// This first part covers the skeleton of §15.3 step 1: config refusals, migrations, the db
// interface, the limiters, the /api router's rules (CSRF, bodies, who may call, limits,
// cookies) and the server's accounts hooks. A adds sign-in, sessions, pairing, family,
// exports, delete, retention, the outbox, audit and the log spy below.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

import { loadConfig, ConfigError, summarizeConfig, subKey } from '../server/config.mjs';
import { migrate, migrationStatus, listMigrations } from '../server/migrate.mjs';
import { KeyedLimiter, Limits, Bucket } from '../server/limits.mjs';
import { createRouter, HttpError, parseCookies, serializeCookie, cookieOf } from '../server/http.mjs';
import { createAccounts, makeClock } from '../server/accounts.mjs';
import { createServer, clientIpOf, isInternalIp, addressKey } from '../server/server.mjs';
import { openTestDb } from './testdb.mjs';

const SECRET = randomBytes(32).toString('base64');
const ORIGIN = 'http://localhost:8080';
/** A complete, valid accounts environment (development, http://localhost). */
const ENV = Object.freeze({
  SW_ACCOUNTS: 'optional',
  DATABASE_URL: 'postgresql://sw@127.0.0.1:5432/sw',
  PUBLIC_ORIGIN: ORIGIN,
  SW_SECRET: SECRET,
  STRIPE_SECRET_KEY: 'sk_test_abc123',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
  STRIPE_PRICE_ID: 'price_abc123',
  MAIL_MODE: 'memory',
});
const PROD = Object.freeze({
  ...ENV,
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: 'https://sparkleworld.fun',
  STRIPE_SECRET_KEY: 'rk_live_abc123',
  MAIL_MODE: 'resend',
  MAIL_API_KEY: 're_abc',
  MAIL_FROM: 'Sparkle World <hello@sparkleworld.fun>',
  SW_OPERATOR_NAME: 'The Family',
  SW_OPERATOR_EMAIL: 'hello@sparkleworld.fun',
  SW_OPERATOR_ADDRESS: 'PO Box 1',
  SW_OPERATOR_PHONE: '+1 555 0100',
});

const refuses = (env, re) => {
  let err = null;
  try {
    loadConfig(env);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ConfigError, 'expected a refusal matching ' + re);
  assert.match(err.message, re);
  assert.ok(!err.message.includes('\n'), 'one line');
  return err;
};

// ---------------------------------------------------------------------------------------------

describe('config (§2)', () => {
  test('off by default, and nothing else is read or required', () => {
    const c = loadConfig({});
    assert.equal(c.accounts, 'off');
    assert.equal(loadConfig({ SW_ACCOUNTS: 'off', SW_FRIENDS_MODE: 'nonsense', SW_TEST: '1', NODE_ENV: 'production' }).accounts, 'off');
    assert.equal(summarizeConfig(c), 'accounts: off');
  });
  test('an unknown SW_ACCOUNTS refuses to start', () => refuses({ SW_ACCOUNTS: 'yes' }, /SW_ACCOUNTS must be one of off, optional, required/));
  test("the family's defaults", () => {
    const c = loadConfig(ENV);
    assert.deepEqual(
      [c.accounts, c.trialDays, c.friendsMode, c.mpConsent, c.graceDays, c.retainDays, [...c.sellCountries], c.priceText, c.worldMaxBytes, c.maxPerFamily],
      ['optional', 0, 'subscription', 'verified', 7, 90, ['US'], '$5.99 a month, plus sales tax where it applies', 8388608, 12],
    );
    assert.equal(loadConfig({ ...ENV, SW_ACCOUNTS: 'Required' }).accounts, 'required');
    assert.ok(Object.isFrozen(c));
  });
  test('every required variable is named when missing', () => {
    for (const k of ['DATABASE_URL', 'PUBLIC_ORIGIN', 'SW_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'MAIL_MODE']) {
      refuses({ ...ENV, [k]: '' }, new RegExp(`${k} is missing`));
    }
    for (const k of ['MAIL_API_KEY', 'MAIL_FROM', 'SW_OPERATOR_NAME', 'SW_OPERATOR_EMAIL', 'SW_OPERATOR_ADDRESS', 'SW_OPERATOR_PHONE']) {
      refuses({ ...PROD, [k]: '' }, new RegExp(`${k} is missing`));
    }
    assert.equal(loadConfig(PROD).production, true);
  });
  test('refusal rules', () => {
    refuses({ ...PROD, PUBLIC_ORIGIN: 'http://localhost:8080' }, /PUBLIC_ORIGIN must start with https:\/\/ in production/);
    refuses({ ...ENV, PUBLIC_ORIGIN: 'http://example.com' }, /PUBLIC_ORIGIN must start with https:\/\//);
    refuses({ ...ENV, PUBLIC_ORIGIN: 'https://sparkleworld.fun/account' }, /just the site address/);
    refuses({ ...ENV, SW_SECRET: randomBytes(31).toString('base64') }, /SW_SECRET must be at least 32 random bytes/);
    refuses({ ...ENV, SW_SECRET: 'not base64 at all!' }, /SW_SECRET/);
    refuses({ ...PROD, MAIL_MODE: 'log' }, /MAIL_MODE must be resend or postmark in production/);
    refuses({ ...PROD, MAIL_MODE: 'memory' }, /MAIL_MODE must be resend or postmark in production/);
    refuses({ ...PROD, SW_TEST: '1' }, /SW_TEST=1 is refused in production/);
    refuses({ ...ENV, SW_TEST: '1', STRIPE_SECRET_KEY: 'sk_live_abc' }, /SW_TEST=1 is refused with a live Stripe key/);
    refuses({ ...PROD, STRIPE_API_BASE: 'http://127.0.0.1:1234' }, /STRIPE_API_BASE is for tests only/);
    refuses({ ...ENV, SW_STRIPE_SHAPES: '1', STRIPE_SECRET_KEY: 'rk_live_abc' }, /SW_STRIPE_SHAPES=1 is for test keys only/);
    refuses({ ...ENV, SW_FRIENDS_MODE: 'free-join' }, /free-join needs SW_MP_CONSENT=email_plus/);
    refuses({ ...ENV, SW_FRIENDS_MODE: 'free-join', SW_MP_CONSENT: 'verified' }, /free-join needs SW_MP_CONSENT=email_plus/);
    refuses({ ...ENV, SW_FRIENDS_MODE: 'everyone' }, /SW_FRIENDS_MODE must be one of/);
    refuses({ ...ENV, SW_MP_CONSENT: 'maybe' }, /SW_MP_CONSENT must be one of/);
    refuses({ ...ENV, MAIL_MODE: 'smtp' }, /MAIL_MODE must be one of/);
    refuses({ ...ENV, SW_TRIAL_DAYS: '-1' }, /SW_TRIAL_DAYS must be a whole number/);
    refuses({ ...ENV, SW_TRIAL_DAYS: '7.5' }, /SW_TRIAL_DAYS must be a whole number/);
    refuses({ ...ENV, SW_SELL_COUNTRIES: 'USA' }, /SW_SELL_COUNTRIES/);
    refuses({ ...ENV, STRIPE_SECRET_KEY: 'pk_test_abc' }, /STRIPE_SECRET_KEY/);
    refuses({ ...ENV, STRIPE_WEBHOOK_SECRET: 'abc' }, /STRIPE_WEBHOOK_SECRET must start with whsec_/);
    refuses({ ...ENV, STRIPE_PRICE_ID: 'prod_abc' }, /STRIPE_PRICE_ID must start with price_/);
    refuses({ ...ENV, STRIPE_PORTAL_CONFIG: 'x' }, /STRIPE_PORTAL_CONFIG must start with bpc_/);
    refuses({ ...ENV, DATABASE_URL: 'mysql://x' }, /DATABASE_URL must be a postgres/);
    refuses({ ...PROD, DATABASE_URL: 'pglite:' }, /pglite: is for development and tests only/);
    const ok = loadConfig({ ...ENV, SW_FRIENDS_MODE: 'free-join', SW_MP_CONSENT: 'email_plus', SW_TRIAL_DAYS: '7', SW_SELL_COUNTRIES: 'us, ca' });
    assert.deepEqual([ok.friendsMode, ok.mpConsent, ok.trialDays, [...ok.sellCountries]], ['free-join', 'email_plus', 7, ['US', 'CA']]);
  });
  test('several problems in one line, and no secret in it', () => {
    const err = refuses({ ...ENV, SW_SECRET: 'c2hvcnQ=', STRIPE_SECRET_KEY: 'sk_live_TOPSECRET', SW_TEST: '1', DATABASE_URL: 'mysql://user:hunter2@x' }, /; /);
    assert.ok(err.problems.length >= 3);
    for (const s of ['c2hvcnQ=', 'TOPSECRET', 'hunter2']) assert.ok(!err.message.includes(s), 'leaked ' + s);
  });
  test('cookies: __Host- and Secure over https, plain names over http://localhost (§4.2)', () => {
    const dev = loadConfig(ENV);
    assert.deepEqual([dev.cookies.sess, dev.cookies.login, dev.cookies.secure, dev.hsts], ['sw_sess', 'sw_login', false, false]);
    const prod = loadConfig(PROD);
    assert.deepEqual([prod.cookies.sess, prod.cookies.login, prod.cookies.secure, prod.hsts, prod.publicOrigin], ['__Host-sw_sess', '__Host-sw_login', true, true, 'https://sparkleworld.fun']);
    assert.equal(serializeCookie(prod, 'sess', 'abc_-1', 3600), '__Host-sw_sess=abc_-1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure');
    assert.equal(serializeCookie(dev, 'login', null), 'sw_login=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    assert.throws(() => serializeCookie(prod, 'sess', 'a;b', 1));
    assert.equal(cookieOf(prod, 'x=1; __Host-sw_sess=tok_1', 'sess'), 'tok_1');
    assert.equal(cookieOf(prod, 'sw_sess=tok_1', 'sess'), null);
    assert.deepEqual({ ...parseCookies('a=1; b="2"; a=3; =x; c') }, { a: '1', b: '2' });
  });
  test('sub-keys (HKDF) are stable, distinct and not the secret', () => {
    const c = loadConfig(ENV);
    const again = loadConfig(ENV);
    assert.ok(c.keys.code.equals(again.keys.code));
    assert.ok(!c.keys.code.equals(c.keys.email) && !c.keys.email.equals(c.keys.pair));
    assert.equal(c.keys.pair.length, 32);
    assert.ok(subKey(c.secret, 'code').equals(c.keys.code));
    assert.ok(!summarizeConfig(c).includes(SECRET));
  });
});

// ---------------------------------------------------------------------------------------------

describe('limits', () => {
  test('KeyedLimiter: count per window with a burst, per key, and forgets full buckets', () => {
    let t = 0;
    const l = new KeyedLimiter({ count: 10, perMs: 3600e3, burst: 5, now: () => t });
    for (let i = 0; i < 5; i++) assert.equal(l.take('a'), true);
    assert.equal(l.take('a'), false);
    assert.equal(l.take('b'), true, 'another key has its own bucket');
    assert.equal(l.retryAfter('a'), 360, 'one token every 6 minutes');
    t += 360e3;
    assert.equal(l.take('a'), true);
    assert.equal(l.take('a'), false);
    t += 10 * 3600e3;
    l.sweep();
    assert.equal(l.size, 0);
  });
  test('Limits: one limiter per name', () => {
    const limits = new Limits({ now: () => 0 });
    const spec = { name: 'x', count: 2, perMs: 1000 };
    assert.deepEqual([limits.check(spec, 'k').ok, limits.check(spec, 'k').ok], [true, true]);
    const no = limits.check(spec, 'k');
    assert.equal(no.ok, false);
    assert.ok(no.retryAfter >= 1);
  });
  test('Bucket and the address helpers still come from server.mjs', () => {
    const b = new Bucket(1, 2);
    assert.deepEqual([b.take(), b.take(), b.take()], [true, true, false]);
    assert.equal(clientIpOf('100.64.0.2', '203.0.113.9, 10.0.0.1'), '203.0.113.9');
    assert.equal(isInternalIp('192.168.1.1'), true);
    assert.equal(addressKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  });
});

// ---------------------------------------------------------------------------------------------

describe('database and migrations (§3)', () => {
  let t;
  before(async () => {
    t = await openTestDb({ migrate: false });
  });
  after(async () => t && t.close());

  test('migrate applies 001 once; running it again changes nothing', async () => {
    assert.deepEqual(await migrationStatus(t.db), { ok: false, current: 0, latest: listMigrations().length });
    const first = await migrate(t.db);
    assert.deepEqual(first.applied, [1]);
    const second = await migrate(t.db);
    assert.deepEqual(second, { applied: [], current: 1 });
    assert.equal((await migrationStatus(t.db)).ok, true);
    const tables = (await t.db.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename);
    assert.deepEqual(tables, ['audit_log', 'deleted_families', 'families', 'gone_sessions', 'login_attempts', 'outbox', 'pair_codes', 'player_profiles', 'players', 'schema_migrations', 'sessions', 'stripe_events', 'subscriptions', 'worlds']);
  });

  test('values: int8 → Number, bytea → Buffer, timestamptz → Date, jsonb parsed', async () => {
    const f = await t.db.one("insert into families (email, flags) values ('p@example.com', $1) returning *", [JSON.stringify({ dispute: true })]);
    assert.equal(typeof f.id, 'string');
    assert.ok(f.created_at instanceof Date);
    assert.deepEqual(f.flags, { dispute: true });
    const p = await t.db.one("insert into players (family_id, nickname) values ($1, 'Star') returning id", [f.id]);
    const w = await t.db.one('insert into worlds (player_id, world_id, rev, client_updated_at, meta, body) values ($1, $2, $3, $4, $5, $6) returning rev, client_updated_at, body', [
      p.id, 'w1', 1, 1790000000000, JSON.stringify({ name: 'A' }), Buffer.from([1, 2, 3]),
    ]);
    assert.deepEqual([w.rev, w.client_updated_at], [1, 1790000000000]);
    assert.ok(Buffer.isBuffer(w.body) && w.body.equals(Buffer.from([1, 2, 3])));
    assert.equal((await t.db.one('select count(*) as n from worlds')).n, 1);
    const upd = await t.db.query("update families set country = 'US' where id = $1", [f.id]);
    assert.equal(upd.rowCount, 1);
  });

  test('the schema checks what §3.3 says', async () => {
    const bad = [
      "insert into families (email) values ('Upper@Example.com')",
      "insert into families (email, country) values ('c@example.com', 'usa')",
      "insert into families (email, verified_method) values ('d@example.com', 'guess')",
    ];
    for (const sql of bad) await assert.rejects(t.db.query(sql));
    const f = await t.db.one("insert into families (email) values ('e@example.com') returning id");
    await assert.rejects(t.db.query("insert into players (family_id, nickname) values ($1, 'ThirteenChars')", [f.id]));
    await t.db.query("insert into players (family_id, nickname) values ($1, 'Lily')", [f.id]);
    await assert.rejects(t.db.query("insert into players (family_id, nickname) values ($1, 'LILY')", [f.id]), 'nicknames unique per family, any case');
    await assert.rejects(t.db.query("insert into players (family_id, nickname, walkie_on) values ($1, 'Mia', true)", [f.id]), 'walkie needs friends');
    const p = await t.db.one("select id from players where family_id = $1", [f.id]);
    await assert.rejects(t.db.query("insert into worlds (player_id, world_id, rev, client_updated_at, meta) values ($1, 'bad/id', 1, 1, '{}')", [p.id]));
    await t.db.query("insert into worlds (player_id, world_id, rev, client_updated_at, meta) values ($1, 'w-1.before~ab', 1, 1, '{}')", [p.id]);
    await t.db.query('delete from families where id = $1', [f.id]);
    assert.equal((await t.db.one('select count(*) as n from worlds where player_id = $1', [p.id])).n, 0, 'cascades to players and worlds');
  });

  test('tx rolls back on error; only q inside', async () => {
    const before = (await t.db.one('select count(*) as n from families')).n;
    await assert.rejects(t.db.tx(async (q) => {
      await q.query("insert into families (email) values ('tx@example.com')");
      throw new Error('boom');
    }), /boom/);
    assert.equal((await t.db.one('select count(*) as n from families')).n, before);
    const v = await t.db.tx(async (q) => (await q.one("insert into families (email) values ('tx2@example.com') returning email")).email);
    assert.equal(v, 'tx2@example.com');
  });

  test('tryLock: one holder at a time; lock waits', async () => {
    let inner = null;
    const outer = await t.db.tryLock('sparkle-world:job:test', async () => {
      inner = await t.db.tryLock('sparkle-world:job:test', async () => 'ran');
      return 'outer';
    });
    assert.deepEqual(outer, { ok: true, value: 'outer' });
    assert.deepEqual(inner, { ok: false });
    assert.deepEqual(await t.db.tryLock('sparkle-world:job:test', async () => 2), { ok: true, value: 2 });
    const order = [];
    await Promise.all([
      t.db.lock('sparkle-world:x', async () => {
        order.push('a1');
        await new Promise((r) => setTimeout(r, 50));
        order.push('a2');
      }),
      t.db.lock('sparkle-world:x', async () => order.push('b')),
    ]);
    assert.deepEqual(order, ['a1', 'a2', 'b']);
    assert.equal(await t.db.ping(2000), true);
  });

  test('reset empties every table but keeps the migrations', async () => {
    await t.reset();
    assert.equal((await t.db.one('select count(*) as n from families')).n, 0);
    assert.equal((await migrationStatus(t.db)).ok, true);
  });
});

// ---------------------------------------------------------------------------------------------
// the router's rules (§4.7, §4.8, §5.1), with made-up routes and a pretend session store

describe('the /api router', () => {
  const cfg = loadConfig({ ...ENV, SW_TEST: '' });
  const FAM = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const PID = '33333333-3333-4333-8333-333333333333';
  const PID2 = '44444444-4444-4444-8444-444444444444';
  const GONE = '55555555-5555-4555-8555-555555555555';
  const clock = makeClock();
  const sessions = {
    parent: { hash: Buffer.alloc(32, 1), kind: 'parent', familyId: FAM, lockPlayer: null, elevatedUntil: null, elevatedAt: null },
    checked: { hash: Buffer.alloc(32, 2), kind: 'parent', familyId: FAM, lockPlayer: null, elevatedUntil: Date.now() + 600e3, elevatedAt: Date.now() - 6 * 60e3 },
    fresh: { hash: Buffer.alloc(32, 3), kind: 'parent', familyId: FAM, lockPlayer: null, elevatedUntil: Date.now() + 600e3, elevatedAt: Date.now() - 60e3 },
    device: { hash: Buffer.alloc(32, 4), kind: 'device', familyId: FAM, lockPlayer: null },
    locked: { hash: Buffer.alloc(32, 5), kind: 'device', familyId: FAM, lockPlayer: PID2 },
  };
  const ctx = {
    clock,
    log: () => {},
    limits: new Limits(),
    sessions: {
      async fromRequest(req) {
        const tok = cookieOf(cfg, req, 'sess');
        if (tok === 'gone') throw new HttpError(410, 'family_gone');
        return sessions[tok] || null;
      },
    },
    family: {
      load: async (id) => ({ id }),
      player: async (pid) => (pid === PID || pid === PID2 ? { id: pid, family_id: FAM } : pid === OTHER ? { id: OTHER, family_id: OTHER } : null),
    },
  };
  const echo = async (req, x) => ({ json: { ok: true, params: x.params, query: x.query, body: x.body, kind: x.session?.kind ?? null, player: x.player?.id ?? null, gone: x.sessionError?.code ?? null } });
  const routes = [
    { method: 'GET', path: '/api/me', who: 'anyone', handler: echo },
    { method: 'POST', path: '/api/auth/start', who: 'anyone', handler: echo, limit: [{ name: 't-start', count: 2, perMs: 3600e3, key: 'ip' }] },
    { method: 'POST', path: '/api/auth/logout', who: 'session', handler: async () => ({ json: { ok: true }, cookies: [{ name: 'sess', value: null }] }) },
    { method: 'GET', path: '/api/family', who: 'parent', handler: echo },
    { method: 'POST', path: '/api/billing/portal', who: 'parent+check', handler: echo },
    { method: 'POST', path: '/api/family/delete', who: 'parent+check5', handler: echo },
    { method: 'GET', path: '/api/players/:pid/worlds/:wid', who: 'player', handler: echo },
    { method: 'PUT', path: '/api/players/:pid/worlds/:wid', who: 'player', body: { kind: 'world', max: 4096 }, handler: async (req, x) => ({ json: { size: x.bodyBytes.length, gz: !!x.bodyGzip, id: x.body.id } }) },
    { method: 'POST', path: '/api/devices/this', who: 'parent', handler: async () => ({ json: { which: 'this' } }) },
    { method: 'PATCH', path: '/api/devices/:id', who: 'parent', handler: async (req, x) => ({ json: { which: x.params.id } }) },
    { method: 'POST', path: '/api/stripe/webhook', who: 'stripe', handler: async (req, x) => ({ json: { raw: Buffer.isBuffer(x.body) ? x.body.toString() : null } }) },
    { method: 'GET', path: '/api/test/mail', who: 'test', handler: echo },
    { method: 'GET', path: '/api/boom', who: 'anyone', handler: async () => { throw new TypeError('secret detail'); } },
    { method: 'GET', path: '/api/pic', who: 'anyone', handler: async () => ({ body: Buffer.from([0xff, 0xd8]), headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } }) },
  ];
  let srv;
  let port;
  const logged = [];
  before(async () => {
    const router = createRouter({ cfg, ctx: { ...ctx, log: (l) => logged.push(l) }, routes });
    srv = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (!(await router.handle(req, res, url))) {
        res.writeHead(404);
        res.end('not ours');
      }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    port = srv.address().port;
  });
  after(() => new Promise((r) => srv.close(r)));

  const call = (method, p, { headers = {}, body, session, json = true } = {}) => new Promise((resolve, reject) => {
    const h = { ...headers };
    if (session) h.cookie = `sw_sess=${session}`;
    if (body !== undefined && json && !Buffer.isBuffer(body)) body = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data, text });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
  const SAFE = { 'x-sw': '1', origin: ORIGIN, 'content-type': 'application/json' };

  test('GET needs no CSRF headers; params and query are decoded', async () => {
    const r = await call('GET', `/api/players/${PID}/worlds/w%2E1?x=1`, { session: 'device' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.params, { pid: PID, wid: 'w.1' });
    assert.deepEqual(r.data.query, { x: '1' });
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-type'], /^application\/json; charset=utf-8/);
  });
  test('not our path → false (server.mjs answers 404); wrong method → 405 with Allow', async () => {
    assert.equal((await call('GET', '/api/nothing')).text, 'not ours');
    const r = await call('DELETE', '/api/me', { headers: SAFE });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, HEAD');
  });
  test('CSRF: X-SW, Origin, Content-Type, Sec-Fetch-Site; the webhook is exempt (§4.7)', async () => {
    const b = { email: 'a@b.co' };
    assert.equal((await call('POST', '/api/auth/start', { headers: SAFE, body: b })).status, 200);
    assert.deepEqual((await call('POST', '/api/me', { headers: SAFE, body: b })).status, 405);
    const without = (k) => Object.fromEntries(Object.entries(SAFE).filter(([key]) => key !== k));
    const r1 = await call('POST', '/api/auth/logout', { headers: without('x-sw'), body: b, session: 'parent' });
    assert.deepEqual([r1.status, r1.data], [403, { error: 'forbidden' }]);
    assert.equal((await call('POST', '/api/auth/logout', { headers: without('origin'), body: b, session: 'parent' })).status, 403);
    assert.equal((await call('POST', '/api/auth/logout', { headers: { ...SAFE, origin: 'https://evil.example' }, body: b, session: 'parent' })).status, 403);
    assert.equal((await call('POST', '/api/auth/logout', { headers: { ...SAFE, 'sec-fetch-site': 'cross-site' }, body: b, session: 'parent' })).status, 403);
    assert.equal((await call('POST', '/api/auth/logout', { headers: { ...SAFE, 'sec-fetch-site': 'same-origin' }, body: b, session: 'parent' })).status, 200);
    assert.equal((await call('POST', '/api/auth/logout', { headers: { ...SAFE, 'content-type': 'text/plain' }, body: b, session: 'parent' })).status, 415);
    assert.equal((await call('POST', '/api/auth/logout', { headers: { ...SAFE, 'content-type': 'application/json; charset=utf-8' }, body: b, session: 'parent' })).status, 200);
    const hook = await call('POST', '/api/stripe/webhook', { headers: { 'content-type': 'application/json', 'stripe-signature': 't=1' }, body: '{"id":"evt_1"}', json: false });
    assert.deepEqual([hook.status, hook.data.raw], [200, '{"id":"evt_1"}']);
  });
  test('bodies: JSON objects only, 16 KB, gzip only where allowed, gzip bombs are 413', async () => {
    assert.equal((await call('POST', '/api/auth/start', { headers: SAFE, body: '[1,2]', json: false })).status, 400);
    assert.equal((await call('POST', '/api/auth/start', { headers: SAFE, body: '{nope', json: false })).status, 400);
    const big = await call('POST', '/api/auth/logout', { headers: SAFE, body: { x: 'a'.repeat(17000) }, session: 'parent' });
    assert.deepEqual([big.status, big.data], [413, { error: 'too_big' }]);
    const save = { id: 'w1', blocks: 'x'.repeat(1000) };
    const plain = await call('PUT', `/api/players/${PID}/worlds/w1`, { headers: SAFE, body: save, session: 'parent' });
    assert.deepEqual([plain.status, plain.data.gz, plain.data.id], [200, false, 'w1']);
    const gz = await call('PUT', `/api/players/${PID}/worlds/w1`, { headers: { ...SAFE, 'content-encoding': 'gzip' }, body: gzipSync(JSON.stringify(save)), session: 'parent' });
    assert.deepEqual([gz.status, gz.data.gz, gz.data.size], [200, true, JSON.stringify(save).length]);
    const bomb = await call('PUT', `/api/players/${PID}/worlds/w1`, { headers: { ...SAFE, 'content-encoding': 'gzip' }, body: gzipSync(Buffer.alloc(1e6, 32)), session: 'parent' });
    assert.deepEqual([bomb.status, bomb.data], [413, { error: 'too_big' }]);
    const notGz = await call('PUT', `/api/players/${PID}/worlds/w1`, { headers: { ...SAFE, 'content-encoding': 'gzip' }, body: Buffer.from('plain'), session: 'parent' });
    assert.equal(notGz.status, 400);
    assert.equal((await call('POST', '/api/auth/logout', { headers: { ...SAFE, 'content-encoding': 'gzip' }, body: gzipSync('{}'), session: 'parent' })).status, 415, 'no gzip on plain JSON routes');
  });
  test('who: signed out, device, check, check within 5 minutes (§5.1)', async () => {
    assert.deepEqual((await call('GET', '/api/family')).data, { error: 'signed_out' });
    assert.equal((await call('GET', '/api/family')).status, 401);
    assert.deepEqual([(await call('GET', '/api/family', { session: 'device' })).status, (await call('GET', '/api/family', { session: 'device' })).data.error], [403, 'forbidden']);
    assert.equal((await call('GET', '/api/family', { session: 'parent' })).status, 200);
    const p1 = await call('POST', '/api/billing/portal', { headers: SAFE, body: {}, session: 'parent' });
    assert.deepEqual([p1.status, p1.data], [403, { error: 'check_required' }]);
    assert.equal((await call('POST', '/api/billing/portal', { headers: SAFE, body: {}, session: 'checked' })).status, 200);
    assert.equal((await call('POST', '/api/family/delete', { headers: SAFE, body: {}, session: 'checked' })).data.error, 'check_required', 'a check 6 minutes ago is too old to delete');
    assert.equal((await call('POST', '/api/family/delete', { headers: SAFE, body: {}, session: 'fresh' })).status, 200);
    const gone = await call('GET', '/api/family', { session: 'gone' });
    assert.deepEqual([gone.status, gone.data], [410, { error: 'family_gone' }]);
    const me = await call('GET', '/api/me', { session: 'gone' });
    assert.deepEqual([me.status, me.data.gone], [200, 'family_gone'], "'anyone' routes see the session error and decide");
  });
  test('who: player — another family 404, deleted 410, a locked device only its player', async () => {
    assert.equal((await call('GET', `/api/players/${PID}/worlds/w1`, { session: 'device' })).data.player, PID);
    assert.deepEqual((await call('GET', `/api/players/${OTHER}/worlds/w1`, { session: 'parent' })).data, { error: 'not_found' });
    const gone = await call('GET', `/api/players/${GONE}/worlds/w1`, { session: 'parent' });
    assert.deepEqual([gone.status, gone.data], [410, { error: 'player_gone' }]);
    assert.equal((await call('GET', '/api/players/not-a-uuid/worlds/w1', { session: 'parent' })).status, 404);
    assert.equal((await call('GET', `/api/players/${PID}/worlds/w1`, { session: 'locked' })).status, 404);
    assert.equal((await call('GET', `/api/players/${PID2}/worlds/w1`, { session: 'locked' })).status, 200);
    assert.equal((await call('GET', `/api/players/${PID}/worlds/w1`)).status, 401);
  });
  test('the most specific path wins', async () => {
    assert.equal((await call('POST', '/api/devices/this', { headers: SAFE, body: {}, session: 'parent' })).data.which, 'this');
    assert.equal((await call('PATCH', '/api/devices/abcd1234', { headers: SAFE, body: {}, session: 'parent' })).data.which, 'abcd1234');
  });
  test('route limits answer 429 rate with Retry-After', async () => {
    const r = await call('POST', '/api/auth/start', { headers: SAFE, body: {} }); // the 2nd of 2 (one in the CSRF test)
    assert.equal(r.status, 200);
    const no = await call('POST', '/api/auth/start', { headers: SAFE, body: {} });
    assert.deepEqual([no.status, no.data], [429, { error: 'rate' }]);
    assert.ok(+no.headers['retry-after'] >= 1);
  });
  test('cookies are set with the §4.2 attributes', async () => {
    const r = await call('POST', '/api/auth/logout', { headers: SAFE, body: {}, session: 'parent' });
    assert.deepEqual(r.headers['set-cookie'], ['sw_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
  });
  test('/api/test/* do not exist without SW_TEST=1', async () => {
    assert.equal((await call('GET', '/api/test/mail')).text, 'not ours');
  });
  test('a surprise is 503 unavailable, logged by its name only', async () => {
    const r = await call('GET', '/api/boom');
    assert.deepEqual([r.status, r.data], [503, { error: 'unavailable' }]);
    assert.ok(logged.some((l) => l.includes('TypeError')));
    assert.ok(!logged.some((l) => l.includes('secret detail')));
  });
  test('binary answers keep their own headers', async () => {
    const r = await call('GET', '/api/pic');
    assert.deepEqual([r.status, r.headers['content-type'], r.headers['cache-control']], [200, 'image/jpeg', 'private, max-age=86400']);
  });
});

// ---------------------------------------------------------------------------------------------
// server.mjs with accounts on (the skeleton's hooks) and off (exactly as before)

describe('server hooks (§1.2, §8.1)', () => {
  let t;
  const dir = mkdtempSync(path.join(tmpdir(), 'sw-acct-'));
  const html = path.join(dir, 'game.html');
  writeFileSync(html, '<!doctype html><title>Sparkle World</title>');
  const servers = [];
  before(async () => {
    t = await openTestDb();
  });
  after(async () => {
    for (const s of servers) await s.close();
    if (t) await t.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(env, { withAccounts = true } = {}) {
    const cfg = loadConfig(env);
    const accounts = withAccounts ? await createAccounts(cfg, { log: () => {}, db: t.db }) : null;
    const app = createServer({ accounts, htmlPath: html, siteDir: path.join(dir, 'none'), log: () => {} });
    const port = await app.listen(0, '127.0.0.1');
    servers.push(app);
    return { app, port, base: `http://127.0.0.1:${port}` };
  }
  const ws = (port, q, headers = {}) => new Promise((resolve) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}/r/test-room-1?s=${'a'.repeat(20)}${q}`, { headers });
    const box = { frames: [], closed: null, opened: false, status: null };
    s.on('open', () => (box.opened = true));
    s.on('message', (d) => box.frames.push(JSON.parse(d.toString())));
    s.on('close', (code) => {
      box.closed = code;
      resolve(box);
    });
    s.on('unexpected-response', (req, res) => {
      box.status = res.statusCode;
      resolve(box);
    });
    s.on('error', () => {});
    box.ws = s;
    setTimeout(() => {
      if (box.opened && box.closed === null) {
        s.close(1000);
      }
    }, 400);
  });

  test('accounts off: /api/net, /healthz and a POST exactly as before', async () => {
    const { base } = await start({}, { withAccounts: false });
    const net = await (await fetch(base + '/api/net')).json();
    assert.deepEqual(Object.keys(net).sort(), ['build', 'ok', 'version']);
    assert.deepEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
    const post = await fetch(base + '/api/me', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal((await fetch(base + '/api/me')).status, 404);
    assert.equal((await fetch(base + '/healthz')).headers.get('strict-transport-security'), null);
  });

  test('accounts on: /api/net fields, /healthz asks the database, unknown /api → 404 JSON', async () => {
    const { base, app } = await start(ENV);
    const net = await (await fetch(base + '/api/net')).json();
    assert.deepEqual([net.ok, net.accounts, net.friendsMode], [true, 'optional', 'subscription']);
    assert.deepEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
    const r = await fetch(base + '/api/nothing-here', { method: 'POST' });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'not_found' });
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal((await fetch(base + '/play', { method: 'POST' })).status, 405, 'still 405 outside /api');
    const h = await app.accounts.health();
    assert.deepEqual(h, { ok: true, db: true, migrations: 1 });
  });

  test('optional: a socket without cookie and p is a legacy socket; with p it is refused after the handshake', async () => {
    const { port } = await start(ENV);
    const legacy = await ws(port, '');
    assert.equal(legacy.opened, true);
    assert.equal(legacy.closed, 1000, 'closed by the test, not the server');
    const withP = await ws(port, '&p=33333333-3333-4333-8333-333333333333');
    assert.equal(withP.opened, true, 'the handshake completes');
    assert.equal(withP.closed, 4401);
    assert.deepEqual(withP.frames, [{ t: 'e', code: 'signed_out' }]);
    const badP = await ws(port, '&p=' + encodeURIComponent('<script>'));
    assert.equal(badP.status, 400);
  });

  test('required: every socket needs a session', async () => {
    const { port } = await start({ ...ENV, SW_ACCOUNTS: 'required' });
    const s = await ws(port, '');
    assert.deepEqual([s.opened, s.closed, s.frames], [true, 4401, [{ t: 'e', code: 'signed_out' }]]);
  });
});
