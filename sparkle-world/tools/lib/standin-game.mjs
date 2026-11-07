// The stand-in game the Node tools share (no browser): a Game built on Game.prototype (real
// history, systems, serializeWorld) with the real Physics, the real modules installed in
// main.js's order, and the real biome generate() + world-feature placers, so a generated world
// ends up with its real entities (furniture, cruise pieces, gifts, elves, reindeer, booth...)
// and their real three.js models. Only the renderer, the DOM, audio and the UI are stand-ins.
// Used by tools/test-wave5-integration.mjs (its checks) and tools/sceneview.mjs (pictures).
//
// Import order matters: ./fake-dom.mjs first (it installs `document` only when the caller has
// not set up its own), then three and the game's modules.

import './fake-dom.mjs';
import * as THREE from 'three';
import { Emitter } from '../../src/core/events.js';
import { ItemRegistry, BlockRegistry } from '../../src/core/registry.js';
import { World, WORLD_SIZES } from '../../src/world/world.js';
import { Physics } from '../../src/world/physics.js';
import { mulberry32 } from '../../src/core/util.js';
import { Noise } from '../../src/core/noise.js';
import { defaultProfile, Game } from '../../src/core/game.js';
import * as blocksMod from '../../src/world/blocks.js';
import * as worldgen from '../../src/world/worldgen.js';
import * as entitiesMod from '../../src/things/entities.js';
import * as furnitureMod from '../../src/things/furniture.js';
import * as featuresMod from '../../src/world/features.js';
import * as petsMod from '../../src/things/pets.js';
import * as prefabsMod from '../../src/things/prefabs.js';
import * as gardenMod from '../../src/things/garden.js';
import * as cookingMod from '../../src/things/cooking.js';
import * as squishMod from '../../src/things/squish/index.js';
import * as vehiclesMod from '../../src/things/vehicles/index.js';
import * as cruiseMod from '../../src/things/cruise/index.js';
import * as giftsMod from '../../src/things/gifts/index.js';
import * as elvesMod from '../../src/things/elves/index.js';
import * as reindeerMod from '../../src/things/reindeer/index.js';
import * as holidayLooksMod from '../../src/player/holiday/index.js';

export { THREE, World, WORLD_SIZES, Game, mulberry32, Noise, worldgen };

/** Anything: every property and call gives another `any` (audio, store and other services). */
export const any = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : any()), apply: () => any() });

/** The UI layer: every panel, button and toast is a no-op (no DOM here); flags read false. */
export function fakeUi() {
  const flags = { dialogOpen: false, panelOpen: false, isOpen: () => false, current: null, openName: null };
  return new Proxy({}, { get: (t, k) => (k in flags ? flags[k] : k === 'then' ? undefined : any()) });
}

/** A Game on Game.prototype with stand-in services (guest: a friend's page in a shared world). */
export function makeGame({ guest = false } = {}) {
  const game = Object.create(Game.prototype);
  const events = new Emitter();
  Object.assign(game, {
    container: null, renderer: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(70, 1, 0.05, 700),
    events, input: { on: () => () => {}, press() {}, pointer: null }, audio: any(), store: any(), thumbs: { get: () => Promise.resolve(null) },
    diag: { error() {}, note() {} }, ui: fakeUi(), startHooks: [], createAvatar: null, createPlayer: null, cameraRig: null,
    entities: null, particles: { emit() {} }, stickers: { has: () => false, award: () => true }, defaultLook: {}, actions: new Map(),
    net: guest ? { active: true, isGuest: true, remoteApplying: false, players: () => [], refuse() { return false; }, custody: () => [] } : null,
    _inSystems: false, profile: defaultProfile(), world: null, player: null, physics: null, chunks: null,
    mode: 'title', loading: false, paused: false, time: { t: 0, dayTime: 0.3, day: 1, dayLength: 720 },
    selectedTool: 'build', hotbar: { slots: Array(9).fill(null), colors: Array(9).fill(null), index: 0 }, target: null, history: [],
    pickables: new Set(), colliders: new Set(), reach: 8, systems: [], _systemMap: new Map(), _systemErrors: new Set(),
    _group: null, debug: {}, coins: { add() {} },
  });
  game.registry = {
    items: new ItemRegistry(game.thumbs), stickers: new Map(), recipes: new Map(), prefabs: new Map(), pets: new Map(), biomes: new Map(),
  };
  game.registry.blocks = new BlockRegistry(game.registry.items);
  return game;
}

/**
 * Install the real modules in main.js's order (the ones a world's features need), with a
 * recorder round every placer and every entities.place call (it only watches; nothing is
 * changed). Returns the log: { calls: [{ kind, rec, places, petsBefore, petsAfter, result,
 * threw }] }. finalize(blockRegistry) freezes the block registry the way start() does; the
 * default gives every face texture layer 0 (no pictures needed).
 */
export function installAll(game, { finalize = (reg) => reg.finalize(() => 0, () => false) } = {}) {
  const log = { calls: [], current: null };
  blocksMod.install(game);
  worldgen.install(game);
  entitiesMod.install(game);
  const E = game.entities;
  const realPlace = E.place.bind(E);
  E.place = (key, x, y, z, rot, color, data, opts = {}) => {
    const e = realPlace(key, x, y, z, rot, color, data, opts);
    if (log.current) log.current.places.push({ key, x, y, z, rot, force: !!opts.force, ok: !!e, uid: e ? e.uid : 0 });
    return e;
  };
  furnitureMod.install(game);
  // features.js registers 'furn' through game.worldFeatures.on inside install: wrap on() the
  // moment the registry is set, so every kind (furn included) goes through the recorder
  let wf = null;
  Object.defineProperty(game, 'worldFeatures', {
    configurable: true,
    get: () => wf,
    set(v) {
      wf = v;
      if (!v) return;
      const realOn = v.on.bind(v);
      v.on = (kind, fn) => realOn(kind, (g, rec, world) => {
        const entry = { kind, rec, places: [], petsBefore: g.pets ? g.pets.pets.length : 0, result: undefined, threw: null };
        const outer = log.current;
        log.current = entry;
        try {
          entry.result = fn(g, rec, world);
          return entry.result;
        } catch (err) {
          entry.threw = err;
          throw err;
        } finally {
          entry.petsAfter = g.pets ? g.pets.pets.length : 0;
          log.current = outer;
          log.calls.push(entry);
        }
      });
    },
  });
  featuresMod.install(game);
  prefabsMod.install(game);
  petsMod.install(game);
  gardenMod.install(game);
  cookingMod.install(game);
  vehiclesMod.install(game);
  squishMod.install(game);
  cruiseMod.install(game);
  giftsMod.install(game);
  elvesMod.install(game);
  reindeerMod.install(game);
  holidayLooksMod.install(game);
  // start(): the texture builder freezes the block registry (props), then 'game:ready'
  finalize(game.registry.blocks);
  game.events.emit('game:ready', {});
  return log;
}

/** Game._enterWorld without a renderer: systems load (onWorldLoad, deserialize), then 'world:load'. */
export function enterWorld(game, world, save) {
  world.game = game;
  game.world = world;
  const t = save.time || {};
  game.time = { t: t.t || 0, dayTime: t.dayTime ?? 0.3, day: t.day || 1, dayLength: 720 };
  game.history = [];
  game._group = null;
  game.pickables.clear();
  game.colliders.clear();
  game.physics = new Physics(world, game.colliders);
  game.loading = true;
  for (const s of game.systems) {
    try {
      if (s.onWorldLoad) s.onWorldLoad(world, save);
      if (s.deserialize && save.systems && save.systems[s.name] !== undefined) s.deserialize(save.systems[s.name]);
    } catch (err) {
      console.error(`[game] system "${s.name}" failed to load`, err);
    }
  }
  game.loading = false;
  game.mode = 'play';
  game.events.emit('world:load', { world, save });
}

/** Game._unloadWorld without the store (the save is the caller's). */
export function unloadWorld(game) {
  if (!game.world) return;
  game.mode = 'title';
  game._callSystems('onWorldUnload');
  game.events.emit('world:unload', {});
  game.world = null;
  game.physics = null;
  game.history = [];
  game._group = null;
  game.pickables.clear();
  game.colliders.clear();
}

/** Game.newWorld without the loading screen. Returns the world and the records generate() left. */
export function newWorld(game, biome, size, seed) {
  unloadWorld(game);
  const def = game.registry.biomes.get(biome);
  if (!def) throw new Error(`unknown biome "${biome}" (have: ${[...game.registry.biomes.keys()].join(', ')})`);
  const world = new World(WORLD_SIZES[size], game.registry.blocks);
  world.meta = { id: `w-${biome}-${size}-${seed}`, name: 'Test', biome, seed, createdAt: 0, sizeName: size };
  def.generate(world, mulberry32(seed), new Noise(seed));
  world.computeAllLight();
  const spawn = (def.spawn || worldgen.defaultSpawn)(world);
  world.meta.spawn = spawn;
  // the very objects features.js hands to the placers (it drops world.features itself)
  const records = Array.isArray(world.features) ? world.features.slice() : [];
  const save = {
    v: 1, player: { x: spawn[0], y: spawn[1], z: spawn[2], yaw: Math.PI, flying: false },
    time: { t: 0, dayTime: 0.3, day: 1 }, systems: {}, hotbar: { slots: Array(9).fill(null), colors: Array(9).fill(null), index: 0 },
  };
  game.events.emit('world:created', { world });
  enterWorld(game, world, save);
  return { world, records };
}

/** Game._unloadWorld without the store, then Game.loadWorld from that save. */
export function saveAndReload(game) {
  const save = JSON.parse(JSON.stringify(Game.prototype.serializeWorld.call(game, { thumbnail: false })));
  unloadWorld(game);
  const world = new World(save.size, game.registry.blocks);
  world.decodeBlocks(save.blocks, save.palette);
  world.meta = { id: save.id, name: save.name, biome: save.biome, seed: save.seed, createdAt: save.createdAt, sizeName: save.sizeName, spawn: save.spawn };
  world.waterLevel = save.waterLevel || 0;
  world.outside = save.outside || null;
  world.computeAllLight();
  enterWorld(game, world, save);
  return save;
}
