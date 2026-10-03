// Boys probe (docs/teams/boys.md §11.1): boy looks, the Girl / Boy / Mix surprise, the boy
// starter looks, the six boy friends, neutral words about real players, and the look codec.
// Unit checks run in Node; the Studio, world, friends and grid passes drive the real page
// (dist/sparkle-world.html, so build first: npm run probe:boys). Screenshots and avatar grids
// go to .shots/boys-*.png. Fails on any console error or failed check.
//
//   node tools/probe-boys.mjs [--only=unit|studio|touch|world|friends|grids] [--headed]

import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  launch, openGame, waitForTitle, waitForPlay, waitIdle, startWorld, shot, settle, finish, SHOTS, ROOT, parseArgs,
} from './smoke.mjs';
import * as W from '../src/player/wardrobe-data.js';
import * as codec from '../src/net/codec.js';
import * as proto from '../src/net/protocol.js';
import { sanitizeName } from '../src/net/names.js';
import { mulberry32 } from '../src/core/util.js';
import * as looks from '../src/things/friends/looks.js';

const PREFIX = 'boys';
const IPAD = { width: 1024, height: 768 };

function check(errors, cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

async function until(page, fn, arg, timeout = 20000) {
  try {
    const h = await page.waitForFunction(fn, arg, { timeout, polling: 200 });
    return await h.jsonValue();
  } catch {
    return page.evaluate(fn, arg);
  }
}

// ---------------- goldens: recorded from the code before any boy item was added ----------------

// the option lists as they were (A1: every list only grows at the end)
const OLD_KEYS = {
  HAIR_STYLES: ['long', 'ponytail', 'pigtails', 'bun', 'space_buns', 'braids', 'curly', 'bob', 'short', 'side_pony', 'wavy_long', 'pixie'],
  HAIR_MIXES: ['ombre', 'streaks', 'tips'],
  TOPS: ['tshirt', 'tank', 'hoodie', 'sweater', 'blouse', 'crop', 'jacket', 'sparkle_top'],
  BOTTOMS: ['skirt', 'tutu', 'jeans', 'leggings', 'shorts', 'overalls', 'pleated'],
  DRESSES: ['sundress', 'party', 'princess', 'ballgown', 'overall_dress', 'mermaid'],
  SHOES: ['sneakers', 'boots', 'sandals', 'sparkle', 'rainboots', 'ballet', 'roller_skates'],
  HEAD_ACC: ['none', 'bow', 'tiara', 'crown', 'flower_crown', 'cat_ears', 'bunny_ears', 'unicorn_horn', 'beanie', 'sun_hat', 'headband', 'witch_hat', 'halo'],
  FACE_ACC: ['none', 'glasses', 'sunglasses', 'heart_glasses', 'star_glasses'],
  BACK_ACC: ['none', 'fairy_wings', 'butterfly_wings', 'angel_wings', 'backpack', 'cape'],
  NECK_ACC: ['none', 'necklace', 'pearls', 'scarf', 'bowtie'],
  HAND_ACC: ['none', 'wand', 'purse', 'balloon', 'teddy', 'ice_cream'],
  PATTERNS: ['none', 'hearts', 'stars', 'stripes', 'dots', 'rainbow', 'flowers'],
  SMILES: ['happy', 'grin', 'cat', 'open'],
};
// DEFAULT_LOOK as it was (no brows, no number)
const OLD_DEFAULT_LOOK = {
  name: 'Lily', skin: '#F6D2B8', hair: { style: 'long', color: '#7A4A2A', color2: null, mix: 'ombre' },
  eyes: { color: '#5A3A28', lashes: true }, face: { blush: true, freckles: false, smile: 'happy' },
  top: { type: 'tshirt', color: '#FF8CC6', pattern: 'hearts', patternColor: '#FFFFFF' },
  bottom: { type: 'skirt', color: '#8E7CFF', pattern: 'none', patternColor: '#FFFFFF' }, dress: null,
  shoes: { type: 'sneakers', color: '#FFFFFF' },
  acc: { head: 'bow', headColor: '#FF5FA2', face: 'none', faceColor: null, back: 'none', backColor: '#B8E1FF', neck: 'none', neckColor: '#FFD54A', hand: 'none', handColor: null },
};
const OLD_DEFAULT_TOKEN = 'f6d2b8.0.7a4a2a.-.0.5a3a28.1.1.0.0.0.ff8cc6.1.ffffff.0.8e7cff.0.ffffff.-.-.-.-.0.ffffff.1.ff5fa2.0.-.0.b8e1ff.0.ffd54a.0.-';
// packLook(randomLook(mulberry32(s), 'Zoe')) for s = 1..20, before boys (A3: the Girl surprise is unchanged)
const OLD_RANDOM = [
  'f0c3a0.1.9c7bff.-.1.5a3a28.1.1.0.0.5.3a1f4d.0.ffffff.2.9c7bff.0.ffffff.3.3a1f4d.4.ffffff.3.ffffff.8.ffd54a.0.6cc6ff.0.3a1f4d.0.6cc6ff.0.6cc6ff',
  '6d4029.6.ff8cc6.-.0.8b6bd6.1.0.1.3.3.ffc9a8.0.ffffff.2.fff4e0.0.ffffff.-.-.-.-.1.ffffff.c.ffd54a.0.-.0.fff4e0.0.dde3ec.3.ff5fa2',
  '8c5535.a.d9762f.r.0.8b6bd6.1.1.0.3.3.ffc9a8.1.ffffff.1.ffd1e6.0.ffffff.-.-.-.-.4.ffd1e6.9.ff6b6b.0.-.0.ffd1e6.2.ff6b6b.0.-',
  '6d4029.6.c99a5b.-.2.3c9a64.1.1.0.3.0.ffffff.5.ff5fa2.6.6cc6ff.0.ff5fa2.-.-.-.-.2.ff5fa2.0.ffd54a.0.ff5fa2.0.6cc6ff.0.dde3ec.0.ff5fa2',
  'ffe6d8.5.ff5fa2.-.0.2fb5b0.1.1.0.1.5.222230.0.ff5fa2.3.ff5fa2.0.ff5fa2.-.-.-.-.5.ffffff.6.ff5fa2.0.6cc6ff.0.222230.0.dde3ec.0.6cc6ff',
  '8c5535.7.f7e7b7.-.1.3c9a64.1.0.0.1.7.6bd68a.6.fff4e0.6.ffe58a.6.fff4e0.0.6bd68a.6.fff4e0.0.ffffff.3.ff5fa2.0.-.3.ff5fa2.0.dde3ec.0.ff5fa2',
  'c3845a.2.c99a5b.-.1.8a6a2e.1.1.0.0.3.ff8cc6.1.fff4e0.1.b8e1ff.0.fff4e0.-.-.-.-.1.ffffff.7.dde3ec.4.-.0.9c7bff.0.9c7bff.0.-',
  'f0c3a0.1.1f1614.-.2.8b6bd6.1.1.1.2.6.a5f0e6.0.e6ddff.1.9c7bff.1.e6ddff.-.-.-.-.0.4d7cff.4.ffd54a.4.4d7cff.0.a5f0e6.0.dde3ec.0.-',
  'f0c3a0.8.c99a5b.-.1.3c9a64.1.0.0.1.2.a5f0e6.1.e6ddff.6.9c7bff.0.e6ddff.-.-.-.-.4.ffffff.b.4d7cff.0.4d7cff.5.9c7bff.0.4d7cff.1.4d7cff',
  'e4ae86.5.f7e7b7.-.2.8a6a2e.0.0.1.1.1.b8f2a0.3.ffffff.0.ffffff.0.ffffff.-.-.-.-.0.ffffff.5.ffd54a.3.ffd43b.0.ffffff.1.ffd54a.4.ffd43b',
  'a96c45.8.a0592d.-.0.2e1e14.1.1.0.2.0.b8f2a0.0.fff4e0.3.ffe58a.0.fff4e0.-.-.-.-.5.ffd43b.0.ffe58a.0.ffd43b.0.ffd43b.1.ffd43b.0.ffd43b',
  '8c5535.7.ff8cc6.-.1.e0569a.0.1.0.3.5.ffd43b.0.ffffff.3.ff8cc6.0.ffffff.4.ffd43b.0.ffffff.2.ffffff.1.ffa94d.0.ffa94d.0.ff8cc6.0.dde3ec.3.ffa94d',
  'e4ae86.6.4d7cff.-.1.2e1e14.1.1.0.1.2.6bd68a.0.ffffff.3.ff8cc6.0.ffffff.0.6bd68a.0.ffffff.2.ffffff.1.ff5fa2.0.-.3.ff5fa2.0.ffd54a.0.ff5fa2',
  'ffe6d8.1.e9eef6.-.1.3c9a64.0.1.0.1.5.6cc6ff.2.ffffff.0.ffe58a.6.ffffff.-.-.-.-.0.ffffff.1.dde3ec.0.ffd43b.0.ffd43b.1.ffd43b.0.-',
  'f0c3a0.3.a0592d.-.0.2fb5b0.0.0.0.0.7.ffd43b.0.ffffff.2.ff8cc6.0.ffffff.-.-.-.-.2.ff6b6b.0.ff6b6b.0.ff6b6b.4.ff6b6b.0.ffd54a.0.-',
  'e4ae86.4.9c7bff.c9a2ff.2.2e1e14.1.1.0.3.4.3a1f4d.0.ffd43b.1.e64980.0.ffd43b.5.3a1f4d.4.ffd43b.4.ffffff.b.ffd43b.0.-.0.3a1f4d.0.dde3ec.0.-',
  'a96c45.8.c99a5b.-.0.3f7ac9.1.1.0.2.2.3a1f4d.3.ff5fa2.3.9c7bff.0.ff5fa2.-.-.-.-.2.ffffff.0.ffd43b.0.-.1.ffd43b.1.ffd43b.5.ffd43b',
  'a96c45.1.d9762f.-.2.8b6bd6.0.1.1.3.5.ff5fa2.0.ffd1e6.1.9c7bff.0.ffd1e6.-.-.-.-.3.ffd43b.a.ffd43b.0.ffd43b.3.ff5fa2.4.ffd43b.0.-',
  'c3845a.1.ff8cc6.-.0.3f7ac9.1.1.0.0.4.ff8cc6.0.fff4e0.3.e6ddff.0.fff4e0.3.ff8cc6.2.fff4e0.5.ffffff.0.9c7bff.0.-.0.9c7bff.2.9c7bff.0.9c7bff',
  'e4ae86.1.ff5fa2.9c7bff.0.5a3a28.1.1.0.3.6.ffc9a8.6.ffffff.2.ffd1e6.0.ffffff.4.ffc9a8.0.ffffff.1.ff6b6b.7.ff6b6b.1.-.5.ff6b6b.0.ff6b6b.0.ff6b6b',
];
// packLook(applyOutfit(DEFAULT_LOOK, starter)) for the six girl starters, before boys (A9)
const OLD_STARTERS = [
  'f6d2b8.a.7a4a2a.-.0.5a3a28.1.1.0.0.0.ff8cc6.1.ffffff.0.8e7cff.0.ffffff.3.ff8cc6.2.fff4e0.3.ffd1e6.2.ffd54a.0.-.0.b8e1ff.2.ffffff.1.ffd54a',
  'f6d2b8.1.7a4a2a.-.0.5a3a28.1.1.0.0.0.3fd8b0.3.ffffff.4.9c7bff.0.ffffff.-.-.-.-.0.ff5fa2.a.ff5fa2.0.-.4.ffd43b.0.ffd54a.0.-',
  'f6d2b8.9.7a4a2a.-.0.5a3a28.1.1.0.0.0.ff8cc6.1.ffffff.0.8e7cff.0.ffffff.0.ffd43b.6.ffffff.2.ff8cc6.9.ff8cc6.2.ff5fa2.0.b8e1ff.0.ffd54a.5.ffd1e6',
  'f6d2b8.4.7a4a2a.-.0.5a3a28.1.1.0.0.7.e6ddff.0.ffffff.1.c3a6ff.0.ffffff.-.-.-.-.5.ffd1e6.4.ff8cc6.0.-.1.a5f0e6.0.ffd54a.1.ffe58a',
  'f6d2b8.5.7a4a2a.-.0.5a3a28.1.1.0.0.3.ff6b6b.2.ffffff.3.4d7cff.0.ffffff.-.-.-.-.1.fff4e0.8.ffffff.0.-.0.b8e1ff.3.ff8cc6.4.-',
  'f6d2b8.6.7a4a2a.ff5fa2.1.5a3a28.1.1.0.0.6.9c7bff.0.ffffff.6.ff5fa2.2.ffe58a.-.-.-.-.1.3a1f4d.0.ff5fa2.4.ffd43b.0.b8e1ff.1.dde3ec.0.-',
];
// the tail a look gets today when it has soft brows and the default number 7
const TAIL = '.0.7';

// ---------------- A: unit checks (Node) ----------------

function unitPass(errors) {
  console.log('Unit checks (Node)');
  const c = (cond, msg) => check(errors, cond, msg);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // A1 append only
  const appendOnly = Object.entries(OLD_KEYS).filter(([k, keys]) => !eq(W[k].slice(0, keys.length).map((o) => o.key), keys));
  c(!appendOnly.length, `A1 every option list keeps its old entries in place (${appendOnly.map(([k]) => k).join(', ') || 'all 13'})`);
  const counts = { HAIR_STYLES: 19, TOPS: 14, BOTTOMS: 10, SHOES: 9, HEAD_ACC: 17, BACK_ACC: 7, NECK_ACC: 7, HAND_ACC: 9, PATTERNS: 12 };
  const badCounts = Object.entries(counts).filter(([k, n]) => W[k].length !== n);
  c(!badCounts.length, `A1 list sizes after the boy items (${badCounts.map(([k]) => `${k} ${W[k].length}`).join(', ') || 'as planned'})`);
  c(Object.keys(OLD_KEYS).every((k) => W[k].length <= 36), 'A1 every list stays under 36 entries (one base-36 token)');
  c(Object.keys(OLD_KEYS).every((k) => eq(W.tagged(W[k], 'g').map((o) => o.key), OLD_KEYS[k])), "A1 each list's Girl filter is exactly the old list");

  // A2 old looks normalize
  const old = W.normalizeLook(OLD_DEFAULT_LOOK);
  c(old.face.brows === 'soft' && old.top.num === 7, 'A2 the old DEFAULT_LOOK gains soft brows and number 7');
  c(W.lookSignature(OLD_DEFAULT_LOOK) === W.lookSignature(W.DEFAULT_LOOK), 'A2 the old default look is still the default look');
  const nums = ['x', NaN, Infinity, -5, 150, 12.4, null].map((n) => W.normalizeLook({ top: { type: 'jersey', num: n } }).top.num);
  c(eq(nums, [7, 7, 7, 0, 99, 12, 7]), `A2 garbage numbers are clamped or replaced (${nums.join(', ')})`);
  c(W.normalizeLook({ face: { brows: 'huge' } }).face.brows === 'soft', 'A2 unknown brows become soft');
  c(W.normalizeLook({ bottom: { num: 5 } }).bottom.num === undefined, 'A2 only the top has a number');
  let idem = true;
  for (const style of W.SURPRISE_STYLES) {
    for (let s = 0; s < 500; s++) {
      const l = W.randomLook(mulberry32(5000 + s), 'Zoe', null, style);
      if (W.lookSignature(W.normalizeLook(l)) !== JSON.stringify(l)) idem = false;
    }
  }
  c(idem, 'A2 normalizeLook is idempotent on 500 random looks of each style');

  // A3 the Girl surprise is unchanged
  let same = 0, sameGirl = 0;
  for (let s = 1; s <= 20; s++) {
    if (codec.packLook(W.randomLook(mulberry32(s), 'Zoe')) === OLD_RANDOM[s - 1] + TAIL) same++;
    if (eq(W.randomLook(mulberry32(s), 'Zoe'), W.randomLook(mulberry32(s), 'Zoe', null, 'girl'))) sameGirl++;
  }
  c(same === 20, `A3 randomLook (Girl) gives the recorded looks for seeds 1..20 (${same}/20)`);
  c(sameGirl === 20, 'A3 the default style is Girl');

  // A4 the Boy surprise
  const bTag = (list, key) => (list.find((o) => o.key === key)?.tag || '').includes('b');
  const boyPats = new Set(['none', 'stars', 'stripes', 'dots', 'plaid', 'checks', 'bolts', 'dinos', 'rockets']);
  let boyBad = 0, lashes = 0;
  for (let s = 0; s < 300; s++) {
    const l = W.randomLook(mulberry32(9000 + s), 'Zoe', null, 'boy');
    const ok = l.dress === null && bTag(W.HAIR_STYLES, l.hair.style) && bTag(W.TOPS, l.top.type) && bTag(W.BOTTOMS, l.bottom.type) &&
      bTag(W.SHOES, l.shoes.type) && boyPats.has(l.top.pattern) && Number.isInteger(l.top.num) && l.top.num >= 1 && l.top.num <= 99;
    if (!ok) boyBad++;
    if (l.eyes.lashes) lashes++;
  }
  c(boyBad === 0, `A4 300 Boy surprises: no dress, boy hair / top / bottom / shoes, boy patterns, a number 1..99 (${boyBad} bad)`);
  c(lashes < 90, `A4 lashes on in fewer than 30% of Boy surprises (${lashes}/300)`);
  const base = W.normalizeLook({ name: 'Leo', skin: '#6D4029', eyes: { color: '#3C9A64', lashes: false }, face: { brows: 'bold' } });
  const kept = W.randomLook(mulberry32(3), 'X', base, 'boy');
  c(kept.name === 'Leo' && kept.skin === '#6D4029' && kept.eyes.color === '#3C9A64' && kept.face.brows === 'bold', 'A4 with a base, name, skin, eyes and face stay');

  // A5 Mix
  let dress = false, boyHair = false;
  for (let s = 0; s < 300; s++) {
    const l = W.randomLook(mulberry32(12000 + s), 'Zoe', null, 'mix');
    if (l.dress) dress = true;
    if (bTag(W.HAIR_STYLES, l.hair.style) && l.hair.style !== 'curly') boyHair = true;
  }
  c(dress && boyHair, 'A5 300 Mix surprises give both a dress and a boy hair style');

  // A6 the look codec
  const lists = {
    'hair.style': W.HAIR_STYLES, 'top.type': W.TOPS, 'top.pattern': W.PATTERNS, 'bottom.type': W.BOTTOMS, 'shoes.type': W.SHOES,
    'acc.head': W.HEAD_ACC, 'acc.back': W.BACK_ACC, 'acc.neck': W.NECK_ACC, 'acc.hand': W.HAND_ACC, 'face.brows': W.BROWS,
  };
  let rt = 0, rtBad = 0;
  for (const [p, list] of Object.entries(lists)) {
    for (const o of list) {
      const l = W.normalizeLook({ name: 'Mia' });
      const [a, b] = p.split('.');
      l[a][b] = o.key;
      const n = W.normalizeLook(l);
      if (!eq(codec.unpackLook(codec.packLook(n), 'Mia'), n)) rtBad++;
      rt++;
    }
  }
  c(rtBad === 0, `A6 every option round-trips through the look token (${rt} looks)`);
  c(codec.packLook(W.DEFAULT_LOOK).startsWith(OLD_DEFAULT_TOKEN + '.'), 'A6 the old default token is a prefix of the new one');
  const back = codec.unpackLook(OLD_DEFAULT_TOKEN, 'Lily');
  c(back.face.brows === 'soft' && back.top.num === 7 && eq(back, W.normalizeLook(OLD_DEFAULT_LOOK)), 'A6 an old token without the tail unpacks (soft brows, number 7)');
  const worst = W.normalizeLook({
    name: 'Zoe', skin: '#ABCDEF', hair: { style: 'afro', color: '#123456', color2: '#654321', mix: 'tips' },
    eyes: { color: '#111111', lashes: true }, face: { blush: true, freckles: true, smile: 'open', brows: 'bold' },
    top: { type: 'tee_bolt', color: '#222222', pattern: 'rockets', patternColor: '#333333', num: 99 },
    bottom: { type: 'pants', color: '#444444', pattern: 'checks', patternColor: '#555555' },
    dress: { type: 'mermaid', color: '#666666', pattern: 'dinos', patternColor: '#777777' },
    shoes: { type: 'skate_shoes', color: '#888888' },
    acc: { head: 'headphones', headColor: '#999999', face: 'star_glasses', faceColor: '#AAAAAA', back: 'star_pack', backColor: '#BBBBBB', neck: 'medal', neckColor: '#CCCCCC', hand: 'dino_toy', handColor: '#DDDDDD' },
  });
  const wl = codec.packLook(worst).length;
  // 147 before boys + the tail '.1.2r' (two dots, 1 + 2 characters) = 152; test-net allows 160, presence 200
  c(wl <= 152, `A6 the worst-case look token is at most 152 characters (${wl})`);

  // A7 friends
  const F = looks.FRIENDS;
  const boys = F.filter((f) => f.pronoun === 'he' && f.kind === 'boy');
  c(F.length === 16 && new Set(F.map((f) => f.key)).size === 16 && new Set(F.map((f) => f.name)).size === 16, 'A7 16 friends with unique keys and names');
  c(boys.length === 6 && eq(F.slice(10).map((f) => f.key), ['leo', 'max', 'kai', 'sam', 'ezra', 'theo']), 'A7 six boys appended after the ten girls');
  c(F.slice(0, 10).every((f) => f.pronoun === 'she' && f.kind === 'girl'), 'A7 the ten girls are "she"');
  c(F.every((f) => JSON.stringify(W.normalizeLook(f.look)) === JSON.stringify(f.look)), 'A7 every friend look normalizes to itself');
  c(F.every((f) => sanitizeName(f.name) === f.name), 'A7 every friend name passes sanitizeName unchanged');
  c(eq(looks.pronouns(looks.friendDef('leo')), { they: 'he', them: 'him', their: 'his', They: 'He' }) && looks.pronouns(looks.friendDef('mia')).them === 'her', 'A7 pronouns(): he / him / his for boys, she / her for girls');
  c(eq(looks.rosterFriends().slice(0, 4).map((f) => f.key), ['mia', 'leo', 'zoe', 'kai']) && looks.rosterFriends().length === 16, 'A7 the invite order takes turns: Mia, Leo, Zoe, Kai, ...');
  c(looks.BAG_FRIEND === 'lilyrose' && looks.FRIENDS[3].key === 'lilyrose', "A7 the Bag picture stays Lily-Rose's (pinned by key)");
  c(looks.outfitsFor(looks.friendDef('leo')).length === 6 && looks.outfitsFor(looks.friendDef('mia')).length === 8, 'A7 boys get 6 outfit buttons, girls 8 (as before)');
  let hairOk = true, l = looks.friendDef('sam').look;
  for (let i = 0; i < 9; i++) {
    l = looks.nextHair(l, 'boy');
    if (!bTag(W.HAIR_STYLES, l.hair.style)) hairOk = false;
  }
  let g = looks.friendDef('mia').look;
  const girlCycle = [];
  for (let i = 0; i < 12; i++) girlCycle.push((g = looks.nextHair(g, 'girl')).hair.style);
  c(hairOk && eq([...girlCycle].sort(), [...OLD_KEYS.HAIR_STYLES].sort()), 'A7 New hair cycles boy styles for boys and the old 12 for girls');
  c(looks.friendDef('lilyrose').lines.includes('Every girl is a princess!'), "A7 Lily-Rose's lines are unchanged");

  // A8 neutral words about real players
  const OLD_STRINGS = {
    'src/net/protocol.js': ['Her world is saved at her house', 'Ask her to help'],
    'src/things/pets.js': ['Ask her to help'],
    'src/things/friends/index.js': ["She's your friend's friend", 'Tap her to play', 'went back to her spot'],
    'src/things/friends/ui.js': ['At her spot', 'invite her again'],
    'src/net/ui.js': ["It's her world", 'her own world', 'She can knock again', 'Ask her for a new code'],
    'src/net/walkie/ui.js': ['turns her walkie'],
    'src/ui/keepsafe.js': ['her worlds live only', 'her look and stickers', "'her world'"],
    'src/account/cards.js': ['her worlds and her cloud copy'],
    'src/core/storage.js': ['every world, her look'],
  };
  const left = [];
  for (const [file, olds] of Object.entries(OLD_STRINGS)) {
    const code = readFileSync(path.join(ROOT, file), 'utf8').split('\n').filter((x) => !/^\s*(\/\/|\*|\/\*)/.test(x)).join('\n');
    for (const s of olds) if (code.includes(s)) left.push(`${file}: ${s}`);
  }
  c(!left.length, `A8 no old "her / she" string about a real player is left (${left.join('; ') || 'none'})`);
  c(proto.messageText('pet_owner', { host: 'Lily' }) === "That's Lily's pet! Ask Lily to help.", 'A8 "That\'s Lily\'s pet! Ask Lily to help."');
  const gone = proto.messageText('host_gone', { host: 'Leo' }) + proto.messageText('ended', { host: 'Leo' });
  c(!/\b[Hh]er\b/.test(gone) && gone.includes("Leo's house"), `A8 "Leo went home" says no "her" (${proto.messageText('host_gone', { host: 'Leo' })})`);

  // A9 starters
  const girls = W.STARTER_OUTFITS.filter((o) => o.tag === 'g');
  const boyStarters = W.STARTER_OUTFITS.filter((o) => o.tag === 'b');
  c(girls.length === 6 && boyStarters.length === 6 && eq(W.STARTER_OUTFITS.slice(0, 6), girls), 'A9 6 girl starters first, 6 boy starters appended');
  c(girls.every((o, i) => codec.packLook(W.applyOutfit(W.DEFAULT_LOOK, o)) === OLD_STARTERS[i] + TAIL), 'A9 each girl starter gives exactly the old look');
  const me = W.normalizeLook({ name: 'Ava', skin: '#8C5535', hair: { style: 'bun', color: '#D9762F' }, eyes: { color: '#3C9A64', lashes: true }, top: { num: 42 } });
  const kept2 = boyStarters.map((o) => W.applyOutfit(me, o));
  c(kept2.every((x) => x.name === 'Ava' && x.skin === '#8C5535' && x.hair.color === '#D9762F' && x.eyes.color === '#3C9A64' && !x.eyes.lashes),
    'A9 boy starters keep name, skin, hair color and eye color (and turn lashes off)');
  const soccer = W.applyOutfit(me, boyStarters[0]);
  c(soccer.top.type === 'jersey' && soccer.top.num === 10 && soccer.face.brows === 'bold', 'A9 Soccer Star: jersey number 10, bold brows');
  c(W.applyOutfit(me, girls[1]).top.num === 42, 'A9 a girl starter keeps your jersey number');
}

// ---------------- helpers for the page ----------------

async function saveDataUrl(url, name) {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${PREFIX}-${name}.png`);
  await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`  grid .shots/${PREFIX}-${name}.png`);
}

/** Render an avatar grid in the page (items built by `src`, a function body given g). */
async function grid(page, name, src, opts) {
  const url = await page.evaluate(async ([src, opts]) => {
    const g = window.__game;
    const items = new Function('g', src)(g);
    return g.debug.avatar.renderGrid(items, opts);
  }, [src, opts || {}]);
  await saveDataUrl(url, name);
}

const tabLoc = (page, key) => page.locator(`.sw-dtab[data-tab="${key}"]`);
const tileLoc = (page, name) => page.locator('.sw-dress-content .sw-dtile', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).first();
const look = (page) => page.evaluate(() => window.__game.dressup.look);
const style = (page) => page.evaluate(() => window.__game.surpriseStyle());

async function waitThumbs(page, timeout = 25000) {
  return page.waitForFunction(() => {
    const pics = [...document.querySelectorAll('.sw-dress-content .sw-dsec:not([hidden]) .sw-dtile:not(.sw-empty) .sw-dpic')];
    return pics.length > 0 && pics.every((p) => p.classList.contains('sw-ready'));
  }, null, { timeout }).then(() => true, () => false);
}

/** The title's buttons that overlap the Dress Up tile (there should be none). */
function titleOverlaps(page) {
  return page.evaluate(() => {
    const tile = [...document.querySelectorAll('.sw-title2 .sw-tile')].find((b) => /Dress Up/.test(b.textContent));
    if (!tile) return ['no Dress Up tile'];
    const t = tile.getBoundingClientRect();
    const out = [];
    if (t.left < -1 || t.top < -1 || t.right > innerWidth + 1 || t.bottom > innerHeight + 1) out.push('Dress Up off screen');
    for (const b of document.querySelectorAll('.sw-title2 button')) {
      if (b === tile || !b.offsetParent) continue;
      const r = b.getBoundingClientRect();
      const ix = Math.min(r.right, t.right) - Math.max(r.left, t.left), iy = Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top);
      if (ix > 2 && iy > 2) out.push(b.getAttribute('aria-label') || b.textContent.trim());
    }
    return out;
  });
}

/**
 * Surprise me! and Undo under the avatar, and Girl / Boy / Mix over the tabs: each set in one
 * row, inside the screen, not overlapping.
 */
function actionsFit(page) {
  return page.evaluate(() => {
    for (const [sel, n] of [['.sw-dress-actions > .sw-btn', 2], ['.sw-dress-who > .sw-dress-who-btn', 3]]) {
      const bs = [...document.querySelectorAll(sel)].map((b) => b.getBoundingClientRect());
      if (bs.length !== n) return `${bs.length} buttons in ${sel}`;
      if (bs.some((r) => Math.abs(r.top - bs[0].top) > 2)) return `${sel}: more than one row`;
      if (bs.some((r) => r.left < 0 || r.right > innerWidth)) return `${sel}: off screen`;
      for (let i = 1; i < n; i++) if (bs[i].left < bs[i - 1].right - 1) return `${sel}: overlapping`;
    }
    return '';
  });
}

// ---------------- B / C: the Studio (desktop mouse, iPad touch) ----------------

async function studioPass(browser, errors, { touch = false } = {}) {
  const label = touch ? 'touch' : 'desktop';
  console.log(`Studio (${touch ? 'iPad 1024x768, touch' : 'desktop 1280x800, mouse'})`);
  const c = (cond, msg) => check(errors, cond, `${touch ? 'C' : 'B'} ${msg}`);
  const { context, page } = await openGame(browser, { errors, label, ...(touch ? { viewport: IPAD, touch: true } : {}) });
  const press = (loc) => (touch ? loc.tap() : loc.click());
  await settle(page, 800);

  // B1 the title's nudge on a fresh profile
  const tile = page.locator('.sw-title2 .sw-tile', { hasText: 'Dress Up' }).first();
  c(await tile.evaluate((b) => b.classList.contains('sw-tile--nudge')), 'B1 a fresh profile: the Dress Up tile wiggles (sw-tile--nudge)');
  const over = await titleOverlaps(page);
  c(!over.length, `B1 no title button overlaps the Dress Up tile (${over.join(', ') || 'none'})`);
  c((await page.evaluate(() => document.querySelector('.sw-hello')?.textContent || '')).includes('Hi, Lily!'), 'B1 the title still says "Hi, Lily!" before any style is picked');
  await shot(page, `${label}-title-nudge`, PREFIX);
  await press(tile);
  await page.waitForFunction(() => window.__game.ui.current === 'dressup', null, { timeout: 10000 });
  c(await page.evaluate(() => window.__game.dressup.tab === 'outfits'), 'B1 the nudged tile opens the Studio on Outfits');
  c(await style(page) === null, 'B4 no surprise style picked yet');
  const fit = await actionsFit(page);
  c(!fit, `B3 Surprise me! and Undo fit one row, and Girl / Boy / Mix another (${fit || 'ok'})`);
  c(await page.evaluate(() => !document.querySelector('.sw-dress-who-btn.sw-on')), 'B3 no style picked yet: none of Girl / Boy / Mix is lit');

  // B4 the ready-made looks
  await waitThumbs(page);
  const ready = await page.evaluate(() => document.querySelectorAll('.sw-dress-content .sw-dsec:first-child .sw-dgrid .sw-dtile').length);
  c(ready === 12, `B4 12 ready-made looks (${ready})`);
  const first4 = await page.evaluate(() => [...document.querySelectorAll('.sw-dress-content .sw-dsec:first-child .sw-dgrid .sw-dtile')].slice(0, 4).map((t) => [...t.querySelectorAll('span')].map((s) => s.textContent).find((x) => x && x.length > 2) || ''));
  c(first4.join(',') === 'Princess,Soccer Star,Sporty,Skater', `B4 before a style is picked, girl and boy looks take turns (${first4.join(', ')})`);
  await shot(page, `${label}-outfits`, PREFIX);
  await press(tileLoc(page, 'Soccer Star'));
  await page.waitForFunction(() => window.__game.dressup.look.top.type === 'jersey', null, { timeout: 5000 }).catch(() => {});
  let L = await look(page);
  c(L.top.type === 'jersey' && L.top.num === 10 && L.eyes.lashes === false, 'B4 Soccer Star: jersey number 10, no lashes');
  c(await style(page) === 'boy', 'B4 the first boy look picked the Boy style (it was unset)');
  c(await page.evaluate(() => !document.querySelector('.sw-dress-ask').hidden), 'B4 the Studio asks "What\'s your name?" once (a bubble, not a dialog)');
  c(await page.evaluate(() => window.__game.ui.current === 'dressup' && !window.__game.ui.dialogOpen), 'B4 nothing blocks the Studio');
  const nm = await page.evaluate(() => { const i = document.querySelector('.sw-dress-name input') || window.__game.dressup.nameInput; return { value: i.value, ph: i.placeholder }; });
  c(nm.value === '' && nm.ph === 'Your name', `B4 a boy who never typed a name: the name field is empty, not "Lily" (${JSON.stringify(nm)})`);
  await settle(page, 600);
  await shot(page, `${label}-soccer-star`, PREFIX);

  // B5 "My number"
  await press(tabLoc(page, 'tops'));
  await settle(page, 300);
  const step = page.locator('.sw-dress-content .sw-dstep');
  c(await step.isVisible(), 'B5 the number stepper shows with a jersey');
  const plus = page.locator('.sw-dstep-btn[data-step="1"]'), minus = page.locator('.sw-dstep-btn[data-step="-1"]');
  await page.evaluate(() => window.__game.dressup.change((d) => { d.top.num = 98; }, { kind: 'quiet' }));
  await press(plus);
  await settle(page, 150);
  c((await look(page)).top.num === 99, 'B5 + from 98 goes to 99');
  c(await plus.isDisabled(), 'B5 + stops at 99');
  await page.evaluate(() => window.__game.dressup.change((d) => { d.top.num = 1; }, { kind: 'quiet' }));
  await press(minus);
  await settle(page, 150);
  c((await look(page)).top.num === 0 && await minus.isDisabled(), 'B5 − goes to 0 and stops there');
  c((await page.locator('.sw-dstep-num').textContent()) === '0', 'B5 the jersey badge shows the number');
  if (!touch) {
    await page.evaluate(() => window.__game.dressup.change((d) => { d.top.num = 50; }, { kind: 'quiet' }));
    const box = await plus.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
    await settle(page, 300);
    const n = (await look(page)).top.num;
    c(n > 51 && n <= 65, `B5 a 1.5 s press repeats, at most 15 steps (50 -> ${n})`);
    await settle(page, 500);
    c((await look(page)).top.num === n, 'B5 the repeat stops on release');
  }
  await shot(page, `${label}-number`, PREFIX);
  await press(tileLoc(page, 'T-Shirt'));
  await settle(page, 300);
  c(!(await step.isVisible()), 'B5 the stepper hides without a jersey');

  // B2 / B3 hair tab and the style button
  await press(tabLoc(page, 'hair'));
  const thumbs = await waitThumbs(page);
  const hair = await page.evaluate(() => [...document.querySelectorAll('.sw-dress-content .sw-dsec:first-child .sw-dtile')].map((t) => t.getAttribute('aria-label')));
  const hairTags = await page.evaluate(() => window.__game.debug.avatar.options().HAIR_STYLES.map((o) => o.tag));
  const boyHair = hairTags.filter((t) => t.includes('b')).length, girlHair = hairTags.filter((t) => t.includes('g')).length;
  c(hair.length === boyHair && thumbs, `B2 with Boy, only the ${boyHair} boy and shared hair tiles, all pictures ready (${hair.length}, ${thumbs ? 'ready' : 'not ready'})`);
  c(hair[0] === 'Buzz Cut' && !hair.includes('Long'), `B3 with Boy, the first hair tile is Buzz Cut and no girl style shows (${hair[0]})`);
  const sig0 = await page.evaluate(() => JSON.stringify(window.__game.dressup.preview?.avatar.look));
  await press(tileLoc(page, 'Afro'));
  await settle(page, 300);
  const sig1 = await page.evaluate(() => JSON.stringify(window.__game.dressup.preview?.avatar.look));
  c((await look(page)).hair.style === 'afro' && sig1 !== sig0, 'B2 tap Afro: the look and the preview change');
  await shot(page, `${label}-hair`, PREFIX);
  // B3 Girl / Boy / Mix: the tiles follow the pick, and Girl and Boy each keep their own look
  const whoBtn = (st) => page.locator(`.sw-dress-who-btn[data-style="${st}"]`);
  const lit = () => page.evaluate(() => [...document.querySelectorAll('.sw-dress-who-btn.sw-on')].map((b) => b.dataset.style).join(','));
  const hairTiles = () => page.evaluate(() => [...document.querySelectorAll('.sw-dress-content .sw-dsec:first-child .sw-dtile')].map((t) => t.getAttribute('aria-label')));
  const dressesShown = () => page.evaluate(() => !document.querySelector('.sw-dtab[data-tab="dresses"]').hidden);
  c(await lit() === 'boy' && !(await dressesShown()), `B3 the Boy button is lit and the Dresses tab hides (${await lit()})`);
  const boyLook = await look(page);
  await press(whoBtn('mix'));
  await settle(page, 300);
  const mixHair = await hairTiles();
  c(await style(page) === 'mix' && await lit() === 'mix' && mixHair.length === hairTags.length && await dressesShown() && JSON.stringify(await look(page)) === JSON.stringify(boyLook),
    `B3 Mix: all ${hairTags.length} hair tiles and the Dresses tab, the look stays (${mixHair.length})`);
  await press(whoBtn('girl'));
  await settle(page, 400);
  const girlHairShown = await hairTiles();
  const gl = await look(page);
  c(await style(page) === 'girl' && girlHairShown.length === girlHair && girlHairShown[0] === 'Long' && !girlHairShown.includes('Buzz Cut'),
    `B3 Girl: only the ${girlHair} girl and shared hair tiles, in the old order (${girlHairShown.length}, ${girlHairShown[0]} first)`);
  c(gl.hair.style === 'long' && !gl.dress && gl.top.type === 'tshirt' && gl.eyes.lashes === true && gl.skin === boyLook.skin && gl.name === boyLook.name && await dressesShown(),
    `B3 Girl puts on a girl look (none kept yet: the default one), keeping the name and skin (${gl.hair.style}, ${gl.top.type})`);
  await press(whoBtn('boy'));
  await settle(page, 400);
  const bl = await look(page);
  c(JSON.stringify(bl) === JSON.stringify(boyLook) && bl.hair.style === 'afro', `B3 Boy again brings back his own boy look, exactly (${bl.hair.style}, ${bl.top.type})`);
  await press(whoBtn('girl'));
  await settle(page, 400);
  c((await look(page)).hair.style === 'long', 'B3 Girl again brings back the girl look');
  await press(page.locator('.sw-dress-undo'));
  await settle(page, 300);
  c((await look(page)).hair.style === 'afro', 'B3 Undo undoes a swap');
  await press(whoBtn('boy'));
  await settle(page, 300);
  c(await style(page) === 'boy' && (await look(page)).hair.style === 'afro', 'B3 Boy with a boy look on: the look stays');
  const before = await look(page);
  let surpriseBad = 0;
  for (let i = 0; i < 10; i++) {
    await press(page.locator('.sw-dress-surprise'));
    await settle(page, 60);
    const s = await look(page);
    const tag = await page.evaluate((k) => window.__game.debug.avatar.options().HAIR_STYLES.find((o) => o.key === k)?.tag, s.hair.style);
    if (s.dress || !tag || !tag.includes('b') || s.name !== before.name || s.skin !== before.skin) surpriseBad++;
  }
  c(surpriseBad === 0, `B3 10 x Surprise me! with Boy: no dress, boy hair, name and skin kept (${surpriseBad} bad)`);
  await settle(page, 500);
  await shot(page, `${label}-surprise-boy`, PREFIX);

  // B6 eyebrows
  await press(tabLoc(page, 'face'));
  await page.evaluate(() => window.__game.dressup.change((d) => { d.face.brows = 'soft'; }, { kind: 'quiet' })); // Soccer Star made them bold
  await settle(page, 300);
  const tex0 = await page.evaluate(() => window.__game.debug.avatar.textures().textures);
  await press(page.locator('.sw-dress-content .sw-dtile[aria-label="Bold"]'));
  await settle(page, 400);
  const tex1 = await page.evaluate(() => window.__game.debug.avatar.textures().textures);
  c((await look(page)).face.brows === 'bold', 'B6 Eyebrows: Bold');
  c(tex1 - tex0 <= 12, `B6 bold brows add only the new eye textures (${tex0} -> ${tex1})`);
  await press(page.locator('.sw-dress-undo'));
  await settle(page, 300);
  c((await look(page)).face.brows === 'soft', 'B6 Undo brings the soft brows back');
  await shot(page, `${label}-face`, PREFIX);

  // close: the nudge is gone, "Hi, friend!" while the name is unset with the Boy style
  await press(page.locator('.sw-dress-done'));
  await page.waitForFunction(() => window.__game.ui.current === 'title', null, { timeout: 8000 });
  await settle(page, 600);
  const after = await page.evaluate(() => ({
    nudge: !!document.querySelector('.sw-title2 .sw-tile--nudge'), picked: window.__game.profile.lookPicked,
    hello: document.querySelector('.sw-hello')?.textContent || '', inProfile: 'surpriseStyle' in window.__game.profile || 'lookStyle' in window.__game.profile,
  }));
  c(!after.nudge && after.picked === true, 'B1 after one visit the nudge is gone (lookPicked)');
  c(after.hello.includes('Hi, friend!'), `B the title greets "friend" for a Boy style with the name unset (${after.hello.trim()})`);
  c(!after.inProfile, 'B the surprise style is not in the profile (kept on this device only)');
  c(!(await page.evaluate(() => Object.keys(window.__game.profile).some((k) => /^look:|lookGirl|lookBoy/.test(k)))), 'B the girl and boy looks kept for the buttons are not in the profile either');
  await shot(page, `${label}-title-after`, PREFIX);
  if (touch) {
    // a phone (390 x 844) and a small one (360 x 740): the three actions still fit one row
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
      await page.setViewportSize(vp);
      await page.evaluate(() => window.__game.runAction('dressup'));
      await page.waitForFunction(() => window.__game.ui.current === 'dressup', null, { timeout: 8000 });
      await settle(page, 600);
      const pf = await actionsFit(page);
      c(!pf, `C Surprise me! / Undo and Girl / Boy / Mix each fit one row on a ${vp.width} px phone (${pf || 'ok'})`);
      await shot(page, `phone-${vp.width}`, PREFIX);
      await page.evaluate(() => window.__game.ui.back());
      await page.waitForFunction(() => window.__game.ui.current === 'title', null, { timeout: 8000 });
    }
  }
  await context.close();
}

// ---------------- B8-B11: in the world, portraits, photo, an old save ----------------

async function worldPass(browser, errors) {
  console.log('World (costs, portraits, photo, an old save)');
  const c = (cond, msg) => check(errors, cond, msg);
  const { context, page } = await openGame(browser, { errors, label: 'world' });
  await startWorld(page);

  // B8 costs on the player's avatar
  const cost = await page.evaluate(async () => {
    const g = window.__game, av = g.player.avatar, r = g.renderer.info.memory;
    const meshes = (l) => {
      av.setLook(l);
      let n = 0;
      av.group.traverse((o) => { if (o.isMesh) n++; });
      return n;
    };
    const starters = g.debug.avatar.starters();
    const princess = meshes(starters.find((o) => o.key === 'princess').look);
    const boys = starters.filter((o) => o.tag === 'b').map((o) => [o.name, meshes(o.look)]);
    const orig = g.debug.avatar.look();
    av.setLook(orig);
    await new Promise((res) => setTimeout(res, 200));
    const time = (style) => {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) av.setLook(g.debug.avatar.random(200 + i, null, style));
      return (performance.now() - t0) / 20;
    };
    time('boy'); time('girl'); // warm the texture cache for both
    const girl = time('girl'), boy = time('boy');
    const round = async (seed) => {
      for (let i = 0; i < 60; i++) {
        av.setLook(g.debug.avatar.random(seed + i, null, 'boy'));
        await new Promise((res) => requestAnimationFrame(res));
      }
      av.setLook(orig);
      await g.debug.waitIdle(20000); // the world's own meshes settle too
      await new Promise((res) => setTimeout(res, 300));
    };
    await round(2000); // a first round warms every shared cache
    const start = { geo: r.geometries, cache: g.debug.avatar.textures().textures };
    await round(3000);
    return { princess, boys, girl, boy, start, end: { geo: r.geometries, cache: g.debug.avatar.textures().textures } };
  });
  console.log(`  meshes: Princess ${cost.princess}; ${cost.boys.map(([n, m]) => `${n} ${m}`).join(', ')}`);
  console.log(`  setLook: girl ~${cost.girl.toFixed(1)} ms, boy ~${cost.boy.toFixed(1)} ms; geometries ${cost.start.geo} -> ${cost.end.geo}, texture cache ${cost.start.cache} -> ${cost.end.cache}`);
  c(cost.boys.every(([, m]) => m <= cost.princess), 'B8 every boy starter has no more meshes than the Princess starter');
  c(cost.boy <= cost.girl * 1.3 + 0.5, `B8 setLook of boy looks costs at most 1.3x girl looks (${cost.boy.toFixed(1)} vs ${cost.girl.toFixed(1)} ms)`);
  c(cost.end.geo <= cost.start.geo + 4, 'B8 no geometry leak after 60 boy looks');
  c(cost.end.cache <= 90, 'B8 the avatar texture cache stays bounded');

  // B9 portraits (account pictures use the same stage, 32 KB limit)
  const pics = await page.evaluate(async () => {
    const g = window.__game, stage = g.debug.avatar.stage();
    const base = g.debug.avatar.starters().find((o) => o.key === 'skater').look;
    const out = [];
    for (const [name, l] of [['cap', { ...base, acc: { ...base.acc, head: 'cap', headColor: '#4D7CFF' } }], ['afro', { ...base, hair: { ...base.hair, style: 'afro' }, acc: { ...base.acc, head: 'none' } }]]) {
      const cv = await stage.snapshot('acct-head:' + name, l, { frame: 'head', size: 160 });
      if (!cv) { out.push({ name, ok: false }); continue; }
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const top = ctx.getImageData(0, 0, cv.width, Math.ceil(cv.height * 0.08)).data;
      const row0 = ctx.getImageData(0, 0, cv.width, 1).data;
      let topInk = 0, edge = 0;
      for (let i = 3; i < top.length; i += 4) if (top[i] > 20) topInk++;
      for (let i = 3; i < row0.length; i += 4) if (row0[i] > 20) edge++;
      out.push({ name, ok: true, b64: cv.toDataURL('image/png').split(',')[1].length, topInk, edge });
    }
    return out;
  });
  for (const p of pics) {
    // account/portrait.js sends at most 32 KB of PNG: a base64 string of at most 43688 characters
    c(p.ok && p.b64 <= Math.floor((32 * 1024) / 3) * 4, `B9 ${p.name} portrait fits the 32 KB limit (${Math.round((p.b64 * 3) / 4 / 1024)} KB)`);
    console.log(`  ${p.name}: ${p.topInk} pixels in the top 8% of the head picture`);
    c(p.ok && p.edge < 8, `B9 ${p.name} is not cut off at the top edge (${p.edge} pixels in row 0)`);
  }

  // B10 photo mode with a boy look
  await page.evaluate(() => {
    const g = window.__game;
    g.profile.look = g.debug.avatar.starters().find((o) => o.key === 'space').look;
    g.events.emit('avatar:changed', { look: g.profile.look });
  });
  await settle(page, 600);
  await page.locator('.sw-round[aria-label="Photo"]').first().click();
  const photo = await until(page, () => window.__game.ui.current === 'photo', null, 10000);
  c(!!photo, 'B10 the HUD Photo button takes a photo with a boy look');
  await settle(page, 700);
  await shot(page, 'photo', PREFIX);
  await page.locator('.sw-photo-done').click();
  c(!!(await until(page, () => !window.__game.ui.current, null, 5000)), 'B10 the photo closes');
  await context.close();

  // B11 an old save: a real profile from the build before boys
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tools/fixtures/boys-old-profile.json'), 'utf8')).profile;
  const ctx2 = await openGame(browser, { errors, label: 'old-save' });
  // the page saves its profile when it goes away, so the old one replaces it in memory too
  await ctx2.page.evaluate(async (p) => {
    const g = window.__game;
    for (const k of Object.keys(g.profile)) delete g.profile[k];
    Object.assign(g.profile, JSON.parse(JSON.stringify(p)));
    await g.store.saveProfile(p);
  }, fixture);
  await ctx2.page.reload();
  await waitForTitle(ctx2.page);
  await settle(ctx2.page, 800);
  const loaded = await ctx2.page.evaluate(() => {
    const g = window.__game, l = g.debug.avatar.look();
    return {
      title: g.ui.current, hair: l.hair.style, brows: l.face.brows, num: l.top.num, outfits: g.profile.outfits.filter(Boolean).length,
      nudge: !!document.querySelector('.sw-title2 .sw-tile--nudge'), hello: document.querySelector('.sw-hello')?.textContent || '',
    };
  });
  c(loaded.title === 'title' && loaded.hair === 'pixie' && loaded.outfits === 1, 'B11 an old profile loads: her pixie hair and saved outfit are there');
  c(loaded.brows === 'soft' && loaded.num === 7, 'B11 the old look gains soft brows and number 7');
  c(!loaded.nudge, 'B11 no Dress Up nudge for a look that was changed before');
  c(loaded.hello.includes('Hi, Lily!'), 'B11 "Hi, Lily!" as before');
  await shot(ctx2.page, 'old-save-title', PREFIX);
  await ctx2.context.close();
}

// ---------------- D: the boy friends ----------------

async function friendsPass(browser, errors, { touch = false } = {}) {
  const label = touch ? 'touch' : 'desktop';
  console.log(`Friends (${touch ? 'iPad, touch' : 'desktop'})`);
  const c = (cond, msg) => check(errors, cond, `D ${msg}`);
  const { context, page } = await openGame(browser, { errors, label: 'friends-' + label, ...(touch ? { viewport: IPAD, touch: true } : {}) });
  const press = (loc) => (touch ? loc.tap() : loc.click());
  await startWorld(page, 'meadow', { tap: touch });
  await page.evaluate(() => {
    const g = window.__game;
    g.setDayTime(0.4);
    window.__toasts = [];
    const t = g.toast.bind(g);
    g.toast = (text, o) => { window.__toasts.push(text); return t(text, o); };
    window.__lines = [];
    g.events.on('friend:talk', ({ friend, line, kind }) => window.__lines.push({ key: friend.key, line, kind }));
  });
  const toasts = () => page.evaluate(() => window.__toasts.splice(0));

  // D1 invite toasts with the right pronoun
  const ids = await page.evaluate(() => ({ leo: window.__game.debug.friends.invite('leo'), mia: window.__game.debug.friends.invite('mia') }));
  const t1 = await toasts();
  c(t1.includes('Leo is here! Tap him to play!'), `"Leo is here! Tap him to play!" (${t1.join(' | ')})`);
  c(t1.includes('Mia is here! Tap her to play!'), '"Mia is here! Tap her to play!"');

  // D3 Leo's Dress up bubble
  await page.evaluate((id) => {
    const g = window.__game, f = g.friends.byId(id), pl = g.player.position;
    f.mode = 'stay';
    const x = pl.x + Math.sin(g.cameraRig.yaw) * 3, z = pl.z + Math.cos(g.cameraRig.yaw) * 3;
    f.teleport(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01, z, false);
    g.cameraRig.pitch = 0.3;
  }, ids.leo);
  await settle(page, 500);
  const bubble = async (id) => {
    await page.evaluate((id) => window.__game.debug.friends.tap(id), id);
    await page.waitForSelector('.pl-bubble.pl-on .sw-round[aria-label="Dress up"]', { timeout: 5000 });
    await press(page.locator('.pl-bubble.pl-on .sw-round[aria-label="Dress up"]'));
    await page.waitForSelector('.pl-bubble.pl-on .sw-round[aria-label="New hair"]', { timeout: 5000 });
    return page.evaluate(() => [...document.querySelectorAll('.pl-bubble.pl-on .sw-round')].map((b) => b.getAttribute('aria-label')));
  };
  const leoBtns = await bubble(ids.leo);
  c(JSON.stringify(leoBtns) === JSON.stringify(['Soccer Star', 'Skater', 'Space Explorer', 'Dino Explorer', 'Camping Day', 'Party Time', 'Surprise!', 'New hair', 'Twins!', 'Back']),
    `Leo's Dress up bubble: the 6 boy looks, then Surprise!, New hair, Twins!, Back (${leoBtns.length})`);
  await shot(page, `${label}-leo-bubble`, PREFIX);
  let dressBad = 0;
  for (let i = 0; i < 5; i++) {
    await press(page.locator('.pl-bubble.pl-on .sw-round[aria-label="Surprise!"]'));
    await settle(page, 80);
    if (await page.evaluate((id) => window.__game.friends.byId(id).look.dress !== null, ids.leo)) dressBad++;
  }
  c(dressBad === 0, 'Surprise! x5 on Leo: never a dress');
  const hairs = [];
  for (let i = 0; i < 7; i++) {
    await press(page.locator('.pl-bubble.pl-on .sw-round[aria-label="New hair"]'));
    await settle(page, 60);
    hairs.push(await page.evaluate((id) => window.__game.friends.byId(id).look.hair.style, ids.leo));
  }
  const bHairs = await page.evaluate(() => window.__game.debug.avatar.options().HAIR_STYLES.filter((o) => o.tag.includes('b')).map((o) => o.key));
  c(hairs.every((h) => bHairs.includes(h)) && new Set(hairs).size >= 6, `New hair x7 on Leo: only boy styles (${hairs.join(', ')})`);
  await press(page.locator('.pl-bubble.pl-on .sw-round[aria-label="Soccer Star"]'));
  await settle(page, 200);
  c(await page.evaluate((id) => window.__game.friends.byId(id).look.top.type === 'jersey', ids.leo), 'an outfit button dresses Leo');
  await settle(page, 600);
  await shot(page, `${label}-leo-styled`, PREFIX);
  const miaBtns = await bubble(ids.mia);
  c(miaBtns.length === 12 && miaBtns[0] === 'Princess', `Mia's bubble still has the 8 girl outfits (${miaBtns.length - 4})`);
  await page.evaluate(() => window.__game.friends.ui?.hideBubble?.());

  // D4 boys never say "pretty" about being dressed up
  const pretty = await page.evaluate((id) => {
    const d = window.__game.debug.friends;
    window.__lines.length = 0;
    for (let i = 0; i < 30; i++) d.style(id, i % 2 ? 'surprise' : 'hair');
    return window.__lines.filter((l) => l.key === 'leo' && /pretty|fancy/i.test(l.line)).map((l) => l.line);
  }, ids.leo);
  c(!pretty.length, `30 style / hair lines from Leo: none says "pretty" (${pretty.join(' | ') || 'none'})`);

  // D2 home, the My Friends card, the bye confirm
  await page.evaluate((id) => { const g = window.__game; g.friends.sendHome(g.friends.byId(id)); }, ids.leo);
  const t2 = await toasts();
  c(t2.includes('Leo went back to his spot!'), `"Leo went back to his spot!" (${t2.join(' | ')})`);
  await page.evaluate(() => window.__game.ui.open('friends'));
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="friends"] .pl-card');
  const meta = await page.evaluate(() => [...document.querySelectorAll('.pl-card')].map((c) => c.textContent));
  c(meta.some((m) => m.includes('Soccer Star · At his spot')), 'My Friends: "Soccer Star · At his spot"');
  // D7 the invite roster
  const roster = await until(page, () => {
    const imgs = [...document.querySelectorAll('.sw-panel-wrap.sw-open .pl-invite img')];
    return imgs.length === 16 && imgs.every((i) => (i.getAttribute('src') || '').startsWith('data:')) ? [...document.querySelectorAll('.pl-invite')].map((b) => b.dataset.friend) : null;
  }, null, 60000);
  c(Array.isArray(roster) && roster.length === 16 && roster.slice(0, 4).join() === 'mia,leo,zoe,kai', `D7 16 invite cards with pictures, Mia, Leo, Zoe, Kai first (${roster && roster.slice(0, 4).join(', ')})`);
  await shot(page, `${label}-roster`, PREFIX);
  const leoCard = page.locator('.pl-card', { hasText: 'Leo' }).first();
  await press(leoCard.locator('button', { hasText: 'Bye' }));
  await page.waitForSelector('.sw-dialog, .sw-confirm, [role="dialog"]', { timeout: 5000 }).catch(() => {});
  const dlg = await page.evaluate(() => (document.querySelector('.sw-dialog, .sw-confirm, [role="dialog"]') || {}).textContent || '');
  c(/invite him again/.test(dlg), 'the bye dialog says "You can invite him again!"');
  await press(page.locator('button', { hasText: 'Stay!' }).first());
  await settle(page, 300);
  await page.evaluate(() => window.__game.ui.close());

  if (!touch) {
    // D5 six friends (three boys) around the player: draw calls, finite positions, no stalls
    const girlsCalls = await page.evaluate(async () => {
      const g = window.__game, d = g.debug.friends;
      for (const f of [...g.friends.friends]) g.friends.remove(f);
      for (const k of ['ava', 'zoe', 'nia', 'mia', 'chloe', 'emma']) d.invite(k);
      await new Promise((r) => setTimeout(r, 1500));
      return d.drawCalls();
    });
    const mixed = await page.evaluate(async () => {
      const g = window.__game, d = g.debug.friends;
      for (const f of [...g.friends.friends]) g.friends.remove(f);
      for (const k of ['leo', 'kai', 'ezra', 'mia', 'zoe', 'ava']) d.invite(k);
      await new Promise((r) => setTimeout(r, 1500));
      return { calls: d.drawCalls(), info: g.debug.info().calls };
    });
    console.log(`  friends' draw calls: six girls ${girlsCalls}, three boys + three girls ${mixed.calls} (frame ${mixed.info})`);
    c(mixed.calls <= Math.ceil(girlsCalls * 1.1), `D5 three boys + three girls draw no more than six girls + 10% (${mixed.calls} vs ${girlsCalls})`);
    await shot(page, 'six-friends', PREFIX);
    const walk = await page.evaluate(async () => {
      const g = window.__game;
      for (const f of g.friends.friends) g.friends.setMode(f, 'follow', { quiet: true });
      const r0 = g.diag.report(), t0 = Date.now(), seen = r0.longFrames.length, seenStalls = r0.stalls.length; // only what happens from here
      const p0 = g.player.position.clone();
      let nonFinite = 0;
      for (let i = 0; i < 60; i++) { // 30 s: the player walks a slow circle, the friends follow
        const a = i * 0.21;
        g.player.teleport(p0.x + Math.cos(a) * 6, g.world.heightAt(Math.floor(p0.x + Math.cos(a) * 6), Math.floor(p0.z + Math.sin(a) * 6)) + 1.01, p0.z + Math.sin(a) * 6);
        await new Promise((r) => setTimeout(r, 500));
        for (const f of g.friends.friends) if (![f.pos.x, f.pos.y, f.pos.z].every(Number.isFinite)) nonFinite++;
      }
      const rep = g.diag.report();
      const longs = rep.longFrames.slice(seen).map((l) => l.ms);
      return { secs: (Date.now() - t0) / 1000, nonFinite, maxLong: longs.length ? Math.max(...longs) : 0, stalls: rep.stalls.length - seenStalls };
    });
    c(walk.nonFinite === 0, `D5 after ${walk.secs.toFixed(0)} s of follow mode every friend position is finite`);
    c(walk.maxLong <= 1000 && walk.stalls === 0, `D5 the frame loop never stalled over 1 s (longest ${walk.maxLong} ms, ${walk.stalls} stalls)`);

    // D6 save and reload
    const saved = await page.evaluate(() => ({ id: window.__game.world.meta.id, list: window.__game.friends.friends.map((f) => [f.key, f.name, JSON.stringify(f.look)]).sort() }));
    await page.evaluate(() => window.__game.debug.save());
    await page.evaluate((id) => window.__game.debug.loadWorld(id), saved.id);
    await waitForPlay(page);
    await waitIdle(page);
    const again = await page.evaluate(() => window.__game.friends.friends.map((f) => [f.key, f.name, JSON.stringify(f.look)]).sort());
    c(JSON.stringify(again) === JSON.stringify(saved.list), `D6 boy friends come back with the same key, name and look (${again.length})`);
  }
  await context.close();
}

// ---------------- B7: grids of every new piece ----------------

async function gridsPass(browser, errors) {
  console.log('Grids (every new option, the boy starters and the boy friends)');
  const { context, page } = await openGame(browser, { errors, label: 'grids' });
  const base = `const b = { ...g.debug.avatar.look(), hair: { style: 'buzz', color: '#3B2419' }, eyes: { color: '#5A3A28', lashes: false }, acc: { ...g.debug.avatar.look().acc, head: 'none' } };`;
  await grid(page, 'hair', `${base}
    const colors = ['#1F1614', '#D9762F', '#3B2419', '#C99A5B', '#1F1614', '#7A4A2A', '#1F1614'];
    const out = ['buzz', 'spiky', 'side_part', 'shaggy', 'short_curly', 'fauxhawk', 'afro'].map((s, i) => ({ look: { ...b, hair: { style: s, color: colors[i], color2: s === 'fauxhawk' ? '#7FD3FF' : null, mix: 'tips' } }, label: s, frame: { cy: 1.3, span: 1.35, yaw: 0.7, pitch: 0.12 } }));
    for (const s of ['buzz', 'spiky', 'side_part', 'shaggy', 'short_curly', 'fauxhawk', 'afro']) out.push({ look: { ...b, hair: { style: s, color: '#3B2419' } }, label: s + ' (back)', frame: { cy: 1.3, span: 1.35, yaw: 2.8, pitch: 0.12 } });
    return out;`, { cols: 7, size: 200, aspect: 0.85 });
  await grid(page, 'hats', `${base}
    const out = [];
    const hairs = ['buzz', 'spiky', 'afro', 'short_curly', 'long', 'fauxhawk'];
    for (const [k, c] of [['cap', '#4D7CFF'], ['cap_back', '#FF6B6B'], ['bucket_hat', '#6BD68A'], ['headphones', '#6CC6FF']]) {
      for (const h of hairs) out.push({ look: { ...b, hair: { style: h, color: '#1F1614' }, acc: { ...b.acc, head: k, headColor: c } }, label: k + '/' + h, frame: { cy: 1.6, span: 1.3, yaw: 0.45, pitch: 0.14 } });
    }
    return out;`, { cols: 6, size: 190, aspect: 0.85 });
  await grid(page, 'clothes', `${base}
    const out = [];
    [['polo', '#6CC6FF', 'none'], ['jersey', '#4D7CFF', 'none'], ['button_up', '#FF6B6B', 'plaid'], ['tee_dino', '#FFE58A', 'none'], ['tee_rocket', '#3A1F4D', 'none'], ['tee_bolt', '#3A1F4D', 'none']].forEach(([k, c, p]) => out.push({ look: { ...b, top: { type: k, color: c, pattern: p, patternColor: k === 'button_up' ? '#3A1F4D' : '#FFFFFF', num: 23 } }, label: k, frame: 'torso' }));
    out.push({ look: { ...b, top: { type: 'jersey', color: '#FF6B6B', pattern: 'none', patternColor: '#FFFFFF', num: 8 } }, label: 'jersey back', frame: { cy: 0.95, span: 0.9, yaw: Math.PI, pitch: 0.05 } });
    [['cargo_shorts', '#8B5E3C'], ['joggers', '#6B7280'], ['pants', '#3A1F4D']].forEach(([k, c]) => out.push({ look: { ...b, bottom: { type: k, color: c, pattern: 'none', patternColor: '#FFFFFF' } }, label: k, frame: 'legs' }));
    [['high_tops', '#FF6B6B'], ['skate_shoes', '#4D7CFF']].forEach(([k, c]) => out.push({ look: { ...b, shoes: { type: k, color: c } }, label: k, frame: 'feet' }));
    ['plaid', 'checks', 'bolts', 'dinos', 'rockets'].forEach((p) => out.push({ look: { ...b, top: { type: 'tshirt', color: '#4D7CFF', pattern: p, patternColor: '#FFE58A' } }, label: p, frame: 'torso' }));
    return out;`, { cols: 6, size: 190, aspect: 0.85 });
  await grid(page, 'accessories', `${base}
    const out = [];
    out.push({ look: { ...b, acc: { ...b.acc, back: 'star_pack', backColor: '#6CC6FF' } }, label: 'star_pack', frame: 'back' });
    for (const [k, c] of [['necktie', '#4D7CFF'], ['medal', '#FF6B6B']]) out.push({ look: { ...b, acc: { ...b.acc, neck: k, neckColor: c } }, label: k, frame: 'neck' });
    for (const k of ['soccer_ball', 'toy_car', 'dino_toy']) out.push({ look: { ...b, acc: { ...b.acc, hand: k } }, label: k, frame: 'hand' });
    out.push({ look: { ...b, face: { ...b.face, brows: 'soft' } }, label: 'brows soft', frame: 'face' });
    out.push({ look: { ...b, face: { ...b.face, brows: 'bold' } }, label: 'brows bold', frame: 'face' });
    return out;`, { cols: 4, size: 200, aspect: 0.85 });
  await grid(page, 'starters', `
    const s = g.debug.avatar.starters().filter((o) => o.tag === 'b');
    const skins = ['#C3845A', '#F6D2B8', '#8C5535', '#FFE6D8', '#6D4029', '#A96C45'];
    const out = s.map((o, i) => ({ look: { ...o.look, skin: skins[i], hair: { ...o.look.hair, color: '#3B2419' } }, label: o.name, frame: { cy: 0.97, span: 2.25, yaw: 0.25, pitch: 0.1 } }));
    return out.concat(out.map((x) => ({ ...x, label: x.label + ' (head)', frame: 'head' })));`, { cols: 6, size: 220 });
  const boyFriends = JSON.stringify(looks.FRIENDS.filter((f) => f.kind === 'boy').map((f) => ({ look: f.look, label: f.name })));
  await grid(page, 'friends', `
    const out = ${boyFriends}.map((x) => ({ ...x, frame: { cy: 0.97, span: 2.25, yaw: 0.25, pitch: 0.1 } }));
    return out.concat(out.map((x) => ({ ...x, label: x.label + ' (head)', frame: 'head' })));`, { cols: 6, size: 220 });
  await grid(page, 'surprise', `
    const out = [];
    for (let s = 1; s <= 6; s++) out.push({ look: g.debug.avatar.random(40 + s, null, 'boy'), label: 'Boy ' + s, frame: { cy: 0.97, span: 2.25, yaw: 0.25, pitch: 0.1 } });
    for (let s = 1; s <= 6; s++) out.push({ look: g.debug.avatar.random(7 + s * 3, null, 'mix'), label: 'Mix ' + s, frame: { cy: 0.97, span: 2.25, yaw: 0.25, pitch: 0.1 } });
    return out;`, { cols: 6, size: 200 });
  await context.close();
}

async function main() {
  const opts = parseArgs();
  const errors = [];
  const only = opts.only;
  if (!only || only === 'unit') unitPass(errors);
  if (only !== 'unit') {
    const browser = await launch(opts);
    try {
      if (!only || only === 'studio') await studioPass(browser, errors);
      if (!only || only === 'touch') await studioPass(browser, errors, { touch: true });
      if (!only || only === 'world') await worldPass(browser, errors);
      if (!only || only === 'friends') await friendsPass(browser, errors);
      if (!only || only === 'touch' || only === 'friends') await friendsPass(browser, errors, { touch: true });
      if (!only || only === 'grids') await gridsPass(browser, errors);
    } catch (err) {
      errors.push('[probe] ' + (err.stack || err.message || String(err)));
    } finally {
      await browser.close();
    }
  }
  finish(errors);
}

main();
