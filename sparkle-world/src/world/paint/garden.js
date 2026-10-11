// Garden: flowers and plants (cross sprites), hedges, pumpkins, melons, hay and farmland.
// Also the little lying-flat decorations (seashells, starfish, lily pads), seaweed, the
// candle and the lollipop sprite, since they are all drawn the same hand-made way.

import { tone, rgb, leaves } from './kit.js';

const STEM = '#4FAE57', STEM_D = '#3E974A';
const LEAF = { m: '#63C466', l: '#8EDB7E', d: '#48A55A' };

// ---------- sprite helpers ----------

/** A stem from (x, bottom) up to `top`, leaning `sway` px at the top. Returns the top x. */
function stem(p, x, top, { bottom = 15, sway = 0, color = STEM, dark = STEM_D, wide = false } = {}) {
  let xx = x;
  for (let y = bottom; y >= top; y--) {
    const t = (bottom - y) / Math.max(1, bottom - top);
    xx = x + Math.round(sway * t * t);
    p.put(xx, y, color);
    if (wide) p.put(xx + 1, y, dark);
  }
  return xx;
}

const LEAF_SMALL = [[1, 0, 'd'], [2, 0, 'm'], [2, -1, 'm'], [3, -1, 'l'], [3, -2, 'l']];
const LEAF_BIG = [[1, 0, 'd'], [2, 0, 'm'], [3, 0, 'd'], [2, -1, 'm'], [3, -1, 'm'], [4, -1, 'l'], [3, -2, 'l'], [4, -2, 'l'], [5, -2, 'm'], [5, -3, 'l']];

/** A leaf growing out of a stem at (x, y); dir +1 = right, -1 = left. */
function leaf(p, x, y, dir, big = false, pal = LEAF) {
  for (const [dx, dy, k] of big ? LEAF_BIG : LEAF_SMALL) p.put(x + dx * dir, y + dy, pal[k]);
}

/**
 * Round flower head: n petal circles around a center.
 * opts: { n, R (petal distance), pr (petal radius), petal, dark, light, center, centerDark, cr, rot }
 */
function radial(p, cx, cy, o) {
  const pts = [];
  for (let k = 0; k < o.n; k++) {
    const a = (o.rot || 0) + (k / o.n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * o.R, cy + Math.sin(a) * o.R]);
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dc = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dc <= o.cr) {
        const lit = x + 0.5 - cx + y + 0.5 - cy < -0.6;
        p.put(x, y, lit ? (o.centerLight || o.center) : dc > o.cr - 0.9 ? o.centerDark : o.center);
        continue;
      }
      for (const [px, py] of pts) {
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        if (d <= o.pr) {
          const low = y + 0.5 > py + o.pr * 0.35;
          const tip = d > o.pr - 0.8 && dc > o.R;
          p.put(x, y, low || tip ? o.dark : dc < o.R - 0.3 && o.light ? o.light : o.petal);
          break;
        }
      }
    }
  }
}

/** Standard flower: stem, two leaves and a head painter. */
function flower(headTop, head, { leavesAt = [11, 12], big = false, sway = 0, x = 7 } = {}) {
  return (p, r) => {
    p.clear();
    stem(p, x, headTop, { sway });
    leaf(p, x, leavesAt[0], -1, big);
    leaf(p, x, leavesAt[1], 1, big);
    head(p, r);
  };
}

// hand-drawn heads -------------------------------------------------------------

const ROSE = [
  '..abba..',
  '.abbbba.',
  'abcbbcba',
  'bcabbacb',
  'bcbccbcb',
  '.bcbbcb.',
  '..cbbc..',
];
const TULIP = [
  '.a.b.c.',
  '.aabbc.',
  'aabbbcc',
  'aabbbcc',
  'aabbbcc',
  '.abbbc.',
  '..bbc..',
];
const POPPY = [
  '.bb..bb.',
  'bbbabbbb',
  'bbaooabb',
  'bbboobbc',
  '.bbbbbc.',
  '..cbbc..',
];
const BELL = ['.s.', 'abB', 'bbB', 'b.B'];
const BELL_SMALL = ['s.', 'aa', 'ab'];

function head(rows, pal, ox, oy) {
  return (p) => p.art(rows, pal, ox, oy);
}

function tulip(petal) {
  const pal = { a: tone(petal, 0.28), b: rgb(petal), c: tone(petal, -0.2) };
  return flower(7, head(TULIP, pal, 4, 1), { leavesAt: [12, 10], big: true });
}

// ---------- tile painters ----------

const PAINT = {
  flower_rose: flower(7, head(ROSE, { a: '#FFA3C0', b: '#FF6F98', c: '#DE4A76' }, 4, 1)),
  flower_tulip: tulip('#B892FF'),
  flower_tulip_pink: tulip('#FF9CC6'),
  flower_tulip_red: tulip('#FF6F7F'),
  flower_tulip_white: (p, r) => {
    tulip('#F4F0FA')(p, r);
    p.art(['.a.b.c.'], { a: '#FFFFFF', b: '#FFE3F0', c: '#E6DDF2' }, 4, 1);
  },
  flower_daisy: flower(6, (p) => radial(p, 8, 5, { n: 8, R: 3, pr: 1.55, petal: '#FFFFFF', dark: '#E4DDF0', center: '#FFD23F', centerDark: '#F2A93B', cr: 1.6 })),
  flower_poppy: flower(7, head(POPPY, { a: '#FF9A8A', b: '#FF5E5E', c: '#D94452', o: '#4B3552' }, 4, 2)),
  flower_cosmos: flower(6, (p) => radial(p, 8, 5, { n: 8, R: 3.2, pr: 1.7, petal: '#FFA3D1', light: '#FFC9E4', dark: '#F078B4', center: '#FFE066', centerDark: '#F2B540', cr: 1.3, rot: 0.39 })),
  flower_sunflower: (p, r) => {
    p.clear();
    stem(p, 7, 8, { wide: true });
    leaf(p, 8, 12, 1, true);
    leaf(p, 7, 10, -1, true);
    radial(p, 8, 5, { n: 12, R: 4, pr: 1.9, petal: '#FFD43B', light: '#FFE680', dark: '#F2A922', center: '#9A5A3A', centerDark: '#6E3E2A', centerLight: '#B8744E', cr: 2.6 });
    for (const [x, y] of [[7, 4], [9, 5], [8, 6]]) p.put(x, y, '#5E3424');
  },
  flower_lavender: (p, r) => {
    p.clear();
    const spikes = [[4, 3, -1], [8, 1, 0], [12, 4, 1]];
    for (const [x, top, sway] of spikes) {
      const tx = stem(p, x, top, { sway, color: '#6DB56A', dark: '#5BA35A' });
      for (let y = top; y < top + 8; y++) {
        const t = (y - top) / 8;
        const xx = x + Math.round(sway * (1 - t) * (1 - t) * 0.9);
        p.put(xx, y, y - top < 2 ? '#C9A8FF' : '#A57FF0');
        if ((y - top) % 2 === 0) p.put(xx - 1, y, '#B894FF');
        else p.put(xx + 1, y, '#8E66DE');
      }
      p.put(tx, top - 1, '#D9C2FF');
    }
    leaf(p, 8, 13, -1);
    leaf(p, 8, 14, 1);
  },
  flower_bluebell: (p, r) => {
    p.clear();
    // arching stem
    const path = [[6, 15], [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [6, 8], [6, 7], [7, 6], [7, 5], [8, 4], [9, 3], [10, 3], [11, 3], [12, 4]];
    for (const [x, y] of path) p.put(x, y, STEM);
    const pal = { s: STEM, a: '#A9C4FF', b: '#7FA3FF', B: '#5F82E8' };
    p.art(BELL, pal, 11, 5);
    p.art(BELL, pal, 8, 5);
    p.art(BELL_SMALL, pal, 5, 7);
    p.put(12, 4, STEM); p.put(9, 4, STEM);
    leaf(p, 6, 13, 1, true);
    leaf(p, 6, 12, -1);
  },
  flower_lily: (p, r) => {
    p.clear();
    // two broad leaves
    for (let y = 6; y < 16; y++) {
      const w = y < 8 ? 1 : y < 11 ? 2 : 2;
      for (let k = 0; k < w; k++) { p.put(4 + k, y, k === 0 ? '#4EA85A' : '#6CCB6A'); p.put(11 - k, y + 2, k === 0 ? '#4EA85A' : '#79D275'); }
      p.put(5 + (w > 1 ? 1 : 0), y, '#8EDB7E');
    }
    const path = [[8, 15], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [8, 8], [8, 7], [8, 6], [8, 5], [9, 4], [10, 3], [11, 3], [12, 4]];
    for (const [x, y] of path) p.put(x, y, STEM);
    const pal = { s: STEM, a: '#FFFFFF', b: '#F1ECF6' };
    for (const [x, y] of [[12, 5], [10, 4], [7, 6], [9, 8], [6, 9]]) p.art(['s.', 'aa', 'ab'], pal, x, y);
  },
  flower_forgetmenot: (p, r) => {
    p.clear();
    const heads = [[5, 5], [10, 3], [9, 8], [4, 10], [12, 9]];
    for (const [hx, hy] of heads) {
      for (let y = hy + 1; y < 16; y++) p.put(hx + (y > 12 ? (hx < 8 ? 1 : -1) : 0), y, STEM);
    }
    for (const [hx, hy] of heads) {
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) p.put(hx + dx, hy + dy, '#7FB8FF');
      p.put(hx - 1, hy - 1, '#A9D0FF'); p.put(hx + 1, hy + 1, '#5E94EA');
      p.put(hx, hy, '#FFE066');
    }
    leaf(p, 7, 14, -1);
    leaf(p, 8, 13, 1);
  },
  mushroom_red: (p) => {
    p.clear();
    p.art([
      '....rrrrr.......',
      '..rrwrrrrrr.....',
      '.rrrrrrrwwrr....',
      '.rwwrrrrrrrrr...',
      '.rrrrrrrrrwrr...',
      '..uuuuuuuuuu....',
      '.....sSs........',
      '.....sSs.....r..',
      '.....sSs....rwr.',
      '.....sSs...rrrrr',
      '.....sSs...uuuuu',
      '....ssSss....s..',
      '...sssSsss...s..',
    ], { r: '#F06474', w: '#FFFFFF', u: '#F7D9C4', s: '#FFF6EA', S: '#EADCC8' }, 0, 3);
    p.put(3, 4, '#FF97A2'); p.put(4, 3, '#FF97A2');
  },
  mushroom_glow: (p) => {
    p.clear();
    p.art([
      '...bbbbb........',
      '.bbwbbbbbb......',
      'bbbbbbbwwbb.....',
      'bwwbbbbbbbbb....',
      '.uuuuuuuuuu.....',
      '....sSs.....ppp.',
      '....sSs....pwppp',
      '....sSs....uuuuu',
      '....sSs.....sS..',
      '...ssSss....sS..',
      '...ssSss...ssSs.',
      '..sssSsss..ssSs.',
    ], { b: '#7FA2F5', w: '#EFFFFF', u: '#C6F2FF', s: '#F2FBFF', S: '#D5ECF5', p: '#C29CFF' }, 0, 4);
    p.put(2, 5, '#B8CCFF'); p.put(3, 4, '#B8CCFF');
  },
  grass_tall: (p, r) => {
    p.clear();
    const greens = ['#6BBF67', '#7DCF74', '#8FDA80', '#A6E891'];
    for (let b = 0; b < 8; b++) {
      let x = 1 + Math.floor(r() * 14);
      const h = 6 + Math.floor(r() * 9);
      const lean = r() < 0.5 ? -1 : 1;
      for (let y = 15, i = 0; y > 15 - h; y--, i++) {
        const t = i / h;
        p.put(x, y, greens[Math.min(3, Math.floor(t * 4))]);
        if (t > 0.55 && r() < 0.45) x += lean;
        x = Math.max(0, Math.min(15, x));
      }
    }
  },
  fern: (p) => {
    p.clear();
    // three arching fronds with little leaflets on both sides
    for (const [ang, len, bend] of [[-0.62, 13, -0.5], [0.05, 15, 0.1], [0.66, 13, 0.5]]) {
      let x = 7.6, y = 15.6;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const a = ang + bend * t * t * 1.4;
        x += Math.sin(a) * 0.95;
        y -= Math.cos(a) * 0.95;
        const px = Math.floor(x), py = Math.floor(y);
        p.put(px, py, '#3F9A4B');
        const reach = t < 0.2 ? 0 : t > 0.85 ? 1 : 2;
        if (i % 2 === 1 && reach) {
          const nx = Math.cos(a), ny = Math.sin(a);
          for (let k = 1; k <= reach; k++) {
            p.put(Math.round(px + nx * k), Math.round(py + ny * k - k * 0.4), k === reach ? '#8EDB7E' : '#63C466');
            p.put(Math.round(px - nx * k), Math.round(py - ny * k - k * 0.4), k === reach ? '#7ACF76' : '#55B560');
          }
        }
      }
    }
  },
  seaweed: (p, r) => {
    p.clear();
    for (const [x0, top, ph] of [[3, 2, 0], [8, 0, 2], [12, 4, 4]]) {
      for (let y = 15; y >= top; y--) {
        const x = x0 + Math.round(Math.sin(y * 0.55 + ph) * 1.3);
        p.put(x, y, '#4CC08E');
        p.put(x + 1, y, '#34A37A');
        if (y % 4 === 0) p.put(x - 1, y, '#7ADBAE');
      }
    }
  },
  candle: (p) => {
    p.clear();
    p.art([
      '.......o........',
      '.......oo.......',
      '......oyo.......',
      '......oyyo......',
      '......oywo......',
      '.......yo.......',
      '.......k........',
      '.....appbb......',
      '.....apppb......',
      '.....apppbp.....',
      '.....apppbp.....',
      '.....apppb......',
      '.....apppb......',
      '....gggggggg....',
      '.....hhhhhh.....',
    ], { o: '#FFB347', y: '#FFE070', w: '#FFFBE6', k: '#5A4A5E', a: '#FFE0EC', p: '#FFB8D2', b: '#F28EB5', g: '#F7D067', h: '#E0AE45' }, 0, 1);
  },
  lollipop: (p) => {
    p.clear();
    for (let y = 9; y < 16; y++) { p.put(7, y, '#FFFFFF'); p.put(8, y, '#E6DDEA'); }
    const cols = ['#FF7FAE', '#FFFFFF', '#FFB3D1', '#FFFFFF'];
    for (let y = 0; y < 11; y++) {
      for (let x = 2; x < 14; x++) {
        const dx = x + 0.5 - 8, dy = y + 0.5 - 5.2, d = Math.hypot(dx, dy);
        if (d > 4.7) continue;
        if (d > 4.0) { p.put(x, y, '#E0508A'); continue; }
        const a = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
        p.put(x, y, cols[Math.floor(a * 2 + d * 0.5) % 4]);
      }
    }
    p.put(6, 3, '#FFFFFF'); p.put(5, 4, '#FFFFFF');
    p.art(['b.b', '.b.', 'b.b'], { b: '#8FD0FF' }, 6, 10);
  },
  seashell: (p) => {
    p.clear();
    const hx = 8, hy = 13.2;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x + 0.5 - hx, dy = y + 0.5 - hy;
        const d = Math.hypot(dx, dy), a = Math.atan2(dx, -dy);
        if (Math.abs(a) > 1.2) continue;
        const ridge = (a + 1.2) / 0.3;
        const edge = 9.6 - Math.abs(Math.sin(ridge * Math.PI)) * 0.9;
        if (d > edge) continue;
        const k = Math.floor(ridge) % 2;
        let c = k ? '#FFC7B8' : '#FFDCCF';
        if (d > edge - 1) c = '#F2A596';
        else if (d < 3) c = '#FFE9E1';
        p.put(x, y, c);
      }
    }
    p.art(['aaaaa', 'bbbbb'], { a: '#F7B5A6', b: '#E8958A' }, 6, 13);
  },
  starfish: (p) => {
    p.clear();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x + 0.5 - 8, dy = y + 0.5 - 8.4;
        const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx) + Math.PI / 2;
        const arm = Math.pow((Math.cos(5 * a) + 1) / 2, 2.2);
        const R = 2.3 + 5.4 * arm;
        if (d > R) continue;
        let c = d > R - 0.9 ? '#EE7F63' : '#FF9E7E';
        if (arm > 0.6 && Math.round(d) % 2 === 0 && d > 2 && d < R - 1) c = '#FFD7C4';
        p.put(x, y, c);
      }
    }
    p.put(7, 7, '#FFBFA6');
  },
  lily_pad: (p) => {
    p.clear();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
        const d = Math.hypot(dx, dy);
        if (d > 7.2) continue;
        const a = Math.atan2(dy, dx);
        if (Math.abs(a - 0.75) < 0.28 && d > 0.8) continue;
        let c = d > 6.3 ? '#4FAA62' : '#67C476';
        if (Math.abs(Math.sin(a * 3)) < 0.18 && d > 1.5 && d < 6.3) c = '#86D690';
        p.put(x, y, c);
      }
    }
    p.art(['.a.', 'aya', '.a.'], { a: '#FFA8CF', y: '#FFE066' }, 4, 4);
    p.put(4, 4, '#FFD1E6');
  },
};

export function install(L) {
  const { tile, block } = L;
  for (const [key, fn] of Object.entries(PAINT)) tile(key, fn);

  const fl = { category: 'garden', shape: 'cross', sound: 'pop' };
  block({ key: 'flower_rose', name: 'Rose', ...fl });
  block({ key: 'flower_tulip', name: 'Purple Tulip', ...fl });
  block({ key: 'flower_tulip_pink', name: 'Pink Tulip', ...fl });
  block({ key: 'flower_tulip_red', name: 'Red Tulip', ...fl });
  block({ key: 'flower_tulip_white', name: 'White Tulip', ...fl });
  block({ key: 'flower_daisy', name: 'Daisy', ...fl });
  block({ key: 'flower_cosmos', name: 'Pink Cosmos', ...fl });
  block({ key: 'flower_sunflower', name: 'Sunflower', ...fl });
  block({ key: 'flower_poppy', name: 'Poppy', ...fl });
  block({ key: 'flower_lavender', name: 'Lavender', ...fl });
  block({ key: 'flower_bluebell', name: 'Bluebells', ...fl });
  block({ key: 'flower_lily', name: 'Lily of the Valley', ...fl });
  block({ key: 'flower_forgetmenot', name: 'Forget-Me-Nots', ...fl });
  block({ key: 'grass_tall', name: 'Tall Grass', ...fl });
  block({ key: 'fern', name: 'Fern', ...fl });
  block({ key: 'mushroom_red', name: 'Red Mushroom', ...fl });
  block({ key: 'mushroom_glow', name: 'Glowing Mushroom', ...fl, light: 10, sound: 'chime' });

  // bushy & farm blocks
  tile('hedge', (p, r) => {
    leaves(p, r, ['#4FA863', '#5BB76C', '#68C375', '#78CE82', '#8BDA92'], { holes: 0 });
    p.bevel(0.1, -0.12);
  });
  tile('hedge_flowers', (p, r) => {
    leaves(p, r, ['#4FA863', '#5BB76C', '#68C375', '#78CE82', '#8BDA92'], { holes: 0 });
    p.bevel(0.1, -0.12);
    const spots = [[2, 2], [9, 1], [13, 6], [5, 8], [10, 11], [2, 13]];
    spots.forEach(([x, y], i) => {
      const c = i % 3 === 2 ? '#FFFFFF' : '#FF8DB7';
      p.set(x, y, c); p.set(x + 1, y, c); p.set(x, y + 1, tone(c, -0.12)); p.set(x + 1, y + 1, c);
      p.set(x + 1, y, i % 3 === 2 ? '#FFE680' : '#FFD1E3');
    });
  });
  tile('pumpkin_side', (p, r) => {
    const cols = ['#E8893A', '#F29A47', '#F8AA57', '#FDBB6C'];
    p.each((x, y) => {
      const rib = x & 3;
      let k = rib === 0 ? 0 : rib === 1 ? 2 : rib === 2 ? 3 : 1;
      if (y === 0 || y === 15) k = Math.max(0, k - 1);
      p.set(x, y, cols[k]);
      if (r() < 0.06) p.shade(x, y, 0.08);
    });
  });
  tile('melon_side', (p, r) => {
    p.each((x, y) => {
      const s = (x + Math.round(Math.sin(y * 0.8) * 0.8) + 16) % 5;
      p.set(x, y, s === 0 ? '#4E9E55' : s === 1 ? '#6BBF65' : s === 4 ? '#8ED67E' : '#7CCB70');
      if (r() < 0.05) p.shade(x, y, 0.1);
    });
  });
  tile('melon_top', (p, r) => {
    p.each((x, y) => {
      const a = Math.atan2(y - 7.5, x - 7.5), d = Math.hypot(x - 7.5, y - 7.5);
      const s = Math.floor(((a / (Math.PI * 2)) + 1) * 10 + d * 0.1) % 2;
      p.set(x, y, s ? '#6BBF65' : '#8ED67E');
    });
    p.rect(7, 7, 2, 2, '#4E9E55');
  });
  tile('hay_side', (p, r) => {
    const cols = ['#E4B550', '#EDC463', '#F4D175', '#F9DE8C'];
    const cv = [];
    for (let x = 0; x < 16; x++) cv.push(Math.floor(r() * 4));
    p.each((x, y) => {
      let k = cv[x];
      if (r() < 0.25) k = Math.max(0, Math.min(3, k + (r() < 0.5 ? -1 : 1)));
      p.set(x, y, cols[k]);
    });
    for (const y0 of [3, 11]) for (let x = 0; x < 16; x++) { p.set(x, y0, '#F2A0B8'); p.set(x, y0 + 1, '#E080A0'); }
  });
  tile('hay_top', (p, r) => {
    const cols = ['#E4B550', '#EDC463', '#F4D175', '#F9DE8C'];
    p.each((x, y) => p.set(x, y, cols[Math.floor(r() * 4)]));
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      p.set(x, y, '#C99A3E'); p.set(x + 1, y, '#FBE7A4');
    }
  });
  tile('farmland_top', (p, r) => {
    const cols = ['#7A5340', '#88604A', '#966C55'];
    p.each((x, y) => {
      const f = y & 3;
      p.set(x, y, f === 0 ? '#6A4636' : f === 1 ? '#A57A60' : cols[Math.floor(r() * 3)]);
    });
  });
  tile('farmland_wet_top', (p, r) => {
    const cols = ['#5E3E30', '#6A4838', '#765241'];
    p.each((x, y) => {
      const f = y & 3;
      p.set(x, y, f === 0 ? '#4E3228' : f === 1 ? '#8A6450' : cols[Math.floor(r() * 3)]);
    });
    for (let i = 0; i < 5; i++) p.set(Math.floor(r() * 16), (Math.floor(r() * 4) << 2) + 1, '#9FB7D6');
  });

  block({ key: 'hedge', name: 'Hedge', category: 'garden', sound: 'pop' });
  block({ key: 'hedge_flowers', name: 'Flower Hedge', category: 'garden', sound: 'pop' });
  block({ key: 'pumpkin', name: 'Pumpkin', category: 'garden', tiles: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top' } });
  block({ key: 'melon', name: 'Watermelon', category: 'garden', tiles: { top: 'melon_top', side: 'melon_side', bottom: 'melon_top' } });
  block({ key: 'hay', name: 'Hay Bale', category: 'garden', tiles: { top: 'hay_top', side: 'hay_side', bottom: 'hay_top' } });
  block({ key: 'farmland', name: 'Garden Soil', category: 'garden', tiles: { top: 'farmland_top', side: 'dirt', bottom: 'dirt' } });
  block({ key: 'farmland_wet', name: 'Watered Soil', category: 'garden', hidden: true, tiles: { top: 'farmland_wet_top', side: 'dirt', bottom: 'dirt' } });

  // decorations that live in other tabs
  const flat = { shape: 'carpet', transparent: true, replaceable: true, sound: 'pop', flatIcon: true };
  block({ key: 'seashell', name: 'Seashell', category: 'nature', ...flat });
  block({ key: 'starfish', name: 'Starfish', category: 'nature', ...flat });
  block({ key: 'lily_pad', name: 'Lily Pad', category: 'nature', ...flat });
  block({ key: 'seaweed', name: 'Seaweed', category: 'nature', shape: 'cross', sound: 'pop' });
  block({ key: 'candle', name: 'Little Candle', category: 'lights', shape: 'cross', light: 12, sound: 'chime' });
  block({ key: 'lollipop', name: 'Lollipop', category: 'candy', shape: 'cross', sound: 'pop' });
}

