// Sign-in, sessions, the email check and kid devices (docs/ACCOUNTS.md §4, §5.2, §8.1).
//
// Everything secret is random (32 bytes from crypto.randomBytes, base64url), single use where it
// can be, stored only as a SHA-256 hash (tokens) or an HMAC (codes, keyed by HKDF sub-keys of
// SW_SECRET), and compared in constant time. A GET never changes anything.
//
//   createSessions(ctx) → {
//     fromRequest(req, now) → session | null        (throws HttpError 401 signed_out, 410 family_gone)
//     fromCookie(cookieHeader, now), fromToken(token, now)
//     byHash(hashBuffer, now) → session | null      (no touch; the relay's questions)
//     createSession(q, { familyId, kind, label, lockPlayer, now, elevated }) → { token, hash, cookie }
//     revokeFamily(familyId | null, { now }) → number   (admin sign-out-all, logout-all)
//     authorizeSocket({ cookie, playerId }) → { ok, claims?, code? }   (§8.1)
//     recheck(claims) → { ok, claims?, code? }                         (§8.4, cached ≤ 60 s)
//     forget(hashHex), clearCaches()
//   }
//   session = { hash (Buffer), id (8 hex), kind: 'parent'|'device', familyId, locked, lockPlayer,
//               label, createdAt, lastSeenAt, expiresAt, idleExpiresAt, elevatedUntil, elevatedAt }  (ms)
//     locked: a kid device set up for one child. It stays locked when that child is deleted
//     (lock_player then becomes null, migration 002): such a device sees no player at all,
//     never every sibling. lockedAway(s, pid) (http.mjs) is the one test every route and the
//     relay use.
//   claims  = { sessionHash (hex), familyId, playerId, nickname, canHost, canBuild, walkie, until }
//   events:  'session' { sessionHash (hex) } when one is revoked or its lock changes.
//
// Lifetimes (§4.3, §4.5, §4.6): parent 30 days from sign-in or 14 days unused; device 180 days
// after last use (expires_at slides at most once a day without a new token); last_seen_at and
// idle_expires_at are bumped at most once an hour. Lookups go through a 60-second in-memory cache
// keyed by the token hash; revocation clears it. Claims are cached 60 s per (session, player);
// while the database is down an entry up to 30 minutes old is used.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { httpError, cookieOf, isUuid, lockedAway } from './http.mjs';
import { accessOf } from './family.mjs';
import { maskEmail } from './mail.mjs';

export { lockedAway };

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const PARENT_LIFE_MS = 30 * DAY;
export const PARENT_IDLE_MS = 14 * DAY;
export const DEVICE_LIFE_MS = 180 * DAY;
export const ELEVATE_MS = 15 * MIN;
export const ATTEMPT_MS = 15 * MIN;
export const PAIR_MS = 10 * MIN;
export const MAX_CODE_TRIES = 5;
export const MAX_LIVE_PAIR_CODES = 3;
const TOUCH_MS = HOUR;
const SLIDE_MS = DAY;
const CACHE_MS = 60e3;
const STALE_MS = 30 * MIN;
const LOGIN_COOKIE_S = 900;

/**
 * The rate limits of §4.8 that belong to these routes (the router applies them, in order).
 * Per address (IPv6 by /64), then per network (IPv6 by /48, IPv4 as is), then for everyone:
 * one home's allocation (a /56 holds 256 /64s) runs into its own network's limit long before
 * it could use up everyone's, so it cannot stop other families from signing in or pairing.
 * The limits for everyone stay well above real use; when one is used up the log says so.
 */
export const AUTH_LIMITS = Object.freeze({
  startIp: { name: 'auth-start-ip', count: 10, perMs: HOUR, burst: 5, key: 'ip' },
  startNet: { name: 'auth-start-net', count: 20, perMs: HOUR, burst: 10, key: 'net' },
  startAll: { name: 'auth-start-all', count: 1000, perMs: HOUR, key: 'global' },
  verifyIp: { name: 'auth-verify-ip', count: 30, perMs: HOUR, key: 'ip' },
  checkFamily: { name: 'auth-check-family', count: 5, perMs: HOUR, key: 'family' },
  pairIp: { name: 'auth-pair-ip', count: 10, perMs: 10 * MIN, key: 'ip' },
  pairNet: { name: 'auth-pair-net', count: 20, perMs: 10 * MIN, key: 'net' },
  pairAll: { name: 'auth-pair-all', count: 1000, perMs: HOUR, key: 'global' },
  pairCodeFamily: { name: 'pair-code-family', count: 10, perMs: HOUR, key: 'family' },
});
/**
 * Per email, counted in login_attempts so it survives restarts, on the email's rate key
 * (emailRateKey: name+tag@ and Gmail's dots count as the same mailbox): sign-ins started
 * (3 per 15 minutes, 10 a day), and wrong codes (10 a day, sign-in and email check together;
 * after that codes for that email stop working until the day has passed, while the link in
 * the email still works: it cannot be guessed).
 */
export const EMAIL_LIMITS = Object.freeze({ short: { count: 3, perMs: 15 * MIN }, day: { count: 10, perMs: DAY }, wrongCodes: { count: 10, perMs: DAY } });

// ---------------------------------------------------------------------------------------------
// small helpers (also used by family.mjs, admin.mjs and the tests)

export const sha256 = (s) => createHash('sha256').update(s).digest();
export const hmac = (key, s) => createHmac('sha256', key).update(s).digest();
export const newToken = () => randomBytes(32).toString('base64url');
export const sidOf = (hash) => Buffer.from(hash).toString('hex').slice(0, 8);
const ms = (v) => (v === null || v === undefined ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

/** trim, NFC, lower-case; ≤ 254 characters; a simple local@domain.tld shape. null when not. */
export function normalizeEmail(s) {
  if (typeof s !== 'string') return null;
  let e;
  try {
    e = s.trim().normalize('NFC').toLowerCase();
  } catch {
    return null;
  }
  if (e.length < 3 || e.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/u.test(e)) return null;
  if (/[\u0000-\u001f\u007f]/.test(e) || e.includes('..')) return null;
  return e;
}

/**
 * The mailbox an address reaches, for counting per email: 'name+tag@x' is 'name@x', and at
 * Gmail dots do not count ('j.doe@gmail.com' = 'jdoe@gmail.com' = 'jdoe@googlemail.com').
 * Only for limits (login_attempts.email_key); the family's email is always the one typed.
 */
export function emailRateKey(email) {
  const at = email.lastIndexOf('@');
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '') || local;
    domain = 'gmail.com';
  }
  return local + '@' + domain;
}

const NEXT_RE = /^\/(account|play)(\?[A-Za-z0-9=&%_-]{0,200})?$/;
/** A return path after sign-in (§4.3 step 5); anything else is /account. */
export function safeNext(s) {
  return typeof s === 'string' && NEXT_RE.test(s) ? s : '/account';
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 'k7qm 2xfd', 'K7QM-2XFD', 'O'→0, 'I'/'L'→1 → 'K7QM2XFD'; null when it cannot be a code. */
export function normalizePairCode(s) {
  if (typeof s !== 'string' || s.length > 32) return null;
  const t = s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(t) ? t : null;
}
export const formatPairCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;
export function newPairCode() {
  let c = '';
  for (let i = 0; i < 8; i++) c += CROCKFORD[randomInt(32)];
  return c;
}

/** A coarse device name made once from the User-Agent ("iPad · Safari"); the UA is not stored. */
export function deviceLabel(ua) {
  const s = String(ua || '');
  const os = /iPad/.test(s) ? 'iPad' : /iPhone|iPod/.test(s) ? 'iPhone' : /Android/.test(s) ? (/Mobile/.test(s) ? 'Android phone' : 'Android tablet')
    : /CrOS/.test(s) ? 'Chromebook' : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : 'Device';
  const br = /Edg[A-Z]*\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
    : /CriOS|Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

/** A parent's name for a device: plain text, one line, ≤ 40 characters; null when empty. */
export function cleanLabel(s) {
  if (typeof s !== 'string') return null;
  let t;
  try {
    t = s.normalize('NFC');
  } catch {
    return null;
  }
  t = t.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/gu, '').replace(/\s+/g, ' ').trim();
  t = Array.from(t).slice(0, 40).join('').trim();
  return t || null;
}

function toSession(row) {
  return {
    hash: Buffer.from(row.id_hash),
    id: sidOf(row.id_hash),
    kind: row.kind,
    familyId: row.family_id,
    // an old deployment (side by side during a deploy) writes lock_player without `locked`
    locked: !!row.locked || !!row.lock_player,
    lockPlayer: row.lock_player || null,
    label: row.label || null,
    createdAt: ms(row.created_at),
    lastSeenAt: ms(row.last_seen_at),
    expiresAt: ms(row.expires_at),
    idleExpiresAt: ms(row.idle_expires_at),
    elevatedUntil: ms(row.elevated_until),
    elevatedAt: ms(row.elevated_at),
    revokedAt: ms(row.revoked_at),
  };
}
const isValid = (s, now) => !!s && !s.revokedAt && s.expiresAt > now && s.idleExpiresAt > now;

// ---------------------------------------------------------------------------------------------

export function createSessions(ctx) {
  const { cfg, db, clock, events } = ctx;
  const cache = new Map(); // token hash hex → { s, at }
  const claimsCache = new Map(); // `${hex}:${pid}` → { at, value, hex, familyId, playerId }
  // bumped by every invalidation: an answer read from the database while one happened is used
  // but not cached (it may predate the revocation or the change that caused it)
  let epoch = 0;

  function forget(hex) {
    epoch++;
    cache.delete(hex);
    for (const [k, e] of claimsCache) if (e.hex === hex) claimsCache.delete(k);
  }
  function forgetFamily(familyId) {
    epoch++;
    for (const [k, e] of cache) if (e.s && e.s.familyId === familyId) cache.delete(k);
    for (const [k, e] of claimsCache) if (e.familyId === familyId) claimsCache.delete(k);
  }
  function forgetPlayer(playerId) {
    epoch++;
    for (const [k, e] of claimsCache) if (e.playerId === playerId) claimsCache.delete(k);
  }
  function clearCaches() {
    epoch++;
    cache.clear();
    claimsCache.clear();
  }
  /** Tests: make every cached entry `byMs` older (the caches run on real time). */
  function ageCaches(byMs) {
    for (const e of cache.values()) e.at -= byMs;
    for (const e of claimsCache.values()) e.at -= byMs;
  }
  // registered before server.mjs's listeners, so its re-checks always see fresh answers
  events.on('session', (e) => e && typeof e.sessionHash === 'string' && forget(e.sessionHash));
  events.on('family', (e) => e && e.familyId && forgetFamily(e.familyId));
  events.on('player', (e) => {
    if (e && e.playerId) forgetPlayer(e.playerId);
  });

  /** After a revocation committed: caches cleared, the relay told (it closes with 4401). */
  function announce(hashes) {
    for (const h of hashes) {
      const hex = Buffer.from(h).toString('hex');
      forget(hex);
      events.emit('session', { sessionHash: hex });
    }
  }

  async function load(hash) {
    const hex = hash.toString('hex');
    const hit = cache.get(hex);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.s;
    const before = epoch;
    const row = await db.one('select * from sessions where id_hash = $1', [hash]);
    const s = row ? toSession(row) : null;
    if (s && epoch === before) cache.set(hex, { s, at: Date.now() });
    else cache.delete(hex);
    return s;
  }

  async function touch(s, now) {
    const idle = s.kind === 'parent' ? PARENT_IDLE_MS : DEVICE_LIFE_MS;
    const slide = s.kind === 'device' && s.expiresAt - now < DEVICE_LIFE_MS - SLIDE_MS;
    const before = epoch;
    try {
      const row = await db.one(
        `update sessions set last_seen_at = $2, idle_expires_at = $3${slide ? ', expires_at = $4' : ''} where id_hash = $1 and revoked_at is null returning *`,
        slide ? [s.hash, new Date(now), new Date(now + idle), new Date(now + DEVICE_LIFE_MS)] : [s.hash, new Date(now), new Date(now + idle)],
      );
      if (row) {
        const fresh = toSession(row);
        if (epoch === before) cache.set(s.hash.toString('hex'), { s: fresh, at: Date.now() });
        return fresh;
      }
    } catch (err) {
      ctx.log(`sessions: touch failed ${err && err.code ? err.code : err && err.name ? err.name : 'Error'}`);
    }
    return s;
  }

  /** A valid session by its hash, or null (no touch). */
  async function byHash(hash, now = clock.now()) {
    const s = await load(Buffer.from(hash));
    return isValid(s, now) ? s : null;
  }

  async function fromToken(token, now = clock.now()) {
    const hash = sha256(token);
    const s = await load(hash);
    if (isValid(s, now)) return now - s.lastSeenAt >= TOUCH_MS ? touch(s, now) : s;
    if (!s && (await db.one('select 1 as x from gone_sessions where id_hash = $1', [hash]))) throw httpError(410, 'family_gone');
    throw httpError(401, 'signed_out');
  }

  async function fromCookie(header, now = clock.now()) {
    const token = cookieOf(cfg, header || '', 'sess');
    return token ? fromToken(token, now) : null;
  }

  async function fromRequest(req, now = clock.now()) {
    const token = cookieOf(cfg, req, 'sess');
    return token ? fromToken(token, now) : null;
  }

  async function createSession(q, { familyId, kind, label = null, lockPlayer = null, now = clock.now(), elevated = false }) {
    const token = newToken();
    const hash = sha256(token);
    const life = kind === 'parent' ? PARENT_LIFE_MS : DEVICE_LIFE_MS;
    const idle = kind === 'parent' ? PARENT_IDLE_MS : DEVICE_LIFE_MS;
    await q.query(
      `insert into sessions (id_hash, family_id, kind, label, lock_player, locked, created_at, last_seen_at, expires_at, idle_expires_at, elevated_until, elevated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11)`,
      [hash, familyId, kind, label, lockPlayer, lockPlayer !== null, new Date(now), new Date(now + life), new Date(now + idle), elevated ? new Date(now + ELEVATE_MS) : null, elevated ? new Date(now) : null],
    );
    return { token, hash, cookie: { name: 'sess', value: token, maxAge: life / 1000 } };
  }

  /** Revoke one session by hash inside q; returns the hash when it was live. */
  async function revokeIn(q, hash, now) {
    const r = await q.one('update sessions set revoked_at = $2 where id_hash = $1 and revoked_at is null returning id_hash', [hash, new Date(now)]);
    return r ? r.id_hash : null;
  }

  /** Revoke every live session of a family (or of everyone: familyId null) → how many. */
  async function revokeFamily(familyId, { now = clock.now() } = {}) {
    const r = familyId
      ? await db.query('update sessions set revoked_at = $2 where family_id = $1 and revoked_at is null returning id_hash', [familyId, new Date(now)])
      : await db.query('update sessions set revoked_at = $1 where revoked_at is null returning id_hash', [new Date(now)]);
    announce(r.rows.map((x) => x.id_hash));
    return r.rows.length;
  }

  // ---- the relay's questions (§8.1, §8.4) ----

  async function computeAccess(hash, playerId, now) {
    const s = await byHash(hash, now);
    if (!s) return { ok: false, code: 'signed_out' };
    if (lockedAway(s, playerId)) return { ok: false, code: 'player_gone', familyId: s.familyId };
    const p = await ctx.family.player(playerId);
    if (!p || p.family_id !== s.familyId) return { ok: false, code: 'player_gone', familyId: s.familyId };
    const ent = await ctx.billing.entitlementFor(s.familyId);
    const a = accessOf({ ent, player: p, cfg });
    if (!a.canJoin) return { ok: false, code: a.why, familyId: s.familyId };
    return {
      ok: true,
      claims: {
        sessionHash: hash.toString('hex'),
        familyId: s.familyId,
        playerId,
        nickname: p.nickname,
        canHost: a.canHost,
        canBuild: a.canBuild,
        walkie: a.walkieOk,
        until: ent.until ?? null,
      },
    };
  }

  async function access(hash, playerId) {
    const hex = hash.toString('hex');
    const key = `${hex}:${playerId}`;
    const hit = claimsCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const before = epoch;
    try {
      const r = await computeAccess(hash, playerId, clock.now());
      const { familyId = r.claims?.familyId ?? null, ...value } = r;
      if (epoch === before) claimsCache.set(key, { at: Date.now(), value, hex, familyId, playerId });
      if (claimsCache.size > 5000) claimsCache.delete(claimsCache.keys().next().value);
      return value;
    } catch (err) {
      // the database is down: a recent enough answer keeps reconnects working after a deploy
      if (hit && claimsCache.get(key) === hit && Date.now() - hit.at < STALE_MS) return hit.value;
      ctx.log(`sessions: socket check failed ${err && err.code ? err.code : err && err.name ? err.name : 'Error'}`);
      return { ok: false, code: 'unavailable' };
    }
  }

  async function authorizeSocket({ cookie, playerId } = {}) {
    // no `p`: optional mode keeps today's relay (a legacy socket, whatever cookie it carries:
    // a signed-in page that fell back to local mode is still a legacy socket); required: refused
    if (!playerId) return cfg.accounts === 'optional' ? { ok: true, claims: null } : { ok: false, code: 'signed_out' };
    const token = cookieOf(cfg, cookie || '', 'sess');
    if (!token) return { ok: false, code: 'signed_out' };
    if (!isUuid(playerId)) return { ok: false, code: 'player_gone' };
    return access(sha256(token), playerId.toLowerCase());
  }

  async function recheck(claims) {
    if (!claims) return { ok: true, claims: null };
    if (typeof claims.sessionHash !== 'string' || !/^[0-9a-f]{64}$/.test(claims.sessionHash) || !isUuid(claims.playerId)) return { ok: false, code: 'signed_out' };
    return access(Buffer.from(claims.sessionHash, 'hex'), claims.playerId);
  }

  return {
    fromRequest,
    fromCookie,
    fromToken,
    byHash,
    createSession,
    revokeIn,
    revokeFamily,
    announce,
    authorizeSocket,
    recheck,
    forget,
    clearCaches,
    ageCaches,
  };
}

// ---------------------------------------------------------------------------------------------
// the routes (§5.2)

export function routes(ctx) {
  const { cfg, db, clock, events } = ctx;
  const sessions = () => ctx.sessions;
  const L = AUTH_LIMITS;
  const emailKey = (email) => hmac(cfg.keys.email, emailRateKey(email));
  const codeMac = (attemptId, code) => hmac(cfg.keys.code, attemptId + code);
  const pairMac = (code) => hmac(cfg.keys.pair, code);
  const clearLogin = { name: 'login', value: null };
  const clearSess = { name: 'sess', value: null };
  const oldSessionHash = (req) => {
    const t = cookieOf(cfg, req, 'sess');
    return t ? sha256(t) : null;
  };

  async function lockablePlayer(familyId, v) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (!isUuid(v)) throw httpError(400, 'bad_request');
    const p = await db.one('select id from players where id = $1 and family_id = $2', [v.toLowerCase(), familyId]);
    if (!p) throw httpError(404, 'not_found');
    return p.id;
  }

  async function newAttempt(q, { purpose, email, familyId = null, sessionHash = null, next = null, now, link }) {
    const attemptId = newToken();
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const linkToken = link ? newToken() : null;
    await q.query(
      `insert into login_attempts (id_hash, purpose, email, email_key, family_id, session_hash, link_hash, code_mac, next, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [sha256(attemptId), purpose, email, emailKey(email), familyId, sessionHash, linkToken ? sha256(linkToken) : null, codeMac(attemptId, code), next, new Date(now), new Date(now + ATTEMPT_MS)],
    );
    return { attemptId, code, linkToken };
  }

  // POST /api/auth/start {email, next?} → 202 {ok:true}: the same answer and the same work whether
  // or not a family exists; nothing is created but the attempt (§4.3 step 1)
  async function start(req, x) {
    const email = normalizeEmail(x.body.email);
    if (!email) throw httpError(400, 'bad_email');
    const now = x.now;
    // the database agrees it is already normalized (the families check constraint)
    const ok = await db.one('select lower(btrim($1::text)) = $1::text as ok', [email]);
    if (!ok || !ok.ok) throw httpError(400, 'bad_email');
    if (ctx.limits) {
      const c = await db.one(
        `select count(*) filter (where created_at > $2) as short, count(*) as day
           from login_attempts where email_key = $1 and purpose = 'signin' and created_at > $3`,
        [emailKey(email), new Date(now - EMAIL_LIMITS.short.perMs), new Date(now - EMAIL_LIMITS.day.perMs)],
      );
      if (c.short >= EMAIL_LIMITS.short.count || c.day >= EMAIL_LIMITS.day.count) {
        throw httpError(429, 'rate', {}, { 'Retry-After': String(c.day >= EMAIL_LIMITS.day.count ? 3600 : 900) });
      }
    }
    const next = safeNext(x.body.next);
    const { attemptId } = await db.tx(async (q) => {
      const a = await newAttempt(q, { purpose: 'signin', email, next, now, link: true });
      // only the 3 newest unused attempts for this email stay valid
      await q.query(
        `update login_attempts set used_at = $2
          where email_key = $1 and purpose = 'signin' and used_at is null
            and id_hash not in (select id_hash from login_attempts where email_key = $1 and purpose = 'signin' and used_at is null order by created_at desc, id_hash limit 3)`,
        [emailKey(email), new Date(now)],
      );
      await ctx.mail.enqueue(q, 'signin', email, { code: a.code, link: `${cfg.publicOrigin}/account/verify#t=${a.linkToken}` });
      return a;
    });
    return { status: 202, json: { ok: true }, cookies: [{ name: 'login', value: attemptId, maxAge: LOGIN_COOKIE_S }] };
  }

  /**
   * Is this a link opened in a browser that is signed in to ANOTHER family (a kid's device,
   * say), which signing in would sign out? False with no live session here, or one of the
   * family the link signs in to.
   */
  async function replacing(q, a, x) {
    if (!x.session) return false;
    const fam = await q.one('select id from families where email = $1', [a.email]);
    return !fam || fam.id !== x.session.familyId;
  }

  // POST /api/auth/verify {code} | {token, peek?, replace?} → {next} (sign-in) or
  // {elevatedUntil} (check); {token, peek: true} → {email (masked), replacing} and uses nothing
  async function verify(req, x) {
    const now = x.now;
    const body = x.body || {};
    let r;
    if (typeof body.token === 'string') {
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(body.token)) throw httpError(410, 'expired');
      const live = (a) => a && !a.used_at && ms(a.expires_at) > now && a.tries < MAX_CODE_TRIES;
      if (body.peek === true) {
        // the link page says whose sign-in this is before anything happens (login CSRF: a
        // stranger's link opened on a kid's device must not quietly take the device over)
        const a = await db.one("select * from login_attempts where link_hash = $1 and purpose = 'signin'", [sha256(body.token)]);
        if (!live(a)) throw httpError(410, 'expired');
        return { json: { email: maskEmail(a.email), replacing: await replacing(db, a, x) } };
      }
      r = await db.tx(async (q) => {
        const a = await q.one("select * from login_attempts where link_hash = $1 and purpose = 'signin' for update", [sha256(body.token)]);
        if (!live(a)) return { expired: true };
        // signed in to another family here: only after the page said so (and asked a grown-up);
        // the link stays good until then
        if (body.replace !== true && (await replacing(q, a, x))) return { error: httpError(409, 'conflict', { replacing: true }) };
        await q.query('update login_attempts set used_at = $2 where id_hash = $1', [a.id_hash, new Date(now)]);
        return finish(q, a, req, x);
      });
    } else if (typeof body.code === 'string' || typeof body.code === 'number') {
      const attemptId = cookieOf(cfg, req, 'login');
      if (!attemptId) throw httpError(410, 'expired');
      const code = String(body.code).replace(/[\s-]/g, '');
      r = await db.tx(async (q) => {
        const a = await q.one('select * from login_attempts where id_hash = $1 for update', [sha256(attemptId)]);
        if (!a || a.used_at || ms(a.expires_at) <= now || a.tries >= MAX_CODE_TRIES) return { expired: true };
        // wrong codes per email (§4.8): 10 a day, whichever attempts they were typed into
        const W = EMAIL_LIMITS.wrongCodes;
        const wrong = (await q.one('select coalesce(sum(tries), 0) as n from login_attempts where email_key = $1 and created_at > $2', [a.email_key, new Date(now - W.perMs)])).n;
        if (wrong >= W.count) return { expired: true };
        const good = /^\d{6}$/.test(code) && timingSafeEqual(codeMac(attemptId, code), Buffer.from(a.code_mac));
        if (!good) {
          const tries = a.tries + 1;
          await q.query('update login_attempts set tries = $2 where id_hash = $1', [a.id_hash, tries]);
          return { bad: true, triesLeft: Math.max(0, Math.min(MAX_CODE_TRIES - tries, W.count - wrong - 1)) };
        }
        await q.query('update login_attempts set used_at = $2 where id_hash = $1', [a.id_hash, new Date(now)]);
        return finish(q, a, req, x);
      });
    } else {
      throw httpError(400, 'bad_request');
    }
    if (r.expired) throw httpError(410, 'expired');
    if (r.bad) throw httpError(400, 'bad_code', { triesLeft: r.triesLeft });
    if (r.error) throw r.error;
    if (r.revoked) sessions().announce(r.revoked);
    if (r.elevated) sessions().forget(r.elevated.toString('hex'));
    if (r.freePass) ctx.freePass.changed(r.freePass);
    return r.answer;
  }

  // inside the verify transaction: the attempt is used; now sign in or elevate
  async function finish(q, a, req, x) {
    const now = x.now;
    if (a.purpose === 'check') {
      if (!x.session || !a.session_hash || !x.session.hash.equals(Buffer.from(a.session_hash))) {
        return { error: httpError(x.session ? 403 : 401, x.session ? 'forbidden' : 'signed_out') };
      }
      const s = await q.one(
        'update sessions set elevated_until = $2, elevated_at = $3 where id_hash = $1 and revoked_at is null returning elevated_until',
        [a.session_hash, new Date(now + ELEVATE_MS), new Date(now)],
      );
      if (!s) return { error: httpError(401, 'signed_out') };
      return { elevated: Buffer.from(a.session_hash), answer: { json: { elevatedUntil: now + ELEVATE_MS }, cookies: [clearLogin] } };
    }
    // sign-in (and sign-up): find or create the family
    await q.query('insert into families (email, created_at) values ($1, $2) on conflict (email) do nothing', [a.email, new Date(now)]);
    const fam = await q.one(
      'update families set email_verified_at = coalesce(email_verified_at, $2), last_seen_at = $2 where email = $1 returning id',
      [a.email, new Date(now)],
    );
    // SW_FREE_PASS (§6.9): a listed address gets its free pass when the family is created or
    // signs in, so it works before the family exists
    let freePass = null;
    if (ctx.freePass?.listed(a.email)) {
      const fp = await ctx.freePass.applyIn(q, fam.id, { now });
      if (fp.pass || fp.consent) freePass = fam.id;
    }
    const revoked = [];
    const old = oldSessionHash(req);
    if (old) {
      const h = await sessions().revokeIn(q, old, now);
      if (h) revoked.push(h);
    }
    const s = await sessions().createSession(q, { familyId: fam.id, kind: 'parent', label: deviceLabel(req.headers['user-agent']), now, elevated: true });
    return { revoked, freePass, answer: { json: { next: safeNext(a.next) }, cookies: [s.cookie, clearLogin] } };
  }

  // POST /api/auth/check → 202: emails a 6-digit code for the email check (§4.4)
  async function check(req, x) {
    const email = x.family.email;
    const attemptId = await db.tx(async (q) => {
      const a = await newAttempt(q, { purpose: 'check', email, familyId: x.family.id, sessionHash: x.session.hash, now: x.now, link: false });
      await ctx.mail.enqueue(q, 'check', email, { code: a.code }, { familyId: x.family.id });
      return a.attemptId;
    });
    return { status: 202, json: { ok: true }, cookies: [{ name: 'login', value: attemptId, maxAge: LOGIN_COOKIE_S }] };
  }

  async function logout(req, x) {
    const h = await sessions().revokeIn(db, x.session.hash, x.now);
    if (h) sessions().announce([h]);
    return { json: { ok: true }, cookies: [clearSess] };
  }

  async function logoutAll(req, x) {
    await sessions().revokeFamily(x.session.familyId, { now: x.now });
    return { json: { ok: true }, cookies: [clearSess] };
  }

  // POST /api/auth/pair {code} → a device session (§4.5)
  async function pair(req, x) {
    const code = normalizePairCode(typeof x.body.code === 'string' ? x.body.code : '');
    if (!code) throw httpError(400, 'bad_code');
    const now = x.now;
    const r = await db.tx(async (q) => {
      const pc = await q.one(
        'update pair_codes set used_at = $2 where code_mac = $1 and used_at is null and expires_at > $2 returning family_id, label, lock_player',
        [pairMac(code), new Date(now)],
      );
      if (!pc) return null;
      const revoked = [];
      const old = oldSessionHash(req);
      if (old) {
        const h = await sessions().revokeIn(q, old, now);
        if (h) revoked.push(h);
      }
      const s = await sessions().createSession(q, {
        familyId: pc.family_id,
        kind: 'device',
        label: pc.label || deviceLabel(req.headers['user-agent']),
        lockPlayer: pc.lock_player || null,
        now,
      });
      await ctx.audit(q, pc.family_id, 'device.paired', { sid: sidOf(s.hash) });
      return { s, revoked };
    });
    if (!r) throw httpError(400, 'bad_code');
    sessions().announce(r.revoked);
    return { json: { ok: true }, cookies: [r.s.cookie] };
  }

  // POST /api/devices/pair-code {label?, lockPlayer?} → {code, expiresAt}
  async function pairCode(req, x) {
    const familyId = x.session.familyId;
    const lock = (await lockablePlayer(familyId, x.body.lockPlayer)) ?? null;
    const label = cleanLabel(x.body.label);
    const now = x.now;
    return db.tx(async (q) => {
      const live = await q.one('select count(*) as n from pair_codes where family_id = $1 and used_at is null and expires_at > $2', [familyId, new Date(now)]);
      if (live.n >= MAX_LIVE_PAIR_CODES) throw httpError(409, 'limit');
      for (let i = 0; i < 5; i++) {
        const code = newPairCode();
        const r = await q.one(
          `insert into pair_codes (code_mac, family_id, label, lock_player, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)
           on conflict (code_mac) do nothing returning code_mac`,
          [pairMac(code), familyId, label, lock, new Date(now), new Date(now + PAIR_MS)],
        );
        if (r) return { json: { code: formatPairCode(code), expiresAt: now + PAIR_MS } };
      }
      throw new Error('pair code space exhausted');
    });
  }

  // POST /api/devices/this {label?, lockPlayer?}: this parent session becomes a device session
  async function thisDevice(req, x) {
    const familyId = x.session.familyId;
    const lock = (await lockablePlayer(familyId, x.body.lockPlayer)) ?? null;
    const label = cleanLabel(x.body.label) || deviceLabel(req.headers['user-agent']);
    const now = x.now;
    const r = await db.tx(async (q) => {
      const h = await sessions().revokeIn(q, x.session.hash, now);
      const s = await sessions().createSession(q, { familyId, kind: 'device', label, lockPlayer: lock, now });
      await ctx.audit(q, familyId, 'device.paired', { sid: sidOf(s.hash) });
      return { s, revoked: h ? [h] : [] };
    });
    sessions().announce(r.revoked);
    return { json: { ok: true }, cookies: [r.s.cookie] };
  }

  const deviceJson = (row, current) => ({
    id: sidOf(row.id_hash),
    kind: row.kind,
    label: row.label || null,
    lastSeen: ms(row.last_seen_at),
    createdAt: ms(row.created_at),
    current: !!current && Buffer.from(row.id_hash).equals(current),
    lockPlayer: row.lock_player || null,
    // locked to a child who was deleted: it plays as nobody until the parent picks again
    locked: !!row.locked || !!row.lock_player,
  });

  async function findDevice(x) {
    const id = String(x.params.id || '').toLowerCase();
    if (!/^[0-9a-f]{8}$/.test(id)) throw httpError(404, 'not_found');
    const row = await db.one(
      `select * from sessions where family_id = $1 and revoked_at is null and expires_at > $2 and idle_expires_at > $2
          and substr(encode(id_hash, 'hex'), 1, 8) = $3 order by created_at limit 1`,
      [x.session.familyId, new Date(x.now), id],
    );
    if (!row) throw httpError(404, 'not_found');
    return row;
  }

  async function listDevices(req, x) {
    const r = await db.query(
      `select * from sessions where family_id = $1 and revoked_at is null and expires_at > $2 and idle_expires_at > $2
        order by last_seen_at desc, created_at desc`,
      [x.session.familyId, new Date(x.now)],
    );
    return { json: r.rows.map((row) => deviceJson(row, x.session.hash)) };
  }

  async function patchDevice(req, x) {
    const row = await findDevice(x);
    const sets = [];
    const params = [row.id_hash];
    if (x.body.label !== undefined) {
      const label = x.body.label === null ? null : cleanLabel(x.body.label);
      if (x.body.label !== null && !label) throw httpError(400, 'bad_request');
      params.push(label);
      sets.push(`label = $${params.length}`);
    }
    let lockChanged = false;
    if (x.body.lockPlayer !== undefined) {
      if (row.kind !== 'device') throw httpError(400, 'bad_request');
      const lock = await lockablePlayer(x.session.familyId, x.body.lockPlayer);
      params.push(lock);
      sets.push(`lock_player = $${params.length}`);
      // the parent's choice: a player locks it, "Anyone in the family" (null) unlocks it
      sets.push(`locked = ${lock !== null ? 'true' : 'false'}`);
      lockChanged = (row.lock_player || null) !== lock || (!!row.locked || !!row.lock_player) !== (lock !== null);
    }
    if (!sets.length) return { json: deviceJson(row, x.session.hash) };
    const upd = await db.one(`update sessions set ${sets.join(', ')} where id_hash = $1 returning *`, params);
    sessions().forget(Buffer.from(row.id_hash).toString('hex'));
    if (lockChanged) events.emit('session', { sessionHash: Buffer.from(row.id_hash).toString('hex') });
    return { json: deviceJson(upd, x.session.hash) };
  }

  async function deleteDevice(req, x) {
    const row = await findDevice(x);
    const h = await db.tx(async (q) => {
      const r = await sessions().revokeIn(q, row.id_hash, x.now);
      if (r) await ctx.audit(q, x.session.familyId, 'device.removed', { sid: sidOf(row.id_hash) });
      return r;
    });
    if (h) sessions().announce([h]);
    const current = x.session.hash.equals(Buffer.from(row.id_hash));
    return { json: { ok: true }, cookies: current ? [clearSess] : [] };
  }

  return [
    { method: 'POST', path: '/api/auth/start', who: 'anyone', limit: [L.startIp, L.startNet, L.startAll], handler: start },
    { method: 'POST', path: '/api/auth/verify', who: 'anyone', limit: [L.verifyIp], handler: verify },
    { method: 'POST', path: '/api/auth/check', who: 'parent', limit: [L.checkFamily], handler: check },
    { method: 'POST', path: '/api/auth/logout', who: 'session', handler: logout },
    { method: 'POST', path: '/api/auth/logout-all', who: 'parent+check', handler: logoutAll },
    { method: 'POST', path: '/api/auth/pair', who: 'anyone', limit: [L.pairIp, L.pairNet, L.pairAll], handler: pair },
    { method: 'POST', path: '/api/devices/pair-code', who: 'parent+check', limit: [L.pairCodeFamily], handler: pairCode },
    { method: 'POST', path: '/api/devices/this', who: 'parent', handler: thisDevice },
    { method: 'GET', path: '/api/devices', who: 'parent', handler: listDevices },
    { method: 'PATCH', path: '/api/devices/:id', who: 'parent', handler: patchDevice },
    { method: 'DELETE', path: '/api/devices/:id', who: 'parent', handler: deleteDevice },
  ];
}
