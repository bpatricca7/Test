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

/** World meta = the small part of a save used by the My Worlds list. */
export function metaOf(save) {
  return {
    id: save.id,
    name: save.name,
    biome: save.biome,
    size: save.size,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt || 0,
    thumbnail: save.thumbnail || null,
  };
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
  async putProfile(p) { this._set('profile', p); }
  async listMetas() { return Object.values(this._get('metas') || {}); }
  async getWorld(id) { return this._get('world:' + id); }
  async putWorld(save) {
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
    this.root = db.doc(`data/users/${uid}/profile`);
    this._chains = new Map(); // doc path -> promise (one write at a time per doc)
    this._partCounts = new Map();
  }
  _write(ref, fn) {
    const prev = this._chains.get(ref.path) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => fn(ref));
    this._chains.set(ref.path, next);
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

  get backendName() {
    return this.local.kind + (this.cloud ? '+cloud' : '');
  }

  /** Will saves survive closing the page? (false: memory only, e.g. a sandboxed frame) */
  get persistent() {
    return this.local.kind !== 'memory' || !!this.cloud;
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
    const ok = local.ok || !!this.cloud;
    const persistent = (local.ok && local.backend.kind !== 'memory') || !!this.cloud;
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

  // ----- profile -----

  async loadProfile() {
    await this.init();
    let local = null;
    for (const b of this._readers()) {
      const p = await this._safe('local profile', () => b.getProfile(), null);
      if (p && (!local || (p.updatedAt || 0) > (local.updatedAt || 0))) local = p;
    }
    const cloud = this.cloud ? await this._safe('cloud profile', () => this.cloud.getProfile(), null) : null;
    if (local && cloud) return (cloud.updatedAt || 0) > (local.updatedAt || 0) ? cloud : local;
    return cloud || local || null;
  }

  async saveProfile(profile) {
    await this.init();
    if (!profile.updatedAt) profile.updatedAt = Date.now();
    const copy = JSON.parse(JSON.stringify(profile));
    const local = await this._writeLocal('profile save', (b) => b.putProfile(copy));
    if (this.cloud) {
      this._pendingProfile = copy;
      this._scheduleCloud('profile');
    }
    return this._result(local);
  }

  // ----- worlds -----

  /** Metas of all worlds, newest first (merged local + cloud by updatedAt). */
  async listWorlds() {
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
    if (this.cloud) add(await this._safe('list cloud', () => this.cloud.listMetas(), []), 'cloud');
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
    const metas = await this._safe('cloud metas', () => this.cloud.listMetas(), []);
    const cm = metas.find((m) => m.id === id);
    if (cm && (!local || (cm.updatedAt || 0) > (local.updatedAt || 0))) {
      const cloud = await this._safe('load cloud world', () => this.cloud.getWorld(id), null);
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
    if (this.cloud) {
      this._pendingWorlds.set(save.id, save);
      this._scheduleCloud(save.id);
    }
    return this._result(local);
  }

  async deleteWorld(id) {
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
    if (this.cloud) {
      try {
        await this.cloud.deleteWorld(id);
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
    if (this._timers.has(key)) return;
    const last = this._lastCloudWrite.get(key) || 0;
    const wait = Math.max(0, last + CLOUD_MIN_INTERVAL - Date.now());
    const timer = setTimeout(() => {
      this._timers.delete(key);
      this._pushCloud(key);
    }, wait);
    this._timers.set(key, timer);
  }

  async _pushCloud(key) {
    if (!this.cloud) return;
    this._lastCloudWrite.set(key, Date.now());
    try {
      if (key === 'profile') {
        const p = this._pendingProfile;
        this._pendingProfile = null;
        if (p) await this.cloud.putProfile(p);
      } else {
        const save = this._pendingWorlds.get(key);
        this._pendingWorlds.delete(key);
        if (save) await this.cloud.putWorld(save);
      }
    } catch (err) {
      console.warn('[storage] cloud write failed', key, err);
    }
  }

  /** Push every pending cloud write now (leaving the world, tab hidden, page closing). */
  async flush() {
    if (!this.cloud) return { ok: true };
    const keys = [...this._timers.keys()];
    for (const k of keys) {
      clearTimeout(this._timers.get(k));
      this._timers.delete(k);
    }
    await Promise.all(keys.map((k) => this._pushCloud(k)));
    return { ok: true };
  }
}
