// Holiday looks (docs/teams/holiday-looks.md "How to test"): the look lists, the look codec,
// the ready-made holiday looks, the Dress-Up booth's rules, the friends' holiday outfits, the
// avatar parts, the booth model and the stickers. Node only, no browser, a few seconds:
//   node tools/test-holiday-looks.mjs                 (npm run test:holiday-looks once wired)
//   node tools/test-holiday-looks.mjs --shots=<dir>   also writes pictures of the looks and the
//                                                     booth (software renderer, read them by eye)
//
// tools/fixtures/holiday-looks-golden.json was recorded from the wave-5 base commit (3b1bf3f)
// BEFORE holiday-looks changed anything. Never edit it: it proves that every look a child had
// before still decodes exactly the same and that the seeded surprises did not move.

import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from '../src/player/wardrobe-data.js';
import * as codec from '../src/net/codec.js';
import { mulberry32 } from '../src/core/util.js';
import * as R from '../src/player/holiday/rules.js';
import * as FL from '../src/things/friends/looks.js';

// a tiny fake canvas (every 2D call accepted, nothing drawn) for the texture painter
const fakeGrad = { addColorStop() {} };
const fakeCtx = new Proxy({}, {
  get: (o, k) => (k in o ? o[k] : () => fakeGrad),
  set: (o, k, v) => { o[k] = v; return true; },
});
globalThis.document = globalThis.document || {
  createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx, style: {} }),
};
const { paintCloth } = await import('../src/player/avatar/textures.js');
const { createAvatar } = await import('../src/player/avatar.js');
const { lookTriangles, renderLooks, renderGrid, renderObject } = await import('./lib/holiday-lookview.mjs');
const { holidayBooth, BOOTH_COLORS, BOOTH_COLLIDERS, BOOTH_SIZE } = await import('../src/player/holiday/booth.js');
const { HOLIDAY_STICKERS } = await import('../src/player/holiday/stickers.js');
const { picture } = await import('../src/ui/dressup/pictures.js');
const { scanText, scanCharacters, scanFiles, EXTRA_SCOPE } = await import('./lib/name-scan.mjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLD = JSON.parse(readFileSync(path.join(ROOT, 'tools/fixtures/holiday-looks-golden.json'), 'utf8'));
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice(8)) : null;

let passed = 0, failures = 0;
function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}
async function test(name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    passed++;
    console.log(`  ok   ${name} (${Date.now() - t0} ms)${info ? ' - ' + info : ''}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fnv = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};
const LISTS = Object.keys(GOLD.keys);
const NEW = {
  TOPS: ['santa_coat', 'elf_tunic', 'holiday_sweater'],
  BOTTOMS: ['santa_pants', 'holiday_tights'],
  DRESSES: ['santa_dress', 'elf_dress'],
  SHOES: ['santa_boots', 'elf_shoes'],
  HEAD_ACC: ['santa_hat', 'elf_hat', 'antlers', 'elf_ears'],
  FACE_ACC: ['beard'],
  BACK_ACC: ['toy_sack'],
  HAND_ACC: ['candy_cane', 'present'],
  PATTERNS: ['snowflakes', 'trees', 'candy'],
};

console.log('holiday looks');

await test('L1 every look list only grew at its end, by exactly the holiday pieces; every list < 36', () => {
  let added = 0;
  for (const k of LISTS) {
    const now = W[k].map((o) => o.key);
    const old = GOLD.keys[k];
    assert(eq(now.slice(0, old.length), old), `${k} changed before its end`);
    assert(eq(now.slice(old.length), NEW[k] || []), `${k} appended ${now.slice(old.length)}`);
    for (const o of W[k].slice(old.length)) {
      assert(o.season === 'holiday', `${k}.${o.key} is seasonal`);
      assert(o.tag === 'gb' || (k === 'DRESSES' && o.tag === 'g'), `${k}.${o.key} is free for anyone (tag ${o.tag})`);
      assert(typeof o.name === 'string' && o.name.length > 2, `${k}.${o.key} has a name`);
      added++;
    }
    assert(now.length < 36, `${k} has ${now.length} entries (one base-36 digit)`);
    assert(new Set(now).size === now.length, `${k} keys are unique`);
  }
  return `${added} pieces appended`;
});

await test('L2 every old look string decodes exactly as before (257 goldens)', () => {
  assert(GOLD.tokens.length === GOLD.decoded.length && GOLD.tokens.length >= 250, 'fixture size');
  let bad = [];
  GOLD.tokens.forEach((t, i) => {
    if (fnv(JSON.stringify(codec.unpackLook(t, 'Zoe'))) !== GOLD.decoded[i]) bad.push(i);
  });
  assert(!bad.length, 'changed: ' + bad.slice(0, 8).join(', '));
  // and every one of them packs back to a string no longer than 160
  const max = Math.max(...GOLD.tokens.map((t) => codec.packLook(codec.unpackLook(t, 'Zoe')).length));
  assert(max <= 160, 'repacked ' + max);
  return `${GOLD.tokens.length} strings, longest repack ${max}`;
});

await test('L3 the seeded surprise looks did not move (holiday pieces never come up by themselves)', () => {
  const got = [];
  for (const style of ['girl', 'boy', 'mix']) for (let s = 1; s <= 20; s++) got.push(fnv(JSON.stringify(W.randomLook(mulberry32(s), 'Zoe', null, style))));
  assert(eq(got, GOLD.randoms), 'seeded randomLook changed');
  // and none of 6,000 surprises wears anything seasonal
  const rnd = mulberry32(11);
  for (const style of ['girl', 'boy', 'mix']) {
    for (let i = 0; i < 2000; i++) assert(!W.wearsHoliday(W.randomLook(rnd, 'Zoe', null, style)), `${style} surprise ${i} wears a holiday piece`);
  }
  for (const k of LISTS) for (const l of ['g', 'b']) assert(W.tagged(W[k], l).every((o) => !o.season), `tagged(${k}) skips seasonal`);
  return '60 seeds, 6000 surprises';
});

await test('L4 the ready-made row and the friends\' Dress up bubble are unchanged', () => {
  assert(eq(W.STARTER_OUTFITS.map((o) => o.key), GOLD.starters), 'STARTER_OUTFITS');
  const keys = FL.OUTFITS.map((o) => o.key);
  assert(eq(keys.slice(0, GOLD.friendOutfits.length), GOLD.friendOutfits), 'friend OUTFITS only appended');
  for (const o of FL.OUTFITS.slice(GOLD.friendOutfits.length)) assert(o.tag === 'h' && o.key.startsWith('hl_'), `appended ${o.key} is a holiday outfit`);
  assert(FL.outfitsFor({ kind: 'boy' }).length === 6 && FL.outfitsFor({ kind: 'girl' }).length === 8, 'bubble counts 6 / 8');
  assert(FL.outfitsFor({ kind: 'girl' }).every((o) => o.tag !== 'h'), 'no holiday outfit on the bubble');
  return `${keys.length - GOLD.friendOutfits.length} friend holiday outfits appended`;
});

await test('C1 every holiday piece round-trips through the look codec; the worst case stays 156 <= 160', () => {
  let n = 0, max = 0;
  const base = W.normalizeLook({ ...W.DEFAULT_LOOK, name: 'Mia' });
  const slots = { TOPS: 'top', BOTTOMS: 'bottom', DRESSES: 'dress', SHOES: 'shoes', HEAD_ACC: 'head', FACE_ACC: 'face', BACK_ACC: 'back', HAND_ACC: 'hand', PATTERNS: 'pattern' };
  for (const [list, keys] of Object.entries(NEW)) {
    for (const key of keys) {
      for (const color of ['#E5383B', '#FFFFFF']) {
        const l = W.cloneLook(base);
        const s = slots[list];
        if (s === 'top' || s === 'bottom') l[s] = { ...l[s], type: key, color };
        else if (s === 'dress') l.dress = { type: key, color, pattern: 'snowflakes', patternColor: '#FFFFFF' };
        else if (s === 'shoes') l.shoes = { type: key, color };
        else if (s === 'pattern') l.top = { ...l.top, pattern: key, patternColor: color };
        else { l.acc[s] = key; l.acc[s + 'Color'] = color; }
        const L = W.normalizeLook(l);
        const p = codec.packLook(L);
        max = Math.max(max, p.length);
        assert(eq(codec.unpackLook(p, 'Mia'), L), `round trip ${list}.${key}`);
        n++;
      }
    }
  }
  // the worst case with holiday pieces: every optional color, a dress, number 99, a sea dragon
  const worst = W.normalizeLook({
    ...W.DEFAULT_LOOK, name: 'Mia',
    hair: { style: 'afro', color: '#FFFFFF', color2: '#FFFFFF', mix: 'tips' },
    top: { type: 'holiday_sweater', color: '#FFFFFF', pattern: 'candy', patternColor: '#FFFFFF', num: 99 },
    bottom: { type: 'holiday_tights', color: '#FFFFFF', pattern: 'candy', patternColor: '#FFFFFF' },
    dress: { type: 'elf_dress', color: '#FFFFFF', pattern: 'candy', patternColor: '#FFFFFF' },
    shoes: { type: 'elf_shoes', color: '#FFFFFF' },
    acc: { head: 'elf_ears', headColor: '#FFFFFF', face: 'beard', faceColor: '#FFFFFF', back: 'toy_sack', backColor: '#FFFFFF', neck: 'medal', neckColor: '#FFFFFF', hand: 'present', handColor: '#FFFFFF' },
    sea: { form: 'sea_dragon', color: '#E6DDFF' },
  });
  const wl = codec.packLook(worst).length;
  assert(wl <= 160 && wl === 156, 'worst case ' + wl);
  assert(eq(codec.unpackLook(codec.packLook(worst), 'Mia'), worst), 'worst round trip');
  // the holiday looks on any starter, and on 1,000 surprises per style
  const rnd = mulberry32(5);
  for (const o of W.HOLIDAY_OUTFITS) {
    for (const s of ['girl', 'boy', 'mix']) {
      for (let i = 0; i < 1000; i++) {
        const l = W.applyOutfit(W.randomLook(rnd, 'Zoe', null, s), o);
        l.sea = { form: W.SEA_FORMS[Math.floor(rnd() * W.SEA_FORMS.length)].key, color: rnd() < 0.3 ? null : W.SEA_COLORS[Math.floor(rnd() * W.SEA_COLORS.length)] };
        const p = codec.packLook(l);
        max = Math.max(max, p.length);
        assert(p.length <= 160, `${o.key} on a surprise: ${p.length}`);
      }
    }
  }
  return `${n} pieces, worst ${wl}, longest holiday string ${max}`;
});

await test('O1 the holiday ready-made looks normalize, pack, fit their tags and show their costume', () => {
  const keys = W.HOLIDAY_OUTFITS.map((o) => o.key);
  assert(new Set(keys).size === keys.length, 'unique keys');
  assert(['santa', 'elf', 'elf_girl', 'mrs_santa'].every((k) => keys.includes(k)), 'Santa and Elf, girl and boy versions');
  for (const o of W.HOLIDAY_OUTFITS) {
    assert(!o.hairStyle && !o.hair && !o.face && !o.eyes, `${o.key} never changes who she is`);
    for (const start of [W.DEFAULT_LOOK, ...W.STARTER_OUTFITS.map((s) => W.applyOutfit(W.DEFAULT_LOOK, s))]) {
      const l = W.applyOutfit(start, o);
      assert(eq(W.normalizeLook(l), l), `${o.key} is normalized`);
      assert(eq(codec.unpackLook(codec.packLook(l), l.name), l), `${o.key} round-trips`);
      assert(W.wearsHoliday(l), `${o.key} wears holiday pieces`);
      assert(l.hair.style === W.normalizeLook(start).hair.style && l.skin === W.normalizeLook(start).skin, `${o.key} keeps hair and skin`);
    }
    const plain = W.applyOutfit(W.DEFAULT_LOOK, o);
    for (const letter of o.tag.split('')) {
      const hair = letter === 'b' ? 'buzz' : 'long';
      assert(W.lookFits({ ...plain, hair: { ...plain.hair, style: hair } }, letter), `${o.key} fits ${letter}`);
    }
  }
  const shown = (k) => R.costumeShown(W.applyOutfit(W.DEFAULT_LOOK, W.holidayOutfit(k)));
  assert(shown('elf') === 'elf' && shown('elf_girl') === 'elf', 'elf costumes');
  assert(shown('santa') === 'santa' && shown('mrs_santa') === 'santa', 'santa costumes');
  assert(shown('cozy') === null && R.costumeShown(W.DEFAULT_LOOK) === null, 'not a costume');
  return keys.join(', ');
});

await test('B1 the booth: costume over her own clothes, Back to me, switching keeps the first own', () => {
  const me = W.applyOutfit({ ...W.DEFAULT_LOOK, name: 'Lily', hair: { style: 'braids', color: '#3B2419', color2: null, mix: 'ombre' } }, W.STARTER_OUTFITS[0]);
  me.acc.back = 'fairy_wings';
  let st = R.normState(undefined);
  assert(eq(st, R.EMPTY_STATE), 'no state');
  // be an elf
  let r = R.wearCostume(me, st, 'elf_girl');
  assert(r.look.dress.type === 'elf_dress' && r.look.acc.head === 'elf_hat' && r.look.acc.back === 'none', 'elf dress on, wings off');
  assert(eq(r.look.hair, me.hair) && r.look.name === 'Lily' && r.look.skin === me.skin, 'still her');
  assert(eq(r.state.own, R.clothesOf(me)) && r.state.wearing === 'elf_girl', 'her clothes kept');
  // then Santa: the first clothes stay kept, nothing of the elf stays hidden under the coat
  const r2 = R.wearCostume(r.look, r.state, 'santa');
  assert(eq(r2.state.own, R.clothesOf(me)), 'first own kept');
  assert(r2.look.top.type === 'santa_coat' && !r2.look.dress && r2.look.acc.face === 'beard', 'Santa on');
  // Studio change of hair while dressed up survives Back to me
  const hairDone = { ...r2.look, hair: { ...r2.look.hair, style: 'bun' } };
  const b = R.backToMe(hairDone, r2.state);
  assert(eq(R.clothesOf(b.look), R.clothesOf(me)), 'her own clothes back');
  assert(b.look.hair.style === 'bun', 'her new hair stays');
  assert(eq(b.state, R.EMPTY_STATE) && R.backToMe(b.look, b.state) === null, 'nothing kept after');
  // dressing again after she changed in the Studio takes the new clothes as her own
  const studio = W.applyOutfit(b.look, W.STARTER_OUTFITS[3]);
  const r3 = R.wearCostume(studio, R.afterOutsideChange(r2.state, studio), 'elf');
  assert(eq(r3.state.own, R.clothesOf(studio)), 'own follows the Studio');
  // a costume while wearing a holiday piece of her own (antlers from the Studio) with no state
  const antlers = { ...studio, acc: { ...studio.acc, head: 'antlers', headColor: '#8B5E3C' } };
  const r4 = R.wearCostume(antlers, R.EMPTY_STATE, 'santa');
  assert(r4.state.own.acc.head === 'antlers', 'her antlers are part of her own look');
  // still dressed up after an outside change that keeps a holiday piece; cleared otherwise
  assert(R.afterOutsideChange(r4.state, r4.look).own, 'kept');
  assert(eq(R.afterOutsideChange(r4.state, W.DEFAULT_LOOK), R.EMPTY_STATE), 'cleared');
  assert(R.wearCostume(me, st, 'nope') === null, 'unknown costume');
  return 'elf, santa, back, studio';
});

await test('B2 the booth state reads safely and its buttons follow her side', () => {
  for (const bad of [null, 7, 'x', [], { own: 5 }, { own: { top: 'x' }, wearing: 'zzz' }, { v: 9, wearing: 3 }]) {
    const s = R.normState(bad);
    assert(s.v === 1 && (s.own === null || typeof s.own === 'object') && s.wearing === null, 'odd state ' + JSON.stringify(bad));
  }
  const kept = R.normState({ own: R.clothesOf(W.DEFAULT_LOOK), wearing: 'santa' });
  assert(eq(kept.own, R.clothesOf(W.DEFAULT_LOOK)) && kept.wearing === 'santa', 'a good state survives');
  const ids = (side, s) => R.buttonsFor(side, s).map((b) => b.id).join(',');
  assert(ids('g', null) === 'elf,santa,santa_dress,me', 'girl buttons');
  assert(ids('b', null) === 'elf,santa,me' && ids('n', null) === 'elf,santa,me', 'boy buttons');
  const g = R.buttonsFor('g', kept), b = R.buttonsFor('b', null);
  assert(g.find((x) => x.id === 'elf').outfit === 'elf_girl' && b.find((x) => x.id === 'elf').outfit === 'elf', 'elf by side');
  assert(g.find((x) => x.id === 'santa').on && !g.find((x) => x.id === 'me').off, 'lit and enabled');
  assert(b.find((x) => x.id === 'me').off, 'Back to me off with nothing kept');
  assert(R.sideFor(W.DEFAULT_LOOK, null) === 'g' && R.sideFor(W.DEFAULT_LOOK, 'boy') === 'b', 'side by style');
  const boy = W.applyOutfit({ ...W.DEFAULT_LOOK, hair: { ...W.DEFAULT_LOOK.hair, style: 'buzz' } }, W.STARTER_OUTFITS.find((o) => o.tag === 'b'));
  assert(R.lookLean(boy) === 'b', 'a boy look leans boy');
  for (const o of W.STARTER_OUTFITS) {
    const l = W.applyOutfit(W.DEFAULT_LOOK, o);
    const hair = o.tag === 'b' ? 'spiky' : 'pigtails';
    assert(R.lookLean({ ...l, hair: { ...l.hair, style: hair } }) === o.tag, `starter ${o.key} leans ${o.tag}`);
  }
  for (const k of Object.values(R.COSTUMES).flatMap((c) => Object.values(c))) assert(W.holidayOutfit(k), 'costume ' + k);
  return 'states, buttons, sides';
});

await test('B3 the module on a stand-in game: booth, feature, costume, Undo, Back to me, friends, stickers', async () => {
  const { install } = await import('../src/player/holiday/index.js');
  const { Emitter } = await import('../src/core/events.js');
  const events = new Emitter();
  const history = [], placed = [], defs = new Map(), actions = new Map(), features = new Map(), systems = [];
  const awarded = [], emitted = [], timers = [];
  for (const ev of ['avatar:changed', 'outfit:changed', 'holidaylook:wear', 'holidaylook:back']) events.on(ev, (p) => emitted.push(ev));
  const player = { position: { x: 1, y: 2, z: 3, clone() { return { ...this }; } }, state: 'walk', emote() {} };
  const friends = { remote: false, friends: [], styled: [], style(f, how, key) { this.styled.push([f.key, how, key]); return true; } };
  const game = {
    events, profile: { look: W.normalizeLook({ ...W.DEFAULT_LOOK, name: 'Lily' }) }, debug: {}, ui: null, mode: 'play', player, friends,
    world: { meta: { biome: 'holiday' } }, net: null,
    saveProfile() {}, pushHistory: (e) => history.push(e), celebrate() {}, audio: { play() {} }, toast() {},
    registry: { stickers: new Map() }, stickers: { has: (id) => awarded.includes(id) }, award: (id) => { awarded.push(id); return true; },
    addSystem: (sys) => systems.push(sys),
    entities: {
      define: (d) => defs.set(d.key, d), registerAction: (n, h) => actions.set(n, h), byUid: () => null,
      place: (...a) => { placed.push(a); return {}; },
    },
    worldFeatures: { on: (k, fn) => features.set(k, fn), placeOpts: (x) => ({ history: false, ...(x || {}) }) },
  };
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { timers.push(fn); return 0; };
  try {
    install(game);
    events.emit('game:ready');
    assert(defs.get('holiday_booth').category === 'holiday' && actions.has('holiday_booth'), 'booth defined');
    assert(actions.get('holiday_booth').hint() === 'Tap to dress up!', 'hint');
    assert(systems.some((s) => s.name === 'holiday-looks') && game.holidayLooks && game.debug.holidayLooks, 'system, facade, debug');
    assert(game.registry.stickers.has('look_elf') && game.registry.stickers.has('look_santa'), 'stickers registered');
    assert(features.get('holiday:dressup')(game, { kind: 'holiday:dressup', x: 4, y: 5, z: 6, rot: 2 }) === true, 'feature placed');
    assert(eq(placed[0].slice(0, 5), ['holiday_booth', 4, 5, 6, 2]), 'at the record');
    const mine = W.cloneLook(game.profile.look);
    assert(game.holidayLooks.dress('elf') && game.profile.look.dress.type === 'elf_dress', 'girl side elf');
    assert(awarded.includes('look_elf') && history.length === 1, 'sticker and one Undo step');
    assert(emitted.filter((e) => e === 'avatar:changed').length === 1 && emitted.includes('holidaylook:wear'), 'look sent once');
    assert(game.holidayLooks.dress('santa') && game.profile.look.top.type === 'santa_coat' && awarded.includes('look_santa'), 'santa');
    history.pop().undo(); // back to the elf
    assert(game.profile.look.dress && game.profile.look.dress.type === 'elf_dress', 'Undo took Santa back');
    assert(game.holidayLooks.back() && eq(R.clothesOf(game.profile.look), R.clothesOf(mine)), 'Back to me');
    assert(eq(game.holidayLooks.state(), R.EMPTY_STATE) && !game.holidayLooks.back(), 'nothing kept');
    // an Undo after she changed in the Studio does nothing
    game.holidayLooks.dress('santa');
    const studio = W.applyOutfit(game.profile.look, W.STARTER_OUTFITS[2]);
    game.profile.look = studio;
    events.emit('outfit:changed', { look: studio });
    assert(eq(game.holidayLooks.state(), R.EMPTY_STATE), 'the Studio change cleared the booth state');
    assert(history.pop().undo() === false && eq(game.profile.look, studio), 'Undo kept the Studio look');
    // a friend arriving in Holiday Village (after the hello line), not on a guest, not elsewhere
    const zoe = { key: 'zoe', def: FL.friendDef('zoe') };
    friends.friends.push(zoe);
    events.emit('friend:invite', { friend: zoe });
    timers.splice(0).forEach((fn) => fn());
    assert(eq(friends.styled, [['zoe', 'outfit', R.friendHolidayKey(zoe.def)]]), 'zoe dressed up');
    game.world = { meta: { biome: 'meadow' } };
    events.emit('friend:invite', { friend: zoe });
    game.world = { meta: { biome: 'holiday' } };
    game.net = { isGuest: true };
    events.emit('friend:invite', { friend: zoe });
    timers.splice(0).forEach((fn) => fn());
    assert(friends.styled.length === 1, 'only in Holiday Village, only on the host');
    systems.find((s) => s.name === 'holiday-looks').update(0.016);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
  return `${emitted.length} events, stickers ${awarded.join(' ')}`;
});

await test('F1 every friend has a holiday outfit of their kind that dresses them up', () => {
  const seen = new Set();
  for (const f of FL.FRIENDS) {
    const key = R.friendHolidayKey(f);
    const o = FL.OUTFITS.find((x) => x.key === key);
    assert(o && o.tag === 'h', `${f.key}: ${key}`);
    assert((f.kind === 'boy' ? R.FRIEND_HOLIDAY.boy : R.FRIEND_HOLIDAY.girl).includes(key), `${f.key} gets a ${f.kind} outfit`);
    const look = FL.wearOutfit(f.look, key);
    assert(W.wearsHoliday(look), `${f.key} is dressed up`);
    assert(look.hair.style === f.look.hair.style && look.skin === f.look.skin && look.name === W.normalizeLook(f.look).name, `${f.key} stays ${f.name}`);
    assert(codec.packLook(look).length <= 160, `${f.key} packs`);
    seen.add(key);
  }
  for (const k of [...R.FRIEND_HOLIDAY.girl, ...R.FRIEND_HOLIDAY.boy]) assert(FL.OUTFITS.some((o) => o.key === k), 'outfit ' + k);
  assert(R.friendHolidayKey({ key: 'someone_new', kind: 'boy' }), 'a later friend gets one too');
  assert(R.isHolidayWorld({ meta: { biome: 'holiday' } }) && !R.isHolidayWorld({ meta: { biome: 'meadow' } }) && !R.isHolidayWorld(null), 'Holiday Village');
  return `${FL.FRIENDS.length} friends, ${seen.size} different outfits`;
});

await test('A1 every holiday piece builds on the avatar (every hair style under the hats)', () => {
  const base = lookTriangles(W.DEFAULT_LOOK).tris.length;
  let n = 0;
  for (const o of W.HOLIDAY_OUTFITS) {
    const t = lookTriangles(W.applyOutfit(W.DEFAULT_LOOK, o)).tris;
    assert(t.length > base * 0.8 && t.every((x) => x.p.every(Number.isFinite)), `${o.key} builds`);
    n++;
  }
  for (const head of NEW.HEAD_ACC) {
    for (const h of W.HAIR_STYLES) {
      const l = W.normalizeLook({ ...W.DEFAULT_LOOK, hair: { ...W.DEFAULT_LOOK.hair, style: h.key }, acc: { ...W.DEFAULT_LOOK.acc, head, face: 'beard', back: 'toy_sack', hand: 'present' } });
      const t = lookTriangles(l).tris;
      assert(t.length > base && t.every((x) => x.p.every(Number.isFinite)), `${head} on ${h.key}`);
      n++;
    }
  }
  for (const [list, keys] of Object.entries(NEW)) {
    for (const key of keys) {
      const l = W.cloneLook(W.DEFAULT_LOOK);
      if (list === 'TOPS') { l.top.type = key; l.dress = null; }
      else if (list === 'BOTTOMS') { l.bottom.type = key; l.dress = null; }
      else if (list === 'DRESSES') l.dress = { type: key, color: '#E5383B', pattern: 'none', patternColor: '#FFFFFF' };
      else if (list === 'SHOES') l.shoes.type = key;
      else if (list === 'HAND_ACC') l.acc.hand = key;
      else continue;
      assert(lookTriangles(l).tris.length > 0, key);
      n++;
    }
  }
  // the new cloth (velvet) and patterns paint without throwing
  for (const pattern of NEW.PATTERNS) for (const fabric of ['velvet', 'knit', 'cotton']) paintCloth(fakeCtx, 64, 64, { color: '#E5383B', pattern, patternColor: '#FFFFFF', fabric });
  return `${n} builds`;
});

await test('A2 the real avatar builds, animates and swaps every holiday look (and back)', () => {
  const av = createAvatar(W.DEFAULT_LOOK);
  let n = 0;
  const all = [...W.HOLIDAY_OUTFITS.map((o) => W.applyOutfit(W.DEFAULT_LOOK, o)), ...FL.FRIENDS.map((f) => FL.wearOutfit(f.look, R.friendHolidayKey(f)))];
  for (const l of all) {
    av.setLook(l);
    for (let i = 0; i < 5; i++) av.update(1 / 30, { speed: i * 0.8, onGround: true });
    n++;
  }
  av.setLook(W.DEFAULT_LOOK);
  av.update(1 / 30, { speed: 0, onGround: true });
  return `${n} looks`;
});

await test('M1 the booth model, its colliders, the stickers, the pictures and the names', () => {
  for (const c of BOOTH_COLORS) {
    const g = holidayBooth(c);
    let tris = 0;
    g.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3; });
    assert(tris > 500, 'booth tris ' + tris);
  }
  const [w, h, d] = BOOTH_SIZE;
  for (const b of BOOTH_COLLIDERS) assert(b[0] >= 0 && b[1] >= 0 && b[2] >= 0 && b[3] <= w && b[4] <= h && b[5] <= d && b[0] < b[3] && b[1] < b[4] && b[2] < b[5], 'collider ' + b);
  assert(HOLIDAY_STICKERS.length <= 2, 'at most 2 stickers');
  assert(eq(HOLIDAY_STICKERS.map((s) => s.id), ['look_elf', 'look_santa']), 'sticker ids');
  for (const s of HOLIDAY_STICKERS) {
    const g = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => fakeGrad), set: (o, k, v) => { o[k] = v; return true; } });
    s.art(g);
  }
  for (const p of ['holiday', 'santa', 'elf', 'santa_dress', 'my_look']) assert(picture(p) !== picture('no_such_picture'), 'picture ' + p);
  const all = [
    ...LISTS.flatMap((k) => W[k].filter((o) => o.season).map((o) => o.name)),
    ...W.HOLIDAY_OUTFITS.map((o) => o.name),
    ...FL.OUTFITS.filter((o) => o.tag === 'h').map((o) => o.name),
    ...Object.values(R.BUTTONS).map((b) => b.label),
    ...HOLIDAY_STICKERS.flatMap((s) => [s.name, s.hint]),
    'Holiday Dress-Up', 'Holiday Dress-Up!', 'Tap to dress up!', 'Holiday looks', 'You are you already!',
  ];
  for (const t of all) {
    assert(scanText(t, { extras: true }).length === 0, 'a forbidden name in: ' + t);
    assert(scanCharacters(t).length === 0, 'a famous character in: ' + t);
  }
  const hits = scanFiles(EXTRA_SCOPE, { extras: true }).filter((m) => /holiday|wardrobe|avatar|dressup|friends\/looks/.test(m.file));
  assert(hits.length === 0, hits.map((m) => `${m.file}:${m.line}`).join(', '));
  return `${all.length} strings`;
});

if (SHOTS) {
  await test('S1 pictures written', () => {
    mkdirSync(SHOTS, { recursive: true });
    const looks = W.HOLIDAY_OUTFITS.map((o) => W.applyOutfit(W.DEFAULT_LOOK, o));
    renderLooks(path.join(SHOTS, 'holiday-looks.png'), looks, { cell: 200 });
    renderGrid(path.join(SHOTS, 'holiday-friends.png'), FL.FRIENDS.map((f) => FL.wearOutfit(f.look, R.friendHolidayKey(f))), { cols: 8, yaw: 0.35, frame: 'full', cell: 130 });
    const heads = [];
    for (const style of ['long', 'short', 'afro', 'space_buns']) {
      for (const head of NEW.HEAD_ACC) heads.push(W.normalizeLook({ ...W.DEFAULT_LOOK, hair: { ...W.DEFAULT_LOOK.hair, style }, acc: { ...W.DEFAULT_LOOK.acc, head, headColor: W.HOLIDAY_RED, face: head === 'santa_hat' ? 'beard' : 'none' } }));
    }
    renderGrid(path.join(SHOTS, 'holiday-heads.png'), heads, { cols: 4, yaw: 0.45, frame: 'head', cell: 200 });
    renderObject(path.join(SHOTS, 'holiday-booth.png'), holidayBooth(), { center: [1, 1.5, 0.5], span: 3.4, yaws: [0, 0.55, -0.7, Math.PI / 2] });
    return SHOTS;
  });
}

console.log(`\n${passed} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
