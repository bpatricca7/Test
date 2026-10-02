// Cars, vans and boats she can drive (wave 3, docs/teams/vehicles.md).
//
// - Nine vehicles in a new Bag tab "Cars & Boats". Parked, each is ordinary furniture
//   (entities.define: saved with the world, journaled to friends, Remove, Undo, careful
//   friends); a Hand tap runs the entity action 'drive'.
// - Driving lifts the entity out of the world (no Undo entry) and builds a live model that
//   carries her: player.state stays 'ride' with a vehicle mount (player.mount). The system
//   moves the car (drive.js) and THEN seats her, so she never lags behind it.
// - Getting out puts the entity back (same uid when allowed, on whole cells, a quarter turn).
//   Nothing is ever lost: every save holds the car she drives as a parked record
//   (systems.vehicles.away); when nothing fits, the car is placed anyway (force).
// - Lights, a horn (Space / the Honk button), Get out (E or X / the button), the engine.
// - Friends see the car under her avatar through the presence field `vh` (remote.js); the host
//   keeps custody of a car a friend drives (src/net/host.js).

import * as THREE from 'three';
import { ITEM_CATEGORIES, SHAPES } from '../../core/registry.js';
import { rotXZ } from '../entities.js';
import { lifeHud } from '../pets/kit.js';
import { VEHICLES } from './defs.js';
import { bubbleCar, convertible, jeep, kart } from './models-cars.js';
import { roadTripVan, iceCreamVan } from './models-vans.js';
import { speedboat, swanBoat, sailboat } from './models-boats.js';
import { partsOf } from '../furniture/kit.js';
import { Drive, angleDelta, waterTopAt } from './drive.js';
import { findParkSpot, bottomCells, isLandSpot, isWaterSpot, centerFromAnchor } from './park.js';
import { LiveModel } from './live.js';
import { WakeRibbon } from './fx.js';
import { RemoteVehicle } from './remote.js';
import { createVehicleSfx } from './sfx.js';
import { installVehicleStickers } from './stickers.js';

const TAB = 'vehicles';
const BUILD = {
  car_bubble: bubbleCar, car_convertible: convertible, car_jeep: jeep, car_kart: kart,
  van_camper: roadTripVan, van_icecream: iceCreamVan,
  boat_speed: speedboat, boat_swan: swanBoat, boat_sail: sailboat,
};
const HOST_RANGE = 1e6; // the host's own uids (docs/MULTIPLAYER.md §5.2)
const TOAST_GAP = 6000; // ms between two of the same driving toasts
const SWIM_CONFIRM = 4000; // ms: the second Get out on open water within this lets her swim
const PLAN_CACHE = 1000; // ms: a save's park plan is reused this long
const HONK_GAP = 0.6; // s between two honks (a presence send each)
const LIGHTS_AUTO = 0.55; // daylight under this: the lamps come on by themselves
const CAM_HOLD = 1.0; // s after she turned the view herself before the chase camera helps

const fin = Number.isFinite;
const clone = (v) => (v === undefined || v === null ? {} : JSON.parse(JSON.stringify(v)));

export function install(game) {
  const E = game.entities;
  if (!E) return;
  const sys = new VehicleSystem(game);

  // ---------- the Bag tab (after Shops; else after Fun & Toys) ----------
  if (!ITEM_CATEGORIES.some(([id]) => id === TAB)) {
    let at = ITEM_CATEGORIES.findIndex(([id]) => id === 'shops');
    if (at < 0) at = ITEM_CATEGORIES.findIndex(([id]) => id === 'fun');
    ITEM_CATEGORIES.splice(at >= 0 ? at + 1 : ITEM_CATEGORIES.length, 0, [TAB, 'Cars & Boats']);
  }

  // ---------- the fleet ----------
  for (const v of VEHICLES) {
    const def = E.define({
      key: v.key, name: v.name, category: TAB, size: v.size, colors: v.colors,
      build: (color, data) => BUILD[v.key](color, data),
      colliders: v.colliders,
      actions: ['drive'],
      defaultData: {},
      vehicle: v.vehicle,
      // a parked boat bobs on the water (its whole model is the 'hull' part)
      update: v.vehicle.water ? bobUpdate : undefined,
    });
    sys.defs.set(v.key, def);
    const item = game.registry.items.get('furn:' + v.key);
    if (item) item.use = (g, hit, opts) => sys.placeFromHit(def, hit, opts && opts.color);
  }
  E.registerAction('drive', {
    run: (g, entity) => sys.drive(entity),
    hint: (g, entity) => (entity.def.vehicle && entity.def.vehicle.hint) || 'Tap to drive!',
  });

  game.addSystem({
    name: 'vehicles',
    onWorldLoad: () => sys.onWorldLoad(),
    onWorldUnload: () => sys.onWorldUnload(),
    update: (dt) => sys.update(dt),
    serialize: () => sys.serialize(),
    deserialize: (data) => sys.deserialize(data),
  });

  sys.award = installVehicleStickers(game);
  sys.installControls();
  game.vehicles = sys.facade();
  if (game.debug) game.debug.vehicles = sys.debugApi();
}

/** Parked boats bob a little (and turn a hair) on the water, each in its own rhythm. */
const _bob = new THREE.Vector3();
function bobUpdate(entity, dt, game) {
  const hull = partsOf(entity).hull;
  if (!hull) return;
  const t = (game.time ? game.time.t : 0) + (entity.uid % 17) * 0.37;
  const rz = 0.03 * Math.sin(t * 1.3), rx = 0.02 * Math.sin(t * 1.7);
  const [w, , d] = entity.def.size;
  // turn about the hull's middle at the waterline, not about the model's corner
  const cx = w / 2, cy = 0.85, cz = d / 2;
  hull.rotation.set(rx, 0, rz);
  _bob.set(cx, cy, cz).applyEuler(hull.rotation);
  hull.position.set(cx - _bob.x, cy - _bob.y + 0.04 * Math.sin(t * 2.1), cz - _bob.z);
}

class VehicleSystem {
  constructor(game) {
    this.game = game;
    this.defs = new Map(); // key -> furniture def (vehicles only)
    this.current = null; // the drive in progress (see drive())
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    this.sfx = createVehicleSfx(game);
    this.award = () => {};
    this.hud = null;
    this._toastAt = new Map();
    this._honkN = 0;
    this._honkAt = -Infinity;
    this._jumpWas = false;
    this._firstTip = new Set();
    this._swimAsk = -Infinity;
    this._plan = null; // { at, rec, stand } cached for saves
    this._v = new THREE.Vector3();
    this._w = { x: 0, y: 0, z: 0 };
    this._remotes = new Set();
    this.stats = { remoteHonks: 0, remoteModels: 0 };
  }

  // =====================================================================================
  // placing (Build tool)
  // =====================================================================================

  _ctx() {
    const g = this.game, E = g.entities, w = g.world;
    const props = g.registry.blocks.props;
    return {
      canPlace: (def, x, y, z, rot) => E.canPlace(def, x, y, z, rot, null, { players: false }),
      liquid: (x, y, z) => props.shape[w.get(x, y, z)] === SHAPES.liquid,
      solid: (x, y, z) => props.solid[w.get(x, y, z)] === 1,
    };
  }

  _toast(key, text, gap = TOAST_GAP) {
    const now = performance.now();
    if (now - (this._toastAt.get(key) ?? -Infinity) < gap) return;
    this._toastAt.set(key, now);
    this.game.toast(text, { icon: 'star' });
  }

  /**
   * Build tool with a vehicle: the nose points away from her (pushing forward drives away from
   * the camera) and the rear row is the tapped cell. Cars go on land, boats on the top water.
   */
  placeFromHit(def, hit, color) {
    const g = this.game, E = g.entities, w = g.world;
    if (!hit || !hit.place || !w) return false;
    if (this.current) {
      this._toast('build', 'Park first to build!', 1500);
      return false;
    }
    const props = g.registry.blocks.props;
    const ctx = this._ctx();
    let [x, y, z] = hit.place;
    if (hit.type === 'block' && (props.replaceable[hit.id] && props.shape[hit.id] !== SHAPES.liquid)) [x, y, z] = [hit.x, hit.y, hit.z];
    const water = !!def.vehicle.water;
    if (water) {
      // climb to the top water cell (Build aims through water)
      if (!ctx.liquid(x, y, z) && ctx.liquid(x, y - 1, z)) y--;
      if (!ctx.liquid(x, y, z)) {
        g.toast('Boats go on water! Tap the water.', { icon: 'star' });
        return false;
      }
      const top = waterTopAt(g.physics, w, x + 0.5, y, z + 0.5);
      if (top >= 0) y = top;
    } else if (ctx.liquid(x, y, z) || ctx.liquid(x, y - 1, z)) {
      g.toast('Cars go on land!', { icon: 'star' });
      return false;
    }
    const p = g.player ? g.player.position : g.camera.position;
    const dx = p.x - (x + 0.5), dz = p.z - (z + 0.5);
    const toward = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 0 : 2;
    const away = (toward + 2) % 4;
    const d = def.size[2];
    for (const r of [away, (away + 1) % 4, (away + 3) % 4, toward]) {
      const [fx, fz] = rotXZ(0, 1, r);
      // rear row on the tapped cell first; then the tapped cell in the middle, then in front
      for (const k of [d - 1, Math.floor((d - 1) / 2), 0]) {
        const ax = x + fx * k, az = z + fz * k;
        if (!E.canPlace(def, ax, y, az, r)) continue;
        const ok = water ? isWaterSpot(ctx, def.size, ax, y, az, r) : isLandSpot(ctx, def.size, ax, y, az, r);
        if (!ok) continue;
        return !!E.place(def.key, ax, y, az, r, color || null, {});
      }
    }
    g.toast('No room there!');
    return false;
  }

  // =====================================================================================
  // driving
  // =====================================================================================

  /** Her own action even when a system noticed it (a guest's recorder skips system changes). */
  _asPlayer(fn) {
    const g = this.game;
    const was = g._inSystems;
    g._inSystems = false;
    try {
      return fn();
    } finally {
      g._inSystems = was;
    }
  }

  _net() {
    const n = this.game.net;
    return n && n.active ? n : null;
  }

  /** Hand tap on a parked vehicle. Returns true when she is driving it. */
  drive(entity) {
    const g = this.game, E = g.entities, pl = g.player;
    if (!pl || !g.world || !entity || !E.byUid(entity.uid)) return false;
    const def = entity.def, v = def.vehicle;
    if (!v) return false;
    if (pl.state === 'sleep' || pl.state === 'hold') return false;
    if (this.current) {
      this._toast('park-first', 'Park first, then try again!', 1500);
      return false;
    }
    // a boat that stands on land (a friend took the water away) cannot sail
    if (v.water && !bottomCells(def.size, entity.x, entity.y, entity.z, entity.rot).every(([x, y, z]) => this._ctx().liquid(x, y, z))) {
      this._toast('boat-land', 'Boats need water! Put it on the water with Build.', 2000);
      return false;
    }
    // playing at a friend's: checks before trying, so nothing flickers in the common cases
    const net = this._net();
    if (net && net.isGuest) {
      // a visiting player who may not build (free-join, docs/ACCOUNTS.md §8.6): the relay
      // drops her outbox, so the drive would never reach the host
      const looker = !!(g.account && g.account.mode === 'visitor');
      if (looker || !net.mayEdit('build')) {
        if (typeof net.refuse === 'function') net.refuse(looker ? 'look' : 'paused');
        return false;
      }
      const rules = net.rules || null;
      if (rules && rules.mine === 0 && entity.uid < HOST_RANGE) {
        if (typeof net.refuse === 'function') net.refuse('vehicle', { noun: v.noun || 'car' });
        return false;
      }
    }
    // off the pony first, up from the chair
    if (pl.state === 'ride' && g.pets && typeof g.pets.dismount === 'function') g.pets.dismount();
    if (pl.state === 'sit') pl.stand();

    const rec = { uid: entity.uid, key: entity.key, x: entity.x, y: entity.y, z: entity.z, rot: entity.rot, color: entity.color, data: clone(entity.data) };
    const [w, , d] = def.size;
    const start = E.localToWorld(entity, w / 2, 0, d / 2, this._v);
    const yaw = entity.rot * (Math.PI / 2);
    const token = net && net.isHost && typeof net.ownerToken === 'function' ? net.ownerToken(entity.uid) : null;
    const removed = this._asPlayer(() => E.remove(entity, { history: false, events: false, fx: false }));
    if (!removed) return false;
    const drive = new Drive({ physics: g.physics, world: g.world, spec: v, pos: [start.x, v.water ? entity.y : start.y, start.z], yaw });
    const live = new LiveModel(def, rec.color);
    this.group.add(live.pivot);
    const cur = {
      def, v, key: def.key, rec, drive, live, token,
      src: rec.uid,
      lights: false, lightsTouched: false, camHold: 0, honkT: 0, revT: 0, splashT: 0, dustT: 0,
      dist: 0, pendingStand: undefined, parked: false, wake: null,
      lightItem: { object3d: live.pivot, lightPoint: [start.x, start.y + 0.6, start.z], lightCell: null, lightScale: 1.25, moving: true },
    };
    if (v.water) cur.wake = new WakeRibbon(this.group);
    cur.mount = this._mount(cur);
    this.current = cur;
    this._plan = null;
    this._jumpWas = true; // a Jump held from before is not a honk
    E.extraLights.add(cur.lightItem);
    live.setPose(drive.pos.x, drive.pos.y, drive.pos.z, drive.yaw);
    pl.mount(cur.mount);
    this._seat(cur);
    const rig = g.cameraRig;
    if (rig) {
      rig.yaw = yaw;
      rig.extraWant = fin(v.cam) ? v.cam : 1.5;
    }
    // first night drive: the lamps come on by themselves
    this._autoLights(cur);
    this.sfx.engineStart(v.engine);
    g.audio.play('pop', { pitch: 1.1 });
    g.celebrate([start.x, start.y + 1, start.z], 'sparkle', { quiet: true });
    this._tip(v);
    const boat = v.kind === 'boat';
    const stats = g.profile.stats || (g.profile.stats = {});
    if (boat) stats.boatRides = (stats.boatRides | 0) + 1;
    else stats.drives = (stats.drives | 0) + 1;
    g.saveProfile();
    this.award(boat ? 'ahoy' : 'beep_beep');
    g.events.emit('vehicle:drive', { key: def.key, kind: v.kind, uid: rec.uid });
    return true;
  }

  /** The first drive of each kind this session: how to steer. */
  _tip(v) {
    const boat = v.kind === 'boat';
    if (this._firstTip.has(boat)) return;
    this._firstTip.add(boat);
    const touch = this.game.input.touchMode;
    const text = touch
      ? (boat ? 'Push the joystick to steer! Tap Honk to toot! The pink button gets out.' : 'Push the joystick to drive! Tap Honk to beep! The pink button gets out.')
      : (boat ? 'Steer with W A S D! Space toots, E gets out.' : 'Drive with W A S D! Space honks, E gets out.');
    this.game.toast(text, { icon: 'star', duration: 4200 });
  }

  /** The mount object player.mount() receives (docs §4.2). */
  _mount(cur) {
    const sys = this;
    const v = cur.v, size = cur.def.size;
    return {
      kind: 'vehicle',
      key: cur.key,
      def: cur.def,
      pose: 'sit',
      seatHeight: v.seat[1],
      get object3d() { return cur.live.pivot; },
      get yaw() { return cur.drive.yaw; },
      /** The seat surface in the world (into out). */
      seatWorld(out) {
        const d = cur.drive;
        d.modelToWorld(size, v.seat[0], v.seat[1], v.seat[2], out);
        out.y += d.liftVis + (cur.live.boat ? cur.live.tilt.position.y : 0);
        return out;
      },
      overlapsCell: (x, y, z) => cur.drive.overlapsCell(x, y, z),
      /** Beside where it would park for this save (player.serialize). */
      standSpot: () => {
        const plan = sys._planFor(cur);
        return plan ? plan.stand : null;
      },
      /** Stood up by someone else (flying, a zip line): park now, say where her door is. */
      beforeStand: () => {
        if (cur.pendingStand !== undefined) return cur.pendingStand;
        sys.park({ reason: 'stand' });
        return cur.pendingStand || null;
      },
    };
  }

  /** Seat her after the car moved this frame (as pets do in syncRider). */
  _seat(cur) {
    const pl = this.game.player;
    if (!pl || pl.mountPet !== cur.mount) return;
    cur.mount.seatWorld(pl.position);
    pl.yaw = cur.drive.yaw;
    pl.velocity.set(0, 0, 0);
    if (pl.avatar) {
      pl.avatar.group.position.copy(pl.position);
      pl.avatar.group.rotation.y = pl.yaw;
    }
  }

  // =====================================================================================
  // parking
  // =====================================================================================

  /** The park spot for the live pose (land, or water for boats), bounded. */
  _spot(cur, extended = false) {
    const d = cur.drive;
    const pose = { x: d.pos.x, y: cur.v.water ? d.waterY : d.pos.y, z: d.pos.z, yaw: d.yaw };
    return findParkSpot(this._ctx(), cur.def, pose, { extended });
  }

  /** Is the record's own spot still free (and on the right ground)? */
  _recFits(rec, def) {
    const E = this.game.entities, ctx = this._ctx();
    if (!this._recValid(rec)) return false;
    if (!E.canPlace(def, rec.x, rec.y, rec.z, rec.rot, null, { players: false })) return false;
    return def.vehicle.water ? isWaterSpot(ctx, def.size, rec.x, rec.y, rec.z, rec.rot) : true;
  }

  _recValid(rec) {
    const w = this.game.world;
    return !!(rec && w && Number.isInteger(rec.x) && Number.isInteger(rec.y) && Number.isInteger(rec.z) &&
      w.inBounds(rec.x, rec.y, rec.z) && Number.isInteger(rec.rot) && rec.rot >= 0 && rec.rot <= 3);
  }

  /**
   * Where it goes when there is no choice (auto-park, saves, loading): the spot here, its old
   * spot, a wider search here and round its old spot; and when even that fails it is placed
   * anyway at its old spot (force), never deleted.
   */
  _fallbackSpot(cur) {
    let s = this._spot(cur, false);
    if (s) return s;
    if (this._recFits(cur.rec, cur.def)) return { x: cur.rec.x, y: cur.rec.y, z: cur.rec.z, rot: cur.rec.rot };
    s = this._spot(cur, true);
    if (s) return s;
    return this._searchAround(cur.def, cur.rec) || this._forceSpot(cur.def, cur.rec, cur.drive);
  }

  _searchAround(def, rec) {
    if (!this._recValid(rec)) return null;
    const [cx, cz] = centerOf(def, rec);
    return findParkSpot(this._ctx(), def, { x: cx, y: rec.y, z: cz, yaw: rec.rot * (Math.PI / 2) }, { extended: true });
  }

  /** The very last resort: its old spot (or here, on whole cells), placed with force. */
  _forceSpot(def, rec, drive) {
    if (this._recValid(rec)) return { x: rec.x, y: rec.y, z: rec.z, rot: rec.rot, force: true };
    const w = this.game.world, p = drive ? drive.pos : this.game.player.position;
    const x = Math.max(0, Math.min(w.sx - 1, Math.floor(p.x))), z = Math.max(0, Math.min(w.sz - 1, Math.floor(p.z)));
    const y = Math.max(0, Math.min(w.sy - 1, Math.floor(p.y)));
    return { x, y, z, rot: 0, force: true };
  }

  /** A save's plan for the live drive: the parked record and her stand spot (cached 1 s). */
  _planFor(cur) {
    const now = performance.now();
    if (this._plan && this._plan.cur === cur && now - this._plan.at < PLAN_CACHE) return this._plan;
    let spot = null;
    try {
      spot = this._fallbackSpot(cur);
    } catch (err) {
      console.error('[vehicles] park plan failed', err);
    }
    const s = spot || { x: cur.rec.x, y: cur.rec.y, z: cur.rec.z, rot: cur.rec.rot };
    const rec = { uid: cur.rec.uid, key: cur.key, x: s.x, y: s.y, z: s.z, rot: s.rot, color: cur.rec.color, data: clone(cur.rec.data) };
    const stand = this._doorStand(cur.def, rec);
    this._plan = { cur, at: now, rec, stand };
    return this._plan;
  }

  /** Where she steps out: beside the door side of a parked record, else the nearest spot. */
  _doorStand(def, rec) {
    const pl = this.game.player;
    if (!pl) return null;
    const v = def.vehicle;
    const [w, , d] = def.size;
    const lx = v.door < 0 ? -0.55 : w + 0.55, lz = Math.min(d - 0.5, Math.max(0.5, v.seat[2]));
    const [cx, cz] = centerOf(def, rec);
    const ox = lx - w / 2, oz = lz - d / 2;
    const c = Math.cos(rec.rot * Math.PI / 2), s = Math.sin(rec.rot * Math.PI / 2);
    const x = cx + ox * c + oz * s, z = cz - ox * s + oz * c;
    const y = v.water ? rec.y + 1 : rec.y;
    return pl.findStandSpot(x, y, z) || pl.findStandSpot(cx, y, cz);
  }

  /**
   * Get out / park. reason: 'button' | 'key' (she asked: may say "no room" and keep driving),
   * 'stand' (someone stood her up), 'auto' (her state changed under us), 'trouble'.
   */
  park({ reason = 'button' } = {}) {
    const cur = this.current;
    if (!cur || cur.parked) return false;
    const g = this.game, pl = g.player;
    const asked = reason === 'button' || reason === 'key';
    let swim = false, stand = null, spot = null;
    if (cur.v.water && asked) {
      // a boat: step out onto the shore when there is one; else ask, then swim
      stand = this._shoreSpot(cur);
      if (!stand) {
        const now = performance.now();
        if (now - this._swimAsk > SWIM_CONFIRM) {
          this._swimAsk = now;
          g.toast('Drive to the shore, or tap Get out again to swim!', { icon: 'star' });
          return false;
        }
        swim = true;
      }
    }
    spot = this._spot(cur, false);
    if (!spot && asked) {
      this._toast('no-room', `No room to park here! Drive a little more.`, 1500);
      return false;
    }
    if (!spot) spot = this._fallbackSpot(cur);
    this._swimAsk = -Infinity;
    return this._finish(cur, spot, { reason, swim, stand });
  }

  _finish(cur, spot, { reason, swim, stand }) {
    const g = this.game, E = g.entities, pl = g.player;
    cur.parked = true;
    this._teardown(cur);
    const net = this._net();
    let uid = cur.rec.uid;
    if (E.byUid(uid)) uid = null;
    if (uid && net && net.isGuest && !(uid > E.uidBase && uid < E.uidBase + HOST_RANGE)) uid = null;
    const opts = { uid: uid || E.allocUid(), history: false, events: false, fx: false, players: false, force: !!spot.force };
    let entity = this._asPlayer(() => E.place(cur.key, spot.x, spot.y, spot.z, spot.rot, cur.rec.color, clone(cur.rec.data), opts));
    if (!entity) {
      // it did not fit after all: its old spot, forced (never lost)
      const f = this._forceSpot(cur.def, cur.rec, cur.drive);
      entity = this._asPlayer(() => E.place(cur.key, f.x, f.y, f.z, f.rot, cur.rec.color, clone(cur.rec.data), { ...opts, force: true }));
    }
    if (entity && cur.token && net && typeof net.restoreOwner === 'function') net.restoreOwner(entity.uid, cur.token);
    // where she stands: the shore, the water beside the boat, or the door side
    let at = stand;
    if (!at && swim && pl) {
      const seat = cur.mount.seatWorld(this._w);
      at = this._swimSpot(cur, entity) || [seat.x, seat.y, seat.z];
    }
    if (!at && entity) at = this._doorStand(cur.def, entity);
    cur.pendingStand = at || null;
    // (reason 'stand': stand() is already running and takes pendingStand from beforeStand())
    if (pl && pl.state === 'ride' && pl.mountPet === cur.mount) pl.stand();
    // she left for a chair or a bed: no stale car under her (the HUD's Honk, the camera)
    if (pl && pl.mountPet === cur.mount) pl.mountPet = null;
    this.current = null;
    this._plan = null;
    if (entity) {
      const c = E.localToWorld(entity, cur.def.size[0] / 2, 0.6, cur.def.size[2] / 2, this._v);
      g.celebrate([c.x, c.y, c.z], 'sparkle', { quiet: true });
    }
    g.audio.play('pop');
    if (swim) this.sfx.splash(1);
    g.events.emit('vehicle:park', { entity, reason });
    return true;
  }

  /**
   * Dry land within 3 blocks of a boat's seat where she can stand (not shallow water: the
   * lagoon floor under one block of water is no shore). Bounded: 49 columns x 4 heights.
   */
  _shoreSpot(cur) {
    const g = this.game, ph = g.physics, pl = g.player;
    if (!ph || !pl) return null;
    const seat = cur.mount.seatWorld(this._w);
    if (![seat.x, seat.y, seat.z].every(fin)) return null;
    const bx = Math.floor(seat.x), bz = Math.floor(seat.z), by = cur.drive.waterY + 1;
    for (let r = 0; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (const dy of [0, 1, -1, 2]) {
            const px = bx + dx + 0.5, py = by + dy, pz = bz + dz + 0.5;
            if (ph.liquidAt(px, py + 0.1, pz) || ph.liquidAt(px, py + 0.6, pz) || ph.liquidAt(px, py - 0.5, pz)) continue;
            if (ph.bodyBlocked(px, py + 0.01, pz, pl.halfW, pl.height)) continue;
            if (!ph.bodyBlocked(px, py - 0.3, pz, pl.halfW, 0.3)) continue;
            // not on the boat itself (it is parked after this, on its water cells)
            if (cur.drive.overlapsCell(Math.floor(px), Math.floor(py), Math.floor(pz))) continue;
            return [px, py + 0.01, pz];
          }
        }
      }
    }
    return null;
  }

  /** A spot in the water beside a parked boat where she can swim. */
  _swimSpot(cur, entity) {
    const g = this.game, ph = g.physics, pl = g.player;
    if (!entity || !ph || !pl) return null;
    const [w, , d] = cur.def.size;
    for (const lx of [w + 0.55, -0.55]) {
      const p = g.entities.localToWorld(entity, lx, 0, d / 2, this._v);
      const y = entity.y + 0.2;
      if (!ph.bodyBlocked(p.x, y, p.z, pl.halfW, pl.height)) return [p.x, y, p.z];
    }
    return null;
  }

  /** Drop the live model, the engine, the light, the wake; the camera comes back. */
  _teardown(cur) {
    const g = this.game;
    this.sfx.engineStop();
    cur.lightItem.lightCell = null;
    g.entities.extraLights.delete(cur.lightItem);
    cur.live.dispose();
    if (cur.wake) cur.wake.dispose();
    cur.wake = null;
    if (g.cameraRig) g.cameraRig.extraWant = 0;
  }

  /**
   * End a drive without parking (the host put the car back, a friend drives that one, the
   * world went away): the live car vanishes in a sparkle; she stands where she is.
   */
  _drop(text = null) {
    const cur = this.current;
    if (!cur || cur.parked) return;
    const g = this.game, pl = g.player;
    cur.parked = true;
    this._teardown(cur);
    cur.pendingStand = null;
    this.current = null;
    this._plan = null;
    if (pl && pl.state === 'ride' && pl.mountPet === cur.mount) pl.stand();
    if (pl && pl.mountPet === cur.mount) pl.mountPet = null;
    const p = cur.drive.pos;
    g.celebrate([p.x, p.y + 1, p.z], 'sparkle', { quiet: true });
    if (text) g.toast(text, { icon: 'star' });
    g.events.emit('vehicle:park', { entity: null, reason: 'drop' });
  }

  // =====================================================================================
  // per frame
  // =====================================================================================

  update(dt) {
    const g = this.game;
    if (!g.world || g.mode !== 'play') return;
    const cur = this.current;
    if (!cur) return;
    const pl = g.player;
    // her state changed under us (a chair, a bed, the pony, a teleport): park where it is
    if (!pl || pl.state !== 'ride' || pl.mountPet !== cur.mount) {
      this.park({ reason: 'auto' });
      return;
    }
    if (this._netChecks(cur)) return;
    const input = g.input, rig = g.cameraRig;
    const paused = g.paused;
    const controls = paused ? null : { mx: input.move.x, mz: input.move.z, camYaw: rig ? rig.yaw : cur.drive.yaw };
    const d = cur.drive;
    d.step(paused ? 0 : dt, controls);
    if (d.trouble) {
      this.park({ reason: 'trouble' });
      g.toast(`Oops! Something got in the way. Your ${cur.v.noun || 'car'} is parked.`, { icon: 'star' });
      return;
    }
    this._events(cur, dt);
    // the picture, then her seat (after the car moved: she never lags behind it)
    const live = cur.live;
    live.setPose(d.pos.x, d.pos.y, d.pos.z, d.yaw, d.pitchVis, d.rollVis, d.liftVis, d.squash);
    live.animate(paused ? 0 : dt, d.speed);
    this._seat(cur);
    if (!paused) {
      this._honk(cur, input);
      this._chase(cur, dt);
      this._effects(cur, dt);
    }
    this._autoLights(cur);
    this.sfx.engineSpeed(paused ? 0 : Math.abs(d.speed) / (cur.v.speed || 6));
  }

  /** Bumps, water and shores: a boing and stars, friendly toasts. */
  _events(cur, dt) {
    const g = this.game, d = cur.drive;
    if (d.bumpSpeed > 0) {
      this.sfx.boing(Math.min(1, d.bumpSpeed / 6));
      const s = Math.sin(d.yaw), c = Math.cos(d.yaw), dir = d.speed >= 0 ? 1 : -1;
      const half = cur.def.size[2] / 2;
      if (g.particles) g.particles.emit('star', { x: d.pos.x + s * half * dir, y: d.pos.y + 0.9, z: d.pos.z + c * half * dir }, { count: 4, spread: 0.4 });
      g.events.emit('vehicle:bump', { speed: d.bumpSpeed });
    }
    if (d.hit === 'water') this._toast('water', "Cars can't swim! Try a boat!");
    if (d.hit === 'shore') {
      const now = performance.now();
      if (now - (this._toastAt.get('shore-splash') ?? -Infinity) > 900) {
        this._toastAt.set('shore-splash', now);
        this.sfx.splash(0.6);
      }
      this._toast('shore', 'Boats stay on the water!');
    }
    // distance (stats, whole meters)
    const moved = Math.abs(d.speed) * dt;
    if (fin(moved)) {
      cur.dist += moved;
      if (cur.dist >= 1) {
        const n = Math.floor(cur.dist);
        cur.dist -= n;
        const st = g.profile.stats || (g.profile.stats = {});
        st.driveMeters = (st.driveMeters | 0) + n;
      }
    }
  }

  /** Space or the Honk button (both press 'jump'): honk, at most every 0.6 s. */
  _honk(cur, input) {
    const down = !!input.jump;
    const edge = down && !this._jumpWas;
    this._jumpWas = down;
    if (edge) this.honk();
  }

  honk() {
    const cur = this.current;
    if (!cur) return false;
    const now = performance.now() / 1000;
    if (now - this._honkAt < HONK_GAP) return false;
    this._honkAt = now;
    this._honkN = (this._honkN + 1) % 1000;
    this.sfx.horn(cur.v.horn, 1);
    const g = this.game;
    const st = g.profile.stats || (g.profile.stats = {});
    st.honks = (st.honks | 0) + 1;
    g.events.emit('vehicle:honk', { key: cur.key });
    return true;
  }

  toggleLights() {
    const cur = this.current;
    if (!cur) return false;
    cur.lightsTouched = true;
    cur.lights = !cur.lights;
    this.sfx.click(cur.lights);
    this._applyLights(cur);
    this._refreshHud();
    return cur.lights;
  }

  _daylight() {
    const u = this.game.blockUniforms;
    const d = u && u.uDaylight ? u.uDaylight.value : 1;
    return fin(d) ? d : 1;
  }

  /** At night the lamps come on by themselves (unless she switched them off this drive). */
  _autoLights(cur) {
    if (!cur.lightsTouched) {
      const want = this._daylight() < LIGHTS_AUTO;
      if (want !== cur.lights) {
        cur.lights = want;
        this._refreshHud();
      }
    }
    this._applyLights(cur);
  }

  _applyLights(cur) {
    const dark = Math.min(1, Math.max(0, (1.05 - this._daylight()) / 0.6));
    cur.live.setLights(cur.lights, dark);
    const li = cur.lightItem;
    li.lightCell = cur.lights ? true : null;
    // the borrowed pool light sits a little in front of the bumper, so the road lights up
    const [w, , d] = cur.def.size;
    const p = cur.live.toWorld(w / 2, 0.9, d + 1.2, this._w);
    li.lightPoint[0] = p.x; li.lightPoint[1] = p.y; li.lightPoint[2] = p.z;
  }

  /**
   * The chase camera: while she drives and is not turning the view herself, the camera swings
   * round behind the vehicle (so "up" is forward), like every driving toy.
   */
  _chase(cur, dt) {
    const g = this.game, rig = g.cameraRig, input = g.input, d = cur.drive;
    if (!rig) return;
    if ((input.look && Math.abs(input.look.dx) + Math.abs(input.look.dy) > 0.5) || input.turn) cur.camHold = CAM_HOLD;
    if (cur.camHold > 0) {
      cur.camHold -= dt;
      return;
    }
    if (Math.abs(d.speed) < 0.5 || d.reversing) return;
    rig.yaw += angleDelta(rig.yaw, d.yaw) * Math.min(1, 1.8 * dt);
    if (rig.mode !== 'first') rig.pitch += (0.32 - rig.pitch) * Math.min(1, 1.5 * dt);
  }

  /** Wake and splashes for boats, dust for cars, beeps while reversing. */
  _effects(cur, dt) {
    const g = this.game, d = cur.drive, p = g.particles;
    const s = Math.sin(d.yaw), c = Math.cos(d.yaw), half = cur.def.size[2] / 2;
    const sp = Math.abs(d.speed);
    if (cur.wake) {
      if (sp > 0.8) cur.wake.push(d.pos.x - s * half, d.waterY + 0.9, d.pos.z - c * half, c, -s);
      cur.wake.update(dt);
      cur.splashT -= dt;
      if (p && sp > 1.5 && cur.splashT <= 0) {
        cur.splashT = 0.09;
        p.emit('splash', { x: d.pos.x - s * half, y: d.waterY + 0.95, z: d.pos.z - c * half }, { count: 2, spread: 0.3 });
      }
    } else if (p && d.onGround && sp > 5) {
      cur.dustT -= dt;
      if (cur.dustT <= 0) {
        cur.dustT = 0.35;
        p.emit('smoke_puff', { x: d.pos.x - s * half, y: d.pos.y + 0.15, z: d.pos.z - c * half }, { count: 1, spread: 0.2, scale: 0.6 });
      }
    }
    if (d.reversing && sp > 0.3) {
      cur.revT -= dt;
      if (cur.revT <= 0) {
        cur.revT = 0.8;
        this.sfx.reverse();
      }
    } else cur.revT = 0;
  }

  // =====================================================================================
  // playing with friends (docs §8.3)
  // =====================================================================================

  /** Guest: the host put her borrowed car back, or another friend drives it. True = ended. */
  _netChecks(cur) {
    const g = this.game, net = this._net();
    if (!net || !net.isGuest) return false;
    const E = g.entities;
    // the host refused her drive: the parked car (her src uid) is back on her page
    if (cur.src && E.byUid(cur.src)) {
      this._drop(null);
      return true;
    }
    // two players tapped the same car: the lower seat keeps it (the host is seat 0)
    const rp = net.remote;
    if (rp && typeof rp.vehicleOf === 'function') {
      const other = rp.vehicleOf(cur.src);
      if (other && other.seat < this._mySeat(net)) {
        this._drop(`${other.name || 'Your friend'} is driving that one!`);
        return true;
      }
    }
    return false;
  }

  _mySeat(net) {
    try {
      const me = net.players().find((p) => p.you);
      return me ? me.seat | 0 : 0;
    } catch {
      return 0;
    }
  }

  /** Presence field vh: [key, color, flags, honk, src] or null (docs §8.1). */
  presence() {
    const cur = this.current;
    if (!cur) return null;
    const color = typeof cur.rec.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(cur.rec.color) ? cur.rec.color.slice(1).toLowerCase() : 'ffffff';
    const flags = (cur.lights ? 1 : 0) | (cur.drive.reversing ? 2 : 0);
    const src = Number.isInteger(cur.src) && cur.src > 0 && cur.src < 2 ** 31 ? cur.src : 0;
    return [cur.key, color, flags, this._honkN, src];
  }

  /** A friend's vehicle model from her parsed vh (or null for a key this page lacks). */
  remoteModel(vh) {
    if (!Array.isArray(vh)) return null;
    const def = this.defs.get(vh[0]);
    if (!def) return null;
    const color = typeof vh[1] === 'string' && /^[0-9a-f]{6}$/.test(vh[1]) ? '#' + vh[1].toUpperCase() : (def.colors ? def.colors[0] : '#FFFFFF');
    const rv = new RemoteVehicle(this.game, def, color);
    this.stats.remoteModels++;
    this._remotes.add(rv);
    const dispose = rv.dispose.bind(rv);
    rv.dispose = () => { this._remotes.delete(rv); dispose(); };
    return rv;
  }

  /** A friend honked (a new nonce in her vh): her horn, quieter far away (none past 24). */
  remoteHonk(key, dist) {
    const def = this.defs.get(key);
    if (!def || !fin(dist) || dist > 24) return;
    this.stats.remoteHonks++;
    this.sfx.horn(def.vehicle.horn, Math.max(0.15, 1 - dist / 24));
  }

  // =====================================================================================
  // saves (docs §4.5)
  // =====================================================================================

  /** { v: 1, away: [records] }: the car she drives (parked where it would go) + custody. */
  serialize() {
    const away = [];
    const cur = this.current;
    if (cur) {
      const plan = this._planFor(cur);
      if (plan) away.push(plan.rec);
    }
    const net = this.game.net;
    if (net && typeof net.custody === 'function') {
      try {
        for (const r of net.custody()) if (r && typeof r === 'object') away.push(clone(r));
      } catch (err) {
        console.error('[vehicles] custody records failed', err);
      }
    }
    return away.length ? { v: 1, away } : undefined;
  }

  /** Put every away record back: its spot, else a search round it, else round her, else force. */
  deserialize(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.away)) return;
    const g = this.game, E = g.entities;
    for (const rec of data.away.slice(0, 64)) {
      try {
        this.placeRecord(rec);
      } catch (err) {
        console.error('[vehicles] could not put a car back', err);
      }
    }
    if (E && typeof g.unstickPlayer === 'function') g.unstickPlayer();
  }

  /**
   * Place a parked record (saves, host custody): same uid when it is free, its own spot when
   * it fits, else the nearest spot round it or round her, else forced at its spot. Returns the
   * entity or null (only for a key this page does not know).
   */
  placeRecord(rec, opts = {}) {
    const g = this.game, E = g.entities;
    if (!rec || typeof rec !== 'object') return null;
    const def = this.defs.get(rec.key);
    if (!def) return null;
    const color = typeof rec.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(rec.color) ? rec.color : null;
    const data = rec.data && typeof rec.data === 'object' ? clone(rec.data) : {};
    let uid = Number.isInteger(rec.uid) && rec.uid > 0 ? rec.uid : null;
    if (uid && E.byUid(uid)) {
      const there = E.byUid(uid);
      // already there (a save made twice): nothing to do
      if (there.key === rec.key && there.x === rec.x && there.y === rec.y && there.z === rec.z) return there;
      uid = null;
    }
    if (opts.uid && !E.byUid(opts.uid)) uid = opts.uid;
    let spot = null;
    if (this._recFits(rec, def)) spot = { x: rec.x, y: rec.y, z: rec.z, rot: rec.rot };
    if (!spot) spot = this._searchAround(def, rec);
    if (!spot && g.player) {
      const p = g.player.position;
      spot = findParkSpot(this._ctx(), def, { x: p.x, y: p.y, z: p.z, yaw: 0 }, { extended: true });
    }
    if (!spot) spot = this._forceSpot(def, rec, null);
    const place = (s, force) => E.place(def.key, s.x, s.y, s.z, s.rot, color, data, {
      uid: uid || E.allocUid(), history: false, events: false, fx: false, players: false, force,
    });
    return this._asPlayer(() => place(spot, !!spot.force) || place(this._forceSpot(def, rec, null), true));
  }

  // =====================================================================================
  // world lifecycle
  // =====================================================================================

  onWorldLoad() {
    this.current = null;
    this._plan = null;
    this._honkN = 0;
    this.game.scene.add(this.group);
  }

  /** No physical park: the save made before unloading already holds the parked record. */
  onWorldUnload() {
    const cur = this.current;
    if (cur) {
      cur.parked = true;
      this._teardown(cur);
      const pl = this.game.player;
      if (pl && pl.state === 'ride' && pl.mountPet === cur.mount) {
        pl.state = 'walk';
        pl.mountPet = null;
      }
    }
    this.current = null;
    this._plan = null;
    for (const rv of [...this._remotes]) rv.dispose();
    this.game.scene.remove(this.group);
  }

  // =====================================================================================
  // controls: keys, the life column, the tools
  // =====================================================================================

  installControls() {
    const g = this.game;
    // L = lights, E or X = get out (the pets' keys). The game's own E does nothing while she
    // drives: the tool stays Hand, and E only switches to Hand.
    g.input.on('key', (e) => {
      if (!e.down || e.repeat || !this.current || g.paused || g.mode !== 'play') return;
      if (g.ui && g.ui.dialogOpen) return;
      if (e.code === 'KeyL') this.toggleLights();
      else if (e.code === 'KeyE' || e.code === 'KeyX') this.park({ reason: 'key' });
      else if (e.code === 'Space') {
        // a quick tap can come and go between two frames: honk on the key itself, and let
        // the 'jump' press it also makes count as the same honk
        this.honk();
        this._jumpWas = true;
      }
    });
    // Build and Remove are off while she drives
    const lock = ({ tool } = {}) => {
      if (!this.current || tool === 'hand') return;
      this._toast('build', 'Park first to build!', 1500);
      g.setTool('hand');
    };
    // after the HUD's own listener, so its buttons end up showing Hand
    g.events.on('game:ready', () => g.events.on('tool:change', lock));
    g.events.on('vehicle:drive', () => { if (g.selectedTool !== 'hand') g.setTool('hand'); });
    // Undo building (a friend's page): the host reverted her car changes, the drive ends
    g.events.on('net:tidied', () => this._drop(null));
    if (!g.ui) return;
    const hud = lifeHud(g);
    this.hud = hud;
    const out = hud.add('vgetout', { icon: 'hopoff', label: 'Get out', color: 'var(--sw-pink)', order: 0, onClick: () => this.park({ reason: 'button' }) });
    out.classList.add('lf-pulse');
    hud.add('vlights', { icon: 'lights', label: 'Lights', color: 'var(--sw-sun)', order: 1, onClick: () => this.toggleLights() });
    for (const ev of ['vehicle:drive', 'vehicle:park', 'world:unload', 'world:load']) g.events.on(ev, () => this._refreshHud());
  }

  _refreshHud() {
    const hud = this.hud;
    if (!hud) return;
    const on = !!this.current;
    hud.show('vgetout', on);
    hud.show('vlights', on);
    const b = hud.button('vlights');
    if (b) b.classList.toggle('sw-active', on && this.current.lights);
  }

  // =====================================================================================
  // facade and debug
  // =====================================================================================

  facade() {
    const sys = this;
    return {
      defs: sys.defs,
      get current() { return sys.current; },
      isVehicle: (key) => sys.defs.has(key),
      drive: (entity) => sys.drive(entity),
      park: (o) => sys.park(o),
      presence: () => sys.presence(),
      remoteModel: (vh) => sys.remoteModel(vh),
      remoteHonk: (key, dist) => sys.remoteHonk(key, dist),
      placeRecord: (rec, o) => sys.placeRecord(rec, o),
      honk: () => sys.honk(),
      toggleLights: () => sys.toggleLights(),
    };
  }

  debugApi() {
    const sys = this, g = this.game;
    return {
      list: () => g.entities.all().filter((e) => sys.defs.has(e.key)).map((e) => ({ uid: e.uid, key: e.key, x: e.x, y: e.y, z: e.z, rot: e.rot, color: e.color })),
      state() {
        const cur = sys.current;
        if (!cur) return null;
        const d = cur.drive;
        return {
          key: cur.key, x: d.pos.x, y: d.pos.y, z: d.pos.z, yaw: d.yaw, speed: d.speed, onGround: d.onGround,
          water: cur.v.water ? d.waterY : null, lights: cur.lights, bumps: d.bumps, nanResets: d.nanResets, src: cur.src,
          reversing: d.reversing, hit: d.hit, free: d.poseFree(d.pos.x, d.pos.y, d.pos.z, d.yaw),
          wake: !!(cur.wake && cur.wake.mesh.visible),
        };
      },
      drive: (uid) => { const e = g.entities.byUid(uid); return e ? sys.drive(e) : false; },
      park: (reason = 'button') => sys.park({ reason }),
      honk: () => sys.honk(),
      lights: () => sys.toggleLights(),
      presence: () => sys.presence(),
      /** Test only: a broken number in the live state (the next frame must recover). */
      corrupt(field = 'x') {
        const cur = sys.current;
        if (!cur) return false;
        const d = cur.drive;
        if (field === 'x' || field === 'y' || field === 'z') d.pos[field] = NaN;
        else d[field] = NaN;
        return true;
      },
      /** Test only: end the drive without parking (the host's custody must put it back). */
      drop: () => sys._drop(null),
      /** Test setup: move the live vehicle (a test course elsewhere in the world). */
      setPose(x, y, z, yaw = 0) {
        const cur = sys.current;
        if (!cur || ![x, y, z, yaw].every(fin)) return false;
        const d = cur.drive;
        d.pos.x = x; d.pos.y = y; d.pos.z = z; d.yaw = yaw;
        d.speed = 0; d.vy = 0; d.liftVis = 0;
        if (d.boat) d.waterY = Math.floor(y);
        Object.assign(d.good, { x, y, z, yaw });
        if (g.cameraRig) g.cameraRig.yaw = yaw;
        return d.poseFree(x, y, z, yaw);
      },
      stats: () => ({ ...sys.stats }),
      plan: () => (sys.current ? sys._planFor(sys.current).rec : null),
    };
  }
}

/** Footprint centre [x, z] of a record. */
function centerOf(def, rec) {
  return centerFromAnchor(def.size, rec.x, rec.z, rec.rot);
}
