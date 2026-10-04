// The whale's visits (docs/teams/ocean.md §5.8): two shared windows a game day (from the world
// seed and the game day, so every page shows the same part of the visit at the same moment),
// a local visit every 360 s while the clock is frozen, and one personal first visit at sea.
// The whale lives out on the horizon ring, 12 to 40 blocks past the world edge, at least 55
// blocks from the player; the toast and 'sea:whale' come only once it is placed.

import * as THREE from 'three';
import { whalePhase, clockFrozen, latchKey, WHALE_LEN, WHALE_LATE, WHALE_FROZEN_EVERY } from './schedule.js';
import { SURF } from './motion.js';

const VISIT_S = 30;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();

export class WhaleVisits {
  constructor(sys) {
    this.sys = sys;
    this.game = sys.game;
    this.latched = new Set();
    this.reset();
  }

  reset() {
    this.visit = null;      // { src: 'shared' | 'frozen' | 'personal' | 'debug', key, start, k }
    this.placed = false;
    this.retryAt = 0;
    this.seenT = 0;
    this.spouts = 0;
    this.waved = false;
    this.personalAt = -1;   // game.time.t of the personal visit, -1 none
    this.personalDone = false;
    this.phase = null;
    this.edgeSpout = false;
    this.skipped = 0;
    this.latched.clear();
  }

  get rec() {
    return this.sys.pools.whale[0];
  }

  /** p (0..1) of the current visit, or null. */
  _p() {
    const g = this.game, v = this.visit;
    if (!v) return null;
    if (v.src === 'shared') {
      const ph = whalePhase(g.world.meta.seed | 0, g.time.day, g.time.dayTime);
      if (!ph || ph.k !== v.k || g.time.day !== v.day) return null;
      return ph.p;
    }
    const p = (g.time.t - v.start) / VISIT_S;
    return p >= 0 && p < 1 ? p : null;
  }

  /** Is there a whale out here at all? (the horizon ring is a liquid) */
  canHaveWhale() {
    const m = this.sys.map;
    return !!(m.attached && m.outside().liquid);
  }

  /** Force a visit now (debug). Refused at night. */
  now() {
    const g = this.game;
    if (!this.canHaveWhale() || !this._daylight()) return false;
    this._end(false);
    this.visit = { src: 'debug', key: 'debug|' + g.time.t, start: g.time.t, k: 0 };
    this.retryAt = 0;
    return true;
  }

  _daylight() {
    const tod = this.game.timeOfDay;
    return !tod || tod.daylight > 0.3;
  }

  _end(clearVisit = true) {
    const r = this.rec;
    r.on = false;
    this.placed = false;
    this.seenT = 0;
    this.spouts = 0;
    this.waved = false;
    this.edgeSpout = false;
    this.visitMet = false;
    if (clearVisit) this.visit = null;
    this.sys.ui && this.sys.ui.pointerAt(false);
  }

  /**
   * Try to place the whale on the ring; true when placed. Directions are sampled from her, the
   * one closest to her view first: a point 12 to 40 blocks past the world edge, at least 55
   * blocks from her, inside 0.75 x fog far; else the nearest such point inside 0.95 x fog far.
   */
  _place(px, pz) {
    const g = this.game, sys = this.sys, m = sys.map, w = g.world;
    const fog = g.scene.fog && Number.isFinite(g.scene.fog.far) ? g.scene.fog.far : 160;
    const cam = g.cameraRig ? g.cameraRig.yaw : 0;
    const sx = w.sx, sz = w.sz;
    let best = null, bestScore = -Infinity, near = null, nearD = Infinity;
    for (let k = 0; k < 24; k++) {
      // 0, +1, -1, +2, -2 ... steps of 15 degrees away from her view
      const step = (k + 1) >> 1, sign = k % 2 ? 1 : -1;
      const a = cam + sign * step * (Math.PI / 12);
      const dx = Math.sin(a), dz = Math.cos(a);
      for (let d = 55; d <= 0.95 * fog; d += 6) {
        const x = px + dx * d, z = pz + dz * d;
        const past = Math.max(-x, x - sx, -z, z - sz);
        if (past < 12 || past > 40) continue;
        if (d < nearD) { nearD = d; near = [x, z]; }
        if (d > 0.75 * fog) continue;
        const score = -step * 10 - d * 0.01;
        if (score > bestScore) { bestScore = score; best = [x, z]; }
        break;
      }
    }
    if (!best && near) best = near;
    if (!best) return false;
    const r = this.rec;
    const out = m.outside();
    r.on = true;
    r.role = 'wild';
    r.state = 'show';
    r.x = best[0]; r.z = best[1];
    r.level = out.level;
    r.yaw = Math.atan2(px - r.x, pz - r.z) + Math.PI / 2;
    r.scale = 1;
    r.fade = 1;
    r.amp = 0.5;
    r.variant = sys.pickVariant('whale');
    r.tintVer++;
    r.y = this._bedY();
    this.placed = true;
    return true;
  }

  _bedY() {
    const out = this.sys.map.outside();
    return Math.max(out.bed + 1.6, out.level + SURF - 4);
  }

  /** Is she somewhere a whale can be seen from? In play, not in a panel, near sea-level water. */
  _canSee(px, pz) {
    const g = this.game;
    if (g.mode !== 'play' || (g.ui && g.ui.current) || g.paused) return false;
    const m = this.sys.map, w = g.world;
    const edge = Math.min(px, pz, w.sx - px, w.sz - pz);
    if (edge < 60 && m.outside().liquid) return true;
    return this.sys.nearDeep(px, pz, 60);
  }

  update(dt, px, py, pz) {
    const g = this.game, sys = this.sys;
    if (!g.world || !this.canHaveWhale()) { if (this.rec.on) this._end(); return; }
    const seed = g.world.meta.seed | 0;
    // a new window?
    if (!this.visit && this._daylight()) {
      if (clockFrozen(g)) {
        const n = Math.floor(g.time.t / WHALE_FROZEN_EVERY);
        const key = 'frozen|' + n;
        const p = (g.time.t - n * WHALE_FROZEN_EVERY) / VISIT_S;
        if (n > 0 && p < WHALE_LATE && !this.latched.has(key)) this.visit = { src: 'frozen', key, start: n * WHALE_FROZEN_EVERY, k: 0 };
      } else {
        const ph = whalePhase(seed, g.time.day, g.time.dayTime);
        if (ph) {
          const key = latchKey(seed, g.time.day, ph.k);
          if (!this.latched.has(key)) {
            this.latched.add(key);
            if (ph.p <= WHALE_LATE) this.visit = { src: 'shared', key, day: g.time.day, k: ph.k };
          }
        }
      }
      // the personal first visit at sea, once per world session until the whale is met
      if (!this.visit && !this.personalDone && sys.met('whale') === 0) {
        this.seaCheckT = (this.seaCheckT || 0) - dt;
        if (this.personalAt < 0 && this.seaCheckT <= 0) {
          this.seaCheckT = 1;
          if (sys.atSea()) this.personalAt = g.time.t + 5 + Math.random() * 50;
        }
        if (this.personalAt >= 0 && g.time.t >= this.personalAt) {
          this.personalDone = true;
          this.visit = { src: 'personal', key: 'personal', start: g.time.t, k: 0 };
        }
      }
    }
    if (!this.visit) return;
    if (this.visit.key) this.latched.add(this.visit.key);
    const p = this._p();
    if (p == null) { this._end(); return; }
    this.phase = p;
    if (!this.placed) {
      if (p > WHALE_LATE) { this._end(); this.skipped++; return; }
      if (g.time.t >= this.retryAt) {
        this.retryAt = g.time.t + 5;
        if (this._canSee(px, pz) && this._place(px, pz)) {
          sys.stats.whales++;
          // a late first sight (p > 0.27) starts from the part of the visit it is in
          this.spouts = p >= 0.6 ? 3 : p >= 0.45 ? 2 : p >= 0.3 ? 1 : 0;
          if (sys.popups()) sys.ui && sys.ui.toast(sys.text.whale, 'whale', this.rec.variant, { key: 'sea-whale', duration: 4200 });
          sys.playSound('whale', this.rec.x, this.rec.y, this.rec.z, 1.4);
          g.events.emit('sea:whale', { personal: this.visit.src === 'personal' });
        }
      }
      if (!this.placed) return;
    }
    // the visit, driven by p (every page shows the same part at the same moment)
    const r = this.rec;
    const out = sys.map.outside();
    const surf = out.level + SURF;
    const low = this._bedY();
    const high = surf - 0.9;
    let y;
    if (p < 0.27) y = low + (high - low) * Math.sin((p / 0.27) * Math.PI / 2);
    else if (p < 0.8) y = high + 0.12 * Math.sin(p * 40);
    else y = high + (low - high) * Math.min(1, (p - 0.8) / 0.2);
    r.y = y;
    r.pitch = p >= 0.8 ? clamp((p - 0.8) * 2, 0, 0.25) : p < 0.27 ? -0.12 : 0;
    r.phase += dt * (p >= 0.8 ? 3 : 1.4);
    r.amp = p >= 0.75 && p < 0.92 ? 1.2 : 0.5; // the tail wave
    r.x += Math.sin(r.yaw) * 0.6 * dt;
    r.z += Math.cos(r.yaw) * 0.6 * dt;
    const SP = [0.3, 0.45, 0.6];
    if (this.spouts < 3 && p >= SP[this.spouts]) { this.spouts++; this._spout(); }
    // at the world edge on the whale's side: it turns to her, waves and spouts once more
    const w = g.world;
    const edge = Math.min(px, pz, w.sx - px, w.sz - pz);
    if (edge < 3 && !this.edgeSpout && Math.hypot(r.x - px, r.z - pz) < 90) {
      const sideX = r.x < 0 ? px < 3 : r.x > w.sx ? px > w.sx - 3 : false;
      const sideZ = r.z < 0 ? pz < 3 : r.z > w.sz ? pz > w.sz - 3 : false;
      if (sideX || sideZ) {
        this.edgeSpout = true;
        r.yaw = Math.atan2(px - r.x, pz - r.z);
        r.amp = 1.4;
        this._spout();
      }
    }
    // seen: centre in the frustum and inside fog far, 1.5 s in all -> meeting the Whale
    const cam = g.camera;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    _v.set(r.x, r.y + 0.8, r.z);
    const fog = g.scene.fog && Number.isFinite(g.scene.fog.far) ? g.scene.fog.far : 200;
    const inView = _frustum.containsPoint(_v) && _v.distanceTo(cam.position) < fog;
    if (inView) {
      this.seenT += dt;
      if (this.seenT >= 1.5 && !this.visitMet) { this.visitMet = true; sys.greet('whale', null, { quietTap: true }); }
    }
    // the pointer: a soft round picture at the screen edge while it is off-camera
    if (sys.ui) {
      if (inView || !sys.popups()) sys.ui.pointerAt(false);
      else {
        _v.set(r.x, r.y + 1, r.z).project(cam);
        const behind = _v.z > 1;
        let nx = behind ? -_v.x : _v.x, ny = behind ? -_v.y : _v.y;
        const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1;
        nx /= m; ny /= m;
        const W = g.container.clientWidth, H = g.container.clientHeight;
        const x = clamp((nx + 1) / 2 * W, 130, W - 130), yy = clamp((1 - ny) / 2 * H, 110, H - 200);
        sys.ui.pointerAt(true, x, yy);
      }
    }
  }

  _spout() {
    const r = this.rec, sys = this.sys;
    _v.set(r.x + Math.sin(r.yaw) * 1.6, r.level + SURF + 1.2, r.z + Math.cos(r.yaw) * 1.6);
    sys.emit('splash', _v, { count: 30, spread: 0.5, speed: 1.6, scale: 1.6 });
    sys.emit('bubble', _v, { count: 6, spread: 0.6 });
    sys.stats.spouts++;
  }

  /** New world session (or unload). */
  worldChanged() {
    this._end();
    this.reset();
  }

  state() {
    return { phase: this.phase, placed: this.placed, latched: [...this.latched], visit: this.visit ? this.visit.src : null, x: this.rec.x, y: this.rec.y, z: this.rec.z, on: this.rec.on, seenT: this.seenT, skipped: this.skipped, len: WHALE_LEN };
  }
}
