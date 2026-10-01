// The friends you can invite: ten stylish girls and six cool boys, each with their own look
// (built with the avatar's look schema), a style, a name-tag color, a voice pitch, a pronoun
// and a few lines of their own. Also the outfits you can put on a friend from the "Dress up"
// bubble. FRIENDS is append only (old saves and the Bag picture find friends by key and
// index); the invite panel shows them in ROSTER_ORDER.

import { normalizeLook, STARTER_OUTFITS, applyOutfit, randomLook, HAIR_STYLES, tagged } from '../../player/wardrobe-data.js';

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
  // ----- boys (appended; pronoun 'he', kind 'boy') -----
  {
    key: 'leo', name: 'Leo', style: 'Soccer Star', color: '#4D7CFF', pitch: 0.94, icon: 'ball', pronoun: 'he', kind: 'boy',
    look: {
      skin: '#C3845A', hair: { style: 'short_curly', color: '#1F1614', color2: null, mix: 'ombre' },
      eyes: { color: '#2E1E14', lashes: false }, face: { blush: false, freckles: false, smile: 'grin', brows: 'bold' },
      top: { type: 'jersey', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF', num: 10 },
      bottom: { type: 'shorts', color: '#FFFFFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'high_tops', color: '#FF6B6B' },
      acc: acc({ neck: 'medal', neckColor: '#FF6B6B', hand: 'soccer_ball' }),
    },
    lines: ['Goal! Did you see that?', 'Let\'s kick the ball around!', 'Teamwork makes the dream work!', 'High five, teammate!'],
  },
  {
    key: 'max', name: 'Max', style: 'Skater', color: '#FF6B6B', pitch: 0.92, icon: 'skate', pronoun: 'he', kind: 'boy',
    look: {
      skin: '#F6D2B8', hair: { style: 'spiky', color: '#D9762F', color2: null, mix: 'ombre' },
      eyes: { color: '#3F7AC9', lashes: false }, face: { blush: true, freckles: true, smile: 'cat' },
      top: { type: 'tee_bolt', color: '#3A1F4D', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'joggers', color: '#6B7280', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'skate_shoes', color: '#FF6B6B' },
      acc: acc({ head: 'cap_back', headColor: '#FF6B6B' }),
    },
    lines: ['Watch me skate! Whoosh!', 'Let\'s build a skate ramp!', 'Skating is the best!', 'That was so cool!'],
  },
  {
    key: 'kai', name: 'Kai', style: 'Space Explorer', color: '#7048E8', pitch: 0.98, icon: 'rocket', pronoun: 'he', kind: 'boy',
    look: {
      skin: '#8C5535', hair: { style: 'fauxhawk', color: '#1F1614', color2: '#7FD3FF', mix: 'tips' },
      eyes: { color: '#5A3A28', lashes: false }, face: { blush: true, freckles: false, smile: 'open' },
      top: { type: 'tee_rocket', color: '#3A1F4D', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'joggers', color: '#7048E8', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'high_tops', color: '#FFFFFF' },
      acc: acc({ head: 'headphones', headColor: '#6CC6FF', back: 'star_pack', backColor: '#6CC6FF' }),
    },
    lines: ['3, 2, 1, blast off!', 'I want to visit every planet!', 'Look! That star is winking at us!', 'Let\'s build a rocket ship!'],
  },
  {
    key: 'sam', name: 'Sam', style: 'Dino Explorer', color: '#6BD68A', pitch: 0.9, icon: 'dino', pronoun: 'he', kind: 'boy',
    look: {
      skin: '#FFE6D8', hair: { style: 'buzz', color: '#C99A5B', color2: null, mix: 'ombre' },
      eyes: { color: '#3C9A64', lashes: false }, face: { blush: true, freckles: true, smile: 'grin' },
      top: { type: 'tee_dino', color: '#FFE58A', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'cargo_shorts', color: '#8B5E3C', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'boots', color: '#8B5E3C' },
      acc: acc({ head: 'bucket_hat', headColor: '#6BD68A', back: 'backpack', backColor: '#FFA94D', hand: 'dino_toy' }),
    },
    lines: ['Rawr! I\'m a friendly dinosaur!', 'Let\'s dig for dinosaur bones!', 'Did you know some dinos had feathers?', 'Stomp, stomp! Dino dance!'],
  },
  {
    key: 'ezra', name: 'Ezra', style: 'Builder', color: '#FFA94D', pitch: 0.95, icon: 'build', pronoun: 'he', kind: 'boy',
    look: {
      skin: '#6D4029', hair: { style: 'afro', color: '#1F1614', color2: null, mix: 'ombre' },
      eyes: { color: '#2E1E14', lashes: false }, face: { blush: false, freckles: false, smile: 'happy', brows: 'bold' },
      top: { type: 'button_up', color: '#FF6B6B', pattern: 'plaid', patternColor: '#3A1F4D' },
      bottom: { type: 'jeans', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'boots', color: '#FFA94D' },
      acc: acc({ hand: 'toy_car', handColor: '#FFD43B' }),
    },
    lines: ['Let\'s build the tallest tower ever!', 'I can build a road for my car! Vroom!', 'Every house needs a cozy bed!', 'Measure twice, build once!'],
  },
  {
    key: 'theo', name: 'Theo', style: 'Magician', color: '#B36BFF', pitch: 1.0, icon: 'wand', pronoun: 'he', kind: 'boy',
    look: {
      skin: '#A96C45', hair: { style: 'side_part', color: '#3B2419', color2: null, mix: 'ombre' },
      eyes: { color: '#8A6A2E', lashes: false }, face: { blush: true, freckles: false, smile: 'grin' },
      top: { type: 'button_up', color: '#FFFFFF', pattern: 'none', patternColor: '#FFFFFF' },
      bottom: { type: 'pants', color: '#3A1F4D', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'boots', color: '#222230' },
      acc: acc({ head: 'witch_hat', headColor: '#7048E8', neck: 'bowtie', neckColor: '#FF5FA2', back: 'cape', backColor: '#7048E8', hand: 'wand', handColor: '#FFE58A' }),
    },
    lines: ['Abracadabra! Ta-da!', 'Pick a card, any card!', 'I can make sparkles appear! Look!', 'The best magic is being kind!'],
  },
];

for (const f of FRIENDS) {
  f.look = normalizeLook({ ...f.look, name: f.name });
  if (f.pronoun !== 'he') f.pronoun = 'she';
  if (f.kind !== 'boy') f.kind = 'girl';
}

export const FRIEND_KEYS = FRIENDS.map((f) => f.key);
export function friendDef(key) {
  return FRIENDS.find((f) => f.key === key) || null;
}

/** The invite panel's order: girls and boys take turns (FRIENDS itself only ever grows). */
export const ROSTER_ORDER = [
  'mia', 'leo', 'zoe', 'kai', 'ava', 'max', 'lilyrose', 'theo', 'maya', 'sam', 'chloe', 'ezra', 'nia', 'emma', 'sofia', 'aria',
];
/** FRIENDS in ROSTER_ORDER (any friend missing from the order goes at the end). */
export function rosterFriends() {
  const known = ROSTER_ORDER.map(friendDef).filter(Boolean);
  return [...known, ...FRIENDS.filter((f) => !ROSTER_ORDER.includes(f.key))];
}

/** The Bag's "Invite a Friend" picture: always Lily-Rose's head (pinned by key, not index). */
export const BAG_FRIEND = 'lilyrose';

/** Words for a friend: pronouns(def).they / them / their / They. */
export function pronouns(def) {
  return def && def.pronoun === 'he'
    ? { they: 'he', them: 'him', their: 'his', They: 'He' }
    : { they: 'she', them: 'her', their: 'her', They: 'She' };
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

const ICONS = {
  princess: 'crown', sporty: 'ball', beach: 'sun', fairy: 'wand', winter: 'snow', rockstar: 'guitar',
  soccer: 'ball', skater: 'skate', space: 'rocket', dino: 'dino', camp: 'snow', dapper: 'star',
};

/** Outfit buttons: the Studio's starter outfits plus a couple more; `tag` 'g' or 'b'. */
export const OUTFITS = [
  ...STARTER_OUTFITS.map((o) => ({ key: o.key, name: o.name, icon: ICONS[o.key] || 'dress', tag: o.tag || 'g', outfit: o })),
  ...extra.map((o) => ({ key: o.key, name: o.name, icon: o.icon, tag: 'g', outfit: { key: o.key, name: o.name, look: o.look } })),
];

/** The outfit buttons for a friend: boys get the boy looks, girls the girl looks. */
export function outfitsFor(def) {
  const letter = def && def.kind === 'boy' ? 'b' : 'g';
  return OUTFITS.filter((o) => o.tag.includes(letter));
}

/** A friend's look wearing an outfit (keeps their own hair style, color, skin and face). */
export function wearOutfit(look, key) {
  const o = OUTFITS.find((x) => x.key === key);
  if (!o) return normalizeLook(look);
  const out = applyOutfit(look, { ...o.outfit, hairStyle: null, hair: null, eyes: null, face: null });
  out.hair = { ...look.hair };
  return normalizeLook(out);
}

/** The next hair style in the list (only the styles of the friend's kind: 'girl' | 'boy'). */
export function nextHair(look, kind = 'girl') {
  const list = tagged(HAIR_STYLES, kind === 'boy' ? 'b' : 'g');
  const i = list.findIndex((h) => h.key === look.hair.style);
  const next = list[(i + 1) % list.length];
  return normalizeLook({ ...look, hair: { ...look.hair, style: next.key } });
}

/** A coordinated surprise outfit in the friend's style (keeps their name, skin, eyes and face). */
export function surpriseLook(look, kind = 'girl') {
  return normalizeLook(randomLook(Math.random, look.name, look, kind === 'boy' ? 'boy' : 'girl'));
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
