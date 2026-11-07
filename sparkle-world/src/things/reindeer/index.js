// wave 5 (reindeer team, docs/teams/reindeer.md): reindeer to pet, feed and ride, the pasture
// herd, flying in Holiday Village and the flying Jingle Sleigh's stickers and coins.
//
// - The reindeer is a pet species (src/things/pets/reindeer.js, appended last): Bag -> Pets,
//   pet / feed a carrot / ride like the pony. Its spec's `flies` asks this module's sky check
//   (Holiday Village, or game.debug.reindeer.sky(true)), so pet.js flies it there like the
//   unicorn: Jump takes off and climbs, Down dives, letting go glides down softly.
// - The pasture herd: the holiday biome's `holiday:reindeer` record { x, y, z, n } puts n
//   (1..4) reindeer there as ordinary home-mode pets (host only; they sync like every pet).
// - The sleigh: the `holiday:sleigh` record { x, y, z, rot } parks a Jingle Sleigh there
//   (src/things/vehicles: the flying physics live in drive.js).
// - Flying here: a stardust ribbon and sparkles behind a flying reindeer, a jingle now and
//   then, and the Land button (life column) for a flying reindeer or the sleigh in the air.
// - Stickers reindeer_friend, reindeer_rider, sleigh_ride; coins: a reindeer's first flight of
//   the day +2, the sleigh's +3 (5 a day at most), only through game.coins.add.
//
// Events: 'reindeer:fly' { pet }, 'reindeer:land' { pet }, 'reindeer:herd' { n, x, y, z }.
// Profile: profile.reindeer (logic.state: always read with a default).

import { makeId } from '../../core/util.js';
import { lifeHud } from '../pets/kit.js';
import { RainbowTrail, STARDUST } from '../pets/fx.js';
import { sfx } from '../pets/sfx.js';
import { SPECIES } from '../pets/species.js';
import {
  STRINGS, setSky, skyAllowed, herdCount, herdSpots, herdNames, herdCoats, coinFor, state, dayStamp,
} from './logic.js';

const GOLDS = ['#FFFFFF', '#FFE38A', '#FFD43B'];
const fin = Number.isFinite;

export function install(game) {
  const sys = new ReindeerSystem(game);
  setSky(() => sys.skyNow());
  game.addSystem({
    name: 'reindeer',
    onWorldLoad: () => sys.onWorldLoad(),
    onWorldUnload: () => sys.onWorldUnload(),
    update: (dt) => sys.update(dt),
  });
  if (game.worldFeatures) {
    game.worldFeatures.on('holiday:reindeer', (g, rec) => sys.placeHerd(rec));
    game.worldFeatures.on('holiday:sleigh', (g, rec) => sys.placeSleigh(rec));
  }
  sys.installStickers();
  sys.installEvents();
  sys.installHud();
  game.reindeer = sys.facade();
  if (game.debug) game.debug.reindeer = sys.debugApi();
}

class ReindeerSystem {
  constructor(game) {
    this.game = game;
    this.skyOverride = null; // debug: true / false forces the sky check
    this.trails = new Map(); // pet -> RainbowTrail (flying reindeer)
    this.flyingPet = null; // the ridden reindeer that is in the air (her own)
    this.landingPet = false; // the Land button holds Down until it touches down
    this.sparkT = 0;
    this.bellT = 0;
    this.hudT = 0;
    this.hud = null;
    this.landShown = false;
    this.award = () => {};
    this.stats = { herds: 0, herdPets: 0, sleighs: 0, flights: 0, coins: 0 };
  }

  // ---------- the sky ----------

  /** May a ridden reindeer fly here and now? (never throws) */
  skyNow() {
    const w = this.game.world;
    if (!w || !w.meta) return this.skyOverride === true;
    return skyAllowed(w.meta.biome, this.skyOverride);
  }

  // ---------- world features (host only: features.js never runs them on a guest) ----------

  /** holiday:reindeer { x, y, z, n }: n reindeer in the pasture as home-mode pets. */
  placeHerd(rec) {
    const g = this.game, P = g.pets;
    if (!P || !g.world || !rec || ![rec.x, rec.y, rec.z].every(fin)) return false;
    const max = fin(P.max) ? P.max : 12;
    const n = herdCount(rec, P.pets.length, max);
    if (n <= 0) return false;
    const seed = ((Math.floor(rec.x) * 73856093) ^ (Math.floor(rec.z) * 19349663) ^ ((g.world.meta && g.world.meta.seed) | 0)) >>> 0;
    const spots = herdSpots(rec, n, seed);
    const names = herdNames(n, seed);
    const coats = herdCoats(n, seed);
    const probe = { spec: SPECIES.reindeer };
    const list = [];
    for (let i = 0; i < spots.length; i++) {
      const [x, y, z] = spots[i];
      // a free standing spot right there, else nearby in the pasture, else the middle
      const s = P.findSpot(probe, x, y + 1, z, 0, 0.8) || P.findSpot(probe, rec.x + 0.5, rec.y + 1, rec.z + 0.5, 0.5, 2.6);
      if (!s) continue;
      list.push({
        id: makeId('pet'), species: 'reindeer', variant: coats[i], name: names[i], mode: 'home',
        x: s[0], y: s[1], z: s[2], yaw: (seed % 628) / 100 + i * 1.7, home: [s[0], s[1], s[2]],
        adoptedAt: Date.now(), love: 0,
      });
    }
    if (!list.length) return false;
    P.deserialize(list); // no 'pet:adopt' (not her adoption), saved and synced like every pet
    this.stats.herds++;
    this.stats.herdPets += list.length;
    g.events.emit('reindeer:herd', { n: list.length, x: rec.x, y: rec.y, z: rec.z });
    return true;
  }

  /** holiday:sleigh { x, y, z, rot }: a parked Jingle Sleigh (its spot, else near, else forced). */
  placeSleigh(rec) {
    const g = this.game, V = g.vehicles;
    if (!V || typeof V.placeRecord !== 'function' || !rec || ![rec.x, rec.y, rec.z].every(fin)) return false;
    const rot = Number.isInteger(rec.rot) && rec.rot >= 0 && rec.rot <= 3 ? rec.rot : 0;
    const e = V.placeRecord({ key: 'sleigh', x: Math.floor(rec.x), y: Math.floor(rec.y), z: Math.floor(rec.z), rot, color: '#E8304A', data: {} });
    if (e) this.stats.sleighs++;
    return !!e;
  }

  // ---------- stickers, coins, events ----------

  installStickers() {
    const g = this.game;
    const register = () => {
      const reg = g.registry.stickers;
      if (!reg) return;
      for (const s of STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
    };
    g.events.on('game:ready', register);
    this.award = (id) => {
      register();
      if (g.stickers && !g.stickers.has(id)) g.award(id);
    };
  }

  /** A daily coin for this action (logic.coinFor), through game.coins.add only. */
  _coin(reason, at) {
    const g = this.game;
    if (!g.coins || typeof g.coins.add !== 'function' || !g.profile) return 0;
    const n = coinFor(g.profile, reason, dayStamp());
    if (n > 0) {
      // the coins fly from where it happened (a world point { x, y, z })
      const from = Array.isArray(at) && at.every(fin) ? { x: at[0], y: at[1], z: at[2] } : null;
      g.coins.add(n, 'reindeer', from ? { at: from } : {});
      this.stats.coins += n;
    }
    g.saveProfile();
    return n;
  }

  installEvents() {
    const g = this.game;
    g.events.on('pet:pet', ({ pet } = {}) => {
      if (g.net?.remoteApplying) return;
      if (!pet || pet.species !== 'reindeer') return;
      const s = state(g.profile);
      s.petted++;
      this.award('reindeer_friend');
    });
    g.events.on('pet:feed', ({ pet } = {}) => {
      if (g.net?.remoteApplying) return;
      if (!pet || pet.species !== 'reindeer') return;
      // a jingle from the collar as it munches
      setTimeout(() => sfx(g, 'jingle', { volume: 0.5 }), 600);
    });
    g.events.on('pet:ride', ({ pet } = {}) => {
      if (g.net?.remoteApplying) return;
      if (!pet || pet.species !== 'reindeer') return;
      const s = state(g.profile);
      s.rides++;
      g.saveProfile();
      sfx(g, 'jingle', { volume: 0.7 });
      this.award('reindeer_rider');
    });
    g.events.on('sleigh:takeoff', () => {
      if (g.net?.remoteApplying) return;
      const s = state(g.profile);
      s.sleighFlights++;
      this.award('sleigh_ride');
      const V = g.vehicles, pose = V && V.pose ? V.pose() : null;
      const n = this._coin('sleigh', pose ? [pose.x, pose.y + 1.5, pose.z] : null);
      if (n > 0 || s.sleighFlights === 1) g.toast(STRINGS.sleighUp, { icon: 'star' });
    });
  }

  // ---------- the Land button (life column) ----------

  installHud() {
    const g = this.game;
    if (!g.ui) return;
    const hud = lifeHud(g);
    this.hud = hud;
    const b = hud.add('rdland', { icon: 'rd_land', label: 'Land', color: 'var(--sw-sky)', order: 2, onClick: () => this.land() });
    // holding it also holds Down (a quick way down); letting go stops the Down press
    const input = g.input;
    const up = () => { if (!this.landingPet) input.press('down', false); };
    b.addEventListener('pointerdown', () => input.press('down', true));
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }

  /** Come down now: the sleigh (drive.js land) or her flying reindeer (holds Down). */
  land() {
    const g = this.game;
    const V = g.vehicles;
    if (V && typeof V.flying === 'function' && V.flying()) {
      V.land();
      g.toast(STRINGS.landing, { icon: 'star', duration: 1200 });
      return true;
    }
    if (this.flyingPet) {
      this.landingPet = true;
      g.input.press('down', true);
      return true;
    }
    return false;
  }

  _refreshHud(dt) {
    if (!this.hud) return;
    this.hudT -= dt;
    if (this.hudT > 0) return;
    this.hudT = 0.15;
    const V = this.game.vehicles;
    const sky = !!this.flyingPet || !!(V && typeof V.flying === 'function' && V.flying());
    if (sky !== this.landShown) {
      this.landShown = sky;
      this.hud.show('rdland', sky);
    }
  }

  // ---------- per frame ----------

  onWorldLoad() {
    this._clearTrails();
    this.flyingPet = null;
    this._endLanding();
  }

  onWorldUnload() {
    this._clearTrails();
    this.flyingPet = null;
    this._endLanding();
    if (this.hud && this.landShown) {
      this.landShown = false;
      this.hud.show('rdland', false);
    }
  }

  _endLanding() {
    if (this.landingPet) {
      this.landingPet = false;
      if (this.game.input) this.game.input.press('down', false);
    }
  }

  _clearTrails() {
    for (const t of this.trails.values()) t.dispose();
    this.trails.clear();
  }

  update(dt) {
    const g = this.game;
    if (!g.world || g.mode !== 'play' || !(dt > 0)) return;
    const P = g.pets;
    if (P && Array.isArray(P.pets)) {
      this._riderFlight(P);
      this._trails(P, dt);
    }
    this._refreshHud(dt);
  }

  /** Her own ridden reindeer: take-off and touch-down (events, the coin, the Land button). */
  _riderFlight(P) {
    const g = this.game;
    const pet = P.rider && P.rider.species === 'reindeer' && !P.remote ? P.rider : null;
    const flying = !!(pet && pet.anim && pet.anim.flying);
    if (flying && this.flyingPet !== pet) {
      this.flyingPet = pet;
      const s = state(g.profile);
      s.flights++;
      this.stats.flights++;
      const at = [pet.pos.x, pet.pos.y + 1.6, pet.pos.z];
      g.celebrate(at, 'sparkle', { quiet: true, count: 12, colors: GOLDS });
      sfx(g, 'sleighbells', { volume: 0.6 });
      if (s.flights === 1) g.toast(STRINGS.firstFly, { icon: 'star', duration: 3600 });
      this._coin('fly', at);
      g.events.emit('reindeer:fly', { pet });
    } else if (!flying && this.flyingPet) {
      const was = this.flyingPet;
      this.flyingPet = null;
      this._endLanding();
      if (pet === was) {
        g.celebrate([was.pos.x, was.pos.y + 0.2, was.pos.z], 'snowflake', { quiet: true, count: 8, spread: 1.2 });
        g.audio.play('step', { volume: 0.7, pitch: 1.3 });
      }
      g.events.emit('reindeer:land', { pet: was });
    }
  }

  /** Stardust ribbons behind every flying reindeer (hers and friends'), sparkles, bells. */
  _trails(P, dt) {
    const g = this.game;
    this.sparkT -= dt;
    this.bellT -= dt;
    let bells = false;
    for (let i = 0; i < P.pets.length; i++) {
      const pet = P.pets[i];
      if (pet.species !== 'reindeer') continue;
      const flying = !!(pet.anim && pet.anim.flying);
      let t = this.trails.get(pet);
      if (!t && flying && P.group) {
        t = new RainbowTrail(P.group, { colors: STARDUST, width: 0.46, life: 1.4 });
        this.trails.set(pet, t);
      }
      if (!t) continue;
      if (flying) {
        const s = Math.sin(pet.yaw), c = Math.cos(pet.yaw);
        const y = pet.pos.y + 0.95 + (pet.rig ? pet.rig.body.position.y - pet.rig.bodyY : 0);
        if ([pet.pos.x, y, pet.pos.z].every(fin)) {
          t.push(pet.pos.x - s * 0.6, y, pet.pos.z - c * 0.6);
          if (this.sparkT <= 0 && g.particles) g.particles.emit('sparkle', [pet.pos.x - s * 0.7, y, pet.pos.z - c * 0.7], { count: 2, spread: 0.45, colors: GOLDS });
          if (pet === this.flyingPet) bells = true;
        }
      }
      t.update(dt);
    }
    if (this.sparkT <= 0) this.sparkT = 0.1;
    if (bells && this.bellT <= 0) {
      this.bellT = 1.2 + Math.random() * 0.6;
      sfx(g, 'jingle', { volume: 0.4 });
    }
    // a pet that left (removed, a new world): drop its ribbon
    if (this.trails.size) {
      for (const [pet, t] of this.trails) {
        if (!P.pets.includes(pet)) {
          t.dispose();
          this.trails.delete(pet);
        }
      }
    }
  }

  // ---------- facade and debug ----------

  facade() {
    const sys = this, g = this.game;
    return {
      /** May a ridden reindeer fly here? */
      canFly: () => sys.skyNow(),
      /** Is she flying (a reindeer or the sleigh)? */
      flying: () => !!sys.flyingPet || !!(g.vehicles && typeof g.vehicles.flying === 'function' && g.vehicles.flying()),
      land: () => sys.land(),
      /** The reindeer pets in this world (hers and the pasture's). */
      herd: () => (g.pets && Array.isArray(g.pets.pets) ? g.pets.pets.filter((p) => p.species === 'reindeer') : []),
      placeHerd: (rec) => sys.placeHerd(rec),
      placeSleigh: (rec) => sys.placeSleigh(rec),
    };
  }

  debugApi() {
    const sys = this, g = this.game;
    return {
      /** Force the sky check: true (fly anywhere), false (never), null (Holiday Village). */
      sky(on = null) {
        sys.skyOverride = on === true || on === false ? on : null;
        return sys.skyNow();
      },
      state: () => ({
        sky: sys.skyNow(), flyingPet: sys.flyingPet ? sys.flyingPet.id : null, landing: sys.landingPet,
        trails: sys.trails.size, landShown: sys.landShown, profile: { ...state(g.profile) }, stats: { ...sys.stats },
      }),
      herd: (x, y, z, n = 3) => sys.placeHerd({ kind: 'holiday:reindeer', x, y, z, n }),
      sleigh: (x, y, z, rot = 0) => sys.placeSleigh({ kind: 'holiday:sleigh', x, y, z, rot }),
      land: () => sys.land(),
    };
  }
}

// ---------- stickers (100 x 100 art, like src/things/vehicles/stickers.js) ----------

function paint(g, fill, stroke = 'rgba(58,31,77,0.55)', w = 2.6) {
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = stroke;
    g.lineWidth = w;
    g.stroke();
  }
}

function antlers(g, cx, cy, s, color) {
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineWidth = 4.5 * s;
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + d * 8 * s, cy);
    g.lineTo(cx + d * 15 * s, cy - 18 * s);
    g.lineTo(cx + d * 18 * s, cy - 30 * s);
    g.moveTo(cx + d * 14 * s, cy - 15 * s);
    g.lineTo(cx + d * 25 * s, cy - 20 * s);
    g.moveTo(cx + d * 16.5 * s, cy - 24 * s);
    g.lineTo(cx + d * 10 * s, cy - 31 * s);
    g.stroke();
  }
}

/** A reindeer face with antlers, a dark nose and a heart. */
function friendArt(g) {
  antlers(g, 50, 36, 1, '#E2C08A');
  // ears
  for (const d of [-1, 1]) {
    g.beginPath(); g.ellipse(50 + d * 26, 46, 11, 5.5, d * 0.35, 0, Math.PI * 2); paint(g, '#B07C52');
  }
  // head and muzzle
  g.beginPath(); g.ellipse(50, 58, 22, 24, 0, 0, Math.PI * 2); paint(g, '#B07C52');
  g.beginPath(); g.ellipse(50, 70, 14, 11, 0, 0, Math.PI * 2); paint(g, '#F2DCC2');
  g.beginPath(); g.ellipse(50, 64.5, 6.5, 4.5, 0, 0, Math.PI * 2); paint(g, '#4A332A', false);
  g.beginPath(); g.ellipse(48, 63.4, 2, 1.2, 0, 0, Math.PI * 2); paint(g, '#FFFFFF', false);
  for (const d of [-1, 1]) {
    g.beginPath(); g.arc(50 + d * 10, 53, 4.2, 0, Math.PI * 2); paint(g, '#3A1F4D', false);
    g.beginPath(); g.arc(50 + d * 10 - 1.4, 51.6, 1.5, 0, Math.PI * 2); paint(g, '#FFFFFF', false);
    g.beginPath(); g.ellipse(50 + d * 17, 62, 3.6, 2.2, 0, 0, Math.PI * 2); paint(g, '#FF9EBE', false);
  }
  g.beginPath(); g.arc(50, 72, 4, 0.25, Math.PI - 0.25); g.strokeStyle = '#3A1F4D'; g.lineWidth = 2; g.stroke();
  // a heart
  g.beginPath();
  g.moveTo(82, 26); g.bezierCurveTo(82, 20, 74, 18, 74, 25); g.bezierCurveTo(74, 30, 82, 34, 82, 37);
  g.bezierCurveTo(82, 34, 90, 30, 90, 25); g.bezierCurveTo(90, 18, 82, 20, 82, 26); g.closePath();
  paint(g, '#FF5FA2');
}

/** A reindeer from the side with a red saddle and a gold bell, on snow. */
function riderArt(g) {
  g.beginPath(); g.moveTo(0, 84); g.quadraticCurveTo(50, 74, 100, 84); g.lineTo(100, 100); g.lineTo(0, 100); g.closePath(); paint(g, '#FFFFFF', 'rgba(58,31,77,0.25)');
  // legs
  for (const x of [30, 40, 62, 72]) { g.beginPath(); g.rect(x - 3.5, 58, 7, 24); paint(g, '#8A5A3A'); }
  // body, saddle, tail
  g.beginPath(); g.ellipse(51, 54, 28, 14, 0, 0, Math.PI * 2); paint(g, '#B07C52');
  g.beginPath(); g.ellipse(22, 48, 5, 4, 0, 0, Math.PI * 2); paint(g, '#FFFFFF');
  g.beginPath(); g.rect(42, 38, 20, 16); paint(g, '#E8304A');
  for (const x of [45, 52, 59]) { g.beginPath(); g.arc(x, 56, 2.4, 0, Math.PI * 2); paint(g, '#F2C14E', false); }
  // neck and head
  g.beginPath(); g.moveTo(68, 50); g.lineTo(76, 30); g.lineTo(86, 34); g.lineTo(80, 52); g.closePath(); paint(g, '#B07C52');
  g.beginPath(); g.ellipse(84, 30, 9, 8, 0.3, 0, Math.PI * 2); paint(g, '#B07C52');
  g.beginPath(); g.arc(92, 33, 2.6, 0, Math.PI * 2); paint(g, '#4A332A', false);
  g.beginPath(); g.arc(84, 27, 1.8, 0, Math.PI * 2); paint(g, '#3A1F4D', false);
  g.beginPath(); g.arc(77, 44, 3.6, 0, Math.PI * 2); paint(g, '#F2C14E');
  antlers(g, 82, 22, 0.55, '#E2C08A');
}

/** The sleigh flying past the moon with a sparkle trail. */
function sleighArt(g) {
  g.beginPath(); g.arc(70, 30, 20, 0, Math.PI * 2); paint(g, '#FFF3B0', 'rgba(58,31,77,0.25)');
  // the trail
  g.lineCap = 'round';
  for (const [w, c] of [[9, '#FFE38A'], [4, '#FFFFFF']]) {
    g.beginPath(); g.moveTo(4, 86); g.quadraticCurveTo(20, 70, 34, 70); g.strokeStyle = c; g.lineWidth = w; g.stroke();
  }
  for (const [x, y] of [[10, 76], [20, 84], [26, 66]]) {
    g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 1.6, y - 1.6); g.lineTo(x + 5, y); g.lineTo(x + 1.6, y + 1.6); g.lineTo(x, y + 5);
    g.lineTo(x - 1.6, y + 1.6); g.lineTo(x - 5, y); g.lineTo(x - 1.6, y - 1.6); g.closePath(); paint(g, '#FFD43B', false);
  }
  // the sleigh: a red tub with a gold runner
  g.beginPath(); g.moveTo(30, 58); g.lineTo(62, 58); g.quadraticCurveTo(64, 70, 54, 72); g.lineTo(34, 72); g.quadraticCurveTo(28, 66, 30, 58); g.closePath(); paint(g, '#E8304A');
  g.beginPath(); g.moveTo(28, 78); g.lineTo(62, 78); g.quadraticCurveTo(70, 78, 68, 70); g.strokeStyle = '#F2C14E'; g.lineWidth = 3.4; g.stroke();
  for (const x of [36, 54]) { g.beginPath(); g.moveTo(x, 72); g.lineTo(x, 78); g.stroke(); }
  // a reindeer in front, leaping
  g.beginPath(); g.ellipse(80, 54, 11, 6, -0.25, 0, Math.PI * 2); paint(g, '#B07C52');
  g.beginPath(); g.ellipse(91, 44, 5, 4.5, 0, 0, Math.PI * 2); paint(g, '#B07C52');
  for (const [x0, y0, x1, y1] of [[86, 57, 94, 62], [84, 58, 90, 64], [74, 58, 66, 62], [76, 59, 70, 65]]) {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = '#8A5A3A'; g.lineWidth = 3; g.stroke();
  }
  g.beginPath(); g.moveTo(62, 60); g.lineTo(76, 54); g.strokeStyle = '#C0263C'; g.lineWidth = 1.8; g.stroke();
  antlers(g, 91, 40, 0.38, '#E2C08A');
}

const STICKERS = [
  { id: 'reindeer_friend', name: 'Reindeer Friend', hint: 'Pet a reindeer', icon: 'heart', art: friendArt },
  { id: 'reindeer_rider', name: 'Reindeer Rider', hint: 'Ride a reindeer', icon: 'star', art: riderArt },
  { id: 'sleigh_ride', name: 'Sleigh Ride', hint: 'Fly the sleigh', icon: 'star', art: sleighArt },
];
