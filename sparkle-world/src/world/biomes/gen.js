// World-generation toolkit shared by every biome: a height field with spawn flattening and
// island shores, column filling, liquid bodies (ponds, lakes), feature placement with
// spacing, tree/structure growers, gem-spot picking and the spawn point.
//
// All randomness comes from the world's seeded rand/noise, so a seed always makes the same
// world. Growers write straight into world.blocks (generation runs before lighting).

import { smoothstep, lerp, clamp } from '../../core/util.js';

const warned = new Set();

export class Gen {
  constructor(world, rand, noise, { sea = 20 } = {}) {
    this.world = world;
    this.rand = rand;
    this.noise = noise;
    this.sx = world.sx;
    this.sy = world.sy;
    this.sz = world.sz;
    this.blocks = world.blocks;
    this.sea = sea;
    this.cx = Math.floor(world.sx / 2);
    this.cz = Math.floor(world.sz / 2);
    this.hf = new Float32Array(this.sx * this.sz); // float heights while shaping
    this.H = new Int16Array(this.sx * this.sz); // ground height (top solid block) per column
    this.taken = new Uint8Array(this.sx * this.sz); // columns claimed by features
    this.gems = []; // [{ x, y, z, tag }] candidates
    this.liquids = []; // { x0, z0, x1, z1, level, id, test(x,z) }
    this.spawnR = 12; // keep the start area clear of big features
    this._ids = new Map();
    this.big = world.sx > 160;
  }

  // ---------- ids & raw voxels ----------

  /** Block id for a key; unknown keys give 0 (air) and warn once, so generation never breaks. */
  id(key) {
    let v = this._ids.get(key);
    if (v === undefined) {
      v = this.world.registry.idOf(key);
      if (v < 0) {
        if (!warned.has(key)) { warned.add(key); console.warn(`[worldgen] unknown block "${key}"`); }
        v = 0;
      }
      this._ids.set(key, v);
    }
    return v;
  }

  inside(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x, y, z) {
    if (!this.inside(x, y, z)) return 0;
    return this.blocks[(y * this.sz + z) * this.sx + x];
  }

  set(x, y, z, id) {
    if (!this.inside(x, y, z)) return;
    this.blocks[(y * this.sz + z) * this.sx + x] = id;
  }

  /** Set only where the cell is air (or a replaceable sprite when `soft`). */
  setAir(x, y, z, id) {
    if (!this.inside(x, y, z)) return false;
    const i = (y * this.sz + z) * this.sx + x;
    if (this.blocks[i] !== 0) return false;
    this.blocks[i] = id;
    return true;
  }

  h(x, z) {
    x = clamp(x | 0, 0, this.sx - 1);
    z = clamp(z | 0, 0, this.sz - 1);
    return this.H[z * this.sx + x];
  }

  top(x, z) {
    return this.get(x, this.h(x, z), z);
  }

  // ---------- height field ----------

  /** hf[x,z] = fn(x, z). */
  shape(fn) {
    const { sx, sz, hf } = this;
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) hf[z * sx + x] = fn(x, z);
  }

  /** Ease the middle of the world to a flat start area (radius r0 flat, blends out to r1). */
  flattenSpawn(r0 = 6, r1 = 15, lift = 0) {
    const { sx, sz, hf, cx, cz } = this;
    let sum = 0, n = 0;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { sum += hf[(cz + dz) * sx + cx + dx]; n++; }
    const base = Math.max(this.sea + 3, Math.round(sum / n + lift));
    this.spawnH = base;
    for (let z = Math.max(0, cz - r1 - 1); z <= Math.min(sz - 1, cz + r1 + 1); z++) {
      for (let x = Math.max(0, cx - r1 - 1); x <= Math.min(sx - 1, cx + r1 + 1); x++) {
        const d = Math.hypot(x - cx, z - cz);
        const k = z * sx + x;
        hf[k] = lerp(base, hf[k], smoothstep(r0, r1, d));
      }
    }
  }

  /**
   * Slope the land into the sea toward the world edge (island worlds). The coast follows a
   * rounded square (superellipse) with a wobbly outline, so islands never look boxy.
   */
  islandEdge(depth = 5, width = null) {
    const { sx, sz, hf, noise, cx, cz } = this;
    const wdt = width || (this.big ? 26 : 22);
    const half = Math.min(sx, sz) / 2;
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const dx = Math.abs(x - cx) / half, dz = Math.abs(z - cz) / half;
        const r = Math.pow(dx * dx * dx + dz * dz * dz, 1 / 3);
        const ang = Math.atan2(z - cz, x - cx);
        const coast = noise.n2(Math.cos(ang) * 1.6 + 3, Math.sin(ang) * 1.6 - 5) * 0.075 + noise.n2(x / 17, z / 17) * 0.03;
        const e = (0.98 - r + coast) * half;
        if (e > wdt + 4) continue;
        const k = z * sx + x;
        hf[k] = lerp(this.sea - depth, hf[k], smoothstep(1, wdt, e));
      }
    }
  }

  /** Round the float heights into H. */
  commit(min = 3, max = null) {
    const top = max ?? this.sy - 14;
    for (let i = 0; i < this.hf.length; i++) this.H[i] = Math.round(clamp(this.hf[i], min, top));
  }

  /**
   * Fill every column. fn(x, z, h) -> [topId, underId, deepId, underDepth = 3, midId, midDepth].
   * From the top: `top` at h, then `mid` for midDepth blocks (optional), `under` down to
   * h - underDepth, and `deep` below.
   */
  fillColumns(fn) {
    const { sx, sz, blocks } = this;
    const layer = sx * sz;
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const h = this.H[z * sx + x];
        const [topId, underId, deepId, depth = 3, midId = 0, midDepth = 0] = fn(x, z, h);
        let i = z * sx + x;
        for (let y = 0; y <= h; y++, i += layer) {
          blocks[i] = y === h ? topId : midDepth && y >= h - midDepth ? midId : y >= h - depth ? underId : deepId;
        }
      }
    }
  }

  /** Flood every column below `level` with liquid (the sea). */
  fillSea(liquidId, level = this.sea) {
    const { sx, sz, blocks } = this;
    const layer = sx * sz;
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const h = this.H[z * sx + x];
        let i = (h + 1) * layer + z * sx + x;
        for (let y = h + 1; y <= level; y++, i += layer) if (blocks[i] === 0) blocks[i] = liquidId;
      }
    }
  }

  // ---------- ponds & lakes ----------

  /**
   * Carve a bowl-shaped pond into the float heights. The water level sits one below the
   * lowest ground on its rim so the pond is always held in (no floating water).
   * Returns the pond { x, z, r, level } (liquid is poured by pourPonds after fillColumns).
   */
  carvePond(px, pz, r, { depth = 3, liquid = 'water', bed = 'sand', ice = false, lilies = 0, rimMin = null } = {}) {
    const { sx, sz, hf, noise } = this;
    // lowest rim height
    let rim = Infinity;
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      for (const f of [1.0, 1.15, 1.3]) {
        const x = Math.round(px + Math.cos(ang) * r * f), z = Math.round(pz + Math.sin(ang) * r * f);
        if (x < 0 || z < 0 || x >= sx || z >= sz) continue;
        rim = Math.min(rim, hf[z * sx + x]);
      }
    }
    if (rimMin !== null) rim = Math.max(rim, rimMin);
    const level = Math.round(rim) - 1;
    const R = Math.ceil(r * 1.4);
    for (let z = Math.max(1, Math.floor(pz - R)); z <= Math.min(sz - 2, Math.ceil(pz + R)); z++) {
      for (let x = Math.max(1, Math.floor(px - R)); x <= Math.min(sx - 2, Math.ceil(px + R)); x++) {
        const wob = 1 + noise.n2(x / 6 + 31, z / 6 - 17) * 0.18;
        const d = Math.hypot(x - px, z - pz) / (r * wob);
        const k = z * sx + x;
        if (d < 1) hf[k] = Math.min(hf[k], level - 0.4 - depth * Math.cos(d * Math.PI / 2) ** 1.2);
        else if (d < 1.35) hf[k] = Math.max(hf[k], level + 1); // keep a rim
      }
    }
    const pond = { x: px, z: pz, r, level, liquid, bed, ice, lilies, R };
    this.liquids.push(pond);
    for (let z = Math.floor(pz - r - 2); z <= pz + r + 2; z++) for (let x = Math.floor(px - r - 2); x <= px + r + 2; x++) this.claim(x, z);
    return pond;
  }

  /** Pour carved ponds (after fillColumns): liquid up to their level, a bed under it. */
  pourPonds() {
    for (const p of this.liquids) {
      const lid = this.id(p.liquid), bed = this.id(p.bed), ice = this.id('ice');
      const R = p.R;
      for (let z = Math.floor(p.z - R); z <= Math.ceil(p.z + R); z++) {
        for (let x = Math.floor(p.x - R); x <= Math.ceil(p.x + R); x++) {
          if (x < 1 || z < 1 || x >= this.sx - 1 || z >= this.sz - 1) continue;
          const h = this.h(x, z);
          if (h >= p.level) continue;
          this.set(x, h, z, bed);
          for (let y = h + 1; y <= p.level; y++) this.set(x, y, z, lid);
          if (p.ice && this.rand() < 0.93) this.set(x, p.level, z, ice);
          else if (p.lilies && this.rand() < p.lilies && p.level - h >= 1) this.setAir(x, p.level + 1, z, this.id('lily_pad'));
        }
      }
    }
  }

  // ---------- feature placement ----------

  claim(x, z, r = 0) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx >= 0 && zz >= 0 && xx < this.sx && zz < this.sz) this.taken[zz * this.sx + xx] = 1;
      }
    }
  }

  free(x, z, r = 0) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 1 || zz < 1 || xx >= this.sx - 1 || zz >= this.sz - 1) return false;
        if (this.taken[zz * this.sx + xx]) return false;
      }
    }
    return true;
  }

  distSpawn(x, z) {
    return Math.hypot(x - this.cx, z - this.cz);
  }

  /** Ground is dry land made of one of `ids` (a Set or array of ids), with air above. */
  dryLand(x, z, ids = null) {
    const h = this.h(x, z);
    if (h <= this.sea) return false;
    const t = this.get(x, h, z);
    if (ids && !(ids.has ? ids.has(t) : ids.includes(t))) return false;
    return this.get(x, h + 1, z) === 0;
  }

  /**
   * Scatter features: `tries` random columns; accept(x, z) -> bool decides, place(x, z)
   * builds (return false to not count). Spacing r claims columns around each placed one.
   */
  scatter(tries, { spacing = 3, avoidSpawn = this.spawnR, accept, place }) {
    let n = 0;
    for (let i = 0; i < tries; i++) {
      const x = 2 + Math.floor(this.rand() * (this.sx - 4)), z = 2 + Math.floor(this.rand() * (this.sz - 4));
      if (avoidSpawn && this.distSpawn(x, z) < avoidSpawn) continue;
      if (!this.free(x, z, spacing)) continue;
      if (!accept(x, z)) continue;
      if (place(x, z) === false) continue;
      this.claim(x, z, Math.max(1, spacing - 1));
      n++;
    }
    return n;
  }

  /** Ground-cover pass: fn(x, z, h, topId) for every dry column with air above. */
  eachSurface(fn) {
    const { sx, sz } = this;
    for (let z = 1; z < sz - 1; z++) {
      for (let x = 1; x < sx - 1; x++) {
        const h = this.H[z * sx + x];
        if (h + 1 >= this.sy) continue;
        const i = ((h + 1) * sz + z) * sx + x;
        if (this.blocks[i] !== 0) continue;
        fn(x, z, h, this.blocks[i - sx * sz]);
      }
    }
  }

  // ---------- gems ----------

  gem(x, y, z, tag) {
    this.gems.push({ x: Math.round(x), y: Math.round(y), z: Math.round(z), tag });
  }

  /** Add hilltop candidates: local maxima of the ground well above the sea. */
  hilltopGems(minAbove = 6) {
    const step = 6;
    for (let z = 8; z < this.sz - 8; z += step) {
      for (let x = 8; x < this.sx - 8; x += step) {
        let bx = x, bz = z, bh = -1;
        for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) {
          const hh = this.h(x + dx, z + dz);
          if (hh > bh) { bh = hh; bx = x + dx; bz = z + dz; }
        }
        if (bh < this.sea + minAbove) continue;
        let peak = true;
        for (let dz = -4; dz <= 4 && peak; dz++) for (let dx = -4; dx <= 4; dx++) if (this.h(bx + dx, bz + dz) > bh) { peak = false; break; }
        if (peak) this.gem(bx, bh + 1, bz, 'hill');
      }
    }
  }

  /**
   * Choose 20-30 gem spots: air cells, spread out (>= 9 apart), not in the start area,
   * mixing the kinds of places (round-robin over tags).
   */
  pickGems(target = this.big ? 28 : 24) {
    const rand = this.rand;
    const valid = this.gems.filter((c) => this.inside(c.x, c.y, c.z) && this.get(c.x, c.y, c.z) === 0 && this.distSpawn(c.x, c.z) >= 7);
    for (let i = valid.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [valid[i], valid[j]] = [valid[j], valid[i]]; }
    // special places first (they have one or two spots each), then the rest round-robin
    const special = ['waterfall', 'island', 'lagoon', 'castle', 'ring', 'cloud', 'ice', 'snowman', 'patch'];
    valid.sort((a, b) => (special.includes(b.tag) ? 1 : 0) - (special.includes(a.tag) ? 1 : 0));
    const byTag = new Map();
    for (const c of valid) {
      if (!byTag.has(c.tag)) byTag.set(c.tag, []);
      byTag.get(c.tag).push(c);
    }
    const picked = [];
    const ok = (c, minD) => picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) + Math.abs(p.y - c.y) * 0.5 >= minD);
    for (const minD of [12, 9, 6, 4]) {
      const queues = [...byTag.values()].map((list) => list.filter((c) => !picked.includes(c)));
      let progress = true;
      while (picked.length < target && progress) {
        progress = false;
        for (const q of queues) {
          while (q.length) {
            const c = q.shift();
            if (ok(c, minD)) { picked.push(c); progress = true; break; }
          }
          if (picked.length >= target) break;
        }
      }
      if (picked.length >= target) break;
    }
    // not enough interesting places: sprinkle a few on open ground
    for (let tries = 0; picked.length < 20 && tries < 4000; tries++) {
      const x = 4 + Math.floor(rand() * (this.sx - 8)), z = 4 + Math.floor(rand() * (this.sz - 8));
      const h = this.h(x, z);
      const c = { x, y: h + 1, z, tag: 'ground' };
      if (h < this.sea || this.get(x, h + 1, z) !== 0 || this.distSpawn(x, z) < 7 || !ok(c, 5)) continue;
      picked.push(c);
    }
    this.pickedGems = picked;
    return picked;
  }

  // ---------- finishing ----------

  /** Spawn: the middle of the start area, on the ground. */
  spawnPoint() {
    const { cx, cz } = this;
    for (let r = 0; r < 12; r++) {
      for (let a = 0; a < Math.max(1, r * 6); a++) {
        const ang = (a / Math.max(1, r * 6)) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(ang) * r), z = Math.round(cz + Math.sin(ang) * r);
        const h = this.h(x, z);
        const t = this.get(x, h, z);
        if (h <= this.sea || !t) continue;
        if (this.get(x, h + 1, z) !== 0 || this.get(x, h + 2, z) !== 0) continue;
        return [x + 0.5, h + 1, z + 0.5];
      }
    }
    return [cx + 0.5, this.h(cx, cz) + 1, cz + 0.5];
  }

  finish({ gems = true } = {}) {
    const w = this.world;
    w.waterLevel = this.sea;
    const spots = gems ? this.pickGems() : [];
    w.gemSpots = spots.map((c) => [c.x, c.y, c.z]);
    w.gemTotal = w.gemSpots.length;
    w._spawn = this.spawnPoint();
    return w;
  }
}

// ---------- growers ----------

/** Leaf/solid blob: ellipsoid of `id` into air cells, ragged edge. */
export function blob(g, cx, cy, cz, rx, ry, rz, id, { ragged = 0.3, onlyAir = true, bottomFlat = false } = {}) {
  const X = Math.ceil(rx), Y = Math.ceil(ry), Z = Math.ceil(rz);
  for (let dy = -Y; dy <= Y; dy++) {
    if (bottomFlat && dy < 0) continue;
    for (let dz = -Z; dz <= Z; dz++) {
      for (let dx = -X; dx <= X; dx++) {
        const d = (dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2;
        if (d > 1) continue;
        if (d > 0.62 && g.rand() < ragged) continue;
        if (onlyAir) g.setAir(cx + dx, cy + dy, cz + dz, id);
        else g.set(cx + dx, cy + dy, cz + dz, id);
      }
    }
  }
}

/** Canopy disc layers: radii from bottom to top at y0.. */
function layers(g, x, y0, z, radii, id, ragged = 0.35) {
  radii.forEach((r, i) => {
    const R = Math.ceil(r);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (d2 > (r - 0.9) * (r - 0.9) && g.rand() < ragged) continue;
        g.setAir(x + dx, y0 + i, z + dz, id);
      }
    }
  });
}

function trunk(g, x, y, z, h, id) {
  for (let i = 0; i < h; i++) g.set(x, y + i, z, id);
}

/** Gem candidate on the ground next to a trunk (under the canopy). */
function underTree(g, x, y, z) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dz] = dirs[Math.floor(g.rand() * 4)];
  g.gem(x + dx, y, z + dz, 'tree');
}

export const TREES = {
  oak(g, x, y, z) {
    const h = 4 + Math.floor(g.rand() * 2);
    const log = g.id('log_oak'), leaf = g.id('leaves_oak');
    trunk(g, x, y, z, h, log);
    layers(g, x, y + h - 2, z, [2.4, 2.8, 2.4, 1.5], leaf);
    for (let k = 0; k < 2; k++) {
      const a = g.rand() * Math.PI * 2;
      blob(g, x + Math.round(Math.cos(a) * 2), y + h - 1 + Math.floor(g.rand() * 2), z + Math.round(Math.sin(a) * 2), 1.7, 1.3, 1.7, leaf);
    }
    underTree(g, x, y, z);
  },
  birch(g, x, y, z, { leaves = 'leaves_birch' } = {}) {
    const h = 6 + Math.floor(g.rand() * 2);
    trunk(g, x, y, z, h, g.id('log_birch'));
    layers(g, x, y + h - 3, z, [1.7, 2.2, 2.2, 1.7, 1.0], g.id(leaves));
    underTree(g, x, y, z);
  },
  cherry(g, x, y, z) {
    const h = 4 + Math.floor(g.rand() * 2);
    const log = g.id('log_cherry'), leaf = g.id('leaves_cherry');
    trunk(g, x, y, z, h, log);
    // a little branch
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const [bx, bz] = dirs[Math.floor(g.rand() * 4)];
    g.set(x + bx, y + h - 2, z + bz, log);
    g.set(x + bx * 2, y + h - 1, z + bz * 2, log);
    layers(g, x, y + h - 1, z, [3.2, 3.6, 3.0, 1.8], leaf, 0.3);
    blob(g, x + bx * 2, y + h, z + bz * 2, 2.2, 1.4, 2.2, leaf);
    // blossom curtain: a few leaves hanging from the canopy rim
    for (let k = 0; k < 7; k++) {
      const a = g.rand() * Math.PI * 2;
      const hx = x + Math.round(Math.cos(a) * 3), hz = z + Math.round(Math.sin(a) * 3);
      if (g.get(hx, y + h - 1, hz) === leaf) g.setAir(hx, y + h - 2, hz, leaf);
    }
    underTree(g, x, y, z);
  },
  palm(g, x, y, z) {
    const h = 6 + Math.floor(g.rand() * 3);
    const log = g.id('palm_log'), leaf = g.id('palm_leaves'), nut = g.id('wool_brown');
    const a = g.rand() * Math.PI * 2, lx = Math.cos(a), lz = Math.sin(a);
    let tx = x, tz = z;
    for (let i = 0; i < h; i++) {
      const t = i / h;
      tx = x + Math.round(lx * t * t * 2.6);
      tz = z + Math.round(lz * t * t * 2.6);
      g.set(tx, y + i, tz, log);
    }
    const ty = y + h;
    g.setAir(tx, ty, tz, leaf);
    g.setAir(tx, ty + 1, tz, leaf);
    const fr = [[1, 0, 4], [-1, 0, 4], [0, 1, 4], [0, -1, 4], [1, 1, 3], [-1, 1, 3], [1, -1, 3], [-1, -1, 3]];
    for (const [dx, dz, L] of fr) {
      for (let k = 1; k <= L; k++) {
        const dy = k <= 2 ? 0 : k === 3 ? -1 : -2;
        g.setAir(tx + dx * k, ty + dy + (k === 1 ? 1 : 0), tz + dz * k, leaf);
        if (k === 2) g.setAir(tx + dx * k, ty + 1, tz + dz * k, leaf);
      }
    }
    // coconuts
    g.setAir(tx + 1, ty - 1, tz, nut);
    if (g.rand() < 0.6) g.setAir(tx, ty - 1, tz - 1, nut);
    g.gem(x - Math.round(lx), y, z - Math.round(lz), 'tree');
  },
  pine(g, x, y, z, { snowy = true } = {}) {
    const h = 7 + Math.floor(g.rand() * 3);
    const log = g.id('log_pine'), leaf = g.id('pine_leaves'), snow = g.id('snow_leaves');
    trunk(g, x, y, z, h, log);
    const y0 = y + 2, top = y + h + 1;
    const placed = [];
    for (let yy = y0; yy <= top; yy++) {
      const t = (yy - y0) / (top - y0);
      let r = 3.3 * (1 - t) + 0.5;
      if ((top - yy) % 2 === 1) r *= 0.72;
      const R = Math.ceil(r);
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > r * r || (d2 > (r - 0.8) ** 2 && g.rand() < 0.25)) continue;
          if (g.setAir(x + dx, yy, z + dz, leaf)) placed.push(x + dx, yy, z + dz);
        }
      }
    }
    g.setAir(x, top + 1, z, leaf);
    placed.push(x, top + 1, z);
    if (snowy) {
      for (let k = 0; k < placed.length; k += 3) {
        const px = placed[k], py = placed[k + 1], pz = placed[k + 2];
        if (g.get(px, py + 1, pz) === 0) g.set(px, py, pz, snow);
      }
    }
    underTree(g, x, y, z);
  },
  fairy(g, x, y, z) {
    const h = 5 + Math.floor(g.rand() * 2);
    const log = g.id('log_fairy'), leaf = g.id('leaves_fairy');
    trunk(g, x, y, z, h, log);
    const y0 = y + h - 2;
    const radii = [3.1, 3.7, 3.4, 2.4, 1.2];
    layers(g, x, y0, z, radii, leaf, 0.3);
    // willow strands hanging from the rim, now and then a glowing lantern at the end
    const lantern = g.id('lantern');
    let lanterns = g.rand() < 0.55 ? 1 : 0;
    for (let a = 0; a < 16; a++) {
      if (g.rand() < 0.35) continue;
      const ang = (a / 16) * Math.PI * 2;
      const sx = x + Math.round(Math.cos(ang) * 3.2), sz = z + Math.round(Math.sin(ang) * 3.2);
      if (g.get(sx, y0, sz) !== leaf) continue;
      const len = 1 + Math.floor(g.rand() * 3);
      let yy = y0 - 1;
      for (let k = 0; k < len && yy > y; k++, yy--) g.setAir(sx, yy, sz, leaf);
      if (lanterns && len >= 2 && yy > y + 1) { g.setAir(sx, yy, sz, lantern); lanterns--; }
    }
    underTree(g, x, y, z);
  },
  mushroom(g, x, y, z, { glow = true } = {}) {
    const h = 4 + Math.floor(g.rand() * 3);
    const stem = g.id('mushroom_stem'), cap = g.id(glow ? 'mushroom_cap_glow' : 'mushroom_cap_red');
    trunk(g, x, y, z, h, stem);
    const R = 2.4 + g.rand() * 1.1;
    const ty = y + h;
    const disc = (yy, r, ring = 0) => {
      const RR = Math.ceil(r);
      for (let dz = -RR; dz <= RR; dz++) for (let dx = -RR; dx <= RR; dx++) {
        const d = Math.hypot(dx, dz);
        if (d <= r && d >= ring) g.setAir(x + dx, yy, z + dz, cap);
      }
    };
    disc(ty - 1, R + 0.4, R - 0.7);
    disc(ty, R + 0.4);
    disc(ty + 1, R - 0.6);
    disc(ty + 2, R - 1.8);
    g.gem(x, ty + (R - 1.8 >= 0.5 ? 3 : 2), z, 'top');
    underTree(g, x, y, z);
  },
  crystals(g, x, y, z) {
    const keys = ['crystal_pink', 'crystal_blue', 'crystal_purple'];
    const main = g.id(keys[Math.floor(g.rand() * 3)]);
    const n = 3 + Math.floor(g.rand() * 4);
    let tallest = 0;
    for (let k = 0; k < n; k++) {
      const id = k === 0 ? main : g.rand() < 0.6 ? main : g.id(keys[Math.floor(g.rand() * 3)]);
      const ox = k === 0 ? 0 : Math.round((g.rand() - 0.5) * 4), oz = k === 0 ? 0 : Math.round((g.rand() - 0.5) * 4);
      const gx = x + ox, gz = z + oz, gy = g.h(gx, gz) + 1;
      const len = k === 0 ? 4 + Math.floor(g.rand() * 2) : 1 + Math.floor(g.rand() * 3);
      const lean = k === 0 ? [0, 0] : [Math.sign(ox), Math.sign(oz)];
      for (let i = 0; i < len; i++) {
        const shift = i >= 2 ? 1 : 0;
        g.set(gx + lean[0] * shift, gy + i, gz + lean[1] * shift, id);
      }
      if (k === 0) tallest = gy + len;
    }
    g.gem(x, tallest, z, 'top');
  },
  lollipop(g, x, y, z) {
    const h = 4 + Math.floor(g.rand() * 2);
    trunk(g, x, y, z, h, g.id('candy_stick'));
    const pairs = [['frosting_pink', 'frosting_white'], ['gumdrop_purple', 'frosting_pink'], ['frosting_mint', 'frosting_white'], ['gumdrop_yellow', 'gumdrop_orange'], ['gumdrop_blue', 'frosting_white']];
    const [a, b] = pairs[Math.floor(g.rand() * pairs.length)].map((k) => g.id(k));
    // face the start area, so lollipops are seen round from the spawn
    const alongX = Math.abs(z - g.cz) >= Math.abs(x - g.cx);
    const cy = y + h + 2, R = 2.7;
    for (let dv = -3; dv <= 3; dv++) {
      for (let du = -3; du <= 3; du++) {
        const d = Math.hypot(du, dv);
        if (d > R) continue;
        const ang = Math.atan2(dv, du) / (Math.PI * 2) + 0.5;
        const id = Math.floor(ang * 2 + d * 0.75) % 2 ? a : b;
        if (alongX) g.set(x + du, cy + dv, z, id); else g.set(x, cy + dv, z + du, id);
      }
    }
    g.gem(x, cy + 4, z, 'top');
  },
  candyCane(g, x, y, z) {
    const h = 6 + Math.floor(g.rand() * 4);
    const cane = g.id('candy_cane');
    trunk(g, x, y, z, h, cane);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const [dx, dz] = dirs[Math.floor(g.rand() * 4)];
    const T = y + h - 1;
    const hook = [[0, 1], [1, 2], [2, 2], [3, 1], [3, 0], [3, -1]];
    for (const [k, dy] of hook) g.set(x + dx * k, T + dy, z + dz * k, cane);
    g.gem(x + dx * 1, T + 3, z + dz * 1, 'top');
  },
  cottonCandy(g, x, y, z) {
    const h = 3 + Math.floor(g.rand() * 2);
    trunk(g, x, y, z, h, g.id('candy_stick'));
    blob(g, x, y + h + 1, z, 2.3, 1.9, 2.3, g.id('cotton_candy'), { ragged: 0.2 });
  },
  iceCream(g, x, y, z) {
    const cone = g.id('waffle_cone');
    g.set(x, y, z, cone);
    g.set(x, y + 1, z, cone);
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) g.set(x + dx, y + 2, z + dz, cone);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) g.set(x + dx, y + 3, z + dz, cone);
    const scoops = ['frosting_pink', 'frosting_white', 'frosting_mint', 'frosting_chocolate'];
    const s = g.id(scoops[Math.floor(g.rand() * scoops.length)]);
    blob(g, x, y + 5, z, 2.2, 1.9, 2.2, s, { ragged: 0.12 });
    g.set(x, y + 7, z, g.id('gumdrop_pink'));
    g.gem(x, y + 8, z, 'top');
  },
  gumdropBush(g, x, y, z) {
    const cols = ['gumdrop_pink', 'gumdrop_orange', 'gumdrop_yellow', 'gumdrop_green', 'gumdrop_blue', 'gumdrop_purple'];
    const id = g.id(cols[Math.floor(g.rand() * cols.length)]);
    const big = g.rand() < 0.5;
    if (big) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) g.setAir(x + dx, y, z + dz, id);
      g.setAir(x, y + 1, z, id);
    } else {
      g.setAir(x, y, z, id);
      if (g.rand() < 0.5) g.setAir(x + 1, y, z, id);
    }
  },
  snowman(g, x, y, z) {
    const snow = g.id('snow');
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const gy = g.h(x + dx, z + dz) + 1;
      if (gy === y) g.set(x + dx, y, z + dz, snow);
    }
    g.set(x, y + 1, z, snow);
    g.set(x, y + 2, z, g.id('snowman_head'));
    const hats = ['wool_pink', 'wool_red', 'wool_sky', 'wool_purple'];
    g.set(x, y + 3, z, g.id(hats[Math.floor(g.rand() * hats.length)]));
    g.gem(x + 1, y + 1, z + 1, 'snowman');
  },
};

/** Little mound of blocks (boulders, bushes). */
export function mound(g, x, y, z, ids, size = 1) {
  const pick = () => ids[Math.floor(g.rand() * ids.length)];
  g.set(x, y, z, pick());
  const around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
  for (let k = 0; k < size + 1; k++) {
    const [dx, dz] = around[Math.floor(g.rand() * around.length)];
    const gy = g.h(x + dx, z + dz) + 1;
    if (Math.abs(gy - y) <= 1) g.setAir(x + dx, gy, z + dz, pick());
  }
  if (size > 1) g.setAir(x, y + 1, z, pick());
}

/** A puffy cloud of `id` hanging in the sky. */
export function puffCloud(g, x, y, z, id) {
  const n = 3 + Math.floor(g.rand() * 3);
  for (let k = 0; k < n; k++) {
    const ox = Math.round((g.rand() - 0.5) * 8), oz = Math.round((g.rand() - 0.5) * 5);
    blob(g, x + ox, y + (k === 0 ? 1 : 0), z + oz, 2.2 + g.rand() * 1.4, 1.3 + g.rand() * 0.6, 1.8 + g.rand(), id, { ragged: 0.25 });
  }
  g.gem(x, y + 3, z, 'cloud');
}

/**
 * A little cliff with a waterfall pouring into the pond below. The cliff rises beside the
 * pond (away from `from`), the water runs down its face, and a hidden nook behind the
 * falling water holds a gem.
 */
export function waterfallCliff(g, pond, { fromX, fromZ, rock = 'stone', grass = 'grass', dirt = 'dirt', height = 7 } = {}) {
  // direction from the viewer to the pond: the cliff stands on the far side
  let ax = pond.x - fromX, az = pond.z - fromZ;
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  // snap to an axis so the fall is a clean column
  const useX = Math.abs(ax) > Math.abs(az);
  const dx = useX ? Math.sign(ax) : 0, dz = useX ? 0 : Math.sign(az);
  const edge = Math.floor(pond.r) - 1; // the fall lands just inside the pond
  const fx = Math.round(pond.x + dx * edge), fz = Math.round(pond.z + dz * edge);
  const top = pond.level + height;
  const rockId = g.id(rock), grassId = g.id(grass), dirtId = g.id(dirt), water = g.id('water');
  // plateau behind the fall: a rounded block of rock with a grass cap
  const px = fx + dx * 4, pz = fz + dz * 4;
  for (let oz = -6; oz <= 6; oz++) {
    for (let ox = -6; ox <= 6; ox++) {
      const x = px + ox, z = pz + oz;
      if (x < 2 || z < 2 || x >= g.sx - 2 || z >= g.sz - 2) continue;
      const along = ox * dx + oz * dz; // distance toward the pond (negative = behind)
      const side = Math.abs(ox * dz + oz * dx);
      const d = Math.hypot(ox, oz) + g.noise.n2(x / 3, z / 3) * 0.9;
      if (d > 6.2 || along < -3) continue;
      const hTop = top - (d > 4.8 ? 1 : 0) - (side > 4 ? 1 : 0);
      const h0 = g.h(x, z);
      if (h0 >= hTop) continue;
      for (let y = Math.max(1, h0 - 1); y <= hTop; y++) g.set(x, y, z, y === hTop ? grassId : y >= hTop - 1 ? dirtId : rockId);
      g.H[z * g.sx + x] = hTop;
      g.claim(x, z);
    }
  }
  // the channel on top and the falling water column (2 wide)
  const wx = dz !== 0 ? 1 : 0, wz = dx !== 0 ? 1 : 0;
  for (let w = 0; w < 2; w++) {
    const cx0 = fx + wx * w, cz0 = fz + wz * w;
    // stream across the plateau
    for (let k = 1; k <= 5; k++) {
      const x = cx0 + dx * k, z = cz0 + dz * k;
      g.set(x, top, z, water);
      g.set(x, top - 1, z, rockId);
    }
    // the falling column in front of the cliff face
    for (let y = pond.level + 1; y <= top; y++) g.set(cx0, y, cz0, water);
    // hidden nook behind the fall
    const nx = cx0 + dx, nz = cz0 + dz;
    g.set(nx, pond.level + 1, nz, 0);
    g.set(nx, pond.level + 2, nz, 0);
    if (w === 0) g.gem(nx, pond.level + 1, nz, 'waterfall');
  }
  // keep a solid floor under the nook
  for (let w = 0; w < 2; w++) g.set(fx + wx * w + dx, pond.level, fz + wz * w + dz, rockId);
  g.gem(px, top + 1, pz, 'hill');
}
