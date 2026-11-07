// Cruise Ship world generation tests (docs/teams/cruise-world.md), no browser:
//   node tools/test-cruise-world.mjs [--only=C1,C2,...] [--seeds=1..5]
// Generates the ship for seeds 1..5 in Cozy and Big worlds and checks:
//   C1 time        generate() stays under the budget (300 ms Big in Node, with headroom for CI)
//   C2 spawn       spawn on the pool deck: solid floor, two free cells
//   C3 features    every record's cells are free (air), standing on a solid floor; floats on water;
//                  no two records share a cell; the counts the plan asks for (§4.1)
//   C4 slides      paths continuous (each step <= 1.5), never climbing, <= 240 points, end in water
//   C5 lifts       every stop has a solid floor and two free cells over it
//   C6 blocks      no unknown block (no warning, every id registered), the block budget
//   C7 sea         water at the sea level for 8+ cells to every edge of the world
//   C8 sizes       the furniture sizes the generator assumes match the catalogs' sources
//   C9 plan        the deck heights and names stay in order; the ship fits inside the world
//   C10 on foot    every named spot, slide gate, game and the wheel can be walked (or swum) to
//                  from the spawn without the lifts (one-block steps up, any drop)

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPES, ItemRegistry, BlockRegistry } from '../src/core/registry.js';
import * as blocksMod from '../src/world/blocks.js';
import { World, WORLD_SIZES } from '../src/world/world.js';
import { mulberry32 } from '../src/core/util.js';
import { Noise } from '../src/core/noise.js';
import * as cruise from '../src/world/biomes/cruise.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const a = process.argv.find((s) => s.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const ONLY = arg('only') ? new Set(arg('only').split(',')) : null;
const SEEDS = (() => {
  const s = arg('seeds');
  if (!s) return [1, 2, 3, 4, 5];
  const m = /^(\d+)\.\.(\d+)$/.exec(s);
  if (m) { const out = []; for (let k = +m[1]; k <= +m[2]; k++) out.push(k); return out; }
  return s.split(',').map(Number);
})();

let passed = 0, failures = 0;
function assert(cond, msg) { if (!cond) throw new Error('assertion failed: ' + msg); }
function test(id, name, fn) {
  if (ONLY && !ONLY.has(id)) return;
  try { fn(); passed++; console.log(`  ok   ${id} ${name}`); } catch (err) { failures++; console.log(`  FAIL ${id} ${name}\n       ${err.message}`); }
}

// ---------- the worlds ----------

const items = new ItemRegistry();
const reg = new BlockRegistry(items);
blocksMod.install({ registry: { blocks: reg, items } });
const solid = new Uint8Array(256), liquid = new Uint8Array(256);
for (const d of reg.defs) { solid[d.id] = d.solid ? 1 : 0; liquid[d.id] = d.shape === 'liquid' || d.shape === SHAPES?.liquid ? 1 : 0; }
const WATER = reg.idOf('water');

const worlds = [];
for (const size of ['cozy', 'big']) {
  for (const seed of SEEDS) {
    const w = new World(WORLD_SIZES[size], reg);
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    let ms = 0, error = null;
    try {
      const t0 = performance.now();
      cruise.generate(w, mulberry32(seed), new Noise(seed));
      ms = performance.now() - t0;
    } catch (err) { error = err; }
    console.warn = orig;
    worlds.push({ w, size, seed, ms, warns, error, label: `${size} seed ${seed}` });
  }
}
console.log(`cruise world: ${worlds.length} worlds generated (${worlds.map((x) => `${x.label} ${x.ms.toFixed(0)} ms`).join(', ')})`);

const get = (w, x, y, z) => (w.inBounds(x, y, z) ? w.get(x, y, z) : 0);
const isAir = (w, x, y, z) => w.inBounds(x, y, z) && w.get(x, y, z) === 0;
const isSolid = (w, x, y, z) => solid[get(w, x, y, z)] === 1;
const isWater = (w, x, y, z) => liquid[get(w, x, y, z)] === 1;
const key = (x, y, z) => `${x},${y},${z}`;

/** The cells a record covers, and how its floor is checked. */
function recordCells(f) {
  if (f.kind === 'furn') {
    const size = cruise.FURN_SIZES[f.key];
    assert(size, `furn key ${f.key} has a size`);
    const cells = cruise.footprint(size, f.x, f.y, f.z, f.rot || 0);
    return { cells, floating: cruise.FLOATING.has(f.key), hanging: cruise.HANGING.has(f.key) };
  }
  if (f.kind === 'cruise:float') return { cells: [[f.x, f.y, f.z]], float: true };
  if (f.kind === 'cruise:movie') return { cells: cruise.footprint([f.w, f.h, 1], f.x, f.y, f.z, f.rot), screen: true };
  if (f.kind === 'cruise:lift') return { cells: f.stops.flatMap((s) => [[f.x, s.y + 1, f.z], [f.x, s.y + 2, f.z]]), lift: true };
  if (f.kind === 'cruise:slide') return { cells: [[f.x, f.y, f.z], [f.x, f.y + 1, f.z]], slide: true };
  return { cells: [[f.x, f.y, f.z], [f.x, f.y + 1, f.z]] };
}

// ---------- tests ----------

test('C0', 'generate() never throws', () => {
  for (const x of worlds) assert(!x.error, `${x.label}: ${x.error && x.error.stack}`);
});

test('C1', 'generate() is fast (Big < 300 ms; Node on a slow CI box gets 3x)', () => {
  const slack = process.env.CI ? 3 : 1.6;
  for (const x of worlds) assert(x.ms < 300 * slack, `${x.label} took ${x.ms.toFixed(0)} ms`);
});

test('C2', 'spawn on the pool deck, safe', () => {
  for (const { w, label } of worlds) {
    const s = w._spawn;
    assert(Array.isArray(s) && s.length === 3, `${label}: spawn set`);
    const [x, y, z] = s.map(Math.floor);
    assert(y === cruise.F3 + 1, `${label}: spawn on the pool deck (y ${y})`);
    assert(isSolid(w, x, y - 1, z), `${label}: floor under the spawn`);
    assert(isAir(w, x, y, z) && isAir(w, x, y + 1, z), `${label}: two free cells at the spawn`);
    const [cx, cz] = [Math.floor(w.sx / 2), Math.floor(w.sz / 2)];
    void cx; void cz;
    // nothing is placed on the spawn cell
    for (const f of w.features) if (f.kind !== 'cruise:slide') for (const c of recordCells(f).cells) assert(key(...c) !== key(x, y, z), `${label}: ${f.kind} on the spawn`);
  }
});

test('C3', 'every feature record has free cells on a solid floor, no overlaps, and the counts', () => {
  for (const { w, label } of worlds) {
    assert(Array.isArray(w.features), `${label}: features listed`);
    const seen = new Map();
    const counts = {};
    for (const f of w.features) {
      const k = f.kind === 'furn' ? `furn:${f.key}` : f.kind;
      counts[k] = (counts[k] || 0) + 1;
      assert(Number.isInteger(f.x) && Number.isInteger(f.y) && Number.isInteger(f.z), `${label}: ${k} has integer x, y, z`);
      if (f.rot !== undefined) assert(Number.isInteger(f.rot) && f.rot >= 0 && f.rot <= 3, `${label}: ${k} rot`);
      if (f.kind === 'cruise:spot') assert(typeof f.name === 'string' && typeof f.deck === 'string', `${label}: spot name and deck`);
      const { cells, floating, hanging, float, screen } = recordCells(f);
      let y0 = Infinity, y1 = -Infinity;
      for (const c of cells) { y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); }
      for (const [x, y, z] of cells) {
        const here = `${label}: ${k} at ${f.x},${f.y},${f.z} cell ${x},${y},${z}`;
        if (f.kind !== 'cruise:spot' || true) {
          const prev = seen.get(key(x, y, z));
          assert(!prev, `${here} overlaps ${prev}`);
          seen.set(key(x, y, z), k);
        }
        if (float || (floating && y === y0)) {
          assert(isWater(w, x, y, z), `${here} floats on water`);
          if (float) assert(isAir(w, x, y + 1, z), `${here} is at the water's top`);
          continue;
        }
        assert(isAir(w, x, y, z), `${here} is air (found ${reg.byId(get(w, x, y, z))?.key})`);
        if (screen) continue;
        if (hanging) { if (y === y1) assert(isSolid(w, x, y + 1, z), `${here} hangs under a ceiling`); continue; }
        if (y === y0) assert(isSolid(w, x, y - 1, z), `${here} stands on a solid floor (found ${reg.byId(get(w, x, y - 1, z))?.key})`);
      }
    }
    const need = {
      'cruise:slide': 2, 'cruise:lift': 1, 'cruise:arcade': 3, 'cruise:game': 3, 'cruise:golf': 1, 'cruise:dance': 1,
      'cruise:movie': 1, 'cruise:wheel': 1, 'cruise:board': 1, 'cruise:spot': 6, 'cruise:float': 4,
      'furn:bed_single': 4, 'furn:cruise_lounger': 6,
    };
    for (const [k, n] of Object.entries(need)) assert((counts[k] || 0) >= n, `${label}: ${n}+ ${k} (have ${counts[k] || 0})`);
    const games = new Set(w.features.filter((f) => f.kind === 'cruise:game').map((f) => f.game));
    for (const g of ['hoops', 'ringtoss', 'shuffle']) assert(games.has(g), `${label}: game ${g}`);
    const golf = w.features.find((f) => f.kind === 'cruise:golf');
    assert(golf.holes.length >= 4 && golf.holes.length <= 6, `${label}: 4-6 golf holes`);
    for (const h of golf.holes) {
      for (const p of [h.tee, h.cup]) {
        assert(isAir(w, p[0], p[1], p[2]) && isSolid(w, p[0], p[1] - 1, p[2]), `${label}: golf tee/cup ${p} on the green`);
      }
      assert(h.par >= 2 && h.par <= 5, `${label}: par`);
    }
    const names = new Set(w.features.filter((f) => f.kind === 'cruise:spot').map((f) => f.name));
    for (const n of ['pool', 'slides', 'arcade', 'golf', 'theater', 'dance', 'bridge', 'cabins', 'beach']) assert(names.has(n), `${label}: spot ${n}`);
    const dance = w.features.find((f) => f.kind === 'cruise:dance');
    for (let z = dance.z0; z <= dance.z1; z++) for (let x = dance.x0; x <= dance.x1; x++) {
      assert(isSolid(w, x, dance.y - 1, z) && isAir(w, x, dance.y, z), `${label}: dance floor cell ${x},${z}`);
    }
    assert(Array.isArray(w._cruiseSkipped) && w._cruiseSkipped.length <= 6, `${label}: few records skipped (${w._cruiseSkipped && w._cruiseSkipped.join(' ')})`);
  }
});

test('C4', 'slide paths are continuous, go downhill and end in a pool', () => {
  for (const { w, label } of worlds) {
    const slides = w.features.filter((f) => f.kind === 'cruise:slide');
    for (const s of slides) {
      const p = s.path;
      assert(Array.isArray(p) && p.length >= 8 && p.length <= 240, `${label}: ${s.name} has 8..240 points (${p.length})`);
      assert(typeof s.name === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s.color), `${label}: name and color`);
      assert(p[0][0] === s.x && p[0][1] === s.y && p[0][2] === s.z, `${label}: ${s.name} starts at its record`);
      for (let i = 1; i < p.length; i++) {
        const [ax, ay, az] = p[i - 1], [bx, by, bz] = p[i];
        const d = Math.hypot(bx - ax, by - ay, bz - az);
        assert(d > 0 && d <= 1.5, `${label}: ${s.name} step ${i} is ${d.toFixed(2)}`);
        assert(by <= ay, `${label}: ${s.name} climbs at step ${i}`);
      }
      const last = p[p.length - 1];
      assert(isWater(w, ...last), `${label}: ${s.name} ends in water`);
      assert(isWater(w, last[0], last[1] - 2, last[2]), `${label}: ${s.name} ends in water 3+ deep`);
      for (let i = 0; i < p.length - 1; i++) {
        const [x, y, z] = p[i];
        assert(isAir(w, x, y, z) || isWater(w, x, y, z), `${label}: ${s.name} point ${i} is free`);
        assert(isAir(w, x, y + 1, z) || isWater(w, x, y + 1, z), `${label}: ${s.name} point ${i} has headroom`);
      }
      assert(isSolid(w, s.x, s.y - 1, s.z), `${label}: ${s.name} gate on the platform`);
      assert(p[0][1] - last[1] >= 8, `${label}: ${s.name} drops 8+ blocks`);
    }
  }
});

test('C5', 'lift stops stand on floors', () => {
  for (const { w, label } of worlds) {
    const lifts = w.features.filter((f) => f.kind === 'cruise:lift');
    assert(lifts.length >= 1 && lifts.length <= 2, `${label}: 1-2 lifts`);
    for (const l of lifts) {
      assert(l.stops.length >= 3, `${label}: lift has 3+ stops`);
      for (const s of l.stops) {
        assert(typeof s.name === 'string' && s.name.length > 0, `${label}: stop name`);
        assert(isSolid(w, l.x, s.y, l.z), `${label}: lift ${l.x},${l.z} floor at ${s.y}`);
        assert(isAir(w, l.x, s.y + 1, l.z) && isAir(w, l.x, s.y + 2, l.z), `${label}: lift ${l.x},${l.z} free over ${s.y}`);
      }
      assert(l.y === l.stops[0].y + 1, `${label}: lift record at its first stop`);
    }
  }
});

test('C6', 'no unknown blocks; the block budget', () => {
  for (const { w, label, warns } of worlds) {
    assert(!warns.some((m) => /unknown block/.test(m)), `${label}: ${warns.join(' | ')}`);
    const n = reg.defs.length;
    let used = 0, ship = 0;
    const kinds = new Set();
    const nat = new Set(['water', 'sand', 'stone', 'gravel', 'dirt', 'sand_pink'].map((k) => reg.idOf(k)));
    for (let i = 0; i < w.blocks.length; i++) {
      const b = w.blocks[i];
      if (!b) continue;
      assert(b < n, `${label}: block id ${b} registered`);
      used++;
      kinds.add(b);
      if (!nat.has(b)) ship++;
    }
    const vol = w.sx * w.sy * w.sz;
    assert(used < vol * 0.55, `${label}: ${used} blocks (< 55% of the world)`);
    assert(ship < (w.sx > 160 ? 220000 : 110000), `${label}: ${ship} ship blocks within the budget`);
    assert(kinds.size <= 110, `${label}: ${kinds.size} kinds of block`);
    assert(n <= 255, `${n} block types registered`);
  }
});

test('C7', 'the sea all round: water for 8+ cells to every edge', () => {
  for (const { w, label } of worlds) {
    assert(w.waterLevel === cruise.SEA, `${label}: waterLevel`);
    assert(w.outside && w.outside.block === 'water', `${label}: outside is water`);
    for (let k = 0; k < 8; k++) {
      for (let t = 0; t < w.sx; t++) {
        for (const [x, z] of [[t, k], [t, w.sz - 1 - k]]) assert(get(w, x, cruise.SEA, z) === WATER && get(w, x, cruise.SEA + 1, z) === 0, `${label}: sea at ${x},${z}`);
      }
      for (let t = 0; t < w.sz; t++) {
        for (const [x, z] of [[k, t], [w.sx - 1 - k, t]]) assert(get(w, x, cruise.SEA, z) === WATER && get(w, x, cruise.SEA + 1, z) === 0, `${label}: sea at ${x},${z}`);
      }
    }
    assert(w.gemSpots.length >= 20 && w.gemSpots.length <= 30 && w.gemTotal === w.gemSpots.length, `${label}: 20-30 gems (${w.gemSpots.length})`);
    for (const [x, y, z] of w.gemSpots) assert(isAir(w, x, y, z), `${label}: gem ${x},${y},${z} in air`);
  }
});

test('C8', 'furniture sizes match the catalogs', () => {
  const sources = [
    'src/things/furniture/catalog.js', 'src/things/vehicles/defs.js', 'src/things/shops/treats.js', 'src/things/outdoor/index.js',
  ];
  const cruiseDir = path.join(ROOT, 'src/things/cruise');
  if (existsSync(cruiseDir)) for (const f of readdirSync(cruiseDir)) if (f.endsWith('.js')) sources.push(`src/things/cruise/${f}`);
  const found = new Map();
  for (const s of sources) {
    const p = path.join(ROOT, s);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    const re = /key:\s*'([a-z0-9_]+)'[^\n]*?size:\s*\[(\d+),\s*(\d+),\s*(\d+)\]/g;
    let m;
    while ((m = re.exec(text))) if (!found.has(m[1])) found.set(m[1], [+m[2], +m[3], +m[4]]);
  }
  // shops are all 3 x 3 x 2 (src/things/shops/index.js)
  for (const k of ['candy_shop', 'ice_cream_parlor']) if (!found.has(k)) found.set(k, [3, 3, 2]);
  for (const [k, size] of Object.entries(cruise.FURN_SIZES)) {
    if (k === 'cruise_lounger' && !found.has(k)) continue; // cruise-fun's key, checked once it exists
    assert(found.has(k), `catalog has ${k}`);
    assert(found.get(k).join() === size.join(), `${k}: catalog ${found.get(k)} vs ${size}`);
  }
});

test('C9', 'the plan: decks in order, the ship inside the world', () => {
  const { F1, F2, F3, F4, F5, FT, SEA, KEEL } = cruise;
  assert(KEEL < SEA && SEA < F1 && F1 < F2 && F2 < F3 && F3 < F4 && F4 < F5 && F3 < FT, 'deck order');
  for (const [sx, sz] of [[144, 144], [208, 208]]) {
    const P = cruise.shipPlan(sx, sz);
    assert(P.z0 >= 12 && P.z1 <= sz - 12, `ship inside ${sx}`);
    assert(P.zA0 < P.zB0 && P.zB0 < P.zT && P.zT < P.zC0 && P.zC0 < P.zLift && P.zLift < P.zBr0 && P.zBr0 < P.zC1, `level order ${sx}`);
    assert(P.cx - P.HW >= 12 && P.cx + P.HW <= sx - 12, `beam inside ${sx}`);
  }
});

test('C10', 'every spot can be reached on foot from the spawn', () => {
  for (const { w, label } of worlds) {
    const { sx, sy, sz } = w;
    const N = sx * sy * sz;
    const idx = (x, y, z) => (y * sz + z) * sx + x;
    // furniture and rides are in the way (doors open, flat things and floats are not)
    const blocked = new Uint8Array(N);
    const PASS = new Set(['door', 'door_pink', 'door_glass', 'picnic_blanket', 'rug_round', 'lamp_ceiling']);
    for (const f of w.features) {
      if (f.kind === 'cruise:spot' || f.kind === 'cruise:float' || f.kind === 'cruise:movie' || f.kind === 'cruise:slide') continue;
      if (f.kind === 'furn' && (PASS.has(f.key) || cruise.FLOATING.has(f.key))) continue;
      for (const [x, y, z] of recordCells(f).cells) if (w.inBounds(x, y, z)) blocked[idx(x, y, z)] = 1;
    }
    const open = (x, y, z) => w.inBounds(x, y, z) && !blocked[idx(x, y, z)] && !solid[w.get(x, y, z)];
    const wet = (x, y, z) => isWater(w, x, y, z);
    // she can be in a cell when it and the one above are open and something holds her up
    const stand = (x, y, z) => open(x, y, z) && open(x, y + 1, z) && (isSolid(w, x, y - 1, z) || wet(x, y, z) || wet(x, y - 1, z));
    const seen = new Uint8Array(N);
    const [s0, s1, s2] = w._spawn.map(Math.floor);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    seen[idx(s0, s1, s2)] = 1;
    queue[qt++] = idx(s0, s1, s2);
    while (qh < qt) {
      const i = queue[qh++];
      const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
      const swimming = wet(x, y, z);
      // swimming up and down in water
      for (const dy of [1, -1]) {
        const ny = y + dy;
        if (swimming && wet(x, ny, z) && stand(x, ny, z) && !seen[idx(x, ny, z)]) { seen[idx(x, ny, z)] = 1; queue[qt++] = idx(x, ny, z); }
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!w.inBounds(nx, y, nz)) continue;
        // a step up (or climbing out of the water) needs room over her head first
        if (open(x, y + 2, z) && stand(nx, y + 1, nz) && !seen[idx(nx, y + 1, nz)]) { seen[idx(nx, y + 1, nz)] = 1; queue[qt++] = idx(nx, y + 1, nz); }
        if (!open(nx, y, nz) || !open(nx, y + 1, nz)) continue;
        // walk on, or drop down to whatever is below
        let ny = y;
        while (ny > 0 && !stand(nx, ny, nz) && open(nx, ny - 1, nz)) ny--;
        if (stand(nx, ny, nz) && !seen[idx(nx, ny, nz)]) { seen[idx(nx, ny, nz)] = 1; queue[qt++] = idx(nx, ny, nz); }
      }
    }
    if (process.env.DEBUG_WALK) console.log(label, 'cells reached', qt);
    const near = (x, y, z) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (w.inBounds(x + dx, y + dy, z + dz) && seen[idx(x + dx, y + dy, z + dz)]) return true;
      }
      return false;
    };
    for (const f of w.features) {
      if (!['cruise:spot', 'cruise:slide', 'cruise:game', 'cruise:wheel', 'cruise:board', 'cruise:arcade', 'cruise:golf', 'cruise:dance'].includes(f.kind)) continue;
      const what = `${label}: ${f.kind}${f.name ? ' ' + f.name : ''} at ${f.x},${f.y},${f.z}`;
      if (f.kind === 'cruise:spot' || f.kind === 'cruise:slide') assert(seen[idx(f.x, f.y, f.z)], `${what} reachable`);
      else assert(near(f.x, f.y, f.z), `${what} reachable`);
    }
    for (const c of w.features.filter((f) => f.kind === 'furn' && f.key === 'bed_single')) assert(near(c.x, c.y, c.z), `${label}: bed at ${c.x},${c.y},${c.z} reachable`);
    // every piece of furniture on the floor can be walked up to (ceiling lamps hang out of reach)
    for (const f of w.features.filter((r) => r.kind === 'furn' && !cruise.HANGING.has(r.key))) {
      assert(recordCells(f).cells.some(([x, y, z]) => near(x, y, z)), `${label}: ${f.key} at ${f.x},${f.y},${f.z} reachable`);
    }
    // the cabin corridor (3 wide) holds no furniture, so the lift in it never closes the way
    const P = cruise.shipPlan(sx, sz);
    for (const f of w.features.filter((r) => r.kind === 'furn' && r.y === cruise.F1 + 1 && !PASS.has(r.key))) {
      for (const [x, , z] of recordCells(f).cells) {
        const inCorridor = Math.abs(x - P.cx) <= 1 && z > P.zA0 + 10 && z < P.zLift - 4;
        assert(!inCorridor, `${label}: ${f.key} at ${f.x},${f.y},${f.z} stands in the cabin corridor`);
      }
    }
  }
});

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
