// A live vehicle model: the car she drives, and friends' cars (remote.js). Built with
// def.build(color, { live: true }) so the wheels, the propeller, the paddle wheel and the sail
// are parts that move.
//
//   pivot (position = footprint centre at wheel level, rotation.y = yaw)
//     tilt (picture only: nose pitch, roll, the eased climb, a boat's bob; about the centre)
//       model (offset by -w/2, -d/2, as entities.js _attach does)
//       headlights (beams + ground glow, fx.js)
//
// No per-frame allocations; every number is checked before it reaches three.js.

import * as THREE from 'three';
import { disposeObject } from '../../core/models.js';
import { Headlights } from './fx.js';

const fin = Number.isFinite;

export class LiveModel {
  /** def: the furniture def (def.vehicle = specs), color: a swatch. */
  constructor(def, color) {
    this.def = def;
    this.v = def.vehicle;
    this.size = def.size;
    this.boat = !!this.v.water;
    this.pivot = new THREE.Group();
    this.pivot.name = 'vehicle:' + def.key;
    this.tilt = new THREE.Group();
    this.pivot.add(this.tilt);
    this.model = def.build(color, { live: true });
    this.model.position.set(-this.size[0] / 2, 0, -this.size[2] / 2);
    this.tilt.add(this.model);
    const parts = this.model.userData.parts || {};
    this.axles = [];
    for (let i = 0; i < 4; i++) if (parts['axle' + i]) this.axles.push(parts['axle' + i]);
    this.wheelR = (this.v.wheels && this.v.wheels.r) || 0.28;
    this.prop = parts.prop || null;
    this.paddle = parts.paddle || null;
    this.sail = parts.sail || null;
    this.hull = parts.hull || null;
    this.lights = new Headlights(this.v.lamps, this.size);
    this.lights.group.position.copy(this.model.position);
    this.tilt.add(this.lights.group);
    this.t = Math.random() * 10;
  }

  /** Place it: pivot at (x, y, z), turned yaw; picture-only tilt and lift. */
  setPose(x, y, z, yaw, pitch = 0, roll = 0, lift = 0, squash = 0) {
    if (!fin(x) || !fin(y) || !fin(z) || !fin(yaw)) return;
    this.pivot.position.set(x, y, z);
    this.pivot.rotation.y = yaw;
    let bob = 0, bp = 0, br = 0;
    if (this.boat) {
      bob = 0.05 * Math.sin(this.t * 2.1);
      bp = 0.03 * Math.sin(this.t * 1.3);
      br = 0.025 * Math.sin(this.t * 1.7);
    }
    this.tilt.rotation.x = fin(pitch) ? -pitch + bp : bp;
    this.tilt.rotation.z = fin(roll) ? roll + br : br;
    this.tilt.position.y = (fin(lift) ? lift : 0) + bob;
    const s = fin(squash) && squash > 0 ? Math.sin(Math.min(1, squash / 0.3) * Math.PI) * 0.06 : 0;
    this.tilt.scale.set(1 + s, 1 - s, 1 + s);
  }

  /** Wheels spin, propeller and paddles turn, the sail fills: speed in blocks/s (signed). */
  animate(dt, speed) {
    if (!(dt > 0)) return;
    const sp = fin(speed) ? speed : 0;
    this.t += dt;
    const turn = (sp * dt) / this.wheelR;
    for (const a of this.axles) a.rotation.x = (a.rotation.x + turn) % (Math.PI * 2);
    if (this.prop) this.prop.rotation.z = (this.prop.rotation.z + dt * (2 + Math.abs(sp) * 4)) % (Math.PI * 2);
    if (this.paddle) this.paddle.rotation.x = (this.paddle.rotation.x - sp * dt * 1.6) % (Math.PI * 2);
    if (this.sail) {
      const max = this.v.speed || 6;
      const fill = 1 + 0.15 * Math.min(1, Math.abs(sp) / max) + 0.03 * Math.sin(this.t * 3);
      this.sail.scale.set(1 + (fill - 1) * 3, 1, fill);
    }
  }

  /** Headlights on/off; dark 0 (day) .. 1 (night) sets how strong the beams look. */
  setLights(on, dark) {
    this.lights.set(on, dark);
  }

  /** A model-space point at the current pose (no tilt), into out. */
  toWorld(lx, ly, lz, out) {
    const ox = lx - this.size[0] / 2, oz = lz - this.size[2] / 2;
    const yaw = this.pivot.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
    const p = this.pivot.position;
    out.x = p.x + ox * c + oz * s;
    out.y = p.y + ly;
    out.z = p.z - ox * s + oz * c;
    return out;
  }

  dispose() {
    if (this.pivot.parent) this.pivot.parent.remove(this.pivot);
    this.lights.dispose();
    disposeObject(this.pivot);
  }
}
