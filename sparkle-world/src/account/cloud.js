// HttpCloudBackend (docs/ACCOUNTS.md §7.3): one player's saves on the family server, in the
// SaveStore's cloud slot (src/core/storage.js). The same six methods as claude.ai's
// CloudBackend, plus what a revisioned backend offers the store: `revisions` (If-Match on every
// write, `_rev` on every read), `minInterval` (30 s between pushes of one thing), `strip()`.
//
//   getProfile()            GET  …/profile        → profile + _rev, or null (204)
//   putProfile(p, {base})   PUT  …/profile        → { rev }
//   listMetas({fresh})      GET  …/worlds         → metas + tombstones (cached 10 s)
//   getWorld(id)            GET  …/worlds/:id     → save + _rev
//   putWorld(save, {base})  PUT  …/worlds/:id     (gzip with CompressionStream where there is one)
//   deleteWorld(id)         DELETE …/worlds/:id   → { rev }
//
// A 410 player_gone / family_gone calls onGone(code) once (the account module wipes this
// player's copy and goes back to the picker). `offline` (booted from the cache): reads fail at
// once instead of waiting for their timeouts, until a write gets through.

import { apiError, revOf } from './api.js';
import { cloudProfile } from './merge.js';

const READ_MS = 8000;
const WORLD_READ_MS = 24000;
const WRITE_MS = 20000;
const METAS_MS = 10000;

async function gzipText(text) {
  if (typeof CompressionStream !== 'function' || typeof Response !== 'function' || typeof Blob !== 'function') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export class HttpCloudBackend {
  /** @param {string} pid  @param {{ api, onGone?, offline? }} o */
  constructor(pid, o) {
    this.kind = 'cloud';
    this.revisions = true;
    this.minInterval = 30000;
    this.pid = pid;
    this.api = o.api;
    this.onGone = o.onGone || null;
    this.offline = !!o.offline;
    this._metas = null;
    this._metasAt = 0;
    this._gone = false;
  }

  strip(p) {
    return cloudProfile(p);
  }

  _path(rest = '') {
    return `/api/players/${encodeURIComponent(this.pid)}${rest}`;
  }

  async _call(method, rest, opts) {
    if (this.offline && method === 'GET') throw apiError(0, 'offline');
    try {
      const r = await this.api.call(method, this._path(rest), opts);
      if (method !== 'GET') this.offline = false;
      return r;
    } catch (err) {
      if (err.status === 410 && (err.code === 'player_gone' || err.code === 'family_gone') && !this._gone) {
        this._gone = true;
        if (this.onGone) setTimeout(() => this.onGone(err.code), 0);
      }
      throw err;
    }
  }

  async getProfile() {
    const r = await this._call('GET', '/profile', { timeout: READ_MS });
    if (r.status === 204 || !r.json) return null;
    r.json._rev = revOf(r.etag);
    return r.json;
  }

  async putProfile(p, { base } = {}) {
    const r = await this._call('PUT', '/profile', { json: cloudProfile(p), ifMatch: base ? `"r${base}"` : '*', timeout: WRITE_MS });
    return { rev: r.json && r.json.rev };
  }

  async listMetas({ fresh = false } = {}) {
    if (!fresh && this._metas && Date.now() - this._metasAt < METAS_MS) return this._metas.map((m) => ({ ...m }));
    const r = await this._call('GET', '/worlds', { timeout: READ_MS });
    this._metas = Array.isArray(r.json) ? r.json : [];
    this._metasAt = Date.now();
    return this._metas.map((m) => ({ ...m }));
  }

  async getWorld(id) {
    const r = await this._call('GET', '/worlds/' + encodeURIComponent(id), { timeout: WORLD_READ_MS });
    if (!r.json) return null;
    r.json._rev = revOf(r.etag);
    return r.json;
  }

  async putWorld(save, { base } = {}) {
    const text = JSON.stringify(save);
    const gz = await gzipText(text);
    this._metas = null;
    const r = await this._call('PUT', '/worlds/' + encodeURIComponent(save.id), {
      body: gz || text,
      headers: gz ? { 'Content-Encoding': 'gzip' } : {},
      ifMatch: base ? `"r${base}"` : '*',
      timeout: WRITE_MS,
    });
    return { rev: r.json && r.json.rev };
  }

  async deleteWorld(id) {
    this._metas = null;
    const r = await this._call('DELETE', '/worlds/' + encodeURIComponent(id), { json: {}, timeout: WRITE_MS });
    return { rev: r.json && r.json.rev };
  }
}
