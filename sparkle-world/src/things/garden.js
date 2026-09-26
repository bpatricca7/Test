// Garden (Pets/Garden/Cooking team): seeds in the Bag's Garden tab, tilling grass/dirt into
// farmland, the watering can, growth through 4 stages driven by game.time (faster when the
// soil is wet; a night's sleep and rain help too), sparkles when ready, harvest with the
// Hand (crops fly into profile.basket), flowers picked into bouquets. Saved per world
// ('garden' system). Events: 'garden:plant' { plant }, 'garden:harvest' { plant, crop, count }.
// API: game.garden (see Garden below).

import * as THREE from 'three';
import { CROPS, CROP_KEYS, stageGeometry, stageHeight, plantThumbObject, wateringCanObject } from './garden/crops.js';
import { sfx } from './pets/sfx.js';
import { basketAdd, loadImage, VC_MAT } from './pets/kit.js';
import { foodModel, foodName } from './food-models.js';
import { disposeObject } from '../core/models.js';
import { hash3, jitter } from '../core/util.js';

const WET_TIME = 90; // seconds of game time the soil stays wet
const WET_BOOST = 1.9; // growth speed while wet
const TICK = 0.25;
const SOIL_OK = new Set(['grass', 'dirt', 'farmland', 'farmland_wet']);
const TILLABLE = new Set(['grass', 'dirt']);
const _v = new THREE.Vector3();

// ---------- farmland blocks (registered only if the Blocks team did not) ----------

function paintFarmland(wet) {
  return (ctx, rand) => {
    const base = wet ? '#7C5438' : '#A5744C', dark = wet ? '#5F3F2A' : '#86593A', light = wet ? '#916448' : '#BE8A5C';
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const row = y % 4;
        let c = row === 0 ? dark : row === 3 ? light : base;
        if (rand() < 0.08) c = row === 0 ? base : dark;
        ctx.fillStyle = jitter(c, rand, 0.03);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    if (wet) {
      ctx.fillStyle = 'rgba(190,232,255,0.65)';
      for (let i = 0; i < 6; i++) ctx.fillRect(Math.floor(rand() * 15), Math.floor(rand() * 4) * 4 + 2, 2, 1);
    }
  };
}

function registerFarmland(game) {
  const B = game.registry.blocks;
  if (!B.byKey('farmland')) {
    B.tile('farmland_top', paintFarmland(false));
    B.register({ key: 'farmland', name: 'Farmland', category: 'garden', tiles: { top: 'farmland_top', side: 'dirt', bottom: 'dirt' } });
  }
  if (!B.byKey('farmland_wet')) {
    B.tile('farmland_wet_top', paintFarmland(true));
    B.register({ key: 'farmland_wet', name: 'Wet Farmland', category: 'garden', hidden: true, tiles: { top: 'farmland_wet_top', side: 'dirt', bottom: 'dirt' } });
  }
}

// ---------- seed packet icons ----------

async function seedPacketIcon(game, crop) {
  const c = CROPS[crop];
  const url = await game.thumbs.get('plant:' + crop, () => plantThumbObject(crop, 3), { dir: [0.8, 0.8, 1.4], zoom: 0.92 });
  const img = await loadImage(url);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const g = cv.getContext('2d');
  // the packet: rounded paper with a zigzag top and a folded band
  g.save();
  g.translate(48, 50);
  g.rotate(-0.08);
  const w = 64, h = 80, x = -w / 2, y = -h / 2;
  g.shadowColor = 'rgba(58,31,77,0.25)';
  g.shadowBlur = 5;
  g.shadowOffsetY = 3;
  g.beginPath();
  g.moveTo(x, y + 6);
  for (let i = 0; i <= 8; i++) g.lineTo(x + (i * w) / 8, y + (i % 2 ? 0 : 6));
  g.lineTo(x + w, y + h - 10);
  g.quadraticCurveTo(x + w, y + h, x + w - 10, y + h);
  g.lineTo(x + 10, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - 10);
  g.closePath();
  g.fillStyle = c.packet;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 3;
  g.strokeStyle = '#FFFFFF';
  g.stroke();
  g.fillStyle = c.color;
  g.globalAlpha = 0.85;
  g.fillRect(x, y + 10, w, 7);
  g.globalAlpha = 1;
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(0, 8, 25, 0, Math.PI * 2);
  g.fill();
  if (img) g.drawImage(img, -30, -24, 60, 60);
  // seeds spilling out
  g.fillStyle = '#E8C98E';
  for (const [sx, sy] of [[-22, 30], [-14, 34], [20, 32]]) {
    g.beginPath();
    g.ellipse(sx, sy, 3.2, 2, 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  return cv.toDataURL('image/png');
}

// ---------- the garden system ----------

class Garden {
  constructor(game) {
    this.game = game;
    this.plants = new Map(); // voxel index of the plant cell -> plant
    this.list = []; // the same plants, for allocation-free per-frame loops
    this._ready = [];
    this.wet = new Map(); // voxel index of a wet farmland block -> { x, y, z, until }
    this.group = new THREE.Group();
    this.group.name = 'garden';
    this.cans = [];
    this.flyers = [];
    this._tick = 0;
    this._dormantTick = 0;
    this._dryTick = 0;
    this._sparkT = 0;
    this._sparkIdx = 0;
    this._rainTick = 0;
    this._hintAt = 0;
    this._slept = false;
    this._clock = 0;
  }

  get t() {
    return this.game.time.t;
  }

  plantAt(x, y, z) {
    const w = this.game.world;
    if (!w || !w.inBounds(x, y, z)) return null;
    return this.plants.get(w.index(x, y, z)) || null;
  }

  all() {
    return [...this.plants.values()];
  }

  // ---------- plants ----------

  addPlant(crop, x, y, z, progress = 0, wetUntil = 0) {
    const g = this.game, w = g.world;
    if (!w || !CROPS[crop] || !w.inBounds(x, y, z)) return null;
    const idx = w.index(x, y, z);
    if (this.plants.has(idx)) return null;
    const stage = progress >= 1 ? 3 : Math.min(2, Math.floor(progress * 3));
    const mesh = new THREE.Mesh(stageGeometry(crop, stage), VC_MAT);
    const h = hash3(x, y, z);
    mesh.position.set(x + 0.5, y, z + 0.5);
    mesh.rotation.y = Math.floor(h * 4) * (Math.PI / 2) + (h - 0.5) * 0.4;
    this.group.add(mesh);
    const plant = {
      crop, x, y, z, idx, progress, stage, wetUntil, mesh,
      phase: h * 20, bounce: 0, dormant: false, box: new THREE.Box3(), pickable: null,
      get name() { return CROPS[crop].name; },
      get ready() { return this.stage === 3; },
    };
    this._box(plant);
    plant.pickable = {
      object3d: mesh,
      kind: 'other',
      ref: plant,
      box: plant.box,
      onUse: () => this.harvest(plant),
      onRemove: () => this.removePlant(plant, { history: true, fx: true }),
      onBuild: (gg, hit, item) => this._onBuild(plant, item),
      hint: (gg) => this._hint(plant, gg),
    };
    g.pickables.add(plant.pickable);
    this.plants.set(idx, plant);
    this.list.push(plant);
    return plant;
  }

  _box(p) {
    const h = Math.max(0.32, stageHeight(p.crop, p.stage));
    p.box.min.set(p.x + 0.12, p.y, p.z + 0.12);
    p.box.max.set(p.x + 0.88, p.y + h, p.z + 0.88);
  }

  removePlant(plant, { history = false, fx = false } = {}) {
    if (!this.plants.has(plant.idx) || this.plants.get(plant.idx) !== plant) return false;
    this._detach(plant);
    this.plants.delete(plant.idx);
    const li = this.list.indexOf(plant);
    if (li >= 0) this.list.splice(li, 1);
    if (fx) {
      this.game.celebrate([plant.x + 0.5, plant.y + 0.3, plant.z + 0.5], 'sparkle', { quiet: true });
      this.game.audio.play('remove');
    }
    if (history) {
      const s = { crop: plant.crop, x: plant.x, y: plant.y, z: plant.z, progress: plant.progress, wet: plant.wetUntil };
      this.game.pushHistory({
        undo: () => this.addPlant(s.crop, s.x, s.y, s.z, s.progress, s.wet),
        redo: () => { const p = this.plantAt(s.x, s.y, s.z); if (p) this.removePlant(p); },
      });
    }
    return true;
  }

  _detach(plant) {
    this.group.remove(plant.mesh);
    this.game.pickables.delete(plant.pickable);
  }

  _setStage(plant, stage, fx = true) {
    if (plant.stage === stage) return;
    plant.stage = stage;
    plant.mesh.geometry = stageGeometry(plant.crop, stage);
    this._box(plant);
    plant.bounce = 0.55;
    if (fx && !plant.dormant) {
      const g = this.game;
      if (g.particles) {
        _v.set(plant.x + 0.5, plant.y + stageHeight(plant.crop, stage) * 0.7, plant.z + 0.5);
        g.particles.emit(stage === 3 ? 'star' : 'leaf', _v, { count: stage === 3 ? 8 : 4, spread: 0.4 });
      }
      if (stage === 3 && this._nearPlayer(plant, 14)) sfx(g, 'chime', { volume: 0.5 });
    }
  }

  _nearPlayer(plant, d) {
    const pl = this.game.player;
    if (!pl) return false;
    const dx = pl.position.x - plant.x - 0.5, dz = pl.position.z - plant.z - 0.5;
    return dx * dx + dz * dz < d * d;
  }

  // ---------- planting ----------

  /** Build tool with a seed item: till grass/dirt into farmland and plant. */
  plantSeed(crop, hit) {
    const g = this.game, w = g.world;
    if (!w || !hit) return false;
    if (hit.type === 'pickable') {
      const ref = hit.pickable.ref;
      if (ref && ref.crop) return this._onBuild(ref, g.registry.items.get('seed:' + crop));
      g.toast('Plant seeds on grass or dirt!', { icon: 'sparkle' });
      return false;
    }
    const props = g.registry.blocks.props;
    let { x, y, z } = hit;
    if (props.replaceable[hit.id] && props.shape[hit.id] !== 5) y -= 1; // flowers / tall grass: the ground under them
    const ground = g.registry.blocks.byId(w.get(x, y, z));
    if (!ground || !SOIL_OK.has(ground.key)) {
      g.toast('Seeds grow in grass or dirt!', { icon: 'sparkle' });
      return false;
    }
    const above = w.get(x, y + 1, z);
    if ((above !== 0 && !props.replaceable[above]) || props.shape[above] === 5 || (g.entities && g.entities.at(x, y + 1, z))) {
      g.toast('No room to grow there!', { icon: 'sparkle' });
      return false;
    }
    if (this.plantAt(x, y + 1, z)) {
      g.toast('Something is already growing here!', { icon: 'sparkle' });
      return false;
    }
    const prevGround = ground.key;
    const prevAbove = above;
    const doPlant = () => {
      if (TILLABLE.has(w.defAt(x, y, z).key)) w.setKey(x, y, z, 'farmland', { record: false });
      if (w.get(x, y + 1, z) !== 0) w.set(x, y + 1, z, 0, { record: false });
      return this.addPlant(crop, x, y + 1, z, 0, this._wetAt(x, y, z));
    };
    const plant = doPlant();
    if (!plant) return false;
    g.pushHistory({
      undo: () => {
        const p = this.plantAt(x, y + 1, z);
        if (p) this.removePlant(p);
        this.wet.delete(w.index(x, y, z));
        w.setKey(x, y, z, prevGround, { record: false });
        if (prevAbove) w.set(x, y + 1, z, prevAbove, { record: false });
      },
      redo: () => doPlant(),
    });
    sfx(g, 'till');
    setTimeout(() => sfx(g, 'pop', { pitch: 1.3 }), 90);
    if (g.particles) {
      _v.set(x + 0.5, y + 1.1, z + 0.5);
      g.particles.emit('leaf', _v, { count: 6, spread: 0.5 });
      g.particles.emit('sparkle', _v, { count: 6, spread: 0.4 });
    }
    plant.bounce = 0.5;
    g.events.emit('garden:plant', { plant });
    if (!this._taughtWater && !this.game.profile.stats.gardenWatered) {
      this._taughtWater = true;
      setTimeout(() => g.toast('Water it with the watering can to grow faster!', { icon: 'sparkle', duration: 3600 }), 700);
    }
    return true;
  }

  _wetAt(x, y, z) {
    const e = this.wet.get(this.game.world.index(x, y, z));
    return e ? e.until : 0;
  }

  // ---------- watering ----------

  /** Watering can on a hit: waters the farmland around it (3x3) and the plants on it. */
  water(hit) {
    const g = this.game, w = g.world;
    if (!w || !hit) return false;
    let cx, cy, cz;
    if (hit.type === 'pickable') {
      const ref = hit.pickable.ref;
      if (ref && ref.crop) { cx = ref.x; cy = ref.y - 1; cz = ref.z; } else [cx, cy, cz] = [Math.floor(hit.point.x), Math.floor(hit.point.y) - 1, Math.floor(hit.point.z)];
    } else {
      ({ x: cx, y: cy, z: cz } = hit);
      const props = g.registry.blocks.props;
      if (props.replaceable[hit.id] && props.shape[hit.id] !== 5) cy -= 1;
    }
    this._pourFx(cx + 0.5, cy + 1, cz + 0.5);
    const until = this.t + WET_TIME;
    let n = 0;
    w.batch(() => {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = 1; dy >= -1; dy--) {
            const x = cx + dx, y = cy + dy, z = cz + dz;
            if (!w.inBounds(x, y, z)) continue;
            const key = w.defAt(x, y, z).key;
            if (key !== 'farmland' && key !== 'farmland_wet') continue;
            if (key === 'farmland') w.setKey(x, y, z, 'farmland_wet', { record: false });
            this.wet.set(w.index(x, y, z), { x, y, z, until });
            const p = this.plantAt(x, y + 1, z);
            if (p) { p.wetUntil = until; n++; }
            break;
          }
        }
      }
    });
    if (n > 0) {
      g.profile.stats.gardenWatered = (g.profile.stats.gardenWatered || 0) + 1;
      if (!this._toldGrow) {
        this._toldGrow = true;
        setTimeout(() => g.toast('Splish splash! Now it grows super fast!', { icon: 'sparkle' }), 900);
      }
    }
    return true;
  }

  _pourFx(x, y, z) {
    const g = this.game;
    const can = wateringCanObject();
    const pl = g.player;
    const yaw = pl ? Math.atan2(x - pl.position.x, z - pl.position.z) : 0;
    can.position.set(x - Math.sin(yaw) * 0.55, y + 0.95, z - Math.cos(yaw) * 0.55);
    can.rotation.y = yaw;
    can.scale.setScalar(0.9);
    this.group.add(can);
    this.cans.push({ can, t: 0, dur: 1.3, x, y, z, yaw, dropT: 0 });
    sfx(g, 'pour');
  }

  // ---------- harvest ----------

  harvest(plant) {
    const g = this.game;
    if (plant.dormant) return false;
    if (plant.stage < 3) {
      plant.bounce = 0.4;
      sfx(g, 'boing', { volume: 0.6 });
      if (performance.now() - this._hintAt > 2500) {
        this._hintAt = performance.now();
        const wet = plant.wetUntil > this.t;
        g.toast(wet ? `The ${plant.name} is growing! Almost there!` : `The ${plant.name} is thirsty! Use the watering can.`, { icon: 'sparkle' });
      }
      return true;
    }
    const c = CROPS[plant.crop];
    const n = c.yield;
    basketAdd(g, c.food, n);
    this._fly(plant, c.food);
    sfx(g, 'harvest');
    if (g.particles) {
      _v.set(plant.x + 0.5, plant.y + 0.5, plant.z + 0.5);
      g.particles.emit(c.kind === 'flower' ? 'petal' : 'leaf', _v, { count: 8, spread: 0.5 });
      g.particles.emit('sparkle', _v, { count: 10, spread: 0.5 });
    }
    const what = c.kind === 'flower' ? `You picked a ${c.name} bouquet!` : `${n} ${foodName(c.food, n)} in your basket!`;
    g.toast(what, { icon: c.kind === 'flower' ? 'heart' : 'star' });
    const info = { crop: plant.crop, x: plant.x, y: plant.y, z: plant.z };
    if (c.regrow) {
      plant.progress = 2 / 3;
      this._setStage(plant, 2, false);
    } else {
      this.removePlant(plant);
    }
    g.events.emit('garden:harvest', { plant: { ...info, name: c.name }, crop: c.food, count: n });
    return true;
  }

  _fly(plant, food) {
    const m = foodModel(food);
    m.position.set(plant.x + 0.5, plant.y + 0.3, plant.z + 0.5);
    m.scale.setScalar(1.1);
    this.group.add(m);
    this.flyers.push({ m, t: 0, dur: 0.7, sx: plant.x + 0.5, sy: plant.y + 0.3, sz: plant.z + 0.5 });
  }

  // ---------- pickable helpers ----------

  _onBuild(plant, item) {
    const g = this.game;
    if (!item) return false;
    if (item.key === 'tool:watering_can') {
      return this.water({ type: 'pickable', pickable: plant.pickable, point: _v.set(plant.x + 0.5, plant.y + 0.2, plant.z + 0.5) });
    }
    if (item.key.startsWith('seed:')) {
      if (performance.now() - this._hintAt > 2000) {
        this._hintAt = performance.now();
        g.toast(`A ${plant.name} is already growing here!`, { icon: 'sparkle' });
      }
      return true;
    }
    return false;
  }

  _hint(plant, g) {
    if (plant.dormant) return null;
    const tool = g.selectedTool;
    if (tool === 'remove') return 'Tap to remove';
    if (tool === 'build') {
      const item = g.selectedItem();
      if (item && item.key === 'tool:watering_can') return 'Tap to water';
      if (item && item.key.startsWith('seed:')) return 'Already growing!';
      if (plant.stage < 3) return null;
    }
    if (plant.stage === 3) return CROPS[plant.crop].kind === 'flower' ? 'Tap to pick!' : 'Tap to harvest!';
    return plant.wetUntil > this.t ? 'Growing…' : 'Needs water!';
  }

  // ---------- growing ----------

  /** Grow every plant by `seconds` of dry growing time (used by sleep and the debug API). */
  grow(seconds) {
    for (const p of this.plants.values()) this._growPlant(p, seconds / CROPS[p.crop].grow);
  }

  _growPlant(p, dProgress) {
    if (p.stage === 3) return;
    p.progress = Math.min(1, p.progress + dProgress);
    const stage = p.progress >= 1 ? 3 : Math.min(2, Math.floor(p.progress * 3));
    if (stage !== p.stage) this._setStage(p, stage);
  }

  update(dt) {
    const g = this.game, w = g.world;
    if (!w || g.mode !== 'play' || g.loading) return;
    const now = this.t;
    // growth, a few times a second, from the game clock
    this._tick += dt;
    if (this._tick >= TICK) {
      const step = Math.max(0, now - this._clock);
      this._clock = now;
      this._tick = 0;
      if (step > 0 && step < 30) {
        const L = this.list;
        for (let i = 0; i < L.length; i++) {
          const p = L[i];
          if (p.dormant) continue;
          const rate = (p.wetUntil > now ? WET_BOOST : 1) / CROPS[p.crop].grow;
          this._growPlant(p, step * rate);
        }
      }
    }
    // plants whose soil went away (or that got built over) hide until it comes back
    this._dormantTick += dt;
    if (this._dormantTick > 0.5) {
      this._dormantTick = 0;
      this._checkDormant();
    }
    // soil dries out
    this._dryTick += dt;
    if (this._dryTick > 1) {
      this._dryTick = 0;
      let changed = false;
      for (const [idx, e] of this.wet) {
        if (e.until > now) continue;
        this.wet.delete(idx);
        if (w.defAt(e.x, e.y, e.z).key === 'farmland_wet') {
          if (!changed) changed = true;
          w.setKey(e.x, e.y, e.z, 'farmland', { record: false });
        }
      }
    }
    // rain waters the garden
    this._rainTick += dt;
    if (this._rainTick > 4) {
      this._rainTick = 0;
      const weather = g.weather && g.weather.current;
      if (weather === 'rain') this._rainWater();
    }
    // wiggle in the breeze; bounce after growing; ready plants sparkle
    const tt = g.time.t;
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (p.dormant) continue;
      const m = p.mesh;
      m.rotation.z = Math.sin(tt * 1.6 + p.phase) * 0.035 * (p.stage / 3);
      m.rotation.x = Math.sin(tt * 1.3 + p.phase * 1.7) * 0.025 * (p.stage / 3);
      if (p.bounce > 0) {
        p.bounce = Math.max(0, p.bounce - dt);
        const u = 1 - p.bounce / 0.55;
        const s = 1 + Math.sin(u * Math.PI * 2) * 0.18 * (1 - u);
        m.scale.set(2 - s, s, 2 - s);
      } else if (p.stage === 3) {
        const s = 1 + Math.sin(tt * 3 + p.phase) * 0.025;
        m.scale.set(1, s, 1);
      } else {
        m.scale.set(1, 1, 1);
      }
    }
    this._sparkT -= dt;
    if (this._sparkT <= 0 && g.particles) {
      this._sparkT = 0.3;
      const ready = this._ready;
      ready.length = 0;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        if (p.stage === 3 && !p.dormant && this._nearPlayer(p, 24)) ready.push(p);
      }
      if (ready.length) {
        const p = ready[this._sparkIdx++ % ready.length];
        _v.set(p.x + 0.5, p.y + stageHeight(p.crop, 3) * 0.8, p.z + 0.5);
        g.particles.emit('sparkle', _v, { count: 2, spread: 0.6 });
      }
    }
    // pouring cans
    for (let i = this.cans.length - 1; i >= 0; i--) {
      const c = this.cans[i];
      c.t += dt;
      const u = Math.min(1, c.t / c.dur);
      const tilt = u < 0.2 ? u / 0.2 : u > 0.8 ? (1 - u) / 0.2 : 1;
      c.can.rotation.x = 0.85 * tilt;
      c.can.position.y = c.y + 0.95 + Math.sin(u * Math.PI) * 0.1;
      c.dropT -= dt;
      if (tilt > 0.6 && c.dropT <= 0 && g.particles) {
        c.dropT = 0.07;
        _v.set(c.x + Math.sin(c.yaw) * (Math.random() - 0.3) * 0.6, c.y + 0.35, c.z + Math.cos(c.yaw) * (Math.random() - 0.3) * 0.6);
        g.particles.emit('splash', _v, { count: 5, spread: 0.9 });
        g.particles.emit('bubble', _v, { count: 1, spread: 0.6 });
      }
      if (u >= 1) {
        this.group.remove(c.can);
        disposeObject(c.can);
        this.cans.splice(i, 1);
      }
    }
    // harvested crops fly to her basket
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      const pl = g.player;
      const tx = pl ? pl.position.x : f.sx, ty = pl ? pl.position.y + 1.1 : f.sy + 1, tz = pl ? pl.position.z : f.sz;
      const e = u * u * (3 - 2 * u);
      f.m.position.set(f.sx + (tx - f.sx) * e, f.sy + (ty - f.sy) * e + Math.sin(u * Math.PI) * 1.1, f.sz + (tz - f.sz) * e);
      f.m.rotation.y += dt * 8;
      f.m.scale.setScalar(1.1 * (1 - u * 0.75));
      if (u >= 1) {
        if (g.particles) g.particles.emit('sparkle', f.m.position, { count: 6, spread: 0.3 });
        sfx(g, 'pop', { pitch: 1.4, volume: 0.7 });
        this.group.remove(f.m);
        disposeObject(f.m);
        this.flyers.splice(i, 1);
      }
    }
  }

  _checkDormant() {
    const g = this.game, w = g.world, B = g.registry.blocks;
    for (const p of this.plants.values()) {
      const under = B.byId(w.get(p.x, p.y - 1, p.z));
      const cell = w.get(p.x, p.y, p.z);
      const blocked = !under || !SOIL_OK.has(under.key) || cell !== 0 || (g.entities && g.entities.at(p.x, p.y, p.z));
      if (blocked && !p.dormant) {
        p.dormant = true;
        this._detach(p);
      } else if (!blocked && p.dormant) {
        p.dormant = false;
        this.group.add(p.mesh);
        g.pickables.add(p.pickable);
      }
    }
  }

  _rainWater() {
    const w = this.game.world;
    const until = this.t + WET_TIME;
    w.batch(() => {
      for (const p of this.plants.values()) {
        if (p.dormant || w.getSky(p.x, p.y, p.z) < 13) continue;
        p.wetUntil = until;
        const x = p.x, y = p.y - 1, z = p.z;
        if (w.defAt(x, y, z).key === 'farmland') w.setKey(x, y, z, 'farmland_wet', { record: false });
        this.wet.set(w.index(x, y, z), { x, y, z, until });
      }
    });
  }

  // ---------- world lifecycle ----------

  clear() {
    for (const p of this.plants.values()) this._detach(p);
    this.plants.clear();
    this.list.length = 0;
    this._ready.length = 0;
    this.wet.clear();
    for (const c of this.cans) { this.group.remove(c.can); disposeObject(c.can); }
    for (const f of this.flyers) { this.group.remove(f.m); disposeObject(f.m); }
    this.cans = [];
    this.flyers = [];
  }

  serialize() {
    const now = this.t;
    const r = (v) => Math.round(v * 1000) / 1000;
    const plants = [];
    for (const p of this.plants.values()) {
      if (p.dormant) continue;
      plants.push([p.crop, p.x, p.y, p.z, r(p.progress), Math.max(0, Math.round(p.wetUntil - now))]);
    }
    const wet = [];
    for (const e of this.wet.values()) wet.push([e.x, e.y, e.z, Math.max(0, Math.round(e.until - now))]);
    return { v: 1, plants, wet };
  }

  deserialize(data) {
    if (!data || !Array.isArray(data.plants)) return;
    const now = this.t;
    const w = this.game.world;
    for (const [crop, x, y, z, progress, wetLeft] of data.plants) {
      const p = this.addPlant(crop, x | 0, y | 0, z | 0, Math.max(0, Math.min(1, +progress || 0)), wetLeft > 0 ? now + wetLeft : 0);
      if (p) p.bounce = 0;
    }
    for (const [x, y, z, left] of data.wet || []) {
      if (!w.inBounds(x, y, z) || w.defAt(x, y, z).key !== 'farmland_wet') continue;
      this.wet.set(w.index(x, y, z), { x, y, z, until: now + (left || 10) });
    }
    this._clock = now;
    this._checkDormant();
  }

  /** Wet farmland with no timer (e.g. from an older save) dries soon. */
  adoptStrayWetBlocks() {
    const w = this.game.world;
    const id = this.game.registry.blocks.idOf('farmland_wet');
    if (id < 0) return;
    const b = w.blocks, sx = w.sx, sz = w.sz;
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== id || this.wet.has(i)) continue;
      const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
      this.wet.set(i, { x, y, z, until: this.t + 20 });
    }
  }
}

export function install(game) {
  registerFarmland(game);
  const garden = new Garden(game);
  game.garden = garden;

  for (const crop of CROP_KEYS) {
    const c = CROPS[crop];
    game.registry.items.register({
      key: 'seed:' + crop,
      name: c.seeds,
      category: 'garden',
      kind: 'other',
      icon: () => seedPacketIcon(game, crop),
      use: (g, hit) => garden.plantSeed(crop, hit),
    });
  }
  game.registry.items.register({
    key: 'tool:watering_can',
    name: 'Watering Can',
    category: 'garden',
    kind: 'other',
    icon: () => game.thumbs.get('tool:watering_can', () => wateringCanObject(), { dir: [1.4, 0.7, 0.9], zoom: 0.85 }),
    use: (g, hit) => garden.water(hit),
  });

  game.addSystem({
    name: 'garden',
    onWorldLoad() {
      garden.clear();
      garden._clock = game.time.t;
      game.scene.add(garden.group);
    },
    onWorldUnload() {
      garden.clear();
      game.scene.remove(garden.group);
    },
    update: (dt) => garden.update(dt),
    serialize: () => garden.serialize(),
    deserialize: (data) => garden.deserialize(data),
  });
  game.events.on('world:load', () => {
    garden._clock = game.time.t;
    garden.adoptStrayWetBlocks();
  });

  // a night's sleep: the garden grows a lot overnight
  game.events.on('player:sleep', () => { garden._slept = true; });
  game.events.on('time:morning', () => {
    if (!garden._slept) return;
    garden._slept = false;
    let n = 0;
    for (const p of garden.plants.values()) if (!p.dormant && p.stage < 3) n++;
    garden.grow(90);
    if (n) setTimeout(() => game.toast('Your garden grew while you slept!', { icon: 'sun' }), 2600);
  });

  if (game.debug) {
    game.debug.garden = {
      plants: () => garden.all().map((p) => ({ crop: p.crop, x: p.x, y: p.y, z: p.z, stage: p.stage, progress: p.progress, wet: p.wetUntil > garden.t })),
      grow: (seconds) => garden.grow(seconds),
      plant: (crop, x, y, z) => !!garden.plantSeed(crop, { type: 'block', x, y, z, id: game.world.get(x, y, z), face: [0, 1, 0], place: [x, y + 1, z], point: new THREE.Vector3(x + 0.5, y + 1, z + 0.5) }),
      water: (x, y, z) => garden.water({ type: 'block', x, y, z, id: game.world.get(x, y, z), face: [0, 1, 0], place: [x, y + 1, z], point: new THREE.Vector3(x + 0.5, y + 1, z + 0.5) }),
      harvest: (x, y, z) => { const p = garden.plantAt(x, y, z); return p ? garden.harvest(p) : false; },
    };
  }
}
