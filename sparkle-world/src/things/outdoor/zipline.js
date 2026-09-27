// Zip lines. Two Zip Towers within 48 blocks link up (a new tower links to the nearest
// unlinked one): a sagging candy-striped cable (a real catenary) hangs between their roof
// beams, with a trolley and a T-bar handle parked at one end. Hand-tap either tower: she
// climbs the ladder (or hops up by magic from further away), walks to the edge, jumps up
// and grabs the handle, then zooms along the cable (speed from the slope, never slower than
// a gentle minimum so flat and uphill lines work too) with the wind rushing, a sparkle and
// rainbow trail and a little pendulum swing, and lands softly on the far platform.
// Emits 'zipline:ride' { from, to } (tower entities). Links are saved per world (system
// 'outdoor' calls serialize/deserialize); removing or undoing a tower unlinks it cleanly.

import * as THREE from 'three';
import { TOWER, HANDLE_DROP, trolley as trolleyModel, cableMesh } from './models-tree.js';
import { disposeObject } from '../../core/models.js';
import { angleDelta, clamp } from '../../core/util.js';

export const ZIP_MAX = 48;
const ZIP_MIN = 3;
const RING = 0.81; // cable anchor: distance of the roof ring beam from the tower centre
const G = 9.8 * 0.85;
const VMIN = 3.2;
const VMAX = 12.5;
const CLIMB_SPEED = 2.4;
const WALK_SPEED = 2.3;

const smooth = (t) => t * t * (3 - 2 * t);

/** Catenary through A and B (world), sampled into flat arrays. */
function catenary(A, B) {
  const dx = B.x - A.x, dz = B.z - A.z;
  const L = Math.hypot(dx, dz);
  const h = B.y - A.y;
  const chord = Math.hypot(L, h);
  const sag = clamp(0.035 * L + 0.12, 0.2, 1.7);
  const slack = (8 / 3) * (sag / L) ** 2;
  const S = chord * (1 + slack);
  const T = Math.sqrt(S * S - h * h);
  // 2 a sinh(L / 2a) = T, decreasing in a: bisect in log space
  let lo = Math.log(L / 400), hi = Math.log(L * 400);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const a = Math.exp(mid);
    const f = 2 * a * Math.sinh(Math.min(700, L / (2 * a))) - T;
    if (f > 0) lo = mid;
    else hi = mid;
  }
  const a = Math.exp((lo + hi) / 2);
  const x0 = (L - a * Math.log((S + h) / (S - h))) / 2;
  const c = A.y - a * Math.cosh(x0 / a);
  const N = clamp(Math.ceil(L / 0.35), 10, 160);
  const pts = new Float32Array((N + 1) * 3);
  const cum = new Float32Array(N + 1);
  const ux = dx / L, uz = dz / L;
  for (let i = 0; i <= N; i++) {
    const x = (L * i) / N;
    let y = a * Math.cosh((x - x0) / a) + c;
    if (!Number.isFinite(y)) y = A.y + (h * i) / N;
    if (i === 0) y = A.y;
    if (i === N) y = B.y;
    pts[i * 3] = A.x + ux * x;
    pts[i * 3 + 1] = y;
    pts[i * 3 + 2] = A.z + uz * x;
    if (i > 0) {
      const j = (i - 1) * 3;
      cum[i] = cum[i - 1] + Math.hypot(pts[i * 3] - pts[j], y - pts[j + 1], pts[i * 3 + 2] - pts[j + 2]);
    }
  }
  return { pts, cum, len: cum[N], N, yaw: Math.atan2(ux, uz), ux, uz };
}

export class ZipLines {
  constructor(game, sfx) {
    this.game = game;
    this.E = game.entities;
    this.sfx = sfx;
    this.links = [];
    this.group = new THREE.Group();
    this.group.name = 'zip-lines';
    this.ride = null;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._h1 = new THREE.Vector3();
    this._h2 = new THREE.Vector3();
    this._fx = new THREE.Vector3();
    this._bar = new THREE.Vector3();
    this._assistHold = 0;
    this._sweeps = [];
  }

  // ---------- geometry helpers ----------

  center(e, out = this._v) {
    return this.E.localToWorld(e, 1, 0, 1, out);
  }

  /** Where the cable meets tower e's roof ring, toward the point (tx, tz). */
  anchor(e, tx, tz, out) {
    const c = this.center(e, out);
    const dx = tx - c.x, dz = tz - c.z;
    if (Math.abs(dz) >= Math.abs(dx)) {
      out.x = c.x + clamp((dx / Math.max(1e-6, Math.abs(dz))) * RING, -0.55, 0.55);
      out.z = c.z + Math.sign(dz || 1) * RING;
    } else {
      out.x = c.x + Math.sign(dx || 1) * RING;
      out.z = c.z + clamp((dz / Math.max(1e-6, Math.abs(dx))) * RING, -0.55, 0.55);
    }
    out.y = e.y + (e.yOffset || 0) + TOWER.ANCHOR;
    return out;
  }

  /** A spot on tower e's deck `inset` blocks in from the anchor on its cable side. */
  deckSpot(e, anchor, inset, out) {
    const c = this.center(e, this._w);
    const dx = anchor.x - c.x, dz = anchor.z - c.z;
    const r = Math.hypot(dx, dz) || 1;
    const k = Math.max(0, r - inset) / r;
    return out.set(c.x + dx * k, e.y + (e.yOffset || 0) + TOWER.DECK + 0.01, c.z + dz * k);
  }

  linkOf(uid) {
    for (const l of this.links) if (l.a === uid || l.b === uid) return l;
    return null;
  }

  towers() {
    const out = [];
    for (const e of this.E.map.values()) if (e.key === 'zipline_tower') out.push(e);
    return out;
  }

  // ---------- linking ----------

  /** A tower was placed (Build tool, undo/redo, a Magic Build): link it to its nearest free partner. */
  onPlace(e, { quiet = false } = {}) {
    if (this.linkOf(e.uid)) return;
    const c = this.center(e, new THREE.Vector3());
    let best = null, bestD = Infinity, tooFar = false;
    for (const o of this.towers()) {
      if (o === e || this.linkOf(o.uid)) continue;
      const oc = this.center(o, this._w);
      const hd = Math.hypot(oc.x - c.x, oc.z - c.z);
      const d = Math.hypot(hd, oc.y - c.y);
      if (hd < ZIP_MIN) continue;
      if (d > ZIP_MAX) { tooFar = true; continue; }
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) {
      this.link(best, e, { fx: !quiet });
      if (!quiet) this.game.toast('Zip line ready! Tap a tower to zip across!', { icon: 'star', color: 'pink', key: 'zip-link' });
    } else if (!quiet) {
      this.game.toast(tooFar ? 'That tower is too far away! Zip towers link up to 48 blocks apart.' : 'Now build a second Zip Tower (up to 48 blocks away)!', { icon: 'star', key: 'zip-link' });
    }
  }

  onRemove(e) {
    const l = this.linkOf(e.uid);
    if (!l) return;
    if (this.ride && this.ride.link === l) this.cancelRide();
    this.unlink(l);
  }

  link(ea, eb, { fx = false, parked = 'a' } = {}) {
    const cb = this.center(eb, new THREE.Vector3());
    const A = this.anchor(ea, cb.x, cb.z, new THREE.Vector3());
    const ca = this.center(ea, new THREE.Vector3());
    const B = this.anchor(eb, ca.x, ca.z, new THREE.Vector3());
    const cat = catenary(A, B);
    const obj = new THREE.Group();
    obj.name = 'zip-line';
    const pts = [];
    for (let i = 0; i <= cat.N; i++) pts.push(new THREE.Vector3(cat.pts[i * 3], cat.pts[i * 3 + 1], cat.pts[i * 3 + 2]));
    const cable = cableMesh(pts, cat.len);
    obj.add(cable);
    // little clamps tying the cable to both roof beams
    const clampGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    for (const P of [A, B]) {
      const m = new THREE.Mesh(clampGeo, cable.material);
      m.position.set(P.x, P.y + 0.04, P.z);
      obj.add(m);
    }
    const tr = trolleyModel(ea.color || '#FF9CCB');
    tr.rotation.order = 'YXZ';
    obj.add(tr);
    this.group.add(obj);
    const l = {
      a: ea.uid, b: eb.uid, obj, cable, clampGeo, trolley: tr, handle: tr.userData.parts.handle,
      ...cat, parked, s: parked === 'a' ? 0 : cat.len, shuttle: null, cursor: 0, idle: 0,
    };
    this.links.push(l);
    this._placeTrolley(l, l.s, 0);
    if (fx) {
      this.sfx.zing();
      this._sweeps.push({ l, t: 0 });
    }
    return l;
  }

  unlink(l) {
    const i = this.links.indexOf(l);
    if (i < 0) return;
    this.links.splice(i, 1);
    this.group.remove(l.obj);
    disposeObject(l.obj);
    l.clampGeo.dispose();
    this._sweeps = this._sweeps.filter((s) => s.l !== l);
  }

  clear() {
    this.cancelRide();
    for (const l of this.links.slice()) this.unlink(l);
    this._sweeps.length = 0;
  }

  serialize() {
    return this.links.map((l) => [l.a, l.b, l.parked === 'a' ? 0 : 1]);
  }

  deserialize(list) {
    if (!Array.isArray(list)) return;
    for (const r of list) {
      if (!Array.isArray(r)) continue;
      const ea = this.E.byUid(r[0]), eb = this.E.byUid(r[1]);
      if (!ea || !eb || ea.key !== 'zipline_tower' || eb.key !== 'zipline_tower' || ea === eb) continue;
      if (this.linkOf(ea.uid) || this.linkOf(eb.uid)) continue;
      this.link(ea, eb, { parked: r[2] ? 'b' : 'a' });
    }
  }

  // ---------- sampling the cable ----------

  /** Point at arc length s (A->B) into out; returns the slope dy/ds at that point. */
  sample(l, s, out) {
    s = clamp(s, 0, l.len);
    let j = clamp(l.cursor, 0, l.N - 1);
    while (j > 0 && l.cum[j] > s) j--;
    while (j < l.N - 1 && l.cum[j + 1] < s) j++;
    l.cursor = j;
    const seg = l.cum[j + 1] - l.cum[j] || 1;
    const t = clamp((s - l.cum[j]) / seg, 0, 1);
    const p = l.pts, i = j * 3, k = i + 3;
    out.set(p[i] + (p[k] - p[i]) * t, p[i + 1] + (p[k + 1] - p[i + 1]) * t, p[i + 2] + (p[k + 2] - p[i + 2]) * t);
    return (p[k + 1] - p[i + 1]) / seg;
  }

  /** Put the trolley at arc length s; swing = handle pitch (radians) in the A->B frame. */
  _placeTrolley(l, s, swing) {
    const slope = this.sample(l, s, l.trolley.position);
    const alpha = Math.atan(-slope); // pitch the pulley along the cable
    l.trolley.rotation.set(alpha, l.yaw, 0);
    if (l.handle) l.handle.rotation.x = swing - alpha;
    l.trolley.updateMatrixWorld(true);
  }

  /** World position of the handle bar's middle. */
  barPoint(l, out) {
    if (!l.handle) {
      out.copy(l.trolley.position);
      out.y -= HANDLE_DROP;
      return out;
    }
    return l.handle.localToWorld(out.set(0, -(HANDLE_DROP - 0.14), 0));
  }

  // ---------- riding ----------

  canRide() {
    return !this.ride;
  }

  /** Hand-tap on tower e: climb, grab the handle and zip to its partner. */
  start(e) {
    const g = this.game, p = g.player;
    const l = this.linkOf(e.uid);
    if (!p || !l || this.ride) return false;
    const other = this.E.byUid(l.a === e.uid ? l.b : l.a);
    if (!other) return false;
    if (g.pets && g.pets.rider && g.pets.dismount) g.pets.dismount();
    if (p.state === 'sit' || p.state === 'sleep' || p.state === 'ride') p.stand();
    const from = l.a === e.uid ? 'a' : 'b';
    const dirSign = from === 'a' ? 1 : -1;
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    this.sample(l, from === 'a' ? 0 : l.len, A);
    this.sample(l, from === 'a' ? l.len : 0, B);
    const launch = this.deckSpot(e, A, 0.45, new THREE.Vector3());
    const landing = this.deckSpot(other, B, 0.55, new THREE.Vector3());
    const r = {
      link: l, from, dirSign, e, other, phase: 'climb', t: 0, dur: 0,
      p0: new THREE.Vector3(), p1: new THREE.Vector3(), yaw0: p.yaw, yaw1: p.yaw,
      launch, landing, anchorA: A, anchorB: B,
      s: 0, v: 1.2, vPrev: 1.2, phi: 0, phiV: 0, trail: 0, spark: 0, step: 0, w: 0, emitted: false,
    };
    const travelYaw = Math.atan2(B.x - A.x, B.z - A.z);
    r.travelYaw = travelYaw;
    // where is she? on this tower's deck, on its ladder, or somewhere else
    const loc = this._local(e, p.position);
    const deckY = e.y + (e.yOffset || 0) + TOWER.DECK;
    const onDeck = loc.x > 0.02 && loc.x < 1.98 && loc.z > 0.02 && loc.z < 1.98 && Math.abs(p.position.y - deckY) < 0.4;
    const onLadder = !onDeck && loc.x > 0.45 && loc.x < 1.55 && loc.z > 1.85 && loc.z < 2.8 && p.position.y > e.y - 0.3 && p.position.y < deckY + 0.3;
    if (typeof p.hold === 'function') p.hold(this);
    else p.sitOn(e, p.position.clone(), p.yaw);
    this.ride = r;
    const ladder = this.E.localToWorld(e, 1.0, 0, 2.32, new THREE.Vector3());
    const face = e.rot * (Math.PI / 2) + Math.PI;
    if (onDeck) {
      this._phaseWalk(r, p.position, launch);
    } else {
      if (!onLadder) {
        this._poof(p.position);
        p.position.set(ladder.x, e.y + (e.yOffset || 0) + 0.01, ladder.z);
        this._poof(p.position);
        g.audio.play('magic', { volume: 0.5 });
      } else {
        p.position.x = ladder.x;
        p.position.z = ladder.z;
      }
      r.phase = 'climb';
      r.t = 0;
      r.p0.copy(p.position);
      r.p1.set(ladder.x, deckY + 0.02, ladder.z);
      r.dur = Math.max(0.2, (r.p1.y - r.p0.y) / CLIMB_SPEED);
      r.yaw0 = r.yaw1 = face;
      p.yaw = face;
    }
    // the trolley comes over if it waits at the other end
    const want = from === 'a' ? 0 : l.len;
    if (Math.abs(l.s - want) > 0.05) {
      l.shuttle = { from: l.s, to: want, t: 0, dur: clamp(l.len / 16, 0.8, 2.2) };
      this.sfx.whirr(l.shuttle.dur);
    }
    if (g.cameraRig) this._assistHold = 0;
    return true;
  }

  _phaseWalk(r, from, to) {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    r.p0.copy(from);
    r.p1.copy(to);
    r.phase = d > 0.12 ? 'walk' : 'wait';
    r.t = 0;
    r.dur = d / WALK_SPEED;
    r.yaw0 = this.game.player.yaw;
    r.yaw1 = d > 0.12 ? Math.atan2(to.x - from.x, to.z - from.z) : r.travelYaw;
  }

  /** Tower-local (model) x/z of a world point. */
  _local(e, pos) {
    const c = this.E.localToWorld(e, 0, 0, 0, this._w);
    const dx = pos.x - c.x, dz = pos.z - c.z;
    // inverse of the entities' rotXZ (rot quarter turns); the model origin maps to c
    let x, z;
    switch (e.rot & 3) {
      case 1: x = -dz; z = dx; break;
      case 2: x = -dx; z = -dz; break;
      case 3: x = dz; z = -dx; break;
      default: x = dx; z = dz;
    }
    this._loc = this._loc || { x: 0, z: 0 };
    this._loc.x = x;
    this._loc.z = z;
    return this._loc;
  }

  _poof(pos) {
    if (this.game.particles) this.game.particles.emit('sparkle', this._fx.set(pos.x, pos.y + 0.9, pos.z), { count: 14, spread: 0.8 });
  }

  /** Let go early (tower removed, she flew off, world closing...). */
  cancelRide() {
    const r = this.ride;
    if (!r) return;
    this.ride = null;
    this.sfx.windStop();
    const p = this.game.player;
    if (p && p.avatar) {
      p.avatar.group.rotation.x = 0;
      p.avatar.group.rotation.z = 0;
    }
    if (p && p.state === 'hold' && p.holder === this && p.release) p.release();
    else if (p && p.state === 'sit' && p.seatEntity === r.e) p.stand();
    const l = r.link;
    if (this.links.includes(l)) {
      l.parked = l.s < l.len / 2 ? 'a' : 'b';
      l.s = l.parked === 'a' ? 0 : l.len;
      l.shuttle = null;
      this._placeTrolley(l, l.s, 0);
    }
  }

  /** Per-frame: shuttles, link sparkles, the ride. */
  update(dt) {
    const g = this.game;
    for (const l of this.links) {
      if (!l.shuttle) continue;
      const sh = l.shuttle;
      sh.t += dt;
      const k = smooth(clamp(sh.t / sh.dur, 0, 1));
      l.s = sh.from + (sh.to - sh.from) * k;
      this._placeTrolley(l, l.s, Math.sin(k * Math.PI) * 0.35 * Math.sign(sh.to - sh.from));
      if (sh.t >= sh.dur) {
        l.shuttle = null;
        l.parked = sh.to < l.len / 2 ? 'a' : 'b';
        this.sfx.thump(0.4);
        if (g.particles) g.particles.emit('sparkle', l.trolley.position, { count: 6 });
      }
    }
    for (let i = this._sweeps.length - 1; i >= 0; i--) {
      const sw = this._sweeps[i];
      const prev = sw.t;
      sw.t += dt;
      const l = sw.l;
      const s0 = (prev / 0.9) * l.len, s1 = Math.min(1, sw.t / 0.9) * l.len;
      for (let s = s0; s < s1; s += 0.9) {
        this.sample(l, s, this._fx);
        if (g.particles) g.particles.emit('sparkle', this._fx, { count: 2, spread: 0.3 });
      }
      if (sw.t >= 0.9) this._sweeps.splice(i, 1);
    }
    if (this.ride) this._updateRide(dt);
  }

  _updateRide(dt) {
    const g = this.game, p = g.player, r = this.ride;
    if (!p || !this.links.includes(r.link) || !this.E.byUid(r.e.uid) || !this.E.byUid(r.other.uid)) {
      this.cancelRide();
      return;
    }
    const holding = typeof p.hold === 'function' ? p.state === 'hold' && p.holder === this : p.state === 'sit';
    if (!holding) {
      this.cancelRide();
      return;
    }
    const l = r.link;
    r.t += dt;
    const av = p.avatar;
    switch (r.phase) {
      case 'climb': {
        const k = clamp(r.t / r.dur, 0, 1);
        p.position.lerpVectors(r.p0, r.p1, k);
        p.velocity.set(0, 0, 0);
        p.onGround = false;
        r.step -= dt;
        if (r.step <= 0) {
          r.step = 0.26;
          g.audio.play('step', { pitch: 1.3 });
        }
        if (av) this._pose(av, 'climb', r.t, 1);
        if (k >= 1) {
          r.phase = 'onto';
          r.t = 0;
          r.dur = 0.4;
          r.p0.copy(p.position);
          this.E.localToWorld(r.e, 1.0, 0, 1.5, r.p1);
          r.p1.y = r.p0.y;
        }
        break;
      }
      case 'onto': {
        const k = clamp(r.t / r.dur, 0, 1);
        p.position.lerpVectors(r.p0, r.p1, k);
        p.velocity.set((r.p1.x - r.p0.x) / r.dur, 0, (r.p1.z - r.p0.z) / r.dur);
        p.onGround = true;
        if (k >= 1) this._phaseWalk(r, p.position, r.launch);
        break;
      }
      case 'walk': {
        const k = clamp(r.t / Math.max(0.01, r.dur), 0, 1);
        p.position.lerpVectors(r.p0, r.p1, k);
        p.velocity.set((r.p1.x - r.p0.x) / Math.max(0.05, r.dur), 0, (r.p1.z - r.p0.z) / Math.max(0.05, r.dur));
        p.onGround = true;
        p.yaw += angleDelta(p.yaw, r.yaw1) * Math.min(1, dt * 12);
        if (k >= 1) {
          r.phase = 'wait';
          r.t = 0;
        }
        break;
      }
      case 'wait': {
        p.velocity.set(0, 0, 0);
        p.onGround = true;
        p.yaw += angleDelta(p.yaw, r.travelYaw) * Math.min(1, dt * 10);
        if (!l.shuttle && r.t > 0.15 && Math.abs(angleDelta(p.yaw, r.travelYaw)) < 0.25) {
          r.phase = 'grab';
          r.t = 0;
          r.dur = 0.42;
          r.p0.copy(p.position);
          g.audio.play('jump', { volume: 0.6 });
        }
        break;
      }
      case 'grab': {
        const k = clamp(r.t / r.dur, 0, 1);
        p.yaw = r.travelYaw;
        p.velocity.set(0, 0, 0);
        p.onGround = false;
        r.s = 0; // distance travelled along her ride
        this._placeTrolley(l, r.dirSign > 0 ? 0 : l.len, 0);
        this.barPoint(l, this._bar);
        if (av) {
          // arc up from the deck to the bar: hands meet it at the end
          this._pose(av, 'hang', r.t, smooth(Math.min(1, k * 2.2)));
          const hands = this._hands(av);
          const lift = Math.sin(k * Math.PI) * 0.25;
          const tx = this._bar.x - (hands.x - av.group.position.x), ty = this._bar.y - (hands.y - av.group.position.y), tz = this._bar.z - (hands.z - av.group.position.z);
          const e = smooth(k);
          p.position.set(r.p0.x + (tx - r.p0.x) * e, r.p0.y + (ty - r.p0.y) * e + lift, r.p0.z + (tz - r.p0.z) * e);
          av.group.position.copy(p.position);
        }
        if (k >= 1) {
          r.phase = 'zip';
          r.t = 0;
          r.v = 1.4;
          this.sfx.windStart();
          if (g.furniture && g.furniture.sfx && g.furniture.sfx.whee) g.furniture.sfx.whee();
          else this.sfx.yay();
          g.events.emit('zipline:ride', { from: r.e, to: r.other });
          r.emitted = true;
        }
        break;
      }
      case 'zip': {
        const ab = r.dirSign > 0 ? r.s : l.len - r.s;
        const slopeAB = this.sample(l, ab, this._fx);
        const slope = slopeAB * r.dirSign; // dy/ds in her travel direction
        const remaining = l.len - r.s;
        let a = -G * (slope / Math.hypot(1, slope)) - 0.012 * r.v * r.v - 0.25;
        r.vPrev = r.v;
        r.v = clamp(r.v + a * dt, VMIN, VMAX);
        if (r.t < 0.6) r.v = Math.min(r.v, 1.4 + r.t * 9);
        r.v = Math.min(r.v, 1.3 + remaining * 2.3);
        r.s = Math.min(l.len, r.s + r.v * dt);
        const acc = (r.v - r.vPrev) / Math.max(dt, 1e-3);
        // pendulum: she swings back as she speeds up, forward as she brakes
        // phi'' = -(g/L) sin(phi) + (a/L) cos(phi) - damping, L ~ 1.2 (hands to her middle)
        r.phiV += (-(G / 1.2) * Math.sin(r.phi) + (acc / 1.2) * Math.cos(r.phi) - 2.2 * r.phiV) * dt;
        r.phi = clamp(r.phi + r.phiV * dt, -0.45, 0.45);
        const abNow = r.dirSign > 0 ? r.s : l.len - r.s;
        l.s = abNow;
        this._placeTrolley(l, abNow, r.phi * r.dirSign);
        this.barPoint(l, this._bar);
        p.yaw = r.travelYaw;
        p.velocity.set(0, 0, 0);
        p.onGround = false;
        if (av) {
          av.group.rotation.order = 'YXZ';
          av.group.rotation.x = r.phi;
          av.group.rotation.z = Math.sin(r.t * 2.3) * 0.05;
          this._pose(av, 'hang', r.t, 1);
          this._hangFrom(p, av, this._bar);
        }
        this.sfx.windSpeed(r.v);
        this._trail(p, dt, r);
        this._cameraAssist(dt, r.travelYaw);
        if (r.s >= l.len - 0.02) {
          r.phase = 'land';
          r.t = 0;
          r.dur = 0.5;
          r.p0.copy(p.position);
          l.parked = r.dirSign > 0 ? 'b' : 'a';
          this.sfx.windStop();
        }
        break;
      }
      case 'land': {
        const k = clamp(r.t / r.dur, 0, 1);
        const e = smooth(k);
        p.yaw = r.travelYaw;
        p.velocity.set(0, 0, 0);
        p.onGround = k > 0.7;
        if (av) {
          av.group.rotation.x = r.phi * (1 - e);
          av.group.rotation.z = 0;
          this._pose(av, 'hang', r.t, 1 - smooth(Math.min(1, k * 1.6)));
        }
        const bounce = Math.sin(Math.min(1, k * 1.25) * Math.PI) * 0.18;
        p.position.set(r.p0.x + (r.landing.x - r.p0.x) * e, r.p0.y + (r.landing.y - r.p0.y) * e + bounce * (1 - e), r.p0.z + (r.landing.z - r.p0.z) * e);
        this._placeTrolley(l, r.dirSign > 0 ? l.len : 0, Math.sin(k * 7) * 0.3 * (1 - k));
        if (k >= 1) this._finish(r);
        break;
      }
      default:
        break;
    }
  }

  _finish(r) {
    const g = this.game, p = g.player;
    this.ride = null;
    if (p.avatar) {
      p.avatar.group.rotation.x = 0;
      p.avatar.group.rotation.z = 0;
    }
    p.position.copy(r.landing);
    if (p.release) p.release();
    else p.stand();
    p.onGround = true;
    this.sfx.thump(1);
    if (g.particles) {
      g.particles.emit('star', this._fx.set(p.position.x, p.position.y + 0.4, p.position.z), { count: 10 });
      g.particles.emit('sparkle', this._fx, { count: 16, spread: 0.9 });
    }
    const stats = g.profile.stats || (g.profile.stats = {});
    stats.zipRides = (stats.zipRides || 0) + 1;
    g.saveProfile();
    const lines = ['Wheee! What a ride!', 'Zoom! You flew!', 'So fast and sparkly!', 'Wheee! Again?'];
    if (stats.zipRides === 1) g.toast('Wheee! You zipped across!', { icon: 'star', big: true, color: 'pink' });
    else g.toast(lines[stats.zipRides % lines.length], { icon: 'star', key: 'zip-land' });
    g.award('zip_zoom');
    this.sfx.yay();
  }

  // ---------- the rider's pose ----------

  /** World position of the midpoint of her hands (bones updated first). */
  _hands(av) {
    av.group.updateMatrixWorld(true);
    const b = av.bones;
    b.elbowL.localToWorld(this._h1.set(0, -0.2, 0));
    b.elbowR.localToWorld(this._h2.set(0, -0.2, 0));
    return this._h1.add(this._h2).multiplyScalar(0.5);
  }

  /** Move her so her hands hold the bar. */
  _hangFrom(p, av, bar) {
    av.group.position.copy(p.position);
    const h = this._hands(av);
    p.position.x += bar.x - h.x;
    p.position.y += bar.y - h.y;
    p.position.z += bar.z - h.z;
    av.group.position.copy(p.position);
  }

  /**
   * Blend the avatar's bones toward a pose: 'hang' (arms up on the bar, knees tucked, a happy
   * kick) or 'climb' (hand over hand). w = 0 keeps the avatar's own pose.
   */
  _pose(av, kind, t, w) {
    if (w <= 0.001) return;
    const b = av.bones;
    const set = (bone, x, y, z) => {
      const r = bone.rotation;
      r.x += (x - r.x) * w;
      r.y += (y - r.y) * w;
      r.z += (z - r.z) * w;
    };
    if (kind === 'hang') {
      const kick = Math.sin(t * 5.5) * 0.22;
      set(b.armL, -0.14, 0, 2.9);
      set(b.elbowL, -0.12, 0, 0);
      set(b.armR, -0.14, 0, -2.9);
      set(b.elbowR, -0.12, 0, 0);
      set(b.legL, -0.72 + kick, 0, 0.08);
      set(b.kneeL, 1.0 + kick * 0.6, 0, 0);
      set(b.legR, -0.72 - kick, 0, -0.08);
      set(b.kneeR, 1.0 - kick * 0.6, 0, 0);
      set(b.torso, 0.05, 0, 0);
      set(b.head, -0.12, Math.sin(t * 1.3) * 0.15, 0);
    } else {
      const c = Math.sin(t * 7.5);
      set(b.armL, -0.55 - c * 0.25, 0, 2.3 + c * 0.35);
      set(b.elbowL, -0.5, 0, 0);
      set(b.armR, -0.55 + c * 0.25, 0, -2.3 + c * 0.35);
      set(b.elbowR, -0.5, 0, 0);
      set(b.legL, -0.7 - c * 0.45, 0, 0.05);
      set(b.kneeL, 1.0 + c * 0.5, 0, 0);
      set(b.legR, -0.7 + c * 0.45, 0, -0.05);
      set(b.kneeR, 1.0 - c * 0.5, 0, 0);
      set(b.torso, 0.14, 0, 0);
      set(b.head, -0.25, 0, 0);
    }
  }

  _trail(p, dt, r) {
    const g = this.game;
    if (!g.particles) return;
    r.trail -= dt;
    r.spark -= dt;
    if (r.trail <= 0) {
      r.trail = 0.05;
      g.particles.emit('rainbow_trail', this._fx.set(p.position.x, p.position.y + 0.6, p.position.z), { count: 2 });
    }
    if (r.spark <= 0) {
      r.spark = 0.09;
      g.particles.emit('sparkle', this._fx.set(p.position.x, p.position.y + 1.2, p.position.z), { count: 2, spread: 0.5 });
    }
  }

  /** Ease the camera round to look along the ride (unless she is turning it herself). */
  _cameraAssist(dt, yaw) {
    const g = this.game, rig = g.cameraRig, input = g.input;
    if (!rig || rig.mode === 'first') return;
    if (input && input.look && (Math.abs(input.look.dx) + Math.abs(input.look.dy) > 0.5 || input.turn)) this._assistHold = 1.6;
    if (this._assistHold > 0) {
      this._assistHold -= dt;
      return;
    }
    rig.yaw += angleDelta(rig.yaw, yaw) * Math.min(1, dt * 1.6);
    rig.pitch += (0.3 - rig.pitch) * Math.min(1, dt * 1.2);
  }
}
