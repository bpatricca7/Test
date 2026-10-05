// The sea map (docs/teams/ocean.md §4.1): the water depth of every column, built once at world
// load and kept current by edit events plus a round-robin rescan of two rows a frame. Pure: no
// THREE, Node-testable. Every loop has a fixed bound.
//
// A column is water only when its top non-air block (lying-flat carpet blocks such as lily
// pads, seashells and starfish skipped) is a liquid. Ice, a bridge or a block over the water
// makes it not-water: nothing swims under ice and nothing leaps into a bridge.

const SHAPE_LIQUID = 5;
const SHAPE_CARPET = 4;
const NONE = 255;
const F_PLACED = 1;

export class SeaMap {
  constructor() {
    this.world = null;
    this.sx = 0;
    this.sz = 0;
    this._top = null;    // y of the top liquid cell, NONE when not water
    this._depth = null;  // liquid cells from the top down, 0..15
    this._ground = null; // y of the top non-air, non-carpet block (land columns), NONE if none
    this._flags = null;
    this._dirty = null;
    this._nDirty = 0;
    this._cursor = 0;
    this._out = { liquid: false, level: -1, depth: 0, bed: -1 };
    this._stats = { ms: 0, liquid: 0, deep: 0, shallow: 0, ticks: 0 };
  }

  /** Full scan (world load only). reg defaults to world.registry ({ props, byKey }). */
  attach(world, reg = world.registry) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.world = world;
    this.props = reg.props;
    this.sx = world.sx;
    this.sz = world.sz;
    const n = this.sx * this.sz;
    if (!this._top || this._top.length !== n) {
      this._top = new Uint8Array(n);
      this._depth = new Uint8Array(n);
      this._ground = new Uint8Array(n);
      this._flags = new Uint8Array(n);
    }
    this._flags.fill(0);
    if (!this._dirty || this._dirty.length !== this.sz) this._dirty = new Uint8Array(this.sz);
    this._dirty.fill(0);
    this._nDirty = 0;
    this._cursor = 0;
    for (let z = 0; z < this.sz; z++) for (let x = 0; x < this.sx; x++) this._scan(x, z);
    this._outside(world, reg);
    const s = this._stats;
    s.liquid = 0; s.deep = 0; s.shallow = 0; s.ticks = 0;
    for (let i = 0; i < n; i++) {
      if (this._top[i] === NONE) continue;
      s.liquid++;
      if (this._depth[i] >= 3) s.deep++;
      else s.shallow++;
    }
    s.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return this;
  }

  detach() {
    this.world = null;
  }

  get attached() {
    return !!this.world;
  }

  _scan(x, z) {
    const w = this.world, b = w.blocks, sx = this.sx, sz = this.sz, shape = this.props.shape;
    const i = z * sx + x;
    let y = w.sy - 1;
    let id = 0;
    for (; y >= 0; y--) {
      id = b[(y * sz + z) * sx + x];
      if (id && shape[id] !== SHAPE_CARPET) break;
    }
    if (y < 0) { this._top[i] = NONE; this._depth[i] = 0; this._ground[i] = NONE; return; }
    if (shape[id] !== SHAPE_LIQUID) {
      this._top[i] = NONE;
      this._depth[i] = 0;
      this._ground[i] = y;
      return;
    }
    let d = 0;
    let yy = y;
    for (; yy >= 0 && d < 64; yy--) {
      if (shape[b[(yy * sz + z) * sx + x]] !== SHAPE_LIQUID) break;
      d++;
    }
    this._top[i] = y;
    this._depth[i] = d > 15 ? 15 : d;
    this._ground[i] = yy >= 0 ? yy : NONE;
  }

  _outside(world, reg) {
    const o = this._out;
    o.liquid = false; o.level = -1; o.depth = 0; o.bed = -1;
    const out = world.outside;
    if (!out || !out.block || typeof reg.byKey !== 'function') return;
    const def = reg.byKey(out.block);
    if (!def || this.props.shape[def.id] !== SHAPE_LIQUID) return;
    // the median depth of the edge columns (every second one) that end in that liquid, like
    // chunks._edgeSeabed
    const ds = [];
    const sample = (x, z) => {
      const i = z * this.sx + x;
      if (this._top[i] === NONE) return;
      if (world.blocks[(this._top[i] * this.sz + z) * this.sx + x] !== def.id) return;
      ds.push(this._depth[i]);
    };
    for (let i = 0; i < this.sx; i += 2) { sample(i, 0); sample(i, this.sz - 1); }
    for (let i = 0; i < this.sz; i += 2) { sample(0, i); sample(this.sx - 1, i); }
    const level = Math.floor(out.surface != null ? out.surface : world.waterLevel || 0);
    let depth = 5;
    if (ds.length) { ds.sort((a, b) => a - b); depth = ds[ds.length >> 1]; }
    o.liquid = true;
    o.level = level;
    o.depth = depth;
    o.bed = level - depth;
  }

  /** Rescan one column now (an edit with an event). fromEdit marks it as a kid's pool cell. */
  setColumn(x, z, fromEdit = true) {
    if (!this.world || !this.inBounds(x, z)) return;
    const i = z * this.sx + x;
    const was = this._top[i] !== NONE;
    this._scan(x, z);
    if (fromEdit && !was && this._top[i] !== NONE) this._flags[i] |= F_PLACED;
  }

  /** Every row is rescanned by tick() (net:applied with cells === null); never a full scan now. */
  markAllDirty() {
    if (!this._dirty) return;
    this._dirty.fill(1);
    this._nDirty = this.sz;
  }

  markRowDirty(z) {
    if (!this._dirty || z < 0 || z >= this.sz) return;
    if (!this._dirty[z]) { this._dirty[z] = 1; this._nDirty++; }
  }

  /** Rescan the next `rows` rows in turn (dirty rows first). Bounded. */
  tick(rows = 2) {
    if (!this.world) return;
    this._stats.ticks++;
    for (let r = 0; r < rows; r++) {
      let z = -1;
      if (this._nDirty > 0) {
        for (let k = 0; k < this.sz; k++) {
          const zz = (this._cursor + k) % this.sz;
          if (this._dirty[zz]) { z = zz; break; }
        }
      }
      if (z < 0) { z = this._cursor; this._cursor = (this._cursor + 1) % this.sz; }
      if (this._dirty[z]) { this._dirty[z] = 0; this._nDirty--; }
      for (let x = 0; x < this.sx; x++) {
        const i = z * this.sx + x;
        const was = this._top[i] !== NONE;
        this._scan(x, z);
        if (!was && this._top[i] !== NONE) this._flags[i] |= F_PLACED;
      }
    }
  }

  inBounds(x, z) {
    return x >= 1 && z >= 1 && x < this.sx - 1 && z < this.sz - 1;
  }

  _in(x, z) {
    return x >= 0 && z >= 0 && x < this.sx && z < this.sz;
  }

  /** y of the top liquid cell of the column, or -1. Out of bounds: the outside ring. */
  top(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.world) return -1;
    if (!this._in(x, z)) return this._out.liquid ? this._out.level : -1;
    const t = this._top[z * this.sx + x];
    return t === NONE ? -1 : t;
  }

  depth(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.world) return 0;
    if (!this._in(x, z)) return this._out.liquid ? this._out.depth : 0;
    return this._depth[z * this.sx + x];
  }

  /** y of the solid cell under the liquid, or -1. */
  bed(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.world) return -1;
    if (!this._in(x, z)) return this._out.liquid ? this._out.bed : -1;
    const i = z * this.sx + x;
    if (this._top[i] === NONE) return -1;
    const g = this._ground[i];
    return g === NONE ? -1 : g;
  }

  /** y of the land top (a non-water column), or -1. */
  ground(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.world || !this._in(x, z)) return -1;
    const i = z * this.sx + x;
    if (this._top[i] !== NONE) return -1;
    const g = this._ground[i];
    return g === NONE ? -1 : g;
  }

  placed(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.world || !this._in(x, z)) return false;
    return (this._flags[z * this.sx + x] & F_PLACED) !== 0;
  }

  /** A solid, non-liquid top block at level or level + 1, next to (4-neighbour) a liquid column. */
  shore(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.world || !this._in(x, z)) return false;
    const i = z * this.sx + x;
    if (this._top[i] !== NONE) return false;
    const g = this._ground[i];
    if (g === NONE) return false;
    const id = this.world.blocks[(g * this.sz + z) * this.sx + x];
    if (!this.props.solid[id]) return false;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = z + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!this._in(nx, nz)) continue;
      const t = this._top[nz * this.sx + nx];
      if (t !== NONE && (g === t || g === t + 1)) return true;
    }
    return false;
  }

  /** The dolphin rule: the column itself and 8 of 9 samples on a 5x5 stride-2 grid are deep. */
  deepAround(x, z, need = 3) {
    x = Math.floor(x); z = Math.floor(z);
    const lvl = this.top(x, z);
    if (lvl < 0 || this.depth(x, z) < need) return false;
    let ok = 0;
    for (let dz = -2; dz <= 2; dz += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        if (this.top(x + dx, z + dz) === lvl && this.depth(x + dx, z + dz) >= need) ok++;
      }
    }
    return ok >= 8;
  }

  /** { liquid, level, depth, bed } for out-of-bounds columns (do not keep the object). */
  outside() {
    return this._out;
  }

  stats() {
    return { ...this._stats };
  }
}
