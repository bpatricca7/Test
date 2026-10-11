// Painted preview pictures for the New World biome cards: a little side-view pixel diorama
// drawn with the game's own block tiles (grass, sand, snow, leaves, flowers...) over a pastel
// sky, so every card looks like a peek into that world. Known biomes get a hand-made recipe;
// biomes other teams add later get a friendly generic scene from their iconBlock and colors.

import { mulberry32, hashString, shade } from '../../core/util.js';

const T = 16; // tile size in pixels (drawn 1:1, the card scales it up crisply)
const COLS = 18;
const ROWS = 11;
export const ART_W = COLS * T; // 288
export const ART_H = ROWS * T; // 176

// profile: ground height (in blocks) per column; water: columns below this height get water
const RECIPES = {
  meadow: {
    sky: ['#6EC3FF', '#DDF4FF'], far: '#BFEBB5', sun: true, clouds: 3,
    ground: [['grass'], ['dirt'], ['stone']],
    heights: [4, 4, 5, 5, 5, 4, 3, 2, 2, 2, 3, 4, 4, 5, 6, 6, 5, 5], water: 3,
    trees: [[2, 'cherry'], [13, 'cherry'], [16, 'oak']],
    deco: ['flower_rose', 'flower_tulip', 'flower_daisy', 'grass_tall', 'flower_rose', 'flower_sunflower'], decoChance: 0.8,
  },
  flat: {
    sky: ['#79CBFF', '#E3F6FF'], far: '#C7EFB9', sun: true, clouds: 3,
    ground: [['grass'], ['dirt'], ['stone']],
    heights: Array(COLS).fill(4), house: 6,
    deco: ['flower_daisy', 'grass_tall', 'flower_tulip'], decoChance: 0.35,
  },
  candy: {
    sky: ['#FFB3DA', '#FFF0F8'], far: '#FFD1EC', sun: true, clouds: 3, cloudColor: '#FFE3F3',
    ground: [['frosting_pink', 'wool_pink'], ['cookie', 'planks_oak'], ['chocolate', 'planks_oak']],
    heights: [4, 5, 5, 4, 4, 3, 3, 3, 4, 5, 5, 6, 6, 5, 4, 4, 5, 5], water: 4, waterKeys: ['chocolate_milk', 'chocolate_water'], waterTint: '#9A5B3C',
    trees: [[2, 'lollipop'], [10, 'lollipop'], [15, 'lollipop']],
    deco: ['gumdrop_pink', 'gumdrop_lime', 'candy_cane', 'gumdrop_yellow'], decoBlocks: true, decoChance: 0.35,
  },
  beach: {
    sky: ['#58C2FF', '#E6FBFF'], far: null, sun: true, clouds: 2, sea: true,
    ground: [['sand'], ['sand'], ['stone']],
    heights: [2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2], water: 4,
    trees: [[8, 'palm'], [11, 'palm']],
    deco: ['shell', 'coral'], decoBlocks: true, decoChance: 0.2,
  },
  snow: {
    sky: ['#8FCBFF', '#F0F8FF'], far: '#FFFFFF', sun: true, clouds: 2, snowflakes: true,
    ground: [['snow'], ['dirt'], ['stone']],
    heights: [5, 5, 6, 6, 5, 4, 4, 3, 3, 3, 4, 4, 5, 6, 6, 7, 7, 6], water: 4, waterKeys: ['ice'],
    trees: [[1, 'pine'], [13, 'pine'], [16, 'pine']],
    snowman: 5,
  },
  fairy: {
    sky: ['#4B3C9C', '#C9A8FF'], far: '#8E77D8', moon: true, stars: 26, fireflies: 16,
    ground: [['moss', 'grass'], ['dirt'], ['stone']],
    heights: [4, 4, 5, 5, 4, 4, 3, 3, 4, 4, 5, 5, 6, 6, 5, 4, 4, 4],
    trees: [[2, 'fairy'], [12, 'fairy']],
    deco: ['mushroom_glow', 'crystal_pink', 'flower_lavender', 'crystal_blue', 'flower_tulip'], decoBlocks: true, decoChance: 0.45,
  },
};

function firstBlock(reg, keys) {
  for (const k of keys || []) {
    const d = k && reg.byKey(k);
    if (d && d.id !== 0) return d;
  }
  return null;
}

function tileFor(reg, def, face) {
  if (!def) return null;
  try {
    return reg.tileCanvas(reg.faceTile(def, face), def.tint);
  } catch {
    return null;
  }
}


function drawSparkle(g, x, y, s, color) {
  g.fillStyle = color;
  g.fillRect(x - s, y, s * 2 + 1, 1);
  g.fillRect(x, y - s, 1, s * 2 + 1);
  if (s > 1) g.fillRect(x - 1, y - 1, 3, 3);
}

function pixelCloud(g, x, y, s, color) {
  g.fillStyle = color;
  g.fillRect(x, y + 4 * s, 22 * s, 6 * s);
  g.fillRect(x + 4 * s, y + 1 * s, 9 * s, 6 * s);
  g.fillRect(x + 11 * s, y, 7 * s, 7 * s);
  g.fillStyle = 'rgba(58,31,77,0.08)';
  g.fillRect(x, y + 9 * s, 22 * s, 1 * s);
}

/**
 * Paint the preview for a biome. Returns a PNG data URL (ART_W x ART_H, pixel art: show it
 * with image-rendering: pixelated).
 */
export function paintBiomeArt(game, key, def = {}) {
  const reg = game.registry.blocks;
  const colors = def.colors || ['#FFFFFF', '#FFD1E6'];
  const sky = def.sky || {};
  const recipe = RECIPES[key] || {
    sky: [sky.top || shade(colors[0], -0.05), sky.horizon || colors[0]], far: colors[1], sun: true, clouds: 3,
    ground: [[def.iconBlock, 'grass'], ['dirt'], ['stone']],
    heights: [4, 4, 5, 5, 4, 4, 3, 3, 4, 5, 5, 6, 5, 5, 4, 4, 5, 5],
    trees: [[3, 'oak'], [14, 'cherry']],
    deco: ['flower_rose', 'flower_daisy', 'flower_tulip'], decoChance: 0.4,
  };
  const rand = mulberry32(hashString('art:' + key));
  const c = document.createElement('canvas');
  c.width = ART_W;
  c.height = ART_H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  // sky: blocky gradient bands (pixel-art look)
  const [top, bottom] = [sky.top && !RECIPES[key] ? sky.top : recipe.sky[0], recipe.sky[1]];
  const grad = g.createLinearGradient(0, 0, 0, ART_H * 0.8);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, ART_W, ART_H);

  if (recipe.stars) {
    for (let i = 0; i < recipe.stars; i++) drawSparkle(g, Math.floor(rand() * ART_W), Math.floor(rand() * ART_H * 0.45), rand() < 0.25 ? 2 : 1, rand() < 0.5 ? '#FFFFFF' : '#FFF3B0');
  }
  if (recipe.sun) {
    const sx = ART_W - 52, sy = 14;
    g.fillStyle = 'rgba(255,241,168,0.55)';
    g.fillRect(sx - 6, sy - 6, 36, 36);
    g.fillStyle = '#FFE066';
    g.fillRect(sx, sy, 24, 24);
    g.fillStyle = '#FFF3A6';
    g.fillRect(sx + 3, sy + 3, 10, 6);
  }
  if (recipe.moon) {
    // a soft crescent moon with a glow
    const mx = ART_W - 40, my = 28, r = 13;
    g.save();
    g.fillStyle = 'rgba(255,246,216,0.22)';
    g.beginPath();
    g.arc(mx, my, r + 7, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(mx, my, r, 0, Math.PI * 2);
    g.arc(mx + 7, my - 5, r * 0.85, 0, Math.PI * 2, true);
    g.fillStyle = '#FFF6D8';
    g.fill('evenodd');
    g.restore();
  }
  for (let i = 0; i < (recipe.clouds || 0); i++) {
    pixelCloud(g, Math.floor(8 + i * (ART_W / (recipe.clouds + 0.4)) + rand() * 20), Math.floor(8 + rand() * 30), 2, recipe.cloudColor || '#FFFFFF');
  }

  // far hills: a lighter blocky silhouette
  if (recipe.far) {
    g.fillStyle = recipe.far;
    let h = 4 + Math.floor(rand() * 2);
    for (let x = 0; x < ART_W; x += 8) {
      if (rand() < 0.35) h += rand() < 0.5 ? -1 : 1;
      h = Math.max(3, Math.min(8, h));
      g.fillRect(x, ART_H - (h + 2) * 8 - 8, 8, (h + 2) * 8 + 8);
    }
  }
  if (recipe.sea) {
    g.fillStyle = '#4FC9E8';
    g.fillRect(0, ART_H - 4.5 * T, ART_W, 4.5 * T);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 12; i++) g.fillRect(Math.floor(rand() * ART_W), Math.floor(ART_H - 4.3 * T + rand() * T * 1.5), 6, 1);
  }

  const surf = firstBlock(reg, recipe.ground[0]) || firstBlock(reg, ['grass']);
  const under = firstBlock(reg, recipe.ground[1]) || surf;
  const deep = firstBlock(reg, recipe.ground[2]) || under;
  const waterDef = firstBlock(reg, recipe.waterKeys || ['water']);
  const heights = recipe.heights;
  const baseY = ART_H; // bottom of the picture

  // ground columns
  for (let col = 0; col < COLS; col++) {
    const h = heights[col];
    for (let r = 0; r < h; r++) {
      const d = r === h - 1 ? surf : r >= h - 3 ? under : deep;
      const tile = tileFor(reg, d, 0);
      const x = col * T, y = baseY - (r + 1) * T;
      if (tile) g.drawImage(tile, x, y);
      // lower rows a touch darker for depth
      const dark = (h - 1 - r) * 0.06;
      if (dark > 0) {
        g.fillStyle = `rgba(58,31,77,${Math.min(0.3, dark)})`;
        g.fillRect(x, y, T, T);
      }
    }
    // water fills dips
    if (recipe.water && h < recipe.water) {
      for (let r = h; r < recipe.water; r++) {
        const x = col * T, y = baseY - (r + 1) * T;
        const tile = waterDef ? tileFor(reg, waterDef, 2) : null;
        if (recipe.waterTint && !(waterDef && waterDef.key !== 'water')) {
          // no chocolate block yet: paint a smooth chocolate pond
          g.fillStyle = recipe.waterTint;
          g.fillRect(x, y, T, T);
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.fillRect(x + ((col * 5) % 9), y + 5 + ((r * 3) % 7), 5, 2);
        } else {
          g.globalAlpha = 0.9;
          if (tile) g.drawImage(tile, x, y);
          else { g.fillStyle = '#6CC6FF'; g.fillRect(x, y, T, T); }
          g.globalAlpha = 1;
        }
        if (r === recipe.water - 1) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x + 2, y + 2, 5, 1); }
      }
    }
  }

  const groundTop = (col) => baseY - Math.max(heights[col], recipe.water && heights[col] < recipe.water ? recipe.water : 0) * T;
  const drawBlock = (def, col, row, face = 0) => {
    const tile = tileFor(reg, def, face);
    if (tile) g.drawImage(tile, col * T, row);
  };

  // trees
  const logOak = firstBlock(reg, ['log_oak']);
  for (const [col, kind] of recipe.trees || []) {
    const y0 = groundTop(col);
    if (kind === 'lollipop') {
      const stick = firstBlock(reg, ['wool_white', 'planks_white']);
      const candy = firstBlock(reg, ['lollipop_block', 'wool_pink']);
      for (let i = 1; i <= 2; i++) drawBlock(stick, col, y0 - i * T);
      const cx = col * T + T / 2, cy = y0 - 3 * T - 2;
      const tile = tileFor(reg, candy, 0);
      g.save();
      g.beginPath();
      g.arc(cx, cy, T * 1.15, 0, Math.PI * 2);
      g.clip();
      if (tile) { for (let dx = -2; dx <= 1; dx++) for (let dy = -2; dy <= 1; dy++) g.drawImage(tile, cx + dx * T, cy + dy * T); }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let a = 0; a < 3; a++) { g.fillRect(cx - T, cy - T + a * 10, T * 2, 3); }
      g.restore();
      continue;
    }
    if (kind === 'palm') {
      const log = firstBlock(reg, ['palm_log', 'log_oak']);
      const leaves = firstBlock(reg, ['palm_leaves', 'leaves_oak']);
      for (let i = 1; i <= 4; i++) drawBlock(log, col, y0 - i * T);
      const ty = y0 - 5 * T;
      for (const [dx, dy] of [[-2, 1], [-1, 0], [0, 0], [1, 0], [2, 1], [0, -1]]) drawBlock(leaves, col + dx, ty + dy * T);
      g.fillStyle = '#8A5A2B';
      g.fillRect(col * T + 3, ty + T + 2, 5, 5);
      g.fillRect(col * T + 9, ty + T + 4, 5, 5);
      continue;
    }
    if (kind === 'pine') {
      const leaves = firstBlock(reg, ['pine_leaves', 'snow_leaves', 'leaves_oak']);
      drawBlock(logOak, col, y0 - T);
      const rows = [[-1, 0, 1], [-1, 0, 1], [0], [0]];
      rows.forEach((xs, i) => xs.forEach((dx) => drawBlock(leaves, col + dx, y0 - (2 + i) * T)));
      g.fillStyle = '#FFFFFF';
      rows.forEach((xs, i) => xs.forEach((dx) => g.fillRect((col + dx) * T, y0 - (2 + i) * T, T, 3)));
      continue;
    }
    const leaves = kind === 'fairy'
      ? firstBlock(reg, ['leaves_purple', 'leaves_fairy', 'wool_purple'])
      : kind === 'cherry' ? firstBlock(reg, ['leaves_cherry', 'leaves_oak']) : firstBlock(reg, ['leaves_oak']);
    const log = kind === 'fairy' ? firstBlock(reg, ['log_birch', 'log_oak']) : logOak;
    const th = 2;
    for (let i = 1; i <= th; i++) drawBlock(log, col, y0 - i * T);
    const canopy = [[-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
    for (const [dx, dy] of canopy) drawBlock(leaves, col + dx, y0 - (th + 1 + dy) * T);
    if (kind === 'cherry') {
      g.fillStyle = '#FFE3F0';
      for (let i = 0; i < 6; i++) g.fillRect(col * T - T + Math.floor(rand() * 3 * T), y0 - (th + 3) * T + Math.floor(rand() * 3 * T), 2, 2);
    }
  }

  // a tiny block house for the builder flat
  if (recipe.house !== undefined) {
    const col = recipe.house, y0 = groundTop(col);
    const wall = firstBlock(reg, ['planks_pink', 'wool_pink']);
    const glass = firstBlock(reg, ['glass_pink', 'glass']);
    const roof = firstBlock(reg, ['roof_pink', 'wool_purple']);
    const door = firstBlock(reg, ['planks_oak']);
    for (let dx = 0; dx < 4; dx++) for (let dy = 1; dy <= 3; dy++) drawBlock(wall, col + dx, y0 - dy * T);
    drawBlock(door, col + 1, y0 - T);
    drawBlock(door, col + 1, y0 - 2 * T);
    drawBlock(glass, col + 3, y0 - 2 * T);
    for (let dx = -1; dx < 5; dx++) drawBlock(roof, col + dx, y0 - 4 * T);
    for (let dx = 0; dx < 4; dx++) drawBlock(roof, col + dx, y0 - 5 * T);
  }

  // snowman
  if (recipe.snowman !== undefined) {
    const col = recipe.snowman, y0 = groundTop(col);
    const cx = col * T + T / 2;
    g.fillStyle = '#FFFFFF';
    g.fillRect(cx - 9, y0 - 16, 18, 16);
    g.fillRect(cx - 7, y0 - 28, 14, 12);
    g.fillStyle = '#2E2244';
    g.fillRect(cx - 4, y0 - 24, 2, 2);
    g.fillRect(cx + 2, y0 - 24, 2, 2);
    g.fillRect(cx - 2, y0 - 12, 2, 2);
    g.fillRect(cx - 2, y0 - 7, 2, 2);
    g.fillStyle = '#FF8A3D';
    g.fillRect(cx, y0 - 21, 5, 2);
    g.fillStyle = '#FF5FA2';
    g.fillRect(cx - 8, y0 - 17, 16, 3);
  }

  // little things on the ground
  if (recipe.deco) {
    const decoDefs = recipe.deco.map((k) => firstBlock(reg, [k])).filter(Boolean);
    if (decoDefs.length) {
      const taken = new Set((recipe.trees || []).map(([c]) => c));
      if (recipe.house !== undefined) for (let i = -1; i < 5; i++) taken.add(recipe.house + i);
      if (recipe.snowman !== undefined) taken.add(recipe.snowman);
      for (let col = 0; col < COLS; col++) {
        if (taken.has(col) || (recipe.water && heights[col] < recipe.water)) continue;
        if (rand() > (recipe.decoChance ?? 0.5)) continue;
        const d = decoDefs[Math.floor(rand() * decoDefs.length)];
        const y0 = groundTop(col);
        if (recipe.decoBlocks && d.shape !== 'cross') {
          // small blocks (gumdrops, shells) drawn half size
          const tile = tileFor(reg, d, 0);
          if (tile) g.drawImage(tile, col * T + 3, y0 - 10, 10, 10);
        } else {
          drawBlock(d, col, y0 - T);
        }
      }
    }
  }

  if (recipe.fireflies) {
    for (let i = 0; i < recipe.fireflies; i++) {
      const x = Math.floor(rand() * ART_W), y = Math.floor(ART_H * 0.3 + rand() * ART_H * 0.45);
      g.fillStyle = 'rgba(255,245,160,0.35)';
      g.fillRect(x - 2, y - 2, 5, 5);
      g.fillStyle = '#FFF7B0';
      g.fillRect(x, y, 2, 2);
    }
  }
  if (recipe.snowflakes) {
    g.fillStyle = '#FFFFFF';
    for (let i = 0; i < 30; i++) g.fillRect(Math.floor(rand() * ART_W), Math.floor(rand() * ART_H * 0.7), 2, 2);
  }
  // sparkles everywhere (it is Glimmer World after all)
  for (let i = 0; i < 5; i++) drawSparkle(g, Math.floor(10 + rand() * (ART_W - 20)), Math.floor(8 + rand() * ART_H * 0.5), 2, '#FFFFFF');

  return c.toDataURL('image/png');
}

/** Two little islands for the Cozy / Big size cards (SVG markup). */
export function sizeArt(big) {
  const r = big ? 38 : 24;
  const trees = big ? [[-22, -4], [4, -10], [22, -2], [-8, 6]] : [[-8, -4], [9, -2]];
  const t = trees.map(([x, y]) => `<rect x="${50 + x - 1.5}" y="${46 + y - 2}" width="3" height="8" fill="#9B6A43"/><circle cx="${50 + x}" cy="${46 + y - 5}" r="6" fill="${x > 0 ? '#FFB8D6' : '#8EDB7E'}"/>`).join('');
  return `<svg viewBox="0 0 100 80" aria-hidden="true"><rect width="100" height="80" rx="14" fill="#8FDBF5"/><path d="M8 70h84" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/>` +
    `<ellipse cx="50" cy="${50}" rx="${r + 5}" ry="${r * 0.42 + 4}" fill="#FFE7A8"/><ellipse cx="50" cy="${48}" rx="${r}" ry="${r * 0.4}" fill="#9EE08F"/>${t}` +
    (big ? '<rect x="58" y="36" width="9" height="8" fill="#FF8CC6"/><path d="M56 37l6.5-5 6.5 5z" fill="#9C7BFF"/>' : '<rect x="44" y="40" width="8" height="7" fill="#FF8CC6"/><path d="M42.5 41l5.5-4.5 5.5 4.5z" fill="#9C7BFF"/>') +
    '</svg>';
}

