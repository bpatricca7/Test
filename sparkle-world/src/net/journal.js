// Host Journal (docs/MULTIPLAYER.md §5.5, §5.7): key -> last sequence number, dirty sets,
// flush() into numbered batches of CURRENT values (<= 3,900 B each), since(from) for
// catch-up fixes, and the floor below which a fix is impossible.
//
// Keys: cell index i, entity uid, plant cell index i, actor 'kind:id'.

import { C } from './protocol.js';
import { packCells, encodeRegion } from './codec.js';
import { jsonBytes } from './transport.js';

const COLUMN_DIRTY_MAX = 32; // more dirty cells than this in one 16x16 column -> one region
const REGION_CHARS = 3000; // a region's base64 must fit a message with room to spare

export class Journal {
  constructor({ maxKeys = C.JOURNAL_MAX_KEYS, msgBytes = C.MSG_BYTES } = {}) {
    this.maxKeys = maxKeys;
    this.msgBytes = msgBytes;
    this.seq = 0;
    this.floor = 0;
    this.cells = new Map();
    this.ents = new Map();
    this.plants = new Map();
    this.actors = new Map();
    this.dCells = new Set();
    this.dEnts = new Set();
    this.dPlants = new Set();
    this.dActors = new Set();
    this.hints = [];
    this.oversize = 0;
  }

  touchCell(i) { this.dCells.add(i); }
  touchEnt(uid) { this.dEnts.add(uid); }
  touchPlant(i) { this.dPlants.add(i); }
  touchActor(key) { this.dActors.add(key); }
  hint(h) { if (this.hints.length < 8) this.hints.push(h); }

  get dirty() {
    return this.dCells.size + this.dEnts.size + this.dPlants.size + this.dActors.size > 0;
  }

  get size() {
    return this.cells.size + this.ents.size + this.plants.size + this.actors.size;
  }

  /**
   * Pack every dirty key with its current value into batches. `head` fields ({e, a?, r?}) go
   * into the first message (the ack must never arrive after a value it clears). Each message
   * gets the next sequence number. Returns [] when nothing is dirty and no head extras.
   * @returns {{msgs: object[], oversize: boolean}}
   */
  flush(adapter, head) {
    const items = collectItems(adapter, this.dCells, this.dEnts, this.dPlants, this.dActors);
    this.dCells.clear();
    this.dEnts.clear();
    this.dPlants.clear();
    this.dActors.clear();
    const hints = this.hints;
    this.hints = [];
    const extras = (head.a ? 1 : 0) + (head.r ? 1 : 0);
    if (items.length === 0 && extras === 0) return { msgs: [], oversize: false };

    const msgs = [];
    let oversize = false;
    const limit = this.msgBytes - 48;
    let cur = null;
    let size = 0;
    let keys = null;
    const start = (first) => {
      cur = { e: head.e, s: 0 };
      size = 32 + head.e.length;
      keys = [];
      if (first) {
        if (head.a) {
          cur.a = head.a;
          size += 6 + jsonBytes(head.a);
        }
        if (head.r) {
          cur.r = head.r;
          size += 6 + jsonBytes(head.r);
        }
        if (hints.length) {
          cur.f = hints;
          size += 6 + jsonBytes(hints);
        }
      }
    };
    const finish = () => {
      this.seq += 1;
      cur.s = this.seq;
      for (const k of keys) this._mark(k, this.seq);
      msgs.push(cur);
      cur = null;
    };
    start(true);
    const cost = (it) => (it.f === 'c' ? 7 + (cur.c === undefined ? 7 : 0) : it.bytes + (cur[it.f] === undefined ? 7 : 1));
    for (const it of items) {
      if (it.bytes + 48 > limit) {
        // cannot travel in a batch: mark it so fixes and snapshots carry it
        oversize = true;
        this.oversize++;
        this._markLater(it);
        continue;
      }
      let add = cost(it);
      if (size + add > limit && keys.length > 0) {
        finish();
        start(false);
        add = cost(it);
      }
      if (it.f === 'c') cur.c = (cur.c || '') + it.v;
      else (cur[it.f] ||= []).push(it.v);
      size += add;
      if (it.cells) for (const i of it.cells) keys.push(['c', i]);
      else keys.push(it.key);
    }
    finish();
    if (this._late) {
      for (const k of this._late) this._mark(k, this.seq);
      this._late = null;
    }
    if (this.size > this.maxKeys) this._compact();
    return { msgs, oversize };
  }

  _markLater(it) {
    this._late ||= [];
    if (it.cells) for (const i of it.cells) this._late.push(['c', i]);
    else this._late.push(it.key);
  }

  _mark(k, seq) {
    const [kind, key] = k;
    if (kind === 'c') this.cells.set(key, seq);
    else if (kind === 'e') this.ents.set(key, seq);
    else if (kind === 'p') this.plants.set(key, seq);
    else this.actors.set(key, seq);
  }

  /** Keys changed after sequence `from` (for a fix). */
  since(from) {
    const pick = (m) => {
      const out = [];
      for (const [k, s] of m) if (s > from) out.push(k);
      return out;
    };
    return { cells: pick(this.cells), ents: pick(this.ents), plants: pick(this.plants), actors: pick(this.actors) };
  }

  /** Keep the newest half: the floor rises to the median sequence number. */
  _compact() {
    const all = [];
    for (const m of [this.cells, this.ents, this.plants, this.actors]) for (const s of m.values()) all.push(s);
    all.sort((a, b) => a - b);
    const median = all[all.length >> 1];
    if (median <= this.floor) return;
    this.floor = median;
    for (const m of [this.cells, this.ents, this.plants, this.actors]) {
      for (const [k, s] of m) if (s <= median) m.delete(k);
    }
  }

  /** Start over (a new epoch). */
  reset() {
    this.seq = 0;
    this.floor = 0;
    for (const m of [this.cells, this.ents, this.plants, this.actors, this.dCells, this.dEnts, this.dPlants, this.dActors]) m.clear();
    this.hints = [];
  }
}

/**
 * Current values of the given keys as wire items: { f: 'c'|'g'|'E'|'X'|'P'|'K', v, bytes,
 * key | cells }. Cells go as `c` unless one 16x16 column holds more than 32 of them; then they
 * go as regions over the dirty bounding box (re-encoding current ids, which is idempotent).
 */
export function collectItems(adapter, cells, ents, plants, actors) {
  const items = [];
  if (cells.size !== undefined ? cells.size > 0 : cells.length > 0) {
    const { sx, sz } = adapter.size();
    const cols = new Map();
    for (const i of cells) {
      const x = i % sx;
      const z = Math.floor(i / sx) % sz;
      const key = (z >> 4) * 4096 + (x >> 4);
      let list = cols.get(key);
      if (!list) cols.set(key, (list = []));
      list.push(i);
    }
    for (const list of cols.values()) {
      if (list.length > COLUMN_DIRTY_MAX) {
        regionItems(adapter, sx, sz, list, items);
      } else {
        for (const i of list) items.push({ f: 'c', v: packCells([i, adapter.getCell(i)]), bytes: 7, key: ['c', i] });
      }
    }
  }
  for (const uid of ents) {
    const rec = adapter.entityRecord(uid);
    if (rec) items.push({ f: 'E', v: rec, bytes: jsonBytes(rec), key: ['e', uid] });
    else items.push({ f: 'X', v: uid, bytes: String(uid).length, key: ['e', uid] });
  }
  for (const i of plants) {
    const rec = adapter.plantRecord(i) || [i, 0, 0, 0];
    items.push({ f: 'P', v: rec, bytes: jsonBytes(rec), key: ['p', i] });
  }
  for (const key of actors) {
    const cut = key.indexOf(':');
    const kind = key.slice(0, cut);
    const id = key.slice(cut + 1);
    const rec = adapter.actorRecord(kind, id) || [kind, id, 0];
    items.push({ f: 'K', v: rec, bytes: jsonBytes(rec), key: ['a', key] });
  }
  return items;
}

function regionItems(adapter, sx, sz, list, items) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -1, y1 = -1, z1 = -1;
  const xyz = [];
  for (const i of list) {
    const x = i % sx;
    const t = Math.floor(i / sx);
    const z = t % sz;
    const y = Math.floor(t / sz);
    xyz.push(x, y, z, i);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  splitRegion(adapter, sx, sz, x0, y0, z0, x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1, xyz, items);
}

function splitRegion(adapter, sx, sz, x0, y0, z0, dx, dy, dz, xyz, items) {
  const b64 = encodeRegion((i) => adapter.getCell(i), sx, sz, x0, y0, z0, dx, dy, dz);
  if (b64.length <= REGION_CHARS || dx * dy * dz <= 64) {
    const cells = [];
    for (let k = 0; k < xyz.length; k += 4) {
      const x = xyz[k], y = xyz[k + 1], z = xyz[k + 2];
      if (x >= x0 && x < x0 + dx && y >= y0 && y < y0 + dy && z >= z0 && z < z0 + dz) cells.push(xyz[k + 3]);
    }
    if (cells.length === 0) return;
    const v = [x0, y0, z0, dx, dy, dz, b64];
    items.push({ f: 'g', v, bytes: jsonBytes(v), cells });
    return;
  }
  // halve along the longest axis
  if (dy >= dx && dy >= dz) {
    const h = dy >> 1;
    splitRegion(adapter, sx, sz, x0, y0, z0, dx, h, dz, xyz, items);
    splitRegion(adapter, sx, sz, x0, y0 + h, z0, dx, dy - h, dz, xyz, items);
  } else if (dx >= dz) {
    const h = dx >> 1;
    splitRegion(adapter, sx, sz, x0, y0, z0, h, dy, dz, xyz, items);
    splitRegion(adapter, sx, sz, x0 + h, y0, z0, dx - h, dy, dz, xyz, items);
  } else {
    const h = dz >> 1;
    splitRegion(adapter, sx, sz, x0, y0, z0, dx, dy, h, xyz, items);
    splitRegion(adapter, sx, sz, x0, y0, z0 + h, dx, dy, dz - h, xyz, items);
  }
}

/** One payload object {c, g, X, E, P, K} holding the current values of `keys` (for fixes). */
export function buildPayload(adapter, keys) {
  const items = collectItems(adapter, keys.cells, keys.ents, keys.plants, keys.actors);
  const p = {};
  for (const it of items) {
    if (it.f === 'c') p.c = (p.c || '') + it.v;
    else (p[it.f] ||= []).push(it.v);
  }
  return p;
}
