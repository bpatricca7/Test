// Vans: the Road Trip Van and the Ice Cream Van (furniture Kit). Both share one body: a
// two-tone box with a glass cab in front (so she shows through the windows while driving)
// and a living / serving space behind. Model space [0,2] x [0,3] x [0,4], nose = +Z, driver
// on +X. build(color, data): data.live puts the wheels in spinning parts.

import { Kit } from '../furniture/kit.js';
import { shade, mixHex } from '../../core/util.js';
import { WHITE, INK, CHROME, GLASS, axles, headlamp, steeringWheel, seat, bumper, discZ } from './kit.js';
import { sideFlower } from './models-cars.js';

const CAB = 2.45; // the cab starts here (z) and runs to the nose
const BELT = 1.25; // top of the colored lower body

/** The shared van: wheels, two-tone body, glass cab with seats, bumpers and lamps. */
function vanBody(k, color, live, upper = WHITE) {
  const dark = shade(color, -0.2);
  axles(k, live, [0.75, 3.2], 0.3, [0.02, 0.2], [1.78, 0.2]);
  // living space: a solid two-tone box (lower in color, upper white)
  k.box(1.76, BELT - 0.3, CAB - 0.05, color, 0.12, 0.3, 0.05);
  k.box(1.76, 2.15 - BELT, CAB - 0.05, upper, 0.12, BELT, 0.05);
  // the cab: floor, side walls under the windows, the nose, a roof
  k.box(1.76, 0.2, 3.95 - CAB, color, 0.12, 0.3, CAB);
  for (const x of [0.12, 1.78]) k.box(0.1, BELT - 0.5, 3.95 - CAB, color, x, 0.5, CAB);
  k.box(1.76, 0.5, 0.3, color, 0.12, 0.5, 3.65);
  k.box(1.56, 0.2, 0.28, color, 0.22, 1.0, 3.6);
  k.box(1.76, 0.1, 3.75 - CAB, upper, 0.12, 2.05, CAB);
  // window glass and white pillars
  for (const x of [0.13, 1.85]) {
    k.box(0.02, 0.8, 3.65 - CAB, GLASS(), x, BELT, CAB);
    k.box(0.08, 0.8, 0.06, upper, x - 0.03, BELT, 3.05);
  }
  k.box(1.6, 0.8, 0.03, GLASS(), 0.2, 1.22, 3.72, { rot: [-0.18, 0, 0], pivot: [0, 1.22, 3.8] });
  for (const x of [0.12, 1.8]) k.box(0.08, 0.84, 0.12, upper, x, BELT, 3.66, { rot: [-0.18, 0, 0], pivot: [0, BELT, 3.75] });
  // two seats, the dashboard and the wheel
  seat(k, 0.98, 0.9, 2.6, 0.62, 0.5, '#FFF6EC', 0.5);
  seat(k, 0.4, 0.9, 2.6, 0.62, 0.5, '#FFF6EC', 0.5);
  k.box(1.56, 0.2, 0.2, INK, 0.22, 1.05, 3.42);
  steeringWheel(k, 1.3, 1.3, 3.3, 0.16, INK);
  // a stripe where the colors meet, bumpers, lamps, a little grille
  for (const x of [0.11, 1.88]) k.box(0.01, 0.06, 3.9, dark, x, BELT - 0.06, 0.05);
  bumper(k, 0.1, 1.9, 0.3, 3.92, CHROME, 0.14);
  bumper(k, 0.1, 1.9, 0.3, 0.0, CHROME, 0.14);
  headlamp(k, 0.42, 0.78, 3.95, 0.14);
  headlamp(k, 1.58, 0.78, 3.95, 0.14);
  headlamp(k, 0.4, 0.8, 0.05, 0.08, true);
  headlamp(k, 1.6, 0.8, 0.05, 0.08, true);
  for (let i = 0; i < 4; i++) k.box(0.6, 0.04, 0.02, CHROME, 0.7, 0.62 + i * 0.08, 3.95);
  return dark;
}

/** A curtained window on a side wall (x = the outer face, s = -1 for -X, +1 for +X). */
function sideWindow(k, x, s, z0, z1, y0, y1, curtain) {
  const t = 0.02;
  const xf = s > 0 ? x : x - t;
  k.box(t, y1 - y0, z1 - z0, '#CFEFFF', xf, y0, z0);
  k.box(t, y1 - y0, (z1 - z0) * 0.22, curtain, xf + s * 0.005, y0, z0);
  k.box(t, y1 - y0, (z1 - z0) * 0.22, curtain, xf + s * 0.005, y0, z1 - (z1 - z0) * 0.22);
  k.box(t, 0.06, z1 - z0, curtain, xf + s * 0.005, y1 - 0.06, z0);
}

// ---------- Road Trip Van [2,3,4]: pop-top roof, surfboard, flower stickers, a bike ----------

export function roadTripVan(color, data) {
  const k = new Kit();
  const live = !!(data && data.live);
  vanBody(k, color, live);
  const curtain = '#FF9CCB';
  for (const [x, s] of [[0.12, -1], [1.88, 1]]) {
    sideWindow(k, x, s, 0.45, 1.25, 1.4, 1.9, curtain);
    sideWindow(k, x, s, 1.45, 2.25, 1.4, 1.9, curtain);
    sideFlower(k, x + s * 0.02, 0.85, 0.7, 0.3, '#FF8CC6');
    sideFlower(k, x + s * 0.02, 0.7, 1.5, 0.22, '#FFE38F', '#FF9F43');
    sideFlower(k, x + s * 0.02, 0.92, 2.0, 0.26, '#C8B4FF');
  }
  // the pop-top roof: striped canvas and a white lid
  const stripes = ['#FF9CCB', '#FFFFFF', '#FFE38F', '#FFFFFF', '#9BE8CF', '#FFFFFF', '#A6D8FF', '#FFFFFF'];
  for (let i = 0; i < stripes.length; i++) k.box(1.6, 0.26, 0.28, stripes[i], 0.2, 2.15, 0.15 + i * 0.28);
  k.box(1.7, 0.08, 2.4, WHITE, 0.15, 2.41, 0.1);
  // a surfboard on the cab roof
  k.ball(1, '#FFF6EC', 1.0, 2.2, 3.05, { seg: 16, sx: 0.28, sy: 0.05, sz: 0.62 });
  k.box(0.08, 0.02, 1.0, '#FF6FA8', 0.96, 2.23, 2.55);
  // a bike on the back
  for (const x of [0.55, 1.45]) k.torus(0.26, 0.03, INK, x, 1.05, 0.0, { rot: [Math.PI / 2, 0, 0] });
  k.stick([0.55, 1.05, 0.0], [0.9, 1.35, 0.0], 0.04, '#FF6FA8');
  k.stick([0.9, 1.35, 0.0], [1.45, 1.05, 0.0], 0.04, '#FF6FA8');
  k.stick([0.9, 1.35, 0.0], [1.25, 1.42, 0.0], 0.04, '#FF6FA8');
  k.box(0.18, 0.05, 0.06, INK, 0.82, 1.42, -0.03);
  // a little spare-wheel cover with a heart on the nose
  discZ(k, 0.12, 0.03, mixHex(color, WHITE, 0.5), 1.0, 1.15, 3.88);
  return k.build();
}

// ---------- Ice Cream Van [2,3,4]: serving hatch, striped awning, a giant cone ----------

const TUBS = ['#FFB3C7', '#BDF2DA', '#FFE38F', '#DCC8FF', '#8B5A3C'];
const SPRINKLES = ['#FF5A7A', '#FFD93D', '#6BD968', '#5BB8FF', '#A77BFF', '#FFFFFF'];

export function iceCreamVan(color, data) {
  const k = new Kit();
  const live = !!(data && data.live);
  vanBody(k, color, live, '#FFF6FA');
  // the serving hatch on the -X side: pink inside, a shelf of tubs, a white frame
  const x = 0.12, z0 = 0.5, z1 = 2.05, y0 = 1.32, y1 = 1.95;
  k.box(0.02, y1 - y0, z1 - z0, '#FFE3F0', x - 0.02, y0, z0);
  k.box(0.12, 0.04, z1 - z0, WHITE, x - 0.12, y0 - 0.04, z0);
  for (let i = 0; i < 5; i++) {
    const tz = z0 + 0.18 + i * 0.3;
    k.cyl(0.06, 0.06, WHITE, x - 0.07, y0, tz, 10);
    k.ball(0.055, TUBS[i], x - 0.07, y0 + 0.07, tz, { seg: 10, sy: 0.6 });
  }
  for (const z of [z0 - 0.06, z1]) k.box(0.04, y1 - y0 + 0.06, 0.06, WHITE, x - 0.04, y0 - 0.02, z);
  k.box(0.04, 0.06, z1 - z0 + 0.12, WHITE, x - 0.04, y1, z0 - 0.06);
  // the striped awning over it
  for (let i = 0; i < 6; i++) {
    const sw = (z1 - z0 + 0.2) / 6;
    k.box(0.3, 0.05, sw, i % 2 ? WHITE : '#FF8FC8', x - 0.3, y1 + 0.12, z0 - 0.1 + i * sw, { rot: [0, 0, -0.35], pivot: [x, y1 + 0.14, 0] });
  }
  // a menu board on the other side: little treats on white
  const mx = 1.885;
  k.box(0.02, 0.5, 0.9, WHITE, mx, 1.38, 0.9);
  const treats = [['#FFB3C7', '#E9B26C'], ['#BDF2DA', '#E9B26C'], ['#DCC8FF', '#FF9CCB']];
  treats.forEach(([top, base], i) => {
    const z = 1.08 + i * 0.27;
    k.ball(0.06, top, mx + 0.03, 1.66, z, { seg: 8, sx: 0.3 });
    k.box(0.02, 0.1, 0.06, base, mx + 0.02, 1.52, z - 0.03);
  });
  // sprinkle decals down both sides
  for (const [sx, s] of [[0.12, -1], [1.88, 1]]) {
    for (let i = 0; i < 14; i++) {
      const z = 0.25 + ((i * 37) % 100) / 100 * 2.0;
      const y = 0.42 + ((i * 53) % 100) / 100 * 0.7;
      k.box(0.015, 0.03, 0.09, SPRINKLES[i % SPRINKLES.length], s > 0 ? sx : sx - 0.015, y, z, { rot: [(i % 3 - 1) * 0.7, 0, 0] });
    }
  }
  // the giant cone on the roof (it always makes her smile)
  k.box(0.6, 0.08, 0.6, WHITE, 0.7, 2.15, 1.0);
  k.cone(0.03, 0.28, 0.62, '#E9B26C', 1.0, 2.2, 1.3, 14);
  k.ball(0.3, '#FFB3C7', 1.0, 2.92, 1.3, { seg: 14 });
  k.ball(0.25, '#BDF2DA', 1.0, 3.18 - 0.2, 1.3, { seg: 14, sy: 0.7 });
  k.ball(0.07, '#E8203F', 1.0, 3.18, 1.3, { seg: 10 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.box(0.02, 0.02, 0.07, SPRINKLES[i % SPRINKLES.length], 1.0 + Math.cos(a) * 0.24, 3.0, 1.3 + Math.sin(a) * 0.24, { rot: [0, a, 0] });
  }
  return k.build();
}
