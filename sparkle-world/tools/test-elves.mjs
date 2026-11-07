// The Twinkle Elves (docs/teams/elves.md), no browser, seconds:
//   node tools/test-elves.mjs            (npm run test:elves, once the integrator adds it)
//   E1  hiding spots are never inside a solid block, always on something, always reachable
//   E2  never the same spot two mornings in a row (and old spots sink)
//   E3  works in a home with no furniture at all; prefers furniture when there is some
//   E4  a sealed room, the player's own cell and a world with no room give no spot there
//   E5  the same seed picks the same spot (every page and every reload agree)
//   E6  nearestSpot, lineOfSight, furnitureTop, localCell
//   E7  daily caps: at most COIN_CAP coins a day, a new day starts over, a clock that went back pays 0
//   E8  profile.elves: found masks, house finds, normalize, merge (nothing found is lost), 24 worlds
//   E9  the per-world save, names, world keys
//   E10 words: no famous names, no he/she, no while / Math.random in the pure files
//   E11 the shared line: the el_elf icon in pets/kit.js; index.js uses only real exports

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../src/things/elves/data.js';
import { pickHideSpot, nearestSpot, spotSupport, findStand, lineOfSight, candidates, furnitureTop, localCell, rotXZ, airRegion, homeRegion } from '../src/things/elves/spots.js';
import { scanText, scanCharacters } from './lib/name-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const DIR = 'src/things/elves';

// ---------------- a made-up world: blocks in a Set, furniture tops in a Map ----------------

const K = (x, y, z) => `${x},${y},${z}`;

/**
 * size [X, Y, Z]; floor of solid blocks at y = 0. furn: Map 'x,y,z' (the furniture's own top
 * cell) -> { dy, key, bath, collide } (an elf may stand in the cell above it).
 */
function makeWorld({ size = [32, 16, 32], floor = true } = {}) {
  const [X, Y, Z] = size;
  const solid = new Set();
  const furn = new Map();
  if (floor) for (let x = 0; x < X; x++) for (let z = 0; z < Z; z++) solid.add(K(x, 0, z));
  const inBounds = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < X && y < Y && z < Z;
  const isSolid = (x, y, z) => (inBounds(x, y, z) ? solid.has(K(x, y, z)) : y < 0);
  const view = {
    inBounds,
    solid: isSolid,
    liquid: () => false,
    open: (x, y, z) => inBounds(x, y, z) && !solid.has(K(x, y, z)) && !furn.has(K(x, y, z)),
    support(x, y, z) {
      if (!inBounds(x, y - 1, z)) return null;
      if (solid.has(K(x, y - 1, z))) return { dy: 0, kind: 'block', key: 'stone' };
      const f = furn.get(K(x, y - 1, z));
      return f ? { dy: f.dy, kind: 'furn', key: f.key, uid: 1, bath: !!f.bath } : null;
    },
    standable(x, y, z) {
      if (!inBounds(x, y, z)) return false;
      for (let k = 0; k < 2; k++) {
        if (isSolid(x, y + k, z)) return false;
        const f = furn.get(K(x, y + k, z));
        if (f && f.collide !== false) return false;
      }
      return isSolid(x, y - 1, z) || !!furn.get(K(x, y - 1, z));
    },
  };
  const box = (x0, y0, z0, x1, y1, z1) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) solid.add(K(x, y, z)); };
  /** A hollow house: walls x0..x1, z0..z1, floor y = 0, walls up to y = h, a roof at h + 1, a door gap. */
  const house = (x0, z0, x1, z1, h = 4) => {
    for (let y = 1; y <= h; y++) {
      for (let x = x0; x <= x1; x++) { solid.add(K(x, y, z0)); solid.add(K(x, y, z1)); }
      for (let z = z0; z <= z1; z++) { solid.add(K(x0, y, z)); solid.add(K(x1, y, z)); }
    }
    box(x0, h + 1, z0, x1, h + 1, z1);
    const mx = (x0 + x1) >> 1;
    solid.delete(K(mx, 1, z1));
    solid.delete(K(mx, 2, z1));
  };
  return { view, solid, furn, box, house, size };
}

/** Everything a picked spot must be (the rules of spots.js, checked from the outside). */
function assertGoodSpot(w, s) {
  const { view } = w;
  assert.ok(s, 'a spot');
  assert.ok([s.x, s.y, s.z].every(Number.isInteger), 'integer cell');
  assert.ok(view.inBounds(s.x, s.y, s.z), 'in the world');
  assert.equal(w.solid.has(K(s.x, s.y, s.z)), false, 'never inside a solid block');
  assert.equal(w.furn.has(K(s.x, s.y, s.z)), false, 'never inside furniture');
  const sup = view.support(s.x, s.y, s.z);
  assert.ok(sup, 'always on something');
  assert.ok(s.dy > -1 && s.dy <= 0.05, 'dy in range');
  assert.ok(Array.isArray(s.stand), 'has a place to stand');
  const [sx, sy, sz] = s.stand;
  assert.ok(view.standable(sx, sy, sz), 'the stand cell is standable');
  const d = Math.hypot(sx + 0.5 - (s.x + 0.5), sy + 1.6 - (s.y + s.dy + 0.32), sz + 0.5 - (s.z + 0.5));
  assert.ok(d <= D.REACH + 1e-9, `within reach (${d.toFixed(2)})`);
  assert.ok(lineOfSight(view, sx + 0.5, sy + 1.6, sz + 0.5, s.x + 0.5, s.y + s.dy + 0.32, s.z + 0.5), 'nothing solid between');
}

function aHome() {
  const w = makeWorld();
  w.house(8, 8, 18, 16, 4);
  // furniture: a shelf top, a fridge top, a sofa back, a bathtub (inside), a lamp
  w.furn.set(K(9, 1, 9), { dy: -0.1, key: 'bookshelf' }); w.furn.set(K(9, 2, 9), { dy: -0.1, key: 'bookshelf' });
  w.furn.set(K(17, 1, 9), { dy: -0.05, key: 'fridge' }); w.furn.set(K(17, 2, 9), { dy: -0.05, key: 'fridge' });
  w.furn.set(K(12, 1, 15), { dy: -0.4, key: 'sofa' });
  w.furn.set(K(16, 1, 15), { dy: -0.6, key: 'bathtub', bath: true });
  return w;
}

// ---------------- E1 .. E5: picking a hiding place ----------------

describe('E1 hiding places are good places', () => {
  test('never inside a solid block, always supported and reachable (300 mornings)', () => {
    const w = aHome();
    let last = null;
    const prev = [];
    for (let day = 1; day <= 300; day++) {
      const s = pickHideSpot(w.view, { anchor: [13, 1, 12], rand: D.rng(D.hashStr(`t:${day}`)), last, prev, player: [13.5, 1, 12.5] });
      assertGoodSpot(w, s);
      if (last) prev.push(last);
      while (prev.length > 3) prev.shift();
      last = [s.x, s.y, s.z];
    }
  });

  test('every candidate is open and supported', () => {
    const w = aHome();
    const all = candidates(w.view, [13, 1, 12]);
    assert.ok(all.length > 50);
    for (const c of all) {
      assert.equal(w.solid.has(K(c.x, c.y, c.z)), false);
      assert.ok(w.view.support(c.x, c.y, c.z));
      assert.ok(c.w > 0);
    }
  });
});

describe('E2 never the same spot twice in a row', () => {
  test('300 mornings in a row', () => {
    const w = aHome();
    let last = null;
    for (let day = 1; day <= 300; day++) {
      const s = pickHideSpot(w.view, { anchor: [13, 1, 12], rand: D.rng(day * 7919), last });
      assert.ok(s);
      if (last) assert.notDeepEqual([s.x, s.y, s.z], last, `day ${day}`);
      last = [s.x, s.y, s.z];
    }
  });

  test('a world with exactly two spots alternates between them', () => {
    const w = makeWorld({ size: [9, 6, 9], floor: false });
    w.box(4, 0, 3, 4, 0, 4); // a tiny bridge in the sky: two floor cells
    let last = null;
    const seen = new Set();
    for (let day = 1; day <= 20; day++) {
      const s = pickHideSpot(w.view, { anchor: [4, 1, 4], rand: D.rng(day), last });
      assert.ok(s, `day ${day}`);
      if (last) assert.notDeepEqual([s.x, s.y, s.z], last);
      last = [s.x, s.y, s.z];
      seen.add(K(s.x, s.y, s.z));
    }
    assert.equal(seen.size, 2);
  });

  test('yesterday and the day before sink (prev)', () => {
    const w = aHome();
    const prev = [[9, 3, 9], [17, 3, 9], [12, 2, 15]];
    let hits = 0;
    for (let day = 1; day <= 200; day++) {
      const s = pickHideSpot(w.view, { anchor: [13, 1, 12], rand: D.rng(day * 31 + 5), prev });
      if (prev.some((p) => p[0] === s.x && p[1] === s.y && p[2] === s.z)) hits++;
    }
    assert.ok(hits < 20, `old spots picked ${hits} times of 200`);
  });
});

describe('E3 furniture or none', () => {
  test('a home with no furniture still gets a spot every morning', () => {
    const w = makeWorld();
    w.house(8, 8, 18, 16, 4);
    let last = null;
    for (let day = 1; day <= 60; day++) {
      const s = pickHideSpot(w.view, { anchor: [13, 1, 12], rand: D.rng(day), last });
      assertGoodSpot(w, s);
      assert.equal(s.kind, 'block');
      last = [s.x, s.y, s.z];
    }
  });

  test('an open field with no house and no furniture', () => {
    const w = makeWorld();
    const s = pickHideSpot(w.view, { anchor: [16, 1, 16], rand: D.rng(3) });
    assertGoodSpot(w, s);
  });

  test('furniture tops are picked more often than the floor', () => {
    const w = aHome();
    let furn = 0, bath = 0;
    for (let day = 1; day <= 300; day++) {
      const s = pickHideSpot(w.view, { anchor: [13, 1, 12], rand: D.rng(day * 101) });
      if (s.kind === 'furn') furn++;
      if (s.bath) { bath++; assert.equal(s.key, 'bathtub'); }
    }
    // 5 furniture cells among ~200 floor and shelf cells
    assert.ok(furn > 300 * 0.05, `furniture ${furn} of 300`);
    assert.ok(bath > 0, 'the bath is used sometimes');
  });
});

describe('E4 places an elf never goes', () => {
  test('a sealed room (no way to see in) is never picked', () => {
    const w = aHome();
    // a sealed 3x3 chamber right next to home, with a floor inside
    w.box(20, 1, 9, 24, 5, 13);
    for (let x = 21; x <= 23; x++) for (let y = 2; y <= 4; y++) for (let z = 10; z <= 12; z++) w.solid.delete(K(x, y, z));
    for (let day = 1; day <= 200; day++) {
      const s = pickHideSpot(w.view, { anchor: [19, 1, 11], rand: D.rng(day) });
      assert.ok(s);
      const inside = s.x >= 21 && s.x <= 23 && s.z >= 10 && s.z <= 12 && s.y >= 2 && s.y <= 4;
      assert.equal(inside, false, `day ${day}: picked inside the sealed room`);
      assertGoodSpot(w, s);
    }
  });

  test('a cave pocket under the floor is never picked, even next to home', () => {
    const w = makeWorld();
    w.box(0, 1, 0, 31, 3, 31); // solid ground three deep
    for (let x = 10; x <= 12; x++) for (let z = 10; z <= 12; z++) { w.solid.delete(K(x, 2, z)); w.solid.delete(K(x, 3, z)); }
    for (let x = 10; x <= 12; x++) for (let z = 10; z <= 12; z++) w.solid.add(K(x, 3, z)); // the cave's roof
    for (let day = 1; day <= 100; day++) {
      const s = pickHideSpot(w.view, { anchor: [11, 4, 11], rand: D.rng(day) });
      assert.ok(s);
      assert.ok(s.y >= 4, `day ${day}: picked in the cave (${s.x},${s.y},${s.z})`);
    }
  });

  test('airRegion: a flood fill of free cells that stops at walls and its box', () => {
    const w = aHome();
    const reg = homeRegion(w.view, [13, 1, 12]);
    assert.ok(reg.has(13, 1, 12) && reg.has(13, 1, 20), 'inside and outside (through the door gap)');
    assert.equal(reg.has(8, 1, 8), false, 'a wall block is not air');
    const sealed = makeWorld();
    sealed.house(2, 2, 6, 6, 3);
    sealed.solid.add(K(4, 1, 6)); sealed.solid.add(K(4, 2, 6)); // the door gap closed
    const inside = airRegion(sealed.view, [4, 1, 4], [0, 0, 0], [12, 8, 12]);
    assert.equal(inside.has(4, 1, 4), true);
    assert.equal(inside.has(9, 1, 9), false);
    assert.equal(airRegion(sealed.view, null, [0, 0, 0], [1, 1, 1]).size(), 0);
  });

  test('never where the player stands', () => {
    const w = aHome();
    const player = [12.5, 1, 11.5];
    for (let day = 1; day <= 200; day++) {
      const s = pickHideSpot(w.view, { anchor: [12, 1, 11], rand: D.rng(day), player, radius: 2, down: 0, up: 1 });
      if (!s) continue;
      assert.ok(!(s.x === 12 && s.z === 11 && (s.y === 1 || s.y === 2)), 'not in the player');
    }
  });

  test('a world that is all stone has no spot: null, no throw', () => {
    const w = makeWorld({ size: [10, 10, 10] });
    w.box(0, 0, 0, 9, 9, 9);
    assert.equal(pickHideSpot(w.view, { anchor: [5, 5, 5], rand: D.rng(1) }), null);
    assert.equal(nearestSpot(w.view, 5, 5, 5), null);
    assert.equal(pickHideSpot(w.view, { anchor: null, rand: D.rng(1) }), null);
    assert.equal(pickHideSpot(w.view, { anchor: [NaN, 1, 1] }), null);
  });

  test('a floating cell (no floor under it) is never a spot', () => {
    const w = makeWorld({ floor: false });
    assert.equal(spotSupport(w.view, 5, 5, 5), null);
    assert.equal(candidates(w.view, [5, 5, 5]).length, 0);
  });
});

describe('E5 the same morning picks the same spot', () => {
  test('same seed, same spot; different seeds spread out', () => {
    const w = aHome();
    const pick = (seed) => { const s = pickHideSpot(w.view, { anchor: [13, 1, 12], rand: D.rng(seed) }); return K(s.x, s.y, s.z); };
    assert.equal(pick(42), pick(42));
    const many = new Set();
    for (let i = 0; i < 40; i++) many.add(pick(i * 977));
    assert.ok(many.size >= 15, `only ${many.size} different spots in 40 mornings`);
  });
});

// ---------------- E6: the helpers ----------------

describe('E6 helpers', () => {
  test('nearestSpot finds the floor below a lost shelf, nearest first, honours avoid', () => {
    const w = aHome();
    const s = nearestSpot(w.view, 13, 3, 12, { r: 2, down: 6, up: 1 });
    assert.deepEqual([s.x, s.y, s.z], [13, 1, 12]);
    const t = nearestSpot(w.view, 13, 3, 12, { r: 2, down: 6, up: 1, avoid: [[13, 1, 12]] });
    assert.ok(t && !(t.x === 13 && t.z === 12));
    assert.equal(w.solid.has(K(t.x, t.y, t.z)), false);
  });

  test('lineOfSight: a wall blocks, open air does not', () => {
    const w = makeWorld();
    assert.equal(lineOfSight(w.view, 2.5, 2.6, 2.5, 8.5, 1.3, 2.5), true);
    w.box(5, 1, 0, 5, 5, 10);
    assert.equal(lineOfSight(w.view, 2.5, 2.6, 2.5, 8.5, 1.3, 2.5), false);
    assert.equal(lineOfSight(w.view, NaN, 1, 1, 2, 2, 2), false);
    assert.equal(findStand(w.view, 8, 1, 2, 0) !== null, true);
  });

  test('furnitureTop: colliders, surface, rugs and wall pieces', () => {
    const table = { size: [1, 1, 1], colliders: 'full', surface: 0.8 };
    assert.equal(furnitureTop(table, 0, 0), 0.8);
    const sofa = { size: [2, 1, 1], colliders: [[0, 0, 0, 2, 0.45, 1], [0, 0, 0, 2, 0.95, 0.25]] };
    assert.equal(furnitureTop(sofa, 0, 0), 0.45); // the cell middle is on the seat, not the back
    assert.equal(furnitureTop(sofa, 2, 0), null); // out of the piece
    assert.equal(furnitureTop({ size: [1, 1, 1], colliders: [[0, 0, 0, 1, 0.05, 1]] }, 0, 0), 0.05);
    assert.equal(furnitureTop({ size: [1, 2, 1], colliders: [[0, 0, 0, 1, 0.5, 1]] }, 0, 0), null); // a short thing in a tall box
    assert.equal(furnitureTop({ size: [1, 1, 1], colliders: 'none' }, 0, 0), null);
    assert.equal(furnitureTop({ size: [1, 1, 1], colliders: () => 'full' }, 0, 0), 1);
    assert.equal(furnitureTop({ size: [1, 1, 1], colliders: () => { throw new Error('x'); } }, 0, 0), null);
  });

  test('localCell is the inverse of the entity footprint for every size and turn', () => {
    for (const [w, d] of [[1, 1], [2, 1], [1, 2], [3, 2], [2, 3]]) {
      const ai = Math.floor((w - 1) / 2);
      for (let rot = 0; rot < 4; rot++) {
        const e = { x: 10, z: 20, rot, def: { size: [w, 1, d] } };
        for (let i = 0; i < w; i++) {
          for (let k = 0; k < d; k++) {
            const [ox, oz] = rotXZ(i - ai, k - (d - 1), rot); // entities.js footprint
            assert.deepEqual(localCell(e, 10 + ox, 20 + oz), [i, k], `w${w} d${d} rot${rot} (${i},${k})`);
          }
        }
      }
    }
  });
});

// ---------------- E7 .. E9: the profile and the save ----------------

describe('E7 daily caps', () => {
  test('at most COIN_CAP coins a day, then a new day', () => {
    const e = D.normalizeElves(null);
    let paid = 0;
    for (let i = 0; i < 20; i++) paid += D.takeCoins(e, D.COIN_VILLAGE, 20261107);
    assert.equal(paid, D.COIN_CAP);
    assert.equal(D.takeCoins(e, D.COIN_HOUSE, 20261107), 0);
    assert.equal(D.takeCoins(e, D.COIN_HOUSE, 20261108), D.COIN_HOUSE);
    // the clock went back a day: nothing
    assert.equal(D.takeCoins(e, D.COIN_HOUSE, 20261107), 0);
    assert.equal(D.takeCoins(e, 0, 20261108), 0);
    assert.equal(D.takeCoins(e, -5, 20261108), 0);
    assert.equal(D.takeCoins(null, 3, 20261108), 0);
    assert.ok(D.COIN_CAP <= 10, 'wave5-plan: elves pay at most 10 a day');
  });

  test('the cap survives a merge (two devices cannot pay twice the cap on the same day)', () => {
    const a = D.normalizeElves(null), b = D.normalizeElves(null);
    D.takeCoins(a, 8, 20261107);
    D.takeCoins(b, 4, 20261107);
    const m = D.mergeElves(a, b);
    assert.equal(m.coinGot, 8);
    assert.equal(D.takeCoins(m, 10, 20261107), 2);
  });

  test('the house elf counts one find per morning', () => {
    const e = D.normalizeElves(null);
    assert.equal(D.markHomeFind(e, 'wabc', 1), true);
    assert.equal(D.markHomeFind(e, 'wabc', 1), false); // the same morning again
    assert.equal(D.markHomeFind(e, 'wabc', 2), true);
    assert.equal(D.markHomeFind(e, 'wabc', 0), false);
    assert.equal(e.homeFinds, 2);
  });
});

describe('E8 profile.elves', () => {
  test('found masks per world', () => {
    const e = D.normalizeElves(undefined);
    assert.equal(D.markFound(e, 'w1', 3), true);
    assert.equal(D.markFound(e, 'w1', 3), false);
    assert.equal(D.markFound(e, 'w1', 29), true);
    assert.equal(D.markFound(e, 'w1', 30), false); // out of range
    assert.equal(D.markFound(e, 'w1', -1), false);
    assert.equal(D.isFound(e, 'w1', 3), true);
    assert.equal(D.isFound(e, 'w2', 3), false);
    assert.equal(D.countFound(e, 'w1', [0, 1, 2, 3, 29]), 2);
    assert.equal(D.isFound(null, 'w1', 3), false);
  });

  test('normalize drops broken parts kindly', () => {
    const e = D.normalizeElves({ met: 1, found: { w1: 5, bad: 3, 'w-2': 1, w3: -4, w4: 'x' }, home: { w1: 2.7, w5: NaN }, homeFinds: -3, coinDay: 'x', coinGot: 99, keys: ['w1', 'w1', 7] });
    assert.equal(e.met, true);
    assert.deepEqual(e.found, { w1: 5 });
    assert.deepEqual(e.home, { w1: 2 });
    assert.equal(e.homeFinds, 0);
    assert.equal(e.coinGot, D.COIN_CAP);
    assert.deepEqual(e.keys, ['w1']);
    for (const raw of [null, 7, 'x', [], { found: [] }]) assert.doesNotThrow(() => D.normalizeElves(raw));
  });

  test('merge keeps every find from both copies', () => {
    const a = D.normalizeElves(null), b = D.normalizeElves(null);
    D.markFound(a, 'w1', 0); D.markFound(a, 'w1', 1);
    D.markFound(b, 'w1', 1); D.markFound(b, 'w1', 5); D.markFound(b, 'w2', 2);
    D.markHomeFind(a, 'w1', 4); D.markHomeFind(b, 'w1', 2);
    b.met = true;
    const m = D.mergeElves(a, b);
    assert.equal(D.countFound(m, 'w1', [0, 1, 5]), 3);
    assert.equal(D.isFound(m, 'w2', 2), true);
    assert.equal(m.home.w1, 4);
    assert.equal(m.met, true);
    assert.deepEqual(D.mergeElves(m, m), m);
    assert.deepEqual(D.mergeElves(null, undefined), D.normalizeElves(null));
  });

  test('only the newest MAX_WORLDS worlds are kept', () => {
    const e = D.normalizeElves(null);
    for (let i = 0; i < D.MAX_WORLDS + 10; i++) D.markFound(e, `w${i.toString(36)}`, 0);
    assert.equal(e.keys.length, D.MAX_WORLDS);
    assert.equal(Object.keys(e.found).length, D.MAX_WORLDS);
    assert.equal(e.found.w0, undefined);
    assert.equal(D.isFound(e, `w${(D.MAX_WORLDS + 9).toString(36)}`, 0), true);
  });
});

describe('E9 the world save, names, keys', () => {
  test('normalizeWorldData', () => {
    assert.deepEqual(D.normalizeWorldData(null), { v: 1, house: null });
    const h = D.normalizeWorldData({ house: { uid: 12, name: '  Pip<b>  ', sc: 40, hide: 3, stamp: 20261107, spot: [1, 2, 3], prev: [[1, 1, 1], 'x', [1.5, 2, 3], [2, 2, 2], [3, 3, 3], [4, 4, 4]], away: 0, bed: -1 } }).house;
    assert.equal(h.uid, 12);
    assert.equal(h.name, 'Pipb');
    assert.equal(h.sc, 0);
    assert.equal(h.hide, 3);
    assert.deepEqual(h.spot, [1, 2, 3]);
    assert.deepEqual(h.prev, [[2, 2, 2], [3, 3, 3], [4, 4, 4]]);
    assert.equal(h.away, false);
    assert.equal(h.bed, 0);
  });

  test('cleanName, names and schemes', () => {
    assert.equal(D.cleanName('', 'Pip'), 'Pip');
    assert.equal(D.cleanName('Twinkly Twinkle Toes', 'Pip').length <= 14, true);
    assert.equal(D.cleanName('<script>', 'Pip'), 'script');
    assert.equal(D.cleanName('   ', 'Pip'), 'Pip');
    assert.equal(D.NAMES.length, 12);
    assert.equal(D.SCHEMES.length, 12);
    assert.equal(new Set(D.NAMES).size, 12);
    assert.equal(new Set(D.SWATCHES).size, 12, 'every elf has its own Bag swatch');
    for (let i = 0; i < 12; i++) assert.equal(D.schemeIndex({}, D.SWATCHES[i]), i);
    assert.equal(D.schemeIndex({ sc: 99 }, null), 0);
    assert.equal(D.schemeIndex({ sc: 5 }, D.SWATCHES[2]), 5);
  });

  test('world keys: stable, the same on every page of a shared world', () => {
    const a = D.worldKey({ seed: 123, createdAt: 1700000000000, id: 'local-1' });
    const b = D.worldKey({ seed: 123, createdAt: 1700000000000, id: 'net-ABCD', shared: true });
    assert.equal(a, b);
    assert.match(a, /^w[0-9a-z]{1,12}$/);
    assert.notEqual(a, D.worldKey({ seed: 124, createdAt: 1700000000000 }));
    assert.equal(D.worldKey(null), '');
    const hi = D.houseIndex(a);
    assert.ok(Number.isInteger(hi) && hi >= 0 && hi < 12);
  });

  test('whereLabel', () => {
    assert.equal(D.whereLabel('furn', 'fridge'), 'on the fridge');
    assert.equal(D.whereLabel('furn', 'bathtub'), 'in the bath');
    assert.equal(D.whereLabel('', '', 'tree'), 'in a tree');
    assert.equal(D.whereLabel('block', 'pine_leaves'), 'in a tree');
    assert.equal(typeof D.whereLabel('', '', ''), 'string');
  });

  test('rng and pickOne', () => {
    const r = D.rng(7);
    for (let i = 0; i < 100; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
    assert.equal(D.pickOne([], r), null);
    assert.equal(D.pickOne(['a'], () => 0.99999999), 'a');
    assert.equal(D.pickOne(['a', 'b'], () => NaN), 'a');
    assert.ok(D.RANDOM_SCENES.every((s) => D.SCENES[s]));
    assert.ok(!D.RANDOM_SCENES.includes('bath'), 'a bubble bath only comes with a bathtub');
  });
});

// ---------------- E10, E11: words and wiring ----------------

describe('E10 words', () => {
  const files = readdirSync(path.join(ROOT, DIR)).filter((f) => f.endsWith('.js'));

  test('no famous names or brands in the elves files or the team doc', () => {
    for (const f of files) {
      const t = src(`${DIR}/${f}`);
      assert.deepEqual(scanText(t, { extras: true }), [], f);
      assert.deepEqual(scanCharacters(t), [], f);
    }
    assert.deepEqual(scanText(src('docs/teams/elves.md')), []);
  });

  test('the elves’ words call the player "you", never he or she', () => {
    const words = JSON.stringify([D.NAMES, D.GREETER, D.LINES, D.SCENES]);
    assert.deepEqual(scanCharacters(words), []);
    assert.doesNotMatch(words, /\b(she|her|hers|he|him|his)\b/i);
    for (const f of files) assert.doesNotMatch(src(`${DIR}/${f}`), /\b(she|her|hers|herself)\b/i, f);
  });

  test('the pure files: no while loops, no Math.random, no DOM, no three.js', () => {
    for (const f of ['data.js', 'spots.js']) {
      const t = src(`${DIR}/${f}`);
      assert.doesNotMatch(t, /\bwhile\s*\(/, f);
      assert.doesNotMatch(t, /Math\.random/, f);
      assert.doesNotMatch(t, /\bdocument\.|from 'three'|localStorage/, f);
    }
  });
});

describe('E11 wiring', () => {
  test('the el_elf icon is the last PATHS entry in pets/kit.js', () => {
    const kit = src('src/things/pets/kit.js');
    assert.match(kit, /\n {2}el_elf: `<path [^`]+`, \/\/ wave 5: elves[^\n]*\n\};/);
  });

  test('every name index.js imports from its own folder is exported there', async () => {
    const idx = src(`${DIR}/index.js`);
    const re = /import \{([^}]+)\} from '\.\/([a-z]+)\.js';/g;
    let n = 0;
    for (const m of idx.matchAll(re)) {
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      const text = src(`${DIR}/${m[2]}.js`);
      for (const name of names) assert.match(text, new RegExp(`export (const|function|let) ${name}\\b`), `${m[2]}.js ${name}`);
      n++;
    }
    assert.ok(n >= 6);
  });

  test('the two feature kinds, three furniture keys and three stickers', () => {
    const idx = src(`${DIR}/index.js`);
    assert.match(idx, /on\('holiday:elf',/);
    assert.match(idx, /on\('holiday:elfhome',/);
    for (const k of ["'elf_twinkle'", "'elf_door'", "'elf_sign'"]) assert.ok(idx.includes(k), k);
    const art = src(`${DIR}/art.js`);
    const ids = [...art.matchAll(/id: '([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['elf_first', 'elf_all', 'elf_home']);
  });
});
