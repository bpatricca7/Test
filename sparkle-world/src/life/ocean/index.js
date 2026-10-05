// Sea animals (docs/teams/ocean.md): dolphins in pods, schools of little fish, sea turtles, an
// octopus, glowing jellies, seahorses, crabs on the shore, starfish on the sand and a gentle
// whale out on the horizon; meeting them, the dolphin ride, the Sea Friends strip, five stickers
// and a small daily sea reward.
//
// Ambient life like the butterflies (src/life/ambient.js): a system named `ocean`, nothing
// placed, nothing saved in a world, each page shows its own animals; the shared moments (the
// buddy dolphin from the world seed, the whale's visit times, a friend's ride `sr` and tricks
// `sk`) come from data every page already has. Drawn as one InstancedMesh per kind (§4.2).
//
//   game.ocean        the facade (§4.8)       game.debug.ocean   probes and tests
//   game.removeLock   Remove waits while riding (game.removeTarget)

import * as THREE from 'three';
import { SeaMap } from './seamap.js';
import { SEA_KINDS, SEA_SPEC, SEA_NAMES, SEA_TEXT, PALETTES, OCEAN_STAR_KINDS, DOLPHIN_NAMES, pickPalette, hexToLinear } from './kinds.js';
import {
  makeRecord, saveGood, sanitize, columnOk, spawnOk, settleY, swimToward, wanderTarget, canLeap, startLeap,
  stepLeap, startTrick, stepTrick, Spawner, placeFish, spaceFish, fishSlot, schoolFrame, stepCrab, rescueCell, bestDirection, glassBetween, SURF, NEAR,
} from './motion.js';
import { SEA_U, SEA_LIQUIDS, SEA_WATER } from './material.js';
import { SeaMeshes, glassLanes } from './render.js';
import { DolphinRide } from './ride.js';
import { WhaleVisits } from './whale.js';
import { createSeaUi } from './ui.js';
import { createSeaSfx } from './sfx.js';
import { installOceanStickers, dailySeaCoins } from './stickers.js';
import { buddyOf, whaleTime } from './schedule.js';
import { thumbFor } from './models.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = Number.isFinite;
const PICK_R = 12;
const WILD = 6;          // dolphin records 0..5 are wild, 6..8 the show pod, 9..11 friends' rides
const SHOW0 = 6, FRIEND0 = 9;
const SCHOOLS = 3, PER_SCHOOL = 10;
/** Little Fish shades within a school (times its colour; index i % 3). */
const FISH_TONES = [1, 0.93, 1.07];
const SOUNDS = { dolphin: 'chirp', fish: 'bloop', sea_turtle: 'bloop', octopus: 'pop', jelly: 'boop', seahorse: 'ding', crab: 'clack', starfish: 'giggle', whale: 'whale' };
const PITCH = { sea_turtle: 0.7, seahorse: 1.4, starfish: 1.3 };
// pick box half sizes [x/z, y down, y up] around the record (feet-origin kinds start at y)
// (the small kinds are built bigger: models.js SIZE)
const BOX = {
  dolphin: [1.0, 0.5, 0.6], sea_turtle: [0.7, 0.35, 0.5], octopus: [0.5, 0, 0.95], jelly: [0.35, 0.5, 0.5],
  seahorse: [0.5, 0.5, 0.55], crab: [0.63, 0, 0.7], starfish: [0.6, 0, 0.45],
};
/** A seahorse's centre above the sea bed's top (its curled tail clear of it) and below the surface. */
const HORSE_BED = 1.55, HORSE_SURF = 0.72;

/** How far apart swimmers of a kind keep (_apart), and the states that hold their place. */
const APART = { dolphin: 1.7, sea_turtle: 1.5, jelly: 1.0, seahorse: 0.8, octopus: 1.2, crab: 0.95 };
/** New animals of a kind spawn at least this far from one already there (_crowded). */
const SPACE = { sea_turtle: 3, octopus: 3, jelly: 1.6, seahorse: 1.8, crab: 1.6, starfish: 1.8 };
/** Clear line-of-sight checks in a row (8 frames apart) before an animal leaves the glass mesh. */
const GLASS_HOLD = 2;
const FIXED = { leap: 1, trick: 1, ride: 1, hold: 1, mount: 1, gallery: 1, buddy: 1 };
/** An octopus's feet: on the bed, or near her up off it with its head just under the surface. */
const octoY = (bed, surf, dist) => {
  const low = bed + 1, high = Math.max(low, surf - 1.6);
  return high + (low - high) * clamp((dist - NEAR * 0.6) / 6, 0, 1);
};
const horseY = (bed, surf, dist) => {
  const low = bed + HORSE_BED, high = Math.max(low, surf - HORSE_SURF);
  return high + (low - high) * clamp((dist - NEAR) / 6, 0, 1);
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _seat = { x: 0, y: 0, z: 0 };
const _hop = [0, 0, 0];
const _tw = [0, 0];

export function install(game) {
  const sys = new OceanSystem(game);
  game.ocean = sys.facade();
  if (game.debug) game.debug.ocean = sys.debugApi();
  game.removeLock = () => sys.removeLocked();
  game.addSystem({
    name: 'ocean',
    onWorldLoad: (world) => sys.worldLoad(world),
    onWorldUnload: () => sys.worldUnload(),
    update: (dt) => sys.update(dt),
  });
  return sys;
}

class OceanSystem {
  constructor(game) {
    this.game = game;
    this.text = SEA_TEXT;
    this.map = new SeaMap();
    this.meshes = game.scene ? new SeaMeshes(game.scene) : null;
    this.pools = {};
    let uid = 0;
    for (const kind of SEA_KINDS) {
      const list = [];
      for (let i = 0; i < SEA_SPEC[kind].cap; i++) {
        const r = makeRecord(kind, i);
        r.uid = uid++;
        r.box = new THREE.Box3();
        r.inSet = false;
        r.pickable = null;
        list.push(r);
      }
      this.pools[kind] = list;
    }
    for (let i = 0; i < SEA_SPEC.dolphin.cap; i++) this.pools.dolphin[i].role = i < WILD ? 'wild' : i < FRIEND0 ? 'show' : 'friend';
    this.schools = [];
    for (let s = 0; s < SCHOOLS; s++) {
      const sc = makeRecord('fish', 100 + s);
      sc.box = new THREE.Box3();
      sc.inSet = false;
      sc.pickable = null;
      sc.scatter = 0;
      sc.n = 0;
      sc.isSchool = true;
      sc.wanderT = 0;
      this.schools.push(sc);
    }
    this.pods = [{ on: false, t: 0, mode: 'cruise', slowT: 0, farT: 0, buddy: false, buddyShown: false, wanderT: 0, tx: 0, tz: 0, n: 0, playLeapT: 2, first: false }];
    for (const kind of SEA_KINDS) for (const r of this.pools[kind]) if (!(kind === 'dolphin' && r.role !== 'wild') && kind !== 'whale' && kind !== 'fish') r.pickable = this._pickable(r);
    for (const sc of this.schools) sc.pickable = this._pickable(sc);
    this.spawner = new Spawner(SEA_KINDS);
    this.ride = new DolphinRide();
    this.rideRec = null;
    this.mount = this._makeMount();
    this.whale = new WhaleVisits(this);
    this.stats = { leaps: 0, leapApex: 0, spawns: 0, despawns: 0, nanResets: 0, puffs: 0, mapTicks: 0, spouts: 0, whales: 0, landings: 0, tricks: 0, remoteTricks: 0, greets: 0, showLeaps: 0, trails: 0 };
    this.env = {
      map: this.map, world: null, props: null, rand: Math.random, seaLevel: null, stats: this.stats,
      isSand: (x, z) => this._isSand(x, z),
      bodyBlocked: (x, y, z) => {
        const pl = game.player, ph = game.physics;
        return !!(pl && ph && ph.bodyBlocked(x, y, z, pl.halfW, pl.height));
      },
    };
    this.paused = false;
    this._okFns = {};
    this.autoSpawn = true; // probes turn it off to set up their own scenes
    this.popupsForced = null;
    this.clock = 0;
    this.frame = 0;
    this.pickT = 0;
    this.spawnT = {};
    for (const k of SEA_KINDS) this.spawnT[k] = 1 + Math.random();
    this.showT = 2;
    this.remote = new Map(); // peer -> { rec, variant, x, y, z, yaw, speed, visible, lastY }
    this.remoteTrickAt = new Map();
    this.trickN = -1;       // presence sk counter (null until the first trick she starts)
    this.trickVar = 0;
    this.rideCueT = 0;
    this.jumpWas = false;
    this.zoomT = 0;
    this.session = this._freshSession();
    this.nearDeepCache = { key: '', t: -1, v: false };
    this.sandIds = null;
    this.sfx = createSeaSfx(game);
    this.award = installOceanStickers(game);
    this.ui = game.ui ? createSeaUi(game, this) : null;
    this._hooks();
  }

  _freshSession() {
    return { firstDeep: false, firstPod: false, poolToast: { fish: false, dolphin: false }, boatToast: false, landToast: false, buddy: null };
  }

  // =====================================================================================
  // hooks: sea map edits, the Starfish block, tools, keys, merfolk's leap
  // =====================================================================================

  _hooks() {
    const g = this.game, ev = g.events;
    ev.on('block:place', (e) => { if (e && this.map.attached) this.map.setColumn(e.x, e.z); });
    ev.on('block:remove', (e) => { if (e && this.map.attached) this.map.setColumn(e.x, e.z); });
    ev.on('net:applied', (e) => {
      if (!this.map.attached) return;
      const cells = e && e.cells;
      if (cells === null || cells === undefined) { this.map.markAllDirty(); return; }
      const w = this.map.world;
      const n = Math.min(cells.length, 4096);
      for (let i = 0; i < n; i++) {
        const c = cells[i];
        if (Array.isArray(c)) this.map.setColumn(c[0], c[2]);
        else if (typeof c === 'number' && w) {
          const x = c % w.sx, z = Math.floor(c / w.sx) % w.sz;
          this.map.setColumn(x, z);
        }
      }
    });
    // the Starfish block says hi too (no edit to garden.js)
    const def = g.registry.blocks.byKey && g.registry.blocks.byKey('starfish');
    if (def && !def.onUse) {
      def.hint = SEA_TEXT.hint;
      def.onUse = (game, hit) => {
        _v.set(hit.x + 0.5, hit.y + 0.3, hit.z + 0.5);
        this.emit('star', _v, { count: 8, spread: 0.3 });
        this.playSound('starfish', _v.x, _v.y, _v.z);
        this.greet('starfish', null, { at: { x: _v.x, y: _v.y + 0.6, z: _v.z } });
        return true;
      };
    }
    // Build and Remove wait while she rides (the vehicles pattern)
    ev.on('game:ready', () => ev.on('tool:change', ({ tool } = {}) => {
      if (!this.ride.on || tool === 'hand') return;
      this._hopFirst();
      g.setTool('hand');
    }));
    g.input.on('key', (e) => {
      if (!e.down || e.repeat || !this.ride.on || g.paused || g.mode !== 'play') return;
      if (g.ui && g.ui.dialogOpen) return;
      if (e.code === 'KeyE' || e.code === 'KeyX') this.hopOff('key');
      // a quick tap can come and go between two frames: the key itself asks for the leap
      else if (e.code === 'Space') this.leapPending = true;
    });
    // merfolk: a mermaid's own leap -> escorting dolphins leap with her (a string event)
    ev.on('player:leap', () => {
      for (const r of this.pools.dolphin) if (r.on && r.role === 'wild' && (r.state === 'escort' || r.state === 'play')) r.leapSoon = 0.05 + Math.random() * 0.15;
    });
    ev.on('world:unload', () => { if (this.ui) this.ui.pointerAt(false); });
  }

  _isSand(x, z) {
    const w = this.map.world;
    if (!w) return false;
    if (!this.sandIds) {
      this.sandIds = new Set();
      for (const k of ['sand', 'sand_pink']) { const d = w.registry.byKey && w.registry.byKey(k); if (d) this.sandIds.add(d.id); }
    }
    const gy = this.map.ground(x, z);
    return gy >= 0 && this.sandIds.has(w.get(Math.floor(x), gy, Math.floor(z)));
  }

  // =====================================================================================
  // world load / unload
  // =====================================================================================

  worldLoad(world) {
    this.endRide('unload', true);
    this._clearAll();
    this.map.attach(world);
    this.env.world = world;
    this.env.props = world.registry.props;
    this.env.seaLevel = this.map.outside().liquid ? this.map.outside().level : (world.waterLevel || null);
    this.session = this._freshSession();
    this.session.buddy = buddyOf(world.meta.seed | 0, world.meta.biome);
    this.spawner.reset();
    this.whale.worldChanged();
    this.nearDeepCache.t = -1;
    this.trickN = -1;
  }

  worldUnload() {
    this.endRide('unload', true);
    this._clearAll();
    this.whale.worldChanged();
    this.map.detach();
    this.env.world = null;
  }

  _clearAll() {
    // out of game.pickables first (a world load / unload clears the Set itself as well)
    this._pickablesOff();
    for (const kind of SEA_KINDS) for (const r of this.pools[kind]) { r.on = false; r.inSet = false; r.saddle = false; r.hidden = false; }
    for (const sc of this.schools) { sc.on = false; sc.inSet = false; }
    for (const p of this.pods) p.on = false;
    this.remote.clear();
    if (this.meshes) this.meshes.hideAll();
    if (this.ui) this.ui.hideBubble();
  }

  // =====================================================================================
  // helpers
  // =====================================================================================

  popups() {
    if (this.popupsForced !== null) return this.popupsForced;
    return !(typeof navigator !== 'undefined' && navigator.webdriver);
  }

  met(kind) {
    const s = this.game.profile && this.game.profile.stats;
    return (s && s.seaMet && s.seaMet[kind]) | 0;
  }

  emit(kind, pos, opts) {
    if (this.game.particles) this.game.particles.emit(kind, pos, opts);
  }

  /** A kind's sound (or a name), quieter with distance from the camera. */
  playSound(kindOrName, x, y, z, vol = 1) {
    const name = SOUNDS[kindOrName] || kindOrName;
    let v = vol;
    if (fin(x)) {
      const c = this.game.camera.position;
      v *= clamp(1 - Math.hypot(x - c.x, y - c.y, z - c.z) / 40, 0, 1);
    }
    this.sfx(name, { volume: v, pitch: PITCH[kindOrName] || 1 });
  }

  pickVariant(kind, pond = false) {
    const w = this.map.world;
    return pickPalette(kind, w ? w.meta.biome : 'meadow', Math.random, { pond });
  }

  _live(kind) {
    let n = 0;
    for (const r of this.pools[kind]) if (r.on && r.role === 'wild') n++;
    return n;
  }

  _free(kind) {
    for (const r of this.pools[kind]) if (!r.on && r.role === 'wild') return r;
    return null;
  }

  /** True if dolphin water lies within r of (x, z): 16 directions x 4 rings, cached 1 s. */
  nearDeep(x, z, r) {
    const key = Math.floor(x / 4) + ',' + Math.floor(z / 4) + ',' + r;
    const c = this.nearDeepCache;
    if (c.key === key && this.clock - c.t < 1) return c.v;
    let v = false;
    if (this.map.attached) {
      for (let k = 0; k < 16 && !v; k++) {
        const a = (k / 16) * TAU;
        for (let q = 1; q <= 4 && !v; q++) {
          const d = (r * q) / 4;
          if (this.map.deepAround(x + Math.sin(a) * d, z + Math.cos(a) * d, 3)) v = true;
        }
      }
    }
    c.key = key; c.t = this.clock; c.v = v;
    return v;
  }

  /** At sea: swimming or boating with no land within 20 blocks, or right by the horizon edge. */
  atSea() {
    const g = this.game, pl = g.player;
    if (!pl || !this.map.attached) return false;
    const boat = this._boat();
    if (!(pl.swimming || pl.state === 'swim' || this.ride.on || (boat && boat.boat))) return false;
    const p = pl.position, w = this.map.world;
    if (this.map.outside().liquid && Math.min(p.x, p.z, w.sx - p.x, w.sz - p.z) < 8) return true;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      for (let d = 4; d <= 20; d += 4) {
        const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        if (this.map.top(x, z) < 0 && this.map.inBounds(Math.floor(x), Math.floor(z))) return false;
      }
    }
    return true;
  }

  _boat() {
    const v = this.game.vehicles;
    return v && typeof v.pose === 'function' ? v.pose() : null;
  }

  near(kind, x, y, z, r) {
    let best = null, bd = r * r;
    const list = kind === 'fish' ? this.schools : this.pools[kind];
    if (!list) return null;
    for (const c of list) {
      if (!c.on || c.role === 'show' || c.role === 'friend') continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2 + (c.z - z) ** 2;
      if (d <= bd) { bd = d; best = c; }
    }
    return best;
  }

  nearAny(x, y, z, r) {
    let best = null, bd = r * r;
    for (const kind of SEA_KINDS) {
      const list = kind === 'fish' ? this.schools : this.pools[kind];
      for (const c of list) {
        if (!c.on || c.role === 'friend') continue;
        const d = (c.x - x) ** 2 + (c.y - y) ** 2 + (c.z - z) ** 2;
        if (d <= bd) { bd = d; best = kind; }
      }
    }
    return best;
  }

  get riding() {
    return this.ride.on;
  }

  // =====================================================================================
  // spawning
  // =====================================================================================

  _spawnRec(r, kind, x, z, opts = {}) {
    const m = this.map;
    r.on = true;
    r.kind = kind;
    r.state = opts.state || 'swim';
    r.prev = 'swim';
    r.t = 0;
    r.x = x; r.z = z;
    r.vx = r.vy = r.vz = 0;
    r.speed = 0;
    r.yaw = opts.yaw != null ? opts.yaw : Math.random() * TAU;
    r.pitch = 0; r.roll = 0;
    r.scale = opts.scale || 1;
    r.phase = Math.random() * TAU;
    r.amp = kind === 'dolphin' ? 0.6 : kind === 'jelly' ? 0.12 : kind === 'sea_turtle' ? 0.5 : kind === 'crab' ? 0.35 : kind === 'seahorse' ? 0.6 : 0.5;
    r.extra = 0;
    r.shade = 1;
    r.variant = opts.variant != null ? opts.variant : this.pickVariant(kind, opts.pond);
    r.tintVer++;
    r.glow = 0; r.flash = 0; r.glowDirty = true;
    r.name = opts.name || '';
    r.buddy = !!opts.buddy;
    r.baby = !!opts.baby;
    r.fade = opts.fade != null ? opts.fade : 0.01;
    r.leaving = false;
    r.puffT = 4 + Math.random() * 2;
    r.leapT = 3 + Math.random() * 4;
    r.leapSoon = -1;
    r.skipT = 3 + Math.random() * 3;
    r.breathT = 6 + Math.random() * 4;
    r.checkT = Math.random() * 0.25;
    r.followT = 0;
    r.bubbleT = 2 + Math.random();
    r.colorT = 20;
    r.lastTap = -1e9;
    r.saddle = false;
    r.hidden = false;
    r.buddyT = 0;
    r.trickN = Math.floor(Math.random() * 3);
    r.pod = opts.pod != null ? opts.pod : -1;
    r.dry = kind === 'crab' || (kind === 'starfish' && m.top(x, z) < 0); // no water over it
    if (r.dry) {
      const gy = m.ground(x, z);
      r.level = gy;
      r.y = r.ty = gy + 1;
      r.tx = x; r.tz = z;
      r.cool = 0;
    } else {
      r.level = m.top(x, z);
      const surf = r.level + SURF;
      const bed = m.bed(x, z);
      if (kind === 'octopus') r.y = octoY(bed, surf, 0);
      else if (kind === 'starfish') r.y = bed + 1;
      else if (kind === 'seahorse') r.y = horseY(bed, surf, 0);
      else if (kind === 'jelly') r.y = surf - 0.5 * r.scale - 0.05;
      else r.y = surf - 0.3;
      r.homeX = x; r.homeZ = z;
    }
    saveGood(r);
    this.stats.spawns++;
    return r;
  }

  /** Another of the kind within its SPACE of (x, z) (a small pool never fills up with them). */
  _crowded(kind, x, z) {
    const d = SPACE[kind] || 0;
    if (!d) return false;
    for (const r of this.pools[kind]) if (r.on && Math.abs(r.x - x) < d && Math.abs(r.z - z) < d && Math.hypot(r.x - x, r.z - z) < d) return true;
    return false;
  }

  _spawnPod(x, z, n, { first = false, sprint = false, arrive = first } = {}) {
    const pod = this.pods[0];
    if (pod.on) return false;
    const s = this.session;
    const buddy = !s.firstPod && s.buddy;
    let k = 0;
    const baby = n >= 3 && Math.random() < 0.25;
    const names = new Set();
    for (const r of this.pools.dolphin) {
      if (k >= n) break;
      if (r.on || r.role !== 'wild') continue;
      let px = x, pz = z;
      if (k > 0) {
        const a = Math.random() * TAU;
        const tx = x + Math.sin(a) * 1.8, tz = z + Math.cos(a) * 1.8;
        if (columnOk(this.env, 'dolphin', Math.floor(tx), Math.floor(tz), this.map.top(x, z))) { px = tx; pz = tz; }
      }
      let name = '';
      if (k === 0 && buddy) name = buddy.name;
      else {
        for (let t = 0; t < 12; t++) { name = DOLPHIN_NAMES[Math.floor(Math.random() * DOLPHIN_NAMES.length)]; if (!names.has(name) && (!buddy || name !== buddy.name)) break; }
      }
      names.add(name);
      const isBaby = baby && k === n - 1;
      this._spawnRec(r, 'dolphin', px, pz, {
        variant: k === 0 && buddy ? buddy.variant : undefined, name, buddy: k === 0 && !!buddy, baby: isBaby,
        scale: isBaby ? 0.6 : 1, pod: 0, state: 'swim', fade: first ? 1 : 0.01,
      });
      r.slot = k;
      k++;
    }
    pod.on = k > 0;
    pod.n = k;
    pod.t = 0;
    pod.mode = 'cruise';
    pod.slowT = pod.farT = 0;
    pod.buddy = !!buddy;
    pod.buddyShown = false;
    pod.wanderT = 0;
    pod.sprint = sprint;
    pod.first = first;
    s.firstPod = true;
    // arriving from the fallback, or the first pod: with a splash (a leap)
    for (const r of this.pools.dolphin) if (r.on && r.pod === 0 && arrive) { r.fade = 1; if (canLeap(this.env, r)) { startLeap(r, 4); this.stats.leaps++; } }
    if (k && this.map.placed(x, z) && !s.poolToast.dolphin && this.popups()) {
      s.poolToast.dolphin = true;
      if (this.ui) this.ui.toast(SEA_TEXT.poolDolphins, 'dolphin', this.pools.dolphin[0].variant, { key: 'sea-pool' });
    }
    return k > 0;
  }

  _spawnSchool(x, z, n, variant = null) {
    const sc = this.schools.find((s) => !s.on);
    if (!sc) return false;
    const si = this.schools.indexOf(sc);
    const pond = this.env.seaLevel == null || this.map.top(x, z) !== this.env.seaLevel || this.map.placed(x, z);
    sc.on = true;
    sc.x = x; sc.z = z;
    sc.level = this.map.top(x, z);
    sc.y = sc.level + SURF - 0.3;
    sc.yaw = Math.random() * TAU;
    sc.speed = 0;
    sc.scatter = 0;
    sc.wanderT = 0;
    sc.pinned = false;
    sc.t = 0;
    sc.fade = 0.01;
    sc.lastTap = -1e9;
    sc.variant = variant != null ? variant : this.pickVariant('fish', pond);
    sc.n = n;
    sc.leaving = false;
    saveGood(sc);
    const list = this.pools.fish;
    // its rows across her view (motion.js schoolFrame), gliding from a random point of its sway
    sc.glideT = Math.random() * 14;
    const eye = this._eye();
    schoolFrame(sc, eye.x, eye.z, 0);
    for (let i = 0; i < PER_SCHOOL; i++) {
      const r = list[si * PER_SCHOOL + i];
      if (i >= n) { r.on = false; continue; }
      this._spawnRec(r, 'fish', x, z, { variant: sc.variant, pod: si, scale: 0.85 + Math.random() * 0.3 });
      // its own place in the school's rows (motion.js fishSlot): the school moves as one
      fishSlot(r, i, n);
      // school mates a touch lighter or darker, so two that overlap still read as two fish
      r.tone = FISH_TONES[i % FISH_TONES.length];
      r.yoff = Math.random();
      r.sepX = 0; r.sepZ = 0; r.waitT = 0;
      placeFish(r, sc, this.env);
    }
    const s = this.session;
    if (this.map.placed(x, z) && !s.poolToast.fish && this.popups()) {
      s.poolToast.fish = true;
      if (this.ui) this.ui.toast(SEA_TEXT.poolFish, 'fish', sc.variant, { key: 'sea-pool' });
    }
    this.stats.spawns++;
    return true;
  }

  _maxFor(kind, tod, low, wet) {
    const sp = SEA_SPEC[kind];
    const day = tod.daylight;
    switch (kind) {
      case 'fish': return Math.max(1, Math.round((low ? sp.low : sp.max) * (day > 0.3 ? 1 : 0.5)));
      case 'sea_turtle': return day > sp.daylight ? sp.max : 0;
      case 'jelly': return tod.night > 0.5 ? (low ? sp.lowNight : sp.maxNight) : (low ? sp.low : sp.max);
      case 'seahorse': return day > sp.daylight ? sp.max : 0;
      case 'crab': return day > sp.daylight && wet < 0.3 ? sp.max : 0;
      default: return sp.max;
    }
  }

  _spawnTick(dt, P, tod, low) {
    const g = this.game;
    const fx = g.weather ? g.weather.fx : null;
    const wet = fx ? fx.snow || 0 : 0;
    const now = this.clock;
    const camYaw = g.cameraRig ? g.cameraRig.yaw : null;
    for (const kind of SEA_KINDS) {
      if (kind === 'whale') continue;
      this.spawnT[kind] -= dt;
      if (this.spawnT[kind] > 0) continue;
      this.spawnT[kind] = 0.5 + Math.random() * 0.4;
      const sp = SEA_SPEC[kind];
      if (kind === 'dolphin') {
        const pod = this.pods[0];
        const water = P.swimming || P.boat || this.nearDeep(P.x, P.z, 30);
        if (pod.on || !water) continue;
        // a new pod only when the free wild slots are at least its size plus 1
        let free = 0;
        for (let i = 0; i < WILD; i++) if (!this.pools.dolphin[i].on) free++;
        const n = 2 + Math.floor(Math.random() * 3);
        if (free < n + 1 && !(free >= 3)) continue;
        const size = Math.min(n, free - 1);
        const first = !this.session.firstDeep && P.swimming && this.map.deepAround(P.x, P.z, 3);
        if (!first && tod.night > 0.5 && Math.random() < 0.5) continue; // half as often at night
        const ring = first ? [20, 25] : sp.near;
        const res = this.spawner.find('dolphin', this.env, P.x, P.z, ring[0], ring[1], sp.min, now, Math.random, _tw, { camYaw: camYaw != null ? camYaw + Math.PI : null, maxR: first ? 25 : ring[1] });
        if (res) {
          if (first) this.session.firstDeep = true;
          this._spawnPod(_tw[0], _tw[1], Math.max(2, size), { first: first || res === 'fallback', sprint: first });
        }
        continue;
      }
      if (kind === 'fish') {
        let on = 0;
        for (const s of this.schools) if (s.on && !s.leaving) on++;
        if (on >= this._maxFor('fish', tod, low, wet)) continue;
        const res = this.spawner.find('fish', this.env, P.x, P.z, sp.near[0], sp.near[1], sp.min, now, Math.random, _tw, { camYaw });
        if (res) {
          const r = low ? sp.perSchoolLow : sp.perSchool;
          this._spawnSchool(_tw[0], _tw[1], r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1)));
        }
        continue;
      }
      const max = this._maxFor(kind, tod, low, wet);
      if (this._live(kind) >= max) continue;
      if (kind === 'sea_turtle') this.spawnT[kind] = 40 + Math.random() * 30; // one at a time
      const okFn = this._okFns[kind] || (this._okFns[kind] = (x, z) => spawnOk(this.env, kind, x, z) && !this._crowded(kind, x + 0.5, z + 0.5));
      const res = this.spawner.find(kind, this.env, P.x, P.z, sp.near[0], sp.near[1], sp.min, now, Math.random, _tw, { camYaw, ok: okFn });
      if (!res) { if (kind === 'sea_turtle') this.spawnT[kind] = 2; continue; }
      const r = this._free(kind);
      if (r) {
        this._spawnRec(r, kind, _tw[0], _tw[1]);
        if (res === 'fallback') { _v.set(r.x, r.y + 0.3, r.z); this.emit('bubble', _v, { count: 4, spread: 0.3 }); }
      }
    }
  }

  // =====================================================================================
  // the show pod (cosmetic, far out, in view)
  // =====================================================================================

  _showTick(dt, P, tod) {
    const g = this.game, list = this.pools.dolphin;
    let live = 0;
    for (let i = SHOW0; i < FRIEND0; i++) if (list[i].on) live++;
    const fog = g.scene.fog && fin(g.scene.fog.far) ? g.scene.fog.far : 150;
    const pod = this.pods[0];
    let realNear = false;
    if (pod.on) for (let i = 0; i < WILD; i++) { const r = list[i]; if (r.on && Math.hypot(r.x - P.x, r.z - P.z) < 30) realNear = true; }
    if (live) {
      // out of view for 10 s, or a real pod arrives: it goes
      for (let i = SHOW0; i < FRIEND0; i++) {
        const r = list[i];
        if (!r.on) continue;
        _v.set(r.x, r.y, r.z).project(g.camera);
        const inView = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
        r.outT = inView ? 0 : (r.outT || 0) + dt;
        if (r.outT > 10 || realNear || tod.daylight < 0.15) r.leaving = true;
      }
      return;
    }
    this.showT -= dt;
    if (this.showT > 0 || tod.daylight <= 0.2 || realNear || this.ride.on) return;
    this.showT = 2;
    const cam = g.cameraRig ? g.cameraRig.yaw : 0;
    const half = ((g.camera.fov || 70) * Math.PI) / 360 * 0.8 * (g.camera.aspect || 1.5);
    const far = 0.8 * fog;
    if (far < 46) return;
    for (let t = 0; t < 12; t++) {
      const a = cam + (Math.random() * 2 - 1) * Math.min(half, 1.2);
      const d = 45 + Math.random() * (far - 45);
      const x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d;
      if (!this.map.deepAround(x, z, 3)) continue;
      const n = 2 + (Math.random() < 0.5 ? 1 : 0);
      const level = this.map.top(x, z);
      for (let k = 0; k < n; k++) {
        const r = list[SHOW0 + k];
        const ox = x + (k - 1) * 2.2, oz = z + (k % 2) * 1.5;
        this._spawnRec(r, 'dolphin', columnOk(this.env, 'dolphin', Math.floor(ox), Math.floor(oz), level) ? ox : x, columnOk(this.env, 'dolphin', Math.floor(ox), Math.floor(oz), level) ? oz : z, { state: 'show', yaw: a + Math.PI / 2 });
        r.role = 'show';
        r.outT = 0;
        const b = bestDirection(this.env, 'dolphin', r, 5, r.yaw); // along open water
        if (b != null) r.yaw = b;
        r.leapT = 2 + k * 3 + Math.random() * 4;
        r.level = level;
      }
      return;
    }
  }

  // =====================================================================================
  // the per-frame update
  // =====================================================================================

  update(dt) {
    const g = this.game;
    if (this.paused || g.mode !== 'play' || !g.world || !g.player || !this.map.attached) {
      if (this.meshes && (this.paused || g.mode !== 'play')) this.meshes.hideAll();
      if (this.paused) this._pickablesOff();
      return;
    }
    dt = clamp(fin(dt) ? dt : 0, 0, 0.05);
    this.clock += dt;
    this.frame++;
    if (this.galleryOn) {
      // the owner-review gallery: still animals, gently kicking
      for (const kind of SEA_KINDS) for (const r of this.pools[kind]) if (r.on) r.phase += dt * 1.5;
      this._write();
      return;
    }
    this.map.tick(2);
    this.stats.mapTicks++;
    const pl = g.player;
    const tod = g.timeOfDay || { daylight: 1, night: 0 };
    const low = g.profile.settings.quality === 'low';
    const boat = this._boat();
    const P = this._P || (this._P = { x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0, yaw: 0, swimming: false, boat: false });
    P.x = pl.position.x; P.y = pl.position.y; P.z = pl.position.z;
    if (boat && boat.boat) {
      P.boat = true; P.x = boat.x; P.z = boat.z; P.yaw = boat.yaw; P.speed = Math.abs(boat.speed);
      P.vx = Math.sin(boat.yaw) * boat.speed; P.vz = Math.cos(boat.yaw) * boat.speed;
    } else {
      P.boat = false;
      P.vx = pl.velocity.x; P.vz = pl.velocity.z;
      P.speed = Math.hypot(P.vx, P.vz);
      P.yaw = P.speed > 0.5 ? Math.atan2(P.vx, P.vz) : pl.yaw;
    }
    P.swimming = !!(pl.swimming || pl.state === 'swim' || this.ride.on);

    // the ride first (it moves the dolphin, then seats her)
    if (this.ride.on) this._rideStep(dt);
    if (this.ride.on && (pl.state !== 'ride' || pl.mountPet !== this.mount)) this.endRide('lost');

    if (this.stillOn) {
      // probes: every animal holds its pose (still drawn and tappable) for a real click
      this._pickables(dt, P);
      this._write(P);
      if (this.ui) this.ui.update(dt);
      return;
    }
    if (this.autoSpawn) {
      this._spawnTick(dt, P, tod, low);
      this._showTick(dt, P, tod);
    }
    this._stepPod(dt, P);
    this._stepShow(dt);
    this._stepSchools(dt, P);
    this._stepOthers(dt, P, tod);
    for (const kind in APART) this._apart(kind, APART[kind]);
    this._stepRemote(dt);
    this.whale.update(dt, P.x, P.y, P.z);
    this._rideCue(dt, P);
    this._pickables(dt, P);
    this._write(P);
    if (this.ui) this.ui.update(dt);
  }

  _fadeStep(r, dt, dist, leave) {
    if (dist > leave) r.leaving = true;
    if (r.leaving) {
      r.fade -= dt * 0.8;
      if (r.fade <= 0) { r.on = false; r.leaving = false; this.stats.despawns++; return false; }
    } else if (r.fade < 1) r.fade = Math.min(1, r.fade + dt * 1.2);
    return true;
  }

  _shade(r, dist) {
    if (dist <= 10) return 1;
    const below = Math.max(0, r.level + SURF - r.y);
    return clamp(1 - 0.07 * below, 0.6, 1);
  }

  _dolphinFx(r, dt, dist) {
    // splashes at a leap's start and end, blowhole puffs near her
    if (dist < NEAR && r.state !== 'leap' && r.state !== 'trick' && r.state !== 'ride') {
      r.puffT -= dt;
      if (r.puffT <= 0) {
        r.puffT = 4 + Math.random() * 2;
        _v.set(r.x + Math.sin(r.yaw) * 0.55 * r.scale, r.level + SURF + 0.15, r.z + Math.cos(r.yaw) * 0.55 * r.scale);
        this.emit('splash', _v, { count: 3, spread: 0.08, speed: 0.4, scale: 0.7 });
        this.playSound('pff', _v.x, _v.y, _v.z, 0.6);
        this.stats.puffs++;
      }
    }
  }

  _leapFx(r, start) {
    _v.set(r.x, r.level + SURF + 0.05, r.z);
    this.emit('splash', _v, { count: 10, spread: 0.35 });
    if (!start) { _v.y -= 0.4; this.emit('bubble', _v, { count: 4, spread: 0.4 }); }
    const c = this.game.camera.position;
    const vol = clamp(1 - Math.hypot(r.x - c.x, r.z - c.z) / 40, 0, 1);
    if (vol > 0.05) this.game.audio.play('splash', { volume: vol * 0.7 });
  }

  /** A wild dolphin's leap / trick in progress. Returns true when it handled the step. */
  _stepAir(r, dt) {
    if (r.state === 'leap') {
      const res = stepLeap(r, dt, this.env);
      const apex = r.y - (r.level + SURF);
      if (apex > this.stats.leapApex) this.stats.leapApex = apex;
      if (res === 'land') { this._leapFx(r, false); if (r.wantHold) { r.wantHold = false; r.state = 'hold'; } }
      return true;
    }
    if (r.state === 'trick') {
      const top = r.y - (r.level + SURF);
      if (stepTrick(r, dt, this.env) === 'done') {
        if (r.wantHold) { r.wantHold = false; r.state = 'hold'; }
        _v.set(r.x, r.y + 0.8, r.z);
        this.emit('heart', _v, { count: 5 });
      } else if (top > 1.6 && !r.sparkled) { r.sparkled = true; _v.set(r.x, r.y + 0.5, r.z); this.emit('sparkle', _v, { count: 10 }); }
      return true;
    }
    return false;
  }

  _escortTarget(P) {
    const pl = this.game.player;
    const T = this._T || (this._T = { x: 0, z: 0, yaw: 0, speed: 0, boat: false, me: true });
    if (P.swimming && !this.ride.on) { T.x = P.x; T.z = P.z; T.yaw = P.yaw; T.speed = P.speed; T.boat = false; T.me = true; return T; }
    if (P.boat) { T.x = P.x; T.z = P.z; T.yaw = P.yaw; T.speed = P.speed; T.boat = true; T.me = true; return T; }
    if (this.ride.on) { T.x = this.ride.x; T.z = this.ride.z; T.yaw = this.ride.yaw; T.speed = this.ride.speed; T.boat = true; T.me = true; return T; }
    // friends in the water or in boats (when she is not), at 4 Hz
    if (this.frame % 15 === 0 || !this._friendT) this._friendT = this._friendTarget(pl);
    return this._friendT || null;
  }

  _friendTarget(pl) {
    const net = this.game.net;
    const fr = net && net.remote && net.remote.friends;
    if (!fr || !fr.size) return null;
    const p = pl.position;
    let best = null, bd = 60 * 60;
    for (const f of fr.values()) {
      if (!f || !f.pos) continue;
      const boat = f.vh && this.game.vehicles && this.game.vehicles.defs && this.game.vehicles.defs.get(f.vh[0]);
      const inBoat = !!(boat && boat.vehicle && boat.vehicle.water === true);
      if (!(f.st === 'i' || f.st === 'm' || inBoat)) continue;
      const d = (f.pos.x - p.x) ** 2 + (f.pos.z - p.z) ** 2;
      if (d < bd) { bd = d; best = { x: f.pos.x, z: f.pos.z, yaw: f.yaw || 0, speed: f.speed || 0, boat: inBoat, me: false }; }
    }
    return best;
  }

  _stepPod(dt, P) {
    const pod = this.pods[0], list = this.pools.dolphin, env = this.env;
    if (!pod.on) return;
    pod.t += dt;
    let leader = null, alive = 0;
    for (let i = 0; i < WILD; i++) {
      const r = list[i];
      if (!r.on || r.pod !== 0) continue;
      alive++;
      if (!leader && r.state !== 'hold' && r.state !== 'ride' && r.state !== 'buddy') leader = r;
    }
    if (!alive) { pod.on = false; return; }
    if (!leader) leader = list.find((r) => r.on && r.pod === 0);
    const T = this._escortTarget(P);
    const dl = T ? Math.hypot(leader.x - T.x, leader.z - T.z) : Infinity;
    const dme = Math.hypot(leader.x - P.x, leader.z - P.z);
    if (T && dl < (T.boat ? 30 : 25)) {
      const slow = !T.boat && T.speed < 1.5;
      pod.slowT = slow ? pod.slowT + dt : 0;
      pod.mode = pod.slowT > 1 ? 'play' : 'escort';
      pod.farT = 0;
    } else {
      pod.mode = pod.mode === 'leave' ? 'leave' : 'cruise';
      pod.farT = dme > 45 ? pod.farT + dt : 0;
      if (pod.farT > 20 && pod.mode !== 'leave') {
        pod.mode = 'leave';
        const a = Math.atan2(leader.x - P.x, leader.z - P.z);
        pod.tx = leader.x + Math.sin(a) * 40; pod.tz = leader.z + Math.cos(a) * 40;
      }
    }
    // the buddy's hello, the first time its pod comes within 6 blocks
    if (pod.buddy && !pod.buddyShown && dme < 6) {
      pod.buddyShown = true;
      const b = list.find((r) => r.on && r.buddy);
      if (b && this.popups() && this.ui) this.ui.toast(SEA_TEXT.buddy.replace('{name}', b.name), 'dolphin', b.variant, { key: 'sea-buddy' });
    }
    // cruise: the leader wanders, toward her if she is in the water nearby
    if (pod.mode === 'cruise') {
      pod.wanderT -= dt;
      if (pod.wanderT <= 0) {
        pod.wanderT = 4 + Math.random() * 3;
        if ((P.swimming || P.boat) && dme < 60) {
          const a = Math.atan2(P.x - leader.x, P.z - leader.z);
          const sv = leader.yaw;
          leader.yaw = a;
          wanderTarget(leader, env, Math.random, _tw, 8, 14);
          leader.yaw = sv;
        } else wanderTarget(leader, env, Math.random, _tw, 8, 14);
        pod.tx = _tw[0]; pod.tz = _tw[1];
      }
    }
    let k = 0;
    let playLeaper = null;
    if (pod.mode === 'play') {
      pod.playLeapT -= dt;
      if (pod.playLeapT <= 0) { pod.playLeapT = 3 + Math.random() * 3; pod.wantPlayLeap = true; }
    }
    for (let i = 0; i < WILD; i++) {
      const r = list[i];
      if (!r.on || r.pod !== 0) continue;
      const slot = k++;
      const dist = Math.hypot(r.x - P.x, r.z - P.z);
      if (!this._fadeStep(r, dt, r.state === 'ride' || r.state === 'hold' ? 0 : dist, pod.mode === 'leave' ? 1e9 : SEA_SPEC.dolphin.leave + 10)) continue;
      if (pod.mode === 'leave' && Math.hypot(r.x - pod.tx, r.z - pod.tz) < 6) r.leaving = true;
      if (r.state === 'ride') continue;
      r.shade = this._shade(r, dist);
      if (this._stepAir(r, dt)) { this._sane(r); continue; }
      if (r.state === 'hold') { this._stepHold(r, dt, P); this._sane(r); continue; }
      if (r.state === 'mount') { this._stepMounting(r, dt); this._sane(r); continue; }
      let tx, tz, want = SEA_SPEC.dolphin.speed;
      if (r.state === 'buddy' && r.buddyT > 0) {
        // after a hop-off: it swims beside her for 20 s
        r.buddyT -= dt;
        if (r.buddyT <= 0) r.state = 'swim';
        tx = P.x + Math.cos(P.yaw) * 2.2; tz = P.z - Math.sin(P.yaw) * 2.2;
        want = Math.min(SEA_SPEC.dolphin.sprint, P.speed + Math.hypot(tx - r.x, tz - r.z) * 1.2);
      } else if ((pod.mode === 'escort' || pod.mode === 'play') && T) {
        const side = slot % 2 ? 1 : -1, row = slot >> 1;
        const fx = Math.sin(T.yaw), fz = Math.cos(T.yaw), rx = Math.cos(T.yaw), rz = -Math.sin(T.yaw);
        if (pod.mode === 'play') {
          const a = pod.t * 0.5 + (slot / Math.max(1, alive)) * TAU;
          tx = T.x + Math.sin(a) * 2.5; tz = T.z + Math.cos(a) * 2.5;
          want = 3.2;
          if (pod.wantPlayLeap && r.state !== 'leap' && canLeap(env, r)) { playLeaper = r; pod.wantPlayLeap = false; }
        } else {
          let s = 2.2 * (1 + row * 0.4), f = 1.0 - row * 1.4;
          if (T.boat && T.speed > 2) { s = 1.6 + row * 0.6; f = 2.6 - row * 1.2; }
          if (r.baby) { s *= 0.6; f -= 0.9; }
          tx = T.x + rx * s * side + fx * f;
          tz = T.z + rz * s * side + fz * f;
          want = Math.min(SEA_SPEC.dolphin.sprint, T.speed + Math.hypot(tx - r.x, tz - r.z) * 1.2);
          if (pod.sprint && Math.hypot(r.x - T.x, r.z - T.z) > 8) want = SEA_SPEC.dolphin.sprint;
        }
        r.state = pod.mode;
        // never closer than 1.5 blocks
        const dx = tx - P.x, dz = tz - P.z, dd = Math.hypot(dx, dz);
        if (dd < 1.6) { tx = P.x + (dx / (dd || 1)) * 1.6; tz = P.z + (dz / (dd || 1)) * 1.6; }
      } else if (pod.mode === 'leave') {
        tx = pod.tx; tz = pod.tz;
        r.state = 'leave';
      } else if (r === leader) {
        tx = pod.tx; tz = pod.tz;
        r.state = 'swim';
        if (pod.sprint && dme > 8) want = SEA_SPEC.dolphin.sprint;
      } else {
        const fx = Math.sin(leader.yaw), fz = Math.cos(leader.yaw), rx = Math.cos(leader.yaw), rz = -Math.sin(leader.yaw);
        const side = slot % 2 ? 1 : -1;
        const s = r.baby ? 0.9 : 1.6 + (slot % 3) * 0.4;
        tx = leader.x + rx * s * side - fx * (r.baby ? 0 : 1.5);
        tz = leader.z + rz * s * side - fz * (r.baby ? 0 : 1.5);
        want = Math.min(SEA_SPEC.dolphin.sprint, leader.speed + Math.hypot(tx - r.x, tz - r.z));
        r.state = 'swim';
      }
      // far from where it wants to be (a new pod, a circle on the other side): it hurries
      const dTarget = Math.hypot(tx - r.x, tz - r.z);
      if (dTarget > 6 && pod.mode !== 'leave') want = Math.max(want, Math.min(SEA_SPEC.dolphin.sprint, dTarget * 1.2));
      swimToward(r, dt, env, tx, tz, want, 2.4);
      settleY(r, dt, env, dist);
      r.roll = clamp(-r.extra * 1.4, -0.35, 0.35);
      r.phase += dt * (2.2 + r.speed * 0.5) * TAU * 0.5;
      r.amp = 0.5 + Math.min(0.4, r.speed * 0.04);
      // leaps: cruising or escorting at speed, in play one at a time, or with her own leap
      r.leapT -= dt;
      if (r.leapSoon > 0) {
        r.leapSoon -= dt;
        if (r.leapSoon <= 0) { r.leapSoon = -1; if (canLeap(env, r)) this._leap(r); }
      } else if (r === playLeaper) {
        if (canLeap(env, r)) this._leap(r, 3);
      } else if (r.leapT <= 0 && pod.mode !== 'play') {
        r.leapT = T && T.boat && pod.mode === 'escort' ? 2 + Math.random() * 2 : 3 + Math.random() * 4;
        if (r.speed > 3 && canLeap(env, r)) this._leap(r);
      }
      this._dolphinFx(r, dt, dist);
      this._cellCheck(r, dt);
      this._sane(r);
    }
  }

  /** The show pod (cosmetic, far out): along open water, a leap every 10 to 20 s. */
  _stepShow(dt) {
    const list = this.pools.dolphin, env = this.env;
    for (let i = SHOW0; i < FRIEND0; i++) {
      const r = list[i];
      if (!r.on) continue;
      if (!this._fadeStep(r, dt, 0, 1e9)) continue;
      if (this._stepAir(r, dt)) continue;
      swimToward(r, dt, env, r.x + Math.sin(r.yaw) * 6, r.z + Math.cos(r.yaw) * 6, 2.2, 0.6);
      r.y = r.level + SURF - 0.3;
      r.phase += dt * 4;
      r.leapT -= dt;
      if (r.leapT <= 0) {
        if (canLeap(env, r)) { r.leapT = 10 + Math.random() * 10; startLeap(r, 4); this.stats.leaps++; this.stats.showLeaps++; this._leapFx(r, true); }
        else {
          // no room ahead: it turns toward open water and tries again in a second
          r.leapT = 1;
          const b = bestDirection(env, 'dolphin', r, 4);
          if (b != null) r.yaw = b;
        }
      }
      this._sane(r);
    }
  }

  _leap(r, fwd) {
    startLeap(r, fwd != null ? fwd : r.speed);
    this.stats.leaps++;
    this._leapFx(r, true);
    this.game.events.emit('sea:leap', { riding: false });
  }

  _sane(r) {
    if (sanitize(r, this.stats)) return;
    saveGood(r);
  }

  /** Every 0.25 s each creature checks its own cell with world.get: built into -> moves or fades. */
  _cellCheck(r, dt) {
    r.checkT -= dt;
    if (r.checkT > 0) return;
    r.checkT = 0.25;
    const res = rescueCell(r, this.env);
    if (res === 'moved') { _v.set(r.x, r.y, r.z); this.emit('bubble', _v, { count: 4, spread: 0.3 }); }
    else if (res === 'fade') { r.leaving = true; r.fade = Math.min(r.fade, 0.3); }
  }

  _stepHold(r, dt, P) {
    // beside her (1.6 blocks), facing her, head up out of the water, still
    const pl = this.game.player;
    const boat = this.ui && this.ui.bubbleFrom === 'boat';
    const a = Math.atan2(r.x - P.x, r.z - P.z);
    const dd = boat ? 2.4 : 1.6;
    let hx = P.x + Math.sin(a) * dd, hz = P.z + Math.cos(a) * dd;
    if (!columnOk(this.env, 'dolphin', Math.floor(hx), Math.floor(hz), r.level)) { hx = r.x; hz = r.z; }
    const d = Math.hypot(hx - r.x, hz - r.z);
    if (d > 0.15) swimToward(r, dt, this.env, hx, hz, Math.min(6, d * 3), 4);
    else { r.speed = 0; r.yaw += clamp(((Math.atan2(P.x - r.x, P.z - r.z) - r.yaw + Math.PI * 3) % TAU) - Math.PI, -3 * dt, 3 * dt); }
    r.y += clamp(r.level + SURF - 0.12 + 0.03 * Math.sin(this.clock * 3) - r.y, -2 * dt, 2 * dt);
    r.pitch += clamp(-0.45 - r.pitch, -2 * dt, 2 * dt);
    r.phase += dt * 3;
    r.amp = 0.3;
    void pl;
  }

  _stepMounting(r, dt) {
    // the dolphin swims under her (0.4 s), then the ride starts
    const pl = this.game.player;
    r.t += dt;
    const k = Math.min(1, dt * 8);
    r.x += (pl.position.x - r.x) * k;
    r.z += (pl.position.z - r.z) * k;
    r.y += (r.level + SURF - 0.25 - r.y) * k;
    r.pitch *= 0.8;
    if (r.t >= 0.4) this._mountNow(r);
  }

  _stepSchools(dt, P) {
    const env = this.env, fish = this.pools.fish;
    for (let s = 0; s < SCHOOLS; s++) {
      const sc = this.schools[s];
      if (!sc.on) continue;
      const dist = Math.hypot(sc.x - P.x, sc.z - P.z);
      sc.kind = 'fish';
      if (!this._fadeStep(sc, dt, dist, SEA_SPEC.fish.leave)) {
        for (let i = 0; i < PER_SCHOOL; i++) fish[s * PER_SCHOOL + i].on = false;
        continue;
      }
      // wander inside 10 blocks of qualifying water; scatter when tapped or swum through fast
      sc.wanderT -= dt;
      if (!sc.pinned && (sc.wanderT <= 0 || Math.hypot(sc.tx - sc.x, sc.tz - sc.z) < 0.5)) {
        sc.wanderT = 4 + Math.random() * 4;
        for (let t = 0; t < 6; t++) {
          const a = Math.random() * TAU, d = 2 + Math.random() * 8;
          const x = sc.x + Math.sin(a) * d, z = sc.z + Math.cos(a) * d;
          if (spawnOk(env, 'fish', Math.floor(x), Math.floor(z)) && this.map.top(x, z) === sc.level) { sc.tx = x; sc.tz = z; break; }
        }
      }
      if (dist < 1.6 && P.speed > 2 && sc.scatter <= 0) this._scatter(sc);
      if (sc.scatter > 0) sc.scatter = Math.max(0, sc.scatter - dt / 3);
      const sv = sc.kind;
      swimToward(sc, dt, env, sc.tx, sc.tz, SEA_SPEC.fish.speed * (sc.scatter > 0.5 ? 2 : 1), 1.5);
      sc.kind = sv;
      if (!spawnOk(env, 'fish', Math.floor(sc.x), Math.floor(sc.z))) { sc.x = sc.gx; sc.z = sc.gz; sc.tx = sc.x; sc.tz = sc.z; }
      saveGood(sc);
      // its rows turn to face her camera and sway gently across her view
      const eye = this._eye();
      schoolFrame(sc, eye.x, eye.z, dt);
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const surf = sc.level + SURF;
      for (let i = 0; i < PER_SCHOOL; i++) {
        const r = fish[s * PER_SCHOOL + i];
        if (!r.on) continue;
        r.orbit += r.orbitW * dt * (1 + sc.scatter * 2);
        placeFish(r, sc, env, dt);
        r.fade = sc.fade;
        r.phase += dt * (6 + sc.speed * 3);
        r.amp = 0.5 + sc.scatter * 0.5;
        if (r.state === 'skip') {
          r.t += dt;
          const p = r.t / 0.5;
          r.y = surf - 0.15 + 0.55 * Math.sin(Math.PI * Math.min(1, p));
          r.pitch = -0.6 * Math.cos(Math.PI * Math.min(1, p));
          if (p >= 1) {
            r.state = 'swim'; r.pitch = 0;
            _v.set(r.x, surf, r.z);
            this.emit('splash', _v, { count: 2, spread: 0.1, scale: 0.5 });
          }
        } else {
          const near = dist <= NEAR;
          const want = near ? surf - 0.38 + 0.1 * Math.sin(r.phase * 0.2 + r.yoff * 6) : surf - 0.7;
          r.y += clamp(want - r.y, -2 * dt, 2 * dt);
          if (near) r.y = clamp(r.y, surf - 0.5, surf - 0.26);
        }
        r.shade = this._shade(r, dist) * (r.tone || 1);
        this._sane(r);
        if (r.x < minX) minX = r.x; if (r.x > maxX) maxX = r.x;
        if (r.y < minY) minY = r.y; if (r.y > maxY) maxY = r.y;
        if (r.z < minZ) minZ = r.z; if (r.z > maxZ) maxZ = r.z;
      }
      // a little room between school mates (no two-headed blobs)
      // and across the view: none peeks out from behind another (no fish with four eyes)
      spaceFish(fish, s * PER_SCHOOL, PER_SCHOOL, dt, sc, env, eye);
      // one fish skips out now and then (near her)
      sc.skipT = (sc.skipT || 4) - dt;
      if (sc.skipT <= 0) {
        sc.skipT = 3 + Math.random() * 3;
        if (dist < NEAR) {
          const r = fish[s * PER_SCHOOL + Math.floor(Math.random() * sc.n)];
          if (r && r.on && r.state !== 'skip') { r.state = 'skip'; r.t = 0; _v.set(r.x, surf, r.z); this.emit('splash', _v, { count: 2, spread: 0.1, scale: 0.5 }); }
        }
      }
      // the school's pick box: its members, at least 1.2 blocks
      if (minX <= maxX) {
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
        const hx = Math.max(0.6, (maxX - minX) / 2 + 0.25), hy = Math.max(0.6, (maxY - minY) / 2 + 0.25), hz = Math.max(0.6, (maxZ - minZ) / 2 + 0.25);
        sc.box.min.set(cx - hx, cy - hy, cz - hz);
        sc.box.max.set(cx + hx, cy + hy, cz + hz);
        sc.y = cy;
      }
    }
  }

  /** Where she looks from: the camera, or (no camera yet) the player. */
  _eye() {
    const c = this.game.camera;
    if (c && c.position && Number.isFinite(c.position.x)) return c.position;
    return this.game.player.position;
  }

  _scatter(sc) {
    sc.scatter = 1;
    _v.set(sc.x, sc.level + SURF - 0.3, sc.z);
    this.emit('bubble', _v, { count: 8, spread: 0.6 });
  }

  _stepOthers(dt, P, tod) {
    const env = this.env, rand = Math.random;
    for (const kind of ['sea_turtle', 'octopus', 'jelly', 'seahorse', 'crab', 'starfish']) {
      const sp = SEA_SPEC[kind];
      const max = this._maxFor(kind, tod, this.game.profile.settings.quality === 'low', 0);
      let live = 0;
      for (const r of this.pools[kind]) {
        if (!r.on) continue;
        live++;
        const dist = Math.hypot(r.x - P.x, r.z - P.z);
        // too many for the time of day (a night jelly by day, a turtle at night): sink and fade
        if (live > max) r.leaving = true;
        if (!this._fadeStep(r, dt, dist, sp.leave)) continue;
        r.t += dt;
        const surf = r.level + SURF;
        if (kind === 'sea_turtle') {
          if (r.state === 'roll') {
            r.roll = TAU * Math.min(1, r.t / 1.2);
            if (r.t >= 1.2) { r.state = 'swim'; r.roll = 0; r.followT = 10; }
          }
          let tx, tz;
          if (r.followT > 0) {
            r.followT -= dt;
            const a = Math.atan2(r.x - P.x, r.z - P.z);
            tx = P.x + Math.sin(a) * 2.5; tz = P.z + Math.cos(a) * 2.5;
          } else {
            if (r.t > (r.nextWander || 0) || Math.hypot(r.tx - r.x, r.tz - r.z) < 1) { r.nextWander = r.t + 6; wanderTarget(r, env, rand, _tw, 6, 12); r.tx = _tw[0]; r.tz = _tw[1]; }
            tx = r.tx; tz = r.tz;
          }
          swimToward(r, dt, env, tx, tz, r.followT > 0 ? 2.4 : sp.speed, r.followT > 0 ? 1.5 : 0.3);
          r.breathT -= dt;
          if (r.breathT <= 0 && r.breathT > -1.2 && dist < NEAR) {
            r.y += clamp(surf - 0.02 - r.y, -1.5 * dt, 1.5 * dt);
            r.pitch = -0.25;
            if (!r.rippled) { r.rippled = true; _v.set(r.x + Math.sin(r.yaw) * 0.6, surf, r.z + Math.cos(r.yaw) * 0.6); this.emit('splash', _v, { count: 2, spread: 0.15, scale: 0.6 }); }
          } else {
            if (r.breathT <= -1.2) { r.breathT = 6 + rand() * 4; r.rippled = false; }
            settleY(r, dt, env, dist);
          }
          r.phase += dt * 0.8 * TAU;
          r.amp = 0.45;
        } else if (kind === 'jelly') {
          if (r.t > (r.nextWander || 0)) { r.nextWander = r.t + 8; wanderTarget(r, env, rand, _tw, 3, 6); r.tx = _tw[0]; r.tz = _tw[1]; }
          swimToward(r, dt, env, r.tx, r.tz, sp.speed, 0.4);
          r.phase += dt * TAU / 1.4;
          r.bob = (r.bob || 0) + dt;
          const lift = r.flash > 0 ? 0.3 * Math.sin(Math.min(1, r.flash / 1.5) * Math.PI) : 0;
          r.y = surf - 0.05 - 0.44 * r.scale - 0.15 * (0.5 + 0.5 * Math.sin(r.phase)) + lift;
          r.amp = 0.12;
          const glow = 0.6 * tod.night + (r.flash > 0 ? 1.2 * (r.flash / 1.5) : 0);
          if (r.flash > 0) r.flash = Math.max(0, r.flash - dt);
          if (Math.abs(glow - r.glow) > 0.02) { r.glow = glow; r.glowDirty = true; }
        } else if (kind === 'octopus') {
          if (r.state === 'scoot') {
            swimToward(r, dt, env, r.tx, r.tz, 3, 6);
            r.extra = 0.25;
            if (Math.hypot(r.tx - r.x, r.tz - r.z) < 0.2 || r.t > 1.5) { r.state = 'rest'; r.speed = 0; }
          } else r.extra = 0.06 + 0.04 * Math.sin(this.clock * 0.6 + r.i);
          // curious: near her it floats up off the bed to say hi (easy to see), farther out it rests on it
          const bed0 = this.map.bed(r.x, r.z);
          if (bed0 >= 0) {
            const want = octoY(bed0, surf, dist) + 0.1 * Math.sin(this.clock * 1.3 + r.i);
            r.y += clamp(want - r.y, -0.8 * dt, 0.8 * dt);
            if (r.y < bed0 + 1) r.y = bed0 + 1;
          }
          r.phase += dt * 1.2;
          r.colorT -= dt;
          if (r.colorT <= 0) { r.colorT = 20; this._nextColor(r); }
          this._bubbles(r, dt, dist);
        } else if (kind === 'seahorse') {
          // near her it floats up just under the surface (easy to see), farther out it sinks to the bed
          const bed2 = this.map.bed(r.x, r.z);
          if (bed2 >= 0) {
            const want = horseY(bed2, surf, dist) + 0.12 * Math.sin(this.clock * Math.PI + r.i);
            r.y += clamp(want - r.y, -0.8 * dt, 0.8 * dt);
          }
          if (r.state === 'twirl') { r.yaw += dt * TAU / 0.8; if (r.t > 0.8) r.state = 'rest'; } else r.yaw += dt * 0.2;
          r.phase += dt * 6 * TAU;
          r.amp = 0.6;
          this._bubbles(r, dt, dist);
        } else if (kind === 'crab') {
          if (r.state === 'wave') { r.extra = 1; r.phase += dt * 10; if (r.t > 1.2) { r.state = 'rest'; r.t = 0; } }
          else stepCrab(r, dt, env, rand, P);
          if (r.lost) { r.lost = false; r.leaving = true; }
          r.phase += dt * 4;
          r.amp = r.state === 'rest' || r.state === 'wave' ? 0.45 : 0.15;
        } else if (kind === 'starfish') {
          r.phase += dt * 0.2 * TAU;
          r.extra = r.state === 'wave' && r.t < 1.2 ? 0.12 * Math.sin(r.t * 12) + 0.08 : 0.03 + 0.02 * Math.sin(r.phase);
          if (this.map.top(r.x, r.z) >= 0) this._bubbles(r, dt, dist);
        }
        if (kind !== 'crab' && kind !== 'starfish') this._cellCheck(r, dt);
        r.shade = this._shade(r, dist);
        this._sane(r);
      }
    }
  }

  /**
   * Swimmers of a kind never sit inside each other (two dolphins crossing read as one with two
   * heads): any two closer than d blocks are eased apart, each only into water it may swim in.
   */
  _apart(kind, d) {
    const list = this.pools[kind], env = this.env, n = list.length;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      if (!a.on || a.hidden || FIXED[a.state]) continue;
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        if (!b.on || b.hidden || FIXED[b.state]) continue;
        const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y, h = Math.hypot(dx, dz);
        if (h >= d || Math.abs(dy) > d) continue;
        const k = Math.min(0.08, (d - h) * 0.25), ux = h > 1e-3 ? dx / h : Math.sin(a.i + 1), uz = h > 1e-3 ? dz / h : Math.cos(a.i + 1);
        for (const [r, s] of [[a, -1], [b, 1]]) {
          const nx = r.x + ux * k * s, nz = r.z + uz * k * s;
          const ok = kind === 'crab' ? this.map.shore(nx, nz) : r.dry || columnOk(env, kind, Math.floor(nx), Math.floor(nz), r.level);
          if (ok) { r.x = nx; r.z = nz; }
        }
      }
    }
  }

  _nextColor(r) {
    r.variant = (r.variant + 1) % PALETTES[r.kind].length;
    r.tintVer++;
  }

  _bubbles(r, dt, dist) {
    if (dist > NEAR) return;
    r.bubbleT -= dt;
    if (r.bubbleT > 0) return;
    r.bubbleT = 2 + Math.random();
    this.stats.trails++;
    _v.set(r.x, r.y + 0.4, r.z);
    this.emit('bubble', _v, { count: 3, spread: 0.12, speed: 0.6, scale: 0.6 });
  }

  _rideCue(dt, P) {
    if (this.ride.on || !P.swimming) return;
    this.rideCueT -= dt;
    if (this.rideCueT > 0) return;
    this.rideCueT = 1.5;
    const r = this._nearestRideable(P.x, P.z, 5);
    if (r) { _v.set(r.x, r.level + SURF + 0.4, r.z); this.emit('sparkle', _v, { count: 4, spread: 0.3 }); }
  }

  _nearestRideable(x, z, rad) {
    let best = null, bd = rad;
    for (let i = 0; i < WILD; i++) {
      const r = this.pools.dolphin[i];
      if (!r.on || r.leaving || r.baby || r.state === 'ride') continue;
      const d = Math.hypot(r.x - x, r.z - z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // =====================================================================================
  // friends' rides and tricks (presence sr / sk)
  // =====================================================================================

  remoteRide(peer, variant, x, y, z, yaw, speed, visible = true) {
    if (variant === null || variant === undefined) {
      const e = this.remote.get(peer);
      if (e) { e.rec.on = false; this.remote.delete(peer); }
      return;
    }
    let e = this.remote.get(peer);
    if (!e) {
      const used = new Set([...this.remote.values()].map((v) => v.rec));
      let rec = null;
      for (let i = FRIEND0; i < SEA_SPEC.dolphin.cap; i++) if (!used.has(this.pools.dolphin[i])) { rec = this.pools.dolphin[i]; break; }
      if (!rec) return;
      e = { rec, lastY: y };
      this.remote.set(peer, e);
      rec.on = true; rec.role = 'friend'; rec.state = 'ride'; rec.fade = 1; rec.scale = 1; rec.saddle = true;
      rec.tintVer++;
    }
    const r = e.rec;
    if (r.variant !== variant) { r.variant = variant; r.tintVer++; }
    if (!fin(x) || !fin(y) || !fin(z)) return;
    // the friend's feet are the seat: the dolphin's centre sits under it
    const yw = fin(yaw) ? yaw : 0;
    r.x = x + Math.sin(yw) * 0.1; r.y = y - 0.42; r.z = z + Math.cos(yw) * 0.1;
    r.yaw = yw;
    const top = this.map.top(r.x, r.z);
    r.level = top; r.dry = top < 0; // the water she rides on (the see-through look, material.js)
    r.speed = fin(speed) ? speed : 0;
    r.hidden = !visible;
    r.on = true;
    e.fresh = true;
  }

  _stepRemote(dt) {
    for (const [, e] of this.remote) {
      const r = e.rec;
      r.phase += dt * (2.2 + r.speed * 0.5) * TAU * 0.5;
      r.amp = 0.5 + Math.min(0.4, r.speed * 0.04);
      const surf = this.map.top(r.x, r.z) + SURF;
      if (fin(surf) && (e.lastY - surf) * (r.y - surf) < 0 && !r.hidden) { _v.set(r.x, surf, r.z); this.emit('splash', _v, { count: 8, spread: 0.3 }); }
      e.lastY = r.y;
    }
  }

  remoteTrick(peer, value, x, y, z) {
    const now = this.clock;
    if (now - (this.remoteTrickAt.get(peer) || -10) < 1.5) return false;
    this.remoteTrickAt.set(peer, now);
    const variant = (value | 0) % 16;
    let best = null, bd = 12, same = false;
    for (let i = 0; i < WILD; i++) {
      const r = this.pools.dolphin[i];
      if (!r.on || r.state === 'ride' || r.state === 'hold' || r.state === 'trick' || r.state === 'leap' || r.state === 'mount') continue;
      const d = Math.hypot(r.x - x, r.z - z);
      const s = r.variant === variant;
      if (d < bd || (d < 12 && s && !same)) { bd = d; best = r; same = s; }
    }
    if (!best && this.map.attached) {
      // bring one of that palette in, 6 blocks from her, with a splash leap
      const r = this.pools.dolphin.slice(0, WILD).find((q) => !q.on);
      if (r) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          const px = x + Math.sin(a) * 6, pz = z + Math.cos(a) * 6;
          if (!this.map.deepAround(px, pz, 3)) continue;
          this._spawnRec(r, 'dolphin', px, pz, { variant: variant < PALETTES.dolphin.length ? variant : 0, fade: 1, pod: 0, name: DOLPHIN_NAMES[k % DOLPHIN_NAMES.length] });
          if (!this.pods[0].on) { this.pods[0].on = true; this.pods[0].mode = 'cruise'; this.pods[0].t = 0; }
          best = r;
          break;
        }
      }
    }
    if (!best) return false;
    best.yaw = Math.atan2(x - best.x, z - best.z);
    startTrick(best, this.env);
    best.sparkled = false;
    _v.set(best.x, best.y + 1, best.z);
    this.emit('heart', _v, { count: 5 });
    this.stats.remoteTricks++;
    return true;
  }

  rideField() {
    const pl = this.game.player;
    return this.ride.on && pl && pl.mountPet === this.mount && this.rideRec ? this.rideRec.variant : null;
  }

  trickField() {
    return this.trickN < 0 ? null : ((this.trickN % 4096) * 16 + (this.trickVar & 15));
  }

  _myTrick(r) {
    this.trickN = this.trickN < 0 ? 1 : this.trickN + 1;
    this.trickVar = r.variant;
    this.game.events.emit('sea:trick', { variant: r.variant });
  }

  // =====================================================================================
  // meeting them
  // =====================================================================================

  _pickable(r) {
    const sys = this;
    const use = (g, hit) => sys.tap(r, hit);
    return {
      object3d: null,
      kind: 'sea',
      ref: r,
      box: r.box,
      throughLiquid: true,
      hint: () => SEA_TEXT.hint,
      onUse: use,
      onBuild: use,
      onRemove: use,
    };
  }

  /** A tap on an animal (any tool): its reaction, its sound, a hello. Always handled. */
  tap(r) {
    const g = this.game, P = g.player.position;
    if (!r.on) return true;
    if (this.clock - r.lastTap < 0.8) return true;
    r.lastTap = this.clock;
    const kind = r.isSchool ? 'fish' : r.kind;
    _v.set(r.x, r.y + 0.6, r.z);
    g.celebrate([_v.x, _v.y, _v.z], 'heart', { quiet: true });
    this.playSound(kind, r.x, r.y, r.z);
    r.t = 0;
    switch (kind) {
      case 'dolphin': {
        const pl = g.player;
        const swimming = pl.swimming || pl.state === 'swim';
        const boat = this._boat();
        const d = Math.hypot(r.x - P.x, r.z - P.z);
        if (this.ride.on) { if (r !== this.rideRec) this._trick(r, false); break; }
        if (swimming && d <= 5 && !r.baby) { this._hold(r, 'water'); break; }
        if (boat && boat.boat && Math.abs(boat.speed) < 1 && Math.hypot(r.x - boat.x, r.z - boat.z) <= 4 && !r.baby) { this._hold(r, 'boat'); break; }
        this._trick(r, true);
        if (this.popups() && this.ui) {
          if (boat && boat.boat && !this.session.boatToast) { this.session.boatToast = true; this.ui.toast(SEA_TEXT.stopBoat, 'dolphin', r.variant); }
          else if (!boat && !swimming && !this.session.landToast) { this.session.landToast = true; this.ui.toast(SEA_TEXT.swimOut, 'dolphin', r.variant); }
        }
        break;
      }
      case 'fish': this._scatter(r); break;
      case 'sea_turtle': r.state = 'roll'; r.t = 0; break;
      case 'octopus': {
        this._nextColor(r);
        _v.set(r.x, r.y + 0.6, r.z);
        this.emit('bubble', _v, { count: 10, spread: 0.4 });
        this.emit('sparkle', _v, { count: 6 });
        const a = Math.random() * TAU;
        const tx = r.x + Math.sin(a) * 2, tz = r.z + Math.cos(a) * 2;
        if (columnOk(this.env, 'octopus', Math.floor(tx), Math.floor(tz), r.level)) { r.state = 'scoot'; r.tx = tx; r.tz = tz; r.t = 0; }
        this.playSound('giggle', r.x, r.y, r.z);
        break;
      }
      case 'jelly': r.flash = 1.5; r.glowDirty = true; break;
      case 'seahorse': r.state = 'twirl'; r.t = 0; _v.set(r.x, r.y + 0.3, r.z); this.emit('sparkle', _v, { count: 8 }); break;
      case 'crab': if (r.state === 'hide') r.y = r.ty; r.state = 'wave'; r.t = 0; break;
      case 'starfish': r.state = 'wave'; r.t = 0; _v.set(r.x, r.y + 0.3, r.z); this.emit('star', _v, { count: 8 }); break;
      default:
    }
    this.greet(kind, r, { at: { x: r.x, y: r.y + 1, z: r.z } });
    return true;
  }

  _trick(r, mine) {
    if (r.state === 'leap' || r.state === 'trick') return;
    startTrick(r, this.env);
    r.sparkled = false;
    this.stats.tricks++;
    if (mine) this._myTrick(r);
  }

  _hold(r, from) {
    if (r.state === 'leap' || r.state === 'trick') r.wantHold = true; // after it lands
    else { r.state = 'hold'; r.pitch = 0; r.roll = 0; }
    this.playSound('chirp', r.x, r.y, r.z);
    if (this.ui) this.ui.showBubble(r, from);
  }

  bubbleValid(r, from) {
    const g = this.game, pl = g.player;
    if (!r.on || !pl || g.mode !== 'play') return false;
    if (Math.hypot(r.x - pl.position.x, r.z - pl.position.z) > 8 && r.state !== 'mount') return false;
    if (from === 'water') return !!(pl.swimming || pl.state === 'swim' || r.state === 'mount' || this.ride.on);
    const boat = this._boat();
    return !!(boat && boat.boat && Math.abs(boat.speed) < 1) || r.state === 'mount';
  }

  bubbleClosed(r) {
    if (r && r.on) r.wantHold = false;
    if (r && r.on && r.state === 'hold') { r.state = 'swim'; r.pitch = 0; }
  }

  askTrick(r) {
    if (!r.on) return;
    this._trick(r, true);
    this.playSound('chirp', r.x, r.y, r.z);
  }

  askRide(r, from) {
    if (!r.on || this.ride.on) return;
    r.rideFrom = from;
    if (r.state === 'trick' || r.state === 'leap') { r.rideWanted = true; this._waitRide(r); return; }
    this._startMount(r);
  }

  _waitRide(r) {
    const tick = () => {
      if (!r.on || !r.rideWanted) return;
      if (r.state === 'trick' || r.state === 'leap') { setTimeout(tick, 100); return; }
      r.rideWanted = false;
      this._startMount(r);
    };
    setTimeout(tick, 100);
  }

  _startMount(r) {
    const g = this.game;
    if (r.rideFrom === 'boat') {
      // she slides over from the stopped boat: it parks on the water, the ride starts at once
      if (g.vehicles && g.vehicles.current) g.vehicles.park({ reason: 'sea' });
      this._mountNow(r);
      return;
    }
    r.state = 'mount';
    r.t = 0;
    _v.set(r.x, r.y + 0.6, r.z);
    this.emit('sparkle', _v, { count: 10 });
    this.playSound('chirp', r.x, r.y, r.z);
  }

  /**
   * One hello: counted in stats.seaMet, the daily coins, 'sea:meet', the first-meet toast (unless
   * a sticker popped for it), the stickers. opts: { at, quietTap }.
   */
  greet(kind, r = null, opts = {}) {
    const g = this.game, p = g.profile;
    if (!p) return;
    if (g.net && g.net.remoteApplying) return;
    const st = p.stats || (p.stats = {});
    const sm = st.seaMet && typeof st.seaMet === 'object' ? st.seaMet : (st.seaMet = {});
    const before = sm[kind] | 0;
    sm[kind] = Math.min(999, before + 1);
    const first = before === 0;
    this.stats.greets++;
    dailySeaCoins(g, kind, opts.at || null);
    let popped = false;
    if (kind === 'dolphin') popped = this.award('dolphin_friend') || popped;
    let kinds = 0;
    for (let i = 0; i < OCEAN_STAR_KINDS; i++) if ((sm[SEA_KINDS[i]] | 0) > 0) kinds++;
    if (kinds >= 5) popped = this.award('sea_explorer') || popped;
    if (kinds >= OCEAN_STAR_KINDS) popped = this.award('ocean_star') || popped;
    if (kind === 'whale') popped = this.award('whale_hello') || popped;
    g.saveProfile();
    g.events.emit('sea:meet', { kind, first, quiet: popped });
    if (first && !popped && this.ui) this.ui.toast(SEA_TEXT.met[kind], kind, r ? r.variant : 0, { key: 'sea-meet', speak: true });
    void opts.quietTap;
  }

  // =====================================================================================
  // the ride
  // =====================================================================================

  _makeMount() {
    const sys = this;
    return {
      kind: 'dolphin',
      pose: 'ride',
      get variant() { return sys.rideRec ? sys.rideRec.variant : 0; },
      get yaw() { return sys.ride.yaw; },
      get kick() { return sys.ride.kick; },
      seatWorld(out) {
        sys.ride.seat(_seat);
        out.x = _seat.x; out.y = _seat.y; out.z = _seat.z;
        return out;
      },
      overlapsCell(x, y, z) {
        const R = sys.ride;
        if (!R.on) return false;
        if (y !== R.level && y !== R.level + 1 && y !== R.level + 2) return false;
        return Math.abs(x + 0.5 - R.x) < 1.3 && Math.abs(z + 0.5 - R.z) < 1.3;
      },
      standSpot() {
        const s = sys.ride.hopSpot(sys.env, _hop);
        return [s[0], s[1], s[2]];
      },
      beforeStand() {
        // stood up by anything (Hop off, flying, a panel action): beside the dolphin in the water
        const s = sys.ride.hopSpot(sys.env, _hop);
        const spot = [s[0], s[1], s[2]];
        sys._finishRide(sys._hopReason || 'stand');
        return spot;
      },
    };
  }

  _mountNow(r) {
    const g = this.game, pl = g.player;
    if (!pl || this.ride.on) return;
    const level = r.level;
    this.rideRec = r;
    r.state = 'ride';
    r.saddle = true;
    r.tintVer++;
    r.fade = 1;
    r.leaving = false;
    this.ride.start(r.x, r.z, r.yaw, level);
    this._hopReason = null;
    if (this.ui) this.ui.hideBubble();
    pl.mount(this.mount);
    if (g.selectedTool !== 'hand') g.setTool('hand');
    if (g.cameraRig) g.cameraRig.extraWant = 1.5;
    const st = g.profile.stats || (g.profile.stats = {});
    st.dolphinRides = (st.dolphinRides | 0) + 1;
    g.saveProfile();
    _v.set(r.x, r.y + 0.8, r.z);
    this.emit('sparkle', _v, { count: 12 });
    this.playSound('chirp', r.x, r.y, r.z);
    g.events.emit('sea:ride', { variant: r.variant });
    this.award('dolphin_rider');
    dailySeaCoins(g, 'ride', { x: r.x, y: r.y + 1.2, z: r.z });
    const touch = g.ui && (g.ui.touch || (g.input && g.input.touch) || document.querySelector('.sw-touch-hud'));
    if (g.ui) g.ui.toast(touch ? SEA_TEXT.rideTouch : SEA_TEXT.rideKeys, { icon: 'star', color: 'sky', key: 'sea-ride' });
    if (this.ui) this.ui.refreshHop();
  }

  _rideStep(dt) {
    const g = this.game, pl = g.player, input = g.input, R = this.ride, r = this.rideRec;
    if (!r || !pl) return;
    const camYaw = g.cameraRig ? g.cameraRig.yaw : pl.yaw;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const busy = g.paused || (g.ui && g.ui.current);
    const mx = busy ? 0 : input.move.x, mz = busy ? 0 : input.move.z;
    const jump = !busy && !!input.jump;
    const press = (jump && !this.jumpWas) || (!busy && this.leapPending);
    this.jumpWas = jump || this.leapPending;
    this.leapPending = false;
    const ev = R.step(dt, fx * mz + rx * mx, fz * mz + rz * mx, !busy && !!input.run, press, this.env);
    r.x = R.x; r.y = R.y; r.z = R.z; r.yaw = R.yaw; r.level = R.level;
    r.pitch = R.leaping ? clamp(-Math.atan2(R.vy, Math.max(1, R.speed)) * 0.8, -0.9, 0.9) : 0;
    r.roll = 0;
    r.phase = R.kick;
    r.amp = 0.5 + R.speed * 0.04;
    r.speed = R.speed;
    saveGood(r);
    if (ev.leap) {
      this.stats.leaps++;
      this._leapFx(r, true);
      g.events.emit('sea:leap', { riding: true });
      const apex = 1.75;
      if (apex > this.stats.leapApex) this.stats.leapApex = apex;
    }
    if (ev.land) this._leapFx(r, false);
    if (ev.refused) { _v.set(r.x, r.level + SURF, r.z); this.emit('splash', _v, { count: 5, spread: 0.2 }); this.playSound('chirp', r.x, r.y, r.z, 0.7); }
    if (ev.uturn) this.playSound('chirp', r.x, r.y, r.z, 0.8);
    if (ev.shallow && this.ui) this.ui.toast(SEA_TEXT.shallow, 'dolphin', r.variant, { key: 'sea-shallow' });
    // zoom: a splash trail and a wider camera
    if (R.zoom) {
      this.zoomT -= dt;
      if (this.zoomT <= 0) {
        this.zoomT = 0.15;
        _v.set(r.x - Math.sin(r.yaw) * 1.2, r.level + SURF, r.z - Math.cos(r.yaw) * 1.2);
        this.emit('splash', _v, { count: 2, spread: 0.15, scale: 0.7 });
      }
    }
    if (g.cameraRig) g.cameraRig.extraWant += clamp((R.zoom ? 2.0 : 1.5) - g.cameraRig.extraWant, -dt, dt);
    if (ev.end) {
      if (this.ui) this.ui.toast(SEA_TEXT.offYouGo, 'dolphin', r.variant, { key: 'sea-off' });
      this.hopOff(ev.end);
      return;
    }
    // seat her (after the dolphin moved, before the camera)
    if (pl.mountPet === this.mount) {
      this.mount.seatWorld(pl.position);
      pl.yaw = R.yaw;
      pl.velocity.set(0, 0, 0);
      if (pl.avatar) {
        pl.avatar.group.position.copy(pl.position);
        pl.avatar.group.rotation.y = pl.yaw;
      }
    }
  }

  /** Hop off (the button, X / E, water gone, blocks in the rider...). */
  hopOff(reason = 'button') {
    if (!this.ride.on) return false;
    const g = this.game, pl = g.player;
    this._hopReason = reason;
    if (pl && pl.state === 'ride' && pl.mountPet === this.mount) pl.stand(); // -> beforeStand -> _finishRide
    if (this.ride.on) this._finishRide(reason);
    g.unstickPlayer();
    this._hopReason = null;
    return true;
  }

  /** The ride is over (whatever ended it): the dolphin swims beside her, labels and camera reset. */
  _finishRide(reason) {
    if (!this.ride.on) return;
    const g = this.game;
    this.ride.on = false;
    const r = this.rideRec;
    this.rideRec = null;
    if (r && r.on) {
      r.saddle = false;
      r.tintVer++;
      r.state = reason === 'unload' ? 'swim' : 'buddy';
      r.buddyT = 20;
      r.speed = 0;
      r.y = r.level + SURF - 0.3;
      r.pitch = 0;
      if (r.role === 'wild' && r.pod !== 0) r.pod = 0;
      if (!this.pods[0].on) { this.pods[0].on = true; this.pods[0].mode = 'cruise'; this.pods[0].t = 0; this.pods[0].n = 1; }
    }
    if (g.cameraRig) g.cameraRig.extraWant = 0;
    g.events.emit('sea:hopoff', { reason });
    if (this.ui) this.ui.refreshHop();
  }

  endRide(reason, silent = false) {
    if (!this.ride.on) return;
    if (silent) {
      const g = this.game, pl = g.player;
      if (pl && pl.mountPet === this.mount) { pl.state = 'walk'; pl.mountPet = null; }
      this._finishRide(reason);
      return;
    }
    if (reason === 'lost') { this._finishRide('lost'); return; }
    this.hopOff(reason);
  }

  _hopFirst() {
    const g = this.game;
    g.audio.play('click', { pitch: 0.6, volume: 0.6 });
    const now = performance.now();
    if (now - (this._hopFirstAt || -1e9) < 1500) return;
    this._hopFirstAt = now;
    if (this.ui) this.ui.toast(SEA_TEXT.hopFirst, 'dolphin', this.rideRec ? this.rideRec.variant : 0, { key: 'sea-hopfirst' });
  }

  removeLocked() {
    if (!this.ride.on) return false;
    this._hopFirst();
    return true;
  }

  // =====================================================================================
  // pickables and buffers
  // =====================================================================================

  _setPick(r, on) {
    const set = this.game.pickables;
    if (on && !r.inSet) { set.add(r.pickable); r.inSet = true; }
    else if (!on && r.inSet) { set.delete(r.pickable); r.inSet = false; }
  }

  _pickablesOff() {
    for (const kind of SEA_KINDS) for (const r of this.pools[kind]) if (r.inSet) this._setPick(r, false);
    for (const sc of this.schools) if (sc.inSet) this._setPick(sc, false);
  }

  _pickables(dt, P) {
    this.pickT -= dt;
    const membership = this.pickT <= 0;
    if (membership) this.pickT = 0.25;
    for (const kind of SEA_KINDS) {
      if (kind === 'fish' || kind === 'whale') continue;
      const b = BOX[kind];
      for (const r of this.pools[kind]) {
        if (!r.pickable) continue;
        if (membership) {
          const want = r.on && !r.leaving && r.state !== 'ride' && r.state !== 'mount' && Math.hypot(r.x - P.x, r.y - P.y, r.z - P.z) < PICK_R;
          this._setPick(r, want);
        }
        if (!r.inSet) continue;
        const h = b[0] * r.scale;
        const feet = kind === 'octopus' || kind === 'crab' || kind === 'starfish';
        r.box.min.set(r.x - h, feet ? r.y : r.y - b[1] * r.scale, r.z - h);
        r.box.max.set(r.x + h, r.y + b[2] * r.scale, r.z + h);
      }
    }
    if (membership) for (const sc of this.schools) this._setPick(sc, sc.on && !sc.leaving && Math.hypot(sc.x - P.x, sc.y - P.y, sc.z - P.z) < PICK_R);
  }

  _write() {
    const M = this.meshes;
    if (!M) return;
    const tod = this.game.timeOfDay;
    SEA_U.uSeaTime.value = this.clock % 600;
    SEA_U.uSeaNight.value = tod && fin(tod.night) ? clamp(tod.night, 0, 1) : 0;
    this._glassTick();
    // within the draw-call budget: a kind split by the glass gets its second mesh while calls are spare
    // (short of calls: the split kinds with the most animals in front first; kinds out of view not drawn)
    const hide = this._hide || (this._hide = {});
    const lanes = glassLanes(this._live, this._back, this._lanes || (this._lanes = {}), undefined, this._front, this._seen, hide);
    const lists = this._lists || (this._lists = [null]);
    const liquid = this._liquidFn || (this._liquidFn = (r) => this._liquid(r));
    for (const kind of SEA_KINDS) {
      lists[0] = this.pools[kind];
      M.write(kind, lists, liquid, lanes[kind]); // null: each animal's own r.behind picks its mesh (render.js)
      if (hide[kind]) M.hideKind(kind);
    }
  }

  /** The linear colour of the liquid a record swims in (water, chocolate milk, strawberry milk). */
  _liquid(r) {
    const w = this.game.world;
    const id = w ? w.get(Math.floor(r.x), r.level, Math.floor(r.z)) : 0;
    const map = this._liq || (this._liq = new Map());
    let c = map.get(id);
    if (!c) {
      const def = w && w.registry && w.registry.byId ? w.registry.byId(id) : null;
      c = hexToLinear(SEA_LIQUIDS[def && def.key] || SEA_WATER);
      map.set(id, c);
    }
    return c;
  }

  /**
   * Glass (material.js): whether each animal is seen through a see-through block (glass, a jelly
   * block, ice) from the camera (r.behind); only those animals draw in their kind's glass mesh
   * (render.js), so a fish behind an ice floe never turns its whole school faint. Each animal's
   * line of sight is checked every eighth frame (a short voxel walk, at most 48 blocks). It goes
   * behind the glass at once (never pasted over it) and back out only after GLASS_HOLD clear checks
   * in a row, so one swimming along a floe's edge does not blink. Returns, per kind, whether any
   * of its animals is behind glass (the debug view).
   */
  _glassTick() {
    const B = this._behind || (this._behind = {});
    const live = this._live || (this._live = {}), back = this._back || (this._back = {});
    const front = this._front || (this._front = {}), seen = this._seen || (this._seen = {});
    for (const kind of SEA_KINDS) { B[kind] = false; live[kind] = 0; back[kind] = 0; front[kind] = 0; seen[kind] = 0; }
    const w = this.game.world, cam = this.game.camera;
    const props = w && w.registry && w.registry.props;
    if (!props || !cam) {
      for (const kind of SEA_KINDS) for (const r of this.pools[kind]) { r.behind = false; r.clear = 0; if (r.on && !r.hidden) { live[kind]++; seen[kind]++; front[kind]++; } }
      return B;
    }
    // what the camera sees (last frame's view; animals move little in one frame): per kind, how many
    // are in view and how many of those in front of the glass (glassLanes, when calls are short)
    const fr = this._frustum || (this._frustum = new THREE.Frustum());
    const pm = this._pm || (this._pm = new THREE.Matrix4());
    const sph = this._sph || (this._sph = new THREE.Sphere());
    fr.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const cp = cam.position, f = this.frame;
    for (const kind of SEA_KINDS) {
      const lift = kind === 'octopus' || kind === 'crab' || kind === 'starfish' ? 0.2 : 0;
      const bs = this.meshes ? this.meshes.k[kind].geo.boundingSphere : null;
      const reach = bs ? bs.radius + bs.center.length() : 3;
      for (const r of this.pools[kind]) {
        if (!r.on || r.hidden) { r.behind = undefined; r.clear = 0; continue; }
        if (((f + r.i) & 7) === 0 || r.behind === undefined) {
          if (glassBetween(w, props.pass, props.shape, cp.x, cp.y, cp.z, r.x, r.y + lift, r.z)) { r.behind = true; r.clear = 0; }
          else if (!r.behind || ++r.clear >= GLASS_HOLD) { r.behind = false; r.clear = 0; }
        }
        live[kind]++;
        if (r.behind) { B[kind] = true; back[kind]++; }
        sph.center.set(r.x, r.y, r.z);
        sph.radius = reach * (r.scale || 1) + 0.5;
        if (fr.intersectsSphere(sph)) { seen[kind]++; if (!r.behind) front[kind]++; }
      }
    }
    return B;
  }

  // =====================================================================================
  // gallery (screenshots for the owner review)
  // =====================================================================================

  gallery({ kinds = SEA_KINDS.filter((k) => k !== 'whale'), palettes = false, variants = null, x = null, y = null, z = null, spacing = 1.3, night = false, cols = 0, cell = 2.6, surface = null } = {}) {
    const g = this.game, pl = g.player;
    this.paused = false;
    this._clearAll();
    this._pickablesOff();
    this.galleryOn = true;
    const ox = x != null ? x : pl.position.x, oy = y != null ? y : pl.position.y + 1.2, oz = z != null ? z : pl.position.z + 4;
    const out = [];
    let i = 0;
    const items = [];
    for (const kind of kinds) {
      // every palette (as many as the kind's mesh holds; `variants` picks which)
      const vs = variants || (palettes ? PALETTES[kind].map((p, v) => v) : [0]);
      for (const v of vs.slice(0, SEA_SPEC[kind].cap)) items.push([kind, v]);
    }
    const width = (kind) => (kind === 'whale' ? 9 : kind === 'dolphin' ? 2.4 : kind === 'sea_turtle' ? 1.6 : 1.1) * spacing;
    let total = 0;
    for (const [k] of items) total += width(k);
    let cur = ox - total / 2;
    const used = {};
    const rows = cols ? Math.ceil(items.length / cols) : 1;
    for (const [kind, v] of items) {
      const w = width(kind);
      const list = this.pools[kind];
      used[kind] = used[kind] || 0;
      const r = list[used[kind]++];
      if (!r) continue;
      r.on = true; r.kind = kind; r.state = 'gallery'; r.variant = v; r.tintVer++; r.fade = 1; r.scale = 1;
      // dry (drawn as on land) unless `surface` puts a water surface at that y (the probe's water-line check)
      r.dry = surface == null; if (surface != null) r.level = surface - SURF;
      const feet = kind === 'octopus' || kind === 'crab' || kind === 'starfish' ? -0.35 : 0;
      if (cols) {
        // a grid: cols across, rows down, `cell` blocks apart (the camera frames it straight on)
        const c = i % cols, row = Math.floor(i / cols);
        // (the camera looks along +z: +x is on the left). Each assignment on its own line: these
        // once sat behind the comment, so every grid animal kept a stale y and z (under the sea
        // floor or far away) and the owner-review pictures showed empty water.
        r.x = ox - (c - (cols - 1) / 2) * cell;
        r.z = oz;
        r.y = oy + ((rows - 1) / 2 - row) * cell * 0.62 + feet;
      } else { r.x = cur + w / 2; r.z = oz; r.y = oy + feet; }
      r.yaw = kind === 'starfish' ? 0.3 : Math.PI - 0.95; r.pitch = kind === 'starfish' ? -0.5 : 0; r.roll = 0; // a 3/4 view toward a camera at -z
      r.phase = 0.6; r.amp = kind === 'dolphin' || kind === 'whale' ? 0.3 : 0.2; r.extra = kind === 'octopus' || kind === 'starfish' ? 0.05 : 0;
      r.shade = 1; r.glow = night && kind === 'jelly' ? 0.6 : 0; r.glowDirty = true; r.saddle = false; r.hidden = false;
      out.push({ kind, variant: v, x: r.x, y: r.y, z: r.z });
      cur += w;
      i++;
    }
    if (this.meshes) this._write();
    return out;
  }

  // =====================================================================================
  // facade and debug
  // =====================================================================================

  facade() {
    const sys = this;
    return {
      get map() { return sys.map; },
      get riding() { return sys.ride.on; },
      rideField: () => sys.rideField(),
      trickField: () => sys.trickField(),
      remoteRide: (peer, variant, x, y, z, yaw, speed, visible) => sys.remoteRide(peer, variant, x, y, z, yaw, speed, visible),
      remoteTrick: (peer, value, x, y, z) => sys.remoteTrick(peer, value, x, y, z),
      hopOff: (reason) => sys.hopOff(reason || 'button'),
      near: (kind, x, y, z, r) => sys.near(kind, x, y, z, r),
      nearAny: (x, y, z, r) => sys.nearAny(x, y, z, r),
      nearDeep: (x, z, r) => sys.nearDeep(x, z, r),
      met: (kind) => sys.met(kind),
      thumb: (kind, variant = 0) => thumbFor(sys.game, kind, variant),
    };
  }

  debugApi() {
    const sys = this, g = this.game;
    const P = () => g.player.position;
    const spot = (pred, from = null, maxR = 120) => {
      const m = sys.map;
      if (!m.attached) return null;
      const s = from || (g.world.meta.spawn ? { x: g.world.meta.spawn[0], z: g.world.meta.spawn[2] } : P());
      for (let r = 0; r <= maxR; r += 2) {
        const n = Math.max(8, Math.round(r * 1.5));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU;
          const x = Math.floor(s.x + Math.sin(a) * r), z = Math.floor(s.z + Math.cos(a) * r);
          if (pred(x, z)) return [x + 0.5, z + 0.5];
        }
      }
      return null;
    };
    const list = (kind) => {
      const out = [];
      const src = kind === 'fish' ? sys.pools.fish : sys.pools[kind] || [];
      for (const r of src) if (r.on) out.push({ i: r.i, x: r.x, y: r.y, z: r.z, yaw: r.yaw, state: r.state, variant: r.variant, name: r.name, role: r.role, saddle: !!r.saddle, level: r.level, buddy: r.buddy, pod: r.pod, fade: r.fade, glow: r.glow, scale: r.scale, hidden: !!r.hidden, inSet: !!r.inSet });
      return out;
    };
    return {
      spawn(kind, x, y, z, { variant = null, n = null } = {}) {
        const m = sys.map;
        if (!m.attached) return 0;
        if (kind === 'dolphin') {
          if (!m.deepAround(x, z, 3) && m.top(x, z) < 0) return 0;
          sys.pods[0].on = false;
          for (let i = 0; i < WILD; i++) sys.pools.dolphin[i].on = false;
          sys._spawnPod(x, z, n || 3, { first: true, arrive: false });
          if (variant != null) for (let i = 0; i < WILD; i++) { const r = sys.pools.dolphin[i]; if (r.on) { r.variant = variant; r.tintVer++; } }
          return sys._live('dolphin');
        }
        if (kind === 'fish') return sys._spawnSchool(x, z, n || 8, variant) ? 1 : 0;
        if (kind === 'whale') return sys.whale.now() ? 1 : 0;
        let k = 0;
        for (let i = 0; i < (n || 1); i++) {
          const r = sys._free(kind);
          if (!r) break;
          const water = kind !== 'crab' && !(kind === 'starfish' && m.top(x, z) < 0);
          if (water && m.top(x, z) < 0) break;
          if (!water && m.ground(x, z) < 0) break;
          sys._spawnRec(r, kind, x + (i % 3) * 0.7, z + Math.floor(i / 3) * 0.7, { variant: variant != null ? variant : undefined, fade: 1 });
          k++;
        }
        return k;
      },
      clear() { sys.endRide('unload', true); sys._clearAll(); sys._pickablesOff(); sys.galleryOn = false; return true; },
      pause(on = true) {
        sys.paused = !!on;
        if (on) { if (sys.meshes) sys.meshes.hideAll(); sys._pickablesOff(); }
        return sys.paused;
      },
      /** Probes: no animals come by themselves while off (debug spawns still work). */
      autoSpawn(on = true) { sys.autoSpawn = !!on; return sys.autoSpawn; },
      /** Probes: move a fish school (its fish and its pick box) up or down by dy. */
      shiftSchool(i = 0, dy = -1) {
        const sc = sys.schools[i];
        if (!sc || !sc.on) return false;
        for (let k = 0; k < PER_SCHOOL; k++) { const r = sys.pools.fish[i * PER_SCHOOL + k]; if (r.on) r.y += dy; }
        sc.y += dy;
        sc.box.min.y += dy;
        sc.box.max.y += dy;
        return true;
      },
      /** Probes: school i swims to (x, z) and stays around it (its fish still circle and space out). */
      schoolTo(i, x, z) {
        const sc = sys.schools[i];
        if (!sc || !sc.on) return false;
        sc.tx = x; sc.tz = z; sc.pinned = true;
        return true;
      },
      /** Probes: the closest two fish of school i (centre to centre across the water; skips left out). */
      fishClosest(i = 0) {
        const sc = sys.schools[i];
        if (!sc || !sc.on) return null;
        let best = Infinity;
        for (let a = 0; a < PER_SCHOOL; a++) {
          const p = sys.pools.fish[i * PER_SCHOOL + a];
          if (!p.on || p.state === 'skip') continue;
          for (let b = a + 1; b < PER_SCHOOL; b++) {
            const q = sys.pools.fish[i * PER_SCHOOL + b];
            if (q.on && q.state !== 'skip') best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z));
          }
        }
        return best;
      },
      /** Probes: every animal holds its pose (still drawn and tappable) while on. */
      still(on = true) { sys.stillOn = !!on; if (on) sys.pickT = 0; return sys.stillOn; },
      popups(on = true) { sys.popupsForced = on === null ? null : !!on; return sys.popups(); },
      count() {
        const out = {};
        for (const k of SEA_KINDS) { out[k] = 0; for (const r of sys.pools[k]) if (r.on) out[k]++; }
        return out;
      },
      list,
      schools: () => sys.schools.filter((s) => s.on).map((s) => ({ x: s.x, y: s.y, z: s.z, n: s.n, scatter: s.scatter, variant: s.variant, level: s.level, inSet: s.inSet, box: [s.box.min.toArray(), s.box.max.toArray()] })),
      pods: () => sys.pods.map((p) => ({ on: p.on, mode: p.mode, n: p.n, buddy: p.buddy, buddyShown: p.buddyShown })),
      buddy: () => sys.session.buddy,
      deepSpot() {
        const s = spot((x, z) => sys.map.deepAround(x, z, 3) && sys.map.deepAround(x + 4, z, 3) && sys.map.deepAround(x - 4, z, 3) && sys.map.deepAround(x, z + 4, 3) && sys.map.deepAround(x, z - 4, 3) && sys.map.inBounds(x - 6, z - 6) && sys.map.inBounds(x + 6, z + 6));
        return s ? [s[0], sys.map.top(s[0], s[1]) + 0.1, s[1]] : null;
      },
      lagoonSpot() {
        const w = g.world, R0 = w.sx * 0.33, cx = w.sx / 2, cz = w.sz / 2;
        const s = spot((x, z) => Math.hypot(x - cx, z - cz) < R0 * 0.9 && sys.map.top(x, z) === sys.env.seaLevel && spawnOk(sys.env, 'fish', x, z), { x: cx, z: cz }, Math.round(R0));
        return s ? [s[0], sys.map.top(s[0], s[1]) + 0.1, s[1]] : null;
      },
      shoreSpot() {
        const s = spot((x, z) => sys.map.shore(x, z) && sys.map.shore(x + 1, z) + sys.map.shore(x - 1, z) + sys.map.shore(x, z + 1) + sys.map.shore(x, z - 1) >= 2);
        return s ? [s[0], sys.map.ground(s[0], s[1]) + 1, s[1]] : null;
      },
      /** Water 2 to 3 deep with a shore cell within 4 blocks (crabs, starfish and seahorses). */
      shallowSpot() {
        const m = sys.map;
        const near = (x, z) => { for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (m.shore(x + dx, z + dz)) return true; return false; };
        const s = spot((x, z) => m.top(x, z) >= 0 && m.top(x, z) === sys.env.seaLevel && m.depth(x, z) >= 2 && m.depth(x, z) <= 3 && m.inBounds(x - 5, z - 5) && m.inBounds(x + 5, z + 5) && near(x, z));
        return s ? [s[0], sys.map.top(s[0], s[1]) + 0.1, s[1]] : null;
      },
      /** The nearest shore cell to (x, z) within r blocks: [x, groundY + 1, z] or null. */
      shoreNear(x, z, r = 8) {
        const m = sys.map;
        let best = null, bd = Infinity;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const cx = Math.floor(x) + dx, cz = Math.floor(z) + dz;
          if (!m.shore(cx, cz)) continue;
          const d = Math.hypot(dx, dz);
          if (d < bd) { bd = d; best = [cx + 0.5, m.ground(cx, cz) + 1, cz + 0.5]; }
        }
        return best;
      },
      /** Pictures: move a live record (by kind and index) to (x, z), optionally facing yaw. */
      move(kind, i, x, z, yaw = null) {
        const r = sys.pools[kind] && sys.pools[kind].find((q) => q.on && q.i === i);
        if (!r) return false;
        r.x = x; r.z = z;
        if (yaw !== null) r.yaw = yaw;
        if (r.tx !== undefined) { r.tx = x; r.tz = z; }
        if (kind === 'seahorse' || kind === 'octopus' || kind === 'starfish') {
          const bed = sys.map.bed(x, z);
          if (bed >= 0) r.y = kind === 'seahorse' ? horseY(bed, r.level + SURF, 0) : kind === 'octopus' ? octoY(bed, r.level + SURF, 0) : bed + 1;
        }
        saveGood(r);
        return true;
      },
      edgeSpot() {
        const w = g.world;
        const s = spot((x, z) => (x === 5 || z === 5 || x === w.sx - 6 || z === w.sz - 6) && sys.map.deepAround(x, z, 3) && sys.map.inBounds(x, z));
        return s ? [s[0], sys.map.top(s[0], s[1]) + 0.1, s[1]] : null;
      },
      mapStats: () => sys.map.stats(),
      tap(kind) {
        const p = P();
        const r = sys.near(kind, p.x, p.y, p.z, 40);
        if (!r) return false;
        r.lastTap = -1e9;
        return sys.tap(r);
      },
      tapRec(kind, i) {
        const r = kind === 'fish' ? sys.schools[i] : sys.pools[kind][i];
        if (!r || !r.on) return false;
        r.lastTap = -1e9;
        return sys.tap(r);
      },
      /** Start a ride now on the nearest dolphin (one comes if none is near). */
      ride() {
        const p = P();
        let r = sys._nearestRideable(p.x, p.z, 12);
        if (!r) {
          const d = this.deepSpot();
          const at = sys.map.deepAround(p.x, p.z, 3) ? [p.x, p.z] : d ? [d[0], d[2]] : null;
          if (!at) return false;
          if (!sys.map.deepAround(p.x, p.z, 3)) g.player.teleport(at[0], sys.map.top(at[0], at[1]) + 0.1, at[1]);
          sys.pods[0].on = false;
          for (let i = 0; i < WILD; i++) sys.pools.dolphin[i].on = false;
          sys._spawnPod(at[0], at[1], 2, { first: true, arrive: false });
          r = sys._nearestRideable(at[0], at[1], 12);
          if (r) r.state = 'swim';
        }
        if (!r) return false;
        sys._mountNow(r);
        return sys.ride.on;
      },
      hopOff: (reason = 'button') => sys.hopOff(reason),
      rideState() {
        const R = sys.ride;
        return { on: R.on, x: R.x, y: R.y, z: R.z, yaw: R.yaw, speed: R.speed, level: R.level, leaping: R.leaping, hop: R.hop, uturn: R.uturn > 0, zoom: R.zoom, variant: sys.rideRec ? sys.rideRec.variant : null, stats: { ...R.stats } };
      },
      whaleNow: () => sys.whale.now(),
      whaleTime: (day, k) => whaleTime(g.world ? g.world.meta.seed | 0 : 0, day, k),
      whaleState: () => sys.whale.state(),
      gallery: (opts) => sys.gallery(opts),
      /** A dolphin (by its index) leaps now, if it can (the owner-review pictures). */
      leap(i) {
        const r = sys.pools.dolphin.find((q) => q.on && q.i === i);
        if (!r || r.state === 'leap') return false;
        sys._leap(r, Math.max(2, r.speed));
        return true;
      },
      palettes: (kind) => PALETTES[kind].length,
      cap: (kind) => SEA_SPEC[kind].cap,
      stats: () => ({ ...sys.stats }),
      bubble: () => (sys.ui && sys.ui.bubbleRec ? { name: sys.ui.bubbleRec.name, from: sys.ui.bubbleFrom, i: sys.ui.bubbleRec.i } : null),
      fields: () => ({ sr: sys.rideField(), sk: sys.trickField() }),
      remote: () => [...sys.remote.entries()].map(([peer, e]) => ({ peer, x: e.rec.x, y: e.rec.y, z: e.rec.z, variant: e.rec.variant, hidden: !!e.rec.hidden, saddle: !!e.rec.saddle })),
      slotTint: (kind, i) => (sys.meshes ? sys.meshes.slotTint(kind, i) : null),
      /** Slot i's (surface y, liquid r, g, b) as drawn (the liquid's colour over it). */
      slotSurf: (kind, i) => (sys.meshes ? sys.meshes.slotSurf(kind, i) : null),
      /** Per kind: an animal of it is seen through glass (material.js; drawn before the glass). */
      behind: () => ({ ...(sys._behind || {}) }),
      /** Per kind: how many of its live animals are seen through glass (each is drawn on its own). */
      behindCount() {
        const out = {};
        for (const k of SEA_KINDS) { out[k] = 0; for (const r of sys.pools[k]) if (r.on && !r.hidden && r.behind) out[k]++; }
        return out;
      },
      /** Live instances per kind in the front meshes (glass: true, in the glass meshes). */
      meshCounts: (glass = false) => (sys.meshes ? sys.meshes.counts(glass) : null),
      /** This frame's glass lanes (render.js glassLanes): per kind lane, in view, in front, hidden. */
      lanes: () => ({ lanes: { ...(sys._lanes || {}) }, seen: { ...(sys._seen || {}) }, front: { ...(sys._front || {}) }, hide: { ...(sys._hide || {}) } }),
      /**
       * Probes: how many pairs of school i's fish sit one over another on the screen right now (the
       * smaller one's box more than a quarter covered; S12's measure, through the real camera).
       */
      fishStacked(i = 0) {
        const sc = sys.schools[i], cam = sys.game.camera;
        if (!sc || !sc.on || !cam) return null;
        const g = sys.meshes ? sys.meshes.k.fish.geo : null;
        if (g && !g.boundingBox) g.computeBoundingBox();
        const bb = g ? g.boundingBox : { min: { x: -0.27, y: -0.3, z: -0.6 }, max: { x: 0.27, y: 0.36, z: 0.34 } };
        const rects = [], v = new THREE.Vector3();
        for (let a = 0; a < PER_SCHOOL; a++) {
          const f = sys.pools.fish[i * PER_SCHOOL + a];
          if (!f.on || f.hidden || f.state === 'skip') continue;
          const R = [Infinity, Infinity, -Infinity, -Infinity], c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
          for (let k = 0; k < 8; k++) {
            const lx = (k & 1 ? bb.max.x : bb.min.x) * f.scale, ly = (k & 2 ? bb.max.y : bb.min.y) * f.scale, lz = (k & 4 ? bb.max.z : bb.min.z) * f.scale;
            v.set(f.x + lx * c + lz * sn, f.y + ly, f.z - lx * sn + lz * c).project(cam);
            R[0] = Math.min(R[0], v.x); R[1] = Math.min(R[1], v.y); R[2] = Math.max(R[2], v.x); R[3] = Math.max(R[3], v.y);
          }
          if (v.z < 1) rects.push(R);
        }
        let pairs = 0;
        for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
          const A = rects[a], B = rects[b];
          const ix = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), iy = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
          if (ix <= 0 || iy <= 0) continue;
          if (ix * iy > 0.25 * Math.min((A[2] - A[0]) * (A[3] - A[1]), (B[2] - B[0]) * (B[3] - B[1]))) pairs++;
        }
        return pairs;
      },
      corrupt(kind = 'dolphin') {
        const r = sys.pools[kind].find((q) => q.on && q.state !== 'ride');
        if (!r) return false;
        r.x = NaN;
        return true;
      },
      atSea: () => sys.atSea(),
      session: () => ({ ...sys.session }),
    };
  }
}
