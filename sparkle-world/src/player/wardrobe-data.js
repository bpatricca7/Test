// Wardrobe data: the default look, every option list the Dress-Up Studio offers (stable keys
// saved in profiles + friendly names kids read), curated color palettes, normalizeLook,
// a coordinated randomLook ("Surprise me!") and the ready-made starter outfits.
//
// look = {
//   name, skin,
//   hair:  { style, color, color2: hex | 'rainbow' | null, mix: 'ombre' | 'streaks' | 'tips' },
//   eyes:  { color, lashes }, face: { blush, freckles, smile },
//   top / bottom: { type, color, pattern, patternColor },  dress: null | { type, color, pattern, patternColor },
//   shoes: { type, color },
//   acc: { head, headColor, face, faceColor, back, backColor, neck, neckColor, hand, handColor }
// }   (faceColor / handColor may be null = the item's own default colors)

export const DEFAULT_LOOK = {
  name: 'Lily',
  skin: '#F6D2B8',
  hair: { style: 'long', color: '#7A4A2A', color2: null, mix: 'ombre' },
  eyes: { color: '#5A3A28', lashes: true },
  face: { blush: true, freckles: false, smile: 'happy' },
  top: { type: 'tshirt', color: '#FF8CC6', pattern: 'hearts', patternColor: '#FFFFFF' },
  bottom: { type: 'skirt', color: '#8E7CFF', pattern: 'none', patternColor: '#FFFFFF' },
  dress: null,
  shoes: { type: 'sneakers', color: '#FFFFFF' },
  acc: {
    head: 'bow', headColor: '#FF5FA2', face: 'none', faceColor: null, back: 'none', backColor: '#B8E1FF',
    neck: 'none', neckColor: '#FFD54A', hand: 'none', handColor: null,
  },
};

const opts = (pairs) => pairs.map(([key, name]) => ({ key, name }));

export const HAIR_STYLES = opts([
  ['long', 'Long'], ['ponytail', 'Ponytail'], ['pigtails', 'Pigtails'], ['bun', 'Bun'],
  ['space_buns', 'Space Buns'], ['braids', 'Braids'], ['curly', 'Curly'], ['bob', 'Bob'],
  ['short', 'Short'], ['side_pony', 'Side Pony'], ['wavy_long', 'Wavy'], ['pixie', 'Pixie'],
]);
export const HAIR_MIXES = opts([['ombre', 'Ombre'], ['streaks', 'Streaks'], ['tips', 'Tips']]);
export const TOPS = opts([
  ['tshirt', 'T-Shirt'], ['tank', 'Tank Top'], ['hoodie', 'Hoodie'], ['sweater', 'Sweater'],
  ['blouse', 'Blouse'], ['crop', 'Crop Top'], ['jacket', 'Jacket'], ['sparkle_top', 'Sparkle Top'],
]);
export const BOTTOMS = opts([
  ['skirt', 'Skirt'], ['tutu', 'Tutu'], ['jeans', 'Jeans'], ['leggings', 'Leggings'],
  ['shorts', 'Shorts'], ['overalls', 'Overalls'], ['pleated', 'Pleated Skirt'],
]);
export const DRESSES = opts([
  ['sundress', 'Sundress'], ['party', 'Party Dress'], ['princess', 'Princess Dress'],
  ['ballgown', 'Ball Gown'], ['overall_dress', 'Overall Dress'], ['mermaid', 'Mermaid Dress'],
]);
export const SHOES = opts([
  ['sneakers', 'Sneakers'], ['boots', 'Boots'], ['sandals', 'Sandals'], ['sparkle', 'Sparkle Shoes'],
  ['rainboots', 'Rain Boots'], ['ballet', 'Ballet Flats'], ['roller_skates', 'Roller Skates'],
]);
export const HEAD_ACC = opts([
  ['none', 'None'], ['bow', 'Bow'], ['tiara', 'Tiara'], ['crown', 'Crown'], ['flower_crown', 'Flower Crown'],
  ['cat_ears', 'Cat Ears'], ['bunny_ears', 'Bunny Ears'], ['unicorn_horn', 'Unicorn Horn'], ['beanie', 'Beanie'],
  ['sun_hat', 'Sun Hat'], ['headband', 'Headband'], ['witch_hat', 'Sparkly Hat'], ['halo', 'Halo'],
]);
export const FACE_ACC = opts([
  ['none', 'None'], ['glasses', 'Glasses'], ['sunglasses', 'Sunglasses'], ['heart_glasses', 'Heart Glasses'],
  ['star_glasses', 'Star Glasses'],
]);
export const BACK_ACC = opts([
  ['none', 'None'], ['fairy_wings', 'Fairy Wings'], ['butterfly_wings', 'Butterfly Wings'],
  ['angel_wings', 'Angel Wings'], ['backpack', 'Backpack'], ['cape', 'Cape'],
]);
export const NECK_ACC = opts([
  ['none', 'None'], ['necklace', 'Necklace'], ['pearls', 'Pearls'], ['scarf', 'Scarf'], ['bowtie', 'Bow Tie'],
]);
export const HAND_ACC = opts([
  ['none', 'None'], ['wand', 'Magic Wand'], ['purse', 'Purse'], ['balloon', 'Balloon'], ['teddy', 'Teddy'],
  ['ice_cream', 'Ice Cream'],
]);
export const PATTERNS = opts([
  ['none', 'Plain'], ['hearts', 'Hearts'], ['stars', 'Stars'], ['stripes', 'Stripes'], ['dots', 'Dots'],
  ['rainbow', 'Rainbow'], ['flowers', 'Flowers'],
]);
export const SMILES = opts([['happy', 'Happy'], ['grin', 'Big Smile'], ['cat', 'Cat Smile'], ['open', 'Excited']]);
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
  smile: keySet(SMILES),
};

const col = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : d);
const colOrNull = (v) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : null);
const one = (v, set, d) => (set.has(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

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
    },
    top: garment(l.top, d.top, KEYS.top),
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

/**
 * A random (always cute, color-coordinated) look. rand() -> [0, 1). When `base` is given its
 * name, skin, eyes and face are kept (the Studio's "Surprise me!" keeps who you are and
 * changes what you wear).
 */
export function randomLook(rand = Math.random, name = DEFAULT_LOOK.name, base = null) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
  const chance = (p) => rand() < p;
  const th = pick(THEMES);
  const main = pick(th.main);
  const second = pick(th.second.filter((c) => c !== main)) || pick(th.second);
  const accent = pick(th.accent);
  const light = pick(th.light.filter((c) => c !== main)) || '#FFFFFF';
  const pattern = () => (th.rainbow && chance(0.6) ? 'rainbow' : chance(0.5) ? 'none' : pick(['hearts', 'stars', 'stripes', 'dots', 'flowers']));
  const dressType = chance(0.4) ? pick(DRESSES).key : null;
  const top = pick(TOPS).key;
  const bottom = pick(BOTTOMS).key;
  const natural = chance(0.72);
  const hairColor = base && chance(0.6) ? base.hair.color : natural ? pick(HAIR_COLORS_NATURAL) : pick(HAIR_COLORS_FANTASY);
  const color2 = chance(0.22) ? (th.rainbow || chance(0.25) ? 'rainbow' : pick([accent, second, ...HAIR_COLORS_FANTASY])) : null;
  const metals = ['#FFD54A', '#DDE3EC'];
  const shoesType = dressType === 'ballgown' || dressType === 'princess' ? pick(['sparkle', 'ballet']) : pick(SHOES).key;
  const back = chance(0.3) ? pick(BACK_ACC.slice(1)).key : 'none';
  const look = {
    name: base ? base.name : name,
    skin: base ? base.skin : pick(SKIN_TONES),
    hair: {
      style: pick(HAIR_STYLES).key,
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
      head: chance(0.7) ? pick(HEAD_ACC.slice(1)).key : 'none',
      headColor: pick([accent, accent, ...metals, second]),
      face: chance(0.2) ? pick(FACE_ACC.slice(1)).key : 'none',
      faceColor: chance(0.5) ? accent : null,
      back,
      backColor: pick([second, accent, main === '#FFFFFF' ? accent : main]),
      neck: chance(0.3) ? pick(NECK_ACC.slice(1)).key : 'none',
      neckColor: pick([...metals, accent]),
      hand: chance(0.3) ? pick(HAND_ACC.slice(1)).key : 'none',
      handColor: chance(0.6) ? accent : null,
    },
  };
  return normalizeLook(look);
}

// ---------- starter outfits ----------

/**
 * Ready-made looks. Wearing one changes clothes, shoes, accessories and the hair style (plus
 * any hair highlight it lists); skin, hair color, eyes, face and name stay yours.
 */
export const STARTER_OUTFITS = [
  {
    key: 'princess', name: 'Princess',
    hairStyle: 'wavy_long',
    look: {
      dress: { type: 'ballgown', color: '#FF8CC6', pattern: 'stars', patternColor: '#FFF4E0' },
      shoes: { type: 'sparkle', color: '#FFD1E6' },
      acc: { head: 'tiara', headColor: '#FFD54A', face: 'none', back: 'none', neck: 'pearls', neckColor: '#FFFFFF', hand: 'wand', handColor: '#FFD54A' },
    },
  },
  {
    key: 'sporty', name: 'Sporty',
    hairStyle: 'ponytail',
    look: {
      top: { type: 'tshirt', color: '#3FD8B0', pattern: 'stripes', patternColor: '#FFFFFF' },
      bottom: { type: 'shorts', color: '#9C7BFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'sneakers', color: '#FF5FA2' },
      acc: { head: 'headband', headColor: '#FF5FA2', face: 'none', back: 'backpack', backColor: '#FFD43B', neck: 'none', hand: 'none' },
    },
  },
  {
    key: 'beach', name: 'Beach Day',
    hairStyle: 'side_pony',
    look: {
      dress: { type: 'sundress', color: '#FFD43B', pattern: 'flowers', patternColor: '#FFFFFF' },
      shoes: { type: 'sandals', color: '#FF8CC6' },
      acc: { head: 'sun_hat', headColor: '#FF8CC6', face: 'sunglasses', faceColor: '#FF5FA2', back: 'none', neck: 'none', hand: 'ice_cream', handColor: '#FFD1E6' },
    },
  },
  {
    key: 'fairy', name: 'Fairy',
    hairStyle: 'space_buns',
    look: {
      top: { type: 'sparkle_top', color: '#E6DDFF', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'tutu', color: '#C3A6FF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'ballet', color: '#FFD1E6' },
      acc: { head: 'flower_crown', headColor: '#FF8CC6', face: 'none', back: 'fairy_wings', backColor: '#A5F0E6', neck: 'none', hand: 'wand', handColor: '#FFE58A' },
    },
  },
  {
    key: 'winter', name: 'Cozy Winter',
    hairStyle: 'braids',
    look: {
      top: { type: 'sweater', color: '#FF6B6B', pattern: 'stars', patternColor: '#FFFFFF' },
      bottom: { type: 'leggings', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'boots', color: '#FFF4E0' },
      acc: { head: 'beanie', headColor: '#FFFFFF', face: 'none', back: 'none', neck: 'scarf', neckColor: '#FF8CC6', hand: 'teddy', handColor: null },
    },
  },
  {
    key: 'rockstar', name: 'Rock Star',
    hairStyle: 'curly',
    hair: { color2: '#FF5FA2', mix: 'streaks' },
    look: {
      top: { type: 'jacket', color: '#9C7BFF', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'pleated', color: '#FF5FA2', pattern: 'stars', patternColor: '#FFE58A' },
      shoes: { type: 'boots', color: '#3A1F4D' },
      acc: { head: 'none', face: 'star_glasses', faceColor: '#FFD43B', back: 'none', neck: 'necklace', neckColor: '#DDE3EC', hand: 'none' },
    },
  },
];

/** The look you get when wearing a starter outfit over `look`. */
export function applyOutfit(look, outfit) {
  const base = normalizeLook(look);
  const o = outfit.look || {};
  const next = {
    ...base,
    top: o.top ? { ...o.top } : base.top,
    bottom: o.bottom ? { ...o.bottom } : base.bottom,
    dress: o.dress ? { ...o.dress } : null,
    shoes: o.shoes ? { ...o.shoes } : base.shoes,
    acc: { ...DEFAULT_LOOK.acc, head: 'none', ...(o.acc || {}) },
    hair: { ...base.hair, ...(outfit.hair || {}), style: outfit.hairStyle || base.hair.style },
  };
  return normalizeLook(next);
}
