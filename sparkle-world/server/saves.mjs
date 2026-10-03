// Cloud saves (docs/ACCOUNTS.md §5.2, §5.4; owner C): each player's profile, worlds and head
// portrait, for the game's HttpCloudBackend (src/account/cloud.js). Mounted by accounts.mjs
// when this file exists: export routes(ctx).
//
//   GET    /api/players/:pid/profile          player   → 200 profile + ETag "r<rev>" | 204
//   PUT    /api/players/:pid/profile          player, entitled; If-Match → { rev } | 409 | 403
//   GET    /api/players/:pid/worlds           player   → [{ …meta, rev, thumbnail: url|null }]
//                                                        + tombstones { id, deleted: true, updatedAt, rev }
//   GET    /api/players/:pid/worlds/:wid      player   → the save JSON (gzip when accepted) + ETag
//   GET    /api/players/:pid/worlds/:wid/thumb player  → image/jpeg (URL has ?v=<rev>)
//   PUT    /api/players/:pid/worlds/:wid      player, entitled; save JSON (gzip optional) + If-Match
//                                               → { rev } | 409 conflict | 410 deleted | 413 | 403
//   DELETE /api/players/:pid/worlds/:wid      player, entitled → { rev } (a tombstone)
//   PUT    /api/players/:pid/portrait         player; { png: 'data:image/png;base64,…' } → { rev }
//   GET    /api/players/:pid/portrait         player   → image/png (URL has ?v=<portrait_rev>)
//
// Revisions (§5.4): every row has `rev` (1, 2, …), sent as ETag "r<rev>". A write carries
// If-Match "r<rev>" (the revision its copy descends from) or * (create); none → 428.
//   no row / a tombstone   → store (a tombstone comes back only when the save's updatedAt is
//                            newer than the delete, else 410 deleted)
//   If-Match = rev         → store, rev + 1
//   If-Match ≠ rev (or *)  → the same updatedAt: 200 with the current rev (the same save again);
//                            else 409 { error: 'conflict', rev, updatedAt }
//   side copies (<id>.before, <id>.undo): the newest updatedAt wins, never a conflict.
// Writes need the family entitled (§6.5, grace included) and its consent; reads work while the
// player exists (a lapsed child still sees her worlds). A deleted player is 410 player_gone
// and another family's player 404 (the router, server/http.mjs).
//
// Nothing here logs a name, a world or a body. Compression runs off the event loop (the relay
// shares this process).

import { gzip as gzipCb, gunzip as gunzipCb } from 'node:zlib';
import { promisify } from 'node:util';
import { httpError } from './http.mjs';
import { metaOf, isSideCopyId } from '../src/core/storage.js';
import { WORLD_SIZES } from '../src/world/world.js';

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

const KB = 1024;
const MB = 1024 * KB;
/** Limits of §3.3. Tests may shrink them per server with ctx.savesLimits. */
export const SAVES_LIMITS = Object.freeze({
  worlds: 60, // live worlds per player (side copies count, tombstones do not)
  playerBytes: 100 * MB, // stored gzip per player
  familyBytes: 300 * MB, // stored gzip per family
  profileBytes: 256 * KB, // profile JSON
  portraitBytes: 32 * KB, // PNG
  thumbBytes: 72 * KB, // JPEG (its data: URL ≤ 96 KB)
  tombs: 1000, // tombstones per player for worlds the server never had (kept 30 days)
});

export const WORLD_ID_RE = /^[A-Za-z0-9_.~-]{1,72}$/;
const MAX_DIM = { x: 0, y: 0, z: 0 };
for (const s of Object.values(WORLD_SIZES)) for (const k of ['x', 'y', 'z']) MAX_DIM[k] = Math.max(MAX_DIM[k], s[k]);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const PNG_PREFIX = 'data:image/png;base64,';
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const PUT_LIMIT = [{ name: 'saves-put', count: 12, perMs: 60000, burst: 20, key: 'player' }];
const PORTRAIT_LIMIT = [{ name: 'portrait-put', count: 6, perMs: 60000, burst: 6, key: 'player' }];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const etag = (rev) => `"r${rev}"`;
const ms = (d) => (d instanceof Date ? d.getTime() : Number(d));

/** If-Match → '*', a revision number, null (missing) or throws 400 (malformed). */
export function parseIfMatch(h) {
  if (h === undefined || h === null || h === '') return null;
  const v = String(h).trim();
  if (v === '*') return '*';
  const m = /^(?:W\/)?"?r(\d{1,15})"?$/.exec(v);
  if (!m) throw httpError(400, 'bad_request');
  return Number(m[1]);
}

function decodeDataUrl(s, prefix, max, sig) {
  if (typeof s !== 'string' || !s.startsWith(prefix)) throw httpError(400, 'bad_request');
  const b64 = s.slice(prefix.length);
  if (b64.length > Math.ceil(max / 3) * 4 + 4 || !B64_RE.test(b64)) throw httpError(413, 'too_big');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > max) throw httpError(413, 'too_big');
  if (buf.length < sig.length || !buf.subarray(0, sig.length).equals(sig)) throw httpError(400, 'bad_request');
  return buf;
}

/** Check a world save (§5.4) → { meta, thumb }; throws 400 / 413. */
export function checkSave(save, wid, limits = SAVES_LIMITS) {
  const bad = () => httpError(400, 'bad_request');
  if (!isObj(save) || save.id !== wid) throw bad();
  if (typeof save.name !== 'string' || save.name.length > 80) throw bad();
  if (typeof save.blocks !== 'string') throw bad();
  const sz = save.size;
  if (!isObj(sz) || !['x', 'y', 'z'].every((k) => Number.isInteger(sz[k]) && sz[k] >= 1 && sz[k] <= MAX_DIM[k])) throw bad();
  if (!Number.isFinite(save.updatedAt) || save.updatedAt <= 0) throw bad();
  let thumb = null;
  if (save.thumbnail !== null && save.thumbnail !== undefined) thumb = decodeDataUrl(save.thumbnail, JPEG_PREFIX, limits.thumbBytes, Buffer.from([0xff, 0xd8]));
  // the list entry: metaOf() as the page makes it, minus the picture, with only small parts
  const meta = metaOf(save);
  delete meta.thumbnail;
  meta.size = { x: sz.x, y: sz.y, z: sz.z };
  if (typeof meta.biome !== 'string' || meta.biome.length > 40) delete meta.biome;
  if (!Number.isFinite(meta.createdAt)) meta.createdAt = 0;
  if (meta.backupOf !== undefined && !(typeof meta.backupOf === 'string' && WORLD_ID_RE.test(meta.backupOf))) delete meta.backupOf;
  if (meta.backupAt !== undefined && !Number.isFinite(meta.backupAt)) delete meta.backupAt;
  if (typeof save.sizeName === 'string' && save.sizeName.length <= 16) meta.sizeName = save.sizeName;
  return { meta, thumb };
}

/** Device-local parts of a profile never reach the server (§7.4): `net`, `settings.walkie*`. */
export function stripProfile(p) {
  const out = { ...p };
  delete out.net;
  delete out._rev;
  if (isObj(out.settings)) {
    const s = { ...out.settings };
    for (const k of Object.keys(s)) if (k.startsWith('walkie')) delete s[k];
    out.settings = s;
  }
  return out;
}

export function routes(ctx) {
  const lim = () => ctx.savesLimits || SAVES_LIMITS;
  const lockKey = (pid, what) => `sparkle-world:save:${pid}:${what}`;

  async function mayWrite(x) {
    const e = await ctx.billing.entitlementFor(x.session.familyId);
    if (!e || !e.entitled) throw httpError(403, 'not_entitled');
    if (e.consent === 'none') throw httpError(403, 'consent_required');
  }

  const now = (x) => new Date(x.now);

  // ---------------------------------------------------------------------------------------
  // profile

  async function getProfile(req, x) {
    const row = await ctx.db.one('select rev, body from player_profiles where player_id = $1', [x.player.id]);
    if (!row) return { status: 204 };
    const text = (await gunzip(row.body)).toString('utf8');
    return { body: Buffer.from(text), headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: etag(row.rev) } };
  }

  async function putProfile(req, x) {
    const ifMatch = parseIfMatch(req.headers['if-match']);
    if (ifMatch === null) throw httpError(428, 'bad_request');
    await mayWrite(x);
    const p = x.body;
    if (!Number.isFinite(p.updatedAt) || p.updatedAt < 0) throw httpError(400, 'bad_request');
    const json = Buffer.from(JSON.stringify(stripProfile(p)));
    if (json.length > lim().profileBytes) throw httpError(413, 'too_big');
    const body = await gzip(json);
    const pid = x.player.id;
    return ctx.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [lockKey(pid, '@profile')]);
      const row = await q.one('select rev, client_updated_at from player_profiles where player_id = $1 for update', [pid]);
      if (row && ifMatch !== row.rev) {
        if (p.updatedAt === row.client_updated_at) return { json: { rev: row.rev }, headers: { ETag: etag(row.rev) } };
        throw httpError(409, 'conflict', { rev: row.rev, updatedAt: row.client_updated_at });
      }
      const rev = (row ? row.rev : 0) + 1;
      await q.query(
        `insert into player_profiles (player_id, rev, client_updated_at, body, size, updated_at) values ($1, $2, $3, $4, $5, $6)
         on conflict (player_id) do update set rev = excluded.rev, client_updated_at = excluded.client_updated_at,
           body = excluded.body, size = excluded.size, updated_at = excluded.updated_at`,
        [pid, rev, Math.floor(p.updatedAt), body, json.length, now(x)],
      );
      return { json: { rev }, headers: { ETag: etag(rev) } };
    });
  }

  // ---------------------------------------------------------------------------------------
  // worlds

  function wid(x) {
    const id = x.params.wid;
    if (!WORLD_ID_RE.test(id)) throw httpError(400, 'bad_request');
    return id;
  }

  async function listWorlds(req, x) {
    const pid = x.player.id;
    const r = await ctx.db.query(
      'select world_id, rev, client_updated_at, meta, thumb is not null as has_thumb, body is null as tomb, deleted_at from worlds where player_id = $1',
      [pid],
    );
    const out = r.rows.map((w) => {
      if (w.tomb) return { id: w.world_id, deleted: true, updatedAt: ms(w.deleted_at), rev: w.rev };
      return {
        ...(isObj(w.meta) ? w.meta : {}),
        id: w.world_id,
        updatedAt: w.client_updated_at,
        rev: w.rev,
        thumbnail: w.has_thumb ? `/api/players/${pid}/worlds/${encodeURIComponent(w.world_id)}/thumb?v=${w.rev}` : null,
      };
    });
    return { json: out };
  }

  async function getWorld(req, x) {
    const id = wid(x);
    const row = await ctx.db.one('select rev, body from worlds where player_id = $1 and world_id = $2', [x.player.id, id]);
    if (!row) throw httpError(404, 'not_found');
    if (!row.body) throw httpError(410, 'deleted');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ETag: etag(row.rev), Vary: 'Accept-Encoding' };
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return { body: row.body, headers: { ...headers, 'Content-Encoding': 'gzip' } };
    return { body: await gunzip(row.body), headers };
  }

  async function getThumb(req, x) {
    const row = await ctx.db.one('select thumb from worlds where player_id = $1 and world_id = $2', [x.player.id, wid(x)]);
    if (!row || !row.thumb) throw httpError(404, 'not_found');
    return { body: row.thumb, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } };
  }

  async function putWorld(req, x) {
    const id = wid(x);
    const ifMatch = parseIfMatch(req.headers['if-match']);
    if (ifMatch === null) throw httpError(428, 'bad_request');
    await mayWrite(x);
    const save = x.body;
    const { meta, thumb } = checkSave(save, id, lim());
    const body = await gzip(x.bodyBytes);
    const size = x.bodyBytes.length;
    const updatedAt = Math.floor(save.updatedAt);
    const side = isSideCopyId(id);
    const pid = x.player.id;
    const L = lim();
    return ctx.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [lockKey(pid, id)]);
      const row = await q.one('select rev, client_updated_at, deleted_at, body is null as tomb from worlds where player_id = $1 and world_id = $2 for update', [pid, id]);
      const same = () => ({ json: { rev: row.rev }, headers: { ETag: etag(row.rev) } });
      if (row && !row.tomb) {
        if (side) {
          if (updatedAt < row.client_updated_at) return same(); // the newest copy wins
        } else if (ifMatch !== row.rev) {
          if (updatedAt === row.client_updated_at) return same();
          throw httpError(409, 'conflict', { rev: row.rev, updatedAt: row.client_updated_at });
        }
      } else if (row && row.tomb && !(updatedAt > ms(row.deleted_at))) {
        throw httpError(410, 'deleted');
      }
      // quotas (§3.3)
      if (!row || row.tomb) {
        const n = (await q.one('select count(*) as n from worlds where player_id = $1 and body is not null', [pid])).n;
        if (n >= L.worlds) throw httpError(413, 'quota');
      }
      const mine = (await q.one('select coalesce(sum(stored), 0) as b from worlds where player_id = $1 and world_id <> $2', [pid, id])).b;
      if (mine + body.length > L.playerBytes) throw httpError(413, 'quota');
      const fam = (await q.one(
        'select coalesce(sum(w.stored), 0) as b from worlds w join players p on p.id = w.player_id where p.family_id = $1 and not (w.player_id = $2 and w.world_id = $3)',
        [x.player.family_id, pid, id],
      )).b;
      if (fam + body.length > L.familyBytes) throw httpError(413, 'quota');
      const rev = (row ? row.rev : 0) + 1;
      await q.query(
        `insert into worlds (player_id, world_id, rev, client_updated_at, meta, thumb, body, size, stored, deleted_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, $10)
         on conflict (player_id, world_id) do update set rev = excluded.rev, client_updated_at = excluded.client_updated_at,
           meta = excluded.meta, thumb = excluded.thumb, body = excluded.body, size = excluded.size, stored = excluded.stored,
           deleted_at = null, updated_at = excluded.updated_at`,
        [pid, id, rev, updatedAt, JSON.stringify(meta), thumb, body, size, body.length, now(x)],
      );
      return { json: { rev }, headers: { ETag: etag(rev) } };
    });
  }

  async function deleteWorld(req, x) {
    const id = wid(x);
    await mayWrite(x);
    const pid = x.player.id;
    const r = await ctx.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [lockKey(pid, id)]);
      const row = await q.one('select rev, body is null as tomb from worlds where player_id = $1 and world_id = $2 for update', [pid, id]);
      if (row && row.tomb) return { json: { rev: row.rev } };
      if (!row) {
        // a world the server never had (made and deleted while away): a tombstone, while
        // there are not too many of them (every other device then knows it is gone)
        const n = (await q.one('select count(*) as n from worlds where player_id = $1 and body is null', [pid])).n;
        if (n >= lim().tombs) return { json: { rev: 0 } };
      }
      const rev = (row ? row.rev : 0) + 1;
      // a tombstone: other devices learn about the delete (§3.3); kept 30 days (jobs.mjs). It
      // holds no world content: no body, no picture, and no meta (the name she typed, the biome)
      await q.query(
        `insert into worlds (player_id, world_id, rev, client_updated_at, meta, thumb, body, size, stored, deleted_at, updated_at)
         values ($1, $2, $3, $4, '{}'::jsonb, null, null, 0, 0, $5, $5)
         on conflict (player_id, world_id) do update set rev = excluded.rev, client_updated_at = excluded.client_updated_at,
           meta = '{}'::jsonb, thumb = null, body = null, size = 0, stored = 0,
           deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`,
        [pid, id, rev, x.now, now(x)],
      );
      return { json: { rev }, journal: !!row };
    });
    // the restore runbook re-applies this delete from the journal (§3.4, §13.4): ids only
    if (r.journal) ctx.log(`deletion-journal world=${pid}/${id}`);
    return { json: r.json };
  }

  // ---------------------------------------------------------------------------------------
  // the head portrait (the picker, the Family page)

  async function putPortrait(req, x) {
    const png = decodeDataUrl(x.body.png, PNG_PREFIX, lim().portraitBytes, PNG_SIG);
    const row = await ctx.db.one('update players set portrait = $2, portrait_rev = portrait_rev + 1, updated_at = $3 where id = $1 returning portrait_rev', [x.player.id, png, now(x)]);
    if (!row) throw httpError(410, 'player_gone');
    return { json: { rev: row.portrait_rev } };
  }

  async function getPortrait(req, x) {
    const row = await ctx.db.one('select portrait from players where id = $1', [x.player.id]);
    if (!row || !row.portrait) throw httpError(404, 'not_found');
    return { body: row.portrait, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' } };
  }

  const P = '/api/players/:pid';
  return [
    { method: 'GET', path: P + '/profile', who: 'player', handler: getProfile },
    { method: 'PUT', path: P + '/profile', who: 'player', body: { kind: 'json', max: SAVES_LIMITS.profileBytes + 4 * KB }, limit: PUT_LIMIT, handler: putProfile },
    { method: 'GET', path: P + '/worlds', who: 'player', handler: listWorlds },
    { method: 'GET', path: P + '/worlds/:wid', who: 'player', handler: getWorld },
    { method: 'GET', path: P + '/worlds/:wid/thumb', who: 'player', handler: getThumb },
    { method: 'PUT', path: P + '/worlds/:wid', who: 'player', body: { kind: 'world' }, limit: PUT_LIMIT, handler: putWorld },
    { method: 'DELETE', path: P + '/worlds/:wid', who: 'player', limit: PUT_LIMIT, handler: deleteWorld },
    { method: 'PUT', path: P + '/portrait', who: 'player', body: { kind: 'json', max: 48 * KB }, limit: PORTRAIT_LIMIT, handler: putPortrait },
    { method: 'GET', path: P + '/portrait', who: 'player', handler: getPortrait },
  ];
}
