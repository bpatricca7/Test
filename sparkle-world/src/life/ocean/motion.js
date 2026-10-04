// How the sea animals move (docs/teams/ocean.md §5): pure steppers over { map, world, props,
// rand } with no THREE, so tools/test-sea.mjs runs them by the thousand. Positions are block
// units; the surface of a water column is top + 0.875. Every loop has a fixed bound, every
// number is sanitized each step (a non-finite value resets the record to its last good pose).
//
// Near the player (20 blocks) every swimmer lives at the surface, because the water is about
// 75% opaque from above: dolphins' backs and fins break the water, fish swim just below, jelly
// bells touch it, turtles come up to breathe.

import { SEA_SPEC } from './kinds.js';

const LIQUID = 5;
export const SURF = 0.875;
export const NEAR = 20;
export const GRAV = 14;
export const LEAP_UP = 7;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = Number.isFinite;

/** Surface bands within 20 blocks of the player: [lowest, highest] centre below the surface. */
export const BAND = {
  dolphin: [0.35, 0.25],
  fish: [0.4, 0.15],
  sea_turtle: [0.8, 0.3],
};

// ---------- records ----------

export function makeRecord(kind, i) {
  return {
    on: false, kind, i, role: 'wild',
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, yaw: 0, pitch: 0, roll: 0, scale: 1,
    state: 'swim', prev: 'swim', t: 0, phase: 0, amp: 0, extra: 0, shade: 1,
    variant: 0, tintVer: 0, glow: 0, flash: 0, name: '', buddy: false, level: 0,
    pod: -1, ox: 0, oz: 0, tx: 0, ty: 0, tz: 0, fade: 0, puffT: 0, leapT: 0, skipT: 0, breathT: 0,
    trick: '', trickN: 0, gx: 0, gy: 0, gz: 0, gyaw: 0, checkT: 0, holdX: 0, holdZ: 0, baby: false,
    lastTap: -1e9, cool: 0, orbit: 0, orbitR: 1, orbitW: 1, hideT: 0, homeX: 0, homeZ: 0,
  };
}

export function saveGood(r) {
  r.gx = r.x; r.gy = r.y; r.gz = r.z; r.gyaw = r.yaw;
}

/** A non-finite number anywhere resets the record to its last good pose. Returns true if reset. */
export function sanitize(r, stats) {
  if (fin(r.x) && fin(r.y) && fin(r.z) && fin(r.vx) && fin(r.vy) && fin(r.vz) && fin(r.yaw) && fin(r.pitch) && fin(r.roll) && fin(r.speed) && fin(r.phase) && fin(r.t)) return false;
  r.x = r.gx; r.y = r.gy; r.z = r.gz; r.yaw = fin(r.gyaw) ? r.gyaw : 0;
  r.vx = r.vy = r.vz = 0; r.speed = 0; r.pitch = 0; r.roll = 0; r.phase = 0; r.t = 0;
  if (r.state === 'leap' || r.state === 'trick') r.state = r.prev === 'leap' || r.prev === 'trick' ? 'swim' : r.prev;
  if (stats) stats.nanResets++;
  return true;
}

// ---------- water rules ----------

const solidOrLiquid = (env, x, y, z) => {
  const id = env.world.get(x, y, z);
  return env.props.solid[id] === 1 || env.props.shape[id] === LIQUID;
};

/** The kind's water rule for the column at (x, z) and the creature's level. */
export function columnOk(env, kind, x, z, level) {
  const m = env.map;
  const top = m.top(x, z);
  if (top < 0 || top !== level) return false;
  const d = m.depth(x, z);
  switch (kind) {
    case 'dolphin': return m.deepAround(x, z, 3);
    case 'fish': return d >= 2;
    case 'sea_turtle': return d >= 2;
    case 'jelly': return d >= 3;
    case 'octopus': return d >= 2 && d <= 6;
    case 'seahorse': return d >= 2 && d <= 5;
    case 'starfish': return d >= 1 && d <= 3;
    default: return d >= 1;
  }
}

/** Is (x, z) a place to spawn a kind? (§3.3; the world's sea level for sea-only kinds) */
export function spawnOk(env, kind, x, z) {
  const m = env.map;
  if (kind === 'crab') return m.shore(x, z);
  if (kind === 'starfish') {
    if (m.shore(x, z)) return !env.isSand || env.isSand(x, z);
    const t = m.top(x, z);
    return t >= 0 && columnOk(env, kind, x, z, t) && m.inBounds(x, z);
  }
  const t = m.top(x, z);
  if (t < 0 || !m.inBounds(x, z)) return false;
  if ((kind === 'sea_turtle' || kind === 'jelly') && env.seaLevel != null && t !== env.seaLevel) return false;
  if (!columnOk(env, kind, x, z, t)) return false;
  if (kind === 'fish') {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (m.top(x + dx, z + dz) !== t) return false;
  }
  return true;
}

/** The centre y of a swimmer near the player: inside its band, with a small bob. */
export function bandY(kind, surf, phase) {
  const b = BAND[kind];
  const mid = (b[0] + b[1]) / 2, half = (b[0] - b[1]) / 2;
  return surf - mid + half * 0.8 * Math.sin(phase * 0.37);
}

/** Free air over the arc: 4 columns ahead (1..4 blocks) x cells level+1 .. level+cells. */
export function arcFree(env, x, z, yaw, level, cells = 4, cols = 4) {
  const sx = Math.sin(yaw), cz = Math.cos(yaw);
  for (let c = 1; c <= cols; c++) {
    const ax = Math.floor(x + sx * c), az = Math.floor(z + cz * c);
    for (let k = 1; k <= cells; k++) if (solidOrLiquid(env, ax, level + k, az)) return false;
  }
  // and above the dolphin itself
  for (let k = 1; k <= cells; k++) if (solidOrLiquid(env, Math.floor(x), level + k, Math.floor(z))) return false;
  return true;
}

/** Can a dolphin leap here? The column 3 to 5 blocks ahead qualifies and the arc is free. */
export function canLeap(env, r) {
  const sx = Math.sin(r.yaw), cz = Math.cos(r.yaw);
  for (let d = 3; d <= 5; d++) if (!columnOk(env, 'dolphin', Math.floor(r.x + sx * d), Math.floor(r.z + cz * d), r.level)) return false;
  return arcFree(env, r.x, r.z, r.yaw, r.level, 4, 5);
}

/** Start a leap: up 7, gravity 14 (apex 1.75 above the start), about 1.0 s in the air. */
export function startLeap(r, fwd = 4) {
  r.prev = r.state === 'leap' ? r.prev : r.state;
  r.state = 'leap';
  r.t = 0;
  r.vy = LEAP_UP;
  r.speed = clamp(fwd, 3, 5);
  r.vx = Math.sin(r.yaw) * r.speed;
  r.vz = Math.cos(r.yaw) * r.speed;
}

/** One step of a leap. Returns 'land' on the step it ends. */
export function stepLeap(r, dt, env) {
  r.t += dt;
  r.x += r.vx * dt;
  r.z += r.vz * dt;
  r.y += r.vy * dt;
  r.vy -= GRAV * dt;
  r.pitch = -Math.atan2(r.vy, Math.max(0.5, r.speed)) * 0.9;
  r.phase += dt * 6;
  const surf = r.level + SURF;
  if (r.vy < 0 && r.y <= surf - 0.3) {
    r.y = surf - 0.3;
    r.vy = 0;
    r.pitch = 0;
    r.state = r.prev && r.prev !== 'leap' ? r.prev : 'swim';
    r.t = 0;
    if (env && env.stats) env.stats.landings = (env.stats.landings || 0) + 1;
    return 'land';
  }
  return null;
}

// ---------- tricks ----------

export const TRICKS = ['spin', 'flip', 'tailwalk'];

/** Start the next trick in order (or a roll at the surface without 3 air cells above). */
export function startTrick(r, env) {
  const name = TRICKS[r.trickN % TRICKS.length];
  r.trickN++;
  const free = arcFree(env, r.x, r.z, r.yaw, r.level, 3, 0);
  let ok = free;
  if (ok && name === 'tailwalk') {
    for (let d = 1; d <= 2 && ok; d++) ok = columnOk(env, 'dolphin', Math.floor(r.x - Math.sin(r.yaw) * d), Math.floor(r.z - Math.cos(r.yaw) * d), r.level);
  }
  if (ok && name === 'flip') {
    ok = arcFree(env, r.x, r.z, r.yaw, r.level, 3, 2);
    for (let d = 1; d <= 2 && ok; d++) ok = columnOk(env, 'dolphin', Math.floor(r.x + Math.sin(r.yaw) * d), Math.floor(r.z + Math.cos(r.yaw) * d), r.level);
  }
  r.prev = r.state === 'trick' || r.state === 'leap' ? r.prev : r.state;
  r.state = 'trick';
  r.trick = ok ? name : 'roll';
  r.t = 0;
  r.tx = r.x; r.tz = r.z; r.ty = r.level + SURF - 0.3;
  return r.trick;
}

const TRICK_LEN = { spin: 1.2, flip: 1.3, tailwalk: 1.6, roll: 0.9 };

/** One step of a trick. Returns 'done' on the step it ends. env (optional): a moving trick
 * stops moving at a column that fails the dolphin's rule. */
export function stepTrick(r, dt, env = null) {
  const ox = r.x, oz = r.z;
  r.t += dt;
  const len = TRICK_LEN[r.trick] || 1;
  const p = clamp(r.t / len, 0, 1);
  const base = r.ty;
  const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
  r.phase += dt * 8;
  r.speed = 0;
  r.vx = r.vz = 0;
  switch (r.trick) {
    case 'spin': // straight up 2.2, a full roll, back down
      r.y = base + 2.2 * Math.sin(Math.PI * p);
      r.pitch = -1.2 * Math.sin(Math.PI * p);
      r.roll = TAU * p;
      break;
    case 'flip': // a forward somersault arc
      r.y = base + 1.8 * Math.sin(Math.PI * p);
      r.pitch = -TAU * p;
      r.x = r.tx + fx * 2 * p;
      r.z = r.tz + fz * 2 * p;
      break;
    case 'tailwalk': // rises half out and moves backward on its kicking tail
      r.y = base + 0.9 * Math.sin(Math.PI * Math.min(1, p * 1.4));
      r.pitch = -1.2 * Math.sin(Math.PI * Math.min(1, p * 1.2));
      r.x = r.tx - fx * 2 * p;
      r.z = r.tz - fz * 2 * p;
      r.phase += dt * 10;
      break;
    default: // roll at the surface
      r.y = base;
      r.roll = TAU * p;
  }
  if (env && (r.x !== ox || r.z !== oz) && !columnOk(env, 'dolphin', Math.floor(r.x), Math.floor(r.z), r.level)) {
    // the way ahead closed (a block landed): it finishes the trick where it is
    r.tx += ox - r.x; r.tz += oz - r.z;
    r.x = ox; r.z = oz;
  }
  if (p >= 1) {
    r.y = base;
    r.pitch = 0;
    r.roll = 0;
    r.state = r.prev && r.prev !== 'trick' && r.prev !== 'leap' ? r.prev : 'swim';
    r.t = 0;
    return 'done';
  }
  return null;
}

// ---------- swimming ----------

const DIRS = 8;

/** The best of 8 directions sampled `dist` away whose column passes (null if none). */
export function bestDirection(env, kind, r, dist = 2, preferYaw = null, allowOut = true) {
  let best = null, bestScore = -Infinity;
  const base = preferYaw == null ? r.yaw : preferYaw;
  for (let k = 0; k < DIRS; k++) {
    const a = base + (k / DIRS) * TAU;
    const x = r.x + Math.sin(a) * dist, z = r.z + Math.cos(a) * dist;
    if (!allowOut && !env.map.inBounds(Math.floor(x), Math.floor(z))) continue;
    if (!columnOk(env, kind, Math.floor(x), Math.floor(z), r.level)) continue;
    let da = Math.abs(((a - base) % TAU + TAU + Math.PI) % TAU - Math.PI);
    const score = -da + env.map.depth(x, z) * 0.05;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

const angDiff = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;

/**
 * Swim toward (tx, tz) at up to `want` blocks/s, turning at `turn` rad/s, never entering a
 * column that fails the kind's rule. Keeps y inside the kind's vertical bounds.
 */
export function swimToward(r, dt, env, tx, tz, want, turn = 2.4) {
  const kind = r.kind;
  const dx = tx - r.x, dz = tz - r.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.05) {
    const goal = Math.atan2(dx, dz);
    const da = angDiff(goal, r.yaw);
    const step = clamp(da, -turn * dt, turn * dt);
    r.yaw += step;
    r.extra = clamp(r.extra * 0.9 + (step / Math.max(dt, 1e-3)) * 0.04, -0.25, 0.25);
  }
  let target = Math.min(want, dist * 1.5);
  // look ahead: never enter a column that fails the rule
  const la = 0.4 + r.speed * 0.25;
  const ax = r.x + Math.sin(r.yaw) * la, az = r.z + Math.cos(r.yaw) * la;
  let blocked = !columnOk(env, kind, Math.floor(ax), Math.floor(az), r.level);
  if (blocked) {
    const b = bestDirection(env, kind, r, 2);
    if (b != null) r.yaw += clamp(angDiff(b, r.yaw), -6 * dt, 6 * dt);
    target = Math.min(target, want * 0.3);
  }
  r.speed += clamp(target - r.speed, -8 * dt, 4 * dt);
  if (r.speed < 0) r.speed = 0;
  let nx = r.x + Math.sin(r.yaw) * r.speed * dt, nz = r.z + Math.cos(r.yaw) * r.speed * dt;
  if (!columnOk(env, kind, Math.floor(nx), Math.floor(nz), r.level)) {
    // the next position itself fails (a block landed there): stay put this step
    nx = r.x; nz = r.z;
    r.speed *= 0.3;
  }
  r.vx = (nx - r.x) / Math.max(dt, 1e-4);
  r.vz = (nz - r.z) / Math.max(dt, 1e-4);
  r.x = nx;
  r.z = nz;
  return blocked;
}

/** Keep a swimmer's centre in its vertical band (near the player) or a bit deeper (far). */
export function settleY(r, dt, env, distToPlayer) {
  const surf = r.level + SURF;
  const bed = env.map.bed(r.x, r.z);
  const floor = bed >= 0 ? bed + 1.3 : surf - 1;
  const b = BAND[r.kind];
  let want;
  if (b) {
    const near = bandY(r.kind, surf, r.phase);
    if (distToPlayer <= NEAR) want = near;
    else {
      const deep = r.kind === 'dolphin' ? surf - 0.9 : r.kind === 'fish' ? surf - 0.6 : surf - 1.2;
      want = near + (deep - near) * clamp((distToPlayer - NEAR) / 6, 0, 1);
    }
    want = Math.max(want, Math.min(floor, surf - b[1]));
  } else want = Math.max(surf - 0.5, floor);
  if (distToPlayer <= NEAR && b) {
    r.y += clamp(want - r.y, -3 * dt, 3 * dt);
    r.y = clamp(r.y, surf - b[0], surf - b[1]);
  } else r.y += clamp(want - r.y, -1.5 * dt, 1.5 * dt);
  if (r.y < floor && floor < surf - 0.1) r.y = floor;
  if (r.y > surf) r.y = surf;
  r.pitch = r.pitch * 0.85;
}

/** A wander target: a point 8 to 14 blocks ahead on qualifying water (6 tries), else around. */
export function wanderTarget(r, env, rand, out, min = 8, max = 14) {
  for (let k = 0; k < 6; k++) {
    const a = r.yaw + (rand() - 0.5) * (k < 3 ? 1.6 : TAU);
    const d = min + rand() * (max - min);
    const x = r.x + Math.sin(a) * d, z = r.z + Math.cos(a) * d;
    if (columnOk(env, r.kind, Math.floor(x), Math.floor(z), r.level)) { out[0] = x; out[1] = z; return true; }
  }
  out[0] = r.x + Math.sin(r.yaw + Math.PI) * 4;
  out[1] = r.z + Math.cos(r.yaw + Math.PI) * 4;
  return false;
}

// ---------- the spawner (ring with fallback, §3.3) ----------

const RING = 16;

export class Spawner {
  constructor(kinds) {
    this.seen = {};
    for (const k of kinds) this.seen[k] = { x: new Float32Array(RING), z: new Float32Array(RING), t: new Float32Array(RING).fill(-1e9), next: 0 };
  }

  reset() {
    for (const k in this.seen) { this.seen[k].t.fill(-1e9); this.seen[k].next = 0; }
  }

  /**
   * Sample `n` columns around (px, pz) in [ring0, ring1]; a hit inside the ring wins. Every
   * qualifying column seen (any distance >= min) goes into the 16-entry memory. Without a ring
   * hit, the farthest remembered cell (seen in the last 2 s) at least `min` away is used,
   * preferring cells behind the camera (camYaw). Writes out = [x, z]; returns 'ring',
   * 'fallback' or null.
   */
  find(kind, env, px, pz, ring0, ring1, min, now, rand, out, { n = 24, camYaw = null, maxR = null, ok = null } = {}) {
    const mem = this.seen[kind];
    const R = maxR || ring1;
    const test = ok || ((x, z) => spawnOk(env, kind, x, z));
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU;
      // half the samples in the ring, half anywhere out to its far edge (small pools)
      const d = k % 2 === 0 ? ring0 + rand() * (ring1 - ring0) : min + rand() * Math.max(0, R - min);
      const x = Math.floor(px + Math.sin(a) * d), z = Math.floor(pz + Math.cos(a) * d);
      if (!test(x, z)) continue;
      const dd = Math.hypot(x + 0.5 - px, z + 0.5 - pz);
      if (dd >= ring0 && dd <= ring1) { out[0] = x + 0.5; out[1] = z + 0.5; return 'ring'; }
      if (dd >= min) {
        const i = mem.next;
        mem.x[i] = x + 0.5; mem.z[i] = z + 0.5; mem.t[i] = now;
        mem.next = (i + 1) % RING;
      }
    }
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < RING; i++) {
      if (now - mem.t[i] > 2) continue;
      const x = mem.x[i], z = mem.z[i];
      if (!test(Math.floor(x), Math.floor(z))) continue;
      const dd = Math.hypot(x - px, z - pz);
      if (dd < min) continue;
      let score = dd;
      if (camYaw != null) {
        const behind = Math.abs(angDiff(Math.atan2(x - px, z - pz), camYaw)) > Math.PI / 2;
        if (behind) score += 100;
      }
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return null;
    out[0] = mem.x[best]; out[1] = mem.z[best];
    return 'fallback';
  }
}

// ---------- per-kind steppers (wild animals; the pod / school brains live in index.js) ----------

/** Fish: each fish orbits its school centre; never outside liquid. */
export function placeFish(r, school, env) {
  const rad = r.orbitR * (school.scatter > 0 ? 1 + 2 * Math.min(1, school.scatter) : 1);
  // the map and the real cell (world.get: an edit with no event is not in the map yet)
  const ok = (x, z) => columnOk(env, 'fish', Math.floor(x), Math.floor(z), school.level) && env.props.shape[env.world.get(Math.floor(x), school.level, Math.floor(z))] === LIQUID;
  let fx = school.x + Math.sin(r.orbit) * rad, fz = school.z + Math.cos(r.orbit) * rad;
  if (!ok(fx, fz)) {
    fx = school.x + Math.sin(r.orbit) * 0.4;
    fz = school.z + Math.cos(r.orbit) * 0.4;
    if (!ok(fx, fz)) { fx = school.x; fz = school.z; }
  }
  const ox = r.x, oz = r.z;
  r.x = fx; r.z = fz;
  const mx = r.x - ox, mz = r.z - oz;
  if (mx * mx + mz * mz > 1e-6) r.yaw = Math.atan2(mx, mz);
  r.level = school.level;
}

/** Crabs walk sideways along shore cells only (4-neighbour steps). */
export function stepCrab(r, dt, env, rand, player) {
  const m = env.map;
  r.t += dt;
  r.phase += dt * 6;
  const pdx = player.x - r.x, pdz = player.z - r.z;
  const pd = Math.hypot(pdx, pdz);
  // the shore changed under it (an edit): to the nearest shore cell within 2, else it goes
  if (!m.shore(Math.floor(r.x), Math.floor(r.z))) {
    let found = false;
    for (let k = 0; k < 16 && !found; k++) {
      const d = k < 8 ? 1 : 2, a = (k % 8) * (TAU / 8);
      const x = Math.floor(r.x + Math.sin(a) * d) + 0.5, z = Math.floor(r.z + Math.cos(a) * d) + 0.5;
      if (m.shore(Math.floor(x), Math.floor(z))) { r.x = r.tx = x; r.z = r.tz = z; found = true; }
    }
    if (!found) { r.lost = true; return; }
    const g = m.ground(r.x, r.z);
    if (g >= 0) { r.ty = g + 1; r.y = g + 1; }
  }
  if (r.state === 'hide') {
    r.hideT -= dt;
    r.y = r.ty - 0.3;
    if (r.hideT <= 0 && pd > 2) { r.state = 'swim'; r.y = r.ty; }
    return;
  }
  // a kid comes close without tapping: scuttle 2 blocks sideways, face her and stay
  if (pd < 1.5 && r.state !== 'scatter' && r.cool <= 0) {
    const side = Math.atan2(pdx, pdz) + Math.PI / 2;
    const cx = Math.floor(r.x), cz = Math.floor(r.z);
    let found = false;
    for (let k = 0; k < 4 && !found; k++) {
      const s = k < 2 ? 1 : -1, step = k % 2 === 0 ? 2 : 1;
      const ax = Math.abs(Math.sin(side)) > Math.abs(Math.cos(side));
      const tx = cx + (ax ? Math.sign(Math.sin(side)) * s * step : 0), tz = cz + (ax ? 0 : Math.sign(Math.cos(side)) * s * step);
      if (m.shore(tx, tz) && (step === 1 || m.shore((cx + tx) >> 1, (cz + tz) >> 1))) { r.tx = tx + 0.5; r.tz = tz + 0.5; found = true; }
    }
    if (found) { r.state = 'scatter'; r.cool = 3; }
    else { r.state = 'hide'; r.hideT = 1; r.ty = r.y; return; }
  }
  r.cool -= dt;
  const dx = r.tx - r.x, dz = r.tz - r.z;
  const d = Math.abs(dx) + Math.abs(dz);
  if (d < 0.05) {
    if (r.state === 'scatter') { r.state = 'rest'; r.t = 0; r.yaw = Math.atan2(pdx, pdz); }
    if (r.t > 1 + rand() * 2) {
      // next: a 4-neighbour shore cell
      const cx = Math.floor(r.x), cz = Math.floor(r.z);
      const k = Math.floor(rand() * 4);
      const tx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), tz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (m.shore(tx, tz)) { r.tx = tx + 0.5; r.tz = tz + 0.5; r.state = 'swim'; }
      r.t = 0;
    }
    r.extra = 1; // snipping claws while paused
    return;
  }
  // move along one axis at a time (x first) so it is always inside a shore cell
  const sp = (r.state === 'scatter' ? 2.4 : SEA_SPEC.crab.speed) * dt;
  if (Math.abs(dx) > 0.01) {
    const nx = r.x + clamp(dx, -sp, sp);
    if (m.shore(Math.floor(nx), Math.floor(r.z))) r.x = nx; else r.tx = r.x;
    if (r.state !== 'scatter') r.yaw = 0; // sideways: nose +Z, walking along X
  } else {
    const nz = r.z + clamp(dz, -sp, sp);
    if (m.shore(Math.floor(r.x), Math.floor(nz))) r.z = nz; else r.tz = r.z;
    if (r.state !== 'scatter') r.yaw = Math.PI / 2;
  }
  const g = m.ground(r.x, r.z);
  if (g >= 0) { r.ty = g + 1; r.y = g + 1; }
  r.extra = 0.4;
}

/**
 * A creature's own cell, read with world.get (not the map): if a block landed there, it pops to
 * the nearest qualifying column within 2 blocks ('moved'), else it should fade ('fade').
 * Returns null when all is well.
 */
export function rescueCell(r, env) {
  if (!env.map.inBounds(Math.floor(r.x), Math.floor(r.z))) return null;
  const cx = Math.floor(r.x), cz = Math.floor(r.z);
  const id = env.world.get(cx, r.level, cz);
  if (env.props.shape[id] === LIQUID && columnOk(env, r.kind, cx, cz, r.level)) return null;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    for (let d = 1; d <= 2; d++) {
      const x = r.x + Math.sin(a) * d, z = r.z + Math.cos(a) * d;
      const ix = Math.floor(x), iz = Math.floor(z);
      if (env.props.shape[env.world.get(ix, r.level, iz)] === LIQUID && columnOk(env, r.kind, ix, iz, r.level)) {
        if (r.state === 'trick') { r.tx += x - r.x; r.tz += z - r.z; }
        r.x = x; r.z = z;
        saveGood(r);
        return 'moved';
      }
    }
  }
  return 'fade';
}
