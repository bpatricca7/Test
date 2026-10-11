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
// Timeouts: reads 8 s, a world 24 s, writes 20 s. A 410 player_gone / family_gone calls
// onGone(code) once (the account module wipes this player's copy and starts again).
// `offline` (booted from the cache): reads fail at once instead of waiting for their
// timeouts, until a write gets through.

import { apiError, revOf } from './api.js';
import { cloudProfile } from './merge.js';

async function gzipText(text) {
  try {
    return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  } catch {
    return null; // no CompressionStream here: plain JSON
  }
}

const copy = (list) => list.map((m) => ({ ...m }));
const match = (base) => (base ? `"r${base}"` : '*');

export class HttpCloudBackend {
  /** @param {string} pid  @param {{ api, onGone?, offline? }} o */
  constructor(pid, o) {
    this.kind = 'cloud';
    this.revisions = true;
    this.minInterval = 30000;
    this.base = '/api/players/' + encodeURIComponent(pid);
    this.api = o.api;
    this.onGone = o.onGone;
    this.offline = !!o.offline;
    this._metas = null;
    this._metasAt = 0;
  }

  strip(p) {
    return cloudProfile(p);
  }

  async _call(method, rest, opts) {
    if (this.offline && method === 'GET') throw apiError(0, 'offline');
    try {
      const r = await this.api.call(method, this.base + rest, opts);
      if (method !== 'GET') this.offline = false;
      return r;
    } catch (err) {
      if (err.status === 410 && /^(player|family)_gone$/.test(err.code) && this.onGone) {
        const fn = this.onGone;
        this.onGone = null;
        setTimeout(() => fn(err.code), 0);
      }
      throw err;
    }
  }

  /** A read with its revision from the ETag. */
  async _read(rest, timeout) {
    const r = await this._call('GET', rest, { timeout });
    if (r.json) r.json._rev = revOf(r.etag);
    return r.json;
  }

  getProfile() {
    return this._read('/profile', 8000);
  }

  async putProfile(p, { base } = {}) {
    return (await this._call('PUT', '/profile', { json: cloudProfile(p), ifMatch: match(base), timeout: 20000 })).json;
  }

  async listMetas({ fresh = false } = {}) {
    if (fresh || !this._metas || Date.now() - this._metasAt > 10000) {
      const r = await this._call('GET', '/worlds', { timeout: 8000 });
      this._metas = Array.isArray(r.json) ? r.json : [];
      this._metasAt = Date.now();
    }
    return copy(this._metas);
  }

  getWorld(id) {
    return this._read('/worlds/' + encodeURIComponent(id), 24000);
  }

  async putWorld(save, { base } = {}) {
    const text = JSON.stringify(save);
    const gz = await gzipText(text);
    this._metas = null;
    const r = await this._call('PUT', '/worlds/' + encodeURIComponent(save.id), {
      body: gz || text, headers: gz ? { 'Content-Encoding': 'gzip' } : {}, ifMatch: match(base), timeout: 20000,
    });
    return r.json;
  }

  async deleteWorld(id) {
    this._metas = null;
    return (await this._call('DELETE', '/worlds/' + encodeURIComponent(id), { json: {}, timeout: 20000 })).json;
  }
}
