// wave 5 (reindeer team, docs/teams/reindeer.md): the Jingle Sleigh [2,3,6], one model: a
// runner sleigh in the swatch color with gold trim and scrolls, a cream seat, two lanterns
// (the headlamps), a little pile of presents, and four reindeer in two rows in front, in a
// harness with jingle bells.
//
// Live models (build(color, { live: true })) put each row of reindeer in a part ('deer0' the
// row by the sleigh, 'deer1' the front row) that bobs, and the legs of each row in two parts
// ('legF0', 'legB0', 'legF1', 'legB1': front and back legs, pivot at the hip) that gallop
// (live.js). A parked sleigh is all static and merges into the furniture batches.
//
// The noses are dark, like every reindeer here: a plain friendly look, nothing borrowed.

import { Kit } from '../furniture/kit.js';
import { shade, mixHex } from '../../core/util.js';
import { WHITE, INK, LAMP, seat } from './kit.js';

export const GOLD = '#F2C14E';
const GOLD_DEEP = '#D9A23A';
const ANTLER = '#E6CFA0';
const HOOF = '#4A3426';
const NOSE = '#3B2A2A';
const CREAM = '#FFF6EA';
const COATS = [['#9C6B45', '#B07C52'], ['#8A5A3A', '#A87148']];
const ROWS = [3.45, 4.95]; // the rows' middle (z)
const XS = [0.52, 1.48]; // the two reindeer of a row (x)
const HIP = 0.62; // leg pivot height
const FRONT = 0.3, BACK = -0.32; // leg rows from the deer's middle

/** Is a hex color light (the snow swatch)? */
function light(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return false;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r + g + b > 600;
}

/**
 * One reindeer (body, head, antlers, collar with a bell, tail) into kit k, middle at (x, cz)
 * in k's space, standing on y = 0.
 */
function deer(k, x, cz, coat, collar) {
  const belly = mixHex(coat, CREAM, 0.55);
  // body, belly, chest ruff, tail
  k.ball(1, coat, x, 0.84, cz, { seg: 16, sx: 0.25, sy: 0.25, sz: 0.5 });
  k.ball(1, belly, x, 0.76, cz + 0.02, { seg: 12, sx: 0.2, sy: 0.17, sz: 0.4 });
  k.ball(0.17, CREAM, x, 0.9, cz + 0.36, { seg: 12, sx: 1, sy: 1.1, sz: 0.8 });
  k.ball(0.07, WHITE, x, 0.95, cz - 0.49, { seg: 8 });
  // neck and head
  k.stick([x, 0.9, cz + 0.32], [x, 1.2, cz + 0.52], 0.15, coat);
  k.ball(0.14, coat, x, 1.27, cz + 0.6, { seg: 14, sy: 0.95, sz: 1.15 });
  k.ball(0.09, belly, x, 1.22, cz + 0.75, { seg: 12, sy: 0.85 });
  k.ball(0.042, NOSE, x, 1.24, cz + 0.835, { seg: 8 });
  for (const s of [-1, 1]) {
    // eyes with a shine, cheeks
    k.ball(0.03, INK, x + s * 0.085, 1.31, cz + 0.67, { seg: 8 });
    k.ball(0.011, WHITE, x + s * 0.09, 1.322, cz + 0.692, { seg: 6 });
    k.ball(0.025, '#FFB3C7', x + s * 0.1, 1.25, cz + 0.7, { seg: 6 });
    // ears out to the side
    k.ball(0.07, coat, x + s * 0.16, 1.35, cz + 0.53, { seg: 8, sx: 1.5, sy: 0.55, sz: 0.8 });
    k.ball(0.04, '#F2B8A0', x + s * 0.17, 1.352, cz + 0.545, { seg: 6, sx: 1.4, sy: 0.4, sz: 0.6 });
    // antlers: a beam up and out, three tines, round tips
    const a = [x + s * 0.06, 1.38, cz + 0.55], b = [x + s * 0.17, 1.6, cz + 0.5], c = [x + s * 0.24, 1.8, cz + 0.42];
    k.stick(a, b, 0.045, ANTLER);
    k.stick(b, c, 0.04, ANTLER);
    k.stick(b, [x + s * 0.12, 1.74, cz + 0.62], 0.035, ANTLER);
    k.stick(b, [x + s * 0.33, 1.66, cz + 0.46], 0.035, ANTLER);
    for (const t of [c, [x + s * 0.12, 1.74, cz + 0.62], [x + s * 0.33, 1.66, cz + 0.46]]) k.ball(0.025, ANTLER, t[0], t[1], t[2], { seg: 6 });
  }
  // the collar round the neck with a gold bell
  k.torus(0.13, 0.035, collar, x, 1.0, cz + 0.4, { rot: [0.95, 0, 0] });
  k.ball(0.055, GOLD, x, 0.9, cz + 0.5, { seg: 10 });
  k.ball(0.018, GOLD_DEEP, x, 0.86, cz + 0.53, { seg: 6 });
  // a harness strap round the middle with a gold buckle
  k.box(0.52, 0.06, 0.08, collar, x - 0.26, 0.97, cz - 0.04);
  k.box(0.08, 0.08, 0.1, GOLD, x - 0.04, 1.06, cz - 0.05);
}

/** One row of two reindeer: in live parts (bobbing row, galloping legs) or static. */
function row(k, r, live, collar) {
  const cz = ROWS[r];
  const body = live ? k.part('deer' + r, 0, 0, cz) : k;
  const z0 = live ? 0 : cz; // the deer's middle in body's space
  const F = live ? body.part('legF' + r, 0, HIP, FRONT) : body;
  const B = live ? body.part('legB' + r, 0, HIP, BACK) : body;
  XS.forEach((x, i) => {
    const coat = COATS[r][i];
    legsInto(F, x, coat, live ? 0 : HIP, live ? 0 : z0 + FRONT);
    legsInto(B, x, coat, live ? 0 : HIP, live ? 0 : z0 + BACK);
    deer(body, x, z0, coat, collar);
  });
}

/** Two legs (left, right) of one deer at one leg row: hip at (hip, z) in kit k's space. */
function legsInto(k, x, coat, hip, z) {
  const dark = shade(coat, -0.12);
  for (const s of [-1, 1]) {
    const lx = x + s * 0.12;
    k.box(0.09, 0.52, 0.09, dark, lx - 0.045, hip - 0.52, z - 0.045);
    k.box(0.11, 0.1, 0.12, HOOF, lx - 0.055, hip - HIP, z - 0.06);
  }
}

/** A gold runner along z at x, with a curl up at the front and a little one at the back. */
function runner(k, x) {
  k.box(0.08, 0.07, 2.45, GOLD, x - 0.04, 0, 0.18);
  const curl = [[2.63, 0.035], [2.84, 0.13], [2.94, 0.34], [2.86, 0.56], [2.66, 0.64], [2.5, 0.52]];
  for (let i = 0; i + 1 < curl.length; i++) k.stick([x, curl[i][1], curl[i][0]], [x, curl[i + 1][1], curl[i + 1][0]], 0.075, GOLD);
  k.ball(0.06, GOLD_DEEP, x, 0.52, 2.5, { seg: 8 });
  k.stick([x, 0.035, 0.18], [x, 0.12, 0.04], 0.07, GOLD);
  k.stick([x, 0.12, 0.04], [x, 0.26, 0.08], 0.065, GOLD);
  // struts up to the sleigh's floor
  for (const z of [0.5, 1.35, 2.2]) k.stick([x, 0.07, z], [x, 0.4, z], 0.06, GOLD_DEEP);
}

/** The Jingle Sleigh. data.live: moving reindeer parts. */
export function sleigh(color, data) {
  const k = new Kit();
  const live = !!(data && data.live);
  const deep = shade(color, -0.16);
  const collar = light(color) ? '#D9283F' : color;
  for (const x of [0.24, 1.76]) runner(k, x);
  // floor
  k.box(1.76, 0.16, 2.5, deep, 0.12, 0.36, 0.12);
  // the sides: a gentle dip in the middle and a high curl at the front, gold along the top
  const n = 12, z0 = 0.12, z1 = 2.72;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const top = 1.2 - 1.0 * u + 1.2 * u * u;
    const z = z0 + (i / n) * (z1 - z0), len = (z1 - z0) / n + 0.005;
    for (const x of [0.08, 1.8]) {
      k.box(0.12, top - 0.5, len, color, x, 0.5, z);
      k.box(0.16, 0.06, len, GOLD, x - 0.02, top, z);
    }
  }
  // gold scrolls on the sides
  for (const [x, s] of [[0.06, -1], [1.94, 1]]) {
    k.torus(0.17, 0.03, GOLD, x, 0.8, 0.85, { rot: [0, 0, Math.PI / 2] });
    k.torus(0.1, 0.025, GOLD, x, 0.82, 1.55, { rot: [0, 0, Math.PI / 2] });
    k.torus(0.13, 0.028, GOLD, x, 1.05, 2.42, { rot: [0, 0, Math.PI / 2] });
    k.ball(0.04, GOLD_DEEP, x + s * 0.01, 0.8, 0.85, { seg: 8 });
  }
  // the tall back with a gold rim and a gold star
  k.box(1.84, 0.98, 0.12, color, 0.08, 0.5, 0.06);
  k.box(1.88, 0.07, 0.16, GOLD, 0.06, 1.48, 0.04);
  for (const x of [0.06, 1.94]) k.ball(0.07, GOLD, x, 1.52, 0.12, { seg: 10 });
  k.cone(0.13, 0.0, 0.05, GOLD, 1.0, 1.0, 0.04, 5, { rot: [-Math.PI / 2, 0, 0] });
  k.cone(0.13, 0.0, 0.05, GOLD, 1.0, 1.0, 0.04, 5, { rot: [-Math.PI / 2, 0, Math.PI] });
  // the front dash, curling up
  k.box(1.6, 0.62, 0.1, color, 0.2, 0.5, 2.6);
  k.box(1.64, 0.06, 0.14, GOLD, 0.18, 1.12, 2.58);
  // the seat (cream, gold buttons) and a little blanket over the front edge
  seat(k, 0.26, 0.8, 0.42, 1.48, 0.9, CREAM, 0.6, GOLD);
  k.box(1.5, 0.05, 0.3, mixHex(color, WHITE, 0.35), 0.25, 0.8, 1.2);
  // presents in the foot well corners
  for (const [x, z, s, c, rb] of [[0.24, 2.1, 0.32, '#3FB27F', '#FFFFFF'], [1.46, 2.05, 0.3, '#5B8CFF', GOLD], [1.5, 1.66, 0.22, '#FF8FB8', '#FFFFFF']]) {
    k.box(s, s, s, c, x, 0.52, z);
    k.box(0.05, s + 0.01, s + 0.01, rb, x + s / 2 - 0.025, 0.52, z - 0.005);
    k.box(s + 0.01, s + 0.01, 0.05, rb, x - 0.005, 0.52, z + s / 2 - 0.025);
    k.ball(0.05, rb, x + s / 2, 0.55 + s, z + s / 2, { seg: 6, sy: 0.6 });
  }
  // two lanterns at the front corners (the headlamps)
  for (const x of [0.18, 1.82]) {
    k.stick([x, 1.1, 2.68], [x, 1.24, 2.68], 0.04, GOLD);
    k.box(0.16, 0.16, 0.16, LAMP(), x - 0.08, 1.24, 2.64);
    k.box(0.2, 0.04, 0.2, GOLD, x - 0.1, 1.4, 2.62);
    k.ball(0.035, GOLD, x, 1.46, 2.72, { seg: 6 });
  }
  // the pole between the reindeer and the reins with jingle bells
  k.stick([1.0, 0.55, 2.7], [1.0, 0.72, 5.2], 0.07, GOLD_DEEP);
  for (const x of XS) {
    const reins = [[0.6 + (x - 1) * 0.3 + 0.4, 1.08, 2.66], [x, 1.02, ROWS[0] - 0.05], [x, 1.02, ROWS[1] - 0.05]];
    for (let i = 0; i + 1 < reins.length; i++) k.stick(reins[i], reins[i + 1], 0.03, '#C0263C');
    for (const t of [0.35, 0.7]) {
      const a = reins[0], b = reins[1];
      k.ball(0.04, GOLD, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 0.03, a[2] + (b[2] - a[2]) * t, { seg: 8 });
    }
  }
  row(k, 0, live, collar);
  row(k, 1, live, collar);
  return k.build();
}
