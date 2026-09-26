// Core block library: ~30 essential blocks with pastel pixel-art tile painters.
// The Blocks & Worldgen team grows this to the full canonical list (see DESIGN.md).
// Painters get (ctx, rand) for a 16x16 canvas; rand is seeded by the tile key.

import { jitter, shade, mixHex } from '../core/util.js';

// ---------- painter helpers (exported for other block modules) ----------

export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Fill every pixel with a weighted pick from palette [[color, weight], ...], jittered. */
export function speckle(ctx, rand, palette, jit = 0.03, x0 = 0, y0 = 0, w = 16, h = 16) {
  let total = 0;
  for (const [, wt] of palette) total += wt;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let r = rand() * total, c = palette[0][0];
      for (const [col, wt] of palette) {
        if ((r -= wt) <= 0) { c = col; break; }
      }
      px(ctx, x, y, jit ? jitter(c, rand, jit) : c);
    }
  }
}

/**
 * Tileable Voronoi cells: returns { cell: Int8Array(256), edge: Uint8Array(256) } where edge
 * marks pixels near a border between cells.
 */
export function voronoi(rand, count, edgeWidth = 1.1) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([rand() * 16, rand() * 16]);
  const cell = new Int8Array(256), edge = new Uint8Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let d1 = Infinity, d2 = Infinity, best = 0;
      for (let i = 0; i < count; i++) {
        let dx = Math.abs(x + 0.5 - pts[i][0]), dy = Math.abs(y + 0.5 - pts[i][1]);
        if (dx > 8) dx = 16 - dx;
        if (dy > 8) dy = 16 - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
      }
      cell[y * 16 + x] = best;
      edge[y * 16 + x] = d2 - d1 < edgeWidth ? 1 : 0;
    }
  }
  return { cell, edge };
}

/** Soft knitted fabric look (wool, carpets). */
export function paintWool(ctx, rand, base) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = base;
      const k = (x + (y >> 1)) % 4;
      if (k === 0) c = shade(base, 0.12);
      else if (k === 2) c = shade(base, -0.06);
      if ((y & 1) === 0 && x % 4 === 1) c = shade(base, -0.1);
      px(ctx, x, y, jitter(c, rand, 0.025));
    }
  }
}

/** Horizontal planks with seams and grain. */
export function paintPlanks(ctx, rand, base, seam) {
  const light = shade(base, 0.12), dark = shade(base, -0.08);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    const cut = (row * 7 + 3 + Math.floor(rand() * 4)) % 16;
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 0; x < 16; x++) {
        let c = y === y0 + 3 ? seam : rand() < 0.18 ? dark : rand() < 0.12 ? light : base;
        if (y === y0 && y !== y0 + 3) c = mixHex(c, light, 0.5);
        if (x === cut && y !== y0 + 3) c = seam;
        px(ctx, x, y, jitter(c, rand, 0.02));
      }
    }
    // a knot here and there
    if (rand() < 0.5) px(ctx, (cut + 5 + Math.floor(rand() * 6)) % 16, y0 + 1, seam);
  }
}

function paintGrassTop(ctx, rand) {
  speckle(ctx, rand, [['#8EDB7E', 5], ['#9EE68A', 3], ['#7BCF72', 2], ['#B4F09A', 1]], 0.03);
  // tiny blades highlights
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 15);
    px(ctx, x, y, '#C6F5A8');
    px(ctx, x, y + 1, '#72C46A');
  }
}

function paintDirt(ctx, rand) {
  speckle(ctx, rand, [['#C0916A', 5], ['#B08260', 3], ['#CFA27A', 2], ['#9E7254', 1]], 0.03);
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rand() * 15), y = Math.floor(rand() * 15);
    px(ctx, x, y, '#D9B892');
    px(ctx, x + 1, y + 1, '#8F6749');
  }
}

function paintGrassSide(ctx, rand) {
  paintDirt(ctx, rand);
  const greens = ['#8EDB7E', '#9EE68A', '#7BCF72'];
  for (let x = 0; x < 16; x++) {
    const drip = 3 + Math.floor(rand() * 3) - (x % 5 === 0 ? 1 : 0);
    for (let y = 0; y < drip; y++) px(ctx, x, y, jitter(greens[Math.floor(rand() * 3)], rand, 0.03));
    px(ctx, x, drip, '#6FBF66');
  }
}

function paintStone(ctx, rand) {
  speckle(ctx, rand, [['#B9B5C8', 6], ['#C8C4D6', 3], ['#A7A2B8', 2]], 0.025);
  // soft cracks
  for (let i = 0; i < 3; i++) {
    let x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    for (let s = 0; s < 4; s++) {
      px(ctx, x & 15, y & 15, '#9A95AD');
      x += rand() < 0.5 ? 1 : 0;
      y += 1;
    }
  }
}

function paintCobble(ctx, rand) {
  const v = voronoi(rand, 7, 1.2);
  const tones = ['#C9C5D6', '#B8B3C9', '#D6D2E2', '#AFAAC0', '#C2BDD0', '#CFCBDC', '#B3AEC4'];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const k = y * 16 + x;
      const c = v.edge[k] ? '#8E89A2' : tones[v.cell[k]];
      px(ctx, x, y, jitter(c, rand, 0.03));
    }
  }
}

function paintSand(ctx, rand) {
  speckle(ctx, rand, [['#F7E4AE', 6], ['#F2D998', 3], ['#FBEFC8', 2], ['#E8CB86', 1]], 0.02);
}

function paintWater(ctx, rand) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const wave = Math.sin((x + y * 0.5) * 0.9) + Math.sin((x * 0.4 - y) * 0.7);
      const c = wave > 1.2 ? '#A8E6FF' : wave > 0.2 ? '#7DD0F5' : '#68C2EE';
      ctx.fillStyle = jitter(c, rand, 0.02);
      ctx.globalAlpha = 0.74;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

function paintSnow(ctx, rand) {
  speckle(ctx, rand, [['#F8FBFF', 8], ['#E8F1FB', 3], ['#FFFFFF', 3]], 0.01);
  for (let i = 0; i < 5; i++) px(ctx, Math.floor(rand() * 16), Math.floor(rand() * 16), '#D9E7F7');
}

function paintIce(ctx, rand) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const streak = (x + y) % 11 === 0 || (x - y + 16) % 13 === 0;
      ctx.fillStyle = streak ? '#F4FCFF' : jitter('#B9E6FA', rand, 0.03);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

function paintLogSide(ctx, rand) {
  const cols = ['#A0714A', '#8C613F', '#B38258'];
  for (let x = 0; x < 16; x++) {
    const base = cols[(x + Math.floor(rand() * 2)) % 3];
    for (let y = 0; y < 16; y++) {
      const c = rand() < 0.1 ? shade(base, -0.12) : base;
      px(ctx, x, y, jitter(c, rand, 0.03));
    }
  }
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 13);
    rect(ctx, x, y, 1, 3, '#7A5234');
  }
}

function paintLogTop(ctx, rand) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      let c;
      if (d > 6.6) c = '#8C613F';
      else c = Math.floor(d) % 2 === 0 ? '#E3BD8A' : '#CFA271';
      px(ctx, x, y, jitter(c, rand, 0.02));
    }
  }
}

function paintLeaves(base, light, dark, holes) {
  return (ctx, rand) => {
    ctx.clearRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (rand() < holes) continue;
        const r = rand();
        const c = r < 0.18 ? light : r < 0.38 ? dark : base;
        px(ctx, x, y, jitter(c, rand, 0.03));
      }
    }
    // little clusters of highlight
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(rand() * 15), y = Math.floor(rand() * 15);
      px(ctx, x, y, shade(light, 0.2));
      px(ctx, x + 1, y, light);
    }
  };
}

function paintGlass(frame, shine) {
  return (ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    rect(ctx, 0, 0, 16, 1, frame);
    rect(ctx, 0, 15, 16, 1, frame);
    rect(ctx, 0, 0, 1, 16, frame);
    rect(ctx, 15, 0, 1, 16, frame);
    // corner studs and a diagonal shine
    px(ctx, 1, 1, shine); px(ctx, 14, 14, shine);
    for (let i = 0; i < 4; i++) px(ctx, 3 + i, 6 - i, shine);
    for (let i = 0; i < 2; i++) px(ctx, 4 + i, 8 - i, shine);
  };
}

function paintFlower(petal, petalLight, petalDark, center, kind) {
  return (ctx, rand) => {
    ctx.clearRect(0, 0, 16, 16);
    const stem = '#4FAE57', leaf = '#6CCB6A';
    rect(ctx, 7, 7, 2, 9, stem);
    rect(ctx, 5, 11, 2, 1, leaf); px(ctx, 4, 10, leaf);
    rect(ctx, 9, 12, 2, 1, leaf); px(ctx, 11, 11, leaf);
    if (kind === 'daisy') {
      const cx = 7.5, cy = 5.5;
      for (let y = 1; y < 11; y++) {
        for (let x = 2; x < 14; x++) {
          const d = Math.hypot(x + 0.5 - cx - 0.5, y + 0.5 - cy);
          if (d < 4.4) px(ctx, x, y, d < 1.6 ? center : (x + y) % 3 === 0 ? petalDark : petal);
        }
      }
      px(ctx, 7, 4, shade(center, 0.3));
    } else if (kind === 'tulip') {
      rect(ctx, 5, 2, 6, 5, petal);
      rect(ctx, 5, 1, 1, 2, petal); rect(ctx, 7, 0, 2, 2, petalLight); rect(ctx, 10, 1, 1, 2, petal);
      rect(ctx, 6, 2, 1, 4, petalLight);
      rect(ctx, 9, 3, 1, 4, petalDark);
      rect(ctx, 6, 7, 4, 1, petalDark);
    } else {
      // rose: round bloom with a swirl
      for (let y = 1; y < 10; y++) {
        for (let x = 3; x < 13; x++) {
          const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 5);
          if (d < 4.2) px(ctx, x, y, d > 3.3 ? petalDark : rand() < 0.25 ? petalLight : petal);
        }
      }
      px(ctx, 7, 4, petalDark); px(ctx, 8, 4, petalDark); px(ctx, 8, 5, petalDark); px(ctx, 7, 6, petalDark);
      px(ctx, 6, 3, petalLight); px(ctx, 9, 6, center);
    }
  };
}

function paintTallGrass(ctx, rand) {
  ctx.clearRect(0, 0, 16, 16);
  const greens = ['#7FD174', '#96E083', '#6BBF67', '#A9EC92'];
  for (let b = 0; b < 7; b++) {
    let x = 1 + Math.floor(rand() * 14);
    const h = 6 + Math.floor(rand() * 9);
    const c = greens[b % greens.length];
    for (let y = 15; y > 15 - h; y--) {
      px(ctx, x, y, c);
      if (rand() < 0.2) x += rand() < 0.5 ? -1 : 1;
      x = Math.max(0, Math.min(15, x));
    }
  }
}

function paintLamp(ctx, rand) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      let c = d > 6.6 ? '#E2A84A' : d > 5.6 ? '#FFD479' : d > 3 ? '#FFE9A8' : '#FFF8DC';
      if (d <= 6.6 && (x === 7 || x === 8 || y === 7 || y === 8) && d > 3) c = '#FFDF8E';
      px(ctx, x, y, jitter(c, rand, 0.015));
    }
  }
  px(ctx, 5, 5, '#FFFFFF'); px(ctx, 10, 10, '#FFFFFF'); px(ctx, 10, 5, '#FFF4C8');
}

/** Pastel wool colors shipped by core (the block team adds the rest of wool_<color>). */
export const CORE_WOOL = {
  pink: '#FFA9CB',
  white: '#FAF6F4',
  purple: '#C3A6FF',
  sky: '#9FD8FF',
  yellow: '#FFE38A',
  lime: '#B6EC8C',
  red: '#FF8A8A',
};

export function install(game) {
  const B = game.registry.blocks;

  B.tile('grass_top', paintGrassTop);
  B.tile('grass_side', paintGrassSide);
  B.tile('dirt', paintDirt);
  B.tile('stone', paintStone);
  B.tile('cobble', paintCobble);
  B.tile('sand', paintSand);
  B.tile('water', paintWater, { animated: true });
  B.tile('snow', paintSnow);
  B.tile('ice', paintIce);
  B.tile('log_oak_side', paintLogSide);
  B.tile('log_oak_top', paintLogTop);
  B.tile('leaves_oak', paintLeaves('#74CC6C', '#9BE386', '#5DB65D', 0.14));
  B.tile('leaves_cherry', paintLeaves('#FFB8D6', '#FFD6E8', '#F79AC4', 0.12));
  B.tile('planks_oak', (ctx, rand) => paintPlanks(ctx, rand, '#E0B07A', '#B68657'));
  B.tile('planks_pink', (ctx, rand) => paintPlanks(ctx, rand, '#FFB7D2', '#EE8DB5'));
  B.tile('planks_white', (ctx, rand) => paintPlanks(ctx, rand, '#FBF4EC', '#DCCFC4'));
  B.tile('glass', paintGlass('#DDF3FF', '#FFFFFF'));
  B.tile('glass_pink', paintGlass('#FFC8E0', '#FFF0F7'));
  B.tile('flower_rose', paintFlower('#FF6F98', '#FF9DBA', '#E24C78', '#FFE07A', 'rose'));
  B.tile('flower_daisy', paintFlower('#FFFFFF', '#FFFFFF', '#E9E4F4', '#FFD23F', 'daisy'));
  B.tile('flower_tulip', paintFlower('#B892FF', '#D4BCFF', '#9670E6', '#FFD23F', 'tulip'));
  B.tile('grass_tall', paintTallGrass);
  B.tile('lamp_block', paintLamp);
  for (const [name, color] of Object.entries(CORE_WOOL)) {
    B.tile('wool_' + name, (ctx, rand) => paintWool(ctx, rand, color));
  }

  // nature
  B.register({ key: 'grass', name: 'Grass', category: 'nature', tiles: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' } });
  B.register({ key: 'dirt', name: 'Dirt', category: 'nature' });
  B.register({ key: 'stone', name: 'Stone', category: 'nature' });
  B.register({ key: 'cobble', name: 'Cobblestone', category: 'building' });
  B.register({ key: 'sand', name: 'Sand', category: 'nature' });
  B.register({ key: 'water', name: 'Water', category: 'nature', shape: 'liquid', translucent: true, solid: false, lightOpacity: 1 });
  B.register({ key: 'snow', name: 'Snow', category: 'nature' });
  B.register({ key: 'ice', name: 'Ice', category: 'nature', translucent: true, lightOpacity: 1 });
  B.register({ key: 'log_oak', name: 'Oak Log', category: 'nature', tiles: { top: 'log_oak_top', side: 'log_oak_side', bottom: 'log_oak_top' } });
  B.register({ key: 'leaves_oak', name: 'Leaves', category: 'nature', transparent: true, lightOpacity: 1 });
  B.register({ key: 'leaves_cherry', name: 'Cherry Blossoms', category: 'nature', transparent: true, lightOpacity: 1 });
  B.register({ key: 'flower_rose', name: 'Rose', category: 'nature', shape: 'cross' });
  B.register({ key: 'flower_daisy', name: 'Daisy', category: 'nature', shape: 'cross' });
  B.register({ key: 'flower_tulip', name: 'Tulip', category: 'nature', shape: 'cross' });
  B.register({ key: 'grass_tall', name: 'Tall Grass', category: 'nature', shape: 'cross', replaceable: true });

  // building
  B.register({ key: 'planks_oak', name: 'Oak Planks', category: 'building' });
  B.register({ key: 'planks_pink', name: 'Pink Planks', category: 'building' });
  B.register({ key: 'planks_white', name: 'White Planks', category: 'building' });
  B.register({ key: 'slab_oak', name: 'Oak Slab', category: 'building', shape: 'slab', tiles: { all: 'planks_oak' } });

  // glass
  B.register({ key: 'glass', name: 'Glass', category: 'glass', transparent: true, sound: 'chime' });
  B.register({ key: 'glass_pink', name: 'Pink Glass', category: 'glass', transparent: true, sound: 'chime' });

  // colors
  for (const [name, color] of Object.entries(CORE_WOOL)) {
    B.register({ key: 'wool_' + name, name: name[0].toUpperCase() + name.slice(1) + ' Wool', category: 'colors', color });
  }
  B.register({ key: 'carpet_pink', name: 'Pink Carpet', category: 'colors', shape: 'carpet', tiles: { all: 'wool_pink' } });
  B.register({ key: 'carpet_white', name: 'White Carpet', category: 'colors', shape: 'carpet', tiles: { all: 'wool_white' } });

  // lights
  B.register({ key: 'lamp_block', name: 'Glow Lamp', category: 'lights', light: 15, sound: 'chime' });
}
