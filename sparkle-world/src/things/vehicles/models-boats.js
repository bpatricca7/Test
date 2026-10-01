// Boats: the Speedboat, the Swan Boat and the Sailboat (furniture Kit). The waterline is at
// model y = 0.85: a parked boat stands in the top water cell, whose surface is drawn at
// +0.875, so the water covers the bottom edge of the hull.
//
// Everything sits in a part 'hull' (pivot at the model origin) so a parked boat can bob
// (def.update in index.js); boats are not batched (about two draw calls each). Live models
// (build(color, { live: true })) also get spinning parts: 'prop' (Speedboat), 'paddle' (Swan
// Boat) and a 'sail' that billows with speed (Sailboat).

import { Kit } from '../furniture/kit.js';
import { shade, mixHex } from '../../core/util.js';
import { WHITE, INK, CHROME, GLASS, TAIL, LAMP, discZ, steeringWheel, seat } from './kit.js';

export const WATERLINE = 0.85;

/**
 * A hull: flat-bottomed tub with thin walls round an open cockpit, a bow that narrows toward
 * the front. paint = [lower, upper, deck].
 */
function hull(k, [lower, upper, deck], { z0 = 0.1, bow = 3.0, nose = 3.95, x0 = 0.12, x1 = 1.88, floor = 0.95, rim = 1.22 } = {}) {
  const w = x1 - x0;
  // bottom and the walls round the cockpit
  k.box(w, floor - 0.45, bow - z0, lower, x0, 0.45, z0);
  for (const x of [x0, x1 - 0.1]) k.box(0.1, rim - floor, bow - z0, upper, x, floor, z0);
  k.box(w, rim - floor, 0.12, upper, x0, floor, z0);
  for (const x of [x0 - 0.02, x1 - 0.06]) k.box(0.08, 0.05, bow - z0, deck, x, rim, z0);
  // the bow: slices that narrow and lift toward the nose
  const n = 6, len = nose - bow;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const half = (w / 2) * (1 - u * u * 0.85);
    const lift = u * 0.35;
    const cx = (x0 + x1) / 2;
    k.box(half * 2, floor - 0.45 - lift + 0.02, len / n, lower, cx - half, 0.45 + lift, bow + u * len);
    k.box(half * 2, rim - floor + 0.02, len / n, upper, cx - half, floor - 0.02, bow + u * len);
    k.box(half * 2 - 0.02, 0.05, len / n, deck, cx - half + 0.01, rim, bow + u * len);
  }
}

// ---------- Speedboat [2,2,4]: windshield, racing stripe, outboard motor ----------

export function speedboat(color, data) {
  const k = new Kit();
  const live = !!(data && data.live);
  const h = k.part('hull', 0, 0, 0);
  const dark = shade(color, -0.2);
  hull(h, [color, color, WHITE]);
  // front deck over the bow and a racing stripe down both sides
  h.box(1.7, 0.06, 0.8, WHITE, 0.15, 1.18, 2.25);
  for (const [x, s] of [[0.12, -1], [1.88, 1]]) {
    h.box(0.02, 0.08, 2.6, WHITE, s > 0 ? x : x - 0.02, 0.98, 0.3);
    h.box(0.02, 0.05, 2.6, dark, s > 0 ? x : x - 0.02, 0.9, 0.3);
  }
  // windshield, seats, the wheel
  h.box(1.4, 0.36, 0.03, GLASS(), 0.3, 1.2, 2.2, { rot: [-0.45, 0, 0], pivot: [0, 1.2, 2.24] });
  h.box(1.44, 0.04, 0.05, CHROME, 0.28, 1.2, 2.2);
  seat(h, 0.65, 1.05, 1.35, 0.7, 0.5, WHITE, 0.44);
  seat(h, 0.3, 1.05, 0.35, 1.4, 0.42, WHITE, 0.36);
  h.box(0.5, 0.2, 0.16, INK, 0.75, 1.0, 2.0);
  steeringWheel(h, 1.0, 1.32, 1.95, 0.13, INK);
  // the outboard motor at the back with its propeller
  h.box(0.36, 0.42, 0.26, WHITE, 0.82, 0.95, -0.04);
  h.box(0.4, 0.1, 0.3, dark, 0.8, 1.32, -0.06);
  h.box(0.12, 0.5, 0.1, '#8E82A8', 0.94, 0.48, 0.02);
  const p = live ? h.part('prop', 1.0, 0.5, 0.0) : h;
  const [px, py, pz] = live ? [0, 0, 0] : [1.0, 0.5, 0.0];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    p.box(0.07, 0.17, 0.03, CHROME, px - 0.035, py, pz - 0.05, { rot: [0, 0, a], pivot: [px, py, pz - 0.035] });
  }
  // a life ring on the side, little bow lamps, tail lamps
  h.torus(0.16, 0.05, WHITE, 1.92, 1.02, 1.0, { rot: [0, 0, Math.PI / 2] });
  for (const z of [0.86, 1.14]) h.box(0.11, 0.12, 0.06, '#FF5F7F', 1.86, 0.96, z - 0.03);
  for (const x of [0.7, 1.3]) h.box(0.1, 0.07, 0.06, LAMP(), x - 0.05, 1.24, 3.62);
  for (const x of [0.3, 1.7]) discZ(h, 0.05, 0.03, TAIL(), x, 1.08, 0.07);
  return k.build();
}

// ---------- Swan Boat [2,2,3]: a long neck, a bow tie, wings and a paddle wheel ----------

export function swanBoat(color, data) {
  const k = new Kit();
  const live = !!(data && data.live);
  const h = k.part('hull', 0, 0, 0);
  const light = mixHex(color, WHITE, 0.5), deep = shade(color, -0.1);
  // body: a low egg, the bench seat and a rim
  h.ball(1, color, 1.0, 0.72, 1.45, { seg: 20, sx: 0.9, sy: 0.42, sz: 1.32 });
  h.box(1.5, 0.08, 1.3, light, 0.25, 0.98, 0.75);
  seat(h, 0.55, 1.0, 0.85, 0.9, 0.5, '#FF9CCB', 0.4, WHITE);
  // wings along both sides: layered feathers
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = 0.65 + i * 0.32;
      h.ball(0.34 - i * 0.03, i % 2 ? WHITE : light, 1.0 + s * 0.86, 1.06 + i * 0.03, z, { seg: 12, sx: 0.22, sy: 0.55 });
    }
  }
  // the neck curving up from the front to the head
  const neck = [[2.45, 1.0, 0.17], [2.62, 1.22, 0.16], [2.7, 1.45, 0.15], [2.66, 1.66, 0.14], [2.56, 1.84, 0.14]];
  for (const [z, y, r] of neck) h.ball(r, color, 1.0, y, z, { seg: 12 });
  h.ball(0.21, color, 1.0, 2.0, 2.58, { seg: 14 });
  h.cone(0.08, 0.02, 0.24, '#FF9F43', 1.0, 1.96, 2.74, 10, { rot: [Math.PI / 2, 0, 0] });
  for (const s of [-1, 1]) {
    h.ball(0.035, INK, 1.0 + s * 0.15, 2.05, 2.7, { seg: 8 });
    h.ball(0.03, '#FFB3C7', 1.0 + s * 0.17, 1.95, 2.68, { seg: 8 });
  }
  // a pink bow tie at the bottom of the neck
  for (const s of [-1, 1]) h.cone(0.1, 0.02, 0.16, '#FF5FA2', 1.0, 1.12, 2.62, 8, { rot: [0, 0, s * Math.PI / 2] });
  h.ball(0.05, '#FF5FA2', 1.0, 1.12, 2.62, { seg: 8 });
  // a curly tail
  h.ball(0.16, deep, 1.0, 1.1, 0.24, { seg: 10 });
  h.ball(0.11, color, 1.0, 1.26, 0.18, { seg: 10 });
  // the paddle wheel at the back (in the water)
  const p = live ? h.part('paddle', 1.0, 0.72, 0.16) : h;
  const [px, py, pz] = live ? [0, 0, 0] : [1.0, 0.72, 0.16];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p.box(0.5, 0.05, 0.2, i % 2 ? WHITE : '#FF9CCB', px - 0.25, py + Math.sin(a) * 0.2 - 0.025, pz + Math.cos(a) * 0.2 - 0.1, { rot: [-a, 0, 0] });
  }
  p.box(0.6, 0.06, 0.06, CHROME, px - 0.3, py - 0.03, pz - 0.03);
  for (const x of [0.7, 1.3]) h.box(0.08, 0.08, 0.05, LAMP(), x - 0.04, 1.16, 2.58);
  return k.build();
}

// ---------- Sailboat [2,4,4]: white hull, mast, striped main sail and jib, a pennant ----------

export function sailboat(color, data) {
  const k = new Kit();
  const live = !!(data && data.live);
  const h = k.part('hull', 0, 0, 0);
  const deep = shade(color, -0.15);
  hull(h, ['#FFFFFF', '#FFFFFF', '#E7BE8C']);
  for (const [x, s] of [[0.12, -1], [1.88, 1]]) h.box(0.02, 0.1, 2.7, color, s > 0 ? x : x - 0.02, 0.9, 0.25);
  // tiny cabin with round windows and a colored roof
  h.box(1.1, 0.42, 0.9, WHITE, 0.45, 0.95, 1.55);
  h.box(1.2, 0.07, 1.0, deep, 0.4, 1.37, 1.5);
  for (const x of [0.75, 1.25]) discZ(h, 0.07, 0.02, GLASS(), x, 1.17, 2.45);
  h.box(1.7, 0.06, 0.9, '#E7BE8C', 0.15, 1.18, 2.45);
  // the tiller seat at the back
  seat(h, 0.6, 1.05, 0.65, 0.8, 0.5, WHITE, 0.36);
  h.stick([1.0, 1.0, 0.18], [1.0, 1.2, 0.6], 0.05, '#B98A5E');
  // mast and boom
  h.cyl(0.05, 2.95, '#E7BE8C', 1.0, 0.95, 2.4, 10);
  h.box(0.06, 0.06, 1.55, '#B98A5E', 0.97, 1.42, 0.85);
  // the main sail (billows with speed), striped
  const s = live ? h.part('sail', 1.0, 1.48, 2.36) : h;
  const [sx, sy, sz] = live ? [0, 0, 0] : [1.0, 1.48, 2.36];
  const rows = 10;
  for (let i = 0; i < rows; i++) {
    const len = 1.45 * (1 - i / rows) + 0.06;
    s.box(0.03, 0.24, len, i % 2 ? WHITE : color, sx - 0.015, sy + i * 0.24, sz - len);
  }
  // the jib in front of the mast
  for (let i = 0; i < 8; i++) {
    const len = 1.05 * (1 - i / 8) + 0.04;
    h.box(0.03, 0.26, len, i % 2 ? color : WHITE, 0.985, 1.25 + i * 0.26, 2.46);
  }
  // pennant on top, bow lamps, tail lamps
  h.pixels(['XXXX', 'XXX.', 'XX..', 'X...'], 0.06, { X: '#FF5FA2' }, 1.02, 3.62, 2.4, { depth: 0.02, plane: 'xy' });
  for (const x of [0.75, 1.25]) h.box(0.08, 0.07, 0.06, LAMP(), x - 0.04, 1.24, 3.58);
  for (const x of [0.35, 1.65]) discZ(h, 0.05, 0.03, TAIL(), x, 1.08, 0.07);
  return k.build();
}
