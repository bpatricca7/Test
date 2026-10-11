// Garden crops: what grows, how long it takes, what it gives, and a little voxel model for
// each of the 4 growth stages (0 seeds, 1 sprout, 2 growing, 3 ready). Plant models stand on
// the farmland block's top, centred in the cell (x, z in [-0.5, 0.5]).

import * as THREE from 'three';
import { baked, VC_MAT, Kit } from '../pets/kit.js';

export const CROPS = {
  rose: { name: 'Rose', seeds: 'Rose Seeds', kind: 'flower', grow: 120, yield: 1, food: 'rose', color: '#FF6F98', packet: '#FFD1E1' },
  tulip: { name: 'Tulip', seeds: 'Tulip Bulbs', kind: 'flower', grow: 120, yield: 1, food: 'tulip', color: '#B892FF', packet: '#E6DDFF' },
  sunflower: { name: 'Sunflower', seeds: 'Sunflower Seeds', kind: 'flower', grow: 140, yield: 1, food: 'sunflower', color: '#FFD23F', packet: '#FFF1B8' },
  carrot: { name: 'Carrot', seeds: 'Carrot Seeds', kind: 'veg', grow: 140, yield: 2, food: 'carrot', color: '#FF9A3C', packet: '#FFE0C2' },
  strawberry: { name: 'Strawberry', seeds: 'Strawberry Seeds', kind: 'berry', grow: 150, yield: 3, food: 'strawberry', regrow: true, color: '#FF4F6D', packet: '#FFD6DE' },
  pumpkin: { name: 'Pumpkin', seeds: 'Pumpkin Seeds', kind: 'veg', grow: 170, yield: 1, food: 'pumpkin', color: '#FF9F2E', packet: '#FFE3C4' },
  watermelon: { name: 'Watermelon', seeds: 'Melon Seeds', kind: 'veg', grow: 170, yield: 1, food: 'watermelon', color: '#5DBB63', packet: '#D6F5D8' },
  blueberry: { name: 'Blueberry', seeds: 'Blueberry Seeds', kind: 'berry', grow: 150, yield: 4, food: 'blueberry', regrow: true, color: '#5B6CFF', packet: '#DCE2FF' },
};
export const CROP_KEYS = Object.keys(CROPS);
for (const k of CROP_KEYS) CROPS[k].key = k;

// how tall each stage is (for picking)
export function stageHeight(crop, stage) {
  if (crop === 'sunflower') return [0.12, 0.3, 0.95, 1.55][stage];
  if (crop === 'rose' || crop === 'tulip') return [0.12, 0.25, 0.5, 0.72][stage];
  return [0.12, 0.25, 0.45, 0.6][stage];
}

const SOIL = '#8A5E3F';
const SOIL_LIGHT = '#A8764F';
const STEM = '#4FAE57';
const LEAF = '#6CCB6A';
const LEAF_DARK = '#4FA557';
const LEAF_LIGHT = '#8EDB7E';

function mound(k, big = false) {
  if (big) {
    k.cbox(0.46, 0.05, 0.46, SOIL, 0, 0.025, 0);
    k.cbox(0.3, 0.035, 0.3, SOIL_LIGHT, 0, 0.06, 0);
  } else {
    k.cbox(0.3, 0.04, 0.3, SOIL, 0, 0.02, 0);
  }
}

function seedsOnTop(k) {
  for (const [x, z, r] of [[-0.06, 0.03, 0.3], [0.05, -0.04, 1.2], [0.02, 0.07, 2.1], [-0.03, -0.07, 0.7]]) {
    k.cbox(0.035, 0.02, 0.05, '#E8C98E', x, 0.087, z, [0, r, 0]);
  }
}

/** A little wooden sign that shows what is planted (stages 0-2). */
function sign(k, color) {
  k.cbox(0.035, 0.3, 0.035, '#C9935F', 0.33, 0.15, 0.33);
  k.cbox(0.2, 0.15, 0.03, '#FFF6E8', 0.33, 0.3, 0.345, [0, -0.6, 0]);
  k.cbox(0.2, 0.15, 0.03, '#E0B07A', 0.33, 0.3, 0.33, [0, -0.6, 0]);
  k.cbox(0.09, 0.08, 0.02, color, 0.34, 0.3, 0.36, [0, -0.6, 0]);
}

function sprout(k, h = 0.14, color = LEAF) {
  k.cbox(0.03, h, 0.03, STEM, 0, h / 2 + 0.03, 0);
  k.cbox(0.1, 0.02, 0.05, color, -0.05, h + 0.02, 0, [0, 0, 0.35]);
  k.cbox(0.1, 0.02, 0.05, color, 0.05, h + 0.02, 0, [0, 0, -0.35]);
}

function leafAt(k, x, y, z, ry, len = 0.16, w = 0.07, color = LEAF, tilt = 0.35) {
  k.cbox(w, 0.02, len, color, x, y, z, [tilt, ry, 0]);
}

function bush(k, r, h, colorA = LEAF, colorB = LEAF_DARK) {
  k.cbox(r * 2, h, r * 2, colorB, 0, 0.04 + h / 2, 0);
  k.cbox(r * 1.6, h * 0.6, r * 2.2, colorA, 0, 0.04 + h * 0.75, 0);
  k.cbox(r * 2.2, h * 0.5, r * 1.5, colorA, 0, 0.04 + h * 0.55, 0);
  k.cbox(r * 1.2, h * 0.35, r * 1.2, LEAF_LIGHT, 0, 0.04 + h * 1.05, 0);
}

const STAGES = {
  rose: [
    (k, c) => { mound(k, true); seedsOnTop(k); sign(k, c.color); },
    (k, c) => { mound(k); sprout(k, 0.16); sign(k, c.color); },
    (k, c) => {
      mound(k);
      k.cbox(0.035, 0.38, 0.035, STEM, 0, 0.23, 0);
      leafAt(k, -0.07, 0.2, 0, 1.57); leafAt(k, 0.07, 0.3, 0.02, -1.4); leafAt(k, 0, 0.14, 0.07, 0.2);
      k.cbox(0.09, 0.1, 0.09, LEAF_DARK, 0, 0.45, 0);
      k.cbox(0.06, 0.05, 0.06, c.color, 0, 0.52, 0);
      sign(k, c.color);
    },
    (k, c) => {
      mound(k);
      k.cbox(0.035, 0.46, 0.035, STEM, 0, 0.27, 0);
      k.cbox(0.03, 0.26, 0.03, STEM, -0.08, 0.2, 0.02, [0, 0, 0.35]);
      k.cbox(0.03, 0.24, 0.03, STEM, 0.08, 0.18, -0.03, [0, 0, -0.35]);
      leafAt(k, -0.08, 0.16, 0.02, 1.57); leafAt(k, 0.09, 0.24, 0.0, -1.4); leafAt(k, 0, 0.3, 0.08, 0.2); leafAt(k, 0.02, 0.12, -0.08, 3.0);
      const bloom = (x, y, z, s) => {
        k.cbox(0.2 * s, 0.1 * s, 0.2 * s, '#E24C78', x, y, z);
        k.cbox(0.17 * s, 0.14 * s, 0.17 * s, c.color, x, y + 0.03 * s, z, [0, 0.4, 0]);
        k.cbox(0.11 * s, 0.1 * s, 0.11 * s, '#FF9DBA', x, y + 0.08 * s, z);
        k.cbox(0.05 * s, 0.05 * s, 0.05 * s, '#E24C78', x, y + 0.12 * s, z, [0, 0.8, 0]);
      };
      bloom(0, 0.56, 0, 1.15);
      bloom(-0.15, 0.36, 0.04, 0.8);
      bloom(0.15, 0.32, -0.05, 0.75);
    },
  ],
  tulip: [
    (k, c) => { mound(k, true); seedsOnTop(k); sign(k, c.color); },
    (k, c) => { mound(k); k.cbox(0.05, 0.16, 0.05, LEAF, -0.03, 0.12, 0, [0, 0, 0.2]); k.cbox(0.05, 0.14, 0.05, LEAF_DARK, 0.03, 0.11, 0, [0, 0, -0.2]); sign(k, c.color); },
    (k, c) => {
      mound(k);
      k.cbox(0.035, 0.36, 0.035, STEM, 0, 0.22, 0);
      k.cbox(0.06, 0.3, 0.03, LEAF, -0.07, 0.18, 0, [0, 0, 0.3]);
      k.cbox(0.06, 0.28, 0.03, LEAF_DARK, 0.07, 0.17, 0, [0, 0, -0.3]);
      k.cbox(0.08, 0.1, 0.08, LEAF_DARK, 0, 0.43, 0);
      k.cbox(0.06, 0.05, 0.06, c.color, 0, 0.49, 0);
      sign(k, c.color);
    },
    (k, c) => {
      mound(k);
      const one = (x, z, h, col) => {
        k.cbox(0.035, h, 0.035, STEM, x, 0.04 + h / 2, z);
        k.cbox(0.15, 0.15, 0.15, col, x, h + 0.1, z);
        k.cbox(0.06, 0.07, 0.155, '#FFFFFF', x - 0.045, h + 0.19, z);
        k.cbox(0.06, 0.07, 0.155, col, x + 0.045, h + 0.19, z);
        k.cbox(0.155, 0.07, 0.06, col, x, h + 0.19, z + 0.045);
        k.cbox(0.1, 0.03, 0.1, '#FFE27A', x, h + 0.18, z);
      };
      one(0, 0, 0.44, c.color);
      one(-0.14, 0.08, 0.3, '#FF8CC6');
      one(0.14, -0.06, 0.34, '#FFE27A');
      k.cbox(0.07, 0.34, 0.03, LEAF, -0.08, 0.2, -0.06, [0, 0.4, 0.3]);
      k.cbox(0.07, 0.3, 0.03, LEAF_DARK, 0.09, 0.18, 0.07, [0, 0.4, -0.3]);
    },
  ],
  sunflower: [
    (k, c) => { mound(k, true); seedsOnTop(k); sign(k, c.color); },
    (k, c) => { mound(k); sprout(k, 0.22, LEAF); sign(k, c.color); },
    (k, c) => {
      mound(k);
      k.cbox(0.06, 0.84, 0.06, STEM, 0, 0.46, 0);
      leafAt(k, -0.12, 0.3, 0, 1.57, 0.24, 0.14); leafAt(k, 0.12, 0.5, 0.02, -1.57, 0.24, 0.14); leafAt(k, 0, 0.68, 0.12, 0.1, 0.2, 0.12);
      k.cbox(0.16, 0.12, 0.16, LEAF_DARK, 0, 0.9, 0);
      for (let i = 0; i < 4; i++) k.cbox(0.05, 0.06, 0.02, c.color, Math.cos(i * 1.57) * 0.09, 0.93, Math.sin(i * 1.57) * 0.09, [0, -i * 1.57, 0]);
      sign(k, c.color);
    },
    (k, c) => {
      mound(k);
      k.cbox(0.07, 1.2, 0.07, STEM, 0, 0.64, 0);
      leafAt(k, -0.14, 0.34, 0, 1.57, 0.28, 0.16); leafAt(k, 0.14, 0.58, 0.02, -1.57, 0.28, 0.16); leafAt(k, 0, 0.82, -0.14, 3.1, 0.24, 0.14);
      // the flower head faces +Z, tilted a little down
      const hy = 1.3, hz = 0.08, tilt = [-0.25, 0, 0];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        k.cbox(0.1, 0.16, 0.03, i % 2 ? c.color : '#FFC21F', Math.cos(a) * 0.2, hy + Math.sin(a) * 0.2, hz - 0.01, [tilt[0], 0, a + Math.PI / 2]);
      }
      k.cbox(0.3, 0.3, 0.06, '#8A5A3C', 0, hy, hz, tilt);
      k.cbox(0.22, 0.22, 0.065, '#6E4530', 0, hy, hz + 0.004, tilt);
      // a happy little face
      k.cbox(0.035, 0.05, 0.02, '#2A1B33', -0.06, hy + 0.04, hz + 0.045, tilt);
      k.cbox(0.035, 0.05, 0.02, '#2A1B33', 0.06, hy + 0.04, hz + 0.045, tilt);
      k.cbox(0.08, 0.02, 0.02, '#2A1B33', 0, hy - 0.05, hz + 0.02, tilt);
      k.cbox(0.03, 0.02, 0.02, '#2A1B33', -0.05, hy - 0.035, hz + 0.024, tilt);
      k.cbox(0.03, 0.02, 0.02, '#2A1B33', 0.05, hy - 0.035, hz + 0.024, tilt);
      k.cbox(0.05, 0.025, 0.02, '#FF8CB0', -0.1, hy - 0.02, hz + 0.028, tilt);
      k.cbox(0.05, 0.025, 0.02, '#FF8CB0', 0.1, hy - 0.02, hz + 0.028, tilt);
    },
  ],
  carrot: [
    (k, c) => { mound(k, true); seedsOnTop(k); sign(k, c.color); },
    (k, c) => { mound(k); sprout(k, 0.12, LEAF_LIGHT); sign(k, c.color); },
    (k, c) => {
      mound(k);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.cbox(0.04, 0.26, 0.04, i % 2 ? LEAF : LEAF_LIGHT, Math.cos(a) * 0.04, 0.17, Math.sin(a) * 0.04, [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]);
      }
      k.cbox(0.08, 0.04, 0.08, c.color, 0, 0.05, 0);
      sign(k, c.color);
    },
    (k, c) => {
      mound(k);
      k.cbox(0.16, 0.1, 0.16, c.color, 0, 0.07, 0);
      k.cbox(0.12, 0.03, 0.12, '#FFB36B', 0, 0.12, 0);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        k.cbox(0.05, 0.36, 0.05, i % 2 ? LEAF : LEAF_LIGHT, Math.cos(a) * 0.06, 0.3, Math.sin(a) * 0.06, [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4]);
        k.cbox(0.12, 0.04, 0.08, LEAF_LIGHT, Math.cos(a) * 0.17, 0.46, Math.sin(a) * 0.17, [0, -a, 0]);
      }
    },
  ],
  strawberry: [
    (k, c) => { mound(k, true); seedsOnTop(k); sign(k, c.color); },
    (k, c) => { mound(k); sprout(k, 0.12); sign(k, c.color); },
    (k, c) => {
      mound(k);
      bush(k, 0.14, 0.22);
      for (const [x, z] of [[-0.1, 0.12], [0.12, 0.06], [0.0, -0.13]]) {
        k.cbox(0.07, 0.03, 0.07, '#FFFFFF', x, 0.3, z);
        k.cbox(0.03, 0.035, 0.03, '#FFE27A', x, 0.31, z);
      }
      sign(k, c.color);
    },
    (k, c) => {
      mound(k);
      bush(k, 0.18, 0.26);
      for (const [x, y, z] of [[-0.2, 0.14, 0.12], [0.2, 0.18, 0.05], [0.04, 0.12, 0.21], [-0.1, 0.2, -0.2], [0.14, 0.13, -0.17]]) {
        k.ball(0.055, c.color, x, y, z, 10, [1, 1.15, 1]);
        k.cbox(0.06, 0.02, 0.06, LEAF_DARK, x, y + 0.06, z, [0, 0.5, 0]);
        k.cbox(0.012, 0.012, 0.012, '#FFE27A', x + 0.03, y + 0.01, z + 0.045);
        k.cbox(0.012, 0.012, 0.012, '#FFE27A', x - 0.03, y - 0.02, z + 0.045);
      }
      k.cbox(0.07, 0.03, 0.07, '#FFFFFF', 0.02, 0.37, 0.0);
      k.cbox(0.03, 0.035, 0.03, '#FFE27A', 0.02, 0.38, 0.0);
    },
  ],
  pumpkin: [
    (k, c) => { mound(k, true); seedsOnTop(k); sign(k, c.color); },
    (k, c) => { mound(k); sprout(k, 0.12); sign(k, c.color); },
    (k, c) => {
      mound(k);
      k.cbox(0.3, 0.03, 0.035, STEM, 0.05, 0.06, 0.05, [0, 0.5, 0]);
      for (const [x, z, r] of [[-0.12, 0.05, 0.3], [0.14, -0.08, 1.9], [0.0, 0.16, 1.0], [0.18, 0.14, 2.6]]) leafAt(k, x, 0.1, z, r, 0.2, 0.16, LEAF, 0.2);
      k.ball(0.08, '#9ACD5A', -0.06, 0.1, -0.1, 10, [1.1, 0.9, 1.1]);
      sign(k, c.color);
    },
    (k, c) => {
      mound(k);
      for (const [x, z, r] of [[-0.3, 0.2, 0.3], [0.3, -0.25, 1.9], [0.28, 0.28, 2.6], [-0.26, -0.26, 4.2]]) leafAt(k, x, 0.08, z, r, 0.22, 0.18, LEAF, 0.15);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.ball(0.15, i % 2 ? c.color : '#FFAE4A', Math.cos(a) * 0.12, 0.17, Math.sin(a) * 0.12, 12, [0.8, 1, 0.8]);
      }
      k.ball(0.19, '#FFA43B', 0, 0.17, 0, 14, [1, 0.85, 1]);
      k.cyl(0.03, 0.1, '#6E8B3D', 0, 0.3, 0, 8, [0, 0, 0.25]);
      k.cbox(0.2, 0.025, 0.025, STEM, 0.1, 0.36, 0.0, [0, 0.4, 0.5]);
    },
  ],
  watermelon: [
    (k, c) => { mound(k, true); seedsOnTop(k); sign(k, c.color); },
    (k, c) => { mound(k); sprout(k, 0.12); sign(k, c.color); },
    (k, c) => {
      mound(k);
      k.cbox(0.34, 0.03, 0.035, STEM, 0.04, 0.06, 0.02, [0, -0.4, 0]);
      for (const [x, z, r] of [[-0.14, 0.06, 0.3], [0.15, -0.07, 1.9], [0.02, 0.17, 1.0]]) leafAt(k, x, 0.1, z, r, 0.2, 0.16, LEAF_DARK, 0.2);
      k.ball(0.09, '#5DBB63', 0.08, 0.1, 0.12, 10, [1.3, 0.9, 1]);
      sign(k, c.color);
    },
    (k, c) => {
      mound(k);
      for (const [x, z, r] of [[-0.3, 0.26, 0.3], [0.32, -0.26, 1.9], [-0.28, -0.28, 4.2]]) leafAt(k, x, 0.08, z, r, 0.22, 0.18, LEAF_DARK, 0.15);
      k.ball(0.22, '#4FA557', 0, 0.2, 0, 16, [1.35, 0.9, 1]);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.ball(0.1, '#2E7D3A', Math.cos(a) * 0.235, 0.2, Math.sin(a) * 0.16, 8, [0.35, 1.55, 0.35]);
      }
      k.cbox(0.04, 0.05, 0.04, '#6E8B3D', 0.0, 0.4, 0);
      k.cbox(0.22, 0.025, 0.025, STEM, 0.12, 0.4, 0.0, [0, 0.3, 0.3]);
    },
  ],
  blueberry: [
    (k, c) => { mound(k, true); seedsOnTop(k); sign(k, c.color); },
    (k, c) => { mound(k); sprout(k, 0.14, LEAF_DARK); sign(k, c.color); },
    (k, c) => { mound(k); bush(k, 0.14, 0.26, LEAF_DARK, '#3F8F4A'); sign(k, c.color); },
    (k, c) => {
      mound(k);
      bush(k, 0.2, 0.34, LEAF_DARK, '#3F8F4A');
      const clusters = [[-0.2, 0.26, 0.12], [0.21, 0.22, 0.08], [0.03, 0.34, 0.2], [-0.12, 0.38, -0.18], [0.16, 0.3, -0.18], [0.0, 0.46, 0.0]];
      for (const [x, y, z] of clusters) {
        for (const [ox, oy, oz] of [[0, 0, 0], [0.045, -0.03, 0.02], [-0.04, -0.035, 0.02]]) {
          k.ball(0.035, c.color, x + ox, y + oy, z + oz, 8);
          k.cbox(0.018, 0.01, 0.018, '#3A3F9E', x + ox, y + oy + 0.034, z + oz);
        }
      }
    },
  ],
};

/** Shared geometry for a crop at a stage. */
export function stageGeometry(crop, stage) {
  const c = CROPS[crop];
  return baked(`plant:${crop}:${stage}`, (k) => STAGES[crop][stage](k, c));
}

/** A mesh (shared geometry) for a crop at a stage. */
export function plantMesh(crop, stage) {
  return new THREE.Mesh(stageGeometry(crop, stage), VC_MAT);
}

/** Thumbnail object: the ready plant on a little block of farmland. */
export function plantThumbObject(crop, stage = 3) {
  const g = new THREE.Group();
  const k = new Kit();
  k.cbox(1, 0.3, 1, '#9A6A45', 0, -0.15, 0);
  k.cbox(1, 0.02, 1, '#7A5236', 0, 0.0, 0);
  const soil = k.mesh();
  g.add(soil);
  g.add(plantMesh(crop, stage));
  return g;
}

// ---------- watering can ----------

export function wateringCanObject() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(baked('tool:can', (k) => {
    const blue = '#8FD3FF', dark = '#6CB4F0';
    k.cyl(0.17, 0.3, blue, 0, 0, 0, 16);
    k.cyl(0.175, 0.03, dark, 0, 0.0, 0, 16);
    k.cyl(0.175, 0.03, dark, 0, 0.28, 0, 16);
    k.cyl(0.12, 0.03, '#E4F4FF', 0, 0.3, 0, 14);
    // spout
    k.cbox(0.05, 0.05, 0.34, blue, 0, 0.2, 0.28, [0.75, 0, 0]);
    k.cyl(0.05, 0.05, dark, 0, 0.36, 0.42, 10, [0.9, 0, 0]);
    // handle
    k.cbox(0.04, 0.04, 0.26, dark, 0, 0.42, -0.06);
    k.cbox(0.04, 0.16, 0.04, dark, 0, 0.35, -0.19);
    k.cbox(0.04, 0.12, 0.04, dark, 0, 0.36, 0.07);
    // a flower sticker on the side
    k.cbox(0.012, 0.08, 0.08, '#FF8CC6', 0.172, 0.15, 0, [0.785, 0, 0]);
    k.cbox(0.014, 0.1, 0.03, '#FF8CC6', 0.172, 0.15, 0);
    k.cbox(0.014, 0.03, 0.1, '#FF8CC6', 0.172, 0.15, 0);
    k.cbox(0.016, 0.035, 0.035, '#FFE27A', 0.174, 0.15, 0);
  }), VC_MAT));
  return g;
}
