// Accounts composition root (docs/ACCOUNTS.md §1.3, §15.2): what server.mjs calls when
// SW_ACCOUNTS is optional or required. server.mjs imports this file ONLY then (dynamically), so
// with accounts off neither `pg` nor `stripe` is ever loaded.
//
//   const accounts = await createAccounts(cfg, { log, clock, db })
//   → { mode, friendsMode,
//       handleHttp(req, res, url) → Promise<boolean>,   // every /api/* except /api/net, /api/stats
//       health() → Promise<{ ok, db, migrations }>,
//       netInfo() → { accounts: mode, friendsMode },
//       authorizeSocket({ cookie, playerId }) → Promise<{ ok, claims?, code? }>,   // §8.1
//       recheck(claims) → Promise<{ ok, claims?, code? }>,                         // §8.4, cached ≤ 60 s
//       events,       // EventEmitter: 'session' {sessionHash}, 'family' {familyId}, 'player' {familyId, playerId}
//       close() → Promise<void>,
//       ctx }         // for tests (ctx.jobs.run(name), ctx.mail.captured, ctx.limits, ...)
//
// `db` is optional (tests pass one from tools/testdb.mjs; otherwise cfg.databaseUrl is opened
// and closed by close()). `clock` defaults to makeClock(): the app clock that every time
// comparison uses (§3.1), moved by POST /api/test/clock. `timers: false` (or `jobs: false`) starts
// no job timers (in-process tests and the admin CLI run jobs with ctx.jobs.run(name)).
//
// The route modules are picked up when their files exist, so each owner adds its own file
// without editing this one (docs/ACCOUNTS.md §15.1):
//   server/auth.mjs       (A) export createSessions(ctx) → { fromRequest(req, now) → session|null (may throw
//                             HttpError 410 family_gone), fromCookie(cookieHeader, now), … }; export routes(ctx)
//   server/family.mjs     (A) export createFamily(ctx) → { load(familyId), player(pid), … }; export routes(ctx)
//   server/audit.mjs      (A) export audit(q, familyId, action, detail, { actor, playerId })
//   server/mail.mjs       (A) export createMail(ctx) → { enqueue(q, template, to, data, { familyId, sendAfter }) }
//   server/jobs.mjs       (A) export startJobs(ctx) → { stop() }
//   server/test-hooks.mjs (A) export routes(ctx)       (mounted only with SW_TEST=1)
//   server/stripe.mjs     (B) export createStripe(cfg) → the Stripe client (ctx.stripe)
//   server/billing.mjs    (B) export createBilling(ctx) → { entitlementFor, invalidate, reconcile,
//                             cancelAndDelete }; export routes(ctx)
//   server/saves.mjs      (C) export routes(ctx)
// Until a file lands, the small fallbacks below stand in (sessions: nobody is signed in;
// billing: entitlementOf over the database rows; mail: a plain outbox insert; audit: a plain
// insert). A owns this file and replaces the fallbacks as the real modules land.

import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { migrate, migrationStatus } from './migrate.mjs';
import { createRouter, cookieOf, isUuid } from './http.mjs';
import { Limits } from './limits.mjs';
import { entitlementOf } from './entitlement.mjs';
import { createFreePass } from './freepass.mjs';

/** The app clock: real time plus an offset the tests can move. */
export function makeClock(base = Date.now) {
  let offset = 0;
  return {
    now: () => base() + offset,
    get offsetMs() {
      return offset;
    },
    set(offsetMs) {
      offset = Number(offsetMs) || 0;
    },
  };
}

async function optionalModule(file) {
  const url = new URL(file, import.meta.url);
  return existsSync(fileURLToPath(url)) ? import(url.href) : null;
}

export async function createAccounts(cfg, { log = (...a) => console.log(...a), clock = makeClock(), db = null, timers = true, jobs: jobsOpt = true } = {}) {
  if (jobsOpt === false) timers = false; // `jobs: false` (tools/test-billing.mjs) is the same as `timers: false`
  if (!cfg || cfg.accounts === 'off') throw new Error('createAccounts: accounts are off');
  const ownDb = !db;
  if (!db) db = await openDb(cfg.databaseUrl, { log });
  try {
    await migrate(db, { log });
  } catch (err) {
    if (ownDb) await db.close().catch(() => {});
    throw err;
  }

  const events = new EventEmitter();
  events.setMaxListeners(50);
  const ctx = {
    cfg,
    db,
    clock,
    log,
    events,
    limits: new Limits(), // rate limits run on real time, not the app clock
    stripe: null,
    mail: null,
    audit: null,
    sessions: null,
    family: null,
    billing: null,
    freePass: null,
  };

  const mods = {
    audit: await optionalModule('./audit.mjs'),
    mail: await optionalModule('./mail.mjs'),
    auth: await optionalModule('./auth.mjs'),
    family: await optionalModule('./family.mjs'),
    stripe: await optionalModule('./stripe.mjs'),
    billing: await optionalModule('./billing.mjs'),
    saves: await optionalModule('./saves.mjs'),
    testHooks: cfg.test ? await optionalModule('./test-hooks.mjs') : null,
    jobs: await optionalModule('./jobs.mjs'),
  };

  const auditFn = mods.audit?.audit ?? fallbackAudit;
  // every audit row carries the app clock's time unless the caller gives one
  ctx.audit = (q, familyId, action, detail = {}, opts = {}) => auditFn(q, familyId, action, detail, { at: clock.now(), ...opts });
  ctx.mail = mods.mail?.createMail ? await mods.mail.createMail(ctx) : fallbackMail();
  ctx.family = mods.family?.createFamily ? await mods.family.createFamily(ctx) : fallbackFamily(ctx);
  ctx.sessions = mods.auth?.createSessions ? await mods.auth.createSessions(ctx) : fallbackSessions();
  ctx.stripe = mods.stripe?.createStripe ? await mods.stripe.createStripe(cfg) : null;
  ctx.billing = mods.billing?.createBilling ? await mods.billing.createBilling(ctx) : fallbackBilling(ctx);

  // SW_FREE_PASS (§6.9): the listed families get their free pass now (and at sign-in); a pass
  // the list set for an address no longer listed ends. Counts only in the log.
  ctx.freePass = createFreePass(ctx);
  try {
    const fp = await ctx.freePass.sync();
    if (ctx.freePass.list.length || fp.ended) log(`free passes: ${ctx.freePass.list.length} listed, ${fp.set} set, ${fp.ended} ended, ${fp.consent} consent recorded`);
  } catch (err) {
    // never stops the start: the sign-in of a listed family applies it again
    log(`free passes: could not apply (${err && err.code ? err.code : err && err.name ? err.name : 'Error'})`);
  }

  const routes = [];
  for (const name of ['auth', 'family', 'saves', 'billing', 'testHooks']) {
    const m = mods[name];
    if (m?.routes) routes.push(...(await m.routes(ctx)));
  }
  const router = createRouter({ cfg, ctx, routes });
  ctx.routes = router.routes; // the mounted routes (the tests walk them: every check route, every parent route)
  // timers: false (in-process tests, the admin CLI): jobs run only when asked (ctx.jobs.run)
  const jobs = mods.jobs?.startJobs ? await mods.jobs.startJobs(ctx, { timers }) : null;
  ctx.jobs = jobs;

  // ---- the relay's questions (§8.1, §8.4): auth.mjs answers them (claims, caches) ----
  async function authorizeSocket({ cookie, playerId } = {}) {
    if (ctx.sessions.authorizeSocket) return ctx.sessions.authorizeSocket({ cookie, playerId });
    const token = cookieOf(cfg, cookie || '', 'sess');
    if (!token && !playerId && cfg.accounts === 'optional') return { ok: true, claims: null }; // a legacy socket: today's behavior
    if (playerId && !isUuid(playerId)) return { ok: false, code: 'player_gone' };
    return { ok: false, code: 'signed_out' };
  }

  async function recheck(claims) {
    if (ctx.sessions.recheck) return ctx.sessions.recheck(claims);
    return { ok: false, code: 'signed_out' };
  }

  async function health() {
    const dbOk = await db.ping(2000);
    const m = dbOk ? await migrationStatus(db) : { ok: false, current: 0 };
    return { ok: dbOk && m.ok, db: dbOk, migrations: m.current };
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await jobs?.stop?.();
    } catch {}
    if (ownDb) await db.close().catch(() => {});
  }

  return {
    mode: cfg.accounts,
    friendsMode: cfg.friendsMode,
    handleHttp: router.handle,
    health,
    netInfo: () => ({ accounts: cfg.accounts, friendsMode: cfg.friendsMode }),
    authorizeSocket,
    recheck,
    events,
    close,
    ctx,
  };
}

// ---------------------------------------------------------------------------------------------
// fallbacks until the real modules land (see the top of this file)

function fallbackSessions() {
  return { fromRequest: async () => null };
}

function fallbackFamily(ctx) {
  return {
    load: (familyId) => (isUuid(familyId) ? ctx.db.one('select * from families where id = $1', [familyId]) : null),
    player: (pid) => (isUuid(pid) ? ctx.db.one('select * from players where id = $1', [pid]) : null),
  };
}

function fallbackMail() {
  return {
    async enqueue(q, template, to, data = {}, { familyId = null, sendAfter = null } = {}) {
      await q.query('insert into outbox (family_id, to_email, template, data, send_after) values ($1, $2, $3, $4, coalesce($5, now()))', [
        familyId, to, template, JSON.stringify(data), sendAfter ? new Date(sendAfter) : null,
      ]);
    },
  };
}

async function fallbackAudit(q, familyId, action, detail = {}, { actor = 'parent', playerId = null } = {}) {
  await q.query('insert into audit_log (family_id, player_id, actor, action, detail) values ($1, $2, $3, $4, $5)', [familyId, playerId, actor, action, JSON.stringify(detail)]);
}

function fallbackBilling(ctx) {
  const cache = new Map(); // familyId -> { at, value }
  return {
    async entitlementFor(familyId) {
      const hit = cache.get(familyId);
      const now = ctx.clock.now();
      if (hit && Date.now() - hit.at < 60000) return hit.value;
      const family = await ctx.db.one('select * from families where id = $1', [familyId]);
      const subs = family ? (await ctx.db.query('select * from subscriptions where family_id = $1', [familyId])).rows : [];
      const value = entitlementOf({ family: family || {}, subs, now, cfg: ctx.cfg });
      cache.set(familyId, { at: Date.now(), value });
      return value;
    },
    invalidate(familyId) {
      if (familyId) cache.delete(familyId);
      else cache.clear();
    },
    async reconcile() {},
    async cancelAndDelete() {},
  };
}
