// The friends she can invite: ten stylish girls, each with her own look (built with the
// avatar's look schema), a style, a name-tag color, a voice pitch and a few lines of her own.
// Also the outfits she can put on a friend from the "Dress her up" bubble.

import { normalizeLook, STARTER_OUTFITS, applyOutfit, randomLook, HAIR_STYLES } from '../../player/wardrobe-data.js';

const acc = (o) => ({ head: 'none', headColor: '#FF5FA2', face: 'none', faceColor: null, back: 'none', backColor: '#B8E1FF', neck: 'none', neckColor: '#FFD54A', hand: 'none', handColor: null, ...o });

export const FRIENDS = [
  {
    key: 'mia', name: 'Mia', style: 'Rock Star', color: '#9C7BFF', pitch: 0.96, icon: 'guitar',
    look: {
      skin: '#8C5535', hair: { style: 'curly', color: '#1F1614', color2: '#FF5FA2', mix: 'streaks' },
      eyes: { color: '#2E1E14', lashes: true }, face: { blush: true, freckles: false, smile: 'grin' },
      top: { type: 'jacket', color: '#9C7BFF', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'pleated', color: '#FF5FA2', pattern: 'stars', patternColor: '#FFE58A' },
      shoes: { type: 'boots', color: '#3A1F4D' },
      acc: acc({ face: 'star_glasses', faceColor: '#FFD43B', neck: 'necklace', neckColor: '#DDE3EC' }),
    },
    lines: ['Let\'s start a band! You can sing!', 'Rock on, bestie!', 'I wrote a song about sparkles!', 'Wanna jam with me? La la laaa!'],
  },
  {
    key: 'zoe', name: 'Zoe', style: 'Sporty', color: '#3FD8B0', pitch: 1.08, icon: 'ball',
    look: {
      skin: '#FFE6D8', hair: { style: 'ponytail', color: '#D9762F', color2: null, mix: 'ombre' },
      eyes: { color: '#3C9A64', lashes: true }, face: { blush: true, freckles: true, smile: 'open' },
      top: { type: 'tshirt', color: '#3FD8B0', pattern: 'stripes', patternColor: '#FFFFFF' },
      bottom: { type: 'shorts', color: '#9C7BFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'sneakers', color: '#FF5FA2' },
      acc: acc({ head: 'headband', headColor: '#FF5FA2', back: 'backpack', backColor: '#FFD43B' }),
    },
    lines: ['Race you to that tree! Ready, set, go!', 'I can do ten cartwheels in a row!', 'Soccer is my favorite! What\'s yours?', 'Let\'s do jumping jacks! One, two!'],
  },
  {
    key: 'ava', name: 'Ava', style: 'Fairy', color: '#FF8CC6', pitch: 1.16, icon: 'wand',
    look: {
      skin: '#E4AE86', hair: { style: 'space_buns', color: '#C9A2FF', color2: '#7FD3FF', mix: 'tips' },
      eyes: { color: '#8B6BD6', lashes: true }, face: { blush: true, freckles: false, smile: 'happy' },
      top: { type: 'sparkle_top', color: '#E6DDFF', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'tutu', color: '#C3A6FF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'ballet', color: '#FFD1E6' },
      acc: acc({ head: 'flower_crown', headColor: '#FF8CC6', back: 'fairy_wings', backColor: '#A5F0E6', hand: 'wand', handColor: '#FFE58A' }),
    },
    lines: ['Sprinkle, sprinkle, fairy dust!', 'I think the flowers are whispering!', 'Make a wish! I\'ll keep it secret!', 'Fairies love sparkly things. Just like you!'],
  },
  {
    key: 'lilyrose', name: 'Lily-Rose', style: 'Princess', color: '#FF5FA2', pitch: 1.1, icon: 'crown',
    look: {
      skin: '#F6D2B8', hair: { style: 'wavy_long', color: '#EACB86', color2: null, mix: 'ombre' },
      eyes: { color: '#3F7AC9', lashes: true }, face: { blush: true, freckles: false, smile: 'happy' },
      dress: { type: 'ballgown', color: '#FF8CC6', pattern: 'stars', patternColor: '#FFF4E0' },
      shoes: { type: 'sparkle', color: '#FFD1E6' },
      acc: acc({ head: 'tiara', headColor: '#FFD54A', neck: 'pearls', neckColor: '#FFFFFF', hand: 'wand', handColor: '#FFD54A' }),
    },
    lines: ['Every girl is a princess!', 'Let\'s have a royal tea party!', 'You can borrow my tiara any time!', 'This world is our kingdom!'],
  },
  {
    key: 'maya', name: 'Maya', style: 'Skater', color: '#6CC6FF', pitch: 1.0, icon: 'skate',
    look: {
      skin: '#A96C45', hair: { style: 'bob', color: '#3B2419', color2: '#6CC6FF', mix: 'tips' },
      eyes: { color: '#5A3A28', lashes: true }, face: { blush: true, freckles: false, smile: 'cat' },
      top: { type: 'hoodie', color: '#6CC6FF', pattern: 'stars', patternColor: '#FFFFFF' },
      bottom: { type: 'jeans', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'roller_skates', color: '#FF5FA2' },
      acc: acc({ head: 'beanie', headColor: '#FFD43B', face: 'sunglasses', faceColor: '#9C7BFF' }),
    },
    lines: ['Roller skating is the best! Wheee!', 'I can skate backwards! Watch!', 'Let\'s build a skate park!', 'Cool! That was so cool!'],
  },
  {
    key: 'chloe', name: 'Chloe', style: 'Artist', color: '#FFC94D', pitch: 1.04, icon: 'palette',
    look: {
      skin: '#D69B6E', hair: { style: 'bun', color: '#A0592D', color2: '#FF8CC6', mix: 'tips' },
      eyes: { color: '#8A6A2E', lashes: true }, face: { blush: true, freckles: true, smile: 'happy' },
      top: { type: 'tshirt', color: '#FFFFFF', pattern: 'rainbow', patternColor: '#FFFFFF' },
      bottom: { type: 'overalls', color: '#FFD43B', pattern: 'dots', patternColor: '#FF8CC6' },
      shoes: { type: 'sneakers', color: '#6CC6FF' },
      acc: acc({ head: 'bow', headColor: '#FF6B6B', face: 'glasses', faceColor: '#FF5FA2' }),
    },
    lines: ['Let\'s paint a rainbow together!', 'I want to paint a picture of you!', 'Purple and pink make magic colors!', 'Your house is like a painting!'],
  },
  {
    key: 'nia', name: 'Nia', style: 'Dancer', color: '#E64980', pitch: 1.12, icon: 'music',
    look: {
      skin: '#6D4029', hair: { style: 'pigtails', color: '#1F1614', color2: '#FF8CC6', mix: 'tips' },
      eyes: { color: '#2E1E14', lashes: true }, face: { blush: true, freckles: false, smile: 'open' },
      top: { type: 'crop', color: '#FF8CC6', pattern: 'hearts', patternColor: '#FFFFFF' },
      bottom: { type: 'tutu', color: '#FF5FA2', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'ballet', color: '#FFFFFF' },
      acc: acc({ head: 'bow', headColor: '#FFFFFF', face: 'heart_glasses', faceColor: '#FF5FA2', neck: 'necklace', neckColor: '#FFD54A' }),
    },
    lines: ['Watch my twirl! Ta-da!', 'Dancing makes my heart happy!', 'Let\'s make up a dance together!', 'Point your toes like a ballerina!'],
  },
  {
    key: 'emma', name: 'Emma', style: 'Beach Day', color: '#FFA94D', pitch: 1.06, icon: 'sun',
    look: {
      skin: '#F0C3A0', hair: { style: 'side_pony', color: '#F7E7B7', color2: null, mix: 'ombre' },
      eyes: { color: '#2FB5B0', lashes: true }, face: { blush: true, freckles: true, smile: 'grin' },
      dress: { type: 'sundress', color: '#FFD43B', pattern: 'flowers', patternColor: '#FFFFFF' },
      shoes: { type: 'sandals', color: '#FF8CC6' },
      acc: acc({ head: 'sun_hat', headColor: '#FF8CC6', face: 'sunglasses', faceColor: '#FF5FA2', hand: 'ice_cream', handColor: '#FFD1E6' }),
    },
    lines: ['Beach day every day!', 'I found a pretty shell! It\'s pink!', 'Let\'s build a sandcastle!', 'Sunshine makes everything sparkle!'],
  },
  {
    key: 'sofia', name: 'Sofia', style: 'Snow Queen', color: '#4D7CFF', pitch: 1.0, icon: 'snow',
    look: {
      skin: '#C3845A', hair: { style: 'braids', color: '#E9EEF6', color2: '#B8E1FF', mix: 'ombre' },
      eyes: { color: '#3F7AC9', lashes: true }, face: { blush: true, freckles: false, smile: 'happy' },
      top: { type: 'sweater', color: '#B8E1FF', pattern: 'stars', patternColor: '#FFFFFF' },
      bottom: { type: 'leggings', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'boots', color: '#FFFFFF' },
      acc: acc({ head: 'crown', headColor: '#DDE3EC', neck: 'scarf', neckColor: '#FF8CC6', back: 'cape', backColor: '#E6DDFF' }),
    },
    lines: ['Snow days are the best days!', 'Let\'s build a snowman together!', 'Hot cocoa with marshmallows? Yes please!', 'Every snowflake is different. Like us!'],
  },
  {
    key: 'aria', name: 'Aria', style: 'Mermaid', color: '#2FB5B0', pitch: 1.14, icon: 'shell',
    look: {
      skin: '#51301E', hair: { style: 'long', color: '#5FE3C0', color2: '#9C7BFF', mix: 'ombre' },
      eyes: { color: '#2FB5B0', lashes: true }, face: { blush: true, freckles: false, smile: 'happy' },
      dress: { type: 'mermaid', color: '#3FD8B0', pattern: 'dots', patternColor: '#A5F0E6' },
      shoes: { type: 'sandals', color: '#A5F0E6' },
      acc: acc({ head: 'flower_crown', headColor: '#FF8CC6', neck: 'pearls', neckColor: '#FFFFFF', hand: 'balloon', handColor: '#6CC6FF' }),
    },
    lines: ['I can swim like a fish!', 'Mermaids love bubbles! Blub blub!', 'Let\'s find treasure under the sea!', 'The water is so sparkly today!'],
  },
];

for (const f of FRIENDS) f.look = normalizeLook({ ...f.look, name: f.name });

export const FRIEND_KEYS = FRIENDS.map((f) => f.key);
export function friendDef(key) {
  return FRIENDS.find((f) => f.key === key) || null;
}

// ---------- outfits for "Dress her up" ----------

const extra = [
  {
    key: 'party', name: 'Party', icon: 'star',
    look: {
      dress: { type: 'party', color: '#C3A6FF', pattern: 'stars', patternColor: '#FFE58A' },
      shoes: { type: 'sparkle', color: '#FFD1E6' },
      acc: acc({ head: 'bow', headColor: '#FF5FA2', neck: 'necklace', neckColor: '#FFD54A', hand: 'balloon', handColor: '#FF8CC6' }),
    },
  },
  {
    key: 'mermaid', name: 'Mermaid', icon: 'shell',
    look: {
      dress: { type: 'mermaid', color: '#6CC6FF', pattern: 'dots', patternColor: '#A5F0E6' },
      shoes: { type: 'sandals', color: '#A5F0E6' },
      acc: acc({ head: 'flower_crown', headColor: '#FF8CC6', neck: 'pearls', neckColor: '#FFFFFF' }),
    },
  },
];

const ICONS = { princess: 'crown', sporty: 'ball', beach: 'sun', fairy: 'wand', winter: 'snow', rockstar: 'guitar' };

/** Outfit buttons: the Studio's starter outfits plus a couple more. */
export const OUTFITS = [
  ...STARTER_OUTFITS.map((o) => ({ key: o.key, name: o.name, icon: ICONS[o.key] || 'dress', outfit: o })),
  ...extra.map((o) => ({ key: o.key, name: o.name, icon: o.icon, outfit: { key: o.key, name: o.name, look: o.look } })),
];

/** Her look wearing an outfit (keeps her own hair style, color, skin and face). */
export function wearOutfit(look, key) {
  const o = OUTFITS.find((x) => x.key === key);
  if (!o) return normalizeLook(look);
  const out = applyOutfit(look, { ...o.outfit, hairStyle: null, hair: null });
  out.hair = { ...look.hair };
  return normalizeLook(out);
}

/** The next hair style in the list. */
export function nextHair(look) {
  const i = HAIR_STYLES.findIndex((h) => h.key === look.hair.style);
  const next = HAIR_STYLES[(i + 1) % HAIR_STYLES.length];
  return normalizeLook({ ...look, hair: { ...look.hair, style: next.key } });
}

/** A coordinated surprise outfit (keeps her name, skin, eyes and face). */
export function surpriseLook(look) {
  return normalizeLook(randomLook(Math.random, look.name, look));
}

/** Twins! Her outfit copied from the player's look (her own hair, skin and face stay). */
export function twinLook(look, playerLook) {
  const p = normalizeLook(playerLook);
  return normalizeLook({
    ...look,
    top: { ...p.top }, bottom: { ...p.bottom }, dress: p.dress ? { ...p.dress } : null,
    shoes: { ...p.shoes }, acc: { ...p.acc },
  });
}
