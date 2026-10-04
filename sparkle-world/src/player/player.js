// The player: walking (with kid-friendly auto-jump), running, swimming, flying, sitting,
// sleeping and riding hooks. Movement is camera-relative; in third person the avatar turns
// smoothly toward where it walks.

import * as THREE from 'three';
import { angleDelta } from '../core/util.js';
import { CameraRig } from './camera.js';
import {
  SeaGate, seaDeep, seaVy, hopVy, leapCheck, autoSeaForm, SEA_SWIM, SEA_SWIM_FAST, ME_SWIM, ME_SWIM_FAST,
  BUOY_DELAY, BUOY_PROBE, HOP_HOLD, LEAP_V, FP_DIVE_DEAD,
} from './merfolk/rules.js';

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
    this.state = 'walk'; // walk | sit | sleep | swim | fly | ride | emote | hold
    this.flying = !!saved.flying;
    this.swimming = false;
    this.onGround = false;
    this.halfW = 0.3;
    this.height = 1.7;
    this.seatEntity = null;
    // what carries her while state === 'ride': a pet (pets.js) or a vehicle she drives
    // (src/things/vehicles). It keeps its old name because pets compare it by identity;
    // read m.kind ('pet' | 'vehicle') before using anything pet-specific.
    this.mountPet = null;
    this.holder = null; // what carries her while state === 'hold' (zip lines)
    this.body = { pos: this.position, vel: this.velocity, halfW: this.halfW, height: this.height, onGround: false };
    this._lastSpace = 0;
    this._stepTime = 0;
    this._emoteUntil = 0;
    this._wish = new THREE.Vector3();

    // sea forms (docs/teams/merfolk.md §6): the gate turns her in deep water; seaSwim is the easy
    // deep-water swimming (every form), seaForm the tail ('mermaid' | 'sea_dragon') or null
    this.seaGate = new SeaGate();
    this.seaSwim = false;
    this.seaForm = null;
    this._seaSt = { idleVT: BUOY_DELAY, hopT: 0 }; // float-up timer, shore-hop timer
    this._leapAt = -1e9;
    this._seaCutFrame = false;
    this._seaDeep = false;
    this._liq = (x, y, z) => !!game.physics && game.physics.liquidAt(x, y, z);
    const seaAuto = (look) => autoSeaForm(typeof game.surpriseStyle === 'function' ? game.surpriseStyle() : null, look);
    this.avatar = game.createAvatar ? game.createAvatar(game.profile.look, { seaAuto }) : null;
    if (this.avatar) game.scene.add(this.avatar.group);
    this._offs = [
      game.input.on('key', (e) => this._onKey(e)),
      game.events.on('avatar:changed', ({ look }) => this.avatar && this.avatar.setLook(look)),
      game.events.on('outfit:changed', ({ look }) => this.avatar && this.avatar.setLook(look)),
      game.events.on('style:changed', () => this.avatar && this.avatar.setSeaAuto(seaAuto)),
    ];
    if (this.flying) this.state = 'fly';
    this._syncAvatar(0);
  }

  _onKey(e) {
    if (!e.down || e.code !== 'Space' || this.game.paused || this.game.mode !== 'play') return;
    // Space is the horn while she drives (a double tap would otherwise stand her up to fly)
    if (this.state === 'ride' && this.mountPet && (this.mountPet.kind === 'vehicle' || this.mountPet.kind === 'dolphin')) return; // ocean
    if (this.seaSwim && this.swimming) return; // merfolk: Space is Up in deep water, never a double-tap fly
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

  /** What carries her (a pet or a vehicle, see mount()), or null. */
  get mounted() {
    return this.mountPet;
  }

  update(dt) {
    const g = this.game;
    const input = g.input;
    const moving = Math.abs(input.move.x) + Math.abs(input.move.z) > 0.2;

    if (this.state === 'hold') {
      // hold(): the holder moves her (and may pose the avatar); no walking, gravity or jumping
      this._syncAvatar(dt);
      return;
    }
    if (this.state === 'sit' || this.state === 'sleep') {
      if (moving || (input.jump && this.state === 'sit')) this.stand();
      else {
        this._syncAvatar(dt);
        return;
      }
    }
    if (this.state === 'ride') {
      // the pets module moves the pet (and reads input); we sit on its saddle. A vehicle seats
      // her itself after it moved this frame (src/things/vehicles); this is only the fallback.
      const pet = this.mountPet;
      if (pet && typeof pet.seatWorld === 'function') {
        pet.seatWorld(this.position);
        if (Number.isFinite(pet.yaw)) this.yaw = pet.yaw;
        this.velocity.set(0, 0, 0);
        this._syncAvatar(dt);
        return;
      }
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

    // sea forms: step the gate (turn in after 0.25 s of deep swimming, back on land)
    const form = this.avatar ? this.avatar.seaForm : 'me';
    const px = this.position.x, py = this.position.y, pz = this.position.z;
    const deep = physics ? seaDeep(this._liq, px, py, pz) : false;
    this._seaDeep = deep;
    const ev = this.seaGate.step(dt, { deep, swimming: this.swimming, onGround: this.onGround, blocked: this.flying });
    if (ev === 'in') {
      this._setSeaSwim(true);
      this._seaSt.idleVT = BUOY_DELAY;
      this._seaIn(form);
    } else if (ev === 'out' || ev === 'cut') this._seaOut(ev === 'cut');
    else if (this.seaGate.on && form !== (this.seaForm || 'me')) {
      // the form changed in the water (the Studio, the bubble): a quick change, no gate reset
      if (form === 'me') {
        this._seaCutFrame = true;
        this.seaForm = null;
        g.events.emit('player:seaform', { form: null });
      } else {
        this.seaForm = form;
        g.events.emit('player:seaform', { form });
      }
    }
    const sea = this.seaSwim && this.swimming;
    const tail = !!this.seaForm;
    const firstPerson = g.cameraRig && g.cameraRig.mode === 'first';

    const speed = this.flying ? (input.run ? FLY_FAST : FLY)
      : sea ? (input.run ? (tail ? SEA_SWIM_FAST : ME_SWIM_FAST) : (tail ? SEA_SWIM : ME_SWIM))
      : this.swimming ? SWIM : input.run ? RUN : WALK;
    const accel = this.onGround || this.flying || this.swimming ? 14 : 5;
    const k = Math.min(1, accel * dt);
    this.velocity.x += (wish.x * speed - this.velocity.x) * k;
    this.velocity.z += (wish.z * speed - this.velocity.z) * k;

    if (this.flying) {
      const vy = input.jump ? 6 : input.down ? -6 : 0;
      this.velocity.y += (vy - this.velocity.y) * Math.min(1, 10 * dt);
    } else if (sea) {
      // deep water: Up / Down (Space / C, never Shift), a gentle float up, settle in the shallows
      let fpWant = 0;
      if (firstPerson && wishLen > 0.2 && g.cameraRig) {
        const p = g.cameraRig.pitch; // positive looks down
        if (Math.abs(p) > FP_DIVE_DEAD) fpWant = -Math.sign(p) * Math.min(1, (Math.abs(p) - FP_DIVE_DEAD) * 1.6) * Math.max(0, input.move.z);
      }
      this.velocity.y = seaVy(this._seaSt, {
        dt, vy: this.velocity.y, up: input.jump, down: input.downKey, fpWant, deep,
        chestWet: physics.liquidAt(px, py + BUOY_PROBE, pz), gravity: GRAVITY,
      });
      // the dolphin leap: fast with Up held, rising, the head out of the water
      const hs0 = Math.hypot(this.velocity.x, this.velocity.z);
      const now = performance.now();
      if (input.jump && hs0 > 3 && this.velocity.y > 1.5 &&
        leapCheck({ jump: true, hs: hs0, vy: this.velocity.y, headWet: physics.liquidAt(px, py + 1.5, pz), now, leapAt: this._leapAt })) {
        this.velocity.y = LEAP_V;
        this._leapAt = now;
        this._seaSt.hopT = 0.25; // plain gravity while she leaves the water
        g.audio.play('splash', { pitch: 1.2 });
        if (g.particles) g.celebrate([px, py + 0.8, pz], 'splash', { quiet: true });
        g.events.emit('player:leap', { pos: [px, py, pz], form: this.seaForm });
      }
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
      const res = physics.move(this.body, dt, { step: !this.flying, swim: sea });
      this.onGround = res.onGround;
      // walking into a 1-block ledge: hop up automatically. The hop starts after this frame's
      // gravity step, so add back half a step: the peak (1.1) then no longer sinks below one
      // block at low frame rates (it was 0.98 at 30 fps, 0.92 at 20 fps). A sea swimmer flops
      // out onto the shore or a pond rim the same way (merfolk).
      if (res.ledge !== null && !this.flying && wishLen > 0.3 && (this.onGround || sea)) {
        if (sea) {
          this.velocity.y = hopVy(res.ledge - this.position.y, GRAVITY, JUMP_V) + GRAVITY * dt * 0.5;
          this._seaSt.hopT = HOP_HOLD;
          if (g.particles) g.celebrate([this.position.x, this.position.y + 0.5, this.position.z], 'splash', { quiet: true });
        } else this.velocity.y = JUMP_V * 0.92 + GRAVITY * dt * 0.5;
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
    // in a car or a boat she sits on its seat (pose 'sit'); on a pony she rides
    const seated = this.state === 'ride' && !!this.mountPet && this.mountPet.pose === 'sit';
    const dolphin = this.state === 'ride' && !!this.mountPet && this.mountPet.kind === 'dolphin';   // ocean
    this.avatar.update(dt, {
      speed: Math.hypot(this.velocity.x, this.velocity.z),
      onGround: this.onGround,
      swimming: this.swimming,
      flying: this.flying,
      sitting: this.state === 'sit' || seated,
      sleeping: this.state === 'sleep',
      riding: this.state === 'ride' && !seated,
      seaRide: dolphin,                                    // ocean
      seaKick: dolphin ? this.mountPet.kick : 0,           // ocean (merfolk clamps a non-finite value to its own beat)
      sea: !!this.seaForm,                                 // merfolk
      seaCut: this._seaCutFrame,                           // merfolk
    });
    this._seaCutFrame = false;
  }

  // ----- sea forms (merfolk) -----

  _setSeaSwim(on) {
    on = !!on;
    if (this.seaSwim === on) return;
    this.seaSwim = on;
    this.game.events.emit('player:seaswim', { on });
  }

  /** The tail appears (not for Just Me: she only gets the easy deep-water swimming). */
  _seaIn(form) {
    if (form === 'me' || !form) return;
    this.seaForm = form;
    this.game.audio.play('magic', { pitch: 1.25, volume: 0.7 });
    this.game.events.emit('player:seaform', { form });
  }

  /** Back to legs (cut: at once, no sound) and the end of sea swimming. */
  _seaOut(cut) {
    if (this.seaForm) {
      if (!cut) this.game.audio.play('magic', { pitch: 0.9, volume: 0.5 });
      this._seaCutFrame = !!cut;
      this.seaForm = null;
      this.game.events.emit('player:seaform', { form: null });
    }
    this._setSeaSwim(false);
  }

  /** Turn back at once (flying, sitting, a pony or a vehicle, the zip line, a teleport). */
  _seaCut() {
    if (!this.seaGate.on) return;
    this.seaGate.reset();
    this._seaOut(true);
  }

  setFlying(on) {
    on = !!on;
    if (this.flying === on) return;
    if (on) this._seaCut();
    if (this.state === 'sit' || this.state === 'sleep' || this.state === 'ride' || this.state === 'hold') this.stand();
    this.flying = on;
    this.state = on ? 'fly' : 'walk';
    if (on) this.velocity.y = 3;
    this.game.audio.play('whoosh');
    this.game.events.emit('player:fly', { flying: on });
  }

  toggleFly() {
    this.setFlying(!this.flying);
  }

  /**
   * Stop flying without the whoosh (sitting down, lying down, mounting): listeners such as
   * the HUD's Fly / Up / Down / Jump buttons still hear 'player:fly'.
   */
  _landQuietly() {
    if (!this.flying) return;
    this.flying = false;
    this.game.events.emit('player:fly', { flying: false });
  }

  /** Sit on a seat: seatPos is the seat surface (world), yaw the direction to face. */
  sitOn(entity, seatPos, yaw) {
    this._seaCut();
    this.state = 'sit';
    this._landQuietly();
    this.seatEntity = entity;
    this.position.copy(seatPos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this._syncAvatar(0);
    this.game.events.emit('player:sit', { entity });
  }

  /**
   * Lie down: pos is the mattress top centre, yaw points from headboard to foot.
   * opts.quiet: just lying down for a rest (a hammock), not going to bed: no 'player:sleep'.
   */
  sleepIn(entity, pos, yaw, { quiet = false } = {}) {
    this._seaCut();
    this.state = 'sleep';
    this._landQuietly();
    this.seatEntity = entity;
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this._syncAvatar(0);
    if (!quiet) this.game.events.emit('player:sleep', {});
  }

  /** Get up from a seat/bed/mount and step to a free spot nearby. */
  stand() {
    const was = this.state;
    if (was !== 'sit' && was !== 'sleep' && was !== 'ride' && was !== 'hold') return;
    const e = this.seatEntity;
    const m = was === 'ride' ? this.mountPet : null;
    this.state = 'walk';
    this.seatEntity = null;
    this.mountPet = null;
    this.holder = null;
    // a vehicle parks itself right now (synchronously) and says where her door is
    let spot = null;
    if (m && typeof m.beforeStand === 'function') {
      try {
        spot = m.beforeStand();
      } catch (err) {
        console.error('[player] parking failed', err);
      }
    }
    if (!spot) spot = this.findStandSpot(this.position.x, this.position.y, this.position.z, e);
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

  /**
   * Ride a mount. A pet (kind 'pet', the default): the pets module moves it, pet.object3d and
   * pet.seatHeight are used. A vehicle (kind 'vehicle', src/things/vehicles): it moves itself
   * and seats her; it may give seatWorld(out), pose ('sit'), overlapsCell(x,y,z), standSpot()
   * (for saves) and beforeStand() (parks it, returns her stand spot or null).
   */
  mount(m) {
    if (m && !m.kind) m.kind = 'pet';
    // a dolphin ride keeps (or starts) the tail; every other mount turns her back at once
    if (m && m.kind === 'dolphin') {
      if (!this.seaGate.on) {
        this.seaGate.force();
        this._setSeaSwim(true);
        this._seaSt.idleVT = BUOY_DELAY;
        this._seaIn(this.avatar ? this.avatar.seaForm : 'me');
      }
    } else this._seaCut();
    this.state = 'ride';
    this._landQuietly();
    this.mountPet = m;
    this.velocity.set(0, 0, 0);
  }

  /**
   * Hold on to something that carries her (a zip-line handle...): until release(), `holder`
   * moves this.position every frame (after player.update) and may pose the avatar. stand(),
   * teleport() and flying let go too; the holder notices state !== 'hold'.
   */
  hold(holder) {
    this._seaCut();
    if (this.state === 'sit' || this.state === 'sleep' || this.state === 'ride') this.stand();
    this._landQuietly();
    this.state = 'hold';
    this.holder = holder || null;
    this.seatEntity = null;
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    return true;
  }

  /** Let go after hold(): she walks on from where the holder left her. */
  release() {
    if (this.state !== 'hold') return;
    this.state = 'walk';
    this.holder = null;
    this.velocity.set(0, 0, 0);
    this._syncAvatar(0);
  }

  emote(name) {
    if (!this.avatar || this.state === 'sit' || this.state === 'sleep' || this.state === 'ride' || this.state === 'hold') return;
    if (this.seaForm && name !== 'wave' && name !== 'heart') return; // only arm-only emotes with a tail
    const dur = this.avatar.playEmote(name) || 2;
    this.state = 'emote';
    this._emoteUntil = performance.now() + dur * 1000;
    this.game.events.emit('emote', { name });
  }

  teleport(x, y, z) {
    this._seaCut();
    if (this.state === 'sit' || this.state === 'sleep' || this.state === 'ride' || this.state === 'hold') {
      this.state = 'walk';
      this.seatEntity = null;
      this.mountPet = null;
      this.holder = null;
    }
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this._syncAvatar(0);
    if (this.game.cameraRig) this.game.cameraRig.snap();
  }

  /** Does the body overlap block cell (x,y,z)? (so you cannot build inside yourself) */
  overlapsCell(x, y, z) {
    const p = this.position;
    const m = this.state === 'ride' ? this.mountPet : null;
    // the car she drives counts as her: nothing is built into it
    if (m && typeof m.overlapsCell === 'function' && m.overlapsCell(x, y, z)) return true;
    return (
      p.x + this.halfW > x && p.x - this.halfW < x + 1 &&
      p.y + this.height > y && p.y < y + 1 &&
      p.z + this.halfW > z && p.z - this.halfW < z + 1
    );
  }

  serialize() {
    let p = this.position;
    // never save someone lying in bed or sitting: they come back standing next to it
    if (this.state === 'sit' || this.state === 'sleep' || this.state === 'ride' || this.state === 'hold') {
      // a vehicle knows where it would park for this save: she stands beside that spot
      const m = this.state === 'ride' ? this.mountPet : null;
      let spot = null;
      if (m && typeof m.standSpot === 'function') {
        try {
          spot = m.standSpot();
        } catch (err) {
          console.error('[player] stand spot failed', err);
        }
      }
      if (!spot) spot = this.findStandSpot(p.x, p.y, p.z, this.seatEntity);
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
