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
  sea_turtle: [0.45, 0.2], // the shell top breaks the water (the probe's V1: visible from the swim camera)
};

// ---------- records ----------

export function makeRecord(kind, i) {
  return {
    on: false, kind, i, role: 'wild',
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, yaw: 0, pitch: 0, roll: 0, scale: 1,
    state: 'swim', prev: 'swim', t: 0, phase: 0, amp: 0, extra: 0, shade: 1,
    variant: 0, tintVer: 0, glow: 0, flash: 0, name: '', buddy: false, level: 0, dry: false,
    pod: -1, ox: 0, oz: 0, tx: 0, ty: 0, tz: 0, fade: 0, puffT: 0, leapT: 0, skipT: 0, breathT: 0,
    trick: '', trickN: 0, gx: 0, gy: 0, gz: 0, gyaw: 0, checkT: 0, holdX: 0, holdZ: 0, baby: false,
    lastTap: -1e9, cool: 0, orbit: 0, orbitR: 1, orbitW: 1, hideT: 0, homeX: 0, homeZ: 0,
    behind: undefined, clear: 0, sepX: 0, sepZ: 0, pushX: 0, pushZ: 0, waitT: 0, tone: 1,
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
      // half the samples in the ring, half anywhere out to its far edge, more of them near `min`
      // (a small pool beside her has only a few cells far enough away; they are found in seconds)
      const d = k % 2 === 0 ? ring0 + rand() * (ring1 - ring0) : min + rand() * rand() * Math.max(0, R - min);
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

/** A fish swims at most this fast (blocks a second; a scatter's dash) toward its place on its orbit. */
export const FISH_STEP = 14;
/** How fast a fish turns to face the way it swims (radians a second). */
const FISH_TURN = 5;
/** How far out along its line a fish tries when its orbit point is blocked (parts of its radius). */
const IN_STEPS = [1, 0.75, 0.5, 0.25, 0];
/** Places tried around a blocked one (per ring of two), and the candidates in all. */
const AROUND = 8, CANDS = 2 + AROUND * 2 + IN_STEPS.length * 2;

/**
 * Fish: each fish orbits its school centre; never outside liquid. dt > 0 (the game's step): a fish
 * whose place jumps (its orbit point blocked by an ice floe, the spacing, a scatter) swims there at
 * most FISH_STEP a second through open water instead of popping across; one that finds the straight
 * way blocked waits in its own water, and after 1.5 s of that goes straight to its place.
 */
export function placeFish(r, school, env, dt = 0) {
  // a scatter spreads the school out (at most 3 blocks more, so a wide school stays near)
  const rad = r.orbitR + (school.scatter > 0 ? Math.min(3, 2 * r.orbitR) * Math.min(1, school.scatter) : 0);
  // the map and the real cell (world.get: an edit with no event is not in the map yet)
  const ok = (x, z) => columnOk(env, 'fish', Math.floor(x), Math.floor(z), school.level) && env.props.shape[env.world.get(Math.floor(x), school.level, Math.floor(z))] === LIQUID;
  // its place in the school (fishSlot), nudged by its spacing from its school mates (spaceFish)
  // (school.face: the school's rows turned to face her; offX / offZ: its glide; schoolFrame)
  const ang = r.orbit + (school.face || 0);
  const sx = Math.sin(ang), sz = Math.cos(ang);
  const cx = school.x + (school.offX || 0), cz = school.z + (school.offZ || 0);
  // dt > 0 (the game's step): it swims there at most FISH_STEP a second, so it takes the first
  // place it can reach this step without crossing a floe (a place past one is skipped for one
  // nearer the centre that it can reach)
  const live = dt > 0 && Number.isFinite(r.x) && Number.isFinite(r.z) && r.level === school.level && ok(r.x, r.z);
  const max = FISH_STEP * dt;
  let fx = school.x, fz = school.z, gx = NaN, gz = NaN, got = false;
  // its place (spaced, then not); a blocked one: the nearest open water around it (toward the
  // school's middle first), so fish by a floe stay spread out instead of bunching at one spot;
  // last, in along its line from the centre
  const px = cx + sx * rad, pz = cz + sz * rad, toC = Math.atan2(-sx, -sz);
  for (let k = 0; k < CANDS && !got; k++) {
    let x, z;
    if (k < 2) { x = px + (k === 0 ? r.sepX : 0); z = pz + (k === 0 ? r.sepZ : 0); }
    else if (k < 2 + AROUND * 2) {
      const j = k - 2, ring = j < AROUND ? 0.9 : 1.8, n = j % AROUND;
      const a = toC + ((n + 1) >> 1) * (n & 1 ? 1 : -1) * (TAU / AROUND);
      x = px + r.sepX + Math.sin(a) * ring; z = pz + r.sepZ + Math.cos(a) * ring;
    } else {
      const j = k - 2 - AROUND * 2, d = Math.max(0.4, rad * IN_STEPS[j % IN_STEPS.length]), home = j >= IN_STEPS.length;
      x = (home ? school.x : cx) + sx * d; z = (home ? school.z : cz) + sz * d;
    }
    if (!ok(x, z)) continue;
    if (!live) { fx = x; fz = z; got = true; break; }
    if (gx !== gx) { gx = x; gz = z; }
    const dx = x - r.x, dz = z - r.z, dd = Math.hypot(dx, dz);
    if (dd <= max) { fx = x; fz = z; got = true; break; }
    const nx = r.x + (dx / dd) * max, nz = r.z + (dz / dd) * max;
    if (ok(nx, nz)) { fx = nx; fz = nz; got = true; }
  }
  if (live) {
    if (got) r.waitT = 0;
    else if (gx === gx) {
      // every way there crosses a floe: slide along its edge (one axis), else wait in its own
      // water, and after 1.5 s of that go straight to its place
      const dx = gx - r.x, dz = gz - r.z;
      const ax = r.x + clamp(dx, -max, max), az = r.z + clamp(dz, -max, max);
      if (Math.abs(dx) > 1e-3 && ok(ax, r.z)) { fx = ax; fz = r.z; r.waitT = 0; }
      else if (Math.abs(dz) > 1e-3 && ok(r.x, az)) { fx = r.x; fz = az; r.waitT = 0; }
      else if ((r.waitT += dt) < 1.5) { fx = r.x; fz = r.z; }
      else { fx = gx; fz = gz; r.waitT = 0; }
    } else { fx = r.x; fz = r.z; }
  }
  const ox = r.x, oz = r.z;
  r.x = fx; r.z = fz;
  // it faces the way it swims, turning smoothly (a school gliding back turns round, never flips)
  const mx = r.x - ox, mz = r.z - oz;
  if (!(dt > 0)) { if (mx * mx + mz * mz > 1e-6) r.yaw = Math.atan2(mx, mz); }
  else if (mx * mx + mz * mz > (0.15 * dt) * (0.15 * dt)) r.yaw += clamp(angDiff(Math.atan2(mx, mz), r.yaw), -FISH_TURN * dt, FISH_TURN * dt);
  r.level = school.level;
}

/** Little Fish keep this far apart (centre to centre, block units; a fish is about 0.92 long, 0.66 tall). */
export const FISH_APART = 1.3;
const SEP_MAX = 1.4, PUSH_MAX = 0.04;
/** Fish side by side in a school's row, and how far its back row is behind the front one (blocks). */
export const FISH_SIDE = 1.8, FISH_ROWS = 1.4;
/** How fast a school's rows turn to face her (radians a second) and its slow glide (blocks, rad/s). */
const FACE_TURN = 0.35, GLIDE = 1.2, GLIDE_W = 0.45;
/** How wide (half, per scale) and tall (half) a fish looks from the camera, with a little room. */
const VIEW_W = 0.5, VIEW_H = 0.4;
/** Schools farther than this from the camera are not spaced across the view (too small to matter). */
const VIEW_FAR = 24;

/**
 * Fish i of a school of n: its place in the school. Up to 4 fish swim side by side in one row;
 * more make two rows across her view, the back one FISH_ROWS behind and set between the front
 * fish, so from her camera every fish shows whole (none sits behind another with its face
 * peeking out). Neighbours are FISH_SIDE apart. Sets r.orbit (the place's angle in the school's
 * frame: 0 = straight away from her) and r.orbitR (its distance from the centre); r.orbitW = 0
 * (the school turns as one: schoolFrame).
 */
export function fishSlot(r, i, n) {
  const rows = n <= 4 ? 1 : 2;
  const front = Math.ceil(n / rows);
  const row = i < front ? 0 : 1, col = row ? i - front : i, cnt = row ? n - front : front;
  // rows of the same length are set half a fish over (an odd school already is)
  const shift = rows === 2 && cnt * 2 === n ? (row ? 0.25 : -0.25) * FISH_SIDE : 0;
  const side = (col - (cnt - 1) / 2) * FISH_SIDE + shift;
  const away = rows === 2 ? (row ? 0.5 : -0.5) * FISH_ROWS : 0;
  r.orbit = Math.atan2(side, away);
  r.orbitR = Math.hypot(side, away);
  r.orbitW = 0;
}

/**
 * A school's frame for this step: its rows turn slowly (FACE_TURN) to face the camera or the
 * player at (px, pz), and the whole school glides gently from side to side across her view
 * (school.offX / offZ, added to its centre by placeFish). dt 0: face her at once.
 */
export function schoolFrame(school, px, pz, dt) {
  const want = Math.atan2(school.x - px, school.z - pz);
  if (!Number.isFinite(school.face) || !(dt > 0)) school.face = Number.isFinite(want) ? want : 0;
  else if (Number.isFinite(want)) school.face += clamp(angDiff(want, school.face), -FACE_TURN * dt, FACE_TURN * dt);
  school.glideT = (school.glideT || 0) + (dt > 0 ? dt : 0);
  const g = GLIDE * Math.sin(school.glideT * GLIDE_W);
  school.offX = Math.cos(school.face) * g;
  school.offZ = -Math.sin(school.face) * g;
}

/**
 * Gentle spacing inside a school: fish closer than FISH_APART push each other apart sideways, a
 * quarter of the overlap a frame and at most PUSH_MAX in all (both at 60 fps; scaled by dt, so a
 * slower frame rate spaces them as well; a fish never darts), and the push is
 * kept in the fish's own small offset (sepX / sepZ, added to its orbit by placeFish) that eases
 * back to 0 when nothing is near, so two fish never melt into one two-headed blob. A push that
 * would leave the school's water slides along the edge (one axis) or is skipped; a fish skipping
 * out of the water is left alone.
 * cam ({ x, y, z }, the camera): also across the view. Two school mates that look one over the
 * other from the camera (one behind the other, its face peeking out at the edge: "a fish with four
 * eyes") move apart sideways across the view until both show whole.
 * list[from .. from + n - 1] are the school's fish. Pure, no allocations.
 */
export function spaceFish(list, from, n, dt, school = null, env = null, cam = null) {
  // per frame at 60 fps; a slower frame (an older iPad) pushes as much per second
  const ease = Math.max(0, 1 - dt * 0.6), end = from + n, fr = Math.min(4, Math.max(0.25, dt * 60));
  const share = Math.min(0.5, 0.25 * fr), most = PUSH_MAX * fr;
  for (let i = from; i < end; i++) { const r = list[i]; r.sepX *= ease; r.sepZ *= ease; r.pushX = 0; r.pushZ = 0; }
  for (let i = from; i < end; i++) {
    const a = list[i];
    if (!a.on || a.state === 'skip') continue;
    for (let j = i + 1; j < end; j++) {
      const b = list[j];
      if (!b.on || b.state === 'skip') continue;
      const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
      const h = Math.hypot(dx, dz), d = Math.hypot(h, dy);
      if (d >= FISH_APART) continue;
      // straight apart; two fish on the very same spot part along their index
      const ux = h > 1e-3 ? dx / h : Math.sin(a.i * 2.4 + 1), uz = h > 1e-3 ? dz / h : Math.cos(a.i * 2.4 + 1);
      const k = (FISH_APART - d) * share;
      a.pushX -= ux * k; a.pushZ -= uz * k;
      b.pushX += ux * k; b.pushZ += uz * k;
    }
  }
  if (cam && school) viewSpace(list, from, end, share, school, cam);
  for (let i = from; i < end; i++) {
    const r = list[i];
    let m = Math.hypot(r.pushX, r.pushZ);
    if (m > 0 && Number.isFinite(m)) {
      if (m > most) { r.pushX *= most / m; r.pushZ *= most / m; }
      // the push, or (against a floe or the shore) the part of it along the edge
      for (let t = 0; t < 3; t++) {
        const px = t === 2 ? 0 : r.pushX, pz = t === 1 ? 0 : r.pushZ;
        if (t > 0 && px === 0 && pz === 0) continue;
        const x = r.x + px, z = r.z + pz;
        if (!env || (columnOk(env, 'fish', Math.floor(x), Math.floor(z), school.level) && env.props.shape[env.world.get(Math.floor(x), school.level, Math.floor(z))] === LIQUID)) {
          r.x = x; r.z = z;
          r.sepX += px; r.sepZ += pz;
          break;
        }
      }
    }
    // a soft cap: an offset past SEP_MAX shrinks back a little each frame (never a jump)
    m = Math.hypot(r.sepX, r.sepZ);
    if (!Number.isFinite(m)) { r.sepX = 0; r.sepZ = 0; } else if (m > SEP_MAX) { const f = (SEP_MAX + (m - SEP_MAX) * 0.9) / m; r.sepX *= f; r.sepZ *= f; }
  }
}

/**
 * How much two fish overlap as seen from cam (0: apart; else the smaller of the sideways and
 * up-down overlaps, in view units: size / distance). sign[0]: which way a must go across the view
 * (+1 / -1). View axes: v = (vx, vz) along the view to the school, u = (vz, -vx) across it.
 */
export function viewOverlap(a, b, cam, vx, vz, sign = null) {
  const ax = a.x - cam.x, az = a.z - cam.z, bx = b.x - cam.x, bz = b.z - cam.z;
  const da = ax * vx + az * vz, db = bx * vx + bz * vz;
  if (da < 1 || db < 1) return 0;
  const la = (ax * vz - az * vx) / da, lb = (bx * vz - bz * vx) / db;
  const ha = (a.y - cam.y) / da, hb = (b.y - cam.y) / db;
  const sa = (a.scale || 1) / da, sb = (b.scale || 1) / db;
  const ex = VIEW_W * (sa + sb) - Math.abs(la - lb), ey = VIEW_H * (sa + sb) - Math.abs(ha - hb);
  if (ex <= 0 || ey <= 0) return 0;
  if (sign) sign[0] = la > lb || (la === lb && a.i < b.i) ? 1 : -1;
  return ex;
}

const _sign = [1];
/** The across-the-view part of spaceFish: pushes go into pushX / pushZ (capped there). */
function viewSpace(list, from, end, share, school, cam) {
  let vx = school.x - cam.x, vz = school.z - cam.z;
  const vl = Math.hypot(vx, vz);
  if (!(vl > 0.5) || vl > VIEW_FAR) return;
  vx /= vl; vz /= vl;
  const ux = vz, uz = -vx;
  for (let i = from; i < end; i++) {
    const a = list[i];
    if (!a.on || a.state === 'skip') continue;
    for (let j = i + 1; j < end; j++) {
      const b = list[j];
      if (!b.on || b.state === 'skip') continue;
      const ex = viewOverlap(a, b, cam, vx, vz, _sign);
      if (ex <= 0) continue;
      // apart across the view: each moves its share, in blocks at its own distance
      const da = (a.x - cam.x) * vx + (a.z - cam.z) * vz, db = (b.x - cam.x) * vx + (b.z - cam.z) * vz;
      const s = _sign[0], k = ex * share * 0.5;
      a.pushX += ux * s * k * da; a.pushZ += uz * s * k * da;
      b.pushX -= ux * s * k * db; b.pushZ -= uz * s * k * db;
    }
  }
}

/**
 * Whether a see-through block that is not a liquid (glass, a jelly block, ice: pass 3) lies on the
 * line from a (the camera) to b (an animal): a voxel walk over the cells strictly between them
 * (the camera's own cell and the animal's are skipped). Lines over 48 blocks: false.
 */
export function glassBetween(world, pass, shape, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0) || len > 48) return false;
  let x = Math.floor(ax), y = Math.floor(ay), z = Math.floor(az);
  const tx = Math.floor(bx), ty = Math.floor(by), tz = Math.floor(bz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ix = dx !== 0 ? 1 / Math.abs(dx) : Infinity, iy = dy !== 0 ? 1 / Math.abs(dy) : Infinity, iz = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
  let mx = dx !== 0 ? (sx > 0 ? x + 1 - ax : ax - x) * ix : Infinity;
  let my = dy !== 0 ? (sy > 0 ? y + 1 - ay : ay - y) * iy : Infinity;
  let mz = dz !== 0 ? (sz > 0 ? z + 1 - az : az - z) * iz : Infinity;
  for (let i = 0; i < 160; i++) {
    if (x === tx && y === ty && z === tz) return false;
    if (i > 0) {
      const id = world.get(x, y, z);
      if (pass[id] === 3 && shape[id] !== LIQUID) return true;
    }
    const t = Math.min(mx, my, mz);
    if (t > 1) return false;
    if (t === mx) { x += sx; mx += ix; } else if (t === my) { y += sy; my += iy; } else { z += sz; mz += iz; }
  }
  return false;
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

/**
 * Swimmers of different kinds keep apart too (owner review: a fish on a dolphin's back, an
 * octopus on a dolphin's tail). APART (index.js) spaces one kind and spaceFish a school; this
 * spaces any two animals of different kinds: each kind has a half-room (CROSS, blocks), and two
 * animals closer (side to side) than the sum of theirs, and within CROSS_UP of each other up and
 * down (a bed animal right under a dolphin looks stacked from her camera), are eased apart a
 * little each frame (at most 0.08 in all, so none darts). One that cannot move (riding, leaping,
 * held, in the gallery: fixed) leaves the whole push to the other. A fish keeps its push in its
 * spacing offset (sepX / sepZ), so it eases back to its place in the school afterwards. A push
 * that would leave the animal's water is skipped. list[0 .. n - 1]: the live swimmers (kinds in
 * CROSS). Pure, no allocations; n is at most the swimmer caps (about 60), so n * n / 2 cheap checks.
 */
export const CROSS = { dolphin: 1.0, sea_turtle: 0.8, octopus: 0.75, jelly: 0.55, fish: 0.6, seahorse: 0.45 };
export const CROSS_UP = 3.5;
export function apartKinds(list, n, env, fixed) {
  for (let i = 0; i < n; i++) {
    const a = list[i], ra = CROSS[a.kind];
    for (let j = i + 1; j < n; j++) {
      const b = list[j];
      if (b.kind === a.kind) continue;
      const d = ra + CROSS[b.kind], dx = b.x - a.x, dz = b.z - a.z;
      if (dx >= d || dx <= -d || dz >= d || dz <= -d) continue;
      const h = Math.hypot(dx, dz);
      if (h >= d || Math.abs(b.y - a.y) > CROSS_UP) continue;
      const wa = fixed[a.state] ? 0 : 1, wb = fixed[b.state] ? 0 : 1;
      if (!wa && !wb) continue;
      const k = Math.min(0.08, (d - h) * 0.25) * 2 / (wa + wb);
      const ux = h > 1e-3 ? dx / h : Math.sin(a.i + 1), uz = h > 1e-3 ? dz / h : Math.cos(a.i + 1);
      if (wa) nudge(a, -ux * k, -uz * k, env);
      if (wb) nudge(b, ux * k, uz * k, env);
    }
  }
}

function nudge(r, px, pz, env) {
  const x = r.x + px, z = r.z + pz, cx = Math.floor(x), cz = Math.floor(z);
  if (r.kind === 'fish') {
    if (!columnOk(env, 'fish', cx, cz, r.level) || env.props.shape[env.world.get(cx, r.level, cz)] !== LIQUID) return;
    r.sepX += px; r.sepZ += pz;
  } else if (!r.dry && !columnOk(env, r.kind, cx, cz, r.level)) return;
  r.x = x; r.z = z;
}
