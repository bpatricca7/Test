// Candy blocks: frosting, cookie, chocolate, waffle cone, candy cane, peppermint, gumdrops,
// cotton candy, lollipop, sprinkle cake, marshmallow, candy sticks and two sweet liquids.

import { tone, ramp, mix, natural, fbm, drip, sprinkles } from './kit.js';

export const SPRINKLES = ['#FF6FA8', '#7FC8FF', '#FFE066', '#8EE3A2', '#C49BFF', '#FFFFFF', '#FF9F6B'];

export const GUMDROPS = [
  ['pink', '#FF8FC0', 'Pink'],
  ['orange', '#FFB072', 'Orange'],
  ['yellow', '#FFDF6E', 'Yellow'],
  ['green', '#8DE08C', 'Green'],
  ['blue', '#80B9FF', 'Blue'],
  ['purple', '#B996FF', 'Purple'],
];

/** Smooth frosting with piped ripples. */
export function frosting(p, rand, base, { sprinkle = 0 } = {}) {
  const c = ramp(base, [-0.08, -0.03, 0.02, 0.07, 0.12]);
  const n = fbm(rand, [[2, 0.6], [4, 0.4]]);
  p.each((x, y) => {
    const ripple = Math.sin((x * 0.55 + y * 0.9) + n[y * 16 + x] * 5) * 0.5 + 0.5;
    const v = Math.max(0, Math.min(0.999, ripple * 0.55 + n[y * 16 + x] * 0.45 + (rand() - 0.5) * 0.12));
    p.set(x, y, c[Math.floor(v * c.length)]);
  });
  if (sprinkle) sprinkles(p, rand, SPRINKLES, sprinkle);
}

export function cookie(p, rand) {
  natural(p, rand, ['#D69F62', '#E0AD70', '#EABB80', '#F2C991'], { dither: 0.35 });
  for (let i = 0; i < 9; i++) p.set(Math.floor(rand() * 16), Math.floor(rand() * 16), '#F9DDB0');
  const chips = [[2, 3], [10, 1], [7, 8], [13, 10], [3, 12]];
  for (const [x, y] of chips) {
    const ox = x + Math.floor(rand() * 2), oy = y + Math.floor(rand() * 2);
    p.set(ox, oy, '#7A4A37'); p.set(ox + 1, oy, '#6A3E2E'); p.set(ox, oy + 1, '#6A3E2E'); p.set(ox + 1, oy + 1, '#57311F');
    p.set(ox, oy, '#93624C');
  }
}

function liquid(p, rand, cols, alpha) {
  p.each((x, y) => {
    const w = Math.sin((x + y * 0.6) * 0.75) + Math.sin((x * 0.5 - y) * 0.7) * 0.8;
    const idx = w > 1.2 ? 4 : w > 0.5 ? 3 : w > -0.2 ? 2 : w > -0.9 ? 1 : 0;
    p.set(x, y, cols[idx], alpha);
  });
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    p.set(x, y, tone(cols[4], 0.3), alpha); p.set(x + 1, y, tone(cols[4], 0.15), alpha);
  }
}

export function install(L) {
  const { tile, block } = L;
  const candy = { category: 'candy', sound: 'pop' };

  // candy ground
  // candy ground in three flavors: strawberry, mint and vanilla frosting over cookie
  for (const [suffix, color, rim] of [['', '#FFB3D2', '#F28DB7'], ['_mint', '#B5EDD3', '#86D2B1'], ['_vanilla', '#FFF4E6', '#EBD3BE']]) {
    tile('grass_frosting' + suffix + '_top', (p, r) => frosting(p, r, color, { sprinkle: 4 }));
    tile('grass_frosting' + suffix + '_side', (p, r) => {
      cookie(p, r);
      drip(p, r, ramp(color, [-0.08, -0.02, 0.04, 0.1]), { min: 2, max: 7, rim });
    });
  }
  tile('cookie', cookie);
  tile('frosting_pink', (p, r) => frosting(p, r, '#FFB3D2'));
  tile('frosting_white', (p, r) => frosting(p, r, '#FFF6F0'));
  tile('frosting_mint', (p, r) => frosting(p, r, '#BDF0D8'));
  tile('frosting_chocolate', (p, r) => frosting(p, r, '#A8715A'));

  tile('chocolate', (p, r) => {
    const base = '#8C5B45';
    p.each((x, y) => {
      const lx = x & 7, ly = y & 7;
      let t = 0;
      if (lx === 7 || ly === 7) t = -0.32;
      else if (lx === 0 || ly === 0) t = 0.2;
      else if (lx === 6 || ly === 6) t = -0.16;
      else if (lx === 1 || ly === 1) t = 0.08;
      p.set(x, y, tone(base, t + (r() - 0.5) * 0.03));
    });
    for (let k = 0; k < 4; k++) p.set(2 + (k & 1) * 8, 2 + (k >> 1) * 8, '#C69378');
  });
  tile('waffle_cone', (p, r) => {
    const base = '#EDBA70';
    p.each((x, y) => {
      const a = (x + y) % 6, b = (x - y + 18) % 6;
      let t = (r() - 0.5) * 0.05;
      if (a === 0 || b === 0) t -= 0.22;
      else if (a === 1 || b === 1) t += 0.12;
      p.set(x, y, tone(base, t));
    });
  });
  tile('candy_cane', (p) => {
    p.each((x, y) => {
      const s = (x + y) & 7;
      const c = s < 3 ? (s === 0 ? '#FF7A8E' : '#F24F69') : s === 3 ? '#FFE9EC' : '#FFFBFB';
      p.set(x, y, c);
    });
    for (let y = 0; y < 16; y++) { p.shade(3, y, 0.2); p.shade(12, y, -0.1); p.shade(13, y, -0.14); }
  });
  tile('peppermint', (p) => {
    p.each((x, y) => {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8, d = Math.hypot(dx, dy);
      let c;
      if (d > 7.6) c = '#FFE4EA';
      else if (d > 6.7) c = '#F7B8C4';
      else {
        const a = Math.atan2(dy, dx) + d * 0.28;
        const s = Math.floor(((a / (Math.PI * 2)) + 1) * 8) % 2;
        c = d < 1.4 ? '#FFFFFF' : s ? '#F2536C' : '#FFFBFB';
      }
      p.set(x, y, c);
    });
    for (let k = 0; k < 3; k++) p.blend(4 + k, 3, '#FFFFFF', 0.7);
    p.blend(3, 4, '#FFFFFF', 0.7);
  });
  for (const [name, color] of GUMDROPS) {
    tile('gumdrop_' + name, (p, r) => {
      const c = ramp(color, [-0.14, -0.06, 0.02, 0.1]);
      p.each((x, y) => {
        const v = Math.max(0, Math.min(0.999, 1 - (y / 16) * 0.8 + (r() - 0.5) * 0.25 - 0.1));
        p.set(x, y, c[Math.floor(v * 4)]);
      });
      p.pillow(0.12);
      for (let i = 0; i < 16; i++) p.blend(Math.floor(r() * 16), Math.floor(r() * 16), '#FFFFFF', 0.55 + r() * 0.3);
      p.blend(3, 3, '#FFFFFF', 0.7); p.blend(4, 3, '#FFFFFF', 0.5); p.blend(3, 4, '#FFFFFF', 0.5);
    });
  }
  tile('cotton_candy', (p, r) => {
    const n = fbm(r, [[2, 0.5], [4, 0.35], [8, 0.15]]);
    const cols = ['#A9D2FF', '#D9E6FF', '#FFD9EC', '#FFB8DA', '#FFA3CE', '#FFC9E3'];
    p.each((x, y) => {
      const v = Math.max(0, Math.min(0.999, n[y * 16 + x] + (r() - 0.5) * 0.18));
      p.set(x, y, cols[Math.floor(v * cols.length)]);
    });
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      p.blend(x, y, '#FFFFFF', 0.6); p.blend(x + 1, y, '#FFFFFF', 0.35);
    }
  });
  tile('lollipop_block', (p) => {
    const cols = ['#FF7FAE', '#FFB36B', '#FFE36B', '#86E08E', '#7FC0FF', '#B68CFF'];
    p.each((x, y) => {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8, d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
      const band = Math.floor(a * 6 + d * 0.55) % 6;
      p.set(x, y, cols[band]);
    });
    p.each((x, y) => { const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8); if (d > 7.3) p.shade(x, y, -0.08); });
    for (let k = 0; k < 4; k++) p.blend(3 + k, 3 + (k > 1 ? 1 : 0) - (k === 0 ? -1 : 0), '#FFFFFF', 0.6);
  });
  tile('cake_side', (p, r) => {
    const sponge = ['#F6D9A0', '#FAE2B0', '#FDEBC2'];
    p.each((x, y) => p.set(x, y, sponge[Math.floor(r() * 3)]));
    for (let i = 0; i < 6; i++) p.set(Math.floor(r() * 16), 9 + Math.floor(r() * 6), '#E9C788');
    for (let x = 0; x < 16; x++) { p.set(x, 9, '#F46F92'); p.set(x, 10, '#FF9DB6'); p.set(x, 8, '#FFF3EA'); }
    drip(p, r, ramp('#FFFFFF', [-0.06, -0.03, 0, 0]).map((c) => mix(c, '#FFD9E8', 0.25)), { min: 2, max: 5, rim: '#F4C5D6' });
    for (let x = 0; x < 16; x += 4) p.set(x + 1, 0, SPRINKLES[(x >> 2) % SPRINKLES.length]);
  });
  tile('cake_top', (p, r) => frosting(p, r, '#FFF1F6', { sprinkle: 14 }));
  tile('cake_bottom', (p, r) => natural(p, r, ['#F2D293', '#F6D9A0', '#FAE2B0'], { dither: 0.4 }));
  tile('marshmallow', (p, r) => {
    natural(p, r, ['#FCEDF3', '#FEF3F7', '#FFF8FA', '#FFFFFF'], { dither: 0.3 });
    p.pillow(0.2);
    for (let i = 0; i < 6; i++) p.blend(Math.floor(r() * 16), Math.floor(r() * 16), '#FFFFFF', 0.8);
  });
  tile('candy_stick', (p) => {
    p.each((x, y) => {
      const s = (x * 2 + y) & 15;
      p.set(x, y, s < 3 ? '#FFB3CD' : s === 3 ? '#FFD6E4' : '#FFFBFC');
    });
    for (let y = 0; y < 16; y++) { p.shade(2, y, 0.25); p.shade(14, y, -0.08); p.shade(15, y, -0.12); }
  });
  tile('choco_milk', (p, r) => liquid(p, r, ['#7E4C38', '#8C5842', '#9A654D', '#AB785F', '#C69478'], 232), { animated: true });
  tile('strawberry_milk', (p, r) => liquid(p, r, ['#EC75A6', '#F084B0', '#F494BC', '#F7A8C9', '#FBC2DA'], 222), { animated: true });

  block({ key: 'lollipop_block', name: 'Lollipop Swirl', ...candy });
  block({ key: 'grass_frosting', name: 'Frosting Grass', ...candy, tiles: { top: 'grass_frosting_top', side: 'grass_frosting_side', bottom: 'cookie' } });
  block({ key: 'grass_frosting_mint', name: 'Mint Frosting Grass', ...candy, tiles: { top: 'grass_frosting_mint_top', side: 'grass_frosting_mint_side', bottom: 'cookie' } });
  block({ key: 'grass_frosting_vanilla', name: 'Vanilla Frosting Grass', ...candy, tiles: { top: 'grass_frosting_vanilla_top', side: 'grass_frosting_vanilla_side', bottom: 'cookie' } });
  block({ key: 'cookie', name: 'Cookie', ...candy });
  block({ key: 'frosting_pink', name: 'Pink Frosting', ...candy });
  block({ key: 'frosting_white', name: 'Vanilla Frosting', ...candy });
  block({ key: 'frosting_mint', name: 'Mint Frosting', ...candy });
  block({ key: 'frosting_chocolate', name: 'Chocolate Frosting', ...candy });
  block({ key: 'chocolate', name: 'Chocolate Bar', ...candy });
  block({ key: 'waffle_cone', name: 'Waffle Cone', ...candy });
  block({ key: 'candy_cane', name: 'Candy Cane', ...candy });
  block({ key: 'peppermint', name: 'Peppermint', ...candy });
  for (const [name, color, label] of GUMDROPS) block({ key: 'gumdrop_' + name, name: label + ' Gumdrop', ...candy, color });
  block({ key: 'cotton_candy', name: 'Cotton Candy', ...candy });
  block({ key: 'cake_sprinkles', name: 'Sprinkle Cake', ...candy, tiles: { top: 'cake_top', side: 'cake_side', bottom: 'cake_bottom' } });
  block({ key: 'marshmallow', name: 'Marshmallow', ...candy });
  block({ key: 'candy_stick', name: 'Candy Stick', ...candy });
  block({ key: 'choco_milk', name: 'Chocolate Milk', category: 'candy', shape: 'liquid', translucent: true, solid: false, lightOpacity: 1, sound: 'splash' });
  block({ key: 'strawberry_milk', name: 'Strawberry Milk', category: 'candy', shape: 'liquid', translucent: true, solid: false, lightOpacity: 1, sound: 'splash' });
}

