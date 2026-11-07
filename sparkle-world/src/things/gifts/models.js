// The Gift Workshop's models (wave 5, docs/teams/gifts.md), all built with the furniture Kit so a
// placed piece is one merged mesh per material (the paper patterns are 16 x 16 pixel textures
// on the shared atlas, 48 of them at most):
//   - toyModel(key):      the 16 toys of our own (a unit cell, centred on x, z = 0, bottom y = 0);
//   - giftModel(spec):    a wrapped gift (box, paper, ribbon, bow, a tag);
//   - stageModel(spec):   the Workshop panel's live model with every moving part (the toy, the
//                         open box, the lid, four paper flaps that fold up, two that fold over,
//                         the ribbon and the bow), posed by poseStage();
//   - openedModel(spec):  a gift that was opened (box, lid leaning on it, paper bits, the toy);
//   - workshopModel(c):   the Gift Workshop bench (2 x 2 x 1).
// Nothing here is random: every look comes from the gift spec and the lists in data.js.

import * as THREE from 'three';
import { Kit } from '../furniture/kit.js';
import { paintTexture, material, glow, sheer } from '../furniture/paint.js';
import { shade, mixHex } from '../../core/util.js';
import { foodModel, hasFoodModel } from '../food-models.js';
import * as D from './data.js';

const PI = Math.PI;
const PAPER_SCALE = 4; // pattern tiles per block unit (one tile = a quarter block)
const KRAFT = '#D9B07E'; // the plain box under the paper
const KRAFT_IN = '#C2925C';
const TAG = '#FFFDF4';
const INK = '#3A1F4D';

/** Box sizes (block units): width = depth, height, the lid's height. Round: r is the radius. */
export const SIZES = {
  small: { w: 0.42, h: 0.3, lid: 0.09 },
  tall: { w: 0.32, h: 0.5, lid: 0.08 },
  round: { r: 0.25, h: 0.28, lid: 0.09 },
};
const sizeOf = (k) => SIZES[k] || SIZES.small;
const halfW = (s) => (s.r ? s.r : s.w / 2);

// ---------------------------------------------------------------------------------------------
// paper: one shared pixel texture per paper color x pattern
// ---------------------------------------------------------------------------------------------

/** The patterned paper material (atlas layer) for a paper and pattern key. */
export function paperMat(paperKey, patternKey) {
  const p = D.paper(paperKey), pt = D.pattern(patternKey);
  const key = `gift:paper:${p.key}:${pt.key}`;
  const tex = paintTexture(key, 16, 16, (ctx) => {
    for (let y = 0; y < 16; y++) {
      const row = pt.rows[y] || '';
      for (let x = 0; x < 16; x++) {
        const ch = row[x];
        ctx.fillStyle = ch === 'x' ? p.ink : ch === 'o' ? p.ink2 : p.color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  return material(`gift|paper|${p.key}|${pt.key}`, { map: tex, uvScale: PAPER_SCALE });
}

// ---------------------------------------------------------------------------------------------
// round-box geometry with UVs in block units (a cylinder's own UVs stretch the pattern)
// ---------------------------------------------------------------------------------------------

const geoCache = new Map();
/** An open tube of radius r and height h whose UVs are model-space block units (whole tiles round). */
function tubeGeo(r, h, seg = 24) {
  const key = `tube|${r}|${h}|${seg}`;
  let g = geoCache.get(key);
  if (g) return g;
  g = new THREE.CylinderGeometry(r, r, h, seg, 1, true).translate(0, h / 2, 0);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const around = Math.max(1, Math.round(2 * PI * r * PAPER_SCALE)) / PAPER_SCALE; // whole tiles
  for (let i = 0; i < pos.count; i++) {
    // CylinderGeometry's u runs 0..1 round the side: keep it, scaled to whole tiles
    uv.setXY(i, uv.getX(i) * around, pos.getY(i));
  }
  uv.needsUpdate = true;
  geoCache.set(key, g);
  return g;
}

/** A flat disc (facing up) whose UVs are its x, z in block units. */
function discGeo(r, seg = 24) {
  const key = `disc|${r}|${seg}`;
  let g = geoCache.get(key);
  if (g) return g;
  g = new THREE.CircleGeometry(r, seg).rotateX(-PI / 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
  uv.needsUpdate = true;
  geoCache.set(key, g);
  return g;
}

const _m = new THREE.Matrix4();
/** A paper-covered round shape: tube + top disc (+ bottom disc), base centre at (x, y, z). */
function paperDrum(k, r, h, paint, x = 0, y = 0, z = 0, { top = true, bottom = false } = {}) {
  k.geo(tubeGeo(r, h), paint, _m.makeTranslation(x, y, z));
  if (top) k.geo(discGeo(r), paint, _m.makeTranslation(x, y + h, z));
  if (bottom) k.geo(discGeo(r), paint, new THREE.Matrix4().makeRotationX(PI).premultiply(new THREE.Matrix4().makeTranslation(x, y, z)));
}

// ---------------------------------------------------------------------------------------------
// small drawing helpers (x, z are centres; y is the bottom)
// ---------------------------------------------------------------------------------------------

const cbox = (k, w, h, d, paint, cx, y, cz, opts = null) => k.box(w, h, d, paint, cx - w / 2, y, cz - d / 2, opts);
const eye = (k, x, y, z, r = 0.022) => {
  k.ball(r, INK, x, y, z, { seg: 8 });
  k.ball(r * 0.38, '#FFFFFF', x + r * 0.3, y + r * 0.35, z + r * 0.75, { seg: 6 });
};
const smile = (k, x, y, z, w = 0.04, paint = INK) => {
  k.box(w * 0.5, 0.008, 0.008, paint, x - w * 0.5, y, z, { rot: [0, 0, -0.45] });
  k.box(w * 0.5, 0.008, 0.008, paint, x, y - 0.004, z, { rot: [0, 0, 0.45] });
};
const cheek = (k, x, y, z) => k.ball(0.016, '#FF9EB8', x, y, z, { sy: 0.6, sz: 0.4, seg: 8 });

const BIG_STAR = ['....x....', '...xxx...', 'xxxxxxxxx', '.xxxxxxx.', '..xxxxx..', '..xx.xx..', '.x.....x.'];

// ---------------------------------------------------------------------------------------------
// the 16 toys
// ---------------------------------------------------------------------------------------------

const TOY_DRAW = {
  teddy(k) {
    const fur = '#C68B59', light = '#E8C08F', dark = shade(fur, -0.15);
    // legs, body, arms
    k.ball(0.07, fur, -0.075, 0.06, 0.04, { sy: 0.85 });
    k.ball(0.07, fur, 0.075, 0.06, 0.04, { sy: 0.85 });
    k.ball(0.04, light, -0.075, 0.055, 0.1, { sz: 0.5 });
    k.ball(0.04, light, 0.075, 0.055, 0.1, { sz: 0.5 });
    k.ball(0.12, fur, 0, 0.17, 0, { sy: 1.05 });
    k.ball(0.075, light, 0, 0.16, 0.07, { sz: 0.55 });
    k.ball(0.055, fur, -0.13, 0.2, 0.02, { sy: 1.25, rot: [0, 0, 0.5] });
    k.ball(0.055, fur, 0.13, 0.2, 0.02, { sy: 1.25, rot: [0, 0, -0.5] });
    // head
    k.ball(0.11, fur, 0, 0.36, 0.01);
    k.ball(0.04, fur, -0.085, 0.45, 0, { sz: 0.6 });
    k.ball(0.04, fur, 0.085, 0.45, 0, { sz: 0.6 });
    k.ball(0.022, '#F4A6B8', -0.085, 0.45, 0.022, { sz: 0.4 });
    k.ball(0.022, '#F4A6B8', 0.085, 0.45, 0.022, { sz: 0.4 });
    k.ball(0.048, light, 0, 0.335, 0.09, { sy: 0.8, sz: 0.6 });
    k.ball(0.018, dark, 0, 0.355, 0.12, { sy: 0.8 });
    eye(k, -0.042, 0.385, 0.095, 0.017);
    eye(k, 0.042, 0.385, 0.095, 0.017);
    // a pink bow tie
    k.ball(0.03, '#FF5FA2', -0.03, 0.26, 0.1, { sx: 1.2, sz: 0.5 });
    k.ball(0.03, '#FF5FA2', 0.03, 0.26, 0.1, { sx: 1.2, sz: 0.5 });
    k.ball(0.015, '#FF8CC6', 0, 0.26, 0.115);
  },
  ball(k) {
    k.ball(0.17, '#FF5B6B', 0, 0.17, 0, { seg: 16 });
    k.torus(0.168, 0.018, '#FFD43B', 0, 0.17, 0);
    k.torus(0.168, 0.018, '#4FB3F6', 0, 0.17, 0, { rot: [PI / 2, 0, 0] });
    k.ball(0.04, '#FFFFFF', -0.06, 0.26, 0.11, { sz: 0.4 });
  },
  robot(k) {
    const body = '#8FB4E0', dark = '#5D7FAF';
    cbox(k, 0.06, 0.1, 0.07, dark, -0.06, 0, 0);
    cbox(k, 0.06, 0.1, 0.07, dark, 0.06, 0, 0);
    cbox(k, 0.08, 0.025, 0.1, INK, -0.06, 0, 0.01);
    cbox(k, 0.08, 0.025, 0.1, INK, 0.06, 0, 0.01);
    cbox(k, 0.22, 0.17, 0.15, body, 0, 0.1, 0);
    cbox(k, 0.13, 0.08, 0.01, '#E8F3FF', 0, 0.14, 0.075);
    k.ball(0.014, glow('#FF5B6B', 0.8), -0.035, 0.18, 0.083, { seg: 8 });
    k.ball(0.014, glow('#FFD43B', 0.8), 0, 0.18, 0.083, { seg: 8 });
    k.ball(0.014, glow('#3FD8B0', 0.8), 0.035, 0.18, 0.083, { seg: 8 });
    // arms
    k.stick([-0.11, 0.24, 0], [-0.17, 0.14, 0.02], 0.03, dark);
    k.stick([0.11, 0.24, 0], [0.17, 0.14, 0.02], 0.03, dark);
    k.torus(0.022, 0.009, '#FFD43B', -0.17, 0.13, 0.02, { rot: [PI / 2, 0, 0] });
    k.torus(0.022, 0.009, '#FFD43B', 0.17, 0.13, 0.02, { rot: [PI / 2, 0, 0] });
    // head
    cbox(k, 0.05, 0.03, 0.05, dark, 0, 0.27, 0);
    cbox(k, 0.18, 0.13, 0.14, body, 0, 0.3, 0);
    cbox(k, 0.14, 0.07, 0.01, INK, 0, 0.33, 0.07);
    cbox(k, 0.03, 0.03, 0.006, glow('#6CF0FF', 1), -0.035, 0.35, 0.08);
    cbox(k, 0.03, 0.03, 0.006, glow('#6CF0FF', 1), 0.035, 0.35, 0.08);
    k.box(0.05, 0.01, 0.006, glow('#6CF0FF', 1), -0.025, 0.338, 0.08);
    cbox(k, 0.02, 0.05, 0.05, dark, -0.1, 0.33, 0);
    cbox(k, 0.02, 0.05, 0.05, dark, 0.1, 0.33, 0);
    k.stick([0, 0.43, 0], [0, 0.49, 0], 0.012, INK);
    k.ball(0.022, glow('#FF5B6B', 1), 0, 0.5, 0, { seg: 8 });
  },
  train(k) {
    const red = '#E8424F', gold = '#FFD43B';
    // chassis and wheels
    cbox(k, 0.4, 0.04, 0.17, INK, 0, 0.04, 0);
    for (const x of [-0.13, 0, 0.13]) {
      for (const z of [-0.09, 0.09]) {
        k.cyl(0.05, 0.03, '#3A3A4A', x, 0.05, z + (z > 0 ? -0.015 : 0.015), 12, { rot: [z > 0 ? PI / 2 : -PI / 2, 0, 0] });
        k.cyl(0.02, 0.032, gold, x, 0.05, z + (z > 0 ? -0.015 : 0.015), 8, { rot: [z > 0 ? PI / 2 : -PI / 2, 0, 0] });
      }
    }
    // the boiler (a cylinder lying along x), chimney and dome
    k.cyl(0.075, 0.24, red, 0.2, 0.155, 0, 14, { rot: [0, 0, PI / 2] });
    k.cyl(0.078, 0.02, gold, 0.07, 0.155, 0, 14, { rot: [0, 0, PI / 2] });
    k.cyl(0.078, 0.02, gold, 0.18, 0.155, 0, 14, { rot: [0, 0, PI / 2] });
    k.cyl(0.03, 0.09, INK, 0.13, 0.21, 0, 10);
    k.cone(0.03, 0.045, 0.03, INK, 0.13, 0.3, 0, 10);
    k.ball(0.03, gold, 0.03, 0.23, 0, { sy: 0.8 });
    k.cyl(0.04, 0.012, '#FFF3B0', 0.205, 0.155, 0, 12, { rot: [0, 0, -PI / 2] });
    // the cab
    cbox(k, 0.15, 0.2, 0.17, red, -0.12, 0.08, 0);
    cbox(k, 0.19, 0.03, 0.2, INK, -0.12, 0.28, 0);
    cbox(k, 0.08, 0.07, 0.172, '#BFE4FF', -0.12, 0.18, 0);
    cbox(k, 0.4, 0.015, 0.175, gold, 0, 0.08, 0);
  },
  doll(k) {
    const skin = '#FFD7B5', hair = '#FF8A3D', dress = '#6CC6FF';
    // legs and shoes
    k.cyl(0.022, 0.1, '#FFFFFF', -0.04, 0.02, 0, 8);
    k.cyl(0.022, 0.1, '#FFFFFF', 0.04, 0.02, 0, 8);
    k.ball(0.03, '#FF5FA2', -0.04, 0.02, 0.012, { sy: 0.6, sz: 1.3 });
    k.ball(0.03, '#FF5FA2', 0.04, 0.02, 0.012, { sy: 0.6, sz: 1.3 });
    // dress with an apron and dots
    k.cone(0.13, 0.06, 0.18, dress, 0, 0.1, 0, 14);
    cbox(k, 0.08, 0.08, 0.01, '#FFE3F0', 0, 0.12, 0.1, { rot: [-0.32, 0, 0] });
    for (const [x, y] of [[-0.09, 0.14], [0.09, 0.14], [-0.05, 0.22], [0.05, 0.22]]) k.ball(0.012, '#FFFFFF', x, y, Math.sqrt(Math.max(0, 0.013 - x * x)) * 0.95 + 0.01, { sz: 0.4, seg: 6 });
    // arms
    k.stick([-0.06, 0.26, 0], [-0.12, 0.15, 0.02], 0.03, skin);
    k.stick([0.06, 0.26, 0], [0.12, 0.15, 0.02], 0.03, skin);
    // head, yarn hair, button eyes
    k.ball(0.09, skin, 0, 0.36, 0);
    for (let i = 0; i < 9; i++) {
      const a = -PI * 0.9 + (i / 8) * PI * 1.8;
      k.ball(0.035, hair, Math.sin(a) * 0.085, 0.38 + Math.cos(a) * 0.075, -0.02, { seg: 8 });
    }
    k.ball(0.05, hair, -0.1, 0.3, -0.01, { sy: 1.4, seg: 8 });
    k.ball(0.05, hair, 0.1, 0.3, -0.01, { sy: 1.4, seg: 8 });
    k.cyl(0.016, 0.006, INK, -0.033, 0.37, 0.083, 10, { rot: [PI / 2, 0, 0] });
    k.cyl(0.016, 0.006, INK, 0.033, 0.37, 0.083, 10, { rot: [PI / 2, 0, 0] });
    cheek(k, -0.055, 0.34, 0.075);
    cheek(k, 0.055, 0.34, 0.075);
    smile(k, 0, 0.325, 0.088, 0.04, '#E8424F');
    k.ball(0.03, '#FF5FA2', 0.06, 0.45, 0.02, { sx: 1.3, sz: 0.6 });
  },
  puzzle(k) {
    // a cube of 8 colored blocks with little knobs (a puzzle cube)
    const cols = ['#FF5B6B', '#FFD43B', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FF8CC6', '#FF8A3D', '#6CC468'];
    const s = 0.14;
    let i = 0;
    for (const y of [0, 1]) {
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          const c = cols[i++ % cols.length];
          cbox(k, s - 0.006, s - 0.006, s - 0.006, c, (x * s) / 2, y * s + 0.003, (z * s) / 2);
          if (y === 1) k.cyl(0.03, 0.025, shade(c, 0.1), (x * s) / 2, 2 * s, (z * s) / 2, 10);
          if (z === 1) k.cyl(0.026, 0.012, shade(c, -0.12), (x * s) / 2, y * s + s / 2, s - 0.003, 10, { rot: [PI / 2, 0, 0] });
        }
      }
    }
  },
  kite(k) {
    // a diamond kite leaning on its stand, its tail of bows curling on the ground
    const rows = [
      '....a....', '...aab...', '..aaabb..', '.aaaabbb.', 'aaaaabbbb',
      'cccccdddd', '.ccccddd.', '..cccdd..', '...ccd...', '....c....',
    ];
    const map = { a: '#FFC94D', b: '#FF5B6B', c: '#4FB3F6', d: '#3FD8B0' };
    cbox(k, 0.16, 0.02, 0.1, '#C68B59', 0, 0, 0);
    k.stick([0, 0.02, -0.01], [0, 0.18, -0.01], 0.014, '#C68B59');
    k.pixels(rows, 0.04, map, -0.18, 0.12, -0.01, { depth: 0.012 });
    k.stick([0, 0.12, 0.005], [0, 0.52, 0.005], 0.01, '#8A5A2E');
    k.stick([-0.18, 0.32, 0.005], [0.18, 0.32, 0.005], 0.01, '#8A5A2E');
    // the tail
    const tail = [[0, 0.12, 0.02], [0.08, 0.06, 0.06], [0.16, 0.03, 0.04], [0.22, 0.012, 0.0]];
    for (let i = 0; i < tail.length - 1; i++) k.stick(tail[i], tail[i + 1], 0.008, '#FFFFFF');
    const bows = ['#FF5FA2', '#9C7BFF', '#3FD8B0'];
    for (let i = 1; i < tail.length; i++) {
      const [x, y, z] = tail[i];
      k.ball(0.018, bows[(i - 1) % bows.length], x - 0.012, y, z, { sx: 1.2, sz: 0.5 });
      k.ball(0.018, bows[(i - 1) % bows.length], x + 0.012, y, z, { sx: 1.2, sz: 0.5 });
    }
  },
  drum(k) {
    const red = '#E8424F', gold = '#FFD43B';
    k.cyl(0.15, 0.2, red, 0, 0, 0, 18);
    k.cyl(0.155, 0.025, '#FFFFFF', 0, 0.2, 0, 18);
    k.cyl(0.158, 0.02, gold, 0, 0.19, 0, 18);
    k.cyl(0.158, 0.02, gold, 0, 0, 0, 18);
    // zig-zag cords round the side
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * PI * 2, a1 = ((i + 0.5) / 10) * PI * 2, a2 = ((i + 1) / 10) * PI * 2;
      const p = (a, y) => [Math.sin(a) * 0.153, y, Math.cos(a) * 0.153];
      k.stick(p(a0, 0.02), p(a1, 0.19), 0.008, gold);
      k.stick(p(a1, 0.19), p(a2, 0.02), 0.008, gold);
    }
    // two drumsticks crossed on top
    k.stick([-0.13, 0.23, 0.06], [0.1, 0.25, -0.04], 0.014, '#E7BE8C');
    k.stick([-0.1, 0.25, -0.07], [0.13, 0.23, 0.05], 0.014, '#E7BE8C');
    k.ball(0.02, '#FFFFFF', 0.1, 0.25, -0.04);
    k.ball(0.02, '#FFFFFF', 0.13, 0.23, 0.05);
  },
  rocket(k) {
    const red = '#E8424F', white = '#FFFFFF';
    k.cyl(0.08, 0.28, white, 0, 0.06, 0, 16);
    k.cone(0.08, 0.0, 0.14, red, 0, 0.34, 0, 16);
    k.cyl(0.082, 0.025, red, 0, 0.24, 0, 16);
    k.cone(0.07, 0.05, 0.06, '#8FA3BF', 0, 0.0, 0, 12);
    // three fins
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2 + PI / 6;
      k.box(0.012, 0.13, 0.09, red, Math.sin(a) * 0.1 - 0.006, 0.0, Math.cos(a) * 0.1 - 0.045, { rot: [0, a + PI / 2, 0] });
    }
    // the window
    k.cyl(0.04, 0.02, '#FFD43B', 0, 0.2, 0.072, 14, { rot: [PI / 2, 0, 0] });
    k.cyl(0.03, 0.022, '#6CC6FF', 0, 0.2, 0.074, 14, { rot: [PI / 2, 0, 0] });
    k.ball(0.009, white, -0.01, 0.21, 0.097, { seg: 6 });
    // a little flame
    k.cone(0.04, 0.0, 0.06, glow('#FF9A3D', 0.9), 0, 0.0, 0, 8, { rot: [PI, 0, 0] });
  },
  unicorn(k) {
    const white = '#FFF6FB', mane = ['#FF8CC6', '#9C7BFF', '#6CC6FF', '#FFD43B'];
    // legs, body
    for (const [x, z] of [[-0.07, -0.05], [0.07, -0.05], [-0.07, 0.05], [0.07, 0.05]]) {
      k.cyl(0.03, 0.09, white, x, 0, z, 10);
      k.cyl(0.032, 0.025, '#FFB8F0', x, 0, z, 10);
    }
    k.ball(0.12, white, 0, 0.16, 0, { sx: 1.05, sz: 0.8 });
    // head (looking at you), muzzle, ears, horn
    k.ball(0.095, white, 0, 0.32, 0.05);
    k.ball(0.06, '#FFE3F0', 0, 0.28, 0.12, { sy: 0.8, sz: 0.7 });
    k.ball(0.01, '#E89AB8', -0.02, 0.29, 0.165, { seg: 6 });
    k.ball(0.01, '#E89AB8', 0.02, 0.29, 0.165, { seg: 6 });
    eye(k, -0.042, 0.345, 0.125, 0.017);
    eye(k, 0.042, 0.345, 0.125, 0.017);
    cheek(k, -0.065, 0.31, 0.11);
    cheek(k, 0.065, 0.31, 0.11);
    k.cone(0.025, 0, 0.06, white, -0.055, 0.39, 0.02, 8, { rot: [0, 0, 0.35] });
    k.cone(0.025, 0, 0.06, white, 0.055, 0.39, 0.02, 8, { rot: [0, 0, -0.35] });
    k.cone(0.026, 0, 0.12, '#FFD43B', 0, 0.39, 0.08, 10, { rot: [0.35, 0, 0] });
    k.torus(0.02, 0.006, '#FFB300', 0, 0.42, 0.09, { rot: [0.35, 0, 0] });
    // the rainbow mane and tail
    for (let i = 0; i < 4; i++) k.ball(0.035, mane[i], 0, 0.4 - i * 0.05, -0.04 - i * 0.012, { sx: 0.9, seg: 8 });
    for (let i = 0; i < 3; i++) k.ball(0.035, mane[i + 1], 0, 0.15 - i * 0.03, -0.12 - i * 0.03, { sy: 1.3, seg: 8 });
  },
  paints(k) {
    // an open paint box: the lid stands up at the back with a rainbow, six paints and a brush
    const box = '#FFFFFF', trim = '#6CC6FF';
    cbox(k, 0.36, 0.04, 0.22, trim, 0, 0, 0.02);
    cbox(k, 0.34, 0.005, 0.2, box, 0, 0.04, 0.02);
    const paints = ['#FF5B6B', '#FF8A3D', '#FFD43B', '#6CC468', '#4FB3F6', '#9C7BFF'];
    paints.forEach((c, i) => {
      const x = -0.125 + (i % 3) * 0.125, z = i < 3 ? -0.02 : 0.07;
      k.cyl(0.04, 0.012, shade(c, -0.1), x, 0.04, z, 12);
      k.cyl(0.032, 0.014, c, x, 0.04, z, 12);
    });
    // the lid (standing up at the back)
    cbox(k, 0.36, 0.22, 0.03, trim, 0, 0.04, -0.105, { rot: [-0.25, 0, 0], pivot: [0, 0.04, -0.09] });
    const rows = ['.aaaaaaa.', 'abbbbbbba', 'bcccccccb', 'cdd...ddc', 'de.....ed'];
    k.pixels(rows, 0.032, { a: '#FF5B6B', b: '#FFD43B', c: '#6CC468', d: '#4FB3F6', e: '#9C7BFF' }, -0.144, 0.1, -0.098, { depth: 0.01 });
    // a brush
    k.stick([-0.17, 0.05, 0.11], [0.14, 0.07, 0.13], 0.016, '#E7BE8C');
    k.cone(0.012, 0.004, 0.05, '#9C7BFF', 0.14, 0.07, 0.13, 8, { rot: [0, 0, -PI / 2 - 0.06] });
  },
  book(k) {
    // a story book standing up, a little open, a gold star on the cover
    const cover = '#9C7BFF', pages = '#FFFDF4';
    cbox(k, 0.24, 0.3, 0.03, cover, 0.0, 0, 0.04, { rot: [0, -0.3, 0], pivot: [-0.12, 0, 0.04] });
    cbox(k, 0.24, 0.3, 0.03, shade(cover, -0.08), 0.0, 0, -0.04, { rot: [0, 0.3, 0], pivot: [-0.12, 0, -0.04] });
    cbox(k, 0.025, 0.3, 0.1, shade(cover, -0.15), -0.125, 0, 0);
    // pages in the V
    for (let i = 0; i < 3; i++) cbox(k, 0.2, 0.28, 0.012, pages, 0.0, 0.01, -0.012 + i * 0.012, { rot: [0, (i - 1) * 0.22, 0], pivot: [-0.11, 0, 0] });
    // the star on the front cover (the cover is turned 0.3 rad round its spine)
    const star = new Kit();
    star.pixels(BIG_STAR, 0.02, { x: '#FFD43B' }, -0.09, 0.13, 0.073, { depth: 0.008 });
    star.pixels(['xxxxx'], 0.012, { x: '#FFFFFF' }, -0.03, 0.06, 0.073, { depth: 0.006 });
    const turn = new THREE.Matrix4().makeTranslation(-0.12, 0, 0.04).multiply(new THREE.Matrix4().makeRotationY(-0.3)).multiply(new THREE.Matrix4().makeTranslation(0.12, 0, -0.04));
    mergeMatrix(k, star, turn);
  },
  dino(k) {
    const green = '#6CC468', belly = '#D6F5B8', spikes = '#FFB13D';
    for (const [x, z] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.05], [0.06, 0.05]]) k.cyl(0.035, 0.08, green, x, 0, z, 10);
    k.ball(0.12, green, 0, 0.15, 0, { sz: 1.15 });
    k.ball(0.08, belly, 0, 0.14, 0.07, { sz: 0.6, sy: 1.1 });
    // tail
    k.cone(0.07, 0.015, 0.18, green, 0, 0.12, -0.11, 10, { rot: [-PI / 2 - 0.35, 0, 0] });
    // head and snout (looking at you)
    k.ball(0.09, green, 0, 0.3, 0.07);
    k.ball(0.07, green, 0, 0.27, 0.13, { sx: 1.1, sy: 0.8 });
    k.ball(0.008, shade(green, -0.3), -0.025, 0.285, 0.198, { seg: 6 });
    k.ball(0.008, shade(green, -0.3), 0.025, 0.285, 0.198, { seg: 6 });
    eye(k, -0.04, 0.34, 0.135, 0.018);
    eye(k, 0.04, 0.34, 0.135, 0.018);
    cheek(k, -0.07, 0.29, 0.14);
    cheek(k, 0.07, 0.29, 0.14);
    smile(k, 0, 0.245, 0.19, 0.05);
    // spikes down the back
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const z = 0.06 - t * 0.26, y = 0.38 - t * 0.2 - (t > 0.5 ? (t - 0.5) * 0.15 : 0);
      k.cone(0.03, 0, 0.05, spikes, 0, y - 0.02, z, 6, { rot: [-0.35, 0, 0] });
    }
  },
  car(k) {
    const blue = '#3D8BEA', white = '#FFFFFF';
    cbox(k, 0.42, 0.08, 0.2, blue, 0, 0.05, 0);
    cbox(k, 0.18, 0.07, 0.17, blue, -0.03, 0.13, 0);
    cbox(k, 0.16, 0.055, 0.172, '#BFE4FF', -0.03, 0.135, 0);
    cbox(k, 0.42, 0.012, 0.06, white, 0, 0.13, 0);
    cbox(k, 0.18, 0.012, 0.06, white, -0.03, 0.2, 0);
    // a number circle on the side
    k.cyl(0.032, 0.006, white, 0.1, 0.09, 0.1, 12, { rot: [PI / 2, 0, 0] });
    k.pixels(['xx.', '..x', '.x.', 'xxx'], 0.01, { x: INK }, 0.085, 0.07, 0.106, { depth: 0.004 });
    // spoiler
    cbox(k, 0.06, 0.012, 0.22, INK, -0.2, 0.19, 0);
    k.stick([-0.19, 0.13, -0.07], [-0.2, 0.19, -0.07], 0.012, INK);
    k.stick([-0.19, 0.13, 0.07], [-0.2, 0.19, 0.07], 0.012, INK);
    // wheels
    for (const x of [-0.13, 0.13]) {
      for (const z of [-1, 1]) {
        k.cyl(0.055, 0.04, '#2E2E3A', x, 0.055, z * 0.12, 12, { rot: [z > 0 ? PI / 2 : -PI / 2, 0, 0] });
        k.cyl(0.025, 0.042, '#D5DCEB', x, 0.055, z * 0.12, 8, { rot: [z > 0 ? PI / 2 : -PI / 2, 0, 0] });
      }
    }
    k.cyl(0.02, 0.01, glow('#FFF3B0', 0.8), 0.21, 0.1, 0.06, 8, { rot: [0, 0, -PI / 2] });
    k.cyl(0.02, 0.01, glow('#FFF3B0', 0.8), 0.21, 0.1, -0.06, 8, { rot: [0, 0, -PI / 2] });
  },
  wand(k) {
    // a star wand standing in a little round holder, ribbons trailing from the star
    k.cyl(0.08, 0.04, '#9C7BFF', 0, 0, 0, 14);
    k.cyl(0.085, 0.012, '#FFD43B', 0, 0.035, 0, 14);
    k.stick([0, 0.04, 0], [0, 0.34, 0], 0.018, '#FFFFFF');
    k.pixels(['....x....', '...xxx...', 'xxxxxxxxx', '.xxxxxxx.', '..xxxxx..', '..xx.xx..', '.x.....x.'], 0.032, { x: glow('#FFD43B', 0.55) }, -0.144, 0.3, -0.012, { depth: 0.024 });
    k.ball(0.02, '#FFFFFF', 0, 0.39, 0.016, { sz: 0.4 });
    k.stick([0.02, 0.32, 0.0], [0.08, 0.22, 0.03], 0.008, '#FF8CC6');
    k.stick([-0.02, 0.32, 0.0], [-0.07, 0.24, 0.04], 0.008, '#6CC6FF');
  },
  globe(k) {
    // a snow globe: a wooden base with a gold rim, a tiny tree and a snowman under the glass
    k.cone(0.15, 0.12, 0.08, '#B5651D', 0, 0, 0, 16);
    k.cyl(0.125, 0.02, '#FFD43B', 0, 0.075, 0, 16);
    k.cyl(0.12, 0.012, '#FFFFFF', 0, 0.09, 0, 16);
    k.cone(0.05, 0, 0.11, '#2E9E5B', -0.03, 0.1, -0.01, 8);
    k.cone(0.04, 0, 0.08, '#3CB96E', -0.03, 0.16, -0.01, 8);
    k.ball(0.012, '#FFD43B', -0.03, 0.245, -0.01, { seg: 6 });
    k.ball(0.028, '#FFFFFF', 0.05, 0.12, 0.02, { seg: 8 });
    k.ball(0.02, '#FFFFFF', 0.05, 0.16, 0.02, { seg: 8 });
    k.box(0.012, 0.006, 0.02, '#FF8A3D', 0.044, 0.16, 0.035);
    for (const [x, y, z] of [[0.06, 0.26, -0.04], [-0.08, 0.22, 0.05], [0.02, 0.3, 0.06], [-0.05, 0.31, -0.05], [0.09, 0.2, 0.06]]) k.ball(0.008, '#FFFFFF', x, y, z, { seg: 6 });
    k.ball(0.13, sheer('#DDF2FF', 0.32), 0, 0.2, 0, { seg: 18 });
    k.ball(0.025, sheer('#FFFFFF', 0.6), -0.06, 0.28, 0.08, { sz: 0.4, seg: 8 });
  },
};

/** Draw a toy into kit k, centred on x, z = 0 with its bottom at y = 0 (a unit-cell toy). */
export function drawToy(k, key) {
  const fn = TOY_DRAW[key] || TOY_DRAW.teddy;
  fn(k);
}

/**
 * A toy model, centred with its bottom at 0. opts: { part: its meshes in part `toy` (to hop),
 * cell: on a unit cell's centre (merged flat unless part), hitbox: a pick box round it }.
 */
export function toyModel(key, { part = false, cell = false, hitbox = false } = {}) {
  const k = new Kit();
  const ox = cell ? 0.5 : 0;
  if (part) drawToy(k.part('toy', ox, 0, ox), key);
  else if (cell) {
    const tk = new Kit();
    drawToy(tk, key);
    mergeInto(k, tk, 0.5, 0, 0.5);
  } else drawToy(k, key);
  if (hitbox) k.hitbox(ox - 0.32, 0, ox - 0.32, ox + 0.32, 0.55, ox + 0.32);
  const g = k.build();
  g.name = 'gift:toy:' + key;
  return g;
}

/** What is inside a gift as a model: a toy, or a treat from the basket (centred, bottom 0). */
export function insideModel(inside) {
  const t = D.treatOf(inside);
  if (t) {
    const g = new THREE.Group();
    try {
      const m = foodModel(hasFoodModel(t) ? t : 'cupcake');
      m.scale.multiplyScalar(1.6);
      g.add(m);
    } catch {
      g.add(toyModel('teddy'));
    }
    g.name = 'gift:treat:' + t;
    return g;
  }
  return toyModel(D.toy(inside) ? inside : 'teddy');
}

// ---------------------------------------------------------------------------------------------
// a wrapped gift
// ---------------------------------------------------------------------------------------------

/** The bow on top (in kit k, sitting on y = 0). kind 'bow' | 'puff' | 'star'. */
function drawBow(k, kind, color, s = 1) {
  const dark = shade(color, -0.14);
  if (kind === 'star') {
    // a big ribbon star: five loops and a shiny middle
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2;
      k.ball(0.06 * s, color, Math.sin(a) * 0.055 * s, 0.035 * s, Math.cos(a) * 0.055 * s, { sx: 0.45, sy: 0.55, rot: [0, a, 0], seg: 10 });
    }
    k.ball(0.04 * s, glow(mixHex(color, '#FFFFFF', 0.35), 0.25), 0, 0.05 * s, 0, { seg: 10 });
    return;
  }
  if (kind === 'puff') {
    // a pom-pom bow: many little loops in a ball
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      k.ball(0.05 * s, i % 2 ? color : dark, Math.sin(a) * 0.05 * s, 0.045 * s, Math.cos(a) * 0.05 * s, { sx: 0.5, sy: 0.9, rot: [0, a, 0.8], seg: 8 });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + PI / 4;
      k.ball(0.045 * s, color, Math.sin(a) * 0.025 * s, 0.09 * s, Math.cos(a) * 0.025 * s, { sx: 0.55, sy: 0.9, rot: [0, a, 0.5], seg: 8 });
    }
    k.ball(0.03 * s, color, 0, 0.12 * s, 0, { seg: 8 });
    return;
  }
  // a classic bow: two loops and two tails, facing front
  k.ball(0.065 * s, color, -0.06 * s, 0.05 * s, 0, { sx: 1.1, sy: 0.7, sz: 0.5, rot: [0, 0, 0.35], seg: 10 });
  k.ball(0.065 * s, color, 0.06 * s, 0.05 * s, 0, { sx: 1.1, sy: 0.7, sz: 0.5, rot: [0, 0, -0.35], seg: 10 });
  k.ball(0.035 * s, dark, -0.065 * s, 0.05 * s, 0.01 * s, { sx: 0.8, sy: 0.5, sz: 0.5, rot: [0, 0, 0.35], seg: 8 });
  k.ball(0.035 * s, dark, 0.065 * s, 0.05 * s, 0.01 * s, { sx: 0.8, sy: 0.5, sz: 0.5, rot: [0, 0, -0.35], seg: 8 });
  k.box(0.03 * s, 0.012 * s, 0.09 * s, color, -0.045 * s, 0, 0.02 * s, { rot: [0, 0.5, 0] });
  k.box(0.03 * s, 0.012 * s, 0.09 * s, color, 0.015 * s, 0, 0.02 * s, { rot: [0, -0.5, 0] });
  k.ball(0.03 * s, color, 0, 0.045 * s, 0, { seg: 8 });
}

/** The ribbon bands round a body of half-width hw (or radius) and height h, plus over a lid. */
function drawRibbon(k, size, color, h, band = 0.05) {
  const t = 0.008; // stands proud of the paper
  if (size.r) {
    const r = size.r;
    k.box(band, h + t, 2 * r + 2 * t, color, -band / 2, 0, -r - t);
    k.box(2 * r + 2 * t, h + t, band, color, -r - t, 0, -band / 2);
    return;
  }
  const hw = size.w / 2;
  k.box(band, h + t, size.w + 2 * t, color, -band / 2, 0, -hw - t);
  k.box(size.w + 2 * t, h + t, band, color, -hw - t, 0, -band / 2);
}

/** A little gift tag with a heart hanging off the ribbon at the front. */
function drawTag(k, size, h, ribbonColor) {
  const front = halfW(size) + 0.012;
  const x = size.r ? 0.06 : Math.min(0.08, size.w * 0.22);
  k.box(0.08, 0.06, 0.008, TAG, x - 0.02, h * 0.42, front, { rot: [0, 0, -0.18] });
  k.pixels(['x.x', 'xxx', '.x.'], 0.012, { x: '#FF5B6B' }, x - 0.002, h * 0.42 + 0.014, front + 0.008, { depth: 0.004 });
  k.stick([0.02, h * 0.42 + 0.06, front], [0.0, h * 0.6, front], 0.006, ribbonColor);
}

/**
 * A wrapped gift, centred on x, z = 0, bottom at 0. opts: { tag: show the gift tag, cell: on a
 * unit cell's centre (0.5, 0, 0.5), merged flat so a placed gift batches; parts: the lid (with
 * its ribbon and bow) as part `lid`, the bow as part `bow` and all of it in part `body` (for the
 * wiggle and the pop) }.
 */
export function giftModel(spec, { tag = true, cell = false, parts = false } = {}) {
  const inner = giftKit(spec, { tag, parts: parts && !cell });
  let k = inner;
  if (cell) {
    k = new Kit();
    mergeInto(k, inner, 0.5, 0, 0.5);
    k.hitbox(0.2, 0, 0.2, 0.8, 0.6, 0.8);
  }
  const out = k.build();
  out.name = 'gift:box';
  return out;
}

function giftKit(spec, { tag = true, parts = false } = {}) {
  const g = D.normalizeGift(spec);
  const size = sizeOf(g.box);
  const paint = paperMat(g.paper, g.pattern);
  const rib = D.ribbon(g.ribbon).color;
  const k = new Kit();
  const body = parts ? k.part('body', 0, 0, 0) : k;
  const h = size.h;
  if (size.r) paperDrum(body, size.r, h, paint, 0, 0, 0, { top: false });
  else body.box(size.w, h, size.w, paint, -size.w / 2, 0, -size.w / 2, { faces: { py: null } });
  drawRibbon(body, size, rib, h);
  if (tag) drawTag(body, size, h, rib);
  // the lid: a little wider than the box
  const lid = parts ? body.part('lid', 0, h, 0) : body;
  const ly = parts ? 0 : h;
  const lsize = size.r ? { r: size.r + 0.012 } : { w: size.w + 0.024 };
  if (size.r) paperDrum(lid, lsize.r, size.lid, paint, 0, ly - 0.012, 0, { bottom: true });
  else lid.box(lsize.w, size.lid, lsize.w, paint, -lsize.w / 2, ly - 0.012, -lsize.w / 2);
  const lidTop = ly - 0.012 + size.lid;
  // the ribbon over the lid
  if (size.r) {
    lid.box(0.05, 0.008, 2 * lsize.r + 0.016, rib, -0.025, lidTop, -lsize.r - 0.008);
    lid.box(2 * lsize.r + 0.016, 0.008, 0.05, rib, -lsize.r - 0.008, lidTop, -0.025);
    lid.box(0.05, size.lid + 0.004, 2 * lsize.r + 0.016, rib, -0.025, ly - 0.014, -lsize.r - 0.008);
    lid.box(2 * lsize.r + 0.016, size.lid + 0.004, 0.05, rib, -lsize.r - 0.008, ly - 0.014, -0.025);
  } else {
    drawRibbonLid(lid, lsize.w, rib, ly - 0.014, size.lid + 0.012);
  }
  const s = g.box === 'tall' ? 0.85 : 1;
  if (parts) drawBow(lid.part('bow', 0, lidTop + 0.004, 0), g.bow, rib, s);
  else {
    const b2 = new Kit();
    drawBow(b2, g.bow, rib, s);
    mergeInto(lid, b2, 0, lidTop + 0.004, 0);
  }
  return k;
}

function drawRibbonLid(k, w, color, y, h) {
  const t = 0.006;
  k.box(0.05, h + t, w + 2 * t, color, -0.025, y, -w / 2 - t);
  k.box(w + 2 * t, h + t, 0.05, color, -w / 2 - t, y, -0.025);
}

/** Copy a kit's meshes (parts too, flattened) into kit k through a matrix (both model space). */
function mergeMatrix(k, sub, matrix) {
  const g = sub.build();
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!o.isMesh || o.userData.hitbox) return;
    copyMesh(k, o, matrix.clone().multiply(o.matrixWorld));
    o.geometry.dispose();
  });
}

/** Copy a small kit's meshes into another kit at an offset. */
const mergeInto = (k, sub, x, y, z) => mergeMatrix(k, sub, new THREE.Matrix4().makeTranslation(x, y, z));

/**
 * Append mesh o (built by a Kit) to kit k with matrix mm: its per-vertex colors, layers and glows
 * survive (Kit.geo would paint it one color).
 */
function copyMesh(k, o, mm) {
  const geo = o.geometry;
  const mat = o.material;
  const atlas = !!(mat && mat.userData && mat.userData.atlas);
  if (!atlas) {
    k.geo(geo, mat, mm);
    return;
  }
  const b = k._bucket(mat);
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  const col = geo.attributes.color, lk = geo.attributes.fLook;
  const nm = new THREE.Matrix3().getNormalMatrix(mm);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const base = b.count;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mm);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    b.pos.push(v.x, v.y, v.z);
    b.nor.push(n.x, n.y, n.z);
    b.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    if (b.vc) b.col.push(col ? col.getX(i) : 1, col ? col.getY(i) : 1, col ? col.getZ(i) : 1);
    if (b.look) b.lk.push(lk ? lk.getX(i) : -1, lk ? lk.getY(i) : 0);
  }
  const ix = geo.index;
  if (ix) for (let i = 0; i < ix.count; i++) b.idx.push(base + ix.getX(i));
  else for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
  b.count += pos.count;
}

// ---------------------------------------------------------------------------------------------
// the Workshop panel's stage model (every moving part) and its poses
// ---------------------------------------------------------------------------------------------

/** How much a toy shrinks to fit inside a box (0.5-block toy -> box). */
export function fitScale(boxKey) {
  const s = sizeOf(boxKey);
  const room = Math.min(2 * halfW(s) * 1.25, (s.h + s.lid) * 1.25);
  return Math.max(0.35, Math.min(0.9, room / 0.5));
}

/** The cardboard box, open at the top, walls with an inside (centred, bottom 0). */
function drawOpenBox(k, size) {
  const t = 0.015;
  if (size.r) {
    const n = 16, r = size.r;
    const seg = 2 * r * Math.sin(PI / n) + 0.004;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2;
      const cx = Math.sin(a) * (r - t / 2), cz = Math.cos(a) * (r - t / 2);
      k.box(seg, size.h, t, i % 2 ? KRAFT : shade(KRAFT, -0.03), cx - seg / 2, 0, cz - t / 2, { rot: [0, a, 0], faces: { pz: KRAFT, nz: KRAFT_IN } });
    }
    k.cyl(r - 0.005, 0.01, KRAFT_IN, 0, 0, 0, n);
    return;
  }
  const w = size.w, h = size.h;
  k.box(w, 0.012, w, KRAFT_IN, -w / 2, 0, -w / 2);
  k.box(w, h, t, KRAFT, -w / 2, 0, w / 2 - t, { faces: { nz: KRAFT_IN } });
  k.box(w, h, t, KRAFT, -w / 2, 0, -w / 2, { faces: { pz: KRAFT_IN } });
  k.box(t, h, w - 2 * t, KRAFT, w / 2 - t, 0, -w / 2 + t, { faces: { nx: KRAFT_IN } });
  k.box(t, h, w - 2 * t, KRAFT, -w / 2, 0, -w / 2 + t, { faces: { px: KRAFT_IN } });
}

/**
 * The stage model: parts toy, box (open cardboard), lid (cardboard), the four side flaps
 * flapF/flapB/flapL/flapR (hinged at the bottom edges, lying flat on the table until they fold
 * up), the two top flaps topL/topR, the ribbon (bands), bow and tag. A round box wraps with a
 * paper tube that rises (part `tube`) and a paper disc for the top (part `cap`). A fixed hitbox
 * keeps the camera framing the same in every step.
 */
export function stageModel(spec) {
  const g = D.normalizeGift(spec);
  const size = sizeOf(g.box);
  const paint = paperMat(g.paper, g.pattern);
  const rib = D.ribbon(g.ribbon).color;
  const k = new Kit();
  const H = size.h + size.lid; // the wrapped height (box + lid)
  const hw = halfW(size) + 0.006; // paper sits just outside the box
  // the table cloth under it all: a soft round mat
  k.cyl(0.62, 0.02, '#FFE3F0', 0, -0.02, 0, 28);
  k.torus(0.62, 0.012, '#FFFFFF', 0, -0.005, 0);
  // the toy (scaled to fit at its pose)
  const toy = k.part('toy', 0, 0, 0);
  // drawn later into the part by the caller (a toy or a treat model)
  // the open cardboard box and its lid
  const boxP = k.part('box', 0, 0, 0);
  drawOpenBox(boxP, size);
  const lid = k.part('lid', 0, size.h, 0);
  if (size.r) lid.cyl(size.r + 0.012, size.lid, KRAFT, 0, -0.012, 0, 20);
  else lid.box(size.w + 0.024, size.lid, size.w + 0.024, KRAFT, -size.w / 2 - 0.012, -0.012, -size.w / 2 - 0.012);
  // paper
  if (size.r) {
    const tube = k.part('tube', 0, 0, 0);
    paperDrum(tube, size.r + 0.016, H, paint, 0, 0, 0, { top: false });
    const cap = k.part('cap', 0, H, 0);
    cap.geo(discGeo(size.r + 0.016), paint, _m.makeTranslation(0, 0.002, 0));
    // the sheet it stands on (shrinks away as the tube rises)
    const sheet = k.part('sheet', 0, 0.001, 0);
    sheet.geo(discGeo(size.r + 0.016 + H * 0.8), paint, _m.makeTranslation(0, 0, 0));
  } else {
    const e = 0.004;
    const flap = (name, px, pz, build) => build(k.part(name, px, 0, pz));
    // front: hinge along x at z = +hw; the panel goes up y (folded out: rot.x = +PI/2)
    flap('flapF', 0, hw, (p) => p.box(2 * hw, H, e, paint, -hw, 0, 0));
    flap('flapB', 0, -hw, (p) => p.box(2 * hw, H, e, paint, -hw, 0, -e));
    flap('flapR', hw, 0, (p) => p.box(e, H, 2 * hw + 2 * e, paint, 0, 0, -hw - e));
    flap('flapL', -hw, 0, (p) => p.box(e, H, 2 * hw + 2 * e, paint, -e, 0, -hw - e));
    // the top: two halves hinged at the top of the left and right sides
    const topL = k.part('topL', -hw - e, H, 0);
    topL.box(hw + e + 0.004, e, 2 * hw + 2 * e, paint, 0, 0, -hw - e);
    const topR = k.part('topR', hw + e, H, 0);
    topR.box(hw + e + 0.004, e, 2 * hw + 2 * e, paint, -hw - e - 0.004, 0.001, -hw - e);
  }
  // ribbon bands (scaled up from the middle as they "zip" round), the bow and the tag
  const ribbon = k.part('ribbon', 0, 0, 0);
  const rsize = size.r ? { r: size.r + 0.02 } : { w: 2 * hw + 0.012 };
  drawRibbon(ribbon, rsize, rib, H + 0.004);
  if (size.r) {
    ribbon.box(0.05, 0.008, 2 * rsize.r, rib, -0.025, H + 0.006, -rsize.r);
    ribbon.box(2 * rsize.r, 0.008, 0.05, rib, -rsize.r, H + 0.006, -0.025);
  } else {
    ribbon.box(0.05, 0.008, rsize.w, rib, -0.025, H + 0.006, -rsize.w / 2);
    ribbon.box(rsize.w, 0.008, 0.05, rib, -rsize.w / 2, H + 0.006, -0.025);
  }
  drawTag(ribbon, rsize, H, rib);
  const bow = k.part('bow', 0, H + 0.012, 0);
  drawBow(bow, g.bow, rib, g.box === 'tall' ? 0.85 : 1);
  // a fixed frame: the camera sees the same box in every step
  k.hitbox(-0.6, 0, -0.6, 0.6, 0.95, 0.6);
  const out = k.build();
  out.name = 'gift:stage';
  out.userData.gift = g;
  out.userData.H = H;
  out.userData.size = size;
  return out;
}

const easeIO = (t) => { const v = D.clamp01(t); return v * v * (3 - 2 * v); };

/**
 * Pose the stage model. pose: { toyY, toyS, lid, paper, ribbon, bow } (data.js wrapPose), or a
 * step view: 'toy' | 'box' | 'paper' | 'ribbon' | 'done'. t: seconds (for the gentle bob).
 */
export function poseStage(obj, pose, t = 0) {
  const P = obj && obj.userData.parts;
  if (!P) return;
  const size = obj.userData.size, H = obj.userData.H;
  let p = pose;
  if (typeof pose === 'string') {
    p = {
      toy: { toyY: 0.5, toyS: 1, lid: 0, paper: 0, ribbon: 0, bow: 0, only: 'toy' },
      box: { toyY: 0.1, toyS: 1, lid: 0, paper: 0, ribbon: 0, bow: 0 },
      paper: { toyY: -1, toyS: 0.7, lid: 1, paper: 1, ribbon: 0, bow: 0 },
      ribbon: { toyY: -1, toyS: 0.7, lid: 1, paper: 1, ribbon: 1, bow: 1 },
      done: { toyY: -1, toyS: 0.7, lid: 1, paper: 1, ribbon: 1, bow: 1 },
    }[pose] || { toyY: -1, toyS: 0.7, lid: 1, paper: 1, ribbon: 1, bow: 1 };
  }
  const only = p.only === 'toy';
  const fit = obj.userData.fit || 0.6;
  // the toy: alone it stands big in the middle; with the box it floats above and sinks in
  if (P.toy) {
    if (only) {
      P.toy.position.set(0, 0.02 + Math.sin(t * 2.2) * 0.015, 0);
      P.toy.scale.setScalar(1.35);
      P.toy.visible = true;
    } else {
      // toyY: 0.5 above the box .. 0 resting on the rim .. -1 down inside
      const top = size.h + 0.02;
      const y = p.toyY >= 0 ? top + p.toyY * 0.25 + Math.sin(t * 2.2) * 0.01 : top * (1 + p.toyY) + 0.012 * -p.toyY;
      P.toy.position.set(0, Math.max(0.012, y), 0);
      P.toy.scale.setScalar(fit * (p.toyS ?? 1));
      P.toy.visible = p.lid < 0.98 || p.paper <= 0;
    }
  }
  if (P.box) P.box.visible = !only && p.paper < 0.999;
  if (P.lid) {
    P.lid.visible = !only && p.paper < 0.999;
    // open: up and to the right, tilted; shut: on the box
    const o = 1 - easeIO(p.lid);
    P.lid.position.set(o * (halfW(size) + 0.18), size.h + o * 0.22, 0);
    P.lid.rotation.set(0, 0, -o * 0.9);
  }
  const paper = D.clamp01(p.paper);
  if (P.flapF) {
    const side = (1 - easeIO(paper / 0.6)) * (PI / 2);
    const show = !only && paper > 0;
    P.flapF.rotation.set(side, 0, 0);
    P.flapB.rotation.set(-side, 0, 0);
    P.flapR.rotation.set(0, 0, -side);
    P.flapL.rotation.set(0, 0, side);
    for (const n of ['flapF', 'flapB', 'flapR', 'flapL']) P[n].visible = show;
    const top = (1 - easeIO((paper - 0.6) / 0.4)) * (PI / 2);
    P.topL.rotation.set(0, 0, top);
    P.topR.rotation.set(0, 0, -top);
    P.topL.visible = P.topR.visible = !only && paper > 0.58;
  }
  if (P.tube) {
    const rise = easeIO(paper / 0.75);
    P.tube.scale.set(1, Math.max(0.001, rise), 1);
    P.tube.visible = !only && paper > 0;
    P.sheet.visible = !only && paper > 0 && rise < 0.98;
    P.sheet.scale.setScalar(Math.max(0.05, 1 - rise * 0.85));
    P.cap.visible = !only && paper > 0.75;
    P.cap.scale.setScalar(Math.max(0.05, easeIO((paper - 0.75) / 0.25)));
  }
  if (P.ribbon) {
    const r = D.clamp01(p.ribbon);
    P.ribbon.visible = !only && r > 0;
    // the bands spread out from the middle line
    P.ribbon.scale.set(Math.max(0.02, r), 1, Math.max(0.02, r));
  }
  if (P.bow) {
    const b = Math.max(0, p.bow);
    P.bow.visible = !only && b > 0.01;
    P.bow.scale.setScalar(Math.max(0.01, b));
    P.bow.rotation.y = (1 - D.clamp01(b)) * 2.4;
  }
  void H;
}

/** Fill the stage model's `toy` part with what is inside (its own model; disposed with it). */
export function putInside(obj, inside) {
  const P = obj && obj.userData.parts;
  if (!P || !P.toy) return;
  const m = insideModel(inside);
  P.toy.add(m);
  obj.userData.fit = fitScale(obj.userData.gift.box);
}

// ---------------------------------------------------------------------------------------------
// an opened gift
// ---------------------------------------------------------------------------------------------

/**
 * An opened gift on a unit cell: the open box, its lid leaning on the side, torn paper bits
 * round it and the toy sitting up out of the box. live: the toy is part `toy` (to hop on a tap);
 * otherwise everything is merged flat (a placed piece batches).
 */
export function openedModel(spec, { live = false } = {}) {
  const g = D.normalizeGift(spec);
  const size = sizeOf(g.box);
  const paint = paperMat(g.paper, g.pattern);
  const rib = D.ribbon(g.ribbon).color;
  const c = new Kit();
  // the box (paper still round its lower half) and the lid leaning on its right
  drawOpenBox(c, size);
  if (size.r) paperDrum(c, size.r + 0.006, size.h * 0.45, paint, 0, 0, 0, { top: false });
  else c.box(size.w + 0.012, size.h * 0.45, size.w + 0.012, paint, -size.w / 2 - 0.006, 0, -size.w / 2 - 0.006, { faces: { py: null, ny: null } });
  const hw = halfW(size);
  const lw = 2 * hw + 0.024;
  c.box(lw, size.lid, lw, paint, hw + 0.03, 0.0, -lw / 2, { rot: [0, 0, 1.15], pivot: [hw + 0.03, 0, 0] });
  // paper bits and a loose ribbon on the floor
  const bits = [[-0.3, 0.2, 0.6], [0.28, 0.24, 2.2], [-0.24, -0.27, 1.3], [0.05, 0.34, 0.2], [0.33, -0.12, 2.9], [-0.36, -0.04, 1.9]];
  for (const [x, z, a] of bits) c.box(0.07, 0.006, 0.05, paint, x, 0.002, z, { rot: [0, a, 0.08] });
  c.stick([-0.33, 0.01, 0.12], [-0.12, 0.012, 0.28], 0.014, rib);
  c.stick([-0.12, 0.012, 0.28], [0.02, 0.01, 0.36], 0.014, rib);
  const k = new Kit();
  mergeInto(k, c, 0.5, 0, 0.5);
  // the toy, up out of the box
  const sc = Math.min(1, fitScale(g.box) * 1.25);
  const ty = size.h * 0.55;
  if (D.treatOf(g.inside)) {
    // a treat: its own model, added as an object
    const m = insideModel(g.inside);
    m.scale.multiplyScalar(sc);
    if (live) k.part('toy', 0.5, ty, 0.5).add(m);
    else { m.position.set(0.5, ty, 0.5); k.add(m); }
  } else {
    const tk = new Kit();
    drawToy(tk, D.toy(g.inside) ? g.inside : 'teddy');
    const m = new THREE.Matrix4().makeScale(sc, sc, sc);
    if (live) mergeMatrix(k.part('toy', 0.5, ty, 0.5), tk, m);
    else mergeMatrix(k, tk, m.premultiply(new THREE.Matrix4().makeTranslation(0.5, ty, 0.5)));
  }
  k.hitbox(0.12, 0, 0.12, 0.88, 0.75, 0.88);
  const out = k.build();
  out.name = 'gift:opened';
  return out;
}

// ---------------------------------------------------------------------------------------------
// the Gift Workshop bench (2 x 2 x 1, front +Z)
// ---------------------------------------------------------------------------------------------

export const WORKSHOP_COLORS = ['#E8424F', '#2E9E5B', '#3D8BEA', '#FF7EB6'];
const SIGN = ['xxx.x.xxx.xxx.xxx', 'x...x.x....x..x..', 'x.x.x.xx...x..xxx', 'x.x.x.x....x....x', 'xxx.x.x....x..xxx'];

export function workshopModel(color = WORKSHOP_COLORS[0]) {
  const c = color || WORKSHOP_COLORS[0];
  const k = new Kit();
  const wood = '#E7BE8C', woodDark = '#C98F55', cream = '#FFF6E6', gold = '#FFD43B';
  // the bench: a cabinet with drawers and a thick wooden top
  k.box(1.94, 0.82, 0.86, c, 0.03, 0, 0.1);
  for (let i = 0; i < 3; i++) {
    const x = 0.1 + i * 0.62;
    k.box(0.56, 0.3, 0.02, shade(c, 0.12), x, 0.42, 0.96);
    k.box(0.56, 0.3, 0.02, shade(c, 0.12), x, 0.08, 0.96);
    k.ball(0.035, gold, x + 0.28, 0.57, 0.99, { sz: 0.6 });
    k.ball(0.035, gold, x + 0.28, 0.23, 0.99, { sz: 0.6 });
  }
  k.box(2, 0.1, 0.95, wood, 0, 0.82, 0.05);
  k.box(2, 0.02, 0.95, woodDark, 0, 0.82, 0.05);
  // the back board with a frame
  k.box(2, 1.08, 0.08, cream, 0, 0.92, 0.04);
  k.box(2, 0.06, 0.1, c, 0, 1.94, 0.03);
  k.box(0.06, 1.08, 0.1, c, 0, 0.92, 0.03);
  k.box(0.06, 1.08, 0.1, c, 1.94, 0.92, 0.03);
  // the glowing GIFTS sign
  k.box(1.06, 0.36, 0.04, '#7A3B8F', 0.47, 1.52, 0.12);
  k.pixels(SIGN, 0.055, { x: glow('#FFE38A', 0.9) }, 0.535, 1.56, 0.16, { depth: 0.02 });
  // little glowing bulbs along the top
  const bulbs = ['#FF5B6B', '#FFD43B', '#3FD8B0', '#6CC6FF', '#FF8CC6'];
  for (let i = 0; i < 11; i++) {
    const x = 0.1 + i * 0.18;
    const y = 1.9 - Math.sin((i / 10) * PI) * 0.06;
    k.ball(0.028, glow(bulbs[i % bulbs.length], 0.9), x, y, 0.15, { seg: 8 });
  }
  k.stick([0.08, 1.92, 0.14], [1.92, 1.92, 0.14], 0.008, '#2E9E5B');
  // three paper rolls on a rod (the papers she can pick)
  k.stick([0.08, 1.3, 0.2], [0.42, 1.3, 0.2], 0.02, woodDark);
  k.stick([1.58, 1.62, 0.2], [1.92, 1.62, 0.2], 0.02, woodDark);
  const rolls = [['red', 'stars', 1.05], ['blue', 'snow', 1.3], ['green', 'candy', 1.55]];
  const rolls2 = [['pink', 'hearts', 1.5], ['gold', 'dots', 1.72]];
  rolls.forEach(([p, pt, y], i) => {
    k.cyl(0.06, 0.3, paperMat(p, pt), 0.1, y - 0.06 + i * 0, 0.2, 16, { rot: [0, 0, -PI / 2] });
  });
  rolls2.forEach(([p, pt, y]) => k.cyl(0.06, 0.3, paperMat(p, pt), 1.6, y, 0.2, 16, { rot: [0, 0, -PI / 2] }));
  // a ribbon spool, scissors and tape on the bench
  k.cyl(0.08, 0.06, '#FF5FA2', 0.3, 0.92, 0.55, 14);
  k.cyl(0.03, 0.065, cream, 0.3, 0.92, 0.55, 8);
  k.stick([0.36, 0.95, 0.58], [0.6, 0.925, 0.72], 0.025, '#FF5FA2');
  k.stick([0.62, 0.925, 0.84], [0.8, 0.925, 0.66], 0.016, '#D5DCEB');
  k.stick([0.66, 0.925, 0.66], [0.8, 0.925, 0.84], 0.016, '#D5DCEB');
  k.torus(0.03, 0.01, '#FF8A3D', 0.6, 0.93, 0.86);
  k.torus(0.03, 0.01, '#FF8A3D', 0.64, 0.93, 0.62);
  k.box(0.14, 0.07, 0.07, '#9C7BFF', 1.42, 0.92, 0.82);
  k.cyl(0.03, 0.072, '#FFFFFF', 1.47, 0.92, 0.855, 10, { rot: [0, 0, PI / 2] });
  // a half-wrapped gift in the middle (paper up the sides, ribbon round it, no bow yet)
  const mid = new Kit();
  drawOpenBox(mid, SIZES.small);
  mid.box(0.43, 0.2, 0.43, paperMat('purple', 'stars'), -0.215, 0, -0.215, { faces: { py: null, ny: null } });
  mid.box(0.6, 0.004, 0.6, paperMat('purple', 'stars'), -0.3, -0.004, -0.3);
  mergeInto(k, mid, 1.02, 0.925, 0.52);
  // a stack of finished gifts at the right end
  const gA = new Kit();
  gA.box(0.3, 0.22, 0.3, paperMat('red', 'dots'), -0.15, 0, -0.15);
  drawRibbon(gA, { w: 0.3 }, '#FFD34D', 0.22);
  gA.box(0.3, 0.2, 0.3, paperMat('mint', 'stripes'), -0.13, 0.225, -0.17, { rot: [0, 0.3, 0] });
  drawRibbon(gA, { w: 0.3 }, '#FF6FA8', 0.2);
  const bowA = new Kit();
  drawBow(bowA, 'bow', '#FF6FA8', 0.8);
  mergeInto(gA, bowA, 0.02, 0.43, -0.02);
  mergeInto(k, gA, 1.72, 0.925, 0.55);
  const out = k.build();
  out.name = 'gift:workshop';
  return out;
}

/** The held gift (in her hand): the wrapped gift scaled down, bottom in the palm. */
export function heldGiftModel(spec) {
  const inner = giftModel(spec, { tag: false });
  const g = new THREE.Group();
  inner.position.set(0, -0.06, 0);
  inner.scale.setScalar(0.72);
  g.add(inner);
  g.name = 'gift:held';
  return g;
}

/** A friend's toy in hand (scaled, bottom in the palm). */
export function heldToyModel(inside) {
  const inner = insideModel(inside);
  const g = new THREE.Group();
  inner.position.set(0, -0.08, 0.02);
  inner.scale.multiplyScalar(0.62);
  g.add(inner);
  g.name = 'gift:toyheld';
  return g;
}
