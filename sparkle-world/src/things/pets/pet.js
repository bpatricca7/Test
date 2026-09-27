// One pet: a rig, a physics body and a small brain. Follows the player with simple steering
// (hops up 1-block ledges, swims, sidesteps when stuck, teleports when lost or far), wanders
// and does little tricks when idle, sits on "Stay", sleeps in a pet bed at night, and can be
// ridden (pony / unicorn: steered with the player's own move input; unicorns fly gently).

import * as THREE from 'three';
import { SPECIES, buildRig, variantOf, petOpts } from './species.js';
import { disposeRig } from './skin.js';
import { newAnim, animate, playTrick } from './anim.js';
import { nameTagSprite, disposeSprite } from './kit.js';
import { angleDelta } from '../../core/util.js';

const GRAVITY = 24;
const TELEPORT_DIST = 24;
const TAU = Math.PI * 2;

const _box = new THREE.Box3();

export class Pet {
  constructor(sys, data) {
    this.sys = sys;
    this.game = sys.game;
    this.id = data.id;
    this.species = SPECIES[data.species] ? data.species : 'puppy';
    this.spec = SPECIES[this.species];
    this.variant = variantOf(this.species, data.variant).key;
    this.name = data.name || this.spec.names[0];
    this.mode = data.mode === 'stay' || data.mode === 'home' ? data.mode : 'follow';
    this.home = Array.isArray(data.home) ? data.home.slice(0, 3) : [data.x || 0, data.y || 0, data.z || 0];
    this.adoptedAt = data.adoptedAt || Date.now();
    this.love = data.love | 0;

    this.opts = petOpts(this.species, data.opts);
    this.rig = buildRig(this.species, this.variant, { ...this.opts, merged: true });
    this.object3d = this.rig.root;
    this.group = this.rig.root;
    this.seatHeight = this.spec.seat || 0.9;
    this.tagY = (variantOf(this.species, this.variant).tagY || this.spec.tagY) * (this.rig.scale || 1);
    this.pos = this.object3d.position;
    this.pos.set(data.x || 0, data.y || 0, data.z || 0);
    this.vel = new THREE.Vector3();
    this.yaw = data.yaw || 0;
    this.object3d.rotation.y = this.yaw;
    this.body = { pos: this.pos, vel: this.vel, halfW: this.spec.halfW, height: this.spec.height, onGround: false };
    this.anim = newAnim();

    // rest-pose extents for picking (measured at the origin)
    this.object3d.position.set(0, 0, 0);
    this.object3d.rotation.y = 0;
    this.object3d.updateMatrixWorld(true);
    // a merged rig keeps its shape in one skinned geometry (baked in root space at rest)
    if (this.rig.skinned) _box.copy(this.rig.skinned.geometry.boundingBox);
    else _box.setFromObject(this.rig.jumper);
    this.pos.set(data.x || 0, data.y || 0, data.z || 0);
    this.object3d.rotation.y = this.yaw;
    this.ext = Math.max(-_box.min.x, _box.max.x, -_box.min.z, _box.max.z, this.spec.halfW) + 0.04;
    this.top = _box.max.y + 0.04;
    this.box = new THREE.Box3();

    // brain
    this.state = 'idle'; // idle | sleep | toBed | ride
    this.moving = false;
    this.run = false;
    this.target = new THREE.Vector3();
    this.idleLeft = 1 + Math.random() * 2;
    this.idleFor = 0;
    this.restPose = 'stand';
    this.restLeft = 0;
    this.attention = 0;
    this.eatLeft = 0;
    this.farT = 0;
    this.stuckT = 0;
    this.progT = 0;
    this.progX = this.pos.x;
    this.progZ = this.pos.z;
    this.detourT = 0;
    this.detourSign = 1;
    this.voiceT = 12 + Math.random() * 25;
    this.zzzT = 0;
    this.groundY = this.pos.y;
    this.onGround = false;
    this.swimming = false;
    this.riding = false;
    this.bedUid = null;
    this.inBed = false;
    this.bedT = 0;
    this.slot = 0;
    this.lookAtPlayer = false;
    this.hs = 0;
    this.stepT = 0;

    this.tag = null;
    this.setName(this.name);
    this.pickable = {
      object3d: this.object3d,
      kind: 'pet',
      ref: this,
      box: this.box,
      onUse: () => sys.petPet(this),
      onRemove: () => sys.tickle(this),
      onBuild: (g, hit, item) => sys.onBuild(this, item),
      hint: (g) => sys.hintFor(this, g),
    };
    this._updateBox();
  }

  get variantDef() {
    return variantOf(this.species, this.variant);
  }

  setName(name) {
    this.name = String(name || '').trim().slice(0, 18) || this.spec.names[0];
    if (this.tag) disposeSprite(this.tag);
    this.tag = nameTagSprite(this.name, this.rig.accent || '#FF5FA2');
    this.tagW = this.tag.scale.x;
    this.tagH = this.tag.scale.y;
    this.tag.position.y = this.tagY;
    this.object3d.add(this.tag);
    if (this.sys.pets.includes(this) && this.sys._touch) this.sys._touch(this);
  }

  serialize() {
    const r = (v) => Math.round(v * 100) / 100;
    let { x, y, z } = this.pos;
    if (this.riding && this.game.player) {
      // the saved spot is on the ground next to where we were riding
      y = this.groundY;
    }
    const out = {
      id: this.id, species: this.species, variant: this.variant, name: this.name, mode: this.mode,
      x: r(x), y: r(y), z: r(z), yaw: r(this.yaw), home: this.home.map(r), adoptedAt: this.adoptedAt, love: this.love,
    };
    if (Object.keys(this.opts).length) out.opts = { ...this.opts };
    return out;
  }

  dispose() {
    if (this.tag) disposeSprite(this.tag);
    this.tag = null;
    disposeRig(this.rig);
    if (this.object3d.parent) this.object3d.parent.remove(this.object3d);
  }

  // ---------- helpers ----------

  /** World position of the head (for hearts, crumbs). */
  headPoint(out) {
    const f = this.ext * 0.55;
    return out.set(this.pos.x + Math.sin(this.yaw) * f, this.pos.y + this.top * (this.anim.lie > 0.5 ? 0.6 : 0.85), this.pos.z + Math.cos(this.yaw) * f);
  }

  isNearPlayer(d = 3) {
    const p = this.game.player;
    if (!p) return false;
    const dx = p.position.x - this.pos.x, dz = p.position.z - this.pos.z;
    return dx * dx + dz * dz < d * d;
  }

  moveTo(x, y, z, run = false) {
    this.target.set(x, y, z);
    this.moving = true;
    this.run = run;
    this.restLeft = 0;
    this.restPose = 'stand';
  }

  stop() {
    this.moving = false;
  }

  teleport(x, y, z, fx = true) {
    const g = this.game;
    if (fx && g.particles) g.celebrate([this.pos.x, this.pos.y + 0.4, this.pos.z], 'sparkle', { quiet: true });
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.groundY = y;
    this.stuckT = 0;
    this.progX = x;
    this.progZ = z;
    this.moving = false;
    if (fx && g.particles) {
      g.celebrate([x, y + 0.4, z], 'star', { quiet: true, count: 10 });
      this.sys.voice(this, 0.6);
    }
  }

  teleportNear(x, y, z, rMin = 1.3, rMax = 2.6) {
    const spot = this.sys.findSpot(this, x, y, z, rMin, rMax);
    if (spot) this.teleport(spot[0], spot[1], spot[2]);
    else this.teleport(x, y + 0.05, z);
  }

  trick(name) {
    playTrick(this.anim, name || this.spec.trick);
  }

  // ---------- per frame ----------

  update(dt) {
    if (this.riding) {
      this._ride(dt);
    } else {
      this._think(dt);
      if (this.inBed) {
        this.vel.set(0, 0, 0);
        this.hs = 0;
        this.onGround = true;
      } else {
        this._move(dt);
      }
    }
    this._post(dt);
  }

  _playerInfo() {
    const pl = this.game.player;
    if (!pl) return null;
    return pl;
  }

  _think(dt) {
    const sys = this.sys;
    const pl = this._playerInfo();
    this.lookAtPlayer = false;
    if (this.eatLeft > 0) {
      this.eatLeft -= dt;
      this.stop();
      this.anim.pose = 'stand';
      return;
    }
    if (this.anim.hideLeft > 0) {
      // a turtle tucked into its shell stays put until it peeks out again
      this.stop();
      this.anim.pose = 'stand';
      return;
    }
    if (this.attention > 0) {
      this.attention -= dt;
      this.stop();
      this.anim.pose = this.spec.rideable || this.spec.gait === 'waddle' ? 'stand' : 'sit';
      this.lookAtPlayer = true;
      return;
    }

    // ----- bedtime -----
    if (this.state === 'sleep') {
      // morning came, or her bed is gone (Remove tool, Undo, a Magic House built over it):
      // hop out to a free spot instead of sleeping on in mid-air
      if (!sys.wantsSleep(this) || (this.inBed && !sys.bedSpot(this.bedUid))) {
        this.wake();
      } else {
        this.stop();
        this.anim.pose = 'sleep';
        this.zzzT -= dt;
        if (this.zzzT <= 0) {
          this.zzzT = 1.3 + Math.random() * 0.6;
          const hx = this.pos.x + Math.sin(this.yaw) * this.ext * 0.4;
          const hz = this.pos.z + Math.cos(this.yaw) * this.ext * 0.4;
          sys.zzz.spawn(hx, this.pos.y + this.top * 0.7, hz);
        }
        return;
      }
    }
    if (this.state === 'toBed') {
      const bed = sys.bedSpot(this.bedUid);
      if (!bed || !sys.isNight()) {
        sys.releaseBed(this);
        this.state = 'idle';
      } else {
        this.bedT += dt;
        const dx = bed.x - this.pos.x, dz = bed.z - this.pos.z;
        if (dx * dx + dz * dz < 0.5 || this.bedT > 12) {
          this.settleInBed(bed);
        } else {
          this.moveTo(bed.x, bed.y, bed.z, this.bedT > 5);
        }
        return;
      }
    }

    this.thinkT = (this.thinkT || 0) - dt;
    if (this.thinkT <= 0) {
      this.thinkT = 1.5 + Math.random();
      if (sys.isNight() && this.mode !== 'stay' && !this.riding) {
        const bed = sys.claimBed(this);
        if (bed) {
          this.state = 'toBed';
          this.bedT = 0;
          return;
        }
      }
      if (sys.wantsSleep(this)) {
        this.state = 'sleep';
        this.zzzT = 0.5;
        return;
      }
    }

    if (this.mode === 'stay') {
      this.stop();
      this.idleFor += dt;
      this.anim.pose = this.idleFor > 30 ? 'lie' : 'sit';
      this.lookAtPlayer = this.isNearPlayer(9);
      return;
    }

    let ax, ay, az; // anchor to hang around
    if (this.mode === 'home') {
      [ax, ay, az] = this.home;
      const dx = ax - this.pos.x, dz = az - this.pos.z;
      if (dx * dx + dz * dz > 30 * 30 || this.pos.y < -4) {
        this.teleportNear(ax, ay, az, 0.2, 1.5);
        return;
      }
      if (dx * dx + dz * dz > 6 * 6) {
        this.moveTo(ax, ay, az, false);
        return;
      }
    } else {
      if (!pl) return;
      const p = pl.position;
      ax = p.x; ay = p.y; az = p.z;
      const dx = p.x - this.pos.x, dy = p.y - this.pos.y, dz = p.z - this.pos.z;
      const d2 = dx * dx + dz * dz;
      const d3 = Math.sqrt(d2 + dy * dy);
      this.farT = d3 > 12 ? this.farT + dt : 0;
      if (d3 > TELEPORT_DIST || this.pos.y < -4 || (this.farT > 6 && d3 > 12)) {
        this.farT = 0;
        // land on the ground near her (below her if she is flying)
        let gy = p.y;
        if (pl.flying || pl.state === 'ride') {
          const h = this.game.world.heightAt(Math.floor(p.x), Math.floor(p.z));
          if (h >= 0) gy = Math.min(p.y, h + 1);
        }
        this.teleportNear(p.x, gy, p.z);
        return;
      }
      // follow point: a little behind her, each pet in its own slot
      const d = Math.sqrt(d2);
      const far = 3.2 + (this.slot % 4) * 0.35;
      if (d > far || (this.moving && this.run && d > 2.2)) {
        const ang = pl.yaw + Math.PI + SLOT_ANGLES[this.slot % SLOT_ANGLES.length];
        const r = 1.8 + Math.floor(this.slot / SLOT_ANGLES.length) * 1.1;
        this.moveTo(p.x + Math.sin(ang) * r, p.y, p.z + Math.cos(ang) * r, d > 7);
        this.idleFor = 0;
        return;
      }
    }

    // ----- idle near the anchor -----
    if (this.moving) return;
    this.idleFor += dt;
    this.lookAtPlayer = this.isNearPlayer(7);
    if (this.restLeft > 0) {
      this.restLeft -= dt;
      this.anim.pose = this.restPose;
      if (this.restLeft <= 0) this.restPose = 'stand';
      return;
    }
    this.anim.pose = 'stand';
    this.idleLeft -= dt;
    if (this.idleLeft > 0) return;
    this.idleLeft = 2.5 + Math.random() * 4;
    const r = Math.random();
    if (r < 0.4) {
      const ang = Math.random() * TAU, rad = 1.2 + Math.random() * 2;
      this.moveTo(ax + Math.sin(ang) * rad, ay, az + Math.cos(ang) * rad, false);
      this.slowWalk = true;
    } else if (r < 0.62) {
      this.restPose = this.spec.rideable ? 'stand' : 'sit';
      this.restLeft = 3 + Math.random() * 5;
    } else if (r < 0.74 && this.idleFor > 12) {
      this.restPose = 'lie';
      this.restLeft = 5 + Math.random() * 6;
    } else if (r < 0.86) {
      this.trick();
      if (Math.random() < 0.5) this.sys.voice(this, 0.5);
    }
  }

  wake() {
    this.state = 'idle';
    this.anim.pose = 'stand';
    if (this.inBed) {
      this.inBed = false;
      const s = this.sys.findSpot(this, this.pos.x, this.pos.y, this.pos.z, 0.9, 1.8);
      if (s) this.pos.set(s[0], s[1], s[2]);
    }
    this.sys.releaseBed(this);
    this.anim.happy = 1.5;
    playTrick(this.anim, 'shake');
  }

  settleInBed(bed) {
    this.stop();
    this.pos.set(bed.x, bed.y, bed.z);
    this.vel.set(0, 0, 0);
    this.yaw = bed.yaw;
    this.inBed = true;
    this.state = 'sleep';
    this.zzzT = 0.8;
    this.groundY = bed.y;
  }

  _move(dt) {
    const g = this.game, ph = g.physics, spec = this.spec;
    if (!ph) return;
    const v = this.vel, p = this.pos;
    let wx = 0, wz = 0, speed = 0;
    if (this.moving) {
      const dx = this.target.x - p.x, dz = this.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.35) {
        this.moving = false;
        this.slowWalk = false;
      } else {
        speed = (this.run ? spec.run : this.slowWalk ? spec.speed * 0.55 : spec.speed) * Math.min(1, dist / 0.9 + 0.3);
        wx = dx / dist;
        wz = dz / dist;
        if (this.detourT > 0) {
          this.detourT -= dt;
          const a = this.detourSign * 1.3;
          const c = Math.cos(a), s = Math.sin(a);
          const nx = wx * c - wz * s, nz = wx * s + wz * c;
          wx = nx; wz = nz;
        }
      }
    }
    // keep a little space between pets
    let sx = 0, sz = 0;
    for (const o of this.sys.pets) {
      if (o === this || o.riding || o.inBed) continue;
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const r = (this.spec.halfW + o.spec.halfW) * 1.6;
      if (d2 < r * r && d2 > 1e-6 && Math.abs(p.y - o.pos.y) < 1) {
        const d = Math.sqrt(d2);
        sx += (dx / d) * (r - d);
        sz += (dz / d) * (r - d);
      }
    }
    // a floating duckling bobs right at the surface (its float point is about where this body
    // point sits), so once swimming it stays swimming while its feet are wet: no flicker of the
    // shadow and the paddling pose; it stops when it climbs out onto dry ground
    const inWater = ph.liquidAt(p.x, p.y + spec.height * 0.3, p.z) || (this.swimming && ph.liquidAt(p.x, p.y + 0.02, p.z));
    this.swimming = inWater;
    if (inWater) speed *= spec.swims ? (spec.swimBoost || 0.9) : 0.6;
    const tvx = wx * speed + sx * 3, tvz = wz * speed + sz * 3;
    const k = Math.min(1, (this.onGround || inWater ? 11 : 4) * dt);
    v.x += (tvx - v.x) * k;
    v.z += (tvz - v.z) * k;
    if (inWater) {
      const floatAt = spec.swims ? 0.2 : spec.height * 0.55;
      const fy = p.y + floatAt;
      if (ph.liquidAt(p.x, fy, p.z)) {
        // rise toward the surface, slowing down near it, so a floating pet settles there
        // instead of shooting out of the water and bouncing
        const top = Math.floor(fy) + 1;
        const depth = ph.liquidAt(p.x, top + 0.5, p.z) ? 1 : top - fy;
        v.y += (Math.min(2.2, 0.15 + depth * 5) - v.y) * Math.min(1, 6 * dt);
      } else v.y -= 10 * dt;
      v.y = Math.max(-3, Math.min(3, v.y));
    } else {
      v.y = Math.max(v.y - GRAVITY * dt, -30);
    }
    const res = ph.move(this.body, dt, { step: true });
    const ledge = res.ledge, hitWall = res.hitWall, onGround = res.onGround;
    this.onGround = onGround;
    if (onGround) this.groundY = p.y;
    if (speed > 0.2 && ledge !== null && onGround) v.y = spec.hop;
    if (inWater && hitWall && speed > 0.2) v.y = spec.hop * 0.9;

    // stuck? hop, then sidestep, then pop over to where we wanted to go
    if (speed > 0.6) {
      this.progT += dt;
      if (this.progT > 0.7) {
        const moved = Math.hypot(p.x - this.progX, p.z - this.progZ);
        this.stuckT = moved < 0.35 ? this.stuckT + this.progT : 0;
        this.progT = 0;
        this.progX = p.x;
        this.progZ = p.z;
      }
      if (this.stuckT > 0.6 && onGround && hitWall) v.y = spec.hop;
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
      const pl = this.game.player;
      if (pl) this.teleportNear(pl.position.x, pl.position.y, pl.position.z);
      else this.teleport(this.home[0], this.home[1] + 1, this.home[2]);
    }
    this.hs = Math.hypot(v.x, v.z);
    if (this.hs > 0.4) this.yaw += angleDelta(this.yaw, Math.atan2(v.x, v.z)) * Math.min(1, 9 * dt);
  }

  // ---------- multiplayer puppet (a friend's page shows the host's pet) ----------

  /**
   * Where the host says this pet is: sample [h, x*20, y*20, z*20, yaw*100, st] (st: 'w' walk /
   * stand, 's' sit, 'l' lie, 'z' sleep, 'i' swim, 'h' ridden, 'f' ridden in the air).
   */
  setNetTarget(sample) {
    const t = this.netTarget || (this.netTarget = { x: 0, y: 0, z: 0, yaw: 0, st: 'w', fresh: true });
    t.x = sample[1] / 20;
    t.y = sample[2] / 20;
    t.z = sample[3] / 20;
    t.yaw = sample[4] / 100;
    t.st = typeof sample[5] === 'string' ? sample[5] : 'w';
  }

  /** The motion sample of this pet for the host's presence (see setNetTarget). */
  netSample() {
    const a = this.anim;
    let st = 'w';
    if (this.riding) st = a.flying ? 'f' : 'h';
    else if (this.state === 'sleep' || a.pose === 'sleep') st = 'z';
    else if (this.swimming) st = 'i';
    else if (a.pose === 'sit') st = 's';
    else if (a.pose === 'lie') st = 'l';
    const p = this.pos;
    return [this.h | 0, Math.round(p.x * 20), Math.round(p.y * 20), Math.round(p.z * 20), Math.round(this.yaw * 100), st];
  }

  /** Per frame on a friend's page: glide toward the host's latest sample, then animate. */
  puppet(dt) {
    const t = this.netTarget;
    const p = this.pos;
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
        this.yaw += angleDelta(this.yaw, t.yaw) * Math.min(1, dt * 10);
      }
      const st = t.st;
      this.swimming = st === 'i';
      this.onGround = st !== 'f';
      this.inBed = st === 'z';
      this.anim.flying = st === 'f';
      this.anim.pose = st === 's' ? 'sit' : st === 'l' ? 'lie' : st === 'z' ? 'sleep' : 'stand';
      if (this.onGround) this.groundY = p.y;
      if (st === 'z') {
        this.zzzT -= dt;
        if (this.zzzT <= 0) {
          this.zzzT = 1.3 + Math.random() * 0.6;
          this.sys.zzz.spawn(p.x + Math.sin(this.yaw) * this.ext * 0.4, p.y + this.top * 0.7, p.z + Math.cos(this.yaw) * this.ext * 0.4);
        }
      }
    }
    this.lookAtPlayer = this.anim.pose !== 'sleep' && this.hs < 0.4 && this.isNearPlayer(5);
    this._post(dt);
  }

  // ---------- riding ----------

  _ride(dt) {
    const g = this.game, pl = g.player, ph = g.physics, spec = this.spec, input = g.input;
    if (!pl || pl.state !== 'ride' || pl.mountPet !== this || !ph) {
      this.sys.onDismounted(this);
      return;
    }
    const v = this.vel, p = this.pos;
    const camYaw = g.cameraRig ? g.cameraRig.yaw : this.yaw;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    let wx = fx * input.move.z + rx * input.move.x;
    let wz = fz * input.move.z + rz * input.move.x;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const inWater = ph.liquidAt(p.x, p.y + spec.height * 0.35, p.z);
    this.swimming = inWater;
    const speed = (input.run ? spec.run * 1.45 : spec.speed * 1.6) * (inWater ? 0.6 : 1);
    const flying = !!spec.flies && !this.onGround && !inWater;
    const k = Math.min(1, (this.onGround || flying || inWater ? 9 : 4) * dt);
    v.x += (wx * speed - v.x) * k;
    v.z += (wz * speed - v.z) * k;
    if (inWater) {
      if (ph.liquidAt(p.x, p.y + spec.height * 0.55, p.z)) v.y += (2.4 - v.y) * Math.min(1, 6 * dt);
      else v.y -= 10 * dt;
      if (input.jump) v.y = Math.max(v.y, 3.5);
    } else if (spec.flies && !this.onGround) {
      if (input.jump) v.y += (4.6 - v.y) * Math.min(1, 3.5 * dt);
      else if (input.down) v.y += (-6.5 - v.y) * Math.min(1, 4 * dt);
      else v.y = Math.max(v.y - 10 * dt, -2.3); // a soft, floaty glide
    } else {
      v.y = Math.max(v.y - GRAVITY * dt, -30);
      if (this.onGround && input.jump) {
        v.y = spec.hop * 1.08;
        g.audio.play('jump', { volume: 0.5, pitch: 0.8 });
      }
    }
    if (g.world && p.y > g.world.sy + 24) {
      p.y = g.world.sy + 24;
      v.y = Math.min(v.y, 0);
    }
    const res = ph.move(this.body, dt, { step: true });
    this.onGround = res.onGround;
    if (this.onGround) this.groundY = p.y;
    if (wl > 0.2 && res.ledge !== null && this.onGround) v.y = spec.hop;
    if (inWater && res.hitWall && wl > 0.2) v.y = spec.hop * 0.9;
    if (p.y < -6 && g.world) {
      const s = g.world.meta.spawn;
      this.teleport(s[0], s[1] + 1, s[2]);
    }
    this.hs = Math.hypot(v.x, v.z);
    if (wl > 0.1) this.yaw += angleDelta(this.yaw, Math.atan2(wx, wz)) * Math.min(1, 7 * dt);
    this.anim.flying = flying;
    // clip-clop
    if (this.onGround && this.hs > 1.5) {
      this.stepT += dt * this.hs;
      if (this.stepT > 1.6) {
        this.stepT = 0;
        g.audio.play('step', { pitch: 1.5 + Math.random() * 0.2, volume: 0.8 });
      }
    }
  }

  /** Put the rider on the saddle (after the pet moved this frame). */
  syncRider() {
    const pl = this.game.player;
    if (!pl || pl.mountPet !== this) return;
    const bob = this.rig.body.position.y - this.rig.bodyY + this.rig.jumper.position.y;
    pl.position.set(this.pos.x, this.pos.y + this.seatHeight + bob, this.pos.z);
    pl.yaw = this.yaw;
    pl.velocity.set(0, 0, 0);
    if (pl.avatar) {
      pl.avatar.group.position.copy(pl.position);
      pl.avatar.group.rotation.y = this.yaw;
    }
  }

  // ---------- after moving: animation, tag, box ----------

  _post(dt) {
    const g = this.game, a = this.anim;
    a.speed = this.hs;
    a.swim = this.swimming;
    a.airTarget = !this.onGround && !this.swimming && !this.inBed ? 1 : 0;
    a.wag = this.lookAtPlayer ? 0.7 : 0.25;
    if (this.eatLeft > 0) a.eat = Math.max(a.eat, 0.05);
    if (this.lookAtPlayer && g.player) {
      const p = g.player.position;
      const dirYaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
      const dy = p.y + 1.3 - (this.pos.y + this.top);
      const dist = Math.max(0.5, Math.hypot(p.x - this.pos.x, p.z - this.pos.z));
      let rel = angleDelta(this.yaw, dirYaw);
      if (!this.moving && Math.abs(rel) > 0.9 && this.anim.pose !== 'sleep') {
        // turn the whole body toward her when she is behind us
        this.yaw += rel * Math.min(1, 3 * dt);
        rel = angleDelta(this.yaw, dirYaw);
      }
      a.lookYaw = rel;
      a.lookPitch = -Math.atan2(dy, dist) * 0.6;
    } else {
      a.lookYaw = 0;
      a.lookPitch = 0;
    }
    animate(this.rig, a, dt);
    this.object3d.rotation.y = this.yaw;
    // the shadow stays on the ground while we jump
    const up = Math.max(0, this.pos.y - this.groundY);
    const sh = this.rig.shadow;
    sh.position.y = -Math.min(up, 3) + 0.02;
    const s = this.spec.shadow * Math.max(0.4, 1 - up * 0.15);
    sh.scale.set(s, 1, s);
    sh.visible = !this.swimming;
    if (this.tag) {
      const cam = g.camera.position;
      const d2 = cam.distanceToSquared(this.pos);
      this.tag.visible = !this.riding && d2 < 22 * 22 && d2 > 1.2;
      // close up the tag shrinks so it never covers the whole screen
      const k = Math.min(1, Math.max(0.4, Math.sqrt(d2) / 6));
      this.tag.scale.set(this.tagW * k, this.tagH * k, 1);
      this.tag.position.y = this.tagY * (1 - a.lie * 0.3) + this.rig.jumper.position.y;
    }
    this._updateBox();
    if (this.riding) this.syncRider();

    // now and then say something (quietly, only when she is near)
    if (!this.riding && this.state !== 'sleep') {
      this.voiceT -= dt;
      if (this.voiceT <= 0) {
        this.voiceT = 18 + Math.random() * 30;
        if (this.isNearPlayer(10)) this.sys.voice(this, 0.35);
      }
    }
  }

  _updateBox() {
    const p = this.pos, e = this.ext;
    const top = this.top * (1 - 0.35 * this.anim.lie);
    this.box.min.set(p.x - e, p.y, p.z - e);
    this.box.max.set(p.x + e, p.y + top, p.z + e);
  }
}

// follow slots behind the player: straight behind, then fanning out to both sides
const SLOT_ANGLES = [0, 0.75, -0.75, 1.5, -1.5, 2.2, -2.2];
