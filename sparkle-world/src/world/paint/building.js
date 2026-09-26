// Building blocks: planks, slabs, bricks, stone bricks, quartz & marble, clay tiles, roofs,
// bookshelf, floor tiles and wallpapers.

import { tone, ramp, natural, fbm, planks, bricks, motif, checker, G, sparkle } from './kit.js';

export const PLANKS = {
  pink: ['#FFB7D2', '#EB8DB3', 'Pink Planks'],
  white: ['#FBF4EC', '#DCCFC4', 'White Planks'],
  lavender: ['#D5C4FF', '#B19DEB', 'Lavender Planks'],
  mint: ['#B3EAD1', '#86CFAE', 'Mint Planks'],
  sky: ['#B7DCFF', '#8DBDEB', 'Sky Blue Planks'],
  oak: ['#E0B07A', '#B98A5C', 'Oak Planks'],
  birch: ['#F2DDB2', '#D4BD8F', 'Birch Planks'],
  cherry: ['#E4A08F', '#C57F70', 'Cherry Planks'],
};

const BRICKS = {
  brick_red: ['#E58B80', '#F7E8DD', 'Red Bricks'],
  brick_pink: ['#F6A6C0', '#FFF1F6', 'Pink Bricks'],
  brick_white: ['#F2ECE6', '#CFC6C9', 'White Bricks'],
  brick_lavender: ['#C6B0F0', '#F4EFFF', 'Lavender Bricks'],
};

const CLAY_TILES = {
  terracotta_peach: ['#F0B597', 'Peach Clay'],
  terracotta_pink: ['#EAA0B4', 'Pink Clay'],
  terracotta_lavender: ['#B9A1D8', 'Lilac Clay'],
  terracotta_mint: ['#9ACFB5', 'Mint Clay'],
};

const ROOFS = {
  roof_red: ['#EE7F87', 'Red Roof'],
  roof_blue: ['#7EA7EE', 'Blue Roof'],
  roof_pink: ['#F79BC1', 'Pink Roof'],
  roof_lavender: ['#B49BF0', 'Lavender Roof'],
  roof_mint: ['#7ED4B4', 'Mint Roof'],
};

/** Fish-scale roof shingles in rows of 4 px. */
export function shingles(p, rand, base) {
  p.each((x, y) => {
    const row = y >> 2, ly = y & 3;
    const sx = (x + (row % 2) * 2) & 3;
    let t;
    if (ly === 3) t = sx === 0 || sx === 3 ? -0.3 : -0.12;
    else if (ly === 0) t = sx === 0 ? -0.04 : 0.14;
    else if (ly === 1) t = sx === 0 ? -0.08 : 0.05;
    else t = sx === 0 || sx === 3 ? -0.14 : -0.02;
    p.set(x, y, tone(base, t + (rand() - 0.5) * 0.04));
  });
}

function wallpaperBase(p, bg, stripe) {
  p.each((x, y) => p.set(x, y, x % 4 === 0 && stripe ? stripe : bg));
}

export function install(L) {
  const { tile, block } = L;

  // --- planks & slabs ---
  for (const [k, [base, seam]] of Object.entries(PLANKS)) tile('planks_' + k, (p, r) => planks(p, r, base, seam));
  for (const [k, [, , name]] of Object.entries(PLANKS)) block({ key: 'planks_' + k, name, category: 'building' });

  // --- bricks & stone ---
  for (const [key, [base, mortar]] of Object.entries(BRICKS)) tile(key, (p, r) => bricks(p, r, base, mortar));
  tile('stone_bricks', (p, r) => bricks(p, r, '#C1BCD1', '#9A94AD', { h: 8, w: 16, vary: 0.05, hi: 0.12, lo: -0.14 }));
  tile('quartz', (p, r) => {
    natural(p, r, ['#EEE8EC', '#F3EEF1', '#F8F4F6', '#FCFAFB'], { dither: 0.18 });
    p.bevel(0.3, -0.12);
    for (let t = 2; t < 14; t++) { p.shade(t, 2, -0.05); p.shade(2, t, -0.05); p.shade(t, 13, 0.25); p.shade(13, t, 0.25); }
  });
  tile('quartz_pillar_side', (p, r) => {
    natural(p, r, ['#EEE8EC', '#F3EEF1', '#F8F4F6', '#FCFAFB'], { dither: 0.18 });
    for (let y = 0; y < 16; y++) {
      p.shade(0, y, 0.3); p.shade(1, y, 0.15); p.shade(14, y, -0.08); p.shade(15, y, -0.14);
      for (const gx of [5, 10]) { p.shade(gx, y, -0.1); p.shade(gx + 1, y, 0.2); }
    }
  });
  tile('quartz_pillar_top', (p, r) => {
    natural(p, r, ['#EEE8EC', '#F3EEF1', '#F8F4F6', '#FCFAFB'], { dither: 0.18 });
    p.bevel(0.25, -0.12);
    p.each((x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (Math.abs(d - 5) < 0.55) p.shade(x, y, -0.1);
      if (Math.abs(d - 2.5) < 0.5) p.shade(x, y, -0.06);
    });
  });
  tile('marble', (p, r) => {
    natural(p, r, ['#F1EEF5', '#F6F3F9', '#FAF8FC', '#FFFFFF'], { dither: 0.15 });
    const n = fbm(r, [[2, 0.6], [4, 0.4]]);
    p.each((x, y) => {
      const v = Math.sin((x * 0.39 + y * 0.39) + n[y * 16 + x] * 3.2);
      if (Math.abs(v) < 0.14) p.set(x, y, '#C7BBDD');
      else if (Math.abs(v) < 0.3) p.blend(x, y, '#E0D7EE', 0.8);
    });
    for (let i = 0; i < 2; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), '#EBD9A6');
  });
  for (const [key, [base]] of Object.entries(CLAY_TILES)) {
    tile(key, (p, r) => {
      natural(p, r, ramp(base, [-0.07, -0.02, 0.03, 0.07]), { dither: 0.35 });
      for (let i = 0; i < 6; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), tone(base, r() < 0.5 ? 0.18 : -0.12));
    });
  }

  for (const [key, [, , name]] of Object.entries(BRICKS)) block({ key, name, category: 'building' });
  block({ key: 'stone_bricks', name: 'Stone Bricks', category: 'building' });
  block({ key: 'cobble', name: 'Cobblestone', category: 'building' });
  block({ key: 'quartz', name: 'Quartz', category: 'building', sound: 'chime' });
  block({ key: 'quartz_pillar', name: 'Quartz Pillar', category: 'building', sound: 'chime', tiles: { top: 'quartz_pillar_top', side: 'quartz_pillar_side', bottom: 'quartz_pillar_top' } });
  block({ key: 'marble', name: 'Marble', category: 'building', sound: 'chime' });
  for (const [key, [, name]] of Object.entries(CLAY_TILES)) block({ key, name, category: 'building' });

  // slabs (half blocks)
  block({ key: 'slab_oak', name: 'Oak Slab', category: 'building', shape: 'slab', tiles: { all: 'planks_oak' } });
  block({ key: 'slab_pink', name: 'Pink Slab', category: 'building', shape: 'slab', tiles: { all: 'planks_pink' } });
  block({ key: 'slab_white', name: 'White Slab', category: 'building', shape: 'slab', tiles: { all: 'planks_white' } });
  block({ key: 'slab_stone', name: 'Stone Slab', category: 'building', shape: 'slab', tiles: { all: 'stone_bricks' } });
  block({ key: 'slab_quartz', name: 'Quartz Slab', category: 'building', shape: 'slab', tiles: { all: 'quartz' } });

  // --- roofs ---
  for (const [key, [base]] of Object.entries(ROOFS)) tile(key, (p, r) => shingles(p, r, base));
  tile('roof_straw', (p, r) => {
    const cols = ['#D9AE52', '#E5BE62', '#EFCB72', '#F6D988', '#FBE6A6'];
    const colv = [];
    for (let x = 0; x < 16; x++) colv.push(Math.floor(r() * 5));
    p.each((x, y) => {
      let k = colv[x];
      if (r() < 0.2) k = Math.max(0, Math.min(4, k + (r() < 0.5 ? -1 : 1)));
      if ((y & 7) === 6) k = 0;
      else if ((y & 7) === 7) k = Math.max(1, k - 1);
      p.set(x, y, cols[k]);
    });
  });
  for (const [key, [, name]] of Object.entries(ROOFS)) block({ key, name, category: 'building' });
  block({ key: 'roof_straw', name: 'Straw Roof', category: 'building' });

  // --- bookshelf ---
  tile('bookshelf', (p, r) => {
    const wood = '#C99466', dark = '#A07148', light = '#DDAE80';
    p.fill(wood);
    const books = ['#FF9EC4', '#B79CFF', '#8FD8C0', '#9FCFFF', '#FFD97A', '#FFB08A', '#F7F0E8', '#F58BA8'];
    for (const [y0, y1] of [[1, 7], [9, 15]]) {
      for (let x = 0; x < 16; x++) p.set(x, y0 - 1, light);
      let x = 1;
      while (x < 15) {
        const w = r() < 0.35 ? 2 : 1;
        const c = books[Math.floor(r() * books.length)];
        const top = y0 + (r() < 0.45 ? 1 : 0);
        for (let xx = x; xx < Math.min(15, x + w); xx++) {
          for (let y = top; y < y1 - 1; y++) p.set(xx, y, c);
          p.set(xx, top, tone(c, 0.25));
          p.set(xx, top + 2, tone(c, -0.18));
        }
        for (let y = y0; y < top; y++) p.set(x, y, tone(wood, -0.25));
        x += w;
        if (r() < 0.12 && x < 14) { for (let y = y0; y < y1 - 1; y++) p.set(x, y, tone(wood, -0.25)); x++; }
      }
      for (let xx = 0; xx < 16; xx++) p.set(xx, y1 - 1, dark);
    }
    for (let y = 0; y < 16; y++) { p.set(0, y, dark); p.set(15, y, dark); }
  });
  block({ key: 'bookshelf', name: 'Bookshelf', category: 'building', tiles: { top: 'planks_oak', side: 'bookshelf', bottom: 'planks_oak' } });

  // --- floor tiles ---
  tile('tile_kitchen', (p) => {
    checker(p, '#FFFBF4', '#BFEBD8', 4);
    p.each((x, y) => {
      if ((x & 3) === 0 && (y & 3) === 0) p.shade(x, y, 0.4);
      if ((x & 3) === 3 || (y & 3) === 3) p.shade(x, y, -0.05);
    });
  });
  tile('tile_bath', (p) => {
    p.each((x, y) => {
      const grout = (x & 3) === 3 || (y & 3) === 3;
      const tint = ((x >> 2) * 3 + (y >> 2) * 5) % 7 === 0 ? '#A6D6F5' : '#B8E2FA';
      p.set(x, y, grout ? '#F2F9FF' : tint);
      if (!grout && (x & 3) === 0 && (y & 3) === 0) p.set(x, y, '#E4F4FF');
    });
  });
  tile('tile_pink', (p) => {
    p.each((x, y) => {
      const lx = x & 7, ly = y & 7;
      let c = '#FFC2D8';
      if (lx === 7 || ly === 7) c = '#FFF1F6';
      else if (lx + ly < 3) c = '#FFE3EE';
      else if (lx === 6 || ly === 6) c = '#F7AECA';
      p.set(x, y, c);
    });
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) { p.set(2 + k * 8, 4 + j * 8, '#FFFFFF'); p.set(3 + k * 8, 3 + j * 8, '#FFFFFF'); }
  });
  block({ key: 'tile_kitchen', name: 'Kitchen Tiles', category: 'building' });
  block({ key: 'tile_bath', name: 'Bathroom Tiles', category: 'building' });
  block({ key: 'tile_pink', name: 'Pink Tiles', category: 'building' });

  // --- wallpapers ---
  tile('wallpaper_hearts', (p) => {
    wallpaperBase(p, '#FFE3EE', '#FFD8E7');
    motif(p, G.heart5, '#FF8DB7', { sx: 8, sy: 8, ox: 1, oy: 1 });
    motif(p, ['X'], '#FFFFFF', { sx: 8, sy: 8, ox: 2, oy: 2 });
  });
  tile('wallpaper_stars', (p) => {
    wallpaperBase(p, '#E3DAFF', null);
    motif(p, G.star5, '#FFE17A', { sx: 8, sy: 8, ox: 1, oy: 1 });
    motif(p, ['X'], '#FFFFFF', { sx: 8, sy: 8, ox: 6, oy: 6 });
    motif(p, ['X'], '#F6F2FF', { sx: 8, sy: 8, ox: 1, oy: 6 });
  });
  tile('wallpaper_stripes', (p) => {
    p.each((x, y) => {
      const s = x & 7;
      p.set(x, y, s < 4 ? (s === 0 || s === 3 ? '#FFBCD5' : '#FFC9DD') : s === 5 ? '#FFE0EC' : '#FFF8FB');
    });
  });
  tile('wallpaper_flowers', (p) => {
    wallpaperBase(p, '#DDF5E9', null);
    motif(p, ['.X.', 'X.X', '.X.'], '#FFFFFF', { sx: 8, sy: 8, ox: 1, oy: 1 });
    motif(p, ['X'], '#FFD35C', { sx: 8, sy: 8, ox: 2, oy: 2 });
    motif(p, ['X.', '.X'], '#9FDDB9', { sx: 8, sy: 8, ox: 3, oy: 4 });
    motif(p, ['.X.', 'X.X', '.X.'], '#FFB3CF', { sx: 8, sy: 8, ox: 5, oy: 4, stagger: false });
    motif(p, ['X'], '#FFFFFF', { sx: 8, sy: 8, ox: 6, oy: 5, stagger: false });
  });
  tile('wallpaper_polka', (p) => {
    wallpaperBase(p, '#CDE9FF', null);
    motif(p, G.dot4, '#FFFFFF', { sx: 8, sy: 8, ox: 2, oy: 2 });
    motif(p, ['X'], '#EAF6FF', { sx: 8, sy: 8, ox: 3, oy: 5 });
  });
  tile('wallpaper_rainbow', (p) => {
    const bands = ['#FFB3B8', '#FFD2A8', '#FFF0A6', '#C9F0A9', '#A9E8EE', '#B5C9FF', '#D5B8FF', '#FFC3E6'];
    p.each((x, y) => p.set(x, y, (y & 1) === 0 ? tone(bands[y >> 1], 0.08) : bands[y >> 1]));
    for (let k = 0; k < 3; k++) sparkle(p, 3 + k * 5, 2 + k * 5, '#FFFFFF', 1);
  });
  block({ key: 'wallpaper_hearts', name: 'Heart Wallpaper', category: 'building' });
  block({ key: 'wallpaper_stars', name: 'Star Wallpaper', category: 'building' });
  block({ key: 'wallpaper_stripes', name: 'Stripy Wallpaper', category: 'building' });
  block({ key: 'wallpaper_flowers', name: 'Flower Wallpaper', category: 'building' });
  block({ key: 'wallpaper_polka', name: 'Polka Dot Wallpaper', category: 'building' });
  block({ key: 'wallpaper_rainbow', name: 'Rainbow Wallpaper', category: 'building' });
}

