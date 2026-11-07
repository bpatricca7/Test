// Holiday Village (wave 5, docs/teams/holiday-world.md): a snowy valley ringed by white
// mountains, always in a pink-and-indigo winter-evening light. In the middle the village square
// with a giant glowing holiday tree (lights spiralling round it, baubles, a big star on top,
// presents at its foot), lamp posts, benches, a cocoa stand and the dress-up booth. Light
// arches lead off the square: north through a light tunnel to Santa's workshop, south down
// Candy Cane Lane past gingerbread and candy cottages, east to the reindeer stable and pasture
// (the sleigh waits on a little launch hill), west to the frozen skating pond and the sledding
// hill. Pine forest with lights and baubles in some trees fills the rest.
//
// Everything that is not a block (furniture, the gift workshop, presents, elves, the dress-up
// booth, reindeer, the sleigh, named spots) is asked for through world.features (wave5-plan.md
// §4): every record is checked here before it is handed out (its cells air, solid floor under
// it, no two records sharing a cell), so the placers never meet a wall.
//
// Layout is in blocks from the tree (the world's middle); "north" is -Z, where a new player
// looks, so a new player starts on the south side of the square looking up at the tree.

import { Gen, TREES } from './gen.js';
import { smoothstep, lerp, clamp } from '../../core/util.js';

export const GROUND = 22; // the village floor: top solid block of the square, lanes and lots
const EDGE_H = 8; // the mountains meet the world edge this high above the village floor
const TREE_BASE = 4; // the giant tree's lowest branches start this far above the floor
const TREE_TOP = 31; // ...and its highest needles end here; the star sits above
const PLAZA_R = 13;

// [w, h, d] of every furniture key the village places (src/things/furniture/catalog.js,
// src/things/shops/index.js): the same footprint rule as game.entities (anchor = front row
// middle, the rest extends away from the front), so the cells checked here are the cells used.
export const FURN_SIZE = {
  bed_single: [1, 1, 2], nightstand: [1, 1, 1], fireplace: [2, 2, 1], sofa: [2, 1, 1], armchair: [1, 1, 1],
  table_round: [1, 1, 1], chair: [1, 1, 1], stool: [1, 1, 1], floor_lamp: [1, 2, 1], lamp_ceiling: [1, 1, 1],
  fairy_lights: [1, 1, 1], lantern_post: [1, 2, 1], bench: [2, 1, 1], door: [1, 2, 1], door_pink: [1, 2, 1],
  fence: [1, 1, 1], gate: [1, 1, 1], table_long: [2, 1, 1], teddy_bear: [1, 1, 1], dollhouse: [2, 2, 1],
  toy_chest: [1, 1, 1], balloon_bunch: [1, 2, 1], easel: [1, 2, 1], rug_round: [2, 1, 2], candy_shop: [3, 3, 2],
  piano: [2, 2, 1], bookshelf_tall: [2, 2, 1], wardrobe: [2, 2, 1], plant_pot: [1, 1, 1],
};
/** Furniture that hangs from a ceiling (a solid block right above it). */
export const CEILING = new Set(['lamp_ceiling', 'fairy_lights']);
/** Rugs: other furniture may share their cells. */
export const FLAT = new Set(['rug_round']);
/**
 * The box [w, h, d] kept clear for each record of the other teams' kinds, by the same rule
 * (anchor = front row middle, the box extends behind it, rot turns it). Owners may use less.
 */
export const CLEAR = {
  'holiday:workshop': [3, 3, 3],
  'holiday:dressup': [3, 3, 3],
  'holiday:elfhome': [1, 2, 1],
  'holiday:elf': [1, 1, 1],
  'holiday:reindeer': [1, 2, 1],
  'holiday:sleigh': [3, 3, 7],
  'holiday:spot': [1, 2, 1],
};

/** Same quarter-turn as src/things/entities.js rotXZ (rot 0..3 turns the front +Z, +X, -Z, -X). */
export function rotXZ(x, z, rot) {
  switch (rot & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}

/** Cells of a [w, h, d] box anchored like furniture at (x, y, z) facing rot. */
export function boxCells([w, h, d], x, y, z, rot) {
  const cells = [];
  const ai = Math.floor((w - 1) / 2);
  for (let i = 0; i < w; i++) {
    for (let k = 0; k < d; k++) {
      const [ox, oz] = rotXZ(i - ai, k - (d - 1), rot);
      for (let j = 0; j < h; j++) cells.push([x + ox, y + j, z + oz]);
    }
  }
  return cells;
}

/** Every cell a feature record needs empty (furniture by its size, presents by their spots). */
export function recordCells(r) {
  if (r.kind === 'furn') {
    const size = FURN_SIZE[r.key];
    return size ? boxCells(size, r.x, r.y, r.z, r.rot | 0) : [[r.x, r.y, r.z]];
  }
  if (r.kind === 'holiday:presents') return (r.spots || [[r.x, r.y, r.z]]).map((s) => [s[0], s[1], s[2]]);
  if (r.kind === 'holiday:reindeer') return [[r.x, r.y, r.z], [r.x, r.y + 1, r.z]];
  return boxCells(CLEAR[r.kind] || [1, 1, 1], r.x, r.y, r.z, r.rot | 0);
}

// ---------- cottage looks ----------

const COTTAGES = [
  { wall: 'holiday_gingerbread', corner: 'candy_cane', roof: 'holiday_roof', lights: 'holiday_lights', floor: 'planks_oak', door: '#FF9CCB', sofa: '#FF8C94', bed: '#FF9CCB' },
  { wall: 'frosting_pink', corner: 'quartz_pillar', roof: 'holiday_roof_green', lights: 'holiday_lights_gold', floor: 'planks_cherry', door: '#FFFFFF', sofa: '#9BE8CF', bed: '#C8B4FF' },
  { wall: 'holiday_gingerbread', corner: 'quartz_pillar', roof: 'holiday_roof_green', lights: 'holiday_lights_icy', floor: 'planks_birch', door: '#A6D8FF', sofa: '#A6D8FF', bed: '#A6D8FF' },
  { wall: 'frosting_white', corner: 'candy_cane', roof: 'holiday_roof', lights: 'holiday_lights', floor: 'planks_oak', door: '#C8B4FF', sofa: '#C8B4FF', bed: '#FFE38F' },
  { wall: 'frosting_mint', corner: 'candy_cane', roof: 'holiday_roof', lights: 'holiday_lights_gold', floor: 'planks_pink', door: '#FF9CCB', sofa: '#FF9CCB', bed: '#9BE8CF' },
  { wall: 'holiday_gingerbread', corner: 'candy_cane', roof: 'holiday_roof_green', lights: 'holiday_lights', floor: 'planks_oak', door: '#9BE8CF', sofa: '#FFE38F', bed: '#FFBFA0' },
];
// the Twinkle Elves' own cottage: mint and peppermint, icy lights
const ELF_COTTAGE = { wall: 'frosting_mint', corner: 'peppermint', roof: 'holiday_roof', lights: 'holiday_lights_icy', floor: 'planks_mint', door: '#FF9CCB', sofa: '#FF9CCB', bed: '#FF9CCB', elves: true };

const LIGHTS = ['holiday_lights', 'holiday_lights_gold', 'holiday_lights_icy'];
const BAUBLES = ['holiday_bauble_red', 'holiday_bauble_gold', 'holiday_bauble_blue'];

// ---------- the village builder ----------

class Village {
  constructor(g) {
    this.g = g;
    this.G = GROUND;
    this.pending = []; // feature records, checked in finalize()
    this.dropped = [];
  }

  id(key) { return this.g.id(key); }

  set(x, y, z, key) { this.g.set(x, y, z, typeof key === 'number' ? key : this.id(key)); }

  fill(x0, y0, z0, x1, y1, z1, key) {
    const id = typeof key === 'number' ? key : this.id(key);
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
    const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.g.set(x, y, z, id);
  }

  /** A building site: local coords (lx across, lz 0 = front row, negative = deeper) turned by f. */
  site(ax, az, f, y0 = this.G) { return new Site(this, ax, az, f & 3, y0); }

  furn(key, x, y, z, rot = 0, color = null, data = null) {
    const r = { kind: 'furn', key, x, y, z, rot: rot & 3 };
    if (color) r.color = color;
    if (data) r.data = data;
    this.pending.push(r);
    return r;
  }

  feat(kind, x, y, z, rot = 0, extra = null) {
    const r = { kind, x, y, z, rot: rot & 3, ...(extra || {}) };
    this.pending.push(r);
    return r;
  }

  elf(x, y, z, where) { return this.feat('holiday:elf', x, y, z, 0, { where }); }

  spot(name, x, y, z, rot = 0) { return this.feat('holiday:spot', x, y, z, rot, { name }); }

  /** Ground surface height at a column (the top solid block). */
  h(x, z) { return this.g.h(x, z); }

  /** Set the ground column at (x, z) to top `key` at height y (fills under, clears above). */
  ground(x, z, y, key, clearTo = y + 12) {
    if (!this.g.inside(x, 0, z)) return;
    const snow = this.id('snow'), dirt = this.id('dirt'), stone = this.id('stone');
    for (let yy = 1; yy < y; yy++) {
      const cur = this.g.get(x, yy, z);
      if (cur === 0 || yy >= y - 2) this.g.set(x, yy, z, yy >= y - 2 ? snow : yy >= y - 5 ? dirt : stone);
    }
    this.g.set(x, y, z, typeof key === 'number' ? key : this.id(key));
    for (let yy = y + 1; yy <= Math.min(this.g.sy - 1, clearTo); yy++) this.g.set(x, yy, z, 0);
    this.g.H[z * this.g.sx + x] = y;
  }

  /**
   * Check every pending record: inside the world, its cells empty (a flower sprite there is
   * cleared), a solid floor under its bottom cells (a solid block over a ceiling lamp), no
   * two records sharing a cell (rugs aside). Fences learn which neighbours they join.
   */
  finalize() {
    const g = this.g, world = g.world, reg = world.registry;
    const solidCube = (id) => { const d = reg.byId(id); return !!(d && d.solid && d.shape === 'cube'); };
    const solid = (id) => { const d = reg.byId(id); return !!(d && d.solid && d.shape !== 'carpet'); };
    const sprite = (id) => { const d = reg.byId(id); return !!(d && d.shape === 'cross'); };
    const used = new Map();
    const key = (x, y, z) => (y * g.sz + z) * g.sx + x;
    const out = [];
    for (const r of this.pending) {
      const cells = recordCells(r);
      const flat = r.kind === 'furn' && FLAT.has(r.key);
      const ceiling = r.kind === 'furn' && CEILING.has(r.key);
      let why = cells.length ? '' : 'no cells';
      for (const [x, y, z] of cells) {
        if (!g.inside(x, y, z) || y < 1) { why = 'outside'; break; }
        const id = g.get(x, y, z);
        if (id !== 0 && !sprite(id)) { why = `cell ${x},${y},${z} holds ${reg.byId(id)?.key}`; break; }
        const other = used.get(key(x, y, z));
        if (other && !(flat || other.flat)) { why = `cell ${x},${y},${z} shared with ${other.r.kind} ${other.r.key || ''}`; break; }
      }
      if (!why) {
        const ys = cells.map((c) => c[1]);
        const bottom = Math.min(...ys), top = Math.max(...ys);
        for (const [x, y, z] of cells) {
          if (ceiling ? y === top && !solid(g.get(x, y + 1, z)) : y === bottom && !solid(g.get(x, y - 1, z))) { why = `no ${ceiling ? 'ceiling' : 'floor'} at ${x},${y},${z}`; break; }
        }
      }
      if (why) { this.dropped.push({ record: r, why }); continue; }
      for (const [x, y, z] of cells) {
        if (g.get(x, y, z) !== 0) g.set(x, y, z, 0);
        used.set(key(x, y, z), { flat, r });
      }
      out.push(r);
    }
    // fences: which sides join a fence, a gate or a solid block (bits 1 +X, 2 -X, 4 +Z, 8 -Z)
    const fenceAt = new Set(out.filter((r) => r.kind === 'furn' && (r.key === 'fence' || r.key === 'gate')).map((r) => key(r.x, r.y, r.z)));
    for (const r of out) {
      if (r.kind !== 'furn' || r.key !== 'fence') continue;
      let conn = 0;
      for (const [bit, dx, dz] of [[1, 1, 0], [2, -1, 0], [4, 0, 1], [8, 0, -1]]) {
        const x = r.x + dx, z = r.z + dz;
        if (fenceAt.has(key(x, r.y, z)) || (g.inside(x, r.y, z) && solidCube(g.get(x, r.y, z)))) conn |= bit;
      }
      r.data = { conn };
    }
    return out;
  }
}

class Site {
  constructor(v, ax, az, f, y0) {
    this.v = v; this.ax = ax; this.az = az; this.f = f; this.y0 = y0;
  }

  xz(lx, lz) {
    const [rx, rz] = rotXZ(lx, lz, this.f);
    return [this.ax + rx, this.az + rz];
  }

  set(lx, dy, lz, key) {
    const [x, z] = this.xz(lx, lz);
    this.v.set(x, this.y0 + dy, z, key);
  }

  get(lx, dy, lz) {
    const [x, z] = this.xz(lx, lz);
    return this.v.g.get(x, this.y0 + dy, z);
  }

  fill(lx0, dy0, lz0, lx1, dy1, lz1, key) {
    const id = typeof key === 'number' ? key : this.v.id(key);
    for (let lx = Math.min(lx0, lx1); lx <= Math.max(lx0, lx1); lx++) {
      for (let lz = Math.min(lz0, lz1); lz <= Math.max(lz0, lz1); lz++) {
        for (let dy = Math.min(dy0, dy1); dy <= Math.max(dy0, dy1); dy++) this.set(lx, dy, lz, id);
      }
    }
  }

  /** Level the ground of a local rectangle to the site floor (top = `key`), clear above. */
  lot(lx0, lz0, lx1, lz1, key = 'snow', clear = 14) {
    for (let lx = Math.min(lx0, lx1); lx <= Math.max(lx0, lx1); lx++) {
      for (let lz = Math.min(lz0, lz1); lz <= Math.max(lz0, lz1); lz++) {
        const [x, z] = this.xz(lx, lz);
        this.v.ground(x, z, this.y0, key, this.y0 + clear);
        this.v.g.claim(x, z);
      }
    }
  }

  furn(key, lx, dy, lz, lrot = 0, color = null, data = null) {
    const [x, z] = this.xz(lx, lz);
    return this.v.furn(key, x, this.y0 + dy, z, lrot + this.f, color, data);
  }

  feat(kind, lx, dy, lz, lrot = 0, extra = null) {
    const [x, z] = this.xz(lx, lz);
    return this.v.feat(kind, x, this.y0 + dy, z, lrot + this.f, extra);
  }

  elf(lx, dy, lz, where) {
    const [x, z] = this.xz(lx, lz);
    return this.v.elf(x, this.y0 + dy, z, where);
  }

  spot(name, lx, dy, lz, lrot = 0) {
    const [x, z] = this.xz(lx, lz);
    return this.v.spot(name, x, this.y0 + dy, z, lrot + this.f);
  }

  gem(lx, dy, lz, tag) {
    const [x, z] = this.xz(lx, lz);
    this.v.g.gem(x, this.y0 + dy, z, tag);
  }

  /** A shell gable roof over lx -half..half, lz front..back (ridge along lz) from dy0 up. */
  gable(half, dy0, lzFront, lzBack, roof, edge = null) {
    for (let k = 0; k <= half; k++) {
      const x = half - k;
      for (let lz = lzBack; lz <= lzFront; lz++) {
        const id = edge && (lz === lzFront || lz === lzBack) ? edge : roof;
        this.set(x, dy0 + k, lz, id);
        if (x) this.set(-x, dy0 + k, lz, id);
      }
    }
  }

  /** Fill the triangle under a gable at row lz (the front or back wall's top). */
  gableWall(half, dy0, lz, key) {
    for (let k = 0; k < half; k++) for (let lx = -(half - k - 1); lx <= half - k - 1; lx++) this.set(lx, dy0 + k, lz, key);
  }
}

// ---------- terrain ----------

function makeTerrain(g, L) {
  const G = GROUND;
  const R0 = g.big ? 30 : 24; // the mountains start this far from the world edge
  // the lots the village stands on: flattened exactly to the floor
  const flatW = new Float32Array(g.sx * g.sz);
  const flatRect = (x0, z0, x1, z1, m = 4) => {
    for (let z = Math.max(0, Math.min(z0, z1) - m); z <= Math.min(g.sz - 1, Math.max(z0, z1) + m); z++) {
      for (let x = Math.max(0, Math.min(x0, x1) - m); x <= Math.min(g.sx - 1, Math.max(x0, x1) + m); x++) {
        const dx = Math.max(Math.min(x0, x1) - x, 0, x - Math.max(x0, x1));
        const dz = Math.max(Math.min(z0, z1) - z, 0, z - Math.max(z0, z1));
        const w = 1 - smoothstep(0, m + 0.5, Math.hypot(dx, dz));
        const k = z * g.sx + x;
        if (w > flatW[k]) flatW[k] = w;
      }
    }
  };
  const flatDisc = (cx, cz, r, m = 5) => {
    for (let z = Math.max(0, Math.floor(cz - r - m)); z <= Math.min(g.sz - 1, Math.ceil(cz + r + m)); z++) {
      for (let x = Math.max(0, Math.floor(cx - r - m)); x <= Math.min(g.sx - 1, Math.ceil(cx + r + m)); x++) {
        const w = 1 - smoothstep(r, r + m, Math.hypot(x - cx, z - cz));
        const k = z * g.sx + x;
        if (w > flatW[k]) flatW[k] = w;
      }
    }
  };
  flatDisc(L.tx, L.tz, PLAZA_R + 2, 6);
  for (const r of L.flatRects) flatRect(...r);

  g.shape((x, z) => {
    const e = Math.min(x, z, g.sx - 1 - x, g.sz - 1 - z);
    // gentle snowdrift hills in the valley
    const drift = Math.max(0, g.noise.fbm2(x / 34 + 11, z / 34 - 4, 3)) * 7;
    let h = G + drift;
    // snowy mountains all round the valley, softly peaked
    const t = smoothstep(R0, R0 - 14, e);
    if (t > 0) {
      const peaks = 10 + 18 * Math.max(0, g.noise.ridge2(x / 24 + 5, z / 24 - 3, 3) - 0.2) + g.noise.fbm2(x / 9, z / 9, 2) * 3;
      h += t * peaks;
    }
    if (e < 6) h = lerp(G + EDGE_H, h, e / 6); // the world edge: the snowy plain beyond
    const w = flatW[z * g.sx + x];
    if (w > 0) h = lerp(h, G, w);
    return h;
  });

  // the sledding hill: a long slope rising away from the pond into the mountains
  const s = L.sled;
  for (let z = s.z - s.half - 6; z <= s.z + s.half + 6; z++) {
    for (let x = 1; x < g.sx - 1; x++) {
      if (z < 1 || z >= g.sz - 1) continue;
      const along = (s.x0 - x) * s.dir; // 0 at the foot, growing uphill
      if (along < -2) continue;
      const side = Math.abs(z - s.z);
      const rise = clamp(along / 1.35, 0, s.height);
      const shoulder = 1 - smoothstep(s.half - 1, s.half + 6, side);
      const hh = G + rise * shoulder;
      const k = z * g.sx + x;
      if (hh > g.hf[k]) g.hf[k] = hh;
    }
  }
  // the sleigh's launch hill: a round mound with a flat top
  const lh = L.launch;
  for (let z = lh.z - 12; z <= lh.z + 12; z++) {
    for (let x = lh.x - 14; x <= lh.x + 14; x++) {
      if (x < 1 || z < 1 || x >= g.sx - 1 || z >= g.sz - 1) continue;
      const d = Math.max(0, Math.hypot((x - lh.x) / 1.4, z - lh.z) - 3.6);
      const hh = G + Math.max(0, lh.height - d * 0.8);
      const k = z * g.sx + x;
      if (hh > g.hf[k]) g.hf[k] = hh;
    }
  }
}

// ---------- the layout ----------

function layout(g) {
  const tx = g.cx, tz = g.cz;
  const big = g.big;
  const L = { tx, tz, big, flatRects: [] };
  L.spawn = [tx, tz + PLAZA_R - 1]; // on the square, south side, looking north at the tree
  L.workshop = { x: tx, z: tz - 26, f: 0 };
  L.elfHome = { x: tx - 17, z: tz - 24, f: 1 };
  // Candy Cane Lane: cottages face the lane from both sides
  L.lane = { z0: tz + PLAZA_R + 1, z1: tz + (big ? 58 : 44) };
  L.cottages = [];
  const rows = big ? [24, 36, 48] : [24, 36];
  for (const dz of rows) {
    L.cottages.push({ x: tx - 7, z: tz + dz, f: 1 });
    L.cottages.push({ x: tx + 7, z: tz + dz, f: 3 });
  }
  L.cottages.push({ x: tx - 23, z: tz + 24, f: 1 });
  if (big) L.cottages.push({ x: tx + 23, z: tz + 46, f: 3 });
  // the reindeer: a fenced pasture east of the square, the stable at its far end
  L.pasture = { x0: tx + 19, x1: tx + 35, z0: tz - 8, z1: tz + 6 };
  L.stable = { x: L.pasture.x1, z: tz - 1, f: 3 };
  L.launch = { x: tx + 30, z: tz + 22, height: 5 };
  L.pond = { x: tx - 27, z: tz + 3, r: 7 };
  L.sled = { x0: tx - 36, dir: 1, z: tz - 12, half: 6, height: 12 };
  // flattened lots (x0, z0, x1, z1, margin)
  const W = L.workshop;
  L.flatRects.push([W.x - 11, W.z - 14, W.x + 11, W.z + 3, 5]);
  L.flatRects.push([tx - 3, tz - PLAZA_R - 12, tx + 3, tz + 4, 3]); // light tunnel
  L.flatRects.push([tx - 3, L.lane.z0, tx + 3, L.lane.z1, 3]);
  for (const c of [...L.cottages, L.elfHome]) L.flatRects.push([c.x - 9, c.z - 9, c.x + 9, c.z + 9, 3]);
  const P = L.pasture;
  L.flatRects.push([P.x0 - 2, P.z0 - 2, P.x1 + 9, P.z1 + 2, 4]);
  L.flatRects.push([tx, tz - 3, P.x0, tz + 3, 3]); // east avenue
  L.flatRects.push([L.pond.x + 2, tz - 3, tx, tz + 3, 3]); // west avenue
  L.flatRects.push([L.pond.x - 1, L.pond.z - 1, L.pond.x + 1, L.pond.z + 1, L.pond.r + 4]); // the pond's banks
  return L;
}

// ---------- pieces ----------

/** Paths: snow-packed lanes with peppermint stepping stones down the middle. */
function avenue(v, x0, z0, x1, z1, half = 2) {
  const g = v.g, G = v.G;
  const pepper = v.id('peppermint'), packed = v.id('path'), white = v.id('quartz');
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  const sx = Math.sign(x1 - x0), sz = Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const cx = x0 + (alongX ? sx * i : 0), cz = z0 + (alongX ? 0 : sz * i);
    for (let w = -half; w <= half; w++) {
      const x = cx + (alongX ? 0 : w), z = cz + (alongX ? w : 0);
      const edge = Math.abs(w) === half;
      const key = w === 0 && i % 3 === 0 ? pepper : edge ? white : packed;
      v.ground(x, z, G, key, G + 6);
      g.claim(x, z);
    }
  }
}

/** A light arch over a path: candy-cane pillars and a curve of light blocks. */
function lightArch(v, x, z, alongX, lights, span = 3) {
  const G = v.G;
  const heights = span === 3 ? [6, 6, 5, 4] : [5, 5, 4];
  const at = (w) => (alongX ? [x, z + w] : [x + w, z]);
  for (const s of [-1, 1]) {
    const [px, pz] = at(s * span);
    for (let dy = 1; dy <= heights[span]; dy++) v.set(px, G + dy, pz, dy === heights[span] ? lights : 'candy_cane');
    v.ground(px, pz, G, 'quartz', G);
  }
  for (let w = -(span - 1); w <= span - 1; w++) {
    const [ax, az] = at(w);
    v.set(ax, G + heights[Math.abs(w)], az, lights);
  }
}

/** The giant holiday tree: a tiered pine wrapped in light garlands, baubles and a big star. */
function giantTree(v, tx, tz) {
  const g = v.g, G = v.G, rand = g.rand;
  const log = v.id('log_pine'), leaf = v.id('pine_leaves'), snowy = v.id('snow_leaves');
  const y0 = G + TREE_BASE, y1 = G + TREE_TOP;
  // trunk (3x3) up through the crown
  v.fill(tx - 1, G + 1, tz - 1, tx + 1, y1 - 8, tz + 1, log);
  v.fill(tx, y1 - 7, tz, tx, y1 - 1, tz, log);
  const TIERS = 6, R0 = 9.6;
  const radius = (y) => {
    const t = (y - y0) / (y1 - y0);
    const env = R0 * (1 - t) + 0.7;
    const f = (t * TIERS) % 1; // within a tier: wide at the bottom, narrower at the top
    return env * (1 - 0.34 * f);
  };
  const cells = [];
  for (let y = y0; y <= y1; y++) {
    const r = radius(y), R = Math.ceil(r);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > r) continue;
        // a soft scalloped rim so the tiers look like branch tips, not a cone
        const ang = Math.atan2(dz, dx);
        if (d > r - 1.2 && Math.sin(ang * 9 + y * 1.7) > 0.55) continue;
        g.set(tx + dx, y, tz + dz, leaf);
        cells.push(dx, y, dz);
      }
    }
  }
  g.set(tx, y1 + 1, tz, leaf);
  // decorate the outside: garlands spiral round the crown, baubles in between, snow on the tiers
  const outside = (x, y, z) => g.get(x, y, z) === 0;
  const pitch = 7.5; // layers per turn of a garland
  for (let i = 0; i < cells.length; i += 3) {
    const dx = cells[i], y = cells[i + 1], dz = cells[i + 2];
    const x = tx + dx, z = tz + dz;
    const up = outside(x, y + 1, z);
    const side = outside(x + 1, y, z) || outside(x - 1, y, z) || outside(x, y, z + 1) || outside(x, y, z - 1);
    if (!up && !side) continue;
    const a = Math.atan2(dz, dx) / (Math.PI * 2) + 0.5;
    const s = a + (y - y0) / pitch;
    let deco = 0;
    for (let k = 0; k < 3; k++) {
      const ph = ((s + k / 3) % 1 + 1) % 1;
      if (ph < 0.075) { deco = v.id(LIGHTS[k]); break; }
    }
    if (!deco && side && rand() < 0.11) deco = v.id(BAUBLES[Math.floor(rand() * BAUBLES.length)]);
    if (!deco && up && !side && rand() < 0.75) deco = snowy;
    else if (!deco && up && rand() < 0.35) deco = snowy;
    if (deco) g.set(x, y, z, deco);
  }
  // the star: two crossed five-point stars of glowing blocks, seen from every side
  const STAR = ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', '.X...X.'];
  const star = v.id('holiday_star');
  const sy = y1 + 2;
  for (let r = 0; r < STAR.length; r++) {
    for (let c = 0; c < 7; c++) {
      if (STAR[r][c] !== 'X') continue;
      const yy = sy + (STAR.length - 1 - r);
      g.set(tx + c - 3, yy, tz, star);
      g.set(tx, yy, tz + c - 3, star);
    }
  }
  g.set(tx, y1 + 1, tz, v.id('holiday_lights_gold'));
  g.gem(tx, sy + 7, tz, 'top');
  return { top: sy + 6 };
}

/** The village square: tree skirt, plaza rings, lamps, benches, the cocoa stand and the booth. */
function square(v, L) {
  const g = v.g, G = v.G, tx = L.tx, tz = L.tz;
  const red = v.id('wool_red'), white = v.id('wool_white'), quartz = v.id('quartz'), pepper = v.id('peppermint');
  const bricks = v.id('brick_white');
  for (let dz = -PLAZA_R - 1; dz <= PLAZA_R + 1; dz++) {
    for (let dx = -PLAZA_R - 1; dx <= PLAZA_R + 1; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > PLAZA_R + 0.5) continue;
      let key = quartz;
      if (d < 6.3) key = red;
      else if (d < 7.3) key = white;
      else if (Math.abs(d - 9.6) < 0.6) key = pepper;
      else if (d > PLAZA_R - 0.6) key = bricks;
      v.ground(tx + dx, tz + dz, G, key, G + 3);
      g.claim(tx + dx, tz + dz);
    }
  }
  // presents under the tree (gifts team): eight spots round the trunk on the red skirt
  const spots = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    spots.push([Math.round(tx + Math.cos(a) * 4.3), G + 1, Math.round(tz + Math.sin(a) * 4.3)]);
  }
  spots.sort((a, b) => b[2] - a[2]); // the ones facing the start first
  v.feat('holiday:presents', spots[0][0], G + 1, spots[0][2], 0, { n: 8, spots, tree: [tx, tz] });
  // a low garland hedge of lights round the square, open where the avenues come in
  for (let dz = -PLAZA_R - 1; dz <= PLAZA_R + 1; dz++) {
    for (let dx = -PLAZA_R - 1; dx <= PLAZA_R + 1; dx++) {
      const d = Math.hypot(dx, dz);
      if (d <= PLAZA_R - 0.6 || d > PLAZA_R + 0.5 || Math.abs(dx) <= 3 || Math.abs(dz) <= 3) continue;
      const seg = Math.floor(((Math.atan2(dz, dx) / (Math.PI * 2)) + 1) * 16) % 3;
      if (g.get(tx + dx, G + 1, tz + dz) === 0) v.set(tx + dx, G + 1, tz + dz, LIGHTS[seg]);
    }
  }
  // lamp posts between the avenues, benches facing the tree
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    v.furn('lantern_post', Math.round(tx + Math.cos(a) * 12), G + 1, Math.round(tz + Math.sin(a) * 12), 0, '#FFE38F');
  }
  v.furn('bench', tx - 8, G + 1, tz - 7, 1, '#FF9CCB'); // faces east, toward the tree
  v.furn('bench', tx + 8, G + 1, tz - 7, 3, '#A6D8FF');
  v.furn('bench', tx - 6, G + 1, tz - 10, 0, '#9BE8CF');
  v.furn('bench', tx + 5, G + 1, tz - 10, 0, '#C8B4FF');
  // the cocoa stand (a sweet shop until a cocoa stand exists) and the dress-up booth
  v.furn('candy_shop', tx - 9, G + 1, tz + 6, 1, '#FF9CCB');
  v.feat('holiday:dressup', tx + 7, G + 1, tz + 7, 3);
  // the striped North Pole by the south arch, a gold bauble on top
  const px = tx + 3, pz = tz + 9;
  for (let dy = 1; dy <= 6; dy++) v.set(px, G + dy, pz, 'candy_cane');
  v.set(px, G + 7, pz, 'holiday_bauble_gold');
  v.elf(px, G + 8, pz, 'pole');
  // snowmen at the square's corners
  for (const [sx, sz] of [[tx - 11, tz + 9], [tx + 11, tz - 9]]) {
    v.ground(sx, sz, G, 'snow', G + 6);
    TREES.snowman(g, sx, G + 1, sz);
  }
  v.elf(tx + 11, G + 5, tz - 9, 'snowman');
  v.spot('tree', tx, G + 1, tz + 10, 2);
}

/** A gingerbread or candy cottage (7 x 7) with a gable roof, furnished inside. */
function cottage(v, c, style, name, index = 0) {
  const s = v.site(c.x, c.z, c.f);
  const roof = v.id(style.roof), lights = v.id(style.lights), wall = v.id(style.wall), corner = v.id(style.corner);
  s.lot(-6, 4, 6, -9, 'snow', 13);
  s.fill(-3, 0, 0, 3, 0, -6, style.floor);
  // walls
  for (let dy = 1; dy <= 4; dy++) {
    for (let lx = -3; lx <= 3; lx++) { s.set(lx, dy, 0, wall); s.set(lx, dy, -6, wall); }
    for (let lz = -5; lz <= -1; lz++) { s.set(-3, dy, lz, wall); s.set(3, dy, lz, wall); }
    for (const [lx, lz] of [[-3, 0], [3, 0], [-3, -6], [3, -6]]) s.set(lx, dy, lz, corner);
  }
  // door, wreath, windows (lit from inside), a little attic window
  s.set(0, 1, 0, 0); s.set(0, 2, 0, 0);
  s.furn('door', 0, 1, 0, 0, style.door);
  s.set(0, 3, 0, 'holiday_holly');
  for (const [lx, lz] of [[-2, 0], [2, 0], [-3, -2], [3, -2], [-3, -4], [3, -4], [0, -6]]) s.set(lx, 2, lz, 'holiday_window');
  // ceiling and gable roof (front edge in lights), icing dripping from the eaves
  s.fill(-2, 5, -1, 2, 5, -5, style.floor);
  s.gableWall(4, 5, 0, wall);
  s.gableWall(4, 5, -6, wall);
  s.set(0, 6, 0, 'holiday_window');
  s.gable(4, 5, 1, -7, roof, lights);
  for (let lz = -7; lz <= 1; lz++) { s.set(-4, 4, lz, 'holiday_icing'); s.set(4, 4, lz, 'holiday_icing'); }
  // chimney over the fireplace
  for (let dy = 6; dy <= 9; dy++) s.set(2, dy, -5, 'brick_red');
  s.set(2, 9, -5, 'cobble');
  // holly bushes under the front windows, a peppermint step
  s.set(-2, 1, 1, 'holiday_holly'); s.set(2, 1, 1, 'holiday_holly');
  s.lot(0, 1, 0, 3, 'path', 13);
  s.set(0, 0, 1, 'peppermint');
  // inside
  if (style.elves) {
    // the elves' toy corner: shelves of toys, a toy chest and a teddy by the fire
    for (let lz = -5; lz <= -2; lz++) s.set(-2, 1, lz, 'holiday_toy_shelf');
    s.furn('toy_chest', -1, 1, -5, 0, '#FF9CCB');
    s.furn('teddy_bear', -1, 1, -2, 0);
  } else {
    s.furn('bed_single', -2, 1, -4, 0, style.bed);
    s.furn('nightstand', -1, 1, -5, 0, '#FFFFFF');
    s.furn('table_round', -2, 1, -2, 0);
    s.furn('chair', -1, 1, -2, 3);
  }
  s.furn('fireplace', 1, 1, -5, 0);
  s.furn('sofa', 2, 1, -2, 2, style.sofa);
  s.furn('floor_lamp', 2, 1, -1, 0, '#FFE38F');
  s.furn('fairy_lights', 0, 4, -3, 0, '#FFE38F');
  s.set(-2, 1, -1, 'holiday_present');
  // one elf hides at each cottage: under a window, up on the roof ridge or on the chimney
  const hide = ['window', 'chimney', 'roof'][(index + 3) % 3];
  if (hide === 'window') s.elf(-2, 2, 1, 'window');
  else if (hide === 'roof') s.elf(0, 10, -3, 'roof');
  else s.elf(2, 10, -5, 'chimney');
  s.gem(0, 1, -3, 'cottage');
  if (style.elves) {
    s.feat('holiday:elfhome', 1, 1, 1, 0);
    s.spot('elfhome', -1, 1, 3, 2);
  } else if (name) {
    s.spot(name, 0, 1, 3, 2);
  }
}

/** Santa's workshop: a big red-and-green barn with toy shelves, workbenches and the chair. */
function workshop(v, W) {
  const s = v.site(W.x, W.z, W.f);
  const red = v.id('holiday_planks_red'), green = v.id('wool_green'), shelf = v.id('holiday_toy_shelf');
  s.lot(-11, 4, 11, -14, 'snow', 20);
  s.fill(-8, 0, 0, 8, 0, -12, 'planks_oak');
  for (let dy = 1; dy <= 6; dy++) {
    const key = dy === 6 ? green : red;
    for (let lx = -8; lx <= 8; lx++) { s.set(lx, dy, 0, key); s.set(lx, dy, -12, key); }
    for (let lz = -11; lz <= -1; lz++) { s.set(-8, dy, lz, key); s.set(8, dy, lz, key); }
    for (const lx of [-8, 8]) for (const lz of [0, -12]) s.set(lx, dy, lz, 'candy_cane');
  }
  // the big doorway with a golden-light frame and a star above it
  s.fill(-1, 1, 0, 1, 3, 0, 0);
  for (let dy = 1; dy <= 4; dy++) { s.set(-2, dy, 0, 'candy_cane'); s.set(2, dy, 0, 'candy_cane'); }
  s.fill(-1, 4, 0, 1, 4, 0, 'holiday_lights_gold');
  s.set(0, 5, 0, 'holiday_star');
  s.fill(-3, 5, 1, 3, 5, 1, 'holiday_holly');
  s.elf(-2, 6, 1, 'sign');
  // windows
  for (const lx of [-6, -5, 5, 6]) for (const dy of [2, 3]) s.set(lx, dy, 0, 'holiday_window');
  for (const lz of [-3, -4, -8, -9]) for (const dy of [2, 3]) { s.set(-8, dy, lz, 'holiday_window'); s.set(8, dy, lz, 'holiday_window'); }
  // ceiling, gable walls and the green roof with golden lights along its front edge
  s.fill(-7, 7, -1, 7, 7, -11, 'planks_oak');
  s.gableWall(9, 7, 0, red);
  s.gableWall(9, 7, -12, red);
  for (const lx of [-1, 0, 1]) s.set(lx, 10, 0, 'holiday_window');
  s.set(0, 12, 0, 'holiday_star');
  s.gable(9, 7, 1, -13, v.id('holiday_roof_green'), v.id('holiday_lights_gold'));
  for (let dy = 8; dy <= 15; dy++) s.set(-5, dy, -9, 'brick_red');
  s.set(-5, 15, -9, 'cobble');
  // toy shelves along the back and the sides
  for (let dy = 1; dy <= 3; dy++) {
    for (let lx = -7; lx <= 7; lx++) if (Math.abs(lx) >= 2) s.set(lx, dy, -11, shelf);
  }
  for (let lz = -9; lz <= -6; lz++) for (let dy = 1; dy <= 2; dy++) { s.set(-7, dy, lz, shelf); s.set(7, dy, lz, shelf); }
  // Santa's chair on a red dais with the big star glowing over it
  s.fill(-2, 0, -8, 2, 0, -10, 'wool_red');
  s.fill(-1, 1, -11, 1, 3, -11, 'wool_red');
  s.set(0, 4, -11, 'holiday_star');
  s.set(-1, 4, -11, 'holiday_lights_gold'); s.set(1, 4, -11, 'holiday_lights_gold');
  s.furn('armchair', 0, 1, -10, 0, '#FF8C94');
  s.furn('rug_round', 0, 1, -8, 0, '#FF9CCB');
  // the Gift Workshop bench in the middle (gifts team)
  s.feat('holiday:workshop', 0, 1, -4, 0);
  // workbenches, stools and toys
  s.furn('table_long', -6, 1, -3, 0, '#FFBFA0');
  s.furn('table_long', 5, 1, -3, 0, '#FFBFA0');
  s.furn('stool', -6, 1, -1, 2, '#FF9CCB');
  s.furn('stool', 5, 1, -1, 2, '#A6D8FF');
  s.furn('dollhouse', -4, 1, -9, 0);
  s.furn('toy_chest', 4, 1, -9, 0);
  s.furn('teddy_bear', 5, 1, -9, 0);
  s.furn('easel', -6, 1, -6, 1);
  s.furn('balloon_bunch', 6, 1, -6, 3);
  s.furn('lamp_ceiling', -4, 6, -5, 0, '#FFE38F');
  s.furn('lamp_ceiling', 4, 6, -5, 0, '#FFE38F');
  s.furn('fairy_lights', 0, 6, -8, 0, '#FFE38F');
  s.furn('fairy_lights', 0, 6, -2, 0, '#FF9CCB');
  // presents piled by the door
  for (const [lx, lz] of [[-3, -1], [3, -1], [-3, -2]]) s.set(lx, 1, lz, 'holiday_present');
  s.set(-3, 2, -1, 'holiday_present');
  s.elf(-5, 4, -11, 'shelf');
  s.elf(6, 4, -11, 'shelf');
  s.elf(-5, 16, -9, 'chimney');
  s.gem(0, 8, -6, 'loft');
  s.spot('workshop', 0, 1, 3, 2);
}

/** The reindeer stable (open toward the pasture) and the fenced pasture with a gate. */
function stableAndPasture(v, L) {
  const g = v.g, G = v.G, P = L.pasture, S = L.stable;
  // the pasture lot
  for (let z = P.z0; z <= P.z1; z++) for (let x = P.x0; x <= P.x1; x++) { v.ground(x, z, G, 'snow', G + 8); g.claim(x, z); }
  // the stable
  const s = v.site(S.x, S.z, S.f);
  s.lot(-7, 1, 7, -9, 'snow', 14);
  s.fill(-4, 0, -1, 4, 0, -5, 'hay');
  const red = v.id('holiday_planks_red');
  for (let dy = 1; dy <= 4; dy++) {
    for (let lx = -5; lx <= 5; lx++) s.set(lx, dy, -6, red);
    for (let lz = -5; lz <= 0; lz++) { s.set(-5, dy, lz, red); s.set(5, dy, lz, red); }
  }
  for (let lx = -4; lx <= 4; lx++) s.set(lx, 4, 0, 'holiday_lights');
  for (const lz of [-3, -4, -5]) { s.set(-2, 1, lz, 'planks_oak'); s.set(2, 1, lz, 'planks_oak'); }
  s.set(-4, 1, -5, 'hay'); s.set(-4, 2, -5, 'hay'); s.set(4, 1, -5, 'hay'); s.set(3, 1, -5, 'hay');
  s.set(-3, 3, -6, 'lantern'); s.set(3, 3, -6, 'lantern');
  s.gableWall(6, 5, 0, red);
  s.gableWall(6, 5, -6, red);
  s.set(0, 7, 0, 'holiday_window');
  s.gable(6, 5, 1, -7, v.id('holiday_roof'), v.id('holiday_lights'));
  s.elf(-4, 3, -5, 'hay');
  s.elf(0, 12, -3, 'roof');
  // the fence round the pasture (the stable closes part of the east side), a gate on the west
  const fenceCells = [];
  const sz0 = s.xz(-5, 0)[1], sz1 = s.xz(5, 0)[1];
  const stableZ0 = Math.min(sz0, sz1), stableZ1 = Math.max(sz0, sz1);
  for (let x = P.x0; x <= P.x1; x++) { fenceCells.push([x, P.z0]); fenceCells.push([x, P.z1]); }
  for (let z = P.z0 + 1; z < P.z1; z++) {
    fenceCells.push([P.x0, z]);
    if (z < stableZ0 || z > stableZ1) fenceCells.push([P.x1, z]);
  }
  const gateZ = L.tz;
  for (const [x, z] of fenceCells) {
    if (x === P.x0 && (Math.abs(z - gateZ) <= 1 || z === P.z0 || z === P.z1)) continue;
    if (x === P.x1 && z >= stableZ0 && z <= stableZ1) continue;
    v.furn('fence', x, G + 1, z, 0, '#FFFFFF');
  }
  v.furn('gate', P.x0, G + 1, gateZ, 1, '#FFFFFF');
  // corner posts of pine logs with lights, hay bales and the herd
  for (const [x, z] of [[P.x0, P.z0], [P.x0, P.z1]]) {
    v.set(x, G + 1, z, 'log_pine');
    v.set(x, G + 2, z, 'holiday_lights_gold');
  }
  // the gate posts
  v.set(P.x0, G + 1, gateZ - 1, 'log_pine'); v.set(P.x0, G + 2, gateZ - 1, 'holiday_lights');
  v.set(P.x0, G + 1, gateZ + 1, 'log_pine'); v.set(P.x0, G + 2, gateZ + 1, 'holiday_lights');
  v.elf(P.x0, G + 3, P.z1, 'fence');
  // hay bales stacked outside the gate (the pasture itself stays open for the herd)
  v.set(P.x0 - 2, G + 1, gateZ - 4, 'hay'); v.set(P.x0 - 3, G + 1, gateZ - 4, 'hay'); v.set(P.x0 - 2, G + 2, gateZ - 4, 'hay');
  const area = [P.x0 + 1, P.z0 + 1, P.x1 - 1, P.z1 - 1];
  v.feat('holiday:reindeer', Math.round((P.x0 + P.x1) / 2), G + 1, Math.round((P.z0 + P.z1) / 2) + 2, 3, { n: 4, area, y: G + 1 });
  v.spot('stable', P.x0 - 2, G + 1, gateZ + 3, 1);
  g.gem(P.x0 - 2, G + 3, gateZ - 4, 'hay');
}

/** The sleigh's launch hill: a snowy mound, a flat pad on top, runway lights down its front. */
function launchHill(v, L) {
  const g = v.g, G = v.G, H = L.launch, top = G + H.height;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -4; dx <= 4; dx++) { v.ground(H.x + dx, H.z + dz, top, 'snow', top + 6); g.claim(H.x + dx, H.z + dz); }
  for (let dz = -3; dz <= 3; dz++) for (let dx = -6; dx <= 6; dx++) g.claim(H.x + dx, H.z + dz);
  // the sleigh faces west (down the hill toward the village); its box runs back east
  v.feat('holiday:sleigh', H.x - 3, top + 1, H.z, 3);
  v.furn('lantern_post', H.x + 4, top + 1, H.z - 2, 0, '#FF9CCB');
  v.furn('lantern_post', H.x + 4, top + 1, H.z + 2, 0, '#A6D8FF');
  v.furn('lantern_post', H.x - 4, top + 1, H.z - 2, 0, '#FFE38F');
  v.furn('lantern_post', H.x - 4, top + 1, H.z + 2, 0, '#9BE8CF');
  v.spot('sleigh', H.x, top + 1, H.z + 2, 0);
  // runway lights in the snow, down the slope
  for (let k = 5; k <= 16; k += 2) {
    for (const dz of [-2, 2]) {
      const x = H.x - k, z = H.z + dz;
      const h = g.h(x, z);
      if (h >= G && g.get(x, h + 1, z) === 0) g.set(x, h, z, v.id(k % 4 === 1 ? 'holiday_lights_icy' : 'holiday_lights_gold'));
    }
  }
  g.gem(H.x + 4, top + 1, H.z, 'hill');
}

/** The skating pond's banks: benches, lamps, a lantern pillar and a snowman. */
function pondSide(v, L, pond) {
  const g = v.g, G = v.G, P = L.pond;
  // freeze it all: smooth ice from rim to rim
  const water = v.id('water'), ice = v.id('ice');
  for (let z = Math.floor(P.z - pond.R); z <= Math.ceil(P.z + pond.R); z++) {
    for (let x = Math.floor(P.x - pond.R); x <= Math.ceil(P.x + pond.R); x++) {
      if (g.get(x, pond.level, z) === water) g.set(x, pond.level, z, ice);
    }
  }
  // lower the lip round the ice to the floor so skaters glide straight on
  for (let z = Math.floor(P.z - pond.R - 1); z <= Math.ceil(P.z + pond.R + 1); z++) {
    for (let x = Math.floor(P.x - pond.R - 1); x <= Math.ceil(P.x + pond.R + 1); x++) {
      if (g.h(x, z) === pond.level + 1 && g.get(x, pond.level + 1, z) !== ice && g.get(x, pond.level + 2, z) === 0) v.ground(x, z, pond.level, 'snow', pond.level + 3);
    }
  }
  const rim = P.r + 2;
  // benches facing the ice (only where the bank is the village floor)
  const around = [[0, -1, 0], [0, 1, 2], [1, 0, 1], [-1, 0, 3]];
  const level = (x0, z0, x1, z1) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (g.h(x, z) !== G || g.get(x, G + 1, z) !== 0) return false;
    return true;
  };
  for (const [ax, az, rot] of around) {
    const x = Math.round(P.x + ax * rim), z = Math.round(P.z + az * rim);
    if (level(x - 1, z - 1, x + 1, z + 1)) v.furn('bench', x, G + 1, z, rot, '#A6D8FF');
  }
  for (const a of [0.8, 2.4, 3.9, 5.5]) {
    const x = Math.round(P.x + Math.cos(a) * (rim + 1)), z = Math.round(P.z + Math.sin(a) * (rim + 1));
    v.furn('lantern_post', x, g.h(x, z) + 1, z, 0, '#FFFFFF');
  }
  // a lantern pillar on the bank (an elf likes the top)
  const lx = Math.round(P.x + rim + 1), lz = Math.round(P.z + 3);
  const lh = g.h(lx, lz);
  v.set(lx, lh + 1, lz, 'cobble'); v.set(lx, lh + 2, lz, 'lantern');
  v.elf(lx, lh + 3, lz, 'lamp');
  const sx = Math.round(P.x - 3), sz = Math.round(P.z - rim - 1);
  if (Math.abs(g.h(sx, sz) - G) <= 1) TREES.snowman(g, sx, g.h(sx, sz) + 1, sz);
  for (let z = Math.floor(P.z - rim - 1); z <= P.z + rim + 1; z++) for (let x = Math.floor(P.x - rim - 1); x <= P.x + rim + 1; x++) g.claim(x, z);
  const spx = Math.round(P.x + rim), spz = Math.round(P.z - 3);
  v.spot('pond', spx, g.h(spx, spz) + 1, spz, 3);
  g.gem(Math.round(P.x), pond.level + 1, Math.round(P.z), 'ice');
}

/** The sledding hill: lamps along the run, a flag and a lookout at the top. */
function sledHill(v, L) {
  const g = v.g, G = v.G, S = L.sled;
  // the start: the first column from the top down whose height is the hill's top
  let topX = S.x0 - S.dir * Math.ceil(S.height * 1.35);
  for (let k = 0; k < 40 && g.h(topX, S.z) < G + S.height; k++) topX -= S.dir;
  const top = g.h(topX, S.z);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) g.claim(topX + dx, S.z + dz);
  // a flag pole and a gold bauble
  for (let dy = 1; dy <= 4; dy++) v.set(topX - S.dir * 2, top + dy, S.z - 2, 'candy_cane');
  v.set(topX - S.dir * 2, top + 5, S.z - 2, 'holiday_bauble_red');
  v.elf(topX - S.dir * 2, top + 6, S.z - 2, 'flag');
  v.spot('sledding', topX, top + 1, S.z, 1);
  // little lights down both sides of the run
  for (let k = 0; k <= S.height * 1.35; k += 3) {
    for (const side of [-4, 4]) {
      const x = Math.round(S.x0 - S.dir * k), z = S.z + side;
      const h = g.h(x, z);
      if (g.get(x, h + 1, z) === 0 && g.get(x, h, z) !== 0) g.set(x, h + 1, z, v.id(k % 2 ? 'holiday_lights_icy' : 'holiday_lights'));
      g.claim(x, z);
    }
  }
  for (let k = -2; k <= S.height * 1.35; k++) for (let dz = -3; dz <= 3; dz++) g.claim(Math.round(S.x0 - S.dir * k), S.z + dz);
  g.gem(topX, top + 1, S.z + 2, 'hill');
}

/** A pine for the forest; some wear lights, baubles and a star. */
function forestPine(g, v, x, y, z) {
  TREES.pine(g, x, y, z);
  const r = g.rand();
  if (r > 0.3) return;
  const light = v.id(LIGHTS[Math.floor(g.rand() * LIGHTS.length)]);
  const leaf = v.id('pine_leaves'), snowy = v.id('snow_leaves');
  for (let yy = y + 2; yy < y + 13; yy++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const id = g.get(x + dx, yy, z + dz);
        if (id !== leaf && id !== snowy) continue;
        const open = g.get(x + dx + 1, yy, z + dz) === 0 || g.get(x + dx - 1, yy, z + dz) === 0 || g.get(x + dx, yy, z + dz + 1) === 0 || g.get(x + dx, yy, z + dz - 1) === 0;
        if (!open) continue;
        const q = g.rand();
        if (r < 0.18 && q < 0.22) g.set(x + dx, yy, z + dz, light);
        else if (q < 0.07) g.set(x + dx, yy, z + dz, v.id(BAUBLES[Math.floor(g.rand() * 3)]));
      }
    }
  }
  if (r < 0.08) {
    for (let yy = y + 14; yy > y + 4; yy--) {
      if (g.get(x, yy, z) === leaf || g.get(x, yy, z) === snowy) { g.set(x, yy + 1, z, v.id('holiday_star')); break; }
    }
  }
}

// ---------- generate ----------

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: GROUND - 4 });
  const G = GROUND;
  const L = layout(g);
  makeTerrain(g, L);
  const pond = g.carvePond(L.pond.x, L.pond.z, L.pond.r, { depth: 2, bed: 'clay', ice: true, rimMin: G + 1 });
  g.commit(3);
  const snow = g.id('snow'), dirt = g.id('dirt'), stone = g.id('stone');
  g.fillColumns((x, z, h) => {
    // grey rock shows on the steep mountain sides, everything else is deep snow
    if (h >= G + 8) {
      const at = (xx, zz) => g.H[Math.min(g.sz - 1, Math.max(0, zz)) * g.sx + Math.min(g.sx - 1, Math.max(0, xx))];
      const slope = Math.max(Math.abs(at(x + 1, z) - h), Math.abs(at(x - 1, z) - h), Math.abs(at(x, z + 1) - h), Math.abs(at(x, z - 1) - h));
      if (slope >= 4) return [stone, stone, stone];
    }
    return [snow, dirt, stone, 5, snow, 3];
  });
  g.pourPonds();

  const v = new Village(g);
  // the square, its tree and the avenues out of it (with light arches at their mouths)
  avenue(v, L.tx, L.tz - PLAZA_R - 1, L.tx, L.workshop.z + 1);
  avenue(v, L.tx, L.lane.z0, L.tx, L.lane.z1);
  avenue(v, L.tx + PLAZA_R + 1, L.tz, L.pasture.x0 - 1, L.tz);
  avenue(v, L.tx - PLAZA_R - 1, L.tz, Math.round(L.pond.x + L.pond.r + 3), L.tz);
  square(v, L);
  giantTree(v, L.tx, L.tz);
  lightArch(v, L.tx, L.tz + PLAZA_R + 2, false, 'holiday_lights');
  lightArch(v, L.tx + PLAZA_R + 2, L.tz, true, 'holiday_lights_gold');
  lightArch(v, L.tx - PLAZA_R - 2, L.tz, true, 'holiday_lights_icy');
  // the light tunnel up to the workshop
  let k = 0;
  for (let z = L.tz - PLAZA_R - 2; z >= L.workshop.z + 3; z -= 3) lightArch(v, L.tx, z, false, v.id(LIGHTS[k++ % 3]));
  workshop(v, L.workshop);
  cottage(v, L.elfHome, ELF_COTTAGE);
  L.cottages.forEach((c, i) => cottage(v, c, COTTAGES[i % COTTAGES.length], i === 0 ? 'cottages' : null, i + 1));
  stableAndPasture(v, L);
  launchHill(v, L);
  pondSide(v, L, pond);
  sledHill(v, L);
  // giant candy canes down Candy Cane Lane
  for (let z = L.lane.z0 + 4; z <= L.lane.z1 - 2; z += 12) {
    for (const side of [-4, 4]) {
      const x = L.tx + side;
      if (g.get(x, G + 1, z) !== 0) continue;
      g.set(x, G, z, g.id('quartz'));
      for (let dy = 1; dy <= 5; dy++) g.set(x, G + dy, z, g.id('candy_cane'));
      const out = side < 0 ? -1 : 1;
      g.set(x, G + 6, z, g.id('candy_cane'));
      g.set(x + out, G + 7, z, g.id('candy_cane'));
      g.set(x + out * 2, G + 6, z, g.id('candy_cane'));
      g.set(x + out * 2, G + 5, z, g.id('holiday_bauble_red'));
    }
  }
  // garland hedges along the lane and through the light tunnel (gaps at every cottage path)
  const hedge = (x, z, key) => { if (g.get(x, G + 1, z) === 0 && g.h(x, z) === G) g.set(x, G + 1, z, g.id(key)); };
  for (let z = L.lane.z0 + 3; z <= L.lane.z1 - 1; z++) {
    for (const side of [-3, 3]) {
      if (L.cottages.some((c) => Math.abs(c.z - z) <= 1 && Math.sign(c.x - L.tx) === Math.sign(side))) continue;
      hedge(L.tx + side, z, (z >> 1) % 4 === 0 ? 'holiday_holly' : LIGHTS[((z >> 1) + (side > 0 ? 1 : 0)) % 3]);
    }
  }
  for (let z = L.tz - PLAZA_R - 3; z >= L.workshop.z + 3; z--) for (const side of [-3, 3]) hedge(L.tx + side, z, LIGHTS[(z & 1) + 1]);
  for (let z = L.lane.z0 + 13; z <= L.lane.z1 - 2; z += 12) {
    v.furn('lantern_post', L.tx - 4, G + 1, z, 0, '#FFE38F');
    v.furn('lantern_post', L.tx + 4, G + 1, z, 0, '#FFE38F');
  }
  // the pine forest
  const surf = [g.id('snow')];
  g.scatter(Math.floor((g.sx * g.sz) / 22), {
    spacing: 2,
    avoidSpawn: 30,
    accept: (x, z) => g.dryLand(x, z, surf) && g.rand() < 0.08 + Math.max(0, g.noise.fbm2(x / 30 + 300, z / 30 + 55, 2)) * 1.3,
    place: (x, z) => forestPine(g, v, x, g.h(x, z) + 1, z),
  });
  // snowmen and snowy bushes out in the snow
  g.scatter(g.big ? 36 : 20, {
    spacing: 4,
    avoidSpawn: 24,
    accept: (x, z) => g.dryLand(x, z, surf) && g.h(x, z) <= G + 6,
    place: (x, z) => {
      if (g.rand() < 0.45) TREES.snowman(g, x, g.h(x, z) + 1, z);
      else for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) g.setAir(x + dx, g.h(x + dx, z + dz) + 1, z + dz, g.id('snow_leaves'));
    },
  });
  // an elf up in a forest tree near the pond, and one on a lower branch of the giant tree
  treeElves(v, L);
  g.hilltopGems(8);

  world.features = v.finalize();
  world.holidayDropped = v.dropped; // records that did not fit, with why (tests expect none)
  world.outside = { block: 'snow', surface: G + EDGE_H + 1 };
  const w = g.finish();
  w.waterLevel = 0; // no sea (the pond is frozen)
  w._spawn = [L.spawn[0] + 0.5, G + 1, L.spawn[1] + 0.5];
  return w;
}

/** Elf spots in trees: on a low branch of the giant tree, and in a forest pine near the pond. */
function treeElves(v, L) {
  const g = v.g, G = v.G;
  const leafy = (id) => id === v.id('pine_leaves') || id === v.id('snow_leaves');
  // the giant tree: an outer branch tip on its south side (toward the spawn) with room above
  let done = false;
  for (let y = G + TREE_BASE; y <= G + TREE_BASE + 6 && !done; y++) {
    for (let r = 11; r >= 4 && !done; r--) {
      for (const dx of [2, -2, 3, -3, 1, -1]) {
        const x = L.tx + dx, z = L.tz + r;
        if (g.get(x, y, z) !== 0 && g.get(x, y + 1, z) === 0 && g.get(x, y + 2, z) === 0) { v.elf(x, y + 1, z, 'tree'); done = true; break; }
      }
    }
  }
  // a forest pine: the nearest one round the pond with an open ledge
  let found = false;
  for (let r = 10; r < 44 && !found; r += 2) {
    for (let a = 0; a < 24 && !found; a++) {
      const x = Math.round(L.pond.x + Math.cos((a / 24) * Math.PI * 2) * r), z = Math.round(L.pond.z + Math.sin((a / 24) * Math.PI * 2) * r);
      const h = g.h(x, z);
      if (g.get(x, h + 1, z) !== v.id('log_pine')) continue;
      for (let y = h + 3; y < h + 8 && !found; y++) {
        for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          if (leafy(g.get(x + dx, y, z + dz)) && g.get(x + dx, y + 1, z + dz) === 0) { v.elf(x + dx, y + 1, z + dz, 'tree'); found = true; break; }
        }
      }
    }
  }
}

// ---------- the New World card ----------

/** A lit tree in a snowy village at dusk (288 x 176 pixel art, wave5-plan.md §5.3). */
export function paintArt(g, W, H, { rand, reg, tileFor, drawSparkle }) {
  const T = 16;
  const block = (key, x, y, face = 0, fallback = '#FFFFFF') => {
    const d = reg && reg.byKey(key);
    const t = d && d.id ? tileFor(d, face) : null;
    if (t) g.drawImage(t, x, y);
    else { g.fillStyle = fallback; g.fillRect(x, y, T, T); }
  };
  const groundY = H - 3 * T; // 128
  // sky: deep indigo at the top to rosy pink at the horizon, in blocky bands
  const bands = ['#262B6E', '#2F3480', '#3B3D8F', '#4B469C', '#5E4FA6', '#7457AC', '#8D5EAF', '#A964AE', '#C56CAA', '#DD7AA7', '#F08FA9', '#FBA8B0'];
  const bh = Math.ceil(groundY / bands.length);
  bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * bh, W, bh + 1); });
  for (let i = 0; i < 40; i++) drawSparkle(g, Math.floor(rand() * W), Math.floor(rand() * 64), rand() < 0.2 ? 2 : 1, rand() < 0.6 ? '#FFFFFF' : '#FFF3B0');
  // a crescent moon
  for (let y = -11; y <= 11; y++) {
    for (let x = -11; x <= 11; x++) {
      const inMoon = x * x + y * y <= 110, bite = (x - 6) * (x - 6) + (y + 3) * (y + 3) <= 90;
      if (x * x + y * y <= 196 && !inMoon) { g.fillStyle = 'rgba(255,246,216,0.10)'; g.fillRect(36 + x, 26 + y, 1, 1); }
      if (inMoon && !bite) { g.fillStyle = '#FFF4CF'; g.fillRect(36 + x, 26 + y, 1, 1); }
    }
  }
  // far snowy mountains: lavender with white caps
  const peaks = [[10, 70], [58, 56], [104, 76], [150, 52], [196, 72], [240, 58], [284, 74]];
  for (let x = 0; x < W; x += 2) {
    let y = H, top = H;
    for (const [px, py] of peaks) { const yy = py + Math.abs(x - px) * 0.75; if (yy < y) { y = yy; top = py; } }
    y = Math.floor(y / 2) * 2;
    const cap = Math.max(0, Math.round((top + 14 - y) / 2) * 2 + (x % 6 === 0 ? 2 : 0));
    g.fillStyle = x % 4 ? '#A99CDB' : '#9F92D3'; g.fillRect(x, y, 2, groundY - y);
    if (cap > 0) { g.fillStyle = '#FFFFFF'; g.fillRect(x, y, 2, cap); }
  }
  // nearer snowy hills with little pines
  for (let x = 0; x < W; x += 2) {
    const y = Math.floor((100 + Math.sin(x / 23) * 6 + Math.sin(x / 9 + 1) * 2) / 2) * 2;
    g.fillStyle = '#E4DCF6'; g.fillRect(x, y, 2, groundY - y);
    g.fillStyle = '#F6F2FF'; g.fillRect(x, y, 2, 2);
  }
  for (const px of [20, 60, 96, 196, 232, 270]) {
    const by = Math.floor((100 + Math.sin(px / 23) * 6) / 2) * 2;
    g.fillStyle = '#3E7F6C';
    for (let k = 0; k < 4; k++) g.fillRect(px - 6 + k * 2, by - 4 - k * 4, 12 - k * 4, 4);
    g.fillStyle = '#FFFFFF'; g.fillRect(px - 2, by - 18, 4, 2);
  }
  // snowy ground
  for (let col = 0; col < W / T; col++) for (let r = 0; r < 3; r++) block('snow', col * T, groundY + r * T, 0);
  g.fillStyle = 'rgba(58,31,77,0.14)'; g.fillRect(0, groundY + T, W, 2 * T);
  // a peppermint path to the tree
  for (let col = 7; col <= 10; col++) block('peppermint', col * T, groundY, 0, '#FF6F8A');
  // two cottages: gingerbread on the left, pink frosting on the right, glowing windows
  const cottageArt = (x0, wall, roofColor, roofDark, bulbs) => {
    for (let dx = 0; dx < 3; dx++) for (let dy = 1; dy <= 2; dy++) block(wall, x0 + dx * T, groundY - dy * T, 0, '#B56E37');
    block('holiday_window', x0 + 2 * T, groundY - 2 * T, 0, '#FFE08A');
    g.fillStyle = '#7A4A37'; g.fillRect(x0 + 4, groundY - 24, 9, 24);
    g.fillStyle = '#FFE38F'; g.fillRect(x0 + 10, groundY - 13, 2, 2);
    // a snowy gable roof (white under, the shingles inset so snow lines the edges)
    const mid = x0 + 24, eave = groundY - 2 * T, peak = eave - 34;
    for (let y = peak; y < eave; y += 2) {
      const hw = 4 + (y - peak);
      g.fillStyle = '#FFFFFF'; g.fillRect(mid - hw, y, hw * 2, 2);
      const hi = hw - 5;
      if (hi > 0 && y > peak + 4) { g.fillStyle = (y >> 1) % 4 === 0 ? roofDark : roofColor; g.fillRect(mid - hi, y, hi * 2, 2); }
    }
    // a light string along the eave and icicles under it
    g.fillStyle = '#1E2A22'; g.fillRect(mid - 37, eave, 74, 1);
    for (let k = 0; k < 11; k++) {
      const x = mid - 35 + k * 7, y = eave + 1 + (k % 2);
      g.fillStyle = 'rgba(255,240,200,0.3)'; g.fillRect(x - 2, y - 2, 6, 7);
      g.fillStyle = bulbs[k % bulbs.length]; g.fillRect(x, y, 2, 3);
    }
    g.fillStyle = '#E8F6FF';
    for (let x = mid - 30; x < mid + 30; x += 9) g.fillRect(x, eave + 5, 2, 3 + (x % 3));
    // chimney with a puff of smoke
    g.fillStyle = '#B2484B'; g.fillRect(mid + 12, peak + 6, 8, 14);
    g.fillStyle = '#FFFFFF'; g.fillRect(mid + 11, peak + 4, 10, 3);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(mid + 14, peak - 4, 6, 5); g.fillRect(mid + 18, peak - 10, 7, 5);
  };
  cottageArt(14, 'holiday_gingerbread', '#D9415A', '#B5324A', ['#FF4F6E', '#FFD84D', '#5FD0FF', '#8CFF9E']);
  cottageArt(W - 14 - 3 * T, 'frosting_pink', '#3E8E6C', '#2F7558', ['#FFD84D', '#FFFFFF', '#FFD84D', '#FFB347']);
  // the giant tree: four tiers of needles, snow on every tier, light strings and baubles
  const cx = W / 2;
  const tiers = [[82, 122, 58], [60, 102, 44], [40, 80, 32], [20, 56, 20]]; // [top y, bottom y, half width]
  g.fillStyle = '#7A4E33'; g.fillRect(cx - 6, 116, 12, groundY - 116);
  g.fillStyle = '#5E3A26'; g.fillRect(cx + 2, 116, 4, groundY - 116);
  const NEEDLES = ['#2B6F59', '#317A62', '#3A876D', '#2A6553'];
  const halfAt = (t, y) => 3 + (t[2] * (y - t[0])) / (t[1] - t[0]);
  for (const t of tiers) {
    for (let y = t[0]; y < t[1]; y += 2) {
      const hw = Math.floor(halfAt(t, y) / 2) * 2;
      for (let x = -hw; x < hw; x += 2) {
        const n = rand();
        g.fillStyle = x > hw * 0.35 ? (n < 0.5 ? '#245C4A' : '#2A6553') : NEEDLES[Math.floor(n * 3)];
        if (x < -hw * 0.5 && n < 0.25) g.fillStyle = '#46967A';
        g.fillRect(cx + x, y, 2, 2);
      }
    }
    // snow along the tier's lower edge, with a few drips
    const hb = Math.floor(halfAt(t, t[1] - 2) / 2) * 2;
    g.fillStyle = '#FFFFFF'; g.fillRect(cx - hb, t[1] - 2, hb * 2, 2);
    for (let x = -hb + 4; x < hb - 4; x += 10) g.fillRect(cx + x, t[1], 2, 2 + (x & 2));
  }
  // light strings: sagging rows of bulbs across each tier, each bulb with a soft glow
  const BULBS = ['#FF4F6E', '#FFD84D', '#5FD0FF', '#8CFF9E', '#FF9CEB', '#FFFFFF'];
  let b = 0;
  for (const t of tiers) {
    for (let k = 0; k < 2; k++) {
      const y0 = t[0] + Math.round((t[1] - t[0]) * (k ? 0.82 : 0.45));
      const hw = halfAt(t, y0) - 4;
      for (let x = -hw; x <= hw; x += 7) {
        const y = Math.round(y0 - 6 * (1 - (x / hw) ** 2));
        const c = BULBS[b++ % BULBS.length];
        g.fillStyle = 'rgba(255,240,200,0.25)'; g.fillRect(cx + x - 2, y - 2, 6, 7);
        g.fillStyle = c; g.fillRect(cx + x, y, 2, 3);
      }
    }
  }
  // baubles
  const BAUBLE = ['#E8455C', '#FFC93D', '#4FA8F0', '#C77DFF'];
  for (const [i, t] of tiers.entries()) {
    for (let k = 0; k < 3 + (3 - i); k++) {
      const y = t[0] + 10 + Math.floor(rand() * (t[1] - t[0] - 16));
      const hw = halfAt(t, y) - 6;
      const x = Math.round((rand() * 2 - 1) * hw);
      g.fillStyle = BAUBLE[(i + k) % 4]; g.fillRect(cx + x, y, 4, 4); g.fillRect(cx + x - 1, y + 1, 6, 2); g.fillRect(cx + x + 1, y - 1, 2, 1);
      g.fillStyle = '#FFFFFF'; g.fillRect(cx + x + 1, y + 1, 1, 1);
    }
  }
  // the star, glowing on top
  const sx = cx, sy = 16;
  for (let y = -22; y <= 22; y += 2) {
    for (let x = -22; x <= 22; x += 2) {
      const d = Math.hypot(x, y);
      if (d > 22) continue;
      g.fillStyle = `rgba(255,236,150,${(0.32 * (1 - d / 22)).toFixed(3)})`;
      g.fillRect(sx + x - 1, sy + y - 1, 2, 2);
    }
  }
  const STAR = ['.....X.....', '....XXX....', '....XXX....', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..XXXXXXX..', '...XXXXX...', '..XXXXXXX..', '..XXX.XXX..', '.XXX...XXX.', '.XX.....XX.'];
  for (let r = 0; r < STAR.length; r++) {
    for (let c = 0; c < 11; c++) {
      if (STAR[r][c] !== 'X') continue;
      g.fillStyle = r < 5 && c < 6 ? '#FFF2A8' : '#FFD23F';
      g.fillRect(sx - 11 + c * 2, sy - 11 + r * 2, 2, 2);
    }
  }
  // presents under the tree
  for (const [px, c, r, w, h] of [[cx - 46, '#E8455C', '#FFD34D', 12, 11], [cx - 30, '#5FC8FF', '#FFFFFF', 10, 8], [cx + 20, '#5FBF7A', '#FF5F7E', 12, 12], [cx + 36, '#C77DFF', '#FFE27A', 10, 9], [cx - 18, '#FFD34D', '#E8455C', 9, 7], [cx + 9, '#FF9CCB', '#FFFFFF', 8, 6]]) {
    g.fillStyle = c; g.fillRect(px, groundY - h, w, h);
    g.fillStyle = r; g.fillRect(px + (w >> 1) - 1, groundY - h, 2, h); g.fillRect(px, groundY - h + 3, w, 2); g.fillRect(px + (w >> 1) - 3, groundY - h - 3, 6, 3);
  }
  // a lamp post with a warm glow, a candy cane and a snowman
  const lamp = (x) => {
    g.fillStyle = 'rgba(255,226,140,0.25)'; g.fillRect(x - 8, groundY - 44, 20, 20);
    g.fillStyle = '#3A3550'; g.fillRect(x + 1, groundY - 34, 2, 34); g.fillRect(x - 2, groundY - 38, 8, 2);
    g.fillStyle = '#FFE38F'; g.fillRect(x - 1, groundY - 36, 6, 6);
  };
  lamp(78); lamp(W - 82);
  g.fillStyle = '#FFFFFF'; g.fillRect(W - 102, groundY - 30, 6, 30);
  g.fillStyle = '#F24F69'; for (let y = 0; y < 30; y += 6) g.fillRect(W - 102, groundY - 30 + y, 6, 3);
  g.fillStyle = '#FFFFFF'; g.fillRect(W - 102, groundY - 34, 14, 4); g.fillRect(W - 92, groundY - 34, 4, 9);
  g.fillStyle = '#F24F69'; g.fillRect(W - 98, groundY - 34, 3, 4); g.fillRect(W - 92, groundY - 29, 4, 2);
  g.fillStyle = '#FFFFFF'; g.fillRect(92, groundY - 16, 18, 16); g.fillRect(94, groundY - 28, 14, 12);
  g.fillStyle = '#2E2244'; g.fillRect(97, groundY - 24, 2, 2); g.fillRect(103, groundY - 24, 2, 2);
  g.fillStyle = '#FF8A3D'; g.fillRect(100, groundY - 21, 5, 2);
  g.fillStyle = '#E8455C'; g.fillRect(93, groundY - 17, 16, 3); g.fillRect(94, groundY - 32, 14, 4);
  // falling snow
  g.fillStyle = '#FFFFFF';
  for (let i = 0; i < 46; i++) { const s = rand() < 0.3 ? 2 : 1; g.fillRect(Math.floor(rand() * W), Math.floor(rand() * groundY), s, s); }
}

export const biome = {
  key: 'holiday',
  name: 'Holiday Village',
  description: 'Twinkly lights, a giant tree, elves and reindeer',
  iconBlock: 'holiday_lights',
  colors: ['#FFE3EC', '#D93D5A'],
  // a winter evening all day: deep blue above, lavender and rosy pink at the horizon
  // (daylightMax: asked of the integrator, docs/teams/holiday-world.md: keeps the day light a
  // little dim so the light strings glow even by day; ignored until daynight.js reads it)
  sky: { top: '#5368C9', mid: '#B497E0', horizon: '#FFC2D6', fog: '#F2D8EE', sunset: '#FF9FBF', sunrise: '#FFB8C8', nightTop: '#141A4A', cloud: '#FFE8F2', daylightMax: 0.72 },
  // snow most of the time (weather.js reads biome.weather as its weights); startWeather: asked
  // of the integrator so a new Holiday Village starts in falling snow like the snow biome
  weather: { sunny: 1.5, cloudy: 1, rain: 0, rainbow: 0, snow: 7 },
  startWeather: 'snow',
  generate,
  paintArt,
};
