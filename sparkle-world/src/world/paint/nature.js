// Nature blocks: ground, stone, snow & ice, water, logs & leaves, giant-mushroom parts,
// coral and shells.

import { tone, ramp, natural, fbm, pebbles, leaves, bark, rings, drip, sparkle, inCircle } from './kit.js';

// ---------- shared ground painters (also used by candy/garden files) ----------

export const GRASS = ['#76C96F', '#81D278', '#8CDA7F', '#98E288', '#A8EB93'];
export const DIRT = ['#A7775A', '#B58466', '#C39373', '#CFA27F'];
export const MOSS = ['#57AE93', '#63BEA0', '#72CBAB', '#84D7B8', '#9AE3C8'];

export function paintDirt(p, rand) {
  natural(p, rand, DIRT, { dither: 0.3 });
  pebbles(p, rand, 5, '#DDB994', '#906449');
  for (let i = 0; i < 3; i++) p.set(Math.floor(rand() * 16), Math.floor(rand() * 16), '#8E6247');
}

export function paintGrassTop(p, rand, colors = GRASS, { blades = 10, dots = null } = {}) {
  natural(p, rand, colors, { oct: [[2, 0.35], [4, 0.4], [8, 0.25]], dither: 0.35 });
  const k = colors.length;
  for (let i = 0; i < blades; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    p.set(x, y, tone(colors[k - 1], 0.12));
    p.set(x, y + 1, colors[1]);
  }
  if (dots) for (let i = 0; i < dots.count; i++) p.set(Math.floor(rand() * 16), Math.floor(rand() * 16), dots.colors[i % dots.colors.length]);
}

/** Side of a grassy block: dirt with a soft overhang of the top material. */
export function paintSideDrip(p, rand, top, { under = paintDirt, min = 2, max = 5, rim = null } = {}) {
  under(p, rand);
  drip(p, rand, top, { min, max, rim: rim || tone(top[0], -0.15) });
}

function paintSand(p, rand, colors, speck) {
  natural(p, rand, colors, { dither: 0.28 });
  // soft wind ripples
  for (const y0 of [2, 7, 12]) {
    for (let x = 0; x < 16; x++) {
      const y = y0 + Math.round(Math.sin((x + y0 * 3) * 0.7) * 0.8);
      if (rand() < 0.75) p.set(x, y, tone(colors[colors.length - 1], 0.1));
      if (rand() < 0.5) p.set(x, y + 1, colors[0]);
    }
  }
  for (let i = 0; i < 3; i++) p.set(Math.floor(rand() * 16), Math.floor(rand() * 16), speck[i % speck.length]);
}

export function paintStone(p, rand, colors = ['#A9A3BB', '#B5AFC6', '#C1BCD1', '#CCC8DB']) {
  natural(p, rand, colors, { dither: 0.25 });
  for (let i = 0; i < 3; i++) {
    let x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    const len = 3 + Math.floor(rand() * 3);
    for (let s = 0; s < len; s++) {
      p.set(x, y, tone(colors[0], -0.08));
      p.set(x + 1, y, tone(colors[colors.length - 1], 0.08));
      x += rand() < 0.5 ? 1 : 0;
      y += 1;
    }
  }
}

/** Rounded cobbles: cells of a tileable Voronoi, each lit from the top-left. */
export function paintCobble(p, rand, tones, grout, { count = 7, moss = null } = {}) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([rand() * 16, rand() * 16, tones[i % tones.length]]);
  const n = moss ? fbm(rand, [[4, 0.55], [8, 0.45]]) : null;
  p.each((x, y) => {
    let d1 = Infinity, d2 = Infinity, best = 0, bdx = 0, bdy = 0;
    for (let i = 0; i < count; i++) {
      let dx = x + 0.5 - pts[i][0], dy = y + 0.5 - pts[i][1];
      if (dx > 8) dx -= 16; else if (dx < -8) dx += 16;
      if (dy > 8) dy -= 16; else if (dy < -8) dy += 16;
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; best = i; bdx = dx; bdy = dy; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;
    let c;
    if (edge < 1.0) c = grout;
    else {
      c = pts[best][2];
      // light from the top-left inside each stone
      const lit = (-bdx - bdy) / (d1 + 0.001);
      if (edge < 1.8) c = tone(c, lit > 0 ? 0.1 : -0.12);
      else if (d1 < 1.6 && lit > 0) c = tone(c, 0.08);
    }
    if (moss && n[y * 16 + x] > 0.6) {
      const m = moss[Math.floor(((n[y * 16 + x] - 0.6) / 0.4) * moss.length * 0.999)];
      c = edge < 1.0 ? tone(m, -0.1) : m;
    }
    p.set(x, y, c);
  });
}

function paintWater(p, rand) {
  const cols = ['#4FBCE0', '#5CC7E8', '#6FD2EE', '#8ADDF3', '#B2EBF9'];
  p.each((x, y) => {
    const w = Math.sin((x + y * 0.5) * 0.8) + Math.sin((x * 0.45 - y) * 0.75) * 0.8;
    const idx = w > 1.25 ? 4 : w > 0.55 ? 3 : w > -0.2 ? 2 : w > -0.9 ? 1 : 0;
    p.set(x, y, cols[idx], 190);
  });
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    p.set(x, y, '#E6F9FF', 215); p.set(x + 1, y, '#D2F3FF', 205);
  }
}

// ---------- block definitions ----------

export function install(L) {
  const { tile, block } = L;

  // --- ground ---
  tile('grass_top', (p, r) => paintGrassTop(p, r));
  tile('grass_side', (p, r) => paintSideDrip(p, r, GRASS.slice(0, 4)));
  tile('dirt', paintDirt);
  tile('path_top', (p, r) => {
    natural(p, r, ['#C9A07A', '#D2AB85', '#DBB690', '#E3C29D'], { dither: 0.3 });
    pebbles(p, r, 6, '#EBD3B4', '#B48B67');
  });
  tile('path_side', (p, r) => {
    paintDirt(p, r);
    for (let x = 0; x < 16; x++) { p.set(x, 0, '#DBB690'); p.set(x, 1, r() < 0.7 ? '#D2AB85' : '#C39373'); }
  });
  tile('stone', (p, r) => paintStone(p, r));
  tile('cobble', (p, r) => paintCobble(p, r, ['#C9C4D6', '#BBB6CB', '#D5D1E1', '#B3AEC4', '#C4BFD2', '#CFCBDC', '#B7B2C8'], '#8F8AA3'));
  tile('mossy_stone', (p, r) => paintCobble(p, r, ['#C9C4D6', '#BBB6CB', '#D5D1E1', '#B3AEC4', '#C4BFD2'], '#8F8AA3', { moss: ['#6DBE8A', '#7FCB94', '#94D8A2'] }));
  tile('sand', (p, r) => paintSand(p, r, ['#EDCF95', '#F2D9A3', '#F6E2B0', '#FAEBC4'], ['#FFFFFF', '#F7B9C8', '#E3C08A']));
  tile('sand_pink', (p, r) => paintSand(p, r, ['#F0B2C2', '#F5C0CD', '#F8CDD8', '#FBDCE4'], ['#FFFFFF', '#FFF3F6', '#E79BB0']));
  tile('gravel', (p, r) => {
    paintCobble(p, r, ['#B9B1C6', '#CDC6D8', '#D9C9BE', '#A9A2B6', '#C6BCCE', '#E0DAE6', '#BFB3AA', '#D0CAD9', '#AFA7BA', '#C9C2D3', '#DCD2C8', '#B5AEC0'], '#8E879C', { count: 12 });
  });
  tile('clay', (p, r) => {
    const cols = ['#A9B4CB', '#B3BDD3', '#BDC7DB', '#C8D0E2'];
    const n = fbm(r, [[2, 0.6], [4, 0.4]]);
    p.each((x, y) => {
      const band = Math.sin((y + n[y * 16 + x] * 5) * 0.9) * 0.5 + 0.5;
      const v = Math.max(0, Math.min(0.999, band * 0.6 + n[y * 16 + x] * 0.4 + (r() - 0.5) * 0.15));
      p.set(x, y, cols[Math.floor(v * 4)]);
    });
  });
  tile('snow', (p, r) => {
    natural(p, r, ['#E4EDF9', '#EEF4FC', '#F6F9FE', '#FFFFFF'], { dither: 0.3 });
    for (let i = 0; i < 4; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), '#D2E1F4');
    for (let i = 0; i < 3; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), '#FFFFFF');
    p.set(Math.floor(r() * 16), Math.floor(r() * 16), '#CFE8FF');
  });
  tile('grass_snowy_side', (p, r) => paintSideDrip(p, r, ['#E4EDF9', '#EEF4FC', '#F6F9FE', '#FFFFFF'], { min: 3, max: 6, rim: '#C9D8EE' }));
  tile('ice', (p, r) => {
    const cols = ['#A6DAF5', '#B4E2F8', '#C2E9FA', '#D3F0FC'];
    const n = fbm(r, [[2, 0.5], [4, 0.5]]);
    p.each((x, y) => {
      const v = Math.min(0.999, n[y * 16 + x] * 0.8 + r() * 0.2);
      p.set(x, y, cols[Math.floor(v * 4)], 205);
    });
    for (let k = 0; k < 16; k++) {
      if ((k & 3) !== 3) p.set(k, (k + 5) & 15, '#F4FCFF', 230);
      if (k > 3 && k < 11) p.set(k + 3, (20 - k) & 15, '#EAF9FF', 225);
    }
    for (let i = 0; i < 3; i++) { const x = Math.floor(r() * 15), y = Math.floor(r() * 15); p.set(x, y, '#FFFFFF', 235); }
  });
  tile('ice_packed', (p, r) => {
    natural(p, r, ['#8CC3EC', '#9BCDF0', '#AAD6F3', '#BCE0F6'], { dither: 0.2 });
    for (let i = 0; i < 4; i++) {
      let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      const dx = r() < 0.5 ? 1 : -1;
      for (let s = 0; s < 5; s++) { p.set(x, y, '#E9F7FF'); x += r() < 0.6 ? dx : 0; y += 1; }
    }
  });
  tile('grass_moss_top', (p, r) => paintGrassTop(p, r, MOSS, { blades: 10, dots: { count: 6, colors: ['#C8B4FF', '#E9FFF6', '#FFD9F0'] } }));
  tile('grass_moss_side', (p, r) => paintSideDrip(p, r, MOSS.slice(0, 4), { min: 2, max: 6 }));
  tile('moss', (p, r) => paintGrassTop(p, r, MOSS, { blades: 12, dots: { count: 3, colors: ['#C8B4FF', '#E9FFF6'] } }));
  tile('water', paintWater, { animated: true });

  block({ key: 'grass', name: 'Grass', category: 'nature', tiles: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' } });
  block({ key: 'dirt', name: 'Dirt', category: 'nature' });
  block({ key: 'path', name: 'Garden Path', category: 'nature', tiles: { top: 'path_top', side: 'path_side', bottom: 'dirt' } });
  block({ key: 'stone', name: 'Stone', category: 'nature' });
  block({ key: 'mossy_stone', name: 'Mossy Stone', category: 'nature' });
  block({ key: 'sand', name: 'Sand', category: 'nature' });
  block({ key: 'sand_pink', name: 'Pink Sand', category: 'nature' });
  block({ key: 'gravel', name: 'Pebbles', category: 'nature' });
  block({ key: 'clay', name: 'Clay', category: 'nature' });
  block({ key: 'grass_snowy', name: 'Snowy Grass', category: 'nature', tiles: { top: 'snow', side: 'grass_snowy_side', bottom: 'dirt' } });
  block({ key: 'snow', name: 'Snow', category: 'nature' });
  block({ key: 'ice', name: 'Ice', category: 'nature', translucent: true, lightOpacity: 1, sound: 'chime' });
  block({ key: 'ice_packed', name: 'Blue Ice', category: 'nature', sound: 'chime' });
  block({ key: 'grass_moss', name: 'Fairy Moss Grass', category: 'nature', tiles: { top: 'grass_moss_top', side: 'grass_moss_side', bottom: 'dirt' } });
  block({ key: 'moss', name: 'Moss', category: 'nature' });
  block({ key: 'water', name: 'Water', category: 'nature', shape: 'liquid', translucent: true, solid: false, lightOpacity: 1, sound: 'splash' });

  // --- logs & leaves ---
  const logTop = (rim, wood, ring) => (p, r) => rings(p, r, rim, wood, ring);
  tile('log_oak_side', (p, r) => bark(p, r, ['#86593A', '#9A6A46', '#AD7B52', '#BC8A5E']));
  tile('log_oak_top', logTop('#8E613F', '#E6C18E', '#D1A673'));
  tile('log_birch_side', (p, r) => {
    natural(p, r, ['#E9E3DB', '#F2EDE6', '#F9F6F1', '#FFFDFB'], { dither: 0.3, oct: [[2, 0.5], [8, 0.5]] });
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16), len = 2 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) p.set(x + k, y, k === 0 || k === len - 1 ? '#A79DB5' : '#7D7290');
    }
  });
  tile('log_birch_top', logTop('#E8E1D8', '#F4E2BC', '#E2CC9E'));
  tile('log_cherry_side', (p, r) => {
    bark(p, r, ['#7E4E4D', '#8E5C59', '#9E6A65', '#AD7872'], { furrows: 1, knots: 0 });
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16), len = 3 + Math.floor(r() * 3);
      for (let k = 0; k < len; k++) p.set(x + k, y, '#C99590');
    }
  });
  tile('log_cherry_top', logTop('#8E5C59', '#F2C2B0', '#E0A897'));
  tile('palm_log_side', (p, r) => {
    const cols = ['#A98459', '#B99366', '#C8A275', '#D5B085'];
    p.each((x, y) => {
      const band = (y + Math.floor(Math.abs(x - 7.5) / 2)) % 4;
      p.set(x, y, band === 0 ? cols[0] : band === 1 ? cols[3] : cols[1 + Math.floor(r() * 2)]);
    });
  });
  tile('palm_log_top', logTop('#A98459', '#EFD9AE', '#DDC393'));
  tile('log_pine_side', (p, r) => bark(p, r, ['#5E3F32', '#6E4B3B', '#7E5845', '#8C6450'], { furrows: 5, knots: 1 }));
  tile('log_pine_top', logTop('#6E4B3B', '#E2BD8E', '#C99E72'));
  tile('log_fairy_side', (p, r) => {
    bark(p, r, ['#7E62B0', '#8D71C0', '#9C82CD', '#AD95DA'], { furrows: 3, knots: 1 });
    for (let i = 0; i < 4; i++) sparkle(p, Math.floor(r() * 16), Math.floor(r() * 16), '#F6ECFF', 0);
  });
  tile('log_fairy_top', logTop('#8D71C0', '#EBDDFF', '#D1BCF5'));

  tile('leaves_oak', (p, r) => leaves(p, r, ['#57AF5A', '#64BD63', '#72C86B', '#84D579', '#98E187']));
  tile('leaves_birch', (p, r) => leaves(p, r, ['#86C457', '#95D063', '#A5DB71', '#B8E783', '#CBF098'], { holes: 0.14 }));
  tile('leaves_cherry', (p, r) => leaves(p, r, ['#F48DBE', '#F9A0C9', '#FDB3D4', '#FFC4DE', '#FFD6E8'], { holes: 0.1, blossoms: ['#FFFFFF', '#FFF0F7', '#FFE3EF'], blossomRate: 7 }));
  tile('palm_leaves', (p, r) => {
    leaves(p, r, ['#36A565', '#43B471', '#52C27E', '#66CF8E', '#7ADC9D'], { holes: 0.05 });
    p.each((x, y) => { if ((x + y) % 4 === 0 && r() < 0.75) p.setAlpha(x, y, 0); });
  });
  tile('pine_leaves', (p, r) => {
    leaves(p, r, ['#347F68', '#3E8E73', '#4A9C7E', '#58AA89', '#68B896'], { holes: 0.08 });
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      if (p.alpha(x, y)) { p.set(x, y, '#76C3A0'); p.set(x + 1, y + 1, '#2F7560'); }
    }
  });
  tile('snow_leaves_side', (p, r) => {
    leaves(p, r, ['#347F68', '#3E8E73', '#4A9C7E', '#58AA89'], { holes: 0.08 });
    drip(p, r, ['#E4EDF9', '#EEF4FC', '#F6F9FE', '#FFFFFF'], { min: 4, max: 8, rim: '#C9D8EE' });
  });
  tile('snow_leaves_top', (p, r) => {
    natural(p, r, ['#E4EDF9', '#EEF4FC', '#F6F9FE', '#FFFFFF'], { dither: 0.3 });
    for (let i = 0; i < 6; i++) { const x = Math.floor(r() * 16), y = Math.floor(r() * 16); p.set(x, y, '#4A9C7E'); p.set(x + 1, y, '#3E8E73'); }
    for (let i = 0; i < 4; i++) p.setAlpha(Math.floor(r() * 16), Math.floor(r() * 16), 0);
  });
  tile('leaves_fairy', (p, r) => leaves(p, r, ['#9A7CDD', '#A98DE7', '#B89EF0', '#C8AFF6', '#D9C4FC'], { holes: 0.05, blossoms: ['#FFE9FB', '#FFD1F0'], blossomRate: 3, sparkles: '#FFF6C8' }));

  const leafDef = { category: 'nature', transparent: true, lightOpacity: 1, sound: 'pop' };
  block({ key: 'log_oak', name: 'Oak Log', category: 'nature', tiles: { top: 'log_oak_top', side: 'log_oak_side', bottom: 'log_oak_top' } });
  block({ key: 'leaves_oak', name: 'Leaves', ...leafDef });
  block({ key: 'log_birch', name: 'Birch Log', category: 'nature', tiles: { top: 'log_birch_top', side: 'log_birch_side', bottom: 'log_birch_top' } });
  block({ key: 'leaves_birch', name: 'Birch Leaves', ...leafDef });
  block({ key: 'log_cherry', name: 'Cherry Log', category: 'nature', tiles: { top: 'log_cherry_top', side: 'log_cherry_side', bottom: 'log_cherry_top' } });
  block({ key: 'leaves_cherry', name: 'Cherry Blossoms', ...leafDef });
  block({ key: 'palm_log', name: 'Palm Trunk', category: 'nature', tiles: { top: 'palm_log_top', side: 'palm_log_side', bottom: 'palm_log_top' } });
  block({ key: 'palm_leaves', name: 'Palm Leaves', ...leafDef });
  block({ key: 'log_pine', name: 'Pine Log', category: 'nature', tiles: { top: 'log_pine_top', side: 'log_pine_side', bottom: 'log_pine_top' } });
  block({ key: 'pine_leaves', name: 'Pine Needles', ...leafDef });
  block({ key: 'snow_leaves', name: 'Snowy Needles', ...leafDef, tiles: { top: 'snow_leaves_top', side: 'snow_leaves_side', bottom: 'pine_leaves' } });
  block({ key: 'log_fairy', name: 'Fairy Log', category: 'nature', tiles: { top: 'log_fairy_top', side: 'log_fairy_side', bottom: 'log_fairy_top' } });
  block({ key: 'leaves_fairy', name: 'Fairy Leaves', ...leafDef });

  // --- giant mushroom parts ---
  tile('mushroom_stem', (p, r) => {
    const cols = ['#E7DAC8', '#EFE4D5', '#F6EEE3', '#FCF7F0'];
    p.each((x, y) => p.set(x, y, cols[Math.min(3, Math.max(0, ((x * 7) % 5 === 0 ? 0 : 2) + Math.floor(r() * 2) - (r() < 0.15 ? 1 : 0)))]));
    for (let i = 0; i < 4; i++) { const x = Math.floor(r() * 16), y = Math.floor(r() * 14); p.set(x, y, '#DCCDB8'); p.set(x, y + 1, '#DCCDB8'); }
  });
  tile('mushroom_cap_red', (p, r) => {
    natural(p, r, ['#E45C6C', '#EC6C7A', '#F37D89', '#F88F99'], { dither: 0.2 });
    p.pillow(0.1);
    const spots = [[3, 3, 2.1], [11, 5, 1.6], [6, 11, 1.8], [13, 13, 1.3], [1, 9, 1.2]];
    for (const [cx, cy, rr] of spots) {
      p.each((x, y) => {
        if (inCircle(x, y, cx, cy, rr)) p.set(x, y, y + 0.5 < cy ? '#FFFFFF' : '#FBEFF1');
      });
    }
  });
  tile('mushroom_cap_glow', (p, r) => {
    natural(p, r, ['#6D7FE4', '#7A8FEC', '#8AA2F3', '#9CB6F8'], { dither: 0.2 });
    p.pillow(0.12);
    const spots = [[4, 4, 1.8], [11, 3, 1.3], [9, 10, 2], [2, 12, 1.3], [14, 12, 1.2]];
    for (const [cx, cy, rr] of spots) {
      p.each((x, y) => {
        if (inCircle(x, y, cx, cy, rr + 0.9)) p.blend(x, y, '#C8F6FF', 0.45);
        if (inCircle(x, y, cx, cy, rr)) p.set(x, y, '#EFFFFF');
      });
    }
  });
  block({ key: 'mushroom_stem', name: 'Mushroom Stem', category: 'nature', sound: 'pop' });
  block({ key: 'mushroom_cap_red', name: 'Red Mushroom Cap', category: 'nature', sound: 'pop' });
  block({ key: 'mushroom_cap_glow', name: 'Glowing Mushroom Cap', category: 'nature', light: 12, sound: 'chime' });

  // --- sea things ---
  const coral = (base) => (p, r) => {
    const c = ramp(base, [-0.16, -0.06, 0.04, 0.14]);
    natural(p, r, c, { dither: 0.3 });
    // little pores on a loose grid
    for (let gy = 0; gy < 16; gy += 4) {
      for (let gx = 0; gx < 16; gx += 4) {
        const x = gx + 1 + Math.floor(r() * 2) + ((gy / 4) % 2) * 2, y = gy + 1 + Math.floor(r() * 2);
        p.set(x, y, tone(base, -0.3));
        p.set(x, y - 1, tone(base, 0.28));
        p.set(x - 1, y, tone(base, 0.18));
      }
    }
  };
  tile('coral', coral('#F785A5'));
  tile('coral_purple', coral('#B08BEE'));
  tile('coral_yellow', coral('#F7D26A'));
  tile('coral_blue', coral('#72BDEE'));
  tile('shell', (p, r) => {
    natural(p, r, ['#F4E3EC', '#F8EAF1', '#FBF2F6', '#FFF9FB'], { dither: 0.3 });
    for (let k = 0; k < 16; k++) { p.blend(k, (k * 3 + 2) & 15, '#E3D6F7', 0.5); p.blend(k, (k * 3 + 9) & 15, '#D8F2EA', 0.45); }
    // a big scallop shell, hinge at the bottom
    const hx = 8, hy = 13.5;
    p.each((x, y) => {
      const dx = x + 0.5 - hx, dy = y + 0.5 - hy;
      const d = Math.hypot(dx, dy), a = Math.atan2(dx, -dy);
      if (Math.abs(a) > 1.15) return;
      const ridge = (a + 1.15) / 0.29;
      const edge = 11 - Math.abs(Math.sin(ridge * Math.PI)) * 0.9;
      if (d > edge) return;
      let c = Math.floor(ridge) % 2 ? '#FFC2B6' : '#FFD9CE';
      if (d > edge - 1) c = '#EFA193';
      else if (d < 3.2) c = '#FFE8E0';
      p.set(x, y, c);
    });
    p.rect(6, 13, 5, 1, '#F7B5A6'); p.rect(6, 14, 5, 1, '#E8958A');
    p.bevel(0.12, -0.12);
  });
  const sea = { category: 'nature', sound: 'pop' };
  block({ key: 'coral', name: 'Pink Coral', ...sea });
  block({ key: 'coral_purple', name: 'Purple Coral', ...sea });
  block({ key: 'coral_yellow', name: 'Yellow Coral', ...sea });
  block({ key: 'coral_blue', name: 'Blue Coral', ...sea });
  block({ key: 'shell', name: 'Seashell Block', ...sea, sound: 'chime' });
}

