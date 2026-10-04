// Squishy toys (wave 4, the squish team doc): the toy list, the present order, the milestone math
// and every string a kid reads. Pure: no three.js, no DOM (Node tests import it).
//
// Puffums are slow-rise foam toys; Stretchums are dough squeeze-and-stretch toys. They come only
// from mystery presents, which come at milestones of coins EARNED over time (spending never takes
// a present away, opening one never costs coins). Nothing is ever bought.

export { mergeSquish } from '../../core/squish-merge.js';

// APPEND ONLY. Keys are saved in profiles and worlds, sent as presence `hi`, and pinned by the
// golden list ITEMS_V1 in tools/test-squish.mjs. Never remove, rename or reorder an entry.
// { key, name, kind: 'puff' | 'stretch', shape, colors: [main, accent, detail], tag: 'g' | 'b' | 'gb' }
// (`tag` only orders presents for the device's Girl / Boy pick; every toy is for everyone.)
export const ITEMS = [
  { key: 'pf_strawberry', name: 'Strawberry Puffum', kind: 'puff', shape: 'berry', colors: ['#FF5F7E', '#FFE9A8', '#4FB860'], tag: 'gb' },
  { key: 'pf_toast', name: 'Toasty', kind: 'puff', shape: 'toast', colors: ['#F7D9A0', '#C98A45', '#FF9EB8'], tag: 'gb' },
  { key: 'pf_donut', name: 'Sprinkle Donut', kind: 'puff', shape: 'donut', colors: ['#E9B26C', '#FF8FC8', '#FFFFFF'], tag: 'gb' },
  { key: 'pf_cupcake', name: 'Cupcake Puffum', kind: 'puff', shape: 'cupcake', colors: ['#FFB3C7', '#A6D8FF', '#E8203F'], tag: 'g' },
  { key: 'pf_peach', name: 'Peachy', kind: 'puff', shape: 'peach', colors: ['#FFB38A', '#FF8FA3', '#4FB860'], tag: 'g' },
  { key: 'pf_icecream', name: 'Ice Cream Puffum', kind: 'puff', shape: 'icecream', colors: ['#E9B26C', '#BDF2DA', '#FFB3C7'], tag: 'gb' },
  { key: 'pf_macaron', name: 'Macaron', kind: 'puff', shape: 'macaron', colors: ['#C8B4FF', '#FFFFFF', '#FFB3C7'], tag: 'g' },
  { key: 'pf_watermelon', name: 'Melon Slice', kind: 'puff', shape: 'melon', colors: ['#FF6F7D', '#3FB66B', '#3A1F4D'], tag: 'gb' },
  { key: 'pf_rocket', name: 'Rocket Puffum', kind: 'puff', shape: 'rocket', colors: ['#F2F6FA', '#FF5F7E', '#6CC6FF'], tag: 'b' },
  { key: 'pf_bunny', name: 'Bunny Puffum', kind: 'puff', shape: 'bunny', colors: ['#FFF0F6', '#FFB8D6', '#3A1F4D'], tag: 'g' },
  { key: 'pf_kitty', name: 'Kitty Loaf', kind: 'puff', shape: 'catloaf', colors: ['#FFC98F', '#FFFFFF', '#3A1F4D'], tag: 'gb' },
  { key: 'pf_panda', name: 'Panda Puffum', kind: 'puff', shape: 'panda', colors: ['#FFFFFF', '#3A1F4D', '#FF9EB8'], tag: 'gb' },
  { key: 'pf_cub', name: 'Cuddle Cub', kind: 'puff', shape: 'bear', colors: ['#9A6B4F', '#FFD9C2', '#FF5F7E'], tag: 'gb' },
  { key: 'pf_frog', name: 'Froggy', kind: 'puff', shape: 'frog', colors: ['#7FD37A', '#FFF1B8', '#FF8FA3'], tag: 'gb' },
  { key: 'pf_penguin', name: 'Penguin Puffum', kind: 'puff', shape: 'penguin', colors: ['#3E4A7A', '#FFFFFF', '#FFB347'], tag: 'gb' },
  { key: 'pf_dino', name: 'Dino Puffum', kind: 'puff', shape: 'dino', colors: ['#7FD37A', '#FFE066', '#3A1F4D'], tag: 'b' },
  { key: 'pf_shark', name: 'Shark Puffum', kind: 'puff', shape: 'shark', colors: ['#8FB8E8', '#FFFFFF', '#3A1F4D'], tag: 'b' },
  { key: 'pf_unicorn', name: 'Unicorn Puffum', kind: 'puff', shape: 'unicorn', colors: ['#FFFFFF', '#FFD1E6', '#FFC94D'], tag: 'g' },
  { key: 'pf_whale', name: 'Splashy Whale', kind: 'puff', shape: 'whale', colors: ['#6CC6FF', '#E6F6FF', '#3A1F4D'], tag: 'gb' },
  { key: 'pf_sloth', name: 'Sleepy Sloth', kind: 'puff', shape: 'sloth', colors: ['#B79A80', '#F1E1CF', '#3A1F4D'], tag: 'gb' },
  { key: 'pf_octopus', name: 'Octo Puffum', kind: 'puff', shape: 'octopus', colors: ['#FF9CCB', '#FFD1E6', '#3A1F4D'], tag: 'gb' },
  { key: 'pf_dolphin', name: 'Dolphin Puffum', kind: 'puff', shape: 'dolphin', colors: ['#8EB8E0', '#F7FBFF', '#3A1F4D'], tag: 'gb' },
  { key: 'pf_mermaid', name: 'Mermaid Tail', kind: 'puff', shape: 'mermaid', colors: ['#3FD8B0', '#C8B4FF', '#FFFFFF'], tag: 'g' },
  { key: 'pf_seadragon', name: 'Sea Dragon Puffum', kind: 'puff', shape: 'seadragon', colors: ['#2FB5B0', '#FFD43B', '#3A1F4D'], tag: 'b' },
  { key: 'st_bubblegum', name: 'Bubblegum Blob', kind: 'stretch', shape: 'blob', colors: ['#FF8FC8', '#FFFFFF', '#3A1F4D'], tag: 'gb' },
  { key: 'st_cube', name: 'Squeezy Cube', kind: 'stretch', shape: 'cube', colors: ['#C8B4FF', '#FFFFFF', '#3A1F4D'], tag: 'gb' },
  { key: 'st_heart', name: 'Heart Squeeze', kind: 'stretch', shape: 'heart', colors: ['#FF5F7E', '#FFFFFF', '#3A1F4D'], tag: 'g' },
  { key: 'st_star', name: 'Star Squeeze', kind: 'stretch', shape: 'star', colors: ['#FFC94D', '#FFFFFF', '#3A1F4D'], tag: 'gb' },
  { key: 'st_cloud', name: 'Cloud Squeeze', kind: 'stretch', shape: 'cloud', colors: ['#E6F6FF', '#FFFFFF', '#3A1F4D'], tag: 'gb' },
  { key: 'st_gold', name: 'Gold Glitter Ball', kind: 'stretch', shape: 'glitter', colors: ['#FFE9A8', '#F2A900', '#FFFFFF'], tag: 'gb' },
  { key: 'st_rainbow', name: 'Rainbow Glitter Ball', kind: 'stretch', shape: 'glitter', colors: ['#FFFFFF', '#FF8FC8', '#6CC6FF'], tag: 'g' },
  { key: 'st_galaxy', name: 'Galaxy Ball', kind: 'stretch', shape: 'glitter', colors: ['#3E2A7A', '#FFE27A', '#9C7BFF'], tag: 'b' },
  { key: 'st_lime', name: 'Lime Jelly', kind: 'stretch', shape: 'jelly', colors: ['#9BE86A', '#DFFFC2', '#3A1F4D'], tag: 'gb' },
  { key: 'st_grape', name: 'Grape Jelly Cube', kind: 'stretch', shape: 'jellycube', colors: ['#9C7BFF', '#E6DDFF', '#3A1F4D'], tag: 'gb' },
  { key: 'st_ocean', name: 'Ocean Jelly', kind: 'stretch', shape: 'jelly', colors: ['#6CC6FF', '#FFB347', '#FFFFFF'], tag: 'gb' },
  { key: 'st_peachfuzz', name: 'Fuzzy Peach', kind: 'stretch', shape: 'fuzzy', colors: ['#FFC2A8', '#FF9EB8', '#3A1F4D'], tag: 'g' },
  { key: 'st_snowball', name: 'Snowball', kind: 'stretch', shape: 'fuzzy', colors: ['#FFFFFF', '#A6D8FF', '#3A1F4D'], tag: 'gb' },
  { key: 'st_moon', name: 'Glow Moon', kind: 'stretch', shape: 'glow', colors: ['#E8FFB8', '#C9F2A0', '#3A1F4D'], tag: 'gb' },
  { key: 'st_kitty', name: 'Kitty Blob', kind: 'stretch', shape: 'animal', colors: ['#FFC4DD', '#FF8FB1', '#3A1F4D'], tag: 'g' },
  { key: 'st_ducky', name: 'Ducky Blob', kind: 'stretch', shape: 'animal', colors: ['#FFE066', '#FF9F43', '#3A1F4D'], tag: 'gb' },
  { key: 'st_piggy', name: 'Piggy Blob', kind: 'stretch', shape: 'animal', colors: ['#FFB3C7', '#FF8FA3', '#3A1F4D'], tag: 'gb' },
  { key: 'st_dinoegg', name: 'Dino Egg', kind: 'stretch', shape: 'egg', colors: ['#BDF2DA', '#7FD37A', '#3A1F4D'], tag: 'b' },
  { key: 'st_zoom', name: 'Zoom Blob', kind: 'stretch', shape: 'zoom', colors: ['#5FC9C9', '#FFC94D', '#3A1F4D'], tag: 'b' },
  { key: 'st_soccer', name: 'Soccer Squeeze', kind: 'stretch', shape: 'ball', colors: ['#FFFFFF', '#3A1F4D', '#FF5F7E'], tag: 'b' },
  { key: 'st_starfish', name: 'Starfish Squeeze', kind: 'stretch', shape: 'starfish', colors: ['#FF9F5A', '#FFFFFF', '#3A1F4D'], tag: 'gb' },
  { key: 'st_shell', name: 'Seashell Squeeze', kind: 'stretch', shape: 'shell', colors: ['#FFC2D1', '#FFF1E6', '#FFFFFF'], tag: 'g' },
  { key: 'st_robot', name: 'Robot Blob', kind: 'stretch', shape: 'robot', colors: ['#AFC3D6', '#6CC6FF', '#FF5F7E'], tag: 'b' },
  { key: 'st_volcano', name: 'Volcano Squeeze', kind: 'stretch', shape: 'volcano', colors: ['#8B6B5A', '#FF7A3D', '#FFD43B'], tag: 'b' },
];

// APPEND ONLY too: a permutation of the ITEMS keys, the order presents come in on Mix (Girl and
// Boy use it through nextItem's rule). Pinned by ORDER_V1 in tools/test-squish.mjs.
export const PRESENT_ORDER = [
  'pf_strawberry', 'pf_dolphin', 'st_bubblegum', 'pf_dino', 'pf_unicorn', 'st_starfish', 'pf_seadragon', 'st_heart',
  'pf_mermaid', 'st_robot', 'pf_donut', 'st_cube', 'pf_shark', 'st_shell', 'pf_bunny', 'st_gold',
  'pf_whale', 'st_galaxy', 'pf_cupcake', 'st_ducky', 'pf_rocket', 'st_rainbow', 'pf_kitty', 'st_volcano',
  'pf_panda', 'st_kitty', 'pf_octopus', 'st_zoom', 'pf_peach', 'st_star', 'pf_icecream', 'st_dinoegg',
  'pf_cub', 'st_peachfuzz', 'pf_toast', 'st_soccer', 'pf_macaron', 'st_lime', 'pf_frog', 'st_ocean',
  'pf_penguin', 'st_moon', 'pf_sloth', 'st_cloud', 'pf_watermelon', 'st_grape', 'st_snowball', 'st_piggy',
];

/** The toys tied to the sea features (ocean's animals, merfolk's forms). */
export const SEA_KEYS = ['pf_dolphin', 'pf_mermaid', 'pf_seadragon', 'pf_whale', 'pf_octopus', 'pf_shark', 'st_ocean', 'st_starfish', 'st_shell'];

const BY_KEY = new Map();
export function item(key) {
  if (BY_KEY.size !== ITEMS.length) {
    BY_KEY.clear();
    for (const it of ITEMS) BY_KEY.set(it.key, it);
  }
  return BY_KEY.get(key) || null;
}

/** The entity / Bag def key of a toy: squish_<key>, or squishg_<key> for its sparkly version. */
export const defKey = (key, glitter = false) => (glitter ? 'squishg_' : 'squish_') + key;
/** { key, glitter } from a def key, or null. */
export function parseDefKey(defk) {
  const m = /^squish(g?)_((?:pf|st)_[a-z]+(?:_[a-z]+)*)$/.exec(String(defk || ''));
  return m ? { key: m[2], glitter: m[1] === 'g' } : null;
}

// ---------------- milestones ----------------

export const START_COINS = 100; // the same value as src/things/shops/coins.js (not imported: no UI deps)
export const FIRST = 50, STEP = 10, MAX_GAP = 100, WELCOME = 3;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const sq = (p) => (isObj(p) && isObj(p.squish) ? p.squish : {});
const validBase = (b) => isObj(b) && typeof b.coins === 'number' && Number.isFinite(b.coins) && b.coins >= 0 &&
  (typeof b.at === 'number' ? Number.isFinite(b.at) : Number.isFinite(Date.parse(b.at)));
const validRest = (r) => isObj(r) && Number.isInteger(r.n) && r.n >= 0 && typeof r.coins === 'number' && Number.isFinite(r.coins) && r.coins >= 0;

/** The gap before present n (1-based): 50, 60, 70, 80, 90, then 100 every time. */
export function gap(n) {
  return Math.min(MAX_GAP, FIRST + STEP * (Math.max(1, Math.floor(n)) - 1));
}

/** Earned coins needed (counted from base) for present n: T(n) = gap(1) + ... + gap(n). */
export function threshold(n) {
  let t = 0;
  const end = Math.max(0, Math.floor(n));
  for (let k = 1; k <= end; k++) t += gap(k);
  return t;
}

/** Everything earned so far (spending never lowers it). */
export function earned(p) {
  if (!isObj(p)) return 0;
  const s = isObj(p.stats) ? p.stats : {};
  return Math.floor(Math.max(num(s.coinsEarned), num(p.coins) - START_COINS, 0));
}

/** Presents in all: every toy, then every toy made sparkly. */
export const presentsTotal = () => 2 * ITEMS.length;

/** Presents opened: keys in got + glit (known to this build or not). */
export function opened(p) {
  const s = sq(p);
  return (isObj(s.got) ? Object.keys(s.got).length : 0) + (isObj(s.glit) ? Object.keys(s.glit).length : 0);
}

/** Presents opened that this build knows. */
export function knownOpened(p) {
  const s = sq(p);
  let n = 0;
  for (const it of ITEMS) {
    if (isObj(s.got) && it.key in s.got) n++;
    if (isObj(s.glit) && it.key in s.glit) n++;
  }
  return n;
}

/** Toys owned (known keys in got). */
export function owned(p) {
  const s = sq(p);
  return isObj(s.got) ? ITEMS.filter((it) => it.key in s.got).length : 0;
}
export function ownedGlitter(p) {
  const s = sq(p);
  return isObj(s.glit) ? ITEMS.filter((it) => it.key in s.glit).length : 0;
}
export const has = (p, key, glitter = false) => {
  const m = sq(p)[glitter ? 'glit' : 'got'];
  return isObj(m) && key in m;
};

/** Earned coins at which present n is reached (from `rest` once everything was opened, §6.6). */
export function milestone(p, n) {
  const s = sq(p);
  if (validRest(s.rest) && n >= s.rest.n) {
    let t = s.rest.coins;
    for (let k = s.rest.n + 1; k <= n; k++) t += gap(k);
    return t;
  }
  return (validBase(s.base) ? s.base.coins : 0) + threshold(n);
}

/** The largest n (at most presentsTotal()) with milestone(p, n) <= earned(p). */
export function reached(p) {
  const e = earned(p), total = presentsTotal();
  let best = 0;
  for (let n = 1; n <= total; n++) if (milestone(p, n) <= e) best = n;
  return best;
}

/** Presents waiting to be opened. */
export function ready(p) {
  return Math.max(0, Math.min(reached(p) - opened(p), presentsTotal() - knownOpened(p)));
}

/** Everything opened? */
export const complete = (p) => knownOpened(p) >= presentsTotal();

/** 0..1 toward the next present, 'ready' when one waits, 'done' when all are opened. */
export function progress(p, inFlight = 0) {
  if (complete(p)) return 'done';
  if (ready(p) > 0) return 'ready';
  const e = earned(p) - num(inFlight);
  const o = opened(p);
  const prev = milestone(p, o), next = milestone(p, o + 1);
  if (!(next > prev)) return 0;
  return Math.min(1, Math.max(0, (e - prev) / (next - prev)));
}

/** Coins still to earn for the next present (0 when one waits), or null when all are opened. */
export function toNext(p) {
  if (complete(p)) return null;
  if (ready(p) > 0) return 0;
  return Math.max(0, Math.ceil(milestone(p, opened(p) + 1) - earned(p)));
}

/**
 * What the next present holds: { key, glitter, pick } or null when everything is opened.
 * Round 1 gives the toys not yet owned in PRESENT_ORDER; with Girl or Boy picked on this device
 * (`style`), the side's own toys and shared toys alternate, own first. Round 2 (every toy owned)
 * makes one owned toy sparkly; the kid picks which (`key` is only the default).
 */
export function nextItem(p, style = null) {
  const s = sq(p);
  const got = isObj(s.got) ? s.got : {};
  const glit = isObj(s.glit) ? s.glit : {};
  const missing = PRESENT_ORDER.filter((k) => !(k in got) && item(k));
  if (missing.length) {
    const letter = style === 'girl' ? 'g' : style === 'boy' ? 'b' : null;
    if (!letter) return { key: missing[0], glitter: false, pick: false };
    const own = missing.filter((k) => item(k).tag === letter);
    const shared = missing.filter((k) => item(k).tag === 'gb');
    const k = ITEMS.filter((it) => it.key in got).length;
    const first = k % 2 === 0 ? (own[0] || shared[0]) : (shared[0] || own[0]);
    return { key: first || missing[0], glitter: false, pick: false };
  }
  const glitterNext = PRESENT_ORDER.find((k) => !(k in glit) && item(k));
  return glitterNext ? { key: glitterNext, glitter: true, pick: true } : null;
}

/** The toys a Glitter round may pick (owned, not sparkly yet), in PRESENT_ORDER. */
export function glitterChoices(p) {
  const s = sq(p);
  const got = isObj(s.got) ? s.got : {};
  const glit = isObj(s.glit) ? s.glit : {};
  return PRESENT_ORDER.filter((k) => k in got && !(k in glit) && item(k));
}

/** Where the milestones start for a profile that has none (§6.2): up to WELCOME presents ready. */
export function makeBase(p, nowIso, { prov = false } = {}) {
  const base = { coins: Math.max(0, earned(p) - threshold(WELCOME)), at: nowIso };
  if (prov) base.prov = 1;
  return base;
}

export const hasValidBase = (p) => validBase(sq(p).base);

/** A provisional base made real in an online session, capped so at most WELCOME are ready. */
export function promoteBase(p) {
  const b = sq(p).base;
  const coins = validBase(b) ? b.coins : 0;
  return { coins: Math.max(coins, earned(p) - threshold(opened(p) + WELCOME)), at: validBase(b) ? b.at : new Date(0).toISOString() };
}

/** The `rest` marker while every present is opened, or null. */
export function restFor(p) {
  return complete(p) ? { n: opened(p), coins: earned(p) } : null;
}

// ---------------- words ----------------

/** Every string a kid reads (the drop, panels, HUD, tips, toasts). No prices, no chances. */
export const STRINGS = {
  dropBig: 'Mystery present!',
  dropSmall: 'Tap me!',
  hudPresent: 'Present',
  hudSquish: 'Squish!',
  hudAway: 'Put away',
  presentTitle: 'Mystery Present',
  tap0: 'Tap the present!',
  tap1: 'Again!',
  tap2: 'One more!',
  newTag: 'NEW!',
  revealName: '{name}!',
  firstPuff: 'A Puffum! Press it and it puffs back up.',
  firstStretch: 'A Stretchum! Squeeze it and stretch it!',
  pickGlitter: 'Pick a toy to make sparkly!',
  nowSparkles: 'Now it sparkles!',
  btnSquish: 'Squish it!',
  btnHold: 'Hold it',
  btnShelf: 'Squish Shelf',
  btnNext: 'Next present!',
  shelfTitle: 'Squish Shelf',
  toGo: '{n} to go!',
  pathReady: 'Ready!',
  openIt: 'Open it!',
  nextGlitter: 'Next: make a toy sparkly!',
  tipFill: 'Play to fill it up!',
  tipSpend: 'Spending candy coins is OK.',
  ok: 'OK',
  counter: '{n} of {total}',
  counterGlitter: 'Glitter {n} of {total}',
  complete: 'You found every toy! You are a Squish Champion!',
  tabAll: 'All',
  tabPuff: 'Puffums',
  tabStretch: 'Stretchums',
  mystery: 'Still a mystery',
  pressPuff: 'Press it!',
  pressStretch: 'Press and hold!',
  glitter: 'Glitter',
  back: 'Back',
  hint: 'Tap to squish!',
  holding: "You're holding the {name}! Press Squish!",
  holdWater: 'Swim to the shore first!',
  away: 'All put away!',
  placeTip: "You put it down! It's still in your Bag.",
  bagTip: 'Your new toy is in your Bag too!',
  pillTip: 'Your toys live here!',
  bagTab: 'Squish Toys',
  shelfItem: 'Toy Shelf',
  pillLabel: 'Sparkle Coins: {n}. Open the Squish Shelf',
};

/** Fill a STRINGS template: fmt('toGo', { n: 40 }) -> '40 to go!'. */
export function fmt(id, vars = {}) {
  return String(STRINGS[id] || id).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** The 4 squish stickers: [id, name, hint]. */
export const STICKERS = [
  ['squish_first', 'First Present!', 'Open a mystery present'],
  ['squish_ten', 'Squish Collector', 'Collect 10 squishy toys'],
  ['squish_all', 'Squish Champion', 'Collect every Puffum and Stretchum'],
  ['squish_squeeze', 'Squeeze Me!', 'Squish a toy 25 times'],
];
