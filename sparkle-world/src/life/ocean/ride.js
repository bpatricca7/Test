// The dolphin ride (docs/teams/ocean.md §6): pure physics, Node-tested (tools/test-sea.mjs S4).
// The dolphin keeps the level it started on, steers like the horse, is faster than a horse,
// never enters a column that is not deep water (it brakes inside its look-ahead), U-turns at
// the world edge, leaps on Jump, and ends the ride when the water or the room around the
// rider goes away. env = { map, world, props, bodyBlocked(x, y, z) }.

const LIQUID = 5;
const SURF = 0.875;
export const RIDE_SPEED = 9.5;
export const RIDE_RUN = 12;
export const RIDE_ACCEL = 6;
export const RIDE_BRAKE = 30;
export const LEAP_COOL = 1.2;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = Number.isFinite;
const angDiff = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;

const free = (env, x, y, z) => {
  const id = env.world.get(x, y, z);
  return env.props.solid[id] !== 1 && env.props.shape[id] !== LIQUID;
};

export class DolphinRide {
  constructor() {
    this.on = false;
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.speed = 0; this.level = 0;
    this.lift = 0; this.vy = 0; this.leaping = false; this.hop = false;
    this.cool = 0; this.uturn = 0; this.uturnYaw = 0; this.t = 0; this.kick = 0;
    this.shallowAt = -1e9; this.zoom = false;
    this.good = { x: 0, z: 0, yaw: 0 };
    this.stats = { leaps: 0, refused: 0, uturns: 0, shallow: 0, nanResets: 0, maxStall: 0, stall: 0 };
    this.ev = { leap: false, refused: false, shallow: false, uturn: false, land: false, end: null };
  }

  start(x, z, yaw, level) {
    this.on = true;
    this.x = x; this.z = z; this.yaw = yaw; this.level = level;
    this.speed = 0; this.lift = 0; this.vy = 0; this.leaping = false; this.hop = false;
    this.cool = 0; this.uturn = 0; this.t = 0;
    this.good.x = x; this.good.z = z; this.good.yaw = yaw;
    this.y = this.baseY();
  }

  baseY() {
    return this.level + SURF - 0.25 + 0.05 * Math.sin(this.t * TAU * 2);
  }

  /** The ride's rule for a column: deep, the same level, inside the world, room for the rider. */
  colOk(env, x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const m = env.map;
    if (!m.inBounds(x, z)) return false;
    if (m.top(x, z) !== this.level || m.depth(x, z) < 3) return false;
    return free(env, x, this.level + 1, z) && free(env, x, this.level + 2, z);
  }

  /** The 'out of bounds only' case: the column is fine except that it lies outside. */
  _outOnly(env, x, z) {
    return !env.map.inBounds(Math.floor(x), Math.floor(z));
  }

  /** The deepest of 8 sampled directions (out-of-bounds samples excluded), or null. */
  _bestDir(env, prefer) {
    let best = null, score = -Infinity;
    for (let k = 0; k < 8; k++) {
      const a = prefer + (k / 8) * TAU;
      const x = this.x + Math.sin(a) * 3, z = this.z + Math.cos(a) * 3;
      if (!this.colOk(env, x, z)) continue;
      const s = env.map.depth(x, z) * 0.1 - Math.abs(angDiff(a, prefer));
      if (s > score) { score = s; best = a; }
    }
    return best;
  }

  /**
   * One step. wishX / wishZ: the world-space wish (length 0..1, camera-relative already).
   * Returns this.ev (reused): { leap, refused, shallow, uturn, land, end: null | 'water' | 'blocked' }.
   */
  step(dt, wishX, wishZ, run, jump, env) {
    const ev = this.ev;
    ev.leap = ev.refused = ev.shallow = ev.uturn = ev.land = false;
    ev.end = null;
    if (!this.on) return ev;
    dt = clamp(fin(dt) ? dt : 0, 0, 0.05);
    if (!fin(wishX)) wishX = 0;
    if (!fin(wishZ)) wishZ = 0;
    this.t += dt;
    this.cool = Math.max(0, this.cool - dt);
    const wl = Math.min(1, Math.hypot(wishX, wishZ));

    // steering like the horse: point where to go
    if (this.uturn > 0) {
      this.uturn -= dt;
      const d = angDiff(this.uturnYaw, this.yaw);
      this.yaw += clamp(d, -2.4 * dt, 2.4 * dt);
    } else if (wl > 0.05) {
      const goal = Math.atan2(wishX, wishZ);
      this.yaw += angDiff(goal, this.yaw) * Math.min(1, 4 * dt);
    }
    let want = this.uturn > 0 ? 3.5 : (run ? RIDE_RUN : RIDE_SPEED) * wl;

    // look ahead: never enter a failing column; brake inside the look-ahead
    const ahead = Math.max(0.9, 0.95 + this.speed * 0.15);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const ax = this.x + fx * ahead, az = this.z + fz * ahead;
    const aheadOk = this.colOk(env, ax, az) && this.colOk(env, this.x + fx * ahead * 0.5, this.z + fz * ahead * 0.5);
    let braking = false;
    if (!aheadOk && !this.leaping) {
      if (this._outOnly(env, ax, az) && this.uturn <= 0) {
        // the world edge: a U-turn arc toward the island's centre, no toast
        const cx = (env.map.sx || 0) / 2, cz = (env.map.sz || 0) / 2;
        this.uturnYaw = Math.atan2(cx - this.x, cz - this.z);
        this.uturn = 1.5;
        this.stats.uturns++;
        ev.uturn = true;
        want = 3.5;
      } else if (this.uturn <= 0) {
        braking = true;
        want = 0;
        const b = this._bestDir(env, this.yaw);
        if (b != null && wl > 0.05) this.yaw += clamp(angDiff(b, this.yaw), -3 * dt, 3 * dt);
        if (this.t - this.shallowAt > 4 && wl > 0.05) {
          this.shallowAt = this.t;
          this.stats.shallow++;
          ev.shallow = true;
        }
      }
    }
    if (braking) this.speed = Math.max(0, this.speed - RIDE_BRAKE * dt);
    else this.speed += clamp(want - this.speed, -RIDE_BRAKE * dt, RIDE_ACCEL * dt);
    this.speed = clamp(this.speed, 0, RIDE_RUN);
    this.zoom = !!run && this.speed > RIDE_SPEED + 1;

    // leap (Jump): the landing column and the arc must be clear, else a small splash hop
    if (jump && !this.leaping && this.cool <= 0) {
      this.cool = LEAP_COOL;
      const reach = Math.max(1, this.speed * 1.0);
      let ok = true;
      const n = Math.ceil(reach);
      for (let i = 1; i <= n && ok; i++) {
        const d = Math.min(reach, i);
        if (!this.colOk(env, this.x + fx * d, this.z + fz * d)) ok = false;
      }
      for (let i = 0; i <= n && ok; i++) {
        const d = Math.min(reach, i);
        const cx = Math.floor(this.x + fx * d), cz = Math.floor(this.z + fz * d);
        for (let k = 1; k <= 4 && ok; k++) if (!free(env, cx, this.level + k, cz)) ok = false;
      }
      this.leaping = true;
      if (ok) { this.hop = false; this.vy = 7; this.stats.leaps++; ev.leap = true; }
      else { this.hop = true; this.vy = 5.7; this.stats.refused++; ev.refused = true; } // 0.5 high, 0.35 s
    }
    if (this.leaping) {
      this.lift += this.vy * dt;
      this.vy -= (this.hop ? 32.6 : 14) * dt;
      if (this.lift <= 0 && this.vy < 0) {
        this.lift = 0; this.vy = 0; this.leaping = false; this.hop = false;
        ev.land = true;
      }
    }

    // move: the next centre must pass too (a block may have landed there this frame)
    const ox = this.x, oz = this.z;
    const nx = this.x + fx * this.speed * dt, nz = this.z + fz * this.speed * dt;
    if (this.colOk(env, nx, nz)) { this.x = nx; this.z = nz; }
    else this.speed = 0;
    const moved = Math.hypot(this.x - ox, this.z - oz);
    if (wl > 0.3 && moved < 0.002 && !this.leaping) {
      this.stats.stall += dt;
      if (this.stats.stall > this.stats.maxStall) this.stats.maxStall = this.stats.stall;
    } else this.stats.stall = 0;
    this.kick += dt * (2.2 + this.speed * 0.5) * TAU;
    if (this.kick > 1e4) this.kick -= Math.floor(this.kick / TAU) * TAU;
    this.y = this.baseY() + this.lift;

    // sanitize: a broken number goes back to the last good pose
    if (![this.x, this.y, this.z, this.yaw, this.speed, this.lift, this.vy].every(fin)) {
      this.x = this.good.x; this.z = this.good.z; this.yaw = this.good.yaw;
      this.speed = 0; this.lift = 0; this.vy = 0; this.leaping = false;
      this.y = this.baseY();
      this.stats.nanResets++;
    } else { this.good.x = this.x; this.good.z = this.z; this.good.yaw = this.yaw; }

    // the water under the dolphin went away, or blocks are in the rider
    const cx = Math.floor(this.x), cz = Math.floor(this.z);
    const own = env.world.get(cx, this.level, cz);
    if (env.props.shape[own] !== LIQUID) ev.end = 'water';
    else if (env.bodyBlocked && env.bodyBlocked(this.x, this.seatY(), this.z)) ev.end = 'blocked';
    else if (!free(env, cx, this.level + 1, cz) || !free(env, cx, this.level + 2, cz)) ev.end = 'blocked';
    return ev;
  }

  /** Feet of the seated rider (the seat on the dolphin's back). */
  seatY() {
    return this.y + 0.42;
  }

  /** The seat point (back of the dolphin) into out {x, y, z}. */
  seat(out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lz = -0.1;
    out.x = this.x + s * lz;
    out.y = this.seatY();
    out.z = this.z + c * lz;
    void c;
    return out;
  }

  /**
   * Where the rider lands on Hop off: beside the dolphin in the water, feet at level + 0.1,
   * trying right, left, behind, in front; else the dolphin's own spot.
   */
  hopSpot(env, out = [0, 0, 0]) {
    const y = this.level + 0.1;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const tries = [[-fz, fx], [fz, -fx], [-fx, -fz], [fx, fz]];
    for (let k = 0; k < 4; k++) {
      const x = this.x + tries[k][0] * 1.2, z = this.z + tries[k][1] * 1.2;
      const t = env.map.top(x, z);
      if (t !== this.level) continue;
      if (env.bodyBlocked && env.bodyBlocked(x, y, z)) continue;
      out[0] = x; out[1] = y; out[2] = z;
      return out;
    }
    out[0] = this.x; out[1] = y; out[2] = this.z;
    return out;
  }
}
