// Glass & windows: clear and tinted panes (cutout), picture windows (heart, star, flower)
// and see-through stained glass (translucent).

import { tone, rgb, glassPane, inCircle } from './kit.js';

const PANES = [
  ['glass', '#D8F0FF', '#FFFFFF', 'Glass'],
  ['glass_pink', '#FFB9D6', '#FFE8F2', 'Pink Glass'],
  ['glass_lavender', '#CDB9FF', '#F1EAFF', 'Lavender Glass'],
  ['glass_blue', '#9CCFFF', '#E6F4FF', 'Blue Glass'],
  ['glass_mint', '#A5E8CC', '#E8FFF5', 'Mint Glass'],
  ['glass_yellow', '#FFE08A', '#FFF8DC', 'Yellow Glass'],
];

const HEART9 = [
  '.XXX.XXX.',
  'XXXXXXXXX',
  'XXXXXXXXX',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '...XXX...',
  '....X....',
];
const STAR9 = [
  '....X....',
  '....X....',
  '...XXX...',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '..XXXXX..',
  '.XXX.XXX.',
  '.X.....X.',
];

/** Draw a filled shape with a light top-left edge and a darker bottom-right edge. */
function shape(p, rows, base, ox, oy) {
  const h = rows.length, w = rows[0].length;
  const inside = (c, r) => r >= 0 && r < h && c >= 0 && c < w && rows[r][c] === 'X';
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!inside(c, r)) continue;
      let t = 0;
      if (!inside(c, r - 1) || !inside(c - 1, r)) t = 0.3;
      else if (!inside(c, r + 1) || !inside(c + 1, r)) t = -0.2;
      p.set(ox + c, oy + r, tone(base, t));
    }
  }
}

function pictureWindow(p, draw) {
  glassPane(p, '#E9D9F7', '#FFFFFF', { inner: '#F7F0FF' });
  draw(p);
}

export function install(L) {
  const { tile, block } = L;
  for (const [key, frame, shine] of PANES) {
    tile(key, (p) => {
      glassPane(p, frame, shine, { inner: tone(frame, 0.35) });
      // little colored corner jewels so tinted glass reads from far away
      if (key !== 'glass') {
        const c = tone(frame, -0.08);
        for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.set(x, y, c);
        p.set(3, 2, tone(frame, 0.2)); p.set(2, 3, tone(frame, 0.2));
      }
    });
  }
  tile('glass_heart', (p) => pictureWindow(p, (q) => {
    shape(q, HEART9, '#FF86B5', 4, 4);
    q.set(5, 5, '#FFFFFF'); q.set(6, 5, '#FFE1EE'); q.set(5, 6, '#FFE1EE');
  }));
  tile('glass_star', (p) => pictureWindow(p, (q) => {
    shape(q, STAR9, '#FFD24D', 4, 3);
    q.set(8, 5, '#FFFFFF'); q.set(8, 6, '#FFF6C8');
  }));
  tile('glass_flower', (p) => pictureWindow(p, (q) => {
    const petals = [[8, 4.6], [11.2, 7.2], [10, 11], [6, 11], [4.8, 7.2]];
    q.each((x, y) => {
      for (const [cx, cy] of petals) if (inCircle(x, y, cx, cy, 2.3)) q.set(x, y, inCircle(x, y, cx - 0.6, cy - 0.6, 1.1) ? '#FFD9EA' : '#FF9CC6');
    });
    q.each((x, y) => { if (inCircle(x, y, 8, 8.2, 1.9)) q.set(x, y, inCircle(x, y, 7.6, 7.7, 0.8) ? '#FFF3B0' : '#FFCB47'); });
  }));

  // stained glass: lead lines between colored panes, see-through
  const stained = (colors) => (p, rand) => {
    const pts = [];
    for (let i = 0; i < 7; i++) pts.push([rand() * 16, rand() * 16, colors[i % colors.length]]);
    p.each((x, y) => {
      let d1 = Infinity, d2 = Infinity, best = 0;
      for (let i = 0; i < pts.length; i++) {
        let dx = Math.abs(x + 0.5 - pts[i][0]), dy = Math.abs(y + 0.5 - pts[i][1]);
        if (dx > 8) dx = 16 - dx;
        if (dy > 8) dy = 16 - dy;
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
      }
      if (d2 - d1 < 0.9) p.set(x, y, '#7B6893', 245);
      else {
        const c = rgb(pts[best][2]);
        p.set(x, y, d1 < 1.5 ? tone(c, 0.3) : c, d1 < 1.5 ? 175 : 140);
      }
    });
    for (let t = 0; t < 16; t++) { p.set(t, 0, '#8C7AA3', 250); p.set(0, t, '#8C7AA3', 250); }
  };
  tile('glass_stained_rainbow', stained(['#FF8FA8', '#FFC27A', '#FFE680', '#8EE3A0', '#7FC6FF', '#B79CFF', '#FF9CE0']));
  tile('glass_stained_pink', stained(['#FF8FBC', '#FFB3D1', '#FF7AAE', '#FFC9DF']));
  tile('glass_stained_blue', stained(['#7FBCFF', '#A6D2FF', '#6AA8F5', '#BFE0FF']));
  tile('glass_stained_purple', stained(['#B38CFF', '#CDB0FF', '#9D78F0', '#DCC8FF']));

  const pane = { category: 'glass', transparent: true, sound: 'chime' };
  block({ key: 'glass_heart', name: 'Heart Window', ...pane });
  for (const [key, , , name] of PANES) block({ key, name, ...pane });
  block({ key: 'glass_star', name: 'Star Window', ...pane });
  block({ key: 'glass_flower', name: 'Flower Window', ...pane });
  const st = { category: 'glass', translucent: true, lightOpacity: 0, sound: 'chime' };
  block({ key: 'glass_stained_rainbow', name: 'Rainbow Stained Glass', ...st });
  block({ key: 'glass_stained_pink', name: 'Pink Stained Glass', ...st });
  block({ key: 'glass_stained_blue', name: 'Blue Stained Glass', ...st });
  block({ key: 'glass_stained_purple', name: 'Purple Stained Glass', ...st });
}
