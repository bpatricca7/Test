// Hair Salon chair: a styling station (counter, a big mirror ringed with glowing bulbs,
// bottles, a hair dryer, a brush) behind a pink tufted salon chair that really spins
// (part 'chair'). She sits facing the mirror (-Z) and the Dress-Up Studio opens on Hair.

import { Kit } from '../furniture/kit.js';
import { woodMat, glow, sheer, mirrorMat, fabricMat } from '../furniture/paint.js';
import { C, heart, drawer, STAR_ROWS } from '../furniture/palette.js';
import { shade, mixHex } from '../../core/util.js';

export const SALON_COLORS = ['#FF9CCB', '#C8B4FF', '#A6D8FF', '#9BE8CF', '#FFE38F', '#FF6FA8'];
/** Seat surface (model units) and the chair's spin pivot. */
export const SALON_SEAT = [0.5, 0.64, 1.36];
export const SALON_PIVOT = [0.5, 0, 1.36];

export function salonChair(color = SALON_COLORS[0]) {
  const k = new Kit();
  const white = '#FFFFFF';
  const chrome = '#E8EEF6';
  const station = mixHex(color, '#FFFFFF', 0.72);
  // ---- styling station (back cell) ----
  k.box(0.96, 0.84, 0.5, woodMat(station), 0.02, 0.04, 0.04);
  k.box(1.0, 0.06, 0.56, white, 0, 0.88, 0.02);
  drawer(k, 0.08, 0.48, 0.38, 0.28, 0.54, station, C.gold, true);
  drawer(k, 0.54, 0.48, 0.38, 0.28, 0.54, station, C.gold, true);
  drawer(k, 0.08, 0.12, 0.84, 0.3, 0.54, station, C.gold, true);
  k.box(0.9, 0.04, 0.46, shade(station, -0.1), 0.05, 0, 0.06);
  // mirror with a bulb frame and a bow on top
  k.box(0.9, 0.98, 0.08, color, 0.05, 0.94, 0.04);
  k.box(0.72, 0.8, 0.02, mirrorMat(), 0.14, 1.03, 0.12);
  const bulb = glow('#FFF6D8', 0.85);
  for (let i = 0; i < 5; i++) {
    k.ball(0.045, bulb, 0.095, 1.05 + i * 0.19, 0.13);
    k.ball(0.045, bulb, 0.905, 1.05 + i * 0.19, 0.13);
  }
  for (let i = 0; i < 4; i++) k.ball(0.045, bulb, 0.26 + i * 0.16, 1.88, 0.13);
  heart(k, 0.24, C.rose, 0.38, 1.94, 0.06, 0.05);
  k.pixels(STAR_ROWS, 0.025, { X: C.butter }, 0.8, 1.93, 0.07, { depth: 0.03 });
  // bottles, a hair dryer and a brush on the counter
  const bottles = [['#FF9CCB', 0.12], ['#C8B4FF', 0.16], ['#9BE8CF', 0.1]];
  bottles.forEach(([c, h], i) => {
    const x = 0.14 + i * 0.1;
    k.cyl(0.035, h, sheer(c, 0.85), x, 0.94, 0.4, 8);
    k.cyl(0.02, 0.03, c, x, 0.94 + h, 0.4, 6);
  });
  k.cyl(0.06, 0.16, color, 0.7, 1.0, 0.36, 12, { rot: [Math.PI / 2, 0, 0] });
  k.cyl(0.045, 0.06, shade(color, -0.15), 0.7, 1.0, 0.52, 10, { rot: [Math.PI / 2, 0, 0] });
  k.box(0.05, 0.14, 0.05, color, 0.675, 0.92, 0.33);
  k.box(0.2, 0.025, 0.06, C.gold, 0.46, 0.94, 0.44);
  k.box(0.12, 0.045, 0.1, '#FFB8D6', 0.43, 0.95, 0.43);
  // ---- the chair (front cell), part 'chair' spins about its pole ----
  k.cyl(0.3, 0.05, chrome, SALON_PIVOT[0], 0, SALON_PIVOT[2], 20);
  const ch = k.part('chair', ...SALON_PIVOT);
  const up = fabricMat(color);
  ch.cyl(0.05, 0.42, chrome, 0, 0.05, 0, 10);
  ch.cyl(0.09, 0.04, chrome, 0, 0.3, 0, 12);
  ch.box(0.6, 0.16, 0.54, up, -0.3, 0.46, -0.3);
  for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [0, 0.02], [-0.15, 0.15], [0.15, 0.15]]) ch.ball(0.022, white, x, 0.625, z);
  ch.box(0.6, 0.62, 0.14, up, -0.3, 0.56, 0.2);
  ch.box(0.48, 0.44, 0.02, shade(color, 0.18), -0.24, 0.66, 0.19);
  heart(ch, 0.16, white, -0.08, 0.98, 0.34, 0.02);
  for (const x of [-0.36, 0.28]) {
    ch.box(0.08, 0.06, 0.46, chrome, x, 0.74, -0.26);
    ch.box(0.06, 0.2, 0.06, chrome, x + 0.01, 0.56, -0.2);
  }
  ch.box(0.4, 0.04, 0.12, chrome, -0.2, 0.14, -0.46);
  ch.stick([0, 0.3, -0.1], [0, 0.16, -0.42], 0.035, chrome);
  return k.build();
}

export const SALON_COLLIDERS = [
  [0.02, 0, 0.02, 0.98, 0.94, 0.58],
  [0.18, 0, 1.08, 0.82, 0.62, 1.66],
  [0.18, 0.62, 1.5, 0.82, 1.2, 1.66],
];

