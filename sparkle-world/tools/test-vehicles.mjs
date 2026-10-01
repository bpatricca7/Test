// Vehicle physics and park-spot tests (docs/teams/vehicles.md §10.1), no browser, seconds:
//   node tools/test-vehicles.mjs            (npm run test:vehicles)
// Drives src/things/vehicles/drive.js and park.js over the real src/world/physics.js on a fake
// voxel world (a Uint8Array and block props), like tools/net/fake-adapter.mjs does for net.
//   1  NaN / Infinity in the pose, the speed and the controls never stick; 1b off a cliff
//   2  bounded: random worlds and controls, every step is quick, never inside a solid, cars
//      never end in water, boats never leave it
//   3  climbing a 1-block step, stopping at a 2-block wall, rolling off a ledge, reversing
//   4  park spots fit, are on whole cells and turns; a sealed box gives null within 588 checks
//   5  no while loops in src/things/vehicles

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Physics } from '../src/world/physics.js';
import { SHAPES } from '../src/core/registry.js';
import { Drive, waterTopAt } from '../src/things/vehicles/drive.js';
import { findParkSpot, bottomCells, anchorFromCenter, centerFromAnchor, rotFromYaw } from '../src/things/vehicles/park.js';
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

// ---------- a fake world ----------

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

/** Flat ground: solid up to y = top - 1, so a car stands at y = top. */
function flatWorld(top = 4, sx = 48, sz = 48) {
  const w = new FakeWorld(sx, 32, sz);
  w.fill(0, 0, 0, sx - 1, top - 1, sz - 1, STONE);
  return w;
}

function setup(world) {
  return { world, physics: new Physics(world, new Set()) };
}

const spec = (key) => vehicleDef(key).vehicle;
const CAR = spec('car_convertible');
const BUBBLE = spec('car_bubble');
const BOAT = spec('boat_speed');

function makeDrive(env, s, x, y, z, yaw = 0) {
  return new Drive({ physics: env.physics, world: env.world, spec: s, pos: [x, y, z], yaw });
}

const allFinite = (d) => [d.pos.x, d.pos.y, d.pos.z, d.yaw, d.speed, d.vy, d.liftVis, d.pitchVis, d.rollVis].every(Number.isFinite);
const FWD = { mx: 0, mz: 1, camYaw: 0 };

/** The vehicle pose is clear: a car's body, a boat's water. */
function cleanPose(d) {
  return d.poseFree(d.pos.x, d.pos.y, d.pos.z, d.yaw);
}

// ---------- fake canPlace for park spots (entities.canPlace, minus furniture) ----------

function makeCtx(world, occupied = new Set()) {
  const ctx = {
    calls: 0,
    canPlace(def, x, y, z, rot) {
      ctx.calls++;
      const [w, h, d] = def.size;
      const ai = Math.floor((w - 1) / 2);
      for (let i = 0; i < w; i++) {
        for (let k = 0; k < d; k++) {
          const [ox, oz] = rotXZ(i - ai, k - (d - 1), rot);
          for (let j = 0; j < h; j++) {
            const cx = x + ox, cy = y + j, cz = z + oz;
            if (!world.inBounds(cx, cy, cz)) return false;
            const id = world.get(cx, cy, cz);
            if (id !== 0 && !props.replaceable[id]) return false;
            if (occupied.has(world.index(cx, cy, cz))) return false;
          }
        }
      }
      return true;
    },
    liquid: (x, y, z) => props.shape[world.get(x, y, z)] === SHAPES.liquid,
    solid: (x, y, z) => props.solid[world.get(x, y, z)] === 1,
  };
  return ctx;
}

// =====================================================================================

console.log('Vehicles: physics and park spots');

await test('1: NaN / Infinity never stick (pose, speed, controls)', () => {
  const env = setup(flatWorld());
  const d = makeDrive(env, CAR, 20, 4, 20, 0);
  const bad = [NaN, Infinity, -Infinity];
  let corrupted = 0;
  for (let i = 0; i < 400; i++) {
    const v = bad[i % 3];
    if (i % 2 === 0) {
      const f = i % 8;
      if (f === 0) d.pos.x = v;
      else if (f === 2) d.yaw = v;
      else if (f === 4) d.speed = v;
      else d.vy = v;
      corrupted++;
    }
    if (i % 5 === 0) { d.liftVis = NaN; d.pitchVis = Infinity; d.rollVis = -Infinity; }
    d.step(1 / 60, { mx: i % 3 === 0 ? NaN : 0.3, mz: i % 4 === 0 ? Infinity : 1, camYaw: i % 7 === 0 ? NaN : 0 });
    assert(allFinite(d), `finite after step ${i}`);
    assert(cleanPose(d), `free pose after step ${i}`);
  }
  assert(d.nanResets === corrupted, `nanResets counts every broken pose (${d.nanResets} vs ${corrupted})`);
  return `${d.nanResets} resets`;
});

await test('1b: off a 3-block cliff the car falls (no NaN from the empty air under it)', () => {
  const w = flatWorld(4);
  w.fill(0, 1, 26, 47, 3, 47, AIR); // a cliff edge at z = 26: ground 3 blocks lower beyond
  const env = setup(w);
  const d = makeDrive(env, CAR, 20, 4, 22, 0);
  let minY = d.pos.y;
  for (let i = 0; i < 180; i++) {
    d.step(1 / 60, FWD);
    minY = Math.min(minY, d.pos.y);
    assert(allFinite(d), 'finite');
  }
  assert(d.nanResets === 0, 'nanResets === 0, got ' + d.nanResets);
  assert(Math.abs(d.pos.y - 1) < 0.05, 'landed 3 lower, y = ' + d.pos.y.toFixed(3));
  assert(d.pos.z > 27, 'moved past the edge, z = ' + d.pos.z.toFixed(2));
  return `y ${d.pos.y.toFixed(2)}, z ${d.pos.z.toFixed(1)}`;
});

await test('2: bounded - 20 seeds x 2,000 random steps in random worlds', () => {
  let maxMs = 0, steps = 0, slow = 0, troubles = 0;
  const times = [];
  for (let seed = 1; seed <= 20; seed++) {
    const rand = mulberry32(seed * 7919);
    const w = flatWorld(4);
    // walls 1..3 high, pits, ponds (water one below the ground), sealed 1x1 holes, slabs
    for (let k = 0; k < 40; k++) {
      const x = 2 + Math.floor(rand() * 42), z = 2 + Math.floor(rand() * 42);
      const sx = 1 + Math.floor(rand() * 4), sz = 1 + Math.floor(rand() * 4);
      const kind = rand();
      if (kind < 0.25) w.fill(x, 4, z, x + sx, 4 + Math.floor(rand() * 3), z + sz, STONE);
      else if (kind < 0.4) w.fill(x, 2, z, x + sx, 3, z + sz, AIR);
      else if (kind < 0.6) { w.fill(x, 2, z, x + sx + 2, 3, z + sz + 2, AIR); w.fill(x, 3, z, x + sx + 2, 3, z + sz + 2, WATER); }
      else if (kind < 0.7) w.set(x, 3, z, AIR);
      else if (kind < 0.8) w.fill(x, 4, z, x + sx, 4, z + sz, SLAB);
      else w.fill(x, 4, z, x, 5, z, STONE);
    }
    const env = setup(w);
    const keys = ['car_convertible', 'car_bubble', 'car_kart', 'van_camper', 'car_jeep'];
    const s = spec(keys[seed % keys.length]);
    // start somewhere free on dry ground
    let d = null;
    for (let t = 0; t < 400 && !d; t++) {
      const x = 4 + rand() * 40, z = 4 + rand() * 40;
      const cand = makeDrive(env, s, x, 4, z, rand() * 6.28);
      if (cand.poseFree(x, 4, z, cand.yaw) && !env.physics.liquidAt(x, 3.5, z) && !env.physics.liquidAt(x, 4.1, z)) d = cand;
    }
    assert(d, 'found a start');
    let c = { mx: 0, mz: 1, camYaw: 0 };
    for (let i = 0; i < 2000; i++) {
      if (i % 40 === 0) c = { mx: rand() * 2 - 1, mz: rand() * 2 - 1, camYaw: d.yaw + (rand() - 0.5) * 3 };
      const dt = rand() < 0.05 ? 0 : rand() * 0.05;
      const t0 = performance.now();
      d.step(dt, c);
      const ms = performance.now() - t0;
      steps++;
      if (i > 50) {
        times.push(ms);
        if (ms > maxMs) maxMs = ms;
        if (ms > 2) slow++;
      }
      if (d.trouble) { troubles++; break; }
      assert(allFinite(d), `finite (seed ${seed}, step ${i})`);
      assert(cleanPose(d), `never inside a solid (seed ${seed}, step ${i}) at ${d.pos.x.toFixed(2)},${d.pos.y.toFixed(2)},${d.pos.z.toFixed(2)}`);
      assert(!env.physics.liquidAt(d.pos.x, d.pos.y + 0.1, d.pos.z), `a car never ends in water (seed ${seed}, step ${i})`);
    }
  }
  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  assert(p99 < 2, `99% of steps under 2 ms (p99 ${p99.toFixed(3)} ms)`);
  assert(slow < steps * 0.002, `almost no step over 2 ms (${slow} of ${steps}; max ${maxMs.toFixed(2)} ms, GC pauses)`);
  return `${steps} steps, p99 ${p99.toFixed(3)} ms, max ${maxMs.toFixed(2)} ms, ${troubles} parked on trouble`;
});

await test('2b: boats never leave the water (10 seeds x 2,000 steps)', () => {
  let steps = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const rand = mulberry32(seed * 104729);
    const w = flatWorld(4);
    // a lake of water at y = 3 (ground level 4 around it), with islands and a bridge
    w.fill(6, 1, 6, 41, 3, 41, WATER);
    for (let k = 0; k < 10; k++) {
      const x = 8 + Math.floor(rand() * 30), z = 8 + Math.floor(rand() * 30);
      if (rand() < 0.5) w.fill(x, 1, z, x + Math.floor(rand() * 3), 3, z + Math.floor(rand() * 3), STONE);
      else w.fill(x, 5, z, x + 3, 5, z, STONE); // a bridge at hull height
    }
    const env = setup(w);
    const s = spec(['boat_speed', 'boat_swan', 'boat_sail'][seed % 3]);
    let d = null;
    for (let t = 0; t < 400 && !d; t++) {
      const x = 8 + rand() * 32, z = 8 + rand() * 32;
      const cand = makeDrive(env, s, x, 3, z, rand() * 6.28);
      if (cand.poseFree(x, 3, z, cand.yaw)) d = cand;
    }
    assert(d, 'found a start on the water');
    let c = { mx: 0, mz: 1, camYaw: 0 };
    for (let i = 0; i < 2000; i++) {
      if (i % 30 === 0) c = { mx: rand() * 2 - 1, mz: rand() * 2 - 1, camYaw: d.yaw + (rand() - 0.5) * 3 };
      d.step(rand() * 0.05, c);
      steps++;
      assert(!d.trouble, 'no trouble on a lake');
      assert(allFinite(d) && d.pos.y === 3, 'at the water level');
      for (const i2 of d.probes) {
        const px = d._px(d.pos.x, d.yaw, i2), pz = d._pz(d.pos.z, d.yaw, i2);
        assert(env.physics.liquidAt(px, 3.5, pz), 'every probe on water');
      }
    }
  }
  return `${steps} steps`;
});

await test('3: a 1-block step is climbed; a 2-block wall stops it with one bump; off a ledge lands 1 lower', () => {
  // climb
  let w = flatWorld(4);
  w.fill(0, 4, 26, 47, 4, 47, STONE); // a step up at z = 26
  let env = setup(w);
  let d = makeDrive(env, CAR, 20, 4, 23.5, 0);
  let t = 0, climbedAt = -1;
  for (; t < 2.5; t += 1 / 60) {
    // about 2 blocks a second toward the step
    d.step(1 / 60, { mx: 0, mz: d.speed < 2 ? 0.4 : 0, camYaw: 0 });
    if (climbedAt < 0 && Math.abs(d.pos.y - 5) < 0.01) climbedAt = t;
  }
  assert(climbedAt >= 0 && climbedAt < 1.6, 'climbed the step, at ' + climbedAt.toFixed(2) + ' s');
  assert(Math.abs(d.pos.y - 5) < 0.01, 'y + 1');
  // wall
  w = flatWorld(4);
  w.fill(0, 4, 26, 47, 5, 26, STONE);
  env = setup(w);
  d = makeDrive(env, CAR, 20, 4, 21, 0);
  for (let i = 0; i < 180; i++) d.step(1 / 60, FWD);
  assert(d.speed === 0, 'stopped');
  assert(d.bumps === 1, 'one bump, got ' + d.bumps);
  assert(cleanPose(d) && d.pos.z + CAR.body.halfL <= 26.001, 'in front of the wall, nose at ' + (d.pos.z + CAR.body.halfL).toFixed(3));
  // ledge
  w = flatWorld(5);
  w.fill(0, 4, 26, 47, 4, 47, AIR);
  env = setup(w);
  d = makeDrive(env, CAR, 20, 5, 22, 0);
  for (let i = 0; i < 150; i++) d.step(1 / 60, FWD);
  assert(Math.abs(d.pos.y - 4) < 0.01 && d.pos.z > 28, 'one lower: y ' + d.pos.y.toFixed(3));
  // reverse: camera behind, pull back
  d = makeDrive(env, CAR, 20, 4, 36, 0);
  for (let i = 0; i < 90; i++) d.step(1 / 60, { mx: 0, mz: -1, camYaw: 0 });
  assert(d.pos.z < 35 && d.reversing, 'reversed, z ' + d.pos.z.toFixed(2));
  // the shore: a car stops before water, a single-probe car too
  w = flatWorld(4);
  w.fill(0, 3, 30, 47, 3, 47, WATER);
  env = setup(w);
  for (const s of [CAR, BUBBLE]) {
    d = makeDrive(env, s, 20, 4, 24, 0);
    for (let i = 0; i < 240; i++) d.step(1 / 60, FWD);
    assert(d.hit === 'water' || d.speed === 0, 'stopped at the water');
    assert(d.pos.z + s.body.halfL <= 30.001, 'bumper on land');
    assert(d.bumps === 0, 'no boing at the shore');
  }
  return `climbed in ${climbedAt.toFixed(2)} s`;
});

await test('3b: boats stop at the shore and keep one water level', () => {
  const w = flatWorld(4);
  w.fill(0, 1, 0, 47, 3, 30, WATER); // water up to z = 30, land after
  const env = setup(w);
  const d = makeDrive(env, BOAT, 20, 3, 20, 0);
  assert(waterTopAt(env.physics, w, 20, 1, 20) === 3, 'water top');
  for (let i = 0; i < 300; i++) d.step(1 / 60, FWD);
  assert(d.hit === 'shore' || d.speed === 0, 'stopped at the shore');
  assert(d.pos.y === 3 && d.pos.z + BOAT.body.halfL <= 31.001, 'on the water (the lake ends at z = 31)');
  // the water goes away under her: trouble 'dry' (the system parks it)
  w.fill(0, 1, 0, 47, 3, 30, STONE);
  d.step(1 / 60, FWD);
  assert(d.trouble === 'dry' || d.trouble === 'stuck', 'trouble when the lake is gone: ' + d.trouble);
});

await test('4: park spots fit, on whole cells and quarter turns; sealed box = null within 588', () => {
  const w = flatWorld(4);
  const ctx = makeCtx(w);
  let n = 0;
  const rand = mulberry32(99);
  for (const v of VEHICLES) {
    if (v.vehicle.water) continue;
    for (let k = 0; k < 40; k++) {
      const pose = { x: 6 + rand() * 36, y: 4 + rand() * 0.01, z: 6 + rand() * 36, yaw: (rand() - 0.5) * 7 };
      const r = findParkSpot(ctx, v, pose);
      assert(r, 'a spot on open ground');
      assert(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.z) && r.rot >= 0 && r.rot <= 3, 'whole cells');
      assert(ctx.canPlace(v, r.x, r.y, r.z, r.rot), 'fits');
      // on open ground it parks right where it is, nose the nearest way
      const [cx, cz] = centerFromAnchor(v.size, r.x, r.z, r.rot);
      assert(Math.hypot(cx - pose.x, cz - pose.z) < 1.2, 'near the pose');
      n++;
    }
  }
  // anchor <-> centre round trip
  for (const v of VEHICLES) for (let rot = 0; rot < 4; rot++) {
    const [cx, cz] = centerFromAnchor(v.size, 10, 12, rot);
    const [ax, az] = anchorFromCenter(v.size, cx, cz, rot);
    assert(ax === 10 && az === 12, `round trip ${v.key} rot ${rot}`);
  }
  assert(rotFromYaw(Math.PI / 2) === 1 && rotFromYaw(-Math.PI / 2) === 3 && rotFromYaw(NaN) === 0, 'rotFromYaw');
  // sealed: stone everywhere around
  const sealed = new FakeWorld(48, 32, 48);
  sealed.fill(0, 0, 0, 47, 31, 47, STONE);
  sealed.fill(20, 4, 20, 21, 5, 21, AIR); // a 2 x 2 x 2 pocket: too short for a 3-long car
  const sctx = makeCtx(sealed);
  const r = findParkSpot(sctx, vehicleDef('car_convertible'), { x: 21, y: 4, z: 21.5, yaw: 0 });
  assert(r === null, 'no spot in a sealed box');
  assert(sctx.calls <= 588 && findParkSpot.lastChecks <= 588, 'at most 588 checks, made ' + sctx.calls);
  const r2 = findParkSpot(sctx, vehicleDef('car_convertible'), { x: 21, y: 4, z: 21.5, yaw: 0 }, { extended: true });
  assert(r2 === null && findParkSpot.lastChecks <= 588 + 3468, 'extended search bounded: ' + findParkSpot.lastChecks);
  // boats: only on water cells (the top layer)
  const lake = flatWorld(4);
  lake.fill(0, 1, 0, 47, 3, 24, WATER);
  const lctx = makeCtx(lake);
  const boat = vehicleDef('boat_speed');
  const rb = findParkSpot(lctx, boat, { x: 20, y: 3, z: 15, yaw: 0.3 });
  assert(rb && rb.y === 3, 'boat parks on the water');
  for (const [x, y, z] of bottomCells(boat.size, rb.x, rb.y, rb.z, rb.rot)) assert(lctx.liquid(x, y, z), 'all bottom cells water');
  // a car never parks on water
  const rc = findParkSpot(lctx, vehicleDef('car_bubble'), { x: 20, y: 4, z: 23, yaw: 0 });
  assert(rc, 'the car parks');
  for (const [x, y, z] of bottomCells(vehicleDef('car_bubble').size, rc.x, rc.y, rc.z, rc.rot)) assert(!lctx.liquid(x, y, z), 'car not on water');
  return `${n} spots`;
});

await test('5: no while loops in src/things/vehicles (every loop has a fixed bound)', () => {
  const dir = path.join(ROOT, 'src/things/vehicles');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert(!/\bwhile\s*\(/.test(src), `no while ( in ${f}`);
    assert(!/for\s*\(\s*;\s*;/.test(src), `no for (;;) in ${f}`);
  }
  return `${files.length} files`;
});

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
