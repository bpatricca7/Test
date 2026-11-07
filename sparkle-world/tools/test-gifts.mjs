// The Gift Workshop (docs/teams/gifts.md, "How to test"), no browser, a few seconds:
//   node tools/test-gifts.mjs            (npm run test:gifts, once the integrator adds it)
//   G1  the lists: 16 toys, 3 boxes, 8 papers, 6 patterns (16 x 16 tiles), 8 ribbons, 3 bows
//   G2  append-only: every list starts with the pinned goldens (saves and held keys use them)
//   G3  normalizeGift / cleanName: anything in, a valid gift out, never a throw
//   G4  every combination (toy or treat x box x paper x pattern x ribbon x bow) gives valid
//       entity data and a held key that comes back to the same look
//   G5  sizes: entity data <= 600 bytes (worst-case names) and flat; held keys fit presence `hi`
//   G6  the shelf (profile.gifts): ensureGifts repairs, add / take / front / return, at most 8
//   G7  coins: 2 a gift, at most 10 a day, a new day starts again, a clock gone back pays nothing
//   G8  mergeGifts (cloud and backup merges)
//   G9  presents round the tree: bounded spot search, spread, the daily re-wrap is seeded
//   G10 the animation curves (wrapPose, givePose, popCurve)
//   G11 words: no prices, pronouns, famous names; no while loops or Math.random in the module
//   G12 every model builds (all toys, boxes, papers x patterns, bows, the stage in every pose,
//       opened gifts, the Workshop in every color, the held gift)
//   G13 the module installed on a fake game: wrap, hold, give to a friend (with the flight),
//       put down, open, undo, presents round the tree, the daily re-wrap, a guest's limits
//   G14 the Workshop panel on a tiny fake DOM: every step, Surprise me!, Wrap it! (timeline),
//       the To: tag, Done, closing mid-wrap keeps the gift, the shelf, a full shelf
//   G15 friends: the gift lines (girl and boy) and {toy} / {to} filled

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCharacters, scanText } from './lib/name-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');

// ---------------- a tiny fake DOM (canvas painters, panels, the life HUD) ----------------

function parseColor(c) {
  const m = typeof c === 'string' ? /^#([0-9a-f]{6})$/i.exec(c.trim()) : null;
  if (!m) return [128, 128, 128, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}
class FakeImageData { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } }
globalThis.ImageData = globalThis.ImageData || FakeImageData;
function fakeCanvas() {
  const c = { width: 16, height: 16, style: {}, className: '', _ctx: null, toDataURL: () => 'data:image/png;base64,AAAA' };
  c.getContext = (kind) => {
    if (kind && kind !== '2d') return null; // no WebGL here
    if (c._ctx) return c._ctx;
    const w = c.width, h = c.height, data = new Uint8ClampedArray(w * h * 4);
    let fill = [0, 0, 0, 255];
    const ctx = {
      canvas: c,
      set fillStyle(v) { fill = parseColor(v); },
      get fillStyle() { return '#000000'; },
      fillRect(x, y, ww, hh) {
        for (let yy = Math.max(0, y | 0); yy < Math.min(h, y + hh); yy++) for (let xx = Math.max(0, x | 0); xx < Math.min(w, x + ww); xx++) data.set(fill, (yy * w + xx) * 4);
      },
      getImageData: (x, y, ww, hh) => new ImageData(data.slice(0, ww * hh * 4), ww, hh),
    };
    c._ctx = new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
    return c._ctx;
  };
  return c;
}

class FakeClassList {
  constructor(el) { this.el = el; }
  _list() { return this.el.className.split(/\s+/).filter(Boolean); }
  add(...c) { const l = this._list(); for (const x of c) if (!l.includes(x)) l.push(x); this.el.className = l.join(' '); }
  remove(...c) { this.el.className = this._list().filter((x) => !c.includes(x)).join(' '); }
  contains(c) { return this._list().includes(c); }
  toggle(c, on) { if (on ?? !this.contains(c)) this.add(c); else this.remove(c); }
}
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.dataset = {};
    this.attrs = {};
    this.hidden = false;
    this.disabled = false;
    this.scrollTop = 0;
    this._text = '';
    this._html = '';
    this._on = {};
  }
  get isConnected() { return true; }
  get offsetWidth() { return 120; }
  get offsetHeight() { return 40; }
  get clientWidth() { return 300; }
  get clientHeight() { return 300; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._clear(); this._text = String(v ?? ''); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._clear(); this._html = String(v ?? ''); this._parse(this._html); }
  set outerHTML(v) { /* a swapped title icon */ this._html = String(v); }
  insertAdjacentHTML(where, html) { this._html += html; this._parse(html); }
  _parse(html) {
    // flat placeholders for each tag, so querySelector('svg') / ('.cls') find something
    for (const m of html.matchAll(/<([a-z]+)([^>]*)>/gi)) {
      const el = new FakeEl(m[1]);
      const cls = /class="([^"]*)"/.exec(m[2]);
      if (cls) el.className = cls[1];
      this.appendChild(el);
    }
  }
  _clear() { for (const c of this.children) c.parentNode = null; this.children = []; this._text = ''; this._html = ''; }
  appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? Object.assign(new FakeEl('#text'), { _text: c }) : c); }
  insertBefore(c, ref) { if (!ref) return this.appendChild(c); if (c.parentNode) c.remove(); c.parentNode = this; this.children.splice(Math.max(0, this.children.indexOf(ref)), 0, c); return c; }
  replaceChildren(...cs) { this._clear(); this.append(...cs); }
  removeChild(c) { c.remove(); return c; }
  remove() { const p = this.parentNode; if (p) { p.children = p.children.filter((x) => x !== this); this.parentNode = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this._on[t] = this._on[t] || []).push(fn); }
  removeEventListener(t, fn) { this._on[t] = (this._on[t] || []).filter((f) => f !== fn); }
  dispatch(t) { const e = { type: t, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, clientX: 0, pointerId: 1 }; for (const fn of this._on[t] || []) fn(e); }
  click() { if (!this.disabled) this.dispatch('click'); }
  animate() { return { finished: Promise.resolve(), cancel() {} }; }
  _all() { const out = []; const walk = (n) => { for (const c of n.children || []) { out.push(c); walk(c); } }; walk(this); return out; }
  _match(sel) {
    const s = sel.replace(/^:scope\s*>\s*/, '').trim();
    if (s.startsWith('.')) return (el) => !!el.classList && el.classList.contains(s.slice(1));
    return (el) => el.tagName === s.toUpperCase();
  }
  querySelectorAll(sel) { return this._all().filter(this._match(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest() { return null; }
}
globalThis.window = globalThis;
globalThis.document = {
  hidden: false,
  createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : new FakeEl(tag)),
  head: new FakeEl('head'),
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.Element = globalThis.Element || FakeEl;

const THREE = await import('three');
const D = await import('../src/things/gifts/data.js');
const M = await import('../src/things/gifts/models.js');
const { HELD_KEY_RE } = await import('../src/net/protocol.js');
const { pickLine, LINES, LINES_BOY } = await import('../src/things/friends/chat.js');

// ---------------- G1-G2 the lists ----------------

const GOLDEN = {
  TOYS: ['teddy', 'ball', 'robot', 'train', 'doll', 'puzzle', 'kite', 'drum', 'rocket', 'unicorn', 'paints', 'book', 'dino', 'car', 'wand', 'globe'],
  BOXES: ['small', 'tall', 'round'],
  PAPERS: ['red', 'green', 'gold', 'blue', 'pink', 'purple', 'snow', 'mint'],
  PATTERNS: ['stripes', 'dots', 'stars', 'snow', 'hearts', 'candy'],
  RIBBONS: ['gold', 'red', 'white', 'green', 'pink', 'purple', 'blue', 'silver'],
  BOWS: ['bow', 'puff', 'star'],
};
const HEX = /^#[0-9A-F]{6}$/i;

describe('gifts: the lists (G1-G2)', () => {
  test('G1 sizes, keys, names, colors and pattern tiles', () => {
    assert.ok(D.TOYS.length >= 12, '12+ toys');
    assert.equal(D.BOXES.length, 3);
    assert.equal(D.PAPERS.length, 8);
    assert.equal(D.PATTERNS.length, 6);
    assert.ok(D.RIBBONS.length >= 6);
    assert.equal(D.BOWS.length, 3);
    for (const [name, list] of Object.entries({ TOYS: D.TOYS, BOXES: D.BOXES, PAPERS: D.PAPERS, PATTERNS: D.PATTERNS, RIBBONS: D.RIBBONS, BOWS: D.BOWS })) {
      const keys = list.map((x) => x.key);
      assert.equal(new Set(keys).size, keys.length, name + ': keys are unique');
      assert.ok(list.length <= 36, name + ': fits one base-36 digit of the held key');
      for (const it of list) {
        assert.match(it.key, /^[a-z]{2,12}$/, name + ' key ' + it.key);
        assert.ok(typeof it.name === 'string' && it.name.length >= 2 && it.name.length <= 20, name + ' name ' + it.name);
      }
    }
    for (const t of D.TOYS) assert.match(t.color, HEX);
    for (const p of D.PAPERS) for (const c of [p.color, p.ink, p.ink2]) assert.match(c, HEX, p.key);
    for (const r of D.RIBBONS) assert.match(r.color, HEX);
    for (const p of D.PATTERNS) {
      assert.equal(p.rows.length, 16, p.key);
      for (const r of p.rows) assert.match(r, /^[.xo]{16}$/, p.key);
      assert.ok(p.rows.join('').includes('x'), p.key + ' has ink');
    }
    assert.ok(D.STICKERS.length <= 3, 'the sticker budget');
    assert.deepEqual(D.STICKERS.map((s) => s[0]), ['gift_maker', 'gift_giver', 'gift_ten']);
    assert.ok(D.GIVE_COINS > 0 && D.DAY_CAP === 10, 'the plan caps giving at 10 coins a day');
  });

  test('G2 append-only: every list starts with the goldens', () => {
    for (const [name, keys] of Object.entries(GOLDEN)) {
      assert.deepEqual(D[name].slice(0, keys.length).map((x) => x.key), keys, name + ' is append-only (saves and held keys keep the indices)');
    }
  });
});

// ---------------- G3-G5 normalization, combinations, sizes ----------------

const WIDE = '\u{20000}'; // a 4-byte letter that NFKC keeps
const worstName = WIDE.repeat(40);

describe('gifts: normalization and limits (G3-G5)', () => {
  test('G3 anything in, a valid gift out', () => {
    const junk = [undefined, null, 0, 1, 'x', [], [1, 2], true, { inside: 'nope', box: 7, paper: {}, pattern: null, ribbon: ['gold'], bow: 'bow' },
      JSON.parse('{"__proto__":{"evil":1},"inside":"robot"}'), { inside: 't:../../etc', to: 42 }, { inside: 't:' + 'a'.repeat(49) }];
    for (const j of junk) {
      const g = D.normalizeGift(j);
      assert.ok(D.isInside(g.inside), JSON.stringify(j));
      for (const [f, list] of [['box', D.BOXES], ['paper', D.PAPERS], ['pattern', D.PATTERNS], ['ribbon', D.RIBBONS], ['bow', D.BOWS]]) {
        assert.ok(list.some((x) => x.key === g[f]), f + ' of ' + JSON.stringify(j));
      }
      assert.equal(typeof g.to, 'string');
      assert.equal(typeof g.from, 'string');
      assert.equal(Object.keys(g).length, 8);
      assert.equal(({}).evil, undefined, 'no prototype pollution');
    }
    assert.equal(D.normalizeGift({ inside: 'robot' }).inside, 'robot');
    assert.equal(D.normalizeGift({ inside: 't:cupcake' }).inside, 't:cupcake');
    assert.equal(D.treatOf('t:cupcake'), 'cupcake');
    assert.equal(D.treatOf('robot'), null);
    assert.equal(D.treatOf('t:BAD KEY'), null);
    // names
    assert.equal(D.cleanName('  Lily  '), 'Lily');
    assert.equal(D.cleanName('Mia <script>'), 'Mia script');
    assert.equal(D.cleanName('Zoë-Anne'), 'Zoë-Anne');
    assert.equal(D.cleanName('---'), '');
    assert.equal(D.cleanName('a'.repeat(50)).length, D.NAME_MAX);
    assert.equal(Array.from(D.cleanName(worstName)).length, D.NAME_MAX);
    assert.equal(D.cleanName(null), '');
    assert.equal(D.cleanName('😀😀'), '', 'emoji are dropped');
    assert.equal(D.cleanName('Ｌｉｌｙ'), 'Lily', 'NFKC');
    assert.equal(D.cleanName("O''Brien"), "O'Brien");
  });

  test('G4 every combination: valid data, a held key that comes back to the same look', () => {
    const insides = [...D.TOYS.map((t) => t.key), 't:cupcake'];
    let n = 0;
    const keys = new Set();
    for (const inside of insides) for (const b of D.BOXES) for (const p of D.PAPERS) for (const pt of D.PATTERNS) for (const r of D.RIBBONS) for (const bw of D.BOWS) {
      const g = { inside, box: b.key, paper: p.key, pattern: pt.key, ribbon: r.key, bow: bw.key, to: 'Mia', from: 'Lily' };
      const d = D.giftData(g);
      assert.equal(d.inside, inside);
      assert.equal(d.box, b.key);
      assert.equal(d.open, 0);
      const k = D.heldKeyOf(g);
      assert.match(k, D.HELD_RE);
      const back = D.parseHeldKey(k);
      assert.deepEqual([back.box, back.paper, back.pattern, back.ribbon, back.bow], [b.key, p.key, pt.key, r.key, bw.key]);
      keys.add(k);
      n++;
    }
    assert.equal(n, insides.length * 3 * 8 * 6 * D.RIBBONS.length * 3);
    assert.equal(keys.size, 3 * 8 * 6 * D.RIBBONS.length * 3, 'every look has its own held key');
    for (const bad of ['gift_w', 'gift_wzzzzz', 'gift_w00000x', 'GIFT_W00000', 'gift_w0000', null, 7, 'teddy']) assert.equal(D.parseHeldKey(bad), null, String(bad));
  });

  test('G5 entity data <= 600 bytes and flat, held keys fit presence `hi`', () => {
    const big = D.giftData({ inside: 't:' + 'a'.repeat(48), box: 'round', paper: 'purple', pattern: 'stripes', ribbon: 'silver', bow: 'puff', to: worstName, from: worstName }, { open: 1, tree: 1 });
    const bytes = Buffer.byteLength(JSON.stringify(big), 'utf8');
    assert.ok(bytes <= 600, `${bytes} bytes`);
    for (const v of Object.values(big)) assert.ok(v === null || typeof v !== 'object', 'flat (depth 1)');
    assert.deepEqual(Object.keys(big).sort(), ['bow', 'box', 'from', 'inside', 'open', 'paper', 'pattern', 'ribbon', 'to', 'tree']);
    for (const b of D.BOXES) for (const bw of D.BOWS) {
      const k = D.heldKeyOf({ box: b.key, bow: bw.key, paper: 'mint', ribbon: 'silver', pattern: 'candy' });
      assert.match(k, HELD_KEY_RE);
      assert.ok(k.length <= 16);
    }
    // the held key carries the look only: never a name or what is inside
    const k = D.heldKeyOf({ inside: 'robot', to: 'Mia', from: 'Lily' });
    assert.doesNotMatch(k, /mia|lily|robot/i);
  });
});

// ---------------- G6-G8 the shelf, coins, merges ----------------

describe('gifts: profile.gifts (G6-G8)', () => {
  test('G6 ensureGifts repairs; the shelf holds 8', () => {
    const p = { gifts: { sack: [{ id: 'abcd1234', inside: 'robot' }, { id: 'abcd1234', inside: 'kite' }, { id: 'BAD!', inside: 'kite' }, null, 7, ...Array.from({ length: 12 }, (_, i) => ({ id: 'id' + String(i).padStart(4, '0'), paper: 'mint' }))],
      toys: { robot: 1, nope: 1, __proto__x: 1 }, made: -3, given: 'x', opened: 2.7, coinDay: NaN, coinsToday: Infinity, last: 'junk' } };
    const s = D.ensureGifts(p);
    assert.equal(s, p.gifts);
    assert.equal(s.sack.length, D.SACK_MAX);
    assert.equal(s.sack[0].inside, 'robot', 'the first of two same ids wins');
    assert.equal(new Set(s.sack.map((e) => e.id)).size, s.sack.length);
    assert.deepEqual(Object.keys(s.toys), ['robot']);
    assert.deepEqual([s.made, s.given, s.opened, s.coinDay, s.coinsToday], [0, 0, 2, 0, 0]);
    assert.deepEqual(Object.keys(s.last).sort(), ['bow', 'box', 'inside', 'paper', 'pattern', 'ribbon']);
    assert.equal(D.ensureGifts(null), null);
    const fresh = D.ensureGifts({});
    assert.deepEqual(fresh.sack, []);
    // add / take / front / return
    const g = D.ensureGifts({});
    for (let i = 0; i < D.SACK_MAX; i++) assert.ok(D.sackAdd(g, { inside: 'ball' }, 'gift' + i));
    assert.equal(D.sackAdd(g, { inside: 'ball' }, 'gift9'), false, 'full');
    assert.equal(D.sackAdd(D.ensureGifts({}), { inside: 'ball' }, 'no'), false, 'a bad id');
    assert.ok(D.sackFront(g, 'gift5'));
    assert.equal(g.sack[0].id, 'gift5');
    const t = D.sackTake(g, 'gift5');
    assert.equal(t.id, 'gift5');
    assert.equal(D.sackTake(g, 'gift5'), null);
    assert.equal(D.sackTake(g).id, 'gift0', 'null takes the front');
    assert.ok(D.sackReturn(g, t));
    assert.equal(g.sack[0].id, 'gift5');
    assert.ok(D.sackReturn(g, t), 'already there is fine');
    assert.equal(D.sackTake({ sack: [] }), null);
  });

  test('G7 coins: 2 a gift, 10 a day at most, a clock gone back pays nothing', () => {
    const g = D.ensureGifts({});
    const day = D.dayStamp(new Date(2026, 11, 24));
    assert.equal(day, 20261224);
    const pays = Array.from({ length: 8 }, () => D.payForGift(g, day));
    assert.deepEqual(pays, [2, 2, 2, 2, 2, 0, 0, 0]);
    assert.equal(pays.reduce((a, b) => a + b, 0), D.DAY_CAP);
    assert.equal(D.payForGift(g, day + 1), 2, 'a new day');
    assert.equal(D.payForGift(g, day), 0, 'the clock went back');
    assert.equal(g.coinDay, day + 1, 'the newer day is kept');
    assert.equal(D.payForGift(g, NaN), 0);
    assert.equal(D.payForGift(null, day), 0);
    const odd = { coinDay: day, coinsToday: 9 };
    assert.equal(D.payForGift(odd, day), 1, 'never past the cap');
    const neg = { coinDay: day, coinsToday: -50 };
    assert.equal(D.payForGift(neg, day, 50), D.DAY_CAP, 'garbage counts cannot raise the cap');
  });

  test('G8 mergeGifts keeps both sides', () => {
    const a = { sack: [{ id: 'aaaa1', inside: 'robot' }], toys: { robot: 1 }, made: 3, given: 1, opened: 5, coinDay: 20261224, coinsToday: 4 };
    const b = { sack: [{ id: 'aaaa1', inside: 'kite' }, { id: 'bbbb2', inside: 'kite' }], toys: { kite: 1 }, made: 1, given: 7, opened: 2, coinDay: 20261224, coinsToday: 8 };
    const m = D.mergeGifts(a, b);
    assert.deepEqual(m.sack.map((e) => e.id), ['aaaa1', 'bbbb2']);
    assert.equal(m.sack[0].inside, 'robot', 'the first side wins on one id');
    assert.deepEqual(Object.keys(m.toys).sort(), ['kite', 'robot']);
    assert.deepEqual([m.made, m.given, m.opened, m.coinsToday], [3, 7, 5, 8]);
    const later = D.mergeGifts(a, { coinDay: 20261225, coinsToday: 2 });
    assert.deepEqual([later.coinDay, later.coinsToday], [20261225, 2]);
    assert.ok(D.mergeGifts(null, undefined).sack.length === 0);
    const many = { sack: Array.from({ length: 8 }, (_, i) => ({ id: 'aaaa' + i })) };
    const more = { sack: Array.from({ length: 8 }, (_, i) => ({ id: 'bbbb' + i })) };
    assert.equal(D.mergeGifts(many, more).sack.length, D.SACK_MAX);
    assert.equal(a.sack.length, 1, 'the inputs are not changed');
    assert.equal(D.toysGot(m), 2);
  });
});

// ---------------- G9-G10 the tree, curves ----------------

describe('gifts: the tree and the animation (G9-G10)', () => {
  test('G9 presentSpots: bounded, spread, only free cells', () => {
    let calls = 0;
    const free = (x, y, z) => { calls++; return y === 10 && !(Math.abs(x) <= 1 && Math.abs(z) <= 1); };
    const s = D.presentSpots(0, 10, 0, 8, free);
    assert.equal(s.length, 8);
    assert.ok(calls <= 13 * 13 * 7, `${calls} checks`);
    assert.equal(new Set(s.map((c) => c.join())).size, 8, 'no cell twice');
    for (const [x, y, z] of s) {
      assert.equal(y, 10);
      assert.ok(!(Math.abs(x) <= 1 && Math.abs(z) <= 1), 'never in the trunk');
      assert.ok(Math.hypot(x, z) <= 6.5);
    }
    // spread round the tree: not all on one side
    const sides = new Set(s.map(([x, , z]) => (Math.abs(x) > Math.abs(z) ? (x > 0 ? 'E' : 'W') : z > 0 ? 'S' : 'N')));
    assert.ok(sides.size >= 3, 'presents all round the tree');
    assert.deepEqual(D.presentSpots(0, 0, 0, 5, () => false), []);
    assert.deepEqual(D.presentSpots(0, 0, 0, 0, () => true), []);
    assert.ok(D.presentSpots(0, 0, 0, 99, () => true).length <= 12);
    // steps: one block up or down is fine
    const hilly = D.presentSpots(0, 5, 0, 4, (x, y) => y === 5 + (x > 0 ? 1 : 0));
    assert.equal(hilly.length, 4);
  });

  test('G9 treeGift: seeded, a new toy every day, never two the same on one day', () => {
    const a = Array.from({ length: 8 }, (_, i) => D.treeGift(42, 3, i));
    const b = Array.from({ length: 8 }, (_, i) => D.treeGift(42, 3, i));
    assert.deepEqual(a, b, 'deterministic');
    assert.equal(new Set(a.map((g) => g.inside)).size, 8);
    const c = Array.from({ length: 8 }, (_, i) => D.treeGift(42, 4, i));
    assert.notDeepEqual(a.map((g) => g.inside), c.map((g) => g.inside), 'a new day, new toys');
    for (const g of [...a, ...c]) {
      assert.equal(g.from, D.TREE_FROM);
      assert.equal(g.to, '');
      assert.ok(D.toy(g.inside));
      assert.notEqual(D.ribbon(g.ribbon).color.toLowerCase(), D.paper(g.paper).color.toLowerCase(), 'the ribbon shows on the paper');
    }
    assert.deepEqual(D.treeGift(1, -5, 0), D.treeGift(1, 1, 0), 'a bad day reads as day 1');
    const d = D.giftData(a[0], { tree: 1 });
    assert.equal(d.tree, 1);
    assert.equal(d.from, D.TREE_FROM);
  });

  test('G10 curves: wrap and give run their course, the pop overshoots then settles', () => {
    const w0 = D.wrapPose(0), w1 = D.wrapPose(D.WRAP_SECONDS);
    assert.deepEqual([w0.lid, w0.paper, w0.ribbon, w0.bow, w0.done], [0, 0, 0, 0, false]);
    assert.deepEqual([w1.toyY, w1.lid, w1.paper, w1.ribbon, w1.done], [-1, 1, 1, 1, true]);
    assert.ok(Math.abs(w1.bow - 1) < 1e-9);
    let prev = D.wrapPose(0);
    for (let t = 0; t <= D.WRAP_SECONDS; t += 0.05) {
      const p = D.wrapPose(t);
      for (const k of ['lid', 'paper', 'ribbon']) assert.ok(p[k] >= prev[k] - 1e-9, `${k} only grows`);
      assert.ok(p.toyY <= prev.toyY + 1e-9, 'the toy only sinks');
      prev = p;
    }
    // the order of the moment: the toy is in before the lid shuts, the paper before the ribbon
    assert.ok(D.wrapPose(0.6).toyY <= -0.99 && D.wrapPose(0.6).lid < 0.5);
    assert.ok(D.wrapPose(1.6).paper > 0.9 && D.wrapPose(1.6).ribbon === 0);
    for (const bad of [NaN, -1, Infinity]) assert.doesNotThrow(() => D.wrapPose(bad));
    const g = D.givePose(D.GIVE_SECONDS);
    assert.ok(g.pop && g.hand && g.done && g.fly === 1);
    assert.equal(D.givePose(1.5).pop, false);
    assert.equal(D.givePose(1.55).pop, true);
    assert.equal(D.givePose(2.49).hand, false);
    assert.ok(Math.max(...Array.from({ length: 50 }, (_, i) => D.popCurve(i / 49))) > 1.2, 'overshoots');
    assert.equal(D.popCurve(1), 1);
    assert.equal(D.popCurve(-3), 0);
  });
});

// ---------------- G11 words and sources ----------------

describe('gifts: words and safety (G11)', () => {
  test('G11 words: no prices, pronouns or famous names; no while loops or Math.random', () => {
    const texts = [
      ...Object.values(D.STRINGS).flat(),
      ...['TOYS', 'BOXES', 'PAPERS', 'PATTERNS', 'RIBBONS', 'BOWS'].flatMap((n) => D[n].map((x) => x.name)),
      ...D.STICKERS.flatMap(([, n, h]) => [n, h]),
      D.TREE_FROM,
      ...[LINES.gift, LINES.giftTreat, LINES.giftAsk, LINES.giftOther, LINES.giftHave, LINES_BOY.gift, LINES.events['gift:wrap'], LINES.events['gift:open'], LINES.places.gift_workshop, LINES.places.gift_box].flat(),
    ];
    assert.ok(texts.length > 100);
    for (const t of texts) {
      assert.equal(typeof t, 'string');
      assert.doesNotMatch(t, /\bbuy\b|price|cost|\bpay\b|[$€£]|\bher\b|\bshe\b|\bhis\b|\bhe\b/i, t);
      assert.deepEqual(scanCharacters(t), [], t + ': a famous character name');
      assert.deepEqual(scanText(t, { extras: true }), [], t + ': another company\'s name');
    }
    for (const f of readdirSync(path.join(ROOT, 'src/things/gifts'))) {
      const s = src('src/things/gifts/' + f);
      assert.doesNotMatch(s, /\bwhile\s*\(/, f + ': no while loops');
      assert.doesNotMatch(s, /Math\.random/, f + ': visual randomness uses mulberry32');
      assert.doesNotMatch(s, /localStorage|sessionStorage/, f + ': saves go through the profile');
      assert.deepEqual(scanText(s, { extras: true }), [], f + ': another company\'s name');
    }
    // data.js stays pure: no imports, no DOM, no three.js
    const data = src('src/things/gifts/data.js');
    assert.doesNotMatch(data, /^import /m);
    assert.doesNotMatch(data, /document\.|window\./);
    // the shared-file lines: friends/index.js and chat.js only (plan §6.1)
    const friends = src('src/things/friends/index.js');
    assert.match(friends, /receiveGift\(/);
    assert.match(friends, /'gift:hand'/);
  });
});

// ---------------- G12 every model builds ----------------

const countMeshes = (o) => { let n = 0; o.traverse((c) => { if (c.isMesh) n++; }); return n; };
const finiteBox = (o) => {
  const b = new THREE.Box3().setFromObject(o);
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite) && !b.isEmpty();
};

describe('gifts: models (G12)', () => {
  test('G12 toys, gifts in every paper x pattern, bows, boxes', () => {
    for (const t of D.TOYS) {
      for (const opts of [{}, { cell: true, hitbox: true }, { part: true, cell: true }]) {
        const m = M.toyModel(t.key, opts);
        assert.ok(countMeshes(m) > 0 && finiteBox(m), t.key);
      }
    }
    const treat = M.insideModel('t:cupcake');
    assert.ok(countMeshes(treat) > 0, 'a treat inside');
    let n = 0;
    for (const b of D.BOXES) for (const p of D.PAPERS) for (const pt of D.PATTERNS) {
      const r = D.RIBBONS[n % D.RIBBONS.length], bw = D.BOWS[n % D.BOWS.length];
      const g = { inside: 'teddy', box: b.key, paper: p.key, pattern: pt.key, ribbon: r.key, bow: bw.key };
      const cell = M.giftModel(g, { cell: true });
      assert.ok(countMeshes(cell) > 0 && finiteBox(cell), `${b.key}/${p.key}/${pt.key}`);
      const bb = new THREE.Box3().setFromObject(cell);
      assert.ok(bb.min.x >= -0.05 && bb.max.x <= 1.05 && bb.max.y <= 1.05, 'fits its cell');
      n++;
    }
    for (const b of D.BOXES) for (const bw of D.BOWS) for (const r of D.RIBBONS) {
      const g = { box: b.key, bow: bw.key, ribbon: r.key, paper: 'red', pattern: 'dots' };
      const parts = M.giftModel(g, { parts: true });
      assert.ok(parts.userData.parts && parts.userData.parts.bow && parts.userData.parts.lid, 'parts for the flight');
      assert.ok(finiteBox(M.heldGiftModel(g)));
    }
    for (const t of D.TOYS) assert.ok(finiteBox(M.heldToyModel(t.key)));
    for (const c of M.WORKSHOP_COLORS) {
      const w = M.workshopModel(c);
      const bb = new THREE.Box3().setFromObject(w);
      assert.ok(countMeshes(w) > 0 && bb.max.y <= 2.6 && bb.max.x <= 2.2, 'the Workshop fits 2 x 2 x 1');
    }
  });

  test('G12 the stage in every pose, the opened gift for every toy', () => {
    for (const b of D.BOXES) for (const bw of D.BOWS) {
      const g = { inside: b.key === 'round' ? 'drum' : 't:cupcake', box: b.key, bow: bw.key, paper: 'gold', pattern: 'hearts', ribbon: 'red' };
      const s = M.stageModel(g);
      M.putInside(s, g.inside);
      assert.ok(s.userData.fit > 0 && s.userData.fit <= 1.2);
      for (const pose of ['toy', 'box', 'paper', 'ribbon', 'done']) {
        M.poseStage(s, pose, 1.3);
        assert.ok(finiteBox(s), `${b.key} ${pose}`);
      }
      for (let t = 0; t <= D.WRAP_SECONDS + 0.01; t += 0.1) M.poseStage(s, D.wrapPose(t), t);
      const P = s.userData.parts;
      assert.ok(P.bow.visible && P.ribbon.visible, 'wrapped: the bow and ribbon show');
      assert.equal(P.box.visible, false, 'wrapped: the cardboard is under the paper');
    }
    for (const t of [...D.TOYS.map((x) => x.key), 't:cupcake']) {
      for (const live of [false, true]) {
        const o = M.openedModel({ inside: t, box: 'tall', paper: 'snow', pattern: 'candy', ribbon: 'green', bow: 'star' }, { live });
        assert.ok(countMeshes(o) > 0 && finiteBox(o), t);
        if (live) assert.ok(o.userData.parts && o.userData.parts.toy, 'the toy can hop');
      }
    }
  });
});

// ---------------- G13 the module on a fake game ----------------

function emitter() {
  const on = new Map();
  return {
    on(n, fn) { if (!on.has(n)) on.set(n, []); on.get(n).push(fn); },
    off(n, fn) { if (on.has(n)) on.set(n, on.get(n).filter((f) => f !== fn)); },
    emit(n, p) { this.log.push([n, p]); for (const fn of on.get(n) || []) fn(p); },
    log: [],
  };
}

function fakeUi(game) {
  const root = new FakeEl('div');
  const ui = {
    game,
    root,
    hudLayer: new FakeEl('div'),
    panelLayer: new FakeEl('div'),
    panels: new Map(),
    current: null,
    dialogOpen: false,
    toasts: [],
    styles: 0,
    el(tag, cls = '', text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; },
    button({ label = '', onClick = null, variant = 'pink', className = '' } = {}) {
      const b = ui.el('button', `sw-btn sw-btn--${variant}${className ? ' ' + className : ''}`);
      if (label) b.appendChild(ui.el('span', 'sw-btn-label', label));
      b.addEventListener('click', (e) => { game.audio.play('click'); if (onClick) onClick(e); });
      return b;
    },
    addStyles() { ui.styles++; },
    toast(text, opts = {}) { ui.toasts.push({ text, ...opts }); },
    hint() {},
    registerPanel(name, def) {
      const wrap = ui.el('div', 'sw-panel-wrap');
      const container = ui.el('div', 'sw-card-body');
      wrap.appendChild(container);
      ui.panels.set(name, { def, wrap, container, built: false });
    },
    open(name, args) {
      const p = ui.panels.get(name);
      if (!p) return false;
      if (ui.current && ui.current !== name) ui._hide(ui.current);
      if (!p.built) { p.def.build(p.container, game); p.built = true; }
      ui.current = name;
      game.paused = true;
      if (p.def.onOpen) p.def.onOpen(args);
      return true;
    },
    _hide(name) { const p = ui.panels.get(name); if (p && p.def.onClose) p.def.onClose(); },
    close() { if (!ui.current) return; const n = ui.current; ui.current = null; ui._hide(n); game.paused = false; },
    back() { ui.close(); },
  };
  return ui;
}

function fakeEntities(game) {
  const E = {
    defs: new Map(), actions: new Map(), list: [], uid: 1, blocked: new Set(), builds: 0,
    define(input) {
      const def = { category: 'living', size: [1, 1, 1], colliders: 'full', actions: [], placeOn: 'floor', defaultData: {}, ...input };
      E.defs.set(def.key, def);
      game.registry.items.register({ key: 'furn:' + def.key, name: def.name, category: def.category, kind: 'furniture', use: (g, hit) => !!E.placeFromHit(def.key, hit) });
      return def;
    },
    registerAction(name, h) { E.actions.set(name, h); },
    canPlace(def, x, y, z) { return !E.blocked.has(`${x},${y},${z}`) && !E.list.some((e) => e.x === x && e.y === y && e.z === z); },
    _solidAt(x, y) { return y < 0; },
    surfaceBelow() { return null; },
    place(key, x, y, z, rot = 0, color = null, data = {}, opts = {}) {
      const def = E.defs.get(key);
      if (!def) return null;
      if (!opts.force && !E.canPlace(def, x, y, z, rot)) return null;
      const e = { uid: E.uid++, key, def, x, y, z, rot, color, data: { ...def.defaultData, ...data } };
      E.list.push(e);
      E._attach(e);
      if (opts.history !== false) game.pushHistory({ undo: () => E.remove(e), redo: () => { E.list.push(e); E._attach(e); } });
      return e;
    },
    placeFromHit(key, hit) { return hit && hit.place ? E.place(key, hit.place[0], hit.place[1], hit.place[2], 0) : null; },
    _attach(e) {
      const pivot = new THREE.Group();
      pivot.add(e.def.build(e.color, e.data));
      e.object3d = pivot;
      E.builds++;
      assert.ok(finiteBox(pivot), e.key + ' builds');
    },
    refresh(e) { if (E.list.includes(e)) E._attach(e); },
    setData(e, patch) { Object.assign(e.data, patch); E.refresh(e); game.events.emit('entity:data', { uid: e.uid, patch }); },
    remove(e) { E.list = E.list.filter((x) => x !== e); },
    localToWorld(e, lx, ly, lz) { return new THREE.Vector3(e.x + lx, e.y + ly, e.z + lz); },
    byUid(uid) { return E.list.find((e) => e.uid === uid) || null; },
    all() { return [...E.list]; },
    run(e) { return E.actions.get(e.def.actions[0]).run(game, e); },
    update(dt) { for (const e of E.list) if (e.def.update) e.def.update(e, dt, game); },
  };
  return E;
}

function fakeFriend(name, kind = 'girl') {
  return {
    name, def: { kind, pitch: 1 }, act: 'idle', pos: new THREE.Vector3(2, 0, 0), yaw: 0, faceT: 0, eatT: 0, emoteLeft: 0,
    stops: 0, emotes: [],
    stop() { this.stops++; }, emote(n) { this.emotes.push(n); },
  };
}

function fakeGame({ guest = false, ui = false } = {}) {
  const items = new Map();
  const game = {
    mode: 'play', loading: false, paused: false,
    events: emitter(),
    registry: { items: { register(it) { const full = { hidden: false, ...it }; items.set(it.key, full); return full; }, get: (k) => items.get(k) || null, map: items }, stickers: new Map() },
    profile: { look: { name: 'Lily' }, basket: { cupcake: 2 }, coins: 100 },
    saves: 0,
    saveProfile() { game.saves++; },
    audio: { play() {}, ctx: null },
    scene: new THREE.Scene(),
    thumbs: { get: () => Promise.resolve(null) },
    particles: { n: 0, emit() { game.particles.n++; } },
    celebrate() {},
    coins: { got: [], add(n, reason, opts) { game.coins.got.push({ n, reason, opts }); } },
    awarded: [],
    award(id) { game.awarded.push(id); return true; },
    toast(text, opts = {}) { (game.ui ? game.ui.toasts : game.toasts).push({ text, ...opts }); },
    toasts: [],
    history: [],
    _group: null,
    pushHistory(e) { if (game._group) game._group.push(e); else game.history.push(e); },
    beginHistoryGroup() { game._group = []; },
    endHistoryGroup() { const l = game._group; game._group = null; if (l && l.length) game.history.push(l.length === 1 ? l[0] : { undo: () => { for (let i = l.length - 1; i >= 0; i--) l[i].undo(); }, redo: () => l.forEach((e) => e.redo && e.redo()) }); },
    undo() { const e = game.history.pop(); if (e) e.undo(); },
    hotbar: { slots: Array(9).fill(null), colors: Array(9).fill(null), index: 0 },
    setSlot(i, key) { game.hotbar.slots[i] = key; game.hotbar.index = i; game.events.emit('hotbar:change', { index: i, key }); },
    player: { position: new THREE.Vector3(0, 0, 0), yaw: 0, avatar: { held: null, heldShown: true, hold(o) { this.held = o; } } },
    time: { day: 3 },
    world: { meta: { seed: 42 } },
    net: guest ? { active: true, isGuest: true, remoteApplying: false, players: () => [{ name: 'Lily', you: true }, { name: 'Sam', you: false }] } : null,
    debug: {},
    worldFeatures: null,
    systems: [],
    addSystem(s) { game.systems.push(s); },
  };
  game.entities = fakeEntities(game);
  // the world features registry (src/world/features.js): on(kind, fn), placeOpts(), run(world, list)
  const kinds = new Map();
  game.worldFeatures = {
    on(k, fn) { kinds.set(k, fn); },
    placeOpts(extra = null) { return { history: false, events: false, fx: false, ...(extra || {}) }; },
    run(world, list) { let n = 0; for (const r of list) if (kinds.get(r.kind) && kinds.get(r.kind)(game, r)) n++; return n; },
  };
  const mia = fakeFriend('Mia');
  const leo = fakeFriend('Leo', 'boy');
  leo.pos.set(-3, 0, 0);
  game.friends = {
    friends: [mia, leo], remote: false, said: [], got: [],
    say(f, kind, opts = {}) { this.said.push({ f: f.name, kind, extra: opts.extra }); return kind; },
    nearest(x, y, z, max) { return this.friends.map((f) => [f, f.pos.distanceTo(new THREE.Vector3(x, y, z))]).filter(([, d]) => d <= max).sort((a, b) => a[1] - b[1]).map(([f]) => f)[0] || null; },
    receiveGift(f, opts) { this.got.push({ f: f.name, ...opts }); return true; },
  };
  if (ui) game.ui = fakeUi(game);
  return game;
}

const { install } = await import('../src/things/gifts/index.js');
const tick = (game, secs, dt = 0.05) => { for (let t = 0; t < secs; t += dt) { for (const s of game.systems) if (s.update) s.update(dt); game.entities.update(dt); } };

describe('gifts: the module on a fake game (G13)', () => {
  test('G13 install, wrap, hold, give to a friend, coins and stickers', () => {
    const game = fakeGame();
    install(game);
    game.events.emit('game:ready');
    for (const id of ['gift_maker', 'gift_giver', 'gift_ten']) assert.ok(game.registry.stickers.has(id), id);
    assert.ok(game.registry.items.get('furn:gift_workshop'), 'the Workshop in the Bag');
    assert.equal(game.registry.items.get('furn:gift_workshop').category, 'holiday');
    assert.ok(game.registry.items.get('furn:gift_box'));
    assert.equal(game.registry.items.get('gift:hand').hidden, true, 'My Gifts hides while the shelf is empty');
    assert.equal(game.registry.items.get('furn:gift_toy_robot').hidden, true, 'toys show once she has them');
    assert.ok(game.gifts && game.debug.gifts, 'the facade and the debug probe');
    const sys = game.systems.find((s) => s.name === 'gifts');
    assert.ok(sys);

    // wrap one for Mia: it is in her hands
    const e = game.gifts.wrap({ inside: 'robot', box: 'tall', paper: 'blue', pattern: 'snow', ribbon: 'gold', bow: 'star' }, 'Mia');
    assert.ok(e && e.id);
    assert.equal(e.from, 'Lily');
    assert.equal(e.to, 'Mia');
    assert.deepEqual(game.awarded, ['gift_maker']);
    assert.equal(game.hotbar.slots[game.hotbar.index], 'gift:hand');
    tick(game, 0.1);
    assert.ok(game.player.avatar.held, 'she holds it');
    assert.match(game.gifts.held(), /^gift_w[0-9a-z]{5}$/);
    assert.ok(game.gifts.model(game.gifts.held()), 'friends can draw it');
    assert.equal(game.registry.items.get('gift:hand').hidden, false);
    assert.equal(game.profile.gifts.last.inside, 'robot', 'the Workshop remembers her last choices');
    assert.ok(game.events.log.some(([n]) => n === 'gift:wrap'));

    // Leo says "That one is for Mia!" and keeps nothing
    const leo = game.friends.friends[1];
    assert.equal(game.gifts.giveTo(leo), true);
    assert.equal(game.friends.said.at(-1).kind, 'giftOther');
    assert.equal(game.friends.said.at(-1).extra.to, 'Mia');
    assert.equal(game.profile.gifts.sack.length, 1);

    // Mia gets it: the flight, "For me?!", the pop, the toy in her hands
    const mia = game.friends.friends[0];
    assert.equal(game.gifts.giveTo(mia), true);
    assert.equal(game.profile.gifts.sack.length, 0);
    assert.equal(game.player.avatar.held, null, 'her hands are empty');
    assert.equal(game.hotbar.slots.includes('gift:hand'), false, 'My Gifts leaves the hotbar');
    assert.ok(game.scene.children.length >= 1, 'the gift flies');
    assert.equal(game.gifts.giveTo(mia), false, 'nothing else to give');
    tick(game, D.GIVE_SECONDS + 0.3);
    assert.ok(game.friends.said.some((s) => s.kind === 'giftAsk'), '"For me?!"');
    assert.equal(game.friends.got.length, 1);
    assert.equal(game.friends.got[0].toy, 'Robot');
    assert.ok(game.friends.got[0].model, 'the toy model goes to the friend');
    assert.equal(game.scene.children.length, 0, 'the flight cleans up');
    assert.deepEqual(game.coins.got.map((c) => [c.n, c.reason]), [[2, 'gift']]);
    assert.ok(game.awarded.includes('gift_giver'));
    assert.ok(game.events.log.some(([n, p]) => n === 'gift:give' && p.npc === 'Mia'));

    // a sleeping friend: a toast, nothing given
    game.gifts.wrap({ inside: 'kite' }, '');
    mia.act = 'sleep';
    assert.equal(game.gifts.giveTo(mia), true);
    assert.match(game.toasts.at(-1).text, /asleep/);
    assert.equal(game.profile.gifts.sack.length, 1);
    mia.act = 'idle';

    // ten gifts: Holiday Helper, and coins stop at 10 today
    for (let i = 0; i < 11; i++) {
      game.gifts.wrap({ inside: 'ball' }, '');
      game.gifts.hold();
      tick(game, 0.05);
      assert.ok(game.gifts.giveTo(mia));
      tick(game, D.GIVE_SECONDS + 0.2);
    }
    const coins = game.coins.got.reduce((a, c) => a + c.n, 0);
    assert.equal(coins, D.DAY_CAP, 'never more than 10 coins a day');
    assert.ok(game.awarded.includes('gift_ten'));
    assert.ok(game.profile.gifts.given >= 10);
  });

  test('G13 the shelf: 8 at most, a treat comes out of the basket, put away and back', () => {
    const game = fakeGame();
    install(game);
    game.events.emit('game:ready');
    assert.ok(game.gifts.wrap({ inside: 't:cupcake' }, ''), 'a treat gift');
    assert.equal(game.profile.basket.cupcake, 1);
    game.gifts.wrap({ inside: 't:cupcake' }, '');
    assert.equal(game.profile.basket.cupcake, undefined, 'the basket is empty now');
    assert.equal(game.gifts.wrap({ inside: 't:cupcake' }, ''), null, 'no cupcake left');
    for (let i = 0; i < 6; i++) assert.ok(game.gifts.wrap({ inside: 'drum' }, ''));
    assert.equal(game.profile.gifts.sack.length, D.SACK_MAX);
    assert.equal(game.gifts.wrap({ inside: 'drum' }, ''), null, 'the shelf is full');
    assert.match(game.toasts.at(-1).text, /full/);
    assert.ok(game.gifts.putAway());
    tick(game, 0.05);
    assert.equal(game.player.avatar.held, null);
    assert.equal(game.hotbar.slots.includes('gift:hand'), false);
    assert.equal(game.profile.gifts.sack.length, D.SACK_MAX, 'putting away keeps the gift');
    const third = game.profile.gifts.sack[2].id;
    assert.ok(game.gifts.hold(third));
    assert.equal(game.profile.gifts.sack[0].id, third, 'the chosen gift comes to the front');
  });

  test('G13 put down, open, undo; a present for a player here waits for that player', () => {
    const game = fakeGame();
    install(game);
    game.events.emit('game:ready');
    const E = game.entities;
    game.gifts.wrap({ inside: 'unicorn', box: 'round' }, '');
    tick(game, 0.05);
    assert.ok(game.gifts.putDown(), 'put down in front of her');
    const box = E.all().find((e) => e.key === 'gift_box');
    assert.ok(box);
    assert.deepEqual(Object.keys(box.data).sort(), ['bow', 'box', 'from', 'inside', 'open', 'paper', 'pattern', 'ribbon', 'to']);
    assert.equal(box.data.from, 'Lily');
    assert.equal(box.data.open, 0);
    assert.equal(game.profile.gifts.sack.length, 0);
    assert.equal(game.coins.got.length, 1);
    // undo: the present goes and the gift comes back to her shelf
    game.undo();
    assert.equal(E.all().filter((e) => e.key === 'gift_box').length, 0);
    assert.equal(game.profile.gifts.sack.length, 1);
    // tap the floor with the gift (the Bag item's use)
    game.gifts.hold();
    const placed = game.registry.items.get('gift:hand').use(game, { place: [3, 0, 3] });
    assert.ok(placed);
    const p = E.all().find((e) => e.key === 'gift_box');
    assert.deepEqual([p.x, p.y, p.z], [3, 0, 3]);
    // open it: confetti, the toy to her Bag, "A Unicorn Plush! From Lily!"
    assert.ok(E.run(p));
    assert.equal(p.data.open, 1);
    assert.equal(game.profile.gifts.toys.unicorn, 1);
    assert.equal(game.registry.items.get('furn:gift_toy_unicorn').hidden, false, 'the toy is in her Bag');
    assert.match(game.toasts.find((t) => t.key === 'gift-open').text, /Unicorn Plush! From Lily!/);
    assert.ok(game.events.log.some(([n]) => n === 'gift:open'));
    tick(game, 1.2); // the toy pops up and settles
    assert.equal(p._gift, null);
    assert.ok(E.run(p), 'tapping an open present hops the toy');
    // undo after it was opened: the present stays, nothing comes back
    game.undo();
    // a treat present: into the basket
    const t = E.place('gift_box', 5, 0, 5, 0, null, D.giftData({ inside: 't:cupcake', from: 'Sam' }));
    const before = game.profile.basket.cupcake | 0;
    E.run(t);
    assert.equal(game.profile.basket.cupcake, before + 1);
    assert.match(game.toasts.at(-1).text, /treat from Sam/);
    // the Bag's Surprise Present: a random wrapped toy from her
    const sp = game.registry.items.get('furn:gift_box').use(game, { place: [7, 0, 7] });
    assert.ok(sp);
    const s = E.all().find((e) => e.x === 7);
    assert.equal(s.data.from, 'Lily');
    assert.ok(D.toy(s.data.inside));
  });

  test('G13 a guest: a present tagged for another player only wiggles; no tree re-wrap', () => {
    const game = fakeGame({ guest: true });
    install(game);
    game.events.emit('game:ready');
    const E = game.entities;
    const forSam = E.place('gift_box', 1, 0, 1, 0, null, D.giftData({ inside: 'car', to: 'Sam', from: 'Lily' }));
    assert.ok(E.run(forSam));
    assert.equal(forSam.data.open, 0, 'Sam opens it, not her');
    const forMe = E.place('gift_box', 2, 0, 1, 0, null, D.giftData({ inside: 'car', to: 'Lily', from: 'Sam' }));
    E.run(forMe);
    assert.equal(forMe.data.open, 1);
    assert.match(game.toasts.at(-1).text, /Race Car! From Sam!/);
    const tree = E.place('gift_box', 3, 0, 1, 0, null, D.giftData(D.treeGift(42, 3, 0), { tree: 1, open: 1 }));
    game.events.emit('time:morning', { day: 4 });
    assert.equal(tree.data.open, 1, 'only the host re-wraps the tree');
    assert.deepEqual(game.gifts.wrap({ inside: 'ball' }, 'Sam').from, 'Lily', 'the From: is her name in the room');
  });

  test('G13 world features: the Workshop and presents round the tree, wrapped again each day', () => {
    const game = fakeGame();
    install(game);
    game.events.emit('game:ready');
    const E = game.entities;
    E.blocked.add('10,0,10');
    assert.equal(game.worldFeatures.run(game.world, [{ kind: 'holiday:workshop', x: 10, y: 0, z: 10, rot: 1 }]), 1, 'moves over when its cell is taken');
    const bench = E.all().find((e) => e.key === 'gift_workshop');
    assert.ok(bench);
    assert.ok(E.actions.get('gift-workshop').hint(game, bench));
    assert.equal(E.run(bench), false, 'no panel without a UI');
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) E.blocked.add(`${x},0,${z}`); // the trunk
    assert.equal(game.worldFeatures.run(game.world, [{ kind: 'holiday:presents', x: 0, y: 0, z: 0, n: 6 }]), 1);
    const tree = E.all().filter((e) => e.key === 'gift_box');
    assert.equal(tree.length, 6);
    for (const p of tree) {
      assert.equal(p.data.tree, 1);
      assert.equal(p.data.from, D.TREE_FROM);
      assert.ok(Buffer.byteLength(JSON.stringify(p.data)) <= 600);
    }
    assert.equal(new Set(tree.map((p) => p.data.inside)).size, 6, 'six different toys');
    E.run(tree[0]);
    E.run(tree[1]);
    assert.match(game.toasts.find((t) => t.key === 'gift-open').text, /From the Holiday Tree!/);
    assert.equal(game.debug.gifts.state().tree.filter((t) => t.open).length, 2);
    game.time.day = 4;
    game.events.emit('time:morning', { day: 4 });
    assert.equal(tree.filter((p) => p.data.open).length, 0, 'wrapped again the next morning');
    assert.deepEqual(tree[0].data, D.giftData(D.treeGift(42, 4, 0), { tree: 1 }));
    // a saved world from an older day re-wraps on load
    E.run(tree[2]);
    const saved = game.systems.find((s) => s.name === 'gifts').serialize();
    assert.deepEqual(saved, { v: 1, day: 4 });
    game.systems.find((s) => s.name === 'gifts').deserialize(saved);
    game.time.day = 6;
    game.events.emit('world:load');
    assert.equal(tree[2].data.open, 0);
    // records with their own spots, and a count out of range
    const n0 = E.all().length;
    game.worldFeatures.run(game.world, [{ kind: 'holiday:presents', x: 20, y: 0, z: 20, n: 50, spots: [[20, 0, 22], [22, 0, 20], ['x', 0, 0]] }]);
    assert.equal(E.all().length - n0, 2, 'bad spots are skipped');
  });
});

// ---------------- G14 the Workshop panel ----------------

describe('gifts: the Workshop panel (G14)', () => {
  const warn = console.warn;
  test('G14 every step, Surprise me!, Wrap it!, the tag, Done', () => {
    console.warn = () => {}; // the stage has no WebGL here: the thumbnail stands in
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const game = fakeGame({ ui: true });
      install(game);
      game.events.emit('game:ready');
      const ui = game.ui;
      const P = game.debug.gifts.panel;
      assert.ok(ui.panels.has('gift-workshop'));
      assert.ok(game.gifts.openWorkshop());
      assert.equal(ui.current, 'gift-workshop');
      const body = ui.panels.get('gift-workshop').container;
      const tiles = () => body.querySelectorAll('.gf-tile');
      const buttons = () => body.querySelector('.gf-btns').querySelectorAll('.sw-btn');
      const btn = (text) => buttons().find((b) => b.textContent.includes(text));
      assert.equal(P.state().step, 0);
      assert.equal(P.state().live, false);
      assert.ok(body.querySelector('.gf-fall'), 'the thumbnail stands in for the stage');
      // step 1: 16 toys and the cupcakes from her basket
      assert.equal(tiles().length, D.TOYS.length + 1);
      tiles().find((t) => t.textContent.includes('Robot')).click();
      assert.equal(P.state().spec.inside, 'robot');
      assert.ok(tiles().find((t) => t.textContent.includes('Robot')).classList.contains('gf-sel'));
      btn('Next').click();
      // step 2: three boxes
      assert.equal(P.state().step, 1);
      assert.equal(tiles().length, 3);
      tiles()[2].click();
      assert.equal(P.state().spec.box, 'round');
      btn('Next').click();
      // step 3: 8 colors and 6 patterns
      assert.equal(tiles().length, 8 + 6);
      tiles()[4].click();
      assert.equal(P.state().spec.paper, 'pink');
      tiles()[8 + 4].click();
      assert.equal(P.state().spec.pattern, 'hearts');
      btn('Next').click();
      // step 4: ribbons and bows
      assert.equal(tiles().length, D.RIBBONS.length + 3);
      tiles()[2].click();
      tiles()[D.RIBBONS.length + 1].click();
      assert.equal(P.state().spec.ribbon, 'white');
      assert.equal(P.state().spec.bow, 'puff');
      // Back, Surprise me! (keeps the toy after step 1), and the step bar
      btn('Back').click();
      assert.equal(P.state().step, 2);
      btn('Surprise').click();
      assert.equal(P.state().spec.inside, 'robot', 'Surprise me! keeps the chosen toy');
      body.querySelector('.gf-steps').querySelectorAll('button')[3].click();
      assert.equal(P.state().step, 3);
      const look = P.state().spec;
      // Wrap it! -> the wrapping moment -> "Who is it for?"
      btn('Wrap').click();
      assert.equal(P.state().phase, 'wrapping');
      assert.equal(buttons().length, 0, 'no buttons while wrapping');
      mock.timers.tick(D.WRAP_SECONDS * 1000 + 450);
      assert.equal(P.state().phase, 'who');
      assert.ok(body.querySelector('.gf-stage').classList.contains('gf-ready'), 'rays behind the finished gift');
      assert.ok(body.querySelectorAll('.gf-confetti').length > 0, 'confetti');
      // the To: tiles: Anyone, Mia, Leo
      const who = tiles().map((t) => t.textContent);
      assert.deepEqual(who, ['Anyone', 'Mia', 'Leo']);
      assert.match(body.querySelector('.gf-tag').textContent, /To: Anyone.*From: Lily/);
      tiles()[1].click();
      assert.match(body.querySelector('.gf-tag').textContent, /To: Mia/);
      btn('Done').click();
      assert.equal(ui.current, null, 'Done closes the panel');
      const s = game.profile.gifts.sack;
      assert.equal(s.length, 1);
      assert.equal(s[0].to, 'Mia');
      assert.deepEqual([s[0].inside, s[0].box, s[0].paper, s[0].pattern, s[0].ribbon, s[0].bow], [look.inside, look.box, look.paper, look.pattern, look.ribbon, look.bow]);
      assert.equal(game.hotbar.slots[game.hotbar.index], 'gift:hand', 'in her hands');
      assert.match(ui.toasts.at(-1).text, /Tap Mia to give your gift!/);
      // open again: it starts from her last gift, and shows her shelf
      game.gifts.openWorkshop();
      assert.equal(P.state().spec.inside, 'robot');
      assert.equal(P.state().phase, 'choose');
      const shelf = body.querySelector('.gf-shelf');
      assert.equal(shelf.hidden, false);
      assert.equal(shelf.querySelectorAll('.gf-tile').length, 1);
      // closing mid-wrap keeps the gift (for Anyone)
      P.step(3);
      P.wrap();
      mock.timers.tick(1000);
      ui.close();
      assert.equal(game.profile.gifts.sack.length, 2);
      assert.equal(game.profile.gifts.sack[0].to, '', 'wrapped for Anyone, and in her hands');
      mock.timers.tick(5000);
      assert.equal(game.profile.gifts.sack.length, 2, 'the timeline stopped with the panel');
      // a shelf gift: tap it to hold it
      game.gifts.openWorkshop();
      assert.equal(game.profile.gifts.sack[0].to, '', 'the newest gift is the one in her hands');
      body.querySelector('.gf-shelf').querySelectorAll('.gf-tile').find((t) => t.textContent.includes('To: Mia')).click();
      assert.equal(ui.current, null);
      assert.equal(game.profile.gifts.sack[0].to, 'Mia', 'the tapped gift goes in her hands');
      // a full shelf: Wrap it! is off, the panel says why
      for (let i = 0; i < 6; i++) game.gifts.wrap({ inside: 'ball' }, '');
      game.gifts.openWorkshop();
      assert.ok(body.querySelector('.gf-full'));
      P.step(3);
      assert.equal(btn('Wrap').disabled, true);
      P.wrap();
      assert.equal(P.state().phase, 'choose');
      ui.close();
      // the basket changed while the panel is closed: nothing breaks
      game.events.emit('basket:change', {});
    } finally {
      mock.timers.reset();
      console.warn = warn;
    }
  });
});

// ---------------- G15 friends' lines ----------------

describe('gifts: friends say thank you (G15)', () => {
  test('G15 girl and boy lines, {toy} and {to} filled', () => {
    const game = { profile: { look: { name: 'Lily' } } };
    const girl = { name: 'Mia', def: { kind: 'girl', lines: [] }, recent: [] };
    const boy = { name: 'Leo', def: { kind: 'boy', lines: [] }, recent: [] };
    for (let i = 0; i < 20; i++) {
      const g = pickLine(game, girl, 'gift', { toy: 'robot' });
      assert.ok(LINES.gift.map((l) => l.replace('{toy}', 'robot').replace('{name}', 'Lily')).includes(g), g);
      assert.doesNotMatch(g, /\{/);
      const b = pickLine(game, boy, 'gift', { toy: 'kite' });
      assert.ok(LINES_BOY.gift.map((l) => l.replace('{toy}', 'kite').replace('{name}', 'Lily')).includes(b), b);
      const o = pickLine(game, girl, 'giftOther', { to: 'Sam' });
      assert.match(o, /Sam/);
      assert.doesNotMatch(o, /\{/);
    }
    assert.match(pickLine(game, girl, 'giftAsk'), /!/);
    assert.match(pickLine(game, girl, 'event:gift:open'), /./);
    assert.doesNotMatch(pickLine(game, girl, 'gift'), /\{/, 'no {toy} left without a toy');
  });
});
