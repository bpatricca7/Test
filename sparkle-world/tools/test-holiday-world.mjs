// Holiday Village tests (docs/teams/holiday-world.md), no browser:
//   node tools/test-holiday-world.mjs [--only=H0,H1,...]
// Generates the real biome (seeds 1..5, Cozy and Big) and checks what the other wave-5 teams
// and the player rely on.
//   H0 blocks: at most 16 holiday blocks, every tile painted, the registry keeps headroom
//   H1 every world: generates fast (< 300 ms Big), no unknown block keys, nothing dropped
//   H2 the spawn: on the village square, a solid floor and two free cells, facing the tree
//   H3 every feature record: inside the world, its cells air, solid floor under it (a solid
//      ceiling over a hanging lamp), no two records sharing a cell, fields as wave5-plan.md §4.2
//   H4 the counts: workshop, 6+ presents (n 3..8), 12+ elves, elf home, dress-up booth, 4+
//      reindeer, the sleigh, 5+ named spots, furnished cottages
//   H5 the giant tree: 25+ blocks tall, lights and baubles on it, the star on top
//   H6 our furniture sizes and colors match the furniture catalog (the cells we keep clear are the
//      cells used, every color one of the piece's swatches)
//   H7 the biome def: sky colors, snowy weather, the New World card paints without throwing
//   H8 every gem and every elf spot has an air path to the open sky (nothing sealed in a loft or
//      a pine's crown) and no gem sits inside a feature record's cells

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ItemRegistry, BlockRegistry } from '../src/core/registry.js';
import * as blocksMod from '../src/world/blocks.js';
import { World, WORLD_SIZES } from '../src/world/world.js';
import { mulberry32 } from '../src/core/util.js';
import { Noise } from '../src/core/noise.js';
import * as holiday from '../src/world/biomes/holiday.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ONLY = (() => {
  const a = process.argv.find((s) => s.startsWith('--only='));
  return a ? new Set(a.slice(7).split(',')) : null;
})();

let passed = 0, failures = 0;
function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}
async function test(id, name, fn) {
  if (ONLY && !ONLY.has(id)) return;
  try {
    await fn();
    passed++;
    console.log(`ok   ${id} ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${id} ${name}\n     ${err.message}`);
  }
}

// ---------- a tiny fake 2D canvas (tile painters and the card) ----------
globalThis.ImageData = globalThis.ImageData || class {
  constructor(d, w, h) {
    if (typeof d === 'number') { h = w; w = d; d = new Uint8ClampedArray(w * h * 4); }
    this.data = d; this.width = w; this.height = h;
  }
};
function fakeCtx(w = 16, h = 16) {
  const data = new Uint8ClampedArray(w * h * 4);
  const ctx = {
    canvas: { width: w, height: h }, fillStyle: '#000', globalAlpha: 1, imageSmoothingEnabled: false, _w: w, _h: h, _data: data, draws: 0,
    fillRect(x, y, ww, hh) {
      for (const v of [x, y, ww, hh]) if (!Number.isFinite(v)) throw new Error('fillRect with ' + v);
      this.draws++;
    },
    clearRect() {},
    putImageData() {},
    getImageData(x, y, ww, hh) { return new ImageData(ww, hh); },
    createImageData(ww, hh) { return new ImageData(ww, hh); },
    drawImage(src, x, y) {
      if (!src || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('drawImage with a bad source or place');
      this.draws++;
    },
  };
  return new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
}

// ---------- the registry and the worlds ----------
const items = new ItemRegistry();
const reg = new BlockRegistry(items);
blocksMod.install({ registry: { blocks: reg, items } });
if (reg.idOf('farmland') < 0) reg.register({ key: 'farmland', name: 'Farmland', category: 'garden', tiles: { all: 'dirt' } });

const G = holiday.GROUND;
const props = (id) => reg.byId(id) || {};
const solidCube = (id) => id !== 0 && props(id).solid && props(id).shape === 'cube';
const solid = (id) => id !== 0 && props(id).solid && props(id).shape !== 'carpet';

const worlds = [];
for (const size of ['cozy', 'big']) {
  for (let seed = 1; seed <= 5; seed++) {
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    const world = new World(WORLD_SIZES[size], reg);
    world.meta = { id: 'test', name: 'Test', biome: 'holiday', seed, createdAt: 0, sizeName: size };
    const t0 = performance.now();
    let error = null;
    try {
      holiday.generate(world, mulberry32(seed), new Noise(seed));
    } catch (err) {
      error = err;
    }
    const ms = performance.now() - t0;
    console.warn = orig;
    worlds.push({ size, seed, world, ms, warns, error, tag: `${size} seed ${seed}` });
  }
}
const each = (fn) => {
  for (const w of worlds) {
    assert(!w.error, `${w.tag}: generate() threw ${w.error && w.error.stack}`);
    fn(w.world, w);
  }
};

// ---------- tests ----------

await test('H0', 'at most 16 holiday blocks, each tile painted, headroom left', () => {
  const src = readFileSync(path.join(ROOT, 'src/world/paint/holiday.js'), 'utf8');
  const keys = [...src.matchAll(/key: '([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert(keys.length >= 10 && keys.length <= 16, `holiday blocks: ${keys.length} (budget 16)`);
  for (const k of keys) {
    const d = reg.byKey(k);
    assert(d && d.id > 0, `block ${k} registered`);
    assert(d.category === 'holiday', `${k} is in the holiday Bag tab`);
    for (let face = 0; face < 6; face++) {
      const tile = reg.faceTile(d, face);
      const p = reg.painters.get(tile);
      assert(p, `${k} face ${face}: tile ${tile} has a painter`);
      p(fakeCtx(), mulberry32(7));
    }
  }
  assert(reg.count <= 244, `registry has ${reg.count} blocks (limit 256; 214 before wave 5 + 14 cruise + 16 holiday; keep room for later waves)`);
});

await test('H1', 'every world generates fast, no unknown blocks, nothing dropped', () => {
  each((world, w) => {
    const unknown = w.warns.filter((s) => /unknown|block/i.test(s));
    assert(!unknown.length, `${w.tag}: warnings ${unknown.join(' | ')}`);
    assert(w.ms < (w.size === 'big' ? 300 : 200), `${w.tag}: generate took ${w.ms.toFixed(0)} ms`);
    const dropped = world.holidayDropped || [];
    assert(!dropped.length, `${w.tag}: dropped ${dropped.map((d) => `${d.record.kind} ${d.record.key || ''} (${d.why})`).join(', ')}`);
    assert(Array.isArray(world.features), `${w.tag}: world.features is a list`);
    assert(world.waterLevel === 0, `${w.tag}: no sea`);
    assert(world.outside && world.outside.block === 'snow', `${w.tag}: snowy horizon`);
    assert(world.gemTotal >= 12, `${w.tag}: gems ${world.gemTotal}`);
    let bad = 0;
    for (let i = 0; i < world.blocks.length; i++) if (world.blocks[i] !== 0 && !reg.byId(world.blocks[i])) bad++;
    assert(!bad, `${w.tag}: ${bad} cells with ids the registry does not know`);
  });
});

await test('H2', 'the spawn is on the village square with room to stand', () => {
  each((world, w) => {
    const [sx, sy, sz] = world._spawn;
    const x = Math.floor(sx), y = Math.floor(sy), z = Math.floor(sz);
    const tx = Math.floor(world.sx / 2), tz = Math.floor(world.sz / 2);
    const d = Math.hypot(x - tx, z - tz);
    assert(d <= 13 && d >= 8, `${w.tag}: spawn ${d.toFixed(1)} blocks from the tree (on the square, not under it)`);
    assert(z > tz, `${w.tag}: spawn south of the tree so a new player (looking north) faces it`);
    assert(y === G + 1, `${w.tag}: spawn at the floor`);
    assert(solidCube(world.get(x, y - 1, z)), `${w.tag}: solid floor under the spawn`);
    assert(world.get(x, y, z) === 0 && world.get(x, y + 1, z) === 0, `${w.tag}: two free cells at the spawn`);
    for (const r of world.features) {
      for (const [cx, cy, cz] of holiday.recordCells(r)) assert(!(cx === x && cz === z && (cy === y || cy === y + 1)), `${w.tag}: ${r.kind} ${r.key || ''} stands on the spawn`);
    }
  });
});

const KINDS = new Set(['furn', 'holiday:workshop', 'holiday:presents', 'holiday:elf', 'holiday:elfhome', 'holiday:dressup', 'holiday:reindeer', 'holiday:sleigh', 'holiday:spot']);

await test('H3', 'every record: in bounds, air cells, solid floor, no overlaps, plan fields', () => {
  each((world, w) => {
    const used = new Map();
    for (const r of world.features) {
      const what = `${w.tag}: ${r.kind} ${r.key || r.where || r.name || ''} at ${r.x},${r.y},${r.z}`;
      assert(KINDS.has(r.kind), `${what}: known kind`);
      assert([r.x, r.y, r.z].every(Number.isInteger) && [0, 1, 2, 3].includes(r.rot), `${what}: integer cell, rot 0..3`);
      if (r.kind === 'furn') assert(holiday.FURN_SIZE[r.key], `${what}: size known`);
      if (r.kind === 'holiday:presents') {
        assert(Number.isInteger(r.n) && r.n >= 3 && r.n <= 8, `${what}: n ${r.n}`);
        assert(Array.isArray(r.spots) && r.spots.length >= r.n, `${what}: a spot for each present`);
      }
      if (r.kind === 'holiday:reindeer') {
        assert(Number.isInteger(r.n) && r.n >= 1 && r.n <= 4, `${what}: n ${r.n}`);
        const [x0, z0, x1, z1] = r.area;
        assert(x0 < x1 && z0 < z1 && r.x >= x0 && r.x <= x1 && r.z >= z0 && r.z <= z1, `${what}: inside its area`);
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            assert(solid(world.get(x, r.y - 1, z)), `${what}: pasture floor at ${x},${z}`);
            assert(world.get(x, r.y, z) === 0 && world.get(x, r.y + 1, z) === 0, `${what}: pasture open at ${x},${z}`);
          }
        }
      }
      if (r.kind === 'holiday:elf') assert(typeof r.where === 'string' && r.where, `${what}: where`);
      if (r.kind === 'holiday:spot') assert(typeof r.name === 'string' && r.name, `${what}: name`);
      const cells = holiday.recordCells(r);
      const ceiling = r.kind === 'furn' && holiday.CEILING.has(r.key);
      const flat = r.kind === 'furn' && holiday.FLAT.has(r.key);
      const ys = cells.map((c) => c[1]);
      const bottom = Math.min(...ys), top = Math.max(...ys);
      for (const [x, y, z] of cells) {
        assert(world.inBounds(x, y, z), `${what}: cell ${x},${y},${z} inside the world`);
        assert(world.get(x, y, z) === 0, `${what}: cell ${x},${y},${z} is air (holds ${props(world.get(x, y, z)).key})`);
        if (!ceiling && y === bottom) assert(solid(world.get(x, y - 1, z)), `${what}: floor under ${x},${y},${z}`);
        if (ceiling && y === top) assert(solid(world.get(x, y + 1, z)), `${what}: ceiling over ${x},${y},${z}`);
        const k = `${x},${y},${z}`;
        const other = used.get(k);
        assert(!other || other.flat || flat, `${what}: cell ${k} shared with ${other && other.r.kind}`);
        used.set(k, { r, flat });
      }
    }
  });
});

await test('H4', 'workshop, presents, elves, elf home, booth, reindeer, sleigh, spots, cottages', () => {
  each((world, w) => {
    const of = (kind) => world.features.filter((r) => r.kind === kind);
    const furn = (key) => world.features.filter((r) => r.kind === 'furn' && r.key === key).length;
    assert(of('holiday:workshop').length === 1, `${w.tag}: one gift workshop`);
    const presents = of('holiday:presents').reduce((s, r) => s + r.n, 0);
    assert(presents >= 6, `${w.tag}: ${presents} presents`);
    assert(of('holiday:elf').length >= 12, `${w.tag}: ${of('holiday:elf').length} elf spots`);
    const wheres = new Set(of('holiday:elf').map((r) => r.where));
    assert(wheres.size >= 6, `${w.tag}: elves hide in ${wheres.size} kinds of places`);
    for (const where of ['tree', 'shelf', 'roof', 'window', 'chimney', 'lamp', 'fence']) assert(wheres.has(where), `${w.tag}: an elf hides on a ${where}`);
    assert(of('holiday:elfhome').length === 1, `${w.tag}: one elf home`);
    assert(of('holiday:dressup').length === 1, `${w.tag}: one dress-up booth`);
    const deer = of('holiday:reindeer').reduce((s, r) => s + r.n, 0);
    assert(deer >= 4, `${w.tag}: ${deer} reindeer`);
    assert(of('holiday:sleigh').length === 1, `${w.tag}: one sleigh`);
    const spots = new Set(of('holiday:spot').map((r) => r.name));
    assert(spots.size >= 5, `${w.tag}: ${spots.size} named spots`);
    for (const name of ['tree', 'workshop', 'stable', 'pond', 'cottages']) assert(spots.has(name), `${w.tag}: spot ${name}`);
    for (const key of ['bed_single', 'fireplace', 'sofa', 'table_round', 'floor_lamp', 'fairy_lights', 'door']) assert(furn(key) >= 3, `${w.tag}: ${furn(key)} ${key}`);
    assert(furn('armchair') >= 1, `${w.tag}: Santa's chair`);
    assert(furn('candy_shop') >= 1, `${w.tag}: the cocoa stand`);
    assert(furn('fence') >= 20 && furn('gate') >= 1, `${w.tag}: the pasture fence and gate`);
    assert(furn('lantern_post') >= 8, `${w.tag}: lamp posts`);
    for (const r of world.features) {
      if (r.kind !== 'furn' || r.key !== 'fence') continue;
      assert(r.data && Number.isInteger(r.data.conn) && r.data.conn > 0, `${w.tag}: fence at ${r.x},${r.z} joins a neighbour`);
    }
  });
});

await test('H5', 'the giant tree: 25+ tall, lights and baubles, the star on top', () => {
  each((world, w) => {
    const tx = Math.floor(world.sx / 2), tz = Math.floor(world.sz / 2);
    let top = world.sy - 1;
    while (top > 0 && world.get(tx, top, tz) === 0) top--;
    assert(top - G >= 25, `${w.tag}: tree ${top - G} tall`);
    assert(props(world.get(tx, top, tz)).key === 'holiday_star', `${w.tag}: the star is on top`);
    const count = {};
    for (let y = G + 1; y <= top; y++) {
      for (let z = tz - 11; z <= tz + 11; z++) {
        for (let x = tx - 11; x <= tx + 11; x++) {
          const k = props(world.get(x, y, z)).key;
          if (k && k.startsWith('holiday_')) count[k] = (count[k] || 0) + 1;
        }
      }
    }
    for (const k of ['holiday_lights', 'holiday_lights_gold', 'holiday_lights_icy']) assert((count[k] || 0) >= 25, `${w.tag}: ${count[k] || 0} ${k} on the tree`);
    const baubles = (count.holiday_bauble_red || 0) + (count.holiday_bauble_gold || 0) + (count.holiday_bauble_blue || 0);
    assert(baubles >= 20, `${w.tag}: ${baubles} baubles`);
    assert((count.holiday_star || 0) >= 20, `${w.tag}: star blocks ${count.holiday_star || 0}`);
    let lights = 0;
    for (let i = 0; i < world.blocks.length; i++) if (props(world.blocks[i]).light >= 12) lights++;
    assert(lights >= 600, `${w.tag}: ${lights} glowing blocks in the village`);
  });
});

await test('H6', 'furniture sizes and colors match the catalog', async () => {
  const { furnitureDefs } = await import('../src/things/furniture/catalog.js');
  const defs = new Map(furnitureDefs().map((d) => [d.key, d]));
  for (const [key, size] of Object.entries(holiday.FURN_SIZE)) {
    if (key === 'candy_shop') { assert(size.join() === '3,3,2', 'shop size (src/things/shops/index.js)'); continue; }
    const d = defs.get(key);
    assert(d, `${key} is in the catalog`);
    assert(d.size.join() === size.join(), `${key}: catalog ${d.size} vs ours ${size}`);
    assert((d.placeOn === 'ceiling') === holiday.CEILING.has(key), `${key}: hangs from a ceiling iff the catalog says so`);
    assert(d.placeOn !== 'wall', `${key}: no wall items (they need a wall face, not a floor)`);
  }
  // every color we ask for is one of that furniture's own swatches
  const { SHOP_COLORS } = await import('../src/things/shops/models.js');
  each((world, w) => {
    for (const r of world.features) {
      if (r.kind !== 'furn' || !r.color) continue;
      const colors = r.key === 'candy_shop' ? SHOP_COLORS : defs.get(r.key).colors;
      assert(colors && colors.includes(r.color), `${w.tag}: ${r.key} color ${r.color} is one of its swatches`);
    }
  });
  // the same footprint rule as game.entities: anchor = front row middle, rot turns the front
  assert(holiday.boxCells([3, 1, 2], 0, 0, 0, 0).map((c) => c.join()).sort().join(' ') === '-1,0,-1 -1,0,0 0,0,-1 0,0,0 1,0,-1 1,0,0', 'footprint rot 0');
  assert(holiday.boxCells([1, 1, 3], 0, 0, 0, 1).map((c) => c.join()).sort().join(' ') === '-1,0,0 -2,0,0 0,0,0', 'footprint rot 1 extends -X');
});

await test('H7', 'sky, snowy weather, the New World card', () => {
  const b = holiday.biome;
  assert(b.key === 'holiday' && b.name === 'Holiday Village', 'key and name');
  for (const k of ['top', 'horizon', 'fog', 'nightTop']) assert(/^#[0-9a-f]{6}$/i.test(b.sky[k]), `sky.${k}`);
  const wts = b.weather;
  assert(wts.snow > wts.sunny && wts.snow > wts.cloudy && !wts.rain, 'snow is the most likely weather, never rain');
  assert(reg.byKey(b.iconBlock), 'icon block exists');
  const g = fakeCtx(288, 176);
  const tileFor = (d) => fakeCtx();
  const drawSparkle = (c, x, y, s, color) => { c.fillStyle = color; c.fillRect(x - s, y, s * 2 + 1, 1); };
  b.paintArt(g, 288, 176, { rand: mulberry32(1), reg, tileFor, drawSparkle, pixelCloud() {} });
  assert(g.draws > 500, `the card paints (${g.draws} draws)`);
  // and with no tiles at all (a fallback color for each block)
  b.paintArt(fakeCtx(288, 176), 288, 176, { rand: mulberry32(2), reg, tileFor: () => null, drawSparkle, pixelCloud() {} });
});

await test('H8', 'every gem and every elf can be reached from the open sky (none sealed in, no gem in a feature)', () => {
  each((world, w) => {
    const g = { world, sx: world.sx, sy: world.sy, sz: world.sz, inside: (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < world.sx && y < world.sy && z < world.sz, get: (x, y, z) => world.get(x, y, z) };
    const tops = holiday.skyTops(g);
    const cells = new Set();
    for (const r of world.features) for (const c of holiday.recordCells(r)) cells.add(c.join(','));
    for (const [x, y, z] of world.gemSpots) {
      assert(!cells.has([x, y, z].join(',')), `${w.tag}: gem ${x},${y},${z} inside a feature`);
      assert(holiday.openToSky(g, tops, x, y, z, 4000), `${w.tag}: gem ${x},${y},${z} sealed in`);
    }
    for (const r of world.features) {
      if (r.kind !== 'holiday:elf') continue;
      assert(holiday.openToSky(g, tops, r.x, r.y, r.z, 4000), `${w.tag}: elf (${r.where}) at ${r.x},${r.y},${r.z} sealed in`);
    }
  });
});

console.log(`\n${passed} passed, ${failures} failed (${worlds.map((w) => `${w.tag} ${w.ms.toFixed(0)}ms`).join(', ')})`);
process.exit(failures ? 1 : 0);
