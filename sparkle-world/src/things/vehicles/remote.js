// A friend's vehicle (docs/teams/vehicles.md §8.2), drawn by src/net/remote-players.js from her
// presence `vh` [key, color, flags, honk, src] (parsed by protocol.parseVehiclePresence). Her
// presence position p is her SEAT (the avatar's sitting origin), so the vehicle's pivot is the
// seat minus the seat offset turned by her yaw. No collisions, no picking: a picture of where
// she drives, like her avatar.

import { LiveModel } from './live.js';
import { WakeRibbon } from './fx.js';
import { RainbowTrail, STARDUST } from '../pets/fx.js'; // wave 5: the sleigh's sparkle trail

const fin = Number.isFinite;

export class RemoteVehicle {
  /** game, def (furniture def with def.vehicle), color '#rrggbb'. */
  constructor(game, def, color) {
    this.game = game;
    this.def = def;
    this.key = def.key;
    this.color = color;
    this.live = new LiveModel(def, color);
    this.object3d = this.live.pivot;
    this.wake = null;
    this.flags = 0;
    this._p = { x: 0, y: 0, z: 0 };
    this._splashT = 0;
    // wave 5: a flying vehicle (the sleigh): airborne is a cheap guess (no solid just under it,
    // checked every 0.2 s); the reindeer gallop in the sky and it leaves a sparkle trail
    this.flying = false;
    this.trail = null;
    this._skyT = 0;
    this._sparkT = 0;
  }

  /** Where the vehicle's pivot is for a seat at (x, y, z) facing yaw (into out). */
  pivotFromSeat(x, y, z, yaw, out) {
    const v = this.def.vehicle, size = this.def.size;
    const ox = v.seat[0] - size[0] / 2, oy = v.seat[1], oz = v.seat[2] - size[2] / 2;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.x = x - (ox * c + oz * s);
    out.y = y - oy;
    out.z = z - (-ox * s + oz * c);
    return out;
  }

  /**
   * One frame: seat (her drawn position), yaw, speed (blocks/s, from her samples), flags
   * (bit 0 lights, bit 1 reversing), visible (her avatar is shown). Boats leave a wake.
   */
  update(dt, x, y, z, yaw, speed, flags, visible) {
    const pv = this.live.pivot;
    pv.visible = !!visible;
    if (!visible || !fin(x) || !fin(y) || !fin(z) || !fin(yaw)) return;
    const p = this.pivotFromSeat(x, y, z, yaw, this._p);
    const sp = (fin(speed) ? speed : 0) * (flags & 2 ? -1 : 1);
    this.live.setPose(p.x, p.y, p.z, yaw, 0, 0, 0, 0);
    if (this.def.vehicle.flies) this._sky(dt, p, yaw, sp);
    this.live.animate(dt, sp, this.flying);
    const g = this.game;
    const daylight = g.blockUniforms ? g.blockUniforms.uDaylight.value : 1;
    this.live.setLights(!!(flags & 1), Math.min(1, Math.max(0, (1.05 - daylight) / 0.6)));
    if (this.live.boat) {
      if (!this.wake && pv.parent) this.wake = new WakeRibbon(pv.parent);
      if (this.wake) {
        if (Math.abs(sp) > 0.8) {
          const s = Math.sin(yaw), c = Math.cos(yaw), half = this.def.size[2] / 2;
          this.wake.push(p.x - s * half, p.y + 0.9, p.z - c * half, c, -s);
        }
        this.wake.update(dt);
      }
      this._splashT -= dt;
      if (Math.abs(sp) > 1.5 && this._splashT <= 0 && g.particles) {
        this._splashT = 0.18;
        const s = Math.sin(yaw), c = Math.cos(yaw), half = this.def.size[2] / 2;
        g.particles.emit('splash', { x: p.x - s * half, y: p.y + 0.9, z: p.z - c * half }, { count: 1, spread: 0.3 });
      }
    }
  }

  /** wave 5: is her sleigh in the air (a guess), and its sparkle trail behind it. */
  _sky(dt, p, yaw, sp) {
    const g = this.game, ph = g.physics;
    this._skyT -= dt;
    if (this._skyT <= 0) {
      this._skyT = 0.2;
      this.flying = !!(ph && typeof ph.bodyBlocked === 'function') && !ph.bodyBlocked(p.x, p.y - 0.7, p.z, 0.45, 0.68);
    }
    if (!this.def.vehicle.sparkles) return;
    const pv = this.live.pivot;
    if (!this.trail && pv.parent) this.trail = new RainbowTrail(pv.parent, { colors: STARDUST, width: 0.5, life: 1.3 });
    if (!this.trail) return;
    const s = Math.sin(yaw), c = Math.cos(yaw), half = this.def.size[2] / 2;
    if (this.flying || Math.abs(sp) > 1) this.trail.push(p.x - s * half, p.y + 0.7, p.z - c * half);
    this.trail.update(dt);
    this._sparkT -= dt;
    if (this.flying && this._sparkT <= 0 && g.particles) {
      this._sparkT = 0.15;
      g.particles.emit('sparkle', { x: p.x - s * half, y: p.y + 0.5, z: p.z - c * half }, { count: 1, spread: 0.4 });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.wake) this.wake.dispose();
    this.wake = null;
    if (this.trail) this.trail.dispose(); // wave 5
    this.trail = null;
    this.live.dispose();
  }
}
