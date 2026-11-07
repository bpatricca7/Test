// The water slides: tap a start gate (or the Bag's little water slide) and she whooshes down.
//
// A ride is planned once at the tap (logic.js does the sums): the gate's packed path (a ship's
// slide record) or, for a Bag gate, a short path straight ahead and down whatever she built.
// Every cell is checked: when something was built into the slide she rides to just before it
// and hops by magic into the splash pool, or (blocked at the very top) the gate says so and she
// stays put. She is held (player.hold, like the zip line) so nothing interrupts the ride, sits
// with her legs out and her arms up, speeds up downhill, leans into the curves, and lands with
// a splash (in water she swims on; on land she hops off). A time limit ends any ride: she can
// never be stuck on a slide.

import * as THREE from 'three';
import { HIP } from '../../player/avatar/rig.js';
import { rotXZ } from '../entities.js';
import { partsOf } from '../furniture/kit.js';
import { angleDelta, clamp } from '../../core/util.js';
import {
  SLIDE, decodeKeys, liftKeys, expandKeys, firstBlocked, planRide, keyCells, smoothCorners,
  polyline, samplePolyline, slideSpeed, rideTimeLimit, autoSlidePath, rideCell,
} from './logic.js';
import { waterSlidePath } from './models.js';

const smooth = (t) => t * t * (3 - 2 * t);
const SEAT = 0.06; // her seat floats this far over the cell floor (the slide's surface)
const BOARD = 0.55; // seconds to hop onto the slide
const SPLASH = 0.7; // seconds of splash at the end

export class Slides {
  constructor(game, sfx, hooks) {
    this.game = game;
    this.sfx = sfx;
    this.hooks = hooks; // { done(kind) } (coins, stickers)
    this.ride = null;
    this.freeze = false; // probes: hold the ride still for a picture
    this._v = new THREE.Vector3();
    this._fx = new THREE.Vector3();
    this._assistHold = 0;
  }

  get E() {
    return this.game.entities;
  }

  // ---------- the world, read kindly ----------

  _solid() {
    const g = this.game, w = g.world, props = g.registry.blocks.props;
    return (x, y, z) => {
      if (!w || !w.inBounds(x, y, z)) return true; // outside the world counts as a wall
      const id = w.get(x, y, z);
      return id !== 0 && props.solid[id] === 1 && !props.replaceable[id];
    };
  }

  _liquid() {
    const ph = this.game.physics;
    return (x, y, z) => !!ph && ph.liquidAt(x + 0.5, y + 0.5, z + 0.5);
  }

  // ---------- planning ----------

  /**
   * The ride for a slide piece: { points (world, her seat), end: 'full'|'pool'|'start',
   * splashAt (world point to hop to, 'pool' only), wet (lands in water) } or null.
   */
  plan(e) {
    if (!e) return null;
    const solid = this._solid(), liquid = this._liquid();
    if (e.key === 'cruise_waterslide') {
      const pts = waterSlidePath().map(([x, y, z]) => {
        const v = this.E.localToWorld(e, x, y, z, new THREE.Vector3());
        return [v.x, v.y, v.z];
      });
      const last = pts[pts.length - 1];
      const wet = liquid(Math.floor(last[0]), Math.floor(last[1]), Math.floor(last[2])) ||
        liquid(Math.floor(last[0]), Math.floor(last[1]) - 1, Math.floor(last[2]));
      return { points: smoothCorners(pts, 1), end: 'full', wet, splashAt: null };
    }
    let keys = null;
    const code = e.data && typeof e.data.p === 'string' ? e.data.p : '';
    if (code) keys = decodeKeys(code, e.x, e.y, e.z);
    if (!keys || keys.length < 2) {
      // a Bag gate: straight out of its front and down what she built
      const [dx, dz] = rotXZ(0, 1, e.rot);
      const w = this.game.world;
      const inside = (x, y, z) => !!w && w.inBounds(x, y, z);
      keys = autoSlidePath(e.x, e.y, e.z, [dx, dz], solid, liquid, inside);
      if (keys.length < 2) return { points: null, end: 'start', wet: false, splashAt: null };
    } else {
      keys = liftKeys(keys, solid);
    }
    const cells = expandKeys(keys);
    if (cells.length < 2) return { points: null, end: 'start', wet: false, splashAt: null };
    const blocked = firstBlocked(cells, solid);
    const last = cells[cells.length - 1];
    const endFree = !!rideCell(last, solid);
    const { end, stopAt } = planRide(cells.length, blocked, endFree);
    if (end === 'start') return { points: null, end, wet: false, splashAt: null };
    const seat = (c) => [c[0] + 0.5, c[1] + SEAT, c[2] + 0.5];
    let route = end === 'full' ? keys : keyCells(cells.slice(0, stopAt + 1));
    if (route.length < 2) route = cells.slice(0, Math.max(2, stopAt + 1));
    const points = smoothCorners(route.map(seat), 2);
    const endCell = rideCell(last, solid) || last;
    const wet = liquid(endCell[0], endCell[1], endCell[2]) || liquid(endCell[0], endCell[1] - 1, endCell[2]);
    return { points, end, wet, splashAt: end === 'pool' ? seat(endCell) : null };
  }

  // ---------- riding ----------

  canRide() {
    return !this.ride;
  }

  /** Tap on a slide piece: off she goes (or a friendly word when the slide is blocked). */
  start(e) {
    const g = this.game, p = g.player;
    if (!p || this.ride) return false;
    if (p.state === 'ride') return false;
    const pl = this.plan(e);
    if (!pl || !pl.points || pl.points.length < 2) {
      g.audio.play('magic', { volume: 0.4 });
      if (g.particles) g.particles.emit('sparkle', this.E.localToWorld(e, 0.5, 1.5, 0.5, this._fx), { count: 10, spread: 0.6 });
      g.toast(e.key === 'cruise_slide' && !(e.data && e.data.p) ? 'Build a slope in front to slide down!' : 'Something is on the slide! Clear it to ride.', { icon: 'sparkle', key: 'cruise-slide' });
      return true;
    }
    if (g.pets && g.pets.rider && g.pets.dismount) g.pets.dismount();
    if (p.state === 'sit' || p.state === 'sleep') p.stand();
    const line = polyline(pl.points);
    const r = {
      e, uid: e.uid, plan: pl, line, phase: 'board', t: 0, s: 0, v: SLIDE.V0,
      p0: p.position.clone(), p1: new THREE.Vector3(pl.points[0][0], pl.points[0][1], pl.points[0][2]),
      yaw: p.yaw, yawWant: p.yaw, lean: 0, limit: rideTimeLimit(line.len) + BOARD, spray: 0, trail: 0, splashed: false,
      hop: null,
    };
    // she faces down the slide
    const q = new THREE.Vector3();
    samplePolyline(line, Math.min(line.len, 0.8), q);
    r.yawWant = Math.atan2(q.x - r.p1.x, q.z - r.p1.z);
    line.cursor = 0;
    if (typeof p.hold !== 'function') return false;
    p.hold(this);
    // far from the top (she tapped the gate from the ground): a sparkly hop up there
    if (r.p0.distanceTo(r.p1) > 3.5) {
      this._poof(r.p0);
      r.p0.copy(r.p1);
      r.p0.y += 0.4;
      g.audio.play('magic', { volume: 0.4 });
    }
    this.ride = r;
    this._gate(e, 1);
    this.sfx.gate();
    this._assistHold = 0;
    this._assistSide = undefined;
    g.events.emit('cruise:slide', { uid: e.uid, phase: 'start' });
    return true;
  }

  /** Let go early (piece removed, world closing, she flew off...). */
  cancelRide() {
    const r = this.ride;
    if (!r) return;
    this.ride = null;
    this.sfx.rushStop();
    const p = this.game.player;
    this._resetAvatar(p);
    if (p && p.state === 'hold' && p.holder === this && p.release) {
      // never left in the air: down to the nearest spot she can stand
      const spot = p.findStandSpot(p.position.x, p.position.y, p.position.z, null);
      if (spot) p.position.set(spot[0], spot[1], spot[2]);
      p.release();
    }
    if (this.E.byUid(r.uid)) this._gate(r.e, 0);
  }

  update(dt) {
    if (this.ride) this._update(this.freeze ? 0 : dt);
  }

  _update(dt) {
    const g = this.game, p = g.player, r = this.ride;
    if (!p || p.state !== 'hold' || p.holder !== this || !this.E.byUid(r.uid)) {
      this.cancelRide();
      return;
    }
    r.t += dt;
    const av = p.avatar;
    p.velocity.set(0, 0, 0);
    switch (r.phase) {
      case 'board': {
        const k = clamp(r.t / BOARD, 0, 1);
        const e = smooth(k);
        p.position.lerpVectors(r.p0, r.p1, e);
        p.position.y += Math.sin(k * Math.PI) * 0.5;
        p.yaw = r.yaw + angleDelta(r.yaw, r.yawWant) * e;
        p.onGround = true;
        this._pose(p, av, 0, k, dt);
        if (k >= 1) {
          r.phase = 'slide';
          r.t = 0;
          r.yaw = p.yaw;
          this.sfx.rushStart();
          this.sfx.whee();
          this._gate(r.e, 0.6);
        }
        break;
      }
      case 'slide': {
        const line = r.line;
        const slope = samplePolyline(line, r.s, this._v);
        r.v = slideSpeed(r.v, slope, dt);
        r.s = Math.min(line.len, r.s + r.v * dt);
        samplePolyline(line, r.s, this._v);
        p.position.copy(this._v);
        // look a little ahead for her heading and the lean into curves
        const ahead = this._fx;
        samplePolyline(line, Math.min(line.len, r.s + 0.9), ahead);
        samplePolyline(line, r.s, this._v); // keeps the cursor where she is
        const dx = ahead.x - this._v.x, dz = ahead.z - this._v.z;
        if (dx * dx + dz * dz > 0.0004) {
          const want = Math.atan2(dx, dz);
          const turn = angleDelta(p.yaw, want);
          p.yaw += turn * Math.min(1, dt * 7);
          r.lean += (clamp(-turn * 1.4, -0.35, 0.35) - r.lean) * Math.min(1, dt * 5);
        }
        p.onGround = true;
        this._pose(p, av, clamp(r.v / 8, 0, 1), 1, dt, r.lean);
        this.sfx.rushSpeed(r.v);
        this._spray(p, dt, r);
        this._cameraAssist(dt, p.yaw);
        if (r.s >= line.len - 0.01 || r.t > r.limit) this._toEnd(r);
        break;
      }
      case 'hop': {
        // the slide was blocked (or it took too long): a magic hop to the splash spot
        const h = r.hop;
        const k = clamp(r.t / h.dur, 0, 1);
        p.position.lerpVectors(h.a, h.b, smooth(k));
        p.position.y += Math.sin(k * Math.PI) * 1.2;
        this._pose(p, av, 0.6, 1, dt);
        if (k >= 1) this._splash(r);
        break;
      }
      case 'splash': {
        const k = clamp(r.t / SPLASH, 0, 1);
        this._pose(p, av, 0, 1 - k, dt);
        if (r.landAt) {
          // a dry landing: hop off onto her feet
          p.position.lerpVectors(r.landFrom, r.landAt, smooth(k));
          p.position.y += Math.sin(k * Math.PI) * 0.35;
        }
        if (k >= 1) this._finish(r);
        break;
      }
      default:
        break;
    }
  }

  /** The end of the slide: splash (or hop on to the splash pool first). */
  _toEnd(r) {
    const p = this.game.player;
    this.sfx.rushStop();
    const timedOut = r.s < r.line.len - 0.05;
    if ((r.plan.end === 'pool' && r.plan.splashAt) || timedOut) {
      const to = r.plan.splashAt || (() => {
        const last = r.line.n - 1;
        return [r.line.pts[last * 3], r.line.pts[last * 3 + 1], r.line.pts[last * 3 + 2]];
      })();
      r.phase = 'hop';
      r.t = 0;
      r.hop = { a: p.position.clone(), b: new THREE.Vector3(to[0], to[1], to[2]), dur: 0.7 };
      this._poof(p.position);
      this.game.audio.play('magic', { volume: 0.45 });
      return;
    }
    this._splash(r);
  }

  _splash(r) {
    const g = this.game, p = g.player;
    r.phase = 'splash';
    r.t = 0;
    r.landAt = null;
    const pos = p.position;
    if (r.plan.wet) {
      this.sfx.splash(1.2);
      if (g.particles) {
        g.particles.emit('splash', this._fx.set(pos.x, pos.y + 0.3, pos.z), { count: 26, spread: 1.1 });
        g.particles.emit('bubble', this._fx.set(pos.x, pos.y + 0.2, pos.z), { count: 14, spread: 0.9 });
      }
    } else {
      this.sfx.splash(0.6);
      if (g.particles) {
        g.particles.emit('splash', this._fx.set(pos.x, pos.y + 0.2, pos.z), { count: 12, spread: 0.7 });
        g.particles.emit('sparkle', this._fx.set(pos.x, pos.y + 0.6, pos.z), { count: 10, spread: 0.7 });
      }
      // hop off a little further on, onto her feet
      const spot = p.findStandSpot(pos.x + Math.sin(p.yaw) * 0.8, pos.y, pos.z + Math.cos(p.yaw) * 0.8, null);
      if (spot) {
        r.landFrom = pos.clone();
        r.landAt = new THREE.Vector3(spot[0], spot[1], spot[2]);
      }
    }
    if (!r.splashed) {
      r.splashed = true;
      g.events.emit('cruise:slide', { uid: r.uid, phase: 'splash', wet: !!r.plan.wet });
    }
  }

  _finish(r) {
    const g = this.game, p = g.player;
    this.ride = null;
    this._resetAvatar(p);
    if (!r.plan.wet && !r.landAt) {
      const spot = p.findStandSpot(p.position.x, p.position.y, p.position.z, null);
      if (spot) p.position.set(spot[0], spot[1], spot[2]);
    }
    if (p.release) p.release();
    p.onGround = !r.plan.wet;
    if (this.E.byUid(r.uid)) this._gate(r.e, 0);
    const name = r.e.key === 'cruise_slide' && r.e.data && typeof r.e.data.n === 'string' && r.e.data.n ? r.e.data.n : null;
    const lines = ['Splash! What a slide!', 'Wheee! Again?', 'Whoosh! So fast!', 'Splashy fun!'];
    const n = (this._rides = (this._rides || 0) + 1);
    g.toast(name && n === 1 ? `Wheee! You rode the ${name}!` : lines[n % lines.length], { icon: 'star', key: 'cruise-slide' });
    if (this.hooks && this.hooks.done) this.hooks.done('slide', p.position);
    g.events.emit('cruise:slide', { uid: r.uid, phase: 'done' });
  }

  // ---------- looks ----------

  /** Swing the gate's bar: 0 shut, 1 open. */
  _gate(e, open) {
    const bar = partsOf(e).bar;
    if (bar) bar.rotation.z = open * 1.35;
  }

  _poof(pos) {
    const g = this.game;
    if (g.particles) g.particles.emit('sparkle', this._fx.set(pos.x, pos.y + 0.8, pos.z), { count: 16, spread: 0.8 });
  }

  _spray(p, dt, r) {
    const g = this.game;
    if (!g.particles) return;
    r.spray -= dt;
    r.trail -= dt;
    if (r.spray <= 0) {
      r.spray = r.v > 7 ? 0.05 : 0.09;
      g.particles.emit('splash', this._fx.set(p.position.x, p.position.y + 0.15, p.position.z), { count: r.v > 7 ? 3 : 2, spread: 0.35 });
    }
    if (r.trail <= 0) {
      r.trail = 0.16;
      g.particles.emit('bubble', this._fx.set(p.position.x, p.position.y + 0.3, p.position.z), { count: 1, spread: 0.3 });
    }
  }

  /**
   * Her pose on the slide (after the avatar's own update): sitting with her legs out, leaning
   * back, arms up in a "wheee" as she goes faster. w blends from her own pose.
   */
  _pose(p, av, speed, w, dt, lean = 0) {
    if (!av || w <= 0.001) {
      if (av) av.group.position.copy(p.position);
      return;
    }
    const b = av.bones;
    const set = (bone, x, y, z) => {
      if (!bone) return;
      const r = bone.rotation;
      r.x += (x - r.x) * w;
      r.y += (y - r.y) * w;
      r.z += (z - r.z) * w;
    };
    const t = this.game.time ? this.game.time.t : 0;
    const up = speed; // arms go up as she speeds up
    const wob = Math.sin(t * 9) * 0.08 * up;
    set(b.legL, -1.5, 0, 0.1);
    set(b.kneeL, 0.12 + wob, 0, 0);
    set(b.legR, -1.5, 0, -0.1);
    set(b.kneeR, 0.12 - wob, 0, 0);
    set(b.torso, -0.22 * (1 - up * 0.3), 0, 0);
    set(b.head, -0.08, 0, 0);
    set(b.armL, -0.3 * (1 - up), 0, 0.5 + 2.2 * up + wob);
    set(b.elbowL, -0.2, 0, 0);
    set(b.armR, -0.3 * (1 - up), 0, -0.5 - 2.2 * up - wob);
    set(b.elbowR, -0.2, 0, 0);
    // sitting: her hips come down to the slide (the avatar's sit drop, done here)
    av.group.position.copy(p.position);
    av.group.position.y -= (HIP - 0.095) * w;
    av.group.rotation.order = 'YXZ';
    av.group.rotation.z = lean * w;
  }

  _resetAvatar(p) {
    if (p && p.avatar) {
      p.avatar.group.rotation.x = 0;
      p.avatar.group.rotation.z = 0;
      p.avatar.group.position.copy(p.position);
    }
  }

  /** A chase view a little to one side, unless she is turning the camera herself. */
  _cameraAssist(dt, yaw) {
    const g = this.game, rig = g.cameraRig, input = g.input;
    if (!rig || rig.mode === 'first') return;
    if (input && input.look && (Math.abs(input.look.dx) + Math.abs(input.look.dy) > 0.5 || input.turn)) this._assistHold = 1.6;
    if (this._assistHold > 0) {
      this._assistHold -= dt;
      return;
    }
    if (this._assistSide === undefined) this._assistSide = angleDelta(yaw, rig.yaw) >= 0 ? 1 : -1;
    const want = yaw + this._assistSide * 0.55;
    rig.yaw += angleDelta(rig.yaw, want) * Math.min(1, dt * 2.5);
    rig.pitch += (0.3 - rig.pitch) * Math.min(1, dt * 1.5);
  }
}
