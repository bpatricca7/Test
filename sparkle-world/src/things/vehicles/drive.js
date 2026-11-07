// The live vehicle she drives: a small kinematic model on voxels (docs/teams/vehicles.md §5).
// Pure logic over { physics, world } (src/world/physics.js), no three.js, no game: Node tests
// drive it directly (tools/test-vehicles.mjs).
//
// The body is three squares along the nose (centre and both ends; one square when it is as
// long as it is wide), each tested with physics.bodyBlocked. Cars climb a 1-block step (the
// physics snaps, the picture eases up through liftVis), roll gently off ledges, stop softly at
// walls and refuse water at the shore; boats only move on water at one water level.
//
// Safety (the game once froze on iPads from a non-finite position in an endless loop):
//   - every number is checked every step: a non-finite pose (pos, yaw, speed, vy) goes back to
//     the last good pose; a non-finite picture value (lift, pitch, roll) is just zeroed;
//   - every loop has a fixed bound (sub-steps 4, probes 3, unstick 3, water scans 64 and 32);
//     there is no while loop in this folder (tools/test-vehicles.mjs checks).
//
// wave 5: a vehicle whose spec says flies (the sleigh, docs/teams/reindeer.md) also flies:
// controls.up takes off and climbs, controls.down dives, letting go sinks gently; the air move
// hops over low things, slides along walls and stops softly; the floor below (solid, or water
// to hover over) is found with two bounded overlap scans; it lands softly on solid ground only,
// never above world.sy + 1 and never through a block. Every other vehicle never takes this path.

const TWO_PI = Math.PI * 2;
const COAST = 3.5; // blocks/s² when she lets go
const BRAKE = 9; // blocks/s² when she pushes the other way
const GRAVITY = 18; // gentler than hers (24)
const MAX_FALL = 14;
const STEP_UP = 1.05; // highest step a car climbs
const SUPPORT_REACH = 1.2; // how far below the wheels we look for ground
const SUB_STEP = 0.3; // longest move per sub-step
const MAX_SUB = 4;
const WATER_SCAN = 64;
const WATER_DROP = 32; // how far down a car looks for water past its bumper (a cliff over a pond)
const WET_EDGE = 3; // near the spot she was put back from water, no driving over a drop
const BOAT_CLEARANCE = 1.85; // hull and rider above the water (a tall boat says more: body.clearance)
// wave 5: flying (spec.flies)
export const FLY = {
  UP: 4.2, // blocks/s climbing (controls.up)
  DOWN: 4.5, // blocks/s diving (controls.down)
  SINK: 0.8, // blocks/s gliding down with nothing held
  LAND: 4, // blocks/s for the Land button (autoland)
  ACCEL: 9, // blocks/s² easing vy toward what she asks
  SOFT: 1.5, // near the floor the descent slows to at most 0.45 + SOFT * height
  HOP: 1.6, // highest thing the air move hops over
  SCAN: 40, // one floor scan (two of them: 80 blocks, more than the world is tall)
  CEIL: 1, // highest pos.y above world.sy
  HOVER: 0.7, // above water it hovers this high (it never lands in water)
  COAST: 1.2, // blocks/s² it slows in the air with the stick let go (a glide)
};

/** Signed smallest turn from a to b (radians). */
export function angleDelta(a, b) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

const fin = Number.isFinite;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Highest liquid cell in the column at (x, z) going up from y0 (at most 64 cells), or -1. */
export function waterTopAt(physics, world, x, y0, z) {
  if (!fin(x) || !fin(y0) || !fin(z)) return -1;
  let y = Math.floor(y0);
  if (!physics.liquidAt(x, y + 0.5, z)) return -1;
  for (let i = 0; i < WATER_SCAN; i++) {
    if (y + 1 >= world.sy || !physics.liquidAt(x, y + 1.5, z)) return y;
    y++;
  }
  return y;
}

export class Drive {
  /**
   * @param {object} o
   * @param {object} o.physics  Physics (overlap, bodyBlocked, liquidAt)
   * @param {object} o.world    { sx, sy, sz }
   * @param {object} o.spec     def.vehicle (body, speed, reverse, accel, turn, kind, water)
   * @param {number[]} o.pos    pivot: footprint centre at wheel level (boats: the water cell y)
   * @param {number} o.yaw
   */
  constructor({ physics, world, spec, pos, yaw }) {
    this.physics = physics;
    this.world = world;
    this.spec = spec;
    this.boat = !!spec.water;
    const b = spec.body || {};
    this.halfW = clamp(fin(b.halfW) ? b.halfW : 0.85, 0.2, 2);
    this.halfL = clamp(fin(b.halfL) ? b.halfL : this.halfW, this.halfW, 3);
    this.height = clamp(fin(b.height) ? b.height : 1.5, 0.5, 3);
    // boats: the room they need above the water (the Sailboat's mast and sail)
    this.clearance = clamp(fin(b.clearance) ? b.clearance : BOAT_CLEARANCE, 1, 4.5);
    this.off = this.halfL - this.halfW; // probe offset along the nose
    this.probes = this.off > 0.01 ? [-1, 0, 1] : [0];
    this.pos = { x: pos[0], y: pos[1], z: pos[2] };
    this.yaw = fin(yaw) ? yaw : 0;
    this.speed = 0;
    this.vy = 0;
    this.yawRate = 0;
    this.onGround = true;
    this.reversing = false;
    // picture-only values (never feed back into the physics)
    this.liftVis = 0;
    this.pitchVis = 0;
    this.rollVis = 0;
    this.squash = 0;
    // boats keep one water level
    this.waterY = this.boat ? Math.floor(this.pos.y) : -1;
    if (this.boat) this.pos.y = this.waterY;
    this.good = { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw };
    // what happened this step (index.js reads them for sounds, sparkles and toasts)
    this.hit = null; // 'wall' | 'water' | 'shore' | null
    this.bumpSpeed = 0;
    this.climbed = 0;
    this.trouble = null; // 'stuck' | 'dry' | null: the system should park the vehicle
    this.wetEdge = null; // { x, z }: where a fall into water put her back (no driving off there)
    // counters for the debug API and the tests
    this.nanResets = 0;
    this.bumps = 0;
    this.blockedFrames = 0;
    this.warned = false;
    this._sup = { top: 0, any: false };
    // wave 5: flying (spec.flies, never a boat)
    this.flies = !!spec.flies && !this.boat;
    this.flying = false;
    this.landing = false; // the Land button: come down now (cleared by Up or touching down)
    this.tookOff = false; // this step: it left the ground
    this.landed = false; // this step: it touched down
    this.airTime = 0; // seconds in the air this drive
    this.airHeight = 0; // height over the floor below (0 on the ground)
    this._floor = { top: 0, wet: false };
  }

  // ---------- geometry ----------

  /** x/z of probe i (-1, 0, 1) at a pose. */
  _px(x, yaw, i) {
    return x + Math.sin(yaw) * this.off * i;
  }

  _pz(z, yaw, i) {
    return z + Math.cos(yaw) * this.off * i;
  }

  /** Is the whole body free at this pose? (boats: on water, nothing at hull height) */
  poseFree(x, y, z, yaw) {
    if (!fin(x) || !fin(y) || !fin(z) || !fin(yaw)) return false;
    const ph = this.physics, hw = this.halfW;
    const m = this.halfL + 0.02;
    if (x < m || z < m || x > this.world.sx - m || z > this.world.sz - m) return false;
    for (const i of this.probes) {
      const px = this._px(x, yaw, i), pz = this._pz(z, yaw, i);
      if (this.boat) {
        if (!ph.liquidAt(px, this.waterY + 0.5, pz)) return false;
        if (ph.bodyBlocked(px, this.waterY + 0.05, pz, hw, this.clearance)) return false;
      } else if (ph.bodyBlocked(px, y + 0.01, pz, hw, this.height)) return false;
    }
    return true;
  }

  /** Highest top of anything blocking the body at this pose (the step it would climb). */
  _blockTop(x, y, z, yaw) {
    const ph = this.physics, hw = this.halfW;
    let top = -Infinity;
    for (const i of this.probes) {
      const px = this._px(x, yaw, i), pz = this._pz(z, yaw, i);
      // copy top out of the shared hit record before the next call resets it
      if (ph.bodyBlocked(px, y + 0.01, pz, hw, this.height)) {
        const t = ph._hit.top;
        if (t > top) top = t;
      }
    }
    return top;
  }

  /** Ground top under probe i within reach, or the finite "nothing" value y - reach. */
  _support(x, y, z, yaw, i) {
    const ph = this.physics, hw = this.halfW;
    const px = this._px(x, yaw, i), pz = this._pz(z, yaw, i);
    const none = y - SUPPORT_REACH;
    if (!ph.overlap(px - hw, y - SUPPORT_REACH, pz - hw, px + hw, y + 0.05, pz + hw)) return none;
    const t = ph._hit.top;
    return fin(t) ? Math.max(none, t) : none;
  }

  /**
   * Water ahead of a car: under the bumper (centre and both corners), liquid at the wheels'
   * level or below them before any ground (a pond down a ledge or a cliff counts too).
   */
  _waterAhead(x, y, z, yaw, dir) {
    const ph = this.physics;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const bx = x + s * this.halfL * dir, bz = z + c * this.halfL * dir;
    const side = this.halfW * 0.8;
    for (let k = -1; k <= 1; k++) {
      const px = bx + c * side * k, pz = bz - s * side * k;
      if (ph.liquidAt(px, y + 0.1, pz)) return true;
      for (let dy = 0; dy < WATER_DROP; dy++) {
        const cy = y - 0.6 - dy;
        if (ph.liquidAt(px, cy, pz)) return true;
        if (ph.bodyBlocked(px, cy - 0.4, pz, 0.05, 0.8)) break; // ground first: no water
      }
    }
    return false;
  }

  // ---------- safety ----------

  _restore() {
    const g = this.good;
    this.pos.x = g.x;
    this.pos.y = g.y;
    this.pos.z = g.z;
    this.yaw = g.yaw;
    this.speed = 0;
    this.vy = 0;
    this.liftVis = 0;
  }

  /**
   * Non-finite pose -> back to the last good pose (counted, one console.warn per drive);
   * non-finite picture values -> 0. Returns false when it had to restore.
   */
  sanitize() {
    let ok = true;
    const p = this.pos;
    if (!fin(p.x) || !fin(p.y) || !fin(p.z) || !fin(this.yaw) || !fin(this.speed) || !fin(this.vy)) {
      this._restore();
      this.nanResets++;
      if (!this.warned) {
        this.warned = true;
        console.warn('[vehicles] a broken number in the drive, back to the last good spot');
      }
      ok = false;
    }
    if (!fin(this.liftVis)) this.liftVis = 0;
    if (!fin(this.pitchVis)) this.pitchVis = 0;
    if (!fin(this.rollVis)) this.rollVis = 0;
    if (!fin(this.squash)) this.squash = 0;
    if (!fin(this.yawRate)) this.yawRate = 0;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    // far below or above the world: the last good pose (like the player's float back)
    if (p.y < -8 || p.y > this.world.sy + 30) {
      this._restore();
      ok = false;
    }
    return ok;
  }

  // ---------- controls ----------

  /**
   * Controls -> target speed and turn rate (docs §6.1). c = { mx, mz, camYaw }: the joystick /
   * keys (input.move, x right, z forward) and the camera's yaw. Pointing is camera-relative,
   * like walking and riding; pulling back while the camera is behind reverses.
   */
  _controls(c) {
    const spec = this.spec;
    let mx = c && fin(c.mx) ? clamp(c.mx, -1, 1) : 0;
    let mz = c && fin(c.mz) ? clamp(c.mz, -1, 1) : 0;
    const camYaw = c && fin(c.camYaw) ? c.camYaw : this.yaw;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }
    const throttle = Math.min(1, len);
    const max = this.flying && fin(spec.flySpeed) ? spec.flySpeed : fin(spec.speed) ? spec.speed : 6;
    const turn = fin(spec.turn) ? spec.turn : 2;
    const grip = Math.min(1, 0.35 + Math.abs(this.speed) / 1.5); // 35% turning at a standstill
    this.reversing = false;
    if (throttle < 0.15) return { target: 0, rate: 0, throttle: 0 };
    const behind = Math.abs(angleDelta(this.yaw, camYaw)) < 1.2;
    if (mz < -0.35 && Math.abs(mx) < 0.75 * Math.abs(mz) && behind) {
      // pull back = reverse; the side swings the tail that way
      this.reversing = true;
      const back = fin(spec.reverse) ? spec.reverse : 2.5;
      return { target: -back * throttle, rate: 0.6 * turn * mx * grip, throttle };
    }
    // point to go
    const rel = angleDelta(this.yaw, Math.atan2(wx, wz));
    const rate = clamp(3 * rel, -turn, turn) * grip;
    const target = max * throttle * (1 - 0.5 * Math.min(1, Math.abs(rel) / 1.6));
    return { target, rate, throttle };
  }

  // ---------- one frame ----------

  /** Advance dt seconds with controls { mx, mz, camYaw }. Never throws on bad numbers. */
  step(dt, controls) {
    this.hit = null;
    this.bumpSpeed = 0;
    this.climbed = 0;
    this.tookOff = false;
    this.landed = false;
    if (!(dt > 0)) return this;
    const we = this.wetEdge;
    if (we && !(Math.hypot(this.pos.x - we.x, this.pos.z - we.z) <= WET_EDGE + 1)) this.wetEdge = null;
    dt = Math.min(dt, 0.05);
    this.sanitize();
    // something appeared inside her car (a friend's block, an Undo): lift it out, else park
    if (!this.poseFree(this.pos.x, this.pos.y, this.pos.z, this.yaw)) this._unstick();
    if (this.trouble) return this;

    const { target, rate, throttle } = this._controls(controls);
    const accel = fin(this.spec.accel) ? this.spec.accel : 5;
    const diff = target - this.speed;
    let r;
    if (Math.sign(target) !== Math.sign(this.speed) && this.speed !== 0 && target !== 0) r = BRAKE;
    else if (Math.abs(target) > Math.abs(this.speed)) r = accel;
    else r = throttle > 0 ? BRAKE * 0.5 : this.flying ? FLY.COAST : COAST;
    this.speed += clamp(diff, -r * dt, r * dt);
    if (Math.abs(this.speed) < 0.01 && target === 0) this.speed = 0;

    // turn (never into a wall)
    this.yawRate = rate;
    if (rate !== 0) {
      const ny = this.yaw + rate * dt;
      if (this.poseFree(this.pos.x, this.pos.y, this.pos.z, ny)) this.yaw = ny;
      else this.yawRate = 0;
    }

    // wave 5: a flying vehicle takes off on Up (also mid-fall: a save), then flies
    const up = !!(controls && controls.up === true), down = !!(controls && controls.down === true);
    if (this.flies && !this.flying && up) this._takeOff();
    if (this.flying) {
      this._airMove(dt);
      this._fly(dt, up, down);
    } else {
      this._move(dt);
      if (this.boat) this._float();
      else this._fall(dt);
      this.airHeight = 0;
    }
    this._picture(dt);

    // keep inside the world, like the player
    const m = this.halfL + 0.02, w = this.world;
    this.pos.x = clamp(this.pos.x, m, w.sx - m);
    this.pos.z = clamp(this.pos.z, m, w.sz - m);
    if (this.pos.y > this.world.sy + FLY.CEIL) this.pos.y = this.world.sy + FLY.CEIL; // wave 5
    this.sanitize();
    if ((this.boat || this.onGround || this.flying) && this.poseFree(this.pos.x, this.pos.y, this.pos.z, this.yaw)) {
      const g = this.good;
      g.x = this.pos.x; g.y = this.pos.y; g.z = this.pos.z; g.yaw = this.yaw;
    }
    return this;
  }

  /** Move along the nose in up to 4 sub-steps: free, climb, slide or stop. */
  _move(dt) {
    const d = this.speed * dt;
    if (d === 0) return;
    const n = Math.min(MAX_SUB, Math.max(1, Math.ceil(Math.abs(d) / SUB_STEP)));
    const s = d / n;
    const nx = Math.sin(this.yaw), nz = Math.cos(this.yaw);
    const dir = s > 0 ? 1 : -1;
    const p = this.pos;
    for (let k = 0; k < n; k++) {
      const tx = p.x + nx * s, tz = p.z + nz * s;
      if (this._ok(tx, p.y, tz, dir)) {
        p.x = tx; p.z = tz;
        continue;
      }
      // a step: climb it if the whole body fits on top (cars on the ground only)
      if (!this.boat && this.onGround && !this._wet(tx, p.y, tz, dir)) {
        const top = this._blockTop(tx, p.y, tz, this.yaw);
        const rise = top - p.y;
        if (fin(rise) && rise > 0 && rise <= STEP_UP && this.poseFree(tx, top + 0.001, tz, this.yaw)) {
          p.x = tx; p.z = tz; p.y = top + 0.001;
          this.liftVis = clamp(this.liftVis - rise, -1.5, 1.5);
          this.speed *= 0.75;
          this.climbed++;
          continue;
        }
      }
      // what stopped the straight move: the shore (boats), water ahead (cars), or a wall; a
      // boat gliding along the shore or a car along a pond's edge still says so (a toast)
      const wet = !this.boat && this._wet(tx, p.y, tz, dir);
      if (this.boat) this.hit = 'shore';
      else if (wet) this.hit = 'water';
      // slide along the wall: the X part alone, then the Z part alone (when they move at all)
      if (Math.abs(nx * s) > 0.01 && this._ok(p.x + nx * s, p.y, p.z, dir)) {
        p.x += nx * s;
        this.speed *= 0.85;
        continue;
      }
      if (Math.abs(nz * s) > 0.01 && this._ok(p.x, p.y, p.z + nz * s, dir)) {
        p.z += nz * s;
        this.speed *= 0.85;
        continue;
      }
      // a soft stop: a boing and stars at a wall (a boat only splashes at the shore)
      if (!this.hit) this.hit = 'wall';
      if (this.hit === 'wall' && Math.abs(this.speed) > 2) {
        this.bumps++;
        this.bumpSpeed = Math.abs(this.speed);
        this.squash = 0.3;
      }
      this.speed = 0;
      this.blockedFrames++;
      break;
    }
  }

  _wet(x, y, z, dir) {
    return this._waterAhead(x, y, z, this.yaw, dir) || this._overWetEdge(x, y, z, dir);
  }

  /**
   * Near the spot a fall into water put her back: a drop under the nose (more than a ledge)
   * counts as water, so a held stick cannot drive off into the same pond again and again.
   */
  _overWetEdge(x, y, z, dir) {
    const e = this.wetEdge;
    if (!e || Math.hypot(x - e.x, z - e.z) > WET_EDGE) return false;
    const i = this.probes.length > 1 ? dir : 0;
    return this._support(x, y, z, this.yaw, i) <= y - SUPPORT_REACH + 1e-6;
  }

  /** May the body be at (x, y, z) now? (free, and for cars: no water at the bumper) */
  _ok(x, y, z, dir) {
    if (!this.poseFree(x, y, z, this.yaw)) return false;
    return this.boat || !this._wet(x, y, z, dir);
  }

  /** Cars: rest on the highest supported probe, else fall gently (never through ground). */
  _fall(dt) {
    const p = this.pos;
    let support = -Infinity;
    for (const i of this.probes) {
      const s = this._support(p.x, p.y, p.z, this.yaw, i);
      if (s > support) support = s;
    }
    if (!fin(support)) support = p.y - SUPPORT_REACH;
    if (support >= p.y - 0.01) {
      p.y = Math.max(p.y, support);
      if (this.vy < -6) this.squash = 0.25; // a soft landing
      this.vy = 0;
      this.onGround = true;
    } else {
      this.vy = Math.max(this.vy - GRAVITY * dt, -MAX_FALL);
      p.y = Math.max(support, p.y + this.vy * dt);
      this.onGround = p.y <= support + 0.001;
      if (this.onGround) this.vy = 0;
    }
    // never end in water: rolled into a pond some other way -> the last good spot, and that
    // edge stays closed while she is near it (no fall-and-back-again loop with a held stick)
    if (this.physics.liquidAt(p.x, p.y + 0.1, p.z)) {
      this._restore();
      this.hit = 'water';
      if (fin(p.x) && fin(p.z)) this.wetEdge = { x: p.x, z: p.z };
      if (!this.poseFree(p.x, p.y, p.z, this.yaw)) this.trouble = 'stuck';
    }
  }

  /** Boats: always at the water level; the water went away -> a neighbouring column or park. */
  _float() {
    const p = this.pos;
    p.y = this.waterY;
    this.vy = 0;
    this.onGround = false;
    if (this.poseFree(p.x, p.y, p.z, this.yaw)) return;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        if (this.poseFree(p.x + dx, p.y, p.z + dz, this.yaw)) {
          p.x += dx;
          p.z += dz;
          return;
        }
      }
    }
    this.trouble = 'dry';
  }

  /** Start of a step inside something: up 1, 2, 3, else the last good pose, else park. */
  _unstick() {
    const p = this.pos;
    if (!this.boat) {
      for (let k = 1; k <= 3; k++) {
        if (this.poseFree(p.x, p.y + k, p.z, this.yaw)) {
          p.y += k;
          this.liftVis = clamp(this.liftVis - k, -1.5, 1.5);
          return;
        }
      }
    }
    const g = this.good;
    if (this.poseFree(g.x, g.y, g.z, g.yaw)) {
      this._restore();
      return;
    }
    if (this.boat) {
      this._float();
      if (!this.trouble && this.poseFree(p.x, p.y, p.z, this.yaw)) return;
    }
    this.speed = 0;
    this.trouble = 'stuck';
  }

  // ---------- flying (wave 5, spec.flies) ----------

  /** Leave the ground (or stop a fall) when there is room just above. */
  _takeOff() {
    const p = this.pos;
    if (!this.poseFree(p.x, p.y + 0.25, p.z, this.yaw)) return false; // a roof: stay
    this.flying = true;
    this.onGround = false;
    this.landing = false;
    this.vy = Math.max(fin(this.vy) ? this.vy : 0, 1.5);
    this.tookOff = true;
    this.squash = 0.15;
    return true;
  }

  /**
   * The floor under the body: the highest solid top below each probe (two bounded scans of
   * SCAN blocks), or the water surface plus HOVER where the probe is over water (wet: it may
   * not land there). Never -Infinity: nothing found is y - 2 * SCAN. Into this._floor.
   */
  floorBelow(x = this.pos.x, y = this.pos.y, z = this.pos.z, yaw = this.yaw) {
    const ph = this.physics, hw = this.halfW, f = this._floor;
    f.top = -Infinity;
    f.wet = false;
    f.ground = -Infinity; // highest solid top or water surface (whole blocks: the park pose)
    if (!fin(x) || !fin(y) || !fin(z) || !fin(yaw)) {
      f.top = f.ground = fin(y) ? y : 0;
      return f;
    }
    for (const i of this.probes) {
      const px = this._px(x, yaw, i), pz = this._pz(z, yaw, i);
      let t = -Infinity;
      for (let k = 0; k < 2; k++) {
        const hi = y + 0.05 - k * FLY.SCAN, lo = hi - FLY.SCAN;
        if (ph.overlap(px - hw, lo, pz - hw, px + hw, hi, pz + hw) && fin(ph._hit.top)) {
          t = ph._hit.top;
          break;
        }
      }
      if (!fin(t)) t = y - 2 * FLY.SCAN;
      let top = t, ground = t;
      if (ph.liquidAt(px, t + 0.5, pz)) {
        const w = waterTopAt(ph, this.world, px, t + 0.5, pz);
        const surf = (w >= 0 ? w : Math.floor(t)) + 1;
        top = surf + FLY.HOVER;
        ground = surf;
        f.wet = true;
      }
      if (top > f.top) f.top = top;
      if (ground > f.ground) f.ground = ground;
    }
    if (!fin(f.top)) f.top = y - 2 * FLY.SCAN;
    if (!fin(f.ground)) f.ground = f.top;
    return f;
  }

  /** In the air along the nose: free, hop over (up to HOP), slide, or stop softly. */
  _airMove(dt) {
    const d = this.speed * dt;
    if (!(d !== 0) || !fin(d)) return;
    const n = Math.min(MAX_SUB, Math.max(1, Math.ceil(Math.abs(d) / SUB_STEP)));
    const s = d / n;
    const nx = Math.sin(this.yaw), nz = Math.cos(this.yaw);
    const p = this.pos, ceil = this.world.sy + FLY.CEIL;
    for (let k = 0; k < n; k++) {
      const tx = p.x + nx * s, tz = p.z + nz * s;
      if (this.poseFree(tx, p.y, tz, this.yaw)) {
        p.x = tx; p.z = tz;
        continue;
      }
      const top = this._blockTop(tx, p.y, tz, this.yaw);
      const rise = top - p.y;
      if (fin(rise) && rise > 0 && rise <= FLY.HOP && top + 0.001 <= ceil && this.poseFree(tx, top + 0.001, tz, this.yaw)) {
        p.x = tx; p.z = tz; p.y = top + 0.001;
        this.liftVis = clamp(this.liftVis - rise, -1.5, 1.5);
        this.speed *= 0.9;
        this.climbed++;
        continue;
      }
      if (Math.abs(nx * s) > 0.01 && this.poseFree(p.x + nx * s, p.y, p.z, this.yaw)) {
        p.x += nx * s;
        this.speed *= 0.85;
        continue;
      }
      if (Math.abs(nz * s) > 0.01 && this.poseFree(p.x, p.y, p.z + nz * s, this.yaw)) {
        p.z += nz * s;
        this.speed *= 0.85;
        continue;
      }
      this.hit = 'wall';
      if (Math.abs(this.speed) > 2) {
        this.bumps++;
        this.bumpSpeed = Math.abs(this.speed);
        this.squash = 0.3;
      }
      this.speed = 0;
      this.blockedFrames++;
      break;
    }
  }

  /** Up, down or a gentle sink; soft near the floor; lands on solid ground, hovers on water. */
  _fly(dt, up, down) {
    const p = this.pos;
    if (up) this.landing = false;
    const f = this.floorBelow();
    const h = Math.max(0, p.y - f.top);
    let want = up ? FLY.UP : down ? -FLY.DOWN : this.landing ? -FLY.LAND : -FLY.SINK;
    if (want < 0) want = Math.max(want, -(0.45 + FLY.SOFT * h)); // a soft touch down
    if (!fin(this.vy)) this.vy = 0;
    this.vy += clamp(want - this.vy, -FLY.ACCEL * dt, FLY.ACCEL * dt);
    let ny = p.y + this.vy * dt;
    const ceil = this.world.sy + FLY.CEIL;
    if (ny > ceil) {
      ny = ceil;
      if (this.vy > 0) this.vy = 0;
    }
    let touch = false;
    if (ny <= f.top) {
      // at the floor: water -> hover (up again if it sank in), solid -> touch down
      if (f.wet) {
        // rise back to the hover height gently when it is under it (never lands in water)
        ny = p.y < f.top ? Math.min(f.top, Math.max(ny, p.y + 3 * dt)) : f.top;
        if (this.vy < 0) this.vy = 0;
      } else {
        ny = f.top;
        touch = true;
      }
    }
    if (!fin(ny)) ny = p.y;
    // never into a block (the floor scan saw every probe; this is the belt and braces)
    if (ny !== p.y && !this.poseFree(p.x, ny, p.z, this.yaw)) {
      if (ny > p.y) {
        this.vy = 0; // a ceiling: stay
        ny = p.y;
      } else if (this.poseFree(p.x, f.top + 0.001, p.z, this.yaw) && f.top <= p.y && !f.wet) {
        ny = f.top + 0.001;
        touch = true;
      } else {
        ny = p.y;
        this.vy = 0;
      }
    }
    p.y = ny;
    this.airHeight = Math.max(0, p.y - f.ground);
    this.airTime += dt;
    if (touch) {
      if (this.vy < -3) this.squash = 0.25;
      this.flying = false;
      this.landing = false;
      this.onGround = true;
      this.vy = 0;
      this.landed = true;
      this.airHeight = 0;
    }
  }

  /** Start landing now (the Land button): down at LAND speed until it touches. */
  land() {
    if (!this.flying) return false;
    this.landing = true;
    return true;
  }

  /**
   * A ground pose under the vehicle for parking and saves while it flies: the solid top (or
   * the water surface) below, else the pose itself.
   */
  groundPose() {
    const p = this.pos;
    if (!this.flying) return { x: p.x, y: p.y, z: p.z, yaw: this.yaw };
    const f = this.floorBelow();
    const y = fin(f.ground) ? Math.max(0, Math.min(this.world.sy - 1, Math.round(f.ground))) : p.y;
    return { x: p.x, y, z: p.z, yaw: this.yaw };
  }

  /** Picture-only: ease the climb, tip the nose, sway in turns, settle the squash. */
  _picture(dt) {
    this.liftVis += clamp(-this.liftVis, -5 * dt, 5 * dt);
    let pitch = 0;
    if (this.flying) {
      // wave 5: nose up climbing, down diving, a deeper bank in turns
      pitch = clamp(this.vy * 0.05, -0.22, 0.22);
    } else if (!this.boat && this.probes.length > 1) {
      const p = this.pos;
      const front = this._support(p.x, p.y, p.z, this.yaw, 1);
      const back = this._support(p.x, p.y, p.z, this.yaw, -1);
      // a missing ground is the finite "reach" value (never -Infinity: atan2 would give NaN)
      pitch = clamp(Math.atan2(front - back, 2 * this.off), -0.3, 0.3);
      if (!fin(pitch)) pitch = 0;
    }
    pitch += clamp(-this.liftVis * 0.25, -0.2, 0.2) * Math.sign(this.speed || 1);
    this.pitchVis += (pitch - this.pitchVis) * Math.min(1, 10 * dt);
    const roll = this.flying
      ? clamp(-this.yawRate * this.speed * 0.03, -0.22, 0.22)
      : clamp(-this.yawRate * this.speed * 0.012, -0.08, 0.08);
    this.rollVis += (roll - this.rollVis) * Math.min(1, 6 * dt);
    this.squash = Math.max(0, this.squash - dt);
    if (!fin(this.pitchVis)) this.pitchVis = 0;
    if (!fin(this.rollVis)) this.rollVis = 0;
  }

  // ---------- for the system ----------

  /**
   * World position of a model-space point (footprint min corner origin) at the current pose,
   * into out ({ x, y, z } or a Vector3). size = def.size [w, h, d].
   */
  modelToWorld(size, lx, ly, lz, out) {
    const ox = lx - size[0] / 2, oz = lz - size[2] / 2;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    out.x = this.pos.x + ox * c + oz * s;
    out.y = this.pos.y + ly;
    out.z = this.pos.z - ox * s + oz * c;
    return out;
  }

  /** Does the body overlap block cell (x, y, z)? (nothing is built into her car) */
  overlapsCell(x, y, z) {
    const p = this.pos, hw = this.halfW;
    const y0 = this.boat ? this.waterY + 0.05 : p.y, y1 = this.boat ? this.waterY + 0.05 + this.clearance : p.y + this.height;
    if (!(y1 > y && y0 < y + 1)) return false;
    for (const i of this.probes) {
      const px = this._px(p.x, this.yaw, i), pz = this._pz(p.z, this.yaw, i);
      if (px + hw > x && px - hw < x + 1 && pz + hw > z && pz - hw < z + 1) return true;
    }
    return false;
  }
}
