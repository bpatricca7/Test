// Accounts platform tests (docs/ACCOUNTS.md §12.6, owner A): `npm run test:accounts`
// (node:test; the database from tools/testdb.mjs; no network).
// This first part covers the skeleton of §15.3 step 1: config refusals, migrations, the db
// interface, the limiters, the /api router's rules (CSRF, bodies, who may call, limits,
// cookies) and the server's accounts hooks. A adds sign-in, sessions, pairing, family,
// exports, delete, retention, the outbox, audit and the log spy below.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import { loadConfig, ConfigError, summarizeConfig, subKey } from '../server/config.mjs';
import { migrate, migrationStatus, listMigrations } from '../server/migrate.mjs';
import { KeyedLimiter, Limits, Bucket } from '../server/limits.mjs';
import { createRouter, HttpError, parseCookies, serializeCookie, cookieOf } from '../server/http.mjs';
import { createAccounts, makeClock } from '../server/accounts.mjs';
import { createServer, clientIpOf, isInternalIp, addressKey } from '../server/server.mjs';
import { openTestDb, installLogSpy } from './testdb.mjs';
import { safeNext, normalizeEmail, normalizePairCode, deviceLabel, cleanLabel, AUTH_LIMITS } from '../server/auth.mjs';
import { accessOf, cleanNickname } from '../server/family.mjs';
import { audit, checkAudit, AUDIT_ACTIONS } from '../server/audit.mjs';
import { makeTransport, maskEmail, MAIL_BACKOFF_MS, MAIL_MAX_TRIES } from '../server/mail.mjs';
import { renderMail, TEMPLATES } from '../server/mail-templates.mjs';
import { fullYears, msUntilUtc } from '../server/jobs.mjs';
import { runAdmin } from '../server/admin.mjs';
import { entitlementOf } from '../server/entitlement.mjs';
import { NOTICE_VERSION, NOTICE_MIN_VERSION } from '../server/notice.mjs';
import { readWorldFile } from '../src/core/storage.js';

// The log spy (§12.7): from here on every console line of this file, and every log function
// given to the servers below, is kept (and printed only with SW_TEST_VERBOSE=1). The last test
// checks that no email address, token, code, nickname, world name or IP address was logged.
const spy = installLogSpy();
const remember = spy.remember;

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
  PUBLIC_ORIGIN: 'https://www.playglimmerworld.com',
  STRIPE_SECRET_KEY: 'rk_live_abc123',
  MAIL_MODE: 'resend',
  MAIL_API_KEY: 're_abc',
  MAIL_FROM: 'Glimmer World <hello@playglimmerworld.com>',
  SW_OPERATOR_NAME: 'The Family',
  SW_OPERATOR_EMAIL: 'hello@playglimmerworld.com',
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
    refuses({ ...ENV, PUBLIC_ORIGIN: 'https://www.playglimmerworld.com/account' }, /just the site address/);
    refuses({ ...ENV, SW_SECRET: randomBytes(31).toString('base64') }, /SW_SECRET must be at least 32 random bytes/);
    refuses({ ...ENV, SW_SECRET: 'not base64 at all!' }, /SW_SECRET/);
    refuses({ ...PROD, MAIL_MODE: 'log' }, /MAIL_MODE must be resend, postmark or microsoft in production/);
    refuses({ ...PROD, MAIL_MODE: 'memory' }, /MAIL_MODE must be resend, postmark or microsoft in production/);
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
    assert.deepEqual([prod.cookies.sess, prod.cookies.login, prod.cookies.secure, prod.hsts, prod.publicOrigin], ['__Host-sw_sess', '__Host-sw_login', true, true, 'https://www.playglimmerworld.com']);
    assert.equal(serializeCookie(prod, 'sess', 'abc_-1', 3600), '__Host-sw_sess=abc_-1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure');
    assert.equal(serializeCookie(dev, 'login', null), 'sw_login=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    assert.throws(() => serializeCookie(prod, 'sess', 'a;b', 1));
    assert.equal(cookieOf(prod, 'x=1; __Host-sw_sess=tok_1', 'sess'), 'tok_1');
    assert.equal(cookieOf(prod, 'sw_sess=tok_1', 'sess'), null);
    assert.deepEqual({ ...parseCookies('a=1; b="2"; a=3; =x; c') }, { a: '1', b: '2' });
  });
  test('SW_FREE_PASS: email or email:YYYY-MM-DD, lower-cased; a bad value refuses the start without naming the address (§6.9)', () => {
    assert.deepEqual([...loadConfig(ENV).freePass], [], 'none by default');
    const c = loadConfig({ ...ENV, SW_FREE_PASS: ' Dad@Example.com , mom.k@example.com:2027-06-30, ' });
    assert.deepEqual(c.freePass.map((e) => ({ ...e })), [
      { email: 'dad@example.com', day: '2099-12-31', until: Date.UTC(2100, 0, 1) },
      { email: 'mom.k@example.com', day: '2027-06-30', until: Date.UTC(2027, 6, 1) },
    ]);
    assert.ok(Object.isFrozen(c.freePass) && Object.isFrozen(c.freePass[0]));
    // the listed address matches what sign-in stores
    for (const e of c.freePass) assert.equal(normalizeEmail(e.email), e.email);
    const line = summarizeConfig(c);
    assert.match(line, /free passes 2/);
    assert.ok(!line.includes('example.com'), 'the count only');
    assert.ok(!summarizeConfig(loadConfig(ENV)).includes('free pass'));
    for (const [v, re] of [
      ['not-an-email', /SW_FREE_PASS entry 1 must be an email address/],
      ['ok@example.com, secret.mom@example', /SW_FREE_PASS entry 2 must be an email address/],
      ['secret.mom@example.com:2027-02-30', /SW_FREE_PASS entry 1 has a date that is not a real day/],
      ['secret.mom@example.com:2100-01-01', /SW_FREE_PASS entry 1 has a date that is not a real day/],
      ['secret.mom@example.com:27-1-1', /SW_FREE_PASS entry 1 must be an email address, or email:YYYY-MM-DD/],
      ['secret.mom@example.com:', /SW_FREE_PASS entry 1 must be an email address/],
      ['secret.mom@example.com, Secret.Mom@example.com:2027-01-01', /SW_FREE_PASS entry 2 lists the same address twice/],
      [Array.from({ length: 21 }, (_, i) => `k${i}@example.com`).join(','), /SW_FREE_PASS lists 21 addresses \(at most 20\)/],
    ]) {
      const err = refuses({ ...ENV, SW_FREE_PASS: v }, re);
      assert.ok(!/secret\.mom|example/i.test(err.message), 'the address is never printed: ' + err.message);
    }
    assert.equal(loadConfig({ ...ENV, SW_FREE_PASS: Array.from({ length: 20 }, (_, i) => `k${i}@example.com`).join(',') }).freePass.length, 20);
    // accounts off: not even read
    assert.equal(loadConfig({ SW_FREE_PASS: 'nonsense' }).accounts, 'off');
  });
  test("MAIL_FROM takes Resend's testing sender (before the domain is verified)", () => {
    const c = loadConfig({ ...PROD, MAIL_FROM: 'Glimmer World <onboarding@resend.dev>' });
    assert.equal(c.mailFrom, 'Glimmer World <onboarding@resend.dev>');
    assert.equal(loadConfig({ ...PROD, MAIL_FROM: 'onboarding@resend.dev' }).mailFrom, 'onboarding@resend.dev');
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

  test('migrate applies 001, 002 and 003 once; running it again changes nothing', async () => {
    assert.deepEqual(await migrationStatus(t.db), { ok: false, current: 0, latest: listMigrations().length });
    const first = await migrate(t.db);
    assert.deepEqual(first.applied, [1, 2, 3]);
    const second = await migrate(t.db);
    assert.deepEqual(second, { applied: [], current: 3 });
    assert.equal((await migrationStatus(t.db)).ok, true);
    const tables = (await t.db.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename);
    assert.deepEqual(tables, ['audit_log', 'deleted_families', 'families', 'gone_sessions', 'login_attempts', 'outbox', 'pair_codes', 'player_profiles', 'players', 'schema_migrations', 'sessions', 'stripe_events', 'subscriptions', 'worlds']);
  });

  test('migrations are expand-only: no drop, rename or type change (§3.2)', () => {
    for (const m of listMigrations()) {
      let sql = readFileSync(m.file, 'utf8').replace(/--[^\n]*/g, '').toLowerCase();
      // the one allowed drop: a check constraint replaced by a wider one of the same name in
      // the same statement (003: a new consent method, a new audit actor)
      sql = sql.replace(/\bdrop\s+constraint\s+(\w+)\s*,\s*add\s+constraint\s+(\w+)\s+check\b/g, (all, a, b) => (a === b ? 'add constraint ' + b + ' check' : all));
      for (const bad of [/\bdrop\s+(table|column|index|constraint|type|schema)\b/, /\brename\b/, /\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/, /\btruncate\b/, /\bdelete\s+from\b/]) {
        assert.ok(!bad.test(sql), `${path.basename(m.file)}: ${bad}`);
      }
    }
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
      "insert into families (email, comp_source) values ('d2@example.com', 'admin')",
      "insert into audit_log (family_id, actor, action) values (gen_random_uuid(), 'someone', 'comp.set')",
    ];
    for (const sql of bad) await assert.rejects(t.db.query(sql));
    // 003: the operator's own family (SW_FREE_PASS, §6.9); every older value still goes in
    for (const m of ['card', 'form', 'call', 'video', 'operator']) await t.db.query('insert into families (email, verified_method) values ($1, $2)', [`m-${m}@example.com`, m]);
    for (const a of ['parent', 'system', 'stripe', 'admin', 'config']) await t.db.query("insert into audit_log (family_id, actor, action) values (gen_random_uuid(), $1, 'comp.set')", [a]);
    await t.db.query("insert into families (email, comp_source) values ('src@example.com', 'config')");
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
    let entered;
    const inA = new Promise((r) => (entered = r));
    const a = t.db.lock('sparkle-world:x', async () => {
      order.push('a1');
      entered();
      await new Promise((r) => setTimeout(r, 50));
      order.push('a2');
    });
    await inA; // b asks only once a holds the lock (two pool connections race otherwise)
    const b = t.db.lock('sparkle-world:x', async () => order.push('b'));
    await Promise.all([a, b]);
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
    assert.equal((await call('POST', '/api/auth/logout', { headers: SAFE, body: '[1,2]', json: false, session: 'parent' })).status, 400);
    assert.equal((await call('POST', '/api/auth/logout', { headers: SAFE, body: '{nope', json: false, session: 'parent' })).status, 400);
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
  test("who may call comes before the body: a stranger's gzip bomb is never inflated (§4.8)", async () => {
    const bomb = gzipSync(Buffer.alloc(1e6, 32));
    const gz = { ...SAFE, 'content-encoding': 'gzip' };
    const r = await call('PUT', `/api/players/${PID}/worlds/w1`, { headers: gz, body: bomb });
    assert.deepEqual([r.status, r.data, r.headers.connection], [401, { error: 'signed_out' }, 'close'], 'signed out: 401 at once (before, the body was inflated first and answered 413)');
    const other = await call('PUT', `/api/players/${OTHER}/worlds/w1`, { headers: gz, body: bomb, session: 'parent' });
    assert.deepEqual([other.status, other.data], [404, { error: 'not_found' }], "another family's player: 404 before the body");
    const own = await call('PUT', `/api/players/${PID}/worlds/w1`, { headers: gz, body: bomb, session: 'parent' });
    assert.deepEqual([own.status, own.data], [413, { error: 'too_big' }], 'her own player: the body is read (in the thread pool) and refused as too big');
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
  writeFileSync(html, '<!doctype html><title>Glimmer World</title>');
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
    assert.deepEqual(h, { ok: true, db: true, migrations: listMigrations().length });
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

// =============================================================================================
// Builder A (§12.6, §12.7): sign-in, sessions, the email check, devices, consent, players,
// exports, deletes, the relay's questions, mail, jobs, audit, the admin CLI. A real server
// (createServer + createAccounts, SW_TEST=1, MAIL_MODE=memory) on 127.0.0.1 with an https
// PUBLIC_ORIGIN, so the cookies are the production ones (__Host-, Secure) and HSTS is on.
// Billing's Stripe side of a family delete is a recording stub (B tests the real one against
// the Stripe fake).

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const HTTPS = 'https://www.playglimmerworld.com';
const TEST_ENV = Object.freeze({
  ...ENV,
  PUBLIC_ORIGIN: HTTPS,
  SW_TEST: '1',
  STRIPE_API_BASE: 'http://127.0.0.1:9', // a Stripe call would fail at once instead of going out
  SW_OPERATOR_EMAIL: 'privacy@playglimmerworld.com',
});
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const SESS = '__Host-sw_sess';
const LOGIN = '__Host-sw_login';
const A_DIR = mkdtempSync(path.join(tmpdir(), 'sw-acct-a-'));
const A_HTML = path.join(A_DIR, 'game.html');
writeFileSync(A_HTML, '<!doctype html><title>Glimmer World</title>');
process.on('exit', () => rmSync(A_DIR, { recursive: true, force: true }));
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');

let ipSeq = 0;
function nextIp() {
  ipSeq++;
  const ip = ipSeq < 250 ? `203.0.113.${ipSeq}` : `198.51.100.${(ipSeq % 250) + 1}`;
  remember(ip);
  return ip;
}
let roomSeq = 0;
const allMail = [];
const allAudit = [];

function httpCall(base, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data, text, buf });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** A browser: its own address and cookie jar; state-changing calls carry the §4.7 headers. */
class Browser {
  constructor(h, { ip = nextIp(), ua = IPAD } = {}) {
    this.h = h;
    this.ip = ip;
    this.ua = ua;
    this.jar = new Map();
  }
  cookie(name) {
    return this.jar.get(name) ?? null;
  }
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async call(method, p, { body, headers = {}, csrf = true } = {}) {
    const hd = { 'user-agent': this.ua, 'x-forwarded-for': this.ip };
    if (this.jar.size) hd.cookie = this.cookieHeader();
    let payload;
    if (method !== 'GET' && method !== 'HEAD') {
      if (csrf) Object.assign(hd, { 'x-sw': '1', origin: HTTPS, 'content-type': 'application/json' });
      payload = body === undefined ? '{}' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
      hd['content-length'] = String(Buffer.byteLength(payload)); // (Node sends a DELETE body only with a length)
    }
    Object.assign(hd, headers);
    const r = await httpCall(this.h.base, method, p, { headers: hd, body: payload });
    for (const sc of [].concat(r.headers['set-cookie'] || [])) {
      const pair = sc.split(';')[0];
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (/Max-Age=0(;|$)/.test(sc) || v === '') this.jar.delete(k);
      else {
        this.jar.set(k, v);
        remember(v);
      }
    }
    return r;
  }
  get(p, o) {
    return this.call('GET', p, o);
  }
  post(p, body, o = {}) {
    return this.call('POST', p, { ...o, body });
  }
  patch(p, body, o = {}) {
    return this.call('PATCH', p, { ...o, body });
  }
  del(p, body, o = {}) {
    return this.call('DELETE', p, { ...o, body });
  }
}

async function startHarness(db, env = {}) {
  const cfg = loadConfig({ ...TEST_ENV, ...env });
  const clock = makeClock();
  const accounts = await createAccounts(cfg, { log: spy.log, db, clock, timers: false });
  const app = createServer({ accounts, htmlPath: A_HTML, siteDir: path.join(A_DIR, 'none'), log: spy.log, hsts: cfg.hsts });
  const port = await app.listen(0, '127.0.0.1');
  const h = { cfg, clock, accounts, ctx: accounts.ctx, app, port, base: `http://127.0.0.1:${port}`, db, stripeCalls: [], stripeFails: false };
  accounts.ctx.billing.cancelAndDelete = async (a) => {
    h.stripeCalls.push(a);
    if (h.stripeFails) {
      const e = new Error('no network');
      e.name = 'StripeConnectionError';
      throw e;
    }
    return { ok: true };
  };
  h.browser = (o) => new Browser(h, o);
  h.mail = async (to) => (await new Browser(h).get('/api/test/mail?to=' + encodeURIComponent(to))).data;
  h.lastMail = async (to) => (await h.mail(to)).at(-1);
  h.lastCode = async (to) => {
    const mail = await h.lastMail(to);
    const code = /(\d{6})$/.exec(mail.subject)[1];
    remember(code);
    return { code, mail };
  };
  h.link = (mail) => {
    const t = /#t=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
    remember(t);
    return t;
  };
  h.family = (email) => db.one('select * from families where email = $1', [email]);
  h.setClock = (offsetMs) => {
    clock.set(offsetMs);
    h.ctx.billing.invalidate();
    h.ctx.sessions.clearCaches();
  };
  h.close = async () => {
    allMail.push(...h.ctx.mail.captured); // the last test reads every email this file sent
    allAudit.push(...(await db.query('select * from audit_log')).rows); // and every audit row
    await app.close();
  };
  return h;
}

async function signIn(h, b, email, { next } = {}) {
  remember(email);
  const s = await b.post('/api/auth/start', { email, ...(next ? { next } : {}) });
  assert.equal(s.status, 202, 'start: ' + s.text);
  const { code } = await h.lastCode(email);
  const v = await b.post('/api/auth/verify', { code });
  assert.equal(v.status, 200, 'verify: ' + v.text);
  return (await h.family(email)).id;
}

/** An active Glimmer World Membership (and, by default, verified consent) straight in the database. */
async function entitle(h, familyId, { verified = true } = {}) {
  const now = h.clock.now();
  await h.db.query(
    `update families set consent_at = coalesce(consent_at, $2), notice_version = coalesce(notice_version, 1),
            verified_at = case when $3::boolean then coalesce(verified_at, $2) else verified_at end,
            verified_method = case when $3::boolean then coalesce(verified_method, 'card') else verified_method end,
            stripe_customer_id = coalesce(stripe_customer_id, $4)
      where id = $1`,
    [familyId, new Date(now), verified, 'cus_' + familyId.slice(0, 8)],
  );
  await h.db.query(
    `insert into subscriptions (id, family_id, customer_id, status, price_id, started_at, current_period_end, synced_at)
     values ($1, $2, $3, 'active', 'price_abc123', $4, $5, $4)
     on conflict (id) do update set status = 'active', current_period_end = excluded.current_period_end, synced_at = excluded.synced_at`,
    ['sub_' + familyId.slice(0, 8), familyId, 'cus_' + familyId.slice(0, 8), new Date(now), new Date(now + 20 * DAY)],
  );
  h.ctx.billing.invalidate(familyId);
}

/** Sign in, agree to the notice, (by default) a plan with verified consent, and players. */
async function setupFamily(h, email, { players = [], entitled = true, verified = true, b = h.browser() } = {}) {
  const familyId = await signIn(h, b, email);
  const n = (await b.get('/api/notice')).data;
  const c = await b.post('/api/consent', { noticeVersion: n.version, agree: true });
  assert.equal(c.status, 200, c.text);
  if (entitled) await entitle(h, familyId, { verified });
  const ids = {};
  for (const nick of players) {
    remember(nick);
    const r = await b.post('/api/players', { nickname: nick });
    assert.equal(r.status, 201, r.text);
    ids[nick] = r.data.id;
  }
  return { b, familyId, ids };
}

/** A kid's device paired with a code from the parent's browser `b` (still within its check). */
async function pairKid(h, b, body = {}, o = {}) {
  const pc = await b.post('/api/devices/pair-code', body);
  assert.equal(pc.status, 200, pc.text);
  remember(pc.data.code, pc.data.code.replace('-', ''));
  const kid = h.browser(o);
  const r = await kid.post('/api/auth/pair', { code: pc.data.code });
  assert.equal(r.status, 200, r.text);
  return kid;
}

/** Open a relay socket as browser `b` for player `pid` (null: no p) and see what happens. */
function wsOpen(h, b, pid, { waitMs = 400 } = {}) {
  return new Promise((resolve) => {
    const headers = { 'x-forwarded-for': b.ip };
    if (b.jar.size) headers.cookie = b.cookieHeader();
    const s = new WebSocket(`ws://127.0.0.1:${h.port}/r/test-room-${++roomSeq}?s=${'a'.repeat(20)}${pid ? '&p=' + pid : ''}`, { headers });
    const box = { frames: [], closed: null, opened: false, status: null, stillOpen: false };
    s.on('open', () => (box.opened = true));
    s.on('message', (d) => {
      try {
        box.frames.push(JSON.parse(d.toString()));
      } catch {}
    });
    s.on('close', (code) => {
      box.closed = code;
      resolve(box);
    });
    s.on('unexpected-response', (req, res) => {
      box.status = res.statusCode;
      resolve(box);
    });
    s.on('error', () => {});
    setTimeout(() => {
      if (box.opened && box.closed === null) {
        box.stillOpen = true;
        s.close(1000);
      }
    }, waitMs);
  });
}

const fill = (p, pid) => p.replace(':pid', pid).replace(':wid', 'w1').replace(':id', '00000000');
const count = async (db, sql, params) => (await db.one(sql, params)).n;

function putWorld(db, pid, id, { name = 'Castle Cove', updatedAt = 1790000000000, size = { x: 144, y: 64, z: 144 }, thumb = null, rev = 1 } = {}) {
  remember(name);
  const save = { id, name, biome: 'meadow', size, blocks: 'AAAA', palette: [], createdAt: updatedAt - 1000, updatedAt, thumbnail: null };
  const text = JSON.stringify(save);
  const gz = gzipSync(text);
  const meta = { id, name, biome: 'meadow', size, createdAt: save.createdAt, updatedAt };
  return db.query(
    `insert into worlds (player_id, world_id, rev, client_updated_at, meta, thumb, body, size, stored)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (player_id, world_id) do update set body = excluded.body, rev = excluded.rev, deleted_at = null`,
    [pid, id, rev, updatedAt, JSON.stringify(meta), thumb, gz, text.length, gz.length],
  ).then(() => save);
}

function putProfile(db, pid, profile) {
  const text = JSON.stringify(profile);
  return db.query('insert into player_profiles (player_id, rev, client_updated_at, body, size) values ($1, 1, $2, $3, $4) on conflict (player_id) do update set body = excluded.body', [
    pid, profile.updatedAt || 1, gzipSync(text), text.length,
  ]);
}

// ---------------------------------------------------------------------------------------------

describe('A: small pieces (emails, next, pair codes, labels, nicknames, access)', () => {
  test('emails are normalized; odd ones are refused', () => {
    assert.equal(normalizeEmail('  Lily.Mom@Example.COM '), 'lily.mom@example.com');
    assert.equal(normalizeEmail('élise@example.com'), 'élise@example.com', 'NFC');
    for (const bad of ['', 'no-at', 'a@b', 'a b@c.de', 'x'.repeat(250) + '@b.co', 'a@b..co', 'a@b.c', '<a>@b.co', 42, null]) assert.equal(normalizeEmail(bad), null, String(bad));
  });
  test('next: only /account and /play (open redirects → /account)', () => {
    for (const n of ['//evil.example', 'https://evil.example', '/account/../evil', '/accounts', '/play?x=<b>', '\\\\evil', '/account?next=//evil.example', 'javascript:alert(1)', '/play#x', null, 7]) {
      assert.equal(safeNext(n), '/account', String(n));
    }
    assert.equal(safeNext('/play'), '/play');
    assert.equal(safeNext('/account?checkout=cs_test_1'), '/account?checkout=cs_test_1');
  });
  test('pair codes: Crockford base32, any case, O=0, I=L=1, dash optional', () => {
    assert.equal(normalizePairCode('k7qm-2xfd'), 'K7QM2XFD');
    assert.equal(normalizePairCode('K7QM 2XFD'), 'K7QM2XFD');
    assert.equal(normalizePairCode('O1LI-abcd'), '0111ABCD');
    assert.equal(normalizePairCode('UUUU-UUUU'), null, 'no U');
    assert.equal(normalizePairCode('K7QM-2XF'), null);
    assert.equal(normalizePairCode(12345678), null);
  });
  test('device labels come from the User-Agent (which is not kept); a parent\'s label is cleaned', () => {
    assert.equal(deviceLabel(IPAD), 'iPad · Safari');
    assert.equal(deviceLabel(MAC_CHROME), 'Mac · Chrome');
    assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'), 'Android phone · Chrome');
    assert.equal(deviceLabel(''), 'Device · Browser');
    assert.equal(cleanLabel('  Kitchen‮ iPad\n<b> '), 'Kitchen iPadb');
    assert.equal(cleanLabel('x'.repeat(60)).length, 40);
    assert.equal(cleanLabel('   '), null);
  });
  test('nicknames go through names.js (≤ 12 letters, no digits, the blocklist)', () => {
    assert.equal(cleanNickname('Lily2'), 'Lily');
    assert.equal(cleanNickname('  Star   Bunny '), 'Star Bunny');
    assert.equal(cleanNickname('Princess Sparkle Pony'), 'Princess Spa');
    for (const bad of ['butt', '1234', '', '   ', 'admin', null]) assert.equal(cleanNickname(bad), null, String(bad));
  });
  test('accessOf: what the relay allows (§6.7, §8.6)', () => {
    const cfg = { friendsMode: 'subscription' };
    const ent = (entitled, verified = true) => ({ entitled, friendsConsentOk: verified, walkieConsentOk: verified });
    const p = (friends_on, walkie_on = false) => ({ friends_on, walkie_on });
    assert.equal(accessOf({ ent: ent(false), player: p(true), cfg }).why, 'not_entitled');
    assert.equal(accessOf({ ent: ent(true, false), player: p(true), cfg }).why, 'friends_locked');
    assert.equal(accessOf({ ent: ent(true), player: p(false), cfg }).why, 'friends_off');
    assert.deepEqual(accessOf({ ent: ent(true), player: p(true, true), cfg }), { canJoin: true, canHost: true, canBuild: true, walkieOk: true, why: null });
    assert.equal(accessOf({ ent: { entitled: true, friendsConsentOk: true, walkieConsentOk: false }, player: p(true, true), cfg }).walkieOk, false, 'the walkie always needs verified consent');
    const free = { friendsMode: 'free-join' };
    assert.deepEqual(accessOf({ ent: ent(false), player: p(true, true), cfg: free }), { canJoin: true, canHost: false, canBuild: false, walkieOk: false, why: null }, 'a visitor');
    assert.equal(accessOf({ ent: ent(false), player: p(false), cfg: free }).why, 'friends_off');
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: sign-in (§4.3, §12.7)', () => {
  let t;
  let h;
  before(async () => {
    t = await openTestDb();
    h = await startHarness(t.db);
  });
  after(async () => {
    await h?.close();
    await t?.close();
  });
  beforeEach(() => {
    h.ctx.limits = new Limits();
    h.setClock(0);
  });

  test('start: the same status, body, cookies and timing for known and unknown emails; nothing is created', async () => {
    const known = [1, 2, 3, 4, 5, 6, 7].map((i) => `known${i}@example.com`);
    const unknown = known.map((e) => e.replace('known', 'stranger'));
    remember(...known, ...unknown);
    for (const e of known) await t.db.query('insert into families (email, email_verified_at) values ($1, $2)', [e, new Date()]);
    const families = await count(t.db, 'select count(*) as n from families');
    const shape = (r) => ({ status: r.status, body: r.text, type: r.headers['content-type'], cookies: [].concat(r.headers['set-cookie']).map((c) => c.replace(/=[^;]*/, '=X')) });
    const times = { known: [], unknown: [] };
    const shapes = { known: null, unknown: null };
    for (let i = 0; i < known.length; i++) {
      for (const [kind, email] of i % 2 ? [['known', known[i]], ['unknown', unknown[i]]] : [['unknown', unknown[i]], ['known', known[i]]]) {
        const b = h.browser();
        const t0 = performance.now();
        const r = await b.post('/api/auth/start', { email });
        times[kind].push(performance.now() - t0);
        shapes[kind] = shape(r);
      }
    }
    assert.deepEqual(shapes.known, shapes.unknown);
    assert.deepEqual([shapes.known.status, shapes.known.body], [202, '{"ok":true}']);
    assert.equal(await count(t.db, 'select count(*) as n from families'), families, 'no family is created by start');
    const median = (l) => [...l].sort((a, b) => a - b)[l.length >> 1];
    const [mk, mu] = [median(times.known), median(times.unknown)];
    assert.ok(Math.abs(mk - mu) < Math.max(40, 0.5 * Math.max(mk, mu)), `timing known ${mk.toFixed(1)} ms vs unknown ${mu.toFixed(1)} ms`);
  });

  test('bad emails → 400 bad_email', async () => {
    for (const email of ['', 'no-at', 'a@b', 'x'.repeat(250) + '@b.co', 42]) {
      const r = await h.browser().post('/api/auth/start', { email });
      assert.deepEqual([r.status, r.data], [400, { error: 'bad_email' }], String(email));
    }
  });

  test('a code works only in the browser that asked, once; the cookies are exactly §4.2\'s', async () => {
    const email = 'lily.mom@example.com';
    remember(email);
    const asker = h.browser();
    const r = await asker.post('/api/auth/start', { email, next: '/play' });
    assert.equal(r.status, 202);
    assert.equal(r.headers['strict-transport-security'], 'max-age=31536000');
    assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
    const login = [].concat(r.headers['set-cookie']).find((c) => c.startsWith(LOGIN + '='));
    assert.match(login, /^__Host-sw_login=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=900; Secure$/);
    const loginValue = asker.cookie(LOGIN);
    const { code, mail } = await h.lastCode(email);
    assert.equal(mail.template, 'signin');
    assert.match(mail.subject, /^Your Glimmer World code: \d{6}$/);
    assert.match(mail.text, /Welcome to Glimmer World!/);
    assert.match(mail.text, new RegExp(`notice version ${NOTICE_VERSION}\\b`));
    assert.ok(mail.text.includes(`${HTTPS}/privacy`));
    const elsewhere = await h.browser().post('/api/auth/verify', { code });
    assert.deepEqual([elsewhere.status, elsewhere.data], [410, { error: 'expired' }], 'no attempt cookie: no sign-in');
    const ok = await asker.post('/api/auth/verify', { code });
    assert.deepEqual([ok.status, ok.data], [200, { next: '/play' }]);
    const set = [].concat(ok.headers['set-cookie']);
    assert.match(set.find((c) => c.startsWith(SESS + '=')), /^__Host-sw_sess=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    assert.ok(set.includes('__Host-sw_login=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'));
    const replay = h.browser();
    replay.jar.set(LOGIN, loginValue);
    assert.equal((await replay.post('/api/auth/verify', { code })).status, 410, 'single use');
    const me = await asker.get('/api/me');
    assert.deepEqual([me.data.signedIn, me.data.kind, me.data.accounts, me.data.consent, me.data.players], [true, 'parent', 'optional', 'none', []]);
    assert.ok(!me.text.includes(email), '/api/me never carries the email');
    const f = await h.family(email);
    assert.ok(f.email_verified_at instanceof Date);
    const s = await t.db.one('select * from sessions where family_id = $1', [f.id]);
    assert.deepEqual([s.kind, s.label], ['parent', 'iPad · Safari'], 'a coarse label from the User-Agent, which is not kept');
    assert.ok(Buffer.isBuffer(s.id_hash) && s.id_hash.length === 32);
    assert.ok(!s.id_hash.equals(Buffer.from(asker.cookie(SESS))), 'only a hash is stored');
    assert.equal(+s.expires_at - +s.created_at, 30 * DAY);
    assert.equal(+s.idle_expires_at - +s.created_at, 14 * DAY);
    assert.equal(+s.elevated_until - +s.created_at, 15 * MIN, 'a sign-in counts as an email check for 15 minutes');
  });

  test('five wrong codes kill the attempt', async () => {
    const email = 'five.tries@example.com';
    remember(email);
    const b = h.browser();
    await b.post('/api/auth/start', { email });
    const { code } = await h.lastCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 0; left--) {
      const r = await b.post('/api/auth/verify', { code: wrong });
      assert.deepEqual([r.status, r.data], [400, { error: 'bad_code', triesLeft: left }]);
    }
    const r = await b.post('/api/auth/verify', { code });
    assert.deepEqual([r.status, r.data], [410, { error: 'expired' }]);
    assert.equal(await h.family(email), null);
  });

  test('the link: any browser, POST only, single use; opening the page consumes nothing', async () => {
    const email = 'link.dad@example.com';
    remember(email);
    await h.browser().post('/api/auth/start', { email });
    const mail = await h.lastMail(email);
    const token = h.link(mail);
    assert.ok(mail.text.includes(`${HTTPS}/account/verify#t=${token}`), 'the token is in the fragment');
    const phone = h.browser({ ua: MAC_CHROME });
    await phone.get('/account/verify'); // what a mail scanner does (the fragment never reaches the server)
    assert.equal((await phone.get('/api/auth/verify?t=' + token)).status, 405, 'a GET changes nothing');
    const ok = await phone.post('/api/auth/verify', { token });
    assert.deepEqual([ok.status, ok.data], [200, { next: '/account' }]);
    assert.equal((await phone.get('/api/me')).data.signedIn, true);
    const twice = await h.browser().post('/api/auth/verify', { token });
    assert.deepEqual([twice.status, twice.data], [410, { error: 'expired' }]);
    assert.equal((await h.browser().post('/api/auth/verify', { token: 'x'.repeat(43) })).status, 410);
    assert.equal((await h.browser().post('/api/auth/verify', {})).status, 400);
  });

  test('codes and links expire after 15 minutes', async () => {
    const email = 'slow.mom@example.com';
    remember(email);
    const b = h.browser();
    await b.post('/api/auth/start', { email });
    const { code, mail } = await h.lastCode(email);
    const token = h.link(mail);
    h.setClock(15 * MIN + 1000);
    assert.equal((await b.post('/api/auth/verify', { code })).status, 410);
    assert.equal((await h.browser().post('/api/auth/verify', { token })).status, 410);
  });

  test('only the 3 newest attempts for an email stay valid', async () => {
    const email = 'many.tabs@example.com';
    remember(email);
    const tabs = [h.browser(), h.browser(), h.browser(), h.browser()];
    const codes = [];
    assert.equal((await h.browser().post('/api/test/limits', { off: true })).data.limits, 'off');
    for (const b of tabs) {
      await b.post('/api/auth/start', { email });
      codes.push((await h.lastCode(email)).code);
    }
    h.ctx.limits = new Limits();
    assert.equal((await tabs[0].post('/api/auth/verify', { code: codes[0] })).status, 410);
    assert.equal((await tabs[3].post('/api/auth/verify', { code: codes[3] })).status, 200);
  });

  test('signing in again: a new session, the old one ended, the email says "sign in" now', async () => {
    const email = 'again@example.com';
    const b = h.browser();
    await signIn(h, b, email);
    const first = b.cookie(SESS);
    const stale = h.browser();
    stale.jar.set(SESS, first);
    await signIn(h, b, email);
    const second = b.cookie(SESS);
    assert.notEqual(first, second);
    const r = await stale.get('/api/family');
    assert.deepEqual([r.status, r.data], [401, { error: 'signed_out' }]);
    assert.equal((await b.get('/api/family')).status, 200);
    const mails = await h.mail(email);
    assert.match(mails.at(-1).text, /^Here is your code to sign in to Glimmer World:/);
    assert.ok(!/notice version/.test(mails.at(-1).text));
    const me = await stale.get('/api/me');
    assert.deepEqual([me.status, me.data, [].concat(me.headers['set-cookie'])], [401, { error: 'signed_out' }, ['__Host-sw_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure']]);
  });

  test('a bad next comes back as /account', async () => {
    const email = 'redirect@example.com';
    remember(email);
    const b = h.browser();
    await b.post('/api/auth/start', { email, next: '//evil.example/account' });
    const { code } = await h.lastCode(email);
    assert.deepEqual((await b.post('/api/auth/verify', { code })).data, { next: '/account' });
  });

  test('limits: per email 3 per 15 min and 10 a day, per address 5 at once, all 1000 an hour, verify 30 an hour', async () => {
    const email = 'limited@example.com';
    remember(email);
    const start = () => h.browser().post('/api/auth/start', { email });
    for (let round = 0; round < 3; round++) {
      h.setClock(round * 16 * MIN);
      for (let i = 0; i < 3; i++) assert.equal((await start()).status, 202);
      const no = await start();
      assert.deepEqual([no.status, no.data], [429, { error: 'rate' }]);
      assert.equal(no.headers['retry-after'], '900');
    }
    h.setClock(3 * 16 * MIN);
    assert.equal((await start()).status, 202, 'the 10th of the day');
    const day = await start();
    assert.deepEqual([day.status, day.headers['retry-after']], [429, '3600']);
    h.setClock(0);
    const one = h.browser();
    for (let i = 0; i < 5; i++) {
      remember(`ip${i}@example.com`);
      assert.equal((await one.post('/api/auth/start', { email: `ip${i}@example.com` })).status, 202);
    }
    assert.equal((await one.post('/api/auth/start', { email: 'ip5@example.com' })).status, 429, 'per address');
    const all = h.ctx.limits.limiter(AUTH_LIMITS.startAll);
    while (all.take('*'));
    assert.equal((await h.browser().post('/api/auth/start', { email: 'everyone@example.com' })).status, 429, 'all 1000 an hour');
    assert.ok(spy.lines.some((l) => l.startsWith('api: limit auth-start-all (for everyone) is used up')), 'the log says so (never who)');
    const v = h.browser();
    for (let i = 0; i < 30; i++) assert.notEqual((await v.post('/api/auth/verify', { code: '123456' })).status, 429);
    const nv = await v.post('/api/auth/verify', { code: '123456' });
    assert.deepEqual([nv.status, nv.data], [429, { error: 'rate' }]);
  });

  test("one network (an IPv6 /48) cannot use up everyone's sign-in and pairing limits", async () => {
    // a home's /56 holds 256 /64s: each counts as its own address, but all share the /48's limit
    const at = (i) => {
      const ip = `2001:db8:77:${i.toString(16)}::1`;
      remember(ip);
      return h.browser({ ip });
    };
    for (let i = 0; i < 10; i++) {
      remember(`net${i}@example.com`);
      assert.equal((await at(i).post('/api/auth/start', { email: `net${i}@example.com` })).status, 202);
    }
    const more = await at(0xff).post('/api/auth/start', { email: 'net10@example.com' });
    assert.deepEqual([more.status, more.data], [429, { error: 'rate' }], 'the 11th at once from the same /48');
    remember('real.parent@example.com');
    assert.equal((await h.browser({ ip: '2001:db8:78::1' }).post('/api/auth/start', { email: 'real.parent@example.com' })).status, 202, 'a family on another network still signs in');
    for (let i = 0; i < 20; i++) assert.equal((await at(0x100 + i).post('/api/auth/pair', { code: 'AAAA-AAAA' })).status, 400);
    assert.equal((await at(0x200).post('/api/auth/pair', { code: 'AAAA-AAAA' })).status, 429, 'pairing: 20 per 10 minutes per network');
    assert.equal((await h.browser({ ip: '2001:db8:79::1' }).post('/api/auth/pair', { code: 'AAAA-AAAA' })).status, 400, 'another network can still pair');
    assert.ok(AUTH_LIMITS.startAll.count >= 1000 && AUTH_LIMITS.pairAll.count >= 1000, 'and the limits for everyone are far above that');
  });

  test('per email means per mailbox: name+tag@ and Gmail dots count as one', async () => {
    const forms = ['sam.jones@gmail.com', 'samjones+1@gmail.com', 'S.am.Jones+x@googlemail.com', 'samjones+4@gmail.com'];
    remember(...forms, ...forms.map((e) => e.toLowerCase()));
    for (const e of forms.slice(0, 3)) assert.equal((await h.browser().post('/api/auth/start', { email: e })).status, 202, e);
    const r = await h.browser().post('/api/auth/start', { email: forms[3] });
    assert.deepEqual([r.status, r.data], [429, { error: 'rate' }], 'the 4th start for the same mailbox in 15 minutes');
    remember('samjones+1@example.com', 'sam.jones@example.com');
    assert.equal((await h.browser().post('/api/auth/start', { email: 'samjones+1@example.com' })).status, 202, 'another domain keeps its dots and tags apart from Gmail');
    assert.equal((await h.browser().post('/api/auth/start', { email: 'sam.jones@example.com' })).status, 202);
  });

  test('wrong codes: 10 a day per email, over all its attempts; then codes stop until the day has passed, the link still works', async () => {
    const email = 'guessed.mom@example.com';
    remember(email);
    const left = [];
    for (let k = 0; k < 2; k++) {
      const b = h.browser();
      const st = await b.post('/api/auth/start', { email });
      assert.equal(st.status, 202, st.text);
      const { code } = await h.lastCode(email);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) left.push((await b.post('/api/auth/verify', { code: wrong })).data.triesLeft);
    }
    assert.deepEqual(left, [4, 3, 2, 1, 0, 4, 3, 2, 1, 0]);
    const b = h.browser();
    await b.post('/api/auth/start', { email });
    const { code, mail } = await h.lastCode(email);
    const r = await b.post('/api/auth/verify', { code });
    assert.deepEqual([r.status, r.data], [410, { error: 'expired' }], 'even the right code, for a day');
    const link = await h.browser().post('/api/auth/verify', { token: h.link(mail) });
    assert.equal(link.status, 200, 'the link in the email (which cannot be guessed) still signs in');
    h.setClock(DAY + HOUR);
    const next = h.browser();
    await next.post('/api/auth/start', { email });
    assert.equal((await next.post('/api/auth/verify', { code: (await h.lastCode(email)).code })).status, 200, 'a day later codes work again');
  });

  test("a link opened where another family is signed in: it says whose sign-in it is and signs the device out only when asked (login CSRF)", async () => {
    const v = await setupFamily(h, 'victim.mom@example.com', { players: ['Wrenny'] });
    const kid = await pairKid(h, v.b);
    const stranger = 'stranger.dad@example.com';
    remember(stranger);
    await h.browser().post('/api/auth/start', { email: stranger, next: '/play' });
    const token = h.link(await h.lastMail(stranger));
    const peek = await kid.post('/api/auth/verify', { token, peek: true });
    assert.deepEqual([peek.status, peek.data], [200, { email: 's•••@example.com', replacing: true }]);
    assert.equal(await count(t.db, 'select count(*) as n from login_attempts where link_hash is not null and used_at is null and email = $1', [stranger]), 1, 'asking uses nothing');
    const refused = await kid.post('/api/auth/verify', { token });
    assert.deepEqual([refused.status, refused.data], [409, { error: 'conflict', replacing: true }]);
    let me = (await kid.get('/api/me')).data;
    assert.deepEqual([me.signedIn, me.kind, me.players.map((p) => p.nickname)], [true, 'device', ['Wrenny']], 'the kid device is still hers');
    assert.equal((await h.browser().post('/api/auth/verify', { token, peek: true })).data.replacing, false, 'a browser signed in nowhere replaces nothing');
    const ok = await kid.post('/api/auth/verify', { token, replace: true });
    assert.deepEqual([ok.status, ok.data], [200, { next: '/play' }], 'after the warning (and the grown-up question), it signs in');
    me = (await kid.get('/api/me')).data;
    assert.deepEqual([me.kind, me.players], ['parent', []]);
    // her own link, on her own browser: nothing to warn about
    await h.browser().post('/api/auth/start', { email: 'victim.mom@example.com' });
    const own = h.link(await h.lastMail('victim.mom@example.com'));
    assert.equal((await v.b.post('/api/auth/verify', { token: own, peek: true })).data.replacing, false);
    assert.equal((await v.b.post('/api/auth/verify', { token: own })).status, 200);
    assert.equal((await kid.post('/api/auth/verify', { token: own, peek: true })).status, 410, 'a used link: expired');
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: sessions, the email check, kid devices (§4.4–4.6, §12.7)', () => {
  let t;
  let h;
  before(async () => {
    t = await openTestDb();
    h = await startHarness(t.db);
  });
  after(async () => {
    await h?.close();
    await t?.close();
  });
  beforeEach(() => {
    h.ctx.limits = new Limits();
    h.setClock(0);
  });

  test('every parent+check route without a fresh check → 403 check_required', async () => {
    const { b, ids } = await setupFamily(h, 'check.walk@example.com', { players: ['Mila'] });
    h.setClock(16 * MIN); // the sign-in's 15 minutes are over
    const checked = h.ctx.routes.filter((r) => r.who === 'parent+check' || r.who === 'parent+check5');
    assert.ok(checked.length >= 6, 'the check routes are mounted');
    for (const r of checked) {
      const res = await b.call(r.method, fill(r.path, ids.Mila), { body: {} });
      assert.deepEqual([`${r.method} ${r.path}`, res.status, res.data?.error], [`${r.method} ${r.path}`, 403, 'check_required']);
    }
  });

  test('a device session → 403 on every family, billing and device route; signed out → 401 everywhere', async () => {
    const { b, ids } = await setupFamily(h, 'device.walk@example.com', { players: ['Zoey'] });
    const kid = await pairKid(h, b);
    const parentOnly = h.ctx.routes.filter((r) => r.who.startsWith('parent'));
    assert.ok(parentOnly.some((r) => r.path.startsWith('/api/family')) && parentOnly.some((r) => r.path.startsWith('/api/devices')));
    for (const r of parentOnly) {
      const res = await kid.call(r.method, fill(r.path, ids.Zoey), { body: {} });
      assert.deepEqual([`${r.method} ${r.path}`, res.status, res.data?.error], [`${r.method} ${r.path}`, 403, 'forbidden']);
    }
    const me = await kid.get('/api/me');
    assert.deepEqual([me.data.kind, me.data.players.map((p) => p.nickname)], ['device', ['Zoey']]);
    const nobody = h.browser();
    for (const r of h.ctx.routes.filter((x) => ['session', 'parent', 'parent+check', 'parent+check5', 'player'].includes(x.who))) {
      const res = await nobody.call(r.method, fill(r.path, ids.Zoey), { body: {} });
      assert.deepEqual([`${r.method} ${r.path}`, res.status, res.data?.error], [`${r.method} ${r.path}`, 401, 'signed_out']);
    }
    assert.equal((await kid.post('/api/auth/logout', {})).status, 200, 'a device may sign itself out');
  });

  test('the email check: a code by email, good for 15 minutes; deleting needs one within 5 minutes', async () => {
    const email = 'check.mom@example.com';
    const { b } = await setupFamily(h, email, { entitled: false });
    h.setClock(20 * MIN);
    assert.equal((await b.post('/api/devices/pair-code', {})).data.error, 'check_required');
    const c = await b.post('/api/auth/check', {});
    assert.deepEqual([c.status, c.data], [202, { ok: true }]);
    const { code, mail } = await h.lastCode(email);
    assert.equal(mail.template, 'check');
    assert.match(mail.subject, /^Your Glimmer World check code: \d{6}$/);
    const sameSessionNoAttempt = h.browser();
    sameSessionNoAttempt.jar.set(SESS, b.cookie(SESS));
    assert.equal((await sameSessionNoAttempt.post('/api/auth/verify', { code })).status, 410, 'bound to the browser that asked');
    const v = await b.post('/api/auth/verify', { code });
    assert.equal(v.status, 200);
    assert.ok(Math.abs(v.data.elevatedUntil - (h.clock.now() + 15 * MIN)) < 5000);
    assert.equal((await b.post('/api/devices/pair-code', {})).status, 200);
    const fam = (await b.get('/api/family')).data;
    assert.ok(fam.elevatedUntil > h.clock.now());
    h.setClock(26 * MIN); // the check was 6 minutes ago: still within 15, not within 5
    assert.equal((await b.post('/api/devices/pair-code', {})).status, 200);
    const del = await b.post('/api/family/delete', { confirm: 'DELETE' });
    assert.deepEqual([del.status, del.data], [403, { error: 'check_required' }]);
    assert.ok(await h.family(email), 'not deleted');
    h.setClock(36 * MIN);
    assert.equal((await b.post('/api/devices/pair-code', {})).data.error, 'check_required', 'and 15 minutes later nothing');
  });

  test('CSRF on every state-changing route: X-SW, Origin, JSON, Sec-Fetch-Site (the webhook alone is exempt)', async () => {
    const { b, ids } = await setupFamily(h, 'csrf.walk@example.com', { players: ['Clementine'] });
    remember('Clementine');
    const writes = h.ctx.routes.filter((r) => r.method !== 'GET' && r.who !== 'stripe' && r.who !== 'test');
    assert.ok(writes.length >= 15);
    const good = { 'x-sw': '1', origin: HTTPS, 'content-type': 'application/json' };
    for (const r of writes) {
      const p = fill(r.path, ids.Clementine);
      const name = `${r.method} ${r.path}`;
      for (const [why, headers, status] of [
        ['no X-SW', { origin: HTTPS, 'content-type': 'application/json' }, 403],
        ['another site', { ...good, origin: 'https://evil.example' }, 403],
        ['cross-site fetch', { ...good, 'sec-fetch-site': 'cross-site' }, 403],
        ['a form post', { ...good, 'content-type': 'text/plain' }, 415],
      ]) {
        b.ip = nextIp(); // (60 requests: past one address's burst)
        const res = await b.call(r.method, p, { body: {}, csrf: false, headers });
        assert.deepEqual([name, why, res.status], [name, why, status]);
      }
    }
    const hook = h.ctx.routes.find((r) => r.who === 'stripe');
    if (hook) assert.notEqual((await b.call('POST', hook.path, { body: '{}', csrf: false, headers: { 'content-type': 'application/json' } })).status, 403);
  });

  test('the default limits: 120 a minute (60 at once) per address, 240 a minute per session', async () => {
    const one = h.browser();
    let n = 0;
    while ((await one.get('/api/me')).status !== 429 && n < 100) n++;
    assert.ok(n >= 59 && n < 70, `per address after ${n}`);
    const { b } = await setupFamily(h, 'busy.session@example.com');
    const cookie = b.cookieHeader();
    let m = 0;
    for (;;) {
      const r = await httpCall(h.base, 'GET', '/api/me', { headers: { cookie, 'x-forwarded-for': nextIp() } });
      if (r.status === 429 || m > 300) break;
      m++;
    }
    assert.ok(m >= 238 && m <= 280, `per session after ${m}`);
  });

  test('/api/test/* do not exist without SW_TEST=1', async () => {
    const cfgNoTest = loadConfig({ ...TEST_ENV, SW_TEST: '' });
    const acc = await createAccounts(cfgNoTest, { log: spy.log, db: t.db, timers: false });
    const app = createServer({ accounts: acc, htmlPath: A_HTML, siteDir: path.join(A_DIR, 'none'), log: spy.log });
    const port = await app.listen(0, '127.0.0.1');
    try {
      assert.ok(!acc.ctx.routes.some((r) => r.path.startsWith('/api/test/')));
      const r = await httpCall(`http://127.0.0.1:${port}`, 'GET', '/api/test/mail');
      assert.deepEqual([r.status, r.data], [404, { error: 'not_found' }]);
      const c = await httpCall(`http://127.0.0.1:${port}`, 'POST', '/api/test/clock', { headers: { 'x-sw': '1', origin: HTTPS, 'content-type': 'application/json' }, body: '{"offsetMs":1}' });
      assert.equal(c.status, 404);
    } finally {
      await app.close();
    }
  });

  test('the email check: 5 an hour per family', async () => {
    const { b } = await setupFamily(h, 'check.limit@example.com', { entitled: false });
    for (let i = 0; i < 5; i++) assert.equal((await b.post('/api/auth/check', {})).status, 202);
    const no = await b.post('/api/auth/check', {});
    assert.deepEqual([no.status, no.data], [429, { error: 'rate' }]);
  });

  test('pair codes: 8 symbols, 10 minutes, single use, at most 3 live; the device gets its label and lock', async () => {
    const { b, familyId, ids } = await setupFamily(h, 'pair.dad@example.com', { players: ['Aria', 'Nora'] });
    const pc = await b.post('/api/devices/pair-code', { label: "Aria's iPad", lockPlayer: ids.Aria });
    assert.equal(pc.status, 200);
    assert.match(pc.data.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.ok(Math.abs(pc.data.expiresAt - (h.clock.now() + 10 * MIN)) < 5000);
    remember(pc.data.code, pc.data.code.replace('-', ''));
    const second = await b.post('/api/devices/pair-code', {});
    const third = await b.post('/api/devices/pair-code', {});
    remember(second.data.code, third.data.code);
    const fourth = await b.post('/api/devices/pair-code', {});
    assert.deepEqual([fourth.status, fourth.data], [409, { error: 'limit' }]);
    const other = await b.post('/api/devices/pair-code', { lockPlayer: randomUUID() });
    assert.equal(other.status, 404, 'lock only to her own players');
    // typed on the kid's iPad in lower case without the dash, O for 0
    const kid = h.browser();
    const typed = pc.data.code.toLowerCase().replace('-', '').replace(/0/g, 'o');
    const r = await kid.post('/api/auth/pair', { code: typed });
    assert.deepEqual([r.status, r.data], [200, { ok: true }]);
    assert.match([].concat(r.headers['set-cookie'])[0], /^__Host-sw_sess=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=15552000; Secure$/);
    assert.equal((await h.browser().post('/api/auth/pair', { code: pc.data.code })).status, 400, 'single use');
    const me = (await kid.get('/api/me')).data;
    assert.deepEqual([me.kind, me.lockPlayer, me.players.map((p) => p.nickname)], ['device', ids.Aria, ['Aria']]);
    const devices = (await b.get('/api/devices')).data;
    const dev = devices.find((d) => d.kind === 'device');
    assert.deepEqual([dev.label, dev.lockPlayer, dev.current, typeof dev.lastSeen], ["Aria's iPad", ids.Aria, false, 'number']);
    assert.match(dev.id, /^[0-9a-f]{8}$/);
    assert.equal(devices.find((d) => d.current).kind, 'parent');
    const log = await t.db.query("select action, detail from audit_log where family_id = $1 and action = 'device.paired'", [familyId]);
    assert.deepEqual(log.rows.map((x) => x.detail), [{ sid: dev.id }]);
    // a code from the default label: the kid's User-Agent
    const mac = h.browser({ ua: MAC_CHROME });
    assert.equal((await mac.post('/api/auth/pair', { code: second.data.code })).status, 200);
    assert.ok((await b.get('/api/devices')).data.some((d) => d.label === 'Mac · Chrome'));
    // expired after 10 minutes
    h.setClock(11 * MIN);
    assert.deepEqual((await h.browser().post('/api/auth/pair', { code: third.data.code })).data, { error: 'bad_code' });
  });

  test('pairing: 10 tries per 10 minutes per address, 200 an hour for everyone', async () => {
    const kid = h.browser();
    for (let i = 0; i < 10; i++) assert.equal((await kid.post('/api/auth/pair', { code: 'ZZZZ-ZZZZ' })).status, 400);
    const no = await kid.post('/api/auth/pair', { code: 'ZZZZ-ZZZZ' });
    assert.deepEqual([no.status, no.data], [429, { error: 'rate' }]);
    const all = h.ctx.limits.limiter(AUTH_LIMITS.pairAll);
    while (all.take('*'));
    assert.equal((await h.browser().post('/api/auth/pair', { code: 'ZZZZ-ZZZZ' })).status, 429);
  });

  test('pair codes: 10 an hour per family', async () => {
    const { b } = await setupFamily(h, 'pair.limit@example.com', { entitled: false });
    const l = h.ctx.limits.limiter(AUTH_LIMITS.pairCodeFamily);
    assert.ok(l); // made on first use below
    for (let i = 0; i < 10; i++) {
      const r = await b.post('/api/devices/pair-code', {});
      assert.ok([200, 409].includes(r.status), r.text);
      if (r.data.code) remember(r.data.code);
      if (r.status === 409) await t.db.query('update pair_codes set used_at = $1 where used_at is null', [new Date()]);
    }
    assert.equal((await b.post('/api/devices/pair-code', {})).status, 429);
  });

  test('devices: rename, lock, sign out one (its sockets and requests end), "Kids play on this device"', async () => {
    const { b, familyId, ids } = await setupFamily(h, 'devices.mom@example.com', { players: ['Ruby', 'Opal'] });
    await b.patch(`/api/players/${ids.Ruby}`, { friends: true });
    const kid = await pairKid(h, b);
    const dev = (await b.get('/api/devices')).data.find((d) => d.kind === 'device');
    const ren = await b.patch(`/api/devices/${dev.id}`, { label: 'Hall iPad', lockPlayer: ids.Ruby });
    assert.deepEqual([ren.status, ren.data.label, ren.data.lockPlayer], [200, 'Hall iPad', ids.Ruby]);
    assert.equal((await b.patch(`/api/devices/${dev.id}`, { lockPlayer: randomUUID() })).status, 404);
    const parentDev = (await b.get('/api/devices')).data.find((d) => d.current);
    assert.equal((await b.patch(`/api/devices/${parentDev.id}`, { lockPlayer: ids.Ruby })).status, 400, 'a parent session is never locked');
    assert.equal((await b.patch('/api/devices/ffffffff', { label: 'x' })).status, 404);
    assert.deepEqual((await kid.get('/api/me')).data.players.map((p) => p.id), [ids.Ruby]);
    const ok = await wsOpen(h, kid, ids.Ruby);
    assert.equal(ok.stillOpen, true, 'the locked player plays with friends');
    const wrong = await wsOpen(h, kid, ids.Opal);
    assert.deepEqual([wrong.closed, wrong.frames.at(-1)], [4405, { t: 'e', code: 'player_gone' }], 'another player on a locked device');
    const off = await b.del(`/api/devices/${dev.id}`, {});
    assert.deepEqual([off.status, off.data], [200, { ok: true }]);
    assert.deepEqual((await kid.get('/api/me')).data, { error: 'signed_out' });
    const after = await wsOpen(h, kid, ids.Ruby);
    assert.deepEqual([after.closed, after.frames.at(-1)], [4401, { t: 'e', code: 'signed_out' }], 'a revoked session is refused on the relay too');
    assert.equal((await t.db.one("select count(*) as n from audit_log where family_id = $1 and action = 'device.removed'", [familyId])).n, 1);
    // this browser becomes a kid device (a new token); the Family page then asks to sign in
    const before = b.cookie(SESS);
    const me = await b.post('/api/devices/this', { lockPlayer: ids.Opal });
    assert.equal(me.status, 200);
    assert.notEqual(b.cookie(SESS), before);
    assert.equal((await b.get('/api/family')).status, 403);
    const dme = (await b.get('/api/me')).data;
    assert.deepEqual([dme.kind, dme.lockPlayer], ['device', ids.Opal]);
    const stale = h.browser();
    stale.jar.set(SESS, before);
    assert.equal((await stale.get('/api/me')).status, 401);
  });

  test('a device locked to a child who is then deleted stays locked: it sees nobody, never her brothers and sisters', async () => {
    const { b, ids } = await setupFamily(h, 'locked.mom@example.com', { players: ['Mira', 'Lilac'] });
    const kid = await pairKid(h, b, { lockPlayer: ids.Mira });
    let me = (await kid.get('/api/me')).data;
    assert.deepEqual([me.locked, me.lockPlayer, me.players.map((p) => p.nickname)], [true, ids.Mira, ['Mira']]);
    assert.equal((await kid.get(`/api/players/${ids.Lilac}/worlds`)).status, 404, 'locked: her sister is not hers (the session is cached now)');
    assert.equal((await b.del(`/api/players/${ids.Mira}`, { confirm: 'Mira' })).status, 200);
    me = (await kid.get('/api/me')).data;
    assert.deepEqual([me.locked, me.lockPlayer, me.players], [true, null, []], 'locked to nobody now');
    assert.deepEqual((await kid.get(`/api/players/${ids.Mira}/profile`)).data, { error: 'player_gone' }, 'her own routes answer 410, so the device wipes her copy');
    assert.equal((await kid.get(`/api/players/${ids.Lilac}/worlds`)).status, 404);
    const put = await kid.call('PUT', `/api/players/${ids.Lilac}/profile`, { body: { coins: 999999, updatedAt: 1 }, headers: { 'if-match': '*' } });
    assert.deepEqual([put.status, put.data], [404, { error: 'not_found' }]);
    assert.equal((await wsOpen(h, kid, ids.Lilac)).closed, 4405, 'and the relay does not let it play as her sister');
    const dev = (await b.get('/api/devices')).data.find((d) => d.kind === 'device');
    assert.deepEqual([dev.locked, dev.lockPlayer], [true, null], 'the Family page shows it locked to nobody');
    const unlocked = await b.patch(`/api/devices/${dev.id}`, { lockPlayer: null });
    assert.deepEqual([unlocked.data.locked, unlocked.data.lockPlayer], [false, null], 'the grown-up unlocks it on purpose');
    me = (await kid.get('/api/me')).data;
    assert.deepEqual([me.locked, me.players.map((p) => p.nickname)], [false, ['Lilac']]);
    const relocked = await b.patch(`/api/devices/${dev.id}`, { lockPlayer: ids.Lilac });
    assert.deepEqual([relocked.data.locked, relocked.data.lockPlayer], [true, ids.Lilac]);
    assert.ok(spy.lines.includes(`deletion-journal player=${ids.Mira}`), 'the delete is journaled (ids only) for the restore runbook');
  });

  test('logout and logout everywhere', async () => {
    const email = 'bye@example.com';
    const { b } = await setupFamily(h, email);
    const phone = h.browser();
    await signIn(h, phone, email);
    const kid = await pairKid(h, b);
    const all = await b.post('/api/auth/logout-all', {});
    assert.deepEqual([all.status, b.cookie(SESS)], [200, null]);
    for (const x of [phone, kid]) assert.equal((await x.get('/api/me')).status, 401);
    const again = h.browser();
    await signIn(h, again, email);
    const out = await again.post('/api/auth/logout', {});
    assert.deepEqual([out.status, again.cookie(SESS)], [200, null]);
    assert.equal((await again.get('/api/me')).data.signedIn, false);
  });

  test('lifetimes: a parent session 14 days unused or 30 days in all; a device 180 days after last use, sliding', async () => {
    const email = 'lifetimes@example.com';
    const { b } = await setupFamily(h, email);
    const kid = await pairKid(h, b);
    for (let d = 13; d <= 26; d += 13) {
      h.setClock(d * DAY);
      assert.equal((await b.get('/api/family')).status, 200, `parent in use on day ${d}`);
    }
    h.setClock(30 * DAY + MIN);
    assert.equal((await b.get('/api/family')).status, 401, 'the parent session ends after 30 days');
    h.setClock(0);
    const idle = h.browser();
    await signIn(h, idle, email);
    h.setClock(14 * DAY + MIN);
    assert.equal((await idle.get('/api/family')).status, 401, '14 days unused');
    // the device: used on day 170 → still good on day 340, and its cookie follows
    h.setClock(170 * DAY);
    const me = await kid.get('/api/me');
    assert.equal(me.status, 200);
    const set = [].concat(me.headers['set-cookie'] || []).find((c) => c.startsWith(SESS + '='));
    assert.match(set, /Max-Age=155(51|52)\d{3}(;|$)/, 'the cookie is sent again with the slid life (180 days)');
    h.setClock(340 * DAY);
    assert.equal((await kid.get('/api/me')).status, 200);
    h.setClock(521 * DAY);
    assert.equal((await kid.get('/api/me')).status, 401, '180 days unused');
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: the notice, consent, players and their switches (§5.2, §6.7, §11)', () => {
  let t;
  let h;
  before(async () => {
    t = await openTestDb();
    h = await startHarness(t.db);
  });
  after(async () => {
    await h?.close();
    await t?.close();
  });
  beforeEach(() => {
    h.ctx.limits = new Limits();
    h.setClock(0);
  });

  test('the notice; consent (email plus) is recorded, audited and confirmed by email a day later', async () => {
    const email = 'consent.mom@example.com';
    const b = h.browser();
    const familyId = await signIn(h, b, email);
    const n = await b.get('/api/notice');
    assert.equal(n.status, 200);
    assert.ok(Number.isInteger(n.data.version) && n.data.sections.length >= 5 && /18 or older/.test(n.data.checkbox));
    assert.deepEqual((await b.post('/api/players', { nickname: 'Luna' })).data, { error: 'consent_required' });
    assert.equal((await b.post('/api/consent', { noticeVersion: n.data.version, agree: false })).status, 400);
    const stale = await b.post('/api/consent', { noticeVersion: n.data.version + 1, agree: true });
    assert.deepEqual([stale.status, stale.data.error], [409, 'conflict']);
    const c = await b.post('/api/consent', { noticeVersion: n.data.version, agree: true });
    assert.equal(c.status, 200);
    assert.deepEqual([c.data.consent.level, c.data.consent.noticeVersion, c.data.consent.verifiedAt], ['email_plus', n.data.version, null]);
    assert.equal((await b.post('/api/consent', { noticeVersion: n.data.version, agree: true })).status, 200, 'twice is fine');
    const audit1 = await t.db.query('select action, detail, actor from audit_log where family_id = $1 order by id', [familyId]);
    assert.deepEqual(audit1.rows, [{ action: 'consent.email_plus', detail: { v: n.data.version }, actor: 'parent' }]);
    assert.equal((await h.mail(email)).filter((m) => m.template === 'consent_confirm').length, 0, 'not yet');
    h.setClock(DAY + MIN);
    const confirm = (await h.mail(email)).filter((m) => m.template === 'consent_confirm');
    assert.equal(confirm.length, 1);
    assert.match(confirm[0].text, /You agreed on .* that Glimmer World may keep your children's nicknames/);
    assert.ok(confirm[0].text.includes(`${HTTPS}/account`));
    const audit2 = await t.db.query('select action, detail, actor from audit_log where family_id = $1 order by id', [familyId]);
    assert.deepEqual(audit2.rows.at(-1), { action: 'consent.confirm_sent', detail: { v: n.data.version }, actor: 'system' });
    const fam = (await b.get('/api/family')).data;
    assert.deepEqual([fam.email, fam.consent.level, fam.config.friendsMode, fam.config.mpConsent, fam.config.trialDays, fam.config.priceText, fam.config.operatorEmail], [
      email, 'email_plus', 'subscription', 'verified', 0, '$5.99 a month, plus sales tax where it applies', 'privacy@playglimmerworld.com',
    ]);
    assert.deepEqual((await b.get('/api/family/audit')).data.map((a) => a.action), ['consent.confirm_sent', 'consent.email_plus']);
  });

  test('players: need consent and a plan; names.js filter; unique in any case; at most 6', async () => {
    const email = 'players.dad@example.com';
    const { b, familyId } = await setupFamily(h, email, { entitled: false });
    assert.deepEqual((await b.post('/api/players', { nickname: 'Luna' })).data, { error: 'not_entitled' });
    await entitle(h, familyId, { verified: false });
    const r = await b.post('/api/players', { nickname: 'Luna2', color: 3 });
    remember('Luna');
    assert.equal(r.status, 201);
    assert.deepEqual([r.data.nickname, r.data.color, r.data.friends, r.data.walkie, r.data.portrait, r.data.worlds], ['Luna', 3, false, false, null, 0]);
    assert.deepEqual((await b.post('/api/players', { nickname: 'LUNA' })).data, { error: 'nickname_taken' });
    assert.deepEqual((await b.post('/api/players', { nickname: 'butt' })).data, { error: 'nickname_blocked' });
    assert.deepEqual((await b.post('/api/players', { nickname: '12345' })).data, { error: 'nickname_blocked' });
    assert.equal((await b.post('/api/players', { nickname: 'Rosa', color: 9 })).status, 400);
    for (const nick of ['Rosa', 'Iris', 'Hazel', 'Pearl', 'Violet']) {
      remember(nick);
      assert.equal((await b.post('/api/players', { nickname: nick })).status, 201);
    }
    remember('Daisy');
    assert.deepEqual((await b.post('/api/players', { nickname: 'Daisy' })).data, { error: 'limit' });
    const fam = (await b.get('/api/family')).data;
    assert.deepEqual(fam.players.map((p) => p.nickname), ['Luna', 'Rosa', 'Iris', 'Hazel', 'Pearl', 'Violet']);
    assert.equal((await t.db.one("select count(*) as n from audit_log where family_id = $1 and action = 'player.create'", [familyId])).n, 6);
  });

  test('switches: on needs the check, a plan and the consent tier; off needs nothing; walkie needs friends', async () => {
    const email = 'switch.mom@example.com';
    const { b, familyId, ids } = await setupFamily(h, email, { players: ['Stella'], verified: false });
    const pid = ids.Stella;
    const events = [];
    const onPlayer = (e) => events.push(e);
    h.ctx.events.on('player', onPlayer);
    try {
      assert.deepEqual((await b.patch(`/api/players/${pid}`, { friends: true })).data, { error: 'needs_verified' }, 'email plus is not enough for friends (SW_MP_CONSENT=verified)');
      let me = (await b.get('/api/me')).data;
      assert.deepEqual([me.consent, me.players[0].canJoin, me.players[0].why], ['email_plus', false, 'friends_locked']);
      await t.db.query("update families set verified_at = $2, verified_method = 'card' where id = $1", [familyId, new Date()]);
      h.ctx.billing.invalidate(familyId);
      me = (await b.get('/api/me')).data;
      assert.deepEqual([me.consent, me.players[0].why], ['verified', 'friends_off']);
      assert.deepEqual((await b.patch(`/api/players/${pid}`, { walkie: true })).data, { error: 'conflict' }, 'the walkie needs friends on');
      h.setClock(16 * MIN);
      assert.deepEqual((await b.patch(`/api/players/${pid}`, { friends: true })).data, { error: 'check_required' });
      h.setClock(0);
      const on = await b.patch(`/api/players/${pid}`, { friends: true, walkie: true, notice: NOTICE_VERSION });
      assert.deepEqual([on.status, on.data.friends, on.data.walkie], [200, true, true]);
      me = (await b.get('/api/me')).data;
      assert.deepEqual(me.players[0], { id: pid, nickname: 'Stella', color: 0, portrait: null, friends: true, walkie: true, canJoin: true, canHost: true, walkieOk: true, why: null });
      assert.equal(me.plan.state, 'active');
      assert.ok(me.playUntil <= h.clock.now() + 7 * DAY + 1000 && me.playUntil > h.clock.now() + 6 * DAY);
      h.setClock(16 * MIN);
      const off = await b.patch(`/api/players/${pid}`, { friends: false });
      assert.deepEqual([off.status, off.data.friends, off.data.walkie], [200, false, false], 'friends off takes the walkie with it, no check needed');
      const renamed = await b.patch(`/api/players/${pid}`, { nickname: 'Star9 Bright', color: 2 });
      remember('Star Bright');
      assert.deepEqual([renamed.data.nickname, renamed.data.color], ['Star Bright', 2]);
      const log = await t.db.query('select action, detail, player_id from audit_log where family_id = $1 and player_id is not null order by id', [familyId]);
      assert.deepEqual(log.rows.map((x) => [x.action, x.detail]), [['player.create', {}], ['friends.on', { v: NOTICE_VERSION }], ['walkie.on', { v: NOTICE_VERSION }], ['friends.off', {}], ['walkie.off', {}]]);
      assert.ok(log.rows.every((x) => x.player_id === pid));
      assert.deepEqual(events.map((e) => e.playerId), [pid, pid, pid]);
      // lapsed: the switch cannot be turned on, and /api/me says why
      await t.db.query('delete from subscriptions where family_id = $1', [familyId]);
      h.ctx.billing.invalidate(familyId);
      h.setClock(0);
      assert.deepEqual((await b.patch(`/api/players/${pid}`, { friends: true })).data, { error: 'not_entitled' });
      me = (await b.get('/api/me')).data;
      assert.deepEqual([me.plan.entitled, me.players[0].why, me.playUntil <= h.clock.now() + 1000], [false, 'not_entitled', true]);
    } finally {
      h.ctx.events.off('player', onPlayer);
    }
  });

  test("the consent records name the notice the server shows; an agreement to an older notice is asked again (§11.3)", async () => {
    const { b, familyId, ids } = await setupFamily(h, 'notice.dad@example.com', { players: ['Fern'] });
    const bad = await b.patch(`/api/players/${ids.Fern}`, { friends: true, notice: 99 });
    assert.deepEqual([bad.status, bad.data], [409, { error: 'conflict', noticeVersion: NOTICE_VERSION }], 'a page showing another notice is told so, nothing recorded');
    assert.equal((await b.patch(`/api/players/${ids.Fern}`, { friends: true })).status, 200);
    const on = await t.db.one("select detail from audit_log where family_id = $1 and action = 'friends.on'", [familyId]);
    assert.deepEqual(on.detail, { v: NOTICE_VERSION }, "the server's own version, never one the page chose");
    // a change that did not matter (version 2 only renamed the plan to the Glimmer World Membership):
    // an agreement to an older version at or above NOTICE_MIN_VERSION still counts, nobody is asked again
    assert.ok(NOTICE_MIN_VERSION < NOTICE_VERSION, 'this check needs an older version that still counts');
    await t.db.query('update families set notice_version = $2 where id = $1', [familyId, NOTICE_MIN_VERSION]);
    const older = (await b.get('/api/family')).data;
    assert.deepEqual([older.consent.noticeVersion, older.config.noticeVersion, older.config.noticeMinVersion], [NOTICE_MIN_VERSION, NOTICE_VERSION, NOTICE_MIN_VERSION]);
    remember('Ivy');
    assert.equal((await b.post('/api/players', { nickname: 'Ivy' })).status, 201, 'an agreement to an older notice that still counts adds players as before');
    // a change that mattered (NOTICE_MIN_VERSION above what she agreed to): simulated with an
    // agreement to version 0
    await t.db.query('update families set notice_version = 0 where id = $1', [familyId]);
    const fam = (await b.get('/api/family')).data;
    assert.deepEqual([fam.consent.level, fam.consent.noticeVersion, fam.config.noticeVersion, fam.config.noticeMinVersion], ['verified', 0, NOTICE_VERSION, NOTICE_MIN_VERSION]);
    remember('Moss');
    assert.deepEqual((await b.post('/api/players', { nickname: 'Moss' })).data, { error: 'consent_required' }, 'no new player until she agrees again');
    assert.deepEqual((await b.patch(`/api/players/${ids.Fern}`, { walkie: true })).data, { error: 'consent_required' }, 'no switch goes on');
    assert.equal((await b.patch(`/api/players/${ids.Fern}`, { friends: false })).status, 200, 'switching off never waits');
    assert.equal((await b.post('/api/consent', { noticeVersion: NOTICE_VERSION, agree: true })).status, 200);
    assert.equal((await b.post('/api/players', { nickname: 'Moss' })).status, 201, 'agreed again: on as before');
    const acts = (await t.db.query("select detail from audit_log where family_id = $1 and action = 'consent.email_plus' order by id", [familyId])).rows.map((r) => r.detail);
    assert.deepEqual(acts, [{ v: NOTICE_VERSION }, { v: NOTICE_VERSION }], 'the second agreement is recorded too');
  });

  test('free-join (with SW_MP_CONSENT=email_plus): a family without a plan adds players who may only join', async () => {
    const fj = await startHarness(t.db, { SW_FRIENDS_MODE: 'free-join', SW_MP_CONSENT: 'email_plus' });
    try {
      const { b, ids } = await setupFamily(fj, 'visitor.mom@example.com', { players: ['Pixie'], entitled: false });
      assert.deepEqual((await b.patch(`/api/players/${ids.Pixie}`, { friends: true, walkie: true })).data, { error: 'not_entitled' }, 'never the walkie');
      assert.equal((await b.patch(`/api/players/${ids.Pixie}`, { friends: true })).status, 200);
      const me = (await b.get('/api/me')).data;
      assert.deepEqual([me.friendsMode, me.plan.entitled, me.players[0].canJoin, me.players[0].canHost, me.players[0].walkieOk, me.players[0].why], ['free-join', false, true, false, false, null]);
      const r = await fj.accounts.authorizeSocket({ cookie: `${SESS}=${b.cookie(SESS)}`, playerId: ids.Pixie });
      assert.deepEqual([r.ok, r.claims.canHost, r.claims.canBuild, r.claims.walkie, r.claims.until], [true, false, false, false, null]);
    } finally {
      await fj.close();
    }
  });

  test('another family\'s player is 404, a deleted one 410 (every :pid route)', async () => {
    const mine = await setupFamily(h, 'idor.a@example.com', { players: ['Poppy'] });
    const theirs = await setupFamily(h, 'idor.b@example.com', { players: ['Ivy Rose'] });
    for (const r of h.ctx.routes.filter((x) => x.path.includes(':pid') && x.who !== 'player')) {
      const res = await mine.b.call(r.method, fill(r.path, theirs.ids['Ivy Rose']), { body: {} });
      assert.deepEqual([`${r.method} ${r.path}`, res.status], [`${r.method} ${r.path}`, 404]);
      const gone = await mine.b.call(r.method, fill(r.path, randomUUID()), { body: {} });
      assert.deepEqual([`${r.method} ${r.path}`, gone.status, gone.data?.error], [`${r.method} ${r.path}`, 410, 'player_gone']);
    }
  });

  test('summary: her worlds with sizes and dates, stickers, coins, stats', async () => {
    const { b, ids } = await setupFamily(h, 'summary.mom@example.com', { players: ['Willow'] });
    const pid = ids.Willow;
    await putWorld(t.db, pid, 'w1', { name: 'Castle Cove', updatedAt: 1790000000000, thumb: Buffer.from([0xff, 0xd8, 0xff]) });
    await putWorld(t.db, pid, 'w2', { name: 'Unicorn Farm', updatedAt: 1790000500000, size: { x: 208, y: 64, z: 208 }, rev: 4 });
    await putWorld(t.db, pid, 'w2.before', { name: 'Unicorn Farm', updatedAt: 1790000400000 });
    await t.db.query("insert into worlds (player_id, world_id, rev, client_updated_at, meta, deleted_at) values ($1, 'w3', 2, 1, '{}', $2)", [pid, new Date()]);
    await putProfile(t.db, pid, { stickers: { firstHouse: 1, petPal: 2 }, coins: 42, stats: { blocksPlaced: 900, recipesCooked: { soup: 2 } }, updatedAt: 5 });
    const s = (await b.get(`/api/players/${pid}/summary`)).data;
    assert.deepEqual([s.nickname, s.friends, s.walkie, s.profile.coins, s.profile.stickers, s.profile.stats.blocksPlaced], ['Willow', false, false, 42, ['firstHouse', 'petPal'], 900]);
    assert.deepEqual(s.worlds.map((w) => [w.id, w.name, w.sizeName, w.updatedAt, w.thumb]), [
      ['w2', 'Unicorn Farm', 'big', 1790000500000, null],
      ['w2.before', 'Unicorn Farm', 'cozy', 1790000400000, null],
      ['w1', 'Castle Cove', 'cozy', 1790000000000, `/api/players/${pid}/worlds/w1/thumb?v=1`],
    ]);
    assert.ok(s.worlds.every((w) => w.size > 0));
    const fam = (await b.get('/api/family')).data;
    assert.equal(fam.players[0].worlds, 2, 'side copies and deleted worlds are not counted');
  });

  test('deleting a player: the check, her nickname typed; the relay and devices are told', async () => {
    const { b, familyId, ids } = await setupFamily(h, 'delete.player@example.com', { players: ['Clover', 'Maple'] });
    const pid = ids.Clover;
    await putWorld(t.db, pid, 'w1');
    const seen = [];
    const on = (e) => seen.push(e);
    h.ctx.events.on('player', on);
    try {
      assert.deepEqual((await b.del(`/api/players/${pid}`, { confirm: 'Maple' })).data, { error: 'bad_request' });
      h.setClock(16 * MIN);
      assert.deepEqual((await b.del(`/api/players/${pid}`, { confirm: 'Clover' })).data, { error: 'check_required' });
      h.setClock(0);
      assert.deepEqual((await b.del(`/api/players/${pid}`, { confirm: 'clover' })).data, { ok: true });
    } finally {
      h.ctx.events.off('player', on);
    }
    assert.deepEqual(seen, [{ familyId, playerId: pid, deleted: true }]);
    assert.equal(await count(t.db, 'select count(*) as n from worlds where player_id = $1', [pid]), 0);
    assert.deepEqual((await b.get(`/api/players/${pid}/summary`)).data, { error: 'player_gone' });
    assert.equal((await t.db.one("select count(*) as n from audit_log where family_id = $1 and action = 'player.delete' and player_id = $2", [familyId, pid])).n, 1);
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: exports and deleting the family (§3.4, §11.6)', () => {
  let t;
  let h;
  before(async () => {
    t = await openTestDb();
    h = await startHarness(t.db);
  });
  after(async () => {
    await h?.close();
    await t?.close();
  });
  beforeEach(() => {
    h.ctx.limits = new Limits();
    h.setClock(0);
    h.stripeFails = false;
  });

  test('her data as a file: the game\'s own world files, streamed; the check; 5 an hour', async () => {
    const { b, familyId, ids } = await setupFamily(h, 'export.mom@example.com', { players: ['Sunny', 'Brook'] });
    const saves = [await putWorld(t.db, ids.Sunny, 'w1', { name: 'Castle Cove' }), await putWorld(t.db, ids.Sunny, 'w2', { name: 'Seaside Shop' })];
    await putWorld(t.db, ids.Brook, 'b1', { name: 'Treehouse Den' });
    await putProfile(t.db, ids.Sunny, { stickers: { a: 1 }, coins: 7, updatedAt: 3 });
    await t.db.query('update players set portrait = $2, portrait_rev = 1 where id = $1', [ids.Sunny, Buffer.from('89504e470d0a1a0a', 'hex')]);
    const r = await b.get(`/api/players/${ids.Sunny}/export`);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-disposition'], /^attachment; filename="glimmer-world-player-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.data.format, 'sparkle-world-player');
    assert.deepEqual([r.data.player.nickname, r.data.profile.coins, r.data.worlds.length], ['Sunny', 7, 2]);
    assert.match(r.data.player.portrait, /^data:image\/png;base64,/);
    for (const [i, w] of r.data.worlds.entries()) {
      assert.deepEqual(w, { format: 'sparkle-world', v: 1, save: saves[i] });
      const back = readWorldFile(JSON.stringify(w));
      assert.deepEqual([back.ok, back.kind, back.worlds[0].name], [true, 'world', saves[i].name], 'My Worlds → Open a file reads it');
    }
    const fam = await b.get('/api/family/export');
    assert.match(fam.headers['content-disposition'], /^attachment; filename="glimmer-world-family-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.equal(fam.data.format, 'sparkle-world-family');
    assert.deepEqual([fam.data.family.email, fam.data.family.consent.level], ['export.mom@example.com', 'verified']);
    assert.deepEqual(fam.data.players.map((p) => [p.player.nickname, p.worlds.map((w) => w.save.name)]), [['Sunny', ['Castle Cove', 'Seaside Shop']], ['Brook', ['Treehouse Den']]]);
    assert.ok(fam.data.consentHistory.some((a) => a.action === 'export.player'));
    assert.ok(fam.data.devices.length >= 1);
    const acts = (await t.db.query('select action from audit_log where family_id = $1 and action like $2', [familyId, 'export.%'])).rows.map((x) => x.action);
    assert.deepEqual(acts.sort(), ['export.family', 'export.player']);
    for (let i = 0; i < 3; i++) assert.equal((await b.get(`/api/players/${ids.Brook}/export`)).status, 200);
    assert.deepEqual((await b.get('/api/family/export')).data, { error: 'rate' }, 'exports: 5 an hour per family');
    h.setClock(16 * MIN);
    h.ctx.limits = new Limits();
    assert.deepEqual((await b.get('/api/family/export')).data, { error: 'check_required' });
  });

  test('deleting the family: Stripe first, then every row, gone_sessions for her devices, the email, the journal', async () => {
    const email = 'delete.all@example.com';
    const { b, familyId, ids } = await setupFamily(h, email, { players: ['Fern', 'Sage'] });
    const kid = await pairKid(h, b);
    await b.post('/api/devices/pair-code', {}); // one live pair code left over
    await putWorld(t.db, ids.Fern, 'w1');
    await putProfile(t.db, ids.Sage, { coins: 1, updatedAt: 1 });
    await h.browser().post('/api/auth/start', { email }); // a pending sign-in attempt for the address
    const fam = await h.family(email);
    const sessions = (await t.db.query('select id_hash from sessions where family_id = $1', [familyId])).rows.map((r) => r.id_hash);
    assert.equal(sessions.length, 2);
    const events = [];
    const onFam = (e) => events.push(['family', e]);
    const onSess = (e) => events.push(['session', e]);
    h.ctx.events.on('family', onFam);
    h.ctx.events.on('session', onSess);
    try {
      assert.deepEqual((await b.post('/api/family/delete', { confirm: 'delete' })).data, { error: 'bad_request' });
      const r = await b.post('/api/family/delete', { confirm: 'DELETE' });
      assert.deepEqual([r.status, r.data, b.cookie(SESS)], [200, { ok: true }, null]);
    } finally {
      h.ctx.events.off('family', onFam);
      h.ctx.events.off('session', onSess);
    }
    assert.deepEqual(h.stripeCalls.at(-1), { familyId, customerId: fam.stripe_customer_id });
    const pids = [ids.Fern, ids.Sage];
    const left = {
      families: await count(t.db, 'select count(*) as n from families where id = $1', [familyId]),
      players: await count(t.db, 'select count(*) as n from players where family_id = $1', [familyId]),
      profiles: await count(t.db, 'select count(*) as n from player_profiles where player_id = $1 or player_id = $2', pids),
      worlds: await count(t.db, 'select count(*) as n from worlds where player_id = $1 or player_id = $2', pids),
      sessions: await count(t.db, 'select count(*) as n from sessions where family_id = $1', [familyId]),
      attempts: await count(t.db, 'select count(*) as n from login_attempts where email = $1 or family_id = $2', [email, familyId]),
      pairCodes: await count(t.db, 'select count(*) as n from pair_codes where family_id = $1', [familyId]),
      subscriptions: await count(t.db, 'select count(*) as n from subscriptions where family_id = $1', [familyId]),
      outbox: await count(t.db, 'select count(*) as n from outbox where family_id = $1', [familyId]),
    };
    assert.deepEqual(left, { families: 0, players: 0, profiles: 0, worlds: 0, sessions: 0, attempts: 0, pairCodes: 0, subscriptions: 0, outbox: 0 });
    const gone = (await t.db.query('select id_hash from gone_sessions')).rows.map((r) => r.id_hash.toString('hex'));
    for (const hsh of sessions) assert.ok(gone.includes(hsh.toString('hex')));
    const df = await t.db.one('select * from deleted_families where family_id = $1', [familyId]);
    assert.deepEqual([df.stripe_customer_id, df.stripe_done_at instanceof Date], [null, true]);
    assert.deepEqual((await t.db.query('select action from audit_log where family_id = $1 order by id', [familyId])).rows.slice(-2).map((x) => x.action), ['family.delete', 'family.deleted']);
    const me = await kid.get('/api/me');
    assert.deepEqual([me.status, me.data], [410, { error: 'family_gone' }], 'her devices learn it and wipe');
    assert.equal(kid.cookie(SESS), null);
    const mail = (await h.mail(email)).at(-1);
    assert.equal(mail.template, 'account_deleted');
    assert.match(mail.text, /backups roll off within 7 days/);
    assert.ok(spy.lines.includes(`deletion-journal family=${familyId}`));
    assert.ok(events.some(([k, e]) => k === 'family' && e.familyId === familyId && e.deleted));
    assert.equal(events.filter(([k]) => k === 'session').length, 2);
  });

  test('two deletes of the same family at once: one does it', async () => {
    const { familyId } = await setupFamily(h, 'double.delete@example.com');
    const r = await Promise.all([h.ctx.family.deleteFamily(familyId, { notify: false }), h.ctx.family.deleteFamily(familyId, { notify: false })]);
    assert.equal(r.filter((x) => x.ok).length, 1);
    assert.equal(await count(t.db, "select count(*) as n from audit_log where family_id = $1 and action = 'family.deleted'", [familyId]), 1);
  });

  test('deleting: no check within 5 minutes → 403; a Stripe failure does not stop it, the retention job finishes it', async () => {
    const email = 'stripe.down@example.com';
    const { b, familyId } = await setupFamily(h, email);
    h.setClock(6 * MIN);
    assert.deepEqual((await b.post('/api/family/delete', { confirm: 'DELETE' })).data, { error: 'check_required' });
    h.setClock(0);
    h.stripeFails = true;
    assert.equal((await b.post('/api/family/delete', { confirm: 'DELETE' })).status, 200);
    const df = await t.db.one('select * from deleted_families where family_id = $1', [familyId]);
    assert.deepEqual([df.stripe_customer_id, df.stripe_done_at], ['cus_' + familyId.slice(0, 8), null]);
    assert.equal(await h.family(email), null, 'deleted anyway');
    await h.ctx.jobs.run('retention');
    assert.equal((await t.db.one('select stripe_done_at from deleted_families where family_id = $1', [familyId])).stripe_done_at, null, 'still failing');
    h.stripeFails = false;
    await h.ctx.jobs.run('retention');
    const done = await t.db.one('select * from deleted_families where family_id = $1', [familyId]);
    assert.deepEqual([done.stripe_customer_id, done.stripe_done_at instanceof Date], [null, true]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("A: the relay's questions — authorizeSocket and recheck (§8.1, §8.4)", () => {
  let t;
  let h;
  before(async () => {
    t = await openTestDb();
    h = await startHarness(t.db);
  });
  after(async () => {
    await h?.close();
    await t?.close();
  });
  beforeEach(() => {
    h.ctx.limits = new Limits();
    h.setClock(0);
  });
  const sess = (b) => `${SESS}=${b.cookie(SESS)}`;

  test('claims for a player who may play with friends; each refusal code', async () => {
    const { b, familyId, ids } = await setupFamily(h, 'claims@example.com', { players: ['Lily', 'Rosie'] });
    assert.equal((await b.patch(`/api/players/${ids.Lily}`, { friends: true, walkie: true })).status, 200);
    const cookie = sess(b);
    const r = await h.accounts.authorizeSocket({ cookie, playerId: ids.Lily });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.claims).sort(), ['canBuild', 'canHost', 'familyId', 'nickname', 'playerId', 'sessionHash', 'until', 'walkie']);
    assert.deepEqual([r.claims.familyId, r.claims.playerId, r.claims.nickname, r.claims.canHost, r.claims.canBuild, r.claims.walkie], [familyId, ids.Lily, 'Lily', true, true, true]);
    assert.match(r.claims.sessionHash, /^[0-9a-f]{64}$/);
    assert.ok(r.claims.until > h.clock.now() + 20 * DAY);
    assert.deepEqual(await h.accounts.recheck(r.claims), r);
    const other = await setupFamily(h, 'claims.other@example.com', { players: ['Opal'] });
    const cases = [
      [{ cookie, playerId: ids.Rosie }, { ok: false, code: 'friends_off' }],
      [{ cookie: '', playerId: ids.Lily }, { ok: false, code: 'signed_out' }],
      [{ cookie: `${SESS}=${'x'.repeat(43)}`, playerId: ids.Lily }, { ok: false, code: 'signed_out' }],
      [{ cookie, playerId: 'abc' }, { ok: false, code: 'player_gone' }],
      [{ cookie, playerId: randomUUID() }, { ok: false, code: 'player_gone' }],
      [{ cookie, playerId: other.ids.Opal }, { ok: false, code: 'player_gone' }],
      [{ cookie: '', playerId: null }, { ok: true, claims: null }],
      [{ cookie, playerId: null }, { ok: true, claims: null }], // optional: no p is today's relay, cookie or not
    ];
    for (const [q, want] of cases) assert.deepEqual(await h.accounts.authorizeSocket(q), want, JSON.stringify(q.playerId));
    // email plus only → friends_locked; no plan → not_entitled
    await t.db.query('update families set verified_at = null, verified_method = null where id = $1', [familyId]);
    h.ctx.events.emit('family', { familyId });
    h.ctx.billing.invalidate(familyId);
    assert.deepEqual(await h.accounts.recheck(r.claims), { ok: false, code: 'friends_locked' });
    await t.db.query('delete from subscriptions where family_id = $1', [familyId]);
    h.ctx.billing.invalidate(familyId);
    h.ctx.events.emit('family', { familyId });
    assert.deepEqual(await h.accounts.recheck(r.claims), { ok: false, code: 'not_entitled' });
  });

  test('live changes reach recheck at once: a switch off, a rename, a revoked session, a deleted player', async () => {
    const { b, ids } = await setupFamily(h, 'live@example.com', { players: ['Daisy', 'Pansy'] });
    await b.patch(`/api/players/${ids.Daisy}`, { friends: true, walkie: true });
    await b.patch(`/api/players/${ids.Pansy}`, { friends: true });
    const kid = await pairKid(h, b);
    const a = await h.accounts.authorizeSocket({ cookie: sess(kid), playerId: ids.Daisy });
    assert.equal(a.claims.walkie, true);
    await b.patch(`/api/players/${ids.Daisy}`, { walkie: false, nickname: 'Daisy Mae' });
    remember('Daisy Mae');
    const w = await h.accounts.recheck(a.claims);
    assert.deepEqual([w.ok, w.claims.walkie, w.claims.nickname], [true, false, 'Daisy Mae'], 'not the 60-second cache');
    await b.patch(`/api/players/${ids.Daisy}`, { friends: false });
    assert.deepEqual(await h.accounts.recheck(a.claims), { ok: false, code: 'friends_off' });
    const p = await h.accounts.authorizeSocket({ cookie: sess(kid), playerId: ids.Pansy });
    assert.equal(p.ok, true);
    assert.deepEqual((await b.del(`/api/players/${ids.Pansy}`, { confirm: 'Pansy' })).data, { ok: true });
    assert.deepEqual(await h.accounts.recheck(p.claims), { ok: false, code: 'player_gone' });
    await b.patch(`/api/players/${ids.Daisy}`, { friends: true });
    assert.equal((await h.accounts.recheck(a.claims)).ok, true);
    const dev = (await b.get('/api/devices')).data.find((d) => d.kind === 'device');
    await b.del(`/api/devices/${dev.id}`, {});
    assert.deepEqual(await h.accounts.recheck(a.claims), { ok: false, code: 'signed_out' });
    assert.deepEqual(await h.accounts.recheck(null), { ok: true, claims: null });
    assert.deepEqual(await h.accounts.recheck({ sessionHash: 'nope', playerId: ids.Daisy }), { ok: false, code: 'signed_out' });
  });

  test('answers are cached 60 s; while the database is down a cached answer up to 30 minutes old is used, else unavailable', async () => {
    const { b, ids } = await setupFamily(h, 'db.down@example.com', { players: ['Hazel', 'Juniper'] });
    await b.patch(`/api/players/${ids.Hazel}`, { friends: true });
    await b.patch(`/api/players/${ids.Juniper}`, { friends: true });
    const cookie = sess(b);
    assert.equal((await h.accounts.authorizeSocket({ cookie, playerId: ids.Hazel })).ok, true);
    const saved = { one: t.db.one, query: t.db.query };
    const down = async () => {
      const e = new Error('connect ECONNREFUSED');
      e.code = 'ECONNREFUSED';
      throw e;
    };
    t.db.one = down;
    t.db.query = down;
    try {
      assert.equal((await h.accounts.authorizeSocket({ cookie, playerId: ids.Hazel })).ok, true, 'fresh cache');
      h.ctx.sessions.ageCaches(5 * MIN);
      assert.equal((await h.accounts.authorizeSocket({ cookie, playerId: ids.Hazel })).ok, true, 'a stale answer while the database is down');
      assert.deepEqual(await h.accounts.authorizeSocket({ cookie, playerId: ids.Juniper }), { ok: false, code: 'unavailable' }, 'nothing cached');
      h.ctx.sessions.ageCaches(30 * MIN);
      assert.deepEqual(await h.accounts.authorizeSocket({ cookie, playerId: ids.Hazel }), { ok: false, code: 'unavailable' }, 'too old');
      const me = await b.get('/api/me');
      assert.deepEqual([me.status, me.data], [503, { error: 'unavailable' }]);
    } finally {
      t.db.one = saved.one;
      t.db.query = saved.query;
    }
    assert.ok(spy.lines.some((l) => l.includes('socket check failed ECONNREFUSED')));
  });

  test('required mode: every socket needs a session and p; through server.mjs the refusals close with 4401–4405', async () => {
    const cfgReq = loadConfig({ ...TEST_ENV, SW_ACCOUNTS: 'required' });
    const req = await createAccounts(cfgReq, { log: spy.log, db: t.db, timers: false });
    try {
      assert.deepEqual(await req.authorizeSocket({ cookie: '', playerId: null }), { ok: false, code: 'signed_out' });
    } finally {
      await req.close();
    }
    const { b, familyId, ids } = await setupFamily(h, 'sockets@example.com', { players: ['Iris', 'Tulip'] });
    await b.patch(`/api/players/${ids.Iris}`, { friends: true, walkie: true });
    const kid = await pairKid(h, b);
    const ok = await wsOpen(h, kid, ids.Iris);
    assert.deepEqual([ok.opened, ok.stillOpen], [true, true]);
    const legacy = await wsOpen(h, h.browser(), null);
    assert.equal(legacy.stillOpen, true, 'optional: a signed-out page plays as today');
    const off = await wsOpen(h, kid, ids.Tulip);
    assert.deepEqual([off.opened, off.closed, off.frames.at(-1)], [true, 4403, { t: 'e', code: 'friends_off' }]);
    const gone = await wsOpen(h, kid, randomUUID());
    assert.deepEqual([gone.closed, gone.frames.at(-1)], [4405, { t: 'e', code: 'player_gone' }]);
    const nobody = await wsOpen(h, h.browser(), ids.Iris);
    assert.deepEqual([nobody.closed, nobody.frames.at(-1)], [4401, { t: 'e', code: 'signed_out' }]);
    await t.db.query('update families set verified_at = null where id = $1', [familyId]);
    h.ctx.billing.invalidate(familyId);
    h.ctx.events.emit('family', { familyId });
    const locked = await wsOpen(h, kid, ids.Iris);
    assert.deepEqual([locked.closed, locked.frames.at(-1)], [4404, { t: 'e', code: 'friends_locked' }]);
    await t.db.query('delete from subscriptions where family_id = $1', [familyId]);
    h.ctx.billing.invalidate(familyId);
    h.ctx.events.emit('family', { familyId });
    const resting = await wsOpen(h, kid, ids.Iris);
    assert.deepEqual([resting.closed, resting.frames.at(-1)], [4402, { t: 'e', code: 'not_entitled' }]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: emails — the outbox, transports and words (§10, §13.7)', () => {
  let t;
  let h;
  before(async () => {
    t = await openTestDb();
    h = await startHarness(t.db);
  });
  after(async () => {
    await h?.close();
    await t?.close();
  });
  beforeEach(async () => {
    h.ctx.limits = new Limits();
    h.setClock(0);
    await t.reset();
    h.ctx.mail.captured.length = 0;
  });

  test('retries back off 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, then stop; errors kept by name only', async () => {
    const tries = [];
    h.ctx.mail.setTransport(async (m) => {
      tries.push(m.id);
      const e = new Error('provider said no to ' + m.to);
      e.code = 'http_503';
      throw e;
    });
    try {
      remember('retry.me@example.com');
      await h.ctx.mail.enqueue(t.db, 'friends_ready', 'retry.me@example.com', {});
      let at = 0;
      for (let i = 0; i < MAIL_MAX_TRIES; i++) {
        h.setClock(at);
        const r = await h.ctx.jobs.run('outbox');
        assert.equal(r.failed + r.stopped, 1, `try ${i + 1}`);
        const row = await t.db.one('select * from outbox');
        assert.deepEqual([row.tries, row.last_error, row.sent_at], [i + 1, 'http_503', null]);
        if (i < MAIL_BACKOFF_MS.length) {
          assert.ok(Math.abs(+row.send_after - (Date.now() + at) - MAIL_BACKOFF_MS[i]) < 3000, 'backoff ' + i);
          h.setClock(at + MAIL_BACKOFF_MS[i] - 5000);
          assert.equal((await h.ctx.jobs.run('outbox')).failed, 0, 'not before its time');
          at += MAIL_BACKOFF_MS[i] + 1000;
        }
      }
      assert.equal(tries.length, 8);
      h.setClock(at + 30 * DAY);
      assert.deepEqual(await h.ctx.jobs.run('outbox'), { sent: 0, failed: 0, stopped: 0 }, 'stopped for good');
    } finally {
      h.ctx.mail.setTransport(makeTransport(h.cfg, { captured: h.ctx.mail.captured }));
    }
  });

  test('sent once (two instances sending at the same moment); secrets scrubbed at send; old codes never sent', async () => {
    const twin = await createAccounts(h.cfg, { log: spy.log, db: t.db, timers: false });
    const sent = [];
    const slow = (who) => async (m) => {
      await new Promise((r) => setTimeout(r, 20));
      sent.push([who, m.template, m.id]);
    };
    h.ctx.mail.setTransport(slow('a'));
    twin.ctx.mail.setTransport(slow('b'));
    try {
      for (let i = 0; i < 6; i++) await h.ctx.mail.enqueue(t.db, 'check', `twice${i}@example.com`, { code: String(100000 + i) });
      remember('twice0@example.com');
      await Promise.all([h.ctx.jobs.run('outbox'), twin.ctx.jobs.run('outbox'), h.ctx.mail.runOutbox(), twin.ctx.mail.runOutbox()]);
      assert.equal(sent.length, 6, 'each email once');
      assert.equal(new Set(sent.map((s) => s[2])).size, 6);
      const rows = (await t.db.query('select data, sent_at from outbox')).rows;
      assert.ok(rows.every((r) => r.sent_at && JSON.stringify(r.data) === '{}'), 'codes scrubbed once sent');
      // a code whose 15 minutes passed before it could be sent is not sent at all
      await h.ctx.mail.enqueue(t.db, 'signin', 'late@example.com', { code: '123456', link: HTTPS + '/account/verify#t=abc' });
      remember('late@example.com');
      h.setClock(16 * MIN);
      assert.deepEqual(await h.ctx.jobs.run('outbox'), { sent: 0, failed: 0, stopped: 1 });
      const late = await t.db.one("select * from outbox where to_email = 'late@example.com'");
      assert.deepEqual([late.sent_at, late.last_error, late.data], [null, 'expired', {}]);
    } finally {
      h.ctx.mail.setTransport(makeTransport(h.cfg, { captured: h.ctx.mail.captured }));
      await twin.close();
    }
  });

  test('the job lock: while another instance holds it, a run skips its turn', async () => {
    const twin = await createAccounts(h.cfg, { log: spy.log, db: t.db, timers: false });
    try {
      for (const name of ['outbox', 'retention', 'summary', 'reminders', 'reconcile']) {
        let inner = null;
        const held = await t.db.tryLock(`sparkle-world:job:${name}`, async () => {
          inner = await twin.ctx.jobs.run(name);
          return true;
        });
        assert.equal(held.ok, true);
        assert.deepEqual(inner, { skipped: true }, name);
      }
      const [a, b] = await Promise.all([h.ctx.jobs.run('summary'), twin.ctx.jobs.run('summary')]);
      assert.equal([a, b].filter((r) => r.skipped).length <= 1, true);
    } finally {
      await twin.close();
    }
  });

  test('transports: resend and postmark send the right request (no tracking); log masks the address', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    let status = 200;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{"id":"x"}', { status });
    };
    try {
      const base = { ...TEST_ENV, MAIL_API_KEY: 'key_123', MAIL_FROM: 'Glimmer World <hello@playglimmerworld.com>' };
      const msg = { id: 41, to: 'parent@example.com', from: 'Glimmer World <hello@playglimmerworld.com>', replyTo: 'privacy@playglimmerworld.com', subject: 'S', text: 'T', html: '<p>T</p>' };
      remember('parent@example.com');
      await makeTransport(loadConfig({ ...base, MAIL_MODE: 'resend' }))(msg);
      assert.equal(calls[0].url, 'https://api.resend.com/emails');
      assert.deepEqual([calls[0].init.headers.Authorization, calls[0].init.headers['Idempotency-Key']], ['Bearer key_123', 'sparkle-outbox-41']);
      assert.deepEqual(JSON.parse(calls[0].init.body), { from: msg.from, to: ['parent@example.com'], subject: 'S', text: 'T', html: '<p>T</p>', reply_to: 'privacy@playglimmerworld.com' });
      await makeTransport(loadConfig({ ...base, MAIL_MODE: 'postmark' }))(msg);
      assert.equal(calls[1].url, 'https://api.postmarkapp.com/email');
      assert.equal(calls[1].init.headers['X-Postmark-Server-Token'], 'key_123');
      const pm = JSON.parse(calls[1].init.body);
      assert.deepEqual([pm.To, pm.MessageStream, pm.TrackOpens, pm.TrackLinks, pm.ReplyTo], ['parent@example.com', 'outbound', false, 'None', 'privacy@playglimmerworld.com']);
      status = 422;
      await assert.rejects(makeTransport(loadConfig({ ...base, MAIL_MODE: 'resend' }))(msg), (e) => e.code === 'http_422');
    } finally {
      globalThis.fetch = realFetch;
    }
    const lines = [];
    const dev = makeTransport(loadConfig({ ...TEST_ENV, MAIL_MODE: 'log' }), { log: (l) => lines.push(l) });
    await dev({ to: 'bryan.parent@gmail.com', template: 'signin', data: { code: '482913', link: 'http://localhost:8080/account/verify#t=abc' } });
    await dev({ to: 'bryan.parent@gmail.com', template: 'welcome', data: {} });
    assert.deepEqual(lines, ['[mail] b•••@gmail.com signin: code 482913, link http://localhost:8080/account/verify#t=abc', '[mail] b•••@gmail.com welcome']);
    assert.equal(maskEmail('x'), '•••');
  });

  test('every template: plain words, our own links only, and never a child\'s name', async () => {
    const cfg = h.cfg;
    const data = { code: '123456', link: `${HTTPS}/account/verify#t=tok`, at: 1790000000000, v: 1, trialEnd: 1790600000000, lapsedAt: 1790000000000, purgeAfter: 1797000000000, refund: true };
    assert.equal(TEMPLATES.length, 10);
    for (const tpl of TEMPLATES) {
      for (const firstTime of [false, true]) {
        const m = renderMail(tpl, { data, cfg, firstTime, notice: { version: 1, sections: [{ title: 'You can', text: 'delete it.' }] } });
        assert.ok(m.subject && m.text.length > 40 && m.html.startsWith('<!doctype html>'), tpl);
        const links = m.text.match(/https?:\/\/[^\s)]+/g) || [];
        assert.ok(links.every((l) => l.startsWith(HTTPS + '/')), `${tpl}: links only to PUBLIC_ORIGIN`);
        assert.ok(!/<img|src=|track/i.test(m.html), `${tpl}: no images or tracking`);
      }
    }
    assert.match(renderMail('welcome', { data: { trialEnd: 1790600000000 }, cfg }).text, /Cancel before .* and you won't be charged/);
    assert.ok(!/free days/.test(renderMail('welcome', { data: {}, cfg }).text), 'no trial, no trial words');
    assert.match(renderMail('us_only', { data: { refund: true }, cfg }).text, /refunded/);
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: jobs — retention, lapse and purge, reminders, the daily line (§3.5, §6.6, §13.7)', () => {
  let t;
  let h;
  before(async () => {
    t = await openTestDb();
    h = await startHarness(t.db);
  });
  after(async () => {
    await h?.close();
    await t?.close();
  });
  beforeEach(async () => {
    h.ctx.limits = new Limits();
    h.setClock(0);
    await t.reset();
  });
  const at = async (offsetMs, job = 'retention') => {
    h.setClock(offsetMs);
    return h.ctx.jobs.run(job);
  };

  test('rows that expire: attempts and pair codes a day after, sessions a week after, tombstones 30 days, sent mail 7 days, audit 3 years', async () => {
    const { b, familyId } = await setupFamily(h, 'keeper@example.com', { entitled: false });
    await t.db.query('update families set comp_until = $2 where id = $1', [familyId, new Date(Date.now() + 3650 * DAY)]);
    h.ctx.billing.invalidate(familyId);
    await b.post('/api/devices/pair-code', {});
    const kid = await pairKid(h, b);
    remember('passerby@example.com');
    await h.browser().post('/api/auth/start', { email: 'passerby@example.com' });
    await h.mail('keeper@example.com'); // sends what is due: those rows are "sent" now
    remember('Marigold');
    const pid = (await b.post('/api/players', { nickname: 'Marigold' })).data.id;
    await putWorld(t.db, pid, 'w1');
    await t.db.query('update worlds set body = null, thumb = null, deleted_at = $2 where player_id = $1', [pid, new Date()]);
    const n = async () => ({
      attempts: await count(t.db, 'select count(*) as n from login_attempts'),
      pairCodes: await count(t.db, 'select count(*) as n from pair_codes'),
      sessions: await count(t.db, 'select count(*) as n from sessions'),
      tombstones: await count(t.db, 'select count(*) as n from worlds where body is null'),
      sentMail: await count(t.db, 'select count(*) as n from outbox where sent_at is not null'),
      audit: await count(t.db, 'select count(*) as n from audit_log'),
      families: await count(t.db, 'select count(*) as n from families'),
    });
    const start = await n();
    assert.ok(start.attempts >= 2 && start.pairCodes === 2 && start.sessions === 2 && start.tombstones === 1 && start.sentMail >= 2 && start.audit >= 3);
    await at(DAY + 5 * MIN);
    assert.deepEqual([(await n()).attempts, (await n()).pairCodes], [start.attempts, start.pairCodes], 'not before a day after they expire');
    await at(DAY + 20 * MIN);
    let now = await n();
    assert.deepEqual([now.attempts, now.pairCodes, now.sessions, now.tombstones], [0, 0, 2, 1]);
    await at(8 * DAY);
    assert.equal((await n()).sentMail, 0, 'sent mail after 7 days');
    await at(22 * DAY);
    now = await n();
    assert.deepEqual([now.sessions, now.tombstones], [1, 1], 'the unused parent session: 14 days + 7');
    await at(31 * DAY);
    assert.equal((await n()).tombstones, 0);
    await at(188 * DAY);
    assert.equal((await n()).sessions, 0, 'the kid device: 180 days unused + 7');
    await at(3 * 365 * DAY + 2 * DAY);
    now = await n();
    assert.deepEqual([now.audit, now.families], [0, 1], 'audit rows after 3 years; the family with a pass stays');
    assert.ok(kid);
    assert.ok(spy.lines.some((l) => /^retention: deleted families=\d+ players=\d+ sessions=\d+/.test(l)));
  });

  test('families that never finish: no notice agreed after 14 days; agreed but no plan, pass or player after 30 days', async () => {
    const quiet = h.browser();
    const neverId = await signIn(h, quiet, 'never.agreed@example.com');
    const agreed = await setupFamily(h, 'no.plan@example.com', { entitled: false });
    const withKid = await setupFamily(h, 'has.kid@example.com', { entitled: false });
    await t.db.query("insert into players (family_id, nickname) values ($1, 'Posy')", [withKid.familyId]);
    remember('Posy');
    await at(14 * DAY - HOUR);
    assert.ok(await h.family('never.agreed@example.com'));
    const r = await at(14 * DAY + HOUR);
    assert.equal(r.families, 1);
    assert.equal(await h.family('never.agreed@example.com'), null);
    assert.deepEqual((await quiet.get('/api/me')).data, { error: 'family_gone' }, 'its browser learns it');
    assert.ok(await h.family('no.plan@example.com'));
    await at(30 * DAY + HOUR);
    assert.equal(await h.family('no.plan@example.com'), null);
    assert.ok(await h.family('has.kid@example.com'), 'a family with a player is kept');
    assert.ok(neverId && agreed.familyId);
    const acts = (await t.db.query("select actor from audit_log where action = 'family.deleted'")).rows.map((x) => x.actor);
    assert.deepEqual(acts, ['system', 'system']);
    assert.equal((await h.mail('no.plan@example.com')).filter((m) => m.template === 'account_deleted').length, 0, 'no email for these');
  });

  test('the plan ends: lapsed, warned 30 and 7 days before, the kids\' data purged after SW_RETAIN_DAYS, the family row after 12 months', async () => {
    const email = 'lapse.mom@example.com';
    const { b, familyId, ids } = await setupFamily(h, email, { players: ['Poppy Lou', 'Wren'] });
    await at(22 * DAY);
    assert.equal((await h.family(email)).lapsed_at, null, 'still in the renewal slack');
    const r = await at(24 * DAY);
    assert.equal(r.lapsed, 1);
    let f = await h.family(email);
    assert.equal(+f.purge_after - +f.lapsed_at, 90 * DAY);
    const lapsedAt = +f.lapsed_at;
    const me = await h.browser().get('/api/me');
    assert.ok(me);
    await at(lapsedAt - Date.now() + 60 * DAY - HOUR);
    assert.equal((await h.mail(email)).filter((m) => m.template === 'lapse_warning').length, 0);
    await at(lapsedAt - Date.now() + 60 * DAY + HOUR);
    await at(lapsedAt - Date.now() + 60 * DAY + 2 * HOUR);
    let warnings = (await h.mail(email)).filter((m) => m.template === 'lapse_warning');
    assert.equal(warnings.length, 1, 'once, 30 days before');
    assert.match(warnings[0].text, /kept until .*, then deleted/);
    await at(lapsedAt - Date.now() + 83 * DAY + HOUR);
    warnings = (await h.mail(email)).filter((m) => m.template === 'lapse_warning');
    assert.equal(warnings.length, 2, 'and 7 days before');
    const seen = [];
    const on = (e) => seen.push(e);
    h.ctx.events.on('family', on);
    try {
      const purge = await at(lapsedAt - Date.now() + 90 * DAY + HOUR);
      assert.equal(purge.players, 2);
    } finally {
      h.ctx.events.off('family', on);
    }
    assert.deepEqual(seen, [{ familyId }]);
    f = await h.family(email);
    assert.ok(f.kid_data_purged_at instanceof Date);
    assert.equal(await count(t.db, 'select count(*) as n from players where family_id = $1', [familyId]), 0);
    const detail = (await t.db.one("select detail from audit_log where family_id = $1 and action = 'retention.purge'", [familyId])).detail;
    assert.deepEqual(detail, { players: 2 });
    assert.ok(ids['Wren'] && b);
    await at(lapsedAt - Date.now() + 365 * DAY - HOUR);
    assert.ok(await h.family(email), 'the family row stays a year');
    await at(lapsedAt - Date.now() + 365 * DAY + HOUR);
    assert.equal(await h.family(email), null);
    assert.deepEqual(h.stripeCalls.at(-1), { familyId, customerId: 'cus_' + familyId.slice(0, 8) }, 'with its Stripe customer');
  });

  test('a lapsed family that comes back: resumed, warnings cleared', async () => {
    const email = 'comeback@example.com';
    const { familyId } = await setupFamily(h, email, { players: ['Juno'] });
    await at(24 * DAY);
    assert.ok((await h.family(email)).lapsed_at);
    await t.db.query('update families set comp_until = $2 where id = $1', [familyId, new Date(Date.now() + 400 * DAY)]);
    const r = await at(25 * DAY);
    assert.equal(r.resumed, 1);
    const f = await h.family(email);
    assert.deepEqual([f.lapsed_at, f.purge_after], [null, null]);
    const acts = (await t.db.query('select action from audit_log where family_id = $1 and action like $2 order by id', [familyId, 'plan.%'])).rows.map((x) => x.action);
    assert.deepEqual(acts, ['plan.lapsed', 'plan.resumed']);
  });

  test("a second lapse after a comeback: warned and purged again 90 days on; a device locked to a purged child sees nobody", async () => {
    const email = 'twice.lapsed@example.com';
    const { b, familyId, ids } = await setupFamily(h, email, { players: ['Hazel'] });
    const kid = await pairKid(h, b, { lockPlayer: ids.Hazel });
    const warnings = async () => (await h.mail(email)).filter((m) => m.template === 'lapse_warning').length;
    // the first lapse, straight to its purge
    await at(24 * DAY);
    const first = +(await h.family(email)).lapsed_at;
    assert.equal((await at(first - Date.now() + 90 * DAY + HOUR)).players, 1);
    assert.ok((await h.family(email)).kid_data_purged_at instanceof Date);
    const me = (await kid.get('/api/me')).data;
    assert.deepEqual([me.locked, me.lockPlayer, me.players], [true, null, []], "the purge does not unlock the device: it sees nobody");
    // she comes back: a new plan, a new child
    const back = first - Date.now() + 100 * DAY;
    h.setClock(back);
    await entitle(h, familyId);
    assert.equal((await at(back + HOUR)).resumed, 1);
    let f = await h.family(email);
    assert.deepEqual([f.lapsed_at, f.purge_after, f.kid_data_purged_at], [null, null, null], 'the comeback clears the last purge too');
    remember('Ivy');
    await t.db.query("insert into players (family_id, nickname) values ($1, 'Ivy')", [familyId]);
    const before = await warnings();
    // the second lapse: the same 90 days, the same two warnings, then the purge
    assert.equal((await at(back + 24 * DAY)).lapsed, 1);
    f = await h.family(email);
    const second = +f.lapsed_at;
    assert.deepEqual([f.kid_data_purged_at, +f.purge_after - second], [null, 90 * DAY]);
    await at(second - Date.now() + 60 * DAY + HOUR);
    assert.equal(await warnings(), before + 1, '30 days before');
    await at(second - Date.now() + 83 * DAY + HOUR);
    assert.equal(await warnings(), before + 2, '7 days before');
    assert.equal((await at(second - Date.now() + 90 * DAY + HOUR)).players, 1, 'purged at +90 days, not 12 months later');
    assert.equal(await count(t.db, 'select count(*) as n from players where family_id = $1', [familyId]), 0);
  });

  test('reminders: the yearly one on the anniversary; "still using it?" after 24 months without use, once', async () => {
    const email = 'yearly@example.com';
    await setupFamily(h, email);
    await at(364 * DAY, 'reminders');
    assert.equal((await h.mail(email)).filter((m) => m.template === 'annual_reminder').length, 0);
    await at(366 * DAY, 'reminders');
    await at(367 * DAY, 'reminders');
    assert.equal((await h.mail(email)).filter((m) => m.template === 'annual_reminder').length, 1);
    await at(731 * DAY, 'reminders');
    await at(732 * DAY, 'reminders');
    const mails = await h.mail(email);
    assert.equal(mails.filter((m) => m.template === 'annual_reminder').length, 2);
    assert.equal(mails.filter((m) => m.template === 'inactive').length, 1);
    assert.equal(fullYears(Date.UTC(2024, 1, 29), Date.UTC(2025, 1, 28)), 0);
    assert.equal(fullYears(Date.UTC(2024, 1, 29), Date.UTC(2025, 2, 1)), 1);
    assert.equal(msUntilUtc(3, 17, Date.UTC(2026, 8, 28, 3, 16)), MIN);
    assert.equal(msUntilUtc(3, 17, Date.UTC(2026, 8, 28, 3, 17)), DAY);
  });

  test('the daily line: counts only', async () => {
    const now = Date.now();
    const fam = async (email, extra = {}) => {
      const f = await t.db.one('insert into families (email, consent_at, flags) values ($1, $2, $3) returning id', [email, new Date(now), JSON.stringify(extra)]);
      return f.id;
    };
    const sub = (fid, status, x = {}) => t.db.query(
      'insert into subscriptions (id, family_id, customer_id, status, trial_end, current_period_end, first_failed_at, synced_at) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      ['sub_' + randomBytes(4).toString('hex'), fid, 'cus_x', status, x.trialEnd ? new Date(x.trialEnd) : null, x.periodEnd ? new Date(x.periodEnd) : null, x.failed ? new Date(x.failed) : null, new Date(now)],
    );
    await sub(await fam('d1@example.com'), 'active', { periodEnd: now + 10 * DAY });
    await sub(await fam('d2@example.com'), 'trialing', { trialEnd: now + 3 * DAY, periodEnd: now + 3 * DAY });
    await sub(await fam('d3@example.com', { dispute: true }), 'past_due', { periodEnd: now - DAY, failed: now - DAY });
    await sub(await fam('d4@example.com', { refund_due: true }), 'canceled', { periodEnd: now - 9 * DAY });
    await fam('d5@example.com');
    await t.db.query("insert into stripe_events (id, type, created, processed_at) values ('evt_1', 'invoice.paid', 1, $1), ('evt_2', 'invoice.paid', 2, null)", [new Date(now)]);
    await t.db.query("insert into outbox (to_email, template, sent_at) values ('d1@example.com', 'welcome', $1)", [new Date(now)]);
    await t.db.query("insert into outbox (to_email, template, tries) values ('d1@example.com', 'welcome', $1)", [MAIL_MAX_TRIES]);
    const r = await h.ctx.jobs.run('summary');
    assert.equal(r.line, 'accounts: families=5 entitled=3 trialing=1 past_due=1 lapsed=1 webhooks ok=1 failed=1 mails sent=1 failed=1 disputes=1 refund_due=1');
    assert.ok(spy.lines.includes(r.line));
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: audit records (§11.9)', () => {
  let t;
  before(async () => {
    t = await openTestDb();
  });
  after(async () => t?.close());

  test('only the listed actions and keys; values are versions, ids, methods, dates and counts', async () => {
    assert.equal(Object.keys(AUDIT_ACTIONS).length, 20);
    checkAudit('consent.verified', { method: 'operator' }, { actor: 'config' });
    checkAudit('comp.set', { until: '2099-12-31' }, { actor: 'config' });
    checkAudit('friends.on', { v: 1 });
    checkAudit('consent.verified', { method: 'card', invoice: 'in_1Abc' }, { actor: 'stripe' });
    checkAudit('comp.set', { until: null }, { actor: 'admin' });
    for (const [action, detail, opts] of [
      ['friends.onn', {}],
      ['friends.on', { v: 1, nickname: 'Lily' }],
      ['friends.on', { v: 'Lily' }],
      ['device.paired', { sid: 'lily@example.com' }],
      ['consent.verified', { method: 'email' }],
      ['consent.verified', { invoice: 'Lily was here' }],
      ['comp.set', { until: 'tomorrow' }],
      ['retention.purge', { players: -1 }],
      ['player.create', {}, { actor: 'kid' }],
      ['player.create', {}, { playerId: 'Lily' }],
    ]) {
      assert.throws(() => checkAudit(action, detail, opts), /^Error: audit: /, `${action} ${JSON.stringify(detail)}`);
    }
    const f = await t.db.one("insert into families (email) values ('audit@example.com') returning id");
    remember('audit@example.com');
    await audit(t.db, f.id, 'friends.on', { v: 2 }, { playerId: randomUUID(), at: Date.UTC(2026, 0, 1) });
    await assert.rejects(audit(t.db, f.id, 'friends.on', { nickname: 'Lily' }), /audit:/);
    await assert.rejects(audit(t.db, 'not-a-family', 'friends.off'), /audit:/);
    const rows = (await t.db.query('select * from audit_log')).rows;
    assert.equal(rows.length, 1, 'a refused record writes nothing');
    assert.deepEqual([rows[0].action, rows[0].detail, rows[0].actor, +rows[0].at], ['friends.on', { v: 2 }, 'parent', Date.UTC(2026, 0, 1)]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: free passes from SW_FREE_PASS (§6.9)', () => {
  let t;
  before(async () => {
    t = await openTestDb();
  });
  after(async () => t?.close());

  const configRows = async (familyId) =>
    (await t.db.query("select action, detail, actor from audit_log where family_id = $1 and actor = 'config' order by id", [familyId])).rows;
  const adminRun = async (h, args) => {
    const lines = [];
    const code = await runAdmin(args, { ctx: h.ctx, out: (s) => lines.push(s), write: () => {}, confirm: async () => '' });
    return { code, text: lines.join('\n') };
  };

  test('listed before the family exists: the pass at sign-up; verified consent (operator) only after the notice; entitlementOf says comp', async () => {
    const dad = 'dad.fp@example.com';
    const other = 'neighbor.fp@example.com';
    remember(dad, other);
    const h = await startHarness(t.db, { SW_FREE_PASS: 'Dad.FP@Example.com' });
    try {
      assert.equal(await h.family(dad), null, 'nothing is created before the family signs up');
      const b = h.browser();
      const familyId = await signIn(h, b, dad);
      let f = await h.family(dad);
      assert.deepEqual([+f.comp_until, f.comp_source], [Date.UTC(2100, 0, 1), 'config'], 'through 2099-12-31');
      assert.deepEqual([f.verified_at, f.verified_method], [null, null], 'no consent before the notice');
      let me = (await b.get('/api/me')).data;
      assert.deepEqual([me.plan.state, me.plan.entitled, me.consent], ['comp', true, 'none']);
      assert.equal((await b.post('/api/players', { nickname: 'Robin' })).status, 403, 'the notice first, like every parent');
      // the notice, in the normal flow
      const n = (await b.get('/api/notice')).data;
      const c = await b.post('/api/consent', { noticeVersion: n.version, agree: true });
      assert.equal(c.status, 200, c.text);
      assert.deepEqual([c.data.consent.level, c.data.consent.method], ['verified', 'operator']);
      f = await h.family(dad);
      assert.equal(f.verified_method, 'operator');
      const e = entitlementOf({ family: f, subs: [], now: h.clock.now(), cfg: h.cfg });
      assert.deepEqual([e.state, e.entitled, e.until, e.consent, e.friendsConsentOk, e.walkieConsentOk], ['comp', true, Date.UTC(2100, 0, 1), 'verified', true, true]);
      // the whole membership without paying: players, friends and the walkie
      remember('Robin');
      const p = await b.post('/api/players', { nickname: 'Robin' });
      assert.equal(p.status, 201, p.text);
      const sw = await b.patch(`/api/players/${p.data.id}`, { friends: true, walkie: true, notice: n.version });
      assert.equal(sw.status, 200, sw.text);
      me = (await b.get('/api/me')).data;
      assert.deepEqual([me.plan.state, me.consent, me.players[0].canHost, me.players[0].walkieOk], ['comp', 'verified', true, true]);
      assert.deepEqual(await configRows(familyId), [
        { action: 'comp.set', detail: { until: '2099-12-31' }, actor: 'config' },
        { action: 'consent.verified', detail: { method: 'operator' }, actor: 'config' },
      ]);
      const hist = (await b.get('/api/family/audit')).data;
      assert.deepEqual(hist.find((a) => a.action === 'consent.verified').detail, { method: 'operator' }, 'the Family page can say how consent was verified');
      assert.match((await adminRun(h, ['show', dad])).text, /verified \d{4}-\d{2}-\d{2} \(operator\)[\s\S]*free pass through 2099-12-31 \(from SW_FREE_PASS\)/);
      // signing in again changes nothing (idempotent)
      await signIn(h, h.browser(), dad);
      assert.equal((await configRows(familyId)).length, 2);
      // an address that is not listed: no pass, and agreeing to the notice is email plus only
      const nb = h.browser();
      const otherId = await signIn(h, nb, other);
      const c2 = await nb.post('/api/consent', { noticeVersion: n.version, agree: true });
      assert.deepEqual([c2.data.consent.level, c2.data.consent.method], ['email_plus', null]);
      const o = await h.family(other);
      assert.deepEqual([o.comp_until, o.comp_source, o.verified_at, o.verified_method], [null, null, null, null]);
      assert.deepEqual(await configRows(otherId), []);
      assert.equal((await nb.get('/api/me')).data.plan.state, 'none');
    } finally {
      await h.close();
    }
  });

  test('at start: an existing listed family gets it; a removed address ends a pass the list set, never an admin pass', async () => {
    const mom = 'mom.fp@example.com';
    const aunt = 'aunt.fp@example.com';
    const gran = 'gran.fp@example.com';
    remember(mom, aunt, gran);
    let h = await startHarness(t.db);
    let ids;
    try {
      ids = {
        mom: (await setupFamily(h, mom, { entitled: false })).familyId,
        aunt: (await setupFamily(h, aunt, { entitled: false })).familyId,
        gran: await signIn(h, h.browser(), gran), // never agreed to the notice
      };
      assert.equal((await adminRun(h, ['comp', aunt, '2031-01-31'])).code, 0, "the aunt's pass is the admin's");
    } finally {
      await h.close();
    }
    const restart = async (list) => {
      h = await startHarness(t.db, list === null ? {} : { SW_FREE_PASS: list });
    };

    // listed now: the next start applies it
    await restart(`${mom}:2030-06-30, ${aunt}, ${gran}`);
    try {
      let f = await h.family(mom);
      assert.deepEqual([+f.comp_until, f.comp_source, f.verified_method], [Date.UTC(2030, 6, 1), 'config', 'operator'], 'she had agreed to the notice: verified (operator)');
      f = await h.family(aunt);
      assert.deepEqual([+f.comp_until, f.comp_source], [Date.UTC(2031, 1, 1), null], "the admin's running pass is never touched");
      assert.equal(f.verified_method, 'operator');
      f = await h.family(gran);
      assert.deepEqual([+f.comp_until, f.comp_source, f.verified_at], [Date.UTC(2100, 0, 1), 'config', null], 'no notice agreed: a pass, but no consent');
      assert.deepEqual(await configRows(ids.mom), [
        { action: 'comp.set', detail: { until: '2030-06-30' }, actor: 'config' },
        { action: 'consent.verified', detail: { method: 'operator' }, actor: 'config' },
      ]);
      assert.deepEqual(await configRows(ids.aunt), [{ action: 'consent.verified', detail: { method: 'operator' }, actor: 'config' }]);
    } finally {
      await h.close();
    }

    // the same list again: nothing changes
    await restart(`${mom}:2030-06-30, ${aunt}, ${gran}`);
    await h.close();
    assert.equal((await configRows(ids.mom)).length, 2, 'idempotent');

    // a new day for mom; gran removed: her pass (the list's) ends now
    await restart(`${mom}:2031-03-31, ${aunt}`);
    try {
      assert.equal(+(await h.family(mom)).comp_until, Date.UTC(2031, 3, 1));
      const g = await h.family(gran);
      assert.ok(+g.comp_until <= h.clock.now(), 'ended');
      const e = entitlementOf({ family: g, subs: [], now: h.clock.now(), cfg: h.cfg });
      assert.deepEqual([e.state, e.entitled], ['lapsed', false], 'an ended pass: the usual lapse rules (§6.6)');
      assert.deepEqual((await configRows(ids.gran)).at(-1), { action: 'comp.set', detail: { until: null }, actor: 'config' });
    } finally {
      await h.close();
    }

    // the Variable removed altogether: mom's pass ends; the aunt's admin pass stays
    await restart(null);
    try {
      const m = await h.family(mom);
      assert.ok(+m.comp_until <= h.clock.now());
      assert.equal(m.verified_method, 'operator', 'verified consent stays once recorded (like a card)');
      const a = await h.family(aunt);
      assert.deepEqual([+a.comp_until, a.comp_source], [Date.UTC(2031, 1, 1), null]);
      assert.equal((await h.ctx.billing.entitlementFor(ids.aunt)).state, 'comp');
      assert.equal((await h.ctx.billing.entitlementFor(ids.mom)).state, 'lapsed');
      // the retention job sees an ended plan like any other
      await h.ctx.jobs.run('retention');
      assert.notEqual((await h.family(mom)).lapsed_at, null);
    } finally {
      await h.close();
    }
    const before = (await configRows(ids.mom)).length;
    await restart(null);
    await h.close();
    assert.equal((await configRows(ids.mom)).length, before, 'an ended pass is not ended twice');

    // listed again later: a new pass, and the job resumes the plan
    await restart(mom);
    try {
      assert.equal((await h.ctx.billing.entitlementFor(ids.mom)).state, 'comp');
      await h.ctx.jobs.run('retention');
      assert.equal((await h.family(mom)).lapsed_at, null);
      // the admin's comp takes the pass over: the list no longer owns it
      const r = await adminRun(h, ['comp', mom, '2032-01-31']);
      assert.equal(r.code, 0);
      assert.match(r.text, /listed in SW_FREE_PASS/);
      assert.equal((await h.family(mom)).comp_source, null);
    } finally {
      await h.close();
    }
    await restart(null);
    try {
      const m = await h.family(mom);
      assert.deepEqual([+m.comp_until, m.comp_source], [Date.UTC(2032, 1, 1), null], 'never touched once the admin set it');
    } finally {
      await h.close();
    }
  });

  test('an admin pass that has ended no longer counts: the list may give its own; a listed day already past gives nothing', async () => {
    const uncle = 'uncle.fp@example.com';
    const late = 'late.fp@example.com';
    remember(uncle, late);
    let h = await startHarness(t.db);
    let familyId;
    try {
      familyId = (await setupFamily(h, uncle, { entitled: false })).familyId;
      await t.db.query('update families set comp_until = $2 where id = $1', [familyId, new Date(h.clock.now() - DAY)]);
    } finally {
      await h.close();
    }
    h = await startHarness(t.db, { SW_FREE_PASS: `${uncle}:2030-01-01` });
    try {
      const f = await h.family(uncle);
      assert.deepEqual([+f.comp_until, f.comp_source], [Date.UTC(2030, 0, 2), 'config']);
    } finally {
      await h.close();
    }
    h = await startHarness(t.db, { SW_FREE_PASS: `${late}:2020-01-01` });
    try {
      await signIn(h, h.browser(), late);
      const f = await h.family(late);
      assert.deepEqual([f.comp_until, f.comp_source], [null, null]);
    } finally {
      await h.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: the admin CLI (§13.8)', () => {
  let t;
  let h;
  before(async () => {
    t = await openTestDb();
    h = await startHarness(t.db);
  });
  after(async () => {
    await h?.close();
    await t?.close();
  });
  beforeEach(() => {
    h.ctx.limits = new Limits();
    h.setClock(0);
  });
  const run = async (args, o = {}) => {
    const lines = [];
    const chunks = [];
    const code = await runAdmin(args, { ctx: h.ctx, out: (s) => lines.push(s), write: (c) => chunks.push(c), confirm: async () => '', ...o });
    return { code, lines, text: lines.join('\n'), written: chunks.join('') };
  };

  test('show, comp, consent-verified, change-email', async () => {
    const email = 'admin.mom@example.com';
    const { b, familyId } = await setupFamily(h, email, { entitled: false });
    let r = await run(['show', 'Admin.Mom@Example.com']);
    assert.equal(r.code, 0, r.text);
    assert.equal(r.lines[0], `family ${familyId}`);
    assert.match(r.text, /plan: none, entitled no/);
    assert.match(r.text, new RegExp(`consent: email_plus, notice v${NOTICE_VERSION} agreed \\d{4}-\\d{2}-\\d{2}, verified -`));
    assert.match(r.text, /players 0 \(friends on 0, walkie on 0\) {2}sessions: parent 1, device 0/);
    assert.deepEqual((await run(['comp', email, '2027-02-30'])).code, 2);
    r = await run(['comp', email, '2027-01-31']);
    assert.equal(r.code, 0);
    let f = await h.family(email);
    assert.equal(+f.comp_until, Date.UTC(2027, 1, 1));
    const me = (await b.get('/api/me')).data;
    assert.deepEqual([me.plan.state, me.plan.entitled], ['comp', true], 'the free pass works at once in this process');
    const kid = await b.post('/api/players', { nickname: 'Birdie' });
    remember('Birdie');
    assert.equal(kid.status, 201);
    r = await run(['show', email]);
    assert.match(r.text, /plan: comp, entitled yes/);
    assert.match(r.text, /players 1 \(friends on 0/);
    assert.ok(!r.text.includes('Birdie'), "never a child's content");
    assert.equal((await run(['consent-verified', email, '--method', 'card'])).code, 2, 'the card is recorded by the first payment only');
    r = await run(['consent-verified', email, '--method', 'form']);
    assert.equal(r.code, 0);
    f = await h.family(email);
    assert.deepEqual([f.verified_method, f.verified_at instanceof Date], ['form', true]);
    assert.equal((await run(['comp', email, 'off'])).code, 0);
    assert.equal((await h.family(email)).comp_until, null);
    const acts = (await t.db.query("select action, detail, actor from audit_log where family_id = $1 and actor = 'admin' order by id", [familyId])).rows;
    assert.deepEqual(acts, [
      { action: 'comp.set', detail: { until: '2027-01-31' }, actor: 'admin' },
      { action: 'consent.verified', detail: { method: 'form' }, actor: 'admin' },
      { action: 'comp.set', detail: { until: null }, actor: 'admin' },
    ]);
    await setupFamily(h, 'taken@example.com', { entitled: false });
    assert.equal((await run(['change-email', email, 'taken@example.com'])).code, 1);
    // an email change ends every session and pair code of the family (it often follows a
    // taken-over mailbox)
    await entitle(h, familyId);
    const code = (await b.post('/api/devices/pair-code', {})).data.code;
    remember(code, code.replace('-', ''));
    const tablet = await pairKid(h, b);
    remember('new.address@example.com');
    r = await run(['change-email', email, 'New.Address@example.com']);
    assert.equal(r.code, 0);
    assert.match(r.text, /2 sessions signed out and its pair codes ended/);
    assert.equal((await h.family('new.address@example.com')).id, familyId);
    assert.deepEqual([(await b.get('/api/me')).status, (await tablet.get('/api/me')).status], [401, 401], "the parent's browser and the kid device are signed out");
    assert.equal(await count(t.db, 'select count(*) as n from pair_codes where family_id = $1', [familyId]), 0, 'no pair code is left');
    assert.equal((await h.browser().post('/api/auth/pair', { code })).status, 400, 'the old code no longer pairs');
    assert.equal((await run(['show', 'nobody@example.com'])).text, 'no family with that email');
  });

  test('export; delete asks for the email again; sign-out-all', async () => {
    const email = 'admin.delete@example.com';
    const { b, familyId, ids } = await setupFamily(h, email, { players: ['Wrenna'] });
    await putWorld(t.db, ids.Wrenna, 'w1', { name: 'Moon Garden' });
    const ex = await run(['export', email]);
    assert.equal(ex.code, 0);
    const data = JSON.parse(ex.written);
    assert.deepEqual([data.format, data.family.email, data.players[0].worlds[0].save.name], ['sparkle-world-family', email, 'Moon Garden']);
    const phone = h.browser();
    await signIn(h, phone, email);
    const so = await run(['sign-out-all', email]);
    assert.match(so.text, /^signed out 2 sessions of family /);
    assert.equal((await phone.get('/api/me')).status, 401);
    assert.equal((await b.get('/api/me')).status, 401);
    const no = await run(['delete', email], { confirm: async () => 'someone.else@example.com' });
    assert.deepEqual([no.code, no.text], [1, 'not deleted: the email did not match']);
    assert.ok(await h.family(email));
    const yes = await run(['delete', email], { confirm: async () => ' Admin.Delete@example.com ' });
    assert.equal(yes.code, 0, yes.text);
    assert.equal(await h.family(email), null);
    assert.deepEqual(h.stripeCalls.at(-1), { familyId, customerId: 'cus_' + familyId.slice(0, 8) });
    assert.equal((await h.mail(email)).at(-1).template, 'account_deleted');
    const acts = (await t.db.query("select action from audit_log where family_id = $1 and actor = 'admin' order by id", [familyId])).rows.map((x) => x.action);
    assert.deepEqual(acts, ['export.family', 'family.delete', 'family.deleted']);
    // everyone: only after typing EVERYONE
    const other = await setupFamily(h, 'everyone.else@example.com', { entitled: false });
    const nobody = await run(['sign-out-all'], { confirm: async () => 'yes' });
    assert.deepEqual([nobody.code, nobody.text], [1, 'nobody was signed out']);
    assert.equal((await other.b.get('/api/me')).data.signedIn, true, 'a forgotten email signs out nobody by itself');
    assert.match((await run(['sign-out-all'], { confirm: async () => ' EVERYONE ' })).text, /^signed out \d+ sessions? \(everyone\)/);
    assert.equal((await other.b.get('/api/me')).status, 401);
  });

  test('comp warns when the family still has a plan that renews (and is charged)', async () => {
    const email = 'comp.paying@example.com';
    const { familyId } = await setupFamily(h, email);
    const r = await run(['comp', email, '2027-06-30']);
    assert.equal(r.code, 0);
    assert.match(r.text, new RegExp(`warning: subscription sub_${familyId.slice(0, 8)} still renews and is still charged`));
  });

  test('reapply-deletions (our own Stripe deletions and the journal: families, players, worlds), purge-now, stats, usage', async () => {
    const x = await setupFamily(h, 'restored.x@example.com', { entitled: false });
    const y = await setupFamily(h, 'restored.y@example.com', { entitled: false });
    const z = await setupFamily(h, 'restored.z@example.com', { players: ['Juniper', 'Posy'] });
    const w = await setupFamily(h, 'handdeleted.w@example.com', { entitled: false });
    await putWorld(t.db, z.ids.Posy, 'w-keep', { name: 'Keep Garden' });
    await putWorld(t.db, z.ids.Posy, 'w-gone', { name: 'Gone Garden' });
    const since = new Date(Date.now() - DAY).toISOString();
    const asked = [];
    const saved = h.ctx.stripe;
    h.ctx.stripe = {
      events: {
        list(params) {
          asked.push(params);
          return (async function* () {
            // our own family delete marks the customer first (billing.cancelAndDelete)
            yield { id: 'evt_x', data: { object: { id: 'cus_x', metadata: { family_id: x.familyId, sw_family_deleted: '1' } } } };
            // a customer the dad deleted by hand in the Dashboard: its family must stay
            yield { id: 'evt_w', data: { object: { id: 'cus_w', metadata: { family_id: w.familyId } } } };
            yield { id: 'evt_q', data: { object: { id: 'cus_q', metadata: {} } } };
          })();
        },
      },
    };
    try {
      // the journal lines a restore brings back: a family, a child and a world (ids only)
      const journal = `2026-09-28T10:00:00Z deletion-journal family=${y.familyId}\nnoise\n${randomUUID()}\n` +
        `2026-09-28T10:01:00Z deletion-journal player=${z.ids.Juniper}\n2026-09-28T10:02:00Z deletion-journal world=${z.ids.Posy}/w-gone\n`;
      const opts = { readFile: (f) => (f === 'journal.txt' ? journal : '') };
      const dry = await run(['reapply-deletions', '--since', since, '--ids', 'journal.txt', '--dry-run'], opts);
      assert.equal(dry.code, 0, dry.text);
      assert.match(dry.text, /3 families, 1 player, 1 world to delete again/);
      assert.match(dry.text, new RegExp(`not reapplied \\(deleted by hand in Stripe, check it\\): event evt_w customer cus_w family ${w.familyId}`));
      assert.ok(await h.family('restored.x@example.com'), 'a dry run deletes nothing');
      const wrong = await run(['reapply-deletions', '--since', since, '--ids', 'journal.txt'], { ...opts, confirm: async () => '4' });
      assert.deepEqual([wrong.code, wrong.lines.at(-1)], [1, 'nothing deleted: the number did not match']);
      assert.ok(await h.family('restored.y@example.com'));
      const r = await run(['reapply-deletions', '--since', since, '--ids', 'journal.txt'], { ...opts, confirm: async () => '5' });
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /reapplied deletions: 2 families, 1 player and 1 world deleted again; the rest were already gone/);
      assert.deepEqual(asked.at(-1), { type: 'customer.deleted', created: { gte: Math.floor(Date.parse(since) / 1000) }, limit: 100 });
    } finally {
      h.ctx.stripe = saved;
    }
    assert.equal(await h.family('restored.x@example.com'), null);
    assert.equal(await h.family('restored.y@example.com'), null);
    assert.ok(await h.family('handdeleted.w@example.com'), 'a customer deleted by hand in Stripe never deletes its family');
    assert.ok(await h.family('restored.z@example.com'));
    assert.equal(await count(t.db, 'select count(*) as n from players where id = $1', [z.ids.Juniper]), 0, 'the child deleted after the backup is deleted again');
    const ws = (await t.db.query('select world_id, body is null as tomb, meta from worlds where player_id = $1 order by world_id', [z.ids.Posy])).rows;
    assert.deepEqual(ws.map((r) => [r.world_id, r.tomb, r.tomb ? r.meta : null]), [['w-gone', true, {}], ['w-keep', false, null]], 'the world deleted after the backup is a tombstone again (no name kept), the other stays');
    assert.ok(spy.lines.some((l) => l === `deletion-journal player=${z.ids.Juniper}`), 'the player delete is journaled again');
    assert.equal((await run(['reapply-deletions'])).code, 2);
    const p = await run(['purge-now']);
    assert.equal(p.code, 0);
    assert.match(p.text, /^retention: families=\d+ players=\d+ sessions=\d+/);
    const s = await run(['stats']);
    assert.match(s.text, /^accounts: families=\d+ entitled=\d+ trialing=0 past_due=0 lapsed=\d+ webhooks ok=0 failed=0 mails sent=\d+ failed=0 disputes=0 refund_due=0$/);
    assert.equal((await run([])).code, 2);
    assert.equal((await run(['frobnicate'])).code, 2);
  });

  test('as a program: node server/admin.mjs with the server\'s Variables', async (tc) => {
    if (!t.url) {
      tc.skip('PGlite has no URL for another process');
      return;
    }
    const runProgram = (args, env = {}) => new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(SERVER_DIR, 'admin.mjs'), ...args], { env: { PATH: process.env.PATH, ...TEST_ENV, DATABASE_URL: t.url, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('exit', (code) => resolve({ code, out, err }));
    });
    const stats = await runProgram(['stats']);
    assert.equal(stats.code, 0, stats.err);
    assert.match(stats.out, /^accounts: families=\d+ /);
    const none = await runProgram(['show', 'nobody@example.com']);
    assert.deepEqual([none.code, none.out], [1, 'no family with that email\n']);
    const off = await runProgram(['stats'], { SW_ACCOUNTS: '' });
    assert.equal(off.code, 1);
    assert.match(off.err, /SW_ACCOUNTS is off/);
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: the server refuses to start with a broken setting (one line, exit 1, §2)', () => {
  const runServer = (env) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(SERVER_DIR, 'server.mjs')], { env: { PATH: process.env.PATH, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), 30000);
    p.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });

  test('SW_TEST=1 in production', async () => {
    const r = await runServer({ ...PROD, SW_TEST: '1' });
    assert.equal(r.code, 1);
    assert.match(r.err, /^Glimmer World will not start: [^\n]*SW_TEST=1 is refused in production[^\n]*\n$/);
  });

  test('a malformed SW_FREE_PASS (the address is never printed)', async () => {
    remember('dad.secret@example.com');
    const r = await runServer({ ...PROD, SW_FREE_PASS: 'dad.secret@example.com:2027-13-01' });
    assert.equal(r.code, 1);
    assert.equal(r.err, 'Glimmer World will not start: SW_FREE_PASS entry 1 has a date that is not a real day (YYYY-MM-DD, up to 2099-12-31)\n');
  });

  test('an unknown SW_ACCOUNTS; a database that does not answer', async () => {
    const bad = await runServer({ SW_ACCOUNTS: 'maybe' });
    assert.deepEqual([bad.code, bad.err], [1, 'Glimmer World will not start: SW_ACCOUNTS must be one of off, optional, required\n']);
    const r = await runServer({ ...TEST_ENV, SW_TEST: '', DATABASE_URL: 'postgresql://sw@127.0.0.1:9/nothing' });
    assert.equal(r.code, 1);
    assert.equal(r.err, 'Glimmer World will not start: accounts could not start (ECONNREFUSED)\n');
  });
});

// ---------------------------------------------------------------------------------------------

describe('A: the log spy (§12.7) — the last suite', () => {
  test('no email address, token, code, nickname, world name or IP address was ever logged', () => {
    assert.ok(spy.lines.length > 20, `the suites logged ${spy.lines.length} lines`);
    assert.ok(spy.secrets.size > 100, `${spy.secrets.size} secrets watched`);
    assert.ok(spy.lines.some((l) => l.startsWith('deletion-journal family=')));
    spy.check();
  });

  test("no email carried a child's name; no audit row an email address, a nickname or a world name", () => {
    const names = [...spy.secrets].filter((s) => /^[A-Z][a-z]+( [A-Z][a-z]+)?$/.test(s));
    const emails = [...spy.secrets].filter((s) => s.includes('@'));
    assert.ok(names.length >= 20 && emails.length >= 20);
    assert.ok(allMail.length > 30, `${allMail.length} emails`);
    for (const m of allMail) for (const n of names) assert.ok(!(m.subject + m.text).includes(n), `a ${m.template} email names a child`);
    assert.ok(allAudit.length > 30);
    for (const row of allAudit) {
      const text = JSON.stringify(row.detail);
      for (const s of [...names, ...emails]) assert.ok(!text.includes(s), `audit ${row.action} holds personal data`);
    }
  });
});
