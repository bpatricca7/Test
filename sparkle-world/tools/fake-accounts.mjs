// A stand-in for server/accounts.mjs (docs/ACCOUNTS.md §15.2) that keeps everything in memory:
// no database, no Stripe, no email. Owner D. Used by
//   - tools/test-net.mjs and tools/test-walkie.mjs (the relay's account rules, §12.6: refusals
//     and close codes, claims, live revocation, the per-family limit, the database-down cache),
//   - tools/site-check.mjs (every state of the Family page, at phone, iPad and computer sizes),
//   - tools/dev-accounts.mjs --fake (designing the Family page without Postgres).
// The real accounts (A), billing (B) and saves (C) replace all of this; the e2e
// (tools/e2e-accounts.mjs) runs against the real ones.
//
//   const fake = createFakeAccounts({ mode, publicOrigin, friendsMode, mpConsent, trialDays })
//   createServer({ accounts: fake })                 // the §15.2 shape: handleHttp, health,
//                                                    // netInfo, authorizeSocket, recheck, events, close
//   const f = fake.addFamily({ plan: 'active', consent: 'verified' })
//   const lily = fake.addPlayer(f, { nickname: 'Lily', friends: true, walkie: true })
//   const s = fake.addSession(f, { kind: 'device' })   // { token, hash, cookie }
//   fake.setPlayer(lily, { walkie: false })            // + the 'player' event, like the real one
//   fake.down = true                                   // the database is down (claims cache)
//
// The HTTP side is the REAL router (server/http.mjs: CSRF, bodies, who may call) over
// in-memory handlers that follow the routes of §5.2 and the answers of §5.3 and §6.5 (the
// plan object is the real entitlementOf()). What only the fake has: /api/fake/* (a pretend
// Stripe Checkout and Portal, and the captured emails for development).

import { EventEmitter } from 'node:events';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRouter, httpError, cookieOf, isUuid } from '../server/http.mjs';
import { loadConfig } from '../server/config.mjs';
import { entitlementOf } from '../server/entitlement.mjs';
import { sanitizeName, isBlocked } from '../src/net/names.js';

const DAY = 24 * 3600 * 1000;
const MIN = 60 * 1000;
const sha = (s) => createHash('sha256').update(s).digest();
const token = () => randomBytes(32).toString('base64url');
const PAIR_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)

/** The direct notice of §11.3 (draft v1), used when B's server/notice.mjs is not in this tree. */
function draftNotice(cfg) {
  const op = cfg.operator || {};
  return [
    { title: 'You gave us your email', text: 'so we can ask your permission and so you can sign in. Children are never asked for an email.' },
    { title: 'With your permission we keep, for each child:', text: 'a nickname you choose (a nickname, please, not a real name), her avatar and its picture, her game progress (stickers, coins, outfits, settings) and her worlds, including names she types for worlds and pets. We use them only to run the game: to save her worlds on our server so they follow her between devices and survive a browser clearing its data.' },
    { title: 'We never collect', text: "children's emails, real names, birthdays, photos, location, contacts or recordings. No ads, no analytics, no trackers." },
    { title: 'Playing with friends and the walkie-talkie are off', text: 'until you switch them on for each child on the Family page. When on, the other children in the same game (only friends the host lets in, whose families also have Sparkle World) see her nickname, avatar and the world, and hear her voice live while she holds the walkie button. Voices are never recorded. You can agree to saving without agreeing to playing with friends. These switches become available once we have confirmed that a grown-up said yes: your first payment does that.' },
    { title: 'Who helps us run it:', text: "Railway (hosting and database). Stripe (your payments) and our email provider (our emails) receive only your email and payment details, never your children's information. We don't sell or share information for advertising." },
    { title: 'How long we keep it:', text: `while your plan is active, and ${cfg.retainDays} days after it ends (so you can come back). When you delete it, it is gone at once, and our backups roll off within 7 days. Details in the Privacy Notice.` },
    { title: 'You can', text: `see, download and delete your children's information and turn any permission off at any time on the Family page, or by writing to ${op.email || 'us'}.` },
    { title: "If you don't finish", text: 'setting up within 14 days, we delete your email address.' },
  ];
}

/**
 * @param {object} o
 * @param {'optional'|'required'} [o.mode='required']
 * @param {string} [o.publicOrigin='http://localhost:8080']  must be the page's origin (CSRF)
 * @param {'subscription'|'free-join'} [o.friendsMode]
 * @param {'verified'|'email_plus'} [o.mpConsent]
 * @param {number} [o.trialDays=0]
 * @param {number} [o.cacheMs=60000]   the claims cache (§8.1)
 * @param {number} [o.staleMs=1800000] how old a cached answer may be while the database is down
 * @param {boolean} [o.limits=false]   the router's rate limits (off: tests and screenshots
 *                                      make many requests from 127.0.0.1)
 * @param {(line: string) => void} [o.log]
 */
export async function createFakeAccounts(o = {}) {
  const mode = o.mode || 'required';
  const env = {
    SW_ACCOUNTS: mode,
    DATABASE_URL: 'pglite:',
    PUBLIC_ORIGIN: o.publicOrigin || 'http://localhost:8080',
    SW_SECRET: randomBytes(32).toString('base64'),
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_fake',
    STRIPE_PRICE_ID: 'price_fake',
    MAIL_MODE: 'memory',
    SW_TRIAL_DAYS: String(o.trialDays ?? 0),
    SW_FRIENDS_MODE: o.friendsMode || 'subscription',
    SW_MP_CONSENT: o.mpConsent || (o.friendsMode === 'free-join' ? 'email_plus' : 'verified'),
    SW_OPERATOR_NAME: 'The Sparkle Family',
    SW_OPERATOR_EMAIL: 'hello@sparkleworld.example',
    SW_OPERATOR_ADDRESS: 'PO Box 123, Springfield, USA',
    SW_OPERATOR_PHONE: '+1 555 0100',
  };
  const cfg = loadConfig(env);
  const log = o.log || (() => {});
  let offset = 0;
  const clock = {
    now: () => Date.now() + offset,
    get offsetMs() {
      return offset;
    },
    set(ms) {
      offset = Number(ms) || 0;
    },
  };
  const events = new EventEmitter();
  events.setMaxListeners(50);

  // ---- the data ----
  const families = new Map(); // id -> row (snake_case, like the database)
  const subs = new Map(); // family id -> [subscription rows]
  const players = new Map(); // id -> row
  const sessions = new Map(); // hash hex -> session
  const attempts = new Map(); // attempt id -> row
  const pairCodes = new Map(); // normalized code -> row
  const checkouts = new Map(); // cs_ id -> { familyId, trial, status }
  const gone = new Set(); // session hashes of deleted families
  const audit = [];
  const mail = [];
  const worlds = new Map(); // player id -> [{ id, name, biome, sizeName, updatedAt, size }]

  let notice = { version: 1, sections: draftNotice(cfg) };
  try {
    const file = fileURLToPath(new URL('../server/notice.mjs', import.meta.url));
    if (existsSync(file)) {
      const m = await import(new URL('../server/notice.mjs', import.meta.url).href);
      if (m.NOTICE_VERSION && typeof m.noticeSections === 'function') notice = { version: m.NOTICE_VERSION, minVersion: Number.isInteger(m.NOTICE_MIN_VERSION) ? m.NOTICE_MIN_VERSION : m.NOTICE_VERSION, sections: m.noticeSections(cfg) };
    }
  } catch {}
  const CHECKBOX = "I'm the parent or legal guardian of the children who will play, I'm 18 or older, and I agree that Sparkle World may keep the information above to run the game for them.";

  const planOf = (familyId) => {
    const fam = families.get(familyId);
    return entitlementOf({ family: fam || {}, subs: subs.get(familyId) || [], now: clock.now(), cfg });
  };
  const familyPlayers = (familyId) => [...players.values()].filter((p) => p.family_id === familyId).sort((a, b) => a.sort - b.sort || a.created_at - b.created_at);
  const portraitUrl = (p) => (p.portrait_rev ? `/api/players/${p.id}/portrait?v=${p.portrait_rev}` : null);

  /** What the relay allows a player now (§5.3 canJoin/canHost/walkieOk/why, §8.1). */
  function allowOf(p, plan = planOf(p.family_id)) {
    const visitor = cfg.friendsMode === 'free-join' && !plan.entitled && plan.consent !== 'none' && p.friends_on && plan.friendsConsentOk;
    let why = null;
    if (!plan.entitled && !visitor) why = 'not_entitled';
    else if (!plan.friendsConsentOk) why = 'friends_locked';
    else if (!p.friends_on) why = 'friends_off';
    const canJoin = why === null;
    return { canJoin, canHost: canJoin && !visitor, canBuild: canJoin && !visitor, walkieOk: canJoin && !visitor && p.walkie_on && plan.walkieConsentOk, why, visitor, plan };
  }

  function audited(familyId, action, detail = {}, playerId = null) {
    audit.push({ family_id: familyId, player_id: playerId, at: new Date(clock.now()), actor: 'parent', action, detail });
  }

  // ---- sessions ----
  function newSession(familyId, { kind = 'parent', lockPlayer = null, label = null, elevated = kind === 'parent' } = {}) {
    const tok = token();
    const hash = sha(tok);
    const now = clock.now();
    const s = {
      hash, hex: hash.toString('hex'), kind, familyId, lockPlayer, label: label || (kind === 'parent' ? 'Grown-up · browser' : 'iPad · Safari'),
      createdAt: now, lastSeen: now, expiresAt: now + (kind === 'parent' ? 30 : 180) * DAY,
      elevatedUntil: elevated ? now + 15 * MIN : null, elevatedAt: elevated ? now : null, revoked: false,
    };
    sessions.set(s.hex, s);
    return { token: tok, hash, session: s, cookie: `${cfg.cookies.sess}=${tok}` };
  }

  function sessionFromToken(tok) {
    if (!tok) return { session: null, error: null };
    const hex = sha(tok).toString('hex');
    if (gone.has(hex)) return { session: null, error: 'family_gone' };
    const s = sessions.get(hex);
    if (!s || s.revoked || s.expiresAt <= clock.now() || !families.has(s.familyId)) return { session: null, error: 'signed_out' };
    return { session: s, error: null };
  }

  const ctx = {
    cfg,
    clock,
    log,
    events,
    limits: o.limits ? undefined : { check: () => ({ ok: true }) },
    sessions: {
      async fromRequest(req) {
        const r = sessionFromToken(cookieOf(cfg, req, 'sess'));
        if (r.error === 'family_gone') throw httpError(410, 'family_gone');
        if (r.error) throw httpError(401, 'signed_out');
        if (r.session) r.session.lastSeen = clock.now();
        return r.session;
      },
    },
    family: {
      load: async (id) => families.get(id) || null,
      player: async (pid) => players.get(pid) || null,
    },
  };
  if (o.limits) {
    const { Limits } = await import('../server/limits.mjs');
    ctx.limits = new Limits();
  }

  // ---- the relay's questions (§8.1, §8.4), with the claims cache ----
  const claimsCache = new Map(); // `${hex}\n${pid}` -> { at, value }
  const counters = { authorize: 0, recheck: 0, cacheHits: 0, stale: 0 };
  const fake = {};

  function computeClaims(hex, playerId) {
    if (gone.has(hex)) return { ok: false, code: 'signed_out' };
    const s = sessions.get(hex);
    if (!s || s.revoked || s.expiresAt <= clock.now() || !families.has(s.familyId)) return { ok: false, code: 'signed_out' };
    if (!playerId) return { ok: false, code: 'signed_out' };
    const p = players.get(playerId);
    if (!p || p.family_id !== s.familyId || (s.lockPlayer && s.lockPlayer !== playerId)) return { ok: false, code: 'player_gone' };
    const a = allowOf(p);
    if (!a.canJoin) return { ok: false, code: a.why };
    return {
      ok: true,
      claims: { sessionHash: s.hash, familyId: s.familyId, playerId: p.id, nickname: p.nickname, canHost: a.canHost, canBuild: a.canBuild, walkie: a.walkieOk, until: a.plan.until },
    };
  }

  function cachedClaims(hex, playerId, fresh) {
    const key = hex + '\n' + (playerId || '');
    const hit = claimsCache.get(key);
    const now = Date.now();
    if (fake.down) {
      if (hit && now - hit.at <= (o.staleMs ?? 30 * MIN)) {
        counters.stale++;
        return hit.value;
      }
      return { ok: false, code: 'unavailable' };
    }
    if (!fresh && hit && now - hit.at <= (o.cacheMs ?? 60000)) {
      counters.cacheHits++;
      return hit.value;
    }
    const value = computeClaims(hex, playerId);
    if (value.ok) claimsCache.set(key, { at: now, value });
    else claimsCache.delete(key);
    return value;
  }

  async function authorizeSocket({ cookie, playerId } = {}) {
    counters.authorize++;
    const tok = cookieOf(cfg, cookie || '', 'sess');
    // optional: no p is a legacy socket, with or without a session cookie (like A's: a
    // signed-in page that fell back to local mode plays as today)
    if (!playerId && mode === 'optional') return { ok: true, claims: null };
    if (!tok) return { ok: false, code: 'signed_out' };
    if (playerId && !isUuid(playerId)) return { ok: false, code: 'player_gone' };
    return cachedClaims(sha(tok).toString('hex'), playerId, false);
  }

  async function recheck(claims, { fresh = false } = {}) {
    counters.recheck++;
    if (!claims || !claims.sessionHash) return { ok: false, code: 'signed_out' };
    return cachedClaims(Buffer.from(claims.sessionHash).toString('hex'), claims.playerId, fresh);
  }

  function invalidate() {
    claimsCache.clear();
  }

  // ---- the routes (§5.2) ----
  const J = (json, status = 200, extra = {}) => ({ status, json, ...extra });
  const bool = (v) => v === true;

  function playerJson(p) {
    const w = worlds.get(p.id) || [];
    return {
      id: p.id, nickname: p.nickname, color: p.color, sort: p.sort, portrait: portraitUrl(p), friends: p.friends_on, walkie: p.walkie_on,
      createdAt: p.created_at, worlds: w.length, lastPlayed: w.length ? Math.max(...w.map((x) => x.updatedAt)) : null,
    };
  }

  function familyJson(fam, s) {
    const plan = planOf(fam.id);
    return {
      email: fam.email,
      createdAt: fam.created_at,
      elevatedUntil: s.elevatedUntil,
      consent: { level: plan.consent, noticeVersion: fam.notice_version, consentAt: fam.consent_at, verifiedAt: fam.verified_at, method: fam.verified_method },
      plan,
      purgeAfter: fam.purge_after ?? null,
      players: familyPlayers(fam.id).map(playerJson),
      config: { friendsMode: cfg.friendsMode, mpConsent: cfg.mpConsent, trialDays: cfg.trialDays, priceText: cfg.priceText, noticeVersion: notice.version, noticeMinVersion: notice.minVersion ?? notice.version, operatorEmail: cfg.operator.email },
    };
  }

  function nicknameOf(raw, familyId, exceptId = null) {
    if (typeof raw !== 'string' || !raw.trim()) throw httpError(400, 'bad_request');
    if (isBlocked(raw)) throw httpError(400, 'nickname_blocked');
    const nick = sanitizeName(raw, '');
    if (!nick) throw httpError(400, 'nickname_blocked');
    for (const p of familyPlayers(familyId)) if (p.id !== exceptId && p.nickname.toLowerCase() === nick.toLowerCase()) throw httpError(409, 'nickname_taken');
    return nick;
  }

  function sendMail(to, template, data) {
    const m = { to, template, at: clock.now(), ...data };
    mail.push(m);
    if (mail.length > 200) mail.shift();
    log(`[mail] ${to.replace(/^(.).*(@.*)$/, '$1•••$2')} ${template}${data.code ? ': code ' + data.code : ''}${data.link ? ', link ' + data.link : ''}`);
  }

  function startAttempt(purpose, email, extra = {}) {
    const id = token();
    const code = String(randomInt(0, 1e6)).padStart(6, '0');
    const link = purpose === 'signin' ? token() : null;
    attempts.set(id, { id, purpose, email, code, link, tries: 0, expiresAt: clock.now() + 15 * MIN, used: false, ...extra });
    sendMail(email, purpose, { code, link: link ? `${cfg.publicOrigin}/account/verify#t=${link}` : null });
    return id;
  }

  function nextPath(n) {
    return typeof n === 'string' && /^\/(account|play)(\?[A-Za-z0-9=&%_-]{0,200})?$/.test(n) ? n : '/account';
  }

  const pid = (x) => x.player.id;

  const routes = [
    { method: 'GET', path: '/api/me', who: 'anyone', handler: async (req, x) => {
      if (x.sessionError) throw x.sessionError;
      if (!x.session) return J({ signedIn: false, accounts: mode });
      const s = x.session;
      const plan = planOf(s.familyId);
      return J({
        signedIn: true, kind: s.kind, accounts: mode, friendsMode: cfg.friendsMode,
        plan: { state: plan.state, entitled: plan.entitled, until: plan.until }, consent: plan.consent,
        players: familyPlayers(s.familyId).filter((p) => !s.lockPlayer || p.id === s.lockPlayer).map((p) => {
          const a = allowOf(p, plan);
          return { id: p.id, nickname: p.nickname, color: p.color, portrait: portraitUrl(p), friends: p.friends_on, walkie: p.walkie_on, canJoin: a.canJoin, canHost: a.canHost, walkieOk: a.walkieOk, why: a.why };
        }),
        lockPlayer: s.lockPlayer,
        playUntil: Math.min(plan.until ?? clock.now(), clock.now() + 7 * DAY),
      });
    } },
    { method: 'GET', path: '/api/notice', who: 'anyone', handler: async () => J({ version: notice.version, sections: notice.sections, checkbox: CHECKBOX }) },
    { method: 'POST', path: '/api/auth/start', who: 'anyone', handler: async (req, x) => {
      const email = typeof x.body.email === 'string' ? x.body.email.trim().normalize('NFC').toLowerCase() : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'bad_email');
      const id = startAttempt('signin', email, { next: nextPath(x.body.next) });
      return J({ ok: true }, 202, { cookies: [{ name: 'login', value: id, maxAge: 900 }] });
    } },
    { method: 'POST', path: '/api/auth/verify', who: 'anyone', handler: async (req, x) => {
      let a = null;
      // like the real one (auth.mjs): {token, peek:true} says whose sign-in it is and uses
      // nothing; a link opened in a browser signed in to another family needs {replace:true}
      const replacing = (t) => {
        if (!x.session) return false;
        const fam = [...families.values()].find((f) => f.email === t.email);
        return !fam || fam.id !== x.session.familyId;
      };
      if (typeof x.body.token === 'string') {
        a = [...attempts.values()].find((t) => t.link && t.link === x.body.token) || null;
        const live = a && !a.used && a.expiresAt > clock.now();
        if (x.body.peek === true) {
          if (!live) throw httpError(410, 'expired');
          return J({ email: a.email.replace(/^(.)[^@]*(@.*)$/, '$1•••$2'), replacing: replacing(a) });
        }
        if (live && x.body.replace !== true && replacing(a)) throw httpError(409, 'conflict', { replacing: true });
      } else {
        const id = cookieOf(cfg, req, 'login');
        a = id ? attempts.get(id) || null : null;
        if (a && !a.used && a.expiresAt > clock.now() && String(x.body.code || '').replace(/\D/g, '') !== a.code) {
          a.tries++;
          if (a.tries >= 5) a.used = true;
          else throw httpError(400, 'bad_code', { triesLeft: 5 - a.tries });
        }
      }
      if (!a || a.used || a.expiresAt <= clock.now()) throw httpError(410, 'expired');
      a.used = true;
      if (a.purpose === 'check') {
        const s = sessions.get(a.sessionHex);
        if (!s || s.revoked) throw httpError(401, 'signed_out');
        s.elevatedUntil = clock.now() + 15 * MIN;
        s.elevatedAt = clock.now();
        return J({ elevatedUntil: s.elevatedUntil }, 200, { cookies: [{ name: 'login', value: null }] });
      }
      let fam = [...families.values()].find((f) => f.email === a.email);
      if (!fam) fam = families.get(fake.addFamily({ email: a.email, consent: 'none', plan: 'none' }));
      fam.email_verified_at ??= new Date(clock.now());
      const old = sessionFromToken(cookieOf(cfg, req, 'sess')).session;
      if (old) old.revoked = true;
      const n = newSession(fam.id, { kind: 'parent' });
      return J({ next: a.next || '/account' }, 200, { cookies: [{ name: 'login', value: null }, { name: 'sess', value: n.token, maxAge: 30 * 86400 }] });
    } },
    { method: 'POST', path: '/api/auth/check', who: 'parent', handler: async (req, x) => {
      const id = startAttempt('check', x.family.email, { sessionHex: x.session.hex });
      return J({ ok: true }, 202, { cookies: [{ name: 'login', value: id, maxAge: 900 }] });
    } },
    { method: 'POST', path: '/api/auth/logout', who: 'session', handler: async (req, x) => {
      x.session.revoked = true;
      invalidate();
      events.emit('session', { sessionHash: x.session.hash });
      return J({ ok: true }, 200, { cookies: [{ name: 'sess', value: null }] });
    } },
    { method: 'POST', path: '/api/auth/logout-all', who: 'parent+check', handler: async (req, x) => {
      for (const s of sessions.values()) if (s.familyId === x.session.familyId) s.revoked = true;
      invalidate();
      for (const s of sessions.values()) if (s.familyId === x.session.familyId) events.emit('session', { sessionHash: s.hash });
      return J({ ok: true }, 200, { cookies: [{ name: 'sess', value: null }] });
    } },
    { method: 'POST', path: '/api/auth/pair', who: 'anyone', handler: async (req, x) => {
      const code = String(x.body.code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
      const pc = pairCodes.get(code);
      if (!pc || pc.used || pc.expiresAt <= clock.now()) throw httpError(400, 'bad_code');
      pc.used = true;
      const n = newSession(pc.familyId, { kind: 'device', lockPlayer: pc.lockPlayer, label: pc.label });
      audited(pc.familyId, 'device.paired', { sid: n.session.hex.slice(0, 8) });
      return J({ ok: true }, 200, { cookies: [{ name: 'sess', value: n.token, maxAge: 180 * 86400 }] });
    } },
    { method: 'POST', path: '/api/devices/pair-code', who: 'parent+check', handler: async (req, x) => {
      const live = [...pairCodes.values()].filter((c) => c.familyId === x.session.familyId && !c.used && c.expiresAt > clock.now());
      if (live.length >= 3) throw httpError(429, 'limit');
      const lock = x.body.lockPlayer && players.get(x.body.lockPlayer)?.family_id === x.session.familyId ? x.body.lockPlayer : null;
      let code = '';
      for (let k = 0; k < 8; k++) code += PAIR_ALPHABET[randomInt(0, 32)];
      const expiresAt = clock.now() + 10 * MIN;
      pairCodes.set(code, { familyId: x.session.familyId, lockPlayer: lock, label: typeof x.body.label === 'string' ? x.body.label.slice(0, 40) : null, expiresAt, used: false });
      return J({ code: code.slice(0, 4) + '-' + code.slice(4), expiresAt });
    } },
    { method: 'POST', path: '/api/devices/this', who: 'parent', handler: async (req, x) => {
      x.session.revoked = true;
      const lock = x.body.lockPlayer && players.get(x.body.lockPlayer)?.family_id === x.session.familyId ? x.body.lockPlayer : null;
      const n = newSession(x.session.familyId, { kind: 'device', lockPlayer: lock, label: typeof x.body.label === 'string' ? x.body.label.slice(0, 40) : 'This device' });
      return J({ ok: true }, 200, { cookies: [{ name: 'sess', value: n.token, maxAge: 180 * 86400 }] });
    } },
    { method: 'GET', path: '/api/devices', who: 'parent', handler: async (req, x) => J([...sessions.values()]
      .filter((s) => s.familyId === x.session.familyId && !s.revoked && s.expiresAt > clock.now())
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((s) => ({ id: s.hex.slice(0, 8), kind: s.kind, label: s.label, lastSeen: new Date(s.lastSeen).toISOString().slice(0, 10), current: s === x.session, lockPlayer: s.lockPlayer }))) },
    { method: 'PATCH', path: '/api/devices/:id', who: 'parent', handler: async (req, x) => {
      const s = [...sessions.values()].find((t) => t.familyId === x.session.familyId && !t.revoked && t.hex.startsWith(x.params.id));
      if (!s || !/^[0-9a-f]{8}$/.test(x.params.id)) throw httpError(404, 'not_found');
      if (typeof x.body.label === 'string') s.label = x.body.label.trim().slice(0, 40) || s.label;
      if ('lockPlayer' in x.body) s.lockPlayer = x.body.lockPlayer && players.get(x.body.lockPlayer)?.family_id === s.familyId ? x.body.lockPlayer : null;
      invalidate();
      events.emit('session', { sessionHash: s.hash });
      return J({ id: s.hex.slice(0, 8), kind: s.kind, label: s.label, lastSeen: new Date(s.lastSeen).toISOString().slice(0, 10), current: s === x.session, lockPlayer: s.lockPlayer });
    } },
    { method: 'DELETE', path: '/api/devices/:id', who: 'parent', handler: async (req, x) => {
      const s = [...sessions.values()].find((t) => t.familyId === x.session.familyId && !t.revoked && t.hex.startsWith(x.params.id));
      if (!s || !/^[0-9a-f]{8}$/.test(x.params.id)) throw httpError(404, 'not_found');
      s.revoked = true;
      audited(s.familyId, 'device.removed', { sid: s.hex.slice(0, 8) });
      invalidate();
      events.emit('session', { sessionHash: s.hash });
      return J({ ok: true });
    } },
    { method: 'GET', path: '/api/family', who: 'parent', handler: async (req, x) => J(familyJson(x.family, x.session)) },
    { method: 'GET', path: '/api/family/audit', who: 'parent', handler: async (req, x) => J(audit.filter((a) => a.family_id === x.session.familyId).map((a) => ({ at: a.at, action: a.action, ...(a.player_id ? { player: a.player_id } : {}) }))) },
    { method: 'POST', path: '/api/consent', who: 'parent', handler: async (req, x) => {
      if (x.body.agree !== true || x.body.noticeVersion !== notice.version) throw httpError(400, 'bad_request');
      x.family.consent_at ??= new Date(clock.now());
      x.family.notice_version = notice.version;
      audited(x.family.id, 'consent.email_plus', { v: notice.version });
      return J({ consent: planOf(x.family.id).consent });
    } },
    { method: 'POST', path: '/api/players', who: 'parent', handler: async (req, x) => {
      const plan = planOf(x.family.id);
      if (plan.consent === 'none') throw httpError(403, 'consent_required');
      if (!plan.entitled && cfg.friendsMode !== 'free-join') throw httpError(403, 'not_entitled');
      if (familyPlayers(x.family.id).length >= 6) throw httpError(409, 'limit');
      const nickname = nicknameOf(x.body.nickname, x.family.id);
      const id = fake.addPlayer(x.family.id, { nickname, color: Number.isInteger(x.body.color) ? x.body.color : undefined });
      audited(x.family.id, 'player.create', {}, id);
      return J(playerJson(players.get(id)), 201);
    } },
    { method: 'PATCH', path: '/api/players/:pid', who: 'parent', handler: async (req, x) => {
      const p = players.get(x.params.pid);
      if (!p) throw httpError(410, 'player_gone');
      if (p.family_id !== x.session.familyId) throw httpError(404, 'not_found');
      const plan = planOf(p.family_id);
      const b = x.body;
      const on = (k) => b[k] === true && !p[k + '_on'];
      if ((on('friends') || on('walkie')) && !(x.session.elevatedUntil > x.now)) throw httpError(403, 'check_required');
      if (on('friends') && (!plan.friendsConsentOk || (!plan.entitled && cfg.friendsMode !== 'free-join'))) throw httpError(403, plan.entitled ? 'needs_verified' : 'not_entitled');
      if (on('walkie') && !plan.walkieConsentOk) throw httpError(403, 'needs_verified');
      if (on('walkie') && !(p.friends_on || b.friends === true)) throw httpError(409, 'conflict');
      if (typeof b.nickname === 'string') p.nickname = nicknameOf(b.nickname, p.family_id, p.id);
      if (Number.isInteger(b.color) && b.color >= 0 && b.color <= 7) p.color = b.color;
      if (Number.isInteger(b.sort)) p.sort = b.sort;
      if (typeof b.friends === 'boolean' && b.friends !== p.friends_on) {
        p.friends_on = b.friends;
        audited(p.family_id, b.friends ? 'friends.on' : 'friends.off', b.friends ? { v: notice.version } : {}, p.id);
        if (!b.friends && p.walkie_on) {
          p.walkie_on = false;
          audited(p.family_id, 'walkie.off', {}, p.id);
        }
      }
      if (typeof b.walkie === 'boolean' && b.walkie !== p.walkie_on) {
        p.walkie_on = b.walkie;
        audited(p.family_id, b.walkie ? 'walkie.on' : 'walkie.off', b.walkie ? { v: notice.version } : {}, p.id);
      }
      invalidate();
      events.emit('player', { familyId: p.family_id, playerId: p.id });
      return J(playerJson(p));
    } },
    { method: 'DELETE', path: '/api/players/:pid', who: 'parent+check', handler: async (req, x) => {
      const p = players.get(x.params.pid);
      if (!p) throw httpError(410, 'player_gone');
      if (p.family_id !== x.session.familyId) throw httpError(404, 'not_found');
      if (typeof x.body.confirm !== 'string' || x.body.confirm.trim().toLowerCase() !== p.nickname.toLowerCase()) throw httpError(400, 'bad_request');
      fake.deletePlayer(p.id);
      return J({ ok: true });
    } },
    { method: 'GET', path: '/api/players/:pid/summary', who: 'parent', handler: async (req, x) => {
      const p = players.get(x.params.pid);
      if (!p) throw httpError(410, 'player_gone');
      if (p.family_id !== x.session.familyId) throw httpError(404, 'not_found');
      return J({
        nickname: p.nickname, createdAt: p.created_at, friends: p.friends_on, walkie: p.walkie_on,
        profile: p.profile,
        worlds: (worlds.get(p.id) || []).map((w) => ({ ...w, thumb: null })),
      });
    } },
    { method: 'GET', path: '/api/players/:pid/export', who: 'parent+check', handler: async (req, x) => {
      const p = players.get(x.params.pid);
      if (!p) throw httpError(410, 'player_gone');
      if (p.family_id !== x.session.familyId) throw httpError(404, 'not_found');
      audited(p.family_id, 'export.player', {}, p.id);
      const body = JSON.stringify({
        format: 'sparkle-world-player', v: 1, player: { nickname: p.nickname, createdAt: p.created_at }, profile: p.profile,
        worlds: (worlds.get(p.id) || []).map((w) => ({ format: 'sparkle-world', v: 1, save: { id: w.id, name: w.name, biome: w.biome, size: { x: 64, y: 32, z: 64 }, blocks: '', updatedAt: w.updatedAt } })),
      });
      return { status: 200, body, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="sparkle-world-player.json"' } };
    } },
    { method: 'GET', path: '/api/family/export', who: 'parent+check', handler: async (req, x) => {
      audited(x.family.id, 'export.family');
      const body = JSON.stringify({ format: 'sparkle-world-family', v: 1, family: { email: x.family.email }, players: familyPlayers(x.family.id).map(playerJson) });
      return { status: 200, body, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="sparkle-world-family-${new Date(clock.now()).toISOString().slice(0, 10)}.json"` } };
    } },
    { method: 'POST', path: '/api/family/delete', who: 'parent+check5', handler: async (req, x) => {
      if (x.body.confirm !== 'DELETE') throw httpError(400, 'bad_request');
      const email = x.family.email;
      fake.deleteFamily(x.family.id);
      sendMail(email, 'account_deleted', {});
      return J({ ok: true }, 200, { cookies: [{ name: 'sess', value: null }] });
    } },
    { method: 'GET', path: '/api/players/:pid/portrait', who: 'player', handler: async () => ({ status: 404, json: { error: 'not_found' } }) },
    // ---- billing (B's routes, pretend Stripe) ----
    { method: 'POST', path: '/api/billing/checkout', who: 'parent+check', handler: async (req, x) => {
      const plan = planOf(x.family.id);
      if (plan.consent === 'none') throw httpError(403, 'consent_required');
      if (x.body.usResident !== true) throw httpError(400, 'us_only');
      if ((subs.get(x.family.id) || []).some((s) => ['trialing', 'active', 'past_due'].includes(s.status))) throw httpError(409, 'already_subscribed');
      if (fake.stripeDown) throw httpError(502, 'stripe_unavailable');
      const id = 'cs_test_' + randomBytes(12).toString('hex');
      checkouts.set(id, { familyId: x.family.id, trial: x.body.trial === true && cfg.trialDays > 0 && !x.family.trial_used, status: 'open' });
      return J({ url: `/api/fake/stripe/c/${id}` });
    } },
    // B's answer carries usOnly when Checkout's billing address was outside the US (the
    // pretend session id cs_test_usonly stands for one, for the page's screenshots)
    { method: 'POST', path: '/api/billing/sync', who: 'parent', handler: async (req, x) => J({ plan: planOf(x.family.id), ...(x.body.sessionId === 'cs_test_usonly' ? { usOnly: true } : {}) }) },
    { method: 'POST', path: '/api/billing/portal', who: 'parent+check', handler: async (req, x) => {
      if (!(subs.get(x.family.id) || []).length) throw httpError(409, 'conflict');
      return J({ url: `/api/fake/stripe/p/${x.family.id}` });
    } },
    // Cancel the plan (no email check: cancelling is never harder than starting)
    { method: 'POST', path: '/api/billing/cancel', who: 'parent', handler: async (req, x) => {
      const sub = (subs.get(x.family.id) || []).find((s) => ['trialing', 'active', 'past_due'].includes(s.status) && !s.cancel_at_period_end);
      if (!sub) throw httpError(409, 'conflict');
      sub.cancel_at_period_end = true;
      invalidate();
      events.emit('family', { familyId: x.family.id });
      return J({ plan: planOf(x.family.id) });
    } },
    { method: 'POST', path: '/api/billing/start-now', who: 'parent+check', handler: async (req, x) => {
      const sub = (subs.get(x.family.id) || []).find((s) => s.status === 'trialing');
      if (!sub) throw httpError(409, 'conflict');
      fake.setPlan(x.family.id, 'active');
      fake.setConsent(x.family.id, 'verified');
      return J({ plan: planOf(x.family.id) });
    } },
    // ---- only the fake: a pretend Checkout and Portal (links, like Stripe's own pages) ----
    { method: 'GET', path: '/api/fake/stripe/c/:id', who: 'anyone', handler: async (req, x) => {
      const c = checkouts.get(x.params.id);
      if (!c) throw httpError(404, 'not_found');
      return fakePage('Pretend Stripe Checkout', `<p>Sparkle World Family Plan: ${esc(cfg.priceText)}${c.trial ? `, free for ${cfg.trialDays} days` : ''}.</p><p><a class="b" id="pay" href="/api/fake/stripe/pay/${esc(x.params.id)}">Pay (4242)</a> <a href="/account?checkout=cancel">Back</a></p>`);
    } },
    { method: 'GET', path: '/api/fake/stripe/pay/:id', who: 'anyone', handler: async (req, x) => {
      const c = checkouts.get(x.params.id);
      if (!c || c.status !== 'open') throw httpError(404, 'not_found');
      c.status = 'complete';
      const fam = families.get(c.familyId);
      if (fam) {
        fake.setPlan(fam.id, c.trial ? 'trialing' : 'active');
        if (c.trial) fam.trial_used = true;
        else fake.setConsent(fam.id, 'verified');
        fam.country = 'US';
      }
      return { status: 303, headers: { Location: `/account?checkout=${x.params.id}` } };
    } },
    { method: 'GET', path: '/api/fake/stripe/p/:id', who: 'anyone', handler: async (req, x) => fakePage('Pretend Stripe Portal', ['cancel', 'resume', 'fail', 'fix'].map((k) => `<p><a class="b" id="${k}" href="/api/fake/stripe/portal/${esc(x.params.id)}/${k}">${{ cancel: 'Cancel at period end', resume: 'Resume', fail: 'Card starts failing', fix: 'Update card' }[k]}</a></p>`).join('') + '<p><a id="back" href="/account?portal=1">Back to Sparkle World</a></p>') },
    { method: 'GET', path: '/api/fake/stripe/portal/:id/:what', who: 'anyone', handler: async (req, x) => {
      const fam = families.get(x.params.id);
      if (!fam) throw httpError(404, 'not_found');
      fake.setPlan(fam.id, { cancel: 'canceling', resume: 'active', fail: 'past_due', fix: 'active' }[x.params.what] || 'active');
      return { status: 303, headers: { Location: `/api/fake/stripe/p/${x.params.id}` } };
    } },
    { method: 'GET', path: '/api/fake/mail', who: 'anyone', handler: async (req, x) => J(mail.filter((m) => !x.query.to || m.to === x.query.to).slice(-20)) },
  ];

  const router = createRouter({ cfg, ctx, routes });

  // ---- test and development controls ----
  Object.assign(fake, {
    mode,
    friendsMode: cfg.friendsMode,
    cfg,
    ctx,
    clock,
    events,
    counters,
    down: false,
    stripeDown: false,
    data: { families, subs, players, sessions, attempts, pairCodes, mail, audit, gone },
    handleHttp: (req, res, url) => router.handle(req, res, url),
    health: async () => (fake.down ? { ok: false, db: false, migrations: 0 } : { ok: true, db: true, migrations: 1 }),
    netInfo: () => ({ accounts: mode, friendsMode: cfg.friendsMode }),
    authorizeSocket,
    recheck,
    invalidate,
    close: async () => {},

    /** A family: { email, plan: none|trialing|active|canceling|past_due|lapsed|comp, consent: none|email_plus|verified }. */
    addFamily({ email = `grownup${families.size + 1}@example.com`, plan = 'active', consent = 'verified' } = {}) {
      const id = randomUUID();
      families.set(id, {
        id, email, created_at: new Date(clock.now() - 20 * DAY), email_verified_at: new Date(clock.now() - 20 * DAY), last_seen_at: null,
        notice_version: null, consent_at: null, verified_at: null, verified_method: null, stripe_customer_id: null, trial_used: false,
        comp_until: null, country: null, lapsed_at: null, purge_after: null, kid_data_purged_at: null, flags: {},
      });
      fake.setConsent(id, consent);
      fake.setPlan(id, plan, { quiet: true });
      return id;
    },
    setConsent(familyId, level) {
      const f = families.get(familyId);
      const t = new Date(clock.now() - 10 * DAY);
      f.consent_at = level === 'none' ? null : f.consent_at || t;
      f.notice_version = level === 'none' ? null : notice.version;
      f.verified_at = level === 'verified' ? f.verified_at || new Date(clock.now()) : null;
      f.verified_method = level === 'verified' ? 'card' : null;
      invalidate();
      events.emit('family', { familyId });
    },
    /** The plan by name (a pretend subscription row), or an object of subscription fields. */
    setPlan(familyId, plan, { quiet = false } = {}) {
      const f = families.get(familyId);
      const now = clock.now();
      const base = { id: 'sub_fake_' + familyId.slice(0, 8), family_id: familyId, customer_id: 'cus_fake', price_id: 'price_fake', started_at: new Date(now - 20 * DAY), synced_at: new Date(now), cancel_at_period_end: false, first_failed_at: null, trial_end: null };
      f.comp_until = null;
      f.lapsed_at = null;
      f.purge_after = null;
      let row = null;
      if (plan === 'trialing') row = { ...base, status: 'trialing', trial_end: new Date(now + 5 * DAY + 3600e3), current_period_end: new Date(now + 5 * DAY + 3600e3) };
      else if (plan === 'active') row = { ...base, status: 'active', current_period_end: new Date(now + 24 * DAY) };
      else if (plan === 'canceling') row = { ...base, status: 'active', cancel_at_period_end: true, current_period_end: new Date(now + 24 * DAY) };
      else if (plan === 'past_due') row = { ...base, status: 'past_due', first_failed_at: new Date(now - 2 * DAY), current_period_end: new Date(now - 2 * DAY) };
      else if (plan === 'lapsed') {
        row = { ...base, status: 'canceled', ended_at: new Date(now - 10 * DAY), current_period_end: new Date(now - 10 * DAY) };
        f.lapsed_at = new Date(now - 10 * DAY);
        f.purge_after = new Date(now + (cfg.retainDays - 10) * DAY);
      } else if (plan === 'comp') f.comp_until = new Date(now + 60 * DAY);
      else if (plan && typeof plan === 'object') row = { ...base, ...plan };
      subs.set(familyId, row ? [row] : []);
      invalidate();
      if (!quiet) events.emit('family', { familyId });
    },
    addPlayer(familyId, { nickname, color, friends = false, walkie = false, worlds: n = 0, portrait = false } = {}) {
      const id = randomUUID();
      const list = familyPlayers(familyId);
      const now = clock.now();
      players.set(id, {
        id, family_id: familyId, nickname: nickname || `Player${list.length + 1}`.replace(/\d/g, ''), color: color ?? list.length % 8, sort: list.length,
        portrait_rev: portrait ? 1 : 0, friends_on: !!friends || !!walkie, walkie_on: !!walkie, created_at: new Date(now - 18 * DAY), updated_at: new Date(now),
        profile: { stickers: 7, coins: 312, stats: { blocksPlaced: 4210, worldsMade: n, petsAdopted: 2, recipesCooked: 11 } },
      });
      const names = ['Candy Castle', 'Bunny Meadow', 'Snowy Cabin', 'Beach House', 'Fairy Garden', 'Camper Town'];
      const biomes = ['candy', 'meadow', 'snow', 'beach', 'fairy', 'flat'];
      worlds.set(id, Array.from({ length: n }, (_, k) => ({ id: 'w' + k, name: names[k % names.length], biome: biomes[k % biomes.length], sizeName: k % 2 ? 'Big' : 'Medium', updatedAt: now - k * 2 * DAY - 3600e3, size: 180000 + k * 40000 })));
      return id;
    },
    /** Change a player the way a grown-up would on the Family page (and tell the relay). */
    setPlayer(pid, { friends, walkie, nickname } = {}) {
      const p = players.get(pid);
      if (typeof friends === 'boolean') p.friends_on = friends;
      if (typeof walkie === 'boolean') p.walkie_on = walkie;
      if (p.walkie_on && !p.friends_on) p.walkie_on = false;
      if (typeof nickname === 'string') p.nickname = nickname;
      invalidate();
      events.emit('player', { familyId: p.family_id, playerId: pid });
    },
    deletePlayer(pid) {
      const p = players.get(pid);
      if (!p) return;
      players.delete(pid);
      worlds.delete(pid);
      audited(p.family_id, 'player.delete', {}, pid);
      invalidate();
      events.emit('player', { familyId: p.family_id, playerId: pid });
    },
    deleteFamily(familyId) {
      for (const s of sessions.values()) if (s.familyId === familyId) {
        gone.add(s.hex);
        sessions.delete(s.hex);
      }
      for (const p of familyPlayers(familyId)) players.delete(p.id);
      families.delete(familyId);
      subs.delete(familyId);
      audited(familyId, 'family.deleted');
      invalidate();
      events.emit('family', { familyId });
    },
    /** A signed-in browser: { token, hash, cookie, session }. */
    addSession(familyId, opts = {}) {
      return newSession(familyId, opts);
    },
    revokeSession(hash) {
      const s = sessions.get(Buffer.from(hash).toString('hex'));
      if (s) s.revoked = true;
      invalidate();
      events.emit('session', { sessionHash: Buffer.from(hash) });
    },
    /** Change a family's row directly (a free pass on top of a plan, an older notice agreed, …). */
    setFamily(familyId, fields = {}) {
      Object.assign(families.get(familyId), fields);
      invalidate();
      events.emit('family', { familyId });
    },
    /** A sign-in link's token for `email` (as if the grown-up asked for it). */
    signInLink(email, { next = '/account' } = {}) {
      const id = startAttempt('signin', email, { next: nextPath(next) });
      return attempts.get(id).link;
    },
    lastMail(to) {
      for (let k = mail.length - 1; k >= 0; k--) if (!to || mail[k].to === to) return mail[k];
      return null;
    },
  });
  return fake;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fakePage(title, inner) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1a1a2e}h1{font-size:22px}.b{display:inline-block;padding:12px 18px;margin:4px 0;border-radius:8px;background:#635bff;color:#fff;text-decoration:none}</style></head><body><h1>${esc(title)}</h1><p>(This page stands in for Stripe in development and tests.)</p>${inner}</body></html>`;
  return { status: 200, body: html, headers: { 'Content-Type': 'text/html; charset=utf-8' } };
}
