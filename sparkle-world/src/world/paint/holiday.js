// Holiday Village blocks (wave 5, docs/teams/holiday-world.md): twinkle-light garlands, tree
// baubles and the star, gingerbread walls with icing trim, snowy roofs, glowing cottage windows,
// holly, wrapped presents, the workshop's red planks and toy shelves. All of them go in the
// Bag's Holiday tab, so she can build her own village anywhere.
//
// 16 blocks (the wave-5 budget for this team, wave5-plan.md §5.1). Light blocks glow at night
// with the shared warm block light; their tiles are bright and saturated so they still read as
// lights by day.

import { tone, mix, natural, fbm, sparkle, inCircle, drip, G } from './kit.js';

// pastel-bright bulb colors (Glimmer World palette: never harsh primaries)
const RAINBOW_BULBS = ['#FF5F7E', '#FFD34D', '#5FC8FF', '#7EE07A', '#C77DFF', '#FF9A4D'];
const GOLD_BULBS = ['#FFF4C2', '#FFE27A', '#FFFBE6', '#FFD95C'];
const ICY_BULBS = ['#8FD3FF', '#FFFFFF', '#B7A8FF', '#5FB4FF', '#E2F6FF'];

const PINE = ['#2C6F5C', '#357D67', '#3F8B73', '#4B9A80', '#5AA98E'];
const PINE_DARK = ['#1F5A4A', '#276552', '#2F725E', '#3B8069', '#4A9078'];
const PINE_FROST = ['#2F6E7E', '#3A7C8C', '#46899A', '#5A9CAC', '#9CCFE0'];

/** Pine needles: short diagonal strokes over a dark base, so a garland looks bushy. */
function needles(p, rand, cols) {
  natural(p, rand, cols.slice(0, 3), { oct: [[4, 0.6], [8, 0.4]], dither: 0.3 });
  for (let i = 0; i < 34; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    const c = cols[2 + Math.floor(rand() * (cols.length - 2))];
    const dir = rand() < 0.5 ? 1 : -1;
    p.set(x, y, c);
    p.set(x + dir, y + 1, c);
    if (rand() < 0.5) p.set(x + 2 * dir, y + 2, tone(c, -0.08));
  }
}

/** A glowing bulb (3 px wide, 4 tall under its socket) with a shine and a soft halo. */
function bulb(p, x, y, c) {
  const halo = tone(c, 0.4);
  for (const [dx, dy] of [[-1, 2], [3, 2], [-1, 3], [3, 3], [0, 5], [2, 5], [1, 6]]) p.blend(x + dx, y + dy, halo, 0.45);
  p.set(x + 1, y, '#4A3B30'); // the little socket
  p.set(x, y + 1, tone(c, 0.6)); p.set(x + 1, y + 1, tone(c, 0.3)); p.set(x + 2, y + 1, c);
  p.set(x, y + 2, tone(c, 0.2)); p.set(x + 1, y + 2, c); p.set(x + 2, y + 2, tone(c, -0.1));
  p.set(x, y + 3, c); p.set(x + 1, y + 3, c); p.set(x + 2, y + 3, tone(c, -0.18));
  p.set(x + 1, y + 4, tone(c, -0.12));
}

/** A garland of pine with two wires looping across it and bulbs hanging along them. */
function garland(p, rand, pine, bulbs, wire) {
  needles(p, rand, pine);
  // the wires: soft waves with one full period across the tile, so the pattern tiles
  const wy = (x) => Math.round(3 + Math.sin(((x & 15) / 16) * Math.PI * 2) * 1.5);
  const wy2 = (x) => Math.round(10 + Math.sin(((x & 15) / 16) * Math.PI * 2 + Math.PI) * 1.5);
  for (let x = 0; x < 16; x++) {
    p.set(x, wy(x), wire);
    p.set(x, wy2(x), wire);
  }
  let k = Math.floor(rand() * bulbs.length);
  for (const bx of [0, 4, 8, 12]) bulb(p, bx, wy(bx + 1), bulbs[k++ % bulbs.length]);
  for (const bx of [2, 6, 10, 14]) bulb(p, bx, wy2(bx + 1), bulbs[k++ % bulbs.length]);
}

/** A shiny tree bauble on pine needles: radial shading, a band, a gold cap and a shine. */
function bauble(p, rand, base, band) {
  needles(p, rand, PINE);
  const lit = tone(base, 0.32), mid = base, dark = tone(base, -0.28), deep = tone(base, -0.42);
  p.each((x, y) => {
    if (!inCircle(x, y, 8, 9, 5.6)) return;
    const d = Math.hypot(x + 0.5 - 6.2, y + 0.5 - 7.2) / 8.5; // light from the top left
    p.set(x, y, d < 0.35 ? lit : d < 0.62 ? mid : d < 0.85 ? dark : deep);
  });
  // a decorated band round the middle with little dots under it
  for (let x = 3; x < 13; x++) {
    if (!inCircle(x, 9, 8, 9, 5.6)) continue;
    p.set(x, 9, band);
    p.blend(x, 10, band, 0.45);
  }
  for (const x of [5, 8, 11]) p.set(x, 12, tone(band, 0.2));
  // the cap and the hook
  p.rect(6, 2, 4, 2, '#F2C14E');
  p.set(6, 2, '#FFE79A'); p.set(9, 3, '#C9952F');
  p.set(7, 1, '#E8E2D0'); p.set(8, 0, '#E8E2D0');
  // the shine
  p.set(5, 6, '#FFFFFF'); p.set(6, 6, '#FFFFFF'); p.set(5, 7, '#FFFFFF'); p.blend(7, 5, '#FFFFFF', 0.6);
  p.blend(11, 12, '#FFFFFF', 0.5);
}

/** Gingerbread dough: warm baked brown with crumbs. */
function dough(p, rand) {
  natural(p, rand, ['#A8622F', '#B56E37', '#C07A40', '#CA864A'], { dither: 0.28 });
  for (let i = 0; i < 10; i++) p.set(Math.floor(rand() * 16), Math.floor(rand() * 16), '#D9985A');
  for (let i = 0; i < 7; i++) p.set(Math.floor(rand() * 16), Math.floor(rand() * 16), '#94532A');
}

/** Snow cushion (roof tops): white with cool lavender-blue shadows and a glint. */
function snowTop(p, rand) {
  natural(p, rand, ['#DDE6F7', '#E9EFFB', '#F3F7FE', '#FFFFFF'], { dither: 0.25 });
  for (let i = 0; i < 4; i++) p.set(Math.floor(rand() * 16), Math.floor(rand() * 16), '#FFFFFF');
  sparkle(p, 4 + Math.floor(rand() * 8), 4 + Math.floor(rand() * 8), '#FFFFFF', 1);
}

/** Roof shingles in staggered rows, with a snow cap dripping over the top. */
function shingles(p, rand, base, { snow = true } = {}) {
  const hi = tone(base, 0.16), lo = tone(base, -0.18), seam = tone(base, -0.34);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4, off = (row & 1) * 2;
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 0; x < 16; x++) {
        let c = tone(base, (rand() - 0.5) * 0.06);
        if (y === y0 + 3) c = seam;
        else if (y === y0) c = hi;
        else if (y === y0 + 2) c = mix(c, lo, 0.4);
        if ((x + off) % 4 === 3 && y !== y0 + 3) c = lo;
        p.set(x, y, c);
      }
    }
  }
  if (snow) drip(p, rand, ['#D9E3F5', '#E8EEFA', '#F4F7FE', '#FFFFFF'], { min: 3, max: 6, rim: '#BFCDE6' });
}

/** Red-painted planks with little brass nails (the workshop and the stable). */
function redPlanks(p, rand) {
  const base = '#D9475C', seam = '#9C2E46';
  for (let r = 0; r < 4; r++) {
    const y0 = r * 4;
    const cut = (r * 5 + 3 + Math.floor(rand() * 5)) % 16;
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 0; x < 16; x++) {
        let c = tone(base, (rand() - 0.5) * 0.08);
        if (y === y0 + 3) c = seam;
        else if (y === y0) c = tone(base, 0.16);
        else if (rand() < 0.12) c = tone(base, -0.08);
        p.set(x, y, c);
      }
    }
    for (let y = y0; y < y0 + 3; y++) p.set(cut, y, seam);
    p.set(cut + 2, y0 + 1, '#F3C6A0');
  }
}

/** The toy shelf: a wooden frame, two shelves and tiny toys on them. */
function toyShelf(p) {
  p.fill('#6E4A33');
  const wood = '#C8935E', woodLit = '#E0AE78', woodDark = '#9C6B44';
  for (let y = 1; y < 7; y++) for (let x = 1; x < 15; x++) p.set(x, y, y < 3 ? '#5A3A28' : '#654230');
  for (let y = 9; y < 14; y++) for (let x = 1; x < 15; x++) p.set(x, y, y < 11 ? '#5A3A28' : '#654230');
  for (let t = 0; t < 16; t++) {
    p.set(t, 0, woodLit); p.set(t, 15, woodDark); p.set(0, t, woodLit); p.set(15, t, woodDark);
    p.set(t, 7, wood); p.set(t, 8, woodDark); p.set(t, 14, wood);
  }
  // top shelf: a teddy, a ball, a little toy block
  p.art(['X...X', 'XXXXX', 'XoXoX', '.XXX.', 'XXXXX', '.X.X.'], { X: '#D9A066', o: '#3A2A20' }, 1, 1);
  p.art(['.XX.', 'XWXX', 'XXXX', '.XX.'], { X: '#FF6F91', W: '#FFFFFF' }, 7, 3);
  p.art(['XXX', 'XYX', 'XXX'], { X: '#7FC8FF', Y: '#FFFFFF' }, 12, 4);
  // bottom shelf: a little train and a wrapped box
  p.art(['X....', 'XXXXX', 'XRRXX', '.o.o.'], { X: '#5FBF7A', R: '#FFD34D', o: '#3A2A20' }, 2, 10);
  p.art(['.G.', 'RGR', 'RGR'], { R: '#FF5F7E', G: '#FFE27A' }, 10, 11);
  p.set(13, 13, '#C77DFF'); p.set(13, 12, '#E3B8FF');
}

const STAR = [
  '.......X.......',
  '......XXX......',
  '......XXX......',
  '.....XXXXX.....',
  'XXXXXXXXXXXXXXX',
  '.XXXXXXXXXXXXX.',
  '...XXXXXXXXX...',
  '....XXXXXXX....',
  '....XXXXXXX....',
  '...XXXX.XXXX...',
  '...XXX...XXX...',
  '..XX.......XX..',
  '..X.........X..',
];

export function install(L) {
  const { tile, block } = L;
  const hol = { category: 'holiday' };
  const glow = { category: 'holiday', sound: 'chime' };

  // ---------- lights ----------
  tile('holiday_lights', (p, r) => garland(p, r, PINE_DARK, RAINBOW_BULBS, '#16261E'));
  tile('holiday_lights_gold', (p, r) => garland(p, r, PINE_DARK, GOLD_BULBS, '#3E3320'));
  tile('holiday_lights_icy', (p, r) => garland(p, r, PINE_FROST, ICY_BULBS, '#E4F3FF'));
  tile('holiday_bauble_red', (p, r) => bauble(p, r, '#F0465F', '#FFF2D6'));
  tile('holiday_bauble_gold', (p, r) => bauble(p, r, '#F6C24A', '#FFFFFF'));
  tile('holiday_bauble_blue', (p, r) => bauble(p, r, '#5AA8F5', '#FFE27A'));
  tile('holiday_star', (p) => {
    // a golden glow with one big star and little twinkles
    p.each((x, y) => {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      p.set(x, y, d < 4 ? '#FFF6C8' : d < 6.5 ? '#FFE680' : d < 9 ? '#FFD24F' : '#F5B83A');
    });
    p.glyph(STAR, '#FFFDF0', 0, 1);
    p.glyph(['X', 'X', 'X'], '#FFFFFF', 7, 4);
    p.glyph(['XXX'], '#FFFFFF', 6, 6);
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) sparkle(p, x, y, '#FFFFFF', 1);
  });

  // ---------- cottages and the workshop ----------
  tile('holiday_gingerbread', (p, r) => {
    dough(p, r);
    // a piped icing zigzag along the top and two candy buttons: gingerbread siding
    for (let x = 0; x < 16; x++) {
      const y = (x & 3) === 0 ? 1 : (x & 3) === 2 ? 3 : 2;
      p.set(x, y, '#FFF9F2');
      p.blend(x, y + 1, '#94532A', 0.5);
    }
    p.art(['.X.', 'XWX', '.X.'], { X: '#FF5F7E', W: '#FFC2CE' }, 3, 8);
    p.art(['.X.', 'XWX', '.X.'], { X: '#5FBF7A', W: '#BDF0C8' }, 11, 10);
  });
  tile('holiday_icing_side', (p, r) => {
    // a white icing band with round scallops hanging at the bottom (cutout) and candy dots
    p.clear();
    const n = fbm(r, [[4, 1]]);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const k = x & 3;
        const hang = k === 0 || k === 3 ? 10 : 12;
        if (y > hang) continue;
        const v = n[y * 16 + x];
        let c = v > 0.66 ? '#FFFFFF' : v > 0.33 ? '#FBF6FA' : '#F1E9F1';
        if (y === 0) c = '#FFFFFF';
        if (y === hang) c = '#E3D3E3';
        p.set(x, y, c);
      }
    }
    for (const [x, c] of [[1, '#FF5F7E'], [5, '#5FBF7A'], [9, '#FFD34D'], [13, '#5FC8FF']]) {
      p.set(x, 5, tone(c, 0.4)); p.set(x + 1, 5, c); p.set(x, 6, tone(c, -0.15)); p.set(x + 1, 6, c);
    }
  });
  tile('holiday_icing_top', (p, r) => {
    natural(p, r, ['#EFE6EF', '#F8F2F8', '#FFFFFF'], { dither: 0.3 });
    for (const [x, y, c] of [[3, 4, '#FF5F7E'], [11, 3, '#5FBF7A'], [7, 11, '#FFD34D'], [13, 12, '#5FC8FF']]) { p.set(x, y, c); p.set(x + 1, y, c); }
  });
  tile('holiday_roof_top', snowTop);
  tile('holiday_roof_side', (p, r) => shingles(p, r, '#E0475E'));
  tile('holiday_roof_under', (p, r) => shingles(p, r, '#C93A55', { snow: false }));
  tile('holiday_roof_green_side', (p, r) => shingles(p, r, '#3E9C6E'));
  tile('holiday_roof_green_under', (p, r) => shingles(p, r, '#2F8660', { snow: false }));
  tile('holiday_window', (p) => {
    // a warm lit window: icing frame, four glowing panes, frost in the corners
    p.each((x, y) => {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 9);
      p.set(x, y, d < 3 ? '#FFF4C9' : d < 5.5 ? '#FFE08A' : d < 8 ? '#FFC967' : '#FFB55A');
    });
    for (let t = 0; t < 16; t++) {
      p.set(t, 0, '#FFFFFF'); p.set(t, 1, '#F3ECF3'); p.set(t, 15, '#E3D6E3'); p.set(t, 14, '#F3ECF3');
      p.set(0, t, '#FFFFFF'); p.set(1, t, '#F3ECF3'); p.set(15, t, '#E3D6E3'); p.set(14, t, '#F3ECF3');
      p.set(7, t, '#F3ECF3'); p.set(8, t, '#E3D6E3');
      p.set(t, 7, '#F3ECF3'); p.set(t, 8, '#E3D6E3');
    }
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [13, 13], [12, 13], [13, 12], [9, 2], [2, 9]]) p.blend(x, y, '#FFFFFF', 0.75);
    p.blend(4, 4, '#FFFFFF', 0.6); p.blend(11, 4, '#FFFFFF', 0.4);
  });
  tile('holiday_holly', (p, r) => {
    // spiky holly leaves in clumps (cutout gaps between them) with bright berry triples
    p.clear();
    const leaf = ['#2E7A4F', '#3A8C5C', '#48A06A', '#5DB57C'];
    const LEAF = ['..X...', '.XXX.X', 'XXXXXX', '.XXXXX', 'XXXXX.', '.X.XX.'];
    for (const [ox, oy] of [[0, 0], [8, 1], [3, 6], [10, 8], [0, 11], [6, 12], [12, 2]]) {
      const c = leaf[Math.floor(r() * leaf.length)];
      p.glyph(LEAF, c, ox, oy);
      p.set(ox + 2, oy + 2, tone(c, 0.25));
      p.set(ox + 3, oy + 3, tone(c, -0.2));
    }
    for (const [x, y] of [[5, 4], [12, 7], [3, 11], [10, 13], [14, 1]]) {
      p.set(x, y, '#FF8A9C'); p.set(x + 1, y, '#E01F3D'); p.set(x, y + 1, '#C8183A'); p.set(x + 1, y + 1, '#F2334F');
    }
  });
  tile('holiday_present_side', (p) => {
    p.fill('#E8455C');
    for (let gy = 1; gy < 16; gy += 5) for (let gx = (gy % 2) ? 1 : 3; gx < 16; gx += 5) p.glyph(G.plus3, '#FFD0D8', gx, gy);
    for (let y = 0; y < 16; y++) { p.set(6, y, '#FFD34D'); p.set(7, y, '#FFF0A8'); p.set(8, y, '#FFD34D'); p.set(9, y, '#E0A92E'); }
    for (let x = 0; x < 16; x++) { p.set(x, 0, '#FF7A8E'); p.set(x, 15, '#BE2E4A'); }
  });
  tile('holiday_present_top', (p) => {
    p.fill('#E8455C');
    for (let t = 0; t < 16; t++) { p.set(6, t, '#FFD34D'); p.set(7, t, '#FFF0A8'); p.set(8, t, '#FFD34D'); p.set(9, t, '#E0A92E'); }
    for (let t = 0; t < 16; t++) { p.set(t, 6, '#FFD34D'); p.set(t, 7, '#FFF0A8'); p.set(t, 8, '#FFD34D'); p.set(t, 9, '#E0A92E'); }
    const bow = ['.XXX....XXX.', 'XXXXX..XXXXX', 'XXX.XXXX.XXX', 'XXXXX..XXXXX', '.XXX....XXX.'];
    p.glyph(bow, '#4CB873', 2, 5);
    p.glyph(['XX', 'XX'], '#9BE8B4', 7, 6);
    p.set(3, 5, '#9BE8B4'); p.set(10, 5, '#9BE8B4');
  });
  tile('holiday_planks_red', redPlanks);
  tile('holiday_toy_shelf', toyShelf);

  // ---------- the blocks (Bag order inside the Holiday tab) ----------
  block({ key: 'holiday_lights', name: 'Twinkle Lights', ...glow, light: 13 });
  block({ key: 'holiday_lights_gold', name: 'Golden Lights', ...glow, light: 14 });
  block({ key: 'holiday_lights_icy', name: 'Icy Lights', ...glow, light: 12 });
  block({ key: 'holiday_star', name: 'Tree Star', ...glow, light: 15 });
  block({ key: 'holiday_bauble_red', name: 'Red Bauble', ...glow, light: 8 });
  block({ key: 'holiday_bauble_gold', name: 'Gold Bauble', ...glow, light: 8 });
  block({ key: 'holiday_bauble_blue', name: 'Blue Bauble', ...glow, light: 8 });
  block({ key: 'holiday_present', name: 'Wrapped Present', ...hol, sound: 'pop', tiles: { top: 'holiday_present_top', side: 'holiday_present_side', bottom: 'holiday_present_side' } });
  block({ key: 'holiday_gingerbread', name: 'Gingerbread', ...hol, sound: 'pop' });
  block({ key: 'holiday_icing', name: 'Icing Trim', ...hol, sound: 'pop', transparent: true, lightOpacity: 0, tiles: { top: 'holiday_icing_top', side: 'holiday_icing_side', bottom: 'holiday_icing_top' } });
  block({ key: 'holiday_window', name: 'Cozy Window', ...glow, light: 12 });
  block({ key: 'holiday_roof', name: 'Snowy Red Roof', ...hol, tiles: { top: 'holiday_roof_top', side: 'holiday_roof_side', bottom: 'holiday_roof_under' } });
  block({ key: 'holiday_roof_green', name: 'Snowy Green Roof', ...hol, tiles: { top: 'holiday_roof_top', side: 'holiday_roof_green_side', bottom: 'holiday_roof_green_under' } });
  block({ key: 'holiday_holly', name: 'Holly', ...hol, sound: 'pop', transparent: true, lightOpacity: 1 });
  block({ key: 'holiday_planks_red', name: 'Workshop Planks', ...hol });
  block({ key: 'holiday_toy_shelf', name: 'Toy Shelf', ...hol, tiles: { top: 'planks_oak', side: 'holiday_toy_shelf', bottom: 'planks_oak' } });
}
