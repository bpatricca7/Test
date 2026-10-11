// The family and its players (docs/ACCOUNTS.md §3.4, §5.2, §5.3, §6.7, §11): /api/me (the
// game's boot call), the notice and consent, players and their two switches, the summary,
// exports, and deleting a player or the whole family.
//
//   createFamily(ctx) → {
//     load(familyId) → families row | null,  player(pid) → players row | null
//     deleteFamily(familyId, { actor, notify, now }) → { ok, stripeDone }     (§3.4)
//     deletePlayer(familyId, playerId, { actor, now })
//     exportFamily(familyId) → async iterable of strings (the family export's JSON)
//   }
//   accessOf({ ent, player, cfg }) → { canJoin, canHost, canBuild, walkieOk, why }   (§6.7, §8)
//
// Events (server.mjs re-checks live sockets, §8.4): 'family' { familyId, deleted? } when the
// family's consent changes or it is deleted; 'player' { familyId, playerId, deleted? } when a
// player's switches or nickname change or she is deleted.
//
// Children's data never leaves through here except to the signed-in parent (summary, exports)
// and, as the server's own nickname stamp, to the relay. Nothing here is logged but ids.

import { gunzipSync } from 'node:zlib';
import { httpError, isUuid } from './http.mjs';
import { consentOf } from './entitlement.mjs';
import { loadNotice } from './mail-templates.mjs';
import { sanitizeName } from '../src/net/names.js';
import { WORLD_SIZES } from '../src/world/world.js';

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const MAX_PLAYERS = 6;
export const EXPORT_LIMIT = Object.freeze({ name: 'exports-family', count: 5, perMs: HOUR, key: 'family' });
const PLAY_OFFLINE_MS = 7 * DAY;
const CONSENT_CONFIRM_MS = DAY;

const ms = (v) => (v === null || v === undefined ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * What the relay lets this player do now (§6.7, §8.1, §8.6), from the family's entitlement
 * (billing.entitlementFor) and her switches. `why` is the /api/me reason and the socket's code.
 */
export function accessOf({ ent, player, cfg }) {
  const deny = (why) => ({ canJoin: false, canHost: false, canBuild: false, walkieOk: false, why });
  const friends = !!player.friends_on;
  if (ent && ent.entitled) {
    if (!ent.friendsConsentOk) return deny('friends_locked');
    if (!friends) return deny('friends_off');
    return { canJoin: true, canHost: true, canBuild: true, walkieOk: !!player.walkie_on && !!ent.walkieConsentOk, why: null };
  }
  if (cfg.friendsMode === 'free-join' && ent) {
    // a visitor: join a friend's game only (never host, build or talk)
    if (!ent.friendsConsentOk) return deny('friends_locked');
    if (!friends) return deny('friends_off');
    return { canJoin: true, canHost: false, canBuild: false, walkieOk: false, why: null };
  }
  return deny('not_entitled');
}

/** The nickname the server stores and stamps: names.js's filter (§3.3); null when nothing is left. */
export function cleanNickname(s) {
  if (typeof s !== 'string' || s.length > 200) return null;
  const n = sanitizeName(s, '');
  return n && Array.from(n).length <= 12 ? n : null;
}

function sizeName(size) {
  if (!size || typeof size !== 'object') return null;
  for (const [name, s] of Object.entries(WORLD_SIZES)) if (s.x === size.x && s.y === size.y && s.z === size.z) return name;
  return null;
}

/**
 * The parent agreed to a notice older than NOTICE_MIN_VERSION (a change that matters, §11.3):
 * the Family page shows the notice again, and until she agrees no player is added and no
 * switch goes on (403 consent_required). Saving goes on meanwhile.
 */
export const noticeStale = (f, n) => !!f && !!f.consent_at && (f.notice_version ?? 0) < (n.minVersion ?? n.version);

const portraitUrl = (p) => (p.portrait ? `/api/players/${p.id}/portrait?v=${p.portrait_rev}` : null);

function consentJson(f) {
  return {
    level: consentOf(f),
    noticeVersion: f.notice_version ?? null,
    consentAt: ms(f.consent_at),
    verifiedAt: ms(f.verified_at),
    method: f.verified_method || null,
  };
}

function playerJson(p, extra = {}) {
  return {
    id: p.id,
    nickname: p.nickname,
    color: p.color,
    sort: p.sort,
    portrait: portraitUrl(p),
    friends: !!p.friends_on,
    walkie: !!p.walkie_on,
    createdAt: ms(p.created_at),
    ...extra,
  };
}

function gunzipJson(buf) {
  if (!buf) return null;
  try {
    return JSON.parse(gunzipSync(buf).toString('utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------

export function createFamily(ctx) {
  const { cfg, db, clock, events } = ctx;

  const load = async (familyId) => (isUuid(familyId) ? db.one('select * from families where id = $1', [familyId]) : null);
  const player = async (pid) => (isUuid(pid) ? db.one('select * from players where id = $1', [pid.toLowerCase()]) : null);

  /**
   * Delete a family (§3.4): (1) Stripe first, (2) one transaction, (3) sockets, cookie, the
   * `account_deleted` email and the deletion journal line. A Stripe failure does not block the
   * delete: deleted_families keeps the customer id and the retention job retries.
   */
  async function deleteFamily(familyId, { actor = 'parent', notify = true, now = clock.now() } = {}) {
    const fam = await load(familyId);
    if (!fam) return { ok: false };
    await ctx.audit(db, fam.id, 'family.delete', {}, { actor });
    let stripeDone = !fam.stripe_customer_id;
    if (fam.stripe_customer_id) {
      try {
        const r = await ctx.billing.cancelAndDelete({ familyId: fam.id, customerId: fam.stripe_customer_id });
        stripeDone = r !== false && !(r && r.ok === false);
      } catch (err) {
        stripeDone = false;
        ctx.log(`family: stripe cleanup failed ${err && err.code ? err.code : err && err.name ? err.name : 'Error'} (retried by the retention job)`);
      }
    }
    const t = new Date(now);
    const gone = await db.tx(async (q) => {
      // the row lock makes a second, simultaneous delete of the same family a no-op
      if (!(await q.one('select id from families where id = $1 for update', [fam.id]))) return null;
      const s = await q.query('select id_hash from sessions where family_id = $1', [fam.id]);
      await q.query('insert into gone_sessions (id_hash, gone_at) select id_hash, $2 from sessions where family_id = $1 on conflict (id_hash) do nothing', [fam.id, t]);
      await q.query(
        `insert into deleted_families (family_id, deleted_at, stripe_customer_id, stripe_done_at) values ($1, $2, $3, $4)
         on conflict (family_id) do update set deleted_at = excluded.deleted_at, stripe_customer_id = excluded.stripe_customer_id, stripe_done_at = excluded.stripe_done_at`,
        [fam.id, t, stripeDone ? null : fam.stripe_customer_id, stripeDone ? t : null],
      );
      await q.query('delete from login_attempts where email = $1', [fam.email]); // (its email check attempts cascade)
      await q.query('delete from families where id = $1', [fam.id]);
      await ctx.audit(q, fam.id, 'family.deleted', {}, { actor });
      return s.rows.map((r) => r.id_hash);
    });
    if (!gone) return { ok: false };
    ctx.billing?.invalidate?.(fam.id);
    for (const h of gone) ctx.sessions?.forget?.(Buffer.from(h).toString('hex'));
    events.emit('family', { familyId: fam.id, deleted: true });
    for (const h of gone) events.emit('session', { sessionHash: Buffer.from(h).toString('hex') });
    if (notify) await ctx.mail.enqueue(db, 'account_deleted', fam.email, {}, { familyId: null });
    ctx.log(`deletion-journal family=${fam.id}`);
    return { ok: true, stripeDone };
  }

  async function deletePlayer(familyId, playerId, { actor = 'parent', now = clock.now() } = {}) {
    const locked = await db.tx(async (q) => {
      // the devices locked to her stay locked (to nobody now); their cached sessions go
      const s = await q.query('select id_hash from sessions where family_id = $1 and lock_player = $2', [familyId, playerId]);
      const r = await q.one('delete from players where id = $1 and family_id = $2 returning id', [playerId, familyId]);
      if (!r) return null;
      await ctx.audit(q, familyId, 'player.delete', {}, { actor, playerId });
      return s.rows.map((x) => Buffer.from(x.id_hash).toString('hex'));
    });
    if (!locked) return false;
    for (const hex of locked) ctx.sessions?.forget?.(hex);
    events.emit('player', { familyId, playerId, deleted: true });
    for (const hex of locked) events.emit('session', { sessionHash: hex });
    // the restore runbook re-applies this delete from the journal (§3.4, §13.4): ids only
    ctx.log(`deletion-journal player=${playerId}`);
    return true;
  }

  // ---- exports: streamed, one world at a time ----

  async function* playerChunks(p) {
    const prof = await db.one('select body from player_profiles where player_id = $1', [p.id]);
    const profile = gunzipJson(prof?.body);
    const info = {
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      createdAt: ms(p.created_at),
      friends: !!p.friends_on,
      walkie: !!p.walkie_on,
      portrait: p.portrait ? 'data:image/png;base64,' + Buffer.from(p.portrait).toString('base64') : null,
    };
    yield `{"format":"sparkle-world-player","v":1,"player":${JSON.stringify(info)},"profile":${JSON.stringify(profile)},"worlds":[`;
    const ids = await db.query('select world_id from worlds where player_id = $1 and body is not null order by world_id', [p.id]);
    let first = true;
    for (const { world_id: wid } of ids.rows) {
      const w = await db.one('select body from worlds where player_id = $1 and world_id = $2 and body is not null', [p.id, wid]);
      if (!w) continue;
      let text;
      try {
        text = gunzipSync(w.body).toString('utf8');
        JSON.parse(text);
      } catch {
        continue;
      }
      yield `${first ? '' : ','}{"format":"sparkle-world","v":1,"save":${text}}`;
      first = false;
    }
    yield ']}';
  }

  async function history(familyId) {
    const r = await db.query('select at, action, player_id, detail from audit_log where family_id = $1 order by at desc, id desc limit 500', [familyId]);
    // the consent method is the one detail the page words differently (a payment, a signed
    // form, the operator's own family); it is never personal data (§11.9)
    const method = (a) => (a.action === 'consent.verified' && typeof a.detail?.method === 'string' ? { detail: { method: a.detail.method } } : {});
    return r.rows.map((a) => ({ at: ms(a.at), action: a.action, ...(a.player_id ? { player: a.player_id } : {}), ...method(a) }));
  }

  async function* exportFamily(familyId) {
    const fam = await load(familyId);
    if (!fam) return;
    const ent = await ctx.billing.entitlementFor(fam.id);
    const devices = await db.query('select kind, label, created_at, last_seen_at from sessions where family_id = $1 and revoked_at is null order by created_at', [fam.id]);
    const info = {
      email: fam.email,
      createdAt: ms(fam.created_at),
      emailVerifiedAt: ms(fam.email_verified_at),
      consent: consentJson(fam),
      plan: { state: ent.state, entitled: ent.entitled, until: ent.until },
      country: fam.country || null,
      compUntil: ms(fam.comp_until),
    };
    yield `{"format":"sparkle-world-family","v":1,"exportedAt":${clock.now()},"family":${JSON.stringify(info)}`;
    yield `,"consentHistory":${JSON.stringify(await history(fam.id))}`;
    yield `,"devices":${JSON.stringify(devices.rows.map((d) => ({ kind: d.kind, label: d.label, createdAt: ms(d.created_at), lastSeen: ms(d.last_seen_at) })))}`;
    yield ',"players":[';
    const players = await db.query('select * from players where family_id = $1 order by sort, created_at', [fam.id]);
    let first = true;
    for (const p of players.rows) {
      if (!first) yield ',';
      first = false;
      yield* playerChunks(p);
    }
    yield ']}';
  }

  return { load, player, deleteFamily, deletePlayer, exportFamily, playerChunks, history };
}

// ---------------------------------------------------------------------------------------------
// the routes (§5.2)

export function routes(ctx) {
  const { cfg, db, events } = ctx;
  const fam = () => ctx.family;

  async function ownPlayer(x) {
    const pid = x.params.pid;
    if (!isUuid(pid)) throw httpError(404, 'not_found');
    const p = await fam().player(pid);
    if (!p) throw httpError(410, 'player_gone');
    if (p.family_id !== x.session.familyId) throw httpError(404, 'not_found');
    return p;
  }

  const attachment = (name) => ({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });

  // GET /api/me (§5.3)
  async function me(req, x) {
    if (x.sessionError) {
      // the family was deleted (410: the page wipes its players' copies) or the session ended
      // (401, never "offline"); either way this browser's cookie is of no use any more
      const gone = x.sessionError.status === 410;
      return { status: gone ? 410 : 401, json: { error: gone ? 'family_gone' : 'signed_out' }, cookies: [{ name: 'sess', value: null }] };
    }
    if (!x.session) return { json: { signedIn: false, accounts: cfg.accounts } };
    const s = x.session;
    const f = x.family;
    if (!f) throw httpError(410, 'family_gone');
    const now = x.now;
    const ent = await ctx.billing.entitlementFor(f.id);
    // a locked device sees its one child; locked to a child who was deleted, it sees nobody
    // (never every sibling: the lock outlives the child, migration 002)
    const locked = !!(s.locked || s.lockPlayer);
    const rows = locked
      ? s.lockPlayer ? await db.query('select * from players where id = $1 and family_id = $2', [s.lockPlayer, f.id]) : { rows: [] }
      : await db.query('select * from players where family_id = $1 order by sort, created_at', [f.id]);
    const players = rows.rows.map((p) => {
      const a = accessOf({ ent, player: p, cfg });
      return {
        id: p.id,
        nickname: p.nickname,
        color: p.color,
        portrait: portraitUrl(p),
        friends: !!p.friends_on,
        walkie: !!p.walkie_on,
        canJoin: a.canJoin,
        canHost: a.canHost,
        walkieOk: a.walkieOk,
        why: a.why,
      };
    });
    if (!f.last_seen_at || now - ms(f.last_seen_at) > DAY) {
      await db.query('update families set last_seen_at = $2 where id = $1', [f.id, new Date(now)]);
    }
    const answer = {
      json: {
        signedIn: true,
        kind: s.kind,
        accounts: cfg.accounts,
        friendsMode: cfg.friendsMode,
        plan: { state: ent.state, entitled: ent.entitled, until: ent.until },
        consent: ent.consent,
        players,
        lockPlayer: s.lockPlayer || null,
        locked,
        playUntil: ent.entitled ? Math.min(ent.until ?? now + PLAY_OFFLINE_MS, now + PLAY_OFFLINE_MS) : now,
      },
    };
    // a device session slides forward: its cookie follows (the same token, §4.2)
    const token = x.cookies[cfg.cookies.sess];
    if (s.kind === 'device' && token && s.expiresAt > now) answer.cookies = [{ name: 'sess', value: token, maxAge: Math.floor((s.expiresAt - now) / 1000) }];
    return answer;
  }

  async function notice() {
    const n = await loadNotice(cfg);
    return { json: { version: n.version, sections: n.sections, checkbox: n.checkbox } };
  }

  // GET /api/family (parent)
  async function family(req, x) {
    const f = x.family;
    const n = await loadNotice(cfg);
    const ent = await ctx.billing.entitlementFor(f.id);
    const r = await db.query(
      `select p.*,
              (select count(*) from worlds w where w.player_id = p.id and w.body is not null and w.world_id !~ '[.](before|undo)$') as world_count,
              greatest((select max(w.updated_at) from worlds w where w.player_id = p.id), (select pp.updated_at from player_profiles pp where pp.player_id = p.id)) as last_played
         from players p where p.family_id = $1 order by p.sort, p.created_at`,
      [f.id],
    );
    return {
      json: {
        email: f.email,
        createdAt: ms(f.created_at),
        elevatedUntil: x.session.elevatedUntil ?? null,
        elevatedAt: x.session.elevatedAt ?? null,
        consent: consentJson(f),
        plan: ent,
        purgeAfter: ms(f.purge_after), // the lapsed ribbon's "kept until <date>" (§9.2); null while entitled
        players: r.rows.map((p) => playerJson(p, { worlds: p.world_count, lastPlayed: ms(p.last_played) })),
        config: {
          friendsMode: cfg.friendsMode,
          mpConsent: cfg.mpConsent,
          trialDays: cfg.trialDays,
          priceText: cfg.priceText,
          noticeVersion: n.version,
          noticeMinVersion: n.minVersion ?? n.version,
          operatorEmail: cfg.operator?.email || null,
        },
      },
    };
  }

  async function familyAudit(req, x) {
    return { json: await fam().history(x.family.id) };
  }

  // POST /api/consent {noticeVersion, agree:true} (§11.4 tier 1)
  async function consent(req, x) {
    const n = await loadNotice(cfg);
    if (x.body.agree !== true || !Number.isInteger(x.body.noticeVersion)) throw httpError(400, 'bad_request');
    if (x.body.noticeVersion !== n.version) throw httpError(409, 'conflict', { noticeVersion: n.version });
    const f = x.family;
    if (f.consent_at && f.notice_version === n.version) return { json: { consent: consentJson(f) } };
    const now = x.now;
    const updated = await db.tx(async (q) => {
      let row = await q.one('update families set notice_version = $2, consent_at = $3 where id = $1 returning *', [f.id, n.version, new Date(now)]);
      await ctx.audit(q, f.id, 'consent.email_plus', { v: n.version });
      // the "plus" of email plus: a confirmation a day later, with a way to take it back
      await ctx.mail.enqueue(q, 'consent_confirm', f.email, { at: now, v: n.version }, { familyId: f.id, sendAfter: now + CONSENT_CONFIRM_MS });
      // SW_FREE_PASS (§6.9): the operator's own listed family gets verified consent (method
      // 'operator') only now, after the parent agreed to the notice like every parent
      if (ctx.freePass?.listed(row.email)) {
        const fp = await ctx.freePass.applyIn(q, f.id, { now, notice: n });
        if (fp.pass || fp.consent) row = await q.one('select * from families where id = $1', [f.id]);
      }
      return row;
    });
    ctx.billing.invalidate(f.id);
    events.emit('family', { familyId: f.id });
    return { json: { consent: consentJson(updated) } };
  }

  // POST /api/players {nickname, color?}
  async function addPlayer(req, x) {
    const f = x.family;
    if (!f.consent_at || noticeStale(f, await loadNotice(cfg))) throw httpError(403, 'consent_required');
    const ent = await ctx.billing.entitlementFor(f.id);
    if (!ent.entitled && cfg.friendsMode !== 'free-join') throw httpError(403, 'not_entitled');
    const nickname = cleanNickname(x.body.nickname);
    if (!nickname) throw httpError(400, 'nickname_blocked');
    const color = x.body.color === undefined ? 0 : x.body.color;
    if (!Number.isInteger(color) || color < 0 || color > 7) throw httpError(400, 'bad_request');
    const now = new Date(x.now);
    const p = await db.tx(async (q) => {
      await q.one('select id from families where id = $1 for update', [f.id]); // one add at a time per family
      const n = await q.one('select count(*) as n, coalesce(max(sort) + 1, 0) as next from players where family_id = $1', [f.id]);
      if (n.n >= MAX_PLAYERS) throw httpError(409, 'limit');
      const taken = await q.one('select 1 as x from players where family_id = $1 and lower(nickname) = lower($2)', [f.id, nickname]);
      if (taken) throw httpError(409, 'nickname_taken');
      const row = await q.one(
        'insert into players (family_id, nickname, color, sort, created_at, updated_at) values ($1, $2, $3, $4, $5, $5) returning *',
        [f.id, nickname, color, Math.min(n.next, 32767), now],
      );
      await ctx.audit(q, f.id, 'player.create', {}, { playerId: row.id });
      return row;
    });
    return { status: 201, json: playerJson(p, { worlds: 0, lastPlayed: null }) };
  }

  // PATCH /api/players/:pid {nickname?, color?, sort?, friends?, walkie?, notice?}
  async function patchPlayer(req, x) {
    const p = await ownPlayer(x);
    const b = x.body;
    for (const k of ['friends', 'walkie']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw httpError(400, 'bad_request');
    if (b.color !== undefined && (!Number.isInteger(b.color) || b.color < 0 || b.color > 7)) throw httpError(400, 'bad_request');
    if (b.sort !== undefined && (!Number.isInteger(b.sort) || b.sort < 0 || b.sort > 1000)) throw httpError(400, 'bad_request');
    if (b.notice !== undefined && (!Number.isInteger(b.notice) || b.notice < 1 || b.notice > 1e6)) throw httpError(400, 'bad_request');
    // the consent records (friends.on / walkie.on {v}) name the notice the server shows now,
    // never a number the page chose; a page showing another version is told so (like /api/consent)
    const n = await loadNotice(cfg);
    if (b.notice !== undefined && b.notice !== n.version) throw httpError(409, 'conflict', { noticeVersion: n.version });
    const friendsOn = b.friends === true && !p.friends_on;
    const walkieOn = b.walkie === true && !p.walkie_on;
    let friends = b.friends ?? p.friends_on;
    let walkie = b.walkie ?? p.walkie_on;
    if (!friends) walkie = false; // the walkie needs friends (and goes off with it)
    if (friendsOn || walkieOn) {
      if (!(x.session.elevatedUntil > x.now)) throw httpError(403, 'check_required');
      if (noticeStale(x.family, n)) throw httpError(403, 'consent_required');
      if (walkieOn && !friends) throw httpError(409, 'conflict');
      const ent = await ctx.billing.entitlementFor(p.family_id);
      const visitorOk = cfg.friendsMode === 'free-join' && !walkieOn;
      if (!ent.entitled && !visitorOk) throw httpError(403, 'not_entitled');
      if (friendsOn && !ent.friendsConsentOk) throw httpError(403, 'needs_verified');
      if (walkieOn && !ent.walkieConsentOk) throw httpError(403, 'needs_verified');
    }
    let nickname = p.nickname;
    if (b.nickname !== undefined) {
      nickname = cleanNickname(b.nickname);
      if (!nickname) throw httpError(400, 'nickname_blocked');
    }
    const v = n.version;
    const row = await db.tx(async (q) => {
      if (nickname !== p.nickname) {
        const taken = await q.one('select 1 as x from players where family_id = $1 and lower(nickname) = lower($2) and id <> $3', [p.family_id, nickname, p.id]);
        if (taken) throw httpError(409, 'nickname_taken');
      }
      const r = await q.one(
        'update players set nickname = $2, color = $3, sort = $4, friends_on = $5, walkie_on = $6, updated_at = $7 where id = $1 returning *',
        [p.id, nickname, b.color ?? p.color, b.sort ?? p.sort, friends, walkie, new Date(x.now)],
      );
      const who = { playerId: p.id };
      if (friends && !p.friends_on) await ctx.audit(q, p.family_id, 'friends.on', { v }, who);
      if (!friends && p.friends_on) await ctx.audit(q, p.family_id, 'friends.off', {}, who);
      if (walkie && !p.walkie_on) await ctx.audit(q, p.family_id, 'walkie.on', { v }, who);
      if (!walkie && p.walkie_on) await ctx.audit(q, p.family_id, 'walkie.off', {}, who);
      return r;
    });
    if (friends !== p.friends_on || walkie !== p.walkie_on || nickname !== p.nickname) {
      events.emit('player', { familyId: p.family_id, playerId: p.id });
    }
    return { json: playerJson(row) };
  }

  // DELETE /api/players/:pid {confirm: <nickname>}
  async function deletePlayer(req, x) {
    const p = await ownPlayer(x);
    const confirm = typeof x.body.confirm === 'string' ? x.body.confirm.trim().toLowerCase() : null;
    if (confirm !== p.nickname.toLowerCase()) throw httpError(400, 'bad_request');
    await fam().deletePlayer(p.family_id, p.id, { actor: 'parent', now: x.now });
    return { json: { ok: true } };
  }

  // GET /api/players/:pid/summary (the parent's "See her data")
  async function summary(req, x) {
    const p = await ownPlayer(x);
    const prof = await db.one('select body from player_profiles where player_id = $1', [p.id]);
    const profile = gunzipJson(prof?.body) || {};
    const ws = await db.query(
      `select world_id, meta, size, rev, client_updated_at, thumb is not null as has_thumb from worlds
        where player_id = $1 and body is not null order by client_updated_at desc, world_id`,
      [p.id],
    );
    const stickers = profile.stickers && typeof profile.stickers === 'object' && !Array.isArray(profile.stickers) ? Object.keys(profile.stickers) : [];
    return {
      json: {
        nickname: p.nickname,
        createdAt: ms(p.created_at),
        friends: !!p.friends_on,
        walkie: !!p.walkie_on,
        profile: {
          stickers,
          coins: Number.isFinite(profile.coins) ? profile.coins : 0,
          stats: profile.stats && typeof profile.stats === 'object' ? profile.stats : {},
        },
        worlds: ws.rows.map((w) => ({
          id: w.world_id,
          name: typeof w.meta?.name === 'string' ? w.meta.name : null,
          biome: typeof w.meta?.biome === 'string' ? w.meta.biome : null,
          sizeName: sizeName(w.meta?.size),
          updatedAt: w.client_updated_at,
          size: w.size,
          thumb: w.has_thumb ? `/api/players/${p.id}/worlds/${encodeURIComponent(w.world_id)}/thumb?v=${w.rev}` : null,
        })),
      },
    };
  }

  // GET /api/players/:pid/export (parent+check): her data as a file
  async function exportPlayer(req, x) {
    const p = await ownPlayer(x);
    await ctx.audit(db, p.family_id, 'export.player', {}, { playerId: p.id });
    return { headers: attachment(`glimmer-world-player-${dayOf(x.now)}.json`), stream: fam().playerChunks(p) };
  }

  // GET /api/family/export (parent+check): everything, streamed one world at a time
  async function exportFamily(req, x) {
    await ctx.audit(db, x.family.id, 'export.family', {});
    return { headers: attachment(`glimmer-world-family-${dayOf(x.now)}.json`), stream: fam().exportFamily(x.family.id) };
  }

  // POST /api/family/delete {confirm:'DELETE'} (parent+check5)
  async function deleteAll(req, x) {
    if (x.body.confirm !== 'DELETE') throw httpError(400, 'bad_request');
    await fam().deleteFamily(x.family.id, { actor: 'parent', notify: true, now: x.now });
    return { json: { ok: true }, cookies: [{ name: 'sess', value: null }] };
  }

  return [
    { method: 'GET', path: '/api/me', who: 'anyone', handler: me },
    { method: 'GET', path: '/api/notice', who: 'anyone', handler: notice },
    { method: 'GET', path: '/api/family', who: 'parent', handler: family },
    { method: 'GET', path: '/api/family/audit', who: 'parent', handler: familyAudit },
    { method: 'POST', path: '/api/consent', who: 'parent', handler: consent },
    { method: 'POST', path: '/api/players', who: 'parent', handler: addPlayer },
    { method: 'PATCH', path: '/api/players/:pid', who: 'parent', handler: patchPlayer },
    { method: 'DELETE', path: '/api/players/:pid', who: 'parent+check', handler: deletePlayer },
    { method: 'GET', path: '/api/players/:pid/summary', who: 'parent', handler: summary },
    { method: 'GET', path: '/api/players/:pid/export', who: 'parent+check', limit: [EXPORT_LIMIT], handler: exportPlayer },
    { method: 'GET', path: '/api/family/export', who: 'parent+check', limit: [EXPORT_LIMIT], handler: exportFamily },
    { method: 'POST', path: '/api/family/delete', who: 'parent+check5', handler: deleteAll },
  ];
}
