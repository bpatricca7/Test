// The Holiday Dress-Up rules (docs/teams/holiday-looks.md §3), pure: no DOM, no three.js scene,
// so tools/test-holiday-looks.mjs runs them in Node.
//
// profile.holidayLooks = { v: 1, own: clothes | null, wearing: outfit key | null }
//   own      her own clothes (top, bottom, dress, shoes, acc) from before the first costume;
//            "Back to me" puts them back. Only clothes: who she is (name, skin, hair, eyes,
//            face, sea form) is never touched by a costume, so a later Studio change to her hair
//            survives "Back to me".
//   wearing  the HOLIDAY_OUTFITS key the booth last put on (lights its button)
// A costume over a costume keeps the first `own`; once she wears no holiday piece any more (she
// changed in the Studio) the state is cleared, so "Back to me" never takes her somewhere old.

import {
  normalizeLook, applyOutfit, holidayOutfit, wearsHoliday, DEFAULT_LOOK,
  HAIR_STYLES, TOPS, BOTTOMS, DRESSES, SHOES, PATTERNS, HEAD_ACC, FACE_ACC, BACK_ACC, NECK_ACC, HAND_ACC,
} from '../wardrobe-data.js';

export const STATE_VERSION = 1;

/** The parts of a look a costume changes (and "Back to me" restores). */
export const CLOTHES = ['top', 'bottom', 'dress', 'shoes', 'acc'];

/** The booth's buttons: id -> the costume for each side ('g' girl, 'b' boy, 'n' not sure). */
export const COSTUMES = {
  elf: { g: 'elf_girl', b: 'elf', n: 'elf' },
  santa: { g: 'santa', b: 'santa', n: 'santa' },
  santa_dress: { g: 'mrs_santa', b: 'mrs_santa', n: 'mrs_santa' },
};

/** Big button words and pictures (src/ui/dressup/pictures.js). */
export const BUTTONS = {
  elf: { label: 'Be an Elf', pic: 'elf', color: 'var(--sw-mint)' },
  santa: { label: 'Be Santa', pic: 'santa', color: '#FF8C8C' },
  santa_dress: { label: 'Santa Dress', pic: 'santa_dress', color: 'var(--sw-pink)' },
  me: { label: 'Back to me', pic: 'my_look', color: 'var(--sw-sun)' },
};

/** Which sticker a costume earns (stickers.js). */
export const STICKER_FOR = { elf: 'look_elf', elf_girl: 'look_elf', santa: 'look_santa', mrs_santa: 'look_santa' };

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Just the clothes of a look (normalized). */
export function clothesOf(look) {
  const L = normalizeLook(look);
  const out = {};
  for (const k of CLOTHES) out[k] = clone(L[k]);
  return out;
}

/** A look with these clothes put on (identity kept from `look`). */
export function withClothes(look, clothes) {
  const L = normalizeLook(look);
  if (!clothes) return L;
  const next = { ...L };
  for (const k of CLOTHES) if (k in clothes) next[k] = clone(clothes[k]);
  return normalizeLook(next);
}

/** profile.holidayLooks, read safely (anything odd becomes "not dressed up"). */
export function normState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  let own = null;
  if (s.own && typeof s.own === 'object') {
    try {
      own = clothesOf(withClothes(DEFAULT_LOOK, s.own));
    } catch {
      own = null;
    }
  }
  const wearing = typeof s.wearing === 'string' && holidayOutfit(s.wearing) ? s.wearing : null;
  return { v: STATE_VERSION, own, wearing };
}

export const EMPTY_STATE = Object.freeze({ v: STATE_VERSION, own: null, wearing: null });

const only = (tag, letter) => (tag || 'g') === letter;

/**
 * Girl or boy leaning of a look, by its one-side items (hair, clothes, patterns, shoes,
 * accessories): 'g', 'b', or 'n' (nothing says). A dress says girl.
 */
export function lookLean(look) {
  const L = normalizeLook(look);
  let score = 0;
  const count = (list, key) => {
    if (!key || key === 'none') return;
    const o = list.find((x) => x.key === key);
    if (!o) return;
    if (only(o.tag, 'b')) score++;
    else if (only(o.tag, 'g')) score--;
  };
  count(HAIR_STYLES, L.hair.style);
  count(HAIR_STYLES, L.hair.style); // her hair says the most
  const worn = L.dress ? [[DRESSES, L.dress]] : [[TOPS, L.top], [BOTTOMS, L.bottom]];
  for (const [list, g] of worn) {
    count(list, g.type);
    count(PATTERNS, g.pattern);
  }
  count(SHOES, L.shoes.type);
  for (const [list, slot] of [[HEAD_ACC, 'head'], [FACE_ACC, 'face'], [BACK_ACC, 'back'], [NECK_ACC, 'neck'], [HAND_ACC, 'hand']]) count(list, L.acc[slot]);
  if (score > 0) return 'b';
  if (score < 0 || L.dress) return 'g';
  return 'n';
}

/** The booth's side: the Studio's Girl / Boy choice first, else what her own look says. */
export function sideFor(look, style) {
  if (style === 'girl') return 'g';
  if (style === 'boy') return 'b';
  return lookLean(look);
}

/** The buttons to show for a side: [{ id, label, pic, color, outfit?, on, off }]. */
export function buttonsFor(side, state) {
  const s = normState(state);
  const ids = side === 'g' ? ['elf', 'santa', 'santa_dress'] : ['elf', 'santa'];
  const out = ids.map((id) => {
    const outfit = COSTUMES[id][side] || COSTUMES[id].n;
    return { id, ...BUTTONS[id], outfit, on: s.wearing === outfit, off: false };
  });
  out.push({ id: 'me', ...BUTTONS.me, outfit: null, on: false, off: !s.own });
  return out;
}

/**
 * Put on a costume. Returns { look, state } (both new objects), or null for an unknown key.
 * Her own clothes are kept the first time; switching costumes keeps the first ones.
 */
export function wearCostume(look, state, outfitKey) {
  const outfit = holidayOutfit(outfitKey);
  if (!outfit) return null;
  const cur = normalizeLook(look);
  const s = normState(state);
  const own = s.own && wearsHoliday(cur) ? s.own : clothesOf(cur);
  // the costume goes over her OWN clothes, so nothing of another costume stays hidden under it
  const next = applyOutfit(withClothes(cur, own), outfit);
  return { look: next, state: { v: STATE_VERSION, own, wearing: outfit.key } };
}

/** "Back to me": her own clothes back on, the state cleared. Null when there is nothing kept. */
export function backToMe(look, state) {
  const s = normState(state);
  if (!s.own) return null;
  return { look: withClothes(look, s.own), state: { ...EMPTY_STATE } };
}

/** After a look change that did not come from the booth: still dressed up? */
export function afterOutsideChange(state, look) {
  const s = normState(state);
  if (!s.own && !s.wearing) return s;
  if (wearsHoliday(look)) return s;
  return { ...EMPTY_STATE };
}

/** Which costume (sticker key) a look shows: 'elf' | 'santa' | null (Studio picks count too). */
export function costumeShown(look) {
  const L = normalizeLook(look);
  const body = L.dress ? L.dress.type : L.top.type;
  if (L.acc.head === 'elf_hat' && (body === 'elf_tunic' || body === 'elf_dress')) return 'elf';
  if ((L.acc.head === 'santa_hat' || L.acc.face === 'beard') && (body === 'santa_coat' || body === 'santa_dress')) return 'santa';
  return null;
}

// ---------- NPC friends in Holiday Village ----------

/** The world is Holiday Village (the `holiday` biome). */
export function isHolidayWorld(world) {
  return !!(world && world.meta && world.meta.biome === 'holiday');
}

/** Friend holiday outfits (src/things/friends/looks.js keys) for each kind. */
export const FRIEND_HOLIDAY = {
  girl: ['hl_elf_girl', 'hl_mrs_santa', 'hl_cozy', 'hl_snowflake_girl', 'hl_reindeer_girl'],
  boy: ['hl_elf', 'hl_santa', 'hl_cozy', 'hl_snowflake', 'hl_reindeer'],
};

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Picked by hand so the village has a mix (two or three elves, one Santa, reindeer...). */
const FRIEND_PICKS = {
  mia: 'hl_reindeer_girl', zoe: 'hl_elf_girl', ava: 'hl_elf_girl', lilyrose: 'hl_mrs_santa', maya: 'hl_cozy',
  chloe: 'hl_snowflake_girl', nia: 'hl_elf_girl', emma: 'hl_cozy', sofia: 'hl_snowflake_girl', aria: 'hl_mrs_santa',
  leo: 'hl_elf', max: 'hl_reindeer', kai: 'hl_snowflake', sam: 'hl_santa', ezra: 'hl_cozy', theo: 'hl_elf',
};

/** The holiday outfit a friend wears in Holiday Village (the same one every time). */
export function friendHolidayKey(def) {
  if (!def || !def.key) return null;
  const list = def.kind === 'boy' ? FRIEND_HOLIDAY.boy : FRIEND_HOLIDAY.girl;
  const pick = FRIEND_PICKS[def.key];
  return pick && list.includes(pick) ? pick : list[hash(def.key) % list.length];
}
