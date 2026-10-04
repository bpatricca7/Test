// The sea animals' tables (docs/teams/ocean.md §3, §4.3, §7): kinds, names, numbers, palettes,
// the dolphins' names and every string kids read. Pure data, no THREE (Node tests import it).
//
// APPEND ONLY: SEA_KINDS and every PALETTES[kind] list. The dolphin palette is sent by index in
// presence `sr` and `sk` (like the look lists), and stats.seaMet is keyed by SEA_KINDS. Never
// remove, rename or reorder an entry; tools/test-sea.mjs S7 pins them.

export const SEA_KINDS = [
  'dolphin',
  'fish',
  'sea_turtle',
  'octopus',
  'jelly',
  'seahorse',
  'crab',
  'starfish',
  'whale',
];

/** Ocean Star = the first 9 SEA_KINDS, forever (kinds appended later never move the goal). */
export const OCEAN_STAR_KINDS = 9;

export const SEA_NAMES = {
  dolphin: 'Dolphin',
  fish: 'Little Fish',
  sea_turtle: 'Sea Turtle',
  octopus: 'Octopus',
  jelly: 'Jellyfish',
  seahorse: 'Seahorse',
  crab: 'Crab',
  starfish: 'Starfish',
  whale: 'Whale',
};

/**
 * Numbers from §3.3 and §5. cap: instances in the mesh; max: wild ones at once (low: on
 * quality 'low'); depth: the water rule; near: the spawn ring [min, max] and min: the fallback's
 * minimum distance; leave: despawn distance; speed: cruise speed; mode: the shader bend;
 * sound: the tap sound; day / night: spawn chance multipliers.
 */
export const SEA_SPEC = {
  dolphin: { cap: 12, wild: 6, show: 3, friends: 3, max: 6, low: 6, depth: 3, near: [30, 40], min: 6, leave: 45, speed: 4.2, sprint: 11, mode: 'kick', sound: 'chirp', day: 1, night: 0.5 },
  fish: { cap: 30, max: 3, low: 2, perSchool: [6, 10], perSchoolLow: [3, 5], depth: 2, near: [8, 22], min: 4, leave: 30, speed: 1.6, mode: 'wiggle', sound: 'bloop', day: 1, night: 0.5 },
  sea_turtle: { cap: 3, max: 3, low: 3, depth: 2, near: [14, 26], min: 6, leave: 34, speed: 1.4, mode: 'flap', sound: 'bloop', daylight: 0.3, every: [40, 70] },
  octopus: { cap: 2, max: 2, low: 2, bed: [2, 6], near: [10, 24], min: 4, leave: 30, speed: 0, mode: 'curl', sound: 'pop' },
  jelly: { cap: 8, max: 2, maxNight: 8, low: 1, lowNight: 4, depth: 3, near: [10, 26], min: 4, leave: 32, speed: 0.3, mode: 'pulse', sound: 'boop' },
  seahorse: { cap: 6, max: 6, low: 6, bed: [2, 5], near: [6, 18], min: 3, leave: 24, speed: 0, mode: 'flutter', sound: 'ding', daylight: 0.3 },
  crab: { cap: 6, max: 6, low: 6, near: [6, 20], min: 3, leave: 26, speed: 1.2, mode: 'snip', sound: 'clack', daylight: 0.2 },
  starfish: { cap: 12, max: 12, low: 12, bed: [1, 3], near: [4, 20], min: 2, leave: 26, speed: 0, mode: 'curl', sound: 'giggle' },
  whale: { cap: 1, max: 1, low: 1, speed: 1.2, mode: 'kick', sound: 'whale' },
};

/** [key, body, accent] per kind; index 0 is the default (§3.2). APPEND ONLY. */
export const PALETTES = {
  dolphin: [
    ['sky', '#7F98D4', '#F7FBFF'], // (was #8EB8E0: too close to the water's own blue)
    ['lilac', '#B9A8F0', '#F6F2FF'],
    ['rose', '#F7A8C8', '#FFF4F8'],
    ['mint', '#9EE3CF', '#F4FFFB'],
    ['silver', '#C9D3E0', '#FFFFFF'],
    ['bubblegum', '#FF9CCB', '#FFF0F7'],
    ['cotton', '#C8B4FF', '#FFF7FF'],
    ['snowy', '#F2F6FA', '#FFFFFF'],
    ['deep', '#3F7FBF', '#EAF4FF'],
    ['teal', '#2FA3A0', '#E8FFFB'],
  ],
  fish: [
    ['coral', '#FF8FB1', '#FFE3EC'],
    ['sunny', '#FFD166', '#FFF6D6'],
    ['sky', '#8FD3FF', '#E6F6FF'],
    ['grape', '#B49CFF', '#EEE6FF'],
    ['mint', '#7FE0C2', '#E3FFF5'],
    ['peach', '#FFA36C', '#FFE08A'],
    ['pearl', '#F5F5FF', '#D9D6FF'],
    ['koi', '#FF9F43', '#FFE08A'],
    ['fairy', '#E9B8FF', '#FFF2FF'],
    ['candy', '#FF7AB8', '#FFF27A'],
  ],
  sea_turtle: [
    ['ocean', '#3FB8C8', '#BFF0F5'],
    ['leafy', '#5FB86A', '#D6F5C8'],
    ['coral', '#FF9CC8', '#FFE0EE'],
    ['lilac', '#9C86E8', '#E6DEFF'],
    ['midnight', '#34508C', '#A9C2F0'],
  ],
  octopus: [
    ['coral', '#FF8FA3', '#FFE0E6'],
    ['lilac', '#C3A6FF', '#F0E8FF'],
    ['peach', '#FFB38A', '#FFE6D6'],
    ['mint', '#8FE3C8', '#E3FFF5'],
    ['sunny', '#FFD866', '#FFF6D0'],
  ],
  jelly: [
    ['pink', '#FFB8D6', '#FFE6F1'],
    ['lilac', '#D9C8FF', '#F4EEFF'],
    ['aqua', '#A6F0FF', '#E6FCFF'],
    ['peach', '#FFD1B0', '#FFF0E3'],
    ['gummy', '#FF8CC6', '#FFD6EC'],
  ],
  seahorse: [
    ['sunny', '#FFD866', '#FFF6D0'],
    ['pink', '#FF9CC8', '#FFE6F1'],
    ['orange', '#FFA36C', '#FFE6D6'],
    ['lilac', '#C3A6FF', '#F0E8FF'],
  ],
  crab: [
    ['red', '#FF7A6B', '#FFD6CF'],
    ['pink', '#FF9CC8', '#FFE6F1'],
    ['candy', '#FFB3D9', '#FFF0F7'],
  ],
  starfish: [
    ['orange', '#FF9F5A', '#FFE6D0'],
    ['coral', '#FF8F7A', '#FFE3DC'],
    ['lilac', '#C9B2FF', '#F2ECFF'],
    ['yellow', '#FFD43B', '#FFF6C8'],
  ],
  whale: [
    ['blue', '#7FA7D6', '#F2F6FA'],
    ['grey', '#A9B6C8', '#F2F6FA'],
    ['white', '#F2F6FA', '#FFFFFF'],
    ['berry', '#E8A3D0', '#FFF0F7'],
  ],
};

/** Palettes only drawn in one biome (by key); everything else is the normal draw. */
const BIOME_ONLY = {
  candy: { dolphin: ['bubblegum', 'cotton'], fish: ['candy'], jelly: ['gummy'], crab: ['candy'], whale: ['berry'] },
  snow: { dolphin: ['snowy'], whale: ['white'] },
  fairy: {},
};
const SPECIAL = new Set(['bubblegum', 'cotton', 'snowy', 'candy', 'gummy', 'berry', 'white', 'koi', 'fairy']);

/** Palette indices a kind may draw in a biome (§3.2 "Biome choice"). Never empty. */
export function paletteChoices(kind, biome) {
  const list = PALETTES[kind];
  const only = BIOME_ONLY[biome] && BIOME_ONLY[biome][kind];
  if (biome === 'candy' && only && only.length) return only.map((k) => list.findIndex((p) => p[0] === k));
  const out = [];
  for (let i = 0; i < list.length; i++) if (!SPECIAL.has(list[i][0])) out.push(i);
  return out.length ? out : [0];
}

/** One palette index for a new animal (rand: () => 0..1). */
export function pickPalette(kind, biome, rand, { pond = false } = {}) {
  const list = PALETTES[kind];
  const idx = (key) => list.findIndex((p) => p[0] === key);
  if (kind === 'fish' && pond) {
    if (biome === 'fairy') return idx('fairy');
    if (biome !== 'candy' && rand() < 0.5) return idx('koi');
  }
  if (biome === 'snow' && (kind === 'dolphin' || kind === 'whale') && rand() < 0.5) return idx(kind === 'dolphin' ? 'snowy' : 'white');
  const c = paletteChoices(kind, biome);
  return c[Math.min(c.length - 1, Math.floor(rand() * c.length))];
}

/** Dolphin-only everyday words: no pet name in the game, no famous character (S9). */
export const DOLPHIN_NAMES = [
  'Splashy',
  'Wavy',
  'Twirl',
  'Breezy',
  'Ripple',
  'Swish',
  'Zoomy',
  'Seafoam',
  'Tumble',
  'Glide',
  'Drizzle',
  'Skimmer',
];

/** Every string kids read (§7). Short and friendly; nothing about prices or buying. */
export const SEA_TEXT = {
  hint: 'Tap to say hi!',
  met: {
    dolphin: 'You met a Dolphin!',
    fish: 'You met a Little Fish!',
    sea_turtle: 'You met a Sea Turtle!',
    octopus: 'You met an Octopus!',
    jelly: 'You met a Jellyfish!',
    seahorse: 'You met a Seahorse!',
    crab: 'You met a Crab!',
    starfish: 'You met a Starfish!',
    whale: 'You met a Whale!',
  },
  buddy: '{name} came to say hi!',
  poolFish: 'Fish moved into your pool!',
  poolDolphins: 'Dolphins came to your pool!',
  ride: 'Ride',
  trick: 'Trick',
  stopBoat: 'Stop the boat to ride a dolphin!',
  swimOut: 'Swim out to ride a dolphin!',
  rideTouch: 'Steer with the joystick! Tap Jump to jump!',
  rideKeys: 'Steer with W A S D! Space to jump!',
  shallow: 'Dolphins stay in deep water!',
  offYouGo: 'Splash! Off you go!',
  hopFirst: 'Hop off first!',
  hopOff: 'Hop off',
  joyRide: 'Ride',
  helpTouch: 'Swim to a dolphin and tap it to ride',
  helpKeys: 'Swim to a dolphin and click it to ride',
  helpHop: 'Hop off a dolphin',
  whale: 'A whale says hello! Look at the sea!',
  friends: 'Sea Friends',
};

/** '#RRGGBB' -> [r, g, b] in linear 0..1 (the instanced tints; colors are linear in three). */
export function hexToLinear(hex, out = [0, 0, 0]) {
  const n = parseInt(String(hex).slice(1), 16);
  const s = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  out[0] = s((n >> 16) & 255);
  out[1] = s((n >> 8) & 255);
  out[2] = s(n & 255);
  return out;
}
