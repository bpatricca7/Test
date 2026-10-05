// Cloud saves tests (docs/ACCOUNTS.md §12.6, owner C): `npm run test:saves` (node:test; the
// database from tools/testdb.mjs; no network).
//
//   1. the saves API (server/saves.mjs) through the real server: revisions, 409, 410,
//      tombstones, quotas, gzip bombs, validation, entitlement on writes, reads when lapsed,
//      IDOR, the portrait, limits;
//   2. SaveStore (src/core/storage.js) + HttpCloudBackend (src/account/cloud.js) in Node
//      against that server (a localStorage shim, no IndexedDB): retries, reconcile, forks,
//      the profile merge (`net` device-local), tombstones, queued deletes, skipped unchanged
//      pushes, wipe, player_gone, the legacy import (twice → no double coins), a keepsafe
//      backup file;
//   3. the account module's boot in Node (src/account/index.js with a pretend page): its player
//      and namespace, a locked device, signed out forgets the cached player, offline boot until
//      playUntil, a 401 is never offline, no plan = the cloud only read, a player deleted on the
//      Family page is wiped here (410), family_gone wipes every player;
//   4. the relay socket (src/net/ws-transport.js with a fake WebSocket): &p=, canHost, the
//      account close codes 4401-4405 stop retries while opening and mid-session, 1013 retries;
//   5. the game in Chromium (skipped without dist/sparkle-world.html or a Chromium; set
//      SW_SAVES_BROWSER=0 to skip): file:// and a claude.ai stand-in make no /api request, and
//      with accounts on a paired device picks its player, brings in the worlds from before (asked
//      once), saves to the cloud, shows the account rows in Settings, gets a friendly card for
//      4401 and boots offline; `required` shows its cards; no "$" or "subscri" in any of it.
//
// `node tools/test-saves.mjs --measure` instead prints real save sizes (every biome × size, made
// by the built game in Chromium), to keep the caps of §3.3 at 4× the largest or more.
//
// Sessions: auth.mjs (owner A) signs people in; here a pretend session store stands in
// (accounts.ctx.sessions), like the router tests of tools/test-accounts.mjs.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { EventEmitter } from 'node:events';

import { loadConfig } from '../server/config.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { createServer } from '../server/server.mjs';
import { cookieOf } from '../server/http.mjs';
import { SAVES_LIMITS } from '../server/saves.mjs';
import { openTestDb } from './testdb.mjs';
import { SaveStore, forkName, BACKUP_FORMAT, mergeBackupProfile, backupProfile } from '../src/core/storage.js';
import { HttpCloudBackend } from '../src/account/cloud.js';
import { createApi } from '../src/account/api.js';
import { mergeProfile, cloudProfile } from '../src/account/merge.js';
import { findLegacy, importLegacy, legacyState, setLegacyState, expireLegacy } from '../src/account/legacy.js';
import { Account } from '../src/account/index.js';
import { WsTransport } from '../src/net/ws-transport.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEASURE = process.argv.includes('--measure');
// the site's address (PUBLIC_ORIGIN): the browser checks serve the game there, so its writes
// carry the Origin the server wants
const WEB_PORT = await new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});
const ORIGIN = `http://localhost:${WEB_PORT}`;
const DAY = 86400e3;
const ENV = Object.freeze({
  SW_ACCOUNTS: 'optional',
  DATABASE_URL: 'postgresql://sw@127.0.0.1:5432/sw',
  PUBLIC_ORIGIN: ORIGIN,
  SW_SECRET: randomBytes(32).toString('base64'),
  STRIPE_SECRET_KEY: 'sk_test_saves',
  STRIPE_WEBHOOK_SECRET: 'whsec_saves',
  STRIPE_PRICE_ID: 'price_saves',
  MAIL_MODE: 'memory',
  SW_WORLD_MAX_BYTES: String(1024 * 1024),
});

const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64');
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)]);
const PNG = 'data:image/png;base64,' + PNG_BYTES.toString('base64');
const T0 = Date.UTC(2026, 8, 1);

/** A world save as the game makes it (src/core/game.js serializeWorld). */
function mkSave(id, extra = {}) {
  return {
    v: 1, id, name: 'Rainbow Meadow', biome: 'meadow', seed: 7, size: { x: 144, y: 64, z: 144 }, sizeName: 'cozy',
    createdAt: T0, updatedAt: T0 + 1000, palette: ['air', 'grass'], blocks: 'AQID', waterLevel: 0, outside: null,
    spawn: [1, 2, 3], player: { x: 1, y: 2, z: 3, yaw: 0, flying: false }, time: { t: 0, dayTime: 0.3, day: 1 },
    hotbar: { slots: [], colors: [], index: 0 }, systems: { entities: [] }, thumbnail: JPEG, ...extra,
  };
}

/** A localStorage for one pretend device. */
class MemLS {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const onDevice = (ls) => {
  globalThis.window = { localStorage: ls };
  globalThis.localStorage = ls;
};

/**
 * src/account/merge.js mergeProfile as it was at commit 669b6fa (before squishy toys), copied as
 * a fixture: an old cached tab still open on an iPad merges a 409 with this (squish S5).
 */
function oldMergeProfile669(local, server) {
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const when = (v) => (typeof v === 'number' ? v : Date.parse(v) || 0);
  const LOCAL = /^(net|keepsafe|_rev)$/;
  const WALKIE = /^walkie/;
  const maxNumbers = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(isObj(b) ? b : {})) {
      if (typeof v === 'number') out[k] = out[k] >= v ? out[k] : v;
      else if (isObj(v)) out[k] = maxNumbers(out[k], v);
      else if (!(k in out)) out[k] = v;
    }
    return out;
  };
  const union = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(isObj(b) ? b : {})) if (!(k in out) || when(v) < when(out[k])) out[k] = v;
    return out;
  };
  const pick = (p, re, keep) => Object.fromEntries(Object.entries(isObj(p) ? p : {}).filter(([k]) => re.test(k) === keep));
  const cloud = (p) => {
    const out = pick(p, LOCAL, false);
    if (isObj(out.settings)) out.settings = pick(out.settings, WALKIE, false);
    return out;
  };
  if (!isObj(server)) return local;
  if (!isObj(local)) return server;
  const lt = local.updatedAt || 0;
  const st = server.updatedAt || 0;
  const out = JSON.parse(JSON.stringify({ ...cloud(st > lt ? server : local), ...pick(local, LOCAL, true) }));
  delete out._rev;
  out.stickers = union(local.stickers, server.stickers);
  if (local.stickersSeen || server.stickersSeen) out.stickersSeen = union(local.stickersSeen, server.stickersSeen);
  out.stats = maxNumbers(local.stats, server.stats);
  if ('coins' in local || 'coins' in server) out.coins = Math.max(local.coins || 0, server.coins || 0);
  if (local.lookPicked === true || server.lookPicked === true) out.lookPicked = true;
  if (isObj(local.settings)) out.settings = { ...out.settings, ...pick(local.settings, WALKIE, true) };
  out.updatedAt = Math.max(lt, st);
  return out;
}

// ---------------------------------------------------------------------------------------------
// the server: accounts on (optional), a pretend session store, one test database

let t, cfg, accounts, app, base;
const SESS = new Map(); // token -> session
const dir = mkdtempSync(path.join(tmpdir(), 'sw-saves-'));
let seq = 0;

async function startServer() {
  t = await openTestDb();
  cfg = loadConfig(ENV);
  accounts = await createAccounts(cfg, { log: () => {}, db: t.db });
  accounts.ctx.sessions = { fromRequest: async (req) => SESS.get(cookieOf(cfg, req, 'sess')) || null };
  // every request here comes from 127.0.0.1: the address and session limits (120 a minute)
  // would stop the suite, so only the saves' own limits are kept
  const real = accounts.ctx.limits;
  accounts.ctx.limits = { check: (spec, key, n) => (spec.name === 'api-ip' || spec.name === 'api-session' ? { ok: true } : real.check(spec, key, n)), sweep: () => real.sweep() };
  const html = path.join(dir, 'game.html');
  writeFileSync(html, '<!doctype html><title>Glimmer World</title>');
  app = createServer({ accounts, htmlPath: html, siteDir: path.join(dir, 'none'), log: () => {} });
  const port = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
}

const STORES = []; // stopped at the end (their retry timers would keep the process up)

async function stopServer() {
  for (const s of STORES) s.close();
  if (app) await app.close();
  if (t) await t.close();
  rmSync(dir, { recursive: true, force: true });
}

/** A family (entitled by a free pass unless told otherwise) with players. */
async function family({ plan = 'comp', consent = true, players = ['Lily'] } = {}) {
  const now = Date.now();
  const comp = plan === 'comp' ? new Date(now + 30 * DAY) : plan === 'lapsed' ? new Date(now - DAY) : null;
  const f = await t.db.one('insert into families (email, consent_at, comp_until, lapsed_at) values ($1, $2, $3, $4) returning id', [
    `family${++seq}@example.com`, consent ? new Date(now - DAY) : null, comp, plan === 'lapsed' ? new Date(now - DAY) : null,
  ]);
  const ids = [];
  for (const nick of players) ids.push((await t.db.one('insert into players (family_id, nickname) values ($1, $2) returning id', [f.id, nick])).id);
  return { id: f.id, pids: ids };
}

/**
 * GET /api/me as §5.3 says, for the pretend sessions (auth.mjs and family.mjs, owner A, answer
 * it for real).
 */
async function meFor(tok, mode = 'optional') {
  const s = SESS.get(tok);
  if (!s) return { signedIn: false, accounts: mode };
  const e = await accounts.ctx.billing.entitlementFor(s.familyId);
  const rows = (await t.db.query('select id, nickname, color, friends_on, portrait_rev from players where family_id = $1 order by created_at, nickname', [s.familyId])).rows;
  return {
    signedIn: true, kind: s.kind, accounts: mode, friendsMode: 'subscription', plan: { state: e.state, entitled: e.entitled, until: e.until }, consent: e.consent,
    players: rows.map((p) => ({ id: p.id, nickname: p.nickname, color: p.color, portrait: p.portrait_rev ? `/api/players/${p.id}/portrait?v=${p.portrait_rev}` : null, friends: p.friends_on, walkie: false, canJoin: e.entitled, canHost: e.entitled, walkieOk: false, why: null })),
    lockPlayer: s.lockPlayer, playUntil: Date.now() + 7 * DAY,
  };
}

function session(familyId, { kind = 'device', lockPlayer = null } = {}) {
  const tok = randomBytes(18).toString('base64url');
  SESS.set(tok, { hash: Buffer.from(tok), kind, familyId, lockPlayer, elevatedUntil: null, elevatedAt: null });
  return tok;
}

/** One request like the page makes it (Origin, X-SW and JSON on writes, the cookie). */
async function call(method, p, { tok = null, body, headers = {}, gz = false } = {}) {
  const h = { ...headers };
  if (tok) h.cookie = `sw_sess=${tok}`;
  if (method !== 'GET' && method !== 'HEAD') {
    if (!('x-sw' in h)) h['x-sw'] = '1';
    if (!('origin' in h)) h.origin = ORIGIN;
    if (!('content-type' in h)) h['content-type'] = 'application/json';
  }
  let b = body;
  if (b !== undefined && typeof b !== 'string' && !Buffer.isBuffer(b)) b = JSON.stringify(b);
  if (gz && b !== undefined) {
    b = gzipSync(b);
    h['content-encoding'] = 'gzip';
  }
  const r = await fetch(base + p, { method, headers: h, body: b });
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null;
  try {
    data = JSON.parse(buf.toString('utf8'));
  } catch {}
  return { status: r.status, headers: r.headers, data, buf };
}
/** Wait until fn() is true (or ms pass) → whether it was. */
async function until(fn, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (await fn()) return true;
  return false;
}
const W = (pid, id = '') => `/api/players/${pid}/worlds${id ? '/' + encodeURIComponent(id) : ''}`;
const put = (pid, save, tok, match = '*', opts = {}) => call('PUT', W(pid, save.id), { tok, body: save, headers: { 'if-match': match, ...(opts.headers || {}) }, gz: opts.gz });

if (!MEASURE) {
  before(startServer);
  after(stopServer);

  // -------------------------------------------------------------------------------------------

  describe('the saves API (§5.4)', () => {
    test('profile: 204, created with *, ETag, If-Match, 409, the same save again, 428', async () => {
      const f = await family();
      const tok = session(f.id);
      const P = `/api/players/${f.pids[0]}/profile`;
      assert.equal((await call('GET', P, { tok })).status, 204);
      const prof = { v: 1, updatedAt: T0, coins: 5, stickers: { first: '2026-09-01' }, net: { lastHost: { code: ['a'] } }, settings: { music: 0.4, walkie: { on: true } } };
      const r1 = await call('PUT', P, { tok, body: prof, headers: { 'if-match': '*' } });
      assert.deepEqual([r1.status, r1.data], [200, { rev: 1 }]);
      const g = await call('GET', P, { tok });
      assert.equal(g.headers.get('etag'), '"r1"');
      assert.deepEqual(g.data, { v: 1, updatedAt: T0, coins: 5, stickers: { first: '2026-09-01' }, settings: { music: 0.4 } }, 'net and the walkie settings never reach the server');
      assert.deepEqual((await call('PUT', P, { tok, body: { ...prof, updatedAt: T0 + 1 }, headers: { 'if-match': '"r1"' } })).data, { rev: 2 });
      const stale = await call('PUT', P, { tok, body: { ...prof, updatedAt: T0 + 5 }, headers: { 'if-match': '"r1"' } });
      assert.deepEqual([stale.status, stale.data], [409, { error: 'conflict', rev: 2, updatedAt: T0 + 1 }]);
      const again = await call('PUT', P, { tok, body: { ...prof, updatedAt: T0 + 1 }, headers: { 'if-match': '"r1"' } });
      assert.deepEqual([again.status, again.data], [200, { rev: 2 }], 'the very same save again: its revision');
      assert.equal((await call('PUT', P, { tok, body: prof })).status, 428);
      assert.equal((await call('PUT', P, { tok, body: prof, headers: { 'if-match': 'banana' } })).status, 400);
      assert.equal((await call('PUT', P, { tok, body: { v: 1, updatedAt: 3 }, headers: { 'if-match': '*' } })).status, 409, 'a row exists: * is a conflict');
      assert.equal((await call('PUT', P, { tok, body: { ...prof, big: 'x'.repeat(SAVES_LIMITS.profileBytes) }, headers: { 'if-match': '"r2"' } })).status, 413);
    });

    test('worlds: create, list (a picture URL), read (gzip or not), update, 409, the same save again', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const s = mkSave('w1');
      const r1 = await put(pid, s, tok);
      assert.deepEqual([r1.status, r1.data, r1.headers.get('etag')], [200, { rev: 1 }, '"r1"']);
      const list = (await call('GET', W(pid), { tok })).data;
      assert.equal(list.length, 1);
      assert.deepEqual(list[0], {
        id: 'w1', name: 'Rainbow Meadow', biome: 'meadow', size: { x: 144, y: 64, z: 144 }, sizeName: 'cozy', createdAt: T0,
        updatedAt: T0 + 1000, rev: 1, thumbnail: `/api/players/${pid}/worlds/w1/thumb?v=1`,
      });
      const thumb = await call('GET', list[0].thumbnail, { tok });
      assert.deepEqual([thumb.status, thumb.headers.get('content-type'), thumb.headers.get('cache-control')], [200, 'image/jpeg', 'private, max-age=86400']);
      assert.equal(thumb.buf[0], 0xff);
      const g = await call('GET', W(pid, 'w1'), { tok, headers: { 'accept-encoding': 'gzip' } });
      assert.deepEqual([g.status, g.headers.get('content-encoding'), g.headers.get('etag')], [200, 'gzip', '"r1"']);
      assert.deepEqual(g.data, s, 'the save exactly as sent (thumbnail included)');
      const plain = await call('GET', W(pid, 'w1'), { tok, headers: { 'accept-encoding': 'identity' } });
      assert.deepEqual([plain.headers.get('content-encoding'), plain.data.blocks], [null, 'AQID']);
      assert.deepEqual((await put(pid, { ...s, updatedAt: T0 + 2000, blocks: 'BBBB' }, tok, '"r1"')).data, { rev: 2 });
      const c = await put(pid, { ...s, updatedAt: T0 + 3000 }, tok, '"r1"');
      assert.deepEqual([c.status, c.data], [409, { error: 'conflict', rev: 2, updatedAt: T0 + 2000 }]);
      const same = await put(pid, { ...s, updatedAt: T0 + 2000, blocks: 'BBBB' }, tok, '*');
      assert.deepEqual([same.status, same.data], [200, { rev: 2 }]);
      assert.equal((await call('PUT', W(pid, 'w1'), { tok, body: s })).status, 428, 'no If-Match');
      assert.equal((await call('GET', W(pid, 'nope'), { tok })).status, 404);
    });

    test('gzip uploads; a gzip bomb or a world over SW_WORLD_MAX_BYTES is 413', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const s = mkSave('wz', { blocks: 'Q'.repeat(50000) });
      assert.deepEqual((await put(pid, s, tok, '*', { gz: true })).data, { rev: 1 });
      assert.equal((await call('GET', W(pid, 'wz'), { tok })).data.blocks.length, 50000);
      const bomb = await call('PUT', W(pid, 'wb'), { tok, body: gzipSync(Buffer.alloc(3 * 1024 * 1024, 32)), headers: { 'if-match': '*', 'content-encoding': 'gzip' } });
      assert.deepEqual([bomb.status, bomb.data], [413, { error: 'too_big' }]);
      const big = await put(pid, mkSave('wbig', { blocks: 'x'.repeat(1100 * 1024) }), tok);
      assert.deepEqual([big.status, big.data], [413, { error: 'too_big' }]);
      assert.equal((await call('GET', W(pid, 'wb'), { tok })).status, 404, 'nothing stored');
    });

    test('validation: id, name, blocks, size, updatedAt, the picture', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const bad = [
        ['id differs', { ...mkSave('v1'), id: 'v2' }],
        ['name too long', mkSave('v1', { name: 'n'.repeat(81) })],
        ['no blocks', mkSave('v1', { blocks: 5 })],
        ['size too big', mkSave('v1', { size: { x: 144, y: 65, z: 144 } })],
        ['size not whole', mkSave('v1', { size: { x: 1.5, y: 64, z: 144 } })],
        ['no updatedAt', mkSave('v1', { updatedAt: 'soon' })],
        ['a PNG picture', mkSave('v1', { thumbnail: PNG })],
        ['not a JPEG', mkSave('v1', { thumbnail: 'data:image/jpeg;base64,' + Buffer.from('hello').toString('base64') })],
      ];
      for (const [why, s] of bad) {
        const r = await call('PUT', W(pid, 'v1'), { tok, body: s, headers: { 'if-match': '*' } });
        assert.deepEqual([r.status, r.data], [400, { error: 'bad_request' }], why);
      }
      const huge = await put(pid, mkSave('v1', { thumbnail: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(80 * 1024)]).toString('base64') }), tok);
      assert.deepEqual([huge.status, huge.data], [413, { error: 'too_big' }], 'a picture over 72 KB');
      assert.equal((await put(pid, mkSave('bad id!'), tok)).status, 400);
      assert.equal((await put(pid, mkSave('v1', { thumbnail: null }), tok)).status, 200, 'no picture is fine');
      const junk = await put(pid, mkSave('v2', { size: { x: 1, y: 1, z: 1, junk: 'x'.repeat(5000) }, biome: 'b'.repeat(500) }), tok);
      assert.equal(junk.status, 200);
      const m = (await call('GET', W(pid), { tok })).data.find((x) => x.id === 'v2');
      assert.deepEqual([m.size, m.biome], [{ x: 1, y: 1, z: 1 }, undefined], 'the list entry keeps only small, known parts');
    });

    test('tombstones: delete, list, read 410, an older save 410, a newer save brings it back', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      await put(pid, mkSave('t1'), tok);
      const d = await call('DELETE', W(pid, 't1'), { tok, body: {} });
      assert.deepEqual([d.status, d.data], [200, { rev: 2 }]);
      const gone = await t.db.one('select meta, thumb, body, size, stored from worlds where player_id = $1 and world_id = $2', [pid, 't1']);
      assert.deepEqual([gone.meta, gone.thumb, gone.body, gone.size, gone.stored], [{}, null, null, 0, 0], 'a tombstone keeps no world content: not even the name she typed (meta)');
      const tomb = (await call('GET', W(pid), { tok })).data.find((x) => x.id === 't1');
      assert.equal(tomb.deleted, true);
      assert.equal(tomb.rev, 2);
      assert.ok(Math.abs(tomb.updatedAt - Date.now()) < 60e3, 'the delete time');
      assert.deepEqual((await call('GET', W(pid, 't1'), { tok })).data, { error: 'deleted' });
      assert.equal((await call('GET', W(pid, 't1'), { tok })).status, 410);
      const old = await put(pid, mkSave('t1'), tok, '"r1"');
      assert.deepEqual([old.status, old.data], [410, { error: 'deleted' }]);
      assert.deepEqual((await put(pid, mkSave('t1', { updatedAt: Date.now() + 1000 }), tok, '*')).data, { rev: 3 }, 'played after the delete: back');
      assert.deepEqual((await call('DELETE', W(pid, 'never'), { tok, body: {} })).data, { rev: 1 }, 'a tombstone even for a world the server never had');
      assert.deepEqual((await call('DELETE', W(pid, 'never'), { tok, body: {} })).data, { rev: 1 }, 'deleting twice changes nothing');
      const row = await t.db.one('select body, thumb, stored from worlds where player_id = $1 and world_id = $2', [pid, 'never']);
      assert.deepEqual([row.body, row.thumb, row.stored], [null, null, 0]);
      accounts.ctx.savesLimits = { ...SAVES_LIMITS, tombs: 1 };
      try {
        assert.deepEqual((await call('DELETE', W(pid, 'never2'), { tok, body: {} })).data, { rev: 0 }, 'not too many tombstones for worlds it never had');
        assert.equal(await t.db.one("select 1 from worlds where player_id = $1 and world_id = 'never2'", [pid]), null);
      } finally {
        accounts.ctx.savesLimits = null;
      }
    });

    test('side copies (.before, .undo): the newest wins, never a conflict', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const b = mkSave('s1.before', { backupOf: 's1', backupAt: T0 });
      assert.deepEqual((await put(pid, b, tok)).data, { rev: 1 });
      assert.deepEqual((await put(pid, { ...b, updatedAt: T0 + 500, blocks: 'OLD' }, tok, '*')).data, { rev: 1 }, 'older: not stored');
      assert.deepEqual((await put(pid, { ...b, updatedAt: T0 + 5000, blocks: 'NEW' }, tok, '"r7"')).data, { rev: 2 }, 'newer: stored whatever If-Match says');
      assert.equal((await call('GET', W(pid, 's1.before'), { tok })).data.blocks, 'NEW');
      assert.equal((await call('GET', W(pid), { tok })).data[0].backupOf, 's1');
    });

    test('quotas: live worlds and bytes, per player and per family (§3.3)', async () => {
      const f = await family({ players: ['Lily', 'Mia'] });
      const tok = session(f.id);
      const [lily, mia] = f.pids;
      accounts.ctx.savesLimits = { ...SAVES_LIMITS, worlds: 2 };
      try {
        await put(lily, mkSave('q1'), tok);
        await put(lily, mkSave('q1.before'), tok);
        const third = await put(lily, mkSave('q2'), tok);
        assert.deepEqual([third.status, third.data], [413, { error: 'quota' }], 'side copies count');
        assert.equal((await put(lily, { ...mkSave('q1'), updatedAt: T0 + 9000 }, tok, '"r1"')).status, 200, 'updating one she has is fine');
        await call('DELETE', W(lily, 'q1.before'), { tok, body: {} });
        assert.equal((await put(lily, mkSave('q2'), tok)).status, 200, 'tombstones do not count');
        const big = { ...mkSave('b1', { blocks: randomBytes(30000).toString('base64') }) };
        accounts.ctx.savesLimits = { ...SAVES_LIMITS, playerBytes: 30000 };
        assert.deepEqual((await put(mia, big, tok)).data, { error: 'quota' });
        accounts.ctx.savesLimits = { ...SAVES_LIMITS, familyBytes: 50000 };
        assert.equal((await put(mia, big, tok)).status, 200);
        assert.deepEqual((await put(lily, { ...big, id: 'b2' }, tok)).data, { error: 'quota' }, 'the family total counts every player');
      } finally {
        accounts.ctx.savesLimits = null;
      }
    });

    test('writes need the plan (and consent); reads work without it; the portrait needs no plan', async () => {
      for (const plan of ['none', 'lapsed']) {
        const f = await family({ plan });
        const tok = session(f.id);
        const pid = f.pids[0];
        // a world kept from when the plan was good
        await t.db.query("insert into worlds (player_id, world_id, rev, client_updated_at, meta, body, size, stored) values ($1, 'kept', 1, $2, $3, $4, 10, 10)", [
          pid, T0, JSON.stringify({ id: 'kept', name: 'Kept' }), gzipSync(JSON.stringify(mkSave('kept'))),
        ]);
        for (const r of [
          await put(pid, mkSave('n1'), tok),
          await call('PUT', `/api/players/${pid}/profile`, { tok, body: { updatedAt: 1 }, headers: { 'if-match': '*' } }),
          await call('DELETE', W(pid, 'kept'), { tok, body: {} }),
        ]) assert.deepEqual([r.status, r.data], [403, { error: 'not_entitled' }], plan);
        assert.equal((await call('GET', W(pid), { tok })).data[0].name, 'Kept', 'a lapsed child still sees her worlds');
        assert.equal((await call('GET', W(pid, 'kept'), { tok })).data.id, 'kept');
        assert.equal((await call('PUT', `/api/players/${pid}/portrait`, { tok, body: { png: PNG } })).status, 200);
      }
      const nc = await family({ consent: false });
      assert.deepEqual((await put(nc.pids[0], mkSave('n1'), session(nc.id))).data, { error: 'consent_required' });
    });

    test('who may: another family 404, a locked device, a deleted player 410, signed out 401', async () => {
      const a = await family({ players: ['Lily', 'Mia'] });
      const b = await family();
      const tokA = session(a.id);
      const tokB = session(b.id);
      await put(a.pids[0], mkSave('mine'), tokA);
      for (const r of [
        await call('GET', W(a.pids[0]), { tok: tokB }),
        await call('GET', W(a.pids[0], 'mine'), { tok: tokB }),
        await put(a.pids[0], mkSave('x'), tokB),
        await call('GET', `/api/players/${a.pids[0]}/portrait`, { tok: tokB }),
      ]) assert.deepEqual([r.status, r.data], [404, { error: 'not_found' }]);
      const locked = session(a.id, { lockPlayer: a.pids[1] });
      assert.equal((await call('GET', W(a.pids[0]), { tok: locked })).status, 404);
      assert.equal((await call('GET', W(a.pids[1]), { tok: locked })).status, 200);
      assert.equal((await call('GET', W(a.pids[0]))).status, 401);
      await t.db.query('delete from players where id = $1', [a.pids[0]]);
      const gone = await call('GET', W(a.pids[0]), { tok: tokA });
      assert.deepEqual([gone.status, gone.data], [410, { error: 'player_gone' }]);
      assert.equal((await call('GET', '/api/players/not-a-uuid/worlds', { tok: tokA })).status, 404);
      assert.equal((await t.db.one('select count(*) as n from worlds where player_id = $1', [a.pids[0]])).n, 0, 'her worlds went with her');
    });

    test('portrait: a PNG of at most 32 KB, with revisions', async () => {
      const f = await family();
      const tok = session(f.id);
      const P = `/api/players/${f.pids[0]}/portrait`;
      assert.equal((await call('GET', P, { tok })).status, 404);
      assert.deepEqual((await call('PUT', P, { tok, body: { png: PNG } })).data, { rev: 1 });
      assert.deepEqual((await call('PUT', P, { tok, body: { png: PNG } })).data, { rev: 2 });
      const g = await call('GET', P, { tok });
      assert.deepEqual([g.status, g.headers.get('content-type'), g.headers.get('cache-control')], [200, 'image/png', 'private, max-age=86400']);
      assert.ok(g.buf.equals(PNG_BYTES));
      assert.equal((await call('PUT', P, { tok, body: { png: JPEG } })).status, 400);
      assert.equal((await call('PUT', P, { tok, body: { png: 'data:image/png;base64,' + Buffer.from('not a png at all').toString('base64') } })).status, 400);
      const big = 'data:image/png;base64,' + Buffer.concat([PNG_BYTES, Buffer.alloc(33 * 1024)]).toString('base64');
      assert.equal((await call('PUT', P, { tok, body: { png: big } })).status, 413);
    });

    test('limits: world PUTs per player (12 a minute, 20 at once)', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      let n = 0;
      let limited = null;
      for (let i = 0; i < 24 && !limited; i++) {
        const r = await put(pid, mkSave('r' + i), tok);
        if (r.status === 429) limited = r;
        else n++;
      }
      assert.equal(n, 20);
      assert.deepEqual(limited.data, { error: 'rate' });
      assert.ok(+limited.headers.get('retry-after') >= 1);
    });

    test('writes carry X-SW and the site Origin (§4.7)', async () => {
      const f = await family();
      const tok = session(f.id);
      assert.equal((await put(f.pids[0], mkSave('c1'), tok, '*', { headers: { 'x-sw': '' } })).status, 403);
      assert.equal((await put(f.pids[0], mkSave('c1'), tok, '*', { headers: { origin: 'https://evil.example' } })).status, 403);
      assert.equal((await call('GET', W(f.pids[0]), { tok, headers: { 'x-sw': '' } })).status, 200, 'reads need neither');
    });
  });

  // -------------------------------------------------------------------------------------------

  describe('mergeProfile (§7.4)', () => {
    test('the newer gives the base; stickers joined (earliest date), stats and coins the bigger; net and walkie stay here', () => {
      const local = {
        updatedAt: 10, look: { hair: 'a' }, coins: 30, stickers: { a: '2026-09-02', b: '2026-09-05' }, stats: { blocksPlaced: 5, recipesCooked: { cake: 2 } },
        basket: { apple: 1 }, net: { lastJoin: { code: ['x'] } }, keepsafe: { persisted: true }, settings: { music: 0.1, walkie: { on: true }, walkieLock: 9 },
      };
      const server = { updatedAt: 20, look: { hair: 'b' }, coins: 12, stickers: { a: '2026-09-01', c: '2026-09-03' }, stats: { blocksPlaced: 3, gems: 4, recipesCooked: { cake: 1, pie: 3 } }, basket: { pear: 2 }, settings: { music: 0.9 } };
      const m = mergeProfile(local, server);
      assert.deepEqual(m.look, { hair: 'b' }, 'the newer copy (the server) gives the look');
      assert.deepEqual(m.basket, { pear: 2 });
      assert.deepEqual(m.stickers, { a: '2026-09-01', b: '2026-09-05', c: '2026-09-03' });
      assert.deepEqual(m.stats, { blocksPlaced: 5, gems: 4, recipesCooked: { cake: 2, pie: 3 } });
      assert.equal(m.coins, 30);
      assert.deepEqual(m.net, local.net);
      assert.deepEqual(m.keepsafe, local.keepsafe);
      assert.deepEqual(m.settings, { music: 0.9, walkie: { on: true }, walkieLock: 9 });
      assert.equal(m.updatedAt, 20);
      assert.deepEqual(cloudProfile(m).settings, { music: 0.9 });
      assert.equal(cloudProfile(m).net, undefined);
      assert.deepEqual(mergeProfile(m, server).coins, 30, 'merging again adds nothing');
    });
    test('lookPicked stays once either copy has it (the Dress Up nudge never comes back)', () => {
      const a = { updatedAt: 10, look: { hair: 'a' }, lookPicked: true };
      const b = { updatedAt: 20, look: { hair: 'a' } };
      assert.equal(mergeProfile(a, b).lookPicked, true, 'the older local copy had it');
      assert.equal(mergeProfile(b, a).lookPicked, true, 'the older server copy had it');
      assert.equal(mergeProfile(b, { updatedAt: 5 }).lookPicked, undefined, 'neither: not made up');
    });
    // squishy toys (the squish team doc §14.4): no toy is ever lost to a merge
    test('S1 squish toys are joined (the earliest date kept) whichever copy is newer', () => {
      const local = { updatedAt: 10, squish: { v: 1, got: { pf_dino: '2026-10-02', st_heart: '2026-10-05' }, glit: {}, seen: {} } };
      const server = { updatedAt: 20, squish: { v: 1, got: { pf_dino: '2026-10-01', pf_strawberry: '2026-10-03' }, glit: { pf_dino: '2026-10-04' }, seen: { pf_dino: 1 } } };
      for (const m of [mergeProfile(local, server), mergeProfile(server, local)]) {
        assert.deepEqual(m.squish.got, { pf_dino: '2026-10-01', st_heart: '2026-10-05', pf_strawberry: '2026-10-03' });
        assert.deepEqual(m.squish.glit, { pf_dino: '2026-10-04' });
        assert.deepEqual(m.squish.seen, { pf_dino: 1 });
      }
    });
    test('S2 a real milestone start beats a provisional one, even an earlier one; two real: the earliest; a missing one is not made up', () => {
      const prov = { updatedAt: 30, squish: { v: 1, got: {}, base: { coins: 120, at: '2026-09-01T00:00:00Z', prov: 1 } } };
      const real = { updatedAt: 10, squish: { v: 1, got: {}, base: { coins: 1820, at: '2026-10-01T00:00:00Z' } } };
      assert.deepEqual(mergeProfile(prov, real).squish.base, real.squish.base);
      assert.deepEqual(mergeProfile(real, prov).squish.base, real.squish.base);
      const early = { updatedAt: 5, squish: { base: { coins: 0, at: '2026-09-15T00:00:00Z' } } };
      assert.deepEqual(mergeProfile(real, early).squish.base, early.squish.base, 'two real: the earliest');
      assert.equal(mergeProfile({ updatedAt: 1, squish: { got: {} } }, { updatedAt: 2, squish: { got: {} } }).squish.base, undefined);
    });
    test('S3 a server copy without squish never removes toys', () => {
      const mine = { updatedAt: 10, coins: 150, squish: { v: 1, got: { pf_whale: '2026-10-02' } } };
      const m = mergeProfile(mine, { updatedAt: 99, coins: 160 });
      assert.deepEqual(Object.keys(m.squish.got), ['pf_whale']);
      assert.equal(m.coins, 160);
    });
    // ocean (docs/teams/ocean.md §13.3): the sea counters live inside stats and merge key by key
    test('M1 sea counters: stats.seaMet joins by maximum, the ride and coin counters take the max (either copy newer)', () => {
      const local = { updatedAt: 10, stats: { seaMet: { dolphin: 3, fish: 1 }, dolphinRides: 2, seaCoinDay: 20261004, seaCoinMask: 5 } };
      const server = { updatedAt: 20, stats: { seaMet: { dolphin: 1, crab: 2 }, dolphinRides: 4, seaCoinDay: 20261003, seaCoinMask: 513 } };
      for (const [a, b] of [[local, server], [server, local], [{ ...local, updatedAt: 30 }, server]]) {
        const m = mergeProfile(a, b);
        assert.deepEqual(m.stats.seaMet, { dolphin: 3, fish: 1, crab: 2 });
        assert.equal(m.stats.dolphinRides, 4);
        assert.equal(m.stats.seaCoinDay, 20261004);
        assert.equal(m.stats.seaCoinMask, 513);
      }
      const old = mergeProfile({ updatedAt: 5, stats: { gems: 2 } }, local);
      assert.deepEqual(old.stats.seaMet, { dolphin: 3, fish: 1 }, 'an old copy without sea counters loses nothing');
    });
    test('M2 sea counters: a backup joins them by maximum; an old backup without seaMet leaves them alone', () => {
      const current = { stats: { seaMet: { dolphin: 3, fish: 1 }, dolphinRides: 2 } };
      assert.equal(mergeBackupProfile(current, { stats: { seaMet: { dolphin: 1, crab: 2 }, dolphinRides: 5, seaCoinDay: 20261004 } }), true);
      assert.deepEqual(current.stats.seaMet, { dolphin: 3, fish: 1, crab: 2 });
      assert.equal(current.stats.dolphinRides, 5);
      assert.equal(current.stats.seaCoinDay, 20261004);
      const before = JSON.stringify(current);
      mergeBackupProfile(current, { stats: { gems: 0 } });
      assert.deepEqual(JSON.parse(before).stats.seaMet, current.stats.seaMet, 'an old backup leaves seaMet alone');
      assert.deepEqual(backupProfile({ stats: { seaMet: { whale: 1 } } }).stats, { seaMet: { whale: 1 } }, 'stats (with the sea counters) are in a backup');
    });
    test('forkName: "<name> (copy)" in at most 80 characters', () => {
      assert.equal(forkName('Castle'), 'Castle (copy)');
      assert.equal(forkName('x'.repeat(80)).length, 80);
      assert.equal(forkName(''), 'My World (copy)');
    });
  });

  // -------------------------------------------------------------------------------------------

  describe('SaveStore + HttpCloudBackend (§7.2, §7.3)', () => {
    /** A pretend device: its localStorage, and a fetch that can fail or count. */
    function device() {
      const dev = { ls: new MemLS(), down: false, failPuts: 0, log: [] };
      dev.fetch = async (url, opts = {}) => {
        const u = new URL(url);
        dev.log.push(`${opts.method || 'GET'} ${u.pathname}`);
        if (dev.down) throw new TypeError('fetch failed');
        if (dev.failPuts > 0 && opts.method === 'PUT') {
          dev.failPuts--;
          throw new TypeError('fetch failed');
        }
        return fetch(url, opts);
      };
      return dev;
    }
    async function open(dev, pid, tok, o = {}) {
      onDevice(dev.ls);
      const api = createApi({ base, fetch: dev.fetch, headers: { cookie: `sw_sess=${tok}`, origin: ORIGIN } });
      const cloud = new HttpCloudBackend(pid, { api, onGone: o.onGone });
      const store = new SaveStore().configure({ ns: 'p-' + pid, cloud, mergeProfile: o.merge || mergeProfile, readOnly: !!o.readOnly });
      STORES.push(store);
      await store.init();
      await store.reconciled;
      return store;
    }
    const serverWorld = async (pid, id) => t.db.one('select rev, client_updated_at, body is null as tomb from worlds where player_id = $1 and world_id = $2', [pid, id]);
    const puts = (dev) => dev.log.filter((l) => l.startsWith('PUT')).length;

    test('a world pushed from one device lists and loads on another (which keeps it with its revision)', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const a = await open(A, pid, tok);
      assert.equal(a.backendName, 'localStorage+cloud');
      assert.equal(a.lsPrefix, `sparkle-world@p-${pid}:`);
      const res = await a.saveWorld(mkSave('w1', { updatedAt: Date.now() }));
      assert.equal(res.ok, true);
      await a.flush();
      assert.equal((await serverWorld(pid, 'w1')).rev, 1);
      assert.deepEqual(JSON.parse(A.ls.getItem(`sparkle-world@p-${pid}:revs`)), { w1: 1 });
      assert.ok(A.log.includes(`PUT /api/players/${pid}/worlds/w1`));
      const B = device();
      const b = await open(B, pid, tok);
      assert.deepEqual((await b.listWorlds()).map((m) => m.id), ['w1']);
      const w = await b.loadWorld('w1');
      assert.equal(w.blocks, 'AQID');
      assert.equal(w._rev, undefined);
      assert.deepEqual(JSON.parse(B.ls.getItem(`sparkle-world@p-${pid}:revs`)), { w1: 1 });
      assert.ok(B.ls.getItem(`sparkle-world@p-${pid}:world:w1`), 'kept on this device too');
      assert.equal(A.ls.getItem('sparkle-world:metas'), null, 'nothing under the names from before accounts');
    });

    test('a failed push is kept and tried again; a refusal (no plan) makes the cloud read-only', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const a = await open(A, pid, tok);
      A.failPuts = 2;
      await a.saveWorld(mkSave('r1', { updatedAt: Date.now() }));
      await a.flush();
      assert.equal(a._pendingWorlds.has('r1'), true, 'put back');
      assert.equal(a._timers.has('r1'), true, 'a retry is scheduled');
      assert.equal(a._retries.get('r1'), 1);
      assert.equal(a.cloudWritable, false);
      await a.flush();
      assert.equal(a._retries.get('r1'), 2);
      await a.flush();
      assert.equal((await serverWorld(pid, 'r1')).rev, 1, 'the third try got through');
      assert.equal(a.cloudWritable, true);
      assert.equal(a._retries.has('r1'), false);
      const n = await family({ plan: 'none' });
      const N = device();
      const s = await open(N, n.pids[0], session(n.id));
      const r = await s.saveWorld(mkSave('n1', { updatedAt: Date.now() }));
      await s.flush();
      assert.equal(s.cloudReadOnly, true);
      assert.equal(s.backendName, 'localStorage+cloud(read-only)');
      assert.equal(r.ok, true);
      assert.equal((await s.loadWorld('n1')).id, 'n1', 'saved on the device');
      const before = N.log.length;
      await s.saveWorld(mkSave('n1', { updatedAt: Date.now() + 5 }));
      await s.flush();
      assert.equal(N.log.length, before, 'no more requests');
    });

    test('reconcile after init: pushes what the cloud lacks or has older, learns equal revisions', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      let a = await open(A, pid, tok);
      await a.saveWorld(mkSave('k1', { updatedAt: Date.now() - 5000 }));
      await a.flush();
      A.down = true;
      await a.saveWorld(mkSave('k2', { updatedAt: Date.now() })); // made offline
      a.journalWorld(mkSave('k1', { updatedAt: Date.now(), blocks: 'JOURNAL' })); // the page went away
      await a.flush();
      A.down = false;
      A.ls.removeItem(`sparkle-world@p-${pid}:revs`); // even without the revisions map
      A.log.length = 0;
      a = await open(A, pid, tok);
      await a.flush();
      assert.equal((await serverWorld(pid, 'k2')).rev, 1, 'the offline world went up');
      const k1 = await t.db.one("select rev from worlds where player_id = $1 and world_id = 'k1'", [pid]);
      assert.equal(k1.rev, 1, 'k1 kept its revision: pushed with * it was a conflict...');
      const names = (await a.listWorlds()).map((m) => m.name).sort();
      assert.deepEqual(names, ['Rainbow Meadow', 'Rainbow Meadow', 'Rainbow Meadow (copy)'], '...so the journal copy became a copy, nothing lost');
      const B = device();
      const b = await open(B, pid, tok);
      await b.loadWorld('k2');
      const bb = await open(B, pid, tok);
      assert.equal(bb._revs.get('k2'), 1);
      assert.equal(B.log.filter((l) => l.startsWith('PUT')).length, 0, 'equal copies: nothing to push');
    });

    test('a world deleted on another device goes here too and is never listed; a newer one here comes back', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const B = device();
      const a = await open(A, pid, tok);
      const t0 = Date.now() - 60000;
      await a.saveWorld(mkSave('d1', { updatedAt: t0 }));
      await a.saveWorld(mkSave('d2', { updatedAt: t0 }));
      await a.flush();
      const b = await open(B, pid, tok);
      await b.loadWorld('d1');
      await b.loadWorld('d2');
      await a.deleteWorld('d1');
      await a.deleteWorld('d2');
      await a.flush();
      assert.equal((await serverWorld(pid, 'd1')).tomb, true);
      // B played d2 after the delete (its clock): kept and pushed back; d1 goes
      onDevice(B.ls);
      await b.saveWorld({ ...(await b.loadWorld('d2') || mkSave('d2')), updatedAt: Date.now() + 1000 });
      const b2 = await open(B, pid, tok);
      await b2.flush();
      assert.deepEqual((await b2.listWorlds()).map((m) => m.id), ['d2']);
      assert.equal(await b2.loadWorld('d1'), null);
      assert.equal(B.ls.getItem(`sparkle-world@p-${pid}:world:d1`), null, 'the local copy is gone');
      assert.equal((await serverWorld(pid, 'd2')).tomb, false, 'played after the delete: back');
    });

    test('deletes wait for the server when it is away (and the world never comes back meanwhile)', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      let a = await open(A, pid, tok);
      await a.saveWorld(mkSave('q1', { updatedAt: Date.now() }));
      await a.flush();
      A.down = true;
      await a.deleteWorld('q1');
      await a.flush();
      assert.deepEqual(JSON.parse(A.ls.getItem(`sparkle-world@p-${pid}:dels`)), ['q1']);
      assert.deepEqual(await a.listWorlds(), []);
      A.down = false;
      a = await open(A, pid, tok);
      assert.deepEqual(await a.listWorlds(), [], 'not listed from the cloud while queued');
      await a.flush();
      assert.equal((await serverWorld(pid, 'q1')).tomb, true);
      assert.deepEqual(JSON.parse(A.ls.getItem(`sparkle-world@p-${pid}:dels`)), []);
    });

    test('a conflict keeps both: "<name> (copy)" pushed as new, the server version brought here', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const B = device();
      const a = await open(A, pid, tok);
      await a.saveWorld(mkSave('c1', { updatedAt: Date.now() - 10000, name: 'Castle' }));
      await a.flush();
      const b = await open(B, pid, tok);
      await b.loadWorld('c1');
      onDevice(A.ls);
      await a.saveWorld(mkSave('c1', { updatedAt: Date.now() - 5000, name: 'Castle', blocks: 'FROM-A' }));
      await a.flush();
      const forks = [];
      b.onFork((e) => forks.push(e));
      onDevice(B.ls);
      await b.saveWorld(mkSave('c1', { updatedAt: Date.now(), name: 'Castle', blocks: 'FROM-B' }));
      await b.flush();
      await b.flush();
      assert.equal(forks.length, 1);
      assert.match(forks[0].to, /^c1~[a-z0-9]{4}$/);
      assert.deepEqual([forks[0].from, forks[0].name], ['c1', 'Castle (copy)']);
      const list = await b.listWorlds();
      assert.deepEqual(list.map((m) => m.name).sort(), ['Castle', 'Castle (copy)']);
      assert.equal((await b.loadWorld('c1')).blocks, 'FROM-A', 'the server version is here');
      assert.equal((await b.loadWorld(forks[0].to)).blocks, 'FROM-B', 'her own is the copy');
      const rows = (await t.db.query('select world_id from worlds where player_id = $1 order by 1', [pid])).rows.map((r) => r.world_id);
      assert.deepEqual(rows, ['c1', forks[0].to]);
      // a save of the old id while the fork is being made goes to the fork
      assert.equal(b._revs.get('c1'), 2);
    });

    test('the profile: a conflict merges (stickers joined, coins the bigger, net stays here)', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const B = device();
      const a = await open(A, pid, tok);
      await a.saveProfile({ v: 1, updatedAt: Date.now() - 10000, coins: 10, stickers: { a: '2026-09-01' }, net: { lastHost: { code: ['A'] } } });
      await a.flush();
      const b = await open(B, pid, tok);
      const pb = await b.loadProfile();
      assert.equal(pb.coins, 10);
      assert.equal(pb.net, undefined, 'another device never sees her net memory');
      onDevice(A.ls);
      await a.saveProfile({ ...(await a.loadProfile()), updatedAt: Date.now() - 5000, coins: 50, stickers: { a: '2026-09-01', fromA: '2026-09-10' } });
      await a.flush();
      const merged = [];
      b.onProfile((p) => merged.push(p));
      onDevice(B.ls);
      await b.saveProfile({ ...pb, updatedAt: Date.now(), coins: 20, stickers: { a: '2026-09-01', fromB: '2026-09-11' }, net: { lastJoin: { code: ['B'] } } });
      await b.flush();
      await b.flush();
      assert.equal(merged.length, 1);
      assert.deepEqual(Object.keys(merged[0].stickers).sort(), ['a', 'fromA', 'fromB']);
      assert.equal(merged[0].coins, 50);
      assert.deepEqual(merged[0].net, { lastJoin: { code: ['B'] } });
      const onServer = (await call('GET', `/api/players/${pid}/profile`, { tok })).data;
      assert.deepEqual([Object.keys(onServer.stickers).sort(), onServer.coins, onServer.net], [['a', 'fromA', 'fromB'], 50, undefined]);
      // A's next boot merges the server's into its own
      const a2 = await open(A, pid, tok);
      const pa = await a2.loadProfile();
      assert.deepEqual([Object.keys(pa.stickers).sort(), pa.coins, pa.net], [['a', 'fromA', 'fromB'], 50, { lastHost: { code: ['A'] } }]);
    });

    test('S3 a conflict (409) with a server copy without squish keeps her toys', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const B = device();
      const a = await open(A, pid, tok);
      await a.saveProfile({ v: 1, updatedAt: Date.now() - 10000, coins: 100 });
      await a.flush();
      const b = await open(B, pid, tok);
      const pb = await b.loadProfile();
      onDevice(A.ls);
      await a.saveProfile({ ...(await a.loadProfile()), updatedAt: Date.now() - 5000, coins: 130 }); // newer, no squish
      await a.flush();
      const merged = [];
      b.onProfile((p) => merged.push(p));
      onDevice(B.ls);
      await b.saveProfile({ ...pb, updatedAt: Date.now(), coins: 120, squish: { v: 1, got: { pf_dino: '2026-10-04' }, glit: {}, seen: {} } });
      await b.flush();
      await b.flush();
      assert.equal(merged.length, 1, 'a 409 was merged');
      assert.deepEqual(Object.keys(merged[0].squish.got), ['pf_dino']);
      const onServer = (await call('GET', `/api/players/${pid}/profile`, { tok })).data;
      assert.deepEqual([Object.keys(onServer.squish.got), onServer.coins], [['pf_dino'], 130]);
    });

    test('S4 the server keeps the stored squish when a profile without it comes in', async () => {
      const f = await family();
      const tok = session(f.id);
      const P = `/api/players/${f.pids[0]}/profile`;
      const squish = { v: 1, got: { pf_strawberry: '2026-10-04' }, glit: {}, seen: {}, base: { coins: 0, at: '2026-10-04T00:00:00.000Z' } };
      assert.equal((await call('PUT', P, { tok, body: { v: 1, updatedAt: T0, coins: 150, squish }, headers: { 'if-match': '*' } })).status, 200);
      assert.equal((await call('PUT', P, { tok, body: { v: 1, updatedAt: T0 + 1, coins: 160 }, headers: { 'if-match': '"r1"' } })).status, 200);
      const g = (await call('GET', P, { tok })).data;
      assert.deepEqual([g.coins, g.squish], [160, squish], 'the new coins, the stored toys');
      // a profile that has squish replaces it as usual (the union happened on the device)
      const more = { ...squish, got: { ...squish.got, pf_dino: '2026-10-05' } };
      assert.equal((await call('PUT', P, { tok, body: { v: 1, updatedAt: T0 + 2, coins: 160, squish: more }, headers: { 'if-match': '"r2"' } })).status, 200);
      assert.deepEqual((await call('GET', P, { tok })).data.squish, more);
      // a fresh row without squish: nothing is made up
      const f2 = await family();
      const P2 = `/api/players/${f2.pids[0]}/profile`;
      const tok2 = session(f2.id);
      await call('PUT', P2, { tok: tok2, body: { v: 1, updatedAt: T0, coins: 5 }, headers: { 'if-match': '*' } });
      await call('PUT', P2, { tok: tok2, body: { v: 1, updatedAt: T0 + 1, coins: 6 }, headers: { 'if-match': '"r1"' } });
      assert.equal((await call('GET', P2, { tok: tok2 })).data.squish, undefined);
    });

    test('S5 an old tab (the 669b6fa merge) uploads without squish; the new build still has every toy', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const B = device();
      const a = await open(A, pid, tok);
      await a.saveProfile({ v: 1, updatedAt: Date.now() - 20000, coins: 100 });
      await a.flush();
      const b = await open(B, pid, tok, { merge: oldMergeProfile669 }); // the old cached page
      const pb = await b.loadProfile();
      onDevice(A.ls);
      const toys = { v: 1, got: { pf_strawberry: '2026-10-04', pf_dolphin: '2026-10-05' }, glit: {}, seen: {}, base: { coins: 0, at: '2026-10-04T00:00:00.000Z' } };
      await a.saveProfile({ ...(await a.loadProfile()), updatedAt: Date.now() - 10000, coins: 150, squish: toys });
      await a.flush();
      onDevice(B.ls);
      await b.saveProfile({ ...pb, updatedAt: Date.now(), coins: 140, stickers: { old: '2026-10-05' } }); // newer, no squish
      await b.flush();
      await b.flush();
      const onServer = (await call('GET', `/api/players/${pid}/profile`, { tok })).data;
      assert.deepEqual(onServer.squish, toys, 'the server guard kept the toys');
      assert.deepEqual(Object.keys(onServer.stickers || {}), ['old'], "the old tab's own change landed");
      // the new build on either device: every toy is there
      const a2 = await open(A, pid, tok);
      assert.deepEqual(Object.keys((await a2.loadProfile()).squish.got).sort(), ['pf_dolphin', 'pf_strawberry']);
      const b2 = await open(B, pid, tok);
      assert.deepEqual(Object.keys((await b2.loadProfile()).squish.got).sort(), ['pf_dolphin', 'pf_strawberry']);
    });

    test('an unchanged world is not pushed again within 5 minutes; a changed one is', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const a = await open(A, pid, tok);
      const s = mkSave('u1', { updatedAt: Date.now() });
      await a.saveWorld(s);
      await a.flush();
      const n = puts(A);
      await a.saveWorld({ ...s, updatedAt: Date.now() + 1, player: { x: 9, y: 9, z: 9, yaw: 1 }, time: { t: 5, dayTime: 0.5, day: 2 }, hotbar: { slots: ['x'], colors: [], index: 1 } });
      await a.flush();
      assert.equal(puts(A), n, 'only where she stands and the time changed: skipped');
      await a.saveWorld({ ...s, updatedAt: Date.now() + 2, blocks: 'CHANGED' });
      await a.flush();
      assert.equal(puts(A), n + 1);
      await a.saveWorld({ ...s, updatedAt: Date.now() + 3, blocks: 'CHANGED', name: 'Renamed' });
      await a.flush();
      assert.equal(puts(A), n + 2, 'a new name is a change');
    });

    test('wipe removes one namespace only; player_gone calls onGone and stops pushing', async () => {
      const f = await family({ players: ['Lily', 'Mia'] });
      const tok = session(f.id);
      const [lily, mia] = f.pids;
      const A = device();
      A.ls.setItem('sparkle-world:net-device', 'keep-me');
      A.ls.setItem('sparkle-world:metas', '{}');
      const l = await open(A, lily, tok);
      await l.saveWorld(mkSave('l1', { updatedAt: Date.now() }));
      await l.flush();
      const m = await open(A, mia, tok);
      await m.saveWorld(mkSave('m1', { updatedAt: Date.now() }));
      await m.flush();
      onDevice(A.ls);
      await SaveStore.wipe('p-' + mia);
      const keys = [...A.ls.m.keys()];
      assert.ok(keys.some((k) => k.startsWith(`sparkle-world@p-${lily}:`)));
      assert.ok(!keys.some((k) => k.startsWith(`sparkle-world@p-${mia}:`)));
      assert.ok(keys.includes('sparkle-world:net-device') && keys.includes('sparkle-world:metas'));
      assert.equal(await SaveStore.wipe('../../x'), false);
      const gone = [];
      const l2 = await open(A, lily, tok, { onGone: (c) => gone.push(c) });
      await t.db.query('delete from players where id = $1', [lily]);
      await l2.saveWorld(mkSave('l2', { updatedAt: Date.now() }));
      await l2.flush();
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(gone, ['player_gone']);
      assert.equal(l2.cloudReadOnly, true);
    });

    test('the first sign-in brings in the worlds from before (side copies, her things); twice adds nothing', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      onDevice(A.ls);
      // the device as it was before accounts
      const old = SaveStore.legacy();
      await old.init();
      await old.saveWorld(mkSave('old1', { updatedAt: T0 + 1, name: 'Old Castle' }));
      await old.saveWorld(mkSave('old1.before', { updatedAt: T0 + 2, backupOf: 'old1', backupAt: T0 }));
      await old.saveWorld(mkSave('old2', { updatedAt: T0 + 3, name: 'Old Farm' }));
      await old.saveProfile({ v: 1, updatedAt: T0, coins: 40, stickers: { s1: '2026-01-01' }, stats: { blocksPlaced: 99 }, look: { hair: 'curly' }, outfits: [{ a: 1 }, null, null, null, null, null], playerName: 'Lily' });
      const store = await open(A, pid, tok);
      await store.saveWorld(mkSave('old2', { updatedAt: Date.now(), name: 'Her Own' })); // an id she already has
      await store.flush();
      const legacy = await findLegacy();
      assert.deepEqual(legacy.worlds.map((m) => m.id).sort(), ['old1', 'old2']);
      const profile = { v: 1, updatedAt: 0, coins: 0, stickers: {}, stats: { blocksPlaced: 0 }, look: {}, outfits: [null, null, null, null, null, null] };
      const r = await importLegacy(legacy, store, profile);
      assert.deepEqual(r, { worlds: 2, failed: 0 });
      assert.deepEqual([profile.coins, profile.stickers, profile.stats.blocksPlaced, profile.look.hair], [40, { s1: '2026-01-01' }, 99, 'curly']);
      const names = (await store.listWorlds()).map((m) => m.name).sort();
      assert.deepEqual(names, ['Her Own', 'Old Castle', 'Old Farm']);
      assert.deepEqual((await store.listBackups()).map((m) => m.backupOf), ['old1']);
      const onServer = (await t.db.query('select world_id from worlds where player_id = $1 order by 1', [pid])).rows.map((x) => x.world_id);
      assert.equal(onServer.length, 4, 'every world and the side copy are in her cloud');
      const again = await importLegacy(await findLegacy(), store, profile);
      assert.deepEqual(again, { worlds: 0, failed: 0 });
      assert.equal(profile.coins, 40, 'no double coins');
      assert.equal((await store.listWorlds()).length, 3, 'no double worlds');
      setLegacyState({ state: 'imported', to: pid, at: T0 + 2 });
      assert.equal(await expireLegacy(T0 + 40 * DAY), false, 'old2 was played after the import (signed out): they all stay');
      setLegacyState({ state: 'imported', to: pid, at: Date.now() });
      assert.equal(await expireLegacy(Date.now() + 29 * DAY), false, 'kept 30 days');
      assert.equal(await expireLegacy(Date.now() + 31 * DAY), true);
      assert.equal(A.ls.getItem('sparkle-world:metas'), null);
      assert.equal(legacyState().state, 'imported');
      assert.equal(await findLegacy(), null);
      assert.ok([...A.ls.m.keys()].some((k) => k.startsWith(`sparkle-world@p-${pid}:`)), 'her own copy stays');
    });

    test('a keepsafe backup file opened in account mode lands in her cloud', async () => {
      const f = await family();
      const tok = session(f.id);
      const pid = f.pids[0];
      const A = device();
      const store = await open(A, pid, tok);
      const file = JSON.stringify({ format: BACKUP_FORMAT, v: 1, profile: { coins: 3 }, worlds: [mkSave('f1', { name: 'From A File' }), mkSave('f2')] });
      const res = await store.importAll(file);
      assert.deepEqual([res.ok, res.added.length, res.profile.coins], [true, 2, 3]);
      await store.flush();
      assert.equal((await t.db.one('select count(*) as n from worlds where player_id = $1', [pid])).n, 2);
    });
  });

  // -------------------------------------------------------------------------------------------

  describe('the account module boot (§7.1, §7.8), in Node', () => {
    const realFetch = globalThis.fetch;
    after(() => {
      globalThis.fetch = realFetch;
      delete globalThis.location;
    });

    /**
     * A pretend /play page on a device: its location, a fetch with the device's cookie, and
     * GET /api/me from meFor() (or o.me = { status, body }). → { game, pg: { reqs, down } }
     */
    function page(ls, o = {}) {
      onDevice(ls);
      globalThis.window.location = globalThis.location = { protocol: 'http:', search: '', host: new URL(ORIGIN).host };
      const pg = { reqs: [], down: !!o.down };
      globalThis.fetch = async (url, opts = {}) => {
        const u = new URL(url, base);
        pg.reqs.push(`${opts.method || 'GET'} ${u.pathname}`);
        if (pg.down) throw new TypeError('fetch failed');
        if (u.pathname === '/api/me') {
          const r = o.me || { status: 200, body: await meFor(o.tok) };
          return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
        }
        // eslint-disable-next-line no-unused-vars
        const { cache, ...rest } = opts;
        return realFetch(u, { ...rest, headers: { ...(opts.headers || {}), origin: ORIGIN, ...(o.tok ? { cookie: `sw_sess=${o.tok}` } : {}) } });
      };
      const game = { store: new SaveStore(), events: new EventEmitter(), profile: { settings: {} }, saveProfile() {}, ui: null };
      STORES.push(game.store);
      return { game, pg };
    }
    async function boot(ls, o) {
      const { game, pg } = page(ls, o);
      const acct = new Account(game);
      await acct.prepare();
      return { acct, game, pg, cache: () => JSON.parse(ls.getItem('sparkle-world:acct')) };
    }
    const nsKeys = (ls, pid) => [...ls.m.keys()].filter((k) => k.startsWith(`sparkle-world@p-${pid}:`));

    test('one player: her own saves and the cloud; a locked device takes its player; signed out forgets the cache', async () => {
      const f = await family({ players: ['Lily', 'Mia'] });
      const [lily, mia] = f.pids;
      const ls = new MemLS();
      const a = await boot(ls, { tok: session(f.id, { lockPlayer: mia }) });
      assert.deepEqual([a.acct.mode, a.acct.server, a.acct.playerId, a.game.store.dbName], ['account', 'optional', mia, 'sparkle-world@p-' + mia]);
      assert.ok(a.game.store._given instanceof HttpCloudBackend);
      assert.deepEqual([a.cache().last, a.cache().used, a.cache().me.players.map((p) => p.nickname)], [mia, [mia], ['Lily', 'Mia']]);
      assert.deepEqual(a.pg.reqs, ['GET /api/net', 'GET /api/me']);
      const one = await family();
      const b = await boot(new MemLS(), { tok: session(one.id) });
      assert.deepEqual([b.acct.mode, b.acct.playerId, b.acct.canSwitch], ['account', one.pids[0], false], 'the only player: no picker');
      const out = await boot(ls, {});
      assert.deepEqual([out.acct.mode, out.acct.server, out.game.store.dbName, out.acct.grownups], ['local', 'optional', 'sparkle-world', true]);
      assert.equal(out.cache().me, undefined, 'a signed-out device boots nobody offline');
      assert.deepEqual(out.cache().used, [mia], 'but still knows whose copies it holds');
      assert.equal(lily.length, 36);
    });

    test('offline: the cache boots her until playUntil; a 401 is never offline; no plan: the cloud only read', async () => {
      const f = await family();
      const pid = f.pids[0];
      const ls = new MemLS();
      const tok = session(f.id);
      await boot(ls, { tok });
      const off = await boot(ls, { tok, down: true });
      assert.deepEqual([off.acct.mode, off.acct.offline, off.acct.playerId], ['account', true, pid]);
      assert.equal(off.game.store._given.offline, true, 'reads fail at once, writes retry');
      const c = off.cache();
      c.me.playUntil = Date.now() - 1000;
      ls.setItem('sparkle-world:acct', JSON.stringify(c));
      const late = await boot(ls, { tok, down: true });
      assert.equal(late.acct.mode, 'local', 'past playUntil: this device as before (optional)');
      await boot(ls, { tok });
      const revoked = await boot(ls, { tok, me: { status: 401, body: { error: 'signed_out' } } });
      assert.deepEqual([revoked.acct.mode, revoked.cache().me], ['local', undefined]);
      const n = await family({ plan: 'lapsed' });
      const ro = await boot(new MemLS(), { tok: session(n.id) });
      assert.deepEqual([ro.acct.mode, ro.game.store.cloudReadOnly], ['account', true], 'optional without a plan: her saves stay here');
    });

    test('a player deleted on the Family page goes from this device (410); family_gone wipes every player here', async () => {
      const f = await family({ players: ['Lily', 'Mia'] });
      const [lily, mia] = f.pids;
      const other = await family();
      const ls = new MemLS();
      for (const id of [lily, mia, other.pids[0]]) ls.setItem(`sparkle-world@p-${id}:metas`, '{}');
      ls.setItem('sparkle-world:acct', JSON.stringify({ used: [lily, mia, other.pids[0]], last: mia }));
      ls.setItem('sparkle-world:net-device', 'keep-me');
      await t.db.query('delete from players where id = $1', [mia]);
      const tok = session(f.id);
      const a = await boot(ls, { tok });
      assert.equal(a.acct.playerId, lily, 'the one player left');
      assert.ok(await until(() => a.cache().used.length === 1), 'the vanished players are looked up');
      assert.deepEqual([nsKeys(ls, mia), a.cache().used], [[], [lily]], "Mia's copy is gone (410 player_gone)");
      assert.equal(nsKeys(ls, other.pids[0]).length, 1, "another family's player (404) is left alone");
      assert.ok(a.pg.reqs.includes(`GET /api/players/${mia}/profile`));
      const g = await boot(ls, { tok, me: { status: 410, body: { error: 'family_gone' } } });
      assert.equal(g.acct.mode, 'local');
      assert.deepEqual([nsKeys(ls, lily), g.cache().used, g.cache().me], [[], [], undefined]);
      assert.equal(ls.getItem('sparkle-world:net-device'), 'keep-me', "the relay's device id stays");
    });
  });

  // -------------------------------------------------------------------------------------------

  describe('the relay socket with family accounts (§7.7), in Node', () => {
    /** A WebSocket the test drives: frames in, close codes. */
    class FakeWS {
      static all = [];
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        FakeWS.all.push(this);
      }
      send() {}
      close() {
        this.readyState = 3;
      }
      frame(f) {
        this.onmessage({ data: JSON.stringify(f) });
      }
      shut(code) {
        this.readyState = 3;
        this.onclose({ code });
      }
    }
    const PID = '2b6c1e0e-3f7a-4c1e-9d2a-0f5b8f6c7a11';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    /** An open transport (the room's roster arrived). */
    async function opened(o = {}) {
      const tr = new WsTransport({ url: 'ws://relay', uid: 'lily', WebSocket: FakeWS, player: PID, ...o });
      const p = tr.open('room1');
      FakeWS.all.at(-1).frame({ t: 'p', self: 'a1', reset: true, j: [{ kind: 'viewer', peer: 'a1', state: {} }] });
      await p;
      return tr;
    }

    test('&p= goes along, canHost is what /api/me said, 4401-4405 stop retries (opening and mid-session), 1013 retries', async () => {
      FakeWS.all = [];
      const plain = new WsTransport({ url: 'ws://relay', uid: 'x', WebSocket: FakeWS });
      assert.deepEqual(await plain.identity(), { uid: null, canHost: true });
      assert.ok(!plain._urlFor('room1').includes('&p='), 'no player: the URL as before accounts');
      const visitor = new WsTransport({ url: 'ws://relay', uid: 'x', WebSocket: FakeWS, player: PID, canHost: false });
      assert.deepEqual(await visitor.identity(), { uid: null, canHost: false });
      assert.match(visitor._urlFor('room1'), new RegExp(`^ws://relay/r/room1\\?s=[A-Za-z0-9]+&d=dev_x0+&p=${PID}$`));
      assert.ok(!new WsTransport({ url: 'ws://relay', uid: 'x', WebSocket: FakeWS, player: 'x&evil=1' })._urlFor('room1').includes('evil'), 'only a player id');

      // refused while opening: the server's {t:'e'} and its close code; no second try
      for (const [code, err] of [[4401, 'signed_out'], [4402, 'not_entitled'], [4403, 'friends_off'], [4404, 'friends_locked'], [4405, 'player_gone']]) {
        FakeWS.all = [];
        const tr = new WsTransport({ url: 'ws://relay', uid: 'lily', WebSocket: FakeWS, player: PID });
        const p = tr.open('room1');
        FakeWS.all[0].frame({ t: 'e', code: err });
        FakeWS.all[0].shut(code);
        await assert.rejects(p, (e) => e.name === 'NetError' && e.code === err, err);
        await wait(650);
        assert.equal(FakeWS.all.length, 1, `${code}: no retry`);
        const q = new WsTransport({ url: 'ws://relay', uid: 'lily', WebSocket: FakeWS, player: PID });
        const pq = q.open('room1');
        FakeWS.all.at(-1).shut(code); // the close code alone says it too
        await assert.rejects(pq, (e) => e.code === err);
      }

      // mid-session: the friend's switch went off on the Family page (§8.4)
      FakeWS.all = [];
      const tr = await opened();
      const fatal = [];
      tr.onStatus((st) => st.fatal && fatal.push(st.fatal));
      FakeWS.all[0].shut(4403);
      await wait(650);
      assert.deepEqual([fatal, FakeWS.all.length], [['friends_off'], 1], 'its own words, no retries');
      await tr.close();

      // 1013 (the database is down, no cached answer): the page tries again
      FakeWS.all = [];
      const busy = await opened();
      FakeWS.all[0].shut(1013);
      await wait(650);
      assert.equal(FakeWS.all.length, 2, 'retried');
      await busy.close();
    });
  });

  // -------------------------------------------------------------------------------------------

  describe('the game in a browser (§7, §7.10)', { skip: browserSkip() }, () => {
    let browser;
    let web; // the built game, served with accounts and a pretend /api/me
    let mode = 'optional';
    before(async () => {
      const { chromium } = await import('playwright-core');
      const { CHROMIUM, LAUNCH_ARGS } = await import('./smoke.mjs');
      browser = await chromium.launch({ executablePath: CHROMIUM, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP localhost 127.0.0.1'] });
      const handleHttp = (req, res, url) => (url.pathname === '/api/me' ? pretendMe(req, res) : accounts.handleHttp(req, res, url));
      web = createServer({
        accounts: { ...accounts, handleHttp, netInfo: () => ({ accounts: mode, friendsMode: 'subscription' }), close: async () => {} },
        htmlPath: path.join(ROOT, 'dist', 'sparkle-world.html'), siteDir: path.join(dir, 'none'), log: () => {},
      });
      await web.listen(WEB_PORT, '127.0.0.1');
      web.base = ORIGIN;
    });
    after(async () => {
      if (browser) await browser.close();
      if (web) await web.close();
    });

    async function pretendMe(req, res) {
      const me = await meFor(cookieOf(cfg, req, 'sess'), mode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(me));
      return true;
    }

    /** A page; page.apis: the /api requests it made; page.errors: page errors. */
    async function open(url, { tok = null, init = null } = {}) {
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      if (tok) await context.addCookies([{ name: 'sw_sess', value: tok, url: web.base }]);
      if (init) await context.addInitScript(...init);
      const page = await context.newPage();
      page.apis = [];
      page.errors = [];
      page.on('request', (r) => { if (r.url().includes('/api/')) page.apis.push(`${r.method()} ${new URL(r.url()).pathname}`); });
      page.on('pageerror', (e) => page.errors.push(e.message));
      await page.goto(url);
      return page;
    }
    const title = (page) => page.waitForFunction(() => window.__game && window.__game.ui && window.__game.ui.current === 'title', null, { timeout: 120000 });
    const played = (page) => page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 120000 });
    const dialogs = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.sw-layer-dialogs').innerText), re.source, { timeout: 60000 });
    /** §7.9: no price and no "subscribe" anywhere in the game's own screens. */
    const noMoney = async (page) => {
      const html = await page.evaluate(() => document.querySelector('.sw-ui').innerHTML + document.body.innerText);
      assert.ok(!html.includes('$') && !/subscri/i.test(html), 'a kid never sees a price');
    };

    test('file://, a claude.ai stand-in and ?net=loop make no /api/me request (file://, claude.ai: none at all)', { timeout: 300000 }, async () => {
      const f = await open(pathToFileURL(path.join(ROOT, 'dist', 'sparkle-world.html')).href);
      await title(f);
      assert.equal(await f.evaluate(() => window.__game.account.mode), 'local');
      assert.equal(await f.evaluate(() => document.querySelectorAll('link[href*="googleapis"]').length), 0);
      assert.equal(await f.evaluate(async () => (await document.fonts.load('700 20px Fredoka')).length > 0), true, 'the font is inside the page');
      assert.deepEqual(f.apis, []);
      await f.context().close();
      const c = await open(web.base + '/play', { init: [() => { window.claude = { use: async () => null }; }] });
      await title(c);
      await c.waitForTimeout(1500);
      assert.deepEqual([await c.evaluate(() => window.__game.account.mode), c.apis], ['local', []], 'claude.ai: nothing asked');
      assert.deepEqual(c.errors, []);
      await c.context().close();
      const loop = await open(web.base + '/play?net=loop');
      await title(loop);
      assert.ok(!loop.apis.includes('GET /api/me'));
      await loop.context().close();
    });

    test('accounts on: signed out plays as today; a kid device picks her player, brings in the old worlds, saves to the cloud, boots offline', { timeout: 400000 }, async () => {
      mode = 'optional';
      const out = await open(web.base + '/play');
      await title(out);
      assert.deepEqual([await out.evaluate(() => window.__game.account.mode), await out.evaluate(() => window.__game.store.backendName)], ['local', 'indexedDB']);
      assert.ok(await out.evaluate(() => !!document.querySelector('.sw-title-grownups')), 'the Grown-ups tile');
      assert.deepEqual(out.apis.filter((a) => a !== 'GET /api/net'), ['GET /api/me']);
      await noMoney(out);
      await out.context().close();

      const f = await family({ players: ['Lily', 'Mia'] });
      const tok = session(f.id);
      const lily = f.pids[0];
      // this computer was played on before accounts: one world (in localStorage)
      const seed = (w) => {
        if (localStorage.getItem('seeded')) return;
        localStorage.setItem('seeded', '1');
        localStorage.setItem('sparkle-world:metas', JSON.stringify({ [w.id]: { id: w.id, name: w.name, updatedAt: w.updatedAt, size: w.size } }));
        localStorage.setItem('sparkle-world:world:' + w.id, JSON.stringify(w));
      };
      const page = await open(web.base + '/play', { tok, init: [seed, mkSave('wold', { name: 'Old Treehouse', updatedAt: T0 + 5 })] });
      await page.waitForSelector('.sw-acct-card', { timeout: 120000 });
      assert.deepEqual(await page.$$eval('.sw-acct-card', (b) => b.map((x) => x.textContent)), ['LLily', 'MMia']);
      await noMoney(page);
      await page.click(`.sw-acct-card[data-player="${lily}"]`);
      await title(page);
      const info = await page.evaluate(() => ({ mode: window.__game.account.mode, store: window.__game.store.backendName, name: window.__game.profile.playerName, db: window.__game.store.dbName }));
      assert.deepEqual(info, { mode: 'account', store: 'indexedDB+cloud', name: 'Lily', db: 'sparkle-world@p-' + lily });
      // the first sign-in: whose are the worlds from before?
      await dialogs(page, /1 world from before/);
      await page.click('.sw-dialog button:has-text("Lily")');
      await page.waitForFunction(async () => (await window.__game.store.listWorlds()).some((m) => m.name === 'Old Treehouse'), null, { timeout: 30000 });
      // she makes a world: it reaches her cloud copy
      await page.evaluate(() => window.__game.newWorld({ name: 'Cloud Castle' }));
      await played(page);
      await page.evaluate(() => window.__game.exitToTitle());
      await page.evaluate(() => window.__game.store.flush());
      const rows = (await t.db.query("select meta->>'name' as name from worlds where player_id = $1 and body is not null order by 1", [lily])).rows.map((r) => r.name);
      assert.deepEqual(rows, ['Cloud Castle', 'Old Treehouse']);
      assert.equal(await page.evaluate(() => document.querySelector('.sw-title-switch').hidden ? '' : document.querySelector('.sw-title-switch').textContent), 'Not Lily?');
      // Settings: her name is the family's, the walkie is her grown-up's switch, a Grown-ups row
      const settings = await page.evaluate(() => {
        window.__game.ui.open('settings');
        const panel = document.querySelector('.sw-set-name').closest('.sw-panel') || document.body;
        const nameRow = document.querySelector('.sw-set-name').closest('.sw-set-row') || document.querySelector('.sw-set-name').parentElement.parentElement;
        const out = { text: panel.innerText, change: !!nameRow.querySelector('button'), grownups: !!document.querySelector('.sw-set-grownups') };
        window.__game.ui.open('title');
        return out;
      });
      assert.match(settings.text, /A grown-up can change it on the Family page/);
      assert.match(settings.text, /Walkie-talkie: off \(a grown-up can change this on the Family page\)/);
      assert.deepEqual([settings.change, settings.grownups], [false, true], 'no Change button for her name; a Grown-ups row');
      await title(page);
      await noMoney(page);
      // playing together: her player goes with the connection; a refusal (4401) is a friendly card, no retries
      const sockets = [];
      page.on('websocket', (ws) => sockets.push(ws.url()));
      await page.evaluate(() => window.__game.loadWorld(window.__game.profile.lastWorldId));
      await played(page);
      await page.evaluate(() => window.__game.net.host());
      await page.waitForFunction(() => document.querySelector('.sw-net-msg')?.dataset.code === 'signed_out', null, { timeout: 60000 });
      assert.match(await page.evaluate(() => document.querySelector('.sw-net-msg').innerText), /Ask a grown-up to sign in/);
      assert.equal(sockets.length, 1, 'no retries after 4401');
      assert.ok(sockets[0].includes('&p=' + lily), 'the socket says who she is');
      assert.deepEqual(page.errors, []);
      const portrait = async () => (await t.db.one('select octet_length(portrait) > 100 as ok from players where id = $1', [lily])).ok;
      assert.ok(await until(portrait, 60000), 'her head portrait went up');
      // the next visit: the worlds from before were answered for, so nobody is asked again
      await page.reload();
      await page.waitForSelector('.sw-acct-card', { timeout: 120000 });
      await page.click(`.sw-acct-card[data-player="${lily}"]`);
      await title(page);
      await page.waitForTimeout(2500);
      assert.ok(!/from before/.test(await page.evaluate(() => document.querySelector('.sw-layer-dialogs').innerText)), 'asked once');
      assert.equal(await page.evaluate(() => window.__game.account.hasLegacy), true, 'the old copies stay 30 days (Remove old copies)');
      // a kid's device: the Grown-ups card opens at once; Sign this device out asks a plain
      // "Sign this device out?", Remove old copies the grown-up check first (§7.7). The title's
      // "Save a copy of your worlds?" card may be up first: Not now
      if (await page.$('.ks-card')) {
        await page.click('.ks-card .ks-later');
        await page.waitForSelector('.ks-card', { state: 'detached' });
      }
      await page.click('.sw-title-grownups');
      await dialogs(page, /For grown-ups/);
      assert.equal(await page.$('.sw-gate'), null, 'no grown-up check before the Grown-ups card on a kid device');
      await page.click('.sw-dialog button:has-text("Sign this device out")');
      await dialogs(page, /Sign this device out\?/);
      assert.equal(await page.$('.sw-gate'), null, 'Sign this device out: a plain confirm, no grown-up check');
      await page.click('.sw-dialog button:has-text("Cancel")');
      await page.waitForFunction(() => !document.querySelector('.sw-dialog'));
      await page.click('.sw-title-grownups');
      await dialogs(page, /For grown-ups/);
      await page.click('.sw-dialog button:has-text("Remove old copies")');
      await page.waitForSelector('.sw-gate .sw-gate-qtext');
      assert.ok(!/Remove the old copies\?/.test(await page.evaluate(() => document.querySelector('.sw-layer-dialogs').innerText)), 'the grown-up check comes before "Remove the old copies?"');
      await page.click('.sw-gate-cancel');
      await page.waitForSelector('.sw-gate', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__game.account.hasLegacy), true, 'cancelled: the old copies stay');
      // offline: the cache boots her (the picker from the cache), saves wait on the device
      await page.route('**/api/me', (r) => r.abort());
      await page.reload();
      await page.waitForSelector('.sw-acct-card', { timeout: 120000 });
      assert.equal(await page.$eval('.sw-acct-card .sw-acct-name', (b) => b.textContent), 'Lily', 'the last player first');
      await page.waitForSelector('.sw-acct-card img', { timeout: 10000 });
      assert.equal(await page.$eval('.sw-acct-card img', (i) => i.naturalWidth > 0), true, 'her portrait shows in the picker');
      await page.click(`.sw-acct-card[data-player="${lily}"]`);
      await title(page);
      assert.deepEqual(await page.evaluate(() => [window.__game.account.mode, window.__game.account.offline, window.__game.profile.playerName]), ['account', true, 'Lily']);
      assert.ok((await page.evaluate(async () => (await window.__game.store.listWorlds()).map((m) => m.name))).includes('Cloud Castle'));
      await page.context().close();
    });

    test('required: signed out gets "Ask a grown-up" (it stays), a lapsed family "resting", no players yet "A grown-up can add you"; a grown-up\'s own sign-in goes to the Family page', { timeout: 300000 }, async () => {
      mode = 'required';
      try {
        const out = await open(web.base + '/play');
        await title(out);
        await dialogs(out, /Ask a grown-up to set up Glimmer World/);
        assert.equal(await out.evaluate(() => window.__game.account.mode), 'blocked');
        await out.keyboard.press('Escape');
        await out.waitForTimeout(300);
        await dialogs(out, /Ask a grown-up to set up Glimmer World/);
        await noMoney(out);
        // I'm a grown-up: straight to the sign-in (the parent's email protects it), no grown-up check
        await out.click(".sw-dialog button:has-text(\"I'm a grown-up\")");
        await out.waitForURL((u) => u.pathname === '/account' && u.searchParams.get('next') === '/play', { timeout: 60000 });
        await out.context().close();
        // I have a code: straight to the code box
        const code = await open(web.base + '/play');
        await title(code);
        await dialogs(code, /Ask a grown-up to set up Glimmer World/);
        await code.click('.sw-dialog button:has-text("I have a code")');
        await code.waitForSelector('.sw-dialog input.sw-input');
        assert.equal(await code.$('.sw-gate'), null, 'I have a code: no grown-up check');
        await code.context().close();
        const f = await family({ plan: 'lapsed' });
        const rest = await open(web.base + '/play', { tok: session(f.id) });
        await title(rest);
        await dialogs(rest, /Glimmer World is resting/);
        // a kid's device: one button (the Family page, no grown-up check)
        assert.deepEqual(await rest.$$eval('.sw-dialog .sw-dialog-buttons button', (bs) => bs.map((b) => b.textContent.trim())), ['Grown-ups']);
        await noMoney(rest);
        // ...which goes straight to the Family page (there it only says the device is the kids')
        await rest.click('.sw-dialog button:has-text("Grown-ups")');
        await rest.waitForURL((u) => u.pathname === '/account', { timeout: 60000 });
        await rest.context().close();
        // a grown-up's own sign-in gets no card: straight to the Family page (the membership)
        const grown = await open(web.base + '/play', { tok: session(f.id, { kind: 'parent' }) });
        await grown.waitForURL((u) => u.pathname === '/account' && !u.search, { timeout: 120000 });
        await grown.context().close();
        // with a plan and players, the game on a grown-up's own sign-in: Grown-ups asks the
        // grown-up check first (there the Family page opens with no email code)
        const two = await family({ players: ['Lily', 'Mia'] });
        const own = await open(web.base + '/play', { tok: session(two.id, { kind: 'parent' }) });
        await own.waitForSelector('.sw-acct-grownups', { timeout: 120000 });
        await own.click('.sw-acct-grownups');
        await own.waitForSelector('.sw-gate .sw-gate-qtext');
        // (the check's own note starts "For grown-ups:", so look at the cards' titles)
        assert.ok(!(await own.$$eval('.sw-layer-dialogs h3', (hs) => hs.some((h) => h.textContent.trim() === 'For grown-ups'))), "a grown-up's own sign-in: the grown-up check first");
        await own.context().close();
        // a plan but nobody added yet: a grown-up's sign-in goes to the Family page to add one...
        const empty = await family({ players: [] });
        const tok = session(empty.id, { kind: 'parent' });
        const none = await open(web.base + '/play', { tok });
        await none.waitForURL((u) => u.pathname === '/account' && u.searchParams.get('next') === '/play', { timeout: 120000 });
        await none.context().close();
        // ...a kid's device that has nobody gets the card, and it stays in `required`...
        const kid = await open(web.base + '/play', { tok: session(empty.id) });
        await title(kid);
        await dialogs(kid, /A grown-up can add you on the Family page/);
        assert.equal(await kid.evaluate(() => window.__game.account.mode), 'blocked');
        await kid.context().close();
        // ...and in `optional` an OK closes it: she plays on this device as before
        mode = 'optional';
        const soft = await open(web.base + '/play', { tok });
        await title(soft);
        await dialogs(soft, /A grown-up can add you on the Family page/);
        await soft.click('.sw-dialog button:has-text("OK")');
        await soft.waitForFunction(() => !/Family page/.test(document.querySelector('.sw-layer-dialogs').innerText));
        assert.deepEqual(await soft.evaluate(() => [window.__game.account.mode, window.__game.store.dbName]), ['local', 'sparkle-world']);
        await noMoney(soft);
        await soft.context().close();
      } finally {
        mode = 'optional';
      }
    });
  });
} else {
  await measure();
}

function browserSkip() {
  if (process.env.SW_SAVES_BROWSER === '0') return 'SW_SAVES_BROWSER=0';
  if (!existsSync(path.join(ROOT, 'dist', 'sparkle-world.html'))) return 'no dist/sparkle-world.html (npm run build)';
  if (!existsSync(process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium')) return 'no Chromium (CHROMIUM_PATH)';
  return false;
}

// ---------------------------------------------------------------------------------------------
// --measure: real save sizes from the built game

async function measure() {
  const { chromium } = await import('playwright-core');
  const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'sparkle-world.html')).href);
  await page.waitForFunction(() => window.__game && window.__game.mode === 'title' && window.__game.registry.biomes.size > 0, null, { timeout: 120000 });
  const biomes = await page.evaluate(() => [...window.__game.registry.biomes.keys()]);
  const rows = [];
  for (const biome of biomes) {
    for (const size of ['cozy', 'big']) {
      await page.evaluate(({ biome, size }) => window.__game.newWorld({ biome, size, name: 'Measure' }), { biome, size });
      await page.evaluate(() => window.__game.debug.waitIdle(60000));
      const r = await page.evaluate(async () => {
        const s = JSON.stringify(window.__game.serializeWorld({ thumbnail: true }));
        const gz = await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        return { json: s.length, gzip: gz.byteLength };
      });
      rows.push({ biome, size, ...r });
      console.log(`${biome.padEnd(12)} ${size.padEnd(5)} ${(r.json / 1024).toFixed(0).padStart(6)} KB JSON  ${(r.gzip / 1024).toFixed(0).padStart(5)} KB gzip`);
    }
  }
  await browser.close();
  const max = rows.reduce((a, b) => (b.json > a.json ? b : a));
  console.log(`largest: ${(max.json / 1024).toFixed(0)} KB JSON (${max.biome} ${max.size}); SW_WORLD_MAX_BYTES default ${(8388608 / 1024).toFixed(0)} KB = ${(8388608 / max.json).toFixed(1)}×`);
  console.log(`per-player cap 100 MB stored gzip = ${((100 * 1024 * 1024) / Math.max(...rows.map((r) => r.gzip))).toFixed(0)} of the largest gzip worlds`);
}
