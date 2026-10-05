// Squishy toys and mystery presents (the squish team doc §14.1), no browser, seconds:
//   node tools/test-squish.mjs            (npm run test:squish)
//   A1  the toy list: 48 toys, keys, names, tags, colors, shapes, the 9 sea toys
//   A2  append-only: ITEMS and PRESENT_ORDER start with the pinned goldens
//   A3  PRESENT_ORDER is a permutation of the ITEMS keys
//   A4  milestone thresholds
//   A5  the milestone start (base) and promotion
//   A6  earned coins: spending never lowers them
//   A7  what is inside: the first 8 per style, no duplicates, the Glitter round
//   A8  ready clamps; `rest` after appended toys
//   A9  mergeSquish
//   A10 mergeProfile keeps toys both ways
//   A11 backup files
//   A12 profileHasPlay
//   A13 words: no prices, no chances, no pronouns, no famous characters; no while / Math.random
//   A14 held keys fit presence `hi`; no localStorage in the module
//   A15 the server still loads; squish-merge.js has no imports
//   A16 the Bag tab sits right after Fun & Toys, once

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../src/things/squish/data.js';
import { mergeSquish } from '../src/core/squish-merge.js';
import { mergeProfile } from '../src/account/merge.js';
import { mergeBackupProfile, backupProfile } from '../src/core/storage.js';
import { profileHasPlay } from '../src/account/legacy.js';
import { HELD_KEY_RE } from '../src/net/protocol.js';
import { pressCurve } from '../src/things/squish/anim.js';
import { scanCharacters, scanText } from './lib/name-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');

// The goldens (§15 step 1): pinned for the owner review of 2026-10-04 (names Puffums and
// Stretchums, the friendly closed-smile shark kept). Before the first release they may still
// change at the review; after it, these lists only ever grow at the end.
const ITEMS_V1 = [
  'pf_strawberry', 'pf_toast', 'pf_donut', 'pf_cupcake', 'pf_peach', 'pf_icecream', 'pf_macaron', 'pf_watermelon',
  'pf_rocket', 'pf_bunny', 'pf_kitty', 'pf_panda', 'pf_cub', 'pf_frog', 'pf_penguin', 'pf_dino',
  'pf_shark', 'pf_unicorn', 'pf_whale', 'pf_sloth', 'pf_octopus', 'pf_dolphin', 'pf_mermaid', 'pf_seadragon',
  'st_bubblegum', 'st_cube', 'st_heart', 'st_star', 'st_cloud', 'st_gold', 'st_rainbow', 'st_galaxy',
  'st_lime', 'st_grape', 'st_ocean', 'st_peachfuzz', 'st_snowball', 'st_moon', 'st_kitty', 'st_ducky',
  'st_piggy', 'st_dinoegg', 'st_zoom', 'st_soccer', 'st_starfish', 'st_shell', 'st_robot', 'st_volcano',
];
const ORDER_V1 = [
  'pf_strawberry', 'pf_dolphin', 'st_bubblegum', 'pf_dino', 'pf_unicorn', 'st_starfish', 'pf_seadragon', 'st_heart',
  'pf_mermaid', 'st_robot', 'pf_donut', 'st_cube', 'pf_shark', 'st_shell', 'pf_bunny', 'st_gold',
  'pf_whale', 'st_galaxy', 'pf_cupcake', 'st_ducky', 'pf_rocket', 'st_rainbow', 'pf_kitty', 'st_volcano',
  'pf_panda', 'st_kitty', 'pf_octopus', 'st_zoom', 'pf_peach', 'st_star', 'pf_icecream', 'st_dinoegg',
  'pf_cub', 'st_peachfuzz', 'pf_toast', 'st_soccer', 'pf_macaron', 'st_lime', 'pf_frog', 'st_ocean',
  'pf_penguin', 'st_moon', 'pf_sloth', 'st_cloud', 'pf_watermelon', 'st_grape', 'st_snowball', 'st_piggy',
];
const FIRST8 = {
  mix: ['Strawberry Puffum', 'Dolphin Puffum', 'Bubblegum Blob', 'Dino Puffum', 'Unicorn Puffum', 'Starfish Squeeze', 'Sea Dragon Puffum', 'Heart Squeeze'],
  girl: ['Unicorn Puffum', 'Strawberry Puffum', 'Heart Squeeze', 'Dolphin Puffum', 'Mermaid Tail', 'Bubblegum Blob', 'Seashell Squeeze', 'Starfish Squeeze'],
  boy: ['Dino Puffum', 'Strawberry Puffum', 'Sea Dragon Puffum', 'Dolphin Puffum', 'Robot Blob', 'Bubblegum Blob', 'Shark Puffum', 'Starfish Squeeze'],
};

const AT = '2026-10-04T10:00:00.000Z';
const prof = (earnedCoins, squish) => ({ coins: 100, stats: { coinsEarned: earnedCoins }, ...(squish ? { squish } : {}) });
const withBase = (earnedCoins, extra = {}) => {
  const p = prof(earnedCoins);
  p.squish = { v: 1, got: {}, glit: {}, seen: {}, base: D.makeBase(p, AT), ...extra };
  return p;
};
/** Open every present in order with a style, returning the keys. */
function openAll(style) {
  const p = { squish: { got: {}, glit: {} } };
  const keys = [];
  for (let i = 0; i < D.presentsTotal() + 2; i++) {
    const n = D.nextItem(p, style);
    if (!n) break;
    keys.push((n.glitter ? 'g:' : '') + n.key);
    (n.glitter ? p.squish.glit : p.squish.got)[n.key] = AT;
  }
  return keys;
}

describe('squishy toys: data (A1-A3)', () => {
  test('A1 the toy list', () => {
    assert.equal(D.ITEMS.length, 48);
    const keys = D.ITEMS.map((i) => i.key);
    assert.equal(new Set(keys).size, 48, 'unique keys');
    for (const it of D.ITEMS) {
      assert.match(it.key, /^(pf|st)_[a-z]+(_[a-z]+)*$/, it.key);
      assert.ok(it.key.length <= 20, it.key);
      assert.ok(!it.key.endsWith('_g'), it.key + ' never ends in _g');
      assert.ok(it.name.length >= 1 && it.name.length <= 20, it.name);
      assert.ok(['g', 'b', 'gb'].includes(it.tag), it.key);
      assert.equal(it.colors.length, 3, it.key);
      for (const c of it.colors) assert.match(c, /^#[0-9A-Fa-f]{6}$/, it.key);
      assert.equal(it.kind, it.key.startsWith('pf_') ? 'puff' : 'stretch', it.key);
    }
    assert.equal(new Set(D.ITEMS.map((i) => i.name)).size, 48, 'unique names');
    assert.equal(D.ITEMS.filter((i) => i.kind === 'puff').length, 24);
    assert.equal(D.ITEMS.filter((i) => i.kind === 'stretch').length, 24);
    assert.ok(D.ITEMS.filter((i) => i.tag === 'b').length >= 10);
    assert.ok(D.ITEMS.filter((i) => i.tag === 'g').length >= 10);
    for (const k of ['pf_dolphin', 'pf_mermaid', 'pf_seadragon', 'pf_whale', 'pf_octopus', 'pf_shark', 'st_ocean', 'st_starfish', 'st_shell']) {
      assert.ok(D.item(k), k);
      assert.ok(D.SEA_KEYS.includes(k), k);
    }
    // C9: merfolk's own colors for the two sea forms
    assert.deepEqual(D.item('pf_seadragon').colors.slice(0, 2), ['#2FB5B0', '#FFD43B']);
    assert.equal(D.item('pf_mermaid').colors[0], '#3FD8B0');
    // every shape has a recipe in models.js (a static scan: models.js needs three.js)
    const models = src('src/things/squish/models.js');
    const m = /export const SHAPES = \[([^\]]*)\]/.exec(models);
    assert.ok(m, 'models.js exports SHAPES as a literal list');
    const shapes = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    for (const it of D.ITEMS) assert.ok(shapes.includes(it.shape), `${it.key}: shape ${it.shape} has a recipe`);
  });

  test('A2 append-only: the pinned goldens', () => {
    assert.deepEqual(D.ITEMS.slice(0, ITEMS_V1.length).map((i) => i.key), ITEMS_V1);
    assert.deepEqual(D.PRESENT_ORDER.slice(0, ORDER_V1.length), ORDER_V1);
  });

  test('A3 PRESENT_ORDER is a permutation of the ITEMS keys', () => {
    assert.deepEqual([...D.PRESENT_ORDER].sort(), D.ITEMS.map((i) => i.key).sort());
  });
});

describe('squishy toys: milestones (A4-A8)', () => {
  test('A4 thresholds', () => {
    const T = D.threshold;
    assert.deepEqual([T(1), T(2), T(3), T(6), T(11), T(48), T(96)], [50, 110, 180, 450, 950, 4650, 9450]);
    let last = 0;
    for (let n = 1; n <= 120; n++) {
      const g = D.gap(n);
      assert.ok(g >= last && g <= 100, `gap ${n}`);
      last = g;
    }
  });

  test('A5 the milestone start: up to 3 welcome presents, promotion capped', () => {
    const cases = [[0, 0, 0], [60, 0, 1], [120, 0, 2], [180, 0, 3], [2000, 1820, 3]];
    for (const [e, base, ready] of cases) {
      const p = withBase(e);
      assert.equal(p.squish.base.coins, base, `earned ${e}: base`);
      assert.equal(D.ready(p), ready, `earned ${e}: ready`);
      assert.equal(p.squish.base.at, AT);
      assert.equal(p.squish.base.prov, undefined);
    }
    const bare = {};
    assert.deepEqual(D.makeBase(bare, AT), { coins: 0, at: AT });
    assert.equal(D.ready({ squish: { base: D.makeBase(bare, AT) } }), 0);
    assert.equal(D.makeBase(prof(10), AT, { prov: true }).prov, 1);
    // a provisional base from a stale copy (earned 300), then the real total (2000) with 2 opened
    const p = prof(2000, { got: { pf_strawberry: AT, pf_dolphin: AT }, glit: {}, base: { coins: 120, at: AT, prov: 1 } });
    assert.ok(D.ready(p) > 3, 'unpromoted it would flood');
    p.squish.base = D.promoteBase(p);
    assert.equal(p.squish.base.prov, undefined);
    assert.ok(D.ready(p) <= 3, `promotion leaves at most 3 ready (${D.ready(p)})`);
    assert.equal(D.ready(p), 3);
  });

  test('A6 earned coins: spending never lowers them; bad values are 0', () => {
    assert.equal(D.earned({ coins: 100, stats: { coinsEarned: 60 } }), 60);
    assert.equal(D.earned({ coins: 400, stats: { coinsEarned: 60 } }), 300, 'coins - 100 is a lower bound');
    assert.equal(D.earned({ coins: 100 }), 0, 'no coinsEarned (an old profile)');
    for (const bad of [NaN, -5, '500', null, Infinity]) assert.equal(D.earned({ coins: bad, stats: { coinsEarned: bad } }), 0, String(bad));
    const p = withBase(140);
    const r0 = D.ready(p), g0 = D.progress(p, 0);
    p.coins -= 30; // a spend in the candy shop: coins down, coinsEarned unchanged
    assert.equal(D.ready(p), r0);
    assert.equal(D.progress(p, 0), g0, 'the ring does not follow spending');
    // flying coins fill it as they land
    const q = withBase(0);
    q.coins += 30;
    q.stats.coinsEarned += 30;
    assert.equal(D.progress(q, 30), 0);
    assert.equal(D.progress(q, 0), 30 / 50);
  });

  test('A7 what is inside: the first 8 per style, no duplicates, then the Glitter round', () => {
    for (const [style, names] of [[null, FIRST8.mix], ['girl', FIRST8.girl], ['boy', FIRST8.boy]]) {
      const keys = openAll(style);
      assert.deepEqual(keys.slice(0, 8).map((k) => D.item(k).name), names, `first 8 for ${style || 'mix'}`);
      assert.ok(keys.slice(0, 4).includes('pf_dolphin'), 'the Dolphin within the first 4');
      const toys = keys.slice(0, 48);
      assert.equal(new Set(toys).size, 48, 'every toy once');
      assert.deepEqual([...toys].sort(), D.ITEMS.map((i) => i.key).sort());
      assert.deepEqual(keys.slice(48), D.PRESENT_ORDER.map((k) => 'g:' + k), 'then the Glitter defaults in order');
      assert.equal(keys.length, 96, 'then null');
      if (style) {
        const other = style === 'boy' ? 'g' : 'b';
        const firstOther = toys.findIndex((k) => D.item(k).tag === other);
        const lastMine = Math.max(...toys.map((k, i) => (D.item(k).tag !== other ? i : -1)));
        assert.ok(firstOther > lastMine, `${style}: no ${other} toy while one of theirs or a shared one is missing`);
      }
    }
    assert.deepEqual(openAll(null).slice(0, 48), D.PRESENT_ORDER, 'Mix is PRESENT_ORDER exactly');
    assert.deepEqual([null, 'girl', 'boy'].map((s) => openAll(s)[0]), ['pf_strawberry', 'pf_unicorn', 'pf_dino']);
    const all = { squish: { got: Object.fromEntries(D.ITEMS.map((i) => [i.key, AT])) } };
    assert.deepEqual(D.nextItem(all, 'boy'), { key: 'pf_strawberry', glitter: true, pick: true });
    assert.equal(D.glitterChoices(all).length, 48);
  });

  test('A8 ready clamps; toNext; rest after appended toys', () => {
    const p = withBase(60, { got: { pf_strawberry: AT, pf_dolphin: AT, pf_dino: AT } });
    assert.equal(D.ready(p), 0, 'opened above reached gives 0');
    const q = withBase(120, { got: { zz_future: AT } });
    assert.equal(D.opened(q), 1, 'unknown keys count as opened');
    assert.equal(D.ready(q), 1);
    assert.equal(D.toNext(withBase(10)), 40);
    assert.equal(D.toNext(withBase(60)), 0, 'one waits');
    const full = withBase(9450, {
      got: Object.fromEntries(D.ITEMS.map((i) => [i.key, AT])),
      glit: Object.fromEntries(D.ITEMS.map((i) => [i.key, AT])),
    });
    assert.equal(D.toNext(full), null);
    assert.equal(D.progress(full), 'done');
    assert.equal(D.ready(full), 0);
    assert.deepEqual(D.restFor(full), { n: 96, coins: 9450 });
    // the kid stays complete and earns 900 more; refresh() keeps rest.coins up to date
    const E = 9450;
    full.stats.coinsEarned = E + 900;
    full.squish.rest = D.restFor(full);
    assert.deepEqual(full.squish.rest, { n: 96, coins: E + 900 });
    // a later build appends 4 toys; she has earned 100 more since
    const extra = ['pf_aa', 'pf_bb', 'pf_cc', 'pf_dd'].map((key) => ({ key, name: key, kind: 'puff', shape: 'berry', colors: ['#FFFFFF', '#FFFFFF', '#FFFFFF'], tag: 'gb' }));
    D.ITEMS.push(...extra);
    D.PRESENT_ORDER.push(...extra.map((i) => i.key));
    try {
      full.stats.coinsEarned = E + 1000;
      assert.equal(D.presentsTotal(), 104);
      assert.equal(D.ready(full), 1, 'one normal gap from rest.coins reaches present 97 only, not 8');
      assert.equal(D.nextItem(full, null).key, 'pf_aa', 'new toys come before the remaining glitter picks');
    } finally {
      D.ITEMS.splice(48);
      D.PRESENT_ORDER.splice(48);
    }
  });

  test('anim curves: a Puffum stays flat while held and rises slowly; a Stretchum stretches', () => {
    assert.ok(pressCurve('puff', 'down', 0.2).sy < 0.6);
    assert.ok(pressCurve('puff', 'down', 5).sy < 0.6, 'flat for as long as it is held');
    assert.ok(pressCurve('puff', 'up', 1.0, 0.45).sy < 0.97, 'still rising after 1 s');
    assert.ok(pressCurve('puff', 'up', 2.3, 0.45).done);
    assert.ok(pressCurve('stretch', 'down', 0.6).sy > 1.3, 'held 600 ms: stretched');
    assert.ok(pressCurve('stretch', 'up', 1.1, 1.5).done);
    assert.ok(pressCurve('stretch', 'tap', 0.4).sy > 1.2 && pressCurve('stretch', 'tap', 1.4).done);
    for (const k of ['puff', 'stretch']) for (const ph of ['tap', 'down', 'up']) for (const t of [0, 0.05, 0.5, 1, 3, NaN]) {
      const c = pressCurve(k, ph, t, 0.5);
      assert.ok(Number.isFinite(c.sx) && Number.isFinite(c.sy) && c.sy > 0, `${k} ${ph} ${t}`);
    }
  });
});

describe('squishy toys: merges (A9-A12)', () => {
  const real = (coins, at) => ({ coins, at });
  const prov = (coins, at) => ({ coins, at, prov: 1 });
  test('A9 mergeSquish', () => {
    const a = { v: 1, got: { pf_strawberry: '2026-10-02', pf_dino: '2026-10-05' }, glit: {}, seen: { pf_dino: 1 }, base: real(0, '2026-10-01') };
    const b = { v: 1, got: { pf_strawberry: '2026-10-01', st_heart: '2026-10-03' }, glit: { pf_dino: '2026-10-06' }, seen: {}, base: real(10, '2026-10-02') };
    const m = mergeSquish(a, b);
    assert.deepEqual(m.got, { pf_strawberry: '2026-10-01', pf_dino: '2026-10-05', st_heart: '2026-10-03' });
    assert.deepEqual(m.glit, { pf_dino: '2026-10-06' });
    assert.deepEqual(m.seen, { pf_dino: 1 });
    assert.deepEqual(m.base, real(0, '2026-10-01'), 'two real: the earliest');
    assert.deepEqual(mergeSquish(b, a), m, 'the order does not matter');
    assert.deepEqual(mergeSquish(m, b), m, 'merging again changes nothing');
    assert.deepEqual(mergeSquish(mergeSquish(a, b), b), mergeSquish(a, b));
    // a real base beats a provisional one, even an earlier one
    assert.deepEqual(mergeSquish({ base: prov(0, '2026-09-01') }, { base: real(50, '2026-10-01') }).base, real(50, '2026-10-01'));
    // two provisional: the larger coins
    assert.deepEqual(mergeSquish({ base: prov(5, '2026-09-01') }, { base: prov(50, '2026-10-01') }).base, prov(50, '2026-10-01'));
    // the stale offline start (earned 300) against a later real one (earned 2,000)
    const stale = { coins: 100, stats: { coinsEarned: 300 } };
    const stBase = D.makeBase(stale, '2026-09-01T00:00:00Z', { prov: true });
    const realP = { coins: 100, stats: { coinsEarned: 2000 } };
    const rBase = D.makeBase(realP, '2026-10-01T00:00:00Z');
    const mm = mergeSquish({ v: 1, got: {}, base: stBase }, { v: 1, got: {}, base: rBase });
    assert.deepEqual(mm.base, rBase);
    assert.ok(D.ready({ ...realP, squish: mm }) <= 3);
    // invalid loses to valid; none valid: absent
    assert.deepEqual(mergeSquish({ base: { coins: -1, at: AT } }, { base: real(3, AT) }).base, real(3, AT));
    assert.deepEqual(mergeSquish({ base: real(3, 'nope') }, { base: real(4, AT) }).base, real(4, AT));
    assert.equal(mergeSquish({ base: 'x' }, { base: null }).base, undefined, 'a missing one is not made up');
    // rest: larger n, then larger coins
    assert.deepEqual(mergeSquish({ rest: { n: 96, coins: 9000 } }, { rest: { n: 97, coins: 10 } }).rest, { n: 97, coins: 10 });
    assert.deepEqual(mergeSquish({ rest: { n: 96, coins: 9000 } }, { rest: { n: 96, coins: 9500 } }).rest, { n: 96, coins: 9500 });
    // unknown inner keys kept
    assert.deepEqual(mergeSquish({ wish: { key: 'pf_dino' } }, { got: {} }).wish, { key: 'pf_dino' });
    // garbage never throws and never drops valid toys
    for (const g of [null, undefined, [], 'x', 5, { got: [] }, { got: 'x', glit: 7, seen: null, base: [], rest: 'r' }]) {
      const r = mergeSquish(a, g);
      assert.ok(r && Object.keys(r.got).length >= 2, `garbage ${JSON.stringify(g)}`);
      assert.deepEqual(mergeSquish(g, a).got, r.got);
    }
    assert.equal(mergeSquish(null, 'x'), undefined);
    assert.deepEqual(mergeSquish(a, undefined), a);
    assert.notEqual(mergeSquish(a, undefined), a, 'a copy');
    assert.equal(mergeSquish({ v: 3 }, { v: 1 }).v, 3);
  });

  test('A10 mergeProfile keeps the toys whichever copy is newer; stats.squishes takes the max', () => {
    const local = { updatedAt: 10, squish: { v: 1, got: { pf_dino: AT } }, stats: { squishes: 7 } };
    const server = { updatedAt: 20, stats: { squishes: 3 } };
    const m = mergeProfile(local, server);
    assert.deepEqual(Object.keys(m.squish.got), ['pf_dino'], 'a newer server copy without squish keeps the local toys');
    assert.equal(m.stats.squishes, 7);
    const m2 = mergeProfile({ updatedAt: 30 }, { updatedAt: 20, squish: { got: { st_heart: AT } } });
    assert.deepEqual(Object.keys(m2.squish.got), ['st_heart'], "a newer local copy keeps the server's toys");
    assert.equal(mergeProfile({ updatedAt: 1 }, { updatedAt: 2 }).squish, undefined, 'neither: absent');
  });

  test('A11 backup files: toys joined, never removed; no squish in the file: not changed', () => {
    const file = backupProfile({ coins: 120, squish: { v: 1, got: { pf_dino: AT }, glit: {}, seen: {} } });
    assert.ok(file.squish && file.squish.got.pf_dino, 'backupProfile carries squish');
    for (const fresh of [true, false]) {
      const cur = { coins: 100, squish: { v: 1, got: { st_heart: AT }, glit: {}, seen: {} } };
      assert.equal(mergeBackupProfile(cur, file, { fresh }), true);
      assert.deepEqual(Object.keys(cur.squish.got).sort(), ['pf_dino', 'st_heart']);
      const empty = { coins: 100 };
      mergeBackupProfile(empty, file, { fresh });
      assert.deepEqual(Object.keys(empty.squish.got), ['pf_dino']);
    }
    const cur = { coins: 100, squish: { v: 1, got: { st_heart: AT }, glit: {}, seen: {} } };
    assert.equal(mergeBackupProfile(cur, { coins: 50 }), false, 'a file without squish: not changed');
    assert.equal(mergeBackupProfile(cur, { squish: JSON.parse(JSON.stringify(cur.squish)) }), false, 'the same toys: not changed');
    const reordered = { coins: 100, squish: { seen: {}, glit: {}, got: { st_heart: AT }, v: 1 } };
    assert.equal(mergeBackupProfile(reordered, { squish: { v: 1, got: { st_heart: AT } } }), false, 'key order does not count as a change');
  });

  test('A12 profileHasPlay counts a toy', () => {
    assert.equal(profileHasPlay({ coins: 100, squish: { got: { pf_strawberry: AT } } }), true);
    assert.equal(profileHasPlay({ coins: 100, squish: { got: {} } }), false);
  });
});

describe('squishy toys: words, keys and safety (A13-A16)', () => {
  test('A13 words: no prices, chances or pronouns; no famous characters; no while or Math.random', () => {
    const texts = [...Object.values(D.STRINGS), ...D.ITEMS.map((i) => i.name), ...D.STICKERS.flatMap(([, n, h]) => [n, h])];
    for (const t of texts) {
      assert.doesNotMatch(t, /buy|price|cost|rare|chance|\bher\b|\bshe\b|[$€£]/i, t);
      assert.doesNotMatch(t, /\d\s*present|present\w*\s*\d|\{n\}\s*present|present\w*\s*\{n\}/i, t + ': no number next to "present"');
      assert.deepEqual(scanCharacters(t), [], t + ': a famous character name');
      assert.deepEqual(scanText(t, { extras: true }), [], t + ': another company\'s name');
    }
    const data = src('src/things/squish/data.js');
    for (const f of readdirSync(path.join(ROOT, 'src/things/squish'))) {
      const s = src('src/things/squish/' + f);
      assert.doesNotMatch(s, /\bwhile\s*\(/, f + ': no while loops');
      assert.doesNotMatch(s, /Math\.random/, f + ': visual randomness uses mulberry32');
    }
    assert.doesNotMatch(src('src/core/squish-merge.js'), /\bwhile\s*\(|Math\.random/);
    assert.ok(data.length > 0);
  });

  test('A14 held keys fit presence `hi`; no localStorage in the module', () => {
    for (const it of D.ITEMS) {
      for (const g of [false, true]) {
        const k = D.defKey(it.key, g);
        assert.match(k, HELD_KEY_RE, k);
        assert.ok(k.length <= 28, k);
        assert.deepEqual(D.parseDefKey(k), { key: it.key, glitter: g });
      }
    }
    assert.equal(D.parseDefKey('squish_PF'), null);
    assert.equal(D.parseDefKey('food:treat_x'), null);
    for (const f of readdirSync(path.join(ROOT, 'src/things/squish'))) assert.doesNotMatch(src('src/things/squish/' + f), /localStorage|sessionStorage/, f);
  });

  test('A15 the server still loads; squish-merge.js has no imports', async () => {
    const mod = await import('../server/saves.mjs');
    assert.ok(mod && typeof mod === 'object');
    assert.doesNotMatch(src('src/core/squish-merge.js'), /^\s*import\b/m);
    assert.match(src('server/saves.mjs'), /squish/, 'the putProfile guard');
  });

  test('A16 the Bag tab sits right after Fun & Toys, once', async () => {
    const { ITEM_CATEGORIES } = await import('../src/core/registry.js');
    const { addSquishTab } = await import('../src/things/squish/tab.js');
    addSquishTab();
    addSquishTab();
    const ids = ITEM_CATEGORIES.map(([id]) => id);
    assert.equal(ids.filter((id) => id === 'squish').length, 1);
    assert.equal(ids[ids.indexOf('fun') + 1], 'squish');
    assert.equal(ITEM_CATEGORIES.find(([id]) => id === 'squish')[1], D.STRINGS.bagTab);
  });
});
