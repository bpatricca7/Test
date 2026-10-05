// Friends' avatars in the world (docs/MULTIPLAYER.md §7 "Friends' avatars", §11.6, §14).
//
// Every page draws the OTHER players from their presence: position p [x, y, z, yaw] (feet;
// the seat when sitting; the mattress when sleeping; the saddle when riding), state st, look
// lk (packLook), name nm, emote em [name, n], phrase ph [id, n] and the held treat hi.
//
// - One avatar per friend: game.createAvatar(unpackLook(lk), { fx: null }) (~33 draw calls),
//   hidden beyond 64 blocks, animation frozen beyond 32 blocks, name tags only within 22.
// - Smooth motion: samples go into a small ring per friend (no per-frame allocations) and
//   are shown 150 ms late, interpolated; a big jump (teleport, a new snapshot) snaps.
// - Poses from st: walk/stand, swim, fly, sit, sleep, ride, emote and zip-line hold (the
//   hanging pose of the zip line, blended over the avatar's own pose).
// - A name tag in the player's color (seat colors), a phrase bubble for 4 s (the phrase text
//   comes from THIS page's table; the id is all that travelled), a treat in her hand.
// - The car, van or boat she drives (presence vh, docs/teams/vehicles.md §8.2): the same live
//   model as hers (game.vehicles.remoteModel), under her seat; she sits in it; her honks play
//   here within 24 blocks.
// - No collisions and no picking: friends are pictures of where the others are.

import * as THREE from 'three';
import { nameTagSprite, disposeSprite, toScreen } from '../things/pets/kit.js';
import { hasFoodModel, foodModel } from '../things/food-models.js';
import { disposeObject } from '../core/models.js';
import { EMOTES } from '../player/wardrobe-data.js';
import { unpackLook } from './codec.js';
import { HELD_KEY_RE, parseVehiclePresence, parseSeaRide, parseSeaTrick } from './protocol.js';
import { sanitizeName } from './names.js';
import { phraseText, phraseIcon, PHRASES } from './pictures.js';

export const INTERP_DELAY = 150; // ms
export const AVATAR_HIDE = 64; // blocks
export const ANIM_FREEZE = 32;
export const TAG_HIDE = 22;
const LOOK_MIN_INTERVAL = 1000;
const BUBBLE_S = 4;
const RING = 12;
const SNAP_DIST = 6; // blocks between two samples: a teleport, not a walk
const EMOTE_NAMES = new Set(EMOTES.map((e) => e.key));

/** Player colors by seat (0 = the host). Name tags, the Players list and the HUD use them. */
export const SEAT_COLORS = ['#FF5FA2', '#3AAEF0', '#22BF95', '#9C7BFF'];
export const seatColor = (seat) => SEAT_COLORS[(seat | 0) % SEAT_COLORS.length];

const angleLerp = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/**
 * A new Object3D of the treat for a held item key, posed for a hand: the Shops team's own
 * model (game.treats.model: the same candy or ice cream she sees in her own hand), else a
 * basket food's model; null for a key this page cannot draw (nothing goes in the hand).
 */
export function heldModel(game, key) {
  try {
    if (game.treats && typeof game.treats.model === 'function') {
      const m = game.treats.model(key);
      if (m) return m;
    }
    if (/^squishg?_/.test(key) && game.squish && typeof game.squish.model === 'function') return game.squish.model(key);
  } catch (err) {
    console.warn('[net] treat model failed', key, err);
  }
  const k = String(key).replace(/^food:/, '');
  return hasFoodModel(k) ? foodModel(k) : null;
}

/** The zip line's hanging pose (src/things/outdoor/zipline.js 'hang'), blended by w. */
function hangPose(av, t, w) {
  const b = av.bones;
  if (!b || !b.armL) return;
  const set = (bone, x, y, z) => {
    if (!bone) return;
    const r = bone.rotation;
    r.x += (x - r.x) * w;
    r.y += (y - r.y) * w;
    r.z += (z - r.z) * w;
  };
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
}

class Friend {
  constructor(sys, peer) {
    this.sys = sys;
    this.peer = peer;
    this.seat = 0;
    this.host = false;
    this.uid = null;
    this.name = '';
    this.color = SEAT_COLORS[0];
    this.avatar = null;
    this.lk = null;
    this.lkWant = null;
    this.lkAt = -Infinity;
    this.tag = null;
    this.tagText = '';
    this.tagColor = '';
    this.st = 'w';
    this.stSeen = null; // merfolk: the last letter seen, for the sea-form sparkle
    this.stateRef = null;
    this.emN = null;
    this.phN = null;
    this.held = null;
    this.heldKey = null;
    // sample ring: t, x, y, z, yaw, jump per entry
    this.ring = new Float64Array(RING * 6);
    this.head = 0;
    this.count = 0;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.seen = false;
    this.visible = false;
    this.bornAt = performance.now();
    this.t = 0;
    this.bubble = null;
    this.bubbleLeft = 0;
    this.vh = null; // parsed presence vh: [key, color, flags, honk, src]
    this.vhKey = null;
    this.vehicle = null; // RemoteVehicle (src/things/vehicles/remote.js)
    this.honkN = null;
    this.sr = null; // ocean: presence sr, the dolphin she rides (palette index) or null
    this.sk = undefined; // ocean: presence sk, her trick counter (undefined until the first presence)
  }

  push(now, p) {
    const k = this.head * 6;
    const r = this.ring;
    let jump = 0;
    if (this.count > 0) {
      const l = ((this.head + RING - 1) % RING) * 6;
      if (Math.abs(r[l + 1] - p[0]) + Math.abs(r[l + 2] - p[1]) + Math.abs(r[l + 3] - p[2]) > SNAP_DIST) jump = 1;
    }
    r[k] = now;
    r[k + 1] = p[0];
    r[k + 2] = p[1];
    r[k + 3] = p[2];
    r[k + 4] = p[3];
    r[k + 5] = jump;
    this.head = (this.head + 1) % RING;
    if (this.count < RING) this.count++;
  }

  /** Interpolated position and yaw at time `t` (ms) into this.pos / this.yaw. */
  sample(t) {
    const r = this.ring;
    const n = this.count;
    if (n === 0) return false;
    const idx = (i) => ((this.head - n + i + RING) % RING) * 6; // i = 0 oldest
    const first = idx(0), last = idx(n - 1);
    if (n === 1 || t <= r[first]) {
      const k = n === 1 ? last : first;
      this.pos.set(r[k + 1], r[k + 2], r[k + 3]);
      this.yaw = r[k + 4];
      return true;
    }
    if (t >= r[last]) {
      this.pos.set(r[last + 1], r[last + 2], r[last + 3]);
      this.yaw = r[last + 4];
      return true;
    }
    for (let i = n - 1; i > 0; i--) {
      const b = idx(i), a = idx(i - 1);
      if (r[a] <= t) {
        if (r[b + 5]) {
          // a teleport between the two: no sliding across the world
          this.pos.set(r[b + 1], r[b + 2], r[b + 3]);
          this.yaw = r[b + 4];
          return true;
        }
        const span = r[b] - r[a];
        const f = span > 0 ? (t - r[a]) / span : 1;
        this.pos.set(r[a + 1] + (r[b + 1] - r[a + 1]) * f, r[a + 2] + (r[b + 2] - r[a + 2]) * f, r[a + 3] + (r[b + 3] - r[a + 3]) * f);
        this.yaw = angleLerp(r[a + 4], r[b + 4], f);
        return true;
      }
    }
    return true;
  }
}

export class RemotePlayers {
  constructor(game, net) {
    this.game = game;
    this.net = net;
    this.friends = new Map(); // peer -> Friend
    this.group = new THREE.Group();
    this.group.name = 'remote-players';
    this._rosterAt = -Infinity;
    this._liveAt = 0;
    this._hideTags = false;
    this._camPos = new THREE.Vector3();
    this._at = { x: 0, y: 0 };
    this._myBubble = null;
    this._myBubbleLeft = 0;
    this._lastState = 'idle';
    this._wallAt = 0;
    this._wdt = 0;
    this._gone = new Map(); // uid -> when her avatar left (a reload comes back "is back!")
    this._hushed = new Set(); // peers sent home: the host's own card already said goodbye
    game.events.on('world:load', () => {
      if (!this.group.parent) game.scene.add(this.group);
    });
    game.events.on('world:unload', () => this.clear());
    game.events.on('thumbnail:before', () => {
      this._hideTags = true;
      for (const f of this.friends.values()) if (f.tag) f.tag.visible = false;
    });
    game.events.on('thumbnail:after', () => { this._hideTags = false; });
    game.events.on('net:state', (s) => {
      const live = s.state === 'h.live' || s.state === 'g.live';
      if (live && !(this._lastState === 'h.live' || this._lastState === 'g.live' || this._lastState === 'g.waiting' || this._lastState === 'g.loading')) this._liveAt = performance.now();
      if (s.state === 'g.loading' && this._lastState !== 'g.live' && this._lastState !== 'g.waiting') this._liveAt = performance.now();
      this._lastState = s.state;
      if (s.state === 'idle') this.clear();
    });
  }

  /** No "went home" toast for this peer (the host sent her home and already said so). */
  hush(peer) {
    if (peer) this._hushed.add(peer);
  }

  /** Remote friend by peer id (tests, the Players panel). */
  get(peer) {
    return this.friends.get(peer) || null;
  }

  /**
   * Where the friends are drawn now: [{ peer, seat, name, pos, visible, st, held, inHand }]
   * (inHand: the name of the model in her avatar's hand, e.g. 'treat:treat_lollipop').
   */
  list() {
    return Array.from(this.friends.values(), (f) => ({
      peer: f.peer, seat: f.seat, name: f.name, color: f.color, pos: [f.pos.x, f.pos.y, f.pos.z], yaw: f.yaw,
      visible: f.visible, st: f.st, held: f.heldKey, inHand: f.avatar && f.avatar.held ? f.avatar.held.name || 'held' : null,
      bubble: f.bubbleLeft > 0 ? f.bubbleText : null,
      tag: !!(f.tag && f.tag.visible), emote: f.avatar ? f.avatar.emoting || null : null,
      lk: f.lk,
      sea: f.avatar ? f.avatar.seaParts() : null,
      vehicle: f.vh ? f.vh[0] : null,
      seaRide: f.sr,
    }));
  }

  /** The friend driving the vehicle that was parked with this uid (her vh src), or null. */
  vehicleOf(uid) {
    if (!uid) return null;
    for (const f of this.friends.values()) if (f.vh && f.vh[4] === uid) return { peer: f.peer, seat: f.seat, name: f.name };
    return null;
  }

  clear() {
    for (const f of this.friends.values()) this._drop(f);
    this.friends.clear();
    this._hideMyBubble();
  }

  // ---------- per frame ----------

  update(dt) {
    const g = this.game;
    const s = this.net.session;
    const inWorld = g.mode === 'play' && !!g.world && !g.loading;
    const live = s && (s.state === 'h.live' || s.state === 'g.live' || s.state === 'g.waiting');
    // bubbles are UI (like toasts): they last 4 s of real time, even when frames are slow
    const now = performance.now();
    this._wdt = this._wallAt ? Math.min(1, (now - this._wallAt) / 1000) : 0;
    this._wallAt = now;
    if (!inWorld || !live) {
      if (this.friends.size) this.clear();
      this._updateMyBubble(this._wdt);
      return;
    }
    if (!this.group.parent) g.scene.add(this.group);
    if (now - this._rosterAt > 120) {
      this._rosterAt = now;
      this._roster(now);
    }
    const t = s.transport;
    const peers = t ? t.peers() : null;
    const cam = g.camera.position;
    const renderT = now - INTERP_DELAY;
    for (const f of this.friends.values()) {
      let entry = null;
      if (peers) for (let k = 0; k < peers.length; k++) if (peers[k].id === f.peer) { entry = peers[k]; break; }
      if (entry && entry.state !== f.stateRef) this._ingest(f, entry.state, now);
      this._frame(f, dt, renderT, cam);
    }
    this._updateMyBubble(this._wdt);
  }

  /** Who is in the session (not me): add and remove friends. */
  _roster(now) {
    const players = this.net.session.players();
    const seen = new Set();
    const uids = new Set();
    for (const pl of players) {
      if (pl.you || !pl.peer) continue;
      seen.add(pl.peer);
      if (pl.uid) uids.add(pl.uid);
      let f = this.friends.get(pl.peer);
      // a friend still on her way (knocking, or her world is loading: `rx`) has no avatar
      // here yet; her position is not in this world (it may be her own world's)
      if (!f && !pl.host && pl.state && (pl.state.kn === 1 || (pl.state.rx && typeof pl.state.rx === 'object'))) continue;
      if (!f) {
        f = new Friend(this, pl.peer);
        this.friends.set(pl.peer, f);
      }
      f.seat = pl.seat | 0;
      f.host = !!pl.host;
      f.uid = pl.uid || null;
      f.color = seatColor(f.seat);
      f.away = !!pl.away;
    }
    for (const [peer, f] of this.friends) {
      if (seen.has(peer)) continue;
      // a page that reloaded comes back as a new peer with the same uid: no goodbye for that,
      // and the host's own comings and goings have their own cards
      const back = f.uid && uids.has(f.uid);
      const hushed = this._hushed.delete(peer);
      if (f.seen && f.avatar && !f.host && !back && !hushed && now - this._liveAt > 2500) {
        this.game.celebrate([f.pos.x, f.pos.y + 1, f.pos.z], 'sparkle');
        this.game.toast(`${f.name || 'Your friend'} went home.`, { icon: 'players', duration: 3000 });
      }
      if (f.uid) this._gone.set(f.uid, now);
      this._drop(f);
      this.friends.delete(peer);
    }
  }

  /** New presence for a friend: samples, look, name, emote, phrase, treat. */
  _ingest(f, st, now) {
    f.stateRef = st;
    const p = st.p;
    if (Array.isArray(p) && p.length >= 4 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]) && Number.isFinite(p[3])) {
      const r = f.ring;
      const l = ((f.head + RING - 1) % RING) * 6;
      if (f.count === 0 || r[l + 1] !== p[0] || r[l + 2] !== p[1] || r[l + 3] !== p[2] || r[l + 4] !== p[3]) f.push(now, p);
    }
    f.st = typeof st.st === 'string' ? st.st.slice(0, 1) : 'w';
    // merfolk: turning into (or out of) sea form sparkles on our page too (remote avatars have
    // no fx). The first presence, or any while the avatar is not built, only records the letter,
    // so a late joiner or a friend coming into range never sparkles for nothing.
    if (f.stSeen === null || !f.avatar) f.stSeen = f.st;
    else if (f.st !== f.stSeen) {
      const was = f.stSeen;
      f.stSeen = f.st;
      if ((was === 'm') !== (f.st === 'm') && this.game.particles && this.game.camera &&
        f.pos.distanceTo(this.game.camera.position) < ANIM_FREEZE) {
        this.game.particles.emit('sparkle', { x: f.pos.x, y: f.pos.y + 0.6, z: f.pos.z }, { count: 12 });
      }
    }
    const nm = sanitizeName(typeof st.nm === 'string' ? st.nm : '', 'Friend');
    if (nm !== f.name) f.name = nm;
    if (typeof st.lk === 'string' && st.lk !== f.lkWant) f.lkWant = st.lk;
    // emotes and phrases: play each NEW nonce. The first presence we see only tells what she
    // did before we arrived (nothing yet is -1), so her very first wave still shows.
    const em = Array.isArray(st.em) && st.em.length >= 2 ? st.em : null;
    const ph = Array.isArray(st.ph) && st.ph.length >= 2 ? st.ph : null;
    if (f.emN === null) f.emN = em ? em[1] : -1;
    else if (em && em[1] !== f.emN) {
      f.emN = em[1];
      const name = em[0];
      if (typeof name === 'string' && EMOTE_NAMES.has(name) && f.avatar) f.avatar.playEmote(name);
    }
    if (f.phN === null) f.phN = ph ? ph[1] : -1;
    else if (ph && ph[1] !== f.phN) {
      f.phN = ph[1];
      const id = ph[0];
      if (Number.isInteger(id) && id >= 0 && id < PHRASES.length) this._say(f, id);
    }
    const hi = typeof st.hi === 'string' && HELD_KEY_RE.test(st.hi) ? st.hi : null;
    if (hi !== f.heldKey) this._setHeld(f, hi);
    this._setVehicle(f, parseVehiclePresence(st.vh));
    // ocean: her dolphin ride, and a trick beside her when her counter changes (the first value
    // a page sees only sets it: a late joiner never replays old tricks)
    f.sr = parseSeaRide(st.sr);
    const sk = parseSeaTrick(st.sk);
    if (f.sk !== undefined && sk !== null && sk !== f.sk && this.game.ocean) this.game.ocean.remoteTrick(f.peer, sk, f.pos.x, f.pos.y, f.pos.z);
    f.sk = sk;
  }

  /** Her vehicle from presence vh: a new model when the key or color changes; honks. */
  _setVehicle(f, vh) {
    const g = this.game;
    const key = vh ? vh[0] + ':' + vh[1] : null;
    if (key !== f.vhKey) {
      this._dropVehicle(f);
      f.vhKey = key;
      if (vh && g.vehicles && typeof g.vehicles.remoteModel === 'function') {
        try {
          f.vehicle = g.vehicles.remoteModel(vh);
        } catch (err) {
          console.warn('[net] friend vehicle failed', err);
          f.vehicle = null;
        }
        if (f.vehicle) {
          f.vehicle.object3d.name = 'friend-vehicle:' + f.peer;
          this.group.add(f.vehicle.object3d);
        }
      }
    }
    f.vh = vh;
    // a new honk nonce: her horn (the first presence we see only tells the count so far)
    if (!vh) f.honkN = null;
    else if (f.honkN === null) f.honkN = vh[3];
    else if (vh[3] !== f.honkN) {
      f.honkN = vh[3];
      if (g.vehicles && typeof g.vehicles.remoteHonk === 'function' && g.player) {
        g.vehicles.remoteHonk(vh[0], f.pos.distanceTo(g.player.position));
      }
    }
  }

  _dropVehicle(f) {
    if (!f.vehicle) return;
    if (f.vehicle.object3d.parent) f.vehicle.object3d.parent.remove(f.vehicle.object3d);
    f.vehicle.dispose();
    f.vehicle = null;
  }

  _frame(f, dt, renderT, cam) {
    const g = this.game;
    if (f.count === 0) return;
    // the avatar appears once her look is known (or after a moment with the default look)
    if (!f.avatar) {
      if (f.lkWant === null && performance.now() - f.bornAt < 1500) return;
      this._build(f);
    } else if (f.lkWant !== null && f.lkWant !== f.lk && performance.now() - f.lkAt > LOOK_MIN_INTERVAL) {
      f.lk = f.lkWant;
      f.lkAt = performance.now();
      try {
        f.avatar.setLook(unpackLook(f.lk, f.name));
      } catch (err) {
        console.warn('[net] friend look failed', err);
      }
    }
    f.prev.copy(f.pos);
    f.sample(renderT);
    const moved = f.seen ? f.pos.distanceTo(f.prev) : 0;
    if (!f.seen) {
      f.seen = true;
      f.prev.copy(f.pos);
      // a friend who arrives after we are playing: a sparkle burst and a hello
      const now = performance.now();
      if (now - this._liveAt > 2500) {
        g.celebrate([f.pos.x, f.pos.y + 1, f.pos.z], 'sparkle');
        const left = f.uid ? this._gone.get(f.uid) : undefined;
        const again = left !== undefined && now - left < 3 * 60 * 1000;
        // the host of the world she just flew into is not "here": she already heard "You're
        // in Lily's world!"; and the host coming back has its own card
        if (!f.host) g.toast(again ? `${f.name || 'Your friend'} is back!` : `${f.name || 'A friend'} is here!`, { icon: 'players', color: 'mint' });
      }
    }
    const inst = dt > 0 ? Math.min(12, moved / dt) : 0;
    f.speed += (inst - f.speed) * Math.min(1, dt * 10);
    if (moved > SNAP_DIST) f.speed = 0;
    const av = f.avatar;
    const grp = av.group;
    const dist = f.pos.distanceTo(cam);
    const show = dist < AVATAR_HIDE;
    f.visible = show;
    grp.visible = show;
    grp.position.copy(f.pos);
    grp.rotation.y = f.yaw;
    f.t += dt;
    // in a car or a boat she sits on its seat ('h' without vh is still a pony ride)
    const seated = f.st === 'h' && !!f.vehicle;
    const seaRide = f.st === 'h' && f.sr != null && !f.vehicle && !f.away;                        // ocean (a page gone quiet: no dolphin)
    if (f.vehicle) f.vehicle.update(dt, f.pos.x, f.pos.y, f.pos.z, f.yaw, f.speed, f.vh ? f.vh[2] : 0, show);
    if (g.ocean) g.ocean.remoteRide(f.peer, seaRide ? f.sr : null, f.pos.x, f.pos.y, f.pos.z, f.yaw, f.speed, show); // ocean (every frame, also when frozen)
    if (show && dist < ANIM_FREEZE) {
      const st = f.st;
      const sea = st === 'm' || seaRide;                                                          // merfolk
      const inLiquid = st === 'm' && g.physics ? g.physics.liquidAt(f.pos.x, f.pos.y + 0.6, f.pos.z) : false; // merfolk
      av.update(dt, {
        speed: st === 's' || st === 'z' || st === 'h' || st === 'l' ? 0 : f.speed,               // unchanged (C5)
        onGround: st !== 'f' && st !== 'i' && st !== 'l' && st !== 'm',                          // merfolk adds 'm'
        swimming: st === 'i' || inLiquid,                                                         // merfolk
        flying: st === 'f',
        sitting: st === 's' || seated,
        sleeping: st === 'z',
        riding: st === 'h' && !seated,
        seaRide,                                                                                  // ocean
        sea,                                                                                      // merfolk
        seaFloat: inLiquid && !g.physics.liquidAt(f.pos.x, f.pos.y + 1.3, f.pos.z),               // merfolk: head out
      });
      // a held treat raises her arm in avatar.update (hidden while she sleeps or swims)
      if (st === 'l') hangPose(av, f.t, 1);
    }
    // name tag in her color, above her head (lower when sitting or lying down)
    if (!f.tag || f.tagText !== f.name || f.tagColor !== f.color) this._makeTag(f);
    if (f.tag) {
      const st = f.st;
      const top = st === 'z' ? 0.95 : st === 's' || st === 'h' ? 1.6 : st === 'l' ? 1.25 : st === 'm' ? 1.7 : 2.12;
      f.tag.position.set(0, top, 0);
      f.tag.visible = show && !this._hideTags && dist < TAG_HIDE;
    }
    if (f.bubbleLeft > 0) this._placeBubble(f, this._wdt);
  }

  _build(f) {
    const g = this.game;
    f.lk = f.lkWant;
    f.lkAt = performance.now();
    let look;
    try {
      look = f.lk ? unpackLook(f.lk, f.name) : g.defaultLook;
    } catch {
      look = g.defaultLook;
    }
    f.avatar = g.createAvatar(look, { fx: null });
    f.avatar.group.name = 'friend:' + f.peer;
    f.avatar.group.userData.netPeer = f.peer;
    this.group.add(f.avatar.group);
    if (f.heldKey) this._setHeld(f, f.heldKey, true);
  }

  _makeTag(f) {
    if (f.tag) {
      disposeSprite(f.tag);
      f.tag = null;
    }
    if (!f.avatar) return;
    f.tagText = f.name;
    f.tagColor = f.color;
    f.tag = nameTagSprite(f.name || 'Friend', f.color);
    f.tag.name = 'friend-tag';
    f.avatar.group.add(f.tag);
  }

  /** The treat in her hand (presence hi): the real model through the avatar's hold() hook. */
  _setHeld(f, key, force = false) {
    if (!force && key === f.heldKey) return;
    f.heldKey = key;
    this._letGo(f);
    if (!key || !f.avatar || typeof f.avatar.hold !== 'function') return;
    const m = heldModel(this.game, key);
    if (!m) return;
    m.userData.netHeld = key;
    f.avatar.hold(m, 'hold');
    f.held = m;
  }

  _letGo(f) {
    if (!f.held) return;
    if (f.avatar && typeof f.avatar.hold === 'function' && f.avatar.held === f.held) f.avatar.hold(null);
    if (f.held.parent) f.held.parent.remove(f.held);
    disposeObject(f.held);
    f.held = null;
  }

  _drop(f) {
    if (this.game.ocean) this.game.ocean.remoteRide(f.peer, null); // ocean: her dolphin goes too
    this._letGo(f);
    this._dropVehicle(f);
    if (f.tag) {
      disposeSprite(f.tag);
      f.tag = null;
    }
    if (f.avatar) {
      this.group.remove(f.avatar.group);
      f.avatar.dispose();
      f.avatar = null;
    }
    if (f.bubble) {
      f.bubble.remove();
      f.bubble = null;
    }
  }

  // ---------- phrase bubbles (DOM, over the head) ----------

  _bubbleEl(color) {
    const ui = this.game.ui;
    const e = ui.el('div', 'sw-net-say');
    e.style.setProperty('--c', color);
    ui.hudLayer.appendChild(e);
    return e;
  }

  _fillBubble(e, id, name) {
    const p = PHRASES[id];
    e.innerHTML = '';
    const ic = this.game.ui.el('span', 'sw-net-say-ic');
    ic.innerHTML = phraseIcon(id);
    ic.style.color = p.color;
    const who = this.game.ui.el('b', 'sw-net-say-who', name);
    e.append(ic, this.game.ui.el('span', 'sw-net-say-text', p.text));
    if (name) e.prepend(who);
    e.classList.remove('sw-on');
    void e.offsetWidth;
    e.classList.add('sw-on');
  }

  _say(f, id) {
    const text = phraseText(id);
    if (!text) return;
    if (!f.bubble) f.bubble = this._bubbleEl(f.color);
    f.bubble.style.setProperty('--c', f.color);
    this._fillBubble(f.bubble, id, f.name);
    f.bubbleText = text;
    f.bubbleLeft = BUBBLE_S;
    this.game.audio.play('pop', { pitch: 1.3 });
    if (typeof this.game.speak === 'function') this.game.speak(`${f.name} says ${text}`);
  }

  _placeBubble(f, dt) {
    f.bubbleLeft -= dt;
    const e = f.bubble;
    if (!e) return;
    if (f.bubbleLeft <= 0) {
      e.classList.remove('sw-on');
      return;
    }
    const st = f.st;
    const top = st === 'z' ? 1.25 : st === 's' || st === 'h' ? 1.95 : st === 'm' ? 2.0 : 2.45;
    const s = f.visible ? toScreen(this.game, f.pos.x, f.pos.y + top, f.pos.z, this._at) : null;
    this._position(e, s);
  }

  _position(e, s) {
    if (!s || this.game.paused) {
      e.style.visibility = 'hidden';
      return;
    }
    e.style.visibility = '';
    const W = this.game.container.clientWidth, H = this.game.container.clientHeight;
    const w = e.offsetWidth || 160, h = e.offsetHeight || 50;
    const x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, s.x));
    const y = Math.max(h + 8, Math.min(H - 90, s.y));
    e.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h)}px)`;
  }

  /** My own phrase (what she said shows over her head too). */
  sayMine(id) {
    const g = this.game;
    if (!phraseText(id)) return;
    if (!this._myBubble) this._myBubble = this._bubbleEl(seatColor(this._mySeat()));
    this._myBubble.style.setProperty('--c', seatColor(this._mySeat()));
    this._fillBubble(this._myBubble, id, '');
    this._myBubbleLeft = BUBBLE_S;
    g.audio.play('pop', { pitch: 1.2 });
  }

  _mySeat() {
    const me = this.net.session.players().find((p) => p.you);
    return me ? me.seat | 0 : 0;
  }

  _updateMyBubble(dt) {
    const e = this._myBubble;
    if (!e || this._myBubbleLeft <= 0) return;
    this._myBubbleLeft -= dt;
    if (this._myBubbleLeft <= 0 || !this.game.player) {
      e.classList.remove('sw-on');
      return;
    }
    const p = this.game.player.position;
    const st = this.game.player.state;
    const top = st === 'sleep' ? 1.25 : st === 'sit' || st === 'ride' ? 1.95 : 2.45;
    this._position(e, toScreen(this.game, p.x, p.y + top, p.z, this._at));
  }

  _hideMyBubble() {
    this._myBubbleLeft = 0;
    if (this._myBubble) this._myBubble.classList.remove('sw-on');
  }

  /** Draw calls the friends add (debug). */
  drawCalls() {
    let n = 0;
    this.group.traverseVisible((o) => { if (o.isMesh || o.isSprite) n++; });
    return n;
  }
}
