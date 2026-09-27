// Climbing the built-in ladders of Zip Towers and Tree Platforms, like the furniture
// ladders: push forward (or Jump) while touching one to climb, let go to slide down gently,
// and at the top she steps onto the deck. climbTo(entity) climbs by itself (Hand tool).

import { TOWER, PLATFORM } from './models-tree.js';

/** Tower-local / platform-local model coordinates of a world point (x, z). */
export function toLocal(E, e, x, z, out) {
  const c = E.localToWorld(e, 0, 0, 0, out.tmp);
  const dx = x - c.x, dz = z - c.z;
  switch (e.rot & 3) {
    case 1: out.x = -dz; out.z = dx; break;
    case 2: out.x = -dx; out.z = -dz; break;
    case 3: out.x = dz; out.z = -dx; break;
    default: out.x = dx; out.z = dz;
  }
  return out;
}

/** A model-space direction (dx, dz) turned into the world (writes out.x / out.z). */
export function dirToWorld(e, dx, dz, out) {
  switch (e.rot & 3) {
    case 1: out.x = dz; out.z = -dx; break;
    case 2: out.x = -dx; out.z = -dz; break;
    case 3: out.x = -dz; out.z = dx; break;
    default: out.x = dx; out.z = dz;
  }
  return out;
}

export class Ladders {
  constructor(game, tmpVec) {
    this.game = game;
    this.E = game.entities;
    this.list = new Set();
    this.arr = []; // the same entities, iterated each frame without allocating
    this.auto = null;
    this._l = { x: 0, z: 0, tmp: tmpVec };
    this._d = { x: 0, z: 0 };
    this._zone = { x0: 0, x1: 0, z0: 0, z1: 0, bottom: 0, top: 0, cx: 0, cz: 0, inZ: 0 };
  }

  track(e) {
    if ((e.key === 'zipline_tower' || e.key === 'tree_platform') && !this.list.has(e)) {
      this.list.add(e);
      this.arr.push(e);
    }
  }

  untrack(e) {
    if (this.list.delete(e)) this.arr.splice(this.arr.indexOf(e), 1);
    if (this.auto && this.auto.e === e) this.auto = null;
  }

  clear() {
    this.list.clear();
    this.arr.length = 0;
    this.auto = null;
  }

  /** The ladder of e in model units (x0..x1, z0..z1 where she can hold it) or null. */
  zone(e) {
    const z = this._zone;
    const base = e.y + (e.yOffset || 0);
    if (e.key === 'zipline_tower') {
      z.x0 = 0.45; z.x1 = 1.55; z.z0 = 1.9; z.z1 = 2.75;
      z.bottom = base - 0.3; z.top = base + TOWER.DECK;
      z.cx = 1.0; z.cz = 2.32; z.inZ = 1.4;
      return z;
    }
    if (e.key === 'tree_platform') {
      const len = +e.data.ladder || 0;
      if (len < 0.3) return null;
      z.x0 = 1.0; z.x1 = 2.0; z.z0 = 2.95; z.z1 = 3.8;
      z.bottom = base + PLATFORM.TOP - len - 0.3; z.top = base + PLATFORM.TOP;
      z.cx = 1.5; z.cz = 3.34; z.inZ = 2.3;
      return z;
    }
    return null;
  }

  /** Is she on e's deck? */
  onDeck(e, pos) {
    const l = toLocal(this.E, e, pos.x, pos.z, this._l);
    const base = e.y + (e.yOffset || 0);
    if (e.key === 'zipline_tower') return l.x > 0.05 && l.x < 1.95 && l.z > 0.05 && l.z < 1.95 && Math.abs(pos.y - (base + TOWER.DECK)) < 0.35;
    return l.x > 0.05 && l.x < 2.95 && l.z > 0.05 && l.z < 2.95 && Math.abs(pos.y - (base + PLATFORM.TOP)) < 0.35;
  }

  /** Hand tool: climb e's ladder by herself (hops to its foot first if she is elsewhere). */
  climbTo(e) {
    const p = this.game.player;
    const z = this.zone(e);
    if (!p || !z) return false;
    if (p.state === 'sit' || p.state === 'sleep') p.stand();
    if (p.flying) p.setFlying(false);
    if (this.onDeck(e, p.position)) return false;
    const l = toLocal(this.E, e, p.position.x, p.position.z, this._l);
    const inZone = l.x > z.x0 && l.x < z.x1 && l.z > z.z0 && l.z < z.z1 && p.position.y > z.bottom && p.position.y < z.top + 0.3;
    if (!inZone) {
      const foot = this.E.localToWorld(e, z.cx, 0, z.cz, this._l.tmp.clone());
      if (this.game.particles) this.game.particles.emit('sparkle', p.position, { count: 10, spread: 0.7 });
      const gy = this._groundUnder(foot.x, z.bottom + 0.35, foot.z);
      p.position.set(foot.x, Math.max(gy, z.bottom + 0.31), foot.z);
      p.velocity.set(0, 0, 0);
      if (this.game.particles) this.game.particles.emit('sparkle', p.position, { count: 10, spread: 0.7 });
    }
    p.yaw = e.rot * (Math.PI / 2) + Math.PI;
    this.auto = { e, t: 0 }; // game seconds (slow devices still get the whole climb)
    this.game.audio.play('jump', { volume: 0.5 });
    return true;
  }

  _groundUnder(x, y, z) {
    const w = this.game.world;
    const props = this.game.registry.blocks.props;
    const fx = Math.floor(x), fz = Math.floor(z);
    for (let yy = Math.floor(y) + 1; yy > 0; yy--) {
      const id = w.get(fx, yy - 1, fz);
      if (id && props.solid[id]) return yy;
    }
    return y;
  }

  update(dt) {
    const g = this.game, p = g.player, input = g.input;
    if (!p || !g.world) return;
    if (p.state !== 'walk' || p.flying) {
      if (this.auto && p.state !== 'walk') this.auto = null;
      return;
    }
    if (this.auto) {
      this.auto.t += dt;
      if (this.auto.t > 8 || !this.E.byUid(this.auto.e.uid)) this.auto = null;
    }
    for (let i = 0; i < this.arr.length; i++) {
      const e = this.arr[i];
      const z = this.zone(e);
      if (!z) continue;
      const pos = p.position;
      if (pos.y < z.bottom || pos.y > z.top + 0.6) continue;
      const l = toLocal(this.E, e, pos.x, pos.z, this._l);
      const auto = this.auto && this.auto.e === e;
      const inZone = l.x > z.x0 && l.x < z.x1 && l.z > z.z0 - (auto ? 1.2 : 0) && l.z < z.z1;
      if (!inZone) continue;
      // standing on the deck at the top of the ladder: she walks as usual
      if (!auto && pos.y >= z.top - 0.05 && l.z < z.z0 + 0.1) continue;
      // pushing toward the ladder (camera-relative walk direction), or Jump
      const cy = g.cameraRig ? g.cameraRig.yaw : p.yaw;
      const wx = Math.sin(cy) * input.move.z - Math.cos(cy) * input.move.x;
      const wz = Math.cos(cy) * input.move.z + Math.sin(cy) * input.move.x;
      const into = dirToWorld(e, 0, -1, this._d);
      const toward = wx * into.x + wz * into.z > 0.3;
      const push = auto || input.jump || toward;
      if (pos.y < z.top - 0.02) {
        if (push) {
          // climb: rise and stay centred on the ladder
          const t = this.E.localToWorld(e, z.cx, 0, z.cz, this._l.tmp);
          p.velocity.x = (t.x - pos.x) * 6;
          p.velocity.z = (t.z - pos.z) * 6;
          p.velocity.y = 3.4;
          p.onGround = false;
          if (Math.random() < dt * 5) g.audio.play('step', { pitch: 1.3 });
        } else if (p.velocity.y < -1.6) {
          p.velocity.y = -1.6; // holding on: slide down gently
        }
      }
      if (push && pos.y > z.top - 0.45) {
        // at the top: step in over the deck edge
        const d = dirToWorld(e, 0, -1, this._d);
        p.velocity.x = d.x * 3;
        p.velocity.z = d.z * 3;
        if (pos.y < z.top + 0.05) p.velocity.y = Math.max(p.velocity.y, 2.2);
        if (l.z < z.inZ + 0.6 && auto) {
          this.auto = null;
          if (g.particles) g.particles.emit('sparkle', this._l.tmp.set(pos.x, pos.y + 1, pos.z), { count: 8 });
        }
      }
      break;
    }
  }
}
