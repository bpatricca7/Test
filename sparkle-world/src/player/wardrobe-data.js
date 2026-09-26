// Wardrobe data: the default look and every option list the Dress-Up Studio offers.
// Keys are stable (saved in profiles); names are what kids read.

export const DEFAULT_LOOK = {
  name: 'Lily',
  skin: '#F6D2B8',
  hair: { style: 'long', color: '#7A4A2A', color2: null },
  eyes: { color: '#5A3A28', lashes: true },
  face: { blush: true, freckles: false, smile: 'happy' },
  top: { type: 'tshirt', color: '#FF8CC6', pattern: 'hearts', patternColor: '#FFFFFF' },
  bottom: { type: 'skirt', color: '#8E7CFF', pattern: 'none', patternColor: '#FFFFFF' },
  dress: null,
  shoes: { type: 'sneakers', color: '#FFFFFF' },
  acc: {
    head: 'bow', headColor: '#FF5FA2', face: 'none', back: 'none', backColor: '#B8E1FF',
    neck: 'none', neckColor: '#FFD700', hand: 'none',
  },
};

const opts = (pairs) => pairs.map(([key, name]) => ({ key, name }));

export const HAIR_STYLES = opts([
  ['long', 'Long'], ['ponytail', 'Ponytail'], ['pigtails', 'Pigtails'], ['bun', 'Bun'],
  ['space_buns', 'Space Buns'], ['braids', 'Braids'], ['curly', 'Curly'], ['bob', 'Bob'],
  ['short', 'Short'], ['side_pony', 'Side Pony'], ['wavy_long', 'Wavy'], ['pixie', 'Pixie'],
]);
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

export const SKIN_TONES = ['#FFE3D3', '#F6D2B8', '#EDBB99', '#D9A37E', '#C68A64', '#A86F4C', '#8A5638', '#6B4029'];
export const HAIR_COLORS = [
  '#2B1B14', '#4A2E1F', '#7A4A2A', '#B5773F', '#E8C07A', '#F6E2A8', '#E86A3A',
  '#FF8CC6', '#B28CFF', '#6CC6FF', '#3FD8B0', '#FFFFFF',
];
export const EYE_COLORS = ['#5A3A28', '#2E1E14', '#3F7AC9', '#3C9A64', '#8B6BD6', '#6F7C85'];
export const CLOTH_COLORS = [
  '#FF5FA2', '#FF8CC6', '#FFD1E6', '#FF6B6B', '#FFA94D', '#FFD43B', '#A9E34B', '#3FD8B0',
  '#6CC6FF', '#4D7CFF', '#9C7BFF', '#E6DDFF', '#FFFFFF', '#3A1F4D', '#8B5E3C', '#222222',
];

/** Fill any missing fields of a (possibly old) look with defaults. */
export function normalizeLook(look) {
  const d = DEFAULT_LOOK;
  const l = look || {};
  return {
    name: typeof l.name === 'string' && l.name ? l.name : d.name,
    skin: l.skin || d.skin,
    hair: { ...d.hair, ...(l.hair || {}) },
    eyes: { ...d.eyes, ...(l.eyes || {}) },
    face: { ...d.face, ...(l.face || {}) },
    top: { ...d.top, ...(l.top || {}) },
    bottom: { ...d.bottom, ...(l.bottom || {}) },
    dress: l.dress ? { pattern: 'none', patternColor: '#FFFFFF', ...l.dress } : null,
    shoes: { ...d.shoes, ...(l.shoes || {}) },
    acc: { ...d.acc, ...(l.acc || {}) },
  };
}

/** A random (always cute) look, for "Surprise me!". rand() -> [0, 1). */
export function randomLook(rand = Math.random, name = DEFAULT_LOOK.name) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const wearDress = rand() < 0.35;
  return normalizeLook({
    name,
    skin: pick(SKIN_TONES),
    hair: { style: pick(HAIR_STYLES).key, color: pick(HAIR_COLORS), color2: null },
    eyes: { color: pick(EYE_COLORS), lashes: rand() < 0.7 },
    face: { blush: rand() < 0.8, freckles: rand() < 0.25, smile: pick(SMILES).key },
    top: { type: pick(TOPS).key, color: pick(CLOTH_COLORS), pattern: pick(PATTERNS).key, patternColor: '#FFFFFF' },
    bottom: { type: pick(BOTTOMS).key, color: pick(CLOTH_COLORS), pattern: 'none', patternColor: '#FFFFFF' },
    dress: wearDress ? { type: pick(DRESSES).key, color: pick(CLOTH_COLORS), pattern: pick(PATTERNS).key, patternColor: '#FFFFFF' } : null,
    shoes: { type: pick(SHOES).key, color: pick(CLOTH_COLORS) },
    acc: {
      head: pick(HEAD_ACC).key, headColor: pick(CLOTH_COLORS), face: rand() < 0.3 ? pick(FACE_ACC).key : 'none',
      back: rand() < 0.3 ? pick(BACK_ACC).key : 'none', backColor: pick(CLOTH_COLORS),
      neck: rand() < 0.3 ? pick(NECK_ACC).key : 'none', neckColor: '#FFD700', hand: 'none',
    },
  });
}
