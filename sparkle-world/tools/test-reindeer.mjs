// Reindeer team tests (wave 5, docs/teams/reindeer.md), no browser, seconds:
//   node tools/test-reindeer.mjs
// Flying physics (src/things/vehicles/drive.js, spec.flies: the Jingle Sleigh) over the real
// src/world/physics.js on a fake voxel world, the reindeer species data, the herd and coin
// rules (src/things/reindeer/logic.js) and the folder rules:
//   F1  take off, climb, glide down, land softly (landed once, never through the ground)
//   F2  bounded: random worlds, random sticks and Up / Down, every step quick, every number
//       finite, never inside a block, never out of the world, never above world.sy + 1
//   F3  landing finds ground: off a cliff, over a pit, from the ceiling; over water it hovers
//       and never lands in it; Get out over water is refused (it says where to go)
//   F4  walls in the air: a soft stop with one bump; a low fence is hopped over
//   F5  NaN / Infinity in flight never stick; a roof stops a take-off; the Land button
//   F6  every other vehicle ignores Up and Down (the old behaviour, byte for byte)
//   F7  the sleigh def: appended last, flies, colliders inside its size, park spots fit
//   R1  the reindeer species: appended last, rideable, a carrot eater, sky flight only where
//       the sky says so, every coat has a name and colors, no red nose
//   R2  herd spots, names, daily coins (5 a day at most) and the profile defaults
//   R3  no while loops in the reindeer folders; no famous names in our strings

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Physics } from '../src/world/physics.js';
import { SHAPES } from '../src/core/registry.js';
import { Drive, FLY } from '../src/things/vehicles/drive.js';
import { findParkSpot } from '../src/things/vehicles/park.js';
import { VEHICLES, vehicleDef } from '../src/things/vehicles/defs.js';
import { rotXZ } from '../src/things/entities.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failures = 0;
function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}
async function test(name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    passed++;
    console.log(`  ok   ${name} (${Date.now() - t0} ms)${info ? ' - ' + info : ''}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}: ${err && err.stack ? err.stack : err}`);
  }
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- a fake world (as tools/test-vehicles.mjs) ----------

const AIR = 0, STONE = 1, WATER = 2, SLAB = 3;
const props = {
  solid: Uint8Array.from([0, 1, 0, 1]),
  shape: Uint8Array.from([SHAPES.air, SHAPES.cube, SHAPES.liquid, SHAPES.slab]),
  replaceable: Uint8Array.from([1, 0, 1, 0]),
};

class FakeWorld {
  constructor(sx = 48, sy = 32, sz = 48) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.blocks = new Uint8Array(sx * sy * sz);
    this.registry = { props };
    this.floorId = STONE;
  }
  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }
  index(x, y, z) {
    return (y * this.sz + z) * this.sx + x;
  }
  get(x, y, z) {
    if (y < 0) return this.floorId;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y >= this.sy) return 0;
    return this.blocks[this.index(x, y, z)];
  }
  set(x, y, z, id) {
    if (this.inBounds(x, y, z)) this.blocks[this.index(x, y, z)] = id;
  }
  fill(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
  }
}

function flatWorld(top = 4, sx = 48, sz = 48, sy = 32) {
  const w = new FakeWorld(sx, sy, sz);
  w.fill(0, 0, 0, sx - 1, top - 1, sz - 1, STONE);
  return w;
}
const setup = (world) => ({ world, physics: new Physics(world, new Set()) });
const SLEIGH = vehicleDef('sleigh').vehicle;
const CAR = vehicleDef('car_convertible').vehicle;
const make = (env, s, x, y, z, yaw = 0) => new Drive({ physics: env.physics, world: env.world, spec: s, pos: [x, y, z], yaw });
const finite = (d) => [d.pos.x, d.pos.y, d.pos.z, d.yaw, d.speed, d.vy, d.liftVis, d.pitchVis, d.rollVis, d.airHeight].every(Number.isFinite);
const clean = (d) => d.poseFree(d.pos.x, d.pos.y, d.pos.z, d.yaw);
const DT = 1 / 60;
const run = (d, secs, c) => {
  let landed = 0, took = 0;
  for (let i = 0; i < Math.round(secs / DT); i++) {
    d.step(DT, c);
    if (d.landed) landed++;
    if (d.tookOff) took++;
  }
  return { landed, took };
};
const UP = { mx: 0, mz: 0, camYaw: 0, up: true };
const UPF = { mx: 0, mz: 1, camYaw: 0, up: true };
const FWD = { mx: 0, mz: 1, camYaw: 0 };
const DOWN = { mx: 0, mz: 0, camYaw: 0, down: true };
const IDLE = { mx: 0, mz: 0, camYaw: 0 };

// =====================================================================================
// flying
// =====================================================================================

await test('F1: take off, climb, glide down, land softly', () => {
  const env = setup(flatWorld(4));
  const d = make(env, SLEIGH, 24, 4, 20);
  run(d, 0.2, IDLE);
  assert(d.onGround && !d.flying, 'parked on the ground first');
  const r1 = run(d, 1.5, UP);
  assert(r1.took === 1 && d.flying, 'one take-off');
  assert(d.pos.y > 8 && d.pos.y < 4 + FLY.UP * 1.5 + 0.1, 'climbed gently: y ' + d.pos.y.toFixed(2));
  const top = d.pos.y;
  // let go: a slow glide down (never a fall)
  let maxDown = 0, steps = 0, landedAt = -1;
  for (let i = 0; i < 60 * 30; i++) {
    d.step(DT, IDLE);
    maxDown = Math.max(maxDown, -d.vy);
    assert(finite(d) && clean(d), 'clean at step ' + i);
    assert(d.pos.y >= 4 - 1e-6, 'never through the ground');
    if (d.landed) { landedAt = i; break; }
    steps++;
  }
  assert(landedAt > 0, 'it landed by itself');
  assert(maxDown <= FLY.SINK + 1e-6, 'a gentle glide, at most ' + FLY.SINK + ' b/s: ' + maxDown.toFixed(2));
  assert(!d.flying && d.onGround && Math.abs(d.pos.y - 4) < 0.01, 'on the ground at y 4: ' + d.pos.y.toFixed(3));
  // a dive is faster but the touch down is soft
  run(d, 1.2, UP);
  let vAtTouch = 0;
  for (let i = 0; i < 60 * 10; i++) {
    const before = d.vy;
    d.step(DT, DOWN);
    if (d.landed) { vAtTouch = before; break; }
  }
  assert(!d.flying, 'the dive landed');
  assert(vAtTouch > -1.2, 'soft touch down after a dive: vy ' + vAtTouch.toFixed(2));
  return `up to ${top.toFixed(1)}, glided down in ${(steps * DT).toFixed(1)} s`;
});

await test('F2: bounded - random worlds, sticks, Up and Down', () => {
  let total = 0, worst = 0, flights = 0, landings = 0;
  const times = [];
  for (let seed = 1; seed <= 24; seed++) {
    const rand = mulberry32(seed * 7919);
    const w = flatWorld(3 + (seed % 3), 48, 48, 24 + (seed % 3) * 8);
    // pillars, arches, a pond, slabs, a floating shelf
    for (let k = 0; k < 40; k++) {
      const x = 2 + Math.floor(rand() * 44), z = 2 + Math.floor(rand() * 44);
      const h = 1 + Math.floor(rand() * 9);
      const kind = rand();
      if (kind < 0.55) w.fill(x, 3, z, x, 3 + h, z, STONE);
      else if (kind < 0.7) w.fill(x, 8 + Math.floor(rand() * 6), z, Math.min(47, x + 3), 8 + Math.floor(rand() * 6), Math.min(47, z + 2), STONE);
      else if (kind < 0.85) w.fill(x, 2, z, Math.min(47, x + 4), 3, Math.min(47, z + 4), WATER);
      else w.set(x, 4, z, SLAB);
    }
    const env = setup(w);
    // a free spot to start
    let d = null;
    for (let k = 0; k < 64 && !d; k++) {
      const x = 4 + rand() * 40, z = 4 + rand() * 40;
      const t = make(env, SLEIGH, x, 12, z, rand() * 6);
      if (clean(t)) d = t;
    }
    if (!d) continue;
    let c = { mx: 0, mz: 1, camYaw: 0 };
    for (let i = 0; i < 2500; i++) {
      if (i % 40 === 0) {
        const r = rand();
        c = { mx: rand() * 2 - 1, mz: rand() * 2 - 1, camYaw: rand() * 7, up: r < 0.35, down: r > 0.75 };
      }
      const t0 = performance.now();
      d.step(i % 97 === 0 ? 0.2 : DT, c); // now and then a long frame
      const ms = performance.now() - t0;
      times.push(ms);
      worst = Math.max(worst, ms);
      total++;
      if (d.tookOff) flights++;
      if (d.landed) landings++;
      assert(finite(d), `finite (seed ${seed}, step ${i})`);
      if (!d.trouble) assert(clean(d), `never inside a block (seed ${seed}, step ${i}) at ${d.pos.x.toFixed(2)},${d.pos.y.toFixed(2)},${d.pos.z.toFixed(2)}`);
      const m = d.halfL;
      assert(d.pos.x >= m - 1e-6 && d.pos.z >= m - 1e-6 && d.pos.x <= w.sx - m + 1e-6 && d.pos.z <= w.sz - m + 1e-6, 'inside the world');
      assert(d.pos.y <= w.sy + FLY.CEIL + 1e-6 && d.pos.y >= -1e-6, 'between the floor and the sky: ' + d.pos.y);
      if (!d.flying && d.onGround) assert(!env.physics.liquidAt(d.pos.x, d.pos.y + 0.1, d.pos.z), 'never rests in water');
      if (d.trouble) break;
    }
  }
  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  assert(p99 < 2, 'quick steps, p99 ' + p99.toFixed(3) + ' ms');
  assert(flights > 20 && landings > 10, `it flew (${flights}) and landed (${landings})`);
  return `${total} steps, ${flights} take-offs, ${landings} landings, p99 ${p99.toFixed(3)} ms, max ${worst.toFixed(2)} ms`;
});

await test('F3: landing finds ground (cliff, pit, ceiling); water: hover, never land', () => {
  // off a cliff: flying forward over the edge, then let go
  const w = flatWorld(4);
  w.fill(0, 4, 0, 47, 11, 20, STONE); // a high plateau z 0..20 (top 12)
  const env = setup(w);
  const d = make(env, SLEIGH, 24, 12, 10);
  run(d, 0.4, UPF);
  assert(d.flying, 'flying off the plateau');
  run(d, 1.6, FWD);
  let t = 0;
  for (; t < 60 * 30 && d.flying; t++) d.step(DT, IDLE);
  assert(!d.flying && Math.abs(d.pos.y - (d.pos.z - d.halfL < 21 ? 12 : 4)) < 0.01, 'landed on ground below: y ' + d.pos.y.toFixed(2) + ' z ' + d.pos.z.toFixed(1));
  // from the ceiling of a tall world, the Land button brings it down
  const w2 = flatWorld(2, 48, 48, 64);
  const e2 = setup(w2);
  const d2 = make(e2, SLEIGH, 24, 2, 24);
  run(d2, 25, UP);
  assert(d2.flying && Math.abs(d2.pos.y - (64 + FLY.CEIL)) < 1e-6, 'held Up: stops at the ceiling ' + d2.pos.y);
  assert(d2.groundPose().y === 2, 'ground pose under it: ' + d2.groundPose().y);
  d2.land();
  let t2 = 0;
  for (; t2 < 60 * 60 && d2.flying; t2++) d2.step(DT, IDLE);
  assert(!d2.flying && Math.abs(d2.pos.y - 2) < 0.01, 'landed from the top in ' + (t2 * DT).toFixed(1) + ' s');
  assert(t2 * DT < 64 / FLY.LAND + 4, 'the Land button is quick');
  // a lake: it hovers, never lands, and comes back up when it starts low
  const w3 = flatWorld(4);
  w3.fill(0, 1, 0, 47, 3, 47, WATER); // water everywhere at y 1..3 (surface 4)
  w3.fill(0, 0, 40, 47, 3, 47, STONE); // a beach at z 40..47
  const e3 = setup(w3);
  const d3 = make(e3, SLEIGH, 24, 9, 15);
  d3.flying = true; d3.onGround = false;
  run(d3, 20, DOWN);
  assert(d3.flying, 'never lands on water');
  assert(Math.abs(d3.pos.y - (4 + FLY.HOVER)) < 0.02, 'hovers over the water: ' + d3.pos.y.toFixed(3));
  assert(d3.floorBelow().wet, 'the floor below is wet');
  assert(d3.groundPose().y === 4, 'ground pose over water is the surface');
  // fly to the beach and come down there
  run(d3, 4, FWD);
  for (let i = 0; i < 60 * 10 && d3.flying; i++) d3.step(DT, DOWN);
  assert(!d3.flying && d3.pos.y === 4 && d3.pos.z > 40, 'landed on the beach at z ' + d3.pos.z.toFixed(1));
  assert(!e3.physics.liquidAt(d3.pos.x, d3.pos.y + 0.1, d3.pos.z), 'not in water');
  // half over water: never lands either
  const d4 = make(e3, SLEIGH, 24, 8, 39.5);
  d4.flying = true; d4.onGround = false;
  run(d4, 10, DOWN);
  assert(d4.flying && d4.floorBelow().wet, 'half over water: keeps hovering');
  // a high bank (one block over the water) with the nose over the water: it lands on the bank
  // (the bank holds it up, not the water) instead of hovering on the shore for ever
  const w5 = flatWorld(4);
  w5.fill(0, 4, 0, 47, 4, 23, STONE);
  w5.fill(0, 1, 24, 47, 3, 47, WATER);
  const e5 = setup(w5);
  for (const z of [23, 24]) {
    const d5 = make(e5, SLEIGH, 20, 9, z);
    d5.flying = true; d5.onGround = false;
    run(d5, 12, IDLE);
    assert(!d5.flying && Math.abs(d5.pos.y - 5) < 0.01 && !d5.floorBelow().wet, 'lands on the bank at z ' + z + ': y ' + d5.pos.y.toFixed(2));
  }
  return `cliff ${(t * DT).toFixed(1)} s, from the top ${(t2 * DT).toFixed(1)} s`;
});

await test('F4: walls in the air stop softly; a low fence is hopped over', () => {
  const w = flatWorld(4);
  w.fill(0, 4, 30, 47, 20, 31, STONE); // a tall wall at z 30
  w.fill(0, 4, 18, 47, 4, 18, STONE); // a 1-high fence at z 18
  const env = setup(w);
  const d = make(env, SLEIGH, 24, 4, 8);
  run(d, 0.3, UPF);
  const y0 = d.pos.y;
  let bumps = 0, hopped = false;
  for (let i = 0; i < 60 * 8; i++) {
    d.step(DT, { mx: 0, mz: 1, camYaw: 0, up: d.pos.y < 6 });
    if (d.climbed) hopped = true;
    if (d.bumpSpeed > 0) bumps++;
    assert(clean(d), 'clean at ' + i);
  }
  assert(d.pos.z + d.halfL <= 30 + 1e-6, 'stopped before the wall: nose ' + (d.pos.z + d.halfL).toFixed(2));
  assert(bumps >= 1 && bumps <= 3, 'a soft bump (or two): ' + bumps);
  // the fence: fly low over it with Down held so it touches the fence height
  const d2 = make(env, SLEIGH, 24, 4, 8);
  run(d2, 0.15, UPF);
  for (let i = 0; i < 60 * 3; i++) {
    d2.step(DT, { mx: 0, mz: 1, camYaw: 0, down: true });
    if (d2.climbed) hopped = true;
    assert(clean(d2), 'clean over the fence ' + i);
  }
  assert(d2.pos.z > 20, 'past the fence: z ' + d2.pos.z.toFixed(1));
  return `y0 ${y0.toFixed(2)}, ${bumps} bump(s), hopped ${hopped}`;
});

await test('F5: NaN in flight never sticks; a roof stops a take-off; Land', () => {
  const env = setup(flatWorld(4));
  const d = make(env, SLEIGH, 24, 4, 24);
  run(d, 1, UP);
  const resets = d.nanResets;
  for (const f of ['x', 'y', 'z']) {
    d.pos[f] = NaN;
    d.step(DT, UP);
    assert(finite(d) && clean(d), 'pos.' + f + ' recovered');
  }
  for (const f of ['vy', 'speed', 'yaw']) {
    d[f] = Infinity;
    d.step(DT, UPF);
    assert(finite(d) && clean(d), f + ' recovered');
  }
  d.step(DT, { mx: NaN, mz: Infinity, camYaw: NaN, up: 'yes', down: NaN });
  assert(finite(d), 'junk controls');
  assert(d.nanResets > resets, 'counted');
  assert(d.floorBelow(NaN, NaN, NaN).top === 0 || Number.isFinite(d.floorBelow(NaN, 5, NaN).top), 'floorBelow never throws on junk');
  // a roof just over the antlers (one block above the body's top): a little lift, no further
  const w = flatWorld(4);
  w.fill(0, 7, 0, 47, 7, 47, STONE);
  const e2 = setup(w);
  const d2 = make(e2, SLEIGH, 24, 4, 24);
  for (let i = 0; i < 120; i++) {
    d2.step(DT, UPF);
    assert(clean(d2) && d2.pos.y + d2.height <= 7 + 1e-6, 'under the low roof ' + d2.pos.y.toFixed(3));
  }
  // snug under a roof (no room at all): no take-off
  const d2b = make(e2, SLEIGH, 24, 4.95, 24);
  d2b.onGround = true;
  const tookSnug = d2b._takeOff();
  assert(!tookSnug && !d2b.flying, 'no room: stays on the ground');
  // a roof higher up: it climbs to it and stops there
  const w3 = flatWorld(4);
  w3.fill(0, 10, 0, 47, 10, 47, STONE);
  const e3 = setup(w3);
  const d3 = make(e3, SLEIGH, 24, 4, 24);
  run(d3, 4, UP);
  assert(d3.flying && d3.pos.y + d3.height <= 10 + 1e-6 && clean(d3), 'under the roof: ' + d3.pos.y.toFixed(2));
  assert(d3.land() === true && d3.landing, 'Land starts');
  run(d3, 6, IDLE);
  assert(!d3.flying && !d3.landing && d3.pos.y === 4, 'Land: on the ground');
  assert(d3.land() === false, 'Land on the ground: nothing');
  return `${d.nanResets} resets`;
});

await test('F6: every other vehicle ignores Up and Down', () => {
  for (const v of VEHICLES) {
    if (v.vehicle.flies) continue;
    const env = setup(flatWorld(4));
    const water = !!v.vehicle.water;
    if (water) env.world.fill(0, 1, 0, 47, 3, 47, WATER);
    const a = make(env, v.vehicle, 24, water ? 3 : 4, 20), b = make(env, v.vehicle, 24, water ? 3 : 4, 20);
    for (let i = 0; i < 300; i++) {
      const c = { mx: Math.sin(i / 30), mz: 1, camYaw: 0 };
      a.step(DT, c);
      b.step(DT, { ...c, up: true, down: i % 2 === 0 });
      assert(a.pos.x === b.pos.x && a.pos.y === b.pos.y && a.pos.z === b.pos.z && a.yaw === b.yaw, v.key + ' same path at ' + i);
      assert(!b.flying && b.airTime === 0, v.key + ' never flies');
    }
  }
  return `${VEHICLES.length - 1} vehicles`;
});

await test('F7: the sleigh def: last, flies, colliders inside, park spots fit', () => {
  const last = VEHICLES[VEHICLES.length - 1];
  assert(last.key === 'sleigh', 'appended last');
  const v = last.vehicle;
  assert(v.flies === true && v.kind === 'sleigh' && v.horn === 'bells' && v.flySpeed > v.speed, 'flying spec');
  const [w, h, d] = last.size;
  for (const c of last.colliders) assert(c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[3] <= w && c[4] <= h && c[5] <= d, 'collider inside');
  assert(v.body.halfL * 2 <= d + 0.01 && v.body.halfW * 2 <= w && v.body.height <= h, 'body inside');
  assert(v.seat[0] > 0 && v.seat[0] < w && v.seat[2] > 0 && v.seat[2] < d, 'seat inside');
  assert(last.colors.length >= 4 && last.colors.every((c) => /^#[0-9A-F]{6}$/i.test(c)), 'swatches');
  // park spots near a flying pose's ground
  const world = flatWorld(4);
  const ctx = {
    calls: 0,
    canPlace(def, x, y, z, rot) {
      const [W, H, D] = def.size;
      const ai = Math.floor((W - 1) / 2);
      for (let i = 0; i < W; i++) for (let k = 0; k < D; k++) {
        const [ox, oz] = rotXZ(i - ai, k - (D - 1), rot);
        for (let j = 0; j < H; j++) {
          const cx = x + ox, cy = y + j, cz = z + oz;
          if (!world.inBounds(cx, cy, cz)) return false;
          const id = world.get(cx, cy, cz);
          if (id !== 0 && !props.replaceable[id]) return false;
        }
      }
      return true;
    },
    liquid: (x, y, z) => props.shape[world.get(x, y, z)] === SHAPES.liquid,
    solid: (x, y, z) => props.solid[world.get(x, y, z)] === 1,
  };
  const env = setup(world);
  const s = make(env, v, 24, 4, 24);
  run(s, 2, UP);
  const gp = s.groundPose();
  assert(s.flying && gp.y === 4, 'ground pose y 4');
  const spot = findParkSpot(ctx, last, gp);
  assert(spot && spot.y === 4, 'a park spot on the ground under it');
  return `spot ${spot.x},${spot.y},${spot.z} rot ${spot.rot}`;
});

// =====================================================================================
// the reindeer (species, herd, coins) and the folder rules
// =====================================================================================

const reindeerLogic = path.join(ROOT, 'src/things/reindeer/logic.js');
if (existsSync(reindeerLogic)) {
  const L = await import(reindeerLogic);
  const { SPECIES, SPECIES_KEYS } = await import('../src/things/pets/species.js');

  await test('R1: the reindeer species', () => {
    assert(SPECIES_KEYS[SPECIES_KEYS.length - 1] === 'reindeer', 'appended last');
    const s = SPECIES.reindeer;
    assert(s.rideable && s.treat === 'carrot' && s.seat > 0.8 && s.speed > 0 && s.run > s.speed, 'ride spec');
    assert(s.variants.length >= 5 && s.variants.every((v) => v.name && v.body && v.antler && v.nose), 'coats');
    for (const v of s.variants) {
      const n = parseInt(v.nose.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      assert(!(r > 150 && r > g * 1.8 && r > b * 1.8), 'no red nose: ' + v.name + ' ' + v.nose);
    }
    const names = new Set(s.names);
    assert(names.size >= 8, 'names');
    L.setSky(() => false);
    assert(s.flies === false, 'no flight outside the sky');
    L.setSky(() => true);
    assert(s.flies === true, 'flies where the sky says so');
    L.setSky(() => { throw new Error('boom'); });
    assert(s.flies === false, 'a broken sky check never flies');
    L.setSky(null);
    assert(s.flies === false, 'no sky check: no flight');
    return `${s.variants.length} coats, ${names.size} names`;
  });

  await test('R2: herd spots, names, coins, profile', () => {
    assert(L.herdCount({ n: 3 }, 0, 12) === 3 && L.herdCount({ n: 9 }, 0, 12) === 4 && L.herdCount({ n: 0 }, 0, 12) === 1, 'n clamped 1..4');
    assert(L.herdCount({ n: 'x' }, 0, 12) === 2 && L.herdCount({ n: 4 }, 10, 12) === 2 && L.herdCount({ n: 4 }, 12, 12) === 0, 'default 2, room left');
    assert(L.herdCount(null, 0, 12) === 0, 'no record');
    const spots = L.herdSpots({ x: 20, y: 5, z: 30 }, 4, 7);
    assert(spots.length === 4 && spots.every(([x, , z]) => Math.hypot(x - 20.5, z - 30.5) <= L.HERD_RADIUS + 0.01), 'inside the pasture');
    const n = L.herdNames(4, 3);
    assert(n.length === 4 && new Set(n).size === 4, 'four different names');
    // coins: 5 a day at most
    const prof = {};
    const day = 20261224;
    const pays = [L.coinFor(prof, 'fly', day), L.coinFor(prof, 'fly', day), L.coinFor(prof, 'sleigh', day), L.coinFor(prof, 'sleigh', day)];
    assert(pays[0] === 2 && pays[1] === 0 && pays[2] === 3 && pays[3] === 0, 'once a day each: ' + pays);
    let sum = 0;
    for (const r of ['fly', 'sleigh', 'herd', 'pet', 'x']) sum += L.coinFor(prof, r, day);
    assert(sum === 0, 'nothing more today');
    assert(L.coinFor(prof, 'fly', day + 1) === 2, 'a new day pays again');
    let week = 0;
    const p2 = {};
    for (let i = 0; i < 50; i++) week += L.coinFor(p2, ['fly', 'sleigh', 'herd'][i % 3], day);
    assert(week <= 5, 'at most 5 a day: ' + week);
    const bad = { reindeer: { coinDay: 'x', coinMask: -5 } };
    assert(L.state(bad).coinDay === 0 && L.state(bad).coinMask === 0, 'junk profile cleaned');
    assert(L.state({}).petted === 0 && typeof L.state({}) === 'object', 'a default');
    return `paid ${pays.join('+')}`;
  });
}

// ---------- the module on a fake game (no DOM: a tiny canvas stand-in for the ribbon) ----------

if (existsSync(reindeerLogic)) {
  await test('R4: the reindeer module on a fake game (herd, sleigh, stickers, coins, flight)', async () => {
    if (!globalThis.document) {
      const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
      globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };
    }
    const THREE = await import('three');
    const { install } = await import('../src/things/reindeer/index.js');
    const { SPECIES } = await import('../src/things/pets/species.js');
    const L = await import(reindeerLogic);
    const listeners = new Map();
    const emitted = [];
    const events = {
      on(n, fn) { (listeners.get(n) || listeners.set(n, []).get(n)).push(fn); },
      emit(n, p) { emitted.push(n); for (const fn of listeners.get(n) || []) fn(p); },
    };
    const awarded = [], coins = [], placedRecs = [];
    const pets = {
      pets: [], max: 12, rider: null, remote: false, group: new THREE.Group(),
      findSpot: (probe, x, y, z) => [x, y - 1 + 0.01, z],
      deserialize(list) { for (const d of list) this.pets.push({ ...d, pos: new THREE.Vector3(d.x, d.y, d.z), anim: { flying: false }, rig: null }); },
    };
    const sys = [];
    const game = {
      events, mode: 'play', world: { meta: { biome: 'holiday', seed: 7 } }, profile: { stats: {} },
      registry: { stickers: new Map() }, stickers: { has: (id) => awarded.includes(id) },
      award: (id) => awarded.push(id), saveProfile() {}, toast() {}, celebrate() {}, audio: { play() {}, ctx: null },
      particles: { emit() {} }, input: { press() {} }, net: null, ui: null, debug: {},
      coins: { add: (n, reason) => coins.push([n, reason]) },
      pets,
      vehicles: { placeRecord: (rec) => (placedRecs.push(rec), { uid: 1 }), flying: () => false, land: () => false, pose: () => ({ x: 1, y: 2, z: 3 }) },
      worldFeatures: { kinds: new Map(), on(k, fn) { this.kinds.set(k, fn); } },
      addSystem: (s) => sys.push(s),
    };
    install(game);
    const R = sys.find((s) => s.name === 'reindeer');
    assert(R && game.reindeer && game.debug.reindeer, 'installed: a system, a facade and a debug handle');
    assert(game.worldFeatures.kinds.has('holiday:reindeer') && game.worldFeatures.kinds.has('holiday:sleigh'), 'both feature kinds');
    // the sky
    assert(SPECIES.reindeer.flies === true, 'flies in Holiday Village');
    game.world.meta.biome = 'meadow';
    assert(SPECIES.reindeer.flies === false, 'not in the meadow');
    assert(game.debug.reindeer.sky(true) === true && SPECIES.reindeer.flies === true, 'debug sky on');
    game.debug.reindeer.sky(null);
    game.world.meta.biome = 'holiday';
    // the herd
    const ok = game.worldFeatures.kinds.get('holiday:reindeer')(game, { kind: 'holiday:reindeer', x: 20, y: 5, z: 30, n: 3 });
    assert(ok === true && pets.pets.length === 3, 'three reindeer in the pasture');
    assert(pets.pets.every((p) => p.species === 'reindeer' && p.mode === 'home' && Math.hypot(p.x - 20.5, p.z - 30.5) <= L.HERD_RADIUS + 0.01), 'home-mode reindeer inside the pasture');
    assert(new Set(pets.pets.map((p) => p.name)).size === 3 && new Set(pets.pets.map((p) => p.id)).size === 3, 'different names and ids');
    assert(emitted.includes('reindeer:herd') && !emitted.includes('pet:adopt'), 'reindeer:herd, never pet:adopt');
    pets.pets.length = 11;
    game.worldFeatures.kinds.get('holiday:reindeer')(game, { x: 20, y: 5, z: 30, n: 4 });
    assert(pets.pets.length === 12, 'never past MAX_PETS');
    assert(game.worldFeatures.kinds.get('holiday:reindeer')(game, { x: 20, y: 5, z: 30, n: 4 }) === false, 'full: nothing');
    assert(game.worldFeatures.kinds.get('holiday:reindeer')(game, { x: NaN, y: 5, z: 30 }) === false, 'junk record: nothing');
    pets.pets.length = 0;
    // the sleigh
    assert(game.worldFeatures.kinds.get('holiday:sleigh')(game, { x: 10.7, y: 4, z: 12.2, rot: 3 }) === true, 'a sleigh placed');
    const sr = placedRecs[0];
    assert(sr.key === 'sleigh' && sr.x === 10 && sr.y === 4 && sr.z === 12 && sr.rot === 3, 'whole cells and its turn');
    game.worldFeatures.kinds.get('holiday:sleigh')(game, { x: 1, y: 4, z: 1, rot: 9 });
    assert(placedRecs[1].rot === 0, 'a junk turn is 0');
    // stickers are registered and awarded once each
    events.emit('game:ready');
    assert(['reindeer_friend', 'reindeer_rider', 'sleigh_ride'].every((id) => game.registry.stickers.has(id)), 'three stickers');
    assert([...game.registry.stickers.values()].every((s) => typeof s.art === 'function' && s.name && s.hint), 'art, names, hints');
    const deer = { species: 'reindeer', pos: new THREE.Vector3(5, 4, 5), anim: { flying: false }, rig: null, yaw: 0 };
    events.emit('pet:pet', { pet: { species: 'pony' } });
    assert(!awarded.length, 'a pony is not a reindeer');
    game.net = { remoteApplying: true };
    events.emit('pet:pet', { pet: deer });
    assert(!awarded.length, 'a friend\'s action applied here: nothing');
    game.net = null;
    events.emit('pet:pet', { pet: deer });
    events.emit('pet:pet', { pet: deer });
    assert(awarded.filter((a) => a === 'reindeer_friend').length === 1, 'reindeer_friend once');
    assert(game.profile.reindeer.petted === 2, 'petted counted');
    events.emit('pet:ride', { pet: deer });
    assert(awarded.includes('reindeer_rider'), 'reindeer_rider');
    // the sleigh's flight: a sticker and 3 coins once a day
    events.emit('sleigh:takeoff', { key: 'sleigh' });
    events.emit('sleigh:takeoff', { key: 'sleigh' });
    assert(awarded.includes('sleigh_ride') && coins.length === 1 && coins[0][0] === 3, 'sleigh: 3 coins once: ' + JSON.stringify(coins));
    // her reindeer takes off and lands: 2 coins once, events, a ribbon
    pets.pets.push(deer);
    pets.rider = deer;
    deer.anim.flying = true;
    R.update(1 / 60);
    assert(!emitted.includes('reindeer:fly') && game.reindeer.flying() === false, 'a hop (a moment in the air) is no flight');
    R.update(0.7);
    assert(emitted.includes('reindeer:fly') && coins.length === 2 && coins[1][0] === 2, 'reindeer flight: 2 coins');
    assert(game.debug.reindeer.state().trails === 1 && game.reindeer.flying() === true, 'a ribbon, flying');
    deer.anim.flying = false;
    R.update(1 / 60);
    assert(emitted.includes('reindeer:land') && game.reindeer.flying() === false, 'landed');
    deer.anim.flying = true;
    R.update(0.7);
    assert(coins.length === 2, 'the second flight today pays nothing');
    const total = coins.reduce((a, [n]) => a + n, 0);
    assert(total <= 5, 'at most 5 coins a day: ' + total);
    // the pet goes away: its ribbon too; a guest's page (remote pets) never counts her flights
    pets.pets.length = 0;
    pets.rider = null;
    R.update(1 / 60);
    assert(game.debug.reindeer.state().trails === 0, 'ribbon dropped');
    pets.remote = true;
    pets.pets.push(deer);
    pets.rider = deer;
    deer.anim.flying = true;
    const before = game.profile.reindeer.flights;
    R.update(1 / 60);
    assert(game.profile.reindeer.flights === before, 'a puppet flight is not hers');
    R.onWorldUnload();
    assert(game.debug.reindeer.state().trails === 0, 'world unload clears');
    return `${awarded.length} stickers, ${total} coins`;
  });
}

// famous holiday names (the eight of the song, the gift-giver's names), kept encoded so this
// file never spells them: none may appear in our files (the gift-giver's) or in our names and
// strings (all of them; several are ordinary words, so only string tables are checked for those)
const FAMOUS = ['RGFzaGVy', 'RGFuY2Vy', 'UHJhbmNlcg==', 'Vml4ZW4=', 'Q29tZXQ=', 'Q3VwaWQ=', 'RG9ubmVy', 'RG9uZGVy', 'QmxpdHplbg==']
  .map((b) => Buffer.from(b, 'base64').toString('utf8'));
const GIVER = ['U2FudGE=', 'S3JpcyBLcmluZ2xl', 'U2FpbnQgTmljaw==', 'TXJzXC4/IENsYXVz', 'Q2xhdXM=']
  .map((b) => Buffer.from(b, 'base64').toString('utf8'));

await test('R3: no while loops; no famous names', async () => {
  const files = [];
  for (const dir of ['src/things/reindeer']) {
    const abs = path.join(ROOT, dir);
    if (existsSync(abs)) for (const f of readdirSync(abs)) if (f.endsWith('.js')) files.push(path.join(abs, f));
  }
  for (const f of ['src/things/pets/reindeer.js', 'src/things/vehicles/models-sleigh.js', 'src/things/vehicles/drive.js', 'docs/teams/reindeer.md', 'tools/test-reindeer.mjs']) {
    const abs = path.join(ROOT, f);
    if (existsSync(abs)) files.push(abs);
  }
  const { scanText, scanCharacters } = await import('./lib/name-scan.mjs');
  const giver = new RegExp('\\b(' + GIVER.join('|') + ')\\b', 'i');
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (f.endsWith('.js')) {
      assert(!/\bwhile\s*\(/.test(src), 'no while ( in ' + f);
      assert(!/for\s*\(\s*;\s*;/.test(src), 'no for (;;) in ' + f);
    }
    assert(scanText(src, { extras: true }).length === 0, 'a forbidden name in ' + path.basename(f) + ': ' + JSON.stringify(scanText(src, { extras: true })[0]));
    assert(!giver.test(src), 'the gift-giver named in ' + path.basename(f));
  }
  // our string tables: names, coats, toasts
  let tables = '';
  if (existsSync(reindeerLogic)) {
    const L = await import(reindeerLogic);
    const { SPECIES } = await import('../src/things/pets/species.js');
    tables = JSON.stringify([L.STRINGS, L.HERD_NAMES, SPECIES.reindeer.names, SPECIES.reindeer.variants.map((v) => v.name)]);
  }
  tables += ' ' + VEHICLES.map((v) => v.name + ' ' + v.vehicle.hint).join(' ');
  assert(scanCharacters(tables).length === 0, 'a famous character in our strings: ' + JSON.stringify(scanCharacters(tables)[0]));
  const famous = new RegExp('\\b(' + FAMOUS.join('|') + ')\\b', 'i');
  assert(!famous.test(tables), 'a famous reindeer name in our strings');
  return `${files.length} files, ${tables.length} chars of strings`;
});

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
