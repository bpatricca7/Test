// Living room models: sofa, armchair, beanbag, coffee table, TV, fireplace, piano, rugs,
// lamps, potted plant, picture frame, kitty clock.

import * as THREE from 'three';
import { Kit } from './kit.js';
import { woodMat, fabricMat, fluffyMat, brickMat, stoneMat, glow, material, paintingMat, clockFaceMat, screenOffMat, sheer } from './paint.js';
import { C, SW, pillow, drawer, heart, flower, HEART_ROWS, STAR_ROWS, BIG_HEART_ROWS } from './palette.js';
import { shade, mixHex } from '../../core/util.js';

function cushionBox(k, w, h, d, color, x, y, z) {
  k.box(w, h, d, fabricMat(color), x, y, z);
  k.box(w - 0.06, 0.03, d - 0.06, shade(color, 0.12), x + 0.03, y + h, z + 0.03);
}

export function sofa(color = SW.fabric[0]) {
  const k = new Kit();
  const fab = fabricMat(color);
  const deep = shade(color, -0.08);
  for (const x of [0.12, 1.8]) for (const z of [0.12, 0.8]) k.box(0.08, 0.1, 0.08, C.woodDark, x, 0, z);
  k.box(1.9, 0.22, 0.84, fabricMat(deep), 0.05, 0.1, 0.1);
  cushionBox(k, 0.82, 0.13, 0.6, color, 0.2, 0.32, 0.32);
  cushionBox(k, 0.82, 0.13, 0.6, color, 0.98, 0.32, 0.32);
  k.box(1.9, 0.52, 0.22, fab, 0.05, 0.3, 0.08);
  cushionBox(k, 0.8, 0.36, 0.14, shade(color, 0.08), 0.2, 0.44, 0.28);
  cushionBox(k, 0.8, 0.36, 0.14, shade(color, 0.08), 1.0, 0.44, 0.28);
  for (const x of [0.02, 1.8]) {
    k.box(0.18, 0.34, 0.86, fab, x, 0.1, 0.09);
    k.cyl(0.1, 0.86, color, x + 0.09, 0.44, 0.09, 10, { rot: [Math.PI / 2, 0, 0] });
  }
  heart(k, 0.3, C.rose, 0.3, 0.46, 0.45, 0.1);
  k.box(0.28, 0.26, 0.1, C.butter, 1.46, 0.45, 0.44, { rot: [-0.25, 0, 0.12] });
  k.pixels(STAR_ROWS, 0.024, { X: '#FFFFFF' }, 1.52, 0.52, 0.5, { depth: 0.02 });
  return k.build();
}

export function armchair(color = SW.fabric[1]) {
  const k = new Kit();
  const fab = fabricMat(color);
  for (const x of [0.12, 0.8]) for (const z of [0.12, 0.8]) k.box(0.08, 0.1, 0.08, C.woodDark, x, 0, z);
  k.box(0.9, 0.22, 0.84, fabricMat(shade(color, -0.08)), 0.05, 0.1, 0.1);
  cushionBox(k, 0.58, 0.13, 0.6, color, 0.21, 0.32, 0.32);
  k.box(0.9, 0.64, 0.2, fab, 0.05, 0.3, 0.08);
  k.box(0.7, 0.1, 0.2, fab, 0.15, 0.94, 0.08);
  cushionBox(k, 0.56, 0.4, 0.13, shade(color, 0.08), 0.22, 0.44, 0.28);
  for (const x of [0.02, 0.8]) {
    k.box(0.18, 0.36, 0.86, fab, x, 0.1, 0.09);
    k.cyl(0.1, 0.86, color, x + 0.09, 0.46, 0.09, 10, { rot: [Math.PI / 2, 0, 0] });
    k.box(0.18, 0.3, 0.2, fab, x, 0.5, 0.08);
  }
  heart(k, 0.2, '#FFFFFF', 0.4, 0.66, 0.42, 0.02);
  return k.build();
}

export function beanbag(color = SW.fabric[2]) {
  const k = new Kit();
  const fab = fabricMat(color);
  k.ball(0.45, fab, 0.5, 0.24, 0.52, { sy: 0.58, seg: 16 });
  k.ball(0.4, fab, 0.5, 0.44, 0.33, { sy: 0.9, sz: 0.55, seg: 16 });
  k.ball(0.33, fabricMat(shade(color, 0.12)), 0.5, 0.36, 0.6, { sy: 0.28, seg: 14 });
  k.ball(0.06, shade(color, -0.1), 0.5, 0.8, 0.36, { sy: 0.6 });
  heart(k, 0.18, '#FFFFFF', 0.41, 0.52, 0.53, 0.02);
  return k.build();
}

export function coffeeTable(color = SW.wood[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(1.84, 0.06, 0.8, wood, 0.08, 0.4, 0.1);
  k.box(1.76, 0.02, 0.72, shade(color, 0.15), 0.12, 0.46, 0.14);
  for (const [x, z] of [[0.16, 0.18], [1.76, 0.18], [0.16, 0.74], [1.76, 0.74]]) k.cyl(0.04, 0.4, shade(color, -0.15), x + 0.04, 0, z + 0.04, 8);
  k.box(1.64, 0.04, 0.6, wood, 0.18, 0.12, 0.2);
  k.box(0.3, 0.05, 0.22, '#9FD8FF', 0.3, 0.16, 0.3);
  k.box(0.28, 0.04, 0.2, '#FF8FB8', 0.32, 0.21, 0.31);
  k.cyl(0.08, 0.02, '#FFFFFF', 1.4, 0.16, 0.5, 10);
  return k.build();
}

/** TV on a cabinet; the screen face uses a per-entity canvas while switched on. */
export function tv(color = SW.bright[0], data = {}, screen = null) {
  const k = new Kit();
  const wood = woodMat(mixHex(color, '#FFFFFF', 0.45));
  k.box(1.9, 0.48, 0.7, wood, 0.05, 0.08, 0.18);
  k.box(1.96, 0.04, 0.76, shade(color, 0.3), 0.02, 0.56, 0.15);
  drawer(k, 0.12, 0.14, 0.8, 0.36, 0.88, color);
  drawer(k, 1.08, 0.14, 0.8, 0.36, 0.88, color);
  for (const x of [0.1, 1.8]) k.box(0.1, 0.08, 0.1, shade(color, -0.2), x, 0, 0.5);
  // stand + screen
  k.box(0.5, 0.04, 0.26, C.night, 0.75, 0.6, 0.35);
  k.box(0.1, 0.12, 0.08, C.night, 0.95, 0.64, 0.42);
  k.box(1.74, 1.02, 0.12, shade(color, 0.1), 0.13, 0.72, 0.36);
  k.box(1.74, 0.08, 0.12, shade(color, -0.08), 0.13, 0.72, 0.36);
  const face = screen || screenOffMat();
  k.box(1.56, 0.86, 0.01, face, 0.22, 0.81, 0.48, { faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  heart(k, 0.1, '#FFFFFF', 0.95, 0.735, 0.485, 0.01);
  // bunny-ear antennas (just for fun)
  k.box(0.03, 0.34, 0.03, C.night, 0.9, 1.72, 0.42, { rot: [0, 0, 0.45], pivot: [0.915, 1.72, 0.43] });
  k.box(0.03, 0.34, 0.03, C.night, 1.08, 1.72, 0.42, { rot: [0, 0, -0.45], pivot: [1.095, 1.72, 0.43] });
  k.ball(0.04, C.rose, 0.77, 2.0, 0.43);
  k.ball(0.04, C.rose, 1.23, 2.0, 0.43);
  const on = data.ch > 0;
  k.ball(0.025, on ? glow('#7CFFB8', 1) : '#6A5F8E', 1.78, 0.76, 0.49);
  return k.build();
}

/** Fireplace with a mantel; part 'flames' flickers while lit. */
export function fireplace(color = '#FFB8C8', data = {}) {
  const k = new Kit();
  const brick = brickMat(color);
  const on = data.on !== false;
  k.box(2.0, 0.08, 0.9, stoneMat('#E9E2F5'), 0, 0, 0.08);
  k.box(0.44, 1.22, 0.62, brick, 0.05, 0.08, 0.1);
  k.box(0.44, 1.22, 0.62, brick, 1.51, 0.08, 0.1);
  k.box(1.9, 0.34, 0.62, brick, 0.05, 0.96, 0.1);
  k.box(1.04, 0.9, 0.08, '#5C3F58', 0.48, 0.08, 0.1);
  k.box(0.06, 0.9, 0.5, '#6E4A68', 0.48, 0.08, 0.18);
  k.box(0.06, 0.9, 0.5, '#6E4A68', 1.46, 0.08, 0.18);
  k.box(1.04, 0.06, 0.5, '#6E4A68', 0.48, 0.9, 0.18);
  const mantel = woodMat(C.cream);
  k.box(2.0, 0.08, 0.74, mantel, 0, 1.3, 0.06);
  k.box(1.9, 0.04, 0.7, shade(C.cream, -0.08), 0.05, 1.26, 0.08);
  heart(k, 0.2, C.rose, 0.9, 1.04, 0.73, 0.03);
  // logs
  k.cyl(0.07, 0.62, C.woodDark, 0.68, 0.16, 0.42, 8, { rot: [0, 0, -Math.PI / 2] });
  k.cyl(0.065, 0.56, shade(C.woodDark, 0.12), 0.72, 0.24, 0.52, 8, { rot: [0.2, 0.5, -Math.PI / 2] });
  if (on) {
    const f = k.part('flames', 1.0, 0.2, 0.45);
    const outer = glow('#FF9A5C', 1);
    const mid = glow('#FFC76B', 1);
    const core = glow('#FFF3B0', 1);
    f.pixels(['..X...', '.XX..X', '.XXX.X', 'XXXXXX', 'XXXXXX', '.XXXX.'], 0.07, { X: outer }, -0.21, 0, -0.03, { depth: 0.06 });
    f.pixels(['..X..', '.XXX.', '.XXX.', '..X..'], 0.06, { X: mid }, -0.15, 0.03, 0.04, { depth: 0.05 });
    f.pixels(['.X.', 'XXX', '.X.'], 0.05, { X: core }, -0.075, 0.03, 0.1, { depth: 0.04 });
  }
  // two little stockings
  for (const [x, c] of [[0.25, C.rose], [1.6, '#8FD0FF']]) {
    k.box(0.12, 0.22, 0.04, c, x, 1.02, 0.8);
    k.box(0.1, 0.08, 0.04, c, x + 0.06, 1.0, 0.8);
    k.box(0.14, 0.05, 0.05, '#FFFFFF', x - 0.01, 1.22, 0.8);
  }
  return k.build();
}

/** Upright piano (h = 2) with shiny keys and a music stand. */
export function piano(color = SW.metal[0]) {
  const k = new Kit();
  const body = material(`piano|${color}`, { color, emissive: color, emissiveIntensity: 0.06 });
  const trim = C.gold;
  k.box(1.9, 1.08, 0.48, body, 0.05, 0.12, 0.05);
  k.box(1.98, 0.06, 0.56, shade(color, 0.12), 0.01, 1.2, 0.02);
  k.box(1.9, 0.12, 0.5, shade(color, -0.1), 0.05, 0, 0.04);
  for (const x of [0.1, 1.8]) {
    k.box(0.1, 0.6, 0.1, body, x, 0.08, 0.76);
    k.box(0.1, 0.04, 0.1, trim, x, 0.08, 0.76);
  }
  k.box(1.8, 0.12, 0.4, body, 0.1, 0.62, 0.48);
  k.box(1.8, 0.14, 0.04, shade(color, -0.06), 0.1, 0.74, 0.47);
  // keys
  for (let i = 0; i < 15; i++) k.box(0.108, 0.03, 0.3, '#FFFFFF', 0.14 + i * 0.1147, 0.74, 0.55);
  const blackAt = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];
  for (const i of blackAt) k.box(0.06, 0.04, 0.17, '#3A2F4A', 0.14 + (i + 1) * 0.1147 - 0.03, 0.765, 0.55);
  // music stand with a song sheet
  k.box(0.7, 0.36, 0.03, '#FFFFFF', 0.65, 0.9, 0.5, { rot: [-0.25, 0, 0] });
  const notes = ['..X...X..', '..X...X..', 'XXX..XX..', 'XX...X...'];
  k.pixels(notes, 0.035, { X: '#6A5F8E' }, 0.84, 1.0, 0.54, { depth: 0.01 });
  k.box(0.74, 0.04, 0.08, body, 0.63, 0.88, 0.5);
  // gold trims, pedals, a heart
  k.box(1.8, 0.03, 0.02, trim, 0.1, 1.16, 0.53);
  heart(k, 0.2, trim, 0.9, 0.3, 0.53, 0.02);
  for (const x of [0.86, 1.06]) k.box(0.08, 0.03, 0.14, trim, x, 0.03, 0.54);
  return k.build();
}

/** Round rug: soft concentric rings (flat). */
export function rugRound(color = SW.fabric[0]) {
  const k = new Kit();
  const rings = [[0.96, color], [0.8, shade(color, 0.5)], [0.64, color], [0.46, shade(color, 0.35)], [0.28, '#FFFFFF'], [0.12, color]];
  rings.forEach(([r, c], i) => k.cyl(r, 0.018, c, 1, i * 0.003, 1, 28));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    k.box(0.05, 0.012, 0.05, shade(color, 0.5), 1 + Math.cos(a) * 0.98 - 0.025, 0, 1 + Math.sin(a) * 0.98 - 0.025);
  }
  return k.build();
}

/** Heart-shaped rug (flat pixels). */
export function rugHeart(color = SW.fabric[0]) {
  const k = new Kit();
  const rows = BIG_HEART_ROWS;
  const px = 1.96 / rows[0].length;
  k.pixels(rows, px, { X: shade(color, -0.05) }, 0.02, 0, 0.02 + px, { plane: 'xz', depth: 0.02 });
  const inner = rows.map((r, i) => {
    if (i === 0 || i >= rows.length - 2) return '.'.repeat(r.length);
    let s = '';
    for (let c = 0; c < r.length; c++) s += r[c] === 'X' && r[c - 1] === 'X' && r[c + 1] === 'X' && rows[i - 1][c] === 'X' && rows[i + 1][c] === 'X' ? 'X' : '.';
    return s;
  });
  k.pixels(inner, px, { X: shade(color, 0.45) }, 0.02, 0.005, 0.02 + px, { plane: 'xz', depth: 0.02 });
  k.pixels(HEART_ROWS, px * 0.8, { X: color }, 1 - 3.5 * px * 0.8, 0.01, 0.55, { plane: 'xz', depth: 0.02 });
  return k.build();
}

function lampShadeMat(color, on) {
  return on
    ? material(`shade|${color}|on`, { color, emissive: color, emissiveIntensity: 0.55, side: THREE.DoubleSide })
    : material(`shade|${color}|off`, { color, side: THREE.DoubleSide });
}

export function floorLamp(color = SW.shades[0], data = {}) {
  const on = data.on !== false;
  const k = new Kit();
  k.cyl(0.2, 0.05, shade(color, -0.2), 0.5, 0, 0.5, 14);
  k.cyl(0.14, 0.03, C.gold, 0.5, 0.05, 0.5, 14);
  k.cyl(0.025, 1.36, C.gold, 0.5, 0.06, 0.5, 8);
  k.cone(0.3, 0.17, 0.36, lampShadeMat(color, on), 0.5, 1.38, 0.5, 16, { open: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    k.ball(0.035, on ? glow('#FFFFFF', 0.4) : '#FFFFFF', 0.5 + Math.cos(a) * 0.3, 1.37, 0.5 + Math.sin(a) * 0.3);
  }
  k.ball(0.08, on ? glow('#FFF3C4', 1) : '#EDE6D6', 0.5, 1.5, 0.5);
  heart(k, 0.16, shade(color, -0.2), 0.42, 0.08, 0.64, 0.02);
  return k.build();
}

export function tableLamp(color = SW.shades[0], data = {}) {
  const on = data.on !== false;
  const k = new Kit();
  k.cyl(0.15, 0.05, C.woodDark, 0.5, 0, 0.5, 12);
  k.ball(0.11, shade(color, -0.12), 0.5, 0.14, 0.5, { sy: 0.9 });
  k.cyl(0.03, 0.18, C.gold, 0.5, 0.22, 0.5, 8);
  k.cone(0.24, 0.14, 0.26, lampShadeMat(color, on), 0.5, 0.36, 0.5, 14, { open: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.ball(0.028, '#FFFFFF', 0.5 + Math.cos(a) * 0.24, 0.36, 0.5 + Math.sin(a) * 0.24);
  }
  k.ball(0.065, on ? glow('#FFF3C4', 1) : '#EDE6D6', 0.5, 0.44, 0.5);
  heart(k, 0.1, '#FFFFFF', 0.45, 0.1, 0.6, 0.02);
  return k.build();
}

/** Potted plant (stands on tables too); blooms after watering (data.bloom). */
export function plantPot(color = SW.bright[0], data = {}) {
  const k = new Kit();
  k.cone(0.15, 0.2, 0.28, color, 0.5, 0, 0.5, 12);
  k.cyl(0.215, 0.05, shade(color, 0.2), 0.5, 0.26, 0.5, 12);
  k.cyl(0.18, 0.02, C.soil, 0.5, 0.29, 0.5, 12);
  heart(k, 0.12, '#FFFFFF', 0.44, 0.1, 0.675, 0.02);
  // a round, fluffy bush with a few leaves poking out
  const bush = fluffyMat(C.leaf);
  k.ball(0.19, bush, 0.5, 0.5, 0.5, { seg: 12 });
  k.ball(0.14, fluffyMat(C.leafDark), 0.37, 0.42, 0.46, { seg: 10 });
  k.ball(0.14, bush, 0.62, 0.43, 0.56, { seg: 10 });
  k.ball(0.12, fluffyMat(C.leafDark), 0.5, 0.42, 0.66, { seg: 10 });
  k.ball(0.12, bush, 0.52, 0.64, 0.46, { seg: 10 });
  const leaves = [[0.4, 0.5], [2.5, 0.45], [4.4, 0.55]];
  leaves.forEach(([a, tilt], i) => {
    k.box(0.12, 0.3, 0.03, i % 2 ? C.leaf : C.leafDark, 0.44, 0.42, 0.485, { rot: [Math.cos(a) * tilt, a, Math.sin(a) * tilt], pivot: [0.5, 0.42, 0.5] });
  });
  if (data.bloom) {
    for (const [x, y, z, c] of [[0.3, 0.5, 0.6, '#FF8FB8'], [0.56, 0.66, 0.58, '#FFE38F'], [0.44, 0.76, 0.52, '#C8A6FF'], [0.6, 0.48, 0.68, '#FFFFFF']]) {
      flower(k, 0.13, c, x, y, z, '#FFF4B8', 0.03);
    }
  }
  return k.build();
}

/** Picture frame on the wall with a cute painting (data.art picks it). */
export function pictureFrame(color = SW.wood[0], data = {}) {
  const k = new Kit();
  const art = Number.isFinite(data.art) ? data.art : Math.max(0, SW.wood.indexOf(color));
  k.box(0.84, 0.84, 0.05, woodMat(color), 0.08, 0.08, 0);
  k.box(0.86, 0.04, 0.06, shade(color, 0.2), 0.07, 0.9, 0);
  k.box(0.66, 0.66, 0.02, paintingMat(art), 0.17, 0.17, 0.05, { faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  k.pixels(['XX.XX', 'XXXXX', 'XX.XX'], 0.04, { X: C.rose }, 0.4, 0.86, 0.06, { depth: 0.03 });
  k.box(0.04, 0.04, 0.04, shade(C.rose, -0.2), 0.48, 0.9, 0.08);
  return k.build();
}

/** Kitty wall clock: hands (parts 'hour', 'minute') show game time; the tail swings. */
export function clock(color = SW.bright[0]) {
  const k = new Kit();
  const cx = 0.5, cy = 0.6;
  k.cyl(0.32, 0.08, color, cx, cy, 0, 20, { rot: [Math.PI / 2, 0, 0] });
  k.box(0.52, 0.52, 0.01, clockFaceMat(color), cx - 0.26, cy - 0.26, 0.08, { faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  for (const sx of [-1, 1]) {
    k.box(0.18, 0.18, 0.07, color, cx + sx * 0.2 - 0.09, cy + 0.2, 0.0, { rot: [0, 0, Math.PI / 4] });
    k.box(0.09, 0.09, 0.02, C.pink, cx + sx * 0.2 - 0.045, cy + 0.24, 0.07, { rot: [0, 0, Math.PI / 4] });
  }
  k.pixels(['XX.XX', 'XXXXX', 'XX.XX'], 0.045, { X: C.rose }, cx - 0.11, cy - 0.36, 0.06, { depth: 0.04 });
  const hour = k.part('hour', cx, cy, 0.095);
  hour.box(0.036, 0.14, 0.012, C.ink, -0.018, -0.02, 0);
  const minute = k.part('minute', cx, cy, 0.108);
  minute.box(0.024, 0.2, 0.012, C.berry, -0.012, -0.02, 0);
  k.ball(0.022, C.gold, cx, cy, 0.12);
  const tail = k.part('tail', cx, cy - 0.32, 0.02);
  tail.box(0.05, 0.22, 0.04, color, -0.025, -0.22, 0);
  tail.pixels(HEART_ROWS, 0.016, { X: C.rose }, -0.056, -0.3, 0.005, { depth: 0.03 });
  return k.build();
}

export { pillow, glow, sheer };
