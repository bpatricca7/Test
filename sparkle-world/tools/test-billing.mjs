// Billing tests (docs/ACCOUNTS.md §12.6, owner B): `npm run test:billing` (node:test, no network).
// Part 1 is the entitlementOf() table of §6.5: every Stripe status × where "now" is × a free
// pass × the consent tiers. Part 2 (below it) runs the real server, the real `stripe` SDK and the
// app's real webhook code against the local Stripe fake (tools/stripe-fake/) and a real database
// (tools/testdb.mjs): the notice and the legal drafts, the fake itself, Checkout, the return sync,
// the Portal, Start now, the webhooks in every delivery mode, the fixtures, the shape contract,
// reconcile, lapse, deleting a customer, stripe:setup and a log spy.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { entitlementOf, countingSub, consentOf, toMs } from '../server/entitlement.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 9, 1, 12, 0, 0); // "now" in most rows
const cfg = { graceDays: 7, mpConsent: 'verified' };
const fam = (extra = {}) => ({ id: 'f', consent_at: new Date(T - 30 * DAY), verified_at: null, comp_until: null, lapsed_at: null, ...extra });
const sub = (status, extra = {}) => ({
  id: 'sub_' + status,
  status,
  trial_end: null,
  current_period_end: null,
  cancel_at_period_end: false,
  first_failed_at: null,
  synced_at: new Date(T - HOUR),
  ...extra,
});
const at = (subs, now = T, family = fam(), c = cfg) => entitlementOf({ family, subs, now, cfg: c });

describe('entitlementOf: status × time (§6.5)', () => {
  const rows = [
    // [name, subs, now, state, entitled, until]
    ['no plan at all', [], T, 'none', false, null],
    ['trialing, 3 days left', [sub('trialing', { trial_end: T + 3 * DAY, current_period_end: T + 3 * DAY })], T, 'trialing', true, T + 4 * DAY],
    ['trialing, trial ended 23 h ago (1 day of slack)', [sub('trialing', { trial_end: T - 23 * HOUR })], T, 'trialing', true, T + HOUR],
    ['trialing, trial ended a day ago', [sub('trialing', { trial_end: T - DAY })], T, 'lapsed', false, null],
    ['active, renews in 10 days', [sub('active', { current_period_end: T + 10 * DAY })], T, 'active', true, T + 13 * DAY],
    ['active, period ended 2 days ago (renewal webhook late)', [sub('active', { current_period_end: T - 2 * DAY })], T, 'active', true, T + DAY],
    ['active, period ended 3 days ago', [sub('active', { current_period_end: T - 3 * DAY })], T, 'lapsed', false, null],
    ['canceling, ends in 5 days', [sub('active', { current_period_end: T + 5 * DAY, cancel_at_period_end: true })], T, 'canceling', true, T + 5 * DAY],
    ['canceling, ended 59 minutes ago', [sub('active', { current_period_end: T - 59 * 60e3, cancel_at_period_end: true })], T, 'canceling', true, T - 59 * 60e3],
    ['canceling, ended an hour ago', [sub('active', { current_period_end: T - HOUR, cancel_at_period_end: true })], T, 'lapsed', false, null],
    ['past_due, failed 2 days ago (grace 7)', [sub('past_due', { current_period_end: T - 2 * DAY, first_failed_at: T - 2 * DAY })], T, 'past_due', true, T + 5 * DAY],
    ['past_due, failed 7 days ago', [sub('past_due', { current_period_end: T - 7 * DAY, first_failed_at: T - 7 * DAY })], T, 'lapsed', false, null],
    ['incomplete (3-D Secure pending), never had a plan', [sub('incomplete')], T, 'none', false, null],
    ['incomplete_expired, never had a plan', [sub('incomplete_expired')], T, 'none', false, null],
    ['unpaid', [sub('unpaid', { current_period_end: T + 5 * DAY })], T, 'lapsed', false, null],
    ['canceled', [sub('canceled', { current_period_end: T - 5 * DAY })], T, 'lapsed', false, null],
    ['paused', [sub('paused')], T, 'lapsed', false, null],
    ['an unknown status', [sub('something_new')], T, 'lapsed', false, null],
  ];
  for (const [name, subs, now, state, entitled, until] of rows) {
    test(name, () => {
      const e = at(subs, now);
      assert.equal(e.state, state);
      assert.equal(e.entitled, entitled);
      assert.equal(e.until, until);
    });
  }

  test('grace follows SW_GRACE_DAYS', () => {
    const s = [sub('past_due', { first_failed_at: T - 2 * DAY })];
    assert.equal(at(s, T, fam(), { ...cfg, graceDays: 3 }).until, T + DAY);
    assert.equal(at(s, T, fam(), { ...cfg, graceDays: 2 }).state, 'lapsed');
    const e = at(s);
    assert.equal(e.graceUntil, T + 5 * DAY);
  });

  test('a missing date falls back to the other date, then to a day after the last sync', () => {
    assert.equal(at([sub('active', { trial_end: T - 2 * DAY })]).until, T + DAY);
    assert.equal(at([sub('trialing', { current_period_end: T + DAY })]).until, T + 2 * DAY);
    assert.equal(at([sub('active', { synced_at: T - HOUR })]).state, 'active');
    assert.equal(at([sub('active', { synced_at: T - 5 * DAY })]).state, 'lapsed');
    assert.equal(at([sub('past_due', { current_period_end: T - DAY })]).until, T + 6 * DAY);
  });

  test('the boundaries are exact (now < until)', () => {
    const end = T + 10 * DAY;
    const s = [sub('active', { current_period_end: end })];
    assert.equal(at(s, end + 3 * DAY - 1).entitled, true);
    assert.equal(at(s, end + 3 * DAY).entitled, false);
    const tr = [sub('trialing', { trial_end: end })];
    assert.equal(at(tr, end + DAY - 1).entitled, true);
    assert.equal(at(tr, end + DAY).entitled, false);
  });
});

describe('entitlementOf: the subscription that counts', () => {
  test('a live one beats a newer-synced ended one', () => {
    const subs = [sub('canceled', { id: 'a', synced_at: T }), sub('active', { id: 'b', current_period_end: T + 5 * DAY, synced_at: T - DAY })];
    assert.equal(countingSub(subs).id, 'b');
    assert.equal(at(subs).state, 'active');
  });
  test('of two live ones, the latest period end counts', () => {
    const subs = [sub('past_due', { id: 'a', current_period_end: T - DAY, first_failed_at: T - DAY }), sub('trialing', { id: 'b', trial_end: T + 6 * DAY, current_period_end: T + 6 * DAY })];
    assert.equal(countingSub(subs).id, 'b');
    assert.equal(at(subs).state, 'trialing');
  });
  test('with none live, the most recently synced counts', () => {
    const subs = [sub('canceled', { id: 'a', synced_at: T - DAY }), sub('incomplete', { id: 'b', synced_at: T })];
    assert.equal(countingSub(subs).id, 'b');
    assert.equal(at(subs).state, 'lapsed', 'a new attempt after an ended plan still reads as lapsed');
  });
  test('no subscriptions', () => {
    assert.equal(countingSub([]), null);
    assert.equal(countingSub(undefined), null);
  });
  test('details come from the counting subscription', () => {
    const e = at([sub('active', { current_period_end: T + 5 * DAY, trial_end: T - 2 * DAY, cancel_at_period_end: true })]);
    assert.deepEqual([e.periodEnd, e.trialEnd, e.cancelAtPeriodEnd, e.graceUntil], [T + 5 * DAY, T - 2 * DAY, true, null]);
    const none = at([]);
    assert.deepEqual([none.periodEnd, none.trialEnd, none.cancelAtPeriodEnd, none.graceUntil], [null, null, false, null]);
  });
});

describe('entitlementOf: free passes (comp_until)', () => {
  test('a pass that has not run out: comp, whatever the status', () => {
    for (const subs of [[], [sub('canceled')], [sub('past_due', { first_failed_at: T - 30 * DAY })], [sub('incomplete')]]) {
      const e = at(subs, T, fam({ comp_until: T + 20 * DAY }));
      assert.deepEqual([e.state, e.entitled, e.until], ['comp', true, T + 20 * DAY]);
    }
  });
  test('a pass and a paid plan: comp, until the later of the two', () => {
    const e = at([sub('active', { current_period_end: T + 30 * DAY })], T, fam({ comp_until: T + 5 * DAY }));
    assert.deepEqual([e.state, e.until], ['comp', T + 33 * DAY]);
  });
  test('a pass that ran out: lapsed (or the plan, if there is one)', () => {
    assert.equal(at([], T, fam({ comp_until: T - 1 })).state, 'lapsed');
    assert.equal(at([], T, fam({ comp_until: T })).state, 'lapsed');
    assert.equal(at([sub('active', { current_period_end: T + 5 * DAY })], T, fam({ comp_until: T - DAY })).state, 'active');
  });
  test('lapsed_at alone means the family had a plan', () => {
    assert.equal(at([], T, fam({ lapsed_at: T - DAY })).state, 'lapsed');
  });
});

describe('entitlementOf: consent tiers (§6.7, §11.4)', () => {
  const cases = [
    // [consent_at, verified_at, mpConsent, consent, friendsOk, walkieOk]
    [null, null, 'verified', 'none', false, false],
    [T - DAY, null, 'verified', 'email_plus', false, false],
    [T - DAY, T - HOUR, 'verified', 'verified', true, true],
    [null, null, 'email_plus', 'none', false, false],
    [T - DAY, null, 'email_plus', 'email_plus', true, false],
    [T - DAY, T - HOUR, 'email_plus', 'verified', true, true],
    [null, T - HOUR, 'verified', 'verified', true, true],
  ];
  for (const [consentAt, verifiedAt, mp, consent, friends, walkie] of cases) {
    test(`consent_at ${consentAt ? 'set' : 'null'}, verified_at ${verifiedAt ? 'set' : 'null'}, SW_MP_CONSENT=${mp}`, () => {
      const e = at([sub('active', { current_period_end: T + DAY })], T, fam({ consent_at: consentAt, verified_at: verifiedAt }), { ...cfg, mpConsent: mp });
      assert.deepEqual([e.consent, e.friendsConsentOk, e.walkieConsentOk], [consent, friends, walkie]);
      assert.equal(consentOf(fam({ consent_at: consentAt, verified_at: verifiedAt })), consent);
    });
  }
  test('consent does not depend on the plan (callers combine it with entitled)', () => {
    const e = at([], T, fam({ verified_at: T - DAY }));
    assert.deepEqual([e.entitled, e.consent, e.walkieConsentOk], [false, 'verified', true]);
  });
  test('unknown mpConsent reads as the strict default', () => {
    const e = at([], T, fam(), { graceDays: 7, mpConsent: 'nonsense' });
    assert.equal(e.friendsConsentOk, false);
  });
});

describe('entitlementOf: inputs', () => {
  test('times as Date, ms and ISO strings; camelCase rows; Date now', () => {
    const end = T + 10 * DAY;
    for (const v of [new Date(end), end, new Date(end).toISOString()]) {
      assert.equal(at([sub('active', { current_period_end: v })]).until, end + 3 * DAY);
    }
    const camel = { status: 'trialing', trialEnd: new Date(T + DAY), currentPeriodEnd: new Date(T + DAY), cancelAtPeriodEnd: false, syncedAt: new Date(T) };
    assert.equal(entitlementOf({ family: { consentAt: new Date(T), compUntil: null }, subs: [camel], now: new Date(T), cfg }).until, T + 2 * DAY);
    assert.equal(toMs(null), null);
    assert.equal(toMs('not a date'), null);
  });
  test('now is required; defaults for cfg', () => {
    assert.throws(() => entitlementOf({ family: fam(), subs: [] }));
    const e = entitlementOf({ family: fam(), subs: [sub('past_due', { first_failed_at: T - 6 * DAY })], now: T });
    assert.equal(e.until, T + DAY, 'grace defaults to 7 days');
  });
  test('the answer has exactly the fields of §6.5', () => {
    assert.deepEqual(Object.keys(at([])).sort(), ['cancelAtPeriodEnd', 'consent', 'entitled', 'friendsConsentOk', 'graceUntil', 'periodEnd', 'state', 'subState', 'trialEnd', 'until', 'walkieConsentOk']);
  });
});

// =============================================================================================
// Part 2: billing through the real server, the real SDK and the Stripe fake (owner B)
// =============================================================================================

import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Stripe from 'stripe';

import { loadConfig } from '../server/config.mjs';
import { createAccounts, makeClock } from '../server/accounts.mjs';
import { createServer } from '../server/server.mjs';
import { createRouter, parseCookies } from '../server/http.mjs';
import { Limits } from '../server/limits.mjs';
import { createBilling, READ_PATHS, HANDLED_EVENTS, shapePaths, hasPath, subscriptionRow, invoiceSubscriptionId } from '../server/billing.mjs';
import { createStripe, stripeOptions, STRIPE_API_VERSION } from '../server/stripe.mjs';
import { NOTICE_VERSION, noticeSections, noticeCheckbox, notice, noticeSummary, renewalSentence, pricePhrase, WALKIE_SWITCH_NOTICE, FRIENDS_SWITCH_NOTICE } from '../server/notice.mjs';
import { startStripeFake } from './stripe-fake/server.mjs';
import { parseForm, encodeForm } from './stripe-fake/form.mjs';
import { addMonth } from './stripe-fake/engine.mjs';
import { makeFixtures, normalize, FIXTURE_DIR, FIXTURE_FAMILIES } from './stripe-fake/make-fixtures.mjs';
import { setup as stripeSetup, LOOKUP_KEY, PORTAL_TAG } from './stripe-setup.mjs';
import { openTestDb } from './testdb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60e3;
const ORIGIN = 'http://localhost:8080';
const BASE_ENV = Object.freeze({
  SW_ACCOUNTS: 'optional',
  DATABASE_URL: 'postgresql://sw@127.0.0.1:5432/unused', // the tests hand createAccounts a database
  PUBLIC_ORIGIN: ORIGIN,
  SW_SECRET: randomBytes(32).toString('base64'),
  STRIPE_SECRET_KEY: 'sk_test_billingSuite',
  MAIL_MODE: 'memory',
});
const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ---- one database for this file (reset between tests) ----

let tdb = null;
async function database() {
  if (!tdb) tdb = await openTestDb();
  return tdb;
}
after(async () => {
  if (tdb) await tdb.close();
});

// ---- a family and a pretend session (auth.mjs is A's; the router only needs fromRequest) ----

let famN = 0;
async function makeFamily(db, o = {}) {
  const email = o.email || `parent${++famN}.${randomBytes(3).toString('hex')}@example.com`;
  const now = Date.now();
  return db.one(
    `insert into families (id, email, email_verified_at, consent_at, notice_version, verified_at, verified_method, trial_used, comp_until, country, stripe_customer_id)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
    [
      o.id || null, email,
      o.verifiedEmail === false ? null : new Date(now - 3600e3),
      o.consent === false ? null : new Date(now - 1800e3),
      o.consent === false ? null : NOTICE_VERSION,
      o.verified ? new Date(now - MIN) : null, o.verified ? 'card' : null,
      !!o.trialUsed, o.compUntil ? new Date(o.compUntil) : null, o.country || null, o.customer || null,
    ],
  );
}

/** Session cookie values the pretend store understands: parent_<familyId>_plain|check, device_<familyId>_plain. */
const tok = (fam, kind = 'plain', who = 'parent') => `${who}_${fam.id}_${kind}`;
function pretendSessions(clock) {
  return {
    async fromRequest(req) {
      const v = parseCookies(req.headers.cookie).sw_sess || '';
      const m = /^(parent|device)_([0-9a-f-]{36})_(plain|check)$/.exec(v);
      if (!m) return null;
      const now = clock.now();
      const checked = m[3] === 'check';
      return { hash: createHash('sha256').update(v).digest(), kind: m[1], familyId: m[2], lockPlayer: null, elevatedUntil: checked ? now + 10 * MIN : null, elevatedAt: checked ? now - MIN : null };
    },
  };
}
const NO_LIMITS = { check: () => ({ ok: true }) };

function request(base, method, p, { token, body, headers = {}, raw = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const h = { ...headers };
    if (method !== 'GET' && !raw) Object.assign(h, { 'x-sw': '1', origin: ORIGIN, 'content-type': 'application/json' }, headers);
    if (token) h.cookie = `sw_sess=${token}`;
    const payload = raw !== null ? raw : method === 'GET' ? null : JSON.stringify(body ?? {});
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h }, (res) => {
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
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ---- the app: the real server + accounts with billing, the fake's webhooks pointed at it ----

const htmlDir = mkdtempSync(path.join(tmpdir(), 'sw-billing-'));
const htmlPath = path.join(htmlDir, 'game.html');
writeFileSync(htmlPath, '<!doctype html><title>Sparkle World</title>');
after(() => rmSync(htmlDir, { recursive: true, force: true }));

async function startApp(fake, extraEnv = {}) {
  const t = await database();
  const cfg = loadConfig({ ...BASE_ENV, STRIPE_API_BASE: fake.url, STRIPE_WEBHOOK_SECRET: fake.webhookSecret, STRIPE_PRICE_ID: fake.priceId, ...extraEnv });
  const clock = makeClock();
  const logs = [];
  const log = (...a) => logs.push(a.join(' '));
  // jobs: false asks accounts.mjs not to start the background jobs (A's jobs.mjs) in this suite
  const accounts = await createAccounts(cfg, { log, clock, db: t.db, jobs: false });
  accounts.ctx.sessions = pretendSessions(clock);
  accounts.ctx.limits = NO_LIMITS;
  // the tests run reconcile and lapse themselves; a background job calling them does nothing here
  const billing = accounts.ctx.billing;
  const reconcile = billing.reconcile;
  const lapse = billing.lapse;
  billing.reconcile = async () => ({ checked: 0, sessions: 0, failed: 0, deletions: { tried: 0, done: 0 }, skipped: true });
  billing.lapse = async () => ({ lapsed: 0, resumed: 0, skipped: true });
  // what was handed to the outbox, before any worker scrubs `data` after sending (§10)
  const mailed = [];
  const mail = accounts.ctx.mail;
  const enqueue = mail.enqueue;
  mail.enqueue = async (q, template, to, data = {}, o = {}) => {
    const r = await enqueue.call(mail, q, template, to, data, o);
    mailed.push({ template, to, data: JSON.parse(JSON.stringify(data)), familyId: o.familyId ?? null });
    return r;
  };
  const app = createServer({ accounts, htmlPath, siteDir: path.join(htmlDir, 'no-site'), log: () => {} });
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  fake.setWebhook(`${base}/api/stripe/webhook`, fake.webhookSecret);
  fake.onClock((now) => clock.set(now - Date.now()));
  const familyEvents = [];
  accounts.events.on('family', (e) => familyEvents.push(e.familyId));
  return {
    cfg, clock, accounts, app, base, logs, db: t.db, t, familyEvents, mailed,
    billing,
    reconcile: (o) => reconcile(o),
    lapse: (o) => lapse(o),
    call: (method, p, o) => request(base, method, p, o),
    async close() {
      fake.onClock(null);
      await app.close();
    },
  };
}

async function outbox(db, familyId) {
  const rows = (await db.query('select template, to_email, data from outbox where family_id = $1 order by id', [familyId])).rows;
  const count = {};
  for (const r of rows) count[r.template] = (count[r.template] || 0) + 1;
  return { rows, count };
}
const famRow = (db, id) => db.one('select * from families where id = $1', [id]);
const subRows = async (db, id) => (await db.query('select * from subscriptions where family_id = $1 order by started_at', [id])).rows;

/** Checkout through the app, then the fake's hosted page ("Pay"): → { url, session, redirect }. */
async function subscribe(A, fake, fam, { trial = false, outcome = 'ok', country = 'US', wait = true } = {}) {
  const r = await A.call('POST', '/api/billing/checkout', { token: tok(fam), body: { trial, usResident: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const paid = await fake.pay(r.data.url, { outcome, country, wait });
  return { url: r.data.url, sessionId: /\/c\/(cs_test_[A-Za-z0-9]+)/.exec(r.data.url)[1], paid };
}

/** Sign an event like Stripe and post it to the app's webhook. */
function postEvent(A, secret, event, { timestamp, payload, body } = {}) {
  const text = payload ?? JSON.stringify(event, null, 2);
  const sig = Stripe.webhooks.generateTestHeaderString({ payload: text, secret, ...(timestamp ? { timestamp } : {}) });
  return request(A.base, 'POST', '/api/stripe/webhook', { raw: body ?? text, headers: { 'content-type': 'application/json', 'stripe-signature': sig } });
}

const readFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURE_DIR, name + '.json'), 'utf8'));
const FIXTURE_NAMES = existsSync(FIXTURE_DIR) ? readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && f !== 'subscriptions.json').map((f) => f.slice(0, -5)).sort() : [];

// ---------------------------------------------------------------------------------------------

describe('the direct notice (server/notice.mjs, §11.3)', () => {
  const cfg = { mpConsent: 'verified', retainDays: 90, trialDays: 0, priceText: '$5.99 a month, plus sales tax where it applies', mailMode: 'resend', publicOrigin: 'https://sparkleworld.example', operator: { name: 'The Operator', email: 'hello@sparkleworld.example', address: 'PO Box 1, Town, ST 00000', phone: '+1 555 0100' } };
  test('version, sections, checkbox; every element of §11.3', () => {
    assert.equal(NOTICE_VERSION, 1);
    const s = noticeSections(cfg);
    assert.ok(s.every((x) => typeof x.title === 'string' && typeof x.text === 'string' && x.text.length > 20));
    const all = s.map((x) => `${x.title} ${x.text}`).join('\n');
    const must = [
      /email so we can ask your permission/i, // why the parent's contact was collected
      /never asked for an email/i,
      /nickname you choose/i, /avatar/i, /game progress/i, /worlds/i, /pets/i, // what is collected
      /only to run the game/i, // how it is used
      /never collect/i, /no ads, no analytics, no trackers/i,
      /Playing with friends and the walkie-talkie are off/i, /see her nickname, avatar and the world/i, /hear her voice live/i, /never recorded/i, // possible disclosures
      /agree to saving without agreeing to playing with friends/i, // consent to collection without disclosure
      /your first payment/i, // how the switches unlock (SW_MP_CONSENT=verified)
      /Railway/, /Stripe/, /Resend/, /don't sell/i, // recipients
      /90 days after it ends/i, /backups roll off within 7 days/i,
      /see, download and delete/i, /hello@sparkleworld\.example/,
      /We need your permission first.*don't collect, use or share anything about your children/i, // 312.4(c)(1)(ii): consent is needed
      /within 14 days, we delete your email address/i, // deletion if consent does not come
      /agree but don't start the Family Plan within 30 days, we delete it then/i, // …and if a plan does not come (§3.5)
      /The Operator, PO Box 1, Town, ST 00000, \+1 555 0100, hello@sparkleworld\.example/, // operator contact
      /https:\/\/sparkleworld\.example\/privacy/, // the link to the online notice
    ];
    for (const re of must) assert.match(all, re);
    assert.match(noticeCheckbox(cfg), /parent or legal guardian.*18 or older.*agree/i);
    const n = notice(cfg);
    assert.deepEqual([n.version, n.privacyPath, n.sections.length, n.checkbox === noticeCheckbox(cfg)], [1, '/privacy', s.length, true]);
    assert.ok(!/\{\{|\bundefined\b|null/.test(all), 'nothing left unfilled');
  });
  test('worded from SW_MP_CONSENT, SW_RETAIN_DAYS and the email provider', () => {
    const e = noticeSections({ ...cfg, mpConsent: 'email_plus', retainDays: 30, mailMode: 'postmark' }).map((x) => x.text).join(' ');
    assert.match(e, /Playing with friends can be switched on as soon as you agree here/);
    assert.match(e, /walkie-talkie switch becomes available once .* first payment/);
    assert.match(e, /30 days after it ends/);
    assert.match(e, /Postmark/);
    const dev = noticeSections({ ...cfg, operator: { name: null, email: null, address: null, phone: null }, mailMode: 'memory' }).map((x) => x.text).join(' ');
    assert.match(dev, /\[SW_OPERATOR_NAME not set\]/);
    assert.match(dev, /our email provider/);
  });
  test('the switch notices are the Family page and game texts', () => {
    const gate = readFileSync(path.join(ROOT, 'src/net/walkie/gate.js'), 'utf8');
    const m = /export const GATE_NOTE = '([^']+)'/.exec(gate);
    assert.ok(m, 'gate.js still exports GATE_NOTE');
    assert.equal(WALKIE_SWITCH_NOTICE, m[1], 'the walkie switch notice is the game\'s GATE_NOTE, word for word');
    assert.match(FRIENDS_SWITCH_NOTICE, /nickname, her avatar and the world/);
  });
  test('the email summary and the auto-renewal sentence', () => {
    const s = noticeSummary(cfg);
    assert.match(s, /https:\/\/sparkleworld\.example\/privacy/);
    assert.ok(!EMAIL_RE.test(s));
    assert.equal(pricePhrase(cfg), '$5.99 plus tax');
    assert.equal(pricePhrase({ priceText: '$5.99 a month, tax included' }), '$5.99, tax included');
    assert.equal(renewalSentence(cfg), 'I agree to the Terms. My Family Plan renews every month at $5.99 plus tax until I cancel; I can cancel any time on the Family page.');
    assert.match(renewalSentence({ ...cfg, trialDays: 7 }, { trial: true }), /^I agree to the Terms\. After the free week, my Family Plan renews every month at \$5\.99 plus tax until I cancel/);
    assert.match(renewalSentence({ ...cfg, trialDays: 14 }, { trial: true }), /After 14 free days/);
    assert.ok(renewalSentence(cfg).length <= 1200, 'fits Checkout custom_text');
  });
});

// ---------------------------------------------------------------------------------------------

describe('the legal drafts (site/privacy.html, site/terms.html, §11.10)', () => {
  const read = (f) => readFileSync(path.join(ROOT, 'site', f), 'utf8');
  const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
  test('/privacy has every element of 312.4(d) and §11.10', () => {
    const html = read('privacy.html');
    const t = text(html);
    const must = [
      /\{\{SW_OPERATOR_NAME\}\}/, /\{\{SW_OPERATOR_ADDRESS\}\}/, /\{\{SW_OPERATOR_PHONE\}\}/, /\{\{SW_OPERATOR_EMAIL\}\}/, // operator contact
      /nickname/i, /avatar/i, /portrait|picture/i, /progress/i, /worlds/i, /pet/i, // what is collected from children
      /how we use/i, /only to run the game/i,
      /Play with friends/i, /walkie-talkie/i, /switch/i, /never recorded/i, // children making information available + the switches
      /cookie/i, /persistent identifier/i, /internal operations/i, /device secret|device stamp/i, // persistent identifiers
      /Railway/, /Stripe/, /Resend|Postmark|email provider/i, // service providers and what each receives
      /never sell|do not sell|don't sell/i, /no advertising|no ads/i,
      /90 days/i, /12 months/i, /7 days/i, /3 years/i, // the retention policy (§3.5)
      /review/i, /download/i, /delete/i, /revoke|turn .* off|switch .* off/i, /10 business days/i, // parent rights
      /Notice version/i, new RegExp(`version ${NOTICE_VERSION}\\b`, 'i'), /\d{4}-\d{2}-\d{2}|September 28, 2026/, // version and date
      /COPPA|Children's Online Privacy Protection/i,
      /never collect/i, /email/i,
    ];
    for (const re of must) assert.match(t, re, String(re));
  });
  test('/terms has the plan, renewal, cancelling, US only, parents, no in-app purchases, conduct, changes, operator', () => {
    const t = text(read('terms.html'));
    const must = [
      /\{\{SW_PRICE_TEXT\}\}|\$5\.99/, /sales tax/i, /renews (automatically )?every month|monthly .*until you cancel|renews .* until you cancel/i,
      /cancel/i, /Customer Portal|Manage subscription|Family page/i, /end of the (current )?(billing )?period|period end/i, /no partial refunds|not refunded|no refunds for partial/i,
      /free (trial|week)|\{\{SW_TRIAL_DAYS\}\}/i, /United States/i, /parent or legal guardian/i, /18/,
      /nothing to buy inside the game|no in-app purchases/i, /kind/i, /change (these|the) terms|changes to (these|the) terms/i, /price/i, /notice/i,
      /\{\{SW_OPERATOR_NAME\}\}/, /\{\{SW_OPERATOR_EMAIL\}\}/, /Privacy Notice/i,
    ];
    for (const re of must) assert.match(t, re, String(re));
  });
  test('the drafts load nothing from other sites, have no inline script and no form', () => {
    for (const f of ['privacy.html', 'terms.html']) {
      const html = read(f);
      const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
      assert.ok(scripts.every((s) => /^<script src="app\.js" defer>$/.test(s)), f + ': only the site\'s own app.js');
      assert.ok(!/<form\b/i.test(html), f + ' has no form');
      assert.ok(!/(src|href)\s*=\s*["']\s*(https?:)?\/\/(?!\{\{)/i.test(html.replace(/<a\b[^>]*>/gi, '')), f + ' loads nothing from another site');
      assert.match(html, /<meta name="viewport"/);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('the Stripe fake (tools/stripe-fake, §12.3)', () => {
  let fake;
  let hook;
  let hookUrl;
  const got = []; // { type, id, ok }
  let answers = []; // statuses to answer next (then 200)
  before(async () => {
    hook = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        let e = null;
        try {
          e = Stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], fake.webhookSecret, 300);
        } catch {}
        const status = answers.length ? answers.shift() : 200;
        const o = e?.data?.object;
        got.push({ type: e?.type ?? null, id: e?.id ?? null, customer: o ? (o.object === 'customer' ? o.id : o.customer ?? null) : null, ok: !!e, status, pretty: raw.toString().includes('\n  "id"') });
        res.writeHead(status);
        res.end('{}');
      });
    });
    await new Promise((r) => hook.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${hook.address().port}/hook`;
    fake = await startStripeFake({ webhookUrl: hookUrl, retryDelays: [20, 40, 80], delayMs: 150 });
  });
  after(async () => {
    await fake?.close();
    await new Promise((r) => hook.close(r));
  });
  beforeEach(() => {
    got.length = 0;
    answers = [];
    fake.delivery('normal');
  });
  const stripe = () => createStripe({ stripeSecretKey: 'sk_test_fakeSuite', stripeApiBase: fake.url });
  const params = (customer, extra = {}) => ({
    mode: 'subscription', customer, client_reference_id: randomUUID(), line_items: [{ price: fake.priceId, quantity: 1 }],
    payment_method_collection: 'always', payment_method_types: ['card'], automatic_tax: { enabled: true }, customer_update: { address: 'auto', name: 'auto' },
    billing_address_collection: 'required', consent_collection: { terms_of_service: 'required' }, allow_promotion_codes: false, locale: 'en',
    success_url: 'http://app/account?checkout={CHECKOUT_SESSION_ID}', cancel_url: 'http://app/account?checkout=cancel', ...extra,
  });

  test("Stripe's form encoding (brackets, arrays, metadata)", () => {
    const data = { a: 'x y', line_items: [{ price: 'p_1', quantity: 1 }], metadata: { family_id: 'f' }, expand: ['subscription', 'subscription.latest_invoice'], n: null, b: true };
    assert.deepEqual(parseForm(encodeForm(data)), { a: 'x y', line_items: [{ price: 'p_1', quantity: '1' }], metadata: { family_id: 'f' }, expand: ['subscription', 'subscription.latest_invoice'], n: '', b: 'true' });
    assert.deepEqual(parseForm('expand[]=a&expand[]=b&x[y][0][z]=1'), { expand: ['a', 'b'], x: { y: [{ z: '1' }] } });
    assert.equal(addMonth(Date.UTC(2026, 0, 31)), Date.UTC(2026, 1, 28), 'Jan 31 → Feb 28');
    assert.equal(addMonth(Date.UTC(2026, 1, 28), 31), Date.UTC(2026, 2, 31), 'the anchor day comes back');
  });

  test('refuses other API versions, live keys and made-up paths, with Stripe error JSON', async () => {
    const r1 = await fetch(fake.url + '/v1/customers/cus_x', { headers: { authorization: 'Bearer sk_test_x', 'stripe-version': '2020-08-27' } });
    assert.equal(r1.status, 400);
    assert.equal((await r1.json()).error.type, 'invalid_request_error');
    const r2 = await fetch(fake.url + '/v1/customers/cus_x', { headers: { authorization: 'Bearer sk_live_x', 'stripe-version': STRIPE_API_VERSION } });
    assert.equal(r2.status, 401);
    const r3 = await fetch(fake.url + '/v1/customers/cus_nope', { headers: { authorization: 'Bearer sk_test_x', 'stripe-version': STRIPE_API_VERSION } });
    assert.deepEqual([r3.status, (await r3.json()).error.code], [404, 'resource_missing']);
    await assert.rejects(stripe().customers.retrieve('cus_nope'), (e) => e.statusCode === 404 && e.code === 'resource_missing');
  });

  test('Idempotency-Key: the same key and body replay; another body is an idempotency_error', async () => {
    const s = stripe();
    const a = await s.customers.create({ email: 'x@example.com', metadata: { family_id: 'f1' } }, { idempotencyKey: 'k-1' });
    const b = await s.customers.create({ email: 'x@example.com', metadata: { family_id: 'f1' } }, { idempotencyKey: 'k-1' });
    assert.equal(a.id, b.id);
    await assert.rejects(s.customers.create({ email: 'y@example.com' }, { idempotencyKey: 'k-1' }), (e) => e.type === 'StripeIdempotencyError' && e.statusCode === 400);
    assert.equal(fake.state().customers.filter((c) => c.email === 'x@example.com').length, 1);
  });

  test("Checkout refuses a request missing what the app relies on (§6.2)", async () => {
    const s = stripe();
    const c = await s.customers.create({ email: 'c@example.com' });
    const bad = [
      { mode: undefined }, { payment_method_collection: 'if_required' }, { automatic_tax: { enabled: false } }, { client_reference_id: undefined },
      { success_url: 'http://app/account' }, { consent_collection: undefined }, { billing_address_collection: 'auto' }, { allow_promotion_codes: true },
      { line_items: [{ price: fake.priceId, quantity: 2 }] }, { line_items: [{ price: 'price_nope', quantity: 1 }] }, { expires_at: Math.floor(Date.now() / 1000) + 60 },
      { subscription_data: { trial_period_days: 0 } }, { customer: 'cus_nope' },
    ];
    for (const extra of bad) await assert.rejects(s.checkout.sessions.create(params(c.id, extra)), (e) => e.statusCode >= 400 && e.statusCode < 500, JSON.stringify(extra));
    const ok = await s.checkout.sessions.create(params(c.id, { expires_at: Math.floor(Date.now() / 1000) + 35 * 60 }));
    assert.match(ok.id, /^cs_test_[A-Za-z0-9]+$/);
    assert.equal(ok.url, `${fake.url}/c/${ok.id}`);
  });

  test('pay: signed webhooks (the SDK verifies them), a subscription, an invoice with tax, the redirect', async () => {
    const s = stripe();
    const c = await s.customers.create({ email: 'pay@example.com' });
    const cs = await s.checkout.sessions.create(params(c.id));
    got.length = 0;
    const r = await fake.pay(cs.id);
    assert.equal(r.redirect, `http://app/account?checkout=${cs.id}`);
    assert.ok(got.every((g) => g.ok && g.pretty), 'every delivery verifies and is pretty-printed JSON like Stripe');
    assert.deepEqual(got.map((g) => g.type), ['customer.updated', 'customer.subscription.created', 'invoice.created', 'invoice.finalized', 'invoice.paid', 'invoice.payment_succeeded', 'checkout.session.completed']);
    const done = await s.checkout.sessions.retrieve(cs.id, { expand: ['subscription.latest_invoice'] });
    assert.deepEqual([done.status, done.payment_status, done.subscription.status, done.subscription.latest_invoice.amount_paid, done.total_details.amount_tax], ['complete', 'paid', 'active', 635, 36]);
    assert.equal(done.subscription.latest_invoice.parent.subscription_details.subscription, done.subscription.id, 'dahlia: the invoice names its subscription under parent');
    assert.ok(done.subscription.items.data[0].current_period_end > done.subscription.items.data[0].current_period_start, 'dahlia: the period is on the item');
    assert.equal(done.subscription.current_period_end, undefined);
  });

  test('declined, 3-D Secure (incomplete, then approved), and a non-US address pays no tax', async () => {
    const s = stripe();
    const c = await s.customers.create({ email: 'three@example.com' });
    const cs = await s.checkout.sessions.create(params(c.id));
    assert.equal((await fake.pay(cs.id, { outcome: 'decline' })).status, 'declined');
    assert.equal((await s.checkout.sessions.retrieve(cs.id)).status, 'open');
    got.length = 0;
    assert.equal((await fake.pay(cs.id, { outcome: '3ds' })).status, 'requires_action');
    const subs = await s.subscriptions.list({ customer: c.id, status: 'all' });
    assert.equal(subs.data[0].status, 'incomplete');
    assert.equal((await fake.pay(cs.id, { outcome: 'approve' })).status, 'complete');
    assert.equal((await s.subscriptions.retrieve(subs.data[0].id)).status, 'active');
    const c2 = await s.customers.create({ email: 'ca@example.com' });
    const cs2 = await s.checkout.sessions.create(params(c2.id));
    await fake.pay(cs2.id, { country: 'CA' });
    const d2 = await s.checkout.sessions.retrieve(cs2.id);
    assert.deepEqual([d2.customer_details.address.country, d2.amount_total, d2.total_details.amount_tax], ['CA', 599, 0]);
  });

  test('the clock: a trial ends and is paid; a failing card goes past_due, is retried, then cancelled', async () => {
    const s = stripe();
    const c = await s.customers.create({ email: 'clock@example.com' });
    const cs = await s.checkout.sessions.create(params(c.id, { subscription_data: { trial_period_days: 7 } }));
    await fake.pay(cs.id);
    const subId = (await s.checkout.sessions.retrieve(cs.id)).subscription;
    const trialInv = (await s.subscriptions.retrieve(subId, { expand: ['latest_invoice'] })).latest_invoice;
    assert.deepEqual([trialInv.amount_paid, trialInv.status], [0, 'paid'], 'the trial invoice is $0');
    const mine = () => got.filter((g) => g.customer === c.id).map((g) => g.type);
    got.length = 0;
    await fake.advance(8);
    const sub = await s.subscriptions.retrieve(subId, { expand: ['latest_invoice'] });
    assert.deepEqual([sub.status, sub.latest_invoice.amount_paid, sub.latest_invoice.billing_reason], ['active', 635, 'subscription_cycle']);
    assert.deepEqual(mine(), ['invoice.created', 'invoice.finalized', 'invoice.paid', 'invoice.payment_succeeded', 'customer.subscription.updated']);
    fake.card(c.id, 'fail');
    got.length = 0;
    await fake.advance(31);
    assert.equal((await s.subscriptions.retrieve(subId)).status, 'past_due');
    assert.deepEqual(mine(), ['invoice.created', 'invoice.finalized', 'invoice.payment_failed', 'customer.subscription.updated']);
    got.length = 0;
    await fake.advance(8);
    assert.equal((await s.subscriptions.retrieve(subId)).status, 'canceled');
    assert.deepEqual(mine(), ['invoice.payment_failed', 'invoice.payment_failed', 'invoice.payment_failed', 'customer.subscription.deleted']);
  });

  test('the Portal: cancel at period end ends the plan at the period end; update card pays a past-due invoice', async () => {
    const s = stripe();
    const c = await s.customers.create({ email: 'portal@example.com' });
    const cs = await s.checkout.sessions.create(params(c.id));
    await fake.pay(cs.id);
    const subId = (await s.checkout.sessions.retrieve(cs.id)).subscription;
    const ps = await s.billingPortal.sessions.create({ customer: c.id, return_url: 'http://app/account?portal=1' });
    assert.equal(ps.url, `${fake.url}/p/${ps.id}`);
    const page = await (await fetch(ps.url)).text();
    assert.match(page, /Cancel at period end/);
    const post = await fetch(ps.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=cancel_at_period_end' });
    assert.equal(post.status, 200);
    await fake.idle();
    assert.equal((await s.subscriptions.retrieve(subId)).cancel_at_period_end, true);
    await fake.portal(ps.url, 'resume');
    assert.equal((await s.subscriptions.retrieve(subId)).cancel_at_period_end, false);
    await fake.portal(ps.id, 'card_fails');
    await fake.advance(32);
    assert.equal((await s.subscriptions.retrieve(subId)).status, 'past_due');
    await fake.portal(ps.id, 'update_card');
    assert.equal((await s.subscriptions.retrieve(subId)).status, 'active');
    await fake.portal(ps.id, 'cancel_at_period_end');
    await fake.advance(32);
    assert.equal((await s.subscriptions.retrieve(subId)).status, 'canceled');
  });

  test('hosted Checkout page: the buttons, the country menu, and the redirect after Pay', async () => {
    const s = stripe();
    const c = await s.customers.create({ email: 'page@example.com' });
    const cs = await s.checkout.sessions.create(params(c.id));
    const html = await (await fetch(cs.url)).text();
    for (const b of ['Pay (4242)', 'Declined', 'Needs 3-D Secure', '<select name="country"', 'value="US" selected']) assert.ok(html.includes(b), b);
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|app\/)/.test(html), 'nothing from other sites');
    const r = await fetch(cs.url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=ok&country=US' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `http://app/account?checkout=${cs.id}`);
    await fake.idle();
  });

  test('delivery modes: duplicate, reverse, delay, drop (then redeliver), and retries on non-2xx', async () => {
    const s = stripe();
    const c = await s.customers.create({ email: 'modes@example.com' });
    await fake.idle();
    const types = () => got.map((g) => g.type);
    fake.delivery('duplicate');
    got.length = 0;
    await s.customers.update(c.id, { name: 'A' });
    await fake.idle();
    assert.deepEqual(types(), ['customer.updated', 'customer.updated']);
    assert.equal(got[0].id, got[1].id, 'the same event twice');
    fake.delivery('reverse');
    got.length = 0;
    const cs = await s.checkout.sessions.create(params(c.id));
    await fake.pay(cs.id);
    assert.equal(types()[0], 'checkout.session.completed');
    assert.equal(types().at(-1), 'customer.updated');
    fake.delivery('delay', { delayMs: 150 });
    got.length = 0;
    await s.customers.update(c.id, { name: 'B' });
    await sleep(40);
    assert.equal(got.length, 0, 'not yet');
    await fake.idle();
    assert.deepEqual(types(), ['customer.updated']);
    fake.delivery('drop');
    got.length = 0;
    await s.customers.update(c.id, { name: 'C' });
    await fake.idle();
    assert.equal(got.length, 0);
    const dropped = fake.deliveries().filter((d) => d.status === 'dropped').at(-1);
    await fake.redeliver(dropped.event);
    assert.deepEqual([types(), got[0].id], [['customer.updated'], dropped.event]);
    fake.delivery('normal');
    got.length = 0;
    answers = [500, 503];
    await s.customers.update(c.id, { name: 'D' });
    await fake.idle();
    assert.deepEqual(got.map((g) => g.status), [500, 503, 200], 'retried until a 2xx');
    const tries = fake.deliveries().filter((d) => d.event === got[0].id).map((d) => d.attempt);
    assert.deepEqual(tries, [1, 2, 3]);
  });

  test('an outage (failNext): the SDK retries, then gives up with a Stripe error', async () => {
    const s = stripe();
    fake.failNext(1, { status: 500 });
    const c = await s.customers.create({ email: 'retry@example.com' }); // 500, then the SDK's retry succeeds
    assert.match(c.id, /^cus_/);
    fake.failNext(3, { status: 503 });
    await assert.rejects(s.customers.create({ email: 'fail@example.com' }), (e) => e.statusCode === 503);
  });

  test('also a program: node tools/stripe-fake/server.mjs prints the variables', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [path.join(ROOT, 'tools/stripe-fake/server.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no output')), 10000);
      child.stdout.on('data', (d) => {
        out += d;
        if (/STRIPE_PRICE_ID=price_/.test(out)) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    child.kill('SIGTERM');
    assert.match(out, /STRIPE_API_BASE=http:\/\/127\.0\.0\.1:\d+/);
    assert.match(out, /STRIPE_WEBHOOK_SECRET=whsec_/);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the Stripe client (server/stripe.mjs, §6.1)', () => {
  test('pinned API version, 2 retries, 10 s, no telemetry; STRIPE_API_BASE → the fake', () => {
    assert.equal(STRIPE_API_VERSION, '2026-08-26.dahlia');
    assert.deepEqual(stripeOptions({}), { apiVersion: '2026-08-26.dahlia', maxNetworkRetries: 2, timeout: 10000, telemetry: false });
    assert.deepEqual(stripeOptions({ stripeApiBase: 'http://127.0.0.1:12111' }), { apiVersion: '2026-08-26.dahlia', maxNetworkRetries: 2, timeout: 10000, telemetry: false, protocol: 'http', host: '127.0.0.1', port: 12111 });
    const s = createStripe({ stripeSecretKey: 'rk_test_abc', stripeApiBase: 'http://127.0.0.1:12111' });
    assert.deepEqual([s.getApiField('version'), s.getApiField('host'), s.getApiField('protocol'), s.getApiField('maxNetworkRetries'), s.getApiField('timeout')], ['2026-08-26.dahlia', '127.0.0.1', 'http', 2, 10000]);
    assert.equal(createStripe({ stripeSecretKey: 'sk_test_abc' }).getApiField('host'), 'api.stripe.com');
    assert.throws(() => createStripe({}), /STRIPE_SECRET_KEY/);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the shape contract (§12.4)', () => {
  test('shapePaths: key paths only, arrays as []; hasPath', () => {
    const p = shapePaths({ a: { b: 1, c: [{ d: 'x' }, { e: null }] }, f: [], g: {} });
    assert.deepEqual(p, ['a.b', 'a.c[].d', 'a.c[].e', 'f[]', 'g']);
    assert.ok(hasPath(p, 'a.c[].d') && hasPath(p, 'a') && hasPath(p, 'a.c') && !hasPath(p, 'a.x'));
  });
  test('every handled event type has a fixture, and every fixture has every path billing.mjs reads', () => {
    const have = new Set(FIXTURE_NAMES.map((n) => readFixture(n).type));
    for (const t of HANDLED_EVENTS) assert.ok(have.has(t), 'a fixture for ' + t);
    for (const n of FIXTURE_NAMES) {
      const ev = readFixture(n);
      const paths = shapePaths(ev);
      for (const want of READ_PATHS[ev.type] || []) assert.ok(hasPath(paths, want), `${n}: ${want}`);
      assert.equal(ev.api_version, STRIPE_API_VERSION, n);
    }
  });
  test('the committed fixtures have the shapes the fake makes today (run make-fixtures.mjs after changing the fake)', () => {
    const { fixtures, runT0 } = makeFixtures();
    const fresh = normalize({ fixtures }, runT0).fixtures;
    assert.deepEqual(Object.keys(fresh).sort(), FIXTURE_NAMES);
    for (const n of FIXTURE_NAMES) assert.deepEqual(shapePaths(readFixture(n)), shapePaths(fresh[n]), n);
  });
  test('real-shapes.txt (after the dad\'s test purchase with SW_STRIPE_SHAPES=1) has every path billing.mjs reads', (t) => {
    const file = path.join(FIXTURE_DIR, 'real-shapes.txt');
    if (!existsSync(file)) {
      t.skip('no real-shapes.txt yet (§14 step 8)');
      return;
    }
    const byType = new Map();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /stripe-shape (\S+) (.*)$/.exec(line.trim());
      if (!m) continue;
      const set = byType.get(m[1]) || new Set();
      for (const p of m[2].split(' ')) set.add(p);
      byType.set(m[1], set);
    }
    for (const [type, set] of byType) for (const want of READ_PATHS[type] || []) assert.ok(hasPath(set, want), `real ${type}: ${want}`);
  });
  test('invoiceSubscriptionId and subscriptionRow read both field locations', () => {
    assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_new' } }, subscription: 'sub_old' }), 'sub_new');
    assert.equal(invoiceSubscriptionId({ subscription: 'sub_old' }), 'sub_old');
    assert.equal(invoiceSubscriptionId({ parent: null }), null);
    const r = subscriptionRow({ id: 'sub_1', customer: { id: 'cus_1' }, status: 'active', created: 100, current_period_end: 2000, items: { data: [{ price: { id: 'price_1' }, current_period_end: 3000 }] } });
    assert.deepEqual([r.customer, r.priceId, r.periodEnd.getTime(), r.cancelAtPeriodEnd], ['cus_1', 'price_1', 3000e3, false]);
    assert.equal(subscriptionRow({ id: 's', status: 'active', current_period_end: 2000, items: { data: [{}] } }).periodEnd.getTime(), 2000e3, 'top-level only as a fallback');
    assert.equal(subscriptionRow({ id: 's', status: 'active', cancel_at: 2000, items: { data: [{ current_period_end: 2000 }] } }).cancelAtPeriodEnd, true, 'cancel_at at the period end reads as cancelling');
  });
});

// ---------------------------------------------------------------------------------------------
// The app with billing (the default plan: no trial, SW_TRIAL_DAYS=0)

describe('billing through the app and the fake (§6, SW_TRIAL_DAYS=0)', () => {
  let fake;
  let A;
  before(async () => {
    fake = await startStripeFake({ retryDelays: [30, 60, 120, 250], delayMs: 200 });
    A = await startApp(fake);
  });
  after(async () => {
    await A?.close();
    await fake?.close();
  });
  beforeEach(async () => {
    fake.delivery('normal');
    A.accounts.ctx.limits = NO_LIMITS;
    await fake.idle(); // webhooks still on their way from the last test finish before the tables are emptied
    await A.t.reset();
    A.billing.invalidate();
  });

  test('who may start a plan: signed in parent, verified email, agreed notice, the US box (§6.2, §4.8)', async () => {
    const f = await makeFamily(A.db);
    const posts = fake.requests((x) => x.method !== 'GET').length;
    assert.deepEqual([(await A.call('POST', '/api/billing/checkout', { body: { usResident: true } })).status], [401]);
    const dev = await A.call('POST', '/api/billing/checkout', { token: tok(f, 'plain', 'device'), body: { usResident: true } });
    assert.deepEqual([dev.status, dev.data], [403, { error: 'forbidden' }]);
    const noConsent = await makeFamily(A.db, { consent: false });
    assert.deepEqual((await A.call('POST', '/api/billing/checkout', { token: tok(noConsent), body: { usResident: true } })).data, { error: 'consent_required' });
    const unverified = await makeFamily(A.db, { verifiedEmail: false });
    assert.equal((await A.call('POST', '/api/billing/checkout', { token: tok(unverified), body: { usResident: true } })).status, 403);
    for (const body of [{}, { usResident: false }, { usResident: 'true' }]) {
      const r = await A.call('POST', '/api/billing/checkout', { token: tok(f), body });
      assert.deepEqual([r.status, r.data], [400, { error: 'us_only' }]);
    }
    const csrf = await A.call('POST', '/api/billing/checkout', { token: tok(f), body: { usResident: true }, headers: { origin: 'https://evil.example' } });
    assert.equal(csrf.status, 403);
    assert.equal(fake.requests((x) => x.method !== 'GET').length, posts, 'none of these reached Stripe');
  });

  test('Checkout: the customer once (email and family id only), exactly the §6.2 parameters, no trial by default', async () => {
    const f = await makeFamily(A.db);
    const before = fake.requests().length;
    const r = await A.call('POST', '/api/billing/checkout', { token: tok(f), body: { trial: true, usResident: true } });
    assert.equal(r.status, 200);
    assert.match(r.data.url, new RegExp(`^${fake.url}/c/cs_test_`));
    const reqs = fake.requests().slice(before);
    const cust = reqs.find((x) => x.method === 'POST' && x.path === '/v1/customers');
    assert.deepEqual(cust.params, { email: f.email, metadata: { family_id: f.id } }, 'never any child data');
    assert.equal(cust.idempotencyKey, 'cust-' + f.id);
    const co = reqs.find((x) => x.method === 'POST' && x.path === '/v1/checkout/sessions');
    assert.match(co.idempotencyKey, new RegExp(`^co-${f.id}-[A-Za-z0-9_-]+$`));
    const p = co.params;
    const row = await famRow(A.db, f.id);
    assert.equal(p.customer, row.stripe_customer_id);
    const exp = Number(p.expires_at) - Math.floor(A.clock.now() / 1000);
    assert.ok(exp > 34 * 60 && exp <= 35 * 60, 'expires in 35 minutes');
    delete p.expires_at;
    assert.deepEqual(p, {
      mode: 'subscription', customer: row.stripe_customer_id, client_reference_id: f.id,
      line_items: [{ price: fake.priceId, quantity: '1' }],
      subscription_data: { metadata: { family_id: f.id } }, // SW_TRIAL_DAYS=0: no trial even when asked
      payment_method_collection: 'always', payment_method_types: ['card'], automatic_tax: { enabled: 'true' },
      customer_update: { address: 'auto', name: 'auto' }, billing_address_collection: 'required',
      consent_collection: { terms_of_service: 'required' },
      custom_text: { terms_of_service_acceptance: { message: renewalSentence(A.cfg) } },
      allow_promotion_codes: 'false', locale: 'en',
      success_url: ORIGIN + '/account?checkout={CHECKOUT_SESSION_ID}', cancel_url: ORIGIN + '/account?checkout=cancel',
    });
    assert.equal(reqs.find((x) => x.path === '/v1/checkout/sessions').stripeVersion, STRIPE_API_VERSION);
    // one open Checkout per family, reused while it is under 30 minutes old
    const again = await A.call('POST', '/api/billing/checkout', { token: tok(f), body: { usResident: true } });
    assert.equal(again.data.url, r.data.url);
    assert.equal(fake.requests((x) => x.method === 'POST' && x.path === '/v1/checkout/sessions').filter((x) => x.params.client_reference_id === f.id).length, 1);
    assert.equal(fake.requests((x) => x.method === 'POST' && x.path === '/v1/customers' && x.params.metadata?.family_id === f.id).length, 1, 'the customer is made once');
  });

  test('Pay → webhooks: active, verified consent by card (audit), welcome and friends_ready once each (§6.4, §6.7)', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f);
    const row = await famRow(A.db, f.id);
    assert.ok(row.verified_at instanceof Date, 'the first $5.99 is the verified consent');
    assert.deepEqual([row.verified_method, row.country, row.trial_used], ['card', 'US', false]);
    const subs = await subRows(A.db, f.id);
    assert.equal(subs.length, 1);
    assert.deepEqual([subs[0].status, subs[0].customer_id, subs[0].price_id, subs[0].cancel_at_period_end], ['active', row.stripe_customer_id, fake.priceId, false]);
    assert.ok(subs[0].latest_paid_at instanceof Date && subs[0].current_period_end > new Date(Date.now() + 27 * 86400e3));
    const mail = await outbox(A.db, f.id);
    assert.deepEqual(mail.count, { welcome: 1, friends_ready: 1 });
    assert.ok(mail.rows.every((m) => m.to_email === f.email));
    const welcome = A.mailed.find((m) => m.template === 'welcome' && m.familyId === f.id).data;
    assert.deepEqual([welcome.priceText, welcome.trialEnd, welcome.trialDays], [A.cfg.priceText, null, 0]);
    assert.equal(welcome.periodEnd, subs[0].current_period_end.getTime());
    const audit = (await A.db.query('select action, actor, detail from audit_log where family_id = $1', [f.id])).rows;
    assert.deepEqual(audit.map((a) => [a.action, a.actor, a.detail.method]), [['consent.verified', 'stripe', 'card']]);
    assert.match(audit[0].detail.invoice, /^in_/);
    const e = await A.billing.entitlementFor(f.id);
    assert.deepEqual([e.state, e.entitled, e.consent, e.friendsConsentOk, e.walkieConsentOk], ['active', true, 'verified', true, true]);
    assert.ok(A.familyEvents.includes(f.id), "the 'family' event reaches live sockets (§8.4)");
    assert.equal((await A.db.one("select count(*) as n from stripe_events where processed_at is not null")).n, fake.events().filter((x) => HANDLED_EVENTS.includes(x.type) && JSON.stringify(x).includes(row.stripe_customer_id)).length);
    const flags = row.flags;
    assert.equal(flags.checkout, undefined, 'the open Checkout is forgotten once done');
    const again = await A.call('POST', '/api/billing/checkout', { token: tok(f), body: { usResident: true } });
    assert.deepEqual([again.status, again.data], [409, { error: 'already_subscribed' }]);
  });

  test('the return sync (§6.3): the webhooks never came, "You\'re all set!" anyway; exactly once when they do', async () => {
    const f = await makeFamily(A.db);
    fake.delivery('drop');
    const { sessionId } = await subscribe(A, fake, f);
    const r = await A.call('POST', '/api/billing/sync', { token: tok(f), body: { sessionId } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.plan.state, r.data.plan.entitled, r.data.plan.consent], ['active', true, 'verified']);
    assert.equal(r.data.usOnly, undefined);
    await A.call('POST', '/api/billing/sync', { token: tok(f), body: { sessionId } });
    fake.delivery('normal');
    for (const d of fake.deliveries().filter((x) => x.status === 'dropped')) await fake.redeliver(d.event);
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
    assert.equal((await A.db.one("select count(*) as n from audit_log where family_id = $1 and action = 'consent.verified'", [f.id])).n, 1);
    // someone else's session, a made-up one, a malformed one
    const other = await makeFamily(A.db);
    assert.deepEqual((await A.call('POST', '/api/billing/sync', { token: tok(other), body: { sessionId } })).data, { error: 'not_found' });
    assert.equal((await A.call('POST', '/api/billing/sync', { token: tok(other), body: { sessionId: 'cs_test_doesnotexist' } })).status, 404);
    assert.equal((await A.call('POST', '/api/billing/sync', { token: tok(other), body: { sessionId: 'https://evil/x' } })).status, 400);
    const none = await A.call('POST', '/api/billing/sync', { token: tok(other), body: {} });
    assert.deepEqual([none.status, none.data.plan.state], [200, 'none']);
  });

  test('the Portal (§6.3): needs the email check; cancel at period end → sync without a session id → "Ends …"', async () => {
    const f = await makeFamily(A.db);
    const noCustomer = await A.call('POST', '/api/billing/portal', { token: tok(f, 'check') });
    assert.deepEqual([noCustomer.status, noCustomer.data], [404, { error: 'not_found' }]);
    await subscribe(A, fake, f);
    const plain = await A.call('POST', '/api/billing/portal', { token: tok(f) });
    assert.deepEqual([plain.status, plain.data], [403, { error: 'check_required' }]);
    const r = await A.call('POST', '/api/billing/portal', { token: tok(f, 'check') });
    assert.equal(r.status, 200);
    assert.match(r.data.url, new RegExp(`^${fake.url}/p/bps_`));
    const req = fake.requests((x) => x.path === '/v1/billing_portal/sessions').at(-1);
    assert.deepEqual(req.params, { customer: (await famRow(A.db, f.id)).stripe_customer_id, return_url: ORIGIN + '/account?portal=1' });
    fake.delivery('drop');
    await fake.portal(r.data.url, 'cancel_at_period_end');
    const s = await A.call('POST', '/api/billing/sync', { token: tok(f) });
    assert.deepEqual([s.data.plan.state, s.data.plan.cancelAtPeriodEnd, s.data.plan.until], ['canceling', true, s.data.plan.periodEnd]);
    fake.delivery('normal');
    await fake.portal(r.data.url, 'resume');
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'active');
  });

  test('non-US billing address: cancelled at once, us_only email, refund_due for the paid invoice, never verified (§6.8)', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f, { country: 'CA' });
    const row = await famRow(A.db, f.id);
    assert.deepEqual([row.country, row.verified_at, row.flags.refund_due, typeof row.flags.us_only], ['CA', null, true, 'string']);
    const subs = await subRows(A.db, f.id);
    assert.equal(subs[0].status, 'canceled');
    assert.equal(fake.state().subscriptions.find((x) => x.id === subs[0].id).status, 'canceled');
    assert.deepEqual((await outbox(A.db, f.id)).count, { us_only: 1 });
    assert.deepEqual(A.mailed.find((m) => m.familyId === f.id).data, { refundDue: true });
    assert.equal((await A.billing.entitlementFor(f.id)).entitled, false);
    // and the sync says so too
    const f2 = await makeFamily(A.db);
    fake.delivery('drop');
    const { sessionId } = await subscribe(A, fake, f2, { country: 'GB' });
    const r = await A.call('POST', '/api/billing/sync', { token: tok(f2), body: { sessionId } });
    assert.deepEqual([r.data.usOnly, r.data.plan.entitled, r.data.plan.consent], [true, false, 'email_plus']);
    assert.deepEqual((await outbox(A.db, f2.id)).count, { us_only: 1 });
  });

  test('duplicate delivery: every event twice → handled once, one email of each kind (§6.4 step 2)', async () => {
    const f = await makeFamily(A.db);
    fake.delivery('duplicate');
    await subscribe(A, fake, f);
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
    const st = A.billing.stats();
    assert.ok(st.webhooksDuplicate >= 3, 'the second copies were recognised');
    const n = (await A.db.one('select count(*) as n, count(distinct id) as d from stripe_events')).n;
    assert.equal(n, (await A.db.one('select count(distinct id) as d from stripe_events')).d);
  });

  test('reversed order: the final mirror row is what Stripe has (the payload order is not trusted)', async () => {
    const f = await makeFamily(A.db);
    fake.delivery('reverse');
    await subscribe(A, fake, f);
    const cust = (await famRow(A.db, f.id)).stripe_customer_id;
    const portal = await A.call('POST', '/api/billing/portal', { token: tok(f, 'check') });
    await fake.portal(portal.data.url, 'card_fails');
    await fake.advance(32); // renewal fails: invoice.* and subscription.updated arrive newest first
    const theirs = fake.state().subscriptions.find((s) => s.customer === cust);
    const ours = (await subRows(A.db, f.id))[0];
    assert.equal(ours.status, 'past_due');
    assert.deepEqual([ours.status, ours.current_period_end.getTime() / 1000, ours.cancel_at_period_end], [theirs.status, theirs.items.data[0].current_period_end, theirs.cancel_at_period_end]);
    assert.ok(ours.first_failed_at instanceof Date, 'grace starts');
    const e = await A.billing.entitlementFor(f.id);
    assert.deepEqual([e.state, e.entitled], ['past_due', true]);
    assert.equal(e.graceUntil, ours.first_failed_at.getTime() + 7 * 86400e3);
    await fake.portal(portal.data.url, 'update_card');
    assert.equal((await subRows(A.db, f.id))[0].first_failed_at, null, 'cleared once active again');
  });

  test('late delivery: the return sync first, the late webhooks after, same result', async () => {
    const f = await makeFamily(A.db);
    fake.delivery('delay', { delayMs: 250 });
    const { sessionId } = await subscribe(A, fake, f, { wait: false });
    const r = await A.call('POST', '/api/billing/sync', { token: tok(f), body: { sessionId } });
    assert.equal(r.data.plan.state, 'active');
    await fake.idle();
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
    assert.equal((await subRows(A.db, f.id))[0].status, 'active');
  });

  test('webhooks Stripe delivers at the same moment, and the return sync, never deadlock and apply once', async () => {
    const fams = [];
    for (let i = 0; i < 4; i++) fams.push(await makeFamily(A.db));
    fake.delivery('drop');
    const sessions = [];
    for (const f of fams) sessions.push((await subscribe(A, fake, f)).sessionId);
    const dropped = new Set(fake.deliveries().filter((d) => d.status === 'dropped').map((d) => d.event));
    const events = fake.events().filter((e) => dropped.has(e.id) && HANDLED_EVENTS.includes(e.type));
    const calls = [
      ...events.map((e) => postEvent(A, fake.webhookSecret, e)),
      ...events.map((e) => postEvent(A, fake.webhookSecret, e)), // and each one twice
      ...fams.map((f, i) => A.call('POST', '/api/billing/sync', { token: tok(f), body: { sessionId: sessions[i] } })),
    ];
    const answers = await Promise.all(calls);
    assert.deepEqual([...new Set(answers.map((a) => a.status))], [200], JSON.stringify(answers.filter((a) => a.status !== 200).map((a) => a.data)));
    for (const f of fams) {
      assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
      assert.equal((await subRows(A.db, f.id))[0].status, 'active');
    }
  });

  test('a handler that throws answers 500; Stripe retries and it works, once (§6.4 step 6)', async () => {
    const f = await makeFamily(A.db);
    const mail = A.accounts.ctx.mail;
    const real = mail.enqueue;
    let boom = 1;
    mail.enqueue = async (...a) => {
      if (boom-- > 0) throw Object.assign(new Error('secret detail'), { name: 'MailDown' });
      return real.apply(mail, a);
    };
    try {
      await subscribe(A, fake, f);
    } finally {
      mail.enqueue = real;
    }
    const statuses = fake.deliveries().filter((d) => d.type === 'checkout.session.completed').slice(-2).map((d) => d.status);
    assert.ok(fake.deliveries().some((d) => d.status === 500), 'one delivery got a 500');
    assert.equal(statuses.at(-1), 200);
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
    assert.ok(A.logs.some((l) => /billing: webhook \S+ failed: MailDown/.test(l)));
    assert.ok(!A.logs.some((l) => l.includes('secret detail')));
  });

  test('signatures (§6.4 step 1): a wrong secret, a 10-minute-old timestamp, a re-serialized body → 400, nothing written', async () => {
    const f = await makeFamily(A.db, { customer: 'cus_Sig' + randomBytes(4).toString('hex') });
    const ev = { ...readFixture('customer.deleted'), id: 'evt_sig' + randomBytes(6).toString('hex') };
    ev.data = { object: { ...ev.data.object, id: f.stripe_customer_id } };
    const before = A.billing.stats().badSignature;
    const wrong = await postEvent(A, 'whsec_wrong', ev);
    assert.deepEqual([wrong.status, wrong.data], [400, { error: 'bad_signature' }]);
    const old = await postEvent(A, fake.webhookSecret, ev, { timestamp: Math.floor(Date.now() / 1000) - 600 });
    assert.equal(old.status, 400);
    const text = JSON.stringify(ev, null, 2);
    const reserialized = await postEvent(A, fake.webhookSecret, ev, { payload: text, body: JSON.stringify(JSON.parse(text)) });
    assert.equal(reserialized.status, 400, 'the raw body is what is verified');
    const noSig = await request(A.base, 'POST', '/api/stripe/webhook', { raw: text, headers: { 'content-type': 'application/json' } });
    assert.equal(noSig.status, 400);
    assert.equal(A.billing.stats().badSignature, before + 4);
    assert.equal((await A.db.one('select count(*) as n from stripe_events')).n, 0);
    assert.equal((await famRow(A.db, f.id)).stripe_customer_id, f.stripe_customer_id, 'nothing changed');
    // the right signature: handled (the Dashboard deleted the customer)
    const ok = await postEvent(A, fake.webhookSecret, ev);
    assert.deepEqual([ok.status, ok.data], [200, { received: true }]);
    assert.equal((await famRow(A.db, f.id)).stripe_customer_id, null);
    // the webhook needs no CSRF headers and no session, but other methods are not it
    assert.equal((await request(A.base, 'GET', '/api/stripe/webhook')).status, 405);
    // an event type it does not handle: 200, nothing recorded
    const other = await postEvent(A, fake.webhookSecret, { ...ev, id: 'evt_other1', type: 'customer.updated' });
    assert.equal(other.status, 200);
    assert.equal((await A.db.one("select count(*) as n from stripe_events where id = 'evt_other1'")).n, 0);
  });

  test('a chargeback flags the family for the dad; entitlement unchanged (§6.4)', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f);
    await fake.dispute({ customer: (await famRow(A.db, f.id)).stripe_customer_id });
    assert.equal((await famRow(A.db, f.id)).flags.dispute, true);
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'active');
  });

  test('two live plans: the newer is cancelled and flagged (refund_due); no second welcome (§6.4)', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f);
    const row = await famRow(A.db, f.id);
    // a second Checkout made outside the app (say, from the Dashboard) for the same customer
    const s = createStripe({ stripeSecretKey: 'sk_test_dash', stripeApiBase: fake.url });
    const cs = await s.checkout.sessions.create({
      mode: 'subscription', customer: row.stripe_customer_id, client_reference_id: f.id, line_items: [{ price: fake.priceId, quantity: 1 }],
      subscription_data: { metadata: { family_id: f.id } }, payment_method_collection: 'always', automatic_tax: { enabled: true },
      billing_address_collection: 'required', consent_collection: { terms_of_service: 'required' },
      success_url: 'http://x/?c={CHECKOUT_SESSION_ID}', cancel_url: 'http://x/',
    });
    await fake.advanceMs(2000); // a moment later than the first plan
    await fake.pay(cs.id);
    const subs = await subRows(A.db, f.id);
    assert.equal(subs.length, 2);
    assert.deepEqual(subs.map((x) => x.status), ['active', 'canceled'], 'the newer one is cancelled');
    const flags = (await famRow(A.db, f.id)).flags;
    assert.deepEqual([flags.duplicate_sub, flags.refund_due], [subs[1].id, true]);
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'active');
  });

  test('a customer deleted in the Dashboard: cleared, and the next Checkout makes a new one (§6.4)', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f);
    const old = (await famRow(A.db, f.id)).stripe_customer_id;
    await createStripe({ stripeSecretKey: 'sk_test_dash', stripeApiBase: fake.url }).customers.del(old);
    await fake.idle();
    const row = await famRow(A.db, f.id);
    assert.deepEqual([row.stripe_customer_id, row.flags.customer_gen], [null, 1]);
    assert.equal((await subRows(A.db, f.id))[0].status, 'canceled', 'deleting a customer ends its plan');
    const r = await A.call('POST', '/api/billing/checkout', { token: tok(f), body: { usResident: true } });
    assert.equal(r.status, 200);
    const made = fake.requests((x) => x.method === 'POST' && x.path === '/v1/customers').at(-1);
    assert.equal(made.idempotencyKey, `cust-${f.id}-1`);
    assert.notEqual((await famRow(A.db, f.id)).stripe_customer_id, old);
  });

  test('a subscription row is never replaced by an older read (synced_at, §6.4)', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f);
    const [row] = await subRows(A.db, f.id);
    const s = createStripe({ stripeSecretKey: 'sk_test_x', stripeApiBase: fake.url });
    const sub = await s.subscriptions.retrieve(row.id);
    const stale = { ...sub, status: 'past_due' };
    await A.db.tx((q) => A.billing.applySubscription(q, stale, { familyId: f.id, syncedAt: row.synced_at.getTime() - 1000 }));
    assert.equal((await subRows(A.db, f.id))[0].status, 'active', 'the older read was ignored');
    await A.db.tx((q) => A.billing.applySubscription(q, stale, { familyId: f.id, syncedAt: row.synced_at.getTime() + 1000 }));
    assert.equal((await subRows(A.db, f.id))[0].status, 'past_due', 'a newer read wins');
  });

  test('the plan by the clock: failed renewal → grace → cancelled after the retries → lapsed (§6.5)', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f);
    fake.card((await famRow(A.db, f.id)).stripe_customer_id, 'fail');
    await fake.advance(31);
    let e = await A.billing.entitlementFor(f.id);
    assert.deepEqual([e.state, e.entitled], ['past_due', true]);
    await fake.advance(4);
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'past_due');
    await fake.advance(4); // the third retry fails: Stripe cancels
    e = await A.billing.entitlementFor(f.id);
    assert.deepEqual([e.state, e.entitled], ['lapsed', false]);
    assert.equal((await subRows(A.db, f.id))[0].status, 'canceled');
  });

  test('reconcile (§6.6): dropped Checkout webhooks and no return visit; a dropped renewal failure', async () => {
    const f = await makeFamily(A.db);
    fake.delivery('drop');
    await subscribe(A, fake, f);
    assert.equal((await subRows(A.db, f.id)).length, 0);
    let r = await A.reconcile();
    assert.equal(r.sessions, 1);
    assert.equal((await subRows(A.db, f.id))[0].status, 'active');
    assert.ok((await famRow(A.db, f.id)).verified_at, 'verified from the paid invoice the reconcile read');
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
    assert.equal((await famRow(A.db, f.id)).flags.checkout, undefined);
    // the renewal fails and every webhook is lost
    fake.card((await famRow(A.db, f.id)).stripe_customer_id, 'fail');
    await fake.advance(31);
    assert.equal((await subRows(A.db, f.id))[0].status, 'active', 'the mirror does not know yet');
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'active', 'the renewal slack (3 days) covers the late news');
    r = await A.reconcile();
    assert.equal(r.checked, 1);
    const [row] = await subRows(A.db, f.id);
    assert.deepEqual([row.status, row.first_failed_at instanceof Date], ['past_due', true]);
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'past_due');
    assert.match(A.logs.findLast((l) => l.startsWith('billing: reconcile')), /^billing: reconcile subscriptions=1 checkouts=0 failed=0 deletions=0\/0$/);
  });

  test('cancelAndDelete (§3.4 step 1) and the retried deletions of the retention/reconcile job', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f);
    const customer = (await famRow(A.db, f.id)).stripe_customer_id;
    const s = createStripe({ stripeSecretKey: 'sk_test_x', stripeApiBase: fake.url });
    fake.failNext(3, { status: 500, path: '/v1/subscriptions' });
    const bad = await A.billing.cancelAndDelete(customer);
    assert.deepEqual([bad.ok, typeof bad.error], [false, 'string'], 'a Stripe outage never throws');
    // the family row is gone (step 2 happened); the job retries from deleted_families
    await A.db.query('insert into deleted_families (family_id, stripe_customer_id) values ($1, $2)', [f.id, customer]);
    await A.db.query('delete from families where id = $1', [f.id]);
    const r = await A.reconcile();
    assert.deepEqual(r.deletions, { tried: 1, done: 1 });
    assert.ok((await A.db.one('select stripe_done_at from deleted_families where family_id = $1', [f.id])).stripe_done_at instanceof Date);
    const st = fake.state();
    assert.equal(st.customers.find((c) => c.id === customer).deleted, true);
    assert.ok(st.subscriptions.filter((x) => x.customer === customer).every((x) => x.status === 'canceled'));
    const cancel = fake.requests((x) => x.method === 'DELETE' && x.path.startsWith('/v1/subscriptions/')).at(-1);
    assert.deepEqual(cancel.params, { invoice_now: 'false', prorate: 'false' });
    assert.deepEqual(await A.billing.cancelAndDelete(customer), { ok: true }, 'already deleted is fine');
    assert.deepEqual(await A.billing.cancelAndDelete({ stripe_customer_id: null }), { ok: true, skipped: true });
    assert.equal((await s.customers.retrieve(customer)).deleted, true);
  });

  test('lapse (§6.6): lapsed_at and purge_after on a lapse, cleared (and audited) when the plan comes back', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f);
    const portal = await A.call('POST', '/api/billing/portal', { token: tok(f, 'check') });
    await fake.portal(portal.data.url, 'cancel_now');
    const now = A.clock.now();
    let r = await A.lapse();
    assert.deepEqual(r, { lapsed: 1, resumed: 0 });
    let row = await famRow(A.db, f.id);
    assert.ok(Math.abs(row.purge_after.getTime() - (row.lapsed_at.getTime() + 90 * 86400e3)) < 5);
    assert.ok(Math.abs(row.lapsed_at.getTime() - now) < 5000);
    assert.deepEqual(await A.lapse(), { lapsed: 0, resumed: 0 }, 'once');
    await A.db.query("update families set comp_until = $2, flags = flags || '{\"warned30\":true}' where id = $1", [f.id, new Date(now + 30 * 86400e3)]);
    r = await A.lapse();
    assert.deepEqual(r, { lapsed: 0, resumed: 1 });
    row = await famRow(A.db, f.id);
    assert.deepEqual([row.lapsed_at, row.purge_after, row.flags.warned30], [null, null, undefined]);
    const audit = (await A.db.query('select action, actor from audit_log where family_id = $1 order by id', [f.id])).rows.map((a) => `${a.action}/${a.actor}`);
    assert.deepEqual(audit.slice(-2), ['plan.lapsed/system', 'plan.resumed/system']);
    const never = await makeFamily(A.db);
    await A.lapse();
    assert.equal((await famRow(A.db, never.id)).lapsed_at, null, 'a family that never had a plan does not lapse');
  });

  test('entitlementFor: cached 60 s, invalidate() clears it, a moved clock or a passed "until" recomputes', async () => {
    const f = await makeFamily(A.db);
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'none');
    await A.db.query("insert into subscriptions (id, family_id, customer_id, status, current_period_end, synced_at) values ('sub_cache1', $1, 'cus_x', 'active', $2, $3)", [f.id, new Date(A.clock.now() + 86400e3), new Date(A.clock.now())]);
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'none', 'cached');
    A.billing.invalidate(f.id);
    const e = await A.billing.entitlementFor(f.id);
    assert.equal(e.state, 'active');
    await A.db.query("update subscriptions set status = 'canceled' where id = 'sub_cache1'");
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'active', 'cached');
    const offset = A.clock.offsetMs;
    A.clock.set(offset + 1000);
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'lapsed', 'the test clock moved: recomputed');
    A.clock.set(offset);
    assert.equal((await A.billing.entitlementFor('not-a-uuid')).state, 'none');
  });

  test('Stripe down: 502 stripe_unavailable (after the SDK\'s 2 retries), logged by name only', async () => {
    const f = await makeFamily(A.db);
    fake.failNext(3, { status: 500, path: '/v1/customers' });
    const r = await A.call('POST', '/api/billing/checkout', { token: tok(f), body: { usResident: true } });
    assert.deepEqual([r.status, r.data], [502, { error: 'stripe_unavailable' }]);
    assert.equal(fake.requests((x) => x.path === '/v1/customers' && x.status === 500).length >= 3, true);
    assert.ok(A.logs.includes('billing: stripe StripeAPIError'));
  });

  test('rate limits: 5 Checkouts per family per hour (§4.8)', async () => {
    A.accounts.ctx.limits = new Limits();
    const f = await makeFamily(A.db);
    for (let i = 0; i < 5; i++) assert.equal((await A.call('POST', '/api/billing/checkout', { token: tok(f), body: { usResident: true } })).status, 200);
    const r = await A.call('POST', '/api/billing/checkout', { token: tok(f), body: { usResident: true } });
    assert.deepEqual([r.status, r.data], [429, { error: 'rate' }]);
    assert.ok(Number(r.headers['retry-after']) >= 1);
  });

  test('log spy: nothing personal or secret in any billing log line (§12.7)', () => {
    assert.ok(A.logs.length > 0);
    for (const l of A.logs) {
      assert.ok(!EMAIL_RE.test(l), 'no email: ' + l);
      assert.ok(!/whsec_|sk_test_|rk_test_|cs_test_[A-Za-z0-9]{10}|127\.0\.0\.1/.test(l), 'no secret, session id or address: ' + l);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('billing with a free week (SW_TRIAL_DAYS=7, §6.7)', () => {
  let fake;
  let A;
  before(async () => {
    fake = await startStripeFake({ retryDelays: [30, 60, 120] });
    A = await startApp(fake, { SW_TRIAL_DAYS: '7' });
  });
  after(async () => {
    await A?.close();
    await fake?.close();
  });
  beforeEach(async () => {
    fake.delivery('normal');
    await fake.idle();
    await A.t.reset();
    A.billing.invalidate();
  });

  test('the trial: 7 days, the renewal sentence says so, the $0 invoice is NOT verified consent, one trial per family', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f, { trial: true });
    const co = fake.requests((x) => x.method === 'POST' && x.path === '/v1/checkout/sessions').at(-1).params;
    assert.deepEqual(co.subscription_data, { metadata: { family_id: f.id }, trial_period_days: '7' });
    assert.match(co.custom_text.terms_of_service_acceptance.message, /After the free week, my Family Plan renews every month at \$5\.99 plus tax/);
    const row = await famRow(A.db, f.id);
    assert.deepEqual([row.trial_used, row.verified_at], [true, null], 'a $0 sign-up is not a monetary transaction');
    const e = await A.billing.entitlementFor(f.id);
    assert.deepEqual([e.state, e.consent, e.friendsConsentOk, e.walkieConsentOk], ['trialing', 'email_plus', false, false]);
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1 });
    const welcome = A.mailed.find((m) => m.familyId === f.id && m.template === 'welcome').data;
    assert.deepEqual([welcome.trialDays, welcome.trialEnd], [7, e.trialEnd]);
    // a family that used its trial gets none, even when asking
    const g = await makeFamily(A.db, { trialUsed: true });
    await A.call('POST', '/api/billing/checkout', { token: tok(g), body: { trial: true, usResident: true } });
    const p2 = fake.requests((x) => x.method === 'POST' && x.path === '/v1/checkout/sessions').at(-1).params;
    assert.deepEqual(p2.subscription_data, { metadata: { family_id: g.id } });
    assert.match(p2.custom_text.terms_of_service_acceptance.message, /^I agree to the Terms\. My Family Plan/);
    // Start today (trial: false) is a real payment at once
    const h = await makeFamily(A.db);
    await subscribe(A, fake, h, { trial: false });
    assert.ok((await famRow(A.db, h.id)).verified_at, 'Start today: verified at once');
  });

  test('Start now (§6.3): needs the email check; charges at once and records verified consent without waiting for webhooks', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f, { trial: true });
    const plain = await A.call('POST', '/api/billing/start-now', { token: tok(f) });
    assert.deepEqual([plain.status, plain.data], [403, { error: 'check_required' }]);
    fake.delivery('drop');
    const r = await A.call('POST', '/api/billing/start-now', { token: tok(f, 'check') });
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.plan.state, r.data.plan.consent, r.data.plan.friendsConsentOk], ['active', 'verified', true]);
    const upd = fake.requests((x) => x.method === 'POST' && x.path.startsWith('/v1/subscriptions/')).at(-1);
    assert.deepEqual([upd.params, upd.idempotencyKey], [{ trial_end: 'now' }, `startnow-${(await subRows(A.db, f.id))[0].id}`]);
    fake.delivery('normal');
    for (const d of fake.deliveries().filter((x) => x.status === 'dropped')) await fake.redeliver(d.event);
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
    const again = await A.call('POST', '/api/billing/start-now', { token: tok(f, 'check') });
    assert.deepEqual([again.status, again.data], [409, { error: 'conflict' }], 'only while trialing');
    const none = await makeFamily(A.db);
    assert.equal((await A.call('POST', '/api/billing/start-now', { token: tok(none, 'check') })).status, 409);
  });

  test('the trial ends by the clock: the first $5.99 invoice is the verified consent', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f, { trial: true });
    await fake.advance(6);
    assert.equal((await famRow(A.db, f.id)).verified_at, null);
    await fake.advance(2);
    const row = await famRow(A.db, f.id);
    assert.ok(row.verified_at);
    assert.equal((await A.billing.entitlementFor(f.id)).state, 'active');
    assert.deepEqual((await outbox(A.db, f.id)).count, { welcome: 1, friends_ready: 1 });
  });

  test('a declined card at the end of the trial: past_due with grace, not verified', async () => {
    const f = await makeFamily(A.db);
    await subscribe(A, fake, f, { trial: true });
    fake.card((await famRow(A.db, f.id)).stripe_customer_id, 'fail');
    await fake.advance(8);
    const e = await A.billing.entitlementFor(f.id);
    assert.deepEqual([e.state, e.entitled, e.consent], ['past_due', true, 'email_plus']);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the webhook over the fixtures (tools/fixtures/stripe, §12.4)', () => {
  // the real route and signature check; Stripe's side (the re-fetch) answered from subscriptions.json
  const subsAt = existsSync(path.join(FIXTURE_DIR, 'subscriptions.json')) ? JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'subscriptions.json'), 'utf8')) : {};
  const SECRET = 'whsec_fixtures' + randomBytes(8).toString('hex');
  let t;
  let srv;
  let base;
  let current = null; // the fixture whose Stripe state the stub serves
  const canceled = new Set();
  const logs = [];
  let clock;
  const stub = {
    webhooks: Stripe.webhooks,
    subscriptions: {
      async retrieve(id) {
        const s = current && subsAt[current];
        if (!s || s.id !== id) throw Object.assign(new Error('No such subscription'), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });
        const out = JSON.parse(JSON.stringify(s));
        if (canceled.has(id)) Object.assign(out, { status: 'canceled', canceled_at: out.created + 60, ended_at: out.created + 60 });
        return out;
      },
      async cancel(id) {
        canceled.add(id);
        return { id, status: 'canceled' };
      },
    },
    charges: { retrieve: async (id) => ({ id, object: 'charge', customer: 'cus_Fixture0001' }) },
  };
  before(async () => {
    t = await database();
    await t.reset();
    const cfg = loadConfig({ ...BASE_ENV, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_ID: 'price_Fixture0001' });
    clock = { now: () => (1790856000 + 3600) * 1000 }; // an hour after the fixtures' first event
    const ctx = {
      cfg, db: t.db, clock, log: (l) => logs.push(l), events: { emit() {} }, limits: NO_LIMITS, stripe: stub,
      sessions: { fromRequest: async () => null }, family: { load: async () => null },
      audit: async (q, familyId, action, detail = {}, { actor = 'parent', playerId = null } = {}) =>
        q.query('insert into audit_log (family_id, player_id, actor, action, detail) values ($1, $2, $3, $4, $5)', [familyId, playerId, actor, action, JSON.stringify(detail)]),
      mail: { enqueue: async (q, template, to, data = {}, { familyId = null } = {}) => q.query('insert into outbox (family_id, to_email, template, data) values ($1, $2, $3, $4)', [familyId, to, template, JSON.stringify(data)]) },
    };
    ctx.billing = createBilling(ctx);
    const router = createRouter({ cfg, ctx, routes: ctx.billing.routes() });
    srv = http.createServer(async (req, res) => {
      if (!(await router.handle(req, res, new URL(req.url, 'http://x')))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${srv.address().port}`;
    for (const [k, id] of Object.entries(FIXTURE_FAMILIES)) {
      await t.db.query('insert into families (id, email, email_verified_at, consent_at, notice_version) values ($1, $2, now(), now(), 1)', [id, `fixture-${k}@example.com`]);
    }
  });
  after(async () => {
    await new Promise((r) => srv.close(r));
    await t.reset();
  });
  const send = async (name) => {
    current = name;
    const ev = readFixture(name);
    const text = JSON.stringify(ev, null, 2);
    const sig = Stripe.webhooks.generateTestHeaderString({ payload: text, secret: SECRET });
    return request(base, 'POST', '/api/stripe/webhook', { raw: text, headers: { 'content-type': 'application/json', 'stripe-signature': sig } });
  };
  const fam = (k) => t.db.one('select * from families where id = $1', [FIXTURE_FAMILIES[k]]);
  const mails = async (k) => (await outbox(t.db, FIXTURE_FAMILIES[k])).count;
  const sub = (id) => t.db.one('select * from subscriptions where id = $1', [id]);

  test('a paid Checkout, its subscription and invoice, in any order; replays change nothing', async () => {
    for (const n of ['invoice.paid', 'customer.subscription.created', 'checkout.session.completed']) assert.equal((await send(n)).status, 200, n);
    const f = await fam('paid');
    assert.deepEqual([f.stripe_customer_id, f.country, f.verified_method, f.trial_used], ['cus_Fixture0001', 'US', 'card', false]);
    assert.deepEqual(await mails('paid'), { friends_ready: 1, welcome: 1 });
    const s = await sub('sub_Fixture0001');
    assert.deepEqual([s.status, s.family_id, s.price_id], ['active', FIXTURE_FAMILIES.paid, 'price_Fixture0001']);
    assert.ok(s.latest_paid_at instanceof Date);
    for (const n of ['invoice.paid', 'checkout.session.completed']) await send(n);
    assert.deepEqual(await mails('paid'), { friends_ready: 1, welcome: 1 });
  });
  test('a failed renewal: past_due with first_failed_at; a chargeback flag', async () => {
    assert.equal((await send('invoice.payment_failed')).status, 200);
    await send('customer.subscription.updated.past_due');
    const s = await sub('sub_Fixture0001');
    assert.equal(s.status, 'past_due');
    assert.ok(s.first_failed_at instanceof Date);
    await send('charge.dispute.created');
    assert.equal((await fam('paid')).flags.dispute, true);
  });
  test('a free week: trialing, trial_used, the $0 invoice is not consent; cancel at period end, then cancelled', async () => {
    for (const n of ['checkout.session.completed.trial', 'customer.subscription.created.trialing', 'invoice.paid.trial']) assert.equal((await send(n)).status, 200, n);
    const f = await fam('trial');
    assert.deepEqual([f.trial_used, f.verified_at], [true, null]);
    assert.deepEqual(await mails('trial'), { welcome: 1 });
    await send('customer.subscription.updated.canceling');
    assert.equal((await sub('sub_Fixture0002')).cancel_at_period_end, true);
    await send('customer.subscription.deleted');
    assert.equal((await sub('sub_Fixture0002')).status, 'canceled');
  });
  test('outside the US: cancelled through Stripe, us_only, refund_due; then the customer deleted', async () => {
    await send('checkout.session.completed.non-us');
    assert.ok(canceled.has(subsAt['checkout.session.completed.non-us'].id), 'cancelled at Stripe');
    const f = await fam('abroad');
    assert.deepEqual([f.country, f.verified_at, f.flags.refund_due], ['CA', null, true]);
    assert.deepEqual(await mails('abroad'), { us_only: 1 });
    assert.equal((await sub(subsAt['checkout.session.completed.non-us'].id)).status, 'canceled');
    await send('customer.deleted');
    assert.equal((await fam('abroad')).stripe_customer_id, null);
  });
  test('every fixture is recorded once in stripe_events and processed', async () => {
    const r = (await t.db.query('select id, type, processed_at from stripe_events')).rows;
    assert.equal(r.length, FIXTURE_NAMES.length);
    assert.ok(r.every((x) => x.processed_at instanceof Date));
    assert.ok(!logs.some((l) => EMAIL_RE.test(l)));
  });
});

// ---------------------------------------------------------------------------------------------

describe('SW_STRIPE_SHAPES=1: the contract lines (§12.4)', () => {
  test('one stripe-shape line per event: the type and sorted key paths, no values', async () => {
    const fake = await startStripeFake({ retryDelays: [30] });
    const A = await startApp(fake, { SW_STRIPE_SHAPES: '1' });
    try {
      await A.t.reset();
      const f = await makeFamily(A.db);
      await subscribe(A, fake, f);
      const lines = A.logs.filter((l) => l.startsWith('stripe-shape '));
      assert.ok(lines.length >= 5);
      const types = new Set(lines.map((l) => l.split(' ')[1]));
      for (const tp of ['checkout.session.completed', 'customer.subscription.created', 'invoice.paid']) assert.ok(types.has(tp), tp);
      for (const l of lines) {
        assert.ok(!EMAIL_RE.test(l) && !/cus_|sub_|in_[A-Za-z0-9]{10}|San Francisco|94103/.test(l), 'paths only');
        const paths = l.split(' ').slice(2);
        assert.deepEqual(paths, [...paths].sort());
      }
      const inv = lines.find((l) => l.split(' ')[1] === 'invoice.paid').split(' ').slice(2);
      for (const want of READ_PATHS['invoice.paid']) assert.ok(hasPath(inv, want), want);
    } finally {
      await A.close();
      await fake.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('npm run stripe:setup (tools/stripe-setup.mjs, §6.1)', () => {
  let fake;
  before(async () => {
    fake = await startStripeFake({ seed: false });
  });
  after(() => fake?.close());
  const stripe = () => new Stripe('sk_test_setup', stripeOptions({ stripeApiBase: fake.url }));

  test('makes the product, the $5.99 price and the portal configuration; a second run changes nothing', async () => {
    const first = await stripeSetup({ stripe: stripe(), origin: 'https://sparkleworld.example' });
    assert.deepEqual(first.created, ['product', 'price', 'default price', 'portal configuration']);
    const second = await stripeSetup({ stripe: stripe(), origin: 'https://sparkleworld.example' });
    assert.deepEqual([second.priceId, second.productId, second.portalConfigId, second.created], [first.priceId, first.productId, first.portalConfigId, []]);
    const st = fake.state();
    assert.equal(st.products.length, 1);
    assert.equal(st.prices.length, 1);
    const price = st.prices[0];
    assert.deepEqual([price.unit_amount, price.currency, price.recurring.interval, price.tax_behavior, price.lookup_key, price.type], [599, 'usd', 'month', 'exclusive', LOOKUP_KEY, 'recurring']);
    const conf = st.portalConfigurations.find((c) => c.metadata.sw === PORTAL_TAG);
    assert.deepEqual(
      [conf.features.customer_update.enabled, conf.features.invoice_history.enabled, conf.features.payment_method_update.enabled, conf.features.subscription_cancel.enabled, conf.features.subscription_cancel.mode, conf.features.subscription_cancel.cancellation_reason.enabled, conf.features.subscription_update.enabled],
      [false, true, true, true, 'at_period_end', true, false],
    );
    assert.deepEqual([conf.business_profile.privacy_policy_url, conf.business_profile.terms_of_service_url, conf.default_return_url], ['https://sparkleworld.example/privacy', 'https://sparkleworld.example/terms', 'https://sparkleworld.example/account?portal=1']);
  });

  test('puts a drifted portal configuration back; a price that differs stops it (--replace moves the lookup key)', async () => {
    const s = stripe();
    const { portalConfigId } = await stripeSetup({ stripe: s });
    await s.billingPortal.configurations.update(portalConfigId, { features: { subscription_update: { enabled: true } } });
    const fixed = await stripeSetup({ stripe: s });
    assert.match(fixed.created.join(), /portal configuration \(subscription_update\)/);
    assert.equal(fake.state().portalConfigurations.find((c) => c.id === portalConfigId).features.subscription_update.enabled, false);
    // somebody made a $6.99 price and gave it the lookup key
    const prod = fake.state().products[0].id;
    await s.prices.create({ product: prod, currency: 'usd', unit_amount: 699, recurring: { interval: 'month' }, tax_behavior: 'exclusive', lookup_key: LOOKUP_KEY, transfer_lookup_key: true });
    await assert.rejects(stripeSetup({ stripe: s }), (e) => e.code === 'price_differs' && /amount 699/.test(e.message));
    const replaced = await stripeSetup({ stripe: s, replace: true });
    assert.ok(replaced.created.includes('price'));
    const withKey = fake.state().prices.filter((p) => p.lookup_key === LOOKUP_KEY);
    assert.deepEqual(withKey.map((p) => p.unit_amount), [599]);
  });

  test('as a program: prints STRIPE_PRICE_ID and STRIPE_PORTAL_CONFIG; refuses a restricted key', async () => {
    const env = { ...process.env, STRIPE_SECRET_KEY: 'sk_test_setupCli', STRIPE_API_BASE: fake.url, PUBLIC_ORIGIN: 'https://sparkleworld.example' };
    const { stdout } = await run(process.execPath, [path.join(ROOT, 'tools/stripe-setup.mjs')], { env });
    assert.match(stdout, /STRIPE_PRICE_ID=price_[A-Za-z0-9]+/);
    assert.match(stdout, /STRIPE_PORTAL_CONFIG=bpc_[A-Za-z0-9]+/);
    assert.match(stdout, /everything was already there; nothing changed/);
    await assert.rejects(run(process.execPath, [path.join(ROOT, 'tools/stripe-setup.mjs')], { env: { ...env, STRIPE_SECRET_KEY: 'rk_test_abc' } }), (e) => /full secret key/.test(e.stderr));
  });
});
