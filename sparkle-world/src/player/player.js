// The player: walking (with kid-friendly auto-jump), running, swimming, flying, sitting,
// sleeping and riding hooks. Movement is camera-relative; in third person the avatar turns
// smoothly toward where it walks.

import * as THREE from 'three';
import { angleDelta } from '../core/util.js';
import { CameraRig } from './camera.js';

export const WALK = 4.3;
export const RUN = 6.5;
export const SWIM = 2.8;
export const FLY = 7.5;
export const FLY_FAST = 12;
export const GRAVITY = 24;
export const JUMP_V = Math.sqrt(2 * GRAVITY * 1.3); // clears 1.25 blocks
const DOUBLE_TAP_MS = 320;

export class Player {
  constructor(game, saved = {}) {
    this.game = game;
    this.position = new THREE.Vector3(saved.x ?? 0, saved.y ?? 30, saved.z ?? 0);
    this.velocity = new THREE.Vector3();
    this.yaw = saved.yaw ?? 0;
    this.state = 'walk'; // walk | sit | sleep | swim | fly | ride | emote
    this.flying = !!saved.flying;
    this.swimming = false;
    this.onGround = false;
    this.halfW = 0.3;
    this.height = 1.7;
    this.seatEntity = null;
    this.mountPet = null;
    this.body = { pos: this.position, vel: this.velocity, halfW: this.halfW, height: this.height, onGround: false };
    this._lastSpace = 0;
    this._stepTime = 0;
    this._emoteUntil = 0;
    this._wish = new THREE.Vector3();

    this.avatar = game.createAvatar ? game.createAvatar(game.profile.look) : null;
    if (this.avatar) game.scene.add(this.avatar.group);
    this._offs = [
      game.input.on('key', (e) => this._onKey(e)),
      game.events.on('avatar:changed', ({ look }) => this.avatar && this.avatar.setLook(look)),
      game.events.on('outfit:changed', ({ look }) => this.avatar && this.avatar.setLook(look)),
    ];
    if (this.flying) this.state = 'fly';
    this._syncAvatar(0);
  }

  _onKey(e) {
    if (!e.down || e.code !== 'Space' || this.game.paused || this.game.mode !== 'play') return;
    const now = performance.now();
    if (now - this._lastSpace < DOUBLE_TAP_MS) {
      this.toggleFly();
      this._lastSpace = 0;
    } else {
      this._lastSpace = now;
    }
  }

  get sitting() {
    return this.state === 'sit';
  }

  get sleeping() {
    return this.state === 'sleep';
  }

  update(dt) {
    const g = this.game;
    const input = g.input;
    const moving = Math.abs(input.move.x) + Math.abs(input.move.z) > 0.2;

    if (this.state === 'sit' || this.state === 'sleep') {
      if (moving || (input.jump && this.state === 'sit')) this.stand();
      else {
        this._syncAvatar(dt);
        return;
      }
    }
    if (this.state === 'ride') {
      // the pets module moves the pet (and reads input); we sit on its saddle
      const pet = this.mountPet;
      const o = pet && (pet.object3d || pet.group);
      if (!o) this.stand();
      else {
        this.position.copy(o.position);
        this.position.y += pet.seatHeight ?? 0.9;
        this.yaw = o.rotation.y;
        this._syncAvatar(dt);
        return;
      }
    }
    if (this.state === 'emote' && (moving || performance.now() > this._emoteUntil)) {
      this.state = this.flying ? 'fly' : 'walk';
    }

    // camera-relative wish direction
    const camYaw = g.cameraRig ? g.cameraRig.yaw : this.yaw;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const wish = this._wish.set(fx * input.move.z + rx * input.move.x, 0, fz * input.move.z + rz * input.move.x);
    const wishLen = Math.min(1, wish.length());
    if (wishLen > 0) wish.multiplyScalar(wishLen / wish.length());

    const physics = g.physics;
    const inWater = physics ? physics.liquidAt(this.position.x, this.position.y + 0.6, this.position.z) : false;
    if (inWater && !this.swimming) {
      g.events.emit('player:swim', {});
      g.audio.play('splash');
      if (g.particles) g.celebrate([this.position.x, this.position.y + 0.8, this.position.z], 'splash', { quiet: true });
    }
    this.swimming = inWater && !this.flying;

    const speed = this.flying ? (input.run ? FLY_FAST : FLY) : this.swimming ? SWIM : input.run ? RUN : WALK;
    const accel = this.onGround || this.flying || this.swimming ? 14 : 5;
    const k = Math.min(1, accel * dt);
    this.velocity.x += (wish.x * speed - this.velocity.x) * k;
    this.velocity.z += (wish.z * speed - this.velocity.z) * k;

    if (this.flying) {
      const vy = input.jump ? 6 : input.down ? -6 : 0;
      this.velocity.y += (vy - this.velocity.y) * Math.min(1, 10 * dt);
    } else if (this.swimming) {
      this.velocity.y -= 5 * dt;
      if (input.jump) this.velocity.y = Math.min(this.velocity.y + 22 * dt, 3.6);
      this.velocity.y = Math.max(this.velocity.y, -2.2);
    } else {
      this.velocity.y -= GRAVITY * dt;
      if (input.jump && this.onGround) {
        this.velocity.y = JUMP_V;
        g.audio.play('jump', { volume: 0.5 });
      }
      this.velocity.y = Math.max(this.velocity.y, -40);
    }

    if (physics) {
      const res = physics.move(this.body, dt, { step: !this.flying });
      this.onGround = res.onGround;
      // walking into a 1-block ledge: hop up automatically
      if (res.ledge !== null && !this.flying && wishLen > 0.3 && this.onGround) {
        this.velocity.y = JUMP_V * 0.92;
      }
      if (this.flying && this.onGround && input.down) this.setFlying(false);
    }

    // gently float back if something went very wrong
    if (this.position.y < -8 && g.world) {
      const s = g.world.meta.spawn;
      this.teleport(s[0], s[1] + 1, s[2]);
    }
    if (g.world) this.position.y = Math.min(this.position.y, g.world.sy + 30);

    // facing
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    const firstPerson = g.cameraRig && g.cameraRig.mode === 'first';
    if (firstPerson) this.yaw = camYaw;
    else if (wishLen > 0.1) {
      const target = Math.atan2(wish.x, wish.z);
      this.yaw += angleDelta(this.yaw, target) * Math.min(1, 12 * dt);
    }

    if (this.state !== 'emote') this.state = this.flying ? 'fly' : this.swimming ? 'swim' : 'walk';

    // footsteps
    if (this.onGround && hs > 1 && !this.flying) {
      this._stepTime += dt * hs;
      if (this._stepTime > 1.7) {
        this._stepTime = 0;
        g.audio.play('step', { pitch: 0.9 + Math.random() * 0.2 });
      }
    }
    this._syncAvatar(dt);
  }

  _syncAvatar(dt) {
    if (!this.avatar) return;
    const grp = this.avatar.group;
    grp.position.copy(this.position);
    grp.rotation.y = this.yaw;
    this.avatar.update(dt, {
      speed: Math.hypot(this.velocity.x, this.velocity.z),
      onGround: this.onGround,
      swimming: this.swimming,
      flying: this.flying,
      sitting: this.state === 'sit',
      sleeping: this.state === 'sleep',
      riding: this.state === 'ride',
    });
  }

  setFlying(on) {
    on = !!on;
    if (this.flying === on) return;
    if (this.state === 'sit' || this.state === 'sleep' || this.state === 'ride') this.stand();
    this.flying = on;
    this.state = on ? 'fly' : 'walk';
    if (on) this.velocity.y = 3;
    this.game.audio.play('whoosh');
    this.game.events.emit('player:fly', { flying: on });
  }

  toggleFly() {
    this.setFlying(!this.flying);
  }

  /** Sit on a seat: seatPos is the seat surface (world), yaw the direction to face. */
  sitOn(entity, seatPos, yaw) {
    this.flying = false;
    this.state = 'sit';
    this.seatEntity = entity;
    this.position.copy(seatPos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this._syncAvatar(0);
    this.game.events.emit('player:sit', { entity });
  }

  /** Lie down: pos is the mattress top centre, yaw points from headboard to foot. */
  sleepIn(entity, pos, yaw) {
    this.flying = false;
    this.state = 'sleep';
    this.seatEntity = entity;
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this._syncAvatar(0);
    this.game.events.emit('player:sleep', {});
  }

  /** Get up from a seat/bed/mount and step to a free spot nearby. */
  stand() {
    const was = this.state;
    if (was !== 'sit' && was !== 'sleep' && was !== 'ride') return;
    const e = this.seatEntity;
    this.state = 'walk';
    this.seatEntity = null;
    this.mountPet = null;
    const spot = this.findStandSpot(this.position.x, this.position.y, this.position.z, e);
    if (spot) this.position.set(spot[0], spot[1], spot[2]);
    this.velocity.set(0, 0, 0);
    this._syncAvatar(0);
    this.game.events.emit('player:stand', {});
  }

  /** Nearest spot where the body fits, preferring in front of an entity. */
  findStandSpot(x, y, z, entity = null) {
    const physics = this.game.physics;
    if (!physics) return null;
    const baseY = Math.floor(y);
    const cands = [];
    if (entity && entity.frontCell) cands.push(entity.frontCell());
    for (let r = 0; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          cands.push([Math.floor(x) + dx, baseY, Math.floor(z) + dz]);
        }
      }
    }
    for (const [cx, cy, cz] of cands) {
      for (const dy of [0, 1, -1, 2]) {
        const px = cx + 0.5, py = cy + dy, pz = cz + 0.5;
        if (physics.bodyBlocked(px, py + 0.01, pz, this.halfW, this.height)) continue;
        if (!physics.bodyBlocked(px, py - 0.3, pz, this.halfW, 0.3)) continue; // needs ground under
        return [px, py + 0.01, pz];
      }
    }
    return null;
  }

  /** Ride a pet (the pets module moves it; pet.object3d and pet.seatHeight are used). */
  mount(pet) {
    this.flying = false;
    this.state = 'ride';
    this.mountPet = pet;
    this.velocity.set(0, 0, 0);
  }

  emote(name) {
    if (!this.avatar || this.state === 'sit' || this.state === 'sleep' || this.state === 'ride') return;
    const dur = this.avatar.playEmote(name) || 2;
    this.state = 'emote';
    this._emoteUntil = performance.now() + dur * 1000;
    this.game.events.emit('emote', { name });
  }

  teleport(x, y, z) {
    if (this.state === 'sit' || this.state === 'sleep' || this.state === 'ride') {
      this.state = 'walk';
      this.seatEntity = null;
      this.mountPet = null;
    }
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this._syncAvatar(0);
    if (this.game.cameraRig) this.game.cameraRig.snap();
  }

  /** Does the body overlap block cell (x,y,z)? (so you cannot build inside yourself) */
  overlapsCell(x, y, z) {
    const p = this.position;
    return (
      p.x + this.halfW > x && p.x - this.halfW < x + 1 &&
      p.y + this.height > y && p.y < y + 1 &&
      p.z + this.halfW > z && p.z - this.halfW < z + 1
    );
  }

  serialize() {
    let p = this.position;
    // never save someone lying in bed or sitting: they come back standing next to it
    if (this.state === 'sit' || this.state === 'sleep' || this.state === 'ride') {
      const spot = this.findStandSpot(p.x, p.y, p.z, this.seatEntity);
      if (spot) p = { x: spot[0], y: spot[1], z: spot[2] };
    }
    const r = (v) => Math.round(v * 100) / 100;
    return { x: r(p.x), y: r(p.y), z: r(p.z), yaw: r(this.yaw), flying: this.flying };
  }

  dispose() {
    for (const off of this._offs) off();
    if (this.avatar) {
      this.game.scene.remove(this.avatar.group);
      this.avatar.dispose();
    }
  }
}

export function install(game) {
  game.createPlayer = (saved) => {
    const player = new Player(game, saved);
    game.cameraRig = new CameraRig(game, player);
    game.cameraRig.setMode(game.profile.settings.camera);
    return player;
  };
}
