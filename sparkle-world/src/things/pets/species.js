// Pet species: blocky chibi models (big heads, big shiny eyes, blush), color variants and
// the numbers the AI and animation use. Models face +Z with the origin at the feet.
//
// Every model is a small rig of pivot groups (body at the rear hips, head at the neck, legs
// at the hips/shoulders, ears, tail, wings) whose meshes are baked vertex-colored geometry
// shared by every pet of the same species + variant.

import * as THREE from 'three';
import { baked, VC_MAT, glowMat } from './kit.js';
import { shade } from '../../core/util.js';
import { BLUSH, GOLD, RAINBOW, pivot, part, partL, eyeMesh, newRig } from './rig.js';
import { buildBreedDog, buildBreedCatExtras, DOG_BREEDS, CAT_BREEDS } from './breeds.js';
import { buildTurtle, TURTLE } from './turtle.js';
import { buildBigHorse, HORSE } from './horse.js';
import { mergeRig } from './skin.js';

// ---------- species table ----------

export const SPECIES = {
  puppy: {
    name: 'Puppy', voice: 'bark', happy: 'yip', treat: 'bone', gait: 'walk', trick: 'spin',
    speed: 4.4, run: 7, halfW: 0.26, height: 0.9, shadow: 0.9, tagY: 1.12, hop: 7.6, scale: 1.12,
    names: ['Biscuit', 'Peanut', 'Cookie', 'Buddy', 'Waffles', 'Teddy', 'Pepper', 'Honey'],
    variants: [
      { key: 'golden', name: 'Golden', body: '#F4C36E', light: '#FFEBC9', ear: '#DB9A45', accent: '#FF6FA5' },
      { key: 'snowy', name: 'Snowy', body: '#FFF8EF', light: '#FFFFFF', ear: '#F1D6BE', accent: '#7CC7FF' },
      { key: 'spotty', name: 'Spotty', body: '#FFFDF8', light: '#FFFFFF', ear: '#6E4B3B', spots: '#6E4B3B', accent: '#FF5A5A' },
      { key: 'cocoa', name: 'Cocoa', body: '#B07A52', light: '#EFD2B2', ear: '#7F5236', accent: '#3FD8B0' },
      { key: 'candy', name: 'Candy', body: '#FFC6DD', light: '#FFF1F7', ear: '#FF96C0', accent: '#9C7BFF' },
      ...DOG_BREEDS,
    ],
  },
  kitty: {
    name: 'Kitty', voice: 'meow', happy: 'purr', treat: 'fish', gait: 'walk', trick: 'groom',
    speed: 4.2, run: 7, halfW: 0.24, height: 0.8, shadow: 0.8, tagY: 1.0, hop: 7.8, scale: 1.12,
    names: ['Luna', 'Mochi', 'Whiskers', 'Mittens', 'Coco', 'Pumpkin', 'Snowball', 'Nala'],
    variants: [
      { key: 'ginger', name: 'Ginger', body: '#FFB46E', light: '#FFEAD6', ear: '#FFB46E', stripes: '#EE8B42', eye: '#6ED39A', accent: '#FF6FA5' },
      { key: 'misty', name: 'Misty', body: '#B9B5CA', light: '#F6F4FA', ear: '#B9B5CA', stripes: '#9C97B0', eye: '#7CC7FF', accent: '#FFC94D' },
      { key: 'calico', name: 'Calico', group: 'breeds', body: '#FFFBF4', light: '#FFFFFF', ear: '#FFA64D', patches: ['#FFA64D', '#4E4557'], eye: '#FFC24D', accent: '#9C7BFF' },
      { key: 'midnight', name: 'Midnight', body: '#4D4760', light: '#6A6380', ear: '#4D4760', eye: '#B6F07A', whisker: '#FFFFFF', accent: '#FF6FA5' },
      { key: 'lilac', name: 'Lilac', body: '#D9C8FF', light: '#F7F2FF', ear: '#D9C8FF', eye: '#FF8CC6', accent: '#3FD8B0' },
      ...CAT_BREEDS,
    ],
  },
  bunny: {
    name: 'Bunny', voice: 'squeak', happy: 'squeak', treat: 'carrot', gait: 'hop', trick: 'binky',
    speed: 4.2, run: 6.6, halfW: 0.24, height: 0.7, shadow: 0.75, tagY: 1.1, hop: 8, scale: 1.15,
    names: ['Clover', 'Daisy', 'Cinnamon', 'Bun Bun', 'Marshmallow', 'Hoppy', 'Thumper', 'Poppy'],
    variants: [
      { key: 'snowball', name: 'Snowball', body: '#FFFFFF', light: '#FFFFFF', ear: '#FFFFFF', inner: '#FFC4D8', accent: '#FF6FA5' },
      { key: 'cocoa', name: 'Cocoa', body: '#BC8D6A', light: '#F4E1CC', ear: '#BC8D6A', inner: '#F7C3B8', accent: '#3FD8B0' },
      { key: 'cloud', name: 'Cloud', body: '#C3C0CE', light: '#F4F2F8', ear: '#C3C0CE', inner: '#FFC4D8', accent: '#7CC7FF' },
      { key: 'patches', name: 'Patches', body: '#FFF9F2', light: '#FFFFFF', ear: '#C28E66', patch: '#C28E66', inner: '#FFC4D8', accent: '#FFC94D' },
      { key: 'rosy', name: 'Rosy', body: '#FFD3E4', light: '#FFF4F8', ear: '#FFD3E4', inner: '#FF9EC3', accent: '#9C7BFF' },
    ],
  },
  pony: {
    name: 'Pony', voice: 'neigh', happy: 'neigh', treat: 'apple', gait: 'trot', trick: 'rear', rideable: true,
    speed: 4.6, run: 7.4, halfW: 0.36, height: 1.2, shadow: 1.3, tagY: 1.84, hop: 8.4, seat: 1.03, scale: 1,
    names: ['Buttercup', 'Maple', 'Star', 'Cinnamon', 'Peaches', 'Dolly', 'Toffee', 'Blossom'],
    variants: [
      { key: 'strawberry', name: 'Strawberry', body: '#FFC6DA', light: '#FFF0F6', mane: ['#FF6FA5', '#FF8DBA'], hoof: '#C7719A', accent: '#9C7BFF' },
      { key: 'snowflake', name: 'Snowflake', body: '#FFFAF5', light: '#FFFFFF', mane: ['#B7A2FF', '#D6C9FF'], hoof: '#B7A2FF', accent: '#FF6FA5' },
      { key: 'caramel', name: 'Caramel', body: '#E6B47F', light: '#FFF1DE', mane: ['#FFF3D6', '#FFE4B0'], hoof: '#9C6B45', accent: '#3FD8B0' },
      { key: 'sky', name: 'Sky', body: '#C4E7FF', light: '#F1FAFF', mane: ['#FFFFFF', '#8FD3FF'], hoof: '#6C9CC6', accent: '#FFC94D' },
      { key: 'chestnut', name: 'Chestnut', body: '#B97B57', light: '#F2D3BC', mane: ['#5E3B2B', '#76503C'], hoof: '#4E3326', accent: '#FF6FA5' },
    ],
  },
  unicorn: {
    name: 'Unicorn', voice: 'unicorn', happy: 'unicorn', treat: 'star_cookie', gait: 'trot', trick: 'rear', rideable: true, flies: true,
    speed: 4.8, run: 7.6, halfW: 0.36, height: 1.2, shadow: 1.3, tagY: 2.0, hop: 8.6, seat: 1.03, scale: 1,
    names: ['Sparkle', 'Rainbow', 'Stardust', 'Twinkle', 'Celeste', 'Glitter', 'Moonbeam', 'Aurora'],
    variants: [
      { key: 'pearl', name: 'Pearl', body: '#FFFBFE', light: '#FFFFFF', mane: RAINBOW, hoof: GOLD, horn: '#FFE39A', mark: '#FF8CC6', accent: '#FF6FA5' },
      { key: 'blossom', name: 'Blossom', body: '#FFD0E4', light: '#FFF3F8', mane: RAINBOW, hoof: GOLD, horn: '#FFF6C8', mark: '#9C7BFF', accent: '#9C7BFF' },
      { key: 'lilac', name: 'Lilac', body: '#DCCBFF', light: '#F6F1FF', mane: RAINBOW, hoof: GOLD, horn: '#FFE39A', mark: '#FF6FA5', accent: '#3FD8B0' },
      { key: 'mint', name: 'Mint', body: '#C9F4E4', light: '#F2FFF9', mane: RAINBOW, hoof: GOLD, horn: '#FFE39A', mark: '#FF8CC6', accent: '#FF6FA5' },
      { key: 'starry', name: 'Starry', body: '#7C74D6', light: '#A9A2F0', mane: RAINBOW, hoof: GOLD, horn: '#FFF3B0', mark: '#FFE27A', accent: '#FFC94D' },
    ],
  },
  panda: {
    name: 'Panda', voice: 'mew', happy: 'mew', treat: 'bamboo', gait: 'walk', trick: 'roll',
    speed: 3.6, run: 6, halfW: 0.3, height: 1.0, shadow: 1.0, tagY: 1.24, hop: 7.4, scale: 1.08,
    names: ['Bamboo', 'Dumpling', 'Bao', 'Oreo', 'Panpan', 'Mei Mei', 'Snuggles', 'Pudding'],
    variants: [
      { key: 'classic', name: 'Classic', body: '#FBF8F4', dark: '#453D4E', accent: '#FF6FA5' },
      { key: 'pink', name: 'Pink', body: '#FFFAFC', dark: '#FF9CC4', accent: '#9C7BFF' },
      { key: 'cocoa', name: 'Cocoa', body: '#FFF3E4', dark: '#8C5D40', accent: '#3FD8B0' },
      { key: 'blueberry', name: 'Blueberry', body: '#FBFCFF', dark: '#6F84D6', accent: '#FFC94D' },
    ],
  },
  duckling: {
    name: 'Duckling', voice: 'peep', happy: 'quack', treat: 'seeds', gait: 'waddle', trick: 'flap', swims: true,
    speed: 3.8, run: 6.2, halfW: 0.2, height: 0.62, shadow: 0.62, tagY: 0.88, hop: 7.2, scale: 1.25,
    names: ['Nugget', 'Puddles', 'Sunny', 'Waddles', 'Pip', 'Quackers', 'Butter', 'Peep'],
    variants: [
      { key: 'sunny', name: 'Sunny', body: '#FFE06B', wing: '#FFD043', beak: '#FF9F2E', accent: '#FF6FA5' },
      { key: 'snowy', name: 'Snowy', body: '#FFFFFF', wing: '#F1EEF6', beak: '#FFB347', accent: '#7CC7FF' },
      { key: 'puddle', name: 'Puddle', body: '#D9B48E', wing: '#B88D66', beak: '#FF9F2E', cap: '#8E6A4E', accent: '#3FD8B0' },
      { key: 'bubblegum', name: 'Bubblegum', body: '#FFC8DD', wing: '#FFA9C9', beak: '#FFB347', accent: '#9C7BFF' },
      { key: 'sky', name: 'Sky', body: '#C3E6FF', wing: '#A6D6FF', beak: '#FFB347', accent: '#FFC94D' },
    ],
  },
  turtle: TURTLE,
  horse: HORSE,
};

export const SPECIES_KEYS = Object.keys(SPECIES);
for (const k of SPECIES_KEYS) SPECIES[k].key = k;

export function variantOf(species, key) {
  const s = SPECIES[species];
  if (!s) return null;
  return s.variants.find((v) => v.key === key) || s.variants[0];
}

// ---------- species builders ----------

function buildPuppy(rig, v) {
  const K = `puppy:${v.key}`;
  const hipY = 0.27;
  rig.legLen = hipY;
  rig.body = pivot(rig.jumper, [0, 0, 0], [0, hipY, -0.18]);
  rig.bodyY = rig.body.position.y;
  const B = rig.body;
  for (const [i, lx, lz] of [[0, -0.12, 0.16], [1, 0.12, 0.16], [2, -0.12, -0.18], [3, 0.12, -0.18]]) {
    const leg = pivot(B, B.userData.w, [lx, hipY, lz]);
    partL(leg, `${K}:leg`, (k) => {
      k.cbox(0.13, 0.27, 0.14, v.body, 0, -0.135, 0);
      k.cbox(0.15, 0.065, 0.17, v.light, 0, -0.238, 0.012);
    });
    rig.legs.push(leg);
    (i < 2 ? rig.front : rig.back).push(leg);
  }
  part(B, `${K}:body`, (k) => {
    k.cbox(0.42, 0.3, 0.6, v.body, 0, 0.4, -0.01);
    k.cbox(0.3, 0.02, 0.44, v.light, 0, 0.245, 0);
    k.cbox(0.26, 0.2, 0.02, v.light, 0, 0.42, 0.29);
    k.cbox(0.37, 0.075, 0.2, v.accent, 0, 0.535, 0.22);
    k.cbox(0.075, 0.085, 0.03, GOLD, 0, 0.47, 0.33);
    if (v.spots) {
      k.cbox(0.012, 0.13, 0.16, v.spots, -0.214, 0.43, -0.12);
      k.cbox(0.012, 0.1, 0.12, v.spots, 0.214, 0.37, 0.1);
      k.cbox(0.16, 0.012, 0.18, v.spots, 0.05, 0.556, -0.16);
      k.cbox(0.012, 0.09, 0.1, v.spots, 0.214, 0.47, -0.2);
    }
  });
  rig.tail = pivot(B, B.userData.w, [0, 0.5, -0.3]);
  part(rig.tail, `${K}:tail`, (k) => {
    k.cbox(0.085, 0.085, 0.24, v.body, 0, 0.577, -0.39, [0.7, 0, 0]);
    k.cbox(0.09, 0.09, 0.06, v.light, 0, 0.64, -0.465, [0.7, 0, 0]);
  });
  const H = rig.head = pivot(B, B.userData.w, [0, 0.52, 0.2]);
  part(H, `${K}:head`, (k) => {
    k.cbox(0.5, 0.44, 0.42, v.body, 0, 0.73, 0.27);
    k.cbox(0.24, 0.15, 0.11, v.light, 0, 0.625, 0.535);
    k.cbox(0.1, 0.065, 0.05, '#3A2A33', 0, 0.685, 0.588);
    k.cbox(0.03, 0.02, 0.01, '#FFFFFF', -0.022, 0.702, 0.614);
    k.cbox(0.018, 0.05, 0.01, '#3A2A33', 0, 0.635, 0.592);
    k.cbox(0.05, 0.018, 0.01, '#3A2A33', -0.03, 0.605, 0.592, [0, 0, -0.45]);
    k.cbox(0.05, 0.018, 0.01, '#3A2A33', 0.03, 0.605, 0.592, [0, 0, 0.45]);
    k.cbox(0.085, 0.042, 0.012, BLUSH, -0.175, 0.645, 0.486);
    k.cbox(0.085, 0.042, 0.012, BLUSH, 0.175, 0.645, 0.486);
    k.cbox(0.2, 0.08, 0.06, v.light, 0, 0.91, 0.42); // a soft forehead tuft
    if (v.spots) k.cbox(0.17, 0.19, 0.012, v.spots, 0.12, 0.77, 0.483);
  });
  rig.tongue = part(H, `${K}:tongue`, (k) => k.cbox(0.075, 0.02, 0.075, '#FF7FA4', 0, 0.565, 0.572));
  rig.eyes.push(eyeMesh(H, K, -0.12, 0.775, 0.49, 0.1, 0.13), eyeMesh(H, K, 0.12, 0.775, 0.49, 0.1, 0.13));
  for (const s of [-1, 1]) {
    const ear = pivot(H, H.userData.w, [s * 0.25, 0.9, 0.3]);
    part(ear, `${K}:ear${s}`, (k) => {
      k.cbox(0.09, 0.28, 0.2, v.ear, s * 0.285, 0.79, 0.3, [0, 0, s * 0.16]);
      k.cbox(0.02, 0.2, 0.14, shade(v.ear, -0.08), s * 0.24, 0.8, 0.3, [0, 0, s * 0.16]);
    });
    rig.ears.push(ear);
  }
}

function buildKitty(rig, v) {
  const K = `kitty:${v.key}`;
  const hipY = 0.22;
  rig.legLen = hipY;
  rig.lashes = true;
  const B = rig.body = pivot(rig.jumper, [0, 0, 0], [0, hipY, -0.16]);
  rig.bodyY = B.position.y;
  const patchA = v.patches ? v.patches[0] : null, patchB = v.patches ? v.patches[1] : null;
  for (const [i, lx, lz] of [[0, -0.1, 0.14], [1, 0.1, 0.14], [2, -0.1, -0.16], [3, 0.1, -0.16]]) {
    const leg = pivot(B, B.userData.w, [lx, hipY, lz]);
    const legColor = patchB && i === 1 ? patchB : v.body;
    part(leg, `${K}:leg${i === 1 ? 'b' : ''}`, (k) => {
      k.cbox(v.fluffy ? 0.12 : 0.1, 0.22, v.fluffy ? 0.13 : 0.11, legColor, lx, 0.11, lz);
      if (v.points) k.cbox(0.108, 0.1, 0.118, v.points, lx, 0.06, lz);
      k.cbox(0.12, 0.05, 0.13, v.points || v.light, lx, 0.025, lz + 0.012);
    });
    rig.legs.push(leg);
    (i < 2 ? rig.front : rig.back).push(leg);
  }
  part(B, `${K}:body`, (k) => {
    k.cbox(0.34, 0.26, 0.54, v.body, 0, 0.34, -0.01);
    k.cbox(0.24, 0.02, 0.36, v.light, 0, 0.205, 0.01);
    k.cbox(0.2, 0.17, 0.02, v.light, 0, 0.35, 0.26);
    k.cbox(0.31, 0.06, 0.16, v.accent, 0, 0.455, 0.2);
    k.ball(0.036, GOLD, 0, 0.405, 0.29, 8);
    if (v.stripes) {
      for (const z of [-0.2, -0.06, 0.08]) {
        k.cbox(0.3, 0.012, 0.05, v.stripes, 0, 0.476, z);
        k.cbox(0.012, 0.09, 0.05, v.stripes, -0.172, 0.43, z);
        k.cbox(0.012, 0.09, 0.05, v.stripes, 0.172, 0.43, z);
      }
    }
    if (patchA) {
      k.cbox(0.2, 0.012, 0.22, patchA, -0.06, 0.476, -0.1);
      k.cbox(0.012, 0.14, 0.2, patchA, -0.172, 0.4, -0.1);
      k.cbox(0.16, 0.012, 0.14, patchB, 0.08, 0.476, 0.08);
      k.cbox(0.012, 0.1, 0.14, patchB, 0.172, 0.4, 0.08);
    }
  });
  rig.tail = pivot(B, B.userData.w, [0, 0.42, -0.27]);
  const tailColor = v.points || patchB || v.body;
  part(rig.tail, `${K}:tail`, (k) => k.cbox(0.075, 0.075, 0.25, tailColor, 0, 0.518, -0.348, [0.9, 0, 0]));
  rig.tail2 = pivot(rig.tail, rig.tail.userData.w, [0, 0.62, -0.425]);
  part(rig.tail2, `${K}:tail2`, (k) => {
    k.cbox(0.075, 0.2, 0.075, tailColor, 0, 0.72, -0.43);
    k.cbox(0.08, 0.06, 0.08, v.stripes || v.light, 0, 0.8, -0.43);
  });
  const H = rig.head = pivot(B, B.userData.w, [0, 0.44, 0.18]);
  const whisker = v.whisker || '#FFFFFF';
  part(H, `${K}:head`, (k) => {
    k.cbox(0.46, 0.38, 0.36, v.body, 0, 0.62, 0.24);
    k.cbox(0.54, 0.13, 0.27, v.body, 0, 0.52, 0.255);
    if (v.points) k.cbox(0.26, 0.2, 0.012, v.points, 0, 0.585, 0.4235);
    k.cbox(0.2, 0.1, 0.03, v.points ? shade(v.points, 0.12) : v.light, 0, 0.535, 0.43);
    k.cbox(0.062, 0.042, 0.03, '#FF8FB0', 0, 0.578, 0.447);
    k.cbox(0.046, 0.014, 0.01, '#5A3A4A', -0.022, 0.537, 0.448, [0, 0, -0.5]);
    k.cbox(0.046, 0.014, 0.01, '#5A3A4A', 0.022, 0.537, 0.448, [0, 0, 0.5]);
    k.cbox(0.075, 0.036, 0.012, BLUSH, -0.16, 0.56, 0.425);
    k.cbox(0.075, 0.036, 0.012, BLUSH, 0.16, 0.56, 0.425);
    for (const s of [-1, 1]) {
      k.cbox(0.17, 0.012, 0.012, whisker, s * 0.33, 0.565, 0.36, [0, 0, s * 0.12]);
      k.cbox(0.17, 0.012, 0.012, whisker, s * 0.33, 0.53, 0.36, [0, 0, -s * 0.08]);
    }
    if (v.stripes) for (const x of [-0.055, 0, 0.055]) k.cbox(0.026, 0.085, 0.01, v.stripes, x, 0.76, 0.422);
    if (patchA) k.cbox(0.2, 0.16, 0.012, patchB, -0.12, 0.74, 0.423);
  });
  rig.eyes.push(
    eyeMesh(H, K, -0.11, 0.655, 0.432, 0.115, 0.135, { iris: v.eye, slit: true, lashes: -1 }),
    eyeMesh(H, K, 0.11, 0.655, 0.432, 0.115, 0.135, { iris: v.eye, slit: true, lashes: 1 }),
  );
  for (const s of [-1, 1]) {
    const ear = pivot(H, H.userData.w, [s * 0.14, 0.79, 0.22]);
    const earColor = v.points || (patchA ? (s < 0 ? patchA : patchB) : v.ear);
    part(ear, `${K}:ear${s}`, (k) => {
      k.cyl(0.125, 0.18, earColor, s * 0.14, 0.79, 0.22, 4, [0, Math.PI / 4, 0], 0);
      k.cyl(0.075, 0.11, '#FFB6CB', s * 0.14, 0.79, 0.262, 4, [0, Math.PI / 4, 0], 0);
    });
    rig.ears.push(ear);
  }
  if (v.fluffy || v.bow) buildBreedCatExtras(rig, v, K);
}

function buildBunny(rig, v) {
  const K = `bunny:${v.key}`;
  rig.legLen = 0.14;
  const B = rig.body = pivot(rig.jumper, [0, 0, 0], [0, 0.14, -0.1]);
  rig.bodyY = B.position.y;
  for (const [i, s] of [[0, -1], [1, 1]]) {
    const leg = pivot(B, B.userData.w, [s * 0.08, 0.16, 0.12]);
    partL(leg, `${K}:arm`, (k) => {
      k.cbox(0.085, 0.16, 0.09, v.body, 0, -0.08, 0.01);
      k.cbox(0.09, 0.04, 0.1, v.light, 0, -0.14, 0.015);
    });
    rig.front.push(leg);
    rig.legs.push(leg);
    void i;
  }
  for (const s of [-1, 1]) {
    const leg = pivot(B, B.userData.w, [s * 0.13, 0.14, -0.1]);
    part(leg, `${K}:foot${s}`, (k) => {
      k.cbox(0.13, 0.17, 0.21, v.patch || v.body, s * 0.14, 0.135, -0.11);
      k.cbox(0.12, 0.06, 0.26, v.light, s * 0.13, 0.03, -0.02);
    });
    rig.back.push(leg);
    rig.legs.push(leg);
  }
  // legs order: FL FR BL BR
  rig.legs = [rig.front[0], rig.front[1], rig.back[0], rig.back[1]];
  part(B, `${K}:body`, (k) => {
    k.cbox(0.36, 0.28, 0.42, v.body, 0, 0.25, -0.05);
    k.cbox(0.3, 0.36, 0.34, v.body, 0, 0.26, -0.06);
    k.cbox(0.22, 0.2, 0.02, v.light, 0, 0.25, 0.165);
    k.cbox(0.3, 0.05, 0.14, v.accent, 0, 0.42, 0.08);
    k.cbox(0.13, 0.08, 0.03, v.accent, -0.08, 0.43, 0.15, [0, 0, 0.35]);
    k.cbox(0.13, 0.08, 0.03, v.accent, 0.08, 0.43, 0.15, [0, 0, -0.35]);
    k.cbox(0.04, 0.04, 0.035, shade(v.accent, -0.15), 0, 0.43, 0.155);
    if (v.patch) {
      k.cbox(0.012, 0.16, 0.2, v.patch, -0.182, 0.27, -0.14);
      k.cbox(0.012, 0.16, 0.2, v.patch, 0.182, 0.27, -0.14);
      k.cbox(0.28, 0.012, 0.18, v.patch, 0, 0.442, -0.15);
    }
  });
  rig.tail = pivot(B, B.userData.w, [0, 0.28, -0.26]);
  part(rig.tail, `${K}:tail`, (k) => k.ball(0.095, '#FFFFFF', 0, 0.28, -0.29, 10));
  const H = rig.head = pivot(B, B.userData.w, [0, 0.36, 0.12]);
  part(H, `${K}:head`, (k) => {
    k.cbox(0.38, 0.33, 0.32, v.body, 0, 0.5, 0.17);
    k.cbox(0.44, 0.13, 0.25, v.body, 0, 0.42, 0.18);
    k.cbox(0.15, 0.09, 0.03, v.light, 0, 0.425, 0.335);
    k.cbox(0.055, 0.038, 0.02, '#FF8FB0', 0, 0.462, 0.352);
    k.cbox(0.05, 0.042, 0.012, '#FFFFFF', 0, 0.39, 0.345);
    k.cbox(0.075, 0.036, 0.012, BLUSH, -0.14, 0.445, 0.336);
    k.cbox(0.075, 0.036, 0.012, BLUSH, 0.14, 0.445, 0.336);
    if (v.patch) k.cbox(0.16, 0.18, 0.012, v.patch, 0.1, 0.57, 0.332);
  });
  rig.eyes.push(eyeMesh(H, K, -0.1, 0.535, 0.338, 0.09, 0.115), eyeMesh(H, K, 0.1, 0.535, 0.338, 0.09, 0.115));
  for (const s of [-1, 1]) {
    const ear = pivot(H, H.userData.w, [s * 0.08, 0.64, 0.15]);
    const earColor = v.patch && s > 0 ? v.patch : v.ear;
    part(ear, `${K}:ear${s}`, (k) => {
      k.cbox(0.1, 0.36, 0.055, earColor, s * 0.105, 0.81, 0.15, [-0.12, 0, -s * 0.16]);
      k.cbox(0.055, 0.27, 0.012, v.inner, s * 0.104, 0.8, 0.18, [-0.12, 0, -s * 0.16]);
    });
    rig.ears.push(ear);
  }
}

function buildPanda(rig, v) {
  const K = `panda:${v.key}`;
  const hipY = 0.25;
  rig.legLen = hipY;
  const B = rig.body = pivot(rig.jumper, [0, 0, 0], [0, hipY, -0.2]);
  rig.bodyY = B.position.y;
  for (const [i, lx, lz] of [[0, -0.15, 0.19], [1, 0.15, 0.19], [2, -0.15, -0.2], [3, 0.15, -0.2]]) {
    const leg = pivot(B, B.userData.w, [lx, hipY, lz]);
    partL(leg, `${K}:leg`, (k) => {
      k.cbox(0.17, 0.25, 0.17, v.dark, 0, -0.125, 0);
      k.cbox(0.19, 0.06, 0.19, shade(v.dark, 0.12), 0, -0.22, 0.01);
    });
    rig.legs.push(leg);
    (i < 2 ? rig.front : rig.back).push(leg);
  }
  part(B, `${K}:body`, (k) => {
    k.cbox(0.52, 0.38, 0.64, v.body, 0, 0.42, -0.01);
    k.cbox(0.54, 0.395, 0.19, v.dark, 0, 0.42, 0.17);
    k.cbox(0.3, 0.07, 0.03, v.accent, 0, 0.56, 0.27);
  });
  rig.tail = pivot(B, B.userData.w, [0, 0.52, -0.33]);
  part(rig.tail, `${K}:tail`, (k) => k.cbox(0.11, 0.1, 0.07, v.body, 0, 0.53, -0.35));
  const H = rig.head = pivot(B, B.userData.w, [0, 0.58, 0.24]);
  part(H, `${K}:head`, (k) => {
    k.cbox(0.56, 0.48, 0.46, v.body, 0, 0.8, 0.3);
    k.cbox(0.62, 0.16, 0.34, v.body, 0, 0.67, 0.31);
    k.cbox(0.17, 0.2, 0.02, v.dark, -0.13, 0.82, 0.535, [0, 0, -0.42]);
    k.cbox(0.17, 0.2, 0.02, v.dark, 0.13, 0.82, 0.535, [0, 0, 0.42]);
    k.cbox(0.27, 0.14, 0.07, v.body, 0, 0.685, 0.565);
    k.cbox(0.11, 0.065, 0.03, '#3A3140', 0, 0.735, 0.6);
    k.cbox(0.03, 0.02, 0.01, '#FFFFFF', -0.025, 0.752, 0.616);
    k.cbox(0.018, 0.04, 0.01, '#3A3140', 0, 0.685, 0.601);
    k.cbox(0.05, 0.016, 0.01, '#3A3140', -0.028, 0.66, 0.601, [0, 0, -0.45]);
    k.cbox(0.05, 0.016, 0.01, '#3A3140', 0.028, 0.66, 0.601, [0, 0, 0.45]);
    k.cbox(0.09, 0.045, 0.012, BLUSH, -0.225, 0.7, 0.535);
    k.cbox(0.09, 0.045, 0.012, BLUSH, 0.225, 0.7, 0.535);
  });
  rig.eyes.push(
    eyeMesh(H, K, -0.13, 0.815, 0.552, 0.075, 0.095, { ring: true }),
    eyeMesh(H, K, 0.13, 0.815, 0.552, 0.075, 0.095, { ring: true }),
  );
  for (const s of [-1, 1]) {
    const ear = pivot(H, H.userData.w, [s * 0.24, 1.02, 0.27]);
    partL(ear, `${K}:ear`, (k) => k.cbox(0.16, 0.15, 0.09, v.dark, 0, 0.04, 0));
    rig.ears.push(ear);
  }
}

function buildDuckling(rig, v) {
  const K = `duckling:${v.key}`;
  rig.legLen = 0.09;
  const B = rig.body = pivot(rig.jumper, [0, 0, 0], [0, 0.09, -0.08]);
  rig.bodyY = B.position.y;
  for (const s of [-1, 1]) {
    const leg = pivot(B, B.userData.w, [s * 0.08, 0.09, 0.02]);
    partL(leg, `${K}:foot`, (k) => {
      k.cbox(0.04, 0.09, 0.04, v.beak, 0, -0.045, 0);
      k.cbox(0.11, 0.025, 0.13, v.beak, 0, -0.0775, 0.03);
    });
    rig.legs.push(leg);
  }
  rig.front = [rig.legs[0]];
  rig.back = [rig.legs[1]];
  part(B, `${K}:body`, (k) => {
    k.cbox(0.32, 0.26, 0.38, v.body, 0, 0.22, -0.04);
    k.cbox(0.28, 0.2, 0.06, v.body, 0, 0.21, 0.17);
    k.cbox(0.15, 0.06, 0.11, v.wing, 0, 0.34, -0.25, [0.6, 0, 0]);
    k.cbox(0.26, 0.05, 0.08, v.accent, 0, 0.335, 0.1);
  });
  for (const s of [-1, 1]) {
    const wing = pivot(B, B.userData.w, [s * 0.16, 0.3, 0.0]);
    part(wing, `${K}:wing${s}`, (k) => k.cbox(0.045, 0.15, 0.22, v.wing, s * 0.18, 0.235, -0.04, [0.15, 0, 0]));
    rig.wings.push(wing);
  }
  const H = rig.head = pivot(B, B.userData.w, [0, 0.34, 0.08]);
  part(H, `${K}:head`, (k) => {
    k.cbox(0.3, 0.28, 0.28, v.body, 0, 0.47, 0.1);
    if (v.cap) k.cbox(0.31, 0.1, 0.29, v.cap, 0, 0.57, 0.1);
    k.cbox(0.13, 0.042, 0.09, v.beak, 0, 0.45, 0.28);
    k.cbox(0.1, 0.026, 0.07, shade(v.beak, 0.25), 0, 0.422, 0.268);
    k.cbox(0.075, 0.035, 0.012, BLUSH, -0.1, 0.445, 0.244);
    k.cbox(0.075, 0.035, 0.012, BLUSH, 0.1, 0.445, 0.244);
    k.cbox(0.032, 0.09, 0.032, v.cap || v.wing, 0, 0.645, 0.12, [-0.35, 0, 0]);
    k.cbox(0.028, 0.075, 0.028, v.cap || v.wing, 0.03, 0.635, 0.085, [0, 0, -0.5]);
  });
  rig.eyes.push(eyeMesh(H, K, -0.08, 0.505, 0.246, 0.065, 0.085), eyeMesh(H, K, 0.08, 0.505, 0.246, 0.065, 0.085));
}

function buildHorse(rig, v, unicorn) {
  const K = `${unicorn ? 'unicorn' : 'pony'}:${v.key}`;
  const hipY = 0.5;
  rig.legLen = hipY;
  rig.lashes = true;
  const mane = v.mane;
  const M = (i) => mane[i % mane.length];
  const B = rig.body = pivot(rig.jumper, [0, 0, 0], [0, hipY, -0.32]);
  rig.bodyY = B.position.y;
  for (const [i, lx, lz] of [[0, -0.15, 0.3], [1, 0.15, 0.3], [2, -0.15, -0.32], [3, 0.15, -0.32]]) {
    const leg = pivot(B, B.userData.w, [lx, hipY, lz]);
    partL(leg, `${K}:leg`, (k) => {
      k.cbox(0.16, 0.46, 0.17, v.body, 0, -0.23, 0);
      k.cbox(0.19, 0.06, 0.2, M(0), 0, -0.4, 0);
      k.cbox(0.18, 0.08, 0.19, v.hoof, 0, -0.46, 0.005);
    });
    rig.legs.push(leg);
    (i < 2 ? rig.front : rig.back).push(leg);
  }
  part(B, `${K}:body`, (k) => {
    k.cbox(0.56, 0.44, 0.9, v.body, 0, 0.72, -0.02);
    k.cbox(0.44, 0.02, 0.62, v.light, 0, 0.495, -0.02);
    // a short, sturdy neck
    k.cbox(0.34, 0.42, 0.34, v.body, 0, 1.0, 0.34, [0.28, 0, 0]);
    // saddle: blanket, seat, pommel, cantle, flaps, stirrups
    k.cbox(0.6, 0.03, 0.44, shade(v.accent, 0.55), 0, 0.952, -0.08);
    k.cbox(0.48, 0.07, 0.34, v.accent, 0, 0.99, -0.08);
    k.cbox(0.14, 0.09, 0.07, shade(v.accent, -0.12), 0, 1.05, 0.08);
    k.cbox(0.36, 0.07, 0.06, shade(v.accent, -0.12), 0, 1.04, -0.24);
    for (const s of [-1, 1]) {
      k.cbox(0.02, 0.22, 0.26, v.accent, s * 0.292, 0.84, -0.08);
      k.cbox(0.02, 0.07, 0.07, '#FFFFFF', s * 0.304, 0.85, -0.08, [0.785, 0, 0]);
      k.cbox(0.018, 0.13, 0.018, '#C9A94A', s * 0.305, 0.69, -0.08);
      k.cbox(0.05, 0.022, 0.08, GOLD, s * 0.305, 0.62, -0.08);
    }
    if (unicorn) {
      for (const s of [-1, 1]) {
        k.cbox(0.012, 0.16, 0.035, v.mark, s * 0.282, 0.74, -0.34);
        k.cbox(0.012, 0.035, 0.16, v.mark, s * 0.282, 0.74, -0.34);
        k.cbox(0.012, 0.07, 0.07, GOLD, s * 0.284, 0.74, -0.34, [0.785, 0, 0]);
      }
    }
  });
  // mane: chunky locks down the back of the neck
  rig.mane = pivot(B, B.userData.w, [0, 1.1, 0.3]);
  part(rig.mane, `${K}:mane`, (k) => {
    const locks = [[1.44, 0.4, 0.18], [1.3, 0.3, 0.2], [1.15, 0.22, 0.2], [1.0, 0.16, 0.18], [0.88, 0.12, 0.15]];
    locks.forEach(([y, z, h], i) => k.cbox(0.2, h, 0.16, M(i), 0, y, z, [0.28, 0, 0]));
    // a few locks falling over the side of the neck
    k.cbox(0.05, 0.3, 0.14, M(1), 0.19, 1.2, 0.3, [0.28, 0, 0.12]);
    k.cbox(0.05, 0.24, 0.12, M(3), 0.2, 1.02, 0.22, [0.28, 0, 0.1]);
  });
  rig.tail = pivot(B, B.userData.w, [0, 0.88, -0.47]);
  part(rig.tail, `${K}:tail`, (k) => {
    k.cbox(0.18, 0.16, 0.2, M(0), 0, 0.88, -0.56, [0.35, 0, 0]);
    k.cbox(0.22, 0.26, 0.18, M(1), 0, 0.72, -0.66, [0.25, 0, 0]);
    k.cbox(0.2, 0.2, 0.16, M(2), 0, 0.53, -0.71, [0.12, 0, 0]);
    k.cbox(0.16, 0.14, 0.14, M(3), 0, 0.39, -0.72);
    if (mane.length > 4) k.cbox(0.12, 0.1, 0.12, M(4), 0, 0.28, -0.71);
  });
  const H = rig.head = pivot(B, B.userData.w, [0, 1.12, 0.42]);
  part(H, `${K}:head`, (k) => {
    k.cbox(0.5, 0.46, 0.46, v.body, 0, 1.3, 0.55);
    k.cbox(0.4, 0.22, 0.17, v.light, 0, 1.16, 0.855);
    k.cbox(0.05, 0.035, 0.012, shade(v.light, -0.35), -0.09, 1.2, 0.944);
    k.cbox(0.05, 0.035, 0.012, shade(v.light, -0.35), 0.09, 1.2, 0.944);
    k.cbox(0.12, 0.018, 0.012, '#8A4A6A', 0, 1.115, 0.944);
    k.cbox(0.05, 0.018, 0.012, '#8A4A6A', -0.07, 1.128, 0.944, [0, 0, -0.45]);
    k.cbox(0.05, 0.018, 0.012, '#8A4A6A', 0.07, 1.128, 0.944, [0, 0, 0.45]);
    k.cbox(0.085, 0.042, 0.012, BLUSH, -0.195, 1.245, 0.785);
    k.cbox(0.085, 0.042, 0.012, BLUSH, 0.195, 1.245, 0.785);
    k.cbox(0.26, 0.15, 0.1, M(0), 0, 1.49, 0.75);
    k.cbox(0.2, 0.11, 0.28, M(1), 0, 1.56, 0.56);
    k.cbox(0.08, 0.2, 0.1, M(2), -0.14, 1.4, 0.76, [0, 0, 0.25]);
  });
  rig.eyes.push(
    eyeMesh(H, K, -0.12, 1.345, 0.787, 0.12, 0.155, { lashes: -1 }),
    eyeMesh(H, K, 0.12, 1.345, 0.787, 0.12, 0.155, { lashes: 1 }),
  );
  for (const s of [-1, 1]) {
    const ear = pivot(H, H.userData.w, [s * 0.16, 1.52, 0.47]);
    part(ear, `${K}:ear${s}`, (k) => {
      k.cyl(0.085, 0.17, v.body, s * 0.16, 1.52, 0.47, 4, [0, Math.PI / 4, 0], 0);
      k.cyl(0.048, 0.1, '#FFB6CB', s * 0.16, 1.52, 0.498, 4, [0, Math.PI / 4, 0], 0);
    });
    rig.ears.push(ear);
  }
  if (unicorn) {
    const horn = new THREE.Group();
    const hw = H.userData.w;
    horn.position.set(0 - hw[0], 1.56 - hw[1], 0.66 - hw[2]);
    horn.rotation.x = 0.42;
    const cone = new THREE.Mesh(baked('horn:cone', (k) => k.cyl(0.07, 0.42, '#FFFFFF', 0, 0, 0, 10, null, 0)), glowMat(v.horn, 0.55));
    horn.add(cone);
    horn.add(new THREE.Mesh(baked('horn:rings', (k) => {
      for (let i = 0; i < 3; i++) {
        const y = 0.07 + i * 0.1, r = 0.07 * (1 - y / 0.42) + 0.008;
        k.cyl(r, 0.022, '#FFB6D9', 0, y, 0, 10, [0.18, 0, 0.1]);
      }
    }), VC_MAT));
    H.add(horn);
    rig.horn = horn;
  }
  rig.seatHeight = SPECIES[unicorn ? 'unicorn' : 'pony'].seat;
}

const BUILDERS = {
  puppy: (rig, v) => (v.breed ? buildBreedDog(rig, v) : buildPuppy(rig, v)),
  kitty: buildKitty,
  bunny: buildBunny,
  panda: buildPanda,
  duckling: buildDuckling,
  pony: (rig, v) => buildHorse(rig, v, false),
  unicorn: (rig, v) => buildHorse(rig, v, true),
  turtle: buildTurtle,
  horse: buildBigHorse,
};

/** Per-pet options a species offers (the horse's braided mane), normalized. */
export function petOpts(species, opts) {
  const o = {};
  if (species === 'horse' && opts && opts.braids) o.braids = true;
  return o;
}

/** A short cache key for pet options ('' when there are none). */
export function optsKey(opts) {
  return opts && opts.braids ? 'braids' : '';
}

/**
 * Build a fresh rig for a species + variant key. opts: { braids } (horse), merged: true bakes
 * every vertex-colored part into ONE skinned mesh driven by the rig's pivots (live pets: one
 * draw call instead of ~16); previews and thumbnails keep the separate meshes.
 */
export function buildRig(species, variantKey, opts = {}) {
  const spec = SPECIES[species] || SPECIES.puppy;
  const key = SPECIES[species] ? species : 'puppy';
  const v = variantOf(key, variantKey);
  const rig = newRig(key, spec, v);
  rig.opts = petOpts(key, opts);
  BUILDERS[key](rig, v, rig.opts);
  rig.scale = spec.scale || 1;
  rig.jumper.scale.setScalar(rig.scale);
  rig.baseRot = rig.legs.map(() => 0);
  rig.headRest = rig.head.position.clone();
  rig.legRest = rig.legs.map((l) => l.position.clone());
  rig.tailRest = rig.tail ? rig.tail.position.clone() : null;
  rig.accent = v.accent;
  if (opts.merged) {
    try {
      mergeRig(rig, `${key}:${v.key}:${optsKey(rig.opts)}`);
    } catch (err) {
      console.warn('[pets] could not merge the pet model; drawing its parts one by one', err);
    }
  }
  return rig;
}

/** Thumbnail object for a species + variant (for game.thumbs / the Bag). */
export function petThumbObject(species, variantKey, opts = {}) {
  const rig = buildRig(species, variantKey, opts);
  rig.root.remove(rig.shadow);
  if (rig.tongue) {
    rig.tongue.visible = false;
    rig.tongue.scale.setScalar(0);
  }
  // a friendly three-quarter pose: head turned toward the viewer a little
  rig.head.rotation.y = 0.25;
  return rig.root;
}
