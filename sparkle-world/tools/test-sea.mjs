// Sea animals tests (docs/teams/ocean.md §13.1), no browser:
//   node tools/test-sea.mjs [--only=S0,S1,...]            (npm run test:sea)
// The sea map, the steppers, the dolphin ride, the whale schedule and the presence parsers over a
// fake voxel world, plus the real biome generators for S0.
//   S0 real worlds    S1 SeaMap         S2 motion        S3 leaps        S4 ride
//   S5 schedule       S6 presence       S7 append-only   S8 caps         S9 static scans
//   S10 glass (the line of sight through see-through blocks)   S11 fish spacing   S12 fish on the screen
//   S14 animals of different kinds keep apart
//   S13 dolphin flukes (attached and swept back)

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
import {
  makeRecord, saveGood, sanitize, columnOk, spawnOk, settleY, swimToward, wanderTarget, canLeap, startLeap, stepLeap,
  startTrick, stepTrick, Spawner, placeFish, spaceFish, fishSlot, fishY, schoolFrame, FISH_APART, FISH_STEP, stepCrab, rescueCell, glassBetween, SURF, BAND, apartKinds, CROSS, CROSS_UP,
} from '../src/life/ocean/motion.js';
import { DolphinRide, RIDE_SPEED, RIDE_RUN } from '../src/life/ocean/ride.js';
import { parseSeaRide, parseSeaTrick } from '../src/net/protocol.js';
import { scanText, scanCharacters } from './lib/name-scan.mjs';

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
        // warm: the best of seven scans (the first, cold one runs behind the loading screen). On a
        // busy machine (another worker's browser, a garbage collection) all seven of one round
        // could still land past 8 ms with unchanged code (seen once in a while), so a Big world
        // whose best is over the limit gets up to two more rounds of seven after a short pause.
        // A real slowdown is slow in every round and still fails; the rounds used are printed.
        let ms = Infinity, rounds = 0;
        const round = () => {
          rounds++;
          for (let k = 0; k < 7; k++) {
            const t0 = performance.now();
            m.attach(w);
            ms = Math.min(ms, performance.now() - t0);
          }
        };
        round();
        while (size === 'big' && ms > 8 && rounds < 3) {
          await new Promise((r) => setTimeout(r, 250));
          round();
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
        if (size === 'big') assert(ms <= 8, `warm attach ${biome} ${ms.toFixed(1)} ms (<= 8, best of ${rounds} rounds of 7)`);
        if (seed === 777 && size === 'big') out.push(`${biome} ${ms.toFixed(1)}ms${rounds > 1 ? ` (${rounds} rounds)` : ''}`);
        else if (rounds > 1) out.push(`${biome} ${seed} ${ms.toFixed(1)}ms (${rounds} rounds)`);
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
  const want = { dolphin: 14, fish: 30, sea_turtle: 3, octopus: 2, jelly: 8, seahorse: 6, crab: 6, starfish: 12, whale: 1 };
  for (const [k, n] of Object.entries(want)) assert(SEA_SPEC[k].cap === n, `${k} capacity ${SEA_SPEC[k].cap}`);
  const d = SEA_SPEC.dolphin;
  assert(d.wild + d.show + d.friends === d.cap, 'dolphins: 6 wild + 3 show + 5 friends (one ride for each friend of 6 players)');
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


// =====================================================================================
// S2 motion
// =====================================================================================

function envFor(w, seed) {
  const map = new SeaMap().attach(w);
  return { map, world: w, props, rand: mulberry32(seed), seaLevel: w.waterLevel, stats: { nanResets: 0 }, isSand: () => true };
}

/** A random edit near (x, z): a block into the water or water back; with or without setColumn. */
function randomEdit(env, rand, x, z, announce) {
  const w = env.world;
  const ex = Math.floor(x + (rand() - 0.5) * 8), ez = Math.floor(z + (rand() - 0.5) * 8);
  if (!w.inBounds(ex, 0, ez)) return;
  const top = env.map.top(ex, ez);
  if (top >= 0 && rand() < 0.6) w.set(ex, top + (rand() < 0.5 ? 0 : 1), ez, STONE);
  else {
    for (let y = 5; y <= 10; y++) w.set(ex, y, ez, WATER);
    w.set(ex, 11, ez, AIR);
  }
  if (announce) env.map.setColumn(ex, ez);
}

await test('S2', 'motion: 20 seeds x 2,000 steps per kind with block edits: finite, in their water, in the surface band', () => {
  let checks = 0, bandChecks = 0;
  const kinds = ['dolphin', 'sea_turtle', 'jelly', 'fish', 'crab', 'starfish'];
  for (let seed = 1; seed <= 20; seed++) {
    const w = seaWorld({ sx: 64, sz: 64 });
    const env = envFor(w, seed);
    const rand = env.rand;
    const player = { x: 32 + 14, z: 32, speed: 0 };
    for (const kind of kinds) {
      const r = makeRecord(kind, 0);
      // a start that qualifies
      let ok = false;
      for (let t = 0; t < 400 && !ok; t++) {
        const x = 2 + Math.floor(rand() * 60), z = 2 + Math.floor(rand() * 60);
        if (kind === 'crab' ? env.map.shore(x, z) : kind === 'starfish' ? true : spawnOk(env, kind, x, z)) { r.x = x + 0.5; r.z = z + 0.5; ok = true; }
      }
      assert(ok, `${kind}: a start cell`);
      r.on = true;
      r.level = kind === 'crab' ? env.map.ground(r.x, r.z) : env.map.top(r.x, r.z);
      r.y = kind === 'crab' ? r.level + 1 : r.level + SURF - 0.3;
      r.tx = r.x; r.tz = r.z; r.ty = r.y;
      saveGood(r);
      const school = { x: r.x, z: r.z, level: r.level, scatter: 0 };
      const fish = [];
      if (kind === 'fish') for (let i = 0; i < 8; i++) { const f = makeRecord('fish', i); f.orbit = rand() * 6.28; f.orbitR = 0.4 + rand() * 0.8; f.orbitW = 1; f.level = r.level; fish.push(f); }
      const sx0 = r.x, sz0 = r.z;
      let lastEdit = -1;
      for (let step = 0; step < 2000; step++) {
        const dt = 1 / 30;
        if (step % 50 === 25) { randomEdit(env, rand, r.x, r.z, rand() < 0.5); lastEdit = step; }
        env.map.tick(2);
        if (step % 8 === 0) {
          const res = kind === 'crab' || kind === 'starfish' || r.state === 'leap' ? null : rescueCell(r, env);
          if (res === 'fade') { r.on = false; break; }
        }
        if (kind === 'dolphin') {
          if (r.state === 'leap') stepLeap(r, dt, env);
          else if (r.state === 'trick') stepTrick(r, dt, env);
          else {
            if (step % 120 === 0) { wanderTarget(r, env, rand, r._w || (r._w = [0, 0])); r.tx = r._w[0]; r.tz = r._w[1]; }
            swimToward(r, dt, env, r.tx, r.tz, 4 + rand() * 6);
            settleY(r, dt, env, Math.hypot(r.x - player.x, r.z - player.z));
            if (step % 90 === 45 && canLeap(env, r)) startLeap(r, r.speed);
            else if (step % 400 === 200) startTrick(r, env);
          }
        } else if (kind === 'sea_turtle' || kind === 'jelly') {
          if (step % 150 === 0) { wanderTarget(r, env, rand, r._w || (r._w = [0, 0]), 4, 10); r.tx = r._w[0]; r.tz = r._w[1]; }
          swimToward(r, dt, env, r.tx, r.tz, kind === 'jelly' ? 0.3 : 1.4, 0.4);
          if (kind === 'jelly') r.y = r.level + SURF - 0.5; else settleY(r, dt, env, Math.hypot(r.x - player.x, r.z - player.z));
        } else if (kind === 'fish') {
          if (step % 150 === 0) {
            for (let t = 0; t < 6; t++) {
              const x = r.x + (rand() - 0.5) * 16, z = r.z + (rand() - 0.5) * 16;
              if (spawnOk(env, 'fish', Math.floor(x), Math.floor(z)) && env.map.top(x, z) === r.level) { r.tx = x; r.tz = z; break; }
            }
          }
          if (step % 300 === 100) school.scatter = 1;
          school.scatter = Math.max(0, school.scatter - dt / 3);
          swimToward(r, dt, env, r.tx, r.tz, 1.6, 1.5);
          if (!spawnOk(env, 'fish', Math.floor(r.x), Math.floor(r.z))) { r.x = r.gx; r.z = r.gz; }
          saveGood(r);
          school.x = r.x; school.z = r.z; school.level = r.level;
          for (const f of fish) {
            f.orbit += dt;
            placeFish(f, school, env);
            const surf = school.level + SURF;
            f.y = surf - 0.275;
            assert(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.z), 'fish finite');
            if (step - lastEdit > 10) {
              assert(props.shape[w.get(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z))] === SHAPES.liquid, `seed ${seed} step ${step}: a fish outside liquid at ${f.x.toFixed(2)},${f.y.toFixed(2)},${f.z.toFixed(2)}`);
              assert(f.y >= surf - 0.4 && f.y <= surf - 0.15, 'fish in their band');
              checks++;
            }
          }
        } else if (kind === 'crab') {
          stepCrab(r, dt, env, rand, player);
          if (r.lost) break; // its shore was built away: it goes (index.js fades it)
          // (an edit with no event reaches the map within sz / 2 ticks)
          if (r.state !== 'hide' && step - lastEdit > 34) { assert(env.map.shore(Math.floor(r.x), Math.floor(r.z)), `seed ${seed} step ${step}: a crab off the shore`); checks++; }
        } else if (kind === 'starfish') {
          assert(r.x === sx0 && r.z === sz0, 'starfish never move');
        }
        if (sanitize(r, env.stats)) throw new Error('a NaN on clean input');
        if (r.state !== 'leap' && r.state !== 'trick') saveGood(r);
        assert([r.x, r.y, r.z, r.yaw, r.pitch, r.roll, r.speed].every(Number.isFinite), `${kind} finite`);
        if (kind === 'dolphin' && r.on) {
          // an edit with no event reaches the map within sz / 2 = 32 ticks; the creature's own
          // check runs every 8 steps (0.25 s)
          const settled = step - lastEdit > 42;
          if (r.state !== 'leap' && settled) {
            assert(columnOk(env, 'dolphin', Math.floor(r.x), Math.floor(r.z), r.level), `seed ${seed} step ${step}: a dolphin in a failing column (${r.state})`);
            checks++;
          }
          const bed = env.map.bed(r.x, r.z);
          if (bed >= 0 && r.state !== 'leap') assert(r.y >= bed + 1, `seed ${seed}: a dolphin below bed + 1`);
          const near = Math.hypot(r.x - player.x, r.z - player.z) <= 20;
          if (near && r.state === 'swim' && r._was === 'swim') {
            const surf = r.level + SURF;
            assert(r.y >= surf - 0.35 - 1e-6 && r.y <= surf - 0.25 + 1e-6, `seed ${seed} step ${step}: a dolphin out of its band (${(surf - r.y).toFixed(3)})`);
            checks++;
            bandChecks++;
          }
          r._was = r.state;
          if (!env.map.inBounds(Math.floor(r.x), Math.floor(r.z)) && r.state !== 'leap') assert(r.y >= env.map.outside().bed + 1.3 - 1e-6, 'outside: above the ring bed + 1.3');
        }
      }
    }
    assert(env.stats.nanResets === 0, 'no NaN resets on clean input');
  }
  // the reset path works after a forced NaN
  const r = makeRecord('dolphin', 0);
  r.x = 5; r.y = 6; r.z = 7; saveGood(r);
  r.x = NaN;
  const st = { nanResets: 0 };
  assert(sanitize(r, st) && r.x === 5 && st.nanResets === 1, 'a NaN goes back to the last good pose');
  assert(bandChecks > 1000, 'the dolphins\' band was checked (' + bandChecks + ')');
  return `${checks} checks, ${bandChecks} in the band`;
});

await test('S2', 'spawn fallback: a 5x5x2 pool (fish) and a 17x17x4 pool (dolphins), the player at its edge', () => {
  const pool = (n, d) => {
    const w = new FakeWorld(48, 24, 48);
    w.fill(0, 0, 0, 47, 9, 47, GRASS);
    const x0 = 20, z0 = 20;
    for (let z = z0; z < z0 + n; z++) for (let x = x0; x < x0 + n; x++) for (let y = 10 - d; y <= 9; y++) w.set(x, y, z, WATER);
    return { w, x0, z0 };
  };
  const now = 1;
  const a = pool(5, 2);
  const ea = envFor(a.w, 9);
  const sp = new Spawner(['fish', 'dolphin']);
  const out = [0, 0];
  let res = null;
  for (let f = 0; f < 120 && !res; f++) res = sp.find('fish', ea, a.x0 - 0.5, a.z0 + 2.5, 8, 22, 4, now, ea.rand, out, { maxR: 22 });
  assert(res && spawnOk(ea, 'fish', Math.floor(out[0]), Math.floor(out[1])), `fish in a 5x5x2 pool (${res})`);
  const b = pool(17, 4);
  const eb = envFor(b.w, 11);
  res = null;
  for (let f = 0; f < 240 && !res; f++) res = sp.find('dolphin', eb, b.x0 - 0.5, b.z0 + 8.5, 30, 40, 6, now, eb.rand, out, { maxR: 40 });
  assert(res && eb.map.deepAround(out[0], out[1], 3), `dolphins in a 17x17x4 pool (${res})`);
  // a 2-deep pool never gets dolphins
  const c = pool(17, 2);
  const ec = envFor(c.w, 12);
  res = null;
  for (let f = 0; f < 120 && !res; f++) res = sp.find('dolphin', ec, c.x0 - 0.5, c.z0 + 8.5, 30, 40, 6, now, ec.rand, out, { maxR: 40 });
  assert(!res, 'a 2-deep pool never gets dolphins');
});

await test('S2', 'slot compaction: every slot keeps its record\'s palette after random despawns', async () => {
  const THREE = await import('three');
  const { SeaMeshes } = await import('../src/life/ocean/render.js');
  const { hexToLinear } = await import('../src/life/ocean/kinds.js');
  const scene = new THREE.Scene();
  const M = new SeaMeshes(scene);
  const rand = mulberry32(5);
  const list = [];
  for (let i = 0; i < 12; i++) { const r = makeRecord('dolphin', i); r.uid = i; list.push(r); }
  for (let round = 0; round < 200; round++) {
    for (const r of list) {
      if (rand() < 0.3) r.on = !r.on;
      if (r.on && rand() < 0.2) { r.variant = Math.floor(rand() * PALETTES.dolphin.length); r.tintVer++; }
      r.fade = 1;
    }
    const n = M.write('dolphin', [list]);
    let k = 0;
    for (const r of list) {
      if (!r.on) continue;
      const t = M.slotTint('dolphin', k);
      const want = hexToLinear(PALETTES.dolphin[r.variant][1]);
      assert(Math.abs(t[0] - want[0]) < 1e-6 && Math.abs(t[1] - want[1]) < 1e-6 && Math.abs(t[2] - want[2]) < 1e-6, `round ${round} slot ${k}: the tint follows its record`);
      k++;
    }
    assert(k === n, 'slot count');
  }
});

// =====================================================================================
// S3 leaps
// =====================================================================================

await test('S3', 'leaps: apex <= surface + 2.0, about 1 s in the air, lands in deep water, refused under a bridge', () => {
  const w = seaWorld({ island: false });
  const env = envFor(w, 3);
  for (let k = 0; k < 40; k++) {
    const r = makeRecord('dolphin', 0);
    r.x = 30.5; r.z = 30.5; r.level = 10; r.y = 10 + SURF - 0.3; r.yaw = (k / 40) * Math.PI * 2;
    assert(canLeap(env, r), 'open sea: a leap is fine');
    startLeap(r, 4);
    let t = 0, apex = -1;
    for (let s = 0; s < 200; s++) {
      t += 1 / 60;
      const res = stepLeap(r, 1 / 60, env);
      apex = Math.max(apex, r.y - (10 + SURF));
      if (res === 'land') break;
    }
    assert(apex <= 2.0 && apex > 1.2, 'apex ' + apex.toFixed(2));
    assert(t >= 0.8 && t <= 1.2, 'airtime ' + t.toFixed(2));
    assert(columnOk(env, 'dolphin', Math.floor(r.x), Math.floor(r.z), 10), 'lands in a qualifying column');
  }
  for (let h = 1; h <= 4; h++) {
    const w2 = seaWorld({ island: false });
    const e2 = envFor(w2, 4);
    for (let x = 28; x <= 36; x++) w2.set(x, 10 + h, 30, BRIDGE);
    const r = makeRecord('dolphin', 0);
    r.x = 30.5; r.z = 28.5; r.level = 10; r.y = 10.5; r.yaw = 0;
    assert(!canLeap(e2, r), `a bridge ${h} above the surface: no leap`);
  }
});

// =====================================================================================
// S4 the ride
// =====================================================================================

await test('S4', 'ride: 20 seeds x 2,000 random inputs: deep water at one level, inside the world, never a shallow column', () => {
  let uturns = 0, leaps = 0, refused = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const w = seaWorld();
    const env = envFor(w, seed);
    env.bodyBlocked = () => false;
    const R = new DolphinRide();
    R.start(32.5 + 14, 32.5, 0, 10);
    const rand = env.rand;
    let wx = 0, wz = 1, run = false;
    for (let s = 0; s < 2000; s++) {
      if (s % 40 === 0) { const a = rand() * Math.PI * 2; const l = rand() < 0.2 ? 0 : 0.5 + rand() * 0.5; wx = Math.sin(a) * l; wz = Math.cos(a) * l; run = rand() < 0.4; }
      const ev = R.step(1 / 30, wx, wz, run, rand() < 0.03, env);
      assert(!ev.end, `seed ${seed}: the ride ended (${ev.end})`);
      assert([R.x, R.y, R.z, R.yaw, R.speed].every(Number.isFinite), 'finite');
      assert(env.map.depth(R.x, R.z) >= 3 && env.map.top(R.x, R.z) === 10, `seed ${seed} step ${s}: the centre is deep water at the level`);
      assert(R.x >= 1 && R.x < 63 && R.z >= 1 && R.z < 63, 'inside [1, sx - 1]');
      if (ev.uturn) uturns++;
      if (ev.leap) leaps++;
      if (ev.refused) refused++;
    }
  }
  return `${uturns} U-turns, ${leaps} leaps, ${refused} small hops`;
});

await test('S4', 'ride: top speed 9.5 (12 running) within 2 s; the shelf stops it from 12 within 0.45 s; leaps come back to the level', () => {
  const w = seaWorld({ island: false });
  const env = envFor(w, 1);
  env.bodyBlocked = () => false;
  const R = new DolphinRide();
  R.start(10.5, 32.5, Math.PI / 2, 10);
  let t = 0;
  for (; t < 2 && R.speed < RIDE_SPEED - 0.01; t += 1 / 60) R.step(1 / 60, 1, 0, false, false, env);
  assert(R.speed >= RIDE_SPEED - 0.01 && t <= 2, 'walk speed 9.5 in ' + t.toFixed(2) + ' s');
  R.start(10.5, 32.5, Math.PI / 2, 10);
  for (t = 0; t < 2.2 && R.speed < RIDE_RUN - 0.01; t += 1 / 60) R.step(1 / 60, 1, 0, true, false, env);
  assert(R.speed >= RIDE_RUN - 0.01 && t <= 2.2, 'run speed 12 in ' + t.toFixed(2) + ' s');
  // a shallow shelf ahead (x >= 40 is 2 deep)
  const ws = seaWorld({ island: false });
  for (let z = 0; z < 64; z++) for (let x = 40; x < 64; x++) ws.fill(x, 5, z, x, 8, z, SAND); // 2 deep
  const es = envFor(ws, 2);
  es.bodyBlocked = () => false;
  const S = new DolphinRide();
  S.start(12.5, 32.5, Math.PI / 2, 10);
  S.speed = 12;
  let stopT = null, shallow = 0;
  for (let s = 0; s < 600; s++) {
    const ev = S.step(1 / 60, 1, 0, true, false, es);
    if (ev.shallow) shallow++;
    assert(es.map.depth(S.x, S.z) >= 3, 'never enters the shelf');
    if (S.speed > 11.5) stopT = null;
    else if (stopT === null && S.speed < 11.5) stopT = s;
    if (S.speed === 0 && stopT !== null) { assert((s - stopT) / 60 <= 0.45, 'stopped in ' + ((s - stopT) / 60).toFixed(2)); break; }
  }
  assert(shallow >= 1 && shallow <= 3, 'the shallow toast at most once per 4 s (' + shallow + ' in 10 s)');
  // a leap returns to the level; a refused leap (a bridge) gives the 0.5 hop
  const L = new DolphinRide();
  L.start(20.5, 32.5, Math.PI / 2, 10);
  L.speed = 6;
  let ev = L.step(1 / 60, 1, 0, false, true, env);
  assert(ev.leap, 'a leap');
  let top = 0;
  for (let s = 0; s < 120; s++) { L.step(1 / 60, 1, 0, false, false, env); top = Math.max(top, L.lift); }
  assert(!L.leaping && L.lift === 0 && Math.abs(top - 1.75) < 0.15, 'back at the level after an apex of ' + top.toFixed(2));
  const wb = seaWorld({ island: false });
  for (let x = 18; x < 30; x++) for (let z = 28; z < 37; z++) wb.set(x, 14, z, BRIDGE); // level + 4: no leap, room for a hop
  const eb = envFor(wb, 3);
  eb.bodyBlocked = () => false;
  const B = new DolphinRide();
  B.start(20.5, 32.5, Math.PI / 2, 10);
  ev = B.step(1 / 60, 0, 0, false, true, eb);
  assert(ev.refused && !ev.leap, 'under a bridge: the small hop');
  top = 0;
  for (let s = 0; s < 60; s++) { B.step(1 / 60, 0, 0, false, false, eb); top = Math.max(top, B.lift); }
  assert(top > 0.4 && top < 0.6, 'the hop is about 0.5 high (' + top.toFixed(2) + ')');
});

await test('S4', 'ride: the world edge U-turns (no toast, no stall over 0.5 s); blocks in the rider end it; the hop-off spot', () => {
  const w = seaWorld({ island: false });
  const env = envFor(w, 1);
  env.bodyBlocked = () => false;
  const R = new DolphinRide();
  R.start(32.5, 32.5, Math.PI / 2, 10);
  let shallow = 0, uturns = 0;
  for (let s = 0; s < 300; s++) {
    const ev = R.step(1 / 60, 1, 0, true, false, env); // steering straight at the east edge for 5 s
    if (ev.shallow) shallow++;
    if (ev.uturn) uturns++;
  }
  assert(shallow === 0, 'no shallow toast at the edge');
  assert(uturns >= 1, 'a U-turn');
  assert(R.stats.maxStall <= 0.5, 'longest stall ' + R.stats.maxStall.toFixed(2) + ' s');
  // a block at level + 1 or + 2 on the dolphin's cell ends the ride on the next step
  for (const dy of [1, 2]) {
    const w2 = seaWorld({ island: false });
    const e2 = envFor(w2, 2);
    e2.bodyBlocked = () => false;
    const B = new DolphinRide();
    B.start(30.5, 30.5, 0, 10);
    B.step(1 / 60, 0, 0, false, false, e2);
    w2.set(30, 10 + dy, 30, STONE);
    const ev = B.step(1 / 60, 0, 0, false, false, e2);
    assert(ev.end === 'blocked', `a block at level + ${dy}: blocked (${ev.end})`);
  }
  // the water under it goes away
  const w3 = seaWorld({ island: false });
  const e3 = envFor(w3, 3);
  const W = new DolphinRide();
  W.start(30.5, 30.5, 0, 10);
  w3.fill(30, 5, 30, 30, 10, 30, AIR);
  assert(W.step(1 / 60, 0, 0, false, false, e3).end === 'water', 'the water went away');
  // the ahead check refuses a column with a block at level + 2
  const w4 = seaWorld({ island: false });
  const e4 = envFor(w4, 4);
  e4.bodyBlocked = () => false;
  const A = new DolphinRide();
  A.start(30.5, 20.5, 0, 10);
  for (let x = 0; x < 64; x++) w4.set(x, 12, 24, STONE);
  for (let s = 0; s < 240; s++) A.step(1 / 60, 0, 1, false, false, e4);
  assert(A.z < 24, 'stops before a block at level + 2 (z ' + A.z.toFixed(2) + ')');
  // the hop-off spot: in the water, a free body; standSpot is the same
  const H = new DolphinRide();
  H.start(30.5, 30.5, 0.3, 10);
  const blocked = (x, y, z) => x > 30.5; // the right side is blocked
  const spot = H.hopSpot({ map: env.map, bodyBlocked: blocked });
  assert(env.map.top(spot[0], spot[2]) === 10 && Math.abs(spot[1] - 10.1) < 1e-9 && !blocked(spot[0], spot[1], spot[2]), 'the hop-off spot is in the water, free');
});

// =====================================================================================
// S6 presence
// =====================================================================================

await test('S6', 'presence parsers: sr 0..15, sk 0..65535', () => {
  for (let v = 0; v <= 15; v++) assert(parseSeaRide(v) === v, 'sr ' + v);
  for (const bad of [-1, 16, 1.5, '3', null, [], {}, NaN]) assert(parseSeaRide(bad) === null, 'sr refused ' + String(bad));
  for (const v of [0, 1, 4096, 65535]) assert(parseSeaTrick(v) === v, 'sk ' + v);
  for (const bad of [-1, 65536, 1.5, '3', null, [], {}, NaN]) assert(parseSeaTrick(bad) === null, 'sk refused ' + String(bad));
});

// =====================================================================================
// S9 static scans
// =====================================================================================

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

await test('S10', 'glass: a see-through block between the camera and an animal is found; water, air and the end cells are not', () => {
  // ids: 0 air, 1 water (liquid, pass 3), 2 stained glass (pass 3), 3 stone (pass 1)
  const pass = Uint8Array.from([0, 3, 3, 1]), shape = Uint8Array.from([SHAPES.air, SHAPES.liquid, SHAPES.cube, SHAPES.cube]);
  const cells = new Map();
  const w = { get: (x, y, z) => cells.get(`${x},${y},${z}`) || 0 };
  // water everywhere below y 5
  for (let x = -2; x < 30; x++) for (let z = -2; z < 30; z++) for (let y = 0; y < 5; y++) cells.set(`${x},${y},${z}`, 1);
  assert(!glassBetween(w, pass, shape, 0.5, 7.5, 0.5, 10.5, 3.5, 12.5), 'through water only: no glass');
  cells.set('5,5,6', 2);
  let hits = 0, n = 0;
  for (let k = 0; k < 40; k++) {
    // lines through the glass cell (5, 5, 6) from many cameras, all ending at (9.5, 3.5, 10.5)
    const a = (k / 40) * Math.PI * 2, cx = 5.5 + Math.sin(a) * 0.3, cz = 6.5 + Math.cos(a) * 0.3;
    const ax = 9.5 + (cx - 9.5) * 2, ay = 3.5 + (5.5 - 3.5) * 2, az = 10.5 + (cz - 10.5) * 2;
    n++;
    if (glassBetween(w, pass, shape, ax, ay, az, 9.5, 3.5, 10.5)) hits++;
  }
  assert(hits === n, `every line through the glass finds it (${hits} of ${n})`);
  assert(!glassBetween(w, pass, shape, 5.5, 5.5, 6.5, 9.5, 3.5, 10.5), 'the camera inside the glass cell itself: skipped');
  assert(!glassBetween(w, pass, shape, 0.5, 5.5, 0.5, 5.5, 5.5, 6.5), 'the animal inside the glass cell itself: skipped');
  assert(!glassBetween(w, pass, shape, 0.5, 9.5, 0.5, 20.5, 9.5, 20.5), 'a line above it: none');
  assert(!glassBetween(w, pass, shape, 0, 9, 0, 60, 3, 60), 'over 48 blocks: none (fogged)');
  for (const [a, b] of [[[0, 0, 0], [0, 0, 0]], [[NaN, 1, 1], [2, 2, 2]]]) assert(glassBetween(w, pass, shape, ...a, ...b) === false, 'degenerate lines are false');
  return `${hits} of ${n} lines`;
});

await test('S10', 'glass meshes: only the animals seen through glass draw in their kind\'s glass mesh (before the glass), the rest stay as they were', async () => {
  const THREE = await import('three');
  const { SeaMeshes } = await import('../src/life/ocean/render.js');
  const { hexToLinear } = await import('../src/life/ocean/kinds.js');
  const { SEA_ORDER, SEA_BEHIND } = await import('../src/life/ocean/material.js');
  const M = new SeaMeshes(new THREE.Scene());
  const rand = mulberry32(9);
  const list = [];
  for (let i = 0; i < 20; i++) { const r = makeRecord('fish', i); r.uid = i; r.on = true; r.fade = 1; r.level = 10; list.push(r); }
  const K = M.k.fish;
  for (let round = 0; round < 100; round++) {
    for (const r of list) { r.behind = rand() < 0.2; if (rand() < 0.1) { r.variant = Math.floor(rand() * PALETTES.fish.length); r.tintVer++; } }
    const n = M.write('fish', [list]);
    const front = list.filter((r) => !r.behind), back = list.filter((r) => r.behind);
    assert(n === 20 && K.n === front.length && K.back.n === back.length, `round ${round}: ${K.n} + ${K.back.n} split as ${front.length} + ${back.length}`);
    assert(K.mesh.visible === front.length > 0 && K.back.mesh.visible === back.length > 0, 'a lane at count 0 is hidden (no draw call)');
    for (const [L, recs, wet] of [[K, front, true], [K.back, back, false]]) {
      recs.forEach((r, k) => {
        const want = hexToLinear(PALETTES.fish[r.variant][1]);
        const t = L.iTint.array, u = L.iSurf.array;
        assert(Math.abs(t[k * 4] - want[0]) < 1e-6 && Math.abs(t[k * 4 + 2] - want[2]) < 1e-6, `round ${round}: a slot keeps its fish's palette`);
        assert(wet ? u[k * 4] > -1e3 : u[k * 4] === -1e4, wet ? 'in front: the water over it' : 'behind glass: untinted');
      });
    }
  }
  assert(K.mesh.renderOrder === SEA_ORDER && K.back.mesh.renderOrder === SEA_BEHIND && SEA_BEHIND < 0 && SEA_ORDER > 0, 'the glass mesh draws before the see-through chunks, the front one after the water');
  for (const r of list) r.behind = false;
  M.write('fish', [list]);
  assert(K.n === 20 && K.back.n === 0 && !K.back.mesh.visible, 'none behind glass: one mesh, as before');
  // within the draw-call budget (render.js glassLanes): a kind split by the glass gets its second
  // mesh only while calls are spare; with every kind out it draws all its animals behind the glass
  const { glassLanes, SEA_CALLS } = await import('../src/life/ocean/render.js');
  const calls = (live, lanes) => SEA_KINDS.reduce((a, k) => a + (live[k] > 0 ? 1 : 0) + (lanes[k] === null ? 1 : 0), 0);
  let splits = 0;
  for (let round = 0; round < 500; round++) {
    const live = {}, back = {};
    for (const k of SEA_KINDS) { live[k] = rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 8); back[k] = rand() < 0.5 ? 0 : Math.floor(rand() * (live[k] + 1)); }
    const lanes = glassLanes(live, back, {});
    assert(calls(live, lanes) <= SEA_CALLS && SEA_CALLS === 9, `round ${round}: ${calls(live, lanes)} calls`);
    for (const k of SEA_KINDS) {
      if (back[k] === 0) assert(lanes[k] === false, 'none behind glass: the front mesh');
      else if (back[k] >= live[k]) assert(lanes[k] === true, 'all behind glass: the glass mesh');
      else { assert(lanes[k] !== false, 'never one pasted over the glass'); if (lanes[k] === null) splits++; }
    }
  }
  const few = glassLanes({ fish: 8, dolphin: 3 }, { fish: 2 }, {});
  assert(few.fish === null && few.dolphin === false, 'a few kinds out: the school splits (only the 2 fish behind the ice)');
  const all = {}, one = { fish: 2 };
  for (const k of SEA_KINDS) all[k] = 4;
  assert(glassLanes(all, one, {}).fish === true, 'every kind out, nothing known of the view: no 10th call, the split school draws behind the glass');
  // short of calls (every kind out, a whale visit): the spare call goes to the kind with the most
  // animals in front of the glass (the school, not two far-off dolphins), and kinds with nothing in
  // view are not drawn at all (no call), so a school by an ice floe keeps its own lanes
  const front = {}, seen = {}, hide = {};
  for (const k of SEA_KINDS) { front[k] = 4; seen[k] = 4; }
  const live8 = { ...all }, back8 = { fish: 2, dolphin: 1 };
  live8.fish = 8; front.fish = 6; front.dolphin = 1; seen.dolphin = 2;
  const busy = glassLanes(live8, back8, {}, SEA_CALLS, front, seen, hide);
  assert(calls(live8, busy) <= SEA_CALLS + 1, 'busy: within the calls');
  const off = {}, lanesB = {};
  for (const k of SEA_KINDS) off[k] = 0;
  off.crab = 1; // the crabs behind her: out of view
  const seenB = { ...seen, crab: 0 };
  glassLanes(live8, back8, lanesB, SEA_CALLS, front, seenB, hide);
  const drawn = (live, lanes, hid) => SEA_KINDS.reduce((a, k) => a + (live[k] > 0 && !hid[k] ? 1 : 0) + (lanes[k] === null && !hid[k] ? 1 : 0), 0);
  assert(hide.crab === true && lanesB.fish === null && drawn(live8, lanesB, hide) <= SEA_CALLS, `busy with the crabs out of view: the crabs are not drawn and the school and the dolphins both split (${JSON.stringify(lanesB)})`);
  // every kind in view (a whale visit): no call to spare; a kind goes to the side most of it is on
  const seenC = { ...seen, fish: 8 };
  const lanesC = glassLanes(live8, back8, {}, SEA_CALLS, front, seenC, hide);
  assert(lanesC.fish === false && lanesC.dolphin === true && drawn(live8, lanesC, hide) <= SEA_CALLS, `busy with every kind in view: the school (6 in front, 2 behind the ice) stays bright, the dolphins (1 in front, 1 behind) go behind the glass (${JSON.stringify(lanesC)})`);
  const steady = { fish: false };
  glassLanes(live8, back8, steady, SEA_CALLS, { ...front, fish: 4 }, { ...seenC, fish: 6 }, hide);
  assert(steady.fish === false, 'once bright it stays bright down to 1.5 times as many in front (4 to 2: no flip)');
  const faint = { fish: true };
  glassLanes(live8, back8, faint, SEA_CALLS, { ...front, fish: 4 }, { ...seenC, fish: 6 }, hide);
  assert(faint.fish === true, 'and once behind the glass it needs 3 times as many in front to come out');
  // steady: the kind holding the spare call keeps it against a near equal (+2), so it never flips
  const eq = { ...front, fish: 5, dolphin: 4 }, live1 = { ...live8, crab: 0 };
  const fresh = glassLanes(live1, back8, {}, SEA_CALLS, eq, seenC, hide);
  assert(fresh.fish === null && fresh.dolphin !== null, 'one spare call: the school (5 in front) gets it before the dolphins (4)');
  const keep2 = { dolphin: null };
  glassLanes(live1, back8, keep2, SEA_CALLS, eq, seenC, hide);
  assert(keep2.dolphin === null && keep2.fish !== null, 'but dolphins already holding it keep it against a school with one more in front (no flip)');
  // random busy rounds: never past the calls, a hidden kind is never drawn, the best front count wins
  let rounds = 0;
  for (let round = 0; round < 500; round++) {
    const live = {}, back = {}, fr = {}, sn = {}, out = {};
    for (const k of SEA_KINDS) {
      live[k] = rand() < 0.15 ? 0 : 1 + Math.floor(rand() * 8);
      back[k] = rand() < 0.4 ? 0 : Math.floor(rand() * (live[k] + 1));
      sn[k] = rand() < 0.2 ? 0 : Math.floor(rand() * (live[k] + 1));
      fr[k] = Math.max(0, Math.min(sn[k], live[k] - back[k]));
    }
    const h = {};
    glassLanes(live, back, out, SEA_CALLS, fr, sn, h);
    assert(drawn(live, out, h) <= SEA_CALLS, `busy round ${round}: ${drawn(live, out, h)} calls`);
    let bestLeft = -1, worstGot = Infinity;
    for (const k of SEA_KINDS) {
      if (h[k]) { assert(!(sn[k] > 0), 'only a kind with nothing in view is hidden'); continue; }
      const split = live[k] > 0 && back[k] > 0 && back[k] < live[k];
      if (!split) continue;
      assert(out[k] !== false || fr[k] >= 3 * Math.max(1, sn[k] - fr[k]), 'one drawn over the glass only when 3 times as many are in front');
      if (out[k] === null) worstGot = Math.min(worstGot, fr[k]); else bestLeft = Math.max(bestLeft, fr[k]);
    }
    assert(bestLeft <= worstGot, `busy round ${round}: the spare calls go to the most animals in front`);
    rounds++;
  }
  return `100 rounds; 500 budget rounds (${splits} splits); ${rounds} busy rounds`;
});

/**
 * A school of n fish in open water (index.js _stepSchools, without the brain): 'old' = each fish on
 * its own random orbit (before this round), 'new' = the school's rings (fishSlot), turning together.
 * spaced: spaceFish runs (cam: also across the view from cam). Returns per-frame stats; look(fish)
 * is called every settled frame.
 */
function schoolRun({ noView = false, layout = 'new', spaced = true, seed = 1, floe = false, fps = 60, n = 10, secs = 60, cam = null, look = null, drift = false }) {
  const w = seaWorld({ sx: 64, sz: 64, island: false });
  // floe: an ice floe on the sea (as snow worlds put near the shore) 1.5 blocks from the school's centre
  if (floe) w.fill(34, 10, 30, 36, 10, 35, ICE);
  const env = envFor(w, seed);
  const rand = mulberry32(seed);
  const school = { x: 32.5, z: 32.5, level: env.map.top(32, 32), scatter: 0 };
  const surf = school.level + SURF;
  const fish = [];
  // her camera (or, none given, the player 10 blocks off at a bearing of the seed's)
  const eye = cam || { x: school.x - Math.sin(seed * 1.7) * 10, z: school.z - Math.cos(seed * 1.7) * 10 };
  if (layout !== 'old') { school.glideT = rand() * 14; schoolFrame(school, eye.x, eye.z, 0); }
  for (let i = 0; i < n; i++) {
    const f = makeRecord('fish', i);
    f.on = true; f.level = school.level; f.scale = 0.85 + rand() * 0.3; f.yoff = rand();
    if (layout === 'old') {
      f.orbit = rand() * 6.28; f.orbitR = 0.6 + rand() * 1.1;
      f.orbitW = (0.6 + rand() * 0.8) * (rand() < 0.5 ? -1 : 1);
    } else fishSlot(f, i, n);
    f.y = surf - 0.38;
    placeFish(f, school, env); // spawned in place (index.js _spawnSchool)
    fish.push(f);
  }
  let close = 0, frames = 0, minD = Infinity, maxSep = 0, jump = 0;
  const px = new Float64Array(n), pz = new Float64Array(n);
  const dt = 1 / fps, settle = 2 * fps;
  // drift: the school swims toward her and away again at the fish's speed (4 blocks each way)
  const x0 = school.x, z0 = school.z, dl = Math.hypot(x0 - eye.x, z0 - eye.z) || 1;
  for (let step = 0; step < secs * fps; step++) {
    if (drift) {
      const k = 4 * Math.sin(step * dt * 0.4);
      school.x = x0 + ((x0 - eye.x) / dl) * k; school.z = z0 + ((z0 - eye.z) / dl) * k;
    }
    if (layout !== 'old') schoolFrame(school, eye.x, eye.z, dt);
    for (const f of fish) {
      f.orbit += f.orbitW * dt; placeFish(f, school, env, spaced ? dt : 0);
      f.phase += dt * 6;
      f.y = fishY(f, school, surf, true, cam ? cam.y : undefined); // (index.js: the rows' lift, the school's bob)
    }
    if (spaced) spaceFish(fish, 0, fish.length, dt, school, env, noView ? null : cam);
    if (step >= settle) for (let i = 0; i < n; i++) jump = Math.max(jump, Math.hypot(fish[i].x - px[i], fish[i].z - pz[i]));
    for (let i = 0; i < n; i++) { px[i] = fish[i].x; pz[i] = fish[i].z; }
    if (step < settle) continue; // settled
    frames++;
    let blob = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(fish[i].x - fish[j].x, fish[i].z - fish[j].z);
      if (d < minD) minD = d;
      if (d < 0.4) blob = true; // closer than half a fish's width each side: two heads, one body
    }
    if (blob) close++;
    for (const f of fish) {
      maxSep = Math.max(maxSep, Math.hypot(f.sepX, f.sepZ));
      assert(Number.isFinite(f.x) && Number.isFinite(f.z), 'finite');
      assert(props.shape[w.get(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z))] === SHAPES.liquid, 'in its water');
    }
    if (look) look(fish, school);
  }
  return { share: close / frames, minD, maxSep, jump, frames };
}

await test('S11', 'fish spacing: a school of 10 seldom overlaps into one blob, stays in its water, and never pops across by an ice floe', () => {
  const out = [];
  let worst = 0, worstOld = 1, gap = Infinity;
  for (let seed = 1; seed <= 6; seed++) {
    const a = schoolRun({ layout: 'old', spaced: false, seed }), b = schoolRun({ seed, n: seed % 2 ? 10 : 8 });
    out.push(`${seed}: ${(a.share * 100).toFixed(0)}% -> ${(b.share * 100).toFixed(1)}% (step ${a.jump.toFixed(3)} -> ${b.jump.toFixed(3)}, closest ${b.minD.toFixed(2)})`);
    assert(b.jump <= 0.08, `no darting: a fish moves at most 0.08 a frame at 60 fps (${b.jump.toFixed(3)})`);
    worst = Math.max(worst, b.share);
    worstOld = Math.min(worstOld, a.share);
    gap = Math.min(gap, b.minD);
    assert(b.maxSep <= 2, `the offset stays small (${b.maxSep.toFixed(2)})`);
  }
  // by an ice floe (snow worlds): orbit points on the ice move in along their line; a fish whose
  // place jumps swims there (FISH_STEP) instead of popping across (before: steps of 1.1 to 1.3 a frame)
  const floeOut = [];
  for (let seed = 1; seed <= 6; seed++) {
    const a = schoolRun({ layout: 'old', spaced: false, seed, floe: true }), b = schoolRun({ seed, floe: true });
    floeOut.push(`${seed}: ${(a.share * 100).toFixed(0)}% -> ${(b.share * 100).toFixed(1)}% (step ${a.jump.toFixed(3)} -> ${b.jump.toFixed(3)})`);
    assert(b.share < 0.03, `by a floe: at most 3% of frames have two fish in one blob (${floeOut.join(', ')})`);
    assert(b.jump <= FISH_STEP / 60 + 0.05, `by a floe: no fish pops across (a step of ${b.jump.toFixed(3)} a frame, at most ${(FISH_STEP / 60 + 0.05).toFixed(3)})`);
    assert(b.maxSep <= 2, `by a floe: the offset stays small (${b.maxSep.toFixed(2)})`);
  }
  assert(worstOld > 0.1, `without the rings and spacing a school overlaps often (the old look; ${out.join(', ')})`);
  assert(worst < 0.005 && gap >= 1.0, `in open water no two fish closer than 1.0 (closest ${gap.toFixed(2)}; FISH_APART ${FISH_APART}; ${out.join(', ')})`);
  // an older iPad at 20 fps: the spacing works per second, not per frame
  const slowOut = [];
  for (let seed = 1; seed <= 4; seed++) {
    for (const floe of [false, true]) {
      const b = schoolRun({ seed, floe, fps: 20 });
      slowOut.push(`${seed}${floe ? ' floe' : ''}: ${(b.share * 100).toFixed(1)}%`);
      assert(b.share < 0.03, `at 20 fps at most 3% of frames have two fish in one blob (${slowOut.join(', ')})`);
      assert(b.jump <= FISH_STEP / 20 + 0.13, `at 20 fps no fish pops across (${b.jump.toFixed(3)})`);
    }
  }
  return out.join(', ') + '; by a floe ' + floeOut.join(', ') + '; at 20 fps ' + slowOut.join(', ');
});

await test('S12', 'fish from her camera: school mates seldom sit one over another on the screen (no fish with four eyes)', async () => {
  // a real camera (fov 70, 4:3) and each fish's real box (models.js), turned by its yaw: a pair is
  // "stacked" when the smaller of the two boxes on the screen is more than a quarter covered by the
  // other (a face peeking out at the edge). Cameras: her play camera (about 3 above the water,
  // 9 to 12 away), a lower one, and one at the surface; 8 and 10 fish; 30 s each.
  const THREE = await import('three');
  const { geometryFor } = await import('../src/life/ocean/models.js');
  const g = geometryFor('fish');
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 200);
  const v = new THREE.Vector3();
  const rects = [];
  for (let i = 0; i < 10; i++) rects.push([0, 0, 0, 0]);
  const measure = (camPos) => {
    let frames = 0, stacked = 0, pairs = 0;
    const look = (fish, school) => {
      camera.position.set(camPos.x, camPos.y, camPos.z);
      camera.lookAt(school.x, school.level + SURF - 0.4, school.z);
      camera.updateMatrixWorld();
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i], R = rects[i];
        R[0] = R[1] = Infinity; R[2] = R[3] = -Infinity;
        const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
        for (let k = 0; k < 8; k++) {
          const lx = (k & 1 ? bb.max.x : bb.min.x) * f.scale, ly = (k & 2 ? bb.max.y : bb.min.y) * f.scale, lz = (k & 4 ? bb.max.z : bb.min.z) * f.scale;
          v.set(f.x + lx * c + lz * s, f.y + ly, f.z - lx * s + lz * c).project(camera);
          R[0] = Math.min(R[0], v.x); R[1] = Math.min(R[1], v.y); R[2] = Math.max(R[2], v.x); R[3] = Math.max(R[3], v.y);
        }
      }
      let any = 0;
      for (let i = 0; i < fish.length; i++) for (let j = i + 1; j < fish.length; j++) {
        const A = rects[i], B = rects[j];
        const ix = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), iy = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
        if (ix <= 0 || iy <= 0) continue;
        const small = Math.min((A[2] - A[0]) * (A[3] - A[1]), (B[2] - B[0]) * (B[3] - B[1]));
        if (ix * iy > 0.25 * small) { any++; pairs++; }
      }
      frames++;
      if (any) stacked++;
    };
    return { look, get: () => ({ share: stacked / Math.max(1, frames), pairs: pairs / Math.max(1, frames) }) };
  };
  const out = [];
  let oldSum = 0, rowSum = 0, newSum = 0, worst = 0, runs = 0;
  for (const [h, far] of [[3.0, 11], [3.0, 9], [1.5, 9], [0.1, 9], [3.7, 16]]) {
    for (const seed of [1, 2, 3]) {
      const n = seed === 2 ? 8 : 10;
      const bear = seed * 2.1;
      const school0 = { x: 32.5, z: 32.5 };
      const camPos = { x: school0.x - Math.sin(bear) * far, y: 10 + SURF + h, z: school0.z - Math.cos(bear) * far };
      // (seaWorld: the water's top block is at level 10; the camera h above its surface)
      // before (each fish on its own orbit, spaced 3D only), the rows alone, the rows spaced across the view
      const mo = measure(camPos), mr = measure(camPos), mn = measure(camPos);
      schoolRun({ layout: 'old', spaced: true, seed, n, secs: 30, look: mo.look });
      schoolRun({ seed, n, secs: 30, cam: camPos, look: mr.look, noView: true });
      schoolRun({ seed, n, secs: 30, cam: camPos, look: mn.look });
      const o = mo.get(), rw = mr.get(), nw = mn.get();
      oldSum += o.pairs; rowSum += rw.pairs; newSum += nw.pairs; runs++;
      worst = Math.max(worst, nw.pairs);
      out.push(`h ${h} d ${far} n ${n}: ${o.pairs.toFixed(2)} / ${rw.pairs.toFixed(2)} / ${nw.pairs.toFixed(2)} pairs (${(nw.share * 100).toFixed(0)}% of frames)`);
    }
  }
  // a school swimming toward her and away (the real game's schools travel): its fish keep their
  // sides to her (sideOn), so a fish's length never covers the row behind it
  const dOut = [];
  let dSum = 0, dWorst = 0;
  // (3.3 up and 14 to 21 away: her play camera with the school wandered off, R-F's far runs)
  for (const [h, far] of [[3.0, 11], [3.0, 9], [1.5, 9], [3.7, 16], [3.3, 15], [3.3, 19]]) {
    for (const seed of [1, 3]) {
      const bear = seed * 2.1, school0 = { x: 32.5, z: 32.5 };
      const camPos = { x: school0.x - Math.sin(bear) * far, y: 10 + SURF + h, z: school0.z - Math.cos(bear) * far };
      const md = measure(camPos);
      schoolRun({ seed, n: 10, secs: 30, cam: camPos, look: md.look, drift: true });
      const r = md.get();
      dSum += r.pairs; dWorst = Math.max(dWorst, r.pairs);
      dOut.push(`h ${h} d ${far}: ${r.pairs.toFixed(2)}`);
    }
  }
  out.push(`swimming toward her and away: ${(dSum / dOut.length).toFixed(2)} pairs a frame (${dOut.join(', ')})`);
  assert(dSum / dOut.length <= 0.3 && dWorst <= 0.6, `a school swimming toward her and away: at most 0.3 stacked pairs a frame on average, 0.6 from any camera (${dOut.join(', ')})`);
  assert(newSum < oldSum * 0.1 && newSum < rowSum * 0.5, `far fewer stacked fish than before and than the rows alone (${(oldSum / runs).toFixed(2)} / ${(rowSum / runs).toFixed(2)} / ${(newSum / runs).toFixed(2)} pairs a frame; ${out.join(', ')})`);
  assert(newSum / runs <= 0.3 && worst <= 0.6, `at most 0.3 stacked pairs a frame on average, 0.6 from any camera (${out.join(', ')})`);
  return `before / rows / rows spaced across the view: ${(oldSum / runs).toFixed(2)} / ${(rowSum / runs).toFixed(2)} / ${(newSum / runs).toFixed(2)} stacked pairs a frame; ${out.join(', ')}`;
});

await test('S13', 'dolphin flukes: each lobe grows out of the fluke root (no loose pieces) and sweeps back to its tip', async () => {
  const THREE = await import('three');
  const { dolphinKit } = await import('../src/life/ocean/models.js');
  const parts = dolphinKit().parts;
  const root = parts.find((p) => p.cx === 0 && Math.abs(p.cz + 1.08) < 1e-9);
  const stock = parts.find((p) => p.cx === 0 && Math.abs(p.cz + 0.82) < 1e-9);
  const lobes = parts.filter((p) => Math.abs(p.cx) > 0.05 && p.cz < -1.0 && p.mask === 1);
  assert(root && stock && lobes.length === 2, `a fluke root, a tail stock and two lobes (${lobes.length})`);
  const inside = (e, v) => Math.hypot((v.x - e.cx) / e.sx, (v.y - e.cy) / e.sy, (v.z - e.cz) / e.sz);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
  const out = [];
  for (const L of lobes) {
    q.setFromEuler(new THREE.Euler(...(L.rot || [0, 0, 0])));
    m.compose(new THREE.Vector3(L.cx, L.cy, L.cz), q, new THREE.Vector3(L.sx, L.sy, L.sz));
    const P = L.g.attributes.position;
    let deep = Infinity, tip = null, inner = null;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      deep = Math.min(deep, inside(root, v), inside(stock, v));
      const out = Math.abs(v.x);
      if (!tip || out > Math.abs(tip.x)) tip = v.clone();
      if (!inner || out < Math.abs(inner.x)) inner = v.clone();
    }
    assert(deep < 0.5, `a lobe reaches well inside the fluke root or the tail stock (deepest ${deep.toFixed(2)}, needs under 0.5)`);
    assert(tip.z < inner.z - 0.1, `a lobe's tip is further back than its root (tip z ${tip.z.toFixed(2)}, root z ${inner.z.toFixed(2)})`);
    assert(Math.abs(tip.x) > 0.3, `the flukes spread wide (${Math.abs(tip.x).toFixed(2)})`);
    out.push(`deepest ${deep.toFixed(2)}, tip ${tip.toArray().map((n) => n.toFixed(2)).join(' ')}, root z ${inner.z.toFixed(2)}`);
  }
  return out.join('; ');
});

await test('S9', 'static: no while loops in the ocean folder; the strings are kind, brand-free and character-free', async () => {
  const dir = path.join(ROOT, 'src/life/ocean');
  for (const f of readdirSync(dir)) {
    const src = stripComments(readFileSync(path.join(dir, f), 'utf8'));
    assert(!/\bwhile\s*\(/.test(src), `no while loop in ${f}`);
  }
  const chat = await import('../src/things/friends/chat.js');
  const L = chat.LINES;
  const strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(SEA_TEXT);
  walk(DOLPHIN_NAMES);
  walk(SEA_NAMES);
  walk([L.events['sea:meet'], L.events['sea:ride'], L.seaKinds, L.seaInvite]);
  const { OCEAN_STICKERS } = await import('../src/life/ocean/stickers.js');
  for (const s of OCEAN_STICKERS) strings.push(s.name, s.hint);
  for (const s of strings) {
    assert(!/\$|\bbuy|\bprice|\bcoin|\bpay\b|\bshop/i.test(s), 'no prices or buying: ' + s);
    assert(!/\b(she|her)\b/i.test(s), 'no "she" or "her" about the player: ' + s);
    eq0(scanText(s, { extras: true }).length, 'no forbidden name in: ' + s);
    eq0(scanCharacters(s).length, 'no famous character in: ' + s);
    assert(s.length <= 60, 'short: ' + s);
  }
  // dolphin names: no repeats, none is a pet name in the game
  assert(new Set(DOLPHIN_NAMES).size === DOLPHIN_NAMES.length, 'dolphin names are different');
  const petDir = path.join(ROOT, 'src/things/pets');
  const petSrc = readdirSync(petDir).map((f) => readFileSync(path.join(petDir, f), 'utf8')).join('\n');
  const petNames = new Set();
  for (const m of petSrc.matchAll(/names:\s*\[([^\]]*)\]/g)) for (const n of m[1].matchAll(/'([^']+)'/g)) petNames.add(n[1]);
  for (const m of petSrc.matchAll(/COMMON_NAMES\s*=\s*\[([^\]]*)\]/g)) for (const n of m[1].matchAll(/'([^']+)'/g)) petNames.add(n[1]);
  assert(petNames.size > 20, 'pet names found (' + petNames.size + ')');
  for (const n of DOLPHIN_NAMES) assert(!petNames.has(n), 'not a pet name: ' + n);
  // every string kids read (§7) is in SEA_TEXT, and the help cards use them
  const touch = readFileSync(path.join(ROOT, 'src/ui/touch.js'), 'utf8');
  for (const k of ['helpTouch', 'helpKeys', 'helpHop']) assert(touch.includes(`'${SEA_TEXT[k]}'`), 'touch.js uses SEA_TEXT.' + k);
  for (const k of SEA_KINDS) assert(SEA_TEXT.met[k] && SEA_TEXT.met[k].includes(SEA_NAMES[k]), 'a first-meet line for ' + k);
  return `${strings.length} strings`;
});

await test('S14', 'animals of different kinds keep apart (no fish on a dolphin\'s back, no octopus on its tail), cheaply', () => {
  const FIXED = { leap: 1, trick: 1, ride: 1, hold: 1, mount: 1, gallery: 1, buddy: 1 };
  const w = seaWorld({ sx: 64, sz: 64, island: false });
  const env = envFor(w, 3);
  const level = env.map.top(32, 32);
  const mk = (kind, i, x, z, state = 'swim') => {
    const r = makeRecord(kind, i);
    r.on = true; r.level = level; r.x = x; r.z = z; r.y = level + SURF - 0.4; r.state = state;
    if (kind === 'octopus') r.y = level - 3;
    return r;
  };
  const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // a fish on a dolphin's back, an octopus right under its tail, a jelly on a turtle
  const dol = mk('dolphin', 0, 32.5, 32.5), fish = mk('fish', 1, 32.6, 32.4), oct = mk('octopus', 2, 32.9, 32.5);
  const tur = mk('sea_turtle', 3, 40.5, 40.5), jel = mk('jelly', 4, 40.5, 40.6);
  const list = [dol, fish, oct, tur, jel];
  let step = 0;
  for (let f = 0; f < 3 * 60; f++) {
    apartKinds(list, list.length, env, FIXED);
    for (const r of list) step = Math.max(step, Math.hypot(r.x - (r.px ?? r.x), r.z - (r.pz ?? r.z)));
    for (const r of list) { r.px = r.x; r.pz = r.z; }
  }
  const want = (a, b) => CROSS[a.kind] + CROSS[b.kind];
  for (const [a, b] of [[dol, fish], [dol, oct], [fish, oct], [tur, jel]]) {
    assert(gap(a, b) >= want(a, b) - 0.05, `${a.kind} and ${b.kind} apart after 3 s (${gap(a, b).toFixed(2)}, want ${want(a, b).toFixed(2)})`);
  }
  assert(step <= 0.161, `none darts: at most 0.16 a frame (${step.toFixed(3)})`);
  assert(Math.hypot(fish.sepX, fish.sepZ) > 0.3, 'the fish keeps its push in its spacing offset (eases back to its school after)');
  // the dolphin she rides does not move: the fish swims out of the way alone
  const ride = mk('dolphin', 5, 20.5, 20.5, 'ride'), f2 = mk('fish', 6, 20.7, 20.5);
  for (let f = 0; f < 3 * 60; f++) apartKinds([ride, f2], 2, env, FIXED);
  assert(ride.x === 20.5 && ride.z === 20.5, 'a ridden dolphin is never pushed');
  assert(gap(ride, f2) >= want(ride, f2) - 0.05, `a fish leaves the ridden dolphin's back (${gap(ride, f2).toFixed(2)})`);
  // far apart up and down (deep water): left alone
  const d3 = mk('dolphin', 7, 10.5, 50.5), o3 = mk('octopus', 8, 10.5, 50.5);
  o3.y = d3.y - CROSS_UP - 1;
  apartKinds([d3, o3], 2, env, FIXED);
  assert(d3.x === 10.5 && o3.x === 10.5, 'animals far apart up and down are left alone');
  // its own kind is APART's / spaceFish's job
  const fa = mk('fish', 9, 50.5, 10.5), fb = mk('fish', 10, 50.6, 10.5);
  apartKinds([fa, fb], 2, env, FIXED);
  assert(fa.x === 50.5 && fb.x === 50.6, 'two of one kind are not pushed here');
  // cost: every swimmer kind at its cap (14 + 30 + 3 + 2 + 8 + 6 = 63) bunched in one 12 x 12 patch
  const rand = mulberry32(5), many = [];
  const caps = { dolphin: 14, fish: 30, sea_turtle: 3, octopus: 2, jelly: 8, seahorse: 6 };
  let id = 0;
  for (const k in caps) for (let i = 0; i < caps[k]; i++) many.push(mk(k, id++, 26 + rand() * 12, 26 + rand() * 12));
  for (let f = 0; f < 60; f++) apartKinds(many, many.length, env, FIXED);
  // the best of three rounds of 200 frames (a busy machine does not decide it; a real slowdown is slow in all three)
  let ms = Infinity;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    for (let f = 0; f < 200; f++) apartKinds(many, many.length, env, FIXED);
    ms = Math.min(ms, (performance.now() - t0) / 200);
  }
  assert(ms < 0.1, `63 swimmers a frame cost ${ms.toFixed(3)} ms (< 0.1)`);
  return `apart after 3 s: dolphin/fish ${gap(dol, fish).toFixed(2)}, dolphin/octopus ${gap(dol, oct).toFixed(2)}, turtle/jelly ${gap(tur, jel).toFixed(2)}; 63 swimmers ${ms.toFixed(3)} ms a frame`;
});

function eq0(n, msg) {
  assert(n === 0, msg);
}

console.log(`\n${passed} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
