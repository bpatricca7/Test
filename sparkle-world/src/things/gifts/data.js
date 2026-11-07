// The Gift Workshop's data and rules (wave 5, docs/teams/gifts.md). Pure: no three.js, no DOM,
// nothing random of its own (callers pass a seeded rand), so Node tests import it and the server could too.
//
// A gift is { inside, box, paper, pattern, ribbon, bow, to, from } where every look field is a
// key of one of the lists below and `inside` is a toy key or 't:<basket food key>' (a treat).
// Every list here is APPEND ONLY: entity data and saves keep the keys, and the held key that
// friends' pages draw (presence `hi`, 'gift_w' + five base-36 digits) keeps the list indices.

export const TOYS = [
  { key: 'teddy', name: 'Teddy Bear', color: '#C68B59', sound: 'soft' },
  { key: 'ball', name: 'Bouncy Ball', color: '#FF5B6B', sound: 'boing' },
  { key: 'robot', name: 'Robot', color: '#8FB4E0', sound: 'beep' },
  { key: 'train', name: 'Toy Train', color: '#E8424F', sound: 'choo' },
  { key: 'doll', name: 'Rag Doll', color: '#FF8A3D', sound: 'soft' },
  { key: 'puzzle', name: 'Puzzle Cube', color: '#3FD8B0', sound: 'click' },
  { key: 'kite', name: 'Kite', color: '#FFC94D', sound: 'whoosh' },
  { key: 'drum', name: 'Drum', color: '#E8424F', sound: 'drum' },
  { key: 'rocket', name: 'Rocket', color: '#FFFFFF', sound: 'whoosh' },
  { key: 'unicorn', name: 'Unicorn Plush', color: '#FFB8F0', sound: 'magic' },
  { key: 'paints', name: 'Paint Set', color: '#6CC6FF', sound: 'click' },
  { key: 'book', name: 'Story Book', color: '#9C7BFF', sound: 'page' },
  { key: 'dino', name: 'Dino Plush', color: '#6CC468', sound: 'soft' },
  { key: 'car', name: 'Race Car', color: '#3D8BEA', sound: 'vroom' },
  { key: 'wand', name: 'Star Wand', color: '#FFD43B', sound: 'magic' },
  { key: 'globe', name: 'Snow Globe', color: '#BFE4FF', sound: 'jingle' },
];

export const BOXES = [
  { key: 'small', name: 'Little Box' },
  { key: 'tall', name: 'Tall Box' },
  { key: 'round', name: 'Round Box' },
];

/** Wrapping paper colors: the paper, its pattern's ink and a second ink. */
export const PAPERS = [
  { key: 'red', name: 'Red', color: '#E23B4E', ink: '#FFFFFF', ink2: '#FFD45C' },
  { key: 'green', name: 'Green', color: '#2E9E5B', ink: '#FFFFFF', ink2: '#FF5B6B' },
  { key: 'gold', name: 'Gold', color: '#F2B93B', ink: '#FFF6D6', ink2: '#E23B4E' },
  { key: 'blue', name: 'Blue', color: '#3D8BEA', ink: '#FFFFFF', ink2: '#BFE4FF' },
  { key: 'pink', name: 'Pink', color: '#FF7EB6', ink: '#FFFFFF', ink2: '#FFE38A' },
  { key: 'purple', name: 'Purple', color: '#8A5CF0', ink: '#FFE38A', ink2: '#FFFFFF' },
  { key: 'snow', name: 'Snow White', color: '#F4F6FF', ink: '#E23B4E', ink2: '#2E9E5B' },
  { key: 'mint', name: 'Mint', color: '#3CCFAE', ink: '#FFFFFF', ink2: '#FF7EB6' },
];

/**
 * Paper patterns as 16 x 16 pixel tiles (row 0 is the top): '.' paper, 'x' ink, 'o' second ink.
 * One tile covers a quarter of a block (models.js PAPER_SCALE), so a little box shows about
 * three motifs a side.
 */
export const PATTERNS = [
  {
    key: 'stripes', name: 'Stripes',
    rows: [
      'xx..o...xx..o...', 'xx..o...xx..o...', 'xx..o...xx..o...', 'xx..o...xx..o...',
      'xx..o...xx..o...', 'xx..o...xx..o...', 'xx..o...xx..o...', 'xx..o...xx..o...',
      'xx..o...xx..o...', 'xx..o...xx..o...', 'xx..o...xx..o...', 'xx..o...xx..o...',
      'xx..o...xx..o...', 'xx..o...xx..o...', 'xx..o...xx..o...', 'xx..o...xx..o...',
    ],
  },
  {
    key: 'dots', name: 'Dots',
    rows: [
      '................', '..xx............', '.xxxx...........', '.xxxx...........',
      '..xx............', '..........o.....', '................', '................',
      '................', '..........xx....', '.........xxxx...', '.........xxxx...',
      '..........xx....', '..o.............', '................', '................',
    ],
  },
  {
    key: 'stars', name: 'Stars',
    rows: [
      '................', '....x...........', '....x...........', '.xxxxxxx........',
      '..xxxxx.........', '...xxx......o...', '..xx.xx....ooo..', '.x.....x....o...',
      '................', '................', '.........x......', '.........x......',
      '......xxxxxxx...', '.......xxxxx....', '........xxx.....', '.......xx.xx....',
    ],
  },
  {
    key: 'snow', name: 'Snowflakes',
    rows: [
      '................', '.x..x..x........', '..x.x.x.........', '...xxx..........',
      '.xxxxxxx........', '...xxx..........', '..x.x.x.........', '.x..x..x....o...',
      '...........ooo..', '............o...', '................', '................',
      '..o.............', '.ooo.....x.x....', '..o.......x.....', '.........x.x....',
    ],
  },
  {
    key: 'hearts', name: 'Hearts',
    rows: [
      '................', '.xx.xx..........', 'xxxxxxx.........', 'xxxxxxx.........',
      '.xxxxx..........', '..xxx...........', '...x............', '................',
      '................', '.........oo.oo..', '........ooooooo.', '........ooooooo.',
      '.........ooooo..', '..........ooo...', '...........o....', '................',
    ],
  },
  {
    key: 'candy', name: 'Candy Stripes',
    // diagonal stripes that join up across tiles (a candy cane's swirl)
    rows: Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => {
      const d = (x + y) % 8;
      return d < 2 ? 'x' : d === 4 ? 'o' : '.';
    }).join('')),
  },
];

export const RIBBONS = [
  { key: 'gold', name: 'Gold', color: '#FFD34D' },
  { key: 'red', name: 'Red', color: '#E8344A' },
  { key: 'white', name: 'White', color: '#FFFFFF' },
  { key: 'green', name: 'Green', color: '#2FA866' },
  { key: 'pink', name: 'Pink', color: '#FF6FA8' },
  { key: 'purple', name: 'Purple', color: '#9C7BFF' },
  { key: 'blue', name: 'Blue', color: '#4FB3F6' },
  { key: 'silver', name: 'Silver', color: '#D5DCEB' },
];

export const BOWS = [
  { key: 'bow', name: 'Big Bow' },
  { key: 'puff', name: 'Puffy Bow' },
  { key: 'star', name: 'Star' },
];

export const SACK_MAX = 8; // wrapped gifts waiting on her gift shelf
export const NAME_MAX = 16; // characters of a To / From name kept in a gift
export const GIVE_COINS = 2; // per gift given (to a friend, or put down for someone)
export const DAY_CAP = 10; // the gifts team's daily coin cap (wave5-plan.md §6.6)
export const TOY_LIFE = 240; // seconds a friend keeps the toy she gave in hand
export const ANYONE = '';
export const TREE_FROM = 'the Holiday Tree'; // who the surprise presents round the tree are from

export const STICKERS = [
  ['gift_maker', 'Gift Maker', 'Wrap a gift at the Gift Workshop'],
  ['gift_giver', 'Gift Giver', 'Give a gift to a friend'],
  ['gift_ten', 'Holiday Helper', 'Give 10 gifts'],
];

/** Every word a child reads (scanned by tools/test-gifts.mjs: no prices, no pronouns, no famous names). */
export const STRINGS = {
  title: 'Gift Workshop',
  workshop: 'Gift Workshop',
  surprise: 'Surprise Present',
  myGifts: 'My Gifts',
  steps: ['Toy', 'Box', 'Paper', 'Ribbon'],
  heads: ['What\'s inside?', 'Pick a box!', 'Pick the paper!', 'Ribbon and bow!'],
  treats: 'Treats',
  colors: 'Color',
  patterns: 'Pattern',
  bows: 'Bow',
  wrap: 'Wrap it!',
  wrapping: 'Wrapping...',
  ready: 'Ta-da! Your gift is ready!',
  forWho: 'Who is it for?',
  anyone: 'Anyone',
  done: 'Done!',
  next: 'Next',
  back: 'Back',
  random: 'Surprise me!',
  shelf: 'Your wrapped gifts',
  makeNew: 'Make a gift',
  holdIt: 'Hold it',
  shelfFull: 'Your gift shelf is full! Give a gift to a friend first!',
  to: 'To:',
  from: 'From:',
  hudGive: 'Give',
  hudDown: 'Put down',
  hudAway: 'Put away',
  holdNpc: 'Tap {to} to give your gift!',
  holdPlayer: 'Put it down for {to} to open!',
  holdAnyone: 'Tap a friend to give it, or tap the floor to put it down!',
  nextGift: 'Here is your next gift!',
  away: 'Your gift is saved for later!',
  placed: 'A present for {to}!',
  placedAnyone: 'A present! Who will open it?',
  noRoom: 'No room here! Try another spot.',
  opened: 'A {toy}! From {from}!',
  openedTo: 'A {toy} for {to}, from {from}!',
  openedTreat: 'Yummy! A treat from {from}!',
  sleeping: 'Shh... {friend} is asleep! Give it in the morning!',
  given: '{friend} loves the {toy}!',
  hintWorkshop: 'Tap to make a gift!',
  hintOpen: 'Tap to open the present!',
  hintPlay: 'Tap to play with the {toy}!',
  hintGive: 'Tap to give {friend} your gift!',
  newToy: 'New toy for your Bag: {toy}!',
  bagToys: 'Toys from presents are in your Bag!',
};

/** STRINGS[key] with {name} parts filled in. */
export function fmt(key, vars = {}) {
  const s = STRINGS[key] || key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

// ---------------------------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------------------------

const byKey = (list) => new Map(list.map((it, i) => [it.key, { ...it, i }]));
const TOY_MAP = byKey(TOYS), BOX_MAP = byKey(BOXES), PAPER_MAP = byKey(PAPERS);
const PATTERN_MAP = byKey(PATTERNS), RIBBON_MAP = byKey(RIBBONS), BOW_MAP = byKey(BOWS);

export const toy = (k) => TOY_MAP.get(k) || null;
export const box = (k) => BOX_MAP.get(k) || BOX_MAP.get('small');
export const paper = (k) => PAPER_MAP.get(k) || PAPER_MAP.get('red');
export const pattern = (k) => PATTERN_MAP.get(k) || PATTERN_MAP.get('stars');
export const ribbon = (k) => RIBBON_MAP.get(k) || RIBBON_MAP.get('gold');
export const bow = (k) => BOW_MAP.get(k) || BOW_MAP.get('bow');

/** The gift a fresh Workshop starts with (and the Bag's picture of a present). */
export const DEFAULT_GIFT = Object.freeze({ inside: 'teddy', box: 'small', paper: 'red', pattern: 'stars', ribbon: 'gold', bow: 'bow', to: '', from: '' });

const FOOD_RE = /^[a-z0-9_-]{1,48}$/;
const ID_RE = /^[a-z0-9]{4,12}$/;

/** A treat inside a gift ('t:' + a basket food key), or null. */
export function treatOf(inside) {
  if (typeof inside !== 'string' || !inside.startsWith('t:')) return null;
  const k = inside.slice(2);
  return FOOD_RE.test(k) ? k : null;
}

export const isInside = (v) => (typeof v === 'string' && !!TOY_MAP.get(v)) || !!treatOf(v);

/**
 * A name kept in a gift (To / From): letters, digits, spaces, an apostrophe or a dash, at most
 * NAME_MAX characters, never empty-looking. Anything else is dropped ('' = nobody / Anyone).
 */
export function cleanName(s, max = NAME_MAX) {
  if (typeof s !== 'string') return '';
  let t = s;
  try { t = t.normalize('NFKC'); } catch { /* keep it */ }
  t = t.replace(/[^\p{L}\p{M}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/(['\-]){2,}/g, '$1').replace(/^['\-\s]+|['\-\s]+$/g, '');
  const chars = Array.from(t);
  if (chars.length > max) t = chars.slice(0, max).join('').trim();
  return t;
}

/** A gift with every field valid (unknown keys fall back to the defaults). Never throws. */
export function normalizeGift(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  return {
    inside: isInside(g.inside) ? g.inside : DEFAULT_GIFT.inside,
    box: BOX_MAP.has(g.box) ? g.box : DEFAULT_GIFT.box,
    paper: PAPER_MAP.has(g.paper) ? g.paper : DEFAULT_GIFT.paper,
    pattern: PATTERN_MAP.has(g.pattern) ? g.pattern : DEFAULT_GIFT.pattern,
    ribbon: RIBBON_MAP.has(g.ribbon) ? g.ribbon : DEFAULT_GIFT.ribbon,
    bow: BOW_MAP.has(g.bow) ? g.bow : DEFAULT_GIFT.bow,
    to: cleanName(g.to),
    from: cleanName(g.from),
  };
}

/** The gift_box entity data for a gift (open: 0 wrapped, 1 opened; tree: a surprise present). */
export function giftData(raw, { open = 0, tree = 0 } = {}) {
  const g = normalizeGift(raw);
  const d = { inside: g.inside, box: g.box, paper: g.paper, pattern: g.pattern, ribbon: g.ribbon, bow: g.bow, to: g.to, from: g.from, open: open ? 1 : 0 };
  if (tree) d.tree = 1;
  return d;
}

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
export const HELD_RE = /^gift_w([0-9a-z])([0-9a-z])([0-9a-z])([0-9a-z])([0-9a-z])$/;

/** The held key friends' pages draw (presence `hi`): the look only, never names or the toy. */
export function heldKeyOf(raw) {
  const g = normalizeGift(raw);
  return 'gift_w' + [box(g.box).i, paper(g.paper).i, pattern(g.pattern).i, ribbon(g.ribbon).i, bow(g.bow).i].map((n) => B36[n]).join('');
}

/** A held key back to a gift look, or null for anything else. */
export function parseHeldKey(key) {
  const m = typeof key === 'string' ? HELD_RE.exec(key) : null;
  if (!m) return null;
  const at = (list, c) => list[B36.indexOf(c)] || null;
  const b = at(BOXES, m[1]), p = at(PAPERS, m[2]), pt = at(PATTERNS, m[3]), r = at(RIBBONS, m[4]), bw = at(BOWS, m[5]);
  if (!b || !p || !pt || !r || !bw) return null;
  return normalizeGift({ inside: DEFAULT_GIFT.inside, box: b.key, paper: p.key, pattern: pt.key, ribbon: r.key, bow: bw.key });
}

const pickOf = (list, rand) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

/** A random wrapped toy (the Bag's Surprise Present, "Surprise me!"). rand: () => [0, 1). */
export function randomGift(rand, base = {}) {
  return normalizeGift({
    ...base,
    inside: pickOf(TOYS, rand).key,
    box: pickOf(BOXES, rand).key,
    paper: pickOf(PAPERS, rand).key,
    pattern: pickOf(PATTERNS, rand).key,
    ribbon: pickOf(RIBBONS, rand).key,
    bow: pickOf(BOWS, rand).key,
  });
}

/** A ribbon that shows up on this paper (never the paper's own color). */
export function ribbonFor(paperKey, rand) {
  const p = paper(paperKey);
  const ok = RIBBONS.filter((r) => r.color.toLowerCase() !== p.color.toLowerCase() && !(p.key === 'snow' && r.key === 'white') && !(p.key === 'gold' && r.key === 'gold'));
  return pickOf(ok, rand).key;
}

/** A small hash of a string (FNV-1a), for the seeded picks below. */
export function hashStr(s) {
  let h = 2166136261;
  const t = String(s);
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 (a copy, so this file needs no imports). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The surprise present number i round the tree on game day `day` of a world: a wrapped toy from
 * the Holiday Tree, a new toy and paper every day, and never two the same toy the same day (for i < 16).
 */
export function treeGift(seed, day, i) {
  const d = Math.max(1, day | 0);
  const order = TOYS.map((t) => t.key);
  const r = seeded(hashStr(`tree|${seed}|${d}`));
  // a shuffle of the toys for the day (Fisher-Yates, bounded by the list)
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(r() * (k + 1));
    const tmp = order[k]; order[k] = order[j]; order[j] = tmp;
  }
  const look = seeded(hashStr(`treelook|${seed}|${d}|${i}`));
  const g = randomGift(look, { from: TREE_FROM, to: ANYONE });
  g.inside = order[((i | 0) % order.length + order.length) % order.length];
  g.ribbon = ribbonFor(g.paper, look);
  return g;
}

/** A short id for a wrapped gift on her shelf. */
export function newId(rand) {
  let s = '';
  for (let i = 0; i < 8; i++) s += B36[Math.floor(rand() * 36) % 36];
  return s;
}

// ---------------------------------------------------------------------------------------------
// profile.gifts
// ---------------------------------------------------------------------------------------------

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const nat = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** A clean sack entry ({ id, ...gift }) or null. */
export function cleanSackEntry(e) {
  if (!isObj(e) || typeof e.id !== 'string' || !ID_RE.test(e.id)) return null;
  return { id: e.id, ...normalizeGift(e) };
}

/**
 * profile.gifts, repaired in place (created when missing): { v, sack: [gift + id] (at most
 * SACK_MAX, oldest first), toys: { key: 1 }, made, given, opened, coinDay, coinsToday, last }.
 */
export function ensureGifts(profile) {
  if (!isObj(profile)) return null;
  const s = isObj(profile.gifts) ? profile.gifts : (profile.gifts = {});
  s.v = 1;
  const seen = new Set();
  s.sack = (Array.isArray(s.sack) ? s.sack : []).map(cleanSackEntry).filter((e) => e && !seen.has(e.id) && seen.add(e.id)).slice(0, SACK_MAX);
  const toys = isObj(s.toys) ? s.toys : {};
  s.toys = {};
  for (const k of Object.keys(toys)) if (TOY_MAP.has(k)) s.toys[k] = 1;
  for (const k of ['made', 'given', 'opened', 'coinDay', 'coinsToday']) s[k] = nat(s[k]);
  const last = isObj(s.last) ? normalizeGift(s.last) : { ...DEFAULT_GIFT };
  s.last = { box: last.box, paper: last.paper, pattern: last.pattern, ribbon: last.ribbon, bow: last.bow, inside: last.inside };
  return s;
}

/** Put a wrapped gift on her shelf (newest last). False when the shelf is full. */
export function sackAdd(gs, gift, id) {
  if (!gs || !Array.isArray(gs.sack) || gs.sack.length >= SACK_MAX) return false;
  const e = cleanSackEntry({ ...gift, id });
  if (!e || gs.sack.some((x) => x.id === e.id)) return false;
  gs.sack.push(e);
  return true;
}

/** Take a gift off the shelf by id (the first one when id is null); the entry, or null. */
export function sackTake(gs, id = null) {
  if (!gs || !Array.isArray(gs.sack) || !gs.sack.length) return null;
  const i = id === null ? 0 : gs.sack.findIndex((e) => e.id === id);
  if (i < 0) return null;
  return gs.sack.splice(i, 1)[0];
}

/** Move a gift to the front of the shelf (the one she holds). */
export function sackFront(gs, id) {
  if (!gs || !Array.isArray(gs.sack)) return false;
  const i = gs.sack.findIndex((e) => e.id === id);
  if (i < 0) return false;
  if (i > 0) gs.sack.unshift(gs.sack.splice(i, 1)[0]);
  return true;
}

/** Put a gift back at the front of the shelf (Undo of putting it down); false when full. */
export function sackReturn(gs, entry) {
  const e = cleanSackEntry(entry);
  if (!e || !gs || !Array.isArray(gs.sack)) return false;
  if (gs.sack.some((x) => x.id === e.id)) return true;
  if (gs.sack.length >= SACK_MAX) return false;
  gs.sack.unshift(e);
  return true;
}

/** yyyymmdd of a Date (a number that only grows). */
export function dayStamp(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * The coins for giving one gift today: GIVE_COINS until DAY_CAP is reached. Changes gs (the day
 * and today's count) and returns the coins to pay (0 once capped, or for a clock gone back).
 */
export function payForGift(gs, day, n = GIVE_COINS, cap = DAY_CAP) {
  if (!gs || !Number.isFinite(day)) return 0;
  if (!(gs.coinDay >= day)) { gs.coinDay = day; gs.coinsToday = 0; }
  if (gs.coinDay > day) return 0;
  const left = Math.max(0, cap - nat(gs.coinsToday));
  const pay = Math.min(left, nat(n));
  gs.coinsToday = nat(gs.coinsToday) + pay;
  return pay;
}

/**
 * Two copies of profile.gifts joined (cloud and backup merges): every toy from both, the bigger
 * counters, the newer day's coin count, the shelf of `a` with any gift only in `b` after it.
 */
export function mergeGifts(a, b) {
  const A = isObj(a) ? a : {}, B = isObj(b) ? b : {};
  const out = ensureGifts({ gifts: JSON.parse(JSON.stringify(A)) });
  const other = ensureGifts({ gifts: JSON.parse(JSON.stringify(B)) });
  for (const k of Object.keys(other.toys)) out.toys[k] = 1;
  for (const k of ['made', 'given', 'opened']) out[k] = Math.max(out[k], other[k]);
  if (other.coinDay > out.coinDay) { out.coinDay = other.coinDay; out.coinsToday = other.coinsToday; }
  else if (other.coinDay === out.coinDay) out.coinsToday = Math.max(out.coinsToday, other.coinsToday);
  for (const e of other.sack) if (out.sack.length < SACK_MAX && !out.sack.some((x) => x.id === e.id)) out.sack.push(e);
  return out;
}

/** How many toys of the 16 she has got from presents. */
export const toysGot = (gs) => (gs && isObj(gs.toys) ? Object.keys(gs.toys).filter((k) => TOY_MAP.has(k)).length : 0);

// ---------------------------------------------------------------------------------------------
// where the surprise presents go round the tree (holiday:presents)
// ---------------------------------------------------------------------------------------------

/**
 * Up to n cells for presents around (cx, cy, cz): free(x, y, z) says whether a present may stand
 * in that cell (air, solid floor under it, nothing there). Rings from radius 1 out to maxR,
 * at most 3 cells up or down, spread round the circle. Bounded: (2 maxR + 1)^2 x 7 checks.
 */
export function presentSpots(cx, cy, cz, n, free, maxR = 6) {
  const want = Math.max(0, Math.min(12, n | 0));
  const cand = [];
  for (let dx = -maxR; dx <= maxR; dx++) {
    for (let dz = -maxR; dz <= maxR; dz++) {
      const r = Math.hypot(dx, dz);
      if (r < 1 || r > maxR + 0.5) continue;
      for (const dy of [0, -1, 1, -2, 2, -3, 3]) {
        if (free(cx + dx, cy + dy, cz + dz)) {
          cand.push({ x: cx + dx, y: cy + dy, z: cz + dz, r, a: Math.atan2(dz, dx) });
          break;
        }
      }
    }
  }
  if (!cand.length || !want) return [];
  // the nearest ring that has room, then spread: each next cell is the one furthest (in angle)
  // from the cells already taken, among the nearest few
  cand.sort((p, q) => p.r - q.r || p.a - q.a);
  const out = [];
  const used = new Set();
  const key = (c) => c.x + ',' + c.y + ',' + c.z;
  for (let k = 0; k < want && out.length < cand.length; k++) {
    const pool = cand.filter((c) => !used.has(key(c))).slice(0, Math.max(6, want * 2));
    let best = null, bestScore = -Infinity;
    for (const c of pool) {
      let near = Infinity;
      for (const o of out) near = Math.min(near, Math.hypot(c.x - o.x, c.z - o.z));
      const score = (out.length ? Math.min(near, 4) : 0) - c.r * 0.35;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) break;
    used.add(key(best));
    out.push(best);
  }
  return out.map((c) => [c.x, c.y, c.z]);
}

// ---------------------------------------------------------------------------------------------
// animation curves (pure, so tests can check them)
// ---------------------------------------------------------------------------------------------

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);
const ease = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
/** A pop: 0 -> overshoot 1.25 -> 1. */
export function popCurve(v) {
  const t = clamp01(v);
  if (t < 0.6) return ease(t / 0.6) * 1.25;
  return 1.25 - 0.25 * ease((t - 0.6) / 0.4);
}

export const WRAP_SECONDS = 2.8;

/**
 * The wrapping moment at t seconds (0 .. WRAP_SECONDS): the toy sinks into the box, the lid
 * shuts, the paper wraps up from the bottom, the ribbon zips round, the bow pops.
 * Returns { toyY, toyS, lid, paper, ribbon, bow, done } (lid: 0 open .. 1 shut).
 */
export function wrapPose(t) {
  const s = Number.isFinite(t) ? Math.max(0, t) : 0;
  return {
    toyY: -ease(s / 0.6),
    toyS: 1 - 0.3 * ease(s / 0.6),
    lid: ease((s - 0.45) / 0.45),
    paper: ease((s - 0.95) / 0.7),
    ribbon: ease((s - 1.6) / 0.5),
    bow: popCurve((s - 2.05) / 0.55),
    done: s >= WRAP_SECONDS,
  };
}

export const GIVE_SECONDS = 3.2;

/**
 * Giving a gift to a friend at t seconds: the box flies from her hand to the friend (fly 0..1),
 * hovers and wiggles (wiggle: radians), POP (pop: true from 1.55 s), the toy rises (rise 0..1)
 * and lands in the friend's hands (hand: true from 2.5 s).
 */
export function givePose(t) {
  const s = Number.isFinite(t) ? Math.max(0, t) : 0;
  const w = s > 0.6 && s < 1.55 ? Math.sin((s - 0.6) * 22) * 0.18 * (1 - (s - 0.6) / 1.2) : 0;
  return {
    fly: ease(s / 0.6),
    arc: Math.sin(clamp01(s / 0.6) * Math.PI) * 0.6,
    wiggle: w,
    pop: s >= 1.55,
    boxS: s < 1.55 ? 1 : Math.max(0, 1 - (s - 1.55) / 0.25),
    rise: ease((s - 1.55) / 0.8),
    spin: s > 1.55 ? (s - 1.55) * 7 : 0,
    hand: s >= 2.5,
    done: s >= GIVE_SECONDS,
  };
}
