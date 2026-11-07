// Cruise Ship (docs/teams/cruise-world.md): the Glimmer Star, an enormous original ocean liner
// floating in a turquoise sea, with a little palm island and a few rocks out at sea.
//
// The ship runs along Z with the stern at the low end and the bow at the high end. Decks (floor
// block y; she stands one above):
//   Promenade 30  wrap-around walk, the snack bar, cabins in a row, the forward lobby
//   Fun       35  kids' club, the bubble hall under the pools, arcade, art studio, sweet street,
//                 theater
//   Pool      40  the spawn: two pools, hot tubs, the slide tower (platform 52), dance floor,
//                 bandstand; the sunset lounge and cafe under the sports deck
//   Sports    45  two funnels with the big screen, running track, mini golf, game court, and
//                 the bridge at its front (roof 50)
// Everything that is not a block (furniture, rides, games, named spots) goes to
// world.features for the modules that own it (docs/teams/wave5-plan.md §4.1); every record's
// cells are checked free here before it is listed. Every loop is bounded by the world size.

import { Gen, TREES, blob, puffCloud } from './gen.js';

export const SEA = 20;
export const KEEL = 12;
export const F1 = 30, F2 = 35, F3 = 40, F4 = 45, F5 = 50;
export const FT = F3 + 12; // the slide tower's platform
export const DECKS = { promenade: F1, fun: F2, pool: F3, sports: F4, bridge: F5, slides: FT };
const DECK_NAME = { [F1]: 'Promenade Deck', [F2]: 'Fun Deck', [F3]: 'Pool Deck', [F4]: 'Sports Deck', [FT]: 'Slide Tower' };

/**
 * Furniture sizes [w, h, d] of every key placed through `furn` (from the catalog, so Node can
 * check footprints without three.js; tools/test-cruise-world.mjs compares them with the
 * sources). cruise_lounger belongs to cruise-fun (docs/teams/cruise-world.md §6).
 */
export const FURN_SIZES = {
  bed_single: [1, 1, 2], bed_bunk: [1, 3, 2], nightstand: [1, 1, 1], wardrobe: [2, 2, 1],
  toy_chest: [1, 1, 1], sofa: [2, 1, 1], armchair: [1, 1, 1], beanbag: [1, 1, 1],
  coffee_table: [2, 1, 1], tv: [2, 2, 1], piano: [2, 2, 1], plant_pot: [1, 1, 1],
  floor_lamp: [1, 2, 1], lantern_post: [1, 2, 1], counter: [1, 1, 1], table_round: [1, 1, 1],
  chair: [1, 1, 1], stool: [1, 1, 1], fridge: [1, 2, 1], bench: [2, 1, 1],
  dollhouse: [2, 2, 1], teddy_bear: [1, 1, 1], trampoline: [2, 1, 2], slide: [1, 2, 3],
  easel: [1, 2, 1], balloon_bunch: [1, 2, 1], bookshelf_tall: [2, 2, 1], desk: [2, 1, 1],
  candy_shop: [3, 3, 2], ice_cream_parlor: [3, 3, 2], camp_chair: [1, 1, 1], hammock: [3, 2, 1],
  picnic_blanket: [2, 1, 2], cooler: [1, 1, 1], lamp_ceiling: [1, 1, 1], door: [1, 2, 1],
  door_pink: [1, 2, 1], door_glass: [1, 2, 1], rug_round: [2, 1, 2],
  boat_swan: [2, 2, 3], boat_speed: [2, 2, 4], cruise_lounger: [1, 1, 2],
};
/** Keys whose base cells are water cells at the surface (boats float). */
export const FLOATING = new Set(['boat_swan', 'boat_speed']);
/** Keys that hang under a ceiling: the block above the top cell is solid instead of below. */
export const HANGING = new Set(['lamp_ceiling']);
/** Keys that may share cells with nothing but stand on a rug (flat). */
export const FLAT = new Set(['rug_round', 'picnic_blanket']);

const COLORS = {
  pink: '#FFB6D9', mint: '#A8E6CF', sky: '#A0D8FF', lilac: '#CDB4FF', sun: '#FFE08A', peach: '#FFC8A8',
};
const CABIN_FLOORS = ['wool_pink', 'wool_sky', 'wool_lime', 'wool_purple', 'wool_yellow', 'wool_cyan'];

// ---------- the plan: every number of the ship from the world size ----------

/**
 * Layout of the ship for a world of sx x sz (pure: no blocks). z0 stern, z1 bow tip; HW the
 * half beam; zA/zB/zC the extents of the superstructure levels (rooms on the Promenade, Fun
 * and Pool decks), zBr the bridge, zT the slide tower's centre, zLift the forward lift.
 */
export function shipPlan(sx, sz) {
  const big = sx > 160;
  const P = {
    big, sx, sz,
    cx: Math.floor(sx / 2),
    HW: big ? 20 : 17,
    z0: big ? 18 : 15,
    z1: sz - 1 - (big ? 14 : 11),
    RS: 9, // stern rounding length
    LB: big ? 46 : 36, // bow taper length
  };
  P.L = P.z1 - P.z0;
  P.hwi = new Int16Array(sz + 16).fill(-1);
  for (let z = 0; z < sz + 16; z++) {
    const h = hullHalf(P, z);
    P.hwi[z] = h < 0 ? -1 : Math.floor(h + 0.3);
  }
  P.zA0 = P.z0 + 9;
  P.zB0 = P.zA0 + 6;
  let zA1 = P.zA0;
  for (let z = P.zA0; z <= P.z1; z++) if (P.hwi[z] - 4 >= 7) zA1 = z;
  P.zA1 = zA1;
  P.zB1 = zA1 - 3;
  P.zC1 = zA1 - 6;
  P.zBr0 = P.zC1 - 6;
  P.zC0 = P.zC1 - (big ? 58 : 40);
  P.zT = P.zB0 + 7;
  P.zLift = P.zC0 + 15;
  return P;
}

/** Deck-level hull half width (float) at z, -1 outside the ship. */
function hullHalf(P, z) {
  if (z < P.z0 || z > P.z1) return -1;
  const a = z - P.z0, b = P.z1 - z;
  let k = 1;
  if (a < P.RS) {
    const t = (P.RS - a) / P.RS;
    k = Math.min(k, 0.6 + 0.4 * Math.sqrt(Math.max(0, 1 - t * t)));
  }
  if (b < P.LB) {
    const u = 1 - b / P.LB;
    k = Math.min(k, Math.pow(Math.max(0, 1 - Math.pow(u, 2.1)), 0.72));
  }
  return P.HW * k;
}

/** Hull half width at height y: the bow rakes back and the bilge rounds in below. */
function hullAt(P, z, y) {
  const lift = F1 - y;
  let h = Math.min(hullHalf(P, z + lift * 0.55), hullHalf(P, z - lift * 0.3));
  if (h < 0) return -1;
  if (y < KEEL + 6) h *= 1 - ((KEEL + 6 - y) / 7) ** 2 * 0.55;
  return h;
}

// integer rotation of a grid offset, as src/things/entities.js rotXZ (rot 0..3: front +Z, +X, -Z, -X)
function rotXZ(x, z, rot) {
  switch (rot & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}

/** The cells a piece of furniture of `size` covers at anchor (x, y, z), as entities.footprint. */
export function footprint(size, x, y, z, rot) {
  const w = Math.max(1, size[0] | 0), h = Math.max(1, size[1] | 0), d = Math.max(1, size[2] | 0);
  const ai = Math.floor((w - 1) / 2);
  const out = [];
  for (let i = 0; i < w; i++) {
    for (let k = 0; k < d; k++) {
      const [ox, oz] = rotXZ(i - ai, k - (d - 1), rot);
      for (let j = 0; j < h; j++) out.push([x + ox, y + j, z + oz]);
    }
  }
  return out;
}

// ---------- generation ----------

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: SEA });
  const P = shipPlan(g.sx, g.sz);
  const S = new Ship(g, P);
  g.cz = Math.round(S.spawn[2]); // gems keep away from the spawn (Gen.distSpawn)
  g.spawnR = 6;
  S.sea();
  S.hull();
  S.levels();
  S.promenadeRooms();
  S.funRooms();
  S.loungeRooms();
  S.bridge();
  S.pools();
  S.funnels();
  S.sportsDeck();
  S.railings();
  S.stairs();
  S.slideTower();
  S.slides();
  S.poolDeck();
  S.hullDetails();
  S.lifeboats();
  S.masts();
  S.islandLife();
  S.spotsAndLifts();
  S.heights();
  S.gemCandidates();
  world.outside = { block: 'water', surface: SEA + 0.875 };
  const w = g.finish();
  w._spawn = S.spawn;
  world.features = S.features;
  // records that could not be placed (for tools/test-cruise-world.mjs and worldview debugging)
  Object.defineProperty(world, '_cruiseSkipped', { value: S.skipped, configurable: true, writable: true });
  return w;
}

class Ship {
  constructor(g, P) {
    this.g = g;
    this.P = P;
    this.features = [];
    this.skipped = [];
    this.res = new Uint8Array(g.sx * g.sy * g.sz); // cells kept free for feature records
    const reg = g.world.registry;
    this.solidOf = new Uint8Array(256);
    this.liquidOf = new Uint8Array(256);
    for (const d of reg.defs) {
      this.solidOf[d.id] = d.solid ? 1 : 0;
      this.liquidOf[d.id] = d.shape === 'liquid' ? 1 : 0;
    }
    const ids = {};
    this.B = new Proxy(ids, { get: (t, k) => (t[k] ??= g.id(k)) });
    this.spawn = [P.cx + 0.5, F3 + 1, P.zC0 - 4 + 0.5];
  }

  // ---------- small helpers ----------

  dx(x) { return Math.abs(x - this.P.cx); }
  hw(z) { return z >= 0 && z < this.P.hwi.length ? this.P.hwi[z] : -1; }
  /** Superstructure half width at z (the open walk outside it is 3 wide). */
  W(z, shift = 0) { const h = this.hw(z + shift); return h < 0 ? -1 : h - 4; }
  inHull(x, z) { const h = this.hw(z); return h >= 0 && this.dx(x) <= h; }
  R1(x, z) { const P = this.P; return z >= P.zA0 && z <= P.zA1 && this.dx(x) <= this.W(z); }
  R2(x, z) { const P = this.P; return z >= P.zB0 && z <= P.zB1 && this.dx(x) <= this.W(z, 3); }
  R3(x, z) { const P = this.P; return z >= P.zC0 && z <= P.zC1 && this.dx(x) <= this.W(z, 6); }
  RB(x, z) { const P = this.P; return z >= P.zBr0 && z <= P.zC1 && this.dx(x) <= this.W(z, 6); }

  idx(x, y, z) { return (y * this.g.sz + z) * this.g.sx + x; }
  get(x, y, z) { return this.g.get(x, y, z); }
  set(x, y, z, id) { if (this.g.inside(x, y, z) && !this.res[this.idx(x, y, z)]) this.g.set(x, y, z, id); }
  air(x, y, z) { return this.g.inside(x, y, z) && this.g.get(x, y, z) === 0; }
  solid(x, y, z) { return this.solidOf[this.g.get(x, y, z)] === 1; }
  water(x, y, z) { return this.liquidOf[this.g.get(x, y, z)] === 1; }
  free(x, y, z) { return this.air(x, y, z) && !this.res[this.idx(x, y, z)]; }
  reserve(x, y, z) { if (this.g.inside(x, y, z)) this.res[this.idx(x, y, z)] = 1; }
  /** Decoration: only into free air. */
  deco(x, y, z, id) { if (this.free(x, y, z)) this.g.set(x, y, z, id); }
  fill(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
  }

  /** A record whose cells are free air, standing on solid floor (or hanging / floating). */
  ok(cells, { floating = false, hanging = false } = {}) {
    let y0 = Infinity, y1 = -Infinity;
    for (const c of cells) { y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); }
    for (const [x, y, z] of cells) {
      if (floating && y === y0) {
        if (!this.water(x, y, z) || this.res[this.idx(x, y, z)]) return false;
        continue;
      }
      if (!this.free(x, y, z)) return false;
      if (!floating && !hanging && y === y0 && !this.solid(x, y - 1, z)) return false;
      if (hanging && y === y1 && !this.solid(x, y + 1, z)) return false;
    }
    return true;
  }

  claim(cells) { for (const [x, y, z] of cells) this.reserve(x, y, z); }

  /** Furniture through the built-in `furn` kind. Returns true when listed. */
  furn(key, x, y, z, rot = 0, color = null, data = null) {
    const size = FURN_SIZES[key];
    if (!size) { this.skipped.push(key); return false; }
    const cells = footprint(size, x, y, z, rot);
    if (!this.ok(cells, { floating: FLOATING.has(key), hanging: HANGING.has(key) })) {
      this.skipped.push(`${key}@${x},${y},${z}`);
      return false;
    }
    this.claim(cells);
    const f = { kind: 'furn', key, x, y, z, rot: rot & 3 };
    if (color) f.color = color;
    if (data) f.data = data;
    this.features.push(f);
    return true;
  }

  /** A pool float on the top water cell (air above). */
  floatAt(x, y, z) {
    if (!this.water(x, y, z) || this.res[this.idx(x, y, z)] || !this.free(x, y + 1, z)) { this.skipped.push(`cruise:float@${x},${y},${z}`); return false; }
    this.reserve(x, y, z);
    this.features.push({ kind: 'cruise:float', x, y, z, rot: 0 });
    return true;
  }

  /** Furniture at the first spot that fits among `tries` ([x, z] around the wanted place, y from the ground). */
  furnNear(key, x, z, rot, color, ring = 3) {
    for (let r = 0; r <= ring; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const xx = x + dx, zz = z + dz;
        const y = FLOATING.has(key) ? SEA : this.g.h(xx, zz) + 1;
        const size = FURN_SIZES[key];
        const cells = footprint(size, xx, y, zz, rot);
        if (this.ok(cells, { floating: FLOATING.has(key) })) return this.furn(key, xx, y, zz, rot, color);
      }
    }
    this.skipped.push(`${key}@${x},${z}`);
    return false;
  }

  /** A cruise:* record at one cell (plus any extra cells it keeps free). */
  feat(kind, x, y, z, rot = 0, extra = {}, cells = null) {
    const list = cells || [[x, y, z], [x, y + 1, z]];
    if (!this.ok(list)) { this.skipped.push(`${kind}@${x},${y},${z}`); return false; }
    this.claim(list);
    this.features.push({ kind, x, y, z, rot: rot & 3, ...extra });
    return true;
  }

  // ---------- the sea, the island and the rocks ----------

  sea() {
    const { g, P, B } = this;
    const { cx } = P;
    const n = g.noise;
    // the island: off the starboard side, toward the bow
    const r = P.big ? 13 : 9;
    const isl = { x: Math.min(g.sx - r - 14, cx + (P.big ? 60 : 44)), z: Math.round(P.z0 + P.L * 0.6), r };
    this.island = isl;
    this.rocks = [
      [cx - (P.big ? 52 : 42), Math.round(P.z0 + P.L * 0.28), 3.2],
      [cx - (P.big ? 46 : 38), Math.round(P.z0 + P.L * 0.8), 2.4],
      [cx + (P.big ? 50 : 40), Math.round(P.z0 + P.L * 0.1), 2.6],
    ];
    g.shape((x, z) => {
      // a sandy sea floor with soft dunes, deep enough under the ship for sea forms
      let h = SEA - 13 + n.fbm2(x / 26, z / 26, 3) * 3;
      const ang = Math.atan2(z - isl.z, x - isl.x);
      const d = Math.hypot(x - isl.x, z - isl.z) / (isl.r * (1 + n.n2(Math.cos(ang) * 1.3 + 4, Math.sin(ang) * 1.3) * 0.14));
      if (d < 2.4) h = Math.max(h, SEA + 2.2 - d * d * 1.9 + Math.max(0, 0.55 - d) * 3);
      for (const [rx, rz, rr] of this.rocks) {
        const dr = Math.hypot(x - rx, z - rz) / rr;
        if (dr < 2.2) h = Math.max(h, SEA - 5 + (2.2 - dr) * 4.2 + n.n2(x / 2, z / 2) * 0.8);
      }
      return h;
    });
    g.commit(2, 40);
    g.fillColumns((x, z, h) => {
      if (this.rocks.some(([rx, rz, rr]) => Math.hypot(x - rx, z - rz) < rr * 1.3)) return [h > SEA - 1 ? B.mossy_stone : B.stone, B.stone, B.stone];
      const di = Math.hypot(x - isl.x, z - isl.z);
      if (h > SEA + 2 && di < isl.r * 0.5) return [B.grass, B.dirt, B.stone];
      if (h < SEA - 9 && n.n2(x / 9, z / 9) > 0.45) return [B.gravel, B.sand, B.stone];
      return [h >= SEA - 2 && n.n2(x / 7 + 5, z / 7) > 0.25 ? B.sand_pink : B.sand, B.sand, B.stone, 4];
    });
    g.fillSea(B.water);
    // coral and seaweed in the shallows round the island
    const corals = [B.coral, B.coral_purple, B.coral_yellow, B.coral_blue];
    for (let k = 0; k < (P.big ? 140 : 90); k++) {
      const a = g.rand() * Math.PI * 2, dd = isl.r * (1.1 + g.rand() * 1.1);
      const x = Math.round(isl.x + Math.cos(a) * dd), z = Math.round(isl.z + Math.sin(a) * dd);
      const h = g.h(x, z);
      if (h >= SEA - 1 || h < SEA - 8) continue;
      g.set(x, h + 1, z, g.rand() < 0.3 ? B.seaweed : corals[Math.floor(g.rand() * 4)]);
    }
  }

  // ---------- the hull ----------

  hull() {
    const { g, P, B } = this;
    const { cx } = P;
    for (let y = KEEL; y <= F1; y++) {
      const id = y <= F1 - 5 ? B.cruise_hull : y === F1 - 4 ? B.cruise_stripe : B.cruise_white;
      for (let z = P.z0 - 2; z <= P.z1 + 2; z++) {
        const h = hullAt(P, z, y);
        if (h < 0) continue;
        const hi = Math.floor(h + 0.3);
        for (let x = cx - hi; x <= cx + hi; x++) g.set(x, y, z, id);
      }
    }
    // the deck: teak inside, a white gunwale round the edge
    for (let z = P.z0; z <= P.z1; z++) {
      const h = this.hw(z);
      for (let x = cx - h; x <= cx + h; x++) {
        const edge = !this.inHull(x - 1, z) || !this.inHull(x + 1, z) || !this.inHull(x, z - 1) || !this.inHull(x, z + 1);
        g.set(x, F1, z, edge ? B.cruise_white : B.cruise_deck);
      }
    }
  }

  /** Portholes, the name, the anchors and the swim platform at the stern. */
  hullDetails() {
    const { g, P, B } = this;
    const { cx } = P;
    // the outermost hull cell of a row at (side s, z, y)
    const shell = (s, z, y) => {
      const h = hullAt(P, z, y);
      if (h < 0) return null;
      return cx + s * Math.floor(h + 0.3);
    };
    const flat = (s, z, y) => {
      const x = shell(s, z, y);
      return x !== null && shell(s, z - 1, y) === x && shell(s, z + 1, y) === x;
    };
    // the name in gold letters on the navy, near the bow on both sides (read from outside)
    const name = 'GLIMMER STAR';
    const nameLen = name.length * 4 - 1;
    const nameEnd = P.z1 - P.LB + 4; // just aft of where the bow starts to narrow
    const nameStart = nameEnd - nameLen;
    const letterAt = (s, z, y) => {
      // starboard reads toward -z (bow on her left), port reads toward +z
      const col = s > 0 ? nameEnd - z : z - nameStart;
      if (col < 0 || col >= nameLen) return false;
      const ch = name[Math.floor(col / 4)], cc = col % 4;
      if (cc === 3 || ch === ' ') return false;
      const rows = FONT[ch];
      const row = F1 - 5 - y; // y F1-5 is the top row
      return !!(rows && row >= 0 && row < 5 && rows[row][cc] === 'X');
    };
    for (const s of [-1, 1]) {
      for (let z = P.z0; z <= P.z1; z++) {
        for (let y = SEA + 1; y <= F1 - 1; y++) {
          const x = shell(s, z, y);
          if (x === null) continue;
          if (letterAt(s, z, y)) { g.set(x, y, z, B.gold_block); continue; }
          const inName = z >= nameStart - 2 && z <= nameEnd + 2;
          if (!flat(s, z, y)) continue;
          if (y === F1 - 2 && (z - P.z0) % 3 === 1) g.set(x, y, z, B.cruise_porthole);
          else if (y === SEA + 3 && !inName && (z - P.z0) % 4 === 2) g.set(x, y, z, B.cruise_porthole);
        }
      }
      // an anchor near the bow
      const az = nameEnd + 6;
      const ANCHOR = ['.X.', 'XXX', '.X.', '.X.', 'X.X', 'XXX'];
      for (let r = 0; r < ANCHOR.length; r++) {
        for (let c = 0; c < 3; c++) {
          if (ANCHOR[r][c] !== 'X') continue;
          const y = F1 - 5 - r, z = az + (s > 0 ? -c : c);
          const x = shell(s, z, y);
          if (x !== null) g.set(x, y, z, B.cruise_white);
        }
      }
    }
    // the stern: a swim platform at the waterline and steps cut down to it from the aft deck
    const zs = P.z0;
    for (let z = zs - 3; z <= zs + 1; z++) for (let x = cx - 4; x <= cx + 4; x++) g.set(x, SEA + 1, z, B.cruise_deck);
    for (let x = cx - 4; x <= cx + 4; x++) { g.set(x, SEA + 2, zs - 3, B.cruise_rail); }
    for (const x of [cx - 4, cx + 4]) for (let z = zs - 3; z <= zs - 1; z++) g.set(x, SEA + 2, z, B.cruise_rail);
    g.set(cx, SEA + 2, zs - 3, 0); // a gap to jump in
    for (let k = 1; k <= F1 - SEA - 1; k++) {
      const z = zs + 1 + k, top = SEA + 1 + k;
      for (let x = cx - 1; x <= cx + 1; x++) {
        for (let y = top + 1; y <= F1 + 3; y++) g.set(x, y, z, 0);
        g.set(x, top, z, B.cruise_deck);
      }
      for (const x of [cx - 2, cx + 2]) for (let y = SEA + 1; y <= top; y++) g.set(x, y, z, B.cruise_white);
    }
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = SEA + 2; y <= F1 + 3; y++) g.set(x, y, zs + 1, 0);
    this.marina = [cx, SEA + 2, zs - 1];
  }

  // ---------- superstructure ----------

  /** Walls (8-neighbour boundary of `inside`), floor and roof of one level of rooms. */
  box(inside, z0, z1, floorY, roofY, { wall, roofId }) {
    const { g, P } = this;
    for (let z = z0; z <= z1; z++) {
      const h = this.hw(z);
      if (h < 0) continue;
      for (let x = P.cx - h; x <= P.cx + h; x++) {
        if (!inside(x, z)) continue;
        let edge = false;
        for (let dz = -1; dz <= 1 && !edge; dz++) for (let dx = -1; dx <= 1; dx++) if (!inside(x + dx, z + dz)) { edge = true; break; }
        for (let y = floorY + 1; y < roofY; y++) g.set(x, y, z, edge ? wall : 0);
        g.set(x, roofY, z, roofId);
      }
    }
  }

  levels() {
    const { P, B } = this;
    const deck = B.cruise_deck, white = B.cruise_white;
    this.box((x, z) => this.R1(x, z), P.zA0, P.zA1, F1, F2, { wall: white, roofId: deck });
    this.box((x, z) => this.R2(x, z), P.zB0, P.zB1, F2, F3, { wall: white, roofId: deck });
    this.box((x, z) => this.R3(x, z), P.zC0, P.zC1, F3, F4, { wall: white, roofId: deck });
    this.box((x, z) => this.RB(x, z), P.zBr0, P.zC1, F4, F5, { wall: white, roofId: white });
  }

  /** The side wall cells of a level at z: [x of port wall, x of starboard wall]. */
  sideWalls(inside, z) {
    const { P } = this;
    let lo = null, hi = null;
    const h = this.hw(z);
    for (let x = P.cx - h; x <= P.cx + h; x++) if (inside(x, z)) { if (lo === null) lo = x; hi = x; }
    return lo === null ? null : [lo, hi];
  }

  /** An opening in a wall (air), w wide centred on x, 2 or 3 high. */
  door(x, y, z, w = 3, h = 3, alongX = true) {
    const r = (w - 1) >> 1;
    for (let k = -r; k <= w - 1 - r; k++) for (let j = 0; j < h; j++) {
      if (alongX) this.g.set(x + k, y + j, z, 0); else this.g.set(x, y + j, z + k, 0);
    }
  }

  /** A partition wall across the level at z (full width inside), with a doorway in the middle. */
  partition(inside, z, y0, id, doorW = 3, doorXs = null) {
    const sw = this.sideWalls(inside, z);
    if (!sw) return;
    for (let x = sw[0] + 1; x < sw[1]; x++) for (let y = y0 + 1; y <= y0 + 4; y++) this.g.set(x, y, z, id);
    for (const dx of doorXs || [0]) this.door(this.P.cx + dx, y0 + 1, z, doorW, 3);
  }

  /** Floor blocks (at y) inside a level between z0..z1 (|dx| < the side walls). */
  floor(inside, z0, z1, y, id, filter = null) {
    for (let z = z0; z <= z1; z++) {
      const sw = this.sideWalls(inside, z);
      if (!sw) continue;
      for (let x = sw[0] + 1; x < sw[1]; x++) if (!filter || filter(x, z)) this.g.set(x, y, z, id);
    }
  }

  /** Window rows on the outer side walls of a level between z0..z1. */
  windows(inside, z0, z1, y, id, every = 1, phase = 0) {
    for (let z = z0; z <= z1; z++) {
      if (((z + phase) % every + every) % every !== 0) continue;
      const sw = this.sideWalls(inside, z);
      if (!sw) continue;
      for (const x of sw) {
        // only straight wall: the cells beside it along z are wall too
        if (!inside(x, z - 1) || !inside(x, z + 1)) continue;
        this.g.set(x, y, z, id);
      }
    }
  }

  // ---------- Promenade deck rooms: snack bar, cabins, forward lobby ----------

  promenadeRooms() {
    const { P, B } = this;
    const { cx } = P;
    const R1 = (x, z) => this.R1(x, z);
    const y = F1;
    // aft wall: the snack bar's doors onto the aft deck
    this.door(cx, y + 1, P.zA0, 3, 3);
    // snack bar
    const sb0 = P.zA0 + 1, sb1 = P.zA0 + 9;
    this.floor(R1, sb0, sb1, y, B.tile_kitchen);
    this.partition(R1, sb1 + 1, y, B.cruise_white);
    this.windows(R1, sb0, sb1, y + 2, B.cruise_window);
    this.windows(R1, sb0, sb1, y + 3, B.cruise_window);
    this.snackBar = { z0: sb0, z1: sb1 };
    this.furnishSnackBar(sb0, sb1);
    this.cabins = [];
    // cabins aft of the lobby, the lobby round the forward lift, more cabins, the bow lounge
    const lobby0 = P.zLift - 4, lobby1 = P.zLift + 5;
    const cEnd = this.cabinBlock(sb1 + 2, lobby0 - 2);
    this.cabinRange = { z0: sb1 + 2, z1: cEnd };
    this.partition(R1, lobby0 - 1, y, B.cruise_white);
    this.floor(R1, lobby0, lobby1, y, B.marble);
    this.windows(R1, lobby0, lobby1, y + 2, B.cruise_window);
    this.lobby = { z0: lobby0, z1: lobby1 };
    this.partition(R1, lobby1 + 1, y, B.cruise_white);
    let fEnd = lobby1 + 1;
    let lim = lobby1 + 2;
    while (lim + 5 <= P.zA1 - 8 && this.W(lim + 5) >= 10) lim += 5;
    if (lim - lobby1 - 2 >= 5) {
      fEnd = this.cabinBlock(lobby1 + 2, lim - 1);
      this.partition(R1, fEnd + 1, y, B.cruise_white);
      fEnd += 1;
    }
    this.bowLounge = { z0: fEnd + 1, z1: P.zA1 - 1 };
    this.floor(R1, fEnd + 1, P.zA1 - 1, y, B.wool_sky);
    this.windows(R1, fEnd + 1, P.zA1 - 1, y + 2, B.glass_blue);
    this.windows(R1, fEnd + 1, P.zA1 - 1, y + 3, B.glass_blue);
    this.door(cx, y + 1, P.zA1, 3, 3);
    this.furnishLobby();
    this.furnishBowLounge();
  }

  /** Cabins in 5-row steps both sides of a corridor from z0 to at most zMax; returns the last row. */
  cabinBlock(z0, zMax) {
    const { P, B, g } = this;
    const { cx } = P;
    const R1 = (x, z) => this.R1(x, z);
    const y = F1;
    const n = Math.max(1, Math.floor((zMax - z0 + 2) / 5));
    const cEnd = z0 + n * 5 - 2;
    this.floor(R1, z0, cEnd, y, B.planks_lavender, (x) => this.dx(x) <= 1);
    for (let z = z0; z <= cEnd; z++) for (const s of [-1, 1]) for (let yy = y + 1; yy <= y + 4; yy++) g.set(cx + s * 2, yy, z, B.cruise_white);
    for (let i = 0; i < n; i++) {
      const c0 = z0 + i * 5;
      if (i > 0) {
        // the wall between neighbours
        const sw = this.sideWalls(R1, c0 - 1);
        if (sw) for (let x = sw[0]; x <= sw[1]; x++) if (this.dx(x) >= 2) for (let yy = y + 1; yy <= y + 4; yy++) g.set(x, yy, c0 - 1, B.cruise_white);
      }
      const k = this.cabins.length;
      for (const s of [-1, 1]) this.cabin(s, c0, k + i);
    }
    return cEnd;
  }

  furnishSnackBar(z0, z1) {
    const { P } = this;
    const { cx } = P;
    const f = F1 + 1;
    const sw = this.sideWalls((x, z) => this.R1(x, z), z0 + 4);
    if (!sw) return;
    // the counter along the front wall, stools in front of it, tables down both sides
    for (let x = cx - 5; x <= cx + 5; x++) if (this.dx(x) > 1) this.furn('counter', x, f, z1, 2);
    for (let x = cx - 4; x <= cx + 4; x += 2) if (this.dx(x) > 1) this.furn('stool', x, f, z1 - 2, 0, COLORS.pink);
    this.furn('fridge', sw[0] + 1, f, z1, 2);
    this.furn('fridge', sw[1] - 1, f, z1, 2);
    for (const x of [sw[0] + 3, sw[1] - 3]) {
      this.furn('table_round', x, f, z0 + 3, 0);
      this.furn('chair', x - 1, f, z0 + 3, 1, COLORS.sun);
      this.furn('chair', x + 1, f, z0 + 3, 3, COLORS.mint);
    }
    this.furn('lamp_ceiling', cx, F1 + 4, z0 + 4, 0);
  }

  furnishLobby() {
    const { P, B, g } = this;
    const { cx } = P;
    const f = F1 + 1;
    const L = this.lobby;
    const sw = this.sideWalls((x, z) => this.R1(x, z), L.z0 + 4);
    if (!sw) return;
    // a little fountain on each side of the lift, sofas and plants, the guest desk forward
    for (const s of [-1, 1]) {
      const fx = cx + s * 6, fz = P.zLift;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) g.set(fx + dx, f, fz + dz, dx || dz ? B.quartz : B.water);
      g.set(fx, F1, fz, B.sea_lantern);
      this.furn('plant_pot', sw[s < 0 ? 0 : 1] - s, f, L.z0, 0);
      this.furn('sofa', cx + s * 4, f, L.z0 + 1, 0, COLORS.lilac);
    }
    for (let x = cx - 3; x <= cx + 3; x++) if (this.dx(x) >= 2) this.furn('counter', x, f, L.z1, 2);
    this.furn('piano', sw[0] + 2, f, L.z1 - 2, 1);
    this.furn('lamp_ceiling', cx - 3, F1 + 4, P.zLift, 0);
    this.furn('lamp_ceiling', cx + 3, F1 + 4, P.zLift, 0);
  }

  furnishBowLounge() {
    const { P } = this;
    const { cx } = P;
    const f = F1 + 1;
    const L = this.bowLounge;
    if (L.z1 - L.z0 < 3) return;
    // beanbags and armchairs looking out of the windows over the bow
    for (let z = L.z0 + 1; z <= L.z1 - 2; z += 3) {
      const sw = this.sideWalls((x, zz) => this.R1(x, zz), z);
      if (!sw) continue;
      for (const [s, rot, color] of [[-1, 3, COLORS.sky], [1, 1, COLORS.pink]]) {
        for (let k = 1; k <= 3; k++) {
          const x = s < 0 ? sw[0] + k : sw[1] - k;
          if (this.ok([[x, f, z]])) { this.furn('armchair', x, f, z, rot, color); break; }
        }
      }
    }
    this.furn('beanbag', cx - 1, f, L.z1 - 1, 0, COLORS.sun);
    this.furn('beanbag', cx + 1, f, L.z1 - 1, 0, COLORS.mint);
    this.furn('coffee_table', cx, f, L.z0 + 2, 0);
    this.furn('lamp_ceiling', cx, F1 + 4, L.z0 + 2 + 2, 0);
  }

  /** One cabin on side s (-1 port, 1 starboard): z0..z0+3 inside, the door from the corridor. */
  cabin(s, z0, i) {
    const { P, B, g } = this;
    const { cx } = P;
    const y = F1;
    // the outer wall: the innermost of the hull-side walls along the cabin (the bow narrows)
    let outer = null;
    for (let z = z0; z <= z0 + 3; z++) {
      const sw = this.sideWalls((x, zz) => this.R1(x, zz), z);
      if (!sw) return;
      const o = s < 0 ? sw[0] : sw[1];
      outer = outer === null ? o : s < 0 ? Math.max(outer, o) : Math.min(outer, o);
    }
    const inner = cx + s * 2;
    // square the cabin off: wall up the pockets between the hull side and the outer wall
    for (let z = z0; z <= z0 + 3; z++) {
      for (let x = outer + s; this.R1(x, z); x += s) for (let yy = y + 1; yy <= y + 4; yy++) g.set(x, yy, z, B.cruise_white);
      g.set(outer, y + 1, z, B.cruise_white); g.set(outer, y + 2, z, B.cruise_white);
      g.set(outer, y + 3, z, B.cruise_white); g.set(outer, y + 4, z, B.cruise_white);
    }
    const floorId = B[CABIN_FLOORS[(i * 2 + (s > 0 ? 1 : 0)) % CABIN_FLOORS.length]];
    for (let z = z0; z <= z0 + 3; z++) for (let x = Math.min(outer, inner) + 1; x < Math.max(outer, inner); x++) g.set(x, y, z, floorId);
    // portholes in the outer wall, a door from the corridor
    g.set(outer, y + 2, z0 + 1, B.cruise_porthole);
    g.set(outer, y + 2, z0 + 2, B.cruise_porthole);
    g.set(inner, y + 1, z0 + 1, 0);
    g.set(inner, y + 2, z0 + 1, 0);
    const rotIn = s < 0 ? 1 : 3; // front toward the corridor (+X on the port side)
    const rotOut = s < 0 ? 3 : 1;
    this.furn(i % 2 ? 'door' : 'door_pink', inner, y + 1, z0 + 1, rotIn);
    // a bed and a bunk bed with their heads to the hull, a nightstand between them
    const head = outer - s, foot = outer - 2 * s;
    this.furn('bed_single', foot, y + 1, z0, rotIn, COLORS.pink);
    this.furn('nightstand', head, y + 1, z0 + 1, rotIn);
    this.furn('bed_bunk', foot, y + 1, z0 + 2, rotIn, COLORS.sky);
    // a wardrobe and a toy chest by the corridor, an armchair by the porthole
    const w = s < 0 ? inner - 1 : inner + 2; // the wardrobe's anchor (it covers anchor-1..anchor)
    this.furn('wardrobe', w, y + 1, z0 + 3, 2);
    this.furn(i % 3 === 0 ? 'toy_chest' : 'beanbag', inner - s, y + 1, z0, rotOut === 1 ? 3 : 1);
    if (i % 2 === 0) this.furn('armchair', outer - 3 * s, y + 1, z0 + 3, 2);
    this.cabins.push({ s, z0, x: outer - 4 * s });
    void rotOut;
  }

  // ---------- Fun deck rooms ----------

  funRooms() {
    const { P, B, g } = this;
    const { cx, zT } = P;
    const R2 = (x, z) => this.R2(x, z);
    const y = F2;
    this.door(cx, y + 1, P.zB0, 3, 3);
    this.door(cx, y + 1, P.zB1, 3, 3);
    // lit windows down both sides
    this.windows(R2, P.zB0 + 1, P.zB1 - 1, y + 2, B.cruise_window, 4, 1);
    this.windows(R2, P.zB0 + 1, P.zB1 - 1, y + 2, B.cruise_window, 4, 2);
    this.windows(R2, P.zB0 + 1, P.zB1 - 1, y + 3, B.cruise_window, 4, 1);
    this.windows(R2, P.zB0 + 1, P.zB1 - 1, y + 3, B.cruise_window, 4, 2);
    const rooms = [];
    const add = (name, z0, z1, floorId) => { rooms.push({ name, z0, z1 }); this.floor(R2, z0, z1, y, floorId); };
    // kids' club (aft), bubble hall (under the pools), arcade
    add('kids', P.zB0 + 1, zT + 3, B.wool_lime);
    // the bubble hall goes round the big pool's glass tank: its doors are in the side aisles
    this.partition(R2, zT + 4, y, B.cruise_white, 2, [-9, 8]);
    add('bubble', zT + 5, zT + 20, B.cruise_pool);
    this.partition(R2, zT + 21, y, B.cruise_white, 2, [-9, 8]);
    add('arcade', zT + 22, zT + 33, B.wool_purple);
    this.partition(R2, zT + 34, y, B.cruise_white);
    // the forward rooms: sweet street round the lift, the theater at the front
    const sw0 = P.zLift - 5, sw1 = P.zLift + 6;
    // the middle: art studio (and more rooms on a big ship)
    const mid0 = zT + 35, mid1 = sw0 - 2;
    const midRooms = ['art', 'music', 'toys', 'art2'];
    const nMid = Math.max(1, Math.min(midRooms.length, Math.floor((mid1 - mid0 + 2) / 12)));
    const step = Math.floor((mid1 - mid0 + 2) / nMid);
    for (let k = 0; k < nMid; k++) {
      const z0 = mid0 + k * step, z1 = k === nMid - 1 ? mid1 : z0 + step - 2;
      add(midRooms[k], z0, z1, [B.wool_yellow, B.wool_sky, B.wool_pink, B.wool_cyan][k]);
      this.partition(R2, z1 + 1, y, B.cruise_white);
    }
    add('sweets', sw0, sw1, B.tile_pink);
    this.partition(R2, sw1 + 1, y, B.cruise_white);
    add('theater', sw1 + 2, P.zB1 - 1, B.wool_red);
    this.funRoomList = rooms;
    for (const r of rooms) this.furnishFun(r);
  }

  furnishFun(r) {
    const { P, B, g } = this;
    const { cx } = P;
    const y = F2 + 1;
    const R2 = (x, z) => this.R2(x, z);
    const sw = this.sideWalls(R2, Math.round((r.z0 + r.z1) / 2));
    if (!sw) return;
    const xl = sw[0] + 1, xr = sw[1] - 1; // inside x range
    const mid = Math.round((r.z0 + r.z1) / 2);
    if (r.name === 'kids') {
      this.furn('trampoline', xl + 1, y, r.z0 + 2, 0, COLORS.pink);
      this.furn('slide', xr, y, r.z0 + 3, 0, COLORS.sun);
      this.furn('dollhouse', xl + 1, y, r.z1, 0, COLORS.pink);
      this.furn('toy_chest', xl, y, mid, 1, COLORS.mint);
      this.furn('teddy_bear', xl + 4, y, r.z1, 2, null);
      this.furn('beanbag', xr - 2, y, r.z1, 2, COLORS.lilac);
      this.furn('beanbag', xr - 3, y, r.z1 - 1, 2, COLORS.peach);
      this.furn('balloon_bunch', xr, y, r.z1, 0);
      this.furn('easel', xr, y, mid - 1, 3);
      this.furn('toy_chest', xr, y, mid + 1, 3, COLORS.sky);
    } else if (r.name === 'bubble') {
      // beanbags in the side aisles looking into the pool through the glass, lights in the floor
      for (let z = r.z0 + 2; z <= r.z1 - 2; z += 4) {
        this.furn('beanbag', cx - 7, y, z, 1, COLORS.sky);
        this.furn('beanbag', cx + 7, y, z, 3, COLORS.mint);
        g.set(cx - 10, F2, z + 1, B.sea_lantern);
        g.set(cx + 10, F2, z + 1, B.sea_lantern);
      }
    } else if (r.name === 'arcade') {
      // three cabinets along each side wall, glowing floor lights between
      const zs = [r.z0 + 2, mid, r.z1 - 2];
      zs.forEach((z, k) => this.feat('cruise:arcade', k % 2 ? xr : xl, y, z, k % 2 ? 3 : 1));
      for (let z = r.z0 + 1; z <= r.z1 - 1; z += 3) { g.set(cx - 3, F2, z, B.cruise_dance); g.set(cx + 3, F2, z, B.cruise_dance); }
      this.furn('beanbag', xr, y, r.z0 + 4, 3, COLORS.pink);
      this.furn('beanbag', xl, y, r.z1 - 4, 1, COLORS.mint);
      this.furn('lamp_ceiling', cx, F2 + 4, mid, 0);
    } else if (r.name === 'art' || r.name === 'art2') {
      for (let k = 0; k < 3; k++) this.furn('easel', xl + 1 + k * 2, y, r.z0 + 1, 0);
      this.furn('desk', xr, y, mid, 3);
      this.furn('chair', xr - 1, y, mid, 1, COLORS.sun);
      this.furn('bookshelf_tall', xl + 1, y, r.z1, 0);
      this.furn('table_round', xl + 2, y, mid, 0);
      this.furn('stool', xl + 1, y, mid, 1, COLORS.pink);
      this.furn('stool', xl + 3, y, mid, 3, COLORS.mint);
    } else if (r.name === 'music') {
      this.furn('piano', xl + 1, y, mid, 1);
      this.furn('armchair', xr, y, mid, 3, COLORS.lilac);
      for (let z = r.z0 + 1; z <= r.z1 - 1; z += 2) g.set(xr, F2, z, B.music_block);
    } else if (r.name === 'toys') {
      this.furn('dollhouse', xl + 1, y, r.z0 + 1, 0);
      this.furn('trampoline', xr - 1, y, mid, 0, COLORS.mint);
      this.furn('teddy_bear', xl, y, mid, 1);
    } else if (r.name === 'sweets') {
      // the candy shop and the ice-cream parlor face the aisle (the lift is in the aisle)
      this.furn('candy_shop', xl + 1, y, mid - 1, 1);
      this.furn('ice_cream_parlor', xr - 1, y, mid - 1, 3);
      for (const z of [r.z0 + 1, r.z1 - 1]) {
        this.furn('table_round', cx - 3, y, z, 0);
        this.furn('chair', cx - 4, y, z, 1, COLORS.pink);
        this.furn('table_round', cx + 3, y, z, 0);
        this.furn('chair', cx + 4, y, z, 3, COLORS.mint);
      }
    } else if (r.name === 'theater') {
      // a stage at the front with a piano and the curtains, rows of seats facing it
      const st = r.z1 - 2;
      for (let z = st; z <= r.z1; z++) for (let x = xl; x <= xr; x++) g.set(x, F2 + 1, z, B.planks_pink);
      for (let x = xl; x <= xr; x++) for (let yy = F2 + 2; yy <= F2 + 4; yy++) {
        if (Math.abs(x - cx) > 4) g.set(x, yy, r.z1, B.wool_red);
      }
      this.furn('piano', cx - 3, F2 + 2, st + 1, 2);
      this.furn('tv', cx + 1, F2 + 2, r.z1, 2);
      for (let row = 0; row < 4; row++) {
        const z = st - 3 - row * 2;
        if (z <= r.z0 + 1) break;
        const rw = this.sideWalls(R2, z);
        if (!rw) continue;
        // benches (two seats each) either side of the middle aisle, facing the stage
        for (const s of [-1, 1]) {
          for (let k = 0; k < 4; k++) {
            const x = s < 0 ? cx - 3 - k * 3 : cx + 2 + k * 3;
            if (x - 1 <= rw[0] + 1 || x + 2 >= rw[1] - 1) break;
            this.furn('bench', x, y, z, 0, row % 2 ? COLORS.pink : COLORS.lilac);
          }
        }
      }
      for (let z = r.z0; z <= st - 1; z += 4) { g.set(xl - 1, F2 + 3, z, B.lantern); g.set(xr + 1, F2 + 3, z, B.lantern); }
    }
    void B;
  }

  // ---------- Pool deck rooms (under the sports deck): sunset lounge and cafe ----------

  loungeRooms() {
    const { P, B, g } = this;
    const { cx } = P;
    const R3 = (x, z) => this.R3(x, z);
    const y = F3;
    this.door(cx, y + 1, P.zC0, 3, 3);
    this.door(cx, y + 1, P.zC1, 3, 3);
    // big panoramic windows: glass with white posts
    for (let z = P.zC0; z <= P.zC1; z++) {
      const sw = this.sideWalls(R3, z);
      if (!sw) continue;
      for (const x of sw) {
        if (!R3(x, z - 1) || !R3(x, z + 1)) continue;
        if ((z - P.zC0) % 4 === 0) continue;
        g.set(x, y + 2, z, B.glass_blue);
        g.set(x, y + 3, z, B.glass_blue);
      }
    }
    // the aft wall looks out over the pool deck
    const swA = this.sideWalls(R3, P.zC0);
    if (swA) for (let x = swA[0] + 1; x < swA[1]; x++) if (this.dx(x) > 2 && this.dx(x) % 4 !== 0) { g.set(x, y + 2, P.zC0, B.glass_blue); g.set(x, y + 3, P.zC0, B.glass_blue); }
    const lz0 = P.zC0 + 1, lz1 = P.zLift - 3;
    this.floor(R3, lz0, lz1, y, B.wool_pink);
    this.partition(R3, lz1 + 1, y, B.cruise_white);
    this.floor(R3, lz1 + 2, P.zC1 - 1, y, B.tile_kitchen);
    this.lounge = { z0: lz0, z1: lz1 };
    this.cafe = { z0: lz1 + 2, z1: P.zC1 - 1 };
    const sw = this.sideWalls(R3, lz0 + 3);
    if (!sw) return;
    const xl = sw[0] + 1, xr = sw[1] - 1, f = y + 1;
    // sunset lounge: sofas round coffee tables, a piano, plants and floor lamps
    this.furn('sofa', xl + 2, f, lz0 + 3, 1, COLORS.lilac);
    this.furn('coffee_table', xl + 3, f, lz0 + 3, 1);
    this.furn('armchair', xl + 5, f, lz0 + 3, 3, COLORS.pink);
    this.furn('sofa', xr - 1, f, lz0 + 3, 3, COLORS.mint);
    this.furn('armchair', xr - 4, f, lz0 + 3, 1, COLORS.sky);
    this.furn('piano', cx + 4, f, lz1, 2);
    this.furn('plant_pot', xl, f, lz0, 0);
    this.furn('plant_pot', xr, f, lz0, 0);
    this.furn('floor_lamp', xl, f, lz1, 0);
    this.furn('floor_lamp', xr, f, lz1, 0);
    this.furn('bookshelf_tall', xl + 3, f, lz1, 2);
    // cafe: counters along the front, tables and chairs
    const c = this.cafe;
    for (let x = cx - 4; x <= cx + 4; x++) if (this.dx(x) > 1) this.furn('counter', x, f, c.z1, 2);
    this.furn('fridge', cx + 6, f, c.z1, 2);
    for (let z = c.z0 + 1; z <= c.z1 - 3; z += 3) {
      for (const xx of [cx - 6, cx + 6]) {
        this.furn('table_round', xx, f, z, 0);
        this.furn('chair', xx - 1, f, z, 1, COLORS.peach);
        this.furn('chair', xx + 1, f, z, 3, COLORS.sun);
      }
    }
  }

  // ---------- the bridge ----------

  bridge() {
    const { P, B, g } = this;
    const { cx } = P;
    const RB = (x, z) => this.RB(x, z);
    const y = F4;
    this.floor(RB, P.zBr0 + 1, P.zC1 - 1, y, B.wool_blue);
    this.door(cx, y + 1, P.zBr0, 3, 3);
    // big windows all round the front and sides
    for (let z = P.zBr0 + 1; z <= P.zC1; z++) {
      const h = this.hw(z);
      for (let x = cx - h; x <= cx + h; x++) {
        if (!RB(x, z)) continue;
        const edge = !RB(x - 1, z) || !RB(x + 1, z) || !RB(x, z + 1);
        if (!edge) continue;
        g.set(x, y + 2, z, B.glass_blue);
        g.set(x, y + 3, z, B.glass_blue);
      }
    }
    // bridge wings stick out over the sides
    for (let z = P.zBr0 + 1; z <= P.zBr0 + 3; z++) {
      const sw = this.sideWalls(RB, z);
      if (!sw) continue;
      const h = this.hw(z);
      for (const s of [-1, 1]) {
        const xw = s < 0 ? sw[0] : sw[1];
        for (let x = xw + s; Math.abs(x - cx) <= h - 1; x += s) {
          g.set(x, y, z, B.cruise_white);
          const rim = Math.abs(x - cx) === h - 1 || z === P.zBr0 + 1 || z === P.zBr0 + 3;
          if (rim) { g.set(x, y + 1, z, B.cruise_rail); g.set(x, y + 2, z, B.slab_quartz); }
        }
        // a door from the bridge onto each wing
        g.set(xw, y + 1, P.zBr0 + 2, 0);
        g.set(xw, y + 2, P.zBr0 + 2, 0);
        g.set(xw, y + 3, P.zBr0 + 2, B.glass_blue);
      }
    }
    const f = y + 1;
    this.wheelAt = [cx, f, P.zC1 - 2];
    this.feat('cruise:wheel', cx, f, P.zC1 - 2, 2);
    // the captain stands behind the wheel, looking over the bow
    this.reserve(cx, f, P.zC1 - 3); this.reserve(cx, f + 1, P.zC1 - 3);
    for (const s of [-1, 1]) {
      for (let k = 2; k <= 4; k++) this.furn('counter', cx + s * k, f, P.zC1 - 1, 2);
      this.furn('armchair', cx + s * 3, f, P.zC1 - 3, 0, COLORS.sky);
    }
    this.furn('table_round', cx - 5, f, P.zBr0 + 2, 0);
  }

  // ---------- pools ----------

  pools() {
    const { P, B, g } = this;
    const { cx, zT } = P;
    // the big pool, deep enough for sea forms; glass walls look into it from the bubble hall
    const pz0 = zT + 6, pz1 = zT + 19, pr = 5;
    this.mainPool = { x0: cx - pr, x1: cx + pr, z0: pz0, z1: pz1, y: F3 };
    for (let z = pz0 - 1; z <= pz1 + 1; z++) {
      for (let x = cx - pr - 1; x <= cx + pr + 1; x++) {
        const wall = z < pz0 || z > pz1 || this.dx(x) > pr;
        for (let yy = F3 - 4; yy <= F3; yy++) {
          let id;
          if (yy === F3 - 4) id = B.cruise_pool;
          else if (wall) id = yy === F3 ? B.quartz : (yy === F3 - 2 || yy === F3 - 3) && this.dx(x) === pr + 1 && z % 3 !== 0 ? B.glass_blue : B.cruise_pool;
          else id = B.water;
          g.set(x, yy, z, id);
        }
      }
    }
    for (const [x, z] of [[cx - pr - 1, pz0 - 1], [cx + pr + 1, pz0 - 1], [cx - pr - 1, pz1 + 1], [cx + pr + 1, pz1 + 1]]) g.set(x, F3, z, B.sea_lantern);
    for (let z = pz0 + 2; z <= pz1 - 2; z += 4) { g.set(cx - pr - 1, F3 - 1, z, B.sea_lantern); g.set(cx + pr + 1, F3 - 1, z, B.sea_lantern); }
    // the splash pool (two deep) on the port side
    const sx0 = cx - 11, sx1 = cx - 8, sz0 = zT + 8, sz1 = zT + 17;
    this.splashPool = { x0: sx0, x1: sx1, z0: sz0, z1: sz1, y: F3 };
    for (let z = sz0 - 1; z <= sz1 + 1; z++) {
      for (let x = sx0 - 1; x <= sx1 + 1; x++) {
        const wall = z < sz0 || z > sz1 || x < sx0 || x > sx1;
        for (let yy = F3 - 2; yy <= F3; yy++) {
          const id = yy === F3 - 2 ? B.cruise_pool : wall ? (yy === F3 ? B.quartz : B.cruise_pool) : B.water;
          g.set(x, yy, z, id);
        }
      }
    }
    g.set(sx0 - 1, F3, sz0 - 1, B.sea_lantern); g.set(sx1 + 1, F3, sz1 + 1, B.sea_lantern);
    // two round hot tubs on the starboard side, raised one block, lit from below
    this.tubs = [];
    for (const tz of [zT + 17, zT + 23]) {
      const tx = cx + 9;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > 3.2) continue;
        const x = tx + dx, z = tz + dz;
        g.set(x, F3, z, d < 0.5 ? B.sea_lantern : B.cruise_pool);
        g.set(x, F3 + 1, z, d > 2.2 ? B.cruise_pool : B.water);
      }
      this.tubs.push([tx, tz]);
    }
  }

  // ---------- funnels ----------

  funnels() {
    const { P, B, g } = this;
    const { cx } = P;
    this.funnelZ = [P.zC0 + 9, P.zC0 + 20];
    const top = F4 + 13;
    for (const fz of this.funnelZ) {
      for (let y = F4 + 1; y <= top; y++) {
        const shift = (y - F4) / 8; // a gentle rake toward the stern
        const t = y - F4;
        const id = t >= 12 ? B.cruise_hull : t >= 8 && t <= 10 ? B.concrete_pink : B.cruise_white;
        for (let z = fz - 5; z <= fz + 5; z++) {
          for (let x = cx - 3; x <= cx + 3; x++) {
            const e = ((x - cx) / 2.7) ** 2 + ((z - fz + shift) / 3.7) ** 2;
            if (e > 1) continue;
            // the star emblem on both sides in the middle of the pink band
            const side = Math.abs(x - cx) === 2 && Math.abs(z - Math.round(fz - shift)) <= 0;
            g.set(x, y, z, t === 9 && side ? B.cruise_emblem : id);
          }
        }
      }
      // a soft puff of cloud drifts above each funnel
      puffCloud(g, cx, top + 3, fz - 2, B.cloud);
      g.gem(cx, top + 1, fz, 'funnel');
    }
    // the big outdoor screen on the aft funnel, facing the pool deck, on a white base
    const sz = P.zC0 + 4;
    for (let x = cx - 4; x <= cx + 4; x++) { g.set(x, F4 + 1, sz, B.cruise_white); g.set(x, F4 + 2, sz, B.cruise_white); }
    for (let x = cx - 4; x <= cx + 4; x++) for (let yy = F4 + 3; yy <= F4 + 7; yy++) g.set(x, yy, sz, 0);
    this.feat('cruise:movie', cx, F4 + 3, sz, 2, { w: 9, h: 5 }, footprint([9, 5, 1], cx, F4 + 3, sz, 2));
  }

  // ---------- sports deck: track, mini golf, game court ----------

  sportsDeck() {
    const { P, B, g } = this;
    const { cx } = P;
    const z0 = P.zC0, zEnd = P.zBr0 - 1;
    // running track: a loop round both funnels
    const tz0 = z0 + 1, tz1 = this.funnelZ[1] + 6;
    for (let z = tz0; z <= tz1; z++) {
      for (let x = cx - 6; x <= cx + 6; x++) {
        const inner = this.dx(x) <= 4 && z >= tz0 + 2 && z <= tz1 - 2;
        if (inner) continue;
        const lane = this.dx(x) >= 6 || z === tz0 || z === tz1;
        g.set(x, F4, z, lane ? B.concrete_pink : B.concrete_peach);
      }
    }
    // a white start line on the starboard straight
    const sl = Math.round((tz0 + tz1) / 2);
    g.set(cx + 5, F4, sl, B.wool_white); g.set(cx + 6, F4, sl, B.wool_white);
    g.set(cx - 5, F4, sl, B.wool_white); g.set(cx - 6, F4, sl, B.wool_white);
    this.track = { z0: tz0, z1: tz1 };
    // mini golf on the port strip: holes of 6 x 6 with low white borders
    const gx0 = cx - 12, gx1 = cx - 7;
    const holes = [];
    const nHoles = Math.max(4, Math.min(6, Math.floor((zEnd - z0 - 2) / 6)));
    for (let k = 0; k < nHoles; k++) {
      const hz0 = z0 + 2 + k * 6, hz1 = hz0 + 5;
      if (hz1 > zEnd) break;
      for (let z = hz0; z <= hz1; z++) {
        for (let x = gx0; x <= gx1; x++) {
          const border = x === gx0 || x === gx1 || z === hz0 || z === hz1;
          g.set(x, F4, z, B.grass);
          if (border) g.set(x, F4 + 1, z, k % 2 ? B.slab_pink : B.slab_white);
        }
      }
      // the way from one hole to the next
      g.set(gx0 + 2, F4 + 1, hz1, 0);
      g.set(gx0 + 2, F4 + 1, hz0, 0);
      const tee = k % 2 ? [gx1 - 1, F4 + 1, hz0 + 1] : [gx0 + 1, F4 + 1, hz0 + 1];
      const cup = k % 2 ? [gx0 + 1, F4 + 1, hz1 - 1] : [gx1 - 1, F4 + 1, hz1 - 1];
      // a little obstacle in the middle of every other hole
      if (k % 2 === 1) g.set(gx0 + 3, F4 + 1, hz0 + 3, B.hedge_flowers);
      if (k === 2) { g.set(gx0 + 2, F4 + 1, hz0 + 2, B.wool_white); g.set(gx0 + 2, F4 + 2, hz0 + 2, B.wool_red); g.set(gx0 + 2, F4 + 3, hz0 + 2, B.lantern); }
      g.set(cup[0], F4, cup[2], B.wool_white);
      holes.push({ tee, cup, par: k === 2 || k === 4 ? 3 : 2 });
    }
    this.golf = { x: cx - 9, z: z0 + 1, holes };
    // game court on the starboard strip: hoops, ring toss, shuffleboard
    const cx0 = cx + 7, cx1 = cx + 12;
    for (let z = z0 + 1; z <= zEnd; z++) {
      for (let x = cx0; x <= cx1; x++) {
        const line = x === cx0 || x === cx1;
        g.set(x, F4, z, line ? B.wool_white : B.concrete_sky);
      }
    }
    for (let x = cx0; x <= cx1; x++) { g.set(x, F4, z0 + 12, B.wool_white); g.set(x, F4, z0 + 21, B.wool_white); }
    // the shuffleboard lane's scoring triangle at the far end
    for (let z = z0 + 30; z <= Math.min(zEnd, z0 + 33); z++) for (let x = cx0 + 1; x <= cx1 - 1; x++) g.set(x, F4, z, (z + x) % 2 ? B.wool_yellow : B.wool_pink);
    this.court = { x0: cx0, x1: cx1 };
  }

  // ---------- railings ----------

  /** Glass railing (a quartz handrail on top) round every open deck edge. */
  railings() {
    const { g, P, B } = this;
    const decks = [
      [F1, (x, z) => this.inHull(x, z), (x, z) => this.R1(x, z)],
      [F2, (x, z) => this.R1(x, z), (x, z) => this.R2(x, z)],
      [F3, (x, z) => this.R2(x, z), (x, z) => this.R3(x, z)],
      [F4, (x, z) => this.R3(x, z), (x, z) => this.RB(x, z)],
      [F5, (x, z) => this.RB(x, z), () => false],
    ];
    for (const [fy, floor, covered] of decks) {
      let n = 0;
      for (let z = P.z0; z <= P.z1; z++) {
        const h = this.hw(z);
        for (let x = P.cx - h; x <= P.cx + h; x++) {
          if (!floor(x, z) || covered(x, z)) continue;
          if (floor(x - 1, z) && floor(x + 1, z) && floor(x, z - 1) && floor(x, z + 1)) continue;
          if (g.get(x, fy + 1, z) !== 0) continue;
          // a lantern on a post every so often, so the decks glow at night
          const post = (n++ % 9) === 4;
          g.set(x, fy + 1, z, B.cruise_rail);
          g.setAir(x, fy + 2, z, post ? B.lantern : B.slab_quartz);
        }
      }
    }
  }

  // ---------- stairs ----------

  /** A straight flight 3 wide (x0..x0+2) rising toward +z from floor y0 to y0 + 5 at z0..z0+4. */
  flight(x0, y0, z0) {
    const { g, B } = this;
    for (let k = 1; k <= 5; k++) {
      const z = z0 + k - 1;
      for (let x = x0; x <= x0 + 2; x++) {
        for (let y = y0 + 1; y <= y0 + k; y++) g.set(x, y, z, y === y0 + k ? B.cruise_deck : B.cruise_white);
        for (let y = y0 + k + 1; y <= y0 + k + 3; y++) g.set(x, y, z, 0);
      }
    }
    // the landing at the top: open the railing there
    for (let x = x0; x <= x0 + 2; x++) for (let y = y0 + 6; y <= y0 + 8; y++) g.set(x, y, z0 + 5, 0);
  }

  stairs() {
    const { P } = this;
    const { cx } = P;
    // the grand staircases at the stern, port and starboard: aft deck -> fun deck -> pool deck
    for (const s of [-1, 1]) {
      const W = this.W(P.zA0);
      const x0 = s < 0 ? cx - W + 1 : cx + W - 3;
      this.flight(x0, F1, P.zA0 - 5);
      this.flight(x0, F2, P.zA0 + 1);
      // pool deck -> sports deck, at the forward end of the pool deck
      const W3 = this.W(P.zC0, 6);
      const x3 = s < 0 ? cx - W3 + 1 : cx + W3 - 3;
      this.flight(x3, F3, P.zC0 - 5);
    }
  }

  // ---------- the slide tower ----------

  slideTower() {
    const { P, B, g } = this;
    const { cx, zT } = P;
    // a solid core, a spiral stair round it and a round platform on top
    for (let y = F3 + 1; y < FT; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) g.set(cx + dx, y, zT + dz, (y - F3) % 4 === 0 ? B.concrete_pink : B.cruise_white);
    const ring = [];
    for (let k = -1; k >= -2; k--) ring.push([k, 2]);
    for (let k = 1; k >= -2; k--) ring.push([-2, k]);
    for (let k = -1; k <= 2; k++) ring.push([k, -2]);
    for (let k = -1; k <= 2; k++) ring.push([2, k]);
    for (let k = 1; k >= 0; k--) ring.push([k, 2]);
    const steps = FT - F3;
    for (let i = 0; i < steps; i++) {
      const [dx, dz] = ring[i];
      for (let y = F3 + 1; y <= F3 + 1 + i; y++) g.set(cx + dx, y, zT + dz, y === F3 + 1 + i ? (i % 2 ? B.planks_pink : B.planks_white) : B.cruise_white);
    }
    const holes = new Set([steps - 3, steps - 2].map((i) => ring[i].join()));
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (Math.hypot(dx, dz) > 3.5 || holes.has(`${dx},${dz}`)) continue;
        g.set(cx + dx, FT, zT + dz, Math.hypot(dx, dz) < 1.5 ? B.cruise_emblem : B.cruise_deck);
      }
    }
    // a striped canopy over the middle of the platform, on four posts
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) for (let y = FT + 1; y <= FT + 3; y++) g.set(cx + dx, y, zT + dz, B.cruise_white);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) g.set(cx + dx, FT + 4, zT + dz, (dx + 2) % 2 ? B.wool_pink : B.wool_white);
    g.set(cx, FT + 5, zT, B.star_block);
    this.towerTop = [cx + 1, FT + 1, zT - 1];
    g.gem(cx - 1, FT + 1, zT + 1, 'tower');
  }

  // ---------- the water slides ----------

  slides() {
    const { P, B } = this;
    const { cx, zT } = P;
    const top = FT + 1;
    // Twister: west off the platform, round the back of the tower and down its starboard side
    // into the big pool (three quarters of a turn)
    const twister = this.slideRoute([cx - 3, zT], [[cx - 6, zT], [cx - 6, zT - 5], [cx + 5, zT - 5], [cx + 5, zT + 7]],
      [[0, top], [2, top], [1, F3 + 1]]);
    // Big Dipper: straight out to starboard, high, then a steep dip toward the bow and a swoop
    // back into the pool
    const dipper = this.slideRoute([cx + 3, zT + 1], [[cx + 12, zT + 1], [cx + 12, zT + 10], [cx + 5, zT + 10]],
      [[0, top], [9, top - 1], [18, F3 + 4], [1, F3 + 1]]);
    this.buildSlide(twister, B.cruise_slide, 'Twister', '#5FD3E6');
    this.buildSlide(dipper, B.cruise_slide_pink, 'Big Dipper', '#FF8DC0');
  }

  /**
   * A slide's path: the cells along axis-aligned runs from `start` through `turns` ([x, z]),
   * heights from `keys` ([index, y]; an index of 1 as the last key means "the last cell"),
   * never climbing and dropping at most one block a cell (so each step is <= 1.42 blocks),
   * then the splash cell in the water under the last one.
   */
  slideRoute(start, turns, keys) {
    const cells = [start.slice()];
    let [x, z] = start;
    for (const [tx, tz] of turns) {
      let guard = 0;
      while ((x !== tx || z !== tz) && guard++ < 200) {
        if (x !== tx) x += Math.sign(tx - x); else z += Math.sign(tz - z);
        cells.push([x, z]);
      }
    }
    const n = cells.length;
    const ks = keys.map(([i, y], k) => [k === keys.length - 1 ? n - 1 : i, y]);
    const yAt = (i) => {
      for (let k = 1; k < ks.length; k++) {
        const [i0, y0] = ks[k - 1], [i1, y1] = ks[k];
        if (i <= i1) return i1 === i0 ? y1 : y0 + ((y1 - y0) * (i - i0)) / (i1 - i0);
      }
      return ks[ks.length - 1][1];
    };
    const out = [];
    let y = Math.round(yAt(0));
    for (let i = 0; i < n; i++) {
      const want = Math.round(yAt(i));
      if (i > 0) y = Math.max(Math.min(y, want), y - 1);
      out.push([cells[i][0], y, cells[i][1]]);
    }
    // down to the water: straight down where the last cell is still high, then the splash cell
    const [lx, , lz] = out[out.length - 1];
    let ly = out[out.length - 1][1];
    let guard = 0;
    while (!this.water(lx, ly - 1, lz) && ly > SEA && guard++ < 20) out.push([lx, --ly, lz]);
    out.push([lx, ly - 1, lz]);
    return out.slice(0, 240);
  }

  /** Slide plastic under the path and lips along it, white posts under it, then the record. */
  buildSlide(path, id, name, color) {
    const { g, B } = this;
    const onPath = new Set();
    for (const [x, y, z] of path) for (let k = 0; k <= 2; k++) onPath.add(`${x},${y + k},${z}`);
    const keep = (x, y, z) => onPath.has(`${x},${y},${z}`);
    for (let i = 0; i < path.length; i++) {
      const [x, y, z] = path[i];
      if (this.water(x, y, z)) continue;
      // clear the rider's way (the slide may pass through a railing or the platform edge)
      for (let k = 0; k <= 1; k++) if (!this.water(x, y + k, z)) g.set(x, y + k, z, 0);
      if (i === 0) continue;
      const under = this.get(x, y - 1, z);
      if (!this.water(x, y - 1, z) && (!this.solid(x, y - 1, z) || under === B.cruise_rail || under === B.slab_quartz)) g.set(x, y - 1, z, id);
      if (this.water(x, y - 1, z)) continue;
      // low walls on both sides (both ways round a corner)
      const [px, , pz] = path[i - 1];
      const nx = path[i + 1] ? path[i + 1][0] : x, nz = path[i + 1] ? path[i + 1][2] : z;
      const sides = new Set();
      for (const [ax, az] of [[px, pz], [nx, nz]]) {
        if (ax !== x) { sides.add('0,1'); sides.add('0,-1'); }
        if (az !== z) { sides.add('1,0'); sides.add('-1,0'); }
      }
      for (const sd of sides) {
        const [lx, lz] = sd.split(',').map(Number);
        if (keep(x + lx, y, z + lz) || keep(x + lx, y - 1, z + lz)) continue;
        this.deco(x + lx, y, z + lz, id);
      }
      // white posts under the high parts, down to the deck
      if (i % 5 === 2 && y - 2 > F3) {
        let ok = true;
        for (let k = F3 + 1; k <= y - 2 && ok; k++) ok = this.free(x, k, z) && !keep(x, k, z);
        if (ok && this.solid(x, F3, z) && !this.water(x, F3, z)) for (let k = F3 + 1; k <= y - 2; k++) g.set(x, k, z, B.cruise_white);
      }
    }
    for (const [x, y, z] of path) for (let k = 0; k <= 1; k++) this.reserve(x, y + k, z);
    const [x0, y0, z0] = path[0], [x1, , z1] = path[1];
    const rot = x1 > x0 ? 1 : x1 < x0 ? 3 : z1 < z0 ? 2 : 0;
    this.features.push({ kind: 'cruise:slide', x: x0, y: y0, z: z0, rot, path: path.map((c) => c.slice()), name, color });
  }

  // ---------- the pool deck: dance floor, bandstand, loungers, the board ----------

  poolDeck() {
    const { P, B, g } = this;
    const { cx, zT } = P;
    const f = F3 + 1;
    // the light-up dance floor and its DJ booth
    const dz0 = zT + 24, dz1 = zT + 30;
    for (let z = dz0; z <= dz1; z++) for (let x = cx - 3; x <= cx + 3; x++) g.set(x, F3, z, B.cruise_dance);
    this.feat('cruise:dance', cx, f, dz0 - 1, 0, { x0: cx - 3, z0: dz0, x1: cx + 3, z1: dz1 });
    this.dance = { z0: dz0, z1: dz1 };
    // party flags over the dance floor, on two posts
    for (const s of [-1, 1]) for (let y = f; y <= f + 4; y++) g.set(cx + s * 4, y, dz1 + 1, B.cruise_white);
    for (let x = cx - 3; x <= cx + 3; x++) this.deco(x, f + 4, dz1 + 1, B.cruise_flags);
    // the bandstand: a pink stage with a piano on the port side
    const bx0 = cx - 12, bx1 = cx - 8, bz0 = zT + 22, bz1 = zT + 28;
    for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) g.set(x, f, z, (x + z) % 2 ? B.planks_pink : B.planks_white);
    for (const z of [bz0, bz1]) for (let y = f + 1; y <= f + 4; y++) g.set(bx0, y, z, B.cruise_white);
    for (let z = bz0; z <= bz1; z++) g.set(bx0, f + 5, z, (z % 2) ? B.wool_pink : B.wool_white);
    this.furn('piano', bx0 + 2, f + 1, bz0 + 2, 1);
    g.set(bx0 + 1, f + 1, bz1 - 1, B.music_block);
    g.set(bx0 + 1, f + 1, bz1 - 2, B.music_block);
    this.furn('lantern_post', bx1, f + 1, bz0, 0);
    this.furn('lantern_post', bx1, f + 1, bz1, 0);
    // loungers along the starboard rail beyond the tubs, and both sides of the plaza
    const plaza0 = dz1 + 2, plaza1 = P.zC0 - 6;
    for (let z = zT + 27; z <= plaza1; z += 2) {
      this.furn('cruise_lounger', cx + 10, f, z, 3, z % 4 ? COLORS.pink : COLORS.sky);
      if (z > bz1 + 1) this.furn('cruise_lounger', cx - 10, f, z, 1, z % 4 ? COLORS.sun : COLORS.mint);
    }
    for (let z = zT + 3; z <= zT + 9; z += 2) this.furn('cruise_lounger', cx + 10, f, z, 3, z % 4 ? COLORS.lilac : COLORS.peach);
    this.plaza(plaza0 + 1, P.zC0 - 8);
    // the What's-on board near the spawn, a bench and lamp posts
    const sz = Math.round(this.spawn[2] - 0.5);
    this.feat('cruise:board', cx + 3, f, sz - 2, 2);
    this.furn('bench', cx - 3, f, sz - 2, 2, COLORS.pink);
    for (const s of [-1, 1]) this.furn('lantern_post', cx + s * 6, f, plaza0, 0);
    this.reserve(cx, f, sz); this.reserve(cx, f + 1, sz);
    // pool floats
    const mp = this.mainPool;
    for (const [x, z] of [[mp.x0 + 1, mp.z0 + 6], [mp.x1 - 1, mp.z0 + 9], [mp.x0 + 2, mp.z1 - 2], [mp.x1 - 3, mp.z1 - 1]]) this.floatAt(x, F3, z);
    const sp = this.splashPool;
    this.floatAt(sp.x0 + 1, F3, sp.z0 + 2);
    this.floatAt(sp.x1 - 1, F3, sp.z1 - 3);
    // little palm planters along the rails
    for (let z = zT + 10; z <= plaza1; z += 8) {
      for (const s of [-1, 1]) {
        const x = cx + s * 12;
        if (this.free(x, f, z) && this.free(x, f + 1, z)) { g.set(x, f, z, B.hedge_flowers); }
      }
    }
  }

  /** The middle of a long pool deck (a big ship): a palm lawn, a kiddie pool, another lawn... */
  plaza(z0, z1) {
    const { P, B, g } = this;
    const { cx } = P;
    const f = F3 + 1;
    let z = z0, k = 0;
    while (z1 - z >= 9 && k < 6) {
      if (k % 2 === 0 && z1 - z >= 12) {
        // a lawn with four palms in white planters, flower hedges, a picnic and benches
        const a = z, b = z + 11;
        for (let zz = a; zz <= b; zz++) for (let x = cx - 5; x <= cx + 5; x++) {
          const edge = this.dx(x) === 5 || zz === a || zz === b;
          g.set(x, F3, zz, B.grass);
          if (edge && !(this.dx(x) <= 1 && (zz === a || zz === b))) g.set(x, f, zz, B.hedge_flowers);
        }
        for (const [dx, dz] of [[-3, 2], [3, 2], [-3, 9], [3, 9]]) {
          g.set(cx + dx, f, a + dz, B.slab_white);
          TREES.palm(g, cx + dx, f + 1, a + dz);
        }
        this.furn('picnic_blanket', cx, f, a + 6, 0, COLORS.pink);
        this.furn('bench', cx - 2, f, a + 4, 0, COLORS.mint);
        this.furn('bench', cx + 3, f, a + 8, 2, COLORS.sun);
        this.furn('lantern_post', cx - 4, f, a + 6, 0);
        this.furn('lantern_post', cx + 4, f, a + 6, 0);
        g.gem(cx + 2, f, a + 3, 'lawn');
        z = b + 2;
      } else {
        // a shallow kiddie pool with a fountain in the middle and a trampoline beside it
        const a = z, b = z + 8;
        for (let zz = a; zz <= b; zz++) for (let x = cx - 4; x <= cx + 4; x++) {
          const rim = this.dx(x) === 4 || zz === a || zz === b;
          g.set(x, F3 - 1, zz, B.cruise_pool);
          g.set(x, F3, zz, rim ? B.quartz : B.water);
        }
        const mz = a + 4;
        g.set(cx, F3, mz, B.sea_lantern);
        for (let y = f; y <= f + 1; y++) g.set(cx, y, mz, B.quartz_pillar);
        g.set(cx, f + 2, mz, B.water);
        this.floatAt(cx - 2, F3, mz + 2);
        this.furn('trampoline', cx + 7, f, mz, 0, COLORS.lilac);
        this.furn('trampoline', cx - 6, f, mz, 0, COLORS.mint);
        z = b + 2;
      }
      k++;
    }
  }

  // ---------- lifeboats ----------

  lifeboats() {
    const { P, B, g } = this;
    const { cx } = P;
    const per = P.big ? 6 : 4;
    const zs0 = this.cabinRange.z0 + 2, zs1 = this.cabinRange.z1 - 6;
    const gap = Math.max(8, Math.floor((zs1 - zs0) / per));
    for (let k = 0; k < per; k++) {
      const z0 = zs0 + k * gap;
      if (z0 + 6 > zs1 + 6) break;
      for (const s of [-1, 1]) {
        const sw = this.sideWalls((x, z) => this.R1(x, z), z0 + 3);
        if (!sw) continue;
        const xw = s < 0 ? sw[0] : sw[1];
        const xa = xw + s, xb = xw + 2 * s;
        for (let dz = 0; dz < 7; dz++) {
          const z = z0 + dz;
          const end = dz === 0 || dz === 6;
          for (const x of [xa, xb]) {
            if (!end) g.set(x, F1 + 3, z, B.wool_orange);
            g.set(x, F1 + 4, z, end ? B.wool_orange : dz % 2 ? B.cruise_white : B.glass_yellow);
            g.set(x, F1 + 5, z, end ? 0 : B.cruise_white);
          }
        }
        // the davits: white arms from the wall
        for (const dz of [1, 5]) g.set(xa, F1 + 6, z0 + dz, B.cruise_white);
        g.gem(xa, F1 + 6, z0 + 3, 'lifeboat');
      }
    }
  }

  // ---------- masts, flags, lights ----------

  masts() {
    const { P, B, g } = this;
    const { cx } = P;
    // the mast on the bridge roof, with a lookout and a lantern
    const mz = P.zBr0 + 3;
    for (let y = F5 + 1; y <= F5 + 9; y++) g.set(cx, y, mz, B.quartz_pillar);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) g.set(cx + dx, F5 + 6, mz + dz, B.slab_quartz);
    g.set(cx, F5 + 10, mz, B.lantern);
    g.gem(cx + 1, F5 + 7, mz, 'nest');
    // a flagstaff at the bow and one at the stern
    const bz = P.z1 - 2;
    for (let y = F1 + 1; y <= F1 + 5; y++) g.set(cx, y, bz, B.quartz_pillar);
    g.set(cx, F1 + 6, bz, B.lantern);
    const sz = P.z0 + 3;
    for (let y = F1 + 1; y <= F1 + 6; y++) g.set(cx + 6, y, sz, B.quartz_pillar);
    g.set(cx + 6, F1 + 7, sz, B.lantern);
    // strings of party flags: bow -> mast -> funnels -> slide tower -> stern
    const t = this.funnelZ;
    this.flagLine([cx, F1 + 5, bz], [cx, F5 + 9, mz]);
    this.flagLine([cx, F5 + 9, mz], [cx, F4 + 13, t[1] + 3]);
    this.flagLine([cx, F4 + 12, t[0] - 4], [cx, FT + 5, P.zT + 1]);
    this.flagLine([cx, FT + 4, P.zT - 1], [cx + 6, F1 + 6, sz]);
  }

  /** A sagging string of flag sprites between two points (only through free air). */
  flagLine(a, b) {
    const { B } = this;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.ceil(len * 2);
    let last = '';
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const sag = Math.sin(t * Math.PI) * Math.min(4, len / 8);
      const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t - sag), z = Math.round(a[2] + (b[2] - a[2]) * t);
      const key = `${x},${y},${z}`;
      if (key === last) continue;
      last = key;
      this.deco(x, y, z, B.cruise_flags);
    }
  }

  // ---------- the island ----------

  islandLife() {
    const { g, B } = this;
    const isl = this.island;
    const land = [B.grass, B.sand, B.sand_pink];
    // palms all round, the tallest in the middle
    const palms = [[0, 0], [0.55, 0.2], [-0.4, 0.45], [0.1, -0.6], [-0.55, -0.3]];
    for (const [fx, fz] of palms) {
      const x = Math.round(isl.x + fx * isl.r), z = Math.round(isl.z + fz * isl.r);
      if (g.dryLand(x, z, land)) TREES.palm(g, x, g.h(x, z) + 1, z);
    }
    for (let k = 0; k < 18; k++) {
      const a = g.rand() * Math.PI * 2, d = isl.r * (0.5 + g.rand() * 0.5);
      const x = Math.round(isl.x + Math.cos(a) * d), z = Math.round(isl.z + Math.sin(a) * d);
      if (!g.dryLand(x, z, land)) continue;
      g.setAir(x, g.h(x, z) + 1, z, g.rand() < 0.5 ? B.seashell : B.starfish);
    }
    // a wooden dock reaching out toward the ship, boats tied up beside it
    const dz = isl.z;
    let x = isl.x - Math.round(isl.r * 0.7);
    let guard = 0;
    while (g.h(x, dz) > SEA - 1 && guard++ < 30) x--;
    const dockEnd = x - 6;
    for (let xx = x + 2; xx >= dockEnd; xx--) {
      for (const zz of [dz, dz + 1]) {
        if (g.h(xx, zz) >= SEA + 1) continue;
        g.set(xx, SEA + 1, zz, B.planks_oak);
        if (xx % 3 === 0) for (let y = g.h(xx, zz) + 1; y <= SEA; y++) g.set(xx, y, zz - (zz === dz ? 1 : -1), B.log_oak);
      }
    }
    g.set(dockEnd, SEA + 2, dz, B.lantern);
    this.furnNear('boat_swan', dockEnd + 3, dz - 2, 0, COLORS.pink);
    this.furnNear('boat_speed', dockEnd + 2, dz + 6, 0, COLORS.sky);
    // a picnic and a hammock on the beach
    const bx = isl.x + Math.round(isl.r * 0.2), bz = isl.z + Math.round(isl.r * 0.5);
    this.furnNear('picnic_blanket', bx, bz, 0, COLORS.pink);
    this.furnNear('cooler', bx + 3, bz, 0);
    this.furnNear('camp_chair', bx - 2, bz - 1, 1, COLORS.sun);
    this.beach = [isl.x - 2, isl.z + 1];
    // rocks: a gem on top of each
    for (const [rx, rz] of this.rocks) g.gem(rx, g.h(rx, rz) + 1, rz, 'rock');
    g.gem(isl.x + 1, g.h(isl.x + 1, isl.z - 2) + 1, isl.z - 2, 'island');
    g.gem(isl.x - 3, g.h(isl.x - 3, isl.z + 4) + 1, isl.z + 4, 'beach');
  }

  // ---------- spots and lifts ----------

  spotsAndLifts() {
    const { P } = this;
    const { cx, zT } = P;
    // lifts: forward (all four decks) and aft (by the slide tower, up to its platform)
    const liftA = [cx, P.zLift];
    const liftB = [cx, zT + 3];
    const lift = (x, z, stops) => {
      const cells = [];
      for (const s of stops) cells.push([x, s.y + 1, z], [x, s.y + 2, z]);
      if (!this.ok(cells)) { this.skipped.push(`cruise:lift@${x},${z}`); return; }
      this.claim(cells);
      this.features.push({ kind: 'cruise:lift', x, y: stops[0].y + 1, z, rot: 0, stops });
    };
    lift(liftB[0], liftB[1], [F1, F2, F3, FT].map((y) => ({ y, name: DECK_NAME[y] })));
    lift(liftA[0], liftA[1], [F1, F2, F3, F4].map((y) => ({ y, name: DECK_NAME[y] })));
    // named places the board and the lifts can send her to
    const spot = (name, deck, x, y, z) => this.feat('cruise:spot', x, y, z, 0, { name, deck });
    const mp = this.mainPool;
    spot('pool', 'Pool Deck', cx, F3 + 1, Math.round(this.spawn[2] - 0.5) - 3);
    spot('slides', 'Slide Tower', this.towerTop[0], this.towerTop[1], this.towerTop[2]);
    const arcade = this.funRoomList.find((r) => r.name === 'arcade');
    spot('arcade', 'Fun Deck', cx, F2 + 1, Math.round((arcade.z0 + arcade.z1) / 2));
    const th = this.funRoomList.find((r) => r.name === 'theater');
    spot('theater', 'Fun Deck', cx, F2 + 1, th.z0 + 1);
    const kids = this.funRoomList.find((r) => r.name === 'kids');
    spot('kids', 'Fun Deck', cx + 3, F2 + 1, kids.z0 + 2);
    const sw = this.funRoomList.find((r) => r.name === 'sweets');
    spot('sweets', 'Fun Deck', cx, F2 + 1, sw.z0 + 1);
    spot('golf', 'Sports Deck', this.golf.x - 2, F4 + 1, this.golf.z);
    spot('court', 'Sports Deck', this.court.x0 + 2, F4 + 1, P.zC0 + 6);
    spot('dance', 'Pool Deck', cx + 5, F3 + 1, this.dance.z0 + 3);
    spot('bridge', 'Bridge', cx, F4 + 1, P.zC1 - 3 - 1);
    const c = this.cabins.find((k) => k.s > 0) || this.cabins[0];
    if (c) spot('cabins', 'Promenade Deck', cx, F1 + 1, c.z0 + 1);
    spot('snacks', 'Promenade Deck', cx, F1 + 1, this.snackBar.z0 + 2);
    spot('lounge', 'Pool Deck', cx, F3 + 1, this.lounge.z0 + 1);
    const [bx, bz] = this.beach;
    spot('beach', 'Beach Island', bx, this.g.h(bx, bz) + 1, bz);
    spot('marina', 'Swim Platform', this.marina[0], this.marina[1], this.marina[2]);
    // the mini golf course's start sign, and the deck games
    this.feat('cruise:golf', this.golf.x, F4 + 1, this.golf.z, 0, { holes: this.golf.holes });
    this.feat('cruise:game', this.court.x0 + 3, F4 + 1, P.zC0 + 2, 0, { game: 'hoops' });
    this.feat('cruise:game', this.court.x0 + 3, F4 + 1, P.zC0 + 14, 0, { game: 'ringtoss' });
    this.feat('cruise:game', this.court.x0 + 3, F4 + 1, P.zC0 + 23, 0, { game: 'shuffle' });
    void mp;
  }

  /** H (top solid per column) after building, for the gem and spawn helpers. */
  heights() {
    const { g } = this;
    for (let z = 0; z < g.sz; z++) {
      for (let x = 0; x < g.sx; x++) {
        let y = g.sy - 1;
        while (y > 0 && g.get(x, y, z) === 0) y--;
        g.H[z * g.sx + x] = y;
      }
    }
  }

  /** Gem candidates all over the ship (the picker spreads 20-30 of them out). */
  gemCandidates() {
    const { g, P } = this;
    const { cx } = P;
    for (const c of this.cabins) if ((c.z0 + c.s) % 3 === 0) g.gem(c.x, F1 + 1, c.z0 + 2, 'cabin');
    for (const r of this.funRoomList) g.gem(cx + (r.z0 % 2 ? 5 : -5), F2 + 1, r.z0 + 1, 'room');
    g.gem(cx, F1 + 1, P.z1 - 4, 'bow');
    g.gem(this.marina[0] + 2, this.marina[1], this.marina[2], 'marina');
    g.gem(cx + 3, F5 + 1, P.zBr0 + 2, 'roof');
    g.gem(cx - 9, F2 + 1, P.zA0 + 2, 'terrace');
    g.gem(cx - 5, F3 + 1, P.zC1 + 1, 'lookout');
    g.gem(cx + 1, F1 + 1, this.lobby.z0 + 1, 'lobby');
    // drop any candidate that lands on a reserved cell
    g.gems = g.gems.filter((c) => g.inside(c.x, c.y, c.z) && !this.res[this.idx(c.x, c.y, c.z)]);
  }
}

// a 3 x 5 pixel font for the ship's name
const FONT = {
  G: ['XXX', 'X..', 'X.X', 'X.X', 'XXX'],
  L: ['X..', 'X..', 'X..', 'X..', 'XXX'],
  I: ['XXX', '.X.', '.X.', '.X.', 'XXX'],
  M: ['X.X', 'XXX', 'XXX', 'X.X', 'X.X'],
  E: ['XXX', 'X..', 'XX.', 'X..', 'XXX'],
  R: ['XX.', 'X.X', 'XX.', 'X.X', 'X.X'],
  S: ['XXX', 'X..', 'XXX', '..X', 'XXX'],
  T: ['XXX', '.X.', '.X.', '.X.', '.X.'],
  A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'],
};

// ---------- the New World card ----------

/** A pixel-art ship on a sparkling sea (288 x 176). Runs in the browser only; never throws. */
export function paintArt(g, W, H, { drawSparkle, pixelCloud }) {
  try {
    const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const mix = (a, b, t) => {
      const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
      return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
    };
    const sx = W / 288, sy = H / 176; // the picture is drawn for 288 x 176 and scaled
    const R = (x, y, w, h, c) => rect(x * sx, y * sy, Math.max(1, w * sx), Math.max(1, h * sy), c);
    // sky: blocky bands from deep blue to the pale horizon
    const SEA_Y = 118;
    for (let k = 0; k < 10; k++) R(0, (k * SEA_Y) / 10, 288, SEA_Y / 10 + 1, mix('#5CC2FF', '#D6F4FF', k / 9));
    // the sun with a soft glow
    for (const [r, c] of [[20, '#F2FBFF'], [15, '#FFF6C8'], [11, '#FFE68A']]) {
      for (let dy = -r; dy <= r; dy++) {
        const half = Math.floor(Math.sqrt(r * r - dy * dy));
        R(246 - half, 30 + dy, half * 2 + 1, 1, c);
      }
    }
    pixelCloud(g, Math.round(14 * sx), Math.round(14 * sy), 2, '#FFFFFF');
    pixelCloud(g, Math.round(150 * sx), Math.round(8 * sy), 1, '#FFFFFF');
    pixelCloud(g, Math.round(196 * sx), Math.round(58 * sy), 1, '#FFFFFF');
    // a little palm island far away on the right
    R(252, SEA_Y - 4, 36, 4, '#FFE2A8');
    R(258, SEA_Y - 6, 22, 2, '#FFE2A8');
    R(262, SEA_Y - 7, 12, 1, '#7CD67A');
    R(268, SEA_Y - 20, 2, 14, '#B07A4A');
    for (const [dx, dy, w] of [[-7, -21, 8], [1, -22, 8], [-4, -23, 10], [-9, -19, 3], [8, -19, 3]]) R(268 + dx, SEA_Y + dy, w, 2, '#3FB867');
    // the sea: bands and glints
    for (let k = 0; k < 6; k++) R(0, SEA_Y + k * 10, 288, 11, mix('#7FD3FF', '#2FA7D8', k / 5));
    const glints = [[12, 124], [40, 150], [70, 166], [100, 158], [250, 130], [266, 152], [232, 168], [150, 170], [20, 168], [196, 160]];
    for (const [x, y] of glints) { R(x, y, 7, 1, '#E8FBFF'); R(x + 2, y + 1, 4, 1, '#BDEFFF'); }

    // ---------- the ship (bow to the right) ----------
    const WL = 132; // waterline
    // reflection under the hull
    for (let k = 0; k < 4; k++) R(50 + k * 4, WL + 2 + k * 3, 170 - k * 8, 2, mix('#2FA7D8', '#4A4489', 0.35 - k * 0.07));
    // hull rows: the bow rakes forward, the stern is rounded
    const hullTop = 104;
    for (let y = hullTop; y <= WL; y++) {
      const t = (y - hullTop) / (WL - hullTop);
      const right = 238 - t * 18;
      const left = 34 + Math.pow(t, 3) * 14 + (y < hullTop + 3 ? 2 : 0);
      const c = y >= 117 ? '#4A4489' : y >= 115 ? '#F4C24E' : y >= 113 ? '#FF8DC0' : '#FFFFFF';
      R(left, y, right - left, 1, c);
    }
    R(36, hullTop, 200, 1, '#E6E1F0');
    // portholes: warm lights on the white, a row of little ones on the navy
    for (let x = 48; x < 220; x += 7) R(x, 108, 2, 2, '#FFE07A');
    for (let x = 60; x < 200; x += 9) R(x, 122, 2, 2, '#FFE9A8');
    // the name plate: a small gold star near the bow
    R(208, 120, 5, 1, '#F4C24E'); R(210, 118, 1, 5, '#F4C24E');
    // bow wave and stern foam
    R(214, WL - 1, 24, 2, '#FFFFFF'); R(222, WL - 3, 12, 2, '#E8FBFF');
    R(30, WL - 1, 14, 2, '#FFFFFF');
    // superstructure decks (white, with window bands)
    const deck = (x0, x1, y0, y1, win, accent) => {
      R(x0, y0, x1 - x0, y1 - y0, '#FFFFFF');
      R(x0, y0, x1 - x0, 1, '#E6E1F0');
      for (let x = x0 + 3; x < x1 - 4; x += 6) R(x, y0 + 3, 4, 3, win);
      if (accent) for (let x = x0 + 3; x < x1 - 4; x += 6) R(x, y0 + 3, 1, 3, accent);
      R(x0, y1 - 1, x1 - x0, 1, '#D8D2E6');
    };
    deck(48, 214, 92, 104, '#9AD8FF', '#FFB6D9');
    deck(56, 204, 80, 92, '#FFE07A', null);
    deck(96, 196, 68, 80, '#8FCBFF', null);
    // the bridge with its dark window band and wings
    R(172, 58, 26, 10, '#FFFFFF');
    R(174, 61, 23, 3, '#3C4C8C');
    R(196, 62, 4, 6, '#FFFFFF');
    R(166, 66, 36, 2, '#FFFFFF');
    // the mast with a lantern
    R(182, 46, 1, 12, '#D8D2E6'); R(181, 45, 3, 2, '#FFE07A');
    // lifeboats hanging along the side
    for (let x = 66; x < 190; x += 22) { R(x, 96, 13, 4, '#FF9E5A'); R(x + 1, 95, 11, 1, '#FFFFFF'); }
    // railings: light dotted lines along the deck tops
    for (const [x0, x1, y] of [[40, 230, 103], [50, 210, 91], [58, 200, 79], [98, 194, 67]]) for (let x = x0; x < x1; x += 2) R(x, y, 1, 1, '#CFC8DE');
    // funnels: white, raked back, a pink band with a gold star, a navy cap, little puffs
    for (const fx of [122, 146]) {
      for (let y = 40; y < 68; y++) {
        const shift = Math.round((68 - y) / 7);
        const c = y < 45 ? '#4A4489' : y >= 50 && y < 56 ? '#FF8DC0' : '#FFFFFF';
        R(fx - shift, y, 12, 1, c);
      }
      R(fx - 2, 52, 1, 3, '#F4C24E'); R(fx - 3, 53, 3, 1, '#F4C24E');
      pixelCloud(g, Math.round((fx - 16) * sx), Math.round(26 * sy), 1, '#FFFFFF');
    }
    // the slide tower at the stern: white tower, striped canopy, two curly slides
    R(64, 52, 10, 28, '#FFFFFF');
    R(64, 52, 10, 1, '#E6E1F0');
    for (let k = 0; k < 5; k++) R(60 + k * 4, 46, 4, 3, k % 2 ? '#FFFFFF' : '#FF8DC0');
    R(66, 49, 1, 3, '#D8D2E6'); R(71, 49, 1, 3, '#D8D2E6');
    R(68, 43, 2, 3, '#FFE07A');
    const slide = (pts, c, c2) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
          R(x, y, 3, 3, c);
          R(x, y, 3, 1, c2);
        }
      }
    };
    slide([[74, 54], [84, 58], [84, 64], [60, 66], [54, 72], [62, 77], [80, 78]], '#5FD3E6', '#B8F2FA');
    slide([[62, 55], [50, 60], [46, 68], [52, 76], [56, 79]], '#FF8DC0', '#FFD1E6');
    // strings of party flags: bow staff -> mast -> funnels -> tower
    const flags = ['#FF8DC0', '#FFE07A', '#7FD3FF', '#A8E6CF', '#CDB4FF'];
    const line = (ax, ay, bx, by, sag) => {
      const n = Math.round(Math.abs(bx - ax) / 3);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t + Math.sin(t * Math.PI) * sag;
        R(x, y, 2, 2, flags[k % flags.length]);
      }
    };
    R(234, 84, 1, 20, '#D8D2E6');
    line(234, 85, 182, 46, 6);
    line(182, 47, 152, 41, 3);
    line(122, 41, 70, 44, 5);
    // sparkles on the water and in the sky
    drawSparkle(g, Math.round(30 * sx), Math.round(60 * sy), 2, '#FFFFFF');
    drawSparkle(g, Math.round(222 * sx), Math.round(84 * sy), 1, '#FFFFFF');
    drawSparkle(g, Math.round(258 * sx), Math.round(142 * sy), 2, '#FFFFFF');
    drawSparkle(g, Math.round(18 * sx), Math.round(140 * sy), 1, '#FFFFFF');
    drawSparkle(g, Math.round(110 * sx), Math.round(162 * sy), 2, '#FFF3B0');
  } catch (err) {
    void err; // the card falls back to whatever was drawn
  }
}

export const biome = {
  key: 'cruise',
  name: 'Cruise Ship',
  description: 'A giant ship on the sea with pools, slides and games',
  iconBlock: 'cruise_lifebuoy',
  colors: ['#E8F7FF', '#7FD3FF'],
  sky: { top: '#5CC2FF', horizon: '#D6F4FF', fog: '#DDF5FF', sunset: '#FFB8A8', nightTop: '#141A4E', cloud: '#FFFFFF' },
  generate,
  paintArt,
};

void blob;
