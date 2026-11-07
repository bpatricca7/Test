// Wave 5 end to end (docs/teams/wave5-plan.md §4), no browser, about 10 s:
//   node tools/test-wave5-integration.mjs [--only=cruise|holiday] [--verbose]   (npm run test:wave5)
// For Cruise Ship and Holiday Village, seeds 1..4, Cozy and Big: the real block registry and
// World, the real biome generate(), then world.features through the REAL placers: features.js
// and the real install() of entities, furniture, prefabs, pets, garden, cooking, vehicles,
// squish, cruise, gifts, elves, reindeer and holiday looks (main.js order), on a stand-in game
// built on Game.prototype (real history, systems, serializeWorld) with the real Physics. Only
// the renderer, the DOM, audio and the UI are stand-ins. A recorder round every placer and
// every entities.place call only watches.
//   W0-W3 per kind: records emitted / placed / forced / moved / skipped, every warning; every
//         non-spot record placed (no force, every piece), no two entities share a cell, none in
//         a solid block, everything stands on something (or hangs under it), no warnings
//   H1-H6 12+ hiding elves (one per record), the booth, the workshop, n presents, the elf home;
//         the herd inside its pasture area on its floor; the sleigh at its record on the pad;
//         elves face the spawn (elf records carry no rot); room in front of the booth, workshop, sign
//   C1-C3 every slide, lift, arcade, game, golf, dance, movie, wheel, board, float and lounger
//         placed, the board knows every spot; every lift stop opens onto its deck; tappable
//         pieces have room in front; slides ride into the water, floats sit on the water's top
//         cell, the movie screen's whole picture is clear
//   S1    a save and a load (twice) runs no placer and keeps the same entities, pets and spots
//   G1    a friend's page (game.net.isGuest) places nothing
//   X1    the checker itself catches a forced overlap, a piece in a block and an unowned record

class FakeImageData { constructor(data, w, h) { if (typeof data === 'number') { h = w; w = data; data = new Uint8ClampedArray(w * h * 4); } this.data = data; this.width = w; this.height = h; } }
globalThis.ImageData = globalThis.ImageData || FakeImageData;
function fakeCanvas() {
  const c = { width: 16, height: 16, style: {}, className: '', _ctx: null, toDataURL: () => 'data:image/png;base64,AAAA', addEventListener() {} };
  c.getContext = (kind) => {
    if (kind && kind !== '2d') return null;
    if (c._ctx) return c._ctx;
    const ctx = {
      canvas: c,
      getImageData: (x, y, ww, hh) => new ImageData(new Uint8ClampedArray(Math.max(1, ww * hh) * 4), ww, hh),
      createImageData: (ww, hh) => new ImageData(new Uint8ClampedArray(Math.max(1, ww * hh) * 4), ww, hh),
      measureText: (t) => ({ width: String(t).length * 6 }),
    };
    c._ctx = new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
    return c._ctx;
  };
  return c;
}
class FakeEl {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.style = { setProperty() {} }; this.dataset = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  appendChild(c) { this.children.push(c); return c; }
  append() {} prepend() {} remove() {} setAttribute() {} getAttribute() { return null; } addEventListener() {} removeEventListener() {}
  querySelector() { return null; } querySelectorAll() { return []; } insertAdjacentHTML() {} animate() { return { finished: Promise.resolve(), cancel() {} }; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; }
}
globalThis.window = globalThis;
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});
globalThis.document = {
  hidden: false,
  createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : new FakeEl(tag)),
  head: new FakeEl('head'), body: new FakeEl('body'),
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
};

const THREE = await import('three');
const { Emitter } = await import('../src/core/events.js');
const { ItemRegistry, BlockRegistry, SHAPES } = await import('../src/core/registry.js');
const { World, WORLD_SIZES } = await import('../src/world/world.js');
const { Physics } = await import('../src/world/physics.js');
const { mulberry32 } = await import('../src/core/util.js');
const { Noise } = await import('../src/core/noise.js');
const { defaultProfile, Game } = await import('../src/core/game.js');
const blocksMod = await import('../src/world/blocks.js');
const worldgen = await import('../src/world/worldgen.js');
const entitiesMod = await import('../src/things/entities.js');
const furnitureMod = await import('../src/things/furniture.js');
const featuresMod = await import('../src/world/features.js');
const petsMod = await import('../src/things/pets.js');
const prefabsMod = await import('../src/things/prefabs.js');
const gardenMod = await import('../src/things/garden.js');
const cookingMod = await import('../src/things/cooking.js');
const squishMod = await import('../src/things/squish/index.js');
const vehiclesMod = await import('../src/things/vehicles/index.js');
const cruiseMod = await import('../src/things/cruise/index.js');
const giftsMod = await import('../src/things/gifts/index.js');
const elvesMod = await import('../src/things/elves/index.js');
const reindeerMod = await import('../src/things/reindeer/index.js');
const holidayLooksMod = await import('../src/player/holiday/index.js');

const any = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : any()), apply: () => any() });

const warnings = [];
let warnTag = 'install';
const origWarn = console.warn, origError = console.error;
console.warn = (...a) => warnings.push({ tag: warnTag, level: 'warn', text: a.map((x) => (x && x.stack) || String(x)).join(' ') });
console.error = (...a) => warnings.push({ tag: warnTag, level: 'error', text: a.map((x) => (x && x.stack) || String(x)).join(' ') });

/** The UI layer: every panel, button and toast is a no-op (no DOM here); flags read false. */
function fakeUi() {
  const flags = { dialogOpen: false, panelOpen: false, isOpen: () => false, current: null, openName: null };
  return new Proxy({}, { get: (t, k) => (k in flags ? flags[k] : k === 'then' ? undefined : any()) });
}

function makeGame({ guest = false } = {}) {
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
 * Install the real modules in main.js's order (the ones this check needs), with a recorder
 * round every placer and every entities.place call (it only watches; nothing is changed).
 */
function installAll(game) {
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
  game.registry.blocks.finalize(() => 0, () => false);
  game.events.emit('game:ready', {});
  return log;
}

/** Game._enterWorld without a renderer: systems load (onWorldLoad, deserialize), then 'world:load'. */
function enterWorld(game, world, save) {
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
function unloadWorld(game) {
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
function newWorld(game, biome, size, seed) {
  unloadWorld(game);
  const def = game.registry.biomes.get(biome);
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
function saveAndReload(game) {
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

// ---------------- what a world's records became ----------------

const SPOT_KINDS = new Set(['cruise:spot', 'holiday:spot']);
const CRUISE_MUST = ['cruise:slide', 'cruise:lift', 'cruise:arcade', 'cruise:game', 'cruise:golf', 'cruise:dance', 'cruise:movie',
  'cruise:wheel', 'cruise:board', 'cruise:float'];
// a record skipped on purpose: kind -> why (none today; a deliberate skip is listed here with its reason)
const DELIBERATE_SKIPS = new Map();

const kindOf = (r) => (r.kind === 'furn' ? `furn:${r.key}` : r.kind);
const clampN = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v | 0)) : d);

/** How many pieces a record should end up as (a lift: one button per stop; golf: the sign and a flag per cup...). */
function wanted(r) {
  switch (r.kind) {
    case 'cruise:lift': return Array.isArray(r.stops) ? r.stops.length : 1;
    case 'cruise:golf': return 1 + (Array.isArray(r.holes) ? r.holes.filter((h) => h && Array.isArray(h.cup)).length : 0);
    case 'holiday:presents': return Math.min(clampN(r.n, 3, 8, 5), Array.isArray(r.spots) && r.spots.length ? r.spots.length : 8);
    case 'holiday:elfhome': return 2; // the sign and the greeter
    default: return 1;
  }
}

/** Per record: placed / forced / short / skipped, from the recorder's log (log.calls[i].rec === record). */
function account(game, log, records) {
  const byRec = new Map(log.calls.map((c) => [c.rec, c]));
  const kinds = {};
  const problems = [];
  for (const r of records) {
    const k = kindOf(r);
    const row = kinds[k] || (kinds[k] = { emitted: 0, placed: 0, forced: 0, moved: 0, skipped: 0, spot: SPOT_KINDS.has(r.kind) });
    row.emitted++;
    const c = byRec.get(r);
    const where = `${k} at ${r.x},${r.y},${r.z} rot ${r.rot | 0}`;
    if (!c) {
      row.skipped++;
      if (!SPOT_KINDS.has(r.kind) && !DELIBERATE_SKIPS.has(k)) problems.push(`${where}: no placer ran (no owner)`);
      continue;
    }
    if (c.threw) { row.skipped++; problems.push(`${where}: the placer threw ${c.threw.message}`); continue; }
    if (SPOT_KINDS.has(r.kind)) { if (c.result !== false) row.placed++; else row.skipped++; continue; }
    const ok = c.places.filter((p) => p.ok);
    const forced = ok.filter((p) => p.force);
    const pets = c.petsAfter - c.petsBefore;
    const got = r.kind === 'holiday:reindeer' ? pets : ok.length;
    const want = r.kind === 'holiday:reindeer' ? clampN(r.n, 1, 4, 2) : wanted(r);
    if (c.result === false || !got) {
      row.skipped++;
      if (!DELIBERATE_SKIPS.has(k)) problems.push(`${where}: skipped (${c.places.length} tries: ${c.places.map((p) => `${p.key}@${p.x},${p.y},${p.z} r${p.rot}${p.force ? ' forced' : ''} ${p.ok ? 'ok' : 'no'}`).join('; ') || 'none'})`);
      continue;
    }
    if (forced.length) {
      row.forced++;
      problems.push(`${where}: placed only with force (${forced.map((p) => p.key).join(', ')}): its cells were not free`);
      continue;
    }
    if (got < want) {
      row.skipped++;
      problems.push(`${where}: ${got} of ${want} pieces placed (${c.places.filter((p) => !p.ok).map((p) => `${p.key}@${p.x},${p.y},${p.z} r${p.rot}`).join('; ')} did not fit)`);
      continue;
    }
    // where the main piece went, against the record (elves may hop to a reachable cell nearby)
    const main = ok[0];
    if (main && r.kind !== 'holiday:reindeer' && r.kind !== 'holiday:presents' && (main.x !== (r.x | 0) || main.y !== (r.y | 0) || main.z !== (r.z | 0) || main.rot !== ((r.rot | 0) & 3))) {
      row.moved++;
      if (!['holiday:elf', 'holiday:elfhome', 'cruise:lift', 'cruise:golf'].includes(r.kind)) {
        problems.push(`${where}: ended at ${main.x},${main.y},${main.z} rot ${main.rot}, not the record's cell and turn`);
      }
    }
    row.placed++;
  }
  return { kinds, problems };
}

/** Every entity: no two share a cell, none inside a solid block, standing on something (or hanging under it). */
function geometry(game) {
  const E = game.entities, w = game.world, props = game.registry.blocks.props;
  const problems = [];
  const solidAt = (x, y, z) => { if (!w.inBounds(x, y, z)) return y < 0; const id = w.get(x, y, z); return id !== 0 && props.solid[id] === 1 && !props.replaceable[id]; };
  const liquidAt = (x, y, z) => w.inBounds(x, y, z) && props.shape[w.get(x, y, z)] === SHAPES.liquid;
  const cells = new Map(), flats = new Map();
  const name = (e) => `${e.key}#${e.uid}@${e.x},${e.y},${e.z}r${e.rot}`;
  for (const e of E.map.values()) {
    const fp = E.footprint(e.def, e.x, e.y, e.z, e.rot);
    const map = e.def.flat ? flats : cells;
    for (const [x, y, z] of fp) {
      if (!w.inBounds(x, y, z)) { problems.push(`${name(e)}: cell ${x},${y},${z} outside the world`); continue; }
      const k = w.index(x, y, z);
      const other = map.get(k);
      if (other) problems.push(`${name(e)} overlaps ${name(other)} at ${x},${y},${z}`);
      else map.set(k, e);
      const id = w.get(x, y, z);
      const thin = y === e.y && props.shape[id] === SHAPES.carpet;
      if (id !== 0 && !props.replaceable[id] && !thin) problems.push(`${name(e)}: cell ${x},${y},${z} is inside ${game.registry.blocks.byId(id)?.key}`);
    }
    const on = e.def.placeOn || 'floor';
    if (on === 'ceiling') {
      const top = e.y + Math.max(1, e.def.size[1] | 0);
      if (!solidAt(e.x, top, e.z)) problems.push(`${name(e)}: hangs under nothing`);
    } else if (on !== 'wall') {
      const bottom = fp.filter((c) => c[1] === e.y);
      const held = bottom.some(([x, y, z]) => solidAt(x, y - 1, z) || liquidAt(x, y - 1, z) || liquidAt(x, y, z) || !!E.at(x, y - 1, z)
        || props.shape[w.get(x, y, z)] === SHAPES.carpet);
      if (!held) problems.push(`${name(e)}: stands on nothing`);
    }
  }
  return problems;
}

/** Can she stand in front of this piece (two free cells over a floor, no other piece there)? */
function frontOpen(game, e) {
  const w = game.world, props = game.registry.blocks.props, E = game.entities;
  const solid = (x, y, z) => { const id = w.get(x, y, z); return id !== 0 && props.solid[id] === 1 && !props.replaceable[id]; };
  const [x, y, z] = e.frontCell();
  const piece = (yy) => { const o = E.at(x, yy, z); return o && o !== e && o.def.colliders !== 'none' && !o.def.flat; };
  return !solid(x, y, z) && !solid(x, y + 1, z) && (solid(x, y - 1, z) || !!E.at(x, y - 1, z)) && !piece(y) && !piece(y + 1);
}

/** The elves' own rule (src/things/elves/index.js faceToward): rot 0..3 turns the front to +Z, +X, -Z, -X. */
function faceToward(x, z, tx, tz) {
  const dx = tx - x, dz = tz - z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz >= 0 ? 0 : 2;
}

/** A picture of the world's things, to compare before and after a save. */
function snapshot(game) {
  const ents = game.entities.all().map((e) => `${e.uid}:${e.key}@${e.x},${e.y},${e.z}r${e.rot}`).sort();
  const pets = game.pets.pets.map((p) => `${p.id}:${p.species}`).sort();
  const spots = game.cruise ? game.cruise.spots().map((s) => `${s.name}@${s.x},${s.y},${s.z}`).sort() : [];
  return { ents, pets, spots };
}

// ---------------- the run ----------------

const ONLY = (() => { const a = process.argv.find((x) => x.startsWith('--only=')); return a ? a.slice(7).split(',') : null; })();
const VERBOSE = process.argv.includes('--verbose');
// pets.findSpot jitters with Math.random: a fixed sequence, so every run sees the same herd
Math.random = mulberry32(0x5eed);

let passed = 0, failures = 0;
const failed = [];
function check(id, cond, msg) {
  if (cond) { passed++; return true; }
  failures++;
  failed.push(`${id}: ${msg}`);
  return false;
}

const BIOMES = ['cruise', 'holiday'].filter((b) => !ONLY || ONLY.includes(b));
const totals = {};
for (const biome of BIOMES) {
  warnTag = `${biome} install`;
  const game = makeGame();
  const log = installAll(game);
  for (const size of ['cozy', 'big']) {
    for (let seed = 1; seed <= 4; seed++) {
      const tag = `${biome} ${size} seed ${seed}`;
      warnTag = tag;
      const w0 = warnings.length;
      const callsBefore = log.calls.length;
      const t0 = performance.now();
      const { world, records } = newWorld(game, biome, size, seed);
      const ms = Math.round(performance.now() - t0);
      const myLog = { calls: log.calls.slice(callsBefore) };
      const { kinds, problems } = account(game, myLog, records);
      const geo = geometry(game);
      // per kind totals
      for (const [k, row] of Object.entries(kinds)) {
        const t = totals[`${biome} ${k}`] || (totals[`${biome} ${k}`] = { emitted: 0, placed: 0, forced: 0, moved: 0, skipped: 0 });
        for (const f of ['emitted', 'placed', 'forced', 'moved', 'skipped']) t[f] += row[f];
      }
      const E = game.entities;
      const ents = E.all();
      const count = (key, pred = () => true) => ents.filter((e) => e.key === key && pred(e)).length;
      console.log(`${tag}: ${records.length} records, ${ents.length} entities, ${game.pets.pets.length} pets (${ms} ms)`);
      if (VERBOSE) for (const [k, row] of Object.entries(kinds)) console.log(`    ${k.padEnd(28)} emitted ${row.emitted} placed ${row.placed} forced ${row.forced} moved ${row.moved} skipped ${row.skipped}`);
      for (const p of problems) check('W1', false, `${tag}: ${p}`);
      for (const p of geo) check('W2', false, `${tag}: ${p}`);
      check('W1', problems.length === 0, `${tag}: every non-spot record placed`);
      check('W2', geo.length === 0, `${tag}: no overlaps, nothing in a block, everything stands on something`);
      check('W0', !!world && records.length > 50, `${tag}: generate() left records`);

      if (biome === 'holiday') {
        const hiders = count('elf_twinkle', (e) => e.data && e.data.role === 'hide');
        check('H1', hiders >= 12, `${tag}: ${hiders} elves hide in the village (12+)`);
        check('H1', hiders === records.filter((r) => r.kind === 'holiday:elf').length, `${tag}: one hiding elf per holiday:elf record`);
        check('H2', count('holiday_booth') === 1, `${tag}: the dress-up booth`);
        check('H2', count('gift_workshop') === 1, `${tag}: the Gift Workshop`);
        const pres = records.find((r) => r.kind === 'holiday:presents');
        const boxes = count('gift_box', (e) => e.data && e.data.tree);
        check('H2', pres && boxes === wanted(pres) && boxes >= 6, `${tag}: ${boxes} presents round the tree (want ${pres && wanted(pres)})`);
        // elf records carry no rot, so every hiding elf faces the spawn (elves.md); a rot 0 on
        // every record (holiday.js wrote one) turned them all to +Z, into walls and roofs
        check('H5', records.filter((r) => r.kind === 'holiday:elf').every((r) => r.rot === undefined), `${tag}: elf records have no rot`);
        const sp = world.meta.spawn;
        for (const e of ents.filter((x) => x.key === 'elf_twinkle' && x.data && x.data.role === 'hide')) {
          check('H5', e.rot === faceToward(e.x, e.z, sp[0], sp[2]), `${tag}: hiding elf ${e.data.idx} (${e.data.where}) at ${e.x},${e.y},${e.z} faces the spawn (rot ${e.rot})`);
        }
        for (const k of ['holiday_booth', 'gift_workshop', 'elf_sign']) {
          for (const e of ents.filter((x) => x.key === k)) check('H6', frontOpen(game, e), `${tag}: ${k} at ${e.x},${e.y},${e.z} r${e.rot} has room in front`);
        }
        check('H2', count('elf_sign') === 1 && count('elf_twinkle', (e) => e.data && e.data.role === 'greet') === 1, `${tag}: the elf home sign and its greeter`);
        // the herd in its pasture
        const herd = records.find((r) => r.kind === 'holiday:reindeer');
        const deer = game.pets.pets.filter((p) => p.species === 'reindeer');
        check('H3', herd && deer.length === clampN(herd.n, 1, 4, 2), `${tag}: ${deer.length} reindeer in the pasture`);
        if (herd && Array.isArray(herd.area)) {
          const [x0, z0, x1, z1] = herd.area;
          for (const p of deer) {
            const x = p.pos.x, y = p.pos.y, z = p.pos.z;
            const hw = p.spec.halfW;
            check('H3', x - hw >= x0 && x + hw <= x1 + 1 && z - hw >= z0 && z + hw <= z1 + 1, `${tag}: reindeer ${p.name} at ${x.toFixed(2)},${z.toFixed(2)} inside the pasture ${x0}..${x1 + 1} x ${z0}..${z1 + 1}`);
            check('H3', Math.abs(y - herd.y) < 0.6, `${tag}: reindeer ${p.name} stands on the pasture floor (y ${y.toFixed(2)}, floor ${herd.y})`);
            check('H3', !game.physics.bodyBlocked(x, y + 0.01, z, hw, p.spec.height), `${tag}: reindeer ${p.name} is not inside anything`);
          }
        } else check('H3', false, `${tag}: the reindeer record has its pasture area`);
        // the sleigh on its pad
        const sr = records.find((r) => r.kind === 'holiday:sleigh');
        const sleighs = ents.filter((e) => e.key === 'sleigh');
        check('H4', sleighs.length === 1, `${tag}: one sleigh (${sleighs.length})`);
        const sl = sleighs[0];
        if (sl && sr) {
          check('H4', sl.x === sr.x && sl.y === sr.y && sl.z === sr.z && sl.rot === sr.rot, `${tag}: the sleigh at its record ${sr.x},${sr.y},${sr.z} r${sr.rot} (is ${sl.x},${sl.y},${sl.z} r${sl.rot})`);
          const props = game.registry.blocks.props;
          const pad = E.footprint(sl.def, sl.x, sl.y, sl.z, sl.rot).filter((c) => c[1] === sl.y);
          const under = pad.filter(([x, y, z]) => props.solid[world.get(x, y - 1, z)] === 1);
          check('H4', under.length === pad.length, `${tag}: the sleigh's ${pad.length} bottom cells all on the pad (${under.length} on blocks)`);
        }
      } else {
        for (const k of CRUISE_MUST) {
          const row = kinds[k];
          check('C1', row && row.emitted > 0 && row.placed === row.emitted, `${tag}: every ${k} placed (${row ? `${row.placed} of ${row.emitted}` : 'none emitted'})`);
        }
        const lo = kinds['furn:cruise_lounger'];
        check('C1', lo && lo.emitted > 0 && lo.placed === lo.emitted, `${tag}: every lounger placed (${lo ? `${lo.placed} of ${lo.emitted}` : 'none'})`);
        // she arrives in a lift facing its front ("facing out"): every stop's booth faces a cell
        // she can step into (a rot 0 record put two stops face to a wall or a rail)
        for (const e of ents.filter((x) => x.key === 'cruise_lift')) {
          check('C2', frontOpen(game, e), `${tag}: the ${e.data.n} lift at ${e.x},${e.y},${e.z} r${e.rot} opens onto the deck`);
        }
        for (const k of ['cruise_arcade', 'cruise_hoops', 'cruise_ringtoss', 'cruise_shuffle', 'cruise_board', 'cruise_wheel', 'cruise_dj', 'cruise_slide']) {
          for (const e of ents.filter((x) => x.key === k)) check('C2', frontOpen(game, e), `${tag}: ${k} at ${e.x},${e.y},${e.z} r${e.rot} has room in front`);
        }
        // the slides ride their whole path into the pool; the floats float; the big screen's
        // picture (wider than its 5 x 3 footprint) is clear of blocks and other pieces
        for (const e of ents.filter((x) => x.key === 'cruise_slide')) {
          const pl = game.debug.cruise.plan(e.uid);
          check('C3', pl && pl.wet && pl.points > 10, `${tag}: slide ${e.data.n} rides into the water (${JSON.stringify(pl)})`);
        }
        const props = game.registry.blocks.props;
        const liquid = (x, y, z) => props.shape[world.get(x, y, z)] === SHAPES.liquid;
        for (const e of ents.filter((x) => x.key === 'cruise_float')) {
          check('C3', liquid(e.x, e.y, e.z) && !liquid(e.x, e.y + 1, e.z), `${tag}: float at ${e.x},${e.y},${e.z} on the water's top cell`);
        }
        for (const e of ents.filter((x) => x.key === 'cruise_movie')) {
          const wd = Math.max(5, Math.min(24, Math.round(e.data.w || 5))), ht = Math.max(3, Math.min(14, Math.round(e.data.h || 3)));
          const pic = E.footprint({ size: [wd, ht, 1] }, e.x, e.y, e.z, e.rot);
          const bad = pic.filter(([x, y, z]) => world.get(x, y, z) !== 0 || (E.at(x, y, z) && E.at(x, y, z) !== e));
          check('C3', bad.length === 0, `${tag}: the ${wd} x ${ht} movie screen is clear (${bad.length} cells taken: ${bad.slice(0, 4).join(' ')})`);
        }
        const spots = records.filter((r) => r.kind === 'cruise:spot').length;
        check('C1', game.cruise.spots().length === spots, `${tag}: the board knows all ${spots} spots (${game.cruise.spots().length})`);
      }

      // a save and a load: nothing placed again, nothing doubled
      const before = snapshot(game);
      const callsAt = log.calls.length;
      saveAndReload(game);
      const after = snapshot(game);
      check('S1', log.calls.length === callsAt, `${tag}: loading the save ran no placer (${log.calls.length - callsAt} ran)`);
      check('S1', JSON.stringify(before) === JSON.stringify(after), `${tag}: the same entities, pets and spots after a save and a load (${before.ents.length}/${before.pets.length}/${before.spots.length} -> ${after.ents.length}/${after.pets.length}/${after.spots.length})`);
      saveAndReload(game);
      check('S1', JSON.stringify(snapshot(game)) === JSON.stringify(before), `${tag}: and after a second one`);
      const geo2 = geometry(game);
      check('S1', geo2.length === 0, `${tag}: still no overlaps after the reload (${geo2.slice(0, 3).join('; ')})`);

      const mine = warnings.slice(w0);
      for (const w of mine) console.log(`    ${w.level}: ${w.text.split('\n')[0].slice(0, 300)}`);
      check('W3', mine.length === 0, `${tag}: no warnings (${mine.length})`);
    }
  }
}

// the checker itself: a forced overlap, a piece in a block and a record nobody owns are caught
{
  warnTag = 'self-check';
  const game = makeGame();
  const log = installAll(game);
  const { world, records } = newWorld(game, 'holiday', 'cozy', 1);
  const E = game.entities;
  const booth = E.all().find((e) => e.key === 'holiday_booth');
  check('X1', geometry(game).length === 0, 'self-check: a clean world first');
  const extra = E.place('chair', booth.x, booth.y, booth.z, 0, null, {}, { history: false, fx: false, events: false, force: true });
  check('X1', geometry(game).some((p) => /overlaps/.test(p)), 'self-check: a chair forced into the booth is an overlap');
  E.remove(extra, { history: false, fx: false, events: false });
  // re-attach the booth's cells (the forced chair took them over in the occupancy map)
  E.refresh(booth);
  const sp = world.meta.spawn;
  const below = [Math.floor(sp[0]), Math.floor(sp[1]) - 1, Math.floor(sp[2])];
  const sunk = E.place('chair', below[0], below[1], below[2], 0, null, {}, { history: false, fx: false, events: false, force: true });
  check('X1', geometry(game).some((p) => /is inside/.test(p)), 'self-check: a chair forced into the floor is inside a block');
  E.remove(sunk, { history: false, fx: false, events: false });
  const fake = { kind: 'holiday:nobody', x: 1, y: 1, z: 1 };
  game.worldFeatures.run(world, [fake]);
  const acc = account(game, { calls: log.calls }, [...records, fake]);
  check('X1', acc.problems.length === 1 && /no placer ran/.test(acc.problems[0]), `self-check: a record with no owner is reported (${acc.problems.join('; ')})`);
  check('X1', warnings.some((w) => w.tag === 'self-check' && /no owner for kind "holiday:nobody"/.test(w.text)), 'self-check: features.js warned about it once');
  warnings.splice(0, warnings.length, ...warnings.filter((w) => w.tag !== 'self-check'));
}

// a friend's page (game.net.isGuest) places nothing: the host's entities come over the wire
for (const biome of BIOMES) {
  warnTag = `${biome} guest`;
  const game = makeGame({ guest: true });
  const log = installAll(game);
  const { records } = newWorld(game, biome, 'cozy', 1);
  check('G1', records.length > 0 && log.calls.length === 0, `${biome} guest: no placer ran (${log.calls.length})`);
  check('G1', game.entities.map.size === 0 && game.pets.pets.length === 0, `${biome} guest: nothing placed (${game.entities.map.size} entities, ${game.pets.pets.length} pets)`);
}

console.log('\nper kind, all seeds and sizes (emitted / placed / forced / moved / skipped):');
for (const [k, t] of Object.entries(totals).sort()) console.log(`  ${k.padEnd(36)} ${String(t.emitted).padStart(5)} ${String(t.placed).padStart(5)} ${String(t.forced).padStart(4)} ${String(t.moved).padStart(4)} ${String(t.skipped).padStart(4)}`);
const installWarns = warnings.filter((w) => / install$| guest$/.test(w.tag));
for (const w of installWarns) console.log(`  ${w.tag} ${w.level}: ${w.text.split('\n')[0].slice(0, 300)}`);
check('W3', installWarns.length === 0, `no warnings while installing (${installWarns.length})`);

console.warn = origWarn;
console.error = origError;
if (failures) {
  console.log(`\n${failed.length} failed:`);
  for (const f of failed.slice(0, 200)) console.log('  FAIL ' + f);
}
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
