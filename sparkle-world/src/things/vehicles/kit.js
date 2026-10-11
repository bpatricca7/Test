// Shared model helpers for the fleet (furniture Kit: plain colors and glow() land on the one
// atlas material, glass on one sheer material). Model space as in defs.js: block units, nose
// = +Z, driver on the +X side.
//
// Moving bits go into Kit parts only for live models (build(color, { live: true }): the car
// she drives and friends' cars); a parked car is all static, so its body merges into the
// world's furniture batches. axles(k, live, ...) does both.

import { sheer, glow } from '../furniture/paint.js';
import { shade } from '../../core/util.js';

export const WHITE = '#FFFFFF';
export const INK = '#3A1F4D';
export const TIRE = '#4B3F5E';
export const CHROME = '#E8EEF6';
export const GLASS = () => sheer('#D8F0FF', 0.42);
export const LAMP = () => glow('#FFF3B0', 0.9);
export const TAIL = () => glow('#FF6F8F', 0.7);

/** A disc standing across X (a wheel's face), spanning x0 .. x0 + t, centred at (y, z). */
export function discX(k, r, t, paint, x0, y, z, seg = 18) {
  return k.cyl(r, t, paint, x0, y, z, seg, { rot: [0, 0, -Math.PI / 2] });
}

/** A disc facing +Z (headlamps, dots, portholes), spanning z .. z + t. */
export function discZ(k, r, t, paint, x, y, z, seg = 18) {
  return k.cyl(r, t, paint, x, y, z, seg, { rot: [Math.PI / 2, 0, 0] });
}

/**
 * One wheel at local (x0 .. x0 + t, y, z): tire, white wall, hub. side +1 when the outer face
 * is at x0 + t (the left wheels), -1 when it is at x0.
 */
export function wheel(k, x0, y, z, r, t, side, { hub = WHITE, wall = WHITE, tire = TIRE, knobs = false } = {}) {
  discX(k, r, t, tire, x0, y, z, 20);
  const xo = side > 0 ? x0 + t : x0 - 0.02;
  discX(k, r * 0.68, 0.02, wall, xo, y, z, 18);
  discX(k, r * 0.3, 0.035, hub, side > 0 ? xo + 0.005 : xo - 0.015, y, z, 12);
  if (knobs) {
    // chunky tread blocks round the tire
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      k.box(t * 0.9, 0.07, 0.07, shade(tire, -0.15), x0 + t * 0.05, y + Math.sin(a) * r - 0.035, z + Math.cos(a) * r - 0.035, { rot: [-a, 0, 0] });
    }
  }
  return k;
}

/**
 * The wheels of a car: one axle per z in `axles`, a wheel on each side. Live models put each
 * axle in a part ('axle0', 'axle1'...) whose pivot is the axle, so it can spin about X.
 * minus / plus: [x0, t] of the wheel slabs on the -X and the +X side. Returns the part names.
 */
export function axles(k, live, list, r, minus, plus, opts = {}) {
  const names = [];
  list.forEach((z, i) => {
    const rr = Array.isArray(r) ? r[i] : r;
    const name = 'axle' + i;
    const target = live ? k.part(name, 0, rr, z) : k;
    const y = live ? 0 : rr;
    const zz = live ? 0 : z;
    wheel(target, minus[0], y, zz, rr, minus[1], -1, opts);
    wheel(target, plus[0], y, zz, rr, plus[1], 1, opts);
    names.push(name);
  });
  return names;
}

/** A round headlamp with a chrome ring, facing +Z at z (or -Z when back is true). */
export function headlamp(k, x, y, z, r = 0.13, back = false) {
  const dz = back ? -1 : 1;
  discZ(k, r + 0.03, 0.04, CHROME, x, y, back ? z - 0.04 : z);
  discZ(k, r, 0.03, back ? TAIL() : LAMP(), x, y, back ? z - 0.07 : z + 0.03 * dz);
  return k;
}

/** A small steering wheel facing her (a ring tilted toward the seat), centre (x, y, z). */
export function steeringWheel(k, x, y, z, r = 0.16, color = INK) {
  k.torus(r, 0.028, color, x, y, z, { rot: [-1.15, 0, 0] });
  k.box(0.04, 0.04, 0.3, color, x - 0.02, y - 0.12, z - 0.02, { rot: [0.45, 0, 0] });
  return k;
}

/** A seat: cushion top at (x0..x0+w, y, z0..z0+d) with a back at the rear (-Z) edge. */
export function seat(k, x0, y, z0, w, d, color, backH = 0.42, tufts = null) {
  k.box(w, 0.16, d, color, x0, y - 0.16, z0);
  k.box(w, backH, 0.12, color, x0, y - 0.06, z0 - 0.08, { rot: [-0.18, 0, 0], pivot: [x0, y - 0.06, z0 - 0.02] });
  if (tufts) {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) k.box(0.04, 0.012, 0.04, tufts, x0 + w * (0.3 + i * 0.4) - 0.02, y, z0 + d * (0.3 + j * 0.4) - 0.02);
  }
  return k;
}

/** Bumper bar across the front (+Z face at z) or back. */
export function bumper(k, x0, x1, y, z, color = CHROME, t = 0.1) {
  k.box(x1 - x0, t, 0.1, color, x0, y, z);
  return k;
}

/** A number or a few letters in a 3x5 pixel font, standing, facing +Z (k.pixels). */
const FONT = {
  0: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'], 1: ['.X.', 'XX.', '.X.', '.X.', 'XXX'], 2: ['XXX', '..X', 'XXX', 'X..', 'XXX'],
  3: ['XXX', '..X', '.XX', '..X', 'XXX'], 4: ['X.X', 'X.X', 'XXX', '..X', '..X'], 5: ['XXX', 'X..', 'XXX', '..X', 'XXX'],
  6: ['XXX', 'X..', 'XXX', 'X.X', 'XXX'], 7: ['XXX', '..X', '.X.', '.X.', '.X.'], 8: ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'],
  9: ['XXX', 'X.X', 'XXX', '..X', 'XXX'],
};
export function digits(k, text, px, color, x, y, z, depth = 0.02) {
  const rows = ['', '', '', '', ''];
  for (const ch of String(text)) {
    const g = FONT[ch];
    if (!g) continue;
    for (let r = 0; r < 5; r++) rows[r] += (rows[r] ? '.' : '') + g[r];
  }
  return k.pixels(rows, px, { X: color }, x, y, z, { depth });
}

/** A flat stripe of n alternating colors along +X, standing, facing +Z. */
export function stripe(k, x0, x1, y, h, z, colors, n = 8, depth = 0.02) {
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) k.box(w, h, depth, colors[i % colors.length], x0 + i * w, y, z);
  return k;
}

/** A point on an ellipsoid surface (centre c, radii r) at angles (around Y: a, up: b). */
export function onEllipsoid(c, r, a, b) {
  return [c[0] + Math.cos(b) * Math.sin(a) * r[0], c[1] + Math.sin(b) * r[1], c[2] + Math.cos(b) * Math.cos(a) * r[2]];
}
