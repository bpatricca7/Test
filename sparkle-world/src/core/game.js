// The Game: owns the renderer, registries, services, world lifecycle, tools, undo history,
// picking and the frame loop. Feature modules plug in through install(game) (see DESIGN.md).

import * as THREE from 'three';
import { Emitter } from './events.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { SaveStore } from './storage.js';
import { Thumbs } from './thumbs.js';
import { BlockRegistry, ItemRegistry, SHAPES } from './registry.js';
import { mulberry32, makeId, nextFrame, clamp } from './util.js';
import { Noise } from './noise.js';
import { Diagnostics } from './diag.js';
import { World, WORLD_SIZES } from '../world/world.js';
import { buildBlockTexture } from '../world/textures.js';
import { createBlockUniforms, createBlockMaterials } from '../world/material.js';
import { ChunkRenderer } from '../world/chunks.js';
import { raycastVoxels, rayBox, makeVoxelHit } from '../world/raycast.js';
import { Physics } from '../world/physics.js';
import { defaultSpawn } from '../world/worldgen.js';

export const DEFAULT_HOTBAR = [
  'block:grass', 'block:planks_pink', 'block:glass', 'block:wool_white', 'block:flower_rose',
  'block:lamp_block', 'furn:bed_single', 'furn:chair', 'furn:table_lamp',
];

const AUTOSAVE_MS = 45000;
// after a change (a block, furniture, a pet...) the world is saved this soon, so a reload or a
// closed frame loses seconds of building, not up to a whole autosave interval
const DIRTY_SAVE_MS = 5000;
const DIRTY_SAVE_MAX_MS = 20000; // ...and at the latest this long after the first unsaved change
const DIRTY_EVENTS = [
  'history:change', 'block:place', 'block:remove', 'entity:place', 'entity:remove', 'entity:use',
  'prefab:place', 'pet:adopt', 'garden:plant', 'garden:harvest', 'gem:collect',
];
const AUTOSAVE_THUMB_MS = 5 * 60000; // autosaves refresh the My Worlds picture this often
const MAX_HISTORY = 20;
const STROKE_MAX_CELLS = 96; // one hold-drag paints at most this many blocks
const SAVE_WARN_MS = 4 * 60000; // repeat the "can't save here" note at most this often

export function defaultProfile(look = {}) {
  return {
    v: 1,
    look: JSON.parse(JSON.stringify(look)),
    outfits: [null, null, null, null, null, null],
    playerName: look.name || 'Lily',
    stickers: {},
    stats: {
      blocksPlaced: 0, petsPetted: 0, notesPlayed: 0, outfitChanges: 0, recipesCooked: {},
      gems: 0, worldsCreated: 0,
    },
    basket: {},
    settings: { music: 0.5, sfx: 0.8, camera: 'third', readAloud: false, timeFrozen: false, quality: 'auto' },
    lastWorldId: null,
    updatedAt: 0,
  };
}

/** Deep-merge a saved profile over defaults so new fields always exist. */
function mergeProfile(base, saved) {
  const out = { ...base, ...saved };
  out.stats = { ...base.stats, ...(saved.stats || {}) };
  out.settings = { ...base.settings, ...(saved.settings || {}) };
  out.look = { ...base.look, ...(saved.look || {}) };
  out.stickers = { ...(saved.stickers || {}) };
  out.basket = { ...(saved.basket || {}) };
  if (!Array.isArray(out.outfits) || out.outfits.length !== 6) out.outfits = base.outfits;
  return out;
}

export class Game {
  constructor(container) {
    this.container = container;
    container.classList.add('sw-app');
    // first, so it also counts the WebGL contexts created below
    this.diag = new Diagnostics(this);

    // three.js
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.className = 'sw-canvas';
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#BDE6FF');
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 700);
    this.camera.position.set(0, 30, 0);
    this.lights = {
      hemi: new THREE.HemisphereLight(0xffffff, 0xd9c7ff, 1.9),
      sun: new THREE.DirectionalLight(0xfff2e0, 1.6),
    };
    this.lights.sun.position.set(0.5, 1, 0.35);
    this.scene.add(this.lights.hemi, this.lights.sun);

    // services
    this.events = new Emitter();
    this.input = new Input(this.renderer.domElement, container);
    this.audio = new AudioEngine();
    this.store = new SaveStore();
    this.thumbs = new Thumbs();
    this.ui = null; // set by ui.js
    const items = new ItemRegistry(this.thumbs);
    this.registry = {
      items,
      blocks: new BlockRegistry(items),
      stickers: new Map(),
      recipes: new Map(),
      prefabs: new Map(),
      pets: new Map(),
      biomes: new Map(),
    };

    // hooks filled in by feature modules
    this.createAvatar = null; // avatar.js: (look) -> avatar
    this.createPlayer = null; // player.js: (savedPlayer) -> Player (also sets game.cameraRig)
    this.cameraRig = null;
    this.entities = null; // entities.js
    this.particles = null; // particles.js
    this.stickers = null; // stickers.js
    this.defaultLook = {}; // wardrobe defaults (avatar.js)
    this.actions = new Map(); // named actions for keys & HUD buttons: name -> fn(game)
    // multiplayer facade (src/net/facade.js; docs/MULTIPLAYER.md §9.1). Every hook below is
    // inert while it is missing or not active, so playing alone is unchanged.
    this.net = null;
    this._inSystems = false; // true while systems update (their changes are not a player's)

    // state
    this.profile = defaultProfile();
    this.world = null;
    this.player = null;
    this.physics = null;
    this.chunks = null;
    this.mode = 'title';
    this.loading = false;
    this.paused = false;
    this.time = { t: 0, dayTime: 0.3, day: 1, dayLength: 720 };
    this.selectedTool = 'build';
    this.hotbar = { slots: DEFAULT_HOTBAR.slice(), colors: Array(9).fill(null), index: 0 };
    this.target = null;
    this.history = [];
    this.pickables = new Set();
    this.colliders = new Set();
    this.reach = 8;
    this.systems = [];
    this._systemMap = new Map();
    this._systemErrors = new Set();
    this.fps = 60;
    this._busy = false;
    this._last = performance.now();
    this._raycaster = new THREE.Raycaster();
    this._tmpV = new THREE.Vector3();
    this._center = new THREE.Vector2(0, 0);
    this._profileTimer = 0;
    this._autosaveTimer = 0;
    this._lastThumb = null;
    this._thumbAt = 0;
    this._saveWarnAt = -Infinity;
    this._dirtyTimer = 0;
    this._dirtySince = 0;
    this._bottomToastAt = -Infinity;
    this._stroke = null; // current hold-drag paint stroke
    this._group = null; // open history group (see beginHistoryGroup)
    // reused per-frame pick results (game.target is overwritten every frame)
    this._n = [0, 0, 0];
    this._nBest = [0, 0, 0];
    this._vhScratch = makeVoxelHit();
    this._pickScratch = {
      block: { type: 'block', x: 0, y: 0, z: 0, id: 0, key: '', face: [0, 0, 0], point: new THREE.Vector3(), place: [0, 0, 0], distance: 0 },
      pickable: { type: 'pickable', pickable: null, point: new THREE.Vector3(), distance: 0, face: [0, 0, 0], place: [0, 0, 0] },
    };
    this._acceptWithLiquids = null;
    this._hintV = new THREE.Vector3();
    this._hintAt = { x: 0, y: 0 };

    this._registerCoreActions();
    this._bindInput();
    this._bindLifecycle();
    this._bindContextLoss();
    this._resize();
    this.debug = createDebug(this);
    if (typeof window !== 'undefined') window.__game = this;
  }

  // ---------- systems ----------

  /**
   * sys = { name, update?(dt), onWorldLoad?(world, save), onWorldUnload?(), serialize?(),
   *         deserialize?(json) }. update runs every frame in every mode (check game.world).
   * On world load: onWorldLoad first, then deserialize(save.systems[name]) if present.
   */
  addSystem(sys) {
    if (!sys || !sys.name) throw new Error('system needs a name');
    this.systems.push(sys);
    this._systemMap.set(sys.name, sys);
    return sys;
  }

  getSystem(name) {
    return this._systemMap.get(name) || null;
  }

  _updateSystems(dt) {
    const list = this.systems;
    this._inSystems = true;
    try {
      this._runSystems(list, dt);
    } finally {
      this._inSystems = false;
    }
  }

  _runSystems(list, dt) {
    let slow = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s.update) continue;
      const t = performance.now();
      try {
        s.update(dt);
      } catch (err) {
        const key = s.name + ':update';
        if (!this._systemErrors.has(key)) {
          this._systemErrors.add(key);
          console.error(`[game] system "${s.name}" update failed`, err);
        }
        this.diag.error('system:' + s.name, err);
      }
      const d = performance.now() - t;
      if (d > 20) (slow || (slow = {}))['sys:' + s.name] = Math.round(d);
    }
    this._slowSystems = slow;
  }

  _callSystems(method, ...args) {
    for (const s of this.systems) {
      if (typeof s[method] !== 'function') continue;
      try {
        s[method](...args);
      } catch (err) {
        const key = s.name + ':' + method;
        if (!this._systemErrors.has(key)) {
          this._systemErrors.add(key);
          console.error(`[game] system "${s.name}" ${method} failed`, err);
        }
      }
    }
  }

  // ---------- startup & loop ----------

  /** Build textures, load the profile, start the loop and open the title screen. */
  async start() {
    const { texture } = buildBlockTexture(this.registry.blocks);
    this.blockUniforms = createBlockUniforms(texture);
    this.blockMaterials = createBlockMaterials(this.blockUniforms);

    await this.store.init();
    const saved = await this.store.loadProfile();
    this.profile = mergeProfile(defaultProfile(this.defaultLook), saved || {});
    this.store.onCloudReady(async () => {
      const p = await this.store.loadProfile();
      if (p && (p.updatedAt || 0) > (this.profile.updatedAt || 0) && this.mode === 'title') {
        this.profile = mergeProfile(defaultProfile(this.defaultLook), p);
        this.events.emit('profile:changed', { profile: this.profile });
      }
    });
    this.applySettings();
    this.events.emit('game:ready', {});
    this._last = performance.now();
    this.renderer.setAnimationLoop(() => this._frame());
    this.mode = 'title';
    if (this.ui && this.ui.hasPanel('title')) this.ui.open('title');
  }

  /** Apply profile.settings (volumes, quality, camera). */
  applySettings() {
    const s = this.profile.settings;
    this.audio.setVolumes({ music: s.music, sfx: s.sfx });
    const pr = s.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    if (this.renderer.getPixelRatio() !== pr) {
      this.renderer.setPixelRatio(pr);
      this._resize();
    }
    if (this.cameraRig && this.cameraRig.setMode) this.cameraRig.setMode(s.camera);
  }

  _frame() {
    const now = performance.now();
    // hidden page (another tab, the app in the background): no work at all; some embedded web
    // views keep calling us. A save was triggered when it hid.
    if (typeof document !== 'undefined' && document.hidden) {
      this._last = now;
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    const playing = this.mode === 'play' && !!this.world;
    // Every stage is guarded: one failing stage must never stop the others (especially render),
    // otherwise the picture freezes while the buttons keep working.
    const st = this._stageTimes || (this._stageTimes = { input: 0, player: 0, systems: 0, camera: 0, target: 0, chunks: 0, thumbs: 0, render: 0 });
    let t0 = now, t1;

    try {
      this.input.enabled = playing && !this.paused;
      this.input.update();
    } catch (err) { this._stageError('input', err); }
    t1 = performance.now(); st.input = t1 - t0; t0 = t1;

    if (playing) {
      try {
        this._advanceTime(dt);
        if (this.player) this.player.update(dt);
      } catch (err) { this._stageError('player', err); }
    }
    t1 = performance.now(); st.player = t1 - t0; t0 = t1;

    this._updateSystems(dt);
    t1 = performance.now(); st.systems = t1 - t0; t0 = t1;

    try {
      if (playing && this.cameraRig) this.cameraRig.update(dt);
      if (this.blockUniforms) this.blockUniforms.uTime.value = this.time.t;
    } catch (err) { this._stageError('camera', err); }
    t1 = performance.now(); st.camera = t1 - t0; t0 = t1;

    try {
      if (playing) this._updateTarget();
    } catch (err) { this._stageError('target', err); }
    t1 = performance.now(); st.target = t1 - t0; t0 = t1;

    try {
      if (this.chunks) {
        const budget = this.loading ? 40 : 6;
        this.chunks.update(budget, this.camera.position.x, this.camera.position.z);
      }
    } catch (err) { this._stageError('chunks', err); }
    t1 = performance.now(); st.chunks = t1 - t0; t0 = t1;

    try {
      this.thumbs.update(this.loading ? 2 : 5);
    } catch (err) { this._stageError('thumbs', err); }
    t1 = performance.now(); st.thumbs = t1 - t0; t0 = t1;

    try {
      this.renderer.render(this.scene, this.camera);
    } catch (err) { this._stageError('render', err); }
    t1 = performance.now(); st.render = t1 - t0;

    try { this.input.endFrame(); } catch (err) { this._stageError('input', err); }

    // multiplayer: a friend's recorder closes this frame's changes into her outbox
    if (this.net !== null) {
      try { this.net.frameEnd(); } catch (err) { this._stageError('net', err); }
    }

    const total = t1 - now;
    if (total > 250 && !this.loading) {
      const slow = {};
      for (const k in st) if (st[k] > 20) slow[k] = Math.round(st[k]);
      if (st.systems > 20) Object.assign(slow, this._slowSystems || {});
      this.diag.longFrame(total, slow);
    }
    this.diag.frameDone(t1);
  }

  _stageError(stage, err) {
    const key = 'stage:' + stage + ':' + ((err && err.message) || err);
    if (!this._systemErrors.has(key)) {
      this._systemErrors.add(key);
      console.error(`[game] ${stage} failed`, err);
    }
    if (this.diag) this.diag.error('stage:' + stage, err);
  }

  _advanceTime(dt) {
    const t = this.time;
    t.t += dt;
    // a friend visiting (multiplayer guest) follows the host's frozen clock, not her own setting
    const frozen = this.net && this.net.isGuest ? this.net.hostFrozen : this.profile.settings.timeFrozen;
    if (!frozen) {
      t.dayTime += dt / t.dayLength;
      if (t.dayTime >= 1) {
        t.dayTime -= 1;
        t.day += 1;
      }
    }
  }

  /** Jump the clock (daynight.js notices crossings and emits time:morning / time:night). */
  setDayTime(dayTime) {
    this.time.dayTime = ((dayTime % 1) + 1) % 1;
  }

  /**
   * Sleep: skip ahead to early morning of the next day. The skipped night is marked
   * (time.quietNight) so daynight emits time:morning but not time:night for it.
   */
  skipToMorning() {
    // a friend (multiplayer guest) asks the host to sleep through the night; she skips ahead
    // locally at once (the host's clock corrects her if the host says no)
    const net = this.net;
    if (net && net.isGuest && !net.remoteApplying) net.intent('z', []);
    if (this.time.dayTime > 0.25) this.time.day += 1;
    this.time.dayTime = 0.26;
    this.time.quietNight = true;
  }

  _resize() {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // fov 70 on landscape; portrait phones get a wider vertical fov so the view is not cramped
    this.camera.fov = this.camera.aspect < 1 ? 70 + (1 - this.camera.aspect) * 40 : 70;
    this.camera.updateProjectionMatrix();
  }

  _bindLifecycle() {
    for (const name of DIRTY_EVENTS) this.events.on(name, () => this._markDirty());
    // a cloud that stops taking writes (with no storage on this device) means nothing survives
    // a reload: say so as soon as it happens, not only when entering the next world
    this.store.onStatus(({ persistent }) => {
      if (!persistent && this.mode === 'play') this._warnSaveTrouble(true);
    });
    window.addEventListener('resize', () => this._resize());
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this._resize()).observe(this.container);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // nothing may stay pressed while the page is away (a web view can swallow the release)
        this.input.reset('hidden');
        this.audio.suspend(true);
        this.flushSave();
      } else {
        this.audio.suspend(false);
        this._last = performance.now();
      }
    });
    window.addEventListener('pagehide', () => {
      this.input.reset('pagehide');
      this.flushSave({ unloading: true });
    });
  }

  /**
   * three.js restores a lost WebGL context by itself (textures and meshes re-upload); we
   * save right away, and if the picture has not come back after a moment we offer a reload.
   */
  _bindContextLoss() {
    const canvas = this.renderer.domElement;
    const lost = () => this.renderer.getContext().isContextLost();
    let timer = 0, asking = null;
    canvas.addEventListener('webglcontextlost', () => {
      this.flushSave();
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!this.ui || !lost() || asking) return;
        asking = new AbortController();
        this.ui.confirm({
          title: 'The picture fell asleep!',
          text: 'Your world is saved. Tap to wake it up.',
          yes: 'Wake up', no: 'Wait', yesVariant: 'mint', icon: 'sparkle', signal: asking.signal,
        }).then((yes) => {
          asking = null;
          if (yes && lost()) location.reload();
        });
      }, 2500);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      clearTimeout(timer);
      if (asking) asking.abort(); // the picture came back by itself
    });
  }

  /** Something in the world changed: save soon (debounced, see DIRTY_SAVE_MS). */
  _markDirty() {
    if (this.mode !== 'play' || !this.world || this.loading) return;
    const now = performance.now();
    if (!this._dirtySince) this._dirtySince = now;
    clearTimeout(this._dirtyTimer);
    const wait = Math.max(0, Math.min(DIRTY_SAVE_MS, this._dirtySince + DIRTY_SAVE_MAX_MS - now));
    this._dirtyTimer = setTimeout(() => this._saveDirty(), wait);
  }

  _saveDirty() {
    this._dirtyTimer = 0;
    if (!this._dirtySince) return;
    if (this.mode !== 'play' || !this.world) { this._dirtySince = 0; return; }
    if (this._busy || this.loading) { this._dirtyTimer = setTimeout(() => this._saveDirty(), 1000); return; }
    this.saveWorld({ thumbnail: false }).catch((err) => console.warn('[game] save failed', err));
  }

  /**
   * Save now (no thumbnail) and push pending cloud writes; used when the page may go away.
   * unloading (pagehide): an IndexedDB write started now can be cut off by the reload or
   * navigation, so a copy also goes into localStorage right away (synchronously); the next
   * session finds it like any fallback copy, and the next normal save drops it.
   */
  flushSave({ unloading = false } = {}) {
    let done = Promise.resolve();
    try {
      if (this.mode === 'play' && this.world && !this._busy && !this._isShared()) {
        if (unloading) {
          const save = this._serializeWorld({ thumbnail: false });
          this.store.journalWorld(save);
          done = this._storeWorld(save);
        } else {
          done = this.saveWorld({ thumbnail: false });
        }
      }
      if (unloading) {
        this.profile.updatedAt = Date.now();
        this.store.journalProfile(this.profile);
      }
    } catch (err) {
      console.warn('[game] save on leaving failed', err);
    }
    done.then(() => this.store.flush()).catch(() => {});
    this.saveProfile(true);
  }

  // ---------- profile ----------

  /** Persist the profile (debounced unless immediate). */
  saveProfile(immediate = false) {
    clearTimeout(this._profileTimer);
    const run = () => {
      this.profile.updatedAt = Date.now();
      return this.store.saveProfile(this.profile);
    };
    if (immediate) return run();
    return new Promise((resolve) => {
      this._profileTimer = setTimeout(() => resolve(run()), 400);
    });
  }

  // ---------- worlds ----------

  /** Generate a new world and enter it. size: 'cozy' | 'big'. */
  async newWorld({ name, biome = 'meadow', size = 'cozy', seed } = {}) {
    if (this._busy) return false;
    // another world: playing together in this one ends first
    if (this.net && this.net.active) await this.net.leave({ quiet: true });
    if (this._busy) return false;
    this._busy = true;
    try {
      this._showLoading('Making your world…', 0.02);
      await nextFrame();
      await nextFrame();
      if (this.world) await this._unloadWorld({ save: true });
      const biomeDef = this.registry.biomes.get(biome) || this.registry.biomes.values().next().value;
      if (!biomeDef) throw new Error('no biomes registered');
      const dims = WORLD_SIZES[size] || WORLD_SIZES.cozy;
      const worldSeed = Number.isFinite(seed) ? seed | 0 : Math.floor(Math.random() * 2 ** 31);
      const world = new World(dims, this.registry.blocks);
      world.meta = {
        id: makeId('w'), name: name || 'My World', biome: biomeDef.key || biome, seed: worldSeed,
        createdAt: Date.now(), sizeName: WORLD_SIZES[size] ? size : 'cozy',
      };
      biomeDef.generate(world, mulberry32(worldSeed), new Noise(worldSeed));
      this._showLoading('Painting the flowers…', 0.25);
      await nextFrame();
      world.computeAllLight();
      const spawn = (biomeDef.spawn || defaultSpawn)(world);
      world.meta.spawn = spawn;
      this.profile.stats.worldsCreated = (this.profile.stats.worldsCreated || 0) + 1;
      const save = {
        v: 1,
        player: { x: spawn[0], y: spawn[1], z: spawn[2], yaw: Math.PI, flying: false },
        time: { t: 0, dayTime: 0.3, day: 1 },
        systems: {},
        hotbar: { slots: DEFAULT_HOTBAR.slice(), colors: Array(9).fill(null), index: 0 },
      };
      this.events.emit('world:created', { world });
      await this._enterWorld(world, save);
      await this.saveWorld({ thumbnail: true });
      return true;
    } catch (err) {
      console.error('[game] newWorld failed', err);
      this._showLoading(null);
      this.toast('Oops! Could not make that world.');
      return false;
    } finally {
      this._busy = false;
    }
  }

  /** Load a saved world by id and enter it. */
  async loadWorld(id) {
    if (this._busy) return false;
    if (this.net && this.net.active) await this.net.leave({ quiet: true });
    if (this._busy) return false;
    this._busy = true;
    try {
      this._showLoading('Opening your world…', 0.05);
      await nextFrame();
      const save = await this.store.loadWorld(id);
      if (!save || !save.blocks) {
        this._showLoading(null);
        this.toast('Could not find that world');
        return false;
      }
      if (this.world) await this._unloadWorld({ save: true });
      const world = new World(save.size || WORLD_SIZES.cozy, this.registry.blocks);
      world.decodeBlocks(save.blocks, save.palette);
      world.meta = {
        id: save.id, name: save.name, biome: save.biome, seed: save.seed, createdAt: save.createdAt,
        sizeName: save.sizeName || 'cozy', spawn: save.spawn || null,
      };
      world.waterLevel = save.waterLevel || 0;
      world.outside = save.outside || null;
      this._showLoading('Opening your world…', 0.25);
      await nextFrame();
      world.computeAllLight();
      if (!world.meta.spawn) world.meta.spawn = defaultSpawn(world);
      await this._enterWorld(world, save);
      return true;
    } catch (err) {
      console.error('[game] loadWorld failed', err);
      this._showLoading(null);
      this.toast('Oops! Could not open that world.');
      return false;
    } finally {
      this._busy = false;
    }
  }

  /**
   * Multiplayer guest: enter the host's world from a snapshot (docs/MULTIPLAYER.md §9.2).
   * save: the host's serializeWorld() (no blocks, player, hotbar or thumbnail) plus net
   * { host: [x, y, z, yaw] }; rle: the host's world.encodeBlocksBytes(). Nothing is stored:
   * the world is marked shared (meta.shared) and saveWorld() never saves it. Resolves true
   * once she is in (standing two blocks in front of the host).
   */
  async enterSharedWorld(save, rle) {
    if (this._busy || !save || !save.size || !rle) return false;
    this._busy = true;
    try {
      this._showLoading('Flying to your friend\u2019s world\u2026', 0.05);
      await nextFrame();
      if (this.world) await this._unloadWorld({ save: !this._isShared() });
      const world = new World(save.size, this.registry.blocks);
      const n = world.decodeBlocksBytes(rle, save.palette);
      if (n !== world.blocks.length) throw new Error('world blocks do not fit');
      const code = this.net && Array.isArray(this.net.code) ? this.net.code.join('-') : 'friend';
      world.meta = {
        id: 'net-' + code, name: save.name || 'Friend\u2019s World', biome: save.biome, seed: save.seed,
        createdAt: save.createdAt || Date.now(), sizeName: save.sizeName || 'cozy', spawn: save.spawn || null, shared: true,
      };
      world.waterLevel = save.waterLevel || 0;
      world.outside = save.outside || null;
      this._showLoading(null, 0.25, true);
      await nextFrame();
      world.computeAllLight();
      if (!world.meta.spawn) world.meta.spawn = defaultSpawn(world);
      const host = save.net && Array.isArray(save.net.host) ? save.net.host : null;
      let player;
      if (host && host.length >= 4 && host.every(Number.isFinite)) {
        const yaw = host[3];
        const x = clamp(host[0] + Math.sin(yaw) * 2, 1, world.sx - 1), z = clamp(host[2] + Math.cos(yaw) * 2, 1, world.sz - 1);
        player = { x, y: host[1] + 0.05, z, yaw: yaw + Math.PI, flying: false };
      } else {
        const sp = world.meta.spawn;
        player = { x: sp[0], y: sp[1], z: sp[2], yaw: Math.PI, flying: false };
      }
      const entered = { ...save, player, hotbar: { slots: DEFAULT_HOTBAR.slice(), colors: Array(9).fill(null), index: 0 }, thumbnail: null };
      await this._enterWorld(world, entered, { shared: true });
      this.unstickPlayer();
      return true;
    } catch (err) {
      console.warn('[game] could not enter the shared world', err);
      this._showLoading(null);
      return false;
    } finally {
      this._busy = false;
    }
  }

  /** Is the current world a friend's (multiplayer guest)? It is never saved here. */
  _isShared() {
    return !!(this.world && this.world.meta && this.world.meta.shared);
  }

  async _enterWorld(world, save, opts = {}) {
    world.game = this;
    this.world = world;
    const t = save.time || {};
    this.time = { t: t.t || 0, dayTime: t.dayTime ?? 0.3, day: t.day || 1, dayLength: 720 };
    const hb = save.hotbar || {};
    this.hotbar = {
      slots: Array.from({ length: 9 }, (_, i) => (hb.slots && hb.slots[i] !== undefined ? hb.slots[i] : DEFAULT_HOTBAR[i])),
      colors: Array.from({ length: 9 }, (_, i) => (hb.colors && hb.colors[i]) || null),
      index: clamp(hb.index | 0, 0, 8),
    };
    this.selectedTool = 'build';
    this.history = [];
    this._group = null;
    this._stroke = null;
    this.target = null;
    // this world's own picture, so an early save never reuses the previous world's
    this._lastThumb = save.thumbnail || null;
    this._thumbAt = save.thumbnail ? Date.now() : 0;
    this.pickables.clear();
    this.colliders.clear();
    this.physics = new Physics(world, this.colliders);
    this.chunks = new ChunkRenderer(world, this.blockMaterials);
    this.scene.add(this.chunks.group);
    const p = save.player || { x: world.meta.spawn[0], y: world.meta.spawn[1], z: world.meta.spawn[2], yaw: 0 };
    this.camera.position.set(p.x, p.y + 2, p.z);
    if (this.createPlayer) this.player = this.createPlayer(p);
    this.loading = true;
    for (const s of this.systems) {
      try {
        if (s.onWorldLoad) s.onWorldLoad(world, save);
        if (s.deserialize && save.systems && save.systems[s.name] !== undefined) s.deserialize(save.systems[s.name]);
      } catch (err) {
        console.error(`[game] system "${s.name}" failed to load`, err);
      }
    }
    if (this.cameraRig) this.cameraRig.snap();
    // mesh the world behind the loading screen, nearest chunks first
    const total = Math.max(1, this.chunks.pending);
    while (this.chunks.pending > 0) {
      this._showLoading(null, 0.35 + 0.65 * (1 - this.chunks.pending / total), true);
      await nextFrame();
    }
    this.loading = false;
    this.mode = 'play';
    if (!opts.shared) {
      this.profile.lastWorldId = world.meta.id;
      this.saveProfile();
    }
    if (this.ui) this.ui.closeAll();
    this._showLoading(null);
    this.events.emit('world:load', { world, save });
    clearInterval(this._autosaveTimer);
    if (opts.shared) return; // a friend's world: nothing of it is saved on this device
    if (!this.store.persistent) this._warnSaveTrouble(true);
    this._autosaveTimer = setInterval(() => {
      if (this.mode !== 'play' || this._busy) return;
      // the picture needs an extra render + JPEG encode, so autosaves only refresh it now and then
      this.saveWorld({ thumbnail: Date.now() - this._thumbAt > AUTOSAVE_THUMB_MS });
    }, AUTOSAVE_MS);
  }

  async _unloadWorld({ save = true } = {}) {
    if (!this.world) return;
    if (save) await this.saveWorld({ thumbnail: true });
    clearInterval(this._autosaveTimer);
    clearTimeout(this._dirtyTimer);
    this._dirtyTimer = 0;
    this._dirtySince = 0;
    this.mode = 'title';
    this._callSystems('onWorldUnload');
    this.events.emit('world:unload', {});
    if (this.player) this.player.dispose();
    this.player = null;
    this.cameraRig = null;
    if (this.chunks) {
      this.scene.remove(this.chunks.group);
      this.chunks.dispose();
    }
    this.chunks = null;
    this.physics = null;
    this.world = null;
    this.target = null;
    this.history = [];
    this._group = null;
    this._stroke = null;
    this.pickables.clear();
    this.colliders.clear();
    if (this.ui) this.ui.hint(null);
  }

  /** Serialize the current world and store it. Resolves when stored. */
  async saveWorld({ thumbnail = true } = {}) {
    // a friend's world (multiplayer guest) is never saved here: it lives at her house
    if (this._isShared() || (this.net && this.net.isGuest)) return { ok: true, skipped: true };
    if (!this.world) return { ok: false };
    return this._storeWorld(this._serializeWorld({ thumbnail }));
  }

  /** The current world as a save object for storing (clears the pending "save soon"). */
  _serializeWorld({ thumbnail = true } = {}) {
    clearTimeout(this._dirtyTimer);
    this._dirtyTimer = 0;
    this._dirtySince = 0;
    return this.serializeWorld({ thumbnail });
  }

  /**
   * The current world as a save object (synchronous, no side effects on saving). Everything
   * changed so far goes in. opts: thumbnail (take a new picture), blocks (false: leave the
   * base64 blocks out, blocks: ''; the multiplayer snapshot sends them as raw bytes).
   */
  serializeWorld({ thumbnail = true, blocks = true } = {}) {
    const w = this.world;
    if (!w) return null;
    const systems = {};
    for (const s of this.systems) {
      if (!s.serialize) continue;
      try {
        const data = s.serialize();
        if (data !== undefined) systems[s.name] = data;
      } catch (err) {
        console.error(`[game] system "${s.name}" failed to save`, err);
      }
    }
    if (thumbnail) {
      this._lastThumb = this.captureThumbnail() || this._lastThumb;
      this._thumbAt = Date.now();
    }
    const save = {
      v: 1,
      id: w.meta.id,
      name: w.meta.name,
      biome: w.meta.biome,
      seed: w.meta.seed,
      size: { x: w.sx, y: w.sy, z: w.sz },
      sizeName: w.meta.sizeName,
      createdAt: w.meta.createdAt,
      updatedAt: Date.now(),
      palette: w.palette(),
      blocks: blocks ? w.encodeBlocks() : '',
      waterLevel: w.waterLevel,
      outside: w.outside,
      spawn: w.meta.spawn,
      player: this.player ? this.player.serialize() : null,
      time: { t: this.time.t, dayTime: this.time.dayTime, day: this.time.day },
      hotbar: { slots: this.hotbar.slots.slice(), colors: this.hotbar.colors.slice(), index: this.hotbar.index },
      systems,
      thumbnail: this._lastThumb || null,
    };
    return save;
  }

  async _storeWorld(save) {
    const res = await this.store.saveWorld(save);
    if (res.ok) this.events.emit('world:saved', { id: save.id, persistent: res.persistent !== false });
    if (!res.ok || res.persistent === false) this._warnSaveTrouble(false);
    await this.saveProfile(true);
    return res;
  }

  /**
   * Tell the player (gently, not too often) that this device is not keeping her world. The
   * game keeps saving (in memory, and wherever it can); the first time in a session it also
   * offers "Save to a file" (the 'saveToFile' action, from the menus module) so nothing is lost.
   */
  _warnSaveTrouble(force) {
    const now = performance.now();
    if (!force && now - this._saveWarnAt < SAVE_WARN_MS) return;
    if (now - this._saveWarnAt < 3000) return; // one note for one trouble (several paths report it)
    this._saveWarnAt = now;
    const ui = this.ui;
    if (!this._saveOffered && this.mode === 'play' && this.world && ui && ui.confirm && !ui.dialogOpen && this.actions.has('saveToFile')) {
      this._saveOffered = true;
      ui.confirm({
        title: "Oh no! This device can't keep your world",
        text: 'Keep playing! To keep your world safe, save it to a file.',
        yes: 'Save to a file', no: 'Keep playing', yesVariant: 'mint', icon: 'download',
      }).then((yes) => { if (yes) this.runAction('saveToFile'); });
      return;
    }
    this.toast("Oh no! This device can't save your world right now.", { icon: 'sparkle', color: 'pink', duration: 6000 });
  }

  /** Small JPEG of the current view for the My Worlds list. */
  captureThumbnail() {
    try {
      this.events.emit('thumbnail:before', {});
      this.renderer.render(this.scene, this.camera);
      const src = this.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 150;
      const sw = src.width, sh = src.height;
      const aspect = 240 / 150;
      let cw = sw, ch = sw / aspect;
      if (ch > sh) { ch = sh; cw = sh * aspect; }
      c.getContext('2d').drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, 240, 150);
      this.events.emit('thumbnail:after', {});
      return c.toDataURL('image/jpeg', 0.75);
    } catch (err) {
      console.warn('[game] thumbnail failed', err);
      return null;
    }
  }

  /**
   * Save, leave the world and show the title screen. The save on this device is awaited; the
   * cloud copy is pushed in the background (a host db that never answers must not leave her
   * on an empty sky with no buttons).
   */
  async exitToTitle() {
    if (this._busy) return;
    // playing together ends quietly first (a friend goes home; a host says goodbye and saves)
    if (this.net && this.net.active) await this.net.leave({ quiet: true });
    if (this._busy) return;
    this._busy = true;
    try {
      await this._unloadWorld({ save: true });
    } catch (err) {
      console.error('[game] leaving the world failed', err);
    } finally {
      this._busy = false;
    }
    this.store.flush().catch(() => {});
    if (this.ui) {
      this.ui.closeAll();
      if (this.ui.hasPanel('title')) this.ui.open('title');
    }
  }

  _showLoading(text, progress, keepText) {
    if (this.ui && this.ui.loading) this.ui.loading(keepText ? undefined : text, progress);
  }

  // ---------- hotbar & tools ----------

  setTool(tool) {
    if (!['build', 'remove', 'hand'].includes(tool)) return;
    if (this.selectedTool === tool) return;
    this.selectedTool = tool;
    this.audio.play('click');
    this.events.emit('tool:change', { tool });
  }

  selectSlot(index) {
    index = clamp(index | 0, 0, 8);
    this.hotbar.index = index;
    if (this.hotbar.slots[index]) this.setTool('build');
    this.audio.play('click', { pitch: 1 + index * 0.03 });
    this.events.emit('hotbar:change', { index, key: this.hotbar.slots[index] });
  }

  /** Put an item (and optional color swatch) into a hotbar slot (default: selected). */
  setSlot(index, key, color = null) {
    index = index === null || index === undefined ? this.hotbar.index : clamp(index | 0, 0, 8);
    this.hotbar.slots[index] = key;
    this.hotbar.colors[index] = color;
    this.hotbar.index = index;
    this.setTool('build');
    this.events.emit('hotbar:change', { index, key });
  }

  selectedItem() {
    const key = this.hotbar.slots[this.hotbar.index];
    return key ? this.registry.items.get(key) : null;
  }

  // ---------- picking ----------

  /**
   * Ray from the camera through ndc (default: input.pointer, else screen centre).
   * Returns { type:'block', x,y,z,id,key,face,point,place,distance } or
   * { type:'pickable', pickable, point, distance, face, place } or null.
   * opts.liquids: water can be hit (default: while the Remove tool is selected, so water
   * can be erased; Build aims through it). opts.reuse: fill and return shared scratch
   * objects instead of allocating (per-frame targeting only; the result is overwritten).
   */
  pick(ndc, opts = {}) {
    if (!this.world) return null;
    const p = ndc === undefined ? this.input.pointer : ndc;
    this._raycaster.setFromCamera(p || this._center, this.camera);
    const ray = this._raycaster.ray;
    const o = ray.origin, d = ray.direction;
    const head = this._tmpV;
    if (this.player) head.set(this.player.position.x, this.player.position.y + 1.4, this.player.position.z);
    else head.copy(o);
    const maxDist = o.distanceTo(head) + this.reach;
    const reuse = !!opts.reuse;
    const liquids = opts.liquids ?? this.selectedTool === 'remove';

    let best = null;
    const vh = raycastVoxels(this.world, o.x, o.y, o.z, d.x, d.y, d.z, maxDist,
      liquids ? this._liquidAccept() : null, reuse ? this._vhScratch : null);
    if (vh) {
      best = reuse ? this._pickScratch.block : { type: 'block', face: [0, 0, 0], point: new THREE.Vector3(), place: [0, 0, 0] };
      best.x = vh.x; best.y = vh.y; best.z = vh.z; best.id = vh.id;
      best.key = this.registry.blocks.byId(vh.id).key;
      best.face[0] = vh.face[0]; best.face[1] = vh.face[1]; best.face[2] = vh.face[2];
      best.point.set(vh.point[0], vh.point[1], vh.point[2]);
      best.place[0] = vh.x + vh.face[0]; best.place[1] = vh.y + vh.face[1]; best.place[2] = vh.z + vh.face[2];
      best.distance = vh.distance;
    }
    const n = this._n;
    let bestPk = null, bestT = best ? best.distance : Infinity;
    const nx = this._nBest;
    for (const pk of this.pickables) {
      const b = pk.box;
      if (!b) continue;
      const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, n);
      if (t < 0 || t > maxDist || t >= bestT) continue;
      bestT = t;
      bestPk = pk;
      nx[0] = n[0]; nx[1] = n[1]; nx[2] = n[2];
    }
    if (bestPk) {
      best = reuse ? this._pickScratch.pickable : { type: 'pickable', point: new THREE.Vector3(), face: [0, 0, 0], place: [0, 0, 0] };
      best.pickable = bestPk;
      best.distance = bestT;
      best.point.set(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
      best.face[0] = nx[0]; best.face[1] = nx[1]; best.face[2] = nx[2];
      best.place[0] = Math.floor(best.point.x + nx[0] * 0.5);
      best.place[1] = Math.floor(best.point.y + nx[1] * 0.5);
      best.place[2] = Math.floor(best.point.z + nx[2] * 0.5);
    }
    if (best && this.player && best.point.distanceTo(head) > this.reach + 0.75) return null;
    return best;
  }

  /** accept() for raycastVoxels that also stops at liquids (Remove tool). */
  _liquidAccept() {
    if (!this._acceptWithLiquids) {
      const props = this.registry.blocks.props;
      this._acceptWithLiquids = (id) => props.selectable[id] === 1 || props.shape[id] === SHAPES.liquid;
    }
    return this._acceptWithLiquids;
  }

  _updateTarget() {
    if (this.paused) {
      this.target = null;
      if (this.ui) this.ui.hint(null);
      return;
    }
    this.target = this.pick(undefined, { reuse: true });
    if (!this.ui) return;
    let hint = null;
    const t = this.target;
    if (t && t.type === 'pickable' && t.pickable.hint) hint = t.pickable.hint(this, t);
    else if (t && t.type === 'block' && this.selectedTool === 'hand') {
      const def = this.registry.blocks.byId(t.id);
      if (def && def.onUse) hint = def.hint || 'Tap to use';
    }
    // show the bubble next to the thing it talks about
    let at = null;
    if (hint) {
      const v = this._hintV.copy(t.point).project(this.camera);
      if (v.z < 1) {
        at = this._hintAt;
        at.x = ((v.x + 1) / 2) * this.container.clientWidth;
        at.y = ((1 - v.y) / 2) * this.container.clientHeight;
      }
    }
    this.ui.hint(hint, at);
  }

  // ---------- acting ----------

  /** Perform the selected tool on a pick result (default: current target). */
  useTarget(hit = this.target) {
    if (!hit || !this.world) return false;
    if (this.selectedTool === 'remove') return this.removeTarget(hit);
    if (this.selectedTool === 'hand') return this.interact(hit);
    if (this._netRefuses('build')) return false;
    const item = this.selectedItem();
    if (!item) {
      if (hit.type === 'pickable') return this.interact(hit);
      this.toast('Pick something from your Bag!', { icon: 'bag' });
      return false;
    }
    const opts = { color: this.hotbar.colors[this.hotbar.index] || (item.colors ? item.colors[0] : null) };
    if (hit.type === 'pickable' && hit.pickable.onBuild) {
      const handled = hit.pickable.onBuild(this, hit, item, opts);
      if (handled) return true;
    }
    if (!item.use) return false;
    let ok = false;
    try {
      ok = !!item.use(this, hit, opts);
    } catch (err) {
      console.error('[game] item use failed', item.key, err);
    }
    if (!ok) this.audio.play('click', { pitch: 0.6, volume: 0.6 });
    return ok;
  }

  /** Remove tool: a block, or a pickable that supports onRemove. */
  removeTarget(hit = this.target) {
    if (!hit) return false;
    if (this._netRefuses('remove')) return false;
    if (hit.type === 'pickable') {
      return hit.pickable.onRemove ? !!hit.pickable.onRemove(this, hit) : false;
    }
    return this.removeBlock(hit.x, hit.y, hit.z);
  }

  /** Hand tool: use a pickable (entity/pet) or a block with onUse. */
  interact(hit = this.target) {
    if (!hit) return false;
    if (hit.type === 'pickable') return hit.pickable.onUse ? !!hit.pickable.onUse(this, hit) : false;
    const def = this.registry.blocks.byId(hit.id);
    if (def && def.onUse) return !!def.onUse(this, hit);
    return false;
  }

  /** Item.use for blocks: place at the hit (replacing tall grass in place). */
  placeBlockFromHit(hit, key, opts = {}) {
    if (!hit || !hit.place) return false;
    let [x, y, z] = hit.place;
    if (hit.type === 'block' && this.registry.blocks.props.replaceable[hit.id]) [x, y, z] = [hit.x, hit.y, hit.z];
    return this.placeBlock(x, y, z, key, opts);
  }

  /** Place a block with undo + sound + sparkle. Returns false if not allowed there. */
  placeBlock(x, y, z, key, { history = true, fx = true } = {}) {
    const w = this.world;
    if (!w) return false;
    const def = this.registry.blocks.byKey(key);
    if (!def || def.id === 0) return false;
    if (!w.inBounds(x, y, z)) {
      if (fx && y >= w.sy) this.toast('That is too high!');
      return false;
    }
    const props = this.registry.blocks.props;
    const prev = w.get(x, y, z);
    if (prev !== 0 && !props.replaceable[prev]) return false;
    if (this.entities && this.entities.at(x, y, z)) return false;
    if (def.solid && this.player && this.player.overlapsCell(x, y, z)) return false;
    // never build a friend in (multiplayer: her avatar stands there)
    if (def.solid && this.net && this.net.active && this.net.cellHasFriend(x, y, z)) return false;
    w.set(x, y, z, def.id, { record: true });
    if (history) {
      this.pushHistory({
        undo: () => this._casSet(w, x, y, z, def.id, prev),
        redo: () => this._casSet(w, x, y, z, prev, def.id),
      });
    }
    if (fx) {
      this.audio.play(def.sound || 'place', { pitch: 0.92 + Math.random() * 0.16 });
      this.celebrate([x + 0.5, y + 0.5, z + 0.5], 'sparkle', { quiet: true });
    }
    return true;
  }

  /** Remove a block with undo + sound + sparkle. The solid bottom layer (y = 0) stays. */
  removeBlock(x, y, z, { history = true, fx = true } = {}) {
    const w = this.world;
    if (!w || !w.inBounds(x, y, z)) return false;
    const prev = w.get(x, y, z);
    if (prev === 0) return false;
    if (y === 0 && this.registry.blocks.props.solid[prev]) {
      // digging through would show the empty space under the world
      if (fx && performance.now() - this._bottomToastAt > 4000) {
        this._bottomToastAt = performance.now();
        this.toast("That's the very bottom of the world!", { icon: 'sparkle' });
      }
      return false;
    }
    w.set(x, y, z, 0, { record: true });
    if (history) {
      this.pushHistory({
        undo: () => this._casSet(w, x, y, z, 0, prev),
        redo: () => this._casSet(w, x, y, z, prev, 0),
      });
    }
    if (fx) {
      this.audio.play('remove', { pitch: 0.95 + Math.random() * 0.1 });
      this.celebrate([x + 0.5, y + 0.5, z + 0.5], 'sparkle', { quiet: true });
    }
    return true;
  }

  /**
   * An Undo / Redo of one block: set id `to`. While playing with friends someone may have
   * changed that cell since, so it only happens if the cell still holds `from` (the value
   * this action wrote); otherwise it is skipped. Alone (LIFO undo) that is always the case.
   */
  _casSet(w, x, y, z, from, to) {
    if (this.net && this.net.active && w.get(x, y, z) !== from) return false;
    return w.set(x, y, z, to, { record: false });
  }

  /** Multiplayer: may the player use this tool now? If not: the soft "nope" and a friendly note. */
  _netRefuses(tool) {
    const net = this.net;
    if (!net || !net.active || net.mayEdit(tool)) return false;
    this.audio.play('click', { pitch: 0.6, volume: 0.6 });
    if (typeof net.refuse === 'function') net.refuse('paused');
    return true;
  }

  // ---------- history ----------

  pushHistory(entry) {
    // executing a friend's change (multiplayer host): it never enters the host's own Undo
    if (this.net && this.net.noHistory) return;
    if (this._group) {
      this._group.entries.push(entry);
      return;
    }
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.events.emit('history:change', { size: this.history.length });
  }

  /**
   * Collect every pushHistory() until the matching endHistoryGroup() into ONE entry, so a
   * single Undo takes back a whole paint stroke (or any multi-step action). Nests.
   */
  beginHistoryGroup() {
    if (this.net && this.net.noHistory) return;
    if (this._group) this._group.depth++;
    else this._group = { entries: [], depth: 1 };
  }

  endHistoryGroup() {
    if (this.net && this.net.noHistory) return;
    const g = this._group;
    if (!g || --g.depth > 0) return;
    this._group = null;
    const list = g.entries;
    if (!list.length) return;
    this.pushHistory(list.length === 1 ? list[0] : {
      undo: () => { for (let i = list.length - 1; i >= 0; i--) list[i].undo(); },
      redo: () => { for (const e of list) if (e.redo) e.redo(); },
    });
  }

  /** Run fn() inside a history group; returns its result. */
  historyGroup(fn) {
    this.beginHistoryGroup();
    try {
      return fn();
    } finally {
      this.endHistoryGroup();
    }
  }

  undo() {
    const e = this.history.pop();
    if (!e) {
      this.toast('Nothing to undo');
      return false;
    }
    try {
      e.undo();
    } catch (err) {
      console.error('[game] undo failed', err);
    }
    this._unstickPlayer();
    this.audio.play('whoosh', { volume: 0.6 });
    this.events.emit('history:change', { size: this.history.length });
    return true;
  }

  /** Step the player out of blocks or furniture that appeared around her (public alias). */
  unstickPlayer() {
    this._unstickPlayer();
  }

  /** After undo put blocks or furniture back, step the player out of them if needed. */
  _unstickPlayer() {
    const pl = this.player, ph = this.physics;
    if (!pl || !ph || pl.state === 'sit' || pl.state === 'sleep' || pl.state === 'ride') return;
    const pos = pl.position;
    if (!ph.bodyBlocked(pos.x, pos.y + 0.01, pos.z, pl.halfW, pl.height)) return;
    let spot = pl.findStandSpot(pos.x, pos.y, pos.z);
    if (!spot) {
      for (let y = Math.floor(pos.y) + 1; y < this.world.sy + 2; y++) {
        if (!ph.bodyBlocked(pos.x, y + 0.01, pos.z, pl.halfW, pl.height)) { spot = [pos.x, y + 0.01, pos.z]; break; }
      }
    }
    if (spot) {
      pos.set(spot[0], spot[1], spot[2]);
      pl.velocity.set(0, 0, 0);
    }
  }

  // ---------- shortcuts ----------

  toast(text, opts = {}) {
    if (this.ui) this.ui.toast(text, opts);
  }

  /** Particles + sound at a position ([x,y,z] or Vector3). opts.quiet skips the sound. */
  celebrate(position, kind = 'sparkle', opts = {}) {
    const pos = Array.isArray(position) ? new THREE.Vector3(position[0], position[1], position[2]) : position;
    if (this.particles) this.particles.emit(kind, pos, opts);
    if (!opts.quiet) this.audio.play(kind === 'heart' ? 'pet' : kind === 'confetti' ? 'success' : 'sparkle');
  }

  award(stickerId) {
    if (this.stickers && this.stickers.award) return this.stickers.award(stickerId);
    return false;
  }

  /** Register a named action (keyboard shortcuts and HUD buttons run these). */
  registerAction(name, fn) {
    this.actions.set(name, fn);
  }

  runAction(name, ...args) {
    const fn = this.actions.get(name);
    if (!fn) return false;
    try {
      return fn(this, ...args);
    } catch (err) {
      console.error(`[game] action "${name}" failed`, err);
      return false;
    }
  }

  _registerCoreActions() {
    this.registerAction('build', (g) => g.setTool('build'));
    this.registerAction('remove', (g) => g.setTool('remove'));
    this.registerAction('hand', (g) => g.setTool('hand'));
    this.registerAction('undo', (g) => g.undo());
    this.registerAction('bag', (g) => g.ui && g.ui.toggle('bag'));
    this.registerAction('menu', (g) => g.ui && g.ui.open('pause'));
    this.registerAction('fly', (g) => g.player && g.player.toggleFly());
    this.registerAction('camera', (g) => {
      if (!g.cameraRig) return;
      g.cameraRig.toggleMode();
      g.profile.settings.camera = g.cameraRig.mode;
      g.saveProfile();
    });
  }

  _bindInput() {
    const input = this.input;
    input.on('gesture', () => {
      this.audio.unlock();
      if (!this._musicStarted && this.audio.ctx) {
        this._musicStarted = true;
        this.audio.music(this.profile.settings.music > 0);
      }
    });
    input.on('tap', (e) => this._tapAt(e.x, e.y, e.button));
    input.on('hold', (e) => {
      if (e.phase === 'start') this._strokeStart(e);
      else if (e.phase === 'move') this._strokeMove(e);
      else this._strokeEnd(e);
    });
    input.on('key', (e) => {
      if (!e.down || e.repeat) return;
      if (this.ui && this.ui.dialogOpen) return;
      if (e.code === 'Escape') {
        if (this.ui && this.ui.current) this.ui.back();
        else if (this.mode === 'play') this.runAction('menu');
        return;
      }
      if (this.mode !== 'play') return;
      if (e.code === 'KeyB') {
        // B toggles the Bag, but never swaps it in over another open panel (a cake baking in
        // the cooking panel, a song on the piano, a half-filled adoption card...)
        const open = this.ui && this.ui.current;
        if (!open || open === 'bag') this.runAction('bag');
        return;
      }
      if (this.paused) return;
      if (/^Digit[1-9]$/.test(e.code)) this.selectSlot(Number(e.code.slice(5)) - 1);
      else if (e.code === 'KeyE') {
        if (this.target && this.selectedTool !== 'hand' && this.interact(this.target)) return;
        this.setTool('hand');
      } else if (e.code === 'KeyQ') this.setTool('remove');
      else if (e.code === 'KeyR') this.setTool('build');
      else if (e.code === 'KeyF') this.runAction('fly');
      else if (e.code === 'KeyV') this.runAction('camera');
      else if (e.code === 'KeyP') this.runAction('photo');
      else if (e.code === 'KeyG') this.runAction('emotes');
      else if (e.code === 'KeyZ') this.undo();
    });
  }

  // ---------- hold-drag painting ----------
  //
  // Press and hold still (0.42 s), then drag: with a block item the Build tool lays a line of
  // blocks, the Remove tool erases one. The stroke is locked to the plane of the first face it
  // touched (the ground layer, or the layer against a wall), so it never climbs toward the
  // camera, and the whole stroke is one Undo. A slow press that never drags, and any hold with
  // the Hand tool or on furniture, acts as a plain tap when released.

  /** Tap (click / touch) at ndc: the current tool acts on what is there. */
  _tapAt(x, y, button = 0) {
    if (this.mode !== 'play' || this.paused) return;
    const hit = this.pick({ x, y }, { liquids: button === 2 || this.selectedTool === 'remove' });
    this.target = hit;
    if (!hit) return;
    if (button === 2) this.removeTarget(hit);
    else this.useTarget(hit);
  }

  _strokeStart(e) {
    this._stroke = null;
    if (this.mode !== 'play' || this.paused) return;
    const tool = this.selectedTool;
    if (tool !== 'hand' && this._netRefuses(tool)) {
      this._stroke = { paint: false, cells: 0, refused: true }; // nor a tap on release
      return;
    }
    const hit = this.pick({ x: e.x, y: e.y });
    const item = this.selectedItem();
    const paints = hit && hit.type === 'block' &&
      (tool === 'remove' || (tool === 'build' && item && item.kind === 'block'));
    this._stroke = { paint: !!paints, cells: 0 };
    if (!paints) return; // decided on release: a still press becomes a tap

    const st = this._stroke;
    const props = this.registry.blocks.props;
    const f = hit.face;
    let axis = f[0] !== 0 ? 0 : f[1] !== 0 ? 1 : 2;
    const c = [hit.x, hit.y, hit.z];
    if (tool === 'build' && props.replaceable[hit.id]) {
      // painting over flowers / grass tufts / water: stay on that ground layer
      axis = 1;
      st.level = hit.y;
      st.plane = hit.y;
    } else {
      const nrm = f[axis];
      st.level = tool === 'build' ? c[axis] + nrm : c[axis];
      st.plane = nrm > 0 ? c[axis] + 1 : c[axis]; // the face we pressed on
    }
    st.axis = axis;
    st.tool = tool;
    st.key = tool === 'build' ? item.block : null;
    this.beginHistoryGroup();
    st.open = true;
    const cell = [hit.x, hit.y, hit.z];
    if (tool === 'build') {
      if (!props.replaceable[hit.id]) cell[axis] = st.level;
      this.useTarget(hit);
    } else {
      this.removeTarget(hit);
    }
    st.last = cell;
    st.cells = 1;
  }

  _strokeMove(e) {
    const st = this._stroke;
    if (!st || !st.paint || !this.world || this.mode !== 'play' || this.paused) return;
    this._raycaster.setFromCamera({ x: e.x, y: e.y }, this.camera);
    const { origin: o, direction: d } = this._raycaster.ray;
    const oa = st.axis === 0 ? o.x : st.axis === 1 ? o.y : o.z;
    const da = st.axis === 0 ? d.x : st.axis === 1 ? d.y : d.z;
    if (Math.abs(da) < 1e-4) return;
    const t = (st.plane - oa) / da;
    if (t <= 0 || t > 60) return;
    const cell = [Math.floor(o.x + d.x * t), Math.floor(o.y + d.y * t), Math.floor(o.z + d.z * t)];
    cell[st.axis] = st.level;
    const last = st.last;
    if (cell[0] === last[0] && cell[1] === last[1] && cell[2] === last[2]) return;
    // walk the straight line from the last cell so quick drags leave no gaps
    const steps = Math.max(Math.abs(cell[0] - last[0]), Math.abs(cell[1] - last[1]), Math.abs(cell[2] - last[2]));
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(last[0] + ((cell[0] - last[0]) * i) / steps);
      const y = Math.round(last[1] + ((cell[1] - last[1]) * i) / steps);
      const z = Math.round(last[2] + ((cell[2] - last[2]) * i) / steps);
      this._strokeCell(st, x, y, z);
    }
    st.last = cell;
  }

  _strokeCell(st, x, y, z) {
    if (st.cells >= STROKE_MAX_CELLS) return;
    const pl = this.player;
    if (pl) {
      const dx = x + 0.5 - pl.position.x, dy = y + 0.5 - (pl.position.y + 1.4), dz = z + 0.5 - pl.position.z;
      if (dx * dx + dy * dy + dz * dz > (this.reach + 1) ** 2) return;
    }
    const ok = st.tool === 'build' ? this.placeBlock(x, y, z, st.key) : this.removeBlock(x, y, z);
    if (ok) st.cells++;
  }

  _strokeEnd(e) {
    const st = this._stroke;
    this._stroke = null;
    if (st && st.open) this.endHistoryGroup();
    // a slow, still press that did not paint: treat it exactly like a tap
    if (st && !st.paint && !st.refused && !e.dragged && !e.cancelled) this._tapAt(e.x, e.y, 0);
  }
}

// ---------- debug API (window.__game.debug) ----------

function createDebug(game) {
  const blockHit = (x, y, z, face = [0, 1, 0]) => {
    const id = game.world.get(x, y, z);
    return {
      type: 'block', x, y, z, id, key: game.registry.blocks.byId(id)?.key, face,
      point: new THREE.Vector3(x + 0.5 + face[0] * 0.5, y + 0.5 + face[1] * 0.5, z + 0.5 + face[2] * 0.5),
      place: [x + face[0], y + face[1], z + face[2]],
      distance: 1,
    };
  };
  return {
    newWorld: (opts = {}) => game.newWorld({ name: 'Test World', biome: 'meadow', size: 'cozy', ...opts }),
    loadWorld: (id) => game.loadWorld(id),
    exitToTitle: () => game.exitToTitle(),
    save: () => game.saveWorld({ thumbnail: true }),
    /** Place a block key, or furniture ('furn:<key>' or a furniture key), at x,y,z. */
    place(key, x, y, z, rot = 0, color = null) {
      const fkey = key.startsWith('furn:') ? key.slice(5) : key;
      if (game.entities && game.registry.furniture && game.registry.furniture.has(fkey)) {
        return !!game.entities.place(fkey, x, y, z, rot, color, {}, { history: true });
      }
      return game.placeBlock(x, y, z, key.replace(/^block:/, ''));
    },
    teleport: (x, y, z) => game.player && game.player.teleport(x, y, z),
    setTime: (dayTime) => game.setDayTime(dayTime),
    select(itemKey) {
      if (!game.registry.items.has(itemKey)) return false;
      game.setSlot(game.hotbar.index, itemKey);
      return true;
    },
    /** Simulate a Build-tool tap on block (x,y,z) (top face by default). */
    useAt(x, y, z, face = [0, 1, 0]) {
      if (!game.world) return false;
      game.setTool('build');
      return game.useTarget(blockHit(x, y, z, face));
    },
    /** Simulate a Hand-tool tap on an entity by uid. */
    interact(uid) {
      const e = game.entities && game.entities.byUid(uid);
      if (!e || !e.pickable) return false;
      const b = e.pickable.box;
      const point = b ? b.getCenter(new THREE.Vector3()) : new THREE.Vector3(e.x + 0.5, e.y + 0.5, e.z + 0.5);
      return game.interact({ type: 'pickable', pickable: e.pickable, point, distance: 1, face: [0, 1, 0], place: [e.x, e.y + 1, e.z] });
    },
    screenshot() {
      game.renderer.render(game.scene, game.camera);
      return game.renderer.domElement.toDataURL('image/png');
    },
    getBlock: (x, y, z) => (game.world ? game.registry.blocks.byId(game.world.get(x, y, z))?.key : null),
    heightAt: (x, z) => (game.world ? game.world.heightAt(x, z) : -1),
    entities: () => (game.entities ? game.entities.all().map((e) => ({ uid: e.uid, key: e.key, x: e.x, y: e.y, z: e.z, rot: e.rot })) : []),
    info() {
      const p = game.player;
      return {
        mode: game.mode, loading: game.loading, busy: game._busy, paused: game.paused,
        world: game.world ? { ...game.world.meta, size: game.world.size } : null,
        pendingChunks: game.chunks ? game.chunks.pending : 0,
        fps: Math.round(game.fps),
        calls: game.renderer.info.render.calls,
        triangles: game.renderer.info.render.triangles,
        player: p ? { x: p.position.x, y: p.position.y, z: p.position.z, state: p.state } : null,
        time: { ...game.time },
        storage: game.store.backendName,
        panel: game.ui ? game.ui.current : null,
      };
    },
    /** Resolves once the world is fully meshed and no load/save is running. */
    async waitIdle(timeoutMs = 20000) {
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        if (!game._busy && !game.loading && (!game.chunks || game.chunks.pending === 0)) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    },
  };
}
