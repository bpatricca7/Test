// A friend's vehicle (docs/teams/vehicles.md §8.2), drawn by src/net/remote-players.js from her
// presence `vh` [key, color, flags, honk, src] (parsed by protocol.parseVehiclePresence). Her
// presence position p is her SEAT (the avatar's sitting origin), so the vehicle's pivot is the
// seat minus the seat offset turned by her yaw. No collisions, no picking: a picture of where
// she drives, like her avatar.

import { LiveModel } from './live.js';
import { WakeRibbon } from './fx.js';

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
    this.live.animate(dt, sp);
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

  dispose() {
    if (this.wake) this.wake.dispose();
    this.wake = null;
    this.live.dispose();
  }
}
