// Sea animals tests (docs/teams/ocean.md §13.1), no browser:
//   node tools/test-sea.mjs [--only=S0,S1,...]            (npm run test:sea)
// The sea map, the steppers, the dolphin ride, the whale schedule and the presence parsers over a
// fake voxel world, plus the real biome generators for S0.
//   S0 real worlds    S1 SeaMap         S2 motion        S3 leaps        S4 ride
//   S5 schedule       S6 presence       S7 append-only   S8 caps         S9 static scans

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPES, ItemRegistry, BlockRegistry } from '../src/core/registry.js';
import * as blocksMod from '../src/world/blocks.js';
import { World, WORLD_SIZES } from '../src/world/world.js';
import { mulberry32 } from '../src/core/util.js';
import { Noise } from '../src/core/noise.js';
import { SeaMap } from '../src/life/ocean/seamap.js';
import { SEA_KINDS, OCEAN_STAR_KINDS, PALETTES, SEA_SPEC, DOLPHIN_NAMES, SEA_TEXT, SEA_NAMES, pickPalette } from '../src/life/ocean/kinds.js';
import { h01, whaleTime, whalePhase, buddyOf, clockFrozen, WHALE_LEN } from '../src/life/ocean/schedule.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ONLY = (() => {
  const a = process.argv.find((s) => s.startsWith('--only='));
  return a ? new Set(a.slice(7).split(',')) : null;
})();

let passed = 0, failures = 0;
function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}
async function test(id, name, fn) {
  if (ONLY && !ONLY.has(id)) return;
  const t0 = Date.now();
  try {
    const info = await fn();
    passed++;
    console.log(`  ok   ${id} ${name} (${Date.now() - t0} ms)${info ? ' - ' + info : ''}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${id} ${name}: ${err && err.stack ? err.stack : err}`);
  }
}

// ---------- a fake world ----------

export const AIR = 0, STONE = 1, WATER = 2, ICE = 3, LILY = 4, SAND = 5, BRIDGE = 6, GRASS = 7;
const KEYS = ['air', 'stone', 'water', 'ice', 'lily_pad', 'sand', 'bridge', 'grass'];
const props = {
  shape: Uint8Array.from([SHAPES.air, SHAPES.cube, SHAPES.liquid, SHAPES.cube, SHAPES.carpet, SHAPES.cube, SHAPES.slab, SHAPES.cube]),
  solid: Uint8Array.from([0, 1, 0, 1, 0, 1, 1, 1]),
  replaceable: Uint8Array.from([1, 0, 1, 0, 1, 0, 0, 0]),
};
const fakeRegistry = {
  props,
  byKey: (k) => (KEYS.indexOf(k) >= 0 ? { id: KEYS.indexOf(k), key: k } : null),
};

export class FakeWorld {
  constructor(sx = 48, sy = 32, sz = 48) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.blocks = new Uint8Array(sx * sy * sz);
    this.registry = fakeRegistry;
    this.floorId = STONE;
    this.outside = null;
  }
  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }
  get(x, y, z) {
    if (y < 0) return this.floorId;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y >= this.sy) return 0;
    return this.blocks[(y * this.sz + z) * this.sx + x];
  }
  set(x, y, z, id) {
    if (this.inBounds(x, y, z)) this.blocks[(y * this.sz + z) * this.sx + x] = id;
  }
  fill(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
  }
}

/** A sea: stone up to the bed, water up to `level` (default 10 deep 6), an island in the middle. */
export function seaWorld({ sx = 64, sz = 64, level = 10, bed = 4, island = true, shelf = true } = {}) {
  const w = new FakeWorld(sx, 32, sz);
  w.fill(0, 0, 0, sx - 1, bed, sz - 1, STONE);
  w.fill(0, bed + 1, 0, sx - 1, level, sz - 1, WATER);
  if (island) {
    // a sand island (centre) with a shallow shelf (2 deep) around it
    const cx = sx >> 1, cz = sz >> 1;
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d < 6) w.fill(x, bed + 1, z, x, level + 1, z, SAND);
      else if (shelf && d < 9) w.fill(x, bed + 1, z, x, level - 2, z, SAND);
    }
  }
  w.outside = { block: 'water', surface: level + 0.875 };
  w.waterLevel = level;
  return w;
}

const realRegistry = (() => {
  let reg = null;
  return () => {
    if (reg) return reg;
    const items = new ItemRegistry();
    const B = new BlockRegistry(items);
    blocksMod.install({ registry: { blocks: B, items } });
    B.finalize(() => 0, () => false); // both arguments must be functions (registry.js:162)
    reg = B;
    return reg;
  };
})();

async function realWorld(biome, size, seed) {
  const B = realRegistry();
  const mod = await import(`../src/world/biomes/${biome}.js`);
  const w = new World(WORLD_SIZES[size], B);
  mod.generate(w, mulberry32(seed), new Noise(seed));
  return w;
}

// =====================================================================================
// S0 real worlds
// =====================================================================================

const S0_NUMBERS = { // §2.1, seed 777: [depth >= 3, depth >= 5]
  'beach|cozy': [9810, 7696], 'beach|big': [19695, 14887],
  'meadow|cozy': [6797, 4824], 'meadow|big': [12348, 9251],
  'candy|cozy': [6709, 4798], 'candy|big': [12378, 9252],
  'snow|cozy': [6393, 4569], 'snow|big': [11708, 8872],
};

await test('S0', 'real worlds: the §2.1 numbers, the lagoon, the outside depth, warm scan time', async () => {
  const out = [];
  for (const seed of [777, 12345]) {
    for (const biome of ['beach', 'meadow', 'candy', 'snow', 'fairy', 'mix', 'flat']) {
      for (const size of ['cozy', 'big']) {
        const w = await realWorld(biome, size, seed);
        const m = new SeaMap();
        m.attach(w);
        let ms = Infinity; // warm: the best of three scans (the first, cold one runs behind the loading screen)
        for (let k = 0; k < 3; k++) {
          const t0 = performance.now();
          m.attach(w);
          ms = Math.min(ms, performance.now() - t0);
        }
        let d3 = 0, d5 = 0, liquid = 0;
        for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) {
          if (m.top(x, z) < 0) continue;
          liquid++;
          const d = m.depth(x, z);
          if (d >= 3) d3++;
          if (d >= 5) d5++;
        }
        const want = seed === 777 && S0_NUMBERS[biome + '|' + size];
        if (want) {
          assert(Math.abs(d3 - want[0]) <= want[0] * 0.02, `${biome} ${size}: depth>=3 ${d3} vs ${want[0]}`);
          assert(Math.abs(d5 - want[1]) <= want[1] * 0.02, `${biome} ${size}: depth>=5 ${d5} vs ${want[1]}`);
        }
        if (biome === 'flat') {
          assert(liquid === 0, `flat has no liquid columns (${liquid})`);
          assert(!m.outside().liquid, 'flat: the outside is grass, not water');
        } else {
          assert(m.outside().liquid, `${biome}: the outside ring is liquid`);
          const want = biome === 'beach' ? 6 : 5;
          if (seed === 777) assert(m.outside().depth === want, `${biome} ${size}: outside depth ${m.outside().depth} (want ${want})`);
        }
        if (biome === 'candy') {
          const top = m.top(1, 1);
          const id = top >= 0 ? w.get(1, top, 1) : -1;
          assert(id === w.registry.idOf('strawberry_milk') || d3 > 1000, 'candy: the strawberry milk sea counts');
        }
        if (size === 'big') assert(ms <= 8, `warm attach ${biome} ${ms.toFixed(1)} ms (<= 8)`);
        if (seed === 777 && size === 'big') out.push(`${biome} ${ms.toFixed(1)}ms`);
        if (biome === 'beach') {
          // the lagoon and its channel (beach.js:62-64, :94) lie inside 0.94 x R0 of the centre
          // (R0 = 0.33 x size): every sea-level water column there is at most 2 deep
          const R0 = w.sx * 0.33, cx = w.sx / 2, cz = w.sz / 2;
          let lagoonMax = 0, n = 0;
          for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) {
            if (m.top(x, z) !== w.waterLevel) continue;
            const d = Math.hypot(x - cx, z - cz);
            if (d > R0 * 0.9) continue;
            n++;
            lagoonMax = Math.max(lagoonMax, m.depth(x, z));
          }
          assert(lagoonMax <= 2 && n > 30, `${size} ${seed}: the lagoon is at most 2 deep (max ${lagoonMax}, ${n} cells)`);
        }
      }
    }
  }
  return 'warm Big: ' + out.join(', ');
});

// =====================================================================================
// S1 SeaMap
// =====================================================================================

await test('S1', 'SeaMap: columns, edits, ticks, outside, shore, deepAround, placed', () => {
  const w = new FakeWorld(32, 24, 32);
  w.fill(0, 0, 0, 31, 3, 31, STONE);
  const col = (x, z, deep) => { w.fill(x, 4, z, x, 3 + deep, z, WATER); };
  col(2, 2, 1); col(4, 2, 2); col(6, 2, 3); col(8, 2, 6);
  col(10, 2, 3); w.set(10, 7, 2, ICE);       // ice on top: not water
  col(12, 2, 3); w.set(12, 7, 2, LILY);      // a lily pad: still water
  col(14, 2, 3); w.set(14, 9, 2, BRIDGE);    // a bridge two above: not water
  w.fill(20, 4, 20, 20, 6, 20, SAND);        // sand at y=6 next to water at level 6
  col(21, 20, 3);
  w.fill(24, 4, 24, 24, 8, 24, SAND);        // sand two above the next water: not a shore
  col(25, 24, 3);
  const m = new SeaMap().attach(w);
  assert(m.depth(2, 2) === 1 && m.top(2, 2) === 4 && m.bed(2, 2) === 3, `1 deep (${m.depth(2, 2)}, ${m.top(2, 2)}, ${m.bed(2, 2)})`);
  assert(m.depth(4, 2) === 2 && m.depth(6, 2) === 3 && m.depth(8, 2) === 6 && m.top(8, 2) === 9, '2, 3, 6 deep');
  assert(m.top(10, 2) === -1, 'ice on top: no water');
  assert(m.top(12, 2) === 6 && m.depth(12, 2) === 3, 'a lily-pad carpet on top: counts');
  assert(m.top(14, 2) === -1, 'a bridge block on top: no water');
  assert(m.top(0, 0) === -1 && m.depth(0, 0) === 0, 'dry stone');
  // setColumn after a change with an event
  w.set(6, 7, 2, STONE);
  m.setColumn(6, 2);
  assert(m.top(6, 2) === -1, 'setColumn sees a block on the water');
  // a prefab-style batch with no event, seen after at most ceil(sz / 2) ticks
  for (let x = 0; x < 32; x++) w.fill(x, 4, 16, x, 6, 16, WATER);
  for (let k = 0; k < Math.ceil(w.sz / 2); k++) m.tick(2);
  assert(m.top(5, 16) === 6 && m.depth(5, 16) === 3, 'edits with no event are seen within sz/2 ticks');
  assert(m.placed(5, 16), 'water that appeared after attach is marked placed');
  assert(!m.placed(8, 2), 'water that was there at attach is not placed');
  // markAllDirty then ticks rescan every row
  for (let x = 0; x < 32; x++) w.set(x, 7, 28, BRIDGE);
  w.fill(3, 4, 28, 3, 6, 28, WATER);
  m.markAllDirty();
  for (let k = 0; k < Math.ceil(w.sz / 2); k++) m.tick(2);
  assert(m.top(3, 28) === -1, 'markAllDirty: every row rescanned');
  // shore
  const m2 = new SeaMap().attach(w);
  assert(m2.shore(20, 20), 'sand at the water level next to water is a shore');
  assert(!m2.shore(19, 20), 'one block inland is not');
  assert(!m2.shore(24, 24), 'sand 2 above the water is not a shore');
  // the outside
  assert(m2.top(-3, 5) === -1, 'outside === null: no liquid out of bounds');
  const sea = seaWorld({ island: false });
  const m3 = new SeaMap().attach(sea);
  assert(m3.outside().liquid && m3.top(-5, 10) === 10 && m3.depth(-5, 10) === 6 && m3.bed(-5, 10) === 4, `outside water (${JSON.stringify(m3.outside())})`);
  sea.outside = { block: 'grass', surface: 11 };
  m3.attach(sea);
  assert(!m3.outside().liquid && m3.top(-5, 10) === -1, 'a grass outside is not water');
  // outside depth 5 when the edge seabed median is 5
  const s5 = seaWorld({ island: false, bed: 5 });
  assert(new SeaMap().attach(s5).outside().depth === 5, 'outside depth 5');
  // deepAround: one shallow sample passes (8 of 9), two fail
  const d = seaWorld({ island: false });
  const md = new SeaMap().attach(d);
  assert(md.deepAround(30, 30), 'open sea is dolphin water');
  d.fill(32, 5, 32, 32, 9, 32, SAND); md.setColumn(32, 32);
  assert(md.deepAround(30, 30), 'one shallow sample: still passes');
  d.fill(28, 5, 28, 28, 9, 28, SAND); md.setColumn(28, 28);
  assert(!md.deepAround(30, 30), 'two shallow samples: fails');
  assert(md.placed(32, 32) === false, 'a column that stopped being water is not placed');
});

// =====================================================================================
// S5 schedule
// =====================================================================================

await test('S5', 'schedule: whale windows, phases, frozen clocks, the buddy', () => {
  const seeds = [1, 777, 12345, 99999, -5];
  for (const seed of seeds) {
    const vals = new Set();
    for (let day = 1; day <= 20; day++) {
      const a = whaleTime(seed, day, 0), b = whaleTime(seed, day, 1);
      assert(a >= 0.32 && a <= 0.44 && b >= 0.52 && b <= 0.64, `windows ${a} ${b}`);
      assert(a + WHALE_LEN < 0.7 && b + WHALE_LEN < 0.7, 'both end before dusk');
      assert(whaleTime(seed, day, 0) === a, 'stable');
      vals.add(a.toFixed(4));
      assert(whalePhase(seed, day, a - 0.001) === null, 'null before');
      const mid = whalePhase(seed, day, a + WHALE_LEN / 2);
      assert(mid && mid.k === 0 && Math.abs(mid.p - 0.5) < 1e-6, 'p = 0.5 mid-window');
      assert(whalePhase(seed, day, a + WHALE_LEN + 0.0001) === null || whalePhase(seed, day, a + WHALE_LEN + 0.0001).k === 1, 'closed after');
    }
    assert(vals.size >= 10, `at least 10 different times over 20 days (${vals.size})`);
  }
  assert(h01(5, 6, 0) !== h01(5, 6, 1) && h01(5, 6, 0) === h01(5, 6, 0), 'h01 stable, k matters');
  // frozen-clock predicate: a shared guest follows the host, everyone else her own setting
  const guest = { net: { isGuest: true, hostFrozen: true }, _isShared: () => true, profile: { settings: { timeFrozen: false } } };
  const solo = { net: null, profile: { settings: { timeFrozen: true } } };
  assert(clockFrozen(guest) === true && clockFrozen({ ...guest, net: { isGuest: true, hostFrozen: false } }) === false, 'guest uses hostFrozen');
  assert(clockFrozen(solo) === true && clockFrozen({ profile: { settings: {} } }) === false, 'solo uses timeFrozen');
  // the buddy is stable per seed
  for (const seed of seeds) {
    const a = buddyOf(seed, 'beach'), b = buddyOf(seed, 'beach');
    assert(a.name === b.name && a.variant === b.variant && DOLPHIN_NAMES.includes(a.name), 'buddy stable');
    assert(PALETTES.dolphin[a.variant], 'buddy palette exists');
    const c = buddyOf(seed, 'candy');
    assert(['bubblegum', 'cotton'].includes(PALETTES.dolphin[c.variant][0]), 'candy buddy uses a candy palette');
  }
});

// =====================================================================================
// S7 append-only guard
// =====================================================================================

// Recorded when step 2 landed. Never edit these lines; append new entries to the lists instead.
const SEA_KINDS_V1 = ['dolphin', 'fish', 'sea_turtle', 'octopus', 'jelly', 'seahorse', 'crab', 'starfish', 'whale'];
const PALETTES_V1 = {
  dolphin: ['sky', 'lilac', 'rose', 'mint', 'silver', 'bubblegum', 'cotton', 'snowy', 'deep', 'teal'],
  fish: ['coral', 'sunny', 'sky', 'grape', 'mint', 'peach', 'pearl', 'koi', 'fairy', 'candy'],
  sea_turtle: ['ocean', 'leafy', 'coral', 'lilac', 'midnight'],
  octopus: ['coral', 'lilac', 'peach', 'mint', 'sunny'],
  jelly: ['pink', 'lilac', 'aqua', 'peach', 'gummy'],
  seahorse: ['sunny', 'pink', 'orange', 'lilac'],
  crab: ['red', 'pink', 'candy'],
  starfish: ['orange', 'coral', 'lilac', 'yellow'],
  whale: ['blue', 'grey', 'white', 'berry'],
};

await test('S7', 'append-only: SEA_KINDS and every palette keep their first entries', () => {
  assert(OCEAN_STAR_KINDS === 9, 'OCEAN_STAR_KINDS is 9');
  assert(SEA_KINDS_V1.every((k, i) => SEA_KINDS[i] === k), 'SEA_KINDS starts with the v1 list');
  for (const k of SEA_KINDS_V1) {
    const keys = PALETTES[k].map((p) => p[0]);
    assert(PALETTES_V1[k].every((key, i) => keys[i] === key), `${k} palettes start with the v1 list`);
    for (const p of PALETTES[k]) assert(/^#[0-9A-F]{6}$/i.test(p[1]) && /^#[0-9A-F]{6}$/i.test(p[2]), `${k} ${p[0]} colors`);
    assert(SEA_NAMES[k] && SEA_SPEC[k], `${k} has a name and a spec`);
  }
  assert(PALETTES.dolphin.length <= 16, 'the dolphin palette fits presence sr (0..15)');
});

// =====================================================================================
// S8 caps
// =====================================================================================

await test('S8', 'caps: instances per kind and the low-quality caps', () => {
  const want = { dolphin: 12, fish: 30, sea_turtle: 3, octopus: 2, jelly: 8, seahorse: 6, crab: 6, starfish: 12, whale: 1 };
  for (const [k, n] of Object.entries(want)) assert(SEA_SPEC[k].cap === n, `${k} capacity ${SEA_SPEC[k].cap}`);
  const d = SEA_SPEC.dolphin;
  assert(d.wild + d.show + d.friends === d.cap, 'dolphins: 6 wild + 3 show + 3 friends');
  assert(SEA_SPEC.fish.max * SEA_SPEC.fish.perSchool[1] <= SEA_SPEC.fish.cap, 'three schools of 10 fit');
  assert(SEA_SPEC.fish.low < SEA_SPEC.fish.max && SEA_SPEC.jelly.lowNight === 4 && SEA_SPEC.jelly.maxNight === 8, 'low quality halves fish and jellies only');
  for (const k of ['dolphin', 'sea_turtle', 'octopus', 'seahorse', 'crab', 'starfish']) assert(SEA_SPEC[k].low === SEA_SPEC[k].max, `${k} is not thinned on low`);
  let tris = 0;
  void tris;
});

// ---------- palettes per biome ----------
await test('S8', 'palettes: candy uses candy colors, snow half snowy, ponds koi', () => {
  const r = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const c = PALETTES.dolphin[pickPalette('dolphin', 'candy', r)][0];
    assert(c === 'bubblegum' || c === 'cotton', 'candy dolphin ' + c);
    const m = PALETTES.dolphin[pickPalette('dolphin', 'meadow', r)][0];
    assert(!['bubblegum', 'cotton', 'snowy'].includes(m), 'meadow dolphin ' + m);
  }
  let snowy = 0;
  for (let i = 0; i < 400; i++) if (PALETTES.dolphin[pickPalette('dolphin', 'snow', r)][0] === 'snowy') snowy++;
  assert(snowy > 120 && snowy < 280, 'snow: about half snowy ' + snowy);
});

console.log(`\n${passed} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
