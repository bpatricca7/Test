// The voxel world: block ids, light channels, chunk dirty flags and (de)serialization.

import { Lighting } from './light.js';

export const CHUNK = 16;
export const WORLD_SIZES = {
  cozy: { x: 144, y: 64, z: 144 },
  big: { x: 208, y: 64, z: 208 },
};

export class World {
  /**
   * @param {{x:number,y:number,z:number}} size
   * @param {import('../core/registry.js').BlockRegistry} registry
   */
  constructor(size, registry) {
    this.sx = size.x;
    this.sy = size.y;
    this.sz = size.z;
    this.size = { x: size.x, y: size.y, z: size.z };
    this.registry = registry;
    const n = this.sx * this.sy * this.sz;
    this.blocks = new Uint8Array(n);
    this.sky = new Uint8Array(n);
    this.blockLight = new Uint8Array(n);
    this.cxCount = Math.ceil(this.sx / CHUNK);
    this.czCount = Math.ceil(this.sz / CHUNK);
    this.dirty = new Uint8Array(this.cxCount * this.czCount);
    this.dirtyCount = 0;
    this.lightSources = new Map(); // voxel index -> array of levels
    this.light = new Lighting(this);
    this.meta = { id: null, name: 'My World', biome: 'meadow', seed: 1, createdAt: Date.now() };
    this.game = null; // set by Game when the world is entered (for events)
    this.waterLevel = 0; // set by world generation; used for the horizon plane
    this.outside = null; // { block, level } horizon filler, set by the biome
    this._batch = null;
    const stone = registry.byKey('stone');
    this.floorId = stone ? stone.id : 1;
  }

  index(x, y, z) {
    return (y * this.sz + z) * this.sx + x;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  /** Block id at integer coords. Out of bounds: solid floor below y=0, air elsewhere. */
  get(x, y, z) {
    if (y < 0) return this.floorId;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y >= this.sy) return 0;
    return this.blocks[(y * this.sz + z) * this.sx + x];
  }

  /** Block definition at coords (air def when empty). */
  defAt(x, y, z) {
    return this.registry.byId(this.get(x, y, z));
  }

  getSky(x, y, z) {
    if (!this.inBounds(x, y, z)) return y < 0 ? 0 : 15;
    return this.sky[this.index(x, y, z)];
  }

  getBlockLight(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.blockLight[this.index(x, y, z)];
  }

  /**
   * Change a block. Marks chunks dirty, relights incrementally and (when record) emits
   * 'block:place' / 'block:remove'. Returns true if something changed.
   */
  set(x, y, z, id, { record = true } = {}) {
    x |= 0; y |= 0; z |= 0;
    if (!this.inBounds(x, y, z)) return false;
    const i = (y * this.sz + z) * this.sx + x;
    const prev = this.blocks[i];
    if (prev === id) return false;
    this.blocks[i] = id;
    if (this._batch) {
      const b = this._batch;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
      if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z;
      b.count++;
    } else {
      this.light.onBlockChanged(i);
      this.markDirtyAround(x, y, z);
    }
    if (record && this.game) {
      const reg = this.registry;
      if (id === 0) this.game.events.emit('block:remove', { x, y, z, id: prev, key: reg.byId(prev)?.key });
      else this.game.events.emit('block:place', { x, y, z, id, prev, key: reg.byId(id)?.key });
    }
    return true;
  }

  /** Set by key (unknown keys are ignored). */
  setKey(x, y, z, key, opts) {
    const id = key === 'air' ? 0 : this.registry.idOf(key);
    if (id < 0) return false;
    return this.set(x, y, z, id, opts);
  }

  /**
   * Run many set() calls, then relight once over the touched columns (+15 margin).
   * Use for prefabs and other bulk edits: far faster than per-block incremental relight.
   */
  batch(fn) {
    if (this._batch) return fn();
    this._batch = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, count: 0 };
    try {
      return fn();
    } finally {
      const b = this._batch;
      this._batch = null;
      if (b.count > 0) {
        this.light.computeRegion(b.x0 - 15, b.z0 - 15, b.x1 + 15, b.z1 + 15);
        this.markDirtyRegion(b.x0 - 15, b.z0 - 15, b.x1 + 15, b.z1 + 15);
      }
    }
  }

  /** y of the highest solid block in a column (-1 if none). */
  heightAt(x, z) {
    x |= 0; z |= 0;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return -1;
    const solid = this.registry.props ? this.registry.props.solid : null;
    for (let y = this.sy - 1; y >= 0; y--) {
      const id = this.blocks[(y * this.sz + z) * this.sx + x];
      if (id !== 0 && (!solid || solid[id])) return y;
    }
    return -1;
  }

  /** y of the highest non-air block (including water and plants), -1 if none. */
  surfaceAt(x, z) {
    for (let y = this.sy - 1; y >= 0; y--) if (this.get(x, y, z) !== 0) return y;
    return -1;
  }

  // ---------- light sources (entities such as lamps) ----------

  addLightSource(x, y, z, level) {
    if (!this.inBounds(x, y, z) || level <= 0) return;
    const i = this.index(x, y, z);
    const list = this.lightSources.get(i) || [];
    list.push(Math.min(15, level | 0));
    this.lightSources.set(i, list);
    this.light.updateBlockLightAt(i);
  }

  removeLightSource(x, y, z, level) {
    if (!this.inBounds(x, y, z)) return;
    const i = this.index(x, y, z);
    const list = this.lightSources.get(i);
    if (!list) return;
    let k = level === undefined ? -1 : list.indexOf(Math.min(15, level | 0));
    if (k < 0) k = list.indexOf(Math.max(...list));
    list.splice(k, 1);
    if (list.length === 0) this.lightSources.delete(i);
    this.light.updateBlockLightAt(i);
  }

  // ---------- dirty tracking ----------

  markChunkDirty(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.cxCount || cz >= this.czCount) return;
    const k = cz * this.cxCount + cx;
    if (!this.dirty[k]) {
      this.dirty[k] = 1;
      this.dirtyCount++;
    }
  }

  /** A voxel's appearance changed: dirty its chunk and any neighbour that samples it. */
  markDirtyCell(x, z) {
    const cx = x >> 4, cz = z >> 4;
    const lx = x & 15, lz = z & 15;
    this.markChunkDirty(cx, cz);
    const dx = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (dx) this.markChunkDirty(cx + dx, cz);
    if (dz) this.markChunkDirty(cx, cz + dz);
    if (dx && dz) this.markChunkDirty(cx + dx, cz + dz);
  }

  markDirtyAround(x, y, z) {
    this.markDirtyCell(x, z);
  }

  markDirtyRegion(x0, z0, x1, z1) {
    for (let cz = Math.max(0, (z0 - 1) >> 4); cz <= Math.min(this.czCount - 1, (z1 + 1) >> 4); cz++) {
      for (let cx = Math.max(0, (x0 - 1) >> 4); cx <= Math.min(this.cxCount - 1, (x1 + 1) >> 4); cx++) {
        this.markChunkDirty(cx, cz);
      }
    }
  }

  markAllDirty() {
    this.dirty.fill(1);
    this.dirtyCount = this.dirty.length;
  }

  /** Compute all lighting from scratch (after generation or loading). */
  computeAllLight() {
    const mark = this.light.markDirty;
    this.light.markDirty = false;
    this.light.computeRegion(0, 0, this.sx - 1, this.sz - 1);
    this.light.markDirty = mark;
    this.markAllDirty();
  }

  // ---------- serialization ----------

  /** Block ids as RLE (id byte + LEB128 run length) encoded to base64. */
  encodeBlocks() {
    const src = this.blocks;
    let out = new Uint8Array(1 << 16);
    let o = 0;
    const put = (b) => {
      if (o === out.length) {
        const bigger = new Uint8Array(out.length * 2);
        bigger.set(out);
        out = bigger;
      }
      out[o++] = b;
    };
    let i = 0;
    const n = src.length;
    while (i < n) {
      const id = src[i];
      let run = 1;
      while (i + run < n && src[i + run] === id) run++;
      put(id);
      let r = run;
      while (r >= 0x80) { put((r & 0x7f) | 0x80); r >>>= 7; }
      put(r);
      i += run;
    }
    return bytesToBase64(out.subarray(0, o));
  }

  /** Decode encodeBlocks() output, remapping ids through a saved palette of keys. */
  decodeBlocks(b64, palette) {
    const bytes = base64ToBytes(b64);
    const remap = new Uint8Array(256);
    if (palette) {
      palette.forEach((key, oldId) => {
        const id = this.registry.idOf(key);
        remap[oldId] = id < 0 ? 0 : id;
      });
    } else {
      for (let k = 0; k < 256; k++) remap[k] = k;
    }
    const dst = this.blocks;
    let o = 0, i = 0;
    while (i < bytes.length && o < dst.length) {
      const id = remap[bytes[i++]];
      let run = 0, shift = 0, b;
      do {
        b = bytes[i++];
        run |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      const end = Math.min(dst.length, o + run);
      if (id !== 0) dst.fill(id, o, end);
      o = end;
    }
  }

  /** Current id -> key palette for saves. */
  palette() {
    return this.registry.defs.map((d) => d.key);
  }
}

export function bytesToBase64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
