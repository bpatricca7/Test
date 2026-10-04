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

// ---------- the goldens still hold ----------

await test('A1 every existing list still starts with its 669 keys', () => {
  for (const [k, keys] of Object.entries(OLD_KEYS_669)) {
    const now = W[k].map((o) => o.key);
    assert(JSON.stringify(now.slice(0, keys.length)) === JSON.stringify(keys), k);
  }
});

await test('A3 the default, the starters and 60 seeded surprises pack exactly as before', () => {
  assert(codec.packLook(W.DEFAULT_LOOK) === OLD_DEFAULT_TOKEN_669, 'default');
  W.STARTER_OUTFITS.forEach((o, i) => assert(codec.packLook(W.applyOutfit(W.DEFAULT_LOOK, o)) === OLD_STARTERS_669[i], 'starter ' + o.key));
  for (const style of ['girl', 'boy', 'mix']) {
    for (let s = 1; s <= 20; s++) {
      assert(codec.packLook(W.randomLook(mulberry32(s), 'Zoe', null, style)) === OLD_RANDOM_669[style][s - 1], `${style} seed ${s}`);
    }
  }
});

await test('A2 the old fixture look normalizes as before', () => {
  const n = W.normalizeLook(FIXTURE.look);
  delete n.sea;
  assert(JSON.stringify(n) === OLD_NORMAL_669, 'normalized fixture look');
});

console.log(`\n${passed} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
