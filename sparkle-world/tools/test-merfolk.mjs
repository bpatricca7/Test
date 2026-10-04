// Sea forms (docs/teams/merfolk.md §14.1): rules, look lists, the look codec and the shore exit,
// no browser, seconds:
//   node tools/test-merfolk.mjs            (npm run test:merfolk)
//
// The OLD_*_669 goldens below were recorded from the untouched tree (commit 582d11c, the same
// game as 669b6fa) BEFORE any sea-form change. Never edit them: they prove that every look a
// child had before still looks and packs exactly the same.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from '../src/player/wardrobe-data.js';
import * as codec from '../src/net/codec.js';
import { mulberry32 } from '../src/core/util.js';
import * as R from '../src/player/merfolk/rules.js';
import { Physics } from '../src/world/physics.js';
import { SHAPES } from '../src/core/registry.js';
import { Input } from '../src/core/input.js';

// A tiny fake canvas so the avatar (and its painted textures) can be built in Node: every 2D
// call is accepted and does nothing (A12, A15 count geometry and texture references only).
const fakeCtx = new Proxy({}, {
  get: (o, k) => (k in o ? o[k] : () => fakeGrad),
  set: (o, k, v) => { o[k] = v; return true; },
});
const fakeGrad = { addColorStop() {} };
globalThis.document = globalThis.document || {
  createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx, style: {} }),
};
const { createAvatar } = await import('../src/player/avatar.js');
const { TailTube, seaPalette, buildSea } = await import('../src/player/merfolk/parts.js');
const { cacheStats } = await import('../src/player/avatar/textures.js');
const { scanText, scanCharacters, scanFiles, EXTRA_SCOPE, extraWords } = await import('./lib/name-scan.mjs');
const { SEA_STICKERS } = await import('../src/player/merfolk/stickers.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = JSON.parse(readFileSync(path.join(ROOT, 'tools/fixtures/merfolk-old-profile.json'), 'utf8')).profile;

// ---------- goldens (recorded before the change) ----------

const OLD_KEYS_669 = {
  HAIR_STYLES: ['long', 'ponytail', 'pigtails', 'bun', 'space_buns', 'braids', 'curly', 'bob', 'short', 'side_pony', 'wavy_long', 'pixie', 'buzz', 'spiky', 'side_part', 'shaggy', 'short_curly', 'fauxhawk', 'afro'],
  HAIR_MIXES: ['ombre', 'streaks', 'tips'],
  TOPS: ['tshirt', 'tank', 'hoodie', 'sweater', 'blouse', 'crop', 'jacket', 'sparkle_top', 'polo', 'jersey', 'button_up', 'tee_dino', 'tee_rocket', 'tee_bolt'],
  BOTTOMS: ['skirt', 'tutu', 'jeans', 'leggings', 'shorts', 'overalls', 'pleated', 'cargo_shorts', 'joggers', 'pants'],
  DRESSES: ['sundress', 'party', 'princess', 'ballgown', 'overall_dress', 'mermaid'],
  SHOES: ['sneakers', 'boots', 'sandals', 'sparkle', 'rainboots', 'ballet', 'roller_skates', 'high_tops', 'skate_shoes'],
  HEAD_ACC: ['none', 'bow', 'tiara', 'crown', 'flower_crown', 'cat_ears', 'bunny_ears', 'unicorn_horn', 'beanie', 'sun_hat', 'headband', 'witch_hat', 'halo', 'cap', 'cap_back', 'bucket_hat', 'headphones'],
  FACE_ACC: ['none', 'glasses', 'sunglasses', 'heart_glasses', 'star_glasses'],
  BACK_ACC: ['none', 'fairy_wings', 'butterfly_wings', 'angel_wings', 'backpack', 'cape', 'star_pack'],
  NECK_ACC: ['none', 'necklace', 'pearls', 'scarf', 'bowtie', 'necktie', 'medal'],
  HAND_ACC: ['none', 'wand', 'purse', 'balloon', 'teddy', 'ice_cream', 'soccer_ball', 'toy_car', 'dino_toy'],
  PATTERNS: ['none', 'hearts', 'stars', 'stripes', 'dots', 'rainbow', 'flowers', 'plaid', 'checks', 'bolts', 'dinos', 'rockets'],
  SMILES: ['happy', 'grin', 'cat', 'open'],
  BROWS: ['soft', 'bold'],
  EMOTES: ['wave', 'dance', 'twirl', 'cartwheel', 'jump', 'heart', 'sit'],
};
const OLD_DEFAULT_TOKEN_669 = 'f6d2b8.0.7a4a2a.-.0.5a3a28.1.1.0.0.0.ff8cc6.1.ffffff.0.8e7cff.0.ffffff.-.-.-.-.0.ffffff.1.ff5fa2.0.-.0.b8e1ff.0.ffd54a.0.-.0.7';
const OLD_STARTERS_669 = [
  'f6d2b8.a.7a4a2a.-.0.5a3a28.1.1.0.0.0.ff8cc6.1.ffffff.0.8e7cff.0.ffffff.3.ff8cc6.2.fff4e0.3.ffd1e6.2.ffd54a.0.-.0.b8e1ff.2.ffffff.1.ffd54a.0.7', // princess
  'f6d2b8.1.7a4a2a.-.0.5a3a28.1.1.0.0.0.3fd8b0.3.ffffff.4.9c7bff.0.ffffff.-.-.-.-.0.ff5fa2.a.ff5fa2.0.-.4.ffd43b.0.ffd54a.0.-.0.7', // sporty
  'f6d2b8.9.7a4a2a.-.0.5a3a28.1.1.0.0.0.ff8cc6.1.ffffff.0.8e7cff.0.ffffff.0.ffd43b.6.ffffff.2.ff8cc6.9.ff8cc6.2.ff5fa2.0.b8e1ff.0.ffd54a.5.ffd1e6.0.7', // beach
  'f6d2b8.4.7a4a2a.-.0.5a3a28.1.1.0.0.7.e6ddff.0.ffffff.1.c3a6ff.0.ffffff.-.-.-.-.5.ffd1e6.4.ff8cc6.0.-.1.a5f0e6.0.ffd54a.1.ffe58a.0.7', // fairy
  'f6d2b8.5.7a4a2a.-.0.5a3a28.1.1.0.0.3.ff6b6b.2.ffffff.3.4d7cff.0.ffffff.-.-.-.-.1.fff4e0.8.ffffff.0.-.0.b8e1ff.3.ff8cc6.4.-.0.7', // winter
  'f6d2b8.6.7a4a2a.ff5fa2.1.5a3a28.1.1.0.0.6.9c7bff.0.ffffff.6.ff5fa2.2.ffe58a.-.-.-.-.1.3a1f4d.0.ff5fa2.4.ffd43b.0.b8e1ff.1.dde3ec.0.-.0.7', // rockstar
  'f6d2b8.g.7a4a2a.-.0.5a3a28.0.1.0.0.9.4d7cff.0.ffffff.4.ffffff.0.ffffff.-.-.-.-.7.ff6b6b.0.ff5fa2.0.-.0.b8e1ff.6.ff6b6b.6.-.1.a', // soccer
  'f6d2b8.d.7a4a2a.-.0.5a3a28.0.1.0.0.d.3a1f4d.0.ffffff.8.6b7280.0.ffffff.-.-.-.-.8.ff6b6b.e.ff6b6b.0.-.0.b8e1ff.0.ffd54a.0.-.0.7', // skater
  'f6d2b8.h.7a4a2a.-.0.5a3a28.0.1.0.0.c.3a1f4d.0.ffffff.8.7048e8.0.ffffff.-.-.-.-.7.ffffff.g.6cc6ff.0.-.6.6cc6ff.0.ffd54a.0.-.0.7', // space
  'f6d2b8.c.7a4a2a.-.0.5a3a28.0.1.0.0.b.ffe58a.0.ffffff.7.8b5e3c.0.ffffff.-.-.-.-.1.8b5e3c.f.6bd68a.0.-.4.ffa94d.0.ffd54a.8.-.0.7', // dino
  'f6d2b8.f.7a4a2a.-.0.5a3a28.0.1.0.0.a.ff6b6b.7.3a1f4d.2.4d7cff.0.ffffff.-.-.-.-.1.8b5e3c.8.ffa94d.0.-.0.b8e1ff.0.ffd54a.0.-.1.7', // camp
  'f6d2b8.e.7a4a2a.-.0.5a3a28.0.1.0.0.a.ffffff.0.ffffff.9.3a1f4d.0.ffffff.-.-.-.-.0.ffffff.0.ff5fa2.0.-.0.b8e1ff.4.ff5fa2.3.6cc6ff.0.7', // dapper
];
const OLD_RANDOM_669 = {
  girl: [
    'f0c3a0.1.9c7bff.-.1.5a3a28.1.1.0.0.5.3a1f4d.0.ffffff.2.9c7bff.0.ffffff.3.3a1f4d.4.ffffff.3.ffffff.8.ffd54a.0.6cc6ff.0.3a1f4d.0.6cc6ff.0.6cc6ff.0.7',
    '6d4029.6.ff8cc6.-.0.8b6bd6.1.0.1.3.3.ffc9a8.0.ffffff.2.fff4e0.0.ffffff.-.-.-.-.1.ffffff.c.ffd54a.0.-.0.fff4e0.0.dde3ec.3.ff5fa2.0.7',
    '8c5535.a.d9762f.r.0.8b6bd6.1.1.0.3.3.ffc9a8.1.ffffff.1.ffd1e6.0.ffffff.-.-.-.-.4.ffd1e6.9.ff6b6b.0.-.0.ffd1e6.2.ff6b6b.0.-.0.7',
    '6d4029.6.c99a5b.-.2.3c9a64.1.1.0.3.0.ffffff.5.ff5fa2.6.6cc6ff.0.ff5fa2.-.-.-.-.2.ff5fa2.0.ffd54a.0.ff5fa2.0.6cc6ff.0.dde3ec.0.ff5fa2.0.7',
    'ffe6d8.5.ff5fa2.-.0.2fb5b0.1.1.0.1.5.222230.0.ff5fa2.3.ff5fa2.0.ff5fa2.-.-.-.-.5.ffffff.6.ff5fa2.0.6cc6ff.0.222230.0.dde3ec.0.6cc6ff.0.7',
    '8c5535.7.f7e7b7.-.1.3c9a64.1.0.0.1.7.6bd68a.6.fff4e0.6.ffe58a.6.fff4e0.0.6bd68a.6.fff4e0.0.ffffff.3.ff5fa2.0.-.3.ff5fa2.0.dde3ec.0.ff5fa2.0.7',
    'c3845a.2.c99a5b.-.1.8a6a2e.1.1.0.0.3.ff8cc6.1.fff4e0.1.b8e1ff.0.fff4e0.-.-.-.-.1.ffffff.7.dde3ec.4.-.0.9c7bff.0.9c7bff.0.-.0.7',
    'f0c3a0.1.1f1614.-.2.8b6bd6.1.1.1.2.6.a5f0e6.0.e6ddff.1.9c7bff.1.e6ddff.-.-.-.-.0.4d7cff.4.ffd54a.4.4d7cff.0.a5f0e6.0.dde3ec.0.-.0.7',
    'f0c3a0.8.c99a5b.-.1.3c9a64.1.0.0.1.2.a5f0e6.1.e6ddff.6.9c7bff.0.e6ddff.-.-.-.-.4.ffffff.b.4d7cff.0.4d7cff.5.9c7bff.0.4d7cff.1.4d7cff.0.7',
    'e4ae86.5.f7e7b7.-.2.8a6a2e.0.0.1.1.1.b8f2a0.3.ffffff.0.ffffff.0.ffffff.-.-.-.-.0.ffffff.5.ffd54a.3.ffd43b.0.ffffff.1.ffd54a.4.ffd43b.0.7',
    'a96c45.8.a0592d.-.0.2e1e14.1.1.0.2.0.b8f2a0.0.fff4e0.3.ffe58a.0.fff4e0.-.-.-.-.5.ffd43b.0.ffe58a.0.ffd43b.0.ffd43b.1.ffd43b.0.ffd43b.0.7',
    '8c5535.7.ff8cc6.-.1.e0569a.0.1.0.3.5.ffd43b.0.ffffff.3.ff8cc6.0.ffffff.4.ffd43b.0.ffffff.2.ffffff.1.ffa94d.0.ffa94d.0.ff8cc6.0.dde3ec.3.ffa94d.0.7',
    'e4ae86.6.4d7cff.-.1.2e1e14.1.1.0.1.2.6bd68a.0.ffffff.3.ff8cc6.0.ffffff.0.6bd68a.0.ffffff.2.ffffff.1.ff5fa2.0.-.3.ff5fa2.0.ffd54a.0.ff5fa2.0.7',
    'ffe6d8.1.e9eef6.-.1.3c9a64.0.1.0.1.5.6cc6ff.2.ffffff.0.ffe58a.6.ffffff.-.-.-.-.0.ffffff.1.dde3ec.0.ffd43b.0.ffd43b.1.ffd43b.0.-.0.7',
    'f0c3a0.3.a0592d.-.0.2fb5b0.0.0.0.0.7.ffd43b.0.ffffff.2.ff8cc6.0.ffffff.-.-.-.-.2.ff6b6b.0.ff6b6b.0.ff6b6b.4.ff6b6b.0.ffd54a.0.-.0.7',
    'e4ae86.4.9c7bff.c9a2ff.2.2e1e14.1.1.0.3.4.3a1f4d.0.ffd43b.1.e64980.0.ffd43b.5.3a1f4d.4.ffd43b.4.ffffff.b.ffd43b.0.-.0.3a1f4d.0.dde3ec.0.-.0.7',
    'a96c45.8.c99a5b.-.0.3f7ac9.1.1.0.2.2.3a1f4d.3.ff5fa2.3.9c7bff.0.ff5fa2.-.-.-.-.2.ffffff.0.ffd43b.0.-.1.ffd43b.1.ffd43b.5.ffd43b.0.7',
    'a96c45.1.d9762f.-.2.8b6bd6.0.1.1.3.5.ff5fa2.0.ffd1e6.1.9c7bff.0.ffd1e6.-.-.-.-.3.ffd43b.a.ffd43b.0.ffd43b.3.ff5fa2.4.ffd43b.0.-.0.7',
    'c3845a.1.ff8cc6.-.0.3f7ac9.1.1.0.0.4.ff8cc6.0.fff4e0.3.e6ddff.0.fff4e0.3.ff8cc6.2.fff4e0.5.ffffff.0.9c7bff.0.-.0.9c7bff.2.9c7bff.0.9c7bff.0.7',
    'e4ae86.1.ff5fa2.9c7bff.0.5a3a28.1.1.0.3.6.ffc9a8.6.ffffff.2.ffd1e6.0.ffffff.4.ffc9a8.0.ffffff.1.ff6b6b.7.ff6b6b.1.-.5.ff6b6b.0.ff6b6b.0.ff6b6b.0.7',
  ],
  boy: [
    'd69b6e.e.a0592d.-.0.3c9a64.0.1.0.0.3.ffa94d.4.ffe58a.7.4d7cff.0.ffe58a.-.-.-.-.2.ffa94d.b.ffa94d.0.-.6.ffa94d.0.ffa94d.7.ff6b6b.1.j',
    '8c5535.c.eacb86.-.1.e0569a.0.1.0.1.a.3a1f4d.0.ffffff.5.6b7280.0.ffffff.-.-.-.-.0.ffffff.g.3a1f4d.0.-.5.3a1f4d.5.ffd54a.8.-.0.2j',
    'f6d2b8.6.7a4a2a.-.2.3f7ac9.0.0.0.2.8.3a1f4d.8.ffffff.5.222230.0.ffffff.-.-.-.-.0.6cc6ff.0.222230.0.-.5.222230.3.6cc6ff.0.-.1.2b',
    '8c5535.d.7fd3ff.-.2.e0569a.0.0.0.1.9.b8f2a0.b.ffffff.2.8b5e3c.0.ffffff.-.-.-.-.7.ffffff.0.b8f2a0.0.ffa94d.5.b8f2a0.0.ffd54a.0.ffa94d.0.1b',
    '8c5535.g.f7e7b7.-.1.5a3a28.0.1.0.1.9.7048e8.4.6cc6ff.8.6b7280.0.6cc6ff.-.-.-.-.1.ffffff.d.6b7280.0.ffd43b.0.ffd43b.0.7048e8.4.ffd43b.0.2',
    '51301e.e.e9eef6.-.0.5a3a28.0.0.0.1.0.ffa94d.0.ffe58a.2.4d7cff.0.ffe58a.-.-.-.-.8.ffa94d.0.4d7cff.0.-.5.ffe58a.0.ffd54a.0.ffe58a.1.2q',
    'f0c3a0.c.d9762f.-.2.3f7ac9.0.1.0.2.8.4d7cff.3.ffffff.5.6b7280.0.ffffff.-.-.-.-.1.ffffff.e.6b7280.4.-.0.6b7280.0.ffd43b.0.-.1.2f',
    'ffe6d8.f.d9762f.9c7bff.0.2e1e14.0.0.1.0.8.ff6b6b.7.ffffff.8.ffffff.0.ffffff.-.-.-.-.0.ffffff.0.ffd43b.0.ffd43b.0.ffd43b.0.ff6b6b.0.-.1.23',
    'a96c45.f.ff5fa2.-.0.2fb5b0.0.0.0.1.a.3fd8b0.a.ffffff.4.4d7cff.0.ffffff.-.-.-.-.6.ffffff.g.ffd43b.0.ffd43b.6.4d7cff.0.ffd54a.0.ffd43b.1.1a',
    '51301e.c.1f1614.-.1.3c9a64.0.0.0.3.8.ff6b6b.0.ffffff.4.ffe58a.0.ffffff.-.-.-.-.4.ffe58a.d.ff6b6b.2.ffe58a.4.ffe58a.3.ff6b6b.0.ffe58a.0.13',
    'd69b6e.h.d9762f.-.1.8b6bd6.0.1.1.1.9.ff6b6b.0.ffe58a.2.4d7cff.0.ffe58a.-.-.-.-.6.4d7cff.0.4d7cff.0.ffe58a.0.ffe58a.5.ff6b6b.3.-.1.1m',
    'ffe6d8.i.d9762f.-.0.3f7ac9.0.0.0.3.0.6cc6ff.0.ffffff.8.ffffff.0.ffffff.-.-.-.-.4.ffffff.d.ffd43b.0.ffd43b.0.ffd43b.0.ffd43b.5.ffd43b.0.v',
    'a96c45.h.d9762f.-.0.2e1e14.0.1.0.2.0.ffa94d.7.ffffff.2.3a1f4d.0.ffffff.-.-.-.-.0.3a1f4d.b.ffe58a.1.-.0.3a1f4d.0.ffe58a.6.ffe58a.1.1t',
    'e4ae86.6.f7e7b7.-.2.5a3a28.0.1.0.3.8.6bd68a.4.ffffff.8.6b7280.0.ffffff.-.-.-.-.8.6bd68a.b.ffe58a.0.ffe58a.5.ffe58a.6.ffe58a.0.-.1.25',
    'e4ae86.d.1f1614.-.0.8b6bd6.0.1.1.3.a.6cc6ff.4.ffffff.9.ffffff.0.ffffff.-.-.-.-.0.4d7cff.0.4d7cff.0.4d7cff.0.6cc6ff.5.6cc6ff.3.4d7cff.0.6',
    'd69b6e.6.3b2419.-.0.3c9a64.0.0.0.1.0.ffa94d.0.ffffff.9.ffe58a.0.ffffff.-.-.-.-.6.ffe58a.0.ffe58a.0.ffe58a.6.ffe58a.0.ffe58a.0.ffe58a.0.1y',
    '8c5535.d.7a4a2a.-.0.2e1e14.0.0.0.1.b.3a1f4d.8.6cc6ff.4.222230.0.6cc6ff.-.-.-.-.2.ffffff.g.6cc6ff.0.-.0.6cc6ff.0.3a1f4d.8.6cc6ff.0.1p',
    'e4ae86.f.3b2419.-.0.3f7ac9.0.1.0.2.9.8b5e3c.0.ffe58a.8.ffe58a.0.ffe58a.-.-.-.-.1.ffe58a.0.ffe58a.0.-.0.ffe58a.0.8b5e3c.7.-.0.b',
    'f6d2b8.e.d9762f.-.1.3c9a64.0.1.1.2.6.4d7cff.7.ffffff.7.3a1f4d.0.ffffff.-.-.-.-.0.ffd43b.g.ffd43b.0.-.0.ffd43b.0.4d7cff.0.ffd43b.0.k',
    'f0c3a0.c.9c7bff.-.0.7c8b96.0.1.0.1.2.3a1f4d.0.6cc6ff.8.222230.0.6cc6ff.-.-.-.-.2.3a1f4d.0.222230.0.6cc6ff.0.6cc6ff.0.6cc6ff.3.6cc6ff.1.b',
  ],
  mix: [
    'f0c3a0.2.9c7bff.-.1.5a3a28.1.1.0.0.5.ffd1e6.0.ffffff.2.b8e1ff.0.ffffff.-.-.-.-.0.b8e1ff.3.dde3ec.0.-.0.b8e1ff.0.dde3ec.0.-.0.7',
    'e4ae86.i.eacb86.5fe3c0.0.2fb5b0.1.1.1.0.2.e64980.3.ffd1e6.5.9c7bff.0.ffd1e6.-.-.-.-.4.ffd1e6.5.ffd1e6.0.ffd1e6.4.9c7bff.0.ffd1e6.5.ffd1e6.0.7',
    'e4ae86.d.3b2419.c9a2ff.0.8b6bd6.1.1.0.0.1.ff8cc6.2.ffffff.1.c3a6ff.3.ffffff.-.-.-.-.5.9c7bff.9.9c7bff.2.-.0.9c7bff.0.9c7bff.0.9c7bff.0.7',
    '8c5535.8.c9a2ff.-.1.8b6bd6.0.0.0.1.4.e64980.2.ffd1e6.4.7048e8.2.ffd1e6.5.e64980.0.ffd1e6.6.ffffff.7.dde3ec.4.ffd43b.0.7048e8.0.ffd54a.0.ffd43b.0.7',
    'e4ae86.h.eacb86.-.0.8b6bd6.1.1.1.3.3.ffc9a8.0.ffffff.6.ffd1e6.0.ffffff.-.-.-.-.4.ffffff.c.ff6b6b.4.ff6b6b.3.ff6b6b.0.ffd54a.0.ff6b6b.0.7',
    'a96c45.9.9c7bff.r.1.2e1e14.0.0.0.3.7.ffd1e6.6.ffffff.1.c3a6ff.0.ffffff.5.ffd1e6.6.ffffff.3.9c7bff.3.9c7bff.0.-.0.9c7bff.0.dde3ec.0.9c7bff.0.7',
    'f6d2b8.e.c99a5b.-.1.2e1e14.0.1.0.1.8.ff6b6b.0.ffffff.4.6b7280.0.ffffff.-.-.-.-.1.ffffff.e.6b7280.4.-.0.6b7280.0.ffd43b.0.-.0.2f',
    'ffe6d8.a.1f1614.-.0.2e1e14.0.0.1.0.c.ffa94d.7.ffffff.4.ffe58a.0.ffffff.-.-.-.-.0.ffe58a.0.ff6b6b.0.ff6b6b.0.ff6b6b.0.ffa94d.0.-.1.23',
    'c3845a.5.c99a5b.-.2.8a6a2e.0.0.0.2.3.b8f2a0.7.ffa94d.9.6b7280.0.ffa94d.-.-.-.-.6.ffffff.g.6bd68a.0.6bd68a.6.6b7280.0.ffd54a.0.6bd68a.0.2f',
    '51301e.5.ff5fa2.-.2.2fb5b0.1.1.0.2.0.e6ddff.5.ff5fa2.6.ffd43b.0.ff5fa2.0.e6ddff.5.ff5fa2.2.ffd43b.7.ff5fa2.1.ff5fa2.0.ffd43b.4.dde3ec.0.-.0.7',
    'f6d2b8.3.eacb86.-.0.3c9a64.1.1.1.2.4.b8f2a0.3.fff4e0.3.ffe58a.4.fff4e0.3.b8f2a0.0.fff4e0.5.ffd43b.9.ffe58a.0.ffd43b.0.b8f2a0.0.dde3ec.0.-.0.7',
    'e4ae86.9.c99a5b.e9eef6.2.7c8b96.0.0.0.0.a.ff6b6b.7.ffffff.7.6b7280.0.ffffff.-.-.-.-.0.ffd43b.b.ffd43b.2.-.0.ff6b6b.0.ffd54a.0.-.1.17',
    'e4ae86.a.eacb86.-.1.2e1e14.1.1.0.1.4.e64980.0.ffffff.6.7048e8.0.ffffff.2.e64980.0.ffffff.3.ffffff.1.ffd43b.0.-.0.ffd43b.0.ffd54a.0.ffd43b.0.7',
    'ffe6d8.e.e9eef6.-.0.2e1e14.0.1.0.0.a.8b5e3c.0.ffffff.2.6b7280.0.ffffff.-.-.-.-.8.8b5e3c.b.ffe58a.0.ffe58a.5.ffe58a.6.ffe58a.0.-.0.25',
    'e4ae86.0.a0592d.-.2.8a6a2e.0.1.0.3.d.6bd68a.0.ffe58a.4.6b7280.0.ffe58a.-.-.-.-.0.ffe58a.0.ffe58a.0.ffe58a.0.6bd68a.5.6bd68a.3.ffe58a.0.6',
    'e4ae86.7.9c7bff.c9a2ff.2.2e1e14.1.1.0.3.4.a5f0e6.0.ffffff.1.c3a6ff.0.ffffff.-.-.-.-.4.c3a6ff.1.c3a6ff.4.-.0.a5f0e6.0.dde3ec.0.-.0.7',
    '8c5535.5.c9a2ff.-.1.8b6bd6.1.1.0.2.2.a5f0e6.0.e6ddff.4.9c7bff.0.e6ddff.3.a5f0e6.0.e6ddff.3.ff8cc6.8.dde3ec.1.-.0.9c7bff.0.ffd54a.4.ff8cc6.0.7',
    'c3845a.3.d9762f.-.1.7c8b96.1.0.0.3.b.ff6b6b.0.ffe58a.4.3a1f4d.0.ffe58a.-.-.-.-.8.ffffff.0.ffe58a.0.-.0.ffe58a.0.ff6b6b.7.-.1.24',
    'd69b6e.a.eacb86.-.1.7c8b96.1.1.0.2.a.6cc6ff.0.ffffff.7.3a1f4d.0.ffffff.-.-.-.-.0.ffd43b.g.ffd43b.0.-.0.ffd43b.0.6cc6ff.0.ffd43b.0.k',
    'e4ae86.2.ff5fa2.9c7bff.0.5a3a28.1.1.0.3.6.ff5fa2.6.ffffff.2.7048e8.0.ffffff.-.-.-.-.1.ffffff.3.ffd43b.0.ffd43b.5.7048e8.4.dde3ec.0.-.0.7',
  ],
};
const OLD_NORMAL_669 = '{\"name\":\"Maya\",\"skin\":\"#F6D2B8\",\"hair\":{\"style\":\"side_pony\",\"color\":\"#7A4A2A\",\"color2\":null,\"mix\":\"ombre\"},\"eyes\":{\"color\":\"#5A3A28\",\"lashes\":true},\"face\":{\"blush\":true,\"freckles\":false,\"smile\":\"happy\",\"brows\":\"soft\"},\"top\":{\"type\":\"tshirt\",\"color\":\"#FF8CC6\",\"pattern\":\"hearts\",\"patternColor\":\"#FFFFFF\",\"num\":7},\"bottom\":{\"type\":\"skirt\",\"color\":\"#8E7CFF\",\"pattern\":\"none\",\"patternColor\":\"#FFFFFF\"},\"dress\":{\"type\":\"mermaid\",\"color\":\"#3FD8B0\",\"pattern\":\"flowers\",\"patternColor\":\"#FFFFFF\"},\"shoes\":{\"type\":\"sandals\",\"color\":\"#FF8CC6\"},\"acc\":{\"head\":\"sun_hat\",\"headColor\":\"#FF8CC6\",\"face\":\"sunglasses\",\"faceColor\":\"#FF5FA2\",\"back\":\"none\",\"backColor\":\"#B8E1FF\",\"neck\":\"none\",\"neckColor\":\"#FFD54A\",\"hand\":\"ice_cream\",\"handColor\":\"#FFD1E6\"}}';

// ---------- harness ----------

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
    console.log(`  FAIL ${name}: ${err && err.stack ? err.stack : err}`);
  }
}

// ---------- A: looks, lists and the codec ----------

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const STYLES = ['girl', 'boy', 'mix', null];
const starters = () => W.STARTER_OUTFITS.map((o) => ({ o, look: W.applyOutfit(W.DEFAULT_LOOK, o) }));

await test('A1 every existing list still starts with its 669 keys; the sea lists are exact', () => {
  for (const [k, keys] of Object.entries(OLD_KEYS_669)) {
    const now = W[k].map((o) => o.key);
    assert(eq(now.slice(0, keys.length), keys), k);
    assert(W[k].length < 36, k + ' under 36');
  }
  assert(eq(W.SEA_FORMS.map((o) => o.key), ['auto', 'mermaid', 'sea_dragon', 'me']), 'SEA_FORMS keys');
  assert(eq(W.SEA_COLORS, ['#3FD8B0', '#6CC6FF', '#4D7CFF', '#9C7BFF', '#FF8CC6', '#FF5FA2', '#FF6B6B', '#FFA94D', '#FFD43B', '#6BD68A', '#2FB5B0', '#E6DDFF']), 'SEA_COLORS');
  assert(W.SEA_COLOR_NAMES.length === W.SEA_COLORS.length, 'a name per color');
  assert(W.SEA_FORMS.length < 36 && W.SEA_COLORS.length < 36, 'one base-36 digit each');
});

await test('A2 the default sea, the old fixture look, freshLook', () => {
  assert(eq(W.DEFAULT_LOOK.sea, { form: 'auto', color: null }), 'DEFAULT_LOOK.sea');
  const n = W.normalizeLook(FIXTURE.look);
  assert(eq(n.sea, { form: 'auto', color: null }), 'old look gains the default sea');
  delete n.sea;
  assert(JSON.stringify(n) === OLD_NORMAL_669, 'normalized fixture look is otherwise the same');
  assert(W.freshLook({ look: W.DEFAULT_LOOK }) === true, 'freshLook(DEFAULT_LOOK)');
  assert(W.freshLook({ look: { ...W.DEFAULT_LOOK, sea: undefined } }) === true, 'freshLook without sea');
});

await test('A3 the default, the starters and 60 seeded surprises pack exactly as before', () => {
  assert(codec.packLook(W.DEFAULT_LOOK) === OLD_DEFAULT_TOKEN_669, 'default');
  assert(OLD_DEFAULT_TOKEN_669.length === 126, 'the default is 126 characters');
  W.STARTER_OUTFITS.forEach((o, i) => assert(codec.packLook(W.applyOutfit(W.DEFAULT_LOOK, o)) === OLD_STARTERS_669[i], 'starter ' + o.key));
  for (const style of ['girl', 'boy', 'mix']) {
    for (let s = 1; s <= 20; s++) {
      assert(codec.packLook(W.randomLook(mulberry32(s), 'Zoe', null, style)) === OLD_RANDOM_669[style][s - 1], `${style} seed ${s}`);
    }
  }
});

await test('A4 every form x every color (and Match) round-trips within 160; the worst case is 156', () => {
  for (const f of W.SEA_FORMS) {
    for (const c of [null, ...W.SEA_COLORS]) {
      const l = W.normalizeLook({ ...W.DEFAULT_LOOK, name: 'Mia', sea: { form: f.key, color: c } });
      const p = codec.packLook(l);
      assert(p.length <= 160, 'length ' + p.length);
      assert(eq(codec.unpackLook(p, 'Mia'), l), `round trip ${f.key} ${c}`);
    }
  }
  // A4b the worst case: every optional color, a dress, number 99, a sea dragon in Pearl
  const worst = W.normalizeLook({
    ...W.DEFAULT_LOOK, name: 'Mia',
    hair: { style: 'afro', color: '#FFFFFF', color2: '#FFFFFF', mix: 'tips' },
    top: { type: 'tee_bolt', color: '#FFFFFF', pattern: 'rockets', patternColor: '#FFFFFF', num: 99 },
    bottom: { type: 'pants', color: '#FFFFFF', pattern: 'rockets', patternColor: '#FFFFFF' },
    dress: { type: 'mermaid', color: '#FFFFFF', pattern: 'rockets', patternColor: '#FFFFFF' },
    shoes: { type: 'skate_shoes', color: '#FFFFFF' },
    acc: { head: 'headphones', headColor: '#FFFFFF', face: 'star_glasses', faceColor: '#FFFFFF', back: 'star_pack', backColor: '#FFFFFF', neck: 'medal', neckColor: '#FFFFFF', hand: 'dino_toy', handColor: '#FFFFFF' },
    sea: { form: 'sea_dragon', color: '#E6DDFF' },
  });
  const wl = codec.packLook(worst).length;
  assert(wl === 156, 'worst case ' + wl);
  assert(eq(codec.unpackLook(codec.packLook(worst), 'Mia'), worst), 'worst round trip');
  // 3,000 random looks per style with a random sea stay within 160
  const rnd = mulberry32(7);
  let max = 0;
  for (const style of ['girl', 'boy', 'mix']) {
    for (let i = 0; i < 3000; i++) {
      const l = W.randomLook(rnd, 'Zoe', null, style);
      l.sea = { form: W.SEA_FORMS[Math.floor(rnd() * 4)].key, color: rnd() < 0.2 ? null : W.SEA_COLORS[Math.floor(rnd() * 12)] };
      max = Math.max(max, codec.packLook(l).length);
    }
  }
  assert(max <= 160, 'random max ' + max);
  return `worst ${wl}, random max ${max}`;
});

await test('A5 old strings and broken tokens unpack to auto / Match', () => {
  const toks = OLD_DEFAULT_TOKEN_669.split('.');
  assert(toks.length === 36, '36 tokens');
  assert(eq(codec.unpackLook(OLD_DEFAULT_TOKEN_669, 'Lily').sea, { form: 'auto', color: null }), '36-token string');
  assert(eq(codec.unpackLook(toks.slice(0, 34).join('.'), 'Lily').sea, { form: 'auto', color: null }), '34-token string');
  assert(eq(codec.unpackLook(OLD_DEFAULT_TOKEN_669 + '.0.-', 'Lily').sea, { form: 'auto', color: null }), 'placeholders .0.-');
  assert(eq(codec.unpackLook(OLD_DEFAULT_TOKEN_669 + '.2.zz', 'Lily').sea, { form: 'sea_dragon', color: null }), 'broken color zz');
  assert(eq(codec.unpackLook(OLD_DEFAULT_TOKEN_669 + '.2r.4', 'Lily').sea, { form: 'auto', color: '#FF8CC6' }), 'form index 99');
  assert(codec.unpackLook(OLD_DEFAULT_TOKEN_669 + '.1.4', 'Lily').sea.form === 'mermaid', 'mermaid token');
  assert(eq(codec.unpackLook(OLD_DEFAULT_TOKEN_669 + '.1.4', 'Lily'), W.normalizeLook({ ...W.DEFAULT_LOOK, sea: { form: 'mermaid', color: '#FF8CC6' } })), 'the rest of the look is the same');
});

await test('A6 resolveSeaForm and withResolvedSea', () => {
  const d = W.DEFAULT_LOOK;
  assert(R.resolveSeaForm(d, 'girl') === 'mermaid' && R.resolveSeaForm(d, 'mix') === 'mermaid', 'girl / mix');
  assert(R.resolveSeaForm(d, 'boy') === 'sea_dragon', 'boy');
  assert(R.resolveSeaForm(d, null) === 'mermaid', 'default, no style');
  for (const { o, look } of starters()) {
    const want = W.lookFits(look, 'b') && !W.lookFits(look, 'g') ? 'sea_dragon' : 'mermaid';
    assert(R.resolveSeaForm(look, null) === want, 'starter ' + o.key);
    if (o.tag === 'g') assert(want === 'mermaid', 'girl starter ' + o.key);
    if (o.tag === 'b') assert(want === 'sea_dragon', 'boy starter ' + o.key);
  }
  for (const form of ['mermaid', 'sea_dragon', 'me']) {
    for (const st of STYLES) {
      const l = W.normalizeLook({ ...d, sea: { form, color: null } });
      assert(R.resolveSeaForm(l, st) === form, `${form} under ${st}`);
      assert(R.withResolvedSea(l, st).sea.form === form, 'withResolvedSea explicit');
    }
  }
  for (const st of STYLES) for (const { look } of starters()) assert(R.withResolvedSea(look, st).sea.form !== 'auto', 'never auto');
});

await test('A6b withResolvedSea never mutates its input', () => {
  for (const st of STYLES) {
    for (const { look } of starters()) {
      const before = JSON.parse(JSON.stringify(look));
      R.withResolvedSea(look, st);
      assert(eq(look, before), 'mutated');
    }
  }
});

await test('A6c Match gives a bright sea color for the default and every starter', () => {
  const dull = new Set(['#FFFFFF', '#6B7280', '#8B5E3C', '#222230', '#3A1F4D']);
  const looks = [{ o: { key: 'default', tag: 'g' }, look: W.normalizeLook(W.DEFAULT_LOOK) }, ...starters()];
  for (const { o, look } of looks) {
    for (const form of ['mermaid', 'sea_dragon']) {
      const c = R.seaColorOf(look, form);
      assert(W.SEA_COLORS.includes(c), `${o.key} ${form}: ${c}`);
      assert(!dull.has(c), 'dull ' + c);
    }
  }
  for (const c of W.SEA_COLORS) assert(R.snapSeaColor(c, 'mermaid') === c, 'exact stays ' + c);
  assert(R.seaColorOf(W.normalizeLook({ ...W.DEFAULT_LOOK, sea: { form: 'auto', color: '#FFD43B' } }), 'mermaid') === '#FFD43B', 'own color wins');
  const names = Object.fromEntries(W.SEA_COLORS.map((c, i) => [c, W.SEA_COLOR_NAMES[i]]));
  return looks.map(({ o, look }) => `${o.key} ${names[R.seaColorOf(look, R.resolveSeaForm(look, null))]}`).join(', ');
});

await test('A7 randomLook keeps base.sea and calls rand() the same number of times', () => {
  const base = W.normalizeLook({ ...W.DEFAULT_LOOK, sea: { form: 'sea_dragon', color: '#FFD43B' } });
  for (const style of ['girl', 'boy', 'mix']) {
    for (let s = 1; s <= 20; s++) {
      assert(eq(W.randomLook(mulberry32(s), 'Zoe', base, style).sea, base.sea), 'keeps sea ' + style);
      assert(eq(W.randomLook(mulberry32(s), 'Zoe', null, style).sea, { form: 'auto', color: null }), 'default sea ' + style);
      let n1 = 0, n2 = 0;
      const r1 = mulberry32(s), r2 = mulberry32(s);
      W.randomLook(() => { n1++; return r1(); }, 'Zoe', base, style);
      W.randomLook(() => { n2++; return r2(); }, 'Zoe', W.normalizeLook(W.DEFAULT_LOOK), style);
      assert(n1 === n2, 'same rand() count');
    }
  }
});

await test('A8 lookFits ignores sea', () => {
  for (const { look } of starters()) {
    for (const form of ['auto', 'mermaid', 'sea_dragon', 'me']) {
      const l = { ...look, sea: { form, color: '#FF8CC6' } };
      assert(W.lookFits(l, 'g') === W.lookFits(look, 'g') && W.lookFits(l, 'b') === W.lookFits(look, 'b'), 'fits ' + form);
    }
  }
});

await test('A9 normalizeLook rejects bad sea values', () => {
  const n = (sea) => W.normalizeLook({ ...W.DEFAULT_LOOK, sea }).sea;
  assert(n({ form: 'mermaid', color: '#123456' }).color === null, 'non-palette color');
  assert(n({ form: 'shark', color: null }).form === 'auto', 'unknown form');
  assert(eq(n(5), { form: 'auto', color: null }), 'sea: 5');
  assert(eq(n(null), { form: 'auto', color: null }), 'sea: null');
  assert(n({ form: 'me', color: '#ff8cc6' }).color === '#FF8CC6', 'lower case color upper-cased');
});

// ---------- A10, A11: the gate and the depth ----------

await test('A10 SeaGate tables', () => {
  const run = (g, secs, f, dt = 0.01) => {
    const ev = [];
    for (let t = 0; t < secs - 1e-9; t += dt) { const e = g.step(dt, f); if (e) ev.push(e); }
    return ev;
  };
  let g = new R.SeaGate();
  assert(run(g, 10, { deep: false, swimming: true, onGround: false }).length === 0, 'a puddle never turns');
  g = new R.SeaGate();
  assert(run(g, 0.24, { deep: true, swimming: true }).length === 0, '0.24 s does not turn');
  g = new R.SeaGate();
  assert(eq(run(g, 0.26, { deep: true, swimming: true }), ['in']), '0.26 s turns');
  // 50 surface bobs: swimming false for 0.2 s each
  const ev = [];
  for (let i = 0; i < 50; i++) {
    ev.push(...run(g, 0.2, { deep: false, swimming: false, onGround: false }));
    ev.push(...run(g, 0.3, { deep: true, swimming: true, onGround: false }));
  }
  assert(ev.length === 0, 'bobs keep it: ' + ev.join(','));
  assert(run(g, 1.2, { deep: false, swimming: false, onGround: false }).length === 0, 'a 1.2 s leap keeps it');
  run(g, 0.1, { deep: true, swimming: true });
  assert(eq(run(g, 0.36, { deep: false, swimming: false, onGround: true }), ['out']), '0.35 s on land turns back');
  g = new R.SeaGate();
  run(g, 0.3, { deep: true, swimming: true });
  assert(g.step(0.01, { blocked: true }) === 'cut' && !g.on, 'blocked cuts at once');
  assert(g.step(0.01, { blocked: true }) === null, 'blocked while off: nothing');
  g = new R.SeaGate();
  g.force();
  assert(g.on, 'force');
  g = new R.SeaGate();
  for (const dt of [NaN, Infinity, -1, -Infinity]) assert(g.step(dt, { deep: true, swimming: true }) === null, 'bad dt ' + dt);
  assert(!g.on, 'bad dt never turns');
});

await test('A11 seaDeep and depthBelow on a fake grid', () => {
  // water cells: y 0..(depth-1); liquid(x,y,z)
  const grid = (depth) => (x, y, z) => y >= 0 && y < depth;
  assert(!R.seaDeep(grid(1), 0.5, 0.0, 0.5), '1 deep standing');
  assert(R.seaDeep(grid(2), 0.5, 0.0, 0.5) === true, '2 deep standing (head height)');
  assert(R.seaDeep(grid(4), 0.5, 2.9, 0.5) === true, 'floating, cell under the feet liquid');
  assert(!R.seaDeep(grid(4), 0.5, 3.5, 0.5), 'waist out');
  assert(R.depthBelow(grid(4), 0.5, 3.9, 0.5) === 4 && R.depthBelow(grid(10), 0.5, 9.5, 0.5) === 4, 'capped at 4');
  assert(R.depthBelow(grid(4), 0.5, 2.5, 0.5) === 3, 'three below');
  assert(R.depthBelow(grid(4), 0.5, 0.2, 0.5) === 0, 'on the floor');
  assert(R.depthBelow(grid(10), 0.5, 9.5, 0.5, 2) === 2, 'cap 2');
});

// ---------- A14: the shore exit on the real Physics.move ----------

const AIR = 0, STONE = 1, WATER = 2;
const props = {
  solid: Uint8Array.from([0, 1, 0]),
  shape: Uint8Array.from([SHAPES.air, SHAPES.cube, SHAPES.liquid]),
  replaceable: Uint8Array.from([1, 0, 1]),
};
class FakeWorld {
  constructor(sx = 40, sy = 24, sz = 40) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.blocks = new Uint8Array(sx * sy * sz);
    this.registry = { props };
  }
  get(x, y, z) {
    if (y < 0) return STONE;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y >= this.sy) return AIR;
    return this.blocks[(y * this.sz + z) * this.sx + x];
  }
  set(x, y, z, id) {
    if (x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz) this.blocks[(y * this.sz + z) * this.sx + x] = id;
  }
  fill(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
  }
}
const TOP = 10; // the water's top surface (water cells y <= 9) and the land top

/** A sea toward -z, the land (top = TOP) from z = 30. profile(z) -> seabed top for z < 30. */
function shoreWorld(profile) {
  const w = new FakeWorld();
  for (let z = 0; z < w.sz; z++) {
    const bed = z >= 30 ? TOP : profile(z);
    w.fill(0, 0, z, w.sx - 1, bed - 1, z, STONE);
    if (bed < TOP) w.fill(0, bed, z, w.sx - 1, TOP - 1, z, WATER);
  }
  return w;
}

/**
 * The player's sea-swimming step (player.js update, §6.2) on the real Physics: the gate, the
 * sea speed, seaVy, physics.move({ swim }), the ledge hop. Holds `input` every frame.
 */
function swimmer(world, x, y, z) {
  const physics = new Physics(world, new Set());
  const liq = (a, b, c) => physics.liquidAt(a, b, c);
  const pos = { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } };
  const vel = { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; } };
  const body = { pos, vel, halfW: 0.3, height: 1.7, onGround: false };
  const gate = new R.SeaGate();
  gate.force();
  const st = { idleVT: R.BUOY_DELAY, hopT: 0 };
  let onGround = false, seaSwim = true;
  return {
    pos, vel, get seaSwim() { return seaSwim; }, get onGround() { return onGround; },
    step(dt, input) {
      const swimming = liq(pos.x, pos.y + 0.6, pos.z);
      const deep = R.seaDeep(liq, pos.x, pos.y, pos.z);
      const ev = gate.step(dt, { deep, swimming, onGround, blocked: false });
      if (ev === 'in') { seaSwim = true; st.idleVT = R.BUOY_DELAY; } else if (ev === 'out') seaSwim = false;
      const sea = seaSwim && swimming;
      const speed = sea ? R.SEA_SWIM : swimming ? 2.8 : 4.3;
      const k = Math.min(1, (onGround || swimming ? 14 : 5) * dt);
      vel.x += (0 - vel.x) * k;
      vel.z += (input.fwd * speed - vel.z) * k;
      if (sea) vel.y = R.seaVy(st, { dt, vy: vel.y, up: false, down: input.down, fpWant: 0, deep, chestWet: liq(pos.x, pos.y + R.BUOY_PROBE, pos.z), gravity: 24 });
      else if (swimming) { vel.y -= 5 * dt; vel.y = Math.max(vel.y, -2.2); } else vel.y = Math.max(vel.y - 24 * dt, -40);
      const res = physics.move(body, dt, { step: true, swim: sea });
      onGround = res.onGround;
      if (res.ledge !== null && input.fwd > 0.3 && (onGround || sea)) {
        const jv = Math.sqrt(2 * 24 * 1.3);
        vel.y = (sea ? R.hopVy(res.ledge - pos.y, 24, jv) : jv * 0.92) + 24 * dt * 0.5;
        if (sea) st.hopT = R.HOP_HOLD;
      }
      if (!Number.isFinite(pos.y)) throw new Error('y not finite');
    },
    onLand() { return pos.z >= 30 && pos.y >= TOP - 0.01 && !liq(pos.x, pos.y + 0.6, pos.z); },
  };
}

function exitTime(world, z0, y0, fps, input, limit) {
  const s = swimmer(world, 20.5, y0, z0);
  const dt = 1 / fps;
  for (let t = 0; t < limit; t += dt) {
    s.step(dt, input);
    if (s.onLand()) return t;
  }
  return Infinity;
}

await test('A14 shore exit holding only forward (60 and 30 fps, surface, mid-water, floor)', () => {
  // 3 deep, the seabed rising in 1-block steps toward the land
  const w = shoreWorld((z) => (z < 24 ? TOP - 3 : z < 27 ? TOP - 2 : TOP - 1));
  const times = [];
  for (const fps of [60, 30]) {
    for (const [y0, name] of [[TOP - 1.0, 'surface'], [TOP - 2.2, 'mid-water'], [TOP - 3, 'floor']]) {
      const t = exitTime(w, 23.5, y0, fps, { fwd: 1, down: false }, 6);
      assert(t <= 2, `${name} at ${fps} fps: ${t.toFixed(2)} s`);
      times.push(`${name}@${fps} ${t.toFixed(2)}`);
    }
  }
  // straight from 3-deep water to the bank (a 1-block step up from the surface)
  const steep = shoreWorld(() => TOP - 3);
  for (const fps of [60, 30]) {
    const t = exitTime(steep, 27.5, TOP - 1.0, fps, { fwd: 1, down: false }, 6);
    assert(t <= 2, `steep bank at ${fps} fps: ${t}`);
    const tf = exitTime(steep, 27.5, TOP - 3, fps, { fwd: 1, down: false }, 6);
    assert(tf <= 2.5, `steep bank from the floor at ${fps} fps: ${tf}`);
    times.push(`steep@${fps} ${t.toFixed(2)}/${tf.toFixed(2)}`);
  }
  return times.join(', ');
});

await test('A14 an underwater 1-block step, a pond rim 1 above, Down + forward, a 3-block cliff', () => {
  // underwater step: bed 4 deep then 3 deep, crossed within 1 s from the floor
  const w = shoreWorld((z) => (z < 20 ? TOP - 4 : TOP - 3));
  const s = swimmer(w, 20.5, TOP - 4, 18.6);
  let crossed = Infinity;
  for (let t = 0; t < 3; t += 1 / 60) {
    s.step(1 / 60, { fwd: 1, down: true });
    if (s.pos.z > 20.4) { crossed = t; break; }
  }
  assert(crossed <= 1, 'underwater step ' + crossed);
  // a pond rim one block above the water top: water to TOP - 1 (cells <= TOP - 2), land at TOP
  const pond = new FakeWorld();
  pond.fill(0, 0, 0, pond.sx - 1, TOP - 1, pond.sz - 1, STONE);
  pond.fill(17, TOP - 4, 17, 23, TOP - 1, 23, AIR);
  pond.fill(17, TOP - 4, 17, 23, TOP - 2, 23, WATER);
  const p = swimmer(pond, 20.5, TOP - 2.0, 20.5);
  let out = Infinity;
  for (let t = 0; t < 4; t += 1 / 60) {
    p.step(1 / 60, { fwd: 1, down: false });
    if (p.pos.z >= 24 && p.pos.y >= TOP - 0.01) { out = t; break; }
  }
  assert(out <= 2, 'pond rim ' + out);
  // holding Down + forward: still out within 2.5 s
  // (on the stepped seabed: holding Down she follows it up and still flops out)
  const w2 = shoreWorld((z) => (z < 24 ? TOP - 3 : z < 27 ? TOP - 2 : TOP - 1));
  const td = exitTime(w2, 23.5, TOP - 1.0, 60, { fwd: 1, down: true }, 6);
  assert(td <= 2.5, 'Down + forward ' + td);
  // a 3-block cliff: never climbed, never stuck oscillating out of range
  const cliff = new FakeWorld();
  cliff.fill(0, 0, 0, cliff.sx - 1, TOP - 4, cliff.sz - 1, STONE);
  cliff.fill(0, TOP - 3, 0, cliff.sx - 1, TOP - 1, 29, WATER);
  cliff.fill(0, TOP - 3, 30, cliff.sx - 1, TOP + 2, cliff.sz - 1, STONE);
  const c = swimmer(cliff, 20.5, TOP - 1, 27);
  for (let t = 0; t < 8; t += 1 / 60) {
    c.step(1 / 60, { fwd: 1, down: false });
    assert(Number.isFinite(c.pos.y) && c.pos.y < TOP + 3 && c.pos.z < 30, 'cliff climbed at ' + t.toFixed(2));
  }
  return `step ${crossed.toFixed(2)} s, pond ${out.toFixed(2)} s, Down ${td.toFixed(2)} s`;
});

// ---------- A12, A15: the tail mesh and texture ownership ----------

await test('A12 TailTube.deform with 10,000 random angle sets stays finite and in place', () => {
  const rnd = mulberry32(12);
  for (const form of ['mermaid', 'sea_dragon']) {
    const t = new TailTube(form, seaPalette('#3FD8B0'));
    const arr = t.posAttr.array, n = arr.length;
    const a = new Float32Array(7), b = new Float32Array(7);
    const wild = [NaN, Infinity, -Infinity, 1e9, -1e9];
    for (let k = 0; k < 10000; k++) {
      for (let i = 0; i < 7; i++) {
        a[i] = rnd() < 0.05 ? wild[Math.floor(rnd() * 5)] : (rnd() * 2 - 1) * 2;
        b[i] = rnd() < 0.05 ? wild[Math.floor(rnd() * 5)] : (rnd() * 2 - 1) * 2;
      }
      t.deform(a, b);
      if (k % 97 === 0) for (let i = 0; i < n; i++) assert(Number.isFinite(arr[i]), 'finite');
      assert(Number.isFinite(t.tipPos.x + t.tipPos.y + t.tipPos.z), 'tip finite');
      assert(Math.hypot(t.tipPos.x, t.tipPos.y + 0.02, t.tipPos.z) <= 1.0, 'tip within 1.0 of the root');
    }
    assert(t.posAttr.array === arr && arr.length === n && t.geometry.attributes.position.count === n / 3, 'same array, same count');
  }
  // frustumCulled is off on the tube and the fin (a bent tail never vanishes at screen edges)
  const av = createAvatar({ sea: { form: 'mermaid', color: null } });
  av.update(0.016, { sea: true, swimming: true, speed: 2 });
  av.update(0.5, { sea: true, swimming: true, speed: 2 });
  const p = av.seaParts();
  assert(p.built && p.shown && p.legsVisible === false, 'the tail shows, legs hidden');
  let culledOff = 0;
  av.group.traverse((o) => { if (o.isMesh && o.frustumCulled === false) culledOff++; });
  assert(culledOff >= 2, 'tube and fluke: frustumCulled false');
  av.dispose();
});

await test('A15 sea textures and materials are referenced once per avatar and all released', () => {
  const before = cacheStats();
  const l = (color) => W.normalizeLook({ ...W.DEFAULT_LOOK, sea: { form: 'sea_dragon', color } });
  const a = createAvatar(l('#3FD8B0')), b = createAvatar(l('#3FD8B0'));
  const swim = { sea: true, swimming: true, speed: 2 };
  a.update(0.5, swim); a.update(0.5, swim);
  b.update(0.5, swim); b.update(0.5, swim);
  assert(a.seaParts().built && b.seaParts().built, 'both built');
  const mid = cacheStats();
  a.dispose();
  for (let i = 0; i < 20; i++) {
    b.setLook(l(W.SEA_COLORS[i % 12])); // clearParts (disposeSea) + rebuild
    b.update(0.5, swim);
    assert(b.seaParts().built && b.seaParts().color === W.SEA_COLORS[i % 12], 'rebuilt ' + i);
    const st = cacheStats();
    assert(st.refs <= mid.refs, 'refs never grow: ' + st.refs + ' > ' + mid.refs);
  }
  // a form change while the tail is out swaps the parts without a leak
  b.setLook({ ...l('#FFD43B'), sea: { form: 'mermaid', color: '#FFD43B' } });
  b.update(0.5, swim);
  assert(b.seaParts().form === 'mermaid', 'mermaid now');
  b.dispose();
  const after = cacheStats();
  assert(after.refs === before.refs, `refs back to ${before.refs}: ${after.refs}`);
  return `refs ${before.refs} -> ${mid.refs} -> ${after.refs}`;
});

// ---------- A13: names ----------

// every player-facing string of the sea forms (merfolk.md §10.2), each checked to still be in the
// source, so this list cannot drift from what kids read
const SEA_STRINGS = {
  'src/ui/dressup.js': ['Water', 'Water: mermaid, sea dragon or just me', 'I swim as', 'Tail color', 'Match my clothes',
    'Splash! A mermaid tail!', 'Whoosh! A sea dragon!', 'Swimming as me!', 'Swim in deep water for a real tail!'],
  'src/player/merfolk/index.js': ['Mermaid', 'Sea Dragon', 'Just Me', ' magic!', 'Hold Down to dive!', 'Hold C to dive!',
    'Swim fast + Up = big leap!', 'Swim fast and press Up to leap like a dolphin!', 'Make it 2 deep for ', 'sea dragon', 'mermaid'],
  'src/ui/touch.js': ['Swim', 'In deep water: Up and Down to swim and dive', 'In deep water: Space up, C down, Shift fast'],
  'src/things/friends/chat.js': ['Whoa! Look at your tail!', "So sparkly! Let\\'s swim!", 'You swim so fast now!'],
};

await test('A13 the sea strings: no other company\'s names, no famous characters, no film words', () => {
  const all = [];
  for (const [file, list] of Object.entries(SEA_STRINGS)) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    for (const t of list) {
      assert(src.includes(t), `${file} still says "${t}"`);
      all.push(t.replace(/\\'/g, "'"));
    }
  }
  for (const o of W.SEA_FORMS) all.push(o.name);
  all.push(...W.SEA_COLOR_NAMES);
  for (const s of SEA_STICKERS) all.push(s.name, s.hint);
  for (const t of all) {
    assert(scanText(t, { extras: true }).length === 0, 'a forbidden name in: ' + t);
    assert(scanCharacters(t).length === 0, 'a famous character in: ' + t);
  }
  assert(extraWords('merfolk').length >= 5, "merfolk's own encoded words are in the shared scanner");
  const hits = scanFiles(EXTRA_SCOPE, { extras: true }).filter((m) => /merfolk|sea|dressup|friends|player|avatar/.test(m.file));
  assert(hits.length === 0, hits.map((m) => `${m.file}:${m.line}`).join(', '));
  return `${all.length} strings`;
});

// ---------- A16: Down without Shift ----------

await test('A16 input.downKey: Shift alone is not Down; C and the Down button are', () => {
  const fake = (keys, virt = {}) => {
    const o = {
      keys: new Set(keys), joy: { active: false }, enabled: true, move: { x: 0, z: 0 }, look: { dx: 0, dy: 0 },
      virtual: { jump: false, down: false, run: false, ...virt }, _latch: { jump: false, down: false, run: false },
      _checkStaleTouches() {}, pointers: new Map(),
    };
    Input.prototype.update.call(o);
    return o;
  };
  const sh = fake(['ShiftLeft']);
  assert(sh.down === true && sh.downKey === false && sh.run === true, 'Shift');
  assert(fake(['KeyC']).downKey === true, 'C');
  assert(fake([], { down: true }).downKey === true, 'the Down button');
  assert(fake([]).downKey === false, 'nothing');
});

console.log(`\n${passed} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
