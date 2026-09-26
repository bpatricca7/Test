// Lights: glowing blocks that light up rooms and gardens at night.

import { tone, sparkle, inCircle, G } from './kit.js';

/** Soft glowing panel: bright middle fading to a warm rim. */
function glowPanel(p, rand, center, mid, edge, frame) {
  p.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const r = Math.hypot(x - 7.5, y - 7.5);
    let c;
    if (d > 6.6) c = frame;
    else if (d > 5.6) c = edge;
    else c = r < 3.2 ? center : r < 5.3 ? mid : edge;
    p.set(x, y, c);
    if (rand() < 0.05 && d <= 5.6) p.shade(x, y, 0.1);
  });
}

function facets(p, rand, base) {
  // crystal: a bright diamond facet in the middle, four tilted planes around it
  p.each((x, y) => {
    const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
    const diamond = Math.abs(dx) + Math.abs(dy);
    let t;
    if (diamond < 4.6) t = 0.26 - diamond * 0.03;
    else if (dx < 0 && dy < 0) t = 0.12;
    else if (dx >= 0 && dy < 0) t = 0.02;
    else if (dx < 0 && dy >= 0) t = -0.06;
    else t = -0.16;
    if (Math.abs(diamond - 4.6) < 0.5) t += 0.18;
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.5 && diamond > 4.6) t -= 0.08;
    p.set(x, y, tone(base, t + (rand() - 0.5) * 0.04));
  });
  p.bevel(0.2, -0.2);
  sparkle(p, 6, 5, '#FFFFFF', 1);
  sparkle(p, 11, 11, '#FFFFFF', 0);
  p.set(3, 12, '#FFFFFF');
}

const SMILE = [
  '................',
  '................',
  '................',
  '...XX......XX...',
  '..XXXX....XXXX..',
  '..XXXX....XXXX..',
  '...XX......XX...',
  '................',
  '................',
  '..X..........X..',
  '..XX........XX..',
  '...XXXXXXXXXX...',
  '....XXXXXXXX....',
  '......XXXX......',
  '................',
  '................',
];

function pumpkinSide(p, rand) {
  const cols = ['#E8893A', '#F29A47', '#F8AA57', '#FDBB6C'];
  p.each((x, y) => {
    const rib = x & 3;
    let k = rib === 0 ? 0 : rib === 1 ? 2 : rib === 2 ? 3 : 1;
    if (y === 0 || y === 15) k = Math.max(0, k - 1);
    p.set(x, y, cols[k]);
    if (rand() < 0.06) p.shade(x, y, 0.08);
  });
}

export function install(L) {
  const { tile, block } = L;
  tile('lamp_block', (p, r) => {
    glowPanel(p, r, '#FFFBE6', '#FFEDB0', '#FFD98A', '#E3A64C');
    for (let t = 2; t < 14; t++) { p.blend(t, 7, '#FFE39A', 0.35); p.blend(7, t, '#FFE39A', 0.35); }
    p.set(4, 4, '#FFFFFF'); p.set(5, 4, '#FFFFFF'); p.set(4, 5, '#FFFFFF');
  });
  tile('lantern_side', (p, r) => {
    p.each((x, y) => {
      const dx = Math.abs(x - 7.5) / 7.5;
      let c = dx < 0.35 ? '#FFE9CF' : dx < 0.7 ? '#FFC7CF' : '#FFA9BE';
      if (y % 3 === 2) c = tone(c, -0.12);
      p.set(x, y, c);
    });
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, '#E3AE45'); p.set(x, 1, '#F2C65E'); p.set(x, 15, '#D59A36'); p.set(x, 14, '#E8B84E');
    }
    p.set(4, 4, '#FFFFFF');
  });
  tile('lantern_top', (p, r) => {
    p.fill('#E8B84E');
    p.each((x, y) => {
      if (inCircle(x, y, 8, 8, 5.2)) p.set(x, y, '#FFD0A8');
      if (inCircle(x, y, 8, 8, 3.2)) p.set(x, y, '#FFF3DC');
      if (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 6.6) p.set(x, y, '#D59A36');
    });
  });
  tile('sea_lantern', (p, r) => {
    glowPanel(p, r, '#F2FFFD', '#C6F5EE', '#A2E8DF', '#7ACFC5');
    const sw = [[4, 4], [11, 4], [4, 11], [11, 11]];
    for (const [cx, cy] of sw) {
      p.each((x, y) => { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (Math.abs(d - 2) < 0.45) p.blend(x, y, '#FFFFFF', 0.6); });
    }
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) p.set(x, y, '#5FB9AF');
  });
  tile('star_block', (p, r) => {
    glowPanel(p, r, '#FFF2A8', '#FFE37A', '#FFD55C', '#F2B940');
    p.glyph(G.star5, '#FFFBE0', 2, 2);
    p.glyph(G.star5, '#FFFBE0', 9, 9);
    p.glyph(['X'], '#FFFFFF', 4, 4); p.glyph(['X'], '#FFFFFF', 11, 11);
    sparkle(p, 12, 4, '#FFFFFF', 1);
    sparkle(p, 4, 12, '#FFFFFF', 1);
  });
  const crystals = [['crystal_pink', '#FF9CCB', 'Pink Crystal'], ['crystal_blue', '#8FCFFF', 'Blue Crystal'], ['crystal_purple', '#B89CFF', 'Purple Crystal']];
  for (const [key, color] of crystals) tile(key, (p, r) => facets(p, r, color));
  tile('pumpkin_lantern_side', pumpkinSide);
  tile('pumpkin_lantern_front', (p, r) => {
    pumpkinSide(p, r);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (SMILE[y][x] !== 'X') continue;
        const inner = SMILE[y][x - 1] === 'X' && SMILE[y][x + 1] === 'X' && SMILE[y - 1]?.[x] === 'X';
        p.set(x, y, inner ? '#FFF6C8' : '#FFE07A');
      }
    }
    // rosy cheeks
    p.set(2, 8, '#FF8FA0'); p.set(13, 8, '#FF8FA0');
  });
  tile('pumpkin_top', (p, r) => {
    p.each((x, y) => {
      const a = Math.atan2(y - 7.5, x - 7.5);
      const rib = Math.floor(((a / (Math.PI * 2)) + 1) * 12) % 3;
      p.set(x, y, rib === 0 ? '#E8893A' : rib === 1 ? '#F8AA57' : '#F29A47');
    });
    p.each((x, y) => { if (inCircle(x, y, 8, 8, 2.2)) p.set(x, y, inCircle(x, y, 7.5, 7.5, 1) ? '#8ED57A' : '#5FAE55'); });
  });
  tile('heart_lamp', (p, r) => {
    glowPanel(p, r, '#FFC3DA', '#FFB0CE', '#FF9DC3', '#EE7FAD');
    const H = ['.XXX.XXX.', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
    p.glyph(H, '#FFE9F2', 3, 4);
    p.glyph(['X.', 'XX'], '#FFFFFF', 5, 5);
  });
  tile('moon_lamp', (p, r) => {
    glowPanel(p, r, '#8595E8', '#7888E0', '#6D7CD6', '#5B68C2');
    p.each((x, y) => {
      if (inCircle(x, y, 8, 8, 5) && !inCircle(x, y, 10.2, 6.4, 4.1)) p.set(x, y, x + y < 13 ? '#FFFBE0' : '#FFF0A8');
    });
    for (const [x, y] of [[12, 3], [3, 12], [13, 11], [11, 13]]) p.set(x, y, '#FFFFFF');
    sparkle(p, 12, 11, '#FFF6C8', 1);
  });

  const glow = { category: 'lights', sound: 'chime' };
  block({ key: 'lamp_block', name: 'Glow Lamp', ...glow, light: 15 });
  block({ key: 'lantern', name: 'Paper Lantern', ...glow, light: 14, tiles: { top: 'lantern_top', side: 'lantern_side', bottom: 'lantern_top' } });
  block({ key: 'sea_lantern', name: 'Sea Lantern', ...glow, light: 15 });
  block({ key: 'star_block', name: 'Star Block', ...glow, light: 15 });
  block({ key: 'heart_lamp', name: 'Heart Lamp', ...glow, light: 13 });
  block({ key: 'moon_lamp', name: 'Moon Lamp', ...glow, light: 12 });
  block({ key: 'pumpkin_lantern', name: 'Happy Pumpkin', ...glow, light: 14, tiles: { top: 'pumpkin_top', sides: 'pumpkin_lantern_side', bottom: 'pumpkin_top', front: 'pumpkin_lantern_front' } });
  for (const [key, , name] of crystals) block({ key, name, ...glow, light: 11 });
}

