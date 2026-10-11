// Doors, windows, stairs, fences, gates, ladders and lights.

import * as THREE from 'three';
import { Kit } from './kit.js';
import { woodMat, quiltMat, sheer, glow, material } from './paint.js';
import { C, SW, knob, heart, flower, HEART_ROWS, STAR_ROWS } from './palette.js';
import { shade, mixHex } from '../../core/util.js';

// A door leaf sits at the back edge of its cell (z 0..0.14) and swings on a hinge at x = 0
// toward +Z, so an open door lies along the side of its own cell (part 'leaf').
export const DOOR_OPEN_ANGLE = -Math.PI / 2 + 0.08;

function leaf(k, draw) {
  const l = k.part('leaf', 0.02, 0, 0.07);
  draw(l);
  return l;
}

export function door(color = SW.door[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  leaf(k, (l) => {
    l.box(0.94, 1.96, 0.12, wood, 0, 0, -0.06);
    for (const [y, h] of [[0.12, 0.72], [1.02, 0.5]]) {
      for (const x of [0.1, 0.52]) {
        l.box(0.32, h, 0.02, shade(color, -0.07), x, y, 0.06);
        l.box(0.32, h, 0.02, shade(color, -0.07), x, y, -0.08);
      }
    }
    // round window at the top
    l.box(0.4, 0.26, 0.13, sheer('#DFF4FF', 0.55), 0.27, 1.6, -0.065);
    l.box(0.48, 0.04, 0.14, shade(color, 0.2), 0.23, 1.86, -0.07);
    heart(l, 0.14, C.rose, 0.4, 1.36, 0.06, 0.02);
    knob(l, 0.8, 0.95, 0.06, C.gold, true);
    knob(l, 0.8, 0.95, -0.1, C.gold, true);
  });
  k.hitbox(0, 0, 0, 1, 2, 1);
  return k.build();
}

export function doorPink(color = SW.doorPink[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  leaf(k, (l) => {
    l.box(0.94, 1.96, 0.12, wood, 0, 0, -0.06);
    // heart-shaped window
    const px = 0.5 / 7;
    l.pixels(HEART_ROWS, px, { X: sheer('#FFE6F2', 0.5) }, 0.22, 1.25, -0.065, { depth: 0.13 });
    l.box(0.66, 0.04, 0.14, shade(color, 0.3), 0.14, 1.72, -0.07);
    // flowers climbing up
    const petals = ['#FFFFFF', '#FFE38F', '#C8A6FF'];
    for (let i = 0; i < 5; i++) {
      const y = 0.15 + i * 0.22;
      flower(l, 0.14, petals[i % 3], i % 2 ? 0.66 : 0.14, y, 0.06, C.rose, 0.02);
      flower(l, 0.14, petals[(i + 1) % 3], i % 2 ? 0.66 : 0.14, y, -0.08, C.rose, 0.02);
    }
    l.box(0.5, 0.02, 0.02, C.leaf, 0.22, 0.2, 0.065);
    knob(l, 0.8, 0.95, 0.06, '#FFFFFF', true);
    knob(l, 0.8, 0.95, -0.1, '#FFFFFF', true);
  });
  k.hitbox(0, 0, 0, 1, 2, 1);
  return k.build();
}

export function doorGlass(color = SW.door[1]) {
  const k = new Kit();
  const frame = woodMat(color);
  const glass = sheer('#DFF4FF', 0.38);
  leaf(k, (l) => {
    l.box(0.1, 1.96, 0.12, frame, 0, 0, -0.06);
    l.box(0.1, 1.96, 0.12, frame, 0.84, 0, -0.06);
    for (const y of [0, 0.66, 1.3, 1.86]) l.box(0.74, 0.1, 0.12, frame, 0.1, y, -0.06);
    l.box(0.05, 1.76, 0.1, frame, 0.445, 0.1, -0.05);
    for (const [y, h] of [[0.1, 0.56], [0.76, 0.54], [1.4, 0.46]]) l.box(0.74, h, 0.03, glass, 0.1, y, -0.015);
    l.box(0.04, 0.3, 0.05, C.gold, 0.78, 0.82, 0.06);
    l.box(0.04, 0.3, 0.05, C.gold, 0.78, 0.82, -0.11);
  });
  k.hitbox(0, 0, 0, 1, 2, 1);
  return k.build();
}

/** Window with panes and curtains (parts curtainL / curtainR slide open). */
export function windowFrame(color = SW.door[1], data = {}) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(1.0, 0.08, 0.2, wood, 0, 0, 0);
  k.box(1.0, 0.08, 0.14, wood, 0, 0.92, 0);
  k.box(0.08, 0.84, 0.14, wood, 0, 0.08, 0);
  k.box(0.08, 0.84, 0.14, wood, 0.92, 0.08, 0);
  k.box(0.04, 0.84, 0.1, wood, 0.48, 0.08, 0.02);
  k.box(0.84, 0.04, 0.1, wood, 0.08, 0.48, 0.02);
  k.box(0.84, 0.84, 0.02, sheer('#E4F6FF', 0.32), 0.08, 0.08, 0.06);
  k.box(1.1, 0.06, 0.24, shade(color, 0.15), -0.05, 0.0, 0.0);
  k.box(1.0, 0.04, 0.04, C.gold, 0, 0.96, 0.16);
  const cur = mixHex(color === '#FFFFFF' ? '#FF9CCB' : color, '#FFFFFF', 0.25);
  const m = quiltMat(cur, 'dots');
  for (const [name, px, dir] of [['curtainL', 0.02, 1], ['curtainR', 0.98, -1]]) {
    const c = k.part(name, px, 0.1, 0.19);
    const x0 = dir > 0 ? 0 : -0.5;
    c.box(0.5, 0.84, 0.03, m, x0, 0, 0);
    c.box(0.5, 0.1, 0.05, shade(cur, -0.1), x0, 0.78, -0.01);
    for (let i = 0; i < 5; i++) c.box(0.06, 0.05, 0.035, shade(cur, 0.4), x0 + 0.02 + i * 0.1, -0.03, 0);
  }
  return k.build();
}

/** Stairs: four real steps (true step colliders) with a carpet runner. */
export function stairs(color = SW.fabric[0]) {
  const k = new Kit();
  const wood = woodMat(C.wood);
  for (let i = 0; i < 4; i++) {
    const y = i * 0.25;
    const z0 = 0;
    const z1 = 1 - i * 0.25;
    k.box(1.0, 0.25, z1 - z0, wood, 0, y, z0);
    k.box(1.0, 0.03, 0.06, shade(C.wood, 0.15), 0, y + 0.23, z1 - 0.05);
    k.box(0.56, 0.015, 0.25, quiltMat(color, 'hearts'), 0.22, y + 0.25, z1 - 0.25);
    k.box(0.56, 0.24, 0.015, quiltMat(color, 'hearts'), 0.22, y + 0.01, z1);
  }
  k.box(0.04, 0.04, 0.04, C.gold, 0.2, 0.26, 0.9);
  k.box(0.04, 0.04, 0.04, C.gold, 0.76, 0.26, 0.9);
  return k.build();
}

/** Picket fence; data.conn = local sides to connect (1 +X, 2 -X, 4 +Z, 8 -Z). */
export function fence(color = SW.door[1], data = {}) {
  const k = new Kit();
  const wood = woodMat(color);
  let conn = data.conn | 0;
  if (!conn) conn = 3; // on its own it shows a straight little segment
  k.box(0.16, 1.0, 0.16, wood, 0.42, 0, 0.42);
  k.box(0.2, 0.05, 0.2, shade(color, 0.2), 0.4, 1.0, 0.4);
  const picket = (x, z) => {
    k.box(0.1, 0.78, 0.05, wood, x - 0.05, 0.08, z - 0.025);
    k.box(0.07, 0.06, 0.05, wood, x - 0.035, 0.86, z - 0.025, { rot: [0, 0, Math.PI / 4] });
  };
  if (conn & 1) {
    k.box(0.42, 0.07, 0.06, wood, 0.58, 0.3, 0.47);
    k.box(0.42, 0.07, 0.06, wood, 0.58, 0.66, 0.47);
    picket(0.72, 0.53);
    picket(0.9, 0.53);
  }
  if (conn & 2) {
    k.box(0.42, 0.07, 0.06, wood, 0, 0.3, 0.47);
    k.box(0.42, 0.07, 0.06, wood, 0, 0.66, 0.47);
    picket(0.1, 0.53);
    picket(0.28, 0.53);
  }
  if (conn & 4) {
    k.box(0.06, 0.07, 0.42, wood, 0.47, 0.3, 0.58);
    k.box(0.06, 0.07, 0.42, wood, 0.47, 0.66, 0.58);
    picket(0.555, 0.72);
    picket(0.555, 0.9);
    k.box(0.05, 0.78, 0.1, wood, 0.53, 0.08, 0.67);
    k.box(0.05, 0.78, 0.1, wood, 0.53, 0.08, 0.85);
  }
  if (conn & 8) {
    k.box(0.06, 0.07, 0.42, wood, 0.47, 0.3, 0);
    k.box(0.06, 0.07, 0.42, wood, 0.47, 0.66, 0);
    k.box(0.05, 0.78, 0.1, wood, 0.53, 0.08, 0.05);
    k.box(0.05, 0.78, 0.1, wood, 0.53, 0.08, 0.23);
  }
  heart(k, 0.1, C.rose, 0.45, 0.72, 0.58, 0.01);
  k.hitbox(0, 0, 0, 1, 1.05, 1);
  return k.build();
}

/** Garden gate: a picket leaf (part 'leaf') between two posts. */
export function gate(color = SW.door[1]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(0.1, 1.1, 0.14, wood, 0, 0, 0.43);
  k.box(0.1, 1.1, 0.14, wood, 0.9, 0, 0.43);
  k.ball(0.07, shade(color, 0.2), 0.05, 1.14, 0.5);
  k.ball(0.07, shade(color, 0.2), 0.95, 1.14, 0.5);
  const l = k.part('leaf', 0.1, 0, 0.5);
  l.box(0.8, 0.07, 0.05, wood, 0, 0.25, -0.025);
  l.box(0.8, 0.07, 0.05, wood, 0, 0.66, -0.025);
  for (let i = 0; i < 5; i++) {
    const x = 0.04 + i * 0.16;
    const h = 0.8 + Math.sin(((i + 0.5) / 5) * Math.PI) * 0.12;
    l.box(0.1, h, 0.04, wood, x, 0.08, 0.025);
    l.box(0.07, 0.07, 0.04, wood, x + 0.015, 0.08 + h - 0.04, 0.025, { rot: [0, 0, Math.PI / 4] });
  }
  heart(l, 0.14, C.rose, 0.33, 0.44, 0.065, 0.02);
  knob(l, 0.72, 0.5, 0.065, C.gold, false);
  k.hitbox(0, 0, 0.3, 1, 1.2, 0.7);
  return k.build();
}

/** Ladder against a wall (back edge of the cell). Climbable. */
export function ladder(color = SW.door[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(0.08, 1.0, 0.08, wood, 0.14, 0, 0.03);
  k.box(0.08, 1.0, 0.08, wood, 0.78, 0, 0.03);
  for (let i = 0; i < 4; i++) k.box(0.56, 0.06, 0.06, shade(color, 0.12), 0.22, 0.12 + i * 0.25, 0.05);
  return k.build();
}

/** Rope ladder for tree houses (3 tall), climbable. */
export function treeHouseLadder(color = SW.door[0]) {
  const k = new Kit();
  const rope = '#E9D3A6';
  k.box(0.04, 3.0, 0.04, rope, 0.18, 0, 0.06);
  k.box(0.04, 3.0, 0.04, rope, 0.78, 0, 0.06);
  for (let i = 0; i < 10; i++) {
    const y = 0.15 + i * 0.29;
    k.box(0.72, 0.06, 0.1, woodMat(color), 0.14, y, 0.03);
    k.box(0.07, 0.08, 0.07, rope, 0.165, y - 0.01, 0.045);
    k.box(0.07, 0.08, 0.07, rope, 0.765, y - 0.01, 0.045);
  }
  k.box(0.16, 0.1, 0.12, C.woodDark, 0.12, 2.9, 0.0);
  k.box(0.16, 0.1, 0.12, C.woodDark, 0.72, 2.9, 0.0);
  return k.build();
}

// ---------- lights ----------

function shadeMat(color, on) {
  return on
    ? material(`shade|${color}|on`, { color, emissive: color, emissiveIntensity: 0.55, side: THREE.DoubleSide })
    : material(`shade|${color}|off`, { color, side: THREE.DoubleSide });
}

/** Pendant lamp hanging from the ceiling. */
export function lampCeiling(color = SW.shades[0], data = {}) {
  const on = data.on !== false;
  const k = new Kit();
  k.cyl(0.1, 0.03, '#FFFFFF', 0.5, 0.97, 0.5, 12);
  k.cyl(0.012, 0.36, '#FFFFFF', 0.5, 0.62, 0.5, 6);
  k.cone(0.32, 0.08, 0.24, shadeMat(color, on), 0.5, 0.38, 0.5, 18, { open: true });
  k.cyl(0.09, 0.04, shade(color, -0.1), 0.5, 0.6, 0.5, 12);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.ball(0.035, i % 2 ? '#FFFFFF' : shade(color, 0.4), 0.5 + Math.cos(a) * 0.32, 0.37, 0.5 + Math.sin(a) * 0.32);
  }
  k.ball(0.09, on ? glow('#FFF3C4', 1) : '#EDE6D6', 0.5, 0.42, 0.5);
  k.box(0.01, 0.1, 0.01, '#FFFFFF', 0.5, 0.26, 0.5);
  k.pixels(HEART_ROWS, 0.02, { X: C.rose }, 0.43, 0.16, 0.5, { depth: 0.02 });
  return k.build();
}

/** Twinkly string of fairy lights under the ceiling (parts twinkleA / twinkleB). */
export function fairyLights(color = SW.shades[0], data = {}) {
  const on = data.on !== false;
  const k = new Kit();
  const bulbs = ['#FF9CCB', '#FFE38F', '#9BE8CF', '#A6D8FF', '#C8B4FF', '#FFBFA0', mixHex(color, '#FFFFFF', 0.2)];
  const n = 7;
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    pts.push([t, 0.96 - Math.sin(t * Math.PI) * 0.22]);
  }
  for (let i = 0; i < 20; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    k.box(len + 0.01, 0.015, 0.015, '#6A8F6A', x0, y0, 0.5, { rot: [0, 0, Math.atan2(y1 - y0, x1 - x0)], pivot: [x0, y0, 0.5] });
  }
  const A = k.part('twinkleA', 0, 0, 0);
  const B = k.part('twinkleB', 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = t, y = 0.96 - Math.sin(t * Math.PI) * 0.22 - 0.05;
    const c = bulbs[i % bulbs.length];
    k.box(0.02, 0.03, 0.02, '#6A8F6A', x - 0.01, y + 0.03, 0.49);
    k.ball(0.04, on ? glow(c, 0.9) : c, x, y, 0.5, { sy: 1.25 });
    if (on) (i % 2 ? A : B).ball(0.075, sheer(c, 0.35), x, y, 0.5);
  }
  for (const t of [0.2, 0.5, 0.8]) {
    const y = 0.96 - Math.sin(t * Math.PI) * 0.22;
    k.box(0.008, 0.2, 0.008, '#FFFFFF', t, y - 0.24, 0.5);
    k.pixels(STAR_ROWS, 0.018, { X: on ? glow('#FFF4B8', 0.7) : '#FFF4B8' }, t - 0.063, y - 0.36, 0.49, { depth: 0.02 });
  }
  return k.build();
}

/** Garden lamp post (2 tall) with a glowing lantern. */
export function lanternPost(color = SW.shades[2], data = {}) {
  const on = data.on !== false;
  const k = new Kit();
  const post = shade(color, -0.1);
  k.box(0.36, 0.1, 0.36, post, 0.32, 0, 0.32);
  k.box(0.26, 0.1, 0.26, shade(post, 0.2), 0.37, 0.1, 0.37);
  k.cyl(0.05, 1.2, post, 0.5, 0.2, 0.5, 10);
  k.torus(0.07, 0.02, C.gold, 0.5, 0.55, 0.5);
  k.box(0.3, 0.04, 0.3, post, 0.35, 1.38, 0.35);
  for (const [x, z] of [[0.36, 0.36], [0.6, 0.36], [0.36, 0.6], [0.6, 0.6]]) k.box(0.04, 0.36, 0.04, post, x, 1.42, z);
  k.box(0.22, 0.34, 0.22, sheer('#FFF6D8', on ? 0.55 : 0.35), 0.39, 1.43, 0.39);
  k.ball(0.07, on ? glow('#FFE7A0', 1) : '#EDE6D6', 0.5, 1.58, 0.5, { sy: 1.3 });
  k.box(0.36, 0.05, 0.36, post, 0.32, 1.78, 0.32);
  k.box(0.24, 0.05, 0.24, post, 0.38, 1.83, 0.38);
  k.ball(0.05, C.gold, 0.5, 1.92, 0.5);
  k.pixels(['XX.XX', 'XXXXX', 'XX.XX'], 0.04, { X: C.rose }, 0.4, 1.2, 0.56, { depth: 0.03 });
  return k.build();
}

/** Candle in a golden holder; part 'flame' flickers (stands on tables). */
export function candle(color = SW.shades[0], data = {}) {
  const on = data.on !== false;
  const k = new Kit();
  k.cyl(0.13, 0.03, C.gold, 0.5, 0, 0.5, 14);
  k.torus(0.05, 0.015, C.gold, 0.68, 0.03, 0.5, { rot: [Math.PI / 2, 0, 0] });
  k.cyl(0.07, 0.03, C.gold, 0.5, 0.03, 0.5, 10);
  k.cyl(0.055, 0.24, color, 0.5, 0.06, 0.5, 10);
  k.box(0.03, 0.05, 0.02, shade(color, 0.4), 0.52, 0.22, 0.545);
  k.box(0.01, 0.04, 0.01, '#6A5F5A', 0.495, 0.3, 0.495);
  if (on) {
    const f = k.part('flame', 0.5, 0.34, 0.5);
    f.ball(0.035, glow('#FFB25C', 1), 0, 0.03, 0, { sy: 1.7 });
    f.ball(0.02, glow('#FFF6C8', 1), 0, 0.03, 0, { sy: 1.5 });
  }
  return k.build();
}
