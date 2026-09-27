// SaveStore: profile + worlds, persisted locally (IndexedDB -> localStorage -> memory) and,
// inside a claude.ai Artifact with the db capability, also in the viewer's private cloud
// subtree. Every public method is async and never throws: reads resolve null/[] on failure,
// writes resolve { ok, backend, persistent, error? }.
//
// If a local write fails later on (quota, the browser evicting storage, a broken database),
// that save falls through to the next backend (localStorage, then memory) instead of being
// dropped, and reads look in every backend that has been written to (newest copy wins).

import { sleep } from './util.js';

const DB_NAME = 'sparkle-world';
const LS_PREFIX = 'sparkle-world:';
const PART_CHARS = 180000;
const CLOUD_MIN_INTERVAL = 60000;
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
  constructor(ls) {
    this.kind = 'localStorage';
    this.ls = ls;
  }
  _get(key) {
    const s = this.ls.getItem(LS_PREFIX + key);
    return s ? JSON.parse(s) : null;
  }
  _set(key, value) {
    this.ls.setItem(LS_PREFIX + key, JSON.stringify(value));
  }
  /** Does this browser already hold Sparkle World saves here? */
  hasData() {
    try {
      return this.ls.getItem(LS_PREFIX + 'metas') !== null || this.ls.getItem(LS_PREFIX + 'profile') !== null;
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
    this.ls.removeItem(LS_PREFIX + 'world:' + id);
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

function openIDB(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const idb = window.indexedDB;
      if (!idb) return finish(null);
      const req = idb.open(DB_NAME, 1);
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

export class SaveStore {
  constructor() {
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
  }

  /** Pick the local backend and start looking for the cloud (waits briefly for it). */
  init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      try {
        const db = await openIDB();
        if (db) this.local = new IDBBackend(db);
        else {
          const ls = probeLocalStorage();
          if (ls) this.local = new LocalStorageBackend(ls);
        }
      } catch (err) {
        console.warn('[storage] local storage unavailable, using memory', err);
      }
      // saves that fell back to localStorage in an earlier session must still be found
      for (const b of this._spareBackends()) if (b.kind === 'localStorage' && b.hasData()) this._usedSpares.add(b);
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
    } else if (isPermanentCloudError(err)) {
      if (!this.cloudReadOnly) {
        console.info('[storage] cloud saves are not available for this viewer; saving on this device only.', String((err && err.message) || err));
      }
      this.cloudReadOnly = true;
      for (const t of this._timers.values()) clearTimeout(t);
      this._timers.clear();
      this._pendingWorlds.clear();
      this._pendingProfile = null;
    } else {
      if (!this._cloudFailing) console.warn('[storage] cloud write failed', key, err);
      this._cloudFailing = true;
    }
    this._statusChanged();
  }

  _spareBackends() {
    if (!this._spares) {
      this._spares = [];
      if (this.local.kind === 'indexedDB') {
        const ls = probeLocalStorage();
        if (ls) this._spares.push(new LocalStorageBackend(ls));
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

  async loadProfile() {
    await this.init();
    let local = null;
    for (const b of this._readers()) {
      const p = await this._safe('local profile', () => b.getProfile(), null);
      if (p && (!local || (p.updatedAt || 0) > (local.updatedAt || 0))) local = p;
    }
    const cloud = this.cloud ? await this._safe('cloud profile', () => withTimeout(this.cloud.getProfile(), CLOUD_READ_MS, 'cloud read'), null) : null;
    if (local && cloud) return (cloud.updatedAt || 0) > (local.updatedAt || 0) ? cloud : local;
    return cloud || local || null;
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
        const cur = byId.get(m.id);
        if (!cur || (m.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(m.id, { ...m, source });
      }
    };
    for (const b of this._readers()) add(await this._safe('list local', () => b.listMetas(), []), b.kind);
    if (this.cloud) add(await this._safe('list cloud', () => withTimeout(this.cloud.listMetas(), CLOUD_READ_MS, 'cloud read'), []), 'cloud');
    return [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async loadWorld(id) {
    await this.init();
    let local = null;
    for (const b of this._readers()) {
      const w = await this._safe('load local world', () => b.getWorld(id), null);
      if (w && (!local || (w.updatedAt || 0) > (local.updatedAt || 0))) local = w;
    }
    if (!this.cloud) return local;
    const metas = await this._safe('cloud metas', () => withTimeout(this.cloud.listMetas(), CLOUD_READ_MS, 'cloud read'), []);
    const cm = metas.find((m) => m.id === id);
    if (cm && (!local || (cm.updatedAt || 0) > (local.updatedAt || 0))) {
      const cloud = await this._safe('load cloud world', () => withTimeout(this.cloud.getWorld(id), CLOUD_READ_MS * 3, 'cloud read'), null);
      if (cloud) return cloud;
    }
    return local;
  }

  async saveWorld(save) {
    await this.init();
    if (!save || !save.id) return { ok: false, error: 'no id' };
    if (!save.updatedAt) save.updatedAt = Date.now();
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

  async _deleteOne(id) {
    await this.init();
    this._pendingWorlds.delete(id);
    let ok = true;
    for (const b of this._readers()) {
      try {
        await b.deleteWorld(id);
      } catch (err) {
        console.warn('[storage] delete failed', b.kind, err);
        if (b === this.local) ok = false;
      }
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

  // ----- cloud throttling -----

  _scheduleCloud(key) {
    if (this.cloudReadOnly || this._timers.has(key)) return;
    const last = this._lastCloudWrite.get(key) || 0;
    const wait = Math.max(0, last + CLOUD_MIN_INTERVAL - Date.now());
    const timer = setTimeout(() => {
      this._timers.delete(key);
      this._pushCloud(key);
    }, wait);
    this._timers.set(key, timer);
  }

  async _pushCloud(key) {
    if (!this.cloud || this.cloudReadOnly) return;
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
    return { ok: true };
  }
}
