// Garden & fun models: swing, slide, trampoline, bench, mailbox, well, fountain, pool float,
// picnic blanket, bird house, flower box, easel, dollhouse, teddy bear, balloons.

import * as THREE from 'three';
import { Kit } from './kit.js';
import { woodMat, quiltMat, stoneMat, waterMat, streamMat, stripeMat, fabricMat, glow, sheer, material, paintTexture } from './paint.js';
import { C, SW, heart, flower, knob, HEART_ROWS, STAR_ROWS, FLOWER_ROWS } from './palette.js';
import { shade, mixHex } from '../../core/util.js';

const BALLOONS = ['#FF9CCB', '#A6D8FF', '#FFE38F', '#9BE8CF', '#C8B4FF', '#FFBFA0'];

/** A-frame swing; the seat (part 'seat', pivot at the beam) really swings. */
export const SWING_PIVOT = [1.0, 1.92, 0.5];
export const SWING_ROPE = 1.4;

export function swing(color = SW.bright[0]) {
  const k = new Kit();
  const wood = woodMat(mixHex(color, '#FFFFFF', 0.5));
  const a = Math.atan2(0.42, 1.95);
  for (const x of [0.1, 1.9]) {
    k.box(0.1, 2.0, 0.1, wood, x - 0.05, 0, 0.03, { rot: [a, 0, 0], pivot: [x, 0, 0.08] });
    k.box(0.1, 2.0, 0.1, wood, x - 0.05, 0, 0.87, { rot: [-a, 0, 0], pivot: [x, 0, 0.92] });
    k.box(0.08, 0.06, 0.6, wood, x - 0.04, 0.6, 0.2);
  }
  k.box(2.0, 0.1, 0.12, wood, 0, 1.9, 0.44);
  for (let i = 0; i < 5; i++) flower(k, 0.12, BALLOONS[i], 0.2 + i * 0.36, 1.86, 0.57, '#FFF4B8', 0.02);
  const s = k.part('seat', ...SWING_PIVOT);
  const L = SWING_ROPE;
  for (const x of [-0.3, 0.3]) {
    s.box(0.025, L, 0.025, '#FFF1D6', x - 0.0125, -L, -0.0125);
    s.box(0.06, 0.05, 0.06, shade(color, -0.1), x - 0.03, -L * 0.45, -0.03);
  }
  s.box(0.76, 0.06, 0.34, woodMat(color), -0.38, -L - 0.06, -0.17);
  s.pixels(['.X.X.', 'XXXXX', '.XOX.', 'XXXXX', '.X.X.'], 0.04, { X: '#FFFFFF', O: C.butter }, -0.1, -L - 0.03, 0.12, { plane: 'xz', depth: 0.01 });
  k.hitbox(0, 0, 0, 2, 2, 1);
  return k.build();
}

/** Slide: ladder at the back, platform, a long chute down to the front. */
export const SLIDE_TOP = [0.5, 1.46, 0.72];
export const SLIDE_END = [0.5, 0.26, 2.85];

export function slide(color = SW.bright[0]) {
  const k = new Kit();
  const frame = '#FFFFFF';
  // ladder
  for (const x of [0.08, 0.84]) k.box(0.08, 1.85, 0.08, frame, x, 0, 0.08);
  for (let y = 0.3; y < 1.4; y += 0.3) k.box(0.7, 0.05, 0.06, shade(color, 0.3), 0.15, y, 0.09);
  // platform with rails and a little flag
  k.box(0.92, 0.08, 0.72, woodMat(C.wood), 0.04, 1.35, 0.1);
  for (const x of [0.04, 0.88]) {
    k.box(0.08, 0.5, 0.08, frame, x, 1.35, 0.72);
    k.box(0.06, 0.06, 0.66, color, x + 0.01, 1.72, 0.14);
  }
  k.box(0.05, 1.4, 0.05, frame, 0.86, 0, 0.74);
  k.box(0.05, 1.4, 0.05, frame, 0.09, 0, 0.74);
  k.box(0.03, 0.5, 0.03, frame, 0.1, 1.85, 0.1);
  k.pixels(['XX..', 'XXXX', 'XXXX', 'XX..'], 0.06, { X: C.rose }, 0.13, 2.05, 0.1, { depth: 0.02 });
  // chute
  const dz = SLIDE_END[2] - 0.8, dy = 1.4 - 0.2;
  const len = Math.hypot(dz, dy) + 0.05;
  const ang = Math.atan2(dy, dz);
  const pv = [0.5, 1.4, 0.8];
  k.box(0.72, 0.05, len, material(`slide|${color}`, { color, emissive: color, emissiveIntensity: 0.08 }), 0.14, 1.35, 0.8, { rot: [ang, 0, 0], pivot: pv });
  for (const x of [0.1, 0.84]) k.box(0.06, 0.16, len, shade(color, -0.1), x, 1.35, 0.8, { rot: [ang, 0, 0], pivot: pv });
  k.box(0.72, 0.05, 0.25, color, 0.14, 0.15, 2.75);
  for (const x of [0.1, 0.84]) k.box(0.06, 0.12, 0.25, shade(color, -0.1), x, 0.15, 2.75);
  k.box(0.08, 0.72, 0.08, frame, 0.46, 0, 1.75);
  k.pixels(STAR_ROWS, 0.03, { X: C.butter }, 0.87, 0.92, 1.4, { depth: 0.03 });
  return k.build();
}

/** Round trampoline with a candy-striped pad. */
export function trampoline(color = SW.bright[0]) {
  const k = new Kit();
  const R = 0.9;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = 1 + Math.cos(a) * 0.8, z = 1 + Math.sin(a) * 0.8;
    k.box(0.06, 0.4, 0.06, '#FFFFFF', x - 0.03, 0, z - 0.03);
    k.box(0.14, 0.03, 0.14, shade(color, -0.2), x - 0.07, 0, z - 0.07);
  }
  k.torus(R - 0.02, 0.035, '#FFFFFF', 1, 0.4, 1);
  k.cyl(0.74, 0.02, '#6E5A9E', 1, 0.39, 1, 28);
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cx = 1 + Math.cos(a) * 0.83, cz = 1 + Math.sin(a) * 0.83;
    k.box(0.24, 0.05, 0.2, i % 2 ? color : '#FFFFFF', cx - 0.12, 0.4, cz - 0.1, { rot: [0, -a - Math.PI / 2, 0] });
  }
  k.pixels(STAR_ROWS, 0.08, { X: C.butter }, 0.72, 0.405, 0.72, { plane: 'xz', depth: 0.012 });
  k.pixels(HEART_ROWS, 0.04, { X: C.pink }, 1.25, 0.405, 0.4, { plane: 'xz', depth: 0.012 });
  return k.build();
}

export function bench(color = SW.bright[2]) {
  const k = new Kit();
  const iron = '#FFFFFF';
  const wood = woodMat(color);
  for (const x of [0.1, 1.84]) {
    k.box(0.06, 0.44, 0.06, iron, x, 0, 0.26);
    k.box(0.06, 0.44, 0.06, iron, x, 0, 0.82);
    k.box(0.06, 0.06, 0.62, iron, x, 0.58, 0.26);
    k.box(0.06, 0.2, 0.06, iron, x, 0.44, 0.82);
    k.ball(0.05, iron, x + 0.03, 0.62, 0.86);
    k.box(0.06, 0.62, 0.06, iron, x, 0.44, 0.2, { rot: [-0.12, 0, 0], pivot: [x, 0.44, 0.23] });
  }
  for (let i = 0; i < 4; i++) k.box(1.84, 0.05, 0.13, wood, 0.08, 0.42, 0.3 + i * 0.15);
  for (let i = 0; i < 3; i++) k.box(1.84, 0.1, 0.04, wood, 0.08, 0.6 + i * 0.14, 0.2 - i * 0.017, { rot: [-0.12, 0, 0], pivot: [1, 0.6 + i * 0.14, 0.2] });
  heart(k, 0.2, C.rose, 0.9, 0.72, 0.2, 0.04);
  return k.build();
}

/** Mailbox; the flag (part 'flag') is up while a letter waits (data.mail !== false). */
export function mailbox(color = SW.bright[0], data = {}) {
  const k = new Kit();
  const mail = data.mail !== false;
  k.box(0.26, 0.04, 0.26, C.woodDark, 0.37, 0, 0.37);
  k.box(0.1, 0.56, 0.1, woodMat(C.wood), 0.45, 0, 0.45);
  k.box(0.34, 0.22, 0.52, color, 0.33, 0.55, 0.24);
  k.cyl(0.17, 0.52, color, 0.5, 0.77, 0.24, 14, { rot: [Math.PI / 2, 0, 0] });
  k.box(0.3, 0.3, 0.02, shade(color, 0.25), 0.35, 0.57, 0.76);
  heart(k, 0.12, '#FFFFFF', 0.44, 0.68, 0.78, 0.01);
  knob(k, 0.5, 0.62, 0.78, C.gold);
  if (mail) {
    k.box(0.22, 0.03, 0.14, '#FFFFFF', 0.39, 0.84, 0.72, { rot: [0.3, 0, 0] });
    k.pixels(['X.X', 'XXX', '.X.'], 0.02, { X: C.rose }, 0.47, 0.84, 0.8, { plane: 'xz', depth: 0.01 });
  }
  const f = k.part('flag', 0.68, 0.64, 0.42, { rot: [mail ? 0 : Math.PI / 2, 0, 0] });
  f.box(0.03, 0.34, 0.03, '#FFFFFF', 0, 0, 0);
  f.box(0.02, 0.1, 0.14, C.rose, 0.005, 0.24, 0.03);
  return k.build();
}

function ringOfStones(k, cx, cz, r, h, n, mat, y = 0, thick = 0.2) {
  const seg = (2 * Math.PI * r) / n + 0.04;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    k.box(seg, h, thick, mat, x - seg / 2, y, z - thick / 2, { rot: [0, -a - Math.PI / 2, 0] });
  }
}

/** Wishing well with a little roof and a bucket (part 'bucket'). */
export function well(color = SW.bright[0]) {
  const k = new Kit();
  ringOfStones(k, 1, 1, 0.72, 0.62, 14, stoneMat('#DCD4EE'));
  ringOfStones(k, 1, 1, 0.72, 0.08, 14, shade('#DCD4EE', 0.3), 0.62, 0.26);
  k.cyl(0.64, 0.02, '#4A6FA0', 1, 0.2, 1, 20);
  k.cyl(0.62, 0.02, waterMat(), 1, 0.45, 1, 20);
  const wood = woodMat(C.wood);
  for (const x of [0.2, 1.72]) k.box(0.08, 1.2, 0.08, wood, x, 0.62, 0.96);
  k.cyl(0.04, 1.6, C.woodDark, 0.2, 1.46, 1, 8, { rot: [0, 0, -Math.PI / 2] });
  k.box(0.04, 0.2, 0.04, C.woodDark, 1.82, 1.38, 0.98);
  const roof = stripeMat(color, shade(color, 0.35));
  const th = Math.atan2(0.4, 0.8);
  k.box(2.1, 0.06, 0.9, roof, -0.05, 1.86, 1.0, { rot: [th, 0, 0], pivot: [1, 1.9, 1.0] });
  k.box(2.1, 0.06, 0.9, roof, -0.05, 1.86, 0.1, { rot: [-th, 0, 0], pivot: [1, 1.9, 1.0] });
  k.box(2.16, 0.08, 0.1, shade(color, -0.1), -0.08, 1.88, 0.95);
  for (let i = 0; i < 10; i++) {
    const x = -0.03 + i * 0.21;
    const z0 = 1.0 + Math.cos(th) * 0.9, y0 = 1.9 - Math.sin(th) * 0.9;
    k.box(0.16, 0.08, 0.04, '#FFFFFF', x, y0 - 0.1, z0 - 0.02);
    k.box(0.16, 0.08, 0.04, '#FFFFFF', x, y0 - 0.1, 1.0 - Math.cos(th) * 0.9 - 0.02);
  }
  heart(k, 0.2, C.rose, 0.9, 1.72, 1.02, 0.03);
  const b = k.part('bucket', 1.0, 1.44, 1.0);
  b.box(0.015, 0.5, 0.015, '#FFF1D6', -0.0075, -0.5, -0.0075);
  b.cone(0.1, 0.13, 0.16, C.woodDark, 0, -0.66, 0, 10);
  b.torus(0.12, 0.012, C.gold, 0, -0.55, 0);
  b.cyl(0.11, 0.01, waterMat(), 0, -0.52, 0, 10);
  return k.build();
}

/** Tiered fountain with running water. */
export function fountain(color = '#E6E0F5') {
  const k = new Kit();
  const stone = stoneMat(color);
  k.cyl(0.84, 0.06, stone, 1, 0, 1, 24);
  ringOfStones(k, 1, 1, 0.86, 0.3, 16, stone, 0, 0.18);
  ringOfStones(k, 1, 1, 0.86, 0.05, 16, shade(color, 0.3), 0.3, 0.24);
  k.cyl(0.78, 0.02, waterMat(), 1, 0.22, 1, 24);
  k.cyl(0.1, 0.55, '#FFFFFF', 1, 0, 1, 10);
  k.cone(0.12, 0.34, 0.1, '#FFFFFF', 1, 0.5, 1, 16);
  k.torus(0.34, 0.025, shade(color, 0.3), 1, 0.6, 1);
  k.cyl(0.31, 0.015, waterMat(), 1, 0.58, 1, 16);
  k.cyl(0.04, 0.16, '#FFFFFF', 1, 0.6, 1, 8);
  heart(k, 0.18, C.rose, 0.91, 0.76, 0.98, 0.04);
  const stream = streamMat();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.cyl(0.02, 0.38, stream, 1 + Math.cos(a) * 0.35, 0.22, 1 + Math.sin(a) * 0.35, 5);
  }
  for (const [x, z] of [[0.45, 0.7], [1.5, 1.45], [1.4, 0.5]]) {
    k.cyl(0.09, 0.01, C.leaf, x, 0.235, z, 10);
    flower(k, 0.08, '#FFB8D6', x - 0.04, 0.25, z, C.butter, 0.02);
  }
  return k.build();
}

/** Donut pool float (sprinkles!); floats at the water line when placed in water. */
export function poolFloat(color = SW.bright[0], data = {}) {
  const k = new Kit();
  const y = data.water ? 0.8 : 0.13;
  const f = k.part('float', 0.5, y, 0.5);
  f.torus(0.3, 0.13, '#FFE0B0', 0, 0, 0);
  f.torus(0.3, 0.115, color, 0, 0.035, 0);
  const sprinkles = ['#FFFFFF', '#FFE38F', '#A6D8FF', '#9BE8CF', '#C8B4FF'];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 0.27 + (i % 3) * 0.03;
    f.box(0.05, 0.015, 0.015, sprinkles[i % 5], Math.cos(a) * r - 0.025, 0.14, Math.sin(a) * r, { rot: [0, a * 2.3, 0] });
  }
  return k.build();
}

/** Gingham picnic blanket with a basket and treats (flat). */
export function picnicBlanket(color = SW.bedding[0]) {
  const k = new Kit();
  k.box(1.9, 0.02, 1.9, quiltMat(color, 'gingham'), 0.05, 0, 0.05);
  const wicker = stripeMat('#E0B070', '#C99555');
  k.box(0.44, 0.24, 0.32, wicker, 0.16, 0.02, 0.18);
  k.box(0.46, 0.04, 0.34, '#C99555', 0.15, 0.26, 0.17);
  k.box(0.4, 0.03, 0.14, quiltMat(color, 'gingham'), 0.18, 0.29, 0.2);
  k.box(0.04, 0.2, 0.04, '#C99555', 0.18, 0.29, 0.32);
  k.box(0.04, 0.2, 0.04, '#C99555', 0.54, 0.29, 0.32);
  k.box(0.4, 0.04, 0.04, '#C99555', 0.18, 0.47, 0.32);
  for (const [x, z] of [[0.95, 0.5], [1.45, 0.9]]) {
    k.cyl(0.16, 0.02, '#FFFFFF', x, 0.02, z, 14);
    k.cyl(0.12, 0.004, shade(color, 0.5), x, 0.04, z, 14);
  }
  k.box(0.16, 0.03, 0.16, '#FFE9B0', 0.87, 0.04, 0.42);
  k.box(0.16, 0.02, 0.16, '#9BE38A', 0.87, 0.07, 0.42);
  k.box(0.16, 0.03, 0.16, '#FFE9B0', 0.87, 0.09, 0.42);
  for (const [x, z] of [[1.4, 0.86], [1.5, 0.92], [1.44, 0.97]]) k.ball(0.04, '#FF4F6F', x, 0.08, z);
  k.cyl(0.05, 0.2, sheer('#FFB870', 0.8), 1.7, 0.02, 0.4, 8);
  k.cyl(0.03, 0.05, '#FFFFFF', 1.7, 0.22, 0.4, 8);
  return k.build();
}

/** Bird house on a post with a little bird (part 'bird') on the perch. */
export function birdHouse(color = SW.bright[1]) {
  const k = new Kit();
  k.box(0.24, 0.05, 0.24, C.woodDark, 0.38, 0, 0.38);
  k.box(0.1, 1.12, 0.1, woodMat(C.wood), 0.45, 0, 0.45);
  k.box(0.42, 0.4, 0.42, woodMat(color), 0.29, 1.1, 0.29);
  // gable roof with its ridge running front to back, so the front shows a little triangle
  const th = Math.PI / 4;
  const roof = stripeMat(C.rose, shade(C.rose, 0.35));
  const pv = [0.5, 1.77, 0.5];
  k.box(0.38, 0.05, 0.6, roof, 0.12, 1.75, 0.2, { rot: [0, 0, th], pivot: pv });
  k.box(0.38, 0.05, 0.6, roof, 0.5, 1.75, 0.2, { rot: [0, 0, -th], pivot: pv });
  k.pixels(['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX'], 0.06, { X: woodMat(color) }, 0.29, 1.5, 0.29, { depth: 0.42 });
  k.ball(0.04, C.gold, 0.5, 1.82, 0.5);
  k.cyl(0.07, 0.02, '#4A3A5A', 0.5, 1.33, 0.71, 12, { rot: [Math.PI / 2, 0, 0] });
  k.cyl(0.012, 0.12, C.woodDark, 0.5, 1.22, 0.71, 6, { rot: [Math.PI / 2, 0, 0] });
  flower(k, 0.1, '#FFFFFF', 0.33, 1.16, 0.71, C.butter, 0.02);
  const b = k.part('bird', 0.5, 1.23, 0.82);
  b.ball(0.055, '#8FD0FF', 0, 0.05, 0, { sz: 1.3 });
  b.ball(0.04, '#8FD0FF', 0, 0.11, 0.04);
  b.box(0.03, 0.02, 0.04, '#FFB84F', -0.015, 0.1, 0.07);
  b.box(0.012, 0.012, 0.01, C.ink, -0.03, 0.12, 0.07);
  b.box(0.012, 0.012, 0.01, C.ink, 0.018, 0.12, 0.07);
  b.box(0.02, 0.05, 0.08, '#6CB8F0', -0.065, 0.03, -0.04);
  b.box(0.02, 0.05, 0.08, '#6CB8F0', 0.045, 0.03, -0.04);
  b.box(0.04, 0.02, 0.06, '#FFB8D6', -0.02, 0.0, 0.03);
  return k.build();
}

/** Flower box for walls and windows. */
export function flowerBox(color = SW.wood[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(0.92, 0.24, 0.32, wood, 0.04, 0.08, 0.02);
  k.box(0.96, 0.04, 0.36, shade(color, 0.12), 0.02, 0.3, 0.0);
  k.box(0.1, 0.1, 0.06, shade(color, -0.2), 0.1, 0.0, 0.02);
  k.box(0.1, 0.1, 0.06, shade(color, -0.2), 0.8, 0.0, 0.02);
  k.box(0.86, 0.02, 0.26, C.soil, 0.07, 0.3, 0.05);
  const petals = ['#FF8FB8', '#FFE38F', '#C8A6FF', '#FFFFFF', '#FF9E8F', '#8FD0FF'];
  for (let i = 0; i < 6; i++) {
    const x = 0.14 + i * 0.14;
    const h = 0.16 + ((i * 7) % 3) * 0.07;
    k.box(0.02, h, 0.02, C.leafDark, x, 0.32, 0.18);
    k.box(0.08, 0.03, 0.02, C.leaf, x - 0.03, 0.32 + h * 0.4, 0.18, { rot: [0, 0, 0.5] });
    flower(k, 0.12, petals[i], x - 0.05, 0.3 + h, 0.16, C.butter, 0.03);
  }
  heart(k, 0.12, C.rose, 0.44, 0.14, 0.34, 0.01);
  return k.build();
}

/** Pixel painting (16x16 palette indices) as a per-entity material. */
export const EASEL_COLORS = ['#FFFFFF', '#FF5FA2', '#FF9CCB', '#FF6B6B', '#FFA94D', '#FFD43B', '#A9E34B', '#3FD8B0', '#6CC6FF', '#4D7CFE', '#9C7BFF', '#8A5A3C', '#3A1F4D', '#FFE3F0', '#B8F0DC', '#E6DDFF'];
export const DEFAULT_PIC = (() => {
  const rows = [
    'dddddddddddddddd', 'dddddd5555dddddd', 'dddd5d5555d5dddd', 'ddddd555555ddddd', 'ddd5555555555ddd',
    'ddddd555555ddddd', 'dddd5d5555d5dddd', 'dddddd5555dddddd', 'dddddddddddddddd', 'dd11d11ddddd22dd',
    'd1111111ddd2222d', 'd1111111dd222222', 'dd11111ddddd66dd', 'ddd111dddddd66dd', '6666166666666666', '6666666666666666',
  ];
  return rows.join('');
})();

export function picTexture(pic) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const s = typeof pic === 'string' && pic.length >= 256 ? pic : DEFAULT_PIC;
  for (let i = 0; i < 256; i++) {
    ctx.fillStyle = EASEL_COLORS[parseInt(s[i], 16) || 0];
    ctx.fillRect(i % 16, Math.floor(i / 16), 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** Painting easel: the canvas shows data.pic (a 16x16 pixel painting). */
export function easel(color = SW.wood[0], data = {}) {
  const k = new Kit();
  const wood = woodMat(color);
  k.stick([0.22, 0, 0.72], [0.42, 1.72, 0.44], 0.07, wood);
  k.stick([0.78, 0, 0.72], [0.58, 1.72, 0.44], 0.07, wood);
  k.stick([0.5, 0, 0.1], [0.5, 1.6, 0.42], 0.06, wood);
  k.box(0.26, 0.08, 0.08, wood, 0.37, 1.66, 0.4);
  k.box(0.84, 0.05, 0.14, wood, 0.08, 0.72, 0.6);
  ['#FF5FA2', '#FFD43B', '#6CC6FF', '#3FD8B0'].forEach((c, i) => k.box(0.08, 0.04, 0.04, c, 0.16 + i * 0.16, 0.77, 0.68));
  let picMat;
  if (data.pic) {
    picMat = new THREE.MeshLambertMaterial({ map: picTexture(data.pic), emissive: '#FFFFFF', emissiveIntensity: 0.08 });
    picMat.userData.uvFit = true;
  } else {
    picMat = material('easel|default', { map: paintTexture('easel|default', 16, 16, (ctx) => {
      for (let i = 0; i < 256; i++) {
        ctx.fillStyle = EASEL_COLORS[parseInt(DEFAULT_PIC[i], 16) || 0];
        ctx.fillRect(i % 16, Math.floor(i / 16), 1, 1);
      }
    }, { repeat: false }), uvFit: true });
  }
  const tilt = -0.14;
  const pv = [0.5, 0.77, 0.64];
  k.box(0.84, 0.84, 0.04, '#FFFFFF', 0.08, 0.77, 0.6, { rot: [tilt, 0, 0], pivot: pv });
  k.box(0.78, 0.78, 0.01, picMat, 0.11, 0.8, 0.64, { rot: [tilt, 0, 0], pivot: pv, faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  k.ball(0.13, '#FFF1D6', 0.92, 0.9, 0.74, { sy: 0.2, sx: 1.1, rot: [0, 0, 1.2] });
  ['#FF5FA2', '#6CC6FF', '#FFD43B', '#3FD8B0'].forEach((c, i) => k.ball(0.025, c, 0.95, 0.84 + (i % 2) * 0.1, 0.68 + Math.floor(i / 2) * 0.1));
  k.hitbox(0.05, 0, 0.1, 0.95, 1.75, 0.8);
  return k.build();
}

/** Dollhouse with tiny rooms; the front (part 'front') swings open. */
export function dollhouse(color = SW.bright[0]) {
  const k = new Kit();
  const wall = mixHex(color, '#FFFFFF', 0.35);
  const roof = stripeMat('#C8B4FF', '#E3D8FF');
  k.box(2.0, 0.08, 0.96, woodMat(C.wood), 0, 0, 0.02);
  k.box(1.9, 1.44, 0.05, wall, 0.05, 0.08, 0.06);
  k.box(0.05, 1.44, 0.86, wall, 0.05, 0.08, 0.06);
  k.box(0.05, 1.44, 0.86, wall, 1.9, 0.08, 0.06);
  k.box(1.8, 0.05, 0.86, woodMat(C.wood), 0.1, 0.78, 0.06);
  k.box(0.04, 1.4, 0.8, wall, 0.98, 0.08, 0.1);
  const papers = ['#FFE3F0', '#E6F4FF', '#FFF6D8', '#E8FFF2'];
  papers.forEach((p, i) => k.box(0.84, 0.64, 0.01, quiltMat(p, ['hearts', 'stars', 'flowers', 'dots'][i]), 0.12 + (i % 2) * 0.9, 0.1 + Math.floor(i / 2) * 0.72, 0.11));
  // tiny furniture
  k.box(0.4, 0.1, 0.22, '#FF9CCB', 0.2, 0.08, 0.4);
  k.box(0.12, 0.06, 0.2, '#FFFFFF', 0.2, 0.18, 0.41);
  k.box(0.04, 0.2, 0.22, '#FFF6EC', 0.18, 0.08, 0.4);
  k.cyl(0.12, 0.02, '#E7BE8C', 1.45, 0.28, 0.45, 10);
  k.cyl(0.02, 0.2, '#E7BE8C', 1.45, 0.08, 0.45, 6);
  k.box(0.08, 0.12, 0.08, '#A6D8FF', 1.2, 0.08, 0.4);
  k.box(0.08, 0.12, 0.08, '#A6D8FF', 1.62, 0.08, 0.4);
  k.box(0.4, 0.12, 0.16, '#C8B4FF', 0.25, 0.83, 0.2);
  k.box(0.4, 0.14, 0.06, '#C8B4FF', 0.25, 0.95, 0.2);
  k.box(0.3, 0.1, 0.2, '#FFFFFF', 1.3, 0.83, 0.35);
  k.box(0.26, 0.02, 0.16, '#BDEBFF', 1.32, 0.92, 0.37);
  // roof: gable facing the front
  const th = Math.atan2(0.5, 1.05);
  k.box(1.2, 0.06, 1.0, roof, -0.2, 1.94, 0.02, { rot: [0, 0, th], pivot: [1.0, 2.0, 0.5] });
  k.box(1.2, 0.06, 1.0, roof, 1.0, 1.94, 0.02, { rot: [0, 0, -th], pivot: [1.0, 2.0, 0.5] });
  // stepped gables front and back (the front one stays when the facade swings open)
  for (let i = 0; i < 5; i++) {
    const w = 1.9 - i * 0.38;
    k.box(w, 0.1, 0.05, wall, 0.05 + i * 0.19, 1.52 + i * 0.096, 0.06);
    k.box(w, 0.1, 0.05, wall, 0.05 + i * 0.19, 1.52 + i * 0.096, 0.92);
  }
  k.pixels(HEART_ROWS, 0.035, { X: C.rose }, 0.88, 1.6, 0.97, { depth: 0.02 });
  // front facade swings open on its left hinge
  const f = k.part('front', 0.05, 0.08, 0.94);
  f.box(1.9, 1.44, 0.04, wall, 0, 0, 0);
  const glass = sheer('#E4F6FF', 0.6);
  for (const [x, y] of [[0.2, 0.9], [1.3, 0.9], [1.3, 0.2]]) {
    f.box(0.4, 0.36, 0.02, glass, x, y, 0.04);
    f.box(0.44, 0.04, 0.04, '#FFFFFF', x - 0.02, y + 0.36, 0.04);
    f.box(0.44, 0.04, 0.04, '#FFFFFF', x - 0.02, y - 0.04, 0.04);
    f.box(0.02, 0.36, 0.03, '#FFFFFF', x + 0.19, y, 0.04);
    f.box(0.4, 0.06, 0.08, woodMat(C.wood), x, y - 0.1, 0.04);
    flower(f, 0.1, '#FF8FB8', x + 0.05, y - 0.05, 0.08, C.butter, 0.02);
    flower(f, 0.1, '#FFE38F', x + 0.25, y - 0.05, 0.08, C.rose, 0.02);
  }
  f.box(0.34, 0.56, 0.03, shade(color, -0.1), 0.4, 0, 0.04);
  f.pixels(HEART_ROWS, 0.03, { X: '#FFFFFF' }, 0.47, 0.36, 0.07, { depth: 0.01 });
  f.box(0.04, 0.04, 0.03, C.gold, 0.66, 0.26, 0.07);
  return k.build();
}

/** Teddy bear (part 'bear' squishes when hugged). Stands on tables too. */
export function teddyBear(color = SW.teddy[0]) {
  const k = new Kit();
  const fur = fabricMat(color);
  const light = mixHex(color, '#FFFFFF', 0.5);
  const bow = color === '#FFC4DD' ? '#C8B4FF' : C.rose;
  const b = k.part('bear', 0.5, 0, 0.5);
  b.ball(0.17, fur, 0, 0.2, 0, { sy: 1.1 });
  b.ball(0.1, light, 0, 0.18, 0.1, { sz: 0.6 });
  b.ball(0.15, fur, 0, 0.47, 0.02);
  b.ball(0.065, light, 0, 0.44, 0.14, { sz: 0.8 });
  b.box(0.04, 0.03, 0.02, C.ink, -0.02, 0.46, 0.19);
  b.box(0.026, 0.035, 0.02, C.ink, -0.07, 0.51, 0.15);
  b.box(0.026, 0.035, 0.02, C.ink, 0.044, 0.51, 0.15);
  b.box(0.012, 0.012, 0.01, '#FFFFFF', -0.06, 0.53, 0.17);
  b.box(0.012, 0.012, 0.01, '#FFFFFF', 0.054, 0.53, 0.17);
  b.box(0.04, 0.02, 0.02, '#FF9EB8', -0.12, 0.45, 0.13);
  b.box(0.04, 0.02, 0.02, '#FF9EB8', 0.08, 0.45, 0.13);
  for (const sx of [-1, 1]) {
    b.ball(0.055, fur, sx * 0.11, 0.6, 0);
    b.ball(0.03, '#FFB8D6', sx * 0.11, 0.6, 0.03);
    b.ball(0.06, fur, sx * 0.17, 0.26, 0.05, { sy: 1.5 });
    b.ball(0.07, fur, sx * 0.1, 0.07, 0.12, { sz: 1.4 });
    b.ball(0.04, light, sx * 0.1, 0.07, 0.21);
  }
  b.pixels(['XX.XX', 'XXXXX', 'XX.XX'], 0.035, { X: bow }, -0.0875, 0.3, 0.14, { depth: 0.04 });
  return k.build();
}

/** A bunch of balloons tied to a little gift box (part 'bunch' sways). */
export function balloonBunch(color = BALLOONS[0]) {
  const k = new Kit();
  k.box(0.2, 0.16, 0.2, color, 0.4, 0, 0.4);
  k.box(0.22, 0.04, 0.22, '#FFFFFF', 0.39, 0.16, 0.39);
  k.box(0.04, 0.17, 0.21, '#FFFFFF', 0.48, 0, 0.395);
  k.pixels(['X.X', 'XXX'], 0.03, { X: '#FFFFFF' }, 0.455, 0.2, 0.5, { depth: 0.02 });
  const b = k.part('bunch', 0.5, 0.22, 0.5);
  const i0 = Math.max(0, BALLOONS.indexOf(color));
  const spots = [[-0.2, 1.3, 0.02], [0.18, 1.42, -0.06], [0, 1.62, 0.08], [-0.06, 1.14, -0.14], [0.22, 1.16, 0.14]];
  spots.forEach(([x, y, z], i) => {
    const c = BALLOONS[(i0 + i) % BALLOONS.length];
    const shiny = material(`balloon|${c}`, { color: c, emissive: c, emissiveIntensity: 0.12 });
    b.stick([0, 0, 0], [x, y - 0.16, z], 0.012, '#FFFFFF');
    b.ball(0.15, shiny, x, y, z, { sy: 1.2, seg: 14 });
    b.cone(0.03, 0.0, 0.05, shiny, x, y - 0.21, z, 6);
    b.ball(0.035, '#FFFFFF', x - 0.06, y + 0.07, z + 0.1);
  });
  k.hitbox(0.15, 0, 0.15, 0.85, 1.95, 0.85);
  return k.build();
}

export { flower, HEART_ROWS, FLOWER_ROWS, fabricMat, glow };
