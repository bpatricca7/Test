// Bedroom models: beds (the stars of the show), crib, pet bed, wardrobe, dresser, vanity,
// nightstand, toy chest, bookshelf, desk and mirror. Every builder returns a Group in block
// units spanning [0,w]x[0,h]x[0,d] with the front facing +Z (a bed's headboard is at z = 0).

import { Kit } from './kit.js';
import { quiltMat, woodMat, fabricMat, fluffyMat, mirrorMat, glow, sheer, QUILT_PATTERNS } from './paint.js';
import { C, SW, patternFor, pillow, drawer, knob, heart, heartOutlined, flower, legs, BIG_HEART_ROWS, STAR_ROWS, HEART_ROWS } from './palette.js';
import { shade, mixHex } from '../../core/util.js';

const MATTRESS = '#FFFDF8';
const SHEET = '#FFFFFF';

const SINGLE_PATTERNS = ['hearts', 'stars', 'clouds', 'dots', 'flowers', 'patchwork', 'gingham'];
const DOUBLE_PATTERNS = ['patchwork', 'moons', 'stars', 'flowers', 'hearts', 'rainbow', 'dots'];
const CANOPY_PATTERNS = ['hearts', 'stars', 'flowers', 'patchwork', 'moons', 'hearts', 'flowers'];
const BUNK_PATTERNS = ['stars', 'hearts', 'clouds', 'flowers', 'dots', 'patchwork', 'gingham'];

const frameOf = (color) => mixHex(color, C.cream, 0.62);

/** Mattress + quilt + turn-down sheet covering x0..x1, z0..z1 (headboard end at z0). */
function bedding(k, { x0, x1, z0, z1, y, color, pattern, quiltStart = 0.55, cover = 'cover' }) {
  const w = x1 - x0;
  k.box(w - 0.06, 0.14, z1 - z0 - 0.02, MATTRESS, x0 + 0.03, y, z0);
  const qz = z0 + quiltStart;
  const q = quiltMat(color, pattern);
  k.box(w + 0.02, 0.24, z1 - qz, q, x0 - 0.01, y - 0.02, qz);
  k.box(w + 0.02, 0.05, 0.18, shade(color, 0.62), x0 - 0.01, y + 0.2, qz - 0.1);
  k.box(w + 0.02, 0.02, 0.05, shade(color, 0.2), x0 - 0.01, y + 0.24, qz - 0.02);
  // the puffed-up quilt that tucks a sleeper in (shown while someone sleeps here)
  if (cover) {
    const c = k.part(cover, 0, 0, 0, { visible: false });
    const cz = qz + 0.16;
    c.box(w + 0.04, 0.46, z1 - cz + 0.01, q, x0 - 0.02, y + 0.12, cz);
    c.box(w - 0.08, 0.05, z1 - cz - 0.12, q, x0 + 0.04, y + 0.58, cz + 0.08);
    c.box(w + 0.05, 0.1, 0.16, shade(color, 0.62), x0 - 0.025, y + 0.52, cz - 0.02);
    c.box(w + 0.05, 0.03, 0.04, shade(color, 0.2), x0 - 0.025, y + 0.58, cz + 0.1);
  }
  return y + 0.22; // top of the quilt
}

/** Classic headboard: two posts with ball finials, an arched panel and a heart. */
function headboard(k, { x0, x1, z, color, frame, height = 1.0, heartColor, finials = true }) {
  const w = x1 - x0;
  const wood = woodMat(frame);
  k.box(0.1, height, 0.1, wood, x0, 0, z);
  k.box(0.1, height, 0.1, wood, x1 - 0.1, 0, z);
  if (finials) {
    k.ball(0.07, frame, x0 + 0.05, height + 0.04, z + 0.05);
    k.ball(0.07, frame, x1 - 0.05, height + 0.04, z + 0.05);
  }
  const top = height - 0.14;
  k.box(w - 0.2, top - 0.28, 0.06, wood, x0 + 0.1, 0.28, z + 0.02);
  // arched top in steps
  k.box(w - 0.36, 0.08, 0.06, wood, x0 + 0.18, top, z + 0.02);
  k.box(w - 0.6, 0.06, 0.06, wood, x0 + 0.3, top + 0.08, z + 0.02);
  k.box(w - 0.2, 0.04, 0.08, shade(frame, -0.06), x0 + 0.1, top - 0.04, z + 0.01);
  const hs = Math.min(0.34, w * 0.3);
  heart(k, hs, heartColor || color, x0 + w / 2 - hs / 2, top - hs * 0.95, z + 0.08, 0.04);
}

function footboard(k, { x0, x1, z, frame, height = 0.55 }) {
  const wood = woodMat(frame);
  k.box(0.1, height, 0.1, wood, x0, 0, z);
  k.box(0.1, height, 0.1, wood, x1 - 0.1, 0, z);
  k.ball(0.06, frame, x0 + 0.05, height + 0.03, z + 0.05);
  k.ball(0.06, frame, x1 - 0.05, height + 0.03, z + 0.05);
  k.box(x1 - x0 - 0.2, height - 0.28, 0.05, wood, x0 + 0.1, 0.22, z + 0.03);
  k.box(x1 - x0 - 0.2, 0.05, 0.07, shade(frame, -0.06), x0 + 0.1, height - 0.08, z + 0.02);
}

function bedBase(k, { x0, x1, z0, z1, frame, y = 0.12, h = 0.16 }) {
  const wood = woodMat(frame);
  k.box(x1 - x0 - 0.04, h, z1 - z0, wood, x0 + 0.02, y, z0);
  for (const [lx, lz] of [[x0 + 0.04, z0 + 0.04], [x1 - 0.14, z0 + 0.04], [x0 + 0.04, z1 - 0.14], [x1 - 0.14, z1 - 0.14]]) {
    k.box(0.1, y, 0.1, shade(frame, -0.12), lx, 0, lz);
  }
}

export function bedSingle(color = SW.bedding[0]) {
  const k = new Kit();
  const frame = frameOf(color);
  const pattern = patternFor(color, SW.bedding, SINGLE_PATTERNS);
  bedBase(k, { x0: 0, x1: 1, z0: 0.08, z1: 1.9, frame });
  const top = bedding(k, { x0: 0.04, x1: 0.96, z0: 0.1, z1: 1.9, y: 0.28, color, pattern });
  pillow(k, 0.7, 0.15, 0.34, SHEET, 0.15, top - 0.08, 0.16);
  heart(k, 0.24, shade(color, -0.1), 0.38, top + 0.06, 0.4, 0.06);
  headboard(k, { x0: 0, x1: 1, z: 0, color, frame, height: 1.0 });
  footboard(k, { x0: 0, x1: 1, z: 1.9, frame, height: 0.58 });
  return k.build();
}

export function bedDouble(color = SW.bedding[1]) {
  const k = new Kit();
  const frame = frameOf(color);
  const pattern = patternFor(color, SW.bedding, DOUBLE_PATTERNS);
  bedBase(k, { x0: 0, x1: 2, z0: 0.08, z1: 1.9, frame });
  const top = bedding(k, { x0: 0.05, x1: 1.95, z0: 0.1, z1: 1.9, y: 0.28, color, pattern });
  pillow(k, 0.74, 0.16, 0.36, SHEET, 0.16, top - 0.08, 0.15);
  pillow(k, 0.74, 0.16, 0.36, SHEET, 1.1, top - 0.08, 0.15);
  pillow(k, 0.5, 0.14, 0.14, shade(color, 0.35), 0.75, top - 0.04, 0.46);
  flower(k, 0.2, shade(color, -0.12), 0.9, top + 0.02, 0.6, C.butter, 0.02);
  headboard(k, { x0: 0, x1: 2, z: 0, color, frame, height: 1.05 });
  footboard(k, { x0: 0, x1: 2, z: 1.9, frame, height: 0.58 });
  return k.build();
}

/** Princess canopy bed: posts, sheer curtains tied with ribbons, scalloped valance, a heart on top. */
export function bedCanopy(color = SW.bedding[0]) {
  const k = new Kit();
  const frame = mixHex(color, '#FFFFFF', 0.78);
  const gold = C.gold;
  const pattern = patternFor(color, SW.bedding, CANOPY_PATTERNS);
  bedBase(k, { x0: 0.05, x1: 1.95, z0: 0.1, z1: 1.88, frame, h: 0.18 });
  const top = bedding(k, { x0: 0.1, x1: 1.9, z0: 0.12, z1: 1.86, y: 0.3, color, pattern, quiltStart: 0.62 });
  pillow(k, 0.7, 0.18, 0.36, SHEET, 0.2, top - 0.08, 0.16);
  pillow(k, 0.7, 0.18, 0.36, SHEET, 1.1, top - 0.08, 0.16);
  heart(k, 0.34, C.rose, 0.83, top + 0.02, 0.44, 0.08);
  // posts with golden rings
  const wood = woodMat(frame);
  const H = 2.42;
  for (const [px, pz] of [[0, 0], [1.9, 0], [0, 1.9], [1.9, 1.9]]) {
    k.box(0.1, H, 0.1, wood, px, 0, pz);
    for (const ry of [0.62, 1.4, 2.05]) k.box(0.13, 0.05, 0.13, gold, px - 0.015, ry, pz - 0.015);
  }
  // tall headboard with an outlined heart
  k.box(1.8, 1.0, 0.06, wood, 0.1, 0.3, 0.02);
  k.box(1.4, 0.1, 0.06, wood, 0.3, 1.3, 0.02);
  k.box(0.9, 0.08, 0.06, wood, 0.55, 1.4, 0.02);
  heartOutlined(k, 0.62, color, shade(color, 0.55), 0.69, 0.62, 0.08, 0.04);
  footboard(k, { x0: 0, x1: 2, z: 1.9, frame, height: 0.6 });
  // canopy rails, fabric roof (stepped) and a heart on the very top
  const fabric = shade(color, 0.45);
  k.box(2.0, 0.07, 0.1, wood, 0, H, 0);
  k.box(2.0, 0.07, 0.1, wood, 0, H, 1.9);
  k.box(0.1, 0.07, 1.8, wood, 0, H, 0.1);
  k.box(0.1, 0.07, 1.8, wood, 1.9, H, 0.1);
  k.box(1.9, 0.05, 1.9, fabric, 0.05, H + 0.05, 0.05);
  k.box(1.4, 0.07, 1.4, color, 0.3, H + 0.1, 0.3);
  k.box(0.9, 0.07, 0.9, fabric, 0.55, H + 0.17, 0.55);
  k.box(0.4, 0.06, 0.4, color, 0.8, H + 0.24, 0.8);
  k.ball(0.05, gold, 1.0, H + 0.33, 1.0);
  heart(k, 0.28, C.rose, 0.86, H + 0.33, 0.97, 0.06);
  // scalloped valance on all four sides
  const val = color;
  for (let i = 0; i < 8; i++) {
    const x = 0.05 + i * 0.2375;
    for (const z of [-0.01, 1.98]) {
      k.box(0.22, 0.08, 0.03, val, x, H - 0.08, z);
      k.box(0.12, 0.05, 0.03, val, x + 0.05, H - 0.13, z);
    }
    for (const xx of [-0.01, 1.98]) {
      k.box(0.03, 0.08, 0.22, val, xx, H - 0.08, x);
      k.box(0.03, 0.05, 0.12, val, xx, H - 0.13, x + 0.05);
    }
  }
  // sheer curtains gathered at each post with a ribbon tie
  const veil = sheer(mixHex(color, '#FFFFFF', 0.55), 0.5);
  const ribbon = C.rose;
  for (const [cx, cz, sx, sz] of [[0.1, 0.08, 1, 1], [1.72, 0.08, -1, 1], [0.1, 1.74, 1, -1], [1.72, 1.74, -1, -1]]) {
    k.box(0.2, 1.0, 0.18, veil, cx - (sx < 0 ? 0.02 : 0), H - 1.0, cz);
    k.box(0.12, 0.08, 0.14, ribbon, cx + 0.04, H - 1.06, cz + 0.02);
    k.box(0.26, 0.9, 0.2, veil, cx - (sx < 0 ? 0.06 : 0), 0.34, cz - 0.01);
  }
  k.box(1.6, 1.3, 0.02, veil, 0.2, H - 1.3, 0.12);
  k.hitbox(0, 0, 0, 2, 2.7, 2);
  return k.build();
}

/** Bunk bed: sleep on the top or the bottom; a ladder at the foot. */
export function bedBunk(color = SW.bedding[2]) {
  const k = new Kit();
  const frame = mixHex(color, C.wood, 0.35);
  const wood = woodMat(shade(frame, 0.25));
  const pattern = patternFor(color, SW.bedding, BUNK_PATTERNS);
  const i = SW.bedding.indexOf(color);
  const upper = SW.bedding[((i < 0 ? 0 : i) + 3) % SW.bedding.length];
  const upperPattern = patternFor(upper, SW.bedding, BUNK_PATTERNS);
  const H = 2.25;
  for (const [px, pz] of [[0, 0], [0.9, 0], [0, 1.9], [0.9, 1.9]]) {
    k.box(0.1, H, 0.1, wood, px, 0, pz);
    k.ball(0.06, shade(frame, 0.25), px + 0.05, H + 0.03, pz + 0.05);
  }
  // lower bunk
  k.box(0.8, 0.14, 1.8, wood, 0.1, 0.12, 0.1);
  let top = bedding(k, { x0: 0.1, x1: 0.9, z0: 0.1, z1: 1.9, y: 0.26, color, pattern });
  pillow(k, 0.56, 0.14, 0.3, SHEET, 0.22, top - 0.07, 0.14);
  heart(k, 0.2, shade(color, -0.12), 0.4, top + 0.05, 0.36, 0.05);
  // upper bunk
  k.box(0.8, 0.12, 1.8, wood, 0.1, 1.3, 0.1);
  top = bedding(k, { x0: 0.1, x1: 0.9, z0: 0.1, z1: 1.9, y: 1.42, color: upper, pattern: upperPattern, cover: 'cover2' });
  pillow(k, 0.56, 0.14, 0.3, SHEET, 0.22, top - 0.07, 0.14);
  const starPx = 0.24 / 7;
  k.pixels(STAR_ROWS, starPx, { X: C.butter }, 0.38, top + 0.04, 0.36, { depth: 0.05 });
  // head & foot panels, guard rails
  k.box(0.8, 0.5, 0.05, wood, 0.1, 0.2, 0.03);
  k.box(0.8, 0.45, 0.05, wood, 0.1, 1.38, 0.03);
  heart(k, 0.22, color, 0.39, 0.46, 0.08, 0.03);
  heart(k, 0.22, upper, 0.39, 1.58, 0.08, 0.03);
  for (const x of [0.02, 0.92]) {
    k.box(0.06, 0.06, 1.8, wood, x, 1.82, 0.1);
    k.box(0.06, 0.06, 1.8, wood, x, 2.05, 0.1);
    for (let z = 0.35; z < 1.8; z += 0.45) k.box(0.05, 0.23, 0.05, wood, x + 0.005, 1.82, z);
  }
  k.box(0.8, 0.3, 0.05, wood, 0.1, 0.16, 1.92);
  // ladder rungs across the foot posts
  for (let y = 0.55; y < 2.1; y += 0.3) k.box(0.8, 0.05, 0.07, shade(frame, 0.1), 0.1, y, 1.93);
  k.hitbox(0, 0, 0, 1, H + 0.1, 2);
  return k.build();
}

/** A bed with a big heart headboard and heart pillows. */
export function bedHeart(color = SW.bedding[0]) {
  const k = new Kit();
  const frame = mixHex(color, '#FFFFFF', 0.35);
  const pattern = 'hearts';
  bedBase(k, { x0: 0, x1: 2, z0: 0.1, z1: 1.9, frame, h: 0.18 });
  const qcol = mixHex(color, '#FFFFFF', 0.25);
  const top = bedding(k, { x0: 0.05, x1: 1.95, z0: 0.14, z1: 1.9, y: 0.3, color: qcol, pattern });
  heartOutlined(k, 2.0, frame, shade(color, 0.6), 0, 0.12, 0.0, 0.12);
  k.box(1.6, 0.4, 0.06, woodMat(frame), 0.2, 0.2, 0.05);
  heart(k, 0.5, C.rose, 0.3, top - 0.06, 0.2, 0.16);
  heart(k, 0.5, shade(color, 0.3), 1.2, top - 0.06, 0.2, 0.16);
  heart(k, 0.26, '#FFFFFF', 0.87, top - 0.02, 0.44, 0.08);
  // low footboard with a heart
  const wood = woodMat(frame);
  k.box(2.0, 0.42, 0.08, wood, 0, 0.12, 1.9);
  k.box(2.0, 0.06, 0.1, shade(frame, -0.08), 0, 0.52, 1.89);
  heart(k, 0.3, C.rose, 0.85, 0.18, 1.98, 0.03);
  return k.build();
}

/** A fluffy cloud bed with a rainbow and stars. */
export function bedCloud(color = SW.bedding[2]) {
  const k = new Kit();
  const cloud = mixHex(color, '#FFFFFF', 0.85);
  const fluff = fluffyMat(cloud);
  // puffy base
  for (let i = 0; i < 5; i++) {
    const z = 0.2 + i * 0.4;
    k.ball(0.26, fluff, 0.18, 0.24, z, { seg: 10 });
    k.ball(0.26, fluff, 1.82, 0.24, z, { seg: 10 });
  }
  for (const x of [0.6, 1.0, 1.4]) k.ball(0.26, fluff, x, 0.24, 1.78, { seg: 10 });
  k.box(1.7, 0.3, 1.7, cloud, 0.15, 0.1, 0.15);
  const top = bedding(k, { x0: 0.12, x1: 1.88, z0: 0.16, z1: 1.86, y: 0.4, color, pattern: patternFor(color, SW.bedding, ['stars', 'moons', 'clouds', 'stars', 'moons', 'clouds', 'stars']) });
  // rainbow arc behind the cloud headboard
  const bands = ['#FF9EB5', '#FFC48A', '#FFE58A', '#A8E89A', '#8FD0FF', '#C3A6FF'];
  const R = 11, rows = [];
  for (let y = R; y >= 0; y--) {
    let s = '';
    for (let x = -R; x <= R; x++) {
      const d = Math.sqrt(x * x + y * y);
      const band = Math.floor(R - d);
      s += d <= R && band < 6 ? String(band) : '.';
    }
    rows.push(s);
  }
  const map = {};
  bands.forEach((c, i) => { map[String(i)] = c; });
  k.pixels(rows, 2.0 / (2 * R + 1), map, 0, 0.86, 0.02, { depth: 0.06 });
  // cloud headboard
  for (const [x, y, r] of [[0.25, 0.55, 0.3], [0.6, 0.75, 0.38], [1.0, 0.85, 0.42], [1.4, 0.75, 0.38], [1.75, 0.55, 0.3], [0.8, 0.5, 0.35], [1.2, 0.5, 0.35]]) {
    k.ball(r, fluff, x, y, 0.2, { seg: 12, sz: 0.55 });
  }
  // star pillows and a crescent
  const px = 0.36 / 7;
  k.pixels(STAR_ROWS, px, { X: C.butter }, 0.35, top - 0.04, 0.34, { depth: 0.14 });
  k.pixels(STAR_ROWS, px, { X: '#FFF4B8' }, 1.3, top - 0.04, 0.34, { depth: 0.14 });
  pillow(k, 0.5, 0.14, 0.3, SHEET, 0.75, top - 0.06, 0.2);
  for (const [x, y] of [[0.5, 1.3], [1.6, 1.25], [1.05, 1.42]]) k.pixels(['.X.', 'XXX', '.X.'], 0.05, { X: glow('#FFF4B8', 0.6) }, x, y, 0.4, { depth: 0.03 });
  return k.build();
}

/** Baby crib with slats and a slowly turning mobile (part 'mobile'). */
export function crib(color = SW.bedding[0]) {
  const k = new Kit();
  const frame = mixHex(color, '#FFFFFF', 0.7);
  const wood = woodMat(frame);
  for (const [px, pz] of [[0.02, 0.02], [0.88, 0.02], [0.02, 1.88], [0.88, 1.88]]) {
    k.box(0.1, 1.0, 0.1, wood, px, 0, pz);
    k.ball(0.06, frame, px + 0.05, 1.03, pz + 0.05);
  }
  k.box(0.8, 0.1, 1.8, wood, 0.1, 0.22, 0.1);
  const top = bedding(k, { x0: 0.1, x1: 0.9, z0: 0.1, z1: 1.9, y: 0.32, color, pattern: patternFor(color, SW.bedding, ['stars', 'hearts', 'clouds', 'dots', 'flowers', 'moons', 'gingham']) });
  pillow(k, 0.5, 0.12, 0.26, SHEET, 0.25, top - 0.07, 0.15);
  // rails and slats along the long sides
  for (const x of [0.03, 0.9]) {
    k.box(0.07, 0.06, 1.8, wood, x, 0.94, 0.1);
    k.box(0.07, 0.05, 1.8, wood, x, 0.24, 0.1);
    for (let z = 0.2; z < 1.85; z += 0.14) k.box(0.04, 0.66, 0.04, frame, x + 0.015, 0.28, z);
  }
  // head and foot panels with hearts
  for (const z of [0.03, 1.9]) {
    k.box(0.8, 0.72, 0.06, wood, 0.1, 0.26, z);
    heart(k, 0.3, color, 0.35, 0.55, z < 1 ? 0.09 : 1.96, 0.03);
  }
  // mobile arm (part 'mobile' turns)
  k.box(0.06, 0.6, 0.06, frame, 0.04, 1.0, 0.04);
  k.box(0.5, 0.05, 0.05, frame, 0.04, 1.58, 0.04);
  k.box(0.05, 0.05, 0.5, frame, 0.5, 1.58, 0.04);
  const m = k.part('mobile', 0.52, 1.56, 0.5);
  m.cyl(0.18, 0.03, C.butter, 0, -0.05, 0, 10);
  const charms = [[STAR_ROWS, C.butter], [HEART_ROWS, C.rose], [['.XX', 'XX.', 'XX.', '.XX'], '#FFF4B8'], [['.XX.', 'XXXX'], '#FFFFFF']];
  charms.forEach(([rows, col], i) => {
    const a = (i / 4) * Math.PI * 2;
    const cx = Math.cos(a) * 0.16, cz = Math.sin(a) * 0.16;
    m.box(0.008, 0.18, 0.008, '#FFFFFF', cx, -0.23, cz);
    m.pixels(rows, 0.1 / rows[0].length, { X: col }, cx - 0.05, -0.33, cz, { depth: 0.03 });
  });
  k.hitbox(0, 0, 0, 1, 1.6, 2);
  return k.build();
}

/** Round cushion bed for pets, with a little bone. */
export function petBed(color = SW.bedding[0]) {
  const k = new Kit();
  k.cyl(0.4, 0.06, shade(color, -0.1), 0.5, 0, 0.5, 16);
  k.torus(0.32, 0.1, fabricMat(color), 0.5, 0.14, 0.5);
  k.cyl(0.28, 0.1, shade(color, 0.55), 0.5, 0.05, 0.5, 16);
  k.box(0.16, 0.04, 0.05, '#FFFFFF', 0.42, 0.15, 0.55);
  for (const [x, z] of [[0.4, 0.53], [0.4, 0.58], [0.58, 0.53], [0.58, 0.58]]) k.ball(0.028, '#FFFFFF', x, 0.17, z);
  const px = 0.035;
  k.pixels(['X.X', '.X.', 'XXX'], px, { X: shade(color, -0.2) }, 0.45, 0.14, 0.9, { depth: 0.02 });
  return k.build();
}

/** Two-door wardrobe (parts doorL / doorR swing open) with little dresses inside. */
export function wardrobe(color = SW.wood[2]) {
  const k = new Kit();
  const wood = woodMat(color);
  const trim = shade(color, -0.12);
  k.box(1.9, 1.78, 0.84, wood, 0.05, 0.1, 0.08);
  k.box(1.96, 0.12, 0.92, shade(color, 0.12), 0.02, 1.86, 0.05);
  k.box(1.7, 0.05, 0.05, trim, 0.15, 1.8, 0.93);
  for (const [x, z] of [[0.08, 0.12], [1.82, 0.12], [0.08, 0.82], [1.82, 0.82]]) k.box(0.1, 0.1, 0.1, trim, x, 0, z);
  heart(k, 0.2, C.rose, 0.9, 1.88, 0.97, 0.03);
  // inside: back, rail, hangers with dresses
  k.box(1.8, 1.7, 0.02, shade(color, 0.35), 0.1, 0.14, 0.12);
  k.cyl(0.02, 1.7, C.chrome, 0.15, 1.62, 0.5, 6, { rot: [0, 0, -Math.PI / 2] });
  const dresses = ['#FF8FB8', '#9FD8FF', '#FFE38F', '#C8B4FF', '#9BE8CF'];
  dresses.forEach((c, i) => {
    const x = 0.28 + i * 0.32;
    k.box(0.01, 0.08, 0.01, C.chrome, x + 0.1, 1.54, 0.5);
    k.pixels(['.XXX.', '.XXX.', '..X..', '.XXX.', 'XXXXX', 'XXXXX'], 0.045, { X: c }, x, 1.0, 0.44, { depth: 0.1 });
  });
  k.box(1.8, 0.03, 0.7, shade(color, 0.2), 0.1, 0.45, 0.14);
  // doors
  for (const [name, px, dir] of [['doorL', 0.06, 1], ['doorR', 1.94, -1]]) {
    const d = k.part(name, px, 0.14, 0.92);
    const x0 = dir > 0 ? 0 : -0.88;
    d.box(0.88, 1.64, 0.05, wood, x0, 0, 0);
    d.box(0.68, 0.7, 0.02, shade(color, -0.06), x0 + 0.1, 0.82, 0.05);
    d.box(0.68, 0.55, 0.02, shade(color, -0.06), x0 + 0.1, 0.12, 0.05);
    heart(d, 0.2, shade(color, 0.45), x0 + 0.34, 1.05, 0.07, 0.02);
    knob(d, dir > 0 ? 0.78 : -0.78, 0.8, 0.05, C.gold, true);
  }
  return k.build();
}

export function dresser(color = SW.wood[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(1.9, 0.76, 0.84, wood, 0.05, 0.1, 0.06);
  k.box(1.98, 0.06, 0.92, shade(color, 0.1), 0.01, 0.86, 0.03);
  for (const [x, z] of [[0.06, 0.08], [1.84, 0.08], [0.06, 0.8], [1.84, 0.8]]) k.box(0.1, 0.1, 0.1, shade(color, -0.15), x, 0, z);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) drawer(k, 0.1 + c * 0.91, 0.14 + r * 0.24, 0.89, 0.21, 0.9, color, C.gold, true);
  }
  return k.build();
}

/** Vanity with a light-up mirror and perfume bottles. */
export function vanity(color = SW.wood[2]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(2.0, 0.07, 0.74, shade(color, 0.12), 0, 0.74, 0.06);
  for (const x of [0.04, 1.46]) {
    k.box(0.5, 0.64, 0.66, wood, x, 0.1, 0.1);
    drawer(k, x + 0.03, 0.44, 0.44, 0.26, 0.76, color);
    drawer(k, x + 0.03, 0.14, 0.44, 0.26, 0.76, color);
    k.box(0.1, 0.1, 0.1, shade(color, -0.15), x + 0.2, 0, 0.4);
  }
  k.box(0.9, 0.18, 0.05, wood, 0.55, 0.56, 0.72);
  drawer(k, 0.8, 0.58, 0.4, 0.14, 0.77, color);
  // mirror with bulbs
  k.box(1.24, 1.04, 0.08, wood, 0.38, 0.82, 0.08);
  k.box(0.84, 0.12, 0.08, wood, 0.58, 1.86, 0.08);
  k.box(1.0, 0.8, 0.02, mirrorMat(), 0.5, 0.94, 0.16);
  const bulb = glow('#FFF6D8', 0.8);
  for (let i = 0; i < 5; i++) {
    k.ball(0.045, bulb, 0.44, 0.98 + i * 0.19, 0.18);
    k.ball(0.045, bulb, 1.56, 0.98 + i * 0.19, 0.18);
  }
  heart(k, 0.2, C.rose, 0.9, 1.86, 0.17, 0.03);
  // perfume, lipstick, brush
  k.cyl(0.05, 0.12, sheer('#FFB8D6', 0.8), 0.25, 0.81, 0.35, 8);
  k.ball(0.035, C.gold, 0.25, 0.97, 0.35);
  k.cyl(0.045, 0.14, sheer('#C8B4FF', 0.8), 0.4, 0.81, 0.45, 8);
  k.ball(0.03, '#FFFFFF', 0.4, 0.99, 0.45);
  k.box(0.2, 0.03, 0.08, C.pink, 1.6, 0.81, 0.4);
  k.box(0.1, 0.05, 0.12, '#FFFFFF', 1.63, 0.84, 0.38);
  k.cyl(0.025, 0.1, C.gold, 1.8, 0.81, 0.5, 6);
  k.cyl(0.02, 0.04, C.rose, 1.8, 0.91, 0.5, 6);
  return k.build();
}

export function nightstand(color = SW.wood[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(0.7, 0.5, 0.64, wood, 0.15, 0.08, 0.18);
  k.box(0.78, 0.05, 0.72, shade(color, 0.1), 0.11, 0.58, 0.14);
  drawer(k, 0.2, 0.38, 0.6, 0.17, 0.82, color);
  k.box(0.62, 0.22, 0.02, shade(color, -0.2), 0.19, 0.12, 0.8);
  k.box(0.3, 0.06, 0.4, '#9FD8FF', 0.25, 0.14, 0.32);
  k.box(0.3, 0.05, 0.4, '#FF8FB8', 0.27, 0.2, 0.32);
  legs(k, 0.15, 0.18, 0.7, 0.64, 0.08, shade(color, -0.15), 0.08, 0.02);
  return k.build();
}

/** Toy chest; the lid (part 'lid') opens when tapped. */
export function toyChest(color = SW.bright[4]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(0.86, 0.44, 0.6, wood, 0.07, 0.06, 0.2);
  for (const x of [0.07, 0.87]) k.box(0.06, 0.44, 0.62, shade(color, -0.12), x - 0.01, 0.06, 0.19);
  k.box(0.9, 0.06, 0.62, shade(color, -0.12), 0.05, 0.02, 0.19);
  const px = 0.2 / 7;
  k.pixels(STAR_ROWS, px, { X: C.butter }, 0.18, 0.2, 0.8, { depth: 0.02 });
  k.pixels(HEART_ROWS, px, { X: C.rose }, 0.41, 0.22, 0.8, { depth: 0.02 });
  k.pixels(STAR_ROWS, px, { X: '#FFFFFF' }, 0.62, 0.2, 0.8, { depth: 0.02 });
  const lid = k.part('lid', 0.05, 0.5, 0.18);
  lid.box(0.9, 0.08, 0.64, shade(color, 0.12), 0, 0, 0);
  lid.box(0.8, 0.06, 0.54, shade(color, 0.25), 0.05, 0.08, 0.05);
  lid.box(0.14, 0.05, 0.04, C.gold, 0.38, -0.04, 0.63);
  return k.build();
}

const BOOKS = ['#FF8FB8', '#9FD8FF', '#FFD95A', '#B79BFF', '#8FE0B8', '#FFB870', '#FF9E8F', '#FFFFFF', '#6CC6FF'];

function bookRow(k, x0, x1, y, z, depth, seed) {
  let x = x0;
  let i = seed;
  while (x < x1 - 0.06) {
    const w = 0.055 + ((i * 7) % 4) * 0.012;
    const h = 0.24 + ((i * 5) % 5) * 0.025;
    if (x + w > x1) break;
    const col = BOOKS[i % BOOKS.length];
    if (i % 9 === 4 && x + 0.2 < x1) {
      k.box(w, h, depth, col, x + 0.02, y, z, { rot: [0, 0, -0.35], pivot: [x + 0.02 + w, y, z] });
      x += 0.14;
    } else {
      k.box(w, h, depth, col, x, y, z);
      k.box(w, 0.02, depth + 0.005, shade(col, 0.5), x, y + h * 0.7, z);
      x += w + 0.008;
    }
    i++;
  }
}

/** Low bookshelf (1 block) full of storybooks. */
export function bookshelf(color = SW.wood[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(0.06, 0.96, 0.6, wood, 0.03, 0, 0.3);
  k.box(0.06, 0.96, 0.6, wood, 0.91, 0, 0.3);
  k.box(0.94, 0.04, 0.64, shade(color, 0.1), 0.03, 0.94, 0.28);
  k.box(0.82, 0.06, 0.6, wood, 0.09, 0, 0.3);
  k.box(0.82, 0.04, 0.58, wood, 0.09, 0.46, 0.31);
  k.box(0.82, 0.9, 0.02, shade(color, -0.15), 0.09, 0.04, 0.3);
  bookRow(k, 0.1, 0.9, 0.06, 0.4, 0.42, 1);
  bookRow(k, 0.1, 0.9, 0.5, 0.4, 0.42, 5);
  return k.build();
}

/** Tall two-wide bookshelf with books, a plant, a globe and a star trophy. */
export function bookshelfTall(color = SW.wood[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(0.08, 1.94, 0.7, wood, 0.02, 0, 0.25);
  k.box(0.08, 1.94, 0.7, wood, 1.9, 0, 0.25);
  k.box(0.08, 1.94, 0.7, wood, 0.96, 0, 0.25);
  k.box(1.98, 0.06, 0.74, shade(color, 0.1), 0.01, 1.92, 0.23);
  k.box(1.8, 1.9, 0.02, shade(color, -0.18), 0.1, 0.02, 0.25);
  for (const y of [0, 0.48, 0.95, 1.42]) k.box(1.88, 0.05, 0.68, wood, 0.06, y, 0.27);
  bookRow(k, 0.1, 0.95, 0.05, 0.36, 0.5, 2);
  bookRow(k, 1.05, 1.88, 0.05, 0.36, 0.5, 7);
  bookRow(k, 0.1, 0.62, 0.53, 0.36, 0.5, 3);
  bookRow(k, 1.04, 1.88, 1.0, 0.36, 0.5, 11);
  bookRow(k, 0.1, 0.95, 1.47, 0.36, 0.5, 6);
  // plant
  k.cone(0.09, 0.12, 0.16, C.pink, 0.8, 0.53, 0.6, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.box(0.05, 0.2, 0.1, C.leaf, 0.78 + Math.cos(a) * 0.05, 0.66, 0.55 + Math.sin(a) * 0.05, { rot: [Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5] });
  }
  // globe
  k.cyl(0.07, 0.03, C.gold, 0.35, 0.99, 0.6, 8);
  k.cyl(0.012, 0.08, C.gold, 0.35, 1.0, 0.6, 6);
  k.ball(0.14, '#8FD0FF', 0.35, 1.2, 0.6);
  k.box(0.12, 0.08, 0.1, '#9BE38A', 0.3, 1.2, 0.72);
  k.box(0.08, 0.1, 0.06, '#9BE38A', 0.38, 1.26, 0.7);
  // trophy + heart box
  k.box(0.14, 0.04, 0.14, C.gold, 1.5, 1.47, 0.53);
  k.box(0.04, 0.12, 0.04, C.gold, 1.55, 1.51, 0.58);
  k.pixels(STAR_ROWS, 0.035, { X: C.gold }, 1.45, 1.63, 0.58, { depth: 0.04 });
  k.box(0.24, 0.14, 0.2, C.rose, 1.3, 1.0, 0.5);
  heart(k, 0.12, '#FFFFFF', 1.36, 1.02, 0.7, 0.01);
  return k.build();
}

export function desk(color = SW.wood[1]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.box(2.0, 0.06, 0.82, shade(color, 0.08), 0, 0.74, 0.08);
  k.box(0.62, 0.64, 0.72, wood, 1.32, 0.1, 0.12);
  drawer(k, 1.36, 0.44, 0.54, 0.26, 0.84, color);
  drawer(k, 1.36, 0.14, 0.54, 0.26, 0.84, color);
  k.box(0.08, 0.74, 0.08, wood, 0.06, 0, 0.12);
  k.box(0.08, 0.74, 0.08, wood, 0.06, 0, 0.76);
  k.box(0.08, 0.1, 0.08, shade(color, -0.15), 1.34, 0, 0.14);
  k.box(0.08, 0.1, 0.08, shade(color, -0.15), 1.84, 0, 0.74);
  k.box(1.24, 0.4, 0.03, wood, 0.08, 0.32, 0.12);
  // pencil cup, a notebook and a heart sticker
  k.cyl(0.07, 0.14, C.pink, 1.78, 0.8, 0.26, 10);
  ['#FFD95A', '#8FD0FF', '#9BE38A'].forEach((c, i) => k.box(0.025, 0.14, 0.025, c, 1.74 + i * 0.03, 0.9, 0.25 + (i % 2) * 0.02, { rot: [0, 0, (i - 1) * 0.2] }));
  k.box(0.34, 0.03, 0.26, '#C8B4FF', 0.3, 0.8, 0.3, { rot: [0, 0.2, 0] });
  k.box(0.3, 0.01, 0.22, '#FFFFFF', 0.32, 0.83, 0.32, { rot: [0, 0.2, 0] });
  heart(k, 0.12, C.rose, 1.54, 0.2, 0.845, 0.01);
  return k.build();
}

/** Wall mirror with an arched frame and a heart on top. */
export function mirror(color = SW.bright[0]) {
  const k = new Kit();
  const wood = woodMat(mixHex(color, '#FFFFFF', 0.3));
  k.box(0.8, 1.56, 0.06, wood, 0.1, 0.12, 0);
  k.box(0.6, 0.1, 0.06, wood, 0.2, 1.68, 0);
  k.box(0.36, 0.08, 0.06, wood, 0.32, 1.78, 0);
  k.box(0.62, 1.44, 0.02, mirrorMat(), 0.19, 0.2, 0.06);
  k.box(0.42, 0.1, 0.02, mirrorMat(), 0.29, 1.64, 0.06);
  heart(k, 0.26, C.rose, 0.37, 1.8, 0.02, 0.05);
  for (const y of [0.3, 0.8, 1.3]) {
    flower(k, 0.1, shade(color, -0.1), 0.06, y, 0.04, C.butter, 0.02);
    flower(k, 0.1, shade(color, -0.1), 0.84, y + 0.25, 0.04, C.butter, 0.02);
  }
  return k.build();
}

export { QUILT_PATTERNS, BIG_HEART_ROWS };
