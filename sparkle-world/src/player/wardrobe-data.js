// Wardrobe data: the default look, every option list the Dress-Up Studio offers (stable keys
// saved in profiles + friendly names kids read), curated color palettes, normalizeLook,
// a coordinated randomLook ("Surprise me!" in a Girl, Boy or Mix style) and the ready-made
// starter outfits.
//
// Option lists are APPEND ONLY: the multiplayer look codec sends list indices, so old saves and
// old tokens keep their meaning only while no entry moves. Each option carries a `tag` ('g',
// 'b' or 'gb') that only says which "Surprise me!" style picks it; every option is free for
// anyone in the Studio.
//
// look = {
//   name, skin,
//   hair:  { style, color, color2: hex | 'rainbow' | null, mix: 'ombre' | 'streaks' | 'tips' },
//   eyes:  { color, lashes }, face: { blush, freckles, smile, brows: 'soft' | 'bold' },
//   top: { type, color, pattern, patternColor, num: 0..99 (only drawn on a jersey) },
//   bottom: { type, color, pattern, patternColor },  dress: null | { type, color, pattern, patternColor },
//   shoes: { type, color },
//   acc: { head, headColor, face, faceColor, back, backColor, neck, neckColor, hand, handColor }
// }   (faceColor / handColor may be null = the item's own default colors)

export const DEFAULT_LOOK = {
  name: 'Lily',
  skin: '#F6D2B8',
  hair: { style: 'long', color: '#7A4A2A', color2: null, mix: 'ombre' },
  eyes: { color: '#5A3A28', lashes: true },
  face: { blush: true, freckles: false, smile: 'happy', brows: 'soft' },
  top: { type: 'tshirt', color: '#FF8CC6', pattern: 'hearts', patternColor: '#FFFFFF', num: 7 },
  bottom: { type: 'skirt', color: '#8E7CFF', pattern: 'none', patternColor: '#FFFFFF' },
  dress: null,
  shoes: { type: 'sneakers', color: '#FFFFFF' },
  acc: {
    head: 'bow', headColor: '#FF5FA2', face: 'none', faceColor: null, back: 'none', backColor: '#B8E1FF',
    neck: 'none', neckColor: '#FFD54A', hand: 'none', handColor: null,
  },
};

// [key, name, tag]: tag 'g' = in the Girl surprise (the default), 'b' = in the Boy surprise,
// 'gb' = both. Each list's Girl filter is exactly the list as it was before the boy items, so
// the Girl surprise (and its seeded results) is what it always was.
const opts = (pairs) => pairs.map(([key, name, tag = 'g']) => ({ key, name, tag }));

export const HAIR_STYLES = opts([
  ['long', 'Long'], ['ponytail', 'Ponytail'], ['pigtails', 'Pigtails'], ['bun', 'Bun'],
  ['space_buns', 'Space Buns'], ['braids', 'Braids'], ['curly', 'Curly', 'gb'], ['bob', 'Bob'],
  ['short', 'Short'], ['side_pony', 'Side Pony'], ['wavy_long', 'Wavy'], ['pixie', 'Pixie'],
  ['buzz', 'Buzz Cut', 'b'], ['spiky', 'Spiky', 'b'], ['side_part', 'Side Part', 'b'], ['shaggy', 'Shaggy', 'b'],
  ['short_curly', 'Short Curls', 'b'], ['fauxhawk', 'Faux Hawk', 'b'], ['afro', 'Afro', 'b'],
]);
export const HAIR_MIXES = opts([['ombre', 'Ombre', 'gb'], ['streaks', 'Streaks', 'gb'], ['tips', 'Tips', 'gb']]);
export const TOPS = opts([
  ['tshirt', 'T-Shirt', 'gb'], ['tank', 'Tank Top'], ['hoodie', 'Hoodie', 'gb'], ['sweater', 'Sweater', 'gb'],
  ['blouse', 'Blouse'], ['crop', 'Crop Top'], ['jacket', 'Jacket', 'gb'], ['sparkle_top', 'Sparkle Top'],
  ['polo', 'Polo', 'b'], ['jersey', 'Jersey', 'b'], ['button_up', 'Button-Up', 'b'], ['tee_dino', 'Dino Tee', 'b'],
  ['tee_rocket', 'Rocket Tee', 'b'], ['tee_bolt', 'Lightning Tee', 'b'],
]);
export const BOTTOMS = opts([
  ['skirt', 'Skirt'], ['tutu', 'Tutu'], ['jeans', 'Jeans', 'gb'], ['leggings', 'Leggings'],
  ['shorts', 'Shorts', 'gb'], ['overalls', 'Overalls', 'gb'], ['pleated', 'Pleated Skirt'],
  ['cargo_shorts', 'Cargo Shorts', 'b'], ['joggers', 'Joggers', 'b'], ['pants', 'Pants', 'b'],
]);
export const DRESSES = opts([
  ['sundress', 'Sundress'], ['party', 'Party Dress'], ['princess', 'Princess Dress'],
  ['ballgown', 'Ball Gown'], ['overall_dress', 'Overall Dress'], ['mermaid', 'Mermaid Dress'],
]);
export const SHOES = opts([
  ['sneakers', 'Sneakers', 'gb'], ['boots', 'Boots', 'gb'], ['sandals', 'Sandals', 'gb'], ['sparkle', 'Sparkle Shoes'],
  ['rainboots', 'Rain Boots', 'gb'], ['ballet', 'Ballet Flats'], ['roller_skates', 'Roller Skates', 'gb'],
  ['high_tops', 'High-Tops', 'b'], ['skate_shoes', 'Skate Shoes', 'b'],
]);
export const HEAD_ACC = opts([
  ['none', 'None', 'gb'], ['bow', 'Bow'], ['tiara', 'Tiara'], ['crown', 'Crown'], ['flower_crown', 'Flower Crown'],
  ['cat_ears', 'Cat Ears'], ['bunny_ears', 'Bunny Ears'], ['unicorn_horn', 'Unicorn Horn'], ['beanie', 'Beanie', 'gb'],
  ['sun_hat', 'Sun Hat'], ['headband', 'Headband'], ['witch_hat', 'Sparkly Hat', 'gb'], ['halo', 'Halo'],
  ['cap', 'Cap', 'b'], ['cap_back', 'Backwards Cap', 'b'], ['bucket_hat', 'Bucket Hat', 'b'], ['headphones', 'Headphones', 'b'],
]);
export const FACE_ACC = opts([
  ['none', 'None', 'gb'], ['glasses', 'Glasses', 'gb'], ['sunglasses', 'Sunglasses', 'gb'], ['heart_glasses', 'Heart Glasses'],
  ['star_glasses', 'Star Glasses', 'gb'],
]);
export const BACK_ACC = opts([
  ['none', 'None', 'gb'], ['fairy_wings', 'Fairy Wings'], ['butterfly_wings', 'Butterfly Wings'],
  ['angel_wings', 'Angel Wings'], ['backpack', 'Backpack', 'gb'], ['cape', 'Cape', 'gb'],
  ['star_pack', 'Star Backpack', 'b'],
]);
export const NECK_ACC = opts([
  ['none', 'None', 'gb'], ['necklace', 'Necklace'], ['pearls', 'Pearls'], ['scarf', 'Scarf', 'gb'], ['bowtie', 'Bow Tie', 'gb'],
  ['necktie', 'Tie', 'b'], ['medal', 'Medal', 'b'],
]);
export const HAND_ACC = opts([
  ['none', 'None', 'gb'], ['wand', 'Magic Wand', 'gb'], ['purse', 'Purse'], ['balloon', 'Balloon', 'gb'], ['teddy', 'Teddy', 'gb'],
  ['ice_cream', 'Ice Cream', 'gb'],
  ['soccer_ball', 'Soccer Ball', 'b'], ['toy_car', 'Toy Car', 'b'], ['dino_toy', 'Toy Dino', 'b'],
]);
export const PATTERNS = opts([
  ['none', 'Plain', 'gb'], ['hearts', 'Hearts'], ['stars', 'Stars', 'gb'], ['stripes', 'Stripes', 'gb'], ['dots', 'Dots', 'gb'],
  ['rainbow', 'Rainbow'], ['flowers', 'Flowers'],
  ['plaid', 'Plaid', 'b'], ['checks', 'Checks', 'b'], ['bolts', 'Lightning', 'b'], ['dinos', 'Dinos', 'b'], ['rockets', 'Rockets', 'b'],
]);
export const SMILES = opts([['happy', 'Happy', 'gb'], ['grin', 'Big Smile', 'gb'], ['cat', 'Cat Smile', 'gb'], ['open', 'Excited', 'gb']]);
/** Eyebrows: 'soft' is the original gentle arc, 'bold' a thicker, flatter brow. */
export const BROWS = opts([['soft', 'Soft', 'gb'], ['bold', 'Bold', 'gb']]);
/** "Surprise me!" styles, cycled by the Studio's style button (device-local `surpriseStyle`). */
export const SURPRISE_STYLES = ['girl', 'boy', 'mix'];

/**
 * The options one "Surprise me!" style picks from (letter 'g' or 'b'), in list order. Falls back
 * to the whole list if a filter is ever empty, so a pick can never be undefined.
 */
export function tagged(list, letter) {
  const out = list.filter((o) => (o.tag || 'g').includes(letter));
  return out.length ? out : list;
}
export const EMOTES = opts([
  ['wave', 'Wave'], ['dance', 'Dance'], ['twirl', 'Twirl'], ['cartwheel', 'Cartwheel'],
  ['jump', 'Jump'], ['heart', 'Heart'], ['sit', 'Sit'],
]);

// ---------- palettes ----------

/** Diverse skin tones, light to deep. */
export const SKIN_TONES = [
  '#FFE6D8', '#F6D2B8', '#F0C3A0', '#E4AE86', '#D69B6E', '#C3845A', '#A96C45', '#8C5535', '#6D4029', '#51301E',
];
export const HAIR_COLORS_NATURAL = ['#1F1614', '#3B2419', '#7A4A2A', '#A0592D', '#D9762F', '#C99A5B', '#EACB86', '#F7E7B7'];
export const HAIR_COLORS_FANTASY = ['#FF8CC6', '#FF5FA2', '#C9A2FF', '#9C7BFF', '#7FD3FF', '#4D7CFF', '#5FE3C0', '#E9EEF6'];
export const HAIR_COLORS = [...HAIR_COLORS_NATURAL, ...HAIR_COLORS_FANTASY];
export const EYE_COLORS = ['#5A3A28', '#2E1E14', '#8A6A2E', '#3C9A64', '#3F7AC9', '#7C8B96', '#8B6BD6', '#E0569A', '#2FB5B0'];
export const CLOTH_COLORS = [
  '#FFFFFF', '#FFF4E0', '#FFD1E6', '#FF8CC6', '#FF5FA2', '#E64980', '#FF6B6B', '#FFA94D', '#FFC9A8',
  '#FFE58A', '#FFD43B', '#B8F2A0', '#6BD68A', '#3FD8B0', '#A5F0E6', '#B8E1FF', '#6CC6FF', '#4D7CFF',
  '#E6DDFF', '#C3A6FF', '#9C7BFF', '#7048E8', '#8B5E3C', '#6B7280', '#3A1F4D', '#222230',
];
export const METAL_COLORS = ['#FFD54A', '#DDE3EC', '#F4B3A0'];
/** Accessory colors: shiny metals first, then the cloth palette. */
export const ACC_COLORS = [...METAL_COLORS, ...CLOTH_COLORS];
/** Pastel rainbow used for rainbow hair and the rainbow pattern. */
export const RAINBOW = ['#FF8A8A', '#FFB86B', '#FFE27A', '#9BE58A', '#7FD3FF', '#A99BFF', '#E59BFF'];

// ---------- validation ----------

const HEX = /^#[0-9a-fA-F]{6}$/;
const keySet = (list) => new Set(list.map((o) => o.key));
const KEYS = {
  hair: keySet(HAIR_STYLES), mix: keySet(HAIR_MIXES), top: keySet(TOPS), bottom: keySet(BOTTOMS),
  dress: keySet(DRESSES), shoes: keySet(SHOES), head: keySet(HEAD_ACC), face: keySet(FACE_ACC),
  back: keySet(BACK_ACC), neck: keySet(NECK_ACC), hand: keySet(HAND_ACC), pattern: keySet(PATTERNS),
  smile: keySet(SMILES), brows: keySet(BROWS),
};

const col = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : d);
const colOrNull = (v) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : null);
const one = (v, set, d) => (set.has(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
// A whole number in [lo, hi]; strings, NaN and Infinity give the default.
const int = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

function garment(g, d, types) {
  const src = g && typeof g === 'object' ? g : {};
  return {
    type: one(src.type, types, d.type),
    color: col(src.color, d.color),
    pattern: one(src.pattern, KEYS.pattern, d.pattern || 'none'),
    patternColor: col(src.patternColor, d.patternColor || '#FFFFFF'),
  };
}

/** A complete, valid, deep-copied look: fills gaps from defaults and drops unknown keys. */
export function normalizeLook(look) {
  const d = DEFAULT_LOOK;
  const l = look && typeof look === 'object' ? look : {};
  const hair = l.hair || {};
  const eyes = l.eyes || {};
  const face = l.face || {};
  const acc = l.acc || {};
  const shoes = l.shoes || {};
  const name = typeof l.name === 'string' ? l.name.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  const color2 = hair.color2 === 'rainbow' ? 'rainbow' : colOrNull(hair.color2);
  return {
    name: name || d.name,
    skin: col(l.skin, d.skin),
    hair: {
      style: one(hair.style, KEYS.hair, d.hair.style),
      color: col(hair.color, d.hair.color),
      color2,
      mix: one(hair.mix, KEYS.mix, 'ombre'),
    },
    eyes: { color: col(eyes.color, d.eyes.color), lashes: bool(eyes.lashes, d.eyes.lashes) },
    face: {
      blush: bool(face.blush, d.face.blush),
      freckles: bool(face.freckles, d.face.freckles),
      smile: one(face.smile, KEYS.smile, d.face.smile),
      brows: one(face.brows, KEYS.brows, d.face.brows),
    },
    // `num` lives on the top only (bottoms and dresses have no number).
    top: { ...garment(l.top, d.top, KEYS.top), num: int(l.top && l.top.num, 0, 99, d.top.num) },
    bottom: garment(l.bottom, d.bottom, KEYS.bottom),
    dress: l.dress && typeof l.dress === 'object' && KEYS.dress.has(l.dress.type)
      ? garment(l.dress, { type: 'sundress', color: '#FF8CC6', pattern: 'none', patternColor: '#FFFFFF' }, KEYS.dress)
      : null,
    shoes: { type: one(shoes.type, KEYS.shoes, d.shoes.type), color: col(shoes.color, d.shoes.color) },
    acc: {
      head: one(acc.head, KEYS.head, d.acc.head),
      headColor: col(acc.headColor, d.acc.headColor),
      face: one(acc.face, KEYS.face, d.acc.face),
      faceColor: colOrNull(acc.faceColor),
      back: one(acc.back, KEYS.back, d.acc.back),
      backColor: col(acc.backColor, d.acc.backColor),
      neck: one(acc.neck, KEYS.neck, d.acc.neck),
      neckColor: col(acc.neckColor, d.acc.neckColor),
      hand: one(acc.hand, KEYS.hand, d.acc.hand),
      handColor: colOrNull(acc.handColor),
    },
  };
}

/** Deep copy of a look (normalized). */
export function cloneLook(look) {
  return normalizeLook(look);
}

/** Stable string for a look (cache keys, change detection). */
export function lookSignature(look) {
  return JSON.stringify(normalizeLook(look));
}

/**
 * True while a profile's look is still the untouched default (any name) and the Studio was
 * never visited from the title's nudge: the title's Dress Up tile then wiggles.
 */
export function freshLook(profile) {
  if (!profile || typeof profile !== 'object' || profile.lookPicked) return false;
  return lookSignature({ ...normalizeLook(profile.look), name: DEFAULT_LOOK.name }) === lookSignature(DEFAULT_LOOK);
}

/** The name is still the unset default (never typed): greetings say "friend" for a Boy style. */
export function nameUnset(profile) {
  return !!profile && !profile.nameSet && normalizeLook(profile.look).name === DEFAULT_LOOK.name;
}

/**
 * A Boy style on this device while the name was never typed: the game calls him "friend" (or
 * shows no name), never the girl default (boys.md). game.surpriseStyle comes from the Studio.
 */
export function boyNameUnset(game) {
  return !!game && typeof game.surpriseStyle === 'function' && game.surpriseStyle() === 'boy' && nameUnset(game.profile);
}

// ---------- "Surprise me!" ----------

// Color stories: a main color, a second color, an accent and a light pattern color that all
// go together, so random outfits look planned.
const THEMES = [
  { name: 'cotton candy', main: ['#FF8CC6', '#FFD1E6'], second: ['#C3A6FF', '#E6DDFF', '#B8E1FF'], accent: ['#FF5FA2', '#9C7BFF'], light: ['#FFFFFF', '#FFF4E0'] },
  { name: 'mermaid', main: ['#3FD8B0', '#A5F0E6'], second: ['#9C7BFF', '#C3A6FF', '#6CC6FF'], accent: ['#FF8CC6', '#4D7CFF'], light: ['#FFFFFF', '#E6DDFF'] },
  { name: 'sunshine', main: ['#FFD43B', '#FFE58A'], second: ['#6CC6FF', '#FF8CC6', '#FFFFFF'], accent: ['#FF6B6B', '#FFA94D'], light: ['#FFFFFF'] },
  { name: 'berry', main: ['#E64980', '#FF5FA2'], second: ['#7048E8', '#9C7BFF', '#3A1F4D'], accent: ['#FFD43B', '#FFD1E6'], light: ['#FFFFFF', '#FFD1E6'] },
  { name: 'sky', main: ['#6CC6FF', '#B8E1FF'], second: ['#FFFFFF', '#FFE58A', '#4D7CFF'], accent: ['#FFD43B', '#FF8CC6'], light: ['#FFFFFF'] },
  { name: 'garden', main: ['#6BD68A', '#B8F2A0'], second: ['#FF8CC6', '#FFE58A', '#FFFFFF'], accent: ['#FF5FA2', '#FFD43B'], light: ['#FFFFFF', '#FFF4E0'] },
  { name: 'rock star', main: ['#3A1F4D', '#222230'], second: ['#FF5FA2', '#9C7BFF', '#E64980'], accent: ['#FFD43B', '#6CC6FF'], light: ['#FF5FA2', '#FFD43B', '#FFFFFF'] },
  { name: 'peachy', main: ['#FFC9A8', '#FFA94D'], second: ['#FFF4E0', '#FFD1E6', '#3FD8B0'], accent: ['#FF6B6B', '#FF5FA2'], light: ['#FFFFFF'] },
  { name: 'lavender', main: ['#C3A6FF', '#9C7BFF'], second: ['#E6DDFF', '#FFD1E6', '#FFFFFF'], accent: ['#FF8CC6', '#FFD54A'], light: ['#FFFFFF', '#FFE58A'] },
  { name: 'rainbow', main: ['#FFFFFF', '#E6DDFF'], second: ['#6CC6FF', '#FF8CC6', '#FFD43B'], accent: ['#FF5FA2', '#3FD8B0'], light: ['#FF5FA2', '#6CC6FF'], rainbow: true },
];

// Boy color stories: sporty, outdoorsy and space colors (same shape as THEMES).
export const BOY_THEMES = [
  { name: 'team', main: ['#4D7CFF', '#FF6B6B'], second: ['#FFFFFF', '#3A1F4D', '#6B7280'], accent: ['#FF6B6B', '#FFD43B'], light: ['#FFFFFF'] },
  { name: 'ocean', main: ['#6CC6FF', '#3FD8B0'], second: ['#4D7CFF', '#FFFFFF', '#3A1F4D'], accent: ['#4D7CFF', '#FFD43B'], light: ['#FFFFFF'] },
  { name: 'forest', main: ['#6BD68A', '#8B5E3C'], second: ['#8B5E3C', '#6B7280', '#FFE58A'], accent: ['#FFE58A', '#FFA94D'], light: ['#FFFFFF', '#FFE58A'] },
  { name: 'sunset', main: ['#FFA94D', '#FF6B6B'], second: ['#3A1F4D', '#4D7CFF', '#FFE58A'], accent: ['#FFE58A', '#FF6B6B'], light: ['#FFFFFF', '#FFE58A'] },
  { name: 'space', main: ['#3A1F4D', '#7048E8'], second: ['#6B7280', '#222230', '#7048E8'], accent: ['#6CC6FF', '#FFD43B'], light: ['#6CC6FF', '#FFFFFF'] },
  { name: 'dino', main: ['#B8F2A0', '#6BD68A'], second: ['#8B5E3C', '#4D7CFF', '#6B7280'], accent: ['#FFA94D', '#6BD68A'], light: ['#FFFFFF', '#FFA94D'] },
];
const BOY_PATTERNS = ['stars', 'stripes', 'dots', 'plaid', 'checks', 'bolts', 'dinos', 'rockets'];

/**
 * A random (always cute, color-coordinated) look. rand() -> [0, 1). When `base` is given its
 * name, skin, eyes and face are kept (the Studio's "Surprise me!" keeps who you are and
 * changes what you wear). `style`: 'girl' (the default, exactly the original surprise, the same
 * rand() calls in the same order), 'boy', or 'mix' (one rand() picks the girl or boy branch,
 * then the hair style comes from every style).
 */
export function randomLook(rand = Math.random, name = DEFAULT_LOOK.name, base = null, style = 'girl') {
  if (style === 'boy') return boyLook(rand, name, base, tagged(HAIR_STYLES, 'b'));
  if (style === 'mix') return rand() < 0.5 ? boyLook(rand, name, base, HAIR_STYLES) : girlLook(rand, name, base, HAIR_STYLES);
  return girlLook(rand, name, base, tagged(HAIR_STYLES, 'g'));
}

function girlLook(rand, name, base, hairStyles) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
  const chance = (p) => rand() < p;
  const TOPS_G = tagged(TOPS, 'g');
  const BOTTOMS_G = tagged(BOTTOMS, 'g');
  const SHOES_G = tagged(SHOES, 'g');
  const th = pick(THEMES);
  const main = pick(th.main);
  const second = pick(th.second.filter((c) => c !== main)) || pick(th.second);
  const accent = pick(th.accent);
  const light = pick(th.light.filter((c) => c !== main)) || '#FFFFFF';
  const pattern = () => (th.rainbow && chance(0.6) ? 'rainbow' : chance(0.5) ? 'none' : pick(['hearts', 'stars', 'stripes', 'dots', 'flowers']));
  const dressType = chance(0.4) ? pick(DRESSES).key : null;
  const top = pick(TOPS_G).key;
  const bottom = pick(BOTTOMS_G).key;
  const natural = chance(0.72);
  const hairColor = base && chance(0.6) ? base.hair.color : natural ? pick(HAIR_COLORS_NATURAL) : pick(HAIR_COLORS_FANTASY);
  const color2 = chance(0.22) ? (th.rainbow || chance(0.25) ? 'rainbow' : pick([accent, second, ...HAIR_COLORS_FANTASY])) : null;
  const metals = ['#FFD54A', '#DDE3EC'];
  const shoesType = dressType === 'ballgown' || dressType === 'princess' ? pick(['sparkle', 'ballet']) : pick(SHOES_G).key;
  const back = chance(0.3) ? pick(tagged(BACK_ACC, 'g').slice(1)).key : 'none';
  const look = {
    name: base ? base.name : name,
    skin: base ? base.skin : pick(SKIN_TONES),
    hair: {
      style: pick(hairStyles).key,
      color: hairColor,
      color2: color2 === hairColor ? null : color2,
      mix: pick(HAIR_MIXES).key,
    },
    eyes: base ? { ...base.eyes } : { color: pick(EYE_COLORS), lashes: chance(0.8) },
    face: base ? { ...base.face } : { blush: chance(0.85), freckles: chance(0.25), smile: pick(SMILES).key },
    top: { type: top, color: main, pattern: pattern(), patternColor: light },
    bottom: { type: bottom, color: second, pattern: chance(0.75) ? 'none' : pattern(), patternColor: light },
    dress: dressType ? { type: dressType, color: main, pattern: pattern(), patternColor: light } : null,
    shoes: { type: shoesType, color: chance(0.35) ? '#FFFFFF' : pick([accent, second]) },
    acc: {
      head: chance(0.7) ? pick(tagged(HEAD_ACC, 'g').slice(1)).key : 'none',
      headColor: pick([accent, accent, ...metals, second]),
      face: chance(0.2) ? pick(tagged(FACE_ACC, 'g').slice(1)).key : 'none',
      faceColor: chance(0.5) ? accent : null,
      back,
      backColor: pick([second, accent, main === '#FFFFFF' ? accent : main]),
      neck: chance(0.3) ? pick(tagged(NECK_ACC, 'g').slice(1)).key : 'none',
      neckColor: pick([...metals, accent]),
      hand: chance(0.3) ? pick(tagged(HAND_ACC, 'g').slice(1)).key : 'none',
      handColor: chance(0.6) ? accent : null,
    },
  };
  return normalizeLook(look);
}

// The Boy surprise: short hair, boy clothes, mostly no lashes, often bold brows, a jersey number.
// A fixed number of rand() calls, no retry loops.
function boyLook(rand, name, base, hairStyles) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
  const chance = (p) => rand() < p;
  const th = pick(BOY_THEMES);
  const main = pick(th.main);
  const second = pick(th.second.filter((c) => c !== main)) || pick(th.second);
  const accent = pick(th.accent.filter((c) => c !== main)) || pick(th.accent);
  const light = pick(th.light.filter((c) => c !== main)) || '#FFFFFF';
  const pattern = () => (chance(0.5) ? 'none' : pick(BOY_PATTERNS));
  const top = pick(tagged(TOPS, 'b')).key;
  const bottom = pick(tagged(BOTTOMS, 'b')).key;
  const hairColor = base && chance(0.6) ? base.hair.color : chance(0.85) ? pick(HAIR_COLORS_NATURAL) : pick(HAIR_COLORS_FANTASY);
  const color2 = chance(0.1) ? pick([accent, ...HAIR_COLORS_FANTASY]) : null;
  const look = {
    name: base ? base.name : name,
    skin: base ? base.skin : pick(SKIN_TONES),
    hair: {
      style: pick(hairStyles).key,
      color: hairColor,
      color2: color2 === hairColor ? null : color2,
      mix: pick(HAIR_MIXES).key,
    },
    eyes: base ? { ...base.eyes } : { color: pick(EYE_COLORS), lashes: chance(0.15) },
    face: base ? { ...base.face } : {
      blush: chance(0.5), freckles: chance(0.25), smile: pick(SMILES).key, brows: chance(0.55) ? 'bold' : 'soft',
    },
    top: { type: top, color: main, pattern: pattern(), patternColor: light, num: 1 + Math.floor(rand() * 99) },
    bottom: { type: bottom, color: second, pattern: chance(0.85) ? 'none' : pattern(), patternColor: light },
    dress: null,
    shoes: { type: pick(tagged(SHOES, 'b')).key, color: chance(0.35) ? '#FFFFFF' : pick([accent, second, main]) },
    acc: {
      head: chance(0.5) ? pick(tagged(HEAD_ACC, 'b').slice(1)).key : 'none',
      headColor: pick([accent, main, second]),
      face: chance(0.2) ? pick(tagged(FACE_ACC, 'b').slice(1)).key : 'none',
      faceColor: chance(0.5) ? accent : null,
      back: chance(0.25) ? pick(tagged(BACK_ACC, 'b').slice(1)).key : 'none',
      backColor: pick([accent, main, second]),
      neck: chance(0.15) ? pick(tagged(NECK_ACC, 'b').slice(1)).key : 'none',
      neckColor: pick(['#FFD54A', accent, main]),
      hand: chance(0.3) ? pick(tagged(HAND_ACC, 'b').slice(1)).key : 'none',
      handColor: chance(0.6) ? accent : null,
    },
  };
  return normalizeLook(look);
}

// ---------- starter outfits ----------

/**
 * Ready-made looks. Wearing one changes clothes, shoes, accessories and the hair style (plus
 * any hair highlight it lists); skin, hair color, eye color and name stay yours. A boy look
 * (`tag: 'b'`) may also set `eyes.lashes` and `face.brows`; girl looks never touch the face.
 * Append only (friends' Dress up bubbles and the probes find them by key).
 */
export const STARTER_OUTFITS = [
  {
    key: 'princess', name: 'Princess', tag: 'g',
    hairStyle: 'wavy_long',
    look: {
      dress: { type: 'ballgown', color: '#FF8CC6', pattern: 'stars', patternColor: '#FFF4E0' },
      shoes: { type: 'sparkle', color: '#FFD1E6' },
      acc: { head: 'tiara', headColor: '#FFD54A', face: 'none', back: 'none', neck: 'pearls', neckColor: '#FFFFFF', hand: 'wand', handColor: '#FFD54A' },
    },
  },
  {
    key: 'sporty', name: 'Sporty', tag: 'g',
    hairStyle: 'ponytail',
    look: {
      top: { type: 'tshirt', color: '#3FD8B0', pattern: 'stripes', patternColor: '#FFFFFF' },
      bottom: { type: 'shorts', color: '#9C7BFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'sneakers', color: '#FF5FA2' },
      acc: { head: 'headband', headColor: '#FF5FA2', face: 'none', back: 'backpack', backColor: '#FFD43B', neck: 'none', hand: 'none' },
    },
  },
  {
    key: 'beach', name: 'Beach Day', tag: 'g',
    hairStyle: 'side_pony',
    look: {
      dress: { type: 'sundress', color: '#FFD43B', pattern: 'flowers', patternColor: '#FFFFFF' },
      shoes: { type: 'sandals', color: '#FF8CC6' },
      acc: { head: 'sun_hat', headColor: '#FF8CC6', face: 'sunglasses', faceColor: '#FF5FA2', back: 'none', neck: 'none', hand: 'ice_cream', handColor: '#FFD1E6' },
    },
  },
  {
    key: 'fairy', name: 'Fairy', tag: 'g',
    hairStyle: 'space_buns',
    look: {
      top: { type: 'sparkle_top', color: '#E6DDFF', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'tutu', color: '#C3A6FF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'ballet', color: '#FFD1E6' },
      acc: { head: 'flower_crown', headColor: '#FF8CC6', face: 'none', back: 'fairy_wings', backColor: '#A5F0E6', neck: 'none', hand: 'wand', handColor: '#FFE58A' },
    },
  },
  {
    key: 'winter', name: 'Cozy Winter', tag: 'g',
    hairStyle: 'braids',
    look: {
      top: { type: 'sweater', color: '#FF6B6B', pattern: 'stars', patternColor: '#FFFFFF' },
      bottom: { type: 'leggings', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'boots', color: '#FFF4E0' },
      acc: { head: 'beanie', headColor: '#FFFFFF', face: 'none', back: 'none', neck: 'scarf', neckColor: '#FF8CC6', hand: 'teddy', handColor: null },
    },
  },
  {
    key: 'rockstar', name: 'Rock Star', tag: 'g',
    hairStyle: 'curly',
    hair: { color2: '#FF5FA2', mix: 'streaks' },
    look: {
      top: { type: 'jacket', color: '#9C7BFF', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'pleated', color: '#FF5FA2', pattern: 'stars', patternColor: '#FFE58A' },
      shoes: { type: 'boots', color: '#3A1F4D' },
      acc: { head: 'none', face: 'star_glasses', faceColor: '#FFD43B', back: 'none', neck: 'necklace', neckColor: '#DDE3EC', hand: 'none' },
    },
  },
  // boys (appended)
  {
    key: 'soccer', name: 'Soccer Star', tag: 'b',
    hairStyle: 'short_curly',
    eyes: { lashes: false }, face: { brows: 'bold' },
    look: {
      top: { type: 'jersey', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF', num: 10 },
      bottom: { type: 'shorts', color: '#FFFFFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'high_tops', color: '#FF6B6B' },
      acc: { head: 'none', face: 'none', back: 'none', neck: 'medal', neckColor: '#FF6B6B', hand: 'soccer_ball', handColor: null },
    },
  },
  {
    key: 'skater', name: 'Skater', tag: 'b',
    hairStyle: 'spiky',
    eyes: { lashes: false },
    look: {
      top: { type: 'tee_bolt', color: '#3A1F4D', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'joggers', color: '#6B7280', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'skate_shoes', color: '#FF6B6B' },
      acc: { head: 'cap_back', headColor: '#FF6B6B', face: 'none', back: 'none', neck: 'none', hand: 'none' },
    },
  },
  {
    key: 'space', name: 'Space Explorer', tag: 'b',
    hairStyle: 'fauxhawk',
    eyes: { lashes: false },
    look: {
      top: { type: 'tee_rocket', color: '#3A1F4D', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'joggers', color: '#7048E8', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'high_tops', color: '#FFFFFF' },
      acc: { head: 'headphones', headColor: '#6CC6FF', face: 'none', back: 'star_pack', backColor: '#6CC6FF', neck: 'none', hand: 'none' },
    },
  },
  {
    key: 'dino', name: 'Dino Explorer', tag: 'b',
    hairStyle: 'buzz',
    eyes: { lashes: false },
    look: {
      top: { type: 'tee_dino', color: '#FFE58A', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'cargo_shorts', color: '#8B5E3C', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'boots', color: '#8B5E3C' },
      acc: { head: 'bucket_hat', headColor: '#6BD68A', face: 'none', back: 'backpack', backColor: '#FFA94D', neck: 'none', hand: 'dino_toy', handColor: null },
    },
  },
  {
    key: 'camp', name: 'Camping Day', tag: 'b',
    hairStyle: 'shaggy',
    eyes: { lashes: false }, face: { brows: 'bold' },
    look: {
      top: { type: 'button_up', color: '#FF6B6B', pattern: 'plaid', patternColor: '#3A1F4D' },
      bottom: { type: 'jeans', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'boots', color: '#8B5E3C' },
      acc: { head: 'beanie', headColor: '#FFA94D', face: 'none', back: 'none', neck: 'none', hand: 'none' },
    },
  },
  {
    key: 'dapper', name: 'Party Time', tag: 'b',
    hairStyle: 'side_part',
    eyes: { lashes: false },
    look: {
      top: { type: 'button_up', color: '#FFFFFF', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'pants', color: '#3A1F4D', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'sneakers', color: '#FFFFFF' },
      acc: { head: 'none', face: 'none', back: 'none', neck: 'bowtie', neckColor: '#FF5FA2', hand: 'balloon', handColor: '#6CC6FF' },
    },
  },
];

/** The look you get when wearing a starter outfit over `look`. */
export function applyOutfit(look, outfit) {
  const base = normalizeLook(look);
  const o = outfit.look || {};
  const next = {
    ...base,
    // A top without its own number keeps yours.
    top: o.top ? { num: base.top.num, ...o.top } : base.top,
    bottom: o.bottom ? { ...o.bottom } : base.bottom,
    dress: o.dress ? { ...o.dress } : null,
    shoes: o.shoes ? { ...o.shoes } : base.shoes,
    acc: { ...DEFAULT_LOOK.acc, head: 'none', ...(o.acc || {}) },
    hair: { ...base.hair, ...(outfit.hair || {}), style: outfit.hairStyle || base.hair.style },
    eyes: outfit.eyes ? { ...base.eyes, ...outfit.eyes } : base.eyes,
    face: outfit.face ? { ...base.face, ...outfit.face } : base.face,
  };
  return normalizeLook(next);
}
