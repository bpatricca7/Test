// Voxel lighting: two 0..15 channels per voxel.
//  - sky:   15 in open sky, travels straight down without loss, -1 per sideways step
//  - block: flood from emitting blocks and entity light sources, -1 per step
// Full (re)computation works on a column region (used for new worlds and batch edits);
// single edits use the classic removal + re-propagation BFS, bounded to ~15 cells.

/** Growable FIFO of voxel indices (plus an optional level per entry). */
class IndexQueue {
  constructor(capacity = 1 << 16) {
    this.idx = new Int32Array(capacity);
    this.lvl = new Uint8Array(capacity);
    this.head = 0;
    this.tail = 0;
  }
  get size() {
    return this.tail - this.head;
  }
  push(i, level = 0) {
    if (this.tail === this.idx.length) this._grow();
    this.idx[this.tail] = i;
    this.lvl[this.tail] = level;
    this.tail++;
  }
  _grow() {
    const live = this.tail - this.head;
    if (this.head > this.idx.length / 2) {
      this.idx.copyWithin(0, this.head, this.tail);
      this.lvl.copyWithin(0, this.head, this.tail);
    } else {
      const idx = new Int32Array(this.idx.length * 2);
      const lvl = new Uint8Array(this.idx.length * 2);
      idx.set(this.idx.subarray(this.head, this.tail));
      lvl.set(this.lvl.subarray(this.head, this.tail));
      this.idx = idx;
      this.lvl = lvl;
    }
    this.head = 0;
    this.tail = live;
  }
  reset() {
    this.head = 0;
    this.tail = 0;
  }
}

// Shared scratch queues: lighting is single-threaded and never re-entrant.
const addQ = new IndexQueue(1 << 18);
const remQ = new IndexQueue(1 << 15);

export class Lighting {
  constructor(world) {
    this.world = world;
    this.markDirty = true; // mark chunks dirty when light values change
  }

  get props() {
    return this.world.registry.props;
  }

  /** Effective block-light emission of a voxel (block emission or entity light sources). */
  emissionAt(i) {
    const w = this.world;
    let e = this.props.emit[w.blocks[i]];
    if (w.lightSources.size) {
      const s = w.lightSources.get(i);
      if (s) for (const l of s) if (l > e) e = l;
    }
    return e;
  }

  _touch(i) {
    if (!this.markDirty) return;
    const w = this.world;
    const x = i % w.sx;
    const z = ((i - x) / w.sx) % w.sz;
    w.markDirtyCell(x, z);
  }

  /** Recompute both channels for columns x0..x1, z0..z1 (inclusive, full height). */
  computeRegion(x0, z0, x1, z1) {
    const w = this.world;
    const { sx, sy, sz } = w;
    x0 = Math.max(0, x0); z0 = Math.max(0, z0);
    x1 = Math.min(sx - 1, x1); z1 = Math.min(sz - 1, z1);
    const layer = sx * sz;
    const opacity = this.props.opacity;
    const emit = this.props.emit;
    const blocks = w.blocks, sky = w.sky, blk = w.blockLight;

    // 1) clear + straight-down sky pass; remember where the open sky ends per column
    const cw = x1 - x0 + 1, cd = z1 - z0 + 1;
    const tops = new Int16Array((cw + 2) * (cd + 2));
    const topAt = (x, z) => {
      let y = sy - 1;
      while (y >= 0 && opacity[blocks[(y * sz + z) * sx + x]] === 0) y--;
      return y; // first voxel (from top) that blocks some light, or -1
    };
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const t = (z - z0 + 1) * (cw + 2) + (x - x0 + 1);
        if (x < 0 || z < 0 || x >= sx || z >= sz) { tops[t] = -1; continue; }
        const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1;
        if (!inside) { tops[t] = topAt(x, z); continue; }
        let y = sy - 1;
        let i = (y * sz + z) * sx + x;
        while (y >= 0 && opacity[blocks[i]] === 0) {
          sky[i] = 15; blk[i] = 0;
          y--; i -= layer;
        }
        tops[t] = y;
        while (y >= 0) {
          sky[i] = 0; blk[i] = 0;
          y--; i -= layer;
        }
      }
    }

    addQ.reset();
    // 2) sky seeds: open-sky voxels that can spill sideways or down into partial blockers
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const t = (z - z0 + 1) * (cw + 2) + (x - x0 + 1);
        const top = tops[t];
        const nb = Math.max(tops[t - 1], tops[t + 1], tops[t - (cw + 2)], tops[t + (cw + 2)]);
        const yEnd = Math.min(sy - 1, Math.max(top + 1, nb));
        for (let y = top + 1; y <= yEnd; y++) addQ.push((y * sz + z) * sx + x);
      }
    }
    // light flowing in from just outside the region
    this._seedRing(sky, x0, z0, x1, z1);
    this._propagate(sky, true);

    // 3) block light: emitters inside the region + light from outside
    addQ.reset();
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        for (let y = 0, i = z * sx + x; y < sy; y++, i += layer) {
          const b = blocks[i];
          if (b === 0) continue;
          const e = emit[b];
          if (e > 0) { blk[i] = e; addQ.push(i); }
        }
      }
    }
    for (const [i, levels] of w.lightSources) {
      const x = i % sx, z = ((i - x) / sx) % sz;
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const e = Math.max(...levels);
      if (e > blk[i]) { blk[i] = e; addQ.push(i); }
    }
    this._seedRing(blk, x0, z0, x1, z1);
    this._propagate(blk, false);
  }

  _seedRing(arr, x0, z0, x1, z1) {
    const w = this.world;
    const { sx, sy, sz } = w;
    const pushCol = (x, z) => {
      if (x < 0 || z < 0 || x >= sx || z >= sz) return;
      for (let y = 0, i = z * sx + x; y < sy; y++, i += sx * sz) if (arr[i] > 1) addQ.push(i);
    };
    for (let x = x0; x <= x1; x++) { pushCol(x, z0 - 1); pushCol(x, z1 + 1); }
    for (let z = z0; z <= z1; z++) { pushCol(x0 - 1, z); pushCol(x1 + 1, z); }
  }

  /** Flood light outwards from everything in addQ. */
  _propagate(arr, isSky) {
    const w = this.world;
    const { sx, sy, sz } = w;
    const layer = sx * sz;
    const opacity = this.props.opacity;
    const blocks = w.blocks;
    while (addQ.head < addQ.tail) {
      const i = addQ.idx[addQ.head++];
      const L = arr[i];
      if (L <= 1) continue;
      const x = i % sx;
      const t = (i - x) / sx;
      const z = t % sz;
      const y = (t - z) / sz;
      for (let d = 0; d < 6; d++) {
        let n;
        if (d === 0) { if (x === sx - 1) continue; n = i + 1; }
        else if (d === 1) { if (x === 0) continue; n = i - 1; }
        else if (d === 2) { if (z === sz - 1) continue; n = i + sx; }
        else if (d === 3) { if (z === 0) continue; n = i - sx; }
        else if (d === 4) { if (y === sy - 1) continue; n = i + layer; }
        else { if (y === 0) continue; n = i - layer; }
        const op = opacity[blocks[n]];
        if (op >= 15) continue;
        const nl = isSky && d === 5 && L === 15 && op === 0 ? 15 : L - 1 - op;
        if (nl > arr[n]) {
          arr[n] = nl;
          addQ.push(n);
          this._touch(n);
        }
      }
    }
    addQ.reset();
  }

  /**
   * Remove light that came through voxel i (whose old level was `old`), then queue every
   * neighbour still lit from elsewhere so _propagate can refill the hole.
   */
  _remove(arr, i, old, isSky) {
    const w = this.world;
    const { sx, sy, sz } = w;
    const layer = sx * sz;
    remQ.reset();
    arr[i] = 0;
    this._touch(i);
    remQ.push(i, old);
    while (remQ.head < remQ.tail) {
      const j = remQ.idx[remQ.head];
      const lvl = remQ.lvl[remQ.head];
      remQ.head++;
      const x = j % sx;
      const t = (j - x) / sx;
      const z = t % sz;
      const y = (t - z) / sz;
      for (let d = 0; d < 6; d++) {
        let n;
        if (d === 0) { if (x === sx - 1) continue; n = j + 1; }
        else if (d === 1) { if (x === 0) continue; n = j - 1; }
        else if (d === 2) { if (z === sz - 1) continue; n = j + sx; }
        else if (d === 3) { if (z === 0) continue; n = j - sx; }
        else if (d === 4) { if (y === sy - 1) continue; n = j + layer; }
        else { if (y === 0) continue; n = j - layer; }
        const nl = arr[n];
        if (nl === 0) continue;
        if (nl < lvl || (isSky && d === 5 && lvl === 15 && nl === 15)) {
          arr[n] = 0;
          this._touch(n);
          remQ.push(n, nl);
          if (!isSky) {
            const e = this.emissionAt(n);
            if (e > 0) { arr[n] = e; addQ.push(n); }
          }
        } else {
          addQ.push(n);
        }
      }
    }
    remQ.reset();
  }

  _pushNeighbours(i) {
    const w = this.world;
    const { sx, sy, sz } = w;
    const x = i % sx;
    const t = (i - x) / sx;
    const z = t % sz;
    const y = (t - z) / sz;
    if (x < sx - 1) addQ.push(i + 1);
    if (x > 0) addQ.push(i - 1);
    if (z < sz - 1) addQ.push(i + sx);
    if (z > 0) addQ.push(i - sx);
    if (y < sy - 1) addQ.push(i + sx * sz);
    if (y > 0) addQ.push(i - sx * sz);
  }

  /** Incremental relight after the block at voxel i changed. */
  onBlockChanged(i) {
    const w = this.world;
    const opaqueNow = this.props.opacity[w.blocks[i]] >= 15;

    // sky channel
    addQ.reset();
    if (w.sky[i] > 0) this._remove(w.sky, i, w.sky[i], true);
    if (!opaqueNow) this._pushNeighbours(i);
    this._propagate(w.sky, true);

    // block channel
    this.updateBlockLightAt(i, !opaqueNow);
  }

  /** Recompute block light around voxel i (after an emitter or light source changed). */
  updateBlockLightAt(i, reopen = true) {
    const w = this.world;
    addQ.reset();
    if (w.blockLight[i] > 0) this._remove(w.blockLight, i, w.blockLight[i], false);
    const e = this.emissionAt(i);
    if (e > w.blockLight[i]) {
      w.blockLight[i] = e;
      this._touch(i);
      addQ.push(i);
    }
    if (reopen) this._pushNeighbours(i);
    this._propagate(w.blockLight, false);
  }
}
