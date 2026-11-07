// The Holiday Dress-Up booth (holiday_booth, 2 x 3 x 1): a cozy little dressing booth with
// candy-cane posts, a snowy roof, a sign with a gold star, twinkly lights, a big mirror, two
// mini hats on pegs (a Santa hat and an elf hat), tied-back curtains and a stack of presents.
// Front faces +Z; she stands on the low stage in front of the mirror. Plain colors and glow only
// (no canvas textures), so the model also builds in Node for tools/test-holiday-looks.mjs.

import { Kit } from '../../things/furniture/kit.js';
import { glow } from '../../things/furniture/paint.js';
import { STAR_ROWS } from '../../things/furniture/palette.js';
import { shade, mixHex } from '../../core/util.js';

/** The panel color (the first is the default, the one the world places). */
export const BOOTH_COLORS = ['#2FA84F', '#E5383B', '#FF9CCB', '#6CC6FF', '#C8B4FF', '#FFE38F'];

export const BOOTH_SIZE = [2, 3, 1];

/** Model units: the stage, the back wall and the two posts (she walks onto the stage). */
export const BOOTH_COLLIDERS = [
  [0, 0, 0, 2, 0.08, 1],
  [0.08, 0, 0, 1.92, 2.62, 0.18],
  [0.02, 0, 0.72, 0.22, 2.62, 0.92],
  [1.78, 0, 0.72, 1.98, 2.62, 0.92],
];

const RED = '#E5383B';
const WHITE = '#FFFFFF';
const SNOW = '#FBFDFF';
const GOLD = '#FFD36B';
const WOOD = '#8B5E3C';
const BULBS = ['#FF6B6B', '#FFD54A', '#6BD68A', '#6CC6FF', '#FF8CC6'];

const FLAKE_ROWS = ['X.X.X', '.XXX.', 'XXXXX', '.XXX.', 'X.X.X'];
const SANTA_HAT_ROWS = ['...RRR..', '..RRRRRW', '.RRRR...', 'RRRRR...', 'WWWWWW..'];
const ELF_HAT_ROWS = ['.....GY', '...GGG.', '..GGGG.', '.GGGGG.', 'RRRRRRR'];

/** A candy-cane post: red and white bands up to y1, a gold ball on top. */
function candyPost(k, x, z, y0, y1) {
  const n = 10, h = (y1 - y0) / n;
  for (let i = 0; i < n; i++) k.cyl(0.085, h, i % 2 ? WHITE : RED, x, y0 + i * h, z, 10);
  k.ball(0.1, GOLD, x, y1 + 0.07, z, { seg: 10 });
}

/** A curtain on one side, gathered at a gold tie (s: -1 left, 1 right). */
function curtain(k, x0, color) {
  const dark = shade(color, -0.22);
  k.box(0.2, 1.14, 0.07, color, x0, 1.06, 0.72); // the upper part, full width
  k.box(0.12, 0.98, 0.07, color, x0 + 0.04, 0.08, 0.72); // gathered below the tie
  for (const fx of [0.05, 0.1, 0.15]) k.box(0.02, 1.1, 0.01, dark, x0 + fx, 1.08, 0.79);
  k.box(0.24, 0.07, 0.09, GOLD, x0 - 0.02, 1.02, 0.71); // the tie
  k.ball(0.04, GOLD, x0 + 0.1, 1.0, 0.8, { seg: 8 });
}

/** A mini hat on a peg. */
function pegHat(k, x, y, kind) {
  k.cyl(0.02, 0.09, GOLD, x, y, 0.13, 6, { rot: [Math.PI / 2, 0, 0] }); // the peg
  if (kind === 'santa') {
    k.cyl(0.11, 0.05, SNOW, x, y - 0.05, 0.24, 12);
    k.cone(0.1, 0.02, 0.22, RED, x, y, 0.24, 10, { rot: [0, 0, -0.45] });
    k.ball(0.04, SNOW, x + 0.1, y + 0.17, 0.24, { seg: 8 });
  } else {
    k.cyl(0.11, 0.05, '#C0392B', x, y - 0.05, 0.24, 12);
    k.cone(0.1, 0.01, 0.3, '#2FA84F', x, y, 0.24, 10, { rot: [0, 0, 0.4] });
    k.ball(0.03, GOLD, x - 0.12, y + 0.27, 0.24, { seg: 8 });
  }
}

/** The booth model (front +Z, footprint [0,2] x [0,1]). color: the back wall and the roof. */
export function holidayBooth(color = BOOTH_COLORS[0]) {
  const k = new Kit();
  const wall = color;
  const trim = shade(color, -0.28);
  const cur = color === RED ? '#1E7A3A' : '#C0392B'; // curtains: red, or green on a red booth
  // ---- the stage: dark wood with a soft snow-white rug ----
  k.box(2, 0.06, 1, WOOD, 0, 0, 0);
  k.box(1.6, 0.025, 0.66, SNOW, 0.2, 0.06, 0.22);
  k.box(1.64, 0.02, 0.04, RED, 0.18, 0.06, 0.88);
  // ---- the back wall: color, snowflakes, a big mirror in a gold frame ----
  k.box(1.84, 2.54, 0.1, wall, 0.08, 0.06, 0.04);
  k.box(1.84, 0.12, 0.12, trim, 0.08, 0.06, 0.03); // skirting
  const flake = { X: mixHex(wall, WHITE, 0.6) };
  for (const [x, y] of [[0.2, 2.15], [1.65, 2.2], [0.28, 0.6], [1.6, 0.5], [0.42, 1.95], [1.45, 1.9]]) {
    k.pixels(FLAKE_ROWS, 0.024, flake, x, y, 0.14, { depth: 0.01 });
  }
  k.box(0.66, 1.24, 0.03, GOLD, 0.67, 0.66, 0.13); // mirror frame
  k.box(0.54, 1.12, 0.02, glow('#DDF3FF', 0.35), 0.73, 0.72, 0.16); // mirror glass
  k.box(0.07, 0.5, 0.005, glow('#FFFFFF', 0.6), 0.8, 1.1, 0.181); // a shine on the glass
  k.box(0.035, 0.24, 0.005, glow('#FFFFFF', 0.6), 0.91, 1.3, 0.181);
  k.pixels(STAR_ROWS, 0.022, { X: GOLD }, 0.92, 1.9, 0.14, { depth: 0.02 }); // a star on the frame top
  pegHat(k, 0.53, 1.45, 'santa');
  pegHat(k, 1.47, 1.45, 'elf');
  // ---- the roof: a slab with fluffy snow and icicles ----
  k.box(1.92, 0.08, 0.86, trim, 0.04, 2.6, 0.04);
  k.box(1.96, 0.07, 0.9, SNOW, 0.02, 2.68, 0.02);
  for (let i = 0; i < 7; i++) k.ball(0.11, SNOW, 0.15 + i * 0.283, 2.74, 0.5 + (i % 2 ? 0.12 : -0.08), { seg: 10, sy: 0.55 });
  // ---- the posts and the sign ----
  candyPost(k, 0.12, 0.82, 0.06, 2.6);
  candyPost(k, 1.88, 0.82, 0.06, 2.6);
  k.box(1.7, 0.4, 0.08, SNOW, 0.15, 2.22, 0.86); // the sign
  k.box(1.76, 0.05, 0.1, RED, 0.12, 2.6, 0.85);
  k.box(1.76, 0.05, 0.1, RED, 0.12, 2.19, 0.85);
  k.pixels(SANTA_HAT_ROWS, 0.04, { R: RED, W: WHITE }, 0.3, 2.3, 0.94, { depth: 0.015 });
  k.pixels(ELF_HAT_ROWS, 0.04, { G: '#2FA84F', R: RED, Y: GOLD }, 1.42, 2.3, 0.94, { depth: 0.015 });
  k.pixels(STAR_ROWS, 0.04, { X: glow(GOLD, 0.7) }, 0.86, 2.29, 0.94, { depth: 0.02 });
  k.pixels(STAR_ROWS, 0.07, { X: glow(GOLD, 0.8) }, 0.755, 2.78, 0.46, { depth: 0.05 }); // the big star on top
  // twinkly lights along the sign's bottom edge and up the posts
  for (let i = 0; i < 11; i++) {
    const x = 0.2 + i * 0.16, y = 2.15 - Math.sin((i / 10) * Math.PI) * 0.08;
    k.ball(0.028, glow(BULBS[i % BULBS.length], 0.9), x, y, 0.96, { seg: 6 });
  }
  for (const x of [0.12, 1.88]) {
    for (let i = 0; i < 6; i++) k.ball(0.026, glow(BULBS[(i + (x > 1 ? 2 : 0)) % BULBS.length], 0.9), x, 0.4 + i * 0.36, 0.92, { seg: 6 });
  }
  // ---- curtains, and presents on the stage ----
  curtain(k, 0.2, cur);
  curtain(k, 1.6, cur);
  k.box(0.2, 0.18, 0.18, '#FF8CC6', 0.3, 0.06, 0.76);
  k.box(0.04, 0.185, 0.185, GOLD, 0.38, 0.06, 0.758);
  k.box(0.13, 0.12, 0.13, '#6CC6FF', 0.335, 0.24, 0.785);
  k.box(0.135, 0.125, 0.03, WHITE, 0.333, 0.24, 0.835);
  k.ball(0.032, GOLD, 0.4, 0.38, 0.85, { seg: 8 });
  k.box(0.17, 0.15, 0.17, '#FFE38F', 1.53, 0.06, 0.77);
  k.box(0.175, 0.03, 0.175, RED, 1.528, 0.12, 0.768);
  return k.build();
}
