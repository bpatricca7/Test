// The Twinkle Elves' data: names, color schemes, what they say, the tiny scenes, the numbers
// and the profile helpers (docs/teams/elves.md). Pure: no three.js, no DOM, so Node tests
// import it (tools/test-elves.mjs).
//
// profile.elves (one key, wave5-plan.md §6.5), read with a default, never assumed:
//   { v: 1, met: bool,                     the player met the elves (sign, greeter, or a first find)
//     found: { [worldKey]: bitmask },       which village elves (data.idx) were found per world
//     home:  { [worldKey]: hideNo },        the last house-elf hide found per world
//     homeFinds: n,                         house-elf finds on different mornings (elf_home)
//     coinDay: yyyymmdd, coinGot: n,        the daily coin cap (§6.6: at most 10 a day)
//     keys: [worldKey, ...] }               newest last; at most MAX_WORLDS worlds are kept
// A world key is the world's seed and creation time (the same on the host's page and on a
// friend's page, where the world id is a session name), so progress survives playing together.

export const NAMES = ['Pip', 'Tinsel', 'Juniper', 'Sprout', 'Clove', 'Nutmeg', 'Holly', 'Sparkle', 'Jingle', 'Maple', 'Pepper', 'Snowdrop'];
/** The elf who waits at the elves' cottage and says hello (not one of the twelve who hide). */
export const GREETER = 'Bramble';

/**
 * Twelve color schemes, one per name (same index). Our own pastel style: a soft tunic with a
 * zigzag hem, a floppy hat with a glowing star at its tip, a striped scarf and mittens.
 *   hat, brim (the fluffy hat band and hem trim), suit, scarf, stripe (scarf stripes), mitt,
 *   shoe, hair, skin, star (the glowing hat star), cheek
 */
export const SCHEMES = [
  { hat: '#5ED6B4', brim: '#FFF6E8', suit: '#8FE6CC', scarf: '#FF8CC6', stripe: '#FFFFFF', mitt: '#FF8CC6', shoe: '#3FB894', hair: '#8A5A3C', skin: '#FFDCC4', star: '#FFE066', cheek: '#FF9EB8' },
  { hat: '#A78BFA', brim: '#FFF3C4', suit: '#C9B6FF', scarf: '#FFD24D', stripe: '#FFFFFF', mitt: '#FFD24D', shoe: '#8467E8', hair: '#F2C14E', skin: '#F6D2B8', star: '#FFF1A0', cheek: '#FF9EB8' },
  { hat: '#2EC4C4', brim: '#FFFFFF', suit: '#7FDEDA', scarf: '#FF8A6B', stripe: '#FFE3D6', mitt: '#FF8A6B', shoe: '#1E9C9C', hair: '#3B2A22', skin: '#C98E6B', star: '#FFE066', cheek: '#F27A8C' },
  { hat: '#8EDB5A', brim: '#FFFFFF', suit: '#B9EE8E', scarf: '#6CC6FF', stripe: '#FFFFFF', mitt: '#6CC6FF', shoe: '#5DB43A', hair: '#E2884A', skin: '#FFE2CF', star: '#FFE066', cheek: '#FF9EB8' },
  { hat: '#B05BC8', brim: '#FFE7F3', suit: '#D9A4EA', scarf: '#FFB38A', stripe: '#FFFFFF', mitt: '#FFB38A', shoe: '#8E3FA8', hair: '#2A1B1B', skin: '#8D5A3F', star: '#FFE88A', cheek: '#E7708A' },
  { hat: '#D9A066', brim: '#FFF8EC', suit: '#EBC79B', scarf: '#9BE8CF', stripe: '#FFFFFF', mitt: '#9BE8CF', shoe: '#B07A44', hair: '#6B3F26', skin: '#F2C8A8', star: '#FFE066', cheek: '#FF9EB8' },
  { hat: '#FF5F8F', brim: '#FFFFFF', suit: '#FF9FBC', scarf: '#5ED68C', stripe: '#FFFFFF', mitt: '#5ED68C', shoe: '#E04476', hair: '#4A2E22', skin: '#E8B48F', star: '#FFE066', cheek: '#FF7FA0' },
  { hat: '#6CC6FF', brim: '#FFFFFF', suit: '#B8E4FF', scarf: '#E6E6F2', stripe: '#9CD6FF', mitt: '#E6E6F2', shoe: '#3EA2E6', hair: '#F7E3A1', skin: '#FFE6D6', star: '#FFFFFF', cheek: '#FFA8C2' },
  { hat: '#FFC93C', brim: '#FFFFFF', suit: '#FFE48A', scarf: '#FF6F6F', stripe: '#FFFFFF', mitt: '#FF6F6F', shoe: '#E6A51E', hair: '#7A4A2A', skin: '#F6D2B8', star: '#FFFFFF', cheek: '#FF9EB8' },
  { hat: '#FF8F3C', brim: '#FFF3E0', suit: '#FFBC85', scarf: '#8C6BFF', stripe: '#FFFFFF', mitt: '#8C6BFF', shoe: '#E0702A', hair: '#B5482A', skin: '#FFDCC4', star: '#FFE066', cheek: '#FF9EB8' },
  { hat: '#F25C5C', brim: '#FFFFFF', suit: '#FFA3A3', scarf: '#5ED6B4', stripe: '#FFFFFF', mitt: '#5ED6B4', shoe: '#C94444', hair: '#1F1A1A', skin: '#B7795A', star: '#FFE066', cheek: '#E86A80' },
  { hat: '#E8F4FF', brim: '#C9B6FF', suit: '#FFFFFF', scarf: '#C9B6FF', stripe: '#FFFFFF', mitt: '#C9B6FF', shoe: '#9FB7E8', hair: '#C9D6E8', skin: '#FFE6D6', star: '#BFE6FF', cheek: '#FFA8C2' },
];
/** The greeter's scheme (a cozy plum and gold). */
export const GREETER_SCHEME = { hat: '#7A4FB5', brim: '#FFE7A0', suit: '#A983D8', scarf: '#FFD24D', stripe: '#FF8CC6', mitt: '#FFD24D', shoe: '#5C3A8E', hair: '#E8E8F0', skin: '#F2C8A8', star: '#FFE066', cheek: '#FF9EB8' };
/** The Bag swatches (one per elf; the color picker shows the twelve elves). */
export const SWATCHES = SCHEMES.map((s) => s.hat);

/** A scheme index from data / a Bag swatch (always 0..11). */
export function schemeIndex(data, color = null) {
  const n = data && Number.isInteger(data.sc) ? data.sc : -1;
  if (n >= 0 && n < SCHEMES.length) return n;
  const i = color ? SWATCHES.indexOf(String(color)) : -1;
  return i >= 0 ? i : 0;
}

// ---------- numbers ----------

export const COIN_CAP = 10; // elves pay at most this many coins a day (wave5-plan.md §6.6)
export const COIN_VILLAGE = 2; // the first find of each village elf
export const COIN_HOUSE = 3; // the house elf's morning find
export const HOME_STICKER_FINDS = 5; // elf_home: the house elf found on 5 mornings
export const ALL_MIN = 6; // elf_all needs a village of at least this many hiding elves
export const MAX_HIDERS = 30; // village elves per world (the found bitmask is 30 bits)
export const MAX_WORLDS = 24; // worlds remembered in profile.elves
export const HOME_RADIUS = 9; // the house elf hides this far (blocks, sideways) from home
export const HOME_DOWN = 3; // ... this far below home
export const HOME_UP = 6; // ... and this far above it
export const REACH = 6.5; // a hiding place is within this of a spot the player can stand (the tap reach is 8)
export const JINGLE_NEAR = 18; // the jingle starts this close to an elf not found yet
export const TWINKLE_NEAR = 5; // the hat star twinkles this close
export const SCENE_CHANCE = 0.6; // how often the house elf sets up a tiny scene

// ---------- what they say (short, warm, always "you" to the player) ----------

export const LINES = {
  found: [
    'Hee hee! You found me!',
    'Peekaboo! There you are!',
    'Oh! You are so good at this!',
    'I thought I hid so well!',
    'Twinkle twinkle, you found me!',
    'Yay! Now find my friends!',
    'Shh, my friends are still hiding!',
    'You have super seeing eyes!',
  ],
  again: [
    'Hee hee! That tickles!',
    'Hello again!',
    'I am still here!',
    'Twinkle twinkle!',
  ],
  house: [
    'Good morning! Did you sleep well?',
    'I love your house!',
    'Hee hee! I hid so well!',
    'Peekaboo! Good morning!',
    'You found me! Tomorrow I will hide again!',
  ],
  houseAgain: [
    'See you tomorrow morning! I will hide somewhere new!',
    'Hee hee! That tickles!',
    'I am having the best day!',
  ],
  decor: [
    'Hello! Twinkle twinkle!',
    'Hee hee!',
    'Hi friend!',
    'I love it here!',
  ],
  greet: ['Welcome to the Twinkle Elves’ cottage!'],
};

/** The tiny scenes the house elf sets up (pose and what the line says). */
export const SCENES = {
  cookies: { pose: 'sit', line: 'I baked you cookies!', gift: 'cookies' },
  note: { pose: 'stand', line: 'I wrote you a note: You are awesome!' },
  plane: { pose: 'stand', line: 'Wheee! I made a paper airplane!' },
  angel: { pose: 'lie', line: 'Look! A snow angel in the sugar!' },
  cocoa: { pose: 'cup', line: 'A cocoa bath with marshmallows!' },
  book: { pose: 'sit', line: 'I am reading a story about you!' },
  snowman: { pose: 'stand', line: 'I made a tiny snowman!' },
  candy: { pose: 'stand', line: 'A candy cane for me, a cookie for you!', gift: 'star_cookie' },
  gift: { pose: 'sit', line: 'I wrapped a tiny present!' },
  bath: { pose: 'cup', line: 'Splish splash! Bubble bath!' },
};
/** Scenes that may be picked at random (bath only comes with a bathtub). */
export const RANDOM_SCENES = ['cookies', 'note', 'plane', 'angel', 'cocoa', 'book', 'snowman', 'candy', 'gift'];
export const POSES = ['stand', 'sit', 'lie', 'cup', 'peek'];

/** A friendly place word for where an elf hides ('on the fridge', 'in a tree'...). */
export function whereLabel(kind, key = '', recordWhere = '') {
  const w = String(recordWhere || '');
  const fromRecord = {
    shelf: 'on a shelf', roof: 'on a roof', tree: 'in a tree', window: 'by a window', lamp: 'on a lamp post',
    fence: 'on a fence', chimney: 'by a chimney', bench: 'on a bench', sign: 'by a sign', wall: 'on a wall',
    stable: 'by the stable', tree_big: 'by the big tree', pond: 'by the pond', cottage: 'by a cottage', workshop: 'in the workshop',
    porch: 'on a porch', step: 'on a step', snowman: 'by a snowman', sleigh: 'by the sleigh', bridge: 'on a bridge',
  };
  if (w && fromRecord[w]) return fromRecord[w];
  const k = String(key || '');
  if (kind === 'furn') {
    if (/fridge/.test(k)) return 'on the fridge';
    if (/bookshelf|shelf/.test(k)) return 'on a shelf';
    if (/lamp|lantern/.test(k)) return 'on a lamp';
    if (/wardrobe|dresser|vanity/.test(k)) return 'on the wardrobe';
    if (/sofa|armchair|beanbag|bench|chair|stool/.test(k)) return 'on a seat';
    if (/bed|crib/.test(k)) return 'on a bed';
    if (/bath/.test(k)) return 'in the bath';
    if (/table|desk|counter|nightstand/.test(k)) return 'on a table';
    if (/fireplace/.test(k)) return 'on the fireplace';
    if (/piano/.test(k)) return 'on the piano';
    if (/tv/.test(k)) return 'on the TV';
    if (/sink/.test(k)) return 'by the sink';
    if (/gift|present/.test(k)) return 'on a present';
    return 'on the furniture';
  }
  if (kind === 'block') {
    if (/leaves|pine/.test(k)) return 'in a tree';
    if (/roof/.test(k)) return 'on a roof';
    if (/snow/.test(k)) return 'in the snow';
    if (/grass|dirt|flower|moss|sand/.test(k)) return 'in the garden';
    return 'near your home';
  }
  return w ? `by the ${w.replace(/[^a-z ]/gi, '').slice(0, 14)}` : 'somewhere nearby';
}

// ---------- tiny deterministic helpers ----------

/** yyyymmdd of this device's today (a number that only grows). */
export function dayStamp(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** The same string hash the game uses (FNV-1a), kept here so this file imports nothing. */
export function hashStr(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 (the game's seeded random), local copy for the same reason. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable key for a world from its meta (seed + creation time; the same for friends). */
export function worldKey(meta) {
  if (!meta) return '';
  const seed = Number.isFinite(meta.seed) ? meta.seed | 0 : 0;
  const at = Number.isFinite(meta.createdAt) ? Math.floor(meta.createdAt) : 0;
  return `w${(hashStr(`${seed}:${at}`) >>> 0).toString(36)}`;
}

/** The house elf's starting name in a world (each world gets its own elf). */
export function houseIndex(wk) {
  return hashStr(`house:${wk}`) % NAMES.length;
}

/** A typed name, made safe: letters, numbers, spaces and a few marks, 1..14 characters. */
export function cleanName(name, fallback = NAMES[0]) {
  const s = String(name ?? '').replace(/[^\p{L}\p{N} '\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14).trim();
  return s || fallback;
}

/** Pick one entry with rand() (0..1). */
export function pickOne(list, rand) {
  if (!Array.isArray(list) || !list.length) return null;
  const r = Number(rand());
  const i = Math.floor((Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0) * list.length);
  return list[i];
}

// ---------- profile.elves ----------

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const nat = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** A clean copy of profile.elves (anything broken is dropped kindly). */
export function normalizeElves(raw) {
  const r = isObj(raw) ? raw : {};
  const out = { v: 1, met: !!r.met, found: {}, home: {}, homeFinds: Math.min(nat(r.homeFinds), 1e6), coinDay: nat(r.coinDay), coinGot: Math.min(nat(r.coinGot), COIN_CAP), keys: [] };
  const keyOk = (k) => typeof k === 'string' && /^w[0-9a-z]{1,12}$/.test(k);
  if (isObj(r.found)) for (const [k, m] of Object.entries(r.found)) if (keyOk(k) && nat(m)) out.found[k] = nat(m) & 0x3fffffff;
  if (isObj(r.home)) for (const [k, n] of Object.entries(r.home)) if (keyOk(k) && nat(n)) out.home[k] = Math.min(nat(n), 1e9);
  const seen = new Set();
  if (Array.isArray(r.keys)) for (const k of r.keys) if (keyOk(k) && !seen.has(k) && (out.found[k] || out.home[k])) { seen.add(k); out.keys.push(k); }
  for (const k of [...Object.keys(out.found), ...Object.keys(out.home)]) if (!seen.has(k)) { seen.add(k); out.keys.push(k); }
  trimWorlds(out);
  return out;
}

/** Keep the newest MAX_WORLDS worlds (keys is oldest first). */
function trimWorlds(e) {
  for (let guard = 0; e.keys.length > MAX_WORLDS && guard < 1000; guard++) {
    const k = e.keys.shift();
    delete e.found[k];
    delete e.home[k];
  }
}

/** Mark world key wk as the newest. */
export function touchWorld(e, wk) {
  const i = e.keys.indexOf(wk);
  if (i >= 0) e.keys.splice(i, 1);
  e.keys.push(wk);
  trimWorlds(e);
}

/** Is village elf idx found in world wk? */
export function isFound(e, wk, idx) {
  if (!e || !Number.isInteger(idx) || idx < 0 || idx >= MAX_HIDERS) return false;
  return ((e.found[wk] | 0) & (1 << idx)) !== 0;
}

/** Mark village elf idx found; true when it is new. */
export function markFound(e, wk, idx) {
  if (!e || !wk || !Number.isInteger(idx) || idx < 0 || idx >= MAX_HIDERS) return false;
  const m = e.found[wk] | 0;
  if (m & (1 << idx)) return false;
  e.found[wk] = (m | (1 << idx)) & 0x3fffffff;
  touchWorld(e, wk);
  return true;
}

/** How many of the given idx list are found in wk. */
export function countFound(e, wk, idxs) {
  let n = 0;
  for (const i of idxs) if (isFound(e, wk, i)) n++;
  return n;
}

/** The house elf's hide number `hide` in wk was found: true when it is a new morning's find. */
export function markHomeFind(e, wk, hide) {
  if (!e || !wk || !(Number.isInteger(hide) && hide > 0)) return false;
  if ((e.home[wk] | 0) >= hide) return false;
  e.home[wk] = hide;
  e.homeFinds = Math.min(e.homeFinds + 1, 1e6);
  touchWorld(e, wk);
  return true;
}

/**
 * Coins within the daily cap: asks for `want`, returns what may be paid now (0..want) and
 * counts it. A clock that went backwards pays nothing (like the sea reward).
 */
export function takeCoins(e, want, day = dayStamp()) {
  want = nat(want);
  if (!e || !want || !nat(day)) return 0;
  if (e.coinDay > day) return 0;
  if (e.coinDay !== day) { e.coinDay = day; e.coinGot = 0; }
  const n = Math.max(0, Math.min(want, COIN_CAP - e.coinGot));
  e.coinGot += n;
  return n;
}

/**
 * Two copies of profile.elves made one (account merge, backup import): nothing found is
 * lost. Found masks are joined, counts keep the bigger number, the coin day the later one.
 */
export function mergeElves(a, b) {
  const x = normalizeElves(a), y = normalizeElves(b);
  const out = normalizeElves({});
  out.met = x.met || y.met;
  out.homeFinds = Math.max(x.homeFinds, y.homeFinds);
  if (x.coinDay === y.coinDay) { out.coinDay = x.coinDay; out.coinGot = Math.max(x.coinGot, y.coinGot); }
  else if (x.coinDay > y.coinDay) { out.coinDay = x.coinDay; out.coinGot = x.coinGot; }
  else { out.coinDay = y.coinDay; out.coinGot = y.coinGot; }
  for (const k of new Set([...Object.keys(x.found), ...Object.keys(y.found)])) out.found[k] = ((x.found[k] | 0) | (y.found[k] | 0)) & 0x3fffffff;
  for (const k of new Set([...Object.keys(x.home), ...Object.keys(y.home)])) out.home[k] = Math.max(x.home[k] | 0, y.home[k] | 0);
  for (const k of [...x.keys, ...y.keys]) touchWorld(out, k);
  for (const k of Object.keys(out.found)) if (!out.keys.includes(k)) delete out.found[k];
  for (const k of Object.keys(out.home)) if (!out.keys.includes(k)) delete out.home[k];
  return out;
}

// ---------- the per-world save (systems.elves) ----------

/** A clean copy of the world's elves data ({ v, house }). */
export function normalizeWorldData(raw) {
  const r = isObj(raw) ? raw : {};
  const h = isObj(r.house) ? r.house : null;
  const cell = (c) => (Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && Math.abs(v) < 4096) ? c.slice() : null);
  const house = h ? {
    uid: nat(h.uid),
    name: cleanName(h.name, NAMES[schemeIndex({ sc: h.sc })]),
    sc: schemeIndex({ sc: h.sc }),
    hide: Math.min(nat(h.hide), 1e9),
    stamp: nat(h.stamp),
    spot: cell(h.spot),
    prev: Array.isArray(h.prev) ? h.prev.map(cell).filter(Boolean).slice(-3) : [],
    away: !!h.away,
    bed: nat(h.bed),
  } : null;
  return { v: 1, house };
}
