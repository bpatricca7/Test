// One friend: an avatar (game.createAvatar) with a physics body and a small brain. She wanders
// near her home spot, waves and says hi when the player comes close, chats, follows when
// invited ("Come with me!"), stays put, mirrors the player's emotes, sits on sofas and chairs,
// sleeps in a free bed at night, and eats treats she is given.
//
// Activities: idle | walk | toSeat | sit | toBed | sleep. Modes: home | follow | stay.

import * as THREE from 'three';
import { angleDelta } from '../../core/util.js';
import { normalizeLook } from '../../player/wardrobe-data.js';
import { disposeObject } from '../../core/models.js';
import { friendDef, FRIENDS } from './looks.js';

const GRAVITY = 24;
export const HALF_W = 0.28;
export const HEIGHT = 1.62;
const TELEPORT_DIST = 24;
const TAU = Math.PI * 2;
// follow slots: beside and a little behind her, left and right
const SLOTS = [1.05, -1.05, 1.75, -1.75, 2.35, -2.35];
// emotes in the multiplayer motion sample (index; see netSample)
const NET_EMOTES = ['wave', 'dance', 'twirl', 'cartwheel', 'jump', 'heart', 'sit'];

export class Friend {
  constructor(sys, data) {
    this.sys = sys;
    this.game = sys.game;
    const g = this.game;
    this.id = data.id;
    this.def = friendDef(data.key) || FRIENDS[0];
    this.key = this.def.key;
    this.name = String(data.name || this.def.name).slice(0, 18);
    this.look = normalizeLook({ ...(data.look || this.def.look), name: this.name });
    this.avatar = g.createAvatar(this.look);
    this.group = this.avatar.group;
    this.group.name = 'friend:' + this.key;
    this.pos = this.group.position;
    this.pos.set(data.x || 0, data.y || 0, data.z || 0);
    this.vel = new THREE.Vector3();
    this.yaw = data.yaw || 0;
    this.group.rotation.y = this.yaw;
    this.body = { pos: this.pos, vel: this.vel, halfW: HALF_W, height: HEIGHT, onGround: false };
    this.mode = data.mode === 'follow' || data.mode === 'stay' ? data.mode : 'home';
    this.home = Array.isArray(data.home) ? data.home.slice(0, 3) : [this.pos.x, this.pos.y, this.pos.z];
    this.metAt = data.metAt || Date.now();

    this.act = 'idle';
    this.target = new THREE.Vector3();
    this.moving = false;
    this.run = false;
    this.slow = false;
    this.slot = 0;
    this.onGround = false;
    this.swimming = false;
    this.hs = 0;
    this.seat = null; // { uid, idx, x, y, z, yaw, front } while going to / sitting on a seat
    this.bed = null; // same for a bed ({ ground: true } when sleeping under the stars)
    this.actT = 0; // seconds in the current activity
    this.sitLeft = 0;
    this.nextSeatT = 8 + Math.random() * 12;
    this.idleLeft = 1 + Math.random() * 3;
    this.thinkT = Math.random();
    this.greetT = 99; // seconds since she last said hi
    this.emoteLeft = 0;
    this.pendingEmote = null;
    this.pendingT = 0;
    this.faceT = 0; // seconds left turning toward the player
    this.attention = 0; // seconds left standing still for her (the bubble is open)
    this.stuckT = 0;
    this.progT = 0;
    this.progX = this.pos.x;
    this.progZ = this.pos.z;
    this.detourT = 0;
    this.detourSign = 1;
    this.farT = 0;
    this.eatT = 0;
    this.food = null;
    this.eatW = 0;
    this.biteT = 0;
    this.recent = [];
    this.visible = true;
    this.inView = true;
    this.lastGreet = -1e9;

    this.box = new THREE.Box3();
    this.pickable = {
      object3d: this.group,
      kind: 'other',
      ref: this,
      box: this.box,
      onUse: () => sys.tap(this),
      onRemove: () => sys.tickle(this),
      onBuild: (gm, hit, item) => sys.onBuild(this, item),
      hint: (gm) => sys.hintFor(this, gm),
    };
    this._updateBox();
  }

  // ---------- helpers ----------

  get busy() {
    return this.act === 'sit' || this.act === 'sleep' || this.act === 'toBed' || this.eatT > 0;
  }

  get awake() {
    return this.act !== 'sleep';
  }

  distToPlayer() {
    const p = this.game.player;
    if (!p) return Infinity;
    const dx = p.position.x - this.pos.x, dz = p.position.z - this.pos.z, dy = p.position.y - this.pos.y;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Keys of furniture within a few blocks (for chat). */
  nearbyKeys(r = 6) {
    const E = this.game.entities;
    if (!E) return [];
    const out = new Set();
    const x0 = Math.floor(this.pos.x), y0 = Math.floor(this.pos.y), z0 = Math.floor(this.pos.z);
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dy = -1; dy <= 2; dy++) {
          const e = E.at(x0 + dx, y0 + dy, z0 + dz);
          if (e) out.add(e.key);
        }
      }
    }
    return [...out];
  }

  moveTo(x, y, z, run = false, slow = false) {
    this.target.set(x, y, z);
    this.moving = true;
    this.run = run;
    this.slow = slow;
  }

  stop() {
    this.moving = false;
  }

  teleport(x, y, z, fx = true) {
    const g = this.game;
    if (fx) g.celebrate([this.pos.x, this.pos.y + 1, this.pos.z], 'sparkle', { quiet: true });
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.stuckT = 0;
    this.progX = x;
    this.progZ = z;
    this.moving = false;
    if (fx) g.celebrate([x, y + 1, z], 'star', { quiet: true, count: 10 });
  }

  teleportNear(x, y, z, rMin = 1.2, rMax = 2.4) {
    const s = this.sys.findSpot(x, y, z, rMin, rMax);
    if (s) this.teleport(s[0], s[1], s[2]);
    else this.teleport(x, y + 0.05, z);
  }

  faceYaw(yaw, dt, rate = 6) {
    this.yaw += angleDelta(this.yaw, yaw) * Math.min(1, rate * dt);
  }

  facePlayer(dt, rate = 6) {
    const p = this.game.player;
    if (!p) return;
    this.faceYaw(Math.atan2(p.position.x - this.pos.x, p.position.z - this.pos.z), dt, rate);
  }

  /** Play an emote (wave, dance, twirl, cartwheel, jump, heart, sit). */
  emote(name, delay = 0) {
    if (this.act === 'sleep' || this.act === 'sit' || this.act === 'toBed') return false;
    if (delay > 0) {
      this.pendingEmote = name;
      this.pendingT = delay;
      return true;
    }
    this.stop();
    this.vel.x = 0;
    this.vel.z = 0;
    this.emoteLeft = this.avatar.playEmote(name) || 2;
    // for friends' pages (multiplayer): the last emote and a counter
    const ei = NET_EMOTES.indexOf(name);
    if (ei >= 0) this.netEmote = ((this.netEmote >> 3) + 1) * 8 + ei;
    return true;
  }

  say(kind, extra) {
    return this.sys.say(this, kind, extra);
  }

  setLook(look) {
    this.look = normalizeLook({ ...look, name: this.name });
    this.avatar.setLook(this.look);
  }

  // ---------- multiplayer puppet (a friend's page shows the host's friend) ----------

  /**
   * The motion sample for the host's presence: [h, x*20, y*20, z*20, yaw*100, st, line, emo];
   * st 'w' walk / stand, 's' sit, 'z' sleep, 'i' swim; line -1 (speech is not sent in v1);
   * emo = counter * 8 + emote index (0 = none yet).
   */
  netSample() {
    const st = this.act === 'sit' ? 's' : this.act === 'sleep' ? 'z' : this.swimming ? 'i' : 'w';
    const p = this.pos;
    return [this.h | 0, Math.round(p.x * 20), Math.round(p.y * 20), Math.round(p.z * 20), Math.round(this.yaw * 100), st, -1, this.netEmote | 0];
  }

  setNetTarget(s) {
    let t = this.netTarget;
    if (!t) {
      t = this.netTarget = { x: 0, y: 0, z: 0, yaw: 0, st: 'w', emo: 0, fresh: true };
      this._emoSeen = s[7] | 0; // do not replay the emote she did before we came
    }
    t.x = s[1] / 20;
    t.y = s[2] / 20;
    t.z = s[3] / 20;
    t.yaw = s[4] / 100;
    t.st = typeof s[5] === 'string' ? s[5] : 'w';
    t.emo = s[7] | 0;
  }

  /** Per frame on a friend's page: glide toward the host's latest sample, pose, emote. */
  puppet(dt, animate) {
    const t = this.netTarget;
    const p = this.pos;
    this.greetT += dt;
    if (t) {
      const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (t.fresh || d > 8) {
        t.fresh = false;
        p.set(t.x, t.y, t.z);
        this.yaw = t.yaw;
        this.hs = 0;
      } else {
        const k = 1 - Math.exp(-dt * 10);
        p.x += dx * k;
        p.y += dy * k;
        p.z += dz * k;
        const hs = dt > 0 ? (Math.hypot(dx, dz) * k) / dt : 0;
        this.hs += (hs - this.hs) * Math.min(1, dt * 8);
        if (this.faceT <= 0 || this.emoteLeft > 0) this.yaw += angleDelta(this.yaw, t.yaw) * Math.min(1, dt * 10);
      }
      const act = t.st === 's' ? 'sit' : t.st === 'z' ? 'sleep' : 'idle';
      if (act !== this.act) {
        this.act = act;
        if (act !== 'idle') {
          this.emoteLeft = 0;
          if (this.avatar.stopEmote) this.avatar.stopEmote();
        }
      }
      this.swimming = t.st === 'i';
      this.onGround = true;
      if (t.emo !== this._emoSeen) {
        this._emoSeen = t.emo;
        const name = NET_EMOTES[t.emo & 7];
        if (name && act === 'idle') this.emoteLeft = this.avatar.playEmote(name) || 2;
      }
    }
    if (this.faceT > 0) {
      this.faceT -= dt;
      if (this.act === 'idle' && this.hs < 0.3 && this.emoteLeft <= 0) this.facePlayer(dt, 5);
    }
    if (this.emoteLeft > 0) this.emoteLeft -= dt;
    this.group.rotation.y = this.yaw;
    if (animate) {
      this.avatar.update(dt, {
        speed: this.emoteLeft > 0 && this.hs < 1.6 ? 0 : this.hs,
        onGround: this.onGround,
        swimming: this.swimming,
        flying: false,
        sitting: this.act === 'sit',
        sleeping: this.act === 'sleep',
        riding: false,
      });
    }
    this._updateBox();
  }

  // ---------- seats & beds ----------

  standUp(fx = false) {
    const s = this.seat || this.bed;
    if (this.seat) this.sys.release(this.seat);
    if (this.bed && !this.bed.ground) this.sys.release(this.bed);
    this.seat = null;
    this.bed = null;
    if (this.act === 'sit' || this.act === 'sleep' || this.act === 'toSeat' || this.act === 'toBed') {
      const wasDown = this.act === 'sit' || this.act === 'sleep';
      this.act = 'idle';
      if (wasDown && s) {
        const spot = s.front ? this.sys.findSpot(s.front[0] + 0.5, s.front[1], s.front[2] + 0.5, 0, 1.6) : null;
        const spot2 = spot || this.sys.findSpot(this.pos.x, this.pos.y, this.pos.z, 0.8, 2.2);
        if (spot2) this.pos.set(spot2[0], spot2[1], spot2[2]);
        this.vel.set(0, 0, 0);
        if (fx) this.game.celebrate([this.pos.x, this.pos.y + 1, this.pos.z], 'sparkle', { quiet: true, count: 5 });
      }
    }
    this.actT = 0;
  }

  goSit(seat) {
    this.stop();
    this.seat = seat;
    this.act = 'toSeat';
    this.actT = 0;
  }

  goBed(bed) {
    this.stop();
    this.bed = bed;
    this.act = 'toBed';
    this.actT = 0;
  }

  _settle(spot, act) {
    this.pos.set(spot.x, spot.y, spot.z);
    this.vel.set(0, 0, 0);
    this.yaw = spot.yaw;
    this.act = act;
    this.actT = 0;
    this.moving = false;
    this.emoteLeft = 0;
    this.avatar.stopEmote && this.avatar.stopEmote();
  }

  sleepNow() {
    if (this.bed) this._settle(this.bed, 'sleep');
  }

  wake() {
    if (this.act !== 'sleep' && this.act !== 'toBed') return false;
    this.standUp(true);
    return true;
  }

  // ---------- treats ----------

  eat(key, model) {
    this.dropFood();
    this.food = model;
    this.food.userData.key = key;
    // in her right hand (the forearm bone), a little forward of the fingers
    this.food.position.set(0, -0.25, 0.06);
    this.food.scale.setScalar(0.92);
    this.avatar.bones.elbowR.add(this.food);
    this.eatT = 3.4;
    this.biteT = 0.9;
    this.stop();
    this.emoteLeft = 0;
  }

  dropFood() {
    if (!this.food) return;
    if (this.food.parent) this.food.parent.remove(this.food);
    disposeObject(this.food);
    this.food = null;
  }

  // ---------- per frame ----------

  update(dt, animate) {
    this.actT += dt;
    this.greetT += dt;
    if (this.faceT > 0) {
      this.faceT -= dt;
      if (this.act === 'idle' && !this.moving && this.emoteLeft <= 0) this.facePlayer(dt, 5);
    }
    if (this.pendingEmote) {
      this.pendingT -= dt;
      if (this.pendingT <= 0) {
        const n = this.pendingEmote;
        this.pendingEmote = null;
        this.emote(n);
      }
    }
    if (this.emoteLeft > 0) this.emoteLeft -= dt;
    this._think(dt);
    if (this.act === 'sit' || this.act === 'sleep') {
      this.vel.set(0, 0, 0);
      this.hs = 0;
      this.onGround = true;
    } else {
      this._move(dt);
    }
    this.group.rotation.y = this.yaw;
    this._eatTick(dt);
    if (animate) {
      this.avatar.update(dt, {
        // a little nudge (making room for her) never cancels a dance
        speed: this.emoteLeft > 0 && this.hs < 1.6 ? 0 : this.hs,
        onGround: this.onGround,
        swimming: this.swimming,
        flying: false,
        sitting: this.act === 'sit',
        sleeping: this.act === 'sleep',
        riding: false,
      });
      this._eatPose();
    }
    this._updateBox();
  }

  _eatTick(dt) {
    if (this.eatT > 0) {
      this.eatT -= dt;
      this.eatW = Math.min(1, this.eatW + dt * 4);
      this.biteT -= dt;
      if (this.biteT <= 0 && this.food) {
        this.biteT = 0.8;
        this.sys.bite(this);
      }
      if (this.eatT <= 0) this.sys.doneEating(this);
    } else {
      this.eatW = Math.max(0, this.eatW - dt * 4);
    }
  }

  /** Lift the treat to her mouth (after the avatar posed her arm this frame). */
  _eatPose() {
    if (this.eatW > 0.001) {
      const b = this.avatar.bones, w = this.eatW;
      const nib = this.eatT > 0 ? Math.max(0, Math.sin(this.eatT * 7.8)) * 0.18 : 0;
      b.armR.rotation.x += (-1.05 - nib) * w;
      b.armR.rotation.z += -0.25 * w;
      b.elbowR.rotation.x += -1.25 * w;
    }
  }

  _think(dt) {
    const sys = this.sys, g = this.game, pl = g.player;
    // ----- eating: stand still, smile at her -----
    if (this.eatT > 0) {
      this.stop();
      if (pl && this.act !== 'sit') this.facePlayer(dt, 5);
      return;
    }
    // ----- sitting -----
    if (this.act === 'sit') {
      this.sitLeft -= dt;
      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        this.thinkT = 0.8;
        if (!sys.spotValid(this.seat)) return this.standUp(true);
        if (sys.playerOn(this.seat)) {
          this.standUp(true);
          this.say('seatTaken');
          return;
        }
        if (this.mode === 'follow' && this.distToPlayer() > 6) return this.standUp(true);
        if (sys.isNight() && this.mode !== 'follow') return this.standUp(false);
      }
      if (this.sitLeft <= 0) this.standUp(true);
      return;
    }
    // ----- sleeping -----
    if (this.act === 'sleep') {
      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        this.thinkT = 1;
        if (!sys.isNight() && !(pl && pl.state === 'sleep')) return this.wake();
        if (this.bed && !this.bed.ground && !sys.spotValid(this.bed)) return this.standUp(true);
        if (this.bed && sys.playerOn(this.bed)) {
          this.standUp(true);
          this.say('seatTaken');
          return;
        }
      }
      sys.zzz(this, dt);
      return;
    }
    // ----- going to a seat / bed -----
    if (this.act === 'toSeat' || this.act === 'toBed') {
      const s = this.act === 'toSeat' ? this.seat : this.bed;
      if (!s || (!s.ground && !sys.spotValid(s)) || (this.act === 'toBed' && !sys.isNight() && !(pl && pl.state === 'sleep'))) {
        this.standUp(false);
        return;
      }
      if (s.ground) {
        this._settle(s, 'sleep');
        return;
      }
      const fx = s.front[0] + 0.5, fz = s.front[2] + 0.5;
      const dx = fx - this.pos.x, dz = fz - this.pos.z;
      const near = dx * dx + dz * dz < 0.8 && Math.abs(this.pos.y - s.front[1]) < 1.6;
      const direct = (s.x - this.pos.x) ** 2 + (s.z - this.pos.z) ** 2 < 1.4;
      if (near || direct || this.actT > 12) {
        if (sys.playerOn(s)) {
          this.standUp(false);
          return;
        }
        if (this.actT > 12) g.celebrate([this.pos.x, this.pos.y + 1, this.pos.z], 'sparkle', { quiet: true });
        this._settle(s, this.act === 'toSeat' ? 'sit' : 'sleep');
        if (this.act === 'sit') {
          this.sitLeft = 14 + Math.random() * 20;
          g.celebrate([s.x, s.y + 0.4, s.z], 'sparkle', { quiet: true, count: 5 });
          if (Math.random() < 0.5) this.say('seat');
        } else {
          sys.onFriendSleep(this);
        }
        return;
      }
      this.moveTo(fx, s.front[1], fz, this.actT > 4);
      return;
    }

    // ----- an emote in progress, or she is talking to us: stand still -----
    if (this.emoteLeft > 0) {
      this.stop();
      return;
    }
    if (this.attention > 0) {
      this.attention -= dt;
      this.stop();
      this.facePlayer(dt, 5);
      return;
    }

    // ----- bedtime -----
    this.thinkT -= dt;
    const night = sys.isNight();
    if (this.thinkT <= 0) {
      this.thinkT = 1.2 + Math.random() * 0.8;
      const plSleeps = pl && pl.state === 'sleep';
      if ((night && this.mode !== 'follow') || (plSleeps && this.distToPlayer() < 20)) {
        const bed = sys.findBed(this);
        if (bed) {
          this.goBed(bed);
          return;
        }
        if (night && this.mode === 'home' && this.actT > 6) {
          // no free bed: a cozy nap under the stars near home
          const spot = sys.groundBed(this);
          if (spot) {
            this.bed = spot;
            this._settle(spot, 'sleep');
            sys.onFriendSleep(this);
            return;
          }
        }
      }
    }

    // ----- greeting -----
    if (pl && this.greetT > 40 && pl.state !== 'sleep') {
      const d = this.distToPlayer();
      if (d < 4.2 && performance.now() - sys.lastGreetAt > 2500) {
        this.greetT = 0;
        sys.lastGreetAt = performance.now();
        this.faceT = 2.5;
        this.emote('wave');
        this.say('greet');
        return;
      }
    }

    if (this.mode === 'stay') {
      this.stop();
      if (pl && this.distToPlayer() < 9) this.facePlayer(dt, 3);
      return;
    }

    let ax, ay, az;
    if (this.mode === 'home') {
      [ax, ay, az] = this.home;
      const dx = ax - this.pos.x, dz = az - this.pos.z;
      if (dx * dx + dz * dz > 40 * 40 || this.pos.y < -4) {
        this.teleportNear(ax, ay, az, 0.2, 1.6);
        return;
      }
      if (dx * dx + dz * dz > 7 * 7) {
        this.moveTo(ax, ay, az, false);
        return;
      }
    } else if (pl) {
      // follow: beside her, a little behind
      const p = pl.position;
      ax = p.x; ay = p.y; az = p.z;
      const dx = p.x - this.pos.x, dy = p.y - this.pos.y, dz = p.z - this.pos.z;
      const d2 = dx * dx + dz * dz, d3 = Math.sqrt(d2 + dy * dy);
      this.farT = d3 > 10 ? this.farT + dt : 0;
      if (d3 > TELEPORT_DIST || this.pos.y < -4 || (this.farT > 6 && d3 > 10)) {
        this.farT = 0;
        let gy = p.y;
        if (pl.flying || pl.state === 'ride') {
          const h = g.world.heightAt(Math.floor(p.x), Math.floor(p.z));
          if (h >= 0) gy = Math.min(p.y, h + 1);
        }
        this.teleportNear(p.x, gy, p.z, 1.4, 2.6);
        return;
      }
      const d = Math.sqrt(d2);
      const far = 2.9 + (this.slot % 3) * 0.3;
      if (d > far || (this.moving && this.run && d > 2.2)) {
        const ang = pl.yaw + Math.PI + SLOTS[this.slot % SLOTS.length];
        const r = 1.9 + Math.floor(this.slot / SLOTS.length) * 1.2;
        this.moveTo(p.x + Math.sin(ang) * r, p.y, p.z + Math.cos(ang) * r, d > 6);
        return;
      }
    } else return;

    // ----- idle near the anchor -----
    if (this.moving) return;
    if (pl && (this.faceT > 0 || this.distToPlayer() < 6)) this.facePlayer(dt, 3);
    this.idleLeft -= dt;
    this.nextSeatT -= dt;
    if (this.idleLeft > 0) return;
    this.idleLeft = 2.5 + Math.random() * 4.5;
    const r = Math.random();
    if (this.nextSeatT <= 0 && !night) {
      this.nextSeatT = 20 + Math.random() * 25;
      const seat = sys.findSeat(this, this.mode === 'home' ? 9 : 5);
      if (seat) {
        this.goSit(seat);
        return;
      }
    }
    const pets = this.game.pets;
    const pet = r < 0.3 && pets ? pets.nearest(this.pos.x, this.pos.y, this.pos.z, 3.5) : null;
    if (pet && !pet.riding && pet.state !== 'sleep') {
      // a pet nearby gets some love
      sys.lovePet(this, pet);
    } else if (this.mode === 'home' && r < 0.55) {
      const ang = Math.random() * TAU, rad = 1 + Math.random() * 4;
      this.moveTo(ax + Math.sin(ang) * rad, ay, az + Math.cos(ang) * rad, false, true);
    } else if (r < 0.7) {
      this.emote(['twirl', 'jump', 'wave', 'heart'][Math.floor(Math.random() * 4)]);
    }
  }

  _move(dt) {
    const g = this.game, ph = g.physics;
    if (!ph) return;
    const v = this.vel, p = this.pos;
    let wx = 0, wz = 0, speed = 0;
    if (this.moving) {
      const dx = this.target.x - p.x, dz = this.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3) {
        this.moving = false;
      } else {
        speed = (this.run ? 5.4 : this.slow ? 2.1 : 3.6) * Math.min(1, dist / 0.8 + 0.35);
        wx = dx / dist;
        wz = dz / dist;
        if (this.detourT > 0) {
          this.detourT -= dt;
          const a = this.detourSign * 1.3, c = Math.cos(a), s = Math.sin(a);
          const nx = wx * c - wz * s, nz = wx * s + wz * c;
          wx = nx; wz = nz;
        }
      }
    }
    // keep a little space from other friends and from her
    let sx = 0, sz = 0;
    for (const o of this.sys.friends) {
      if (o === this || o.act === 'sit' || o.act === 'sleep') continue;
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-6 && Math.abs(p.y - o.pos.y) < 1.5) {
        const d = Math.sqrt(d2);
        sx += (dx / d) * (0.8 - d);
        sz += (dz / d) * (0.8 - d);
      }
    }
    const pl = g.player;
    if (pl && pl.state !== 'sit' && pl.state !== 'sleep') {
      const dx = p.x - pl.position.x, dz = p.z - pl.position.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.81 && d2 > 1e-6 && Math.abs(p.y - pl.position.y) < 1.5) {
        const d = Math.sqrt(d2);
        sx += (dx / d) * (0.9 - d);
        sz += (dz / d) * (0.9 - d);
      }
    }
    const inWater = ph.liquidAt(p.x, p.y + 0.9, p.z) || (this.swimming && ph.liquidAt(p.x, p.y + 0.3, p.z));
    this.swimming = inWater;
    if (inWater) speed *= 0.65;
    const tvx = wx * speed + sx * 3, tvz = wz * speed + sz * 3;
    const k = Math.min(1, (this.onGround || inWater ? 10 : 4) * dt);
    v.x += (tvx - v.x) * k;
    v.z += (tvz - v.z) * k;
    if (inWater) {
      const fy = p.y + 1.15;
      if (ph.liquidAt(p.x, fy, p.z)) {
        const top = Math.floor(fy) + 1;
        const depth = ph.liquidAt(p.x, top + 0.5, p.z) ? 1 : top - fy;
        v.y += (Math.min(2.2, 0.15 + depth * 5) - v.y) * Math.min(1, 6 * dt);
      } else v.y -= 10 * dt;
      v.y = Math.max(-3, Math.min(3, v.y));
    } else {
      v.y = Math.max(v.y - GRAVITY * dt, -30);
    }
    const res = ph.move(this.body, dt, { step: true });
    this.onGround = res.onGround;
    if (speed > 0.2 && res.ledge !== null && res.onGround) v.y = 8.2;
    if (inWater && res.hitWall && speed > 0.2) v.y = 7.4;
    // stuck? hop, then sidestep, then pop over to where she wanted to go
    if (speed > 0.6) {
      this.progT += dt;
      if (this.progT > 0.7) {
        const moved = Math.hypot(p.x - this.progX, p.z - this.progZ);
        this.stuckT = moved < 0.3 ? this.stuckT + this.progT : 0;
        this.progT = 0;
        this.progX = p.x;
        this.progZ = p.z;
      }
      if (this.stuckT > 0.6 && res.onGround && res.hitWall) v.y = 8.2;
      if (this.stuckT > 1.8 && this.detourT <= 0) {
        this.detourT = 1.1;
        this.detourSign = Math.random() < 0.5 ? -1 : 1;
      }
      if (this.stuckT > 5) {
        this.stuckT = 0;
        const t = this.target;
        this.teleportNear(t.x, t.y, t.z, 0, 1.2);
      }
    } else {
      this.stuckT = 0;
      this.progT = 0;
    }
    if (p.y < -6) {
      const [hx, hy, hz] = this.home;
      if (this.mode === 'follow' && pl) this.teleportNear(pl.position.x, pl.position.y, pl.position.z);
      else this.teleportNear(hx, hy + 1, hz, 0, 1.5);
    }
    this.hs = Math.hypot(v.x, v.z);
    if (this.hs > 0.4 && this.moving) this.faceYaw(Math.atan2(v.x, v.z), dt, 9);
  }

  _updateBox() {
    const p = this.pos;
    if (this.act === 'sleep') {
      this.box.min.set(p.x - 0.5, p.y - 0.1, p.z - 0.5);
      this.box.max.set(p.x + 0.5, p.y + 0.45, p.z + 0.5);
    } else if (this.act === 'sit') {
      this.box.min.set(p.x - 0.32, p.y - 0.1, p.z - 0.32);
      this.box.max.set(p.x + 0.32, p.y + 1.25, p.z + 0.32);
    } else {
      this.box.min.set(p.x - 0.32, p.y, p.z - 0.32);
      this.box.max.set(p.x + 0.32, p.y + 1.78, p.z + 0.32);
    }
  }

  serialize() {
    const r = (v) => Math.round(v * 100) / 100;
    // a sleeping or sitting friend is saved standing next to her seat
    let { x, y, z } = this.pos;
    const s = this.seat || this.bed;
    if ((this.act === 'sit' || this.act === 'sleep') && s && s.front) {
      x = s.front[0] + 0.5; y = s.front[1] + 0.01; z = s.front[2] + 0.5;
    }
    return {
      id: this.id, key: this.key, name: this.name, look: this.look, mode: this.mode,
      x: r(x), y: r(y), z: r(z), yaw: r(this.yaw), home: this.home.map(r), metAt: this.metAt,
    };
  }

  dispose() {
    this.dropFood();
    if (this.seat) this.sys.release(this.seat);
    if (this.bed && !this.bed.ground) this.sys.release(this.bed);
    this.avatar.dispose();
  }
}

