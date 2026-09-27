// Pets (Pets/Garden/Cooking team): species in game.registry.pets, adoption from the Bag's
// Pets tab, follow AI, petting (hearts + voices), feeding (free treats or basket food),
// riding the pony / unicorn (rainbow trail, gentle flying), sleeping in pet beds at night,
// the Pets panel and per-world saves ('pets' system). See docs/teams/life.md.
//
// Events: 'pet:adopt' { pet }, 'pet:pet' { pet }, 'pet:feed' { pet, food }, 'pet:ride' { pet }
// (pet.species is the species key). API: game.pets (see PetSystem below).

import * as THREE from 'three';
import { SPECIES, SPECIES_KEYS, variantOf, petOpts } from './pets/species.js';
import { installPetStickers } from './pets/stickers.js';
import { install as installFriends } from './friends/index.js';
import { Pet } from './pets/pet.js';
import { RainbowTrail, ZzzPool } from './pets/fx.js';
import { sfx } from './pets/sfx.js';
import { installPetUI, petThumb } from './pets/ui.js';
import { basketTake, basketCount } from './pets/kit.js';
import { FOOD, foodModel, foodName } from './food-models.js';
import { makeId } from '../core/util.js';
import { disposeObject } from '../core/models.js';

export const MAX_PETS = 12;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

class PetSystem {
  constructor(game) {
    this.game = game;
    this.max = MAX_PETS;
    this.pets = [];
    this.group = new THREE.Group();
    this.group.name = 'pets';
    this.zzz = new ZzzPool(this.group);
    this.trails = []; // unicorns' RainbowTrails (pet.trail)
    this.bedClaims = new Map(); // bed entity uid -> pet
    this.snacks = [];
    this.rider = null; // the pet being ridden
    this.playerStillT = 0;
    this._tickleAt = 0;
    this._glowT = 0;
    this._sparkT = 0;
    this.ui = null;
    // multiplayer (docs/MULTIPLAYER.md §9.7): the host owns every pet. On a friend's page
    // (remote) the pets are puppets that follow the host's motion samples (pet.netTarget);
    // she can pet and tickle them, everything else asks the host. onChange(pet) is called
    // when a pet is added, removed, renamed or changes mode (src/net/actors.js).
    this.remote = false;
    this.onChange = null;
    this._hSeq = 0; // pet.h: a small per-session handle (motion samples use it)
  }

  _touch(pet) {
    if (this.onChange !== null) this.onChange(pet);
  }

  /**
   * On a friend's page (remote): the host's pets only do what the host asks. Shows
   * "That's Lily's pet! Ask her to help." and returns true when the action must stop.
   */
  _refused() {
    const net = this.game.net;
    if (!this.remote || (net && net.remoteApplying)) return false;
    if (net && typeof net.refuse === 'function') net.refuse('pet');
    else this.game.toast("That's your friend's pet! Ask her to help.", { icon: 'heart' });
    return true;
  }

  // ---------- adopting & removing ----------

  adopt(species, variant, name, spot, { fx = true, opts = null } = {}) {
    const g = this.game;
    if (!g.world || !SPECIES[species]) return null;
    if (this._refused()) return null;
    if (this.pets.length >= MAX_PETS) {
      g.toast(`You have ${MAX_PETS} pets! That's so much love!`, { icon: 'heart' });
      return null;
    }
    let pos = spot;
    if (!pos && g.player) {
      const p = g.player.position;
      pos = [p.x + Math.sin(g.player.yaw) * 2, p.y, p.z + Math.cos(g.player.yaw) * 2];
    }
    const data = {
      id: makeId('pet'), species, variant: variantOf(species, variant).key, name, mode: 'follow',
      x: pos[0], y: pos[1], z: pos[2], home: [pos[0], pos[1], pos[2]], adoptedAt: Date.now(),
      opts: petOpts(species, opts),
    };
    if (g.player) data.yaw = Math.atan2(g.player.position.x - pos[0], g.player.position.z - pos[2]);
    const pet = this._add(data);
    if (fx) {
      g.celebrate([pos[0], pos[1] + 0.8, pos[2]], 'confetti', { quiet: true });
      g.celebrate([pos[0], pos[1] + 1.1, pos[2]], 'heart', { quiet: true, count: 10 });
      sfx(g, 'tada');
      setTimeout(() => this.voice(pet, 0.9), 350);
      pet.trick('hop');
      pet.anim.happy = 3;
      pet.attention = 2.5;
    }
    g.events.emit('pet:adopt', { pet });
    return pet;
  }

  _add(data) {
    const pet = new Pet(this, data);
    pet.h = data.h > 0 ? data.h | 0 : ++this._hSeq;
    this.pets.push(pet);
    this.group.add(pet.object3d);
    this.game.pickables.add(pet.pickable);
    if (pet.species === 'unicorn') {
      pet.trail = new RainbowTrail(this.group);
      pet.trail.pet = pet;
      this.trails.push(pet.trail);
    }
    this._slots();
    this._changed();
    this._touch(pet);
    return pet;
  }

  remove(pet, { fx = false } = {}) {
    const i = this.pets.indexOf(pet);
    if (i < 0) return false;
    if (this._refused()) return false;
    if (this.rider === pet) this.dismount();
    this.pets.splice(i, 1);
    this.game.pickables.delete(pet.pickable);
    this.releaseBed(pet);
    if (fx) {
      const p = pet.pos;
      this.game.celebrate([p.x, p.y + 0.6, p.z], 'sparkle');
      this.game.celebrate([p.x, p.y + 0.9, p.z], 'heart', { quiet: true });
    }
    if (pet.trail) {
      pet.trail.dispose();
      this.trails.splice(this.trails.indexOf(pet.trail), 1);
      pet.trail = null;
    }
    pet.dispose();
    this._slots();
    this._changed();
    this._touch(pet);
    return true;
  }

  _slots() {
    let n = 0;
    for (const p of this.pets) if (p.mode === 'follow') p.slot = n++;
  }

  _changed() {
    if (this.ui) {
      this.ui.refreshHud();
      this.ui.refreshPanel();
    }
  }

  byId(id) {
    return this.pets.find((p) => p.id === id) || null;
  }

  /** Nearest pet to a point (within maxDist), or null. */
  nearest(x, y, z, maxDist = 8) {
    let best = null, bd = maxDist * maxDist;
    for (const p of this.pets) {
      const d = (p.pos.x - x) ** 2 + (p.pos.y - y) ** 2 + (p.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------- interactions ----------

  petPet(pet) {
    const g = this.game;
    if (pet.riding) return false;
    if (pet.anim.hideLeft > 0) {
      // a gentle pat brings a shy turtle right back out
      pet.anim.hideLeft = 0;
      pet.anim.happy = 2;
    }
    if (pet.state === 'sleep') {
      // a sleepy pet just gets a gentle cuddle
      pet.headPoint(_v);
      g.celebrate(_v, 'heart', { quiet: true, count: 4 });
      sfx(g, 'pet', { volume: 0.6 });
      pet.love++;
      g.events.emit('pet:pet', { pet });
      return true;
    }
    pet.headPoint(_v);
    g.celebrate([_v.x, _v.y + 0.25, _v.z], 'heart', { quiet: true, count: 8 });
    sfx(g, 'pet');
    this.voice(pet, 0.9, true);
    pet.anim.happy = 2.6;
    pet.attention = Math.max(pet.attention, 4);
    if (pet.anim.trick === null && Math.random() < 0.7) pet.trick(Math.random() < 0.6 ? 'hop' : pet.spec.trick);
    pet.love++;
    g.events.emit('pet:pet', { pet });
    // a friend visiting pets the host's pet; its care (treats, rides, modes) stays with the host
    if (this.ui && !this.remote) this.ui.showBubble(pet);
    return true;
  }

  tickle(pet) {
    const g = this.game;
    pet.headPoint(_v);
    if (pet.spec.hideOnTickle && pet.state !== 'sleep') {
      // turtles are shy: they pop into their shell, then peek out with a happy wiggle
      const was = pet.anim.hideLeft > 0;
      pet.anim.hideLeft = 2.6;
      pet.stop();
      sfx(g, 'shell');
      g.celebrate([pet.pos.x, pet.pos.y + 0.6, pet.pos.z], 'sparkle', { quiet: true, count: 6 });
      if (!was) {
        setTimeout(() => {
          if (!this.pets.includes(pet) || pet.anim.hideLeft > 0.05) return;
          pet.anim.happy = 2;
          pet.trick('hop');
          this.voice(pet, 0.8, true);
        }, 2900);
      }
      if (performance.now() - this._tickleAt > 5000) {
        this._tickleAt = performance.now();
        g.toast(`Peekaboo! ${pet.name} is hiding in the shell!`, { icon: 'heart', key: 'pet-tickle' });
      }
      return true;
    }
    g.celebrate(_v, 'heart', { quiet: true, count: 5 });
    pet.anim.happy = 1.5;
    pet.trick('shake');
    this.voice(pet, 0.7, true);
    if (performance.now() - this._tickleAt > 5000) {
      this._tickleAt = performance.now();
      g.toast(`Hee hee! ${pet.name} is ticklish!`, { icon: 'heart' });
    }
    return true;
  }

  onBuild(pet, item) {
    if (item && item.key && item.key.startsWith('food:')) {
      const key = item.key.slice(5);
      if (FOOD[key] && FOOD[key].kind !== 'flower') return this.feed(pet, key);
    }
    return this.petPet(pet);
  }

  hintFor(pet, g) {
    if (pet.riding) return null;
    const tool = g.selectedTool;
    if (tool === 'remove') return null;
    if (tool === 'build') {
      const item = g.selectedItem();
      if (item && item.key.startsWith('food:') && FOOD[item.key.slice(5)] && FOOD[item.key.slice(5)].kind !== 'flower') return `Tap to feed ${pet.name}`;
    }
    if (pet.state === 'sleep') return `${pet.name} is sleeping`;
    return `Tap to pet ${pet.name}`;
  }

  /** Feed a pet: key 'treat' (free, the species' favourite) or a food key from the basket. */
  feed(pet, key = 'treat') {
    const g = this.game;
    if (this._refused()) return false;
    let food = key;
    if (key === 'treat') food = pet.spec.treat;
    else if (!basketTake(g, key, 1)) {
      g.toast(`No ${foodName(key, 2)} in your basket!`, { icon: 'heart' });
      return false;
    }
    if (pet.state === 'sleep') pet.wake();
    pet.stop();
    pet.eatLeft = 2.2;
    pet.anim.eat = 2.2;
    pet.attention = 0;
    this._snack(pet, food);
    sfx(g, 'crunch');
    setTimeout(() => {
      if (!this.pets.includes(pet)) return;
      pet.headPoint(_v);
      g.celebrate([_v.x, _v.y + 0.2, _v.z], 'heart', { quiet: true, count: 10 });
      pet.anim.happy = 3;
      pet.trick('hop');
      this.voice(pet, 0.9, true);
    }, 2200);
    g.events.emit('pet:feed', { pet, food: key === 'treat' ? 'treat' : key });
    return true;
  }

  _snack(pet, key) {
    const m = foodModel(key);
    const f = pet.spec.rideable ? pet.ext * 0.95 : pet.ext * 0.8;
    m.position.set(pet.pos.x + Math.sin(pet.yaw) * f, pet.pos.y + 0.02, pet.pos.z + Math.cos(pet.yaw) * f);
    m.rotation.y = pet.yaw;
    const s = pet.species === 'horse' ? 2.1 : pet.spec.rideable ? 1.7 : pet.species === 'panda' ? 1.1 : 0.9;
    m.scale.setScalar(s);
    this.group.add(m);
    this.snacks.push({ m, life: 2.2, base: s, bites: 0, color: (FOOD[key] && FOOD[key].color) || '#FFFFFF' });
  }

  doTrick(pet) {
    pet.trick(Math.random() < 0.35 ? 'hop' : pet.spec.trick);
    pet.anim.happy = 2;
    this.voice(pet, 0.8, true);
    pet.headPoint(_v);
    this.game.celebrate(_v, 'star', { quiet: true, count: 6 });
  }

  voice(pet, volume = 1, happy = false) {
    const g = this.game;
    let v = volume;
    if (g.player) {
      const d = pet.pos.distanceTo(g.player.position);
      v *= Math.max(0, 1 - d / 22);
    }
    if (v < 0.03) return;
    const pitch = pet.species === 'puppy' && pet.variant !== 'cocoa' ? (pet.variant === 'husky' || pet.variant === 'retriever' ? 0.95 : 1.15)
      : pet.species === 'horse' ? 0.82 : 1;
    sfx(g, happy ? pet.spec.happy : pet.spec.voice, { volume: v, pitch: pitch * (0.95 + Math.random() * 0.1) });
  }

  // ---------- modes ----------

  setMode(pet, mode, { quiet = false } = {}) {
    if (this._refused()) return;
    pet.mode = mode;
    pet.idleFor = 0;
    if (mode === 'stay') {
      pet.stop();
      pet.anim.happy = 1;
      if (!quiet) this.game.toast(`${pet.name} will stay here!`, { icon: 'heart' });
    } else if (mode === 'follow') {
      if (pet.state === 'sleep') pet.wake();
      pet.anim.happy = 1.5;
      pet.trick('hop');
      if (!quiet) this.game.toast(`${pet.name} is following you!`, { icon: 'heart' });
    }
    if (!quiet) this.voice(pet, 0.8, true);
    this._slots();
    this._changed();
    this._touch(pet);
  }

  /** Call a pet over to the player (pops next to her). */
  call(pet, announce = true) {
    const pl = this.game.player;
    if (!pl) return;
    if (this._refused()) return;
    if (this.rider === pet) return;
    if (pet.state === 'sleep') pet.wake();
    pet.mode = 'follow';
    const p = pl.position;
    pet.teleportNear(p.x, p.y, p.z, 1.3, 2.2);
    pet.yaw = Math.atan2(p.x - pet.pos.x, p.z - pet.pos.z);
    pet.anim.happy = 2.5;
    pet.trick('hop');
    pet.attention = 2;
    this.game.celebrate([pet.pos.x, pet.pos.y + 1, pet.pos.z], 'heart', { quiet: true });
    if (announce) this.game.toast(`${pet.name} is here!`, { icon: 'heart' });
    this._slots();
    this._changed();
    this._touch(pet);
  }

  sendHome(pet) {
    if (this._refused()) return;
    if (this.rider === pet) this.dismount();
    if (pet.state === 'sleep') pet.wake();
    pet.mode = 'home';
    const [x, y, z] = pet.home;
    pet.teleportNear(x, y, z, 0, 1.2);
    this.game.toast(`${pet.name} went home!`, { icon: 'home' });
    this._slots();
    this._changed();
    this._touch(pet);
  }

  // ---------- riding ----------

  mount(pet) {
    const g = this.game, pl = g.player;
    if (!pl || !pet.spec.rideable || pet.riding) return false;
    if (this._refused()) return false;
    if (this.rider) this.dismount();
    if (pl.flying) pl.setFlying(false);
    if (pl.state === 'sit' || pl.state === 'sleep') pl.stand();
    if (pet.state === 'sleep') pet.wake();
    pet.stop();
    pet.attention = 0;
    pet.eatLeft = 0;
    pet.riding = true;
    pet.state = 'ride';
    pet.anim.pose = 'stand';
    this.rider = pet;
    g.pickables.delete(pet.pickable);
    pl.mount(pet);
    pet.syncRider();
    if (g.cameraRig) g.cameraRig.yaw = pet.yaw;
    this.voice(pet, 1, true);
    g.celebrate([pet.pos.x, pet.pos.y + 1.2, pet.pos.z], 'sparkle');
    const touch = g.input.touchMode;
    const fly = pet.spec.flies ? (touch ? ' Hold Jump to fly!' : ' Hold Space to fly!') : '';
    g.toast(touch ? `Steer with the joystick!${fly}` : `Ride with W A S D!${fly}`, { icon: 'heart', duration: 4200 });
    g.events.emit('pet:ride', { pet });
    this._changed();
    return true;
  }

  dismount() {
    const pet = this.rider;
    const pl = this.game.player;
    if (pl && pl.state === 'ride') pl.stand();
    if (pet) this.onDismounted(pet);
  }

  onDismounted(pet) {
    if (!pet.riding) return;
    pet.riding = false;
    pet.state = 'idle';
    pet.anim.flying = false;
    pet.attention = 1.5;
    if (this.rider === pet) this.rider = null;
    if (this.pets.includes(pet)) this.game.pickables.add(pet.pickable);
    this._changed();
  }

  // ---------- beds & sleep ----------

  isNight() {
    const d = this.game.time.dayTime;
    return d < 0.23 || d > 0.8;
  }

  wantsSleep(pet) {
    const pl = this.game.player;
    if (pet.inBed) return this.isNight();
    if (pl && pl.state === 'sleep' && pet.isNearPlayer(16)) return true;
    if (!this.isNight()) return false;
    if (pet.mode === 'stay' || pet.mode === 'home') return true;
    return this.playerStillT > 10 && pet.isNearPlayer(7);
  }

  _beds() {
    const E = this.game.entities;
    if (!E) return [];
    const out = [];
    for (const e of E.all()) if (e.key === 'pet_bed' || (e.def && e.def.petBed)) out.push(e);
    return out;
  }

  /** Where a pet lies on a bed entity: { x, y, z, yaw } or null. */
  bedSpot(uid) {
    const E = this.game.entities;
    const e = E && uid !== null ? E.byUid(uid) : null;
    if (!e) return null;
    const def = e.def;
    const [w, , d] = def.size || [1, 1, 1];
    const s = def.petSpot || def.sleepPos || [w / 2, 0.14, d / 2];
    E.localToWorld(e, s[0], s[1], s[2], _w);
    return { x: _w.x, y: _w.y, z: _w.z, yaw: e.rot * (Math.PI / 2) };
  }

  claimBed(pet) {
    if (pet.spec.rideable) return null; // ponies and unicorns are too big for pet beds
    if (pet.bedUid !== null && this.bedSpot(pet.bedUid)) return this.bedSpot(pet.bedUid);
    let best = null, bd = 40 * 40;
    for (const e of this._beds()) {
      const owner = this.bedClaims.get(e.uid);
      if (owner && owner !== pet && this.pets.includes(owner)) continue;
      const d = (e.x + 0.5 - pet.pos.x) ** 2 + (e.z + 0.5 - pet.pos.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return null;
    this.bedClaims.set(best.uid, pet);
    pet.bedUid = best.uid;
    return this.bedSpot(best.uid);
  }

  releaseBed(pet) {
    if (pet.bedUid !== null && this.bedClaims.get(pet.bedUid) === pet) this.bedClaims.delete(pet.bedUid);
    pet.bedUid = null;
    pet.inBed = false;
  }

  // ---------- spots ----------

  /** A free standing spot for this pet near (x, y, z), between rMin and rMax away. */
  findSpot(pet, x, y, z, rMin = 1, rMax = 2.5) {
    const g = this.game, ph = g.physics, w = g.world;
    if (!ph || !w) return null;
    const hw = pet.spec.halfW, h = pet.spec.height;
    const tries = 28;
    for (let i = 0; i < tries; i++) {
      const a = (i / tries) * Math.PI * 2 * 3.1 + Math.random() * 0.3;
      const r = i === 0 && rMin === 0 ? 0 : rMin + (rMax - rMin) * ((i % 5) / 4);
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      if (px < 1 || pz < 1 || px > w.sx - 1 || pz > w.sz - 1) continue;
      const y0 = Math.floor(y);
      for (let yy = y0 + 3; yy >= y0 - 8; yy--) {
        if (yy < 0) break;
        if (ph.bodyBlocked(px, yy + 0.01, pz, hw, h)) continue;
        if (!ph.bodyBlocked(px, yy - 0.25, pz, hw, 0.25)) continue;
        if (!pet.spec.swims && ph.liquidAt(px, yy + 0.2, pz)) break;
        return [px, yy + 0.01, pz];
      }
    }
    return null;
  }

  // ---------- frame ----------

  update(dt) {
    const g = this.game;
    if (!g.world || g.mode !== 'play' || g.loading) return;
    if (g.paused) {
      if (this.ui) this.ui.update(dt);
      return;
    }
    const pl = g.player;
    if (pl) {
      const moving = Math.hypot(pl.velocity.x, pl.velocity.z) > 0.2 || pl.state === 'ride';
      this.playerStillT = moving ? 0 : this.playerStillT + dt;
    }
    if (this.remote) for (let i = 0; i < this.pets.length; i++) this.pets[i].puppet(dt);
    else for (let i = 0; i < this.pets.length; i++) this.pets[i].update(dt);
    this.zzz.update(dt);
    // unicorn trails + sparkles
    this._sparkT -= dt;
    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i], pet = trail.pet;
      const fast = pet.hs > 2.4 || (pet.riding && (!pet.onGround || pet.hs > 1.2));
      if (fast) {
        const s = Math.sin(pet.yaw), c = Math.cos(pet.yaw);
        trail.push(pet.pos.x - s * 0.62, pet.pos.y + 0.98 + pet.rig.body.position.y - pet.rig.bodyY, pet.pos.z - c * 0.62);
        if (this._sparkT <= 0 && g.particles) {
          _v.set(pet.pos.x - s * 0.7, pet.pos.y + 1, pet.pos.z - c * 0.7);
          g.particles.emit('sparkle', _v, { count: 2, spread: 0.4 });
        }
      }
      trail.update(dt);
    }
    if (this._sparkT <= 0) this._sparkT = 0.12;
    // horns glow softly
    this._glowT += dt;
    for (const pet of this.pets) {
      if (pet.rig.horn) pet.rig.horn.children[0].material.emissiveIntensity = 0.45 + Math.sin(this._glowT * 2.4) * 0.2;
    }
    // snacks being nibbled
    for (let i = this.snacks.length - 1; i >= 0; i--) {
      const s = this.snacks[i];
      s.life -= dt;
      const bites = Math.floor((2.2 - s.life) / 0.55);
      if (bites > s.bites && g.particles) {
        s.bites = bites;
        _v.copy(s.m.position);
        _v.y += 0.12;
        g.particles.emit('sparkle', _v, { count: 5, color: s.color, spread: 0.2, scale: 0.7 });
      }
      s.m.scale.setScalar(s.base * Math.max(0.05, s.life / 2.2));
      if (s.life <= 0) {
        this.group.remove(s.m);
        disposeObject(s.m);
        this.snacks.splice(i, 1);
      }
    }
    if (this.ui) this.ui.update(dt);
  }

  // ---------- world lifecycle ----------

  clear() {
    if (this.rider) this.rider.riding = false;
    this.rider = null;
    for (const pet of this.pets) {
      this.game.pickables.delete(pet.pickable);
      pet.dispose();
    }
    this.pets = [];
    for (const t of this.trails) t.dispose();
    this.trails.length = 0;
    this.bedClaims.clear();
    for (const s of this.snacks) {
      this.group.remove(s.m);
      disposeObject(s.m);
    }
    this.snacks = [];
    this.zzz.clear();
  }

  serialize() {
    return this.pets.map((p) => p.serialize());
  }

  deserialize(list) {
    if (!Array.isArray(list)) return;
    for (const d of list.slice(0, MAX_PETS)) {
      if (!d || !SPECIES[d.species]) continue;
      const pet = this._add(d);
      // saved inside something (a block built later)? pop out to a free spot
      const ph = this.game.physics;
      if (ph && ph.bodyBlocked(pet.pos.x, pet.pos.y + 0.01, pet.pos.z, pet.spec.halfW, pet.spec.height)) {
        const s = this.findSpot(pet, pet.pos.x, pet.pos.y, pet.pos.z, 0.5, 3);
        if (s) pet.pos.set(s[0], s[1], s[2]);
      }
      pet.groundY = pet.pos.y;
    }
  }
}

// ---------- Bag items: one adoption item per species ----------

function spotFromHit(game, sys, species, hit) {
  const props = game.registry.blocks.props;
  let cell = hit.place;
  if (hit.type === 'block' && props.replaceable[hit.id]) cell = [hit.x, hit.y, hit.z];
  const probe = { spec: SPECIES[species] };
  const x = cell[0] + 0.5, y = cell[1], z = cell[2] + 0.5;
  const ph = game.physics;
  if (ph && !ph.bodyBlocked(x, y + 0.01, z, probe.spec.halfW, probe.spec.height) && ph.bodyBlocked(x, y - 0.25, z, probe.spec.halfW, 0.25)) {
    return [x, y + 0.01, z];
  }
  const s = sys.findSpot(probe, x, y + 1, z, 0, 2.2);
  return s;
}

export function install(game) {
  const sys = new PetSystem(game);
  game.pets = sys;
  for (const k of SPECIES_KEYS) game.registry.pets.set(k, SPECIES[k]);

  for (const species of SPECIES_KEYS) {
    const spec = SPECIES[species];
    game.registry.items.register({
      key: 'pet:' + species,
      name: spec.name,
      category: 'pets',
      kind: 'other',
      icon: () => petThumb(game, species, spec.variants[0].key),
      use(g, hit) {
        if (!hit) return false;
        if (sys._refused()) return false;
        if (sys.pets.length >= MAX_PETS) {
          g.toast(`You have ${MAX_PETS} pets! That's so much love!`, { icon: 'heart' });
          return false;
        }
        const spot = spotFromHit(g, sys, species, hit);
        if (!spot) {
          g.toast('Tap on the ground!', { icon: 'heart' });
          return false;
        }
        g.ui.open('adopt', { species, spot });
        return true;
      },
    });
  }

  game.addSystem({
    name: 'pets',
    onWorldLoad() {
      sys.clear();
      game.scene.add(sys.group);
    },
    onWorldUnload() {
      sys.clear();
      game.scene.remove(sys.group);
    },
    update: (dt) => sys.update(dt),
    serialize: () => sys.serialize(),
    deserialize: (data) => sys.deserialize(data),
  });

  sys.ui = installPetUI(game, sys);
  installPetStickers(game);
  installFriends(game);
  game.registerAction('pets', (g) => g.ui && g.ui.open('pets'));

  // wake everyone up in the morning; curl up when she goes to sleep
  game.events.on('time:morning', () => {
    if (sys.remote) return; // the host's pets wake up at the host's
    for (const p of sys.pets) {
      if (p.state === 'sleep' || p.state === 'toBed') {
        p.wake();
        p.anim.happy = 2;
      }
    }
  });
  game.events.on('player:sleep', () => {
    if (sys.remote) return;
    for (const p of sys.pets) if (!p.riding && p.isNearPlayer(16) && p.state !== 'sleep') {
      p.state = 'sleep';
      p.zzzT = 0.6;
    }
  });
  // keyboard: E or X hops off while riding
  let spaceAt = -1e9;
  game.input.on('key', (e) => {
    if (e.down && e.code === 'Space') spaceAt = performance.now();
    if (!e.down || e.repeat || !sys.rider || game.paused) return;
    if (e.code === 'KeyX' || e.code === 'KeyE') sys.dismount();
  });
  // a quick double-tap of Space (the player's fly shortcut) while riding is meant for the
  // unicorn, not for hopping off: put her right back in the saddle
  game.events.on('player:fly', ({ flying }) => {
    const pet = sys.rider, pl = game.player;
    if (!flying || !pet || !pl || performance.now() - spaceAt > 450) return;
    pl.setFlying(false);
    pl.mount(pet);
    pet.syncRider();
  });

  // debug helpers for play tests
  if (game.debug) {
    game.debug.pets = {
      list: () => sys.pets.map((p) => ({ id: p.id, species: p.species, variant: p.variant, name: p.name, mode: p.mode, state: p.state, x: p.pos.x, y: p.pos.y, z: p.pos.z })),
      adopt: (species, variant, name, x, y, z, opts) => {
        const pet = sys.adopt(species, variant, name || SPECIES[species].names[0], x === undefined || x === null ? null : [x, y, z], { opts });
        return pet ? pet.id : null;
      },
      tickle: (id) => { const p = sys.byId(id); return p ? sys.tickle(p) : false; },
      info: (id) => {
        const p = sys.byId(id);
        if (!p) return null;
        let meshes = 0;
        p.object3d.traverse((o) => { if (o.isMesh || o.isSprite) meshes++; });
        return { id: p.id, species: p.species, variant: p.variant, opts: p.opts, merged: !!p.rig.skinned, meshes, hide: p.anim.hide, riding: p.riding, swimming: p.swimming };
      },
      pet: (id) => { const p = sys.byId(id); return p ? sys.petPet(p) : false; },
      feed: (id, key) => { const p = sys.byId(id); return p ? sys.feed(p, key) : false; },
      ride: (id) => { const p = sys.byId(id); return p ? sys.mount(p) : false; },
      dismount: () => sys.dismount(),
      remove: (id) => { const p = sys.byId(id); return p ? sys.remove(p) : false; },
      setMode: (id, mode) => { const p = sys.byId(id); if (p) sys.setMode(p, mode, { quiet: true }); return !!p; },
    };
  }
  void basketCount;
}
