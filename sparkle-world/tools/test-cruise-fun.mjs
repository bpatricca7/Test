// Cruise fun (docs/teams/cruise-fun.md), no browser, a few seconds:
//   node tools/test-cruise-fun.mjs
//   C1  slide paths: reading a record, packing it into the gate's data (fits 600 bytes), back
//   C2  slide safety: floor cells lifted, blocked cells found, every ride ends in the pool or
//       on the start, the speed never stops, a whole ride follows the path and ends in time
//   C3  the Bag slide gate's own path (down the steps, into the water, at a wall, a flat scoot)
//   C4  lift stops: one shaft, lowest first, same floor once, names, at most 12; current stop
//   C5  the deck games' meter: every throw scores 1..3, five throws make 5..15
//   C6  mini golf: every hole ends (the ball never leaves the green or goes NaN), stars
//   C7  every mini game finishes by itself with a score (and draws without throwing)
//   C8  scores and the daily coins: 20 a day at most, once per game a day, a new day pays again
//   C9  the board: spot names to activities, nearest
//   C10 the 17 models build in Node, inside their footprints; the defs' data fits the network
//   C11 words: no other company's names or famous characters, no while loops in the module
//   C12 install on a pretend game: 17 pieces, 13 actions, one system; every world record kind
//       places what it should with small data; spots save and load

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../src/things/cruise/logic.js';
import { makeGame, GAME_KEYS, W, H } from '../src/things/cruise/games.js';
import { isPlainData, C } from '../src/net/protocol.js';
import { scanCharacters, scanText } from './lib/name-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const DIR = 'src/things/cruise';

// ---------- a tiny fake 2D canvas (models paint textures; games draw) ----------
function fakeCtx() {
  const o = {};
  return new Proxy(o, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}
function fakeCanvas() {
  const ctx = fakeCtx();
  return { width: 16, height: 16, style: {}, getContext: () => ctx };
}
globalThis.document = globalThis.document || { createElement: () => fakeCanvas() };

// ---------- a little world of cells ----------
const key = (x, y, z) => `${x},${y},${z}`;
function world() {
  const solidSet = new Set(), waterSet = new Set();
  return {
    solidSet, waterSet,
    solid: (x, y, z) => solidSet.has(key(x, y, z)),
    liquid: (x, y, z) => waterSet.has(key(x, y, z)),
    put: (x, y, z) => solidSet.add(key(x, y, z)),
    water: (x, y, z) => waterSet.add(key(x, y, z)),
  };
}

/** A spiral slide record: air cells over a floor block each, ending in a pool. */
function spiral(w, turns = 3, cx = 40, cz = 40, top = 60) {
  const path = [];
  const n = Math.round(turns * 24);
  for (let i = 0; i <= n; i++) {
    const a = (i / 24) * Math.PI * 2;
    const c = [Math.round(cx + 6 * Math.cos(a)), top - Math.floor(i / 2), Math.round(cz + 6 * Math.sin(a))];
    const l = path[path.length - 1];
    if (!l || l[0] !== c[0] || l[1] !== c[1] || l[2] !== c[2]) path.push(c);
  }
  // the splash pool at the end
  const end = path[path.length - 1];
  const pool = [end[0] + 1, end[1] - 1, end[2]];
  path.push([end[0] + 1, end[1], end[2]], pool);
  for (const c of path.slice(0, -2)) w.put(c[0], c[1] - 1, c[2]);
  for (let dx = -1; dx <= 3; dx++) for (let dz = -2; dz <= 2; dz++) {
    w.water(pool[0] + dx, pool[1], pool[2] + dz);
    w.water(pool[0] + dx, pool[1] - 1, pool[2] + dz);
    w.put(pool[0] + dx, pool[1] - 2, pool[2] + dz);
  }
  return path;
}

/** Ride the polyline like slide.js does: returns { t, len, maxOff, finite }. */
function ride(points, keys) {
  const line = L.polyline(points);
  let v = L.SLIDE.V0, s = 0, t = 0, maxOff = 0, finite = true;
  const out = [0, 0, 0];
  const limit = L.rideTimeLimit(line.len);
  for (let i = 0; i < 100000 && s < line.len - 1e-6 && t <= limit; i++) {
    const dt = 1 / 60;
    const slope = L.samplePolyline(line, s, out);
    v = L.slideSpeed(v, slope, dt);
    assert.ok(v >= L.SLIDE.VMIN - 1e-9 && v <= L.SLIDE.VMAX + 1e-9, 'speed in range');
    s = Math.min(line.len, s + v * dt);
    t += dt;
    L.samplePolyline(line, s, out);
    if (!out.every(Number.isFinite)) finite = false;
    if (keys) {
      let best = Infinity;
      for (const k of keys) best = Math.min(best, Math.hypot(out[0] - (k[0] + 0.5), out[1] - k[1], out[2] - (k[2] + 0.5)));
      maxOff = Math.max(maxOff, best);
    }
  }
  return { t, len: line.len, limit, done: s >= line.len - 1e-6, maxOff, finite };
}

describe('C1 slide paths in the gate data', () => {
  test('normalizePath drops broken points and fills short gaps, stops at a jump', () => {
    const p = L.normalizePath([[0, 10, 0], null, 'x', [1, 10, 0], [1, 10, 0], [3, 9, 0], { x: 4, y: 9, z: 0 }, [40, 0, 0], [41, 0, 0]]);
    assert.deepEqual(p[0], [0, 10, 0]);
    assert.ok(p.length >= 4 && p.length <= 6, 'the gap to 3 is filled, the jump to 40 ends it: ' + JSON.stringify(p));
    assert.ok(p.every((c) => c[0] < 10));
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      assert.ok(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= 1, 'steps of one cell');
    }
    assert.deepEqual(L.normalizePath('nope'), []);
    assert.ok(L.normalizePath(Array.from({ length: 900 }, (_, i) => [i, 0, 0])).length <= L.SLIDE.MAX_POINTS);
  });

  test('pack -> decode keeps the ends and fits the data budget', () => {
    const w = world();
    for (const turns of [0.5, 1, 2, 4, 9]) {
      const path = spiral(w, turns);
      const gate = path[0];
      const { code, keys } = L.packPath(path, gate[0], gate[1], gate[2]);
      assert.ok(code.length > 1 && code.length <= L.SLIDE.MAX_CHARS, `turns ${turns}: ${code.length} chars`);
      const back = L.decodeKeys(code, gate[0], gate[1], gate[2]);
      assert.ok(back.length >= 2);
      assert.deepEqual(back[0], keys[0]);
      assert.deepEqual(back[back.length - 1], keys[keys.length - 1]);
      const cells = L.normalizePath(path);
      assert.deepEqual(back[back.length - 1], cells[cells.length - 1], 'ends in the pool');
      const data = { n: 'A Very Long Slide Nam', p: code };
      assert.ok(isPlainData(data, C.ENTITY_DATA_DEPTH ?? 3), 'plain data');
      assert.ok(Buffer.byteLength(JSON.stringify(data)) <= C.ENTITY_DATA_BYTES, 'fits the network');
    }
    assert.deepEqual(L.packPath([[1, 1, 1]], 0, 0, 0), { code: '', keys: [] });
    assert.deepEqual(L.decodeKeys('k!!!', 0, 0, 0).length <= 1, true);
    assert.deepEqual(L.decodeKeys(42, 0, 0, 0), []);
  });

  test('a long step is split so every encoded step fits', () => {
    const keys = [[0, 0, 0], [100, -70, 3]];
    const code = L.encodeKeys(keys, 0, 0, 0);
    const back = L.decodeKeys(code, 0, 0, 0);
    assert.deepEqual(back[back.length - 1], [100, -70, 3]);
  });
});

describe('C2 slide safety', () => {
  test('a record naming the floor blocks rides one higher', () => {
    const w = world();
    const air = spiral(w, 1);
    const floor = air.slice(0, -2).map((c) => [c[0], c[1] - 1, c[2]]);
    const lifted = L.liftKeys(floor, w.solid);
    lifted.forEach((c, i) => assert.deepEqual(c, air[i]));
    assert.equal(L.rideCell([0, 0, 0], () => true), null, 'solid with solid above: blocked');
  });

  test('a clear slide rides to the pool, following the path, in time', () => {
    const w = world();
    const path = spiral(w, 3);
    const g = path[0];
    const keys = L.liftKeys(L.decodeKeys(L.packPath(path, g[0], g[1], g[2]).code, g[0], g[1], g[2]), w.solid);
    const cells = L.expandKeys(keys);
    const blocked = L.firstBlocked(cells, w.solid);
    assert.equal(blocked, -1);
    const plan = L.planRide(cells.length, blocked, true);
    assert.equal(plan.end, 'full');
    const pts = L.smoothCorners(keys.map((c) => [c[0] + 0.5, c[1] + 0.06, c[2] + 0.5]), 2);
    const r = ride(pts, cells);
    assert.ok(r.done, 'reached the end');
    assert.ok(r.finite);
    assert.ok(r.t <= r.limit, `in time: ${r.t.toFixed(1)} s of ${r.limit.toFixed(1)}`);
    assert.ok(r.maxOff < 1.3, `stays on the slide: ${r.maxOff.toFixed(2)}`);
    const last = cells[cells.length - 1];
    assert.ok(w.liquid(last[0], last[1], last[2]), 'the end is in the water');
  });

  test('something built in the slide: she stops before it and hops to the pool', () => {
    const w = world();
    const path = spiral(w, 2);
    const cells = L.expandKeys(L.liftKeys(L.keyCells(L.normalizePath(path)), w.solid));
    const k = Math.floor(cells.length / 2);
    const c = cells[k];
    w.put(c[0], c[1], c[2]);
    w.put(c[0], c[1] + 1, c[2]);
    const blocked = L.firstBlocked(cells, w.solid);
    assert.ok(blocked >= 0 && blocked <= k);
    const plan = L.planRide(cells.length, blocked, true);
    assert.equal(plan.end, 'pool');
    assert.ok(plan.stopAt < blocked);
    // a pillar right at the top: no ride, she stays at the start
    const w2 = world();
    const p2 = spiral(w2, 1);
    const cells2 = L.expandKeys(L.keyCells(L.normalizePath(p2)));
    w2.put(cells2[1][0], cells2[1][1], cells2[1][2]);
    w2.put(cells2[1][0], cells2[1][1] + 1, cells2[1][2]);
    assert.equal(L.planRide(cells2.length, L.firstBlocked(cells2, w2.solid), true).end, 'start');
    // the pool filled in: the start too
    assert.equal(L.planRide(30, 20, false).end, 'start');
  });

  test('the speed never stops and never runs away', () => {
    let v = L.SLIDE.V0;
    for (let i = 0; i < 600; i++) v = L.slideSpeed(v, 3, 1 / 60);
    assert.ok(v <= L.SLIDE.VMAX);
    for (let i = 0; i < 600; i++) v = L.slideSpeed(v, -2, 1 / 60);
    assert.ok(v >= L.SLIDE.VMIN);
    assert.ok(L.slideSpeed(NaN, NaN, NaN) >= L.SLIDE.VMIN);
    assert.ok(L.rideTimeLimit(NaN) > 0);
  });

  test('sampling walks both ways and handles tiny lines', () => {
    const line = L.polyline([[0, 0, 0], [0, 0, 4], [4, 0, 4]]);
    const out = [0, 0, 0];
    L.samplePolyline(line, 7, out);
    assert.deepEqual(out.map((v) => Math.round(v * 100) / 100), [3, 0, 4]);
    L.samplePolyline(line, 1, out);
    assert.deepEqual(out, [0, 0, 1]);
    assert.equal(L.samplePolyline(L.polyline([]), 1, out), 0);
    assert.equal(L.samplePolyline(L.polyline([[1, 2, 3]]), 5, out), 0);
    assert.deepEqual(out, [1, 2, 3]);
    assert.ok(L.smoothCorners(Array.from({ length: 900 }, (_, i) => [i, 0, i % 2]), 2).length <= 1200);
  });
});

describe('C3 the Bag slide gate', () => {
  test('down the steps and into the water', () => {
    const w = world();
    // steps going down in +x from a top deck at y 10, a pool at the bottom
    for (let x = -2; x <= 0; x++) w.put(x, 9, 0);
    for (let i = 1; i <= 6; i++) w.put(i, 9 - i, 0);
    for (let x = 7; x <= 10; x++) { w.water(x, 3, 0); w.water(x, 2, 0); w.put(x, 1, 0); }
    const p = L.autoSlidePath(0, 10, 0, [1, 0], w.solid, w.liquid);
    assert.ok(p.length > 4, JSON.stringify(p));
    const last = p[p.length - 1];
    assert.ok(w.liquid(last[0], last[1], last[2]), 'ends in the pool: ' + JSON.stringify(last));
    for (let i = 1; i < p.length; i++) assert.ok(p[i][1] <= p[i - 1][1], 'never goes up');
  });

  test('a wall in front, a flat floor, no direction', () => {
    const w = world();
    for (let x = -3; x <= 20; x++) w.put(x, 4, 0);
    w.put(1, 5, 0);
    assert.equal(L.autoSlidePath(0, 5, 0, [1, 0], w.solid, w.liquid).length, 1, 'a wall: nowhere to go');
    const flat = L.autoSlidePath(3, 5, 0, [1, 0], w.solid, w.liquid);
    assert.ok(flat.length >= 2 && flat.length <= 6, 'a short scoot on the flat');
    assert.equal(L.autoSlidePath(0, 5, 0, [0, 0], w.solid, w.liquid).length, 1);
    const edge = L.autoSlidePath(0, 5, 0, [1, 0], () => false, () => false, (x) => x < 3);
    assert.ok(edge.every((c) => c[0] < 3), 'stays inside the world');
    const fall = L.autoSlidePath(0, 50, 0, [1, 0], () => false, () => false);
    assert.ok(fall.length <= L.SLIDE.AUTO_STEPS + 2, 'bounded');
  });
});

describe('C4 lift stops', () => {
  test('one shaft, lowest first, one per floor, names', () => {
    const pieces = [
      { uid: 1, x: 5, y: 20, z: 5, name: 'Pool Deck' },
      { uid: 2, x: 5, y: 10, z: 5, name: '' },
      { uid: 3, x: 6, y: 15, z: 5, name: 'Elsewhere' },
      { uid: 4, x: 5, y: 15, z: 5, name: '  Fun\u0007 Deck  ' },
      { uid: 5, x: 5, y: 21, z: 5, name: 'Same floor' },
    ];
    const s = L.liftStops(pieces, 5, 5);
    assert.deepEqual(s.map((q) => q.uid), [2, 4, 1]);
    assert.deepEqual(s.map((q) => q.name), ['Deck 1', 'Fun Deck', 'Pool Deck']);
    assert.equal(L.currentStop(s, 15.02).uid, 4);
    assert.equal(L.currentStop(s, 40), null);
    const many = Array.from({ length: 40 }, (_, i) => ({ uid: i, x: 0, y: i * 3, z: 0 }));
    assert.equal(L.liftStops(many, 0, 0).length, 12);
    assert.deepEqual(L.liftStops(null, 0, 0), []);
  });
});

describe('C5 the deck games', () => {
  test('meter, quality and points', () => {
    for (let t = 0; t < 10; t += 0.013) {
      const v = L.meterValue(t, L.meterSpeed(3));
      assert.ok(v >= 0 && v <= 1);
    }
    assert.equal(L.meterQuality(0.5, 0.5, 0.3), 1);
    assert.equal(L.meterQuality(0, 1, 0.3), 0);
    assert.equal(L.throwPoints(1), 3);
    assert.equal(L.throwPoints(0.5), 2);
    assert.equal(L.throwPoints(0), 1);
    assert.equal(L.throwPoints(NaN), 1);
    assert.ok(L.meterSpeed(100) <= 1.15);
  });
});

describe('C6 mini golf', () => {
  test('every hole ends, the ball stays on the green', () => {
    const powers = [0.5, 0.3, 0.75, 0.2, 0.95, 0.4];
    for (const h of L.golfCourse(9)) {
      const b = L.newBall(h);
      let inCup = false;
      for (let stroke = 0; stroke < L.GOLF.MAX_STROKES && !inCup; stroke++) {
        L.putt(b, h.cup[0], h.cup[1], powers[stroke]);
        for (let i = 0; i < 60 * 30 && b.moving; i++) {
          if (L.stepBall(b, h, 1 / 60) === 'cup') inCup = true;
          assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
          assert.ok(b.x >= 20 && b.x <= L.GOLF.W - 20 && b.y >= 20 && b.y <= L.GOLF.H - 20, 'on the green');
        }
        assert.equal(b.moving, false, 'the ball stops');
      }
      assert.ok(L.holeStars(inCup ? 2 : 7, h.par) >= 1);
    }
    assert.equal(L.golfCourse(3, [9, 1, 'x']).map((h) => h.par).join(), '5,2,3');
    assert.equal(L.golfCourse(50).length, 9);
    assert.equal(L.putt(L.newBall(L.HOLES[0]), L.HOLES[0].tee[0], L.HOLES[0].tee[1], 1), false, 'no aim, no putt');
  });

  test('every hole can be sunk: a straight putt on the open hole, a band of powers going in', () => {
    const h = L.HOLES[0];
    const sinks = [];
    for (let p = 0.3; p <= 1.0001; p += 0.05) {
      const b = L.newBall(h);
      L.putt(b, h.cup[0], h.cup[1], p);
      for (let i = 0; i < 1800 && b.moving; i++) L.stepBall(b, h, 1 / 60);
      if (b.inCup) sinks.push(Math.round(p * 100));
    }
    assert.ok(sinks.length >= 3, 'a wide band of powers sinks it: ' + sinks.join());
  });
});

describe('C7 every mini game finishes with a score', () => {
  const sfx = new Proxy({}, { get: () => () => {} });
  for (const k of GAME_KEYS) {
    test(k, () => {
      const g = makeGame(k, { sfx, rand: L.rng(7), opts: k === 'golf' ? { holes: 3 } : {} });
      const ctx = fakeCtx();
      let t = 0, timeUp = false, left = g.time || 0;
      const step = 1 / 30;
      for (let i = 0; i < 30 * 600 && !g.finished; i++) {
        t += step;
        if (g.time && !timeUp) {
          left -= step;
          if (left <= 0) { timeUp = true; g.timeUp(); }
        }
        g.update(step);
        // a busy little player
        if (i % 8 === 0) {
          if (k === 'star' && g.stars.length) g.tap(g.stars[0].x, g.stars[0].y);
          else if (k === 'bubble' && g.pops.length) g.tap(g.pops[0].x, g.pops[0].y);
          else if (k === 'fish') {
            const c = g.cards[(i / 8) % 12];
            g.tap(c.x + 5, c.y + 5);
          } else if (g.act) {
            if (k === 'golf' && i % 64 === 0) g.tap(g.h.cup[0], g.h.cup[1]);
            g.action();
          }
        }
        if (i % 45 === 0) g.draw(ctx);
        assert.ok(typeof g.status() === 'string');
      }
      assert.ok(g.finished, `${k} finished after ${t.toFixed(0)} s`);
      const r = g.result();
      assert.ok(Number.isInteger(r.score) && r.score > 0, `${k} score ${r.score}`);
      assert.ok(typeof r.line === 'string' && r.line.length > 3);
      if (g.time) assert.ok(t < g.time + 15, `${k} ends soon after its clock`);
      if (['hoops', 'ring', 'shuffle'].includes(k)) assert.ok(r.score >= 5 && r.score <= 15);
      if (k === 'golf') assert.ok(r.score >= 3 && r.score <= 9);
      assert.ok(W === 640 && H === 400);
    });
  }
});

describe('C8 scores and daily coins', () => {
  test('20 a day at most, once per game a day', () => {
    const prof = {};
    const c = L.cruiseData(prof);
    assert.equal(prof.cruise, c);
    const sum = Object.values(L.PAY).reduce((a, b) => a + b, 0);
    assert.equal(sum, L.DAILY_CAP, 'the PAY table adds up to the cap');
    let total = 0;
    for (const k of Object.keys(L.PAY)) {
      total += L.dailyCoins(c, k, 20261107);
      total += L.dailyCoins(c, k, 20261107);
    }
    assert.equal(total, 20);
    assert.equal(L.dailyCoins(c, 'nope', 20261107), 0);
    assert.equal(L.dailyCoins(c, 'star', 20261108), L.PAY.star, 'a new day pays again');
    assert.equal(L.dailyCoins(c, 'bubble', 20261101), 0, 'a clock that went back pays nothing');
    // a broken saved object is mended, never trusted
    const bad = { cruise: { best: { star: -4, fish: 'x', golf: 9 }, plays: [], day: 'y', mask: NaN, paid: -2 } };
    const m = L.cruiseData(bad);
    assert.deepEqual(m.best, { golf: 9 });
    assert.deepEqual(m.plays, {});
    assert.equal(m.day, 0);
    assert.equal(L.cruiseData(null), null);
  });

  test('best scores', () => {
    const c = L.cruiseData({});
    assert.deepEqual(L.recordScore(c, 'star', 12), { best: 12, isBest: true });
    assert.deepEqual(L.recordScore(c, 'star', 8), { best: 12, isBest: false });
    assert.deepEqual(L.recordScore(c, 'star', 30.7), { best: 30, isBest: true });
    assert.equal(c.plays.star, 3);
    assert.ok(L.matchScore(6, 30, 12) > L.matchScore(6, 80, 30));
    assert.equal(L.matchScore(0, 1, 1), 0);
  });
});

describe('C8b two devices', () => {
  test('mergeCruise keeps the higher scores and never pays a game twice in a day', () => {
    const a = { best: { star: 30, golf: 5 }, plays: { star: 4 }, day: 20261107, mask: 1, paid: 3 };
    const b = { best: { star: 12, fish: 50 }, plays: { star: 9, fish: 1 }, day: 20261107, mask: 4, paid: 3 };
    const m = L.mergeCruise(a, b);
    assert.deepEqual(m.best, { star: 30, golf: 5, fish: 50 });
    assert.deepEqual(m.plays, { star: 9, fish: 1 });
    assert.equal(m.mask, 5);
    assert.equal(L.dailyCoins(m, 'star', 20261107), 0, 'paid on one device: not again');
    assert.equal(L.mergeCruise(a, { ...b, day: 20261108, mask: 0, paid: 0 }).day, 20261108);
    assert.equal(L.mergeCruise({ ...a, day: 20261109 }, b).mask, 1);
    assert.deepEqual(L.mergeCruise(null, undefined).best, {});
    assert.deepEqual(a.best, { star: 30, golf: 5 }, 'inputs untouched');
  });
});

describe('C9 the board', () => {
  test('spot names find their activity', () => {
    assert.equal(L.activityOfSpot('Pool'), 'pool');
    assert.equal(L.activityOfSpot('Splash Pool'), 'pool');
    assert.equal(L.activityOfSpot('Theater'), 'movies');
    assert.equal(L.activityOfSpot('Mini Golf'), 'golf');
    assert.equal(L.activityOfSpot('The Bridge'), 'bridge');
    assert.equal(L.activityOfSpot('Palm Island Beach'), 'beach');
    assert.equal(L.activityOfSpot(''), null);
    assert.equal(L.activityOfSpot(7), null);
    const n = L.nearest([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 }, { x: NaN, y: 0, z: 0 }], 4, 0, 4);
    assert.equal(n.x, 5);
    assert.equal(L.nearest([], 0, 0, 0), null);
  });
});

describe('C10 models', async () => {
  const THREE = await import('three');
  const M = await import('../src/things/cruise/models.js');
  const pieces = [
    ['slideGate', [1, 3, 1], { n: 'Twister' }], ['waterSlide', [2, 4, 6]], ['lift', [1, 2, 1]], ['arcade', [1, 2, 1], { g: 'fish' }],
    ['hoops', [1, 3, 1]], ['ringToss', [2, 1, 1]], ['shuffle', [1, 1, 4]], ['golfSign', [1, 2, 1]], ['golfFlag', [1, 2, 1], { i: 2 }],
    ['djBooth', [2, 3, 1]], ['movieScreen', [5, 3, 1], { ch: 1 }], ['wheel', [1, 2, 1]], ['board', [2, 2, 1]], ['float', [1, 1, 1]],
    ['lounger', [1, 1, 2]], ['towel', [1, 1, 1], { a: 1 }], ['bell', [1, 2, 1]],
  ];
  test('17 pieces build inside their footprints', () => {
    assert.equal(pieces.length, 17);
    for (const [fn, [w, h, d], data] of pieces) {
      const g = M[fn](undefined, data || {});
      const box = new THREE.Box3().setFromObject(g);
      const m = 0.36;
      assert.ok(!box.isEmpty(), fn);
      assert.ok(box.min.x >= -m && box.max.x <= w + m, `${fn} x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)}`);
      assert.ok(box.min.y >= -0.01 && box.max.y <= h + 0.5, `${fn} y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`);
      assert.ok(box.min.z >= -m && box.max.z <= d + m, `${fn} z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`);
    }
    // every float shape and towel animal builds
    for (const c of M.FLOAT_COLORS) M.float(c, {});
    for (let a = 0; a < 4; a++) M.towel(undefined, { a });
    for (const g of M.ARCADE_GAMES) assert.equal(M.gameOf(undefined, { g }), g);
    assert.equal(M.gameOf(M.ARCADE_COLORS[1], {}), 'bubble');
    assert.deepEqual(M.screenSize({ w: 99, h: -3 }), { w: 24, h: 3 });
  });

  test('the little water slide path runs downhill to the front', () => {
    const p = M.waterSlidePath();
    assert.ok(p[0][1] > 3 && p[p.length - 1][1] < 0.5);
    assert.ok(p[p.length - 1][2] > 6, 'out past the front, into a pool there');
    for (let i = 3; i < p.length; i++) assert.ok(p[i][1] <= p[i - 1][1] + 0.12, 'downhill');
  });
});

describe('C11 words and loops', () => {
  const files = readdirSync(path.join(ROOT, DIR)).filter((f) => f.endsWith('.js')).map((f) => `${DIR}/${f}`);
  files.push('tools/test-cruise-fun.mjs');
  test('no other company names, no famous characters', () => {
    for (const f of files) {
      const t = src(f);
      assert.deepEqual(scanText(t, { extras: true }), [], f);
      assert.deepEqual(scanCharacters(t), [], f);
    }
    if (files.length) {
      const doc = path.join(ROOT, 'docs/teams/cruise-fun.md');
      try {
        const t = readFileSync(doc, 'utf8');
        assert.deepEqual(scanText(t, { extras: true }), [], 'docs/teams/cruise-fun.md');
        assert.deepEqual(scanCharacters(t), [], 'docs/teams/cruise-fun.md');
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  });
  test('no while loops, no localStorage in the module', () => {
    for (const f of files.filter((x) => x.startsWith(DIR))) {
      const t = src(f).replace(/\/\/.*$/gm, '');
      assert.ok(!/\bwhile\s*\(/.test(t), f + ': a while loop');
      assert.ok(!/localStorage/.test(t), f + ': localStorage');
    }
  });
  test('the Bag tab picture names our pieces', () => {
    const inv = src('src/ui/inventory.js');
    const line = inv.split('\n').find((l) => /^\s*cruise: \[/.test(l));
    assert.ok(line && /furn:cruise_/.test(line), line);
  });
});

describe('C12 install and the world records', async () => {
  const { install } = await import('../src/things/cruise/index.js');
  const { install: installFeatures } = await import('../src/world/features.js');
  const any = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any() });
  const placed = [];
  const defs = new Map();
  const listeners = new Map();
  const game = {
    profile: { stickers: {}, settings: {} },
    events: { on: (n, f) => (listeners.get(n) || listeners.set(n, []).get(n)).push(f), emit: () => {} },
    registry: { items: { register() {} }, stickers: new Map(), blocks: { props: { solid: new Uint8Array(256), replaceable: new Uint8Array(256) } } },
    world: { inBounds: () => true, get: () => 0 },
    ui: any(), audio: any(), player: any(), cameraRig: any(), time: { t: 0 },
    systems: [],
    addSystem(sys) { this.systems.push(sys); return sys; },
    debug: {},
    entities: {
      defs, map: new Map(), actions: new Map(),
      define(d) { assert.ok(d.key && typeof d.build === 'function'); defs.set(d.key, d); return d; },
      registerAction(n, h) { this.actions.set(n, h); },
      place(key, x, y, z, rot, color, data, opts) {
        const e = { key, x, y, z, rot, color, data, opts, def: defs.get(key) };
        placed.push(e);
        return e;
      },
      footprint: () => [], at: () => null, byUid: () => null, localToWorld: (e, a, b, c, o) => o,
    },
  };
  installFeatures(game);
  install(game);

  test('17 pieces, their actions, one system, the stickers', () => {
    assert.equal(defs.size, 17);
    for (const d of defs.values()) {
      assert.ok(d.key.startsWith('cruise_'), d.key);
      assert.equal(d.category, 'cruise');
      for (const a of d.actions || []) assert.ok(game.entities.actions.has(a), `${d.key} action ${a}`);
      assert.ok(isPlainData(d.defaultData || {}, 3));
    }
    assert.equal(game.entities.actions.size, 13);
    assert.deepEqual(game.systems.map((s) => s.name), ['cruise']);
    for (const f of listeners.get('game:ready') || []) f();
    assert.equal([...game.registry.stickers.keys()].filter((k) => k.startsWith('cruise_')).length, 6);
    assert.ok(game.cruise && typeof game.cruise.play === 'function');
    assert.ok(game.debug.cruise && typeof game.debug.cruise.plan === 'function');
  });

  test('every record kind places its pieces', () => {
    const recs = [
      { kind: 'cruise:slide', x: 5, y: 20, z: 5, rot: 1, name: 'Twisty', color: '#4FB8FF', path: Array.from({ length: 300 }, (_, i) => [5 + (i % 9), 20 - (i >> 2), 5 + Math.floor(i / 9)]) },
      { kind: 'cruise:lift', x: 9, y: 10, z: 9, stops: [{ y: 10, name: 'Deck 1' }, { y: 15, name: 'Pool Deck' }, { y: 'x' }] },
      { kind: 'cruise:arcade', x: 1, y: 10, z: 1 }, { kind: 'cruise:arcade', x: 2, y: 10, z: 1 }, { kind: 'cruise:arcade', x: 3, y: 10, z: 1 },
      { kind: 'cruise:game', game: 'hoops', x: 1, y: 10, z: 3 }, { kind: 'cruise:game', game: 'ringtoss', x: 1, y: 10, z: 5 },
      { kind: 'cruise:game', game: 'shuffle', x: 1, y: 10, z: 7 }, { kind: 'cruise:game', game: 'nope', x: 1, y: 10, z: 9 },
      { kind: 'cruise:golf', x: 20, y: 10, z: 20, holes: [{ tee: [21, 10, 21], cup: [25, 10, 21], par: 2 }, { cup: [30, 10, 30], par: 9 }] },
      { kind: 'cruise:dance', x: 40, y: 15, z: 40, x0: 38, z0: 42, x1: 44, z1: 47 },
      { kind: 'cruise:movie', x: 50, y: 15, z: 50, w: 40, h: 7 },
      { kind: 'cruise:wheel', x: 60, y: 22, z: 60 }, { kind: 'cruise:board', x: 61, y: 15, z: 60 }, { kind: 'cruise:float', x: 62, y: 10, z: 60 },
      { kind: 'cruise:spot', x: 1, y: 1, z: 1, name: 'Pool', deck: 'Deck 7' }, { kind: 'cruise:spot', x: 1, y: 1, z: 1, name: '' },
    ];
    const n = game.worldFeatures.run({}, recs);
    assert.equal(n, recs.length - 2, 'the unknown game and the nameless spot are skipped');
    const keys = placed.map((e) => e.key);
    assert.deepEqual(keys, ['cruise_slide', 'cruise_lift', 'cruise_lift', 'cruise_arcade', 'cruise_arcade', 'cruise_arcade', 'cruise_hoops',
      'cruise_ringtoss', 'cruise_shuffle', 'cruise_golf', 'cruise_flag', 'cruise_flag', 'cruise_dj', 'cruise_movie', 'cruise_wheel', 'cruise_board', 'cruise_float']);
    for (const e of placed) {
      assert.ok(isPlainData(e.data, 3), e.key);
      assert.ok(Buffer.byteLength(JSON.stringify(e.data)) <= C.ENTITY_DATA_BYTES, e.key);
      assert.equal(e.opts.history, false);
      assert.equal(e.opts.fx, false);
    }
    assert.deepEqual(placed.slice(3, 6).map((e) => e.data.g), ['star', 'bubble', 'fish']);
    assert.equal(placed[0].data.n, 'Twisty');
    assert.ok(placed[0].data.p.length > 0 && placed[0].data.p.length <= L.SLIDE.MAX_CHARS);
    assert.deepEqual(placed[9].data.par, [2, 5]);
    assert.equal(placed[13].data.w, 24);
    assert.deepEqual(game.cruise.spots().map((s) => s.name), ['Pool']);
  });

  test('spots are saved with the world and cleared when it goes', () => {
    const sys = game.systems[0];
    const saved = JSON.parse(JSON.stringify(sys.serialize()));
    sys.onWorldUnload && sys.onWorldUnload();
    assert.equal(game.cruise.spots().length, 0);
    sys.deserialize(saved);
    assert.deepEqual(game.cruise.spots().map((s) => s.name), ['Pool']);
    sys.deserialize({ v: 1, spots: [{ name: '<b>', x: 'q' }, ...Array.from({ length: 80 }, (_, i) => ({ name: 'S' + i, x: i, y: 0, z: 0 }))] });
    assert.ok(game.cruise.spots().length <= 32);
    sys.deserialize(null);
    sys.update(1 / 60);
  });
});
