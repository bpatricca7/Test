// Color swatches (pastels first) and the little shared building blocks every model uses:
// puffy pillows, drawers with heart knobs, pixel hearts, legs...

import { shade, mixHex } from '../../core/util.js';

export const C = {
  pink: '#FF9CCB', rose: '#FF6FA8', lav: '#C8B4FF', sky: '#A6D8FF', mint: '#9BE8CF',
  butter: '#FFE38F', peach: '#FFBFA0', white: '#FFFFFF', cream: '#FFF6EC', coral: '#FF8C94',
  lilac: '#E3C6FF', aqua: '#8FE3F0', wood: '#E7BE8C', woodDark: '#B98A5E', gold: '#FFD36B',
  ink: '#3A1F4D', berry: '#B04A7E', chrome: '#E8EEF6', leaf: '#6CC468', leafDark: '#4FA84F',
  soil: '#8A5A3C', night: '#3B3358',
};

/** Swatch sets. The first color is the default one. */
export const SW = {
  bedding: ['#FF9CCB', '#C8B4FF', '#A6D8FF', '#9BE8CF', '#FFE38F', '#FFFFFF', '#FFBFA0'],
  wood: ['#E7BE8C', '#FFFFFF', '#FFC4DD', '#D8C8FF', '#BFEFDC', '#BFE2FF'],
  fabric: ['#FF9CCB', '#C8B4FF', '#A6D8FF', '#9BE8CF', '#FFE38F', '#FFF6EC', '#FF8C94'],
  appliance: ['#FFFFFF', '#FFC4DD', '#BFE2FF', '#BFEFDC', '#FFF0B3', '#D8C8FF'],
  shades: ['#FF9CCB', '#FFE38F', '#C8B4FF', '#A6D8FF', '#9BE8CF', '#FFFFFF'],
  door: ['#E7BE8C', '#FFFFFF', '#FF9CCB', '#C8B4FF', '#9BE8CF', '#A6D8FF'],
  doorPink: ['#FF9CCB', '#FF6FA8', '#E3C6FF', '#FFBFA0', '#FFFFFF'],
  bright: ['#FF9CCB', '#A6D8FF', '#9BE8CF', '#FFE38F', '#C8B4FF', '#FFBFA0'],
  teddy: ['#E7BE8C', '#FFC4DD', '#D8C8FF', '#FFFFFF', '#BFE2FF', '#FFE38F'],
  cloud: ['#FFFFFF', '#FFE3F0', '#E6DDFF', '#DDF3FF', '#E2FBF0', '#FFF6D8'],
  metal: ['#FFFFFF', '#FF9CCB', '#C8B4FF', '#A6D8FF', '#9BE8CF', '#E7BE8C'],
};

/** Pick a quilt pattern per swatch so every color has its own look. */
export function patternFor(color, list, patterns) {
  const i = list.indexOf(color);
  return patterns[(i < 0 ? 0 : i) % patterns.length];
}

export const light = (c, t = 0.5) => shade(c, t);
export const dark = (c, t = 0.15) => shade(c, -t);
export const mix = mixHex;

// ---------- tiny building blocks ----------

/** Puffy pillow: a soft box with a slightly raised middle. */
export function pillow(k, w, h, d, color, x, y, z) {
  k.box(w, h * 0.8, d, color, x, y, z);
  k.box(w - 0.08, h * 0.2, d - 0.08, shade(color, 0.12), x + 0.04, y + h * 0.8, z + 0.04);
  return k;
}

/** Round-ish knob (a tiny heart when heart = true). */
export function knob(k, x, y, z, color = C.gold, heart = false) {
  if (heart) {
    k.pixels(['X.X', 'XXX', '.X.'], 0.03, { X: color }, x - 0.045, y - 0.045, z, { depth: 0.03 });
  } else {
    k.box(0.06, 0.06, 0.04, color, x - 0.03, y - 0.03, z);
  }
  return k;
}

/** Drawer front on a +Z face at z: inset panel + knob. */
export function drawer(k, x, y, w, h, z, color, knobColor = C.gold, heart = true) {
  k.box(w, h, 0.03, shade(color, 0.08), x, y, z);
  k.box(w - 0.06, h - 0.06, 0.012, shade(color, -0.05), x + 0.03, y + 0.03, z + 0.03);
  knob(k, x + w / 2, y + h / 2, z + 0.042, knobColor, heart);
  return k;
}

/** Four square legs under a w x d top (inset by `inset`). */
export function legs(k, x, z, w, d, h, color, size = 0.08, inset = 0.04) {
  for (const [lx, lz] of [[x + inset, z + inset], [x + w - inset - size, z + inset], [x + inset, z + d - inset - size], [x + w - inset - size, z + d - inset - size]]) {
    k.box(size, h, size, color, lx, 0, lz);
  }
  return k;
}

export const HEART_ROWS = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
export const BIG_HEART_ROWS = [
  '..XXX...XXX..',
  '.XXXXX.XXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '...XXXXXXX...',
  '....XXXXX....',
  '.....XXX.....',
  '......X......',
];
export const STAR_ROWS = ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '.XX.XX.', 'X.....X'];
export const FLOWER_ROWS = ['.X.X.', 'XXXXX', '.XOX.', 'XXXXX', '.X.X.'];

/** Heart made of pixels, standing (faces +Z) with its bottom-left at (x, y, z). */
export function heart(k, size, color, x, y, z, depth = 0.04, rows = HEART_ROWS) {
  const px = size / rows[0].length;
  return k.pixels(rows, px, { X: color }, x, y, z, { depth });
}

/** Heart with a lighter inner heart (outlined look), standing. */
export function heartOutlined(k, size, color, inner, x, y, z, depth = 0.05) {
  const rows = BIG_HEART_ROWS;
  const px = size / rows[0].length;
  k.pixels(rows, px, { X: color }, x, y, z, { depth });
  const innerRows = rows.map((r, i) => {
    if (i === 0 || i >= rows.length - 2) return '.'.repeat(r.length);
    let s = '';
    for (let c = 0; c < r.length; c++) {
      const on = r[c] === 'X' && r[c - 1] === 'X' && r[c + 1] === 'X' && rows[i - 1][c] === 'X' && rows[i + 1][c] === 'X';
      s += on ? 'X' : '.';
    }
    return s;
  });
  k.pixels(innerRows, px, { X: inner }, x, y, z + depth, { depth: 0.01 });
  return k;
}

/** Little flower sprite (standing). */
export function flower(k, size, petal, x, y, z, center = '#FFE38F', depth = 0.03) {
  const px = size / 5;
  return k.pixels(FLOWER_ROWS, px, { X: petal, O: center }, x, y, z, { depth });
}

/** Scalloped trim along +X: little bumps hanging down from y, on the z face. */
export function scallops(k, x, y, z, length, color, bump = 0.1, depth = 0.03) {
  const n = Math.max(1, Math.round(length / bump));
  const step = length / n;
  for (let i = 0; i < n; i++) {
    k.box(step * 0.9, bump * 0.5, depth, color, x + i * step + step * 0.05, y - bump * 0.5, z);
    k.box(step * 0.5, bump * 0.3, depth, color, x + i * step + step * 0.25, y - bump * 0.8, z);
  }
  return k;
}
