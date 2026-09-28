// SaveStore: profile + worlds, persisted locally (IndexedDB -> localStorage -> memory) and,
// inside a claude.ai Artifact with the db capability, also in the viewer's private cloud
// subtree. Every public method is async and never throws: reads resolve null/[] on failure,
// writes resolve { ok, backend, persistent, error? }.
//
// If a local write fails later on (quota, the browser evicting storage, a broken database),
// that save falls through to the next backend (localStorage, then memory) instead of being
// dropped, and reads look in every backend that has been written to (newest copy wins).
//
// Family accounts (docs/ACCOUNTS.md §7.2): store.configure({ ns, cloud, mergeProfile }) before
// init() puts one player's saves under their own names ('sparkle-world@p-<uuid>') with the
// server's HttpCloudBackend (src/account/cloud.js). Such a backend says `revisions: true`, and
// only then do the extras run: revisions (If-Match), retried pushes, a reconcile after init(),
// tombstones, "(copy)" forks on a conflict, the profile merge, skipped unchanged pushes, queued
// deletes. Without configure() everything is exactly as before (claude.ai's CloudBackend too).

import { sleep } from './util.js';

const DB_NAME = 'sparkle-world';
const LS_PREFIX = 'sparkle-world:';
const PART_CHARS = 180000;
const CLOUD_MIN_INTERVAL = 60000;
const RETRY_MS = [30000, 60000, 120000]; // then every 5 minutes (revisioned backends)
const RETRY_LAST_MS = 300000;
const SKIP_MS = 5 * 60000; // an unchanged world is not pushed again within this time
const PROFILE_REV = '@profile';
const CLOUD_WRITE_MS = 10000; // one cloud write that has not settled by then counts as failed
const CLOUD_READ_MS = 8000; // cloud reads give up after this (local data is used instead)

/** Resolve like `promise`, or reject after ms (the host's db may never answer). */
function withTimeout(promise, ms, what) {
  let timer = 0;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** A rejection that will not go away by retrying (a view-only visitor, no permission...). */
function isPermanentCloudError(err) {
  const code = String((err && (err.code || err.name)) || '');
  const text = code + ' ' + String((err && err.message) || err || '');
  return /permission|denied|forbidden|unauthori[sz]ed|unauthenticated|invalid[_ ]argument|read[-_ ]?only|not[_ ]allowed|not[_ ]granted|capability[_ ](disabled|removed)|\b40[13]\b/i.test(text);
}

/** World meta = the small part of a save used by the My Worlds list. */
export function metaOf(save) {
  const m = {
    id: save.id,
    name: save.name,
    biome: save.biome,
    size: save.size,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt || 0,
    thumbnail: save.thumbnail || null,
  };
  if (save.backupOf) {
    m.backupOf = save.backupOf;
    m.backupAt = save.backupAt || m.updatedAt;
  }
  return m;
}

/** "Before friends" backups are saved as '<world id>.before' (docs/MULTIPLAYER.md §13). */
export function isBackupId(id) {
  return typeof id === 'string' && id.endsWith('.before');
}

/** The world as it was just before a "Before friends" restore: '<world id>.undo' (§13). */
export function isUndoId(id) {
  return typeof id === 'string' && id.endsWith('.undo');
}

/** Copies that are not worlds of their own (never listed in My Worlds). */
export function isSideCopyId(id) {
  return isBackupId(id) || isUndoId(id);
}

// ---------- files: one world, or a backup of everything ----------

/** "Save a copy of your worlds": every world plus her own things, in one file. */
export const BACKUP_FORMAT = 'sparkle-world-backup';

// what of the profile a backup carries: her own things. Not the settings (this device's
// volumes, quality and a grown-up's switches), not playing-with-friends ids, not lastWorldId.
const BACKUP_PROFILE_KEYS = ['look', 'outfits', 'playerName', 'nameSet', 'stickers', 'stickersSeen', 'stats', 'coins', 'basket', 'tutorialDone'];

function newWorldId() {
  return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const validSave = (s) => isObj(s) && typeof s.blocks === 'string' && isObj(s.size);

/** The part of a profile that goes into a backup (a deep copy). */
export function backupProfile(profile) {
  const out = {};
  if (!isObj(profile)) return out;
  for (const k of BACKUP_PROFILE_KEYS) if (profile[k] !== undefined) out[k] = JSON.parse(JSON.stringify(profile[k]));
  return out;
}

/**
 * Bring a backup's profile into `current` (changed in place). Nothing she has here is lost:
 * stickers and seen stickers are joined, counters and coins keep the bigger number, the basket
 * keeps the bigger count of each food, empty outfit slots are filled. Her look, name and
 * outfits come from the file only on a fresh device (`fresh`: no worlds here before).
 * Returns true when anything changed.
 */
export function mergeBackupProfile(current, fromFile, { fresh = false } = {}) {
  if (!isObj(current) || !isObj(fromFile)) return false;
  const before = JSON.stringify(current);
  const f = fromFile;
  if (fresh) {
    if (isObj(f.look)) current.look = { ...(current.look || {}), ...f.look };
    if (Array.isArray(f.outfits) && f.outfits.length === 6) current.outfits = JSON.parse(JSON.stringify(f.outfits));
    if (typeof f.playerName === 'string' && f.playerName.trim()) current.playerName = f.playerName.slice(0, 40);
    if (f.nameSet) current.nameSet = true;
    if (f.tutorialDone) current.tutorialDone = f.tutorialDone;
  } else if (Array.isArray(f.outfits) && Array.isArray(current.outfits)) {
    const have = new Set(current.outfits.filter(Boolean).map((o) => JSON.stringify(o)));
    const extra = f.outfits.filter((o) => o && !have.has(JSON.stringify(o)));
    for (let i = 0; i < current.outfits.length && extra.length; i++) if (!current.outfits[i]) current.outfits[i] = extra.shift();
  }
  for (const k of ['stickers', 'stickersSeen']) {
    if (!isObj(f[k])) continue;
    const mine = isObj(current[k]) ? current[k] : (current[k] = {});
    for (const [id, at] of Object.entries(f[k])) if (!(id in mine)) mine[id] = at;
  }
  const maxNumbers = (mine, theirs) => {
    for (const [k, v] of Object.entries(theirs)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (!(typeof mine[k] === 'number' && mine[k] >= v)) mine[k] = v;
      } else if (isObj(v)) {
        if (!isObj(mine[k])) mine[k] = {};
        maxNumbers(mine[k], v);
      }
    }
  };
  if (isObj(f.stats)) maxNumbers(isObj(current.stats) ? current.stats : (current.stats = {}), f.stats);
  if (isObj(f.basket)) maxNumbers(isObj(current.basket) ? current.basket : (current.basket = {}), f.basket);
  if (typeof f.coins === 'number' && Number.isFinite(f.coins) && f.coins >= 0 && !(current.coins >= f.coins)) current.coins = Math.floor(f.coins);
  return JSON.stringify(current) !== before;
}

/**
 * Read a Sparkle World file: one world ({ format: 'sparkle-world', save } or a bare save) or a
 * backup ({ format: BACKUP_FORMAT, profile, worlds: [save...] }). Returns
 * { ok, kind: 'world' | 'backup', worlds: [save...], profile: {...} | null, skipped } or
 * { ok: false, error }. Broken worlds inside a backup are skipped (counted), not fatal.
 */
export function readWorldFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not a Sparkle World file' };
  }
  if (isObj(parsed) && parsed.format === BACKUP_FORMAT) {
    const list = Array.isArray(parsed.worlds) ? parsed.worlds : [];
    const worlds = list.filter(validSave);
    const profile = isObj(parsed.profile) ? parsed.profile : null;
    if (!worlds.length && !profile) return { ok: false, error: 'not a Sparkle World file' };
    return { ok: true, kind: 'backup', worlds, profile, skipped: list.length - worlds.length };
  }
  const save = isObj(parsed) && parsed.format === 'sparkle-world' ? parsed.save : parsed;
  if (!validSave(save)) return { ok: false, error: 'not a Sparkle World file' };
  return { ok: true, kind: 'world', worlds: [save], profile: null, skipped: 0 };
}

// ---------- local backends ----------

class MemoryBackend {
  constructor() {
    this.kind = 'memory';
    this.profile = null;
    this.worlds = new Map();
  }
  async getProfile() { return this.profile; }
  async putProfile(p) { this.profile = JSON.parse(JSON.stringify(p)); }
  async listMetas() { return [...this.worlds.values()].map(metaOf); }
  async getWorld(id) { return this.worlds.get(id) || null; }
  async putWorld(save) { this.worlds.set(save.id, save); }
  async deleteWorld(id) { this.worlds.delete(id); }
}

class LocalStorageBackend {
  constructor(ls, prefix = LS_PREFIX) {
    this.kind = 'localStorage';
    this.ls = ls;
    this.prefix = prefix;
  }
  _get(key) {
    const s = this.ls.getItem(this.prefix + key);
    return s ? JSON.parse(s) : null;
  }
  _set(key, value) {
    this.ls.setItem(this.prefix + key, JSON.stringify(value));
  }
  /** Does this browser already hold Sparkle World saves here? */
  hasData() {
    try {
      return this.ls.getItem(this.prefix + 'metas') !== null || this.ls.getItem(this.prefix + 'profile') !== null;
    } catch {
      return false;
    }
  }
  async getProfile() { return this._get('profile'); }
  async putProfile(p) { this.putProfileSync(p); }
  async listMetas() { return Object.values(this._get('metas') || {}); }
  async getWorld(id) { return this._get('world:' + id); }
  async putWorld(save) { this.putWorldSync(save); }
  // synchronous writes (throw on failure), for the page-closing journal
  putProfileSync(p) { this._set('profile', p); }
  putWorldSync(save) {
    this._set('world:' + save.id, save);
    const metas = this._get('metas') || {};
    metas[save.id] = metaOf(save);
    this._set('metas', metas);
  }
  async deleteWorld(id) {
    this.ls.removeItem(this.prefix + 'world:' + id);
    const metas = this._get('metas') || {};
    delete metas[id];
    this._set('metas', metas);
  }
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class IDBBackend {
  constructor(db) {
    this.kind = 'indexedDB';
    this.db = db;
  }
  _tx(stores, mode) {
    return this.db.transaction(stores, mode);
  }
  _done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }
  async getProfile() {
    return (await idbRequest(this._tx(['profile'], 'readonly').objectStore('profile').get('profile'))) || null;
  }
  async putProfile(p) {
    const tx = this._tx(['profile'], 'readwrite');
    tx.objectStore('profile').put(p, 'profile');
    await this._done(tx);
  }
  async listMetas() {
    return (await idbRequest(this._tx(['metas'], 'readonly').objectStore('metas').getAll())) || [];
  }
  async getWorld(id) {
    return (await idbRequest(this._tx(['worlds'], 'readonly').objectStore('worlds').get(id))) || null;
  }
  async putWorld(save) {
    const tx = this._tx(['worlds', 'metas'], 'readwrite');
    tx.objectStore('worlds').put(save);
    tx.objectStore('metas').put(metaOf(save));
    await this._done(tx);
  }
  async deleteWorld(id) {
    const tx = this._tx(['worlds', 'metas'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    tx.objectStore('metas').delete(id);
    await this._done(tx);
  }
}

function openIDB(name = DB_NAME, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const idb = window.indexedDB;
      if (!idb) return finish(null);
      const req = idb.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('metas')) db.createObjectStore('metas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
      };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
      setTimeout(() => finish(null), timeoutMs);
    } catch {
      finish(null);
    }
  });
}

function probeLocalStorage() {
  try {
    const ls = window.localStorage;
    const k = LS_PREFIX + 'probe';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

// ---------- cloud backend (claude.ai db capability) ----------

class CloudBackend {
  constructor(db, uid) {
    this.kind = 'cloud';
    this.db = db;
    this.uid = uid;
    this.root = db.doc(`data/users/${uid}/profile`);
    this._chains = new Map(); // doc path -> promise (one write at a time per doc)
    this._partCounts = new Map();
  }
  /**
   * One write at a time per doc. Each write gives up after CLOUD_WRITE_MS, so a db call that
   * never settles cannot hold up the writes queued behind it (or whoever awaits them).
   */
  _write(ref, fn) {
    const key = ref.path || ref;
    const prev = this._chains.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => withTimeout(Promise.resolve().then(() => fn(ref)), CLOUD_WRITE_MS, 'cloud write'));
    this._chains.set(key, next);
    next.catch(() => {}).then(() => { if (this._chains.get(key) === next) this._chains.delete(key); });
    return next;
  }
  async getProfile() {
    const snap = await this.root.get();
    if (!snap.exists) return null;
    const d = snap.data();
    return d && d.profile ? d.profile : null;
  }
  async putProfile(p) {
    await this._write(this.root, (ref) => ref.set({ profile: p, updatedAt: p.updatedAt || Date.now() }));
  }
  async listMetas() {
    const q = await this.root.collection('worlds').get();
    return q.docs.map((d) => d.data()).filter(Boolean);
  }
  async getWorld(id) {
    const metaSnap = await this.root.collection('worlds').doc(id).get();
    if (!metaSnap.exists) return null;
    const meta = metaSnap.data();
    const parts = [];
    for (let i = 0; i < (meta.parts || 0); i++) {
      const snap = await this.root.collection('worldparts').doc(`${id}-${i}`).get();
      if (!snap.exists) return null;
      parts.push(snap.data().data || '');
    }
    this._partCounts.set(id, meta.parts || 0);
    return JSON.parse(parts.join(''));
  }
  async putWorld(save) {
    const json = JSON.stringify(save);
    const n = Math.max(1, Math.ceil(json.length / PART_CHARS));
    const parts = this.root.collection('worldparts');
    // parts first, then the meta that points at them
    for (let i = 0; i < n; i++) {
      const chunk = json.slice(i * PART_CHARS, (i + 1) * PART_CHARS);
      await this._write(parts.doc(`${save.id}-${i}`), (ref) => ref.set({ data: chunk }));
    }
    await this._write(this.root.collection('worlds').doc(save.id), (ref) => ref.set({ ...metaOf(save), parts: n }));
    const old = this._partCounts.get(save.id) || 0;
    for (let i = n; i < old; i++) await this._write(parts.doc(`${save.id}-${i}`), (ref) => ref.delete());
    this._partCounts.set(save.id, n);
  }
  async deleteWorld(id) {
    const metaRef = this.root.collection('worlds').doc(id);
    const snap = await metaRef.get();
    const n = snap.exists ? snap.data().parts || 0 : this._partCounts.get(id) || 0;
    await this._write(metaRef, (ref) => ref.delete());
    for (let i = 0; i < n; i++) {
      await this._write(this.root.collection('worldparts').doc(`${id}-${i}`), (ref) => ref.delete());
    }
    this._partCounts.delete(id);
  }
}

async function detectCloud() {
  try {
    const c = typeof window !== 'undefined' ? window.claude : null;
    if (!c || typeof c.use !== 'function') return null;
    const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    return new CloudBackend(db, uid);
  } catch (err) {
    console.warn('[storage] cloud unavailable', err);
    return null;
  }
}

// ---------- SaveStore ----------

/** FNV-1a of a string (the "did this world change?" check before a push). */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A world push can be skipped when only these changed (docs/ACCOUNTS.md §7.2 item 7). */
function saveHash(save) {
  // eslint-disable-next-line no-unused-vars
  const { player, time, hotbar, updatedAt, thumbnail, ...rest } = save;
  return fnv(JSON.stringify(rest));
}

/** "<name> (copy)" in at most 80 characters. */
export function forkName(name) {
  const n = typeof name === 'string' && name.trim() ? name : 'My World';
  return (n.length > 73 ? n.slice(0, 73) : n) + ' (copy)';
}

const NS_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** JSON with sorted keys (a "same content?" check). */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

export class SaveStore {
  constructor() {
    this.dbName = DB_NAME;
    this.lsPrefix = LS_PREFIX;
    this.local = new MemoryBackend(); // primary local backend, picked by init()
    this._spares = null; // fallback backends for failed writes (created on first need)
    this._usedSpares = new Set(); // spares that hold data and must be read too
    this.cloud = null;
    this._pendingWorlds = new Map(); // id -> save waiting for its cloud slot
    this._pendingProfile = null;
    this._lastCloudWrite = new Map(); // 'profile' | world id -> time
    this._timers = new Map();
    this._cloudListeners = [];
    this._statusListeners = [];
    // cloud health: a failed write makes the cloud stop counting as "persistent" until one
    // succeeds again; a permanent refusal (e.g. a view-only visitor) switches cloud saves off
    // for the session (no retries, no console noise)
    this.cloudReadOnly = false;
    this._cloudFailing = false;
    this._lastPersistent = null;
    this.ready = null;
    // family accounts (configure(); used only by a backend with `revisions`)
    this._configured = false;
    this._given = null; // the backend given to configure()
    this._merge = null; // mergeProfile(local, server)
    this._revs = new Map(); // world id | PROFILE_REV -> rev this device's copy descends from
    this._dels = new Set(); // deletes not yet taken by the server
    this._tombs = new Map(); // id -> time of a delete the cloud told us about
    this._pushed = new Map(); // id -> { hash, at } of the last successful push
    this._retries = new Map(); // key -> failed attempts in a row
    this._redirect = new Map(); // id -> { to, name } while a fork is being made
    this._forkFns = [];
    this._profileFns = [];
    this._chain = Promise.resolve(); // one push at a time
    this._ls = null;
    this.reconciled = Promise.resolve();
  }

  /**
   * Before init(): o.ns 'p-<uuid>' → IndexedDB 'sparkle-world@p-<uuid>' and localStorage keys
   * 'sparkle-world@p-<uuid>:…'; o.cloud: the backend to use instead of detectCloud() (null: none);
   * o.mergeProfile(local, server); o.readOnly: the cloud is only read (no plan: §1.2).
   */
  configure(o = {}) {
    if (this.ready) throw new Error('store.configure() must come before init()');
    if (o.ns !== undefined && o.ns !== null) {
      if (!NS_RE.test(o.ns)) throw new Error('bad store namespace');
      this.dbName = DB_NAME + '@' + o.ns;
      this.lsPrefix = DB_NAME + '@' + o.ns + ':';
    }
    this._configured = true;
    this._given = o.cloud || null;
    this._merge = typeof o.mergeProfile === 'function' ? o.mergeProfile : null;
    this.cloudReadOnly = !!o.readOnly;
    return this;
  }

  /** fn({ from, to, name }) after a conflict made "<name> (copy)" (docs/ACCOUNTS.md §7.4). */
  onFork(fn) {
    this._forkFns.push(fn);
  }

  /** fn(merged) after the profile was merged with another device's (a 409). */
  onProfile(fn) {
    this._profileFns.push(fn);
  }

  /** Does the cloud keep revisions (the family server)? */
  get _rev() {
    return !!(this.cloud && this.cloud.revisions);
  }

  /** Pick the local backend and start looking for the cloud (waits briefly for it). */
  init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      try {
        const db = await openIDB(this.dbName);
        if (db) this.local = new IDBBackend(db);
        else {
          const ls = probeLocalStorage();
          if (ls) this.local = new LocalStorageBackend(ls, this.lsPrefix);
        }
      } catch (err) {
        console.warn('[storage] local storage unavailable, using memory', err);
      }
      // saves that fell back to localStorage in an earlier session must still be found
      for (const b of this._spareBackends()) if (b.kind === 'localStorage' && b.hasData()) this._usedSpares.add(b);
      if (this._configured) {
        this.cloud = this._given;
        if (this._rev) {
          this._ls = probeLocalStorage();
          this._loadSync();
          // (tests await store.reconciled)
          if (!this.cloudReadOnly) this.reconciled = new Promise((r) => setTimeout(() => r(this._reconcile().catch(() => {})), 0));
        }
        return { ok: true, local: this.local.kind, cloud: !!this.cloud };
      }
      const cloudPromise = detectCloud().then((backend) => {
        this.cloud = backend;
        if (backend) for (const fn of this._cloudListeners) fn();
        return backend;
      });
      await Promise.race([cloudPromise, sleep(1500)]);
      return { ok: true, local: this.local.kind, cloud: !!this.cloud };
    })();
    return this.ready;
  }

  /** Stop pushing and close the local database (before deleting it; tests). */
  close() {
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
    try {
      if (this.local.db) this.local.db.close();
    } catch {}
  }

  /**
   * Delete one namespace's saves on this device: its database and its localStorage keys.
   * ns '' (or null) is the saves from before accounts ('sparkle-world' and the sparkle-world:
   * metas / profile / world:* keys); nothing else (the relay's device id, the account cache)
   * is ever touched.
   */
  static async wipe(ns) {
    const legacy = !ns;
    if (!legacy && !NS_RE.test(ns)) return false;
    const prefix = legacy ? LS_PREFIX : DB_NAME + '@' + ns + ':';
    try {
      const ls = window.localStorage;
      const drop = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (!legacy || rest === 'metas' || rest === 'profile' || rest.startsWith('world:')) drop.push(k);
      }
      for (const k of drop) ls.removeItem(k);
    } catch {}
    try {
      const idb = window.indexedDB;
      if (idb) {
        await new Promise((resolve) => {
          const req = idb.deleteDatabase(legacy ? DB_NAME : DB_NAME + '@' + ns);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
          setTimeout(resolve, 3000);
        });
      }
    } catch {}
    return true;
  }

  /** A store on the names from before accounts (the first sign-in's import, §7.5). */
  static legacy() {
    return new SaveStore().configure({ cloud: null });
  }

  /** Called once if the cloud backend becomes available after init() returned. */
  onCloudReady(fn) {
    this._cloudListeners.push(fn);
  }

  /** fn({ persistent }) whenever `persistent` changes (e.g. the cloud starts refusing writes). */
  onStatus(fn) {
    this._statusListeners.push(fn);
    return () => { this._statusListeners = this._statusListeners.filter((f) => f !== fn); };
  }

  get backendName() {
    return this.local.kind + (this.cloud ? (this.cloudReadOnly ? '+cloud(read-only)' : '+cloud') : '');
  }

  /** Is the cloud taking our writes? (present, not refused, the last write did not fail) */
  get cloudWritable() {
    return !!this.cloud && !this.cloudReadOnly && !this._cloudFailing;
  }

  /** Will saves survive closing the page? (false: memory only, e.g. a sandboxed frame) */
  get persistent() {
    return this.local.kind !== 'memory' || this.cloudWritable;
  }

  _statusChanged() {
    const now = this.persistent;
    if (now === this._lastPersistent) return;
    this._lastPersistent = now;
    for (const fn of this._statusListeners) {
      try { fn({ persistent: now }); } catch (err) { console.warn('[storage] status listener failed', err); }
    }
  }

  /** Book-keeping after each cloud write (err = null when it worked). */
  _cloudResult(key, err) {
    if (!err) {
      this._cloudFailing = false;
    } else if (isPermanentCloudError(err) || (err && err.status === 410)) {
      if (!this.cloudReadOnly) {
        console.info('[storage] cloud saves are not available for this viewer; saving on this device only.', String((err && err.message) || err));
      }
      this.cloudReadOnly = true;
      for (const t of this._timers.values()) clearTimeout(t);
      this._timers.clear();
      this._pendingWorlds.clear();
      this._pendingProfile = null;
    } else {
      if (!this._cloudFailing) console.warn('[storage] cloud write failed', key, String((err && err.message) || err));
      this._cloudFailing = true;
    }
    this._statusChanged();
  }

  _spareBackends() {
    if (!this._spares) {
      this._spares = [];
      if (this.local.kind === 'indexedDB') {
        const ls = probeLocalStorage();
        if (ls) this._spares.push(new LocalStorageBackend(ls, this.lsPrefix));
      }
      if (this.local.kind !== 'memory') this._spares.push(new MemoryBackend());
    }
    return this._spares;
  }

  /** Local backends that may hold data: the primary plus any spare written to. */
  _readers() {
    return [this.local, ...this._usedSpares];
  }

  /**
   * Run write(backend) on the primary local backend, falling through to the spares.
   * Resolves { ok, backend, error? }.
   */
  async _writeLocal(label, write) {
    let lastErr = null;
    for (const b of [this.local, ...this._spareBackends()]) {
      try {
        await write(b);
        if (b !== this.local) this._usedSpares.add(b);
        return { ok: true, backend: b };
      } catch (err) {
        lastErr = err;
        console.warn(`[storage] ${label} failed (${b.kind})`, err);
      }
    }
    return { ok: false, backend: null, error: String(lastErr) };
  }

  _result(local) {
    const cloud = this.cloudWritable;
    const ok = local.ok || cloud;
    const persistent = (local.ok && local.backend.kind !== 'memory') || cloud;
    const res = { ok, backend: local.ok ? local.backend.kind : null, persistent };
    if (!local.ok) res.error = local.error;
    return res;
  }

  async _safe(label, fn, fallback) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[storage] ${label} failed`, err);
      return fallback;
    }
  }

  // ----- revisions and queued deletes (revisioned backends): localStorage[prefix + 'revs' | 'dels'] -----

  _loadSync() {
    try {
      const ls = this._ls;
      const revs = JSON.parse(ls.getItem(this.lsPrefix + 'revs') || '{}');
      for (const [k, v] of Object.entries(revs)) if (Number.isFinite(v)) this._revs.set(k, v);
      for (const id of JSON.parse(ls.getItem(this.lsPrefix + 'dels') || '[]')) if (typeof id === 'string') this._dels.add(id);
    } catch {}
  }

  _saveSync() {
    try {
      const ls = this._ls;
      ls.setItem(this.lsPrefix + 'revs', JSON.stringify(Object.fromEntries(this._revs)));
      ls.setItem(this.lsPrefix + 'dels', JSON.stringify([...this._dels]));
    } catch {}
  }

  _setRev(id, rev) {
    if (!Number.isFinite(rev)) return;
    if (this._revs.get(id) === rev) return;
    this._revs.set(id, rev);
    this._saveSync();
  }

  /** The cloud's "deleted" wins over a copy here that is not newer. */
  _gone(id, updatedAt) {
    if (this._dels.has(id)) return true;
    const t = this._tombs.get(id);
    return t !== undefined && t >= (updatedAt || 0);
  }

  // ----- page-closing journal -----

  /** The localStorage backend (primary or spare), or null when this browser has none. */
  _journalBackend() {
    if (this.local.kind === 'localStorage') return this.local;
    if (this.local.kind === 'memory') return null;
    return this._spareBackends().find((b) => b.kind === 'localStorage') || null;
  }

  /**
   * Keep a copy of a world save in localStorage synchronously (the page is going away and an
   * IndexedDB write started now may be cut off). The next session reads it like any fallback
   * copy (the newest copy wins) and the next normal save drops it. Returns true when written.
   */
  journalWorld(save) {
    try {
      const b = this._journalBackend();
      if (!b || !save || !save.id) return false;
      if (!save.updatedAt) save.updatedAt = Date.now();
      b.putWorldSync(save);
      if (b !== this.local) this._usedSpares.add(b);
      return true;
    } catch (err) {
      console.warn('[storage] journal world failed', err);
      return false;
    }
  }

  /** Same for the profile. */
  journalProfile(profile) {
    try {
      const b = this._journalBackend();
      if (!b || !profile) return false;
      b.putProfileSync(JSON.parse(JSON.stringify(profile)));
      if (b !== this.local) this._usedSpares.add(b);
      return true;
    } catch (err) {
      console.warn('[storage] journal profile failed', err);
      return false;
    }
  }

  // ----- profile -----

  async _localProfile() {
    let local = null;
    for (const b of this._readers()) {
      const p = await this._safe('local profile', () => b.getProfile(), null);
      if (p && (!local || (p.updatedAt || 0) > (local.updatedAt || 0))) local = p;
    }
    return local;
  }

  async loadProfile() {
    await this.init();
    const local = await this._localProfile();
    if (this._rev) return this._loadProfileRev(local);
    const cloud = this.cloud ? await this._safe('cloud profile', () => withTimeout(this.cloud.getProfile(), CLOUD_READ_MS, 'cloud read'), null) : null;
    if (local && cloud) return (cloud.updatedAt || 0) > (local.updatedAt || 0) ? cloud : local;
    return cloud || local || null;
  }

  /** Local and cloud profiles merged (§7.4); what the cloud lacks is pushed. */
  async _loadProfileRev(local) {
    let cloud = null;
    let reached = false;
    try {
      cloud = await withTimeout(this.cloud.getProfile(), CLOUD_READ_MS, 'cloud read');
      reached = true;
    } catch (err) {
      console.warn('[storage] cloud profile failed', String((err && err.message) || err));
    }
    if (cloud) {
      this._setRev(PROFILE_REV, cloud._rev);
      delete cloud._rev;
    }
    if (!local) return cloud;
    if (!cloud) {
      if (reached && !this.cloudReadOnly) this._queueProfile(local);
      return local;
    }
    const merged = this._merge ? this._merge(local, cloud) : (cloud.updatedAt || 0) > (local.updatedAt || 0) ? cloud : local;
    // push when this device has something the cloud does not (newer, or stickers it lacks...)
    const strip = typeof this.cloud.strip === 'function' ? (p) => this.cloud.strip(p) : (p) => p;
    const differs = canon({ ...strip(merged), updatedAt: 0 }) !== canon({ ...strip(cloud), updatedAt: 0 });
    if (!this.cloudReadOnly && ((local.updatedAt || 0) > (cloud.updatedAt || 0) || differs)) this._queueProfile(merged);
    return merged;
  }

  _queueProfile(p) {
    this._pendingProfile = JSON.parse(JSON.stringify(p));
    this._scheduleCloud('profile');
  }

  async saveProfile(profile) {
    await this.init();
    if (!profile.updatedAt) profile.updatedAt = Date.now();
    const copy = JSON.parse(JSON.stringify(profile));
    const local = await this._writeLocal('profile save', (b) => b.putProfile(copy));
    if (this.cloud && !this.cloudReadOnly) {
      this._pendingProfile = copy;
      this._scheduleCloud('profile');
    }
    return this._result(local);
  }

  // ----- worlds -----

  /**
   * Metas of all worlds, newest first (merged local + cloud by updatedAt). "Before friends"
   * backups (ids ending '.before', docs/MULTIPLAYER.md §9.12) are not listed; see listBackups().
   */
  async listWorlds() {
    return (await this._listAll()).filter((m) => !isSideCopyId(m.id));
  }

  /** Metas of the "before friends" backups ({ id: '<world>.before', backupOf, backupAt, ... }). */
  async listBackups() {
    return (await this._listAll()).filter((m) => isBackupId(m.id));
  }

  /**
   * Put a world back as it was before friends came: the world as it is now is kept first as
   * '<id>.undo' (restoreUndo() brings it back), then its '.before' backup becomes the world
   * again and the backup goes (the next hosting makes a fresh one). Resolves { ok, id, undo }.
   */
  async restoreBackup(id) {
    if (!id || isSideCopyId(id)) return { ok: false, error: 'no world' };
    const b = await this.loadWorld(id + '.before');
    if (!b || !b.blocks) return { ok: false, error: 'no backup' };
    const cur = await this.loadWorld(id);
    let undo = false;
    if (cur && cur.blocks) {
      const copy = { ...cur, id: id + '.undo', undoOf: id, updatedAt: Date.now() };
      delete copy.backupOf;
      delete copy.backupAt;
      const u = await this.saveWorld(copy);
      if (!u.ok) return { ok: false, error: 'no room for the undo copy' };
      undo = true;
    }
    const save = { ...b, id, updatedAt: Date.now() };
    delete save.backupOf;
    delete save.backupAt;
    const res = await this.saveWorld(save);
    if (!res.ok) return res;
    await this._deleteOne(id + '.before');
    return { ok: true, id, undo };
  }

  /** Take back a "Before friends" restore: the '.undo' copy becomes the world again. */
  async restoreUndo(id) {
    if (!id || isSideCopyId(id)) return { ok: false, error: 'no world' };
    const u = await this.loadWorld(id + '.undo');
    if (!u || !u.blocks) return { ok: false, error: 'no undo copy' };
    const save = { ...u, id, updatedAt: Date.now() };
    delete save.undoOf;
    const res = await this.saveWorld(save);
    if (!res.ok) return res;
    await this._deleteOne(id + '.undo');
    return { ok: true, id };
  }

  /** Is there a world as it was before the last "Before friends" restore? */
  async hasUndo(id) {
    return (await this._listAll()).some((m) => m.id === id + '.undo');
  }

  async _listAll() {
    await this.init();
    const byId = new Map();
    const add = (metas, source) => {
      for (const m of metas || []) {
        if (!m || !m.id) continue;
        if (m.deleted) {
          this._tombs.set(m.id, m.updatedAt || 0); // a cloud tombstone (§7.2 item 5)
          continue;
        }
        const cur = byId.get(m.id);
        if (!cur || (m.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(m.id, { ...m, source });
      }
    };
    for (const b of this._readers()) add(await this._safe('list local', () => b.listMetas(), []), b.kind);
    if (this.cloud) add(await this._safe('list cloud', () => withTimeout(this.cloud.listMetas(), CLOUD_READ_MS, 'cloud read'), []), 'cloud');
    let all = [...byId.values()];
    if (this._rev) all = all.filter((m) => !this._gone(m.id, m.updatedAt));
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async _loadLocal(id) {
    let local = null;
    for (const b of this._readers()) {
      const w = await this._safe('load local world', () => b.getWorld(id), null);
      if (w && (!local || (w.updatedAt || 0) > (local.updatedAt || 0))) local = w;
    }
    return local;
  }

  async loadWorld(id) {
    await this.init();
    const local = await this._loadLocal(id);
    if (!this.cloud) return local;
    const metas = await this._safe('cloud metas', () => withTimeout(this.cloud.listMetas(), CLOUD_READ_MS, 'cloud read'), []);
    const cm = metas.find((m) => m.id === id);
    if (this._rev) {
      if (cm && cm.deleted) this._tombs.set(id, cm.updatedAt || 0);
      if (this._gone(id, local && local.updatedAt)) return null;
    }
    if (cm && !cm.deleted && (!local || (cm.updatedAt || 0) > (local.updatedAt || 0))) {
      const cloud = await this._safe('load cloud world', () => withTimeout(this.cloud.getWorld(id), CLOUD_READ_MS * 3, 'cloud read'), null);
      if (cloud && this._rev) await this._keepDownload(cloud);
      if (cloud) return cloud;
    }
    return local;
  }

  /** A world downloaded from a revisioned cloud: keep it here too and learn its revision. */
  async _keepDownload(save) {
    const rev = save._rev;
    delete save._rev;
    await this._writeLocal('keep cloud copy', (b) => b.putWorld(save));
    this._setRev(save.id, rev);
    this._pushed.set(save.id, { hash: saveHash(save), at: Date.now() });
  }

  async saveWorld(save) {
    await this.init();
    if (!save || !save.id) return { ok: false, error: 'no id' };
    // a save of a world whose conflict is being forked right now goes to the fork (§7.4)
    const r = this._redirect.get(save.id);
    if (r) save = { ...save, id: r.to, name: r.name };
    if (!save.updatedAt) save.updatedAt = Date.now();
    if (this._dels.delete(save.id)) this._saveSync();
    const local = await this._writeLocal('world save', (b) => b.putWorld(save));
    if (local.ok && local.backend === this.local) {
      // the primary works again: drop older fallback copies (they only use up space)
      for (const b of this._usedSpares) this._safe('drop fallback copy', () => b.deleteWorld(save.id), null);
    }
    if (this.cloud && !this.cloudReadOnly) {
      this._pendingWorlds.set(save.id, save);
      this._scheduleCloud(save.id);
    }
    return this._result(local);
  }

  async deleteWorld(id) {
    // a world takes its "before friends" backup (and a restore's undo copy) with it
    if (id && !isSideCopyId(id)) {
      const all = await this._listAll();
      for (const side of [id + '.before', id + '.undo']) if (all.some((m) => m.id === side)) await this._deleteOne(side);
    }
    return this._deleteOne(id);
  }

  async _deleteLocal(id) {
    let ok = true;
    for (const b of this._readers()) {
      try {
        await b.deleteWorld(id);
      } catch (err) {
        console.warn('[storage] delete failed', b.kind, err);
        if (b === this.local) ok = false;
      }
    }
    return ok;
  }

  async _deleteOne(id) {
    await this.init();
    this._pendingWorlds.delete(id);
    let ok = await this._deleteLocal(id);
    if (this._rev) {
      // queued until the server has it, so the world never comes back from the cloud
      this._revs.delete(id);
      this._pushed.delete(id);
      if (!this.cloudReadOnly) {
        this._dels.add(id);
        this._saveSync();
        this._pushCloud('del:' + id);
      }
      return { ok };
    }
    if (this.cloud && !this.cloudReadOnly) {
      try {
        await withTimeout(this.cloud.deleteWorld(id), CLOUD_WRITE_MS * 2, 'cloud delete');
      } catch (err) {
        console.warn('[storage] cloud delete failed', err);
        ok = false;
      }
    }
    return { ok };
  }

  /** A whole world as a JSON string (for "Save to a file"). */
  async exportWorld(id) {
    const save = await this.loadWorld(id);
    if (!save) return null;
    return JSON.stringify({ format: 'sparkle-world', v: 1, save });
  }

  /** Import a string made by exportWorld. Resolves { ok, id }. */
  async importWorld(text) {
    try {
      const parsed = JSON.parse(text);
      const save = parsed && parsed.format === 'sparkle-world' ? parsed.save : parsed;
      if (!save || !save.blocks || !save.size) return { ok: false, error: 'not a Sparkle World file' };
      const existing = await this.listWorlds();
      if (!save.id || existing.some((m) => m.id === save.id)) {
        save.id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      }
      save.updatedAt = Date.now();
      const res = await this.saveWorld(save);
      return res.ok ? { ok: true, id: save.id } : res;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /**
   * Every world (not the "Before friends" side copies) and her own things from `profile`
   * (look, outfits, name, stickers, coins, counters, basket) as one JSON string: the
   * "Save a copy of your worlds" backup. Resolves null when there is nothing to save.
   */
  async exportAll(profile) {
    try {
      const worlds = [];
      for (const m of await this.listWorlds()) {
        const save = await this.loadWorld(m.id);
        if (validSave(save)) worlds.push(save);
      }
      if (!worlds.length && !profile) return null;
      return JSON.stringify({
        format: BACKUP_FORMAT,
        v: 1,
        about: 'Sparkle World: a copy of every world, her look, outfits and stickers. To bring it back: My Worlds, then Open a file.',
        savedAt: new Date().toISOString(),
        profile: backupProfile(profile),
        worlds,
      });
    } catch (err) {
      console.warn('[storage] export all failed', err);
      return null;
    }
  }

  /**
   * Put back the worlds of a file made by exportWorld (one world) or exportAll (a backup).
   * A world whose id is already here is never replaced silently: `ask(conflict)` decides
   * ('mine' keeps the one here, 'file' replaces it, 'both' adds the file's as a copy; anything
   * else counts as 'mine'). conflict = { id, name, index, total, same, mine: meta, file: meta };
   * `same` = both have the same updatedAt. In a backup, such unchanged worlds are skipped
   * without asking. The profile part is returned, not applied (see mergeBackupProfile).
   * Resolves { ok, kind, added: [ids], replaced: [ids], copies: [ids], kept: [ids], same: [ids],
   * failed, skipped, fresh (no worlds here before), profile } or { ok: false, error }.
   */
  async importAll(text, { ask = null } = {}) {
    const file = readWorldFile(text);
    if (!file.ok) return file;
    const out = { ok: true, kind: file.kind, added: [], replaced: [], copies: [], kept: [], same: [], failed: 0, skipped: file.skipped, fresh: false, profile: file.profile };
    try {
      const here = new Map((await this.listWorlds()).map((m) => [m.id, m]));
      out.fresh = here.size === 0;
      const total = file.worlds.length;
      for (let i = 0; i < total; i++) {
        const save = JSON.parse(JSON.stringify(file.worlds[i]));
        if (typeof save.name !== 'string' || !save.name.trim()) save.name = 'My World';
        if (typeof save.id !== 'string' || !save.id || isSideCopyId(save.id)) save.id = newWorldId();
        delete save.backupOf;
        delete save.backupAt;
        delete save.undoOf;
        // one world opened from a file shows up first in My Worlds; a backup keeps its days
        if (file.kind === 'world' || !save.updatedAt) save.updatedAt = Date.now();
        const mine = here.get(save.id);
        let choice = 'add';
        if (mine) {
          const same = (mine.updatedAt || 0) === (file.worlds[i].updatedAt || 0);
          if (same && file.kind === 'backup') {
            out.same.push(save.id);
            continue;
          }
          let answer = 'mine';
          try {
            if (ask) answer = await ask({ id: save.id, name: save.name, index: i, total, same, mine, file: metaOf(file.worlds[i]) });
          } catch (err) {
            console.warn('[storage] import question failed', err);
          }
          choice = answer === 'file' || answer === 'both' ? answer : 'mine';
        }
        if (choice === 'mine') {
          out.kept.push(save.id);
          continue;
        }
        if (choice === 'both') {
          save.id = newWorldId();
          save.name = (save.name.length > 33 ? save.name.slice(0, 33) : save.name) + ' (copy)';
          save.updatedAt = Date.now();
        } else if (choice === 'file') {
          save.updatedAt = Date.now(); // her choice now: newer than any copy left here
        }
        const res = await this.saveWorld(save);
        if (!res.ok) {
          out.failed++;
          continue;
        }
        here.set(save.id, metaOf(save));
        (choice === 'both' ? out.copies : choice === 'file' ? out.replaced : out.added).push(save.id);
      }
    } catch (err) {
      console.warn('[storage] import failed', err);
      return { ok: false, error: String(err) };
    }
    if (out.failed && !out.added.length && !out.replaced.length && !out.copies.length) out.ok = false;
    return out;
  }

  // ----- cloud throttling -----

  _scheduleCloud(key, wait = null) {
    if (this.cloudReadOnly || this._timers.has(key)) return;
    const last = this._lastCloudWrite.get(key) || 0;
    const every = (this.cloud && this.cloud.minInterval) || CLOUD_MIN_INTERVAL;
    const ms = wait !== null ? wait : Math.max(0, last + every - Date.now());
    const timer = setTimeout(() => {
      this._timers.delete(key);
      this._pushCloud(key);
    }, ms);
    this._timers.set(key, timer);
  }

  async _pushCloud(key) {
    if (!this.cloud || this.cloudReadOnly) return;
    if (this._rev) {
      // one request at a time (a reconcile or an import must not burst)
      const run = this._chain.then(() => this._pushRev(key));
      this._chain = run.catch(() => {});
      return run;
    }
    this._lastCloudWrite.set(key, Date.now());
    try {
      let wrote = false;
      if (key === 'profile') {
        const p = this._pendingProfile;
        this._pendingProfile = null;
        if (p) { wrote = true; await this.cloud.putProfile(p); }
      } else {
        const save = this._pendingWorlds.get(key);
        this._pendingWorlds.delete(key);
        if (save) { wrote = true; await this.cloud.putWorld(save); }
      }
      if (wrote) this._cloudResult(key, null);
    } catch (err) {
      this._cloudResult(key, err);
    }
  }

  // ----- pushes to a revisioned cloud (§7.2 items 2, 6, 7) -----

  async _pushRev(key) {
    if (this.cloudReadOnly) return;
    this._lastCloudWrite.set(key, Date.now());
    if (key.startsWith('del:')) {
      const id = key.slice(4);
      if (!this._dels.has(id)) return;
      try {
        await this.cloud.deleteWorld(id);
        this._dels.delete(id);
        this._tombs.set(id, Date.now());
        this._saveSync();
        this._ok(key);
      } catch (err) {
        this._failed(key, err);
      }
      return;
    }
    if (key === 'profile') {
      const p = this._pendingProfile;
      this._pendingProfile = null;
      if (!p) return;
      try {
        const r = await this.cloud.putProfile(p, { base: this._revs.get(PROFILE_REV) });
        this._setRev(PROFILE_REV, r.rev);
        this._ok(key);
      } catch (err) {
        if (err && err.status === 409) return this._profileConflict(p);
        if (!this._pendingProfile) this._pendingProfile = p;
        this._failed(key, err);
      }
      return;
    }
    const save = this._pendingWorlds.get(key);
    this._pendingWorlds.delete(key);
    if (!save) return;
    const hash = saveHash(save);
    const last = this._pushed.get(key);
    if (last && last.hash === hash && Date.now() - last.at < SKIP_MS && this._revs.has(key)) return;
    try {
      const r = await this.cloud.putWorld(save, { base: this._revs.get(key) });
      this._setRev(key, r.rev);
      this._pushed.set(key, { hash, at: Date.now() });
      this._ok(key);
    } catch (err) {
      const status = err && err.status;
      if (status === 409 && !isSideCopyId(key)) return this._fork(save, err);
      if (status === 410 && err.code === 'deleted') {
        // deleted on another device before this copy was made: it goes here too
        this._tombs.set(key, Date.now());
        this._revs.delete(key);
        this._saveSync();
        if (!this._pendingWorlds.has(key)) await this._deleteLocal(key);
        return;
      }
      if (status === 400 || status === 413) {
        console.warn('[storage] the cloud did not take a world', String(err.message || err));
        return; // no retry: the same save would be refused again
      }
      if (!this._pendingWorlds.has(key)) this._pendingWorlds.set(key, save);
      this._failed(key, err);
    }
  }

  _ok(key) {
    this._retries.delete(key);
    this._cloudResult(key, null);
  }

  /** A failed push: permanent → read-only (today's path); else try again later. */
  _failed(key, err) {
    this._cloudResult(key, err);
    if (this.cloudReadOnly) return;
    const n = (this._retries.get(key) || 0) + 1;
    this._retries.set(key, n);
    let wait = RETRY_MS[n - 1] || RETRY_LAST_MS;
    if (err && err.retryAfter > 0) wait = Math.max(wait, err.retryAfter * 1000);
    const t = this._timers.get(key);
    if (t) clearTimeout(t);
    this._timers.delete(key);
    this._scheduleCloud(key, wait);
  }

  /**
   * 409 on a world (§7.4): this device's copy becomes "<name> (copy)" (a new world, pushed as
   * new) and the server's version of the world is brought here, so both are kept.
   */
  async _fork(save, err) {
    const from = save.id;
    const to = from.slice(0, 67) + '~' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
    const name = forkName(save.name);
    this._redirect.set(from, { to, name });
    const later = this._pendingWorlds.get(from); // a newer save of the world waiting its turn
    this._pendingWorlds.delete(from);
    const fork = { ...(later || save), id: to, name };
    if (Number.isFinite(err && err.rev)) this._setRev(from, err.rev);
    await this._writeLocal('fork', (b) => b.putWorld(fork));
    this._pendingWorlds.set(to, fork);
    this._scheduleCloud(to, 0);
    for (const fn of this._forkFns) {
      try { fn({ from, to, name }); } catch (e) { console.warn('[storage] fork listener failed', e); }
    }
    setTimeout(() => this._redirect.delete(from), 2000);
    this._ok(from);
    try {
      const server = await withTimeout(this.cloud.getWorld(from), CLOUD_READ_MS * 3, 'cloud read');
      if (server) await this._keepDownload(server);
    } catch {
      // not reachable now: this device's copy of the world goes (it lives on as the fork), so
      // the world is read from the cloud next time
      await this._deleteLocal(from);
    }
  }

  /** 409 on the profile: merge with the server's (§7.4) and push again on its revision. */
  async _profileConflict(p) {
    let server = null;
    try {
      server = await withTimeout(this.cloud.getProfile(), CLOUD_READ_MS, 'cloud read');
    } catch (err) {
      if (!this._pendingProfile) this._pendingProfile = p;
      this._failed('profile', err);
      return;
    }
    if (server) {
      this._setRev(PROFILE_REV, server._rev);
      delete server._rev;
    } else this._revs.delete(PROFILE_REV);
    const merge = (a, b) => (b && this._merge ? this._merge(a, b) : a);
    const merged = merge(p, server);
    await this._writeLocal('profile merge', (b) => b.putProfile(merged));
    this._pendingProfile = this._pendingProfile ? merge(this._pendingProfile, server) : merged;
    for (const fn of this._profileFns) {
      try { fn(merged); } catch (e) { console.warn('[storage] profile listener failed', e); }
    }
    const n = (this._retries.get('profile') || 0) + 1;
    this._retries.set('profile', n);
    this._scheduleCloud('profile', n > 3 ? RETRY_MS[0] : 0);
  }

  /**
   * After init() (§7.2 item 4): one look at the cloud. A local world the cloud deleted (and
   * not changed since) goes; one the cloud lacks, or an older cloud copy, is pushed (this
   * uploads what the page-closing journal kept); an equal one teaches its revision.
   */
  async _reconcile() {
    if (!this._rev || this.cloudReadOnly) return;
    let metas;
    try {
      metas = await withTimeout(this.cloud.listMetas({ fresh: true }), CLOUD_READ_MS, 'cloud read');
    } catch {
      return; // offline: pushes wait for their retries
    }
    const cloud = new Map();
    for (const m of metas || []) if (m && m.id) cloud.set(m.id, m);
    for (const id of this._dels) this._pushCloud('del:' + id);
    const locals = new Map();
    for (const b of this._readers()) {
      for (const m of await this._safe('list local', () => b.listMetas(), [])) {
        if (m && m.id && (!locals.has(m.id) || (m.updatedAt || 0) > (locals.get(m.id).updatedAt || 0))) locals.set(m.id, m);
      }
    }
    for (const [id, lm] of locals) {
      if (this._dels.has(id)) continue;
      const cm = cloud.get(id);
      const lt = lm.updatedAt || 0;
      if (cm && cm.deleted) {
        this._tombs.set(id, cm.updatedAt || 0);
        if ((cm.updatedAt || 0) >= lt) {
          await this._deleteLocal(id);
          this._revs.delete(id);
          continue;
        }
      }
      if (!cm || cm.deleted || lt > (cm.updatedAt || 0)) {
        if (this._pendingWorlds.has(id)) continue;
        const save = await this._loadLocal(id);
        if (save) {
          this._pendingWorlds.set(id, save);
          this._scheduleCloud(id);
        }
      } else if (lt === (cm.updatedAt || 0)) this._setRev(id, cm.rev);
    }
    this._saveSync();
  }

  /**
   * Push every pending cloud write now (leaving the world, tab hidden, page closing).
   * Settles within the per-write timeouts even if the host's db never answers.
   */
  async flush() {
    if (!this.cloud || this.cloudReadOnly) return { ok: true };
    const keys = [...this._timers.keys()];
    for (const k of keys) {
      clearTimeout(this._timers.get(k));
      this._timers.delete(k);
    }
    await Promise.all(keys.map((k) => this._pushCloud(k)));
    if (this._rev) await this._chain;
    return { ok: true };
  }
}
