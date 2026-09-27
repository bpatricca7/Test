// Procedural furniture textures (painted on small canvases, pixel-art style) and the shared
// materials that use them. Everything is cached per (kind, color) and marked
// userData.shared so disposeObject() never frees a texture another piece still uses.

import * as THREE from 'three';
import { mulberry32, hashString, shade, mixHex } from '../../core/util.js';

const texCache = new Map();
const matCache = new Map();

/** Canvas texture (nearest filtering, repeat wrap by default). paint(ctx, w, h, rand). */
export function paintTexture(key, w, h, paint, { repeat = true, smooth = false } = {}) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // read back once into the furniture texture array (atlas.js): keep the pixels on the CPU so
  // that read does not stall on the GPU
  const ctx = c.getContext('2d', { willReadFrequently: true });
  paint(ctx, w, h, mulberry32(hashString(key)));
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.shared = true;
  texCache.set(key, t);
  return t;
}

/**
 * Cached Lambert material. opts: { map, uvScale, uvFit, emissive, emissiveIntensity,
 * opacity, side, alphaTest, emissiveMap }.
 */
export function material(key, opts = {}) {
  let m = matCache.get(key);
  if (m) return m;
  const p = { color: opts.color || '#FFFFFF' };
  if (opts.map) p.map = opts.map;
  if (opts.emissive) {
    p.emissive = opts.emissive;
    p.emissiveIntensity = opts.emissiveIntensity ?? 1;
    if (opts.emissiveMap) p.emissiveMap = opts.emissiveMap;
  }
  if (opts.opacity !== undefined && opts.opacity < 1) {
    p.transparent = true;
    p.opacity = opts.opacity;
    p.depthWrite = false;
  }
  if (opts.alphaTest) p.alphaTest = opts.alphaTest;
  if (opts.side) p.side = opts.side;
  m = new THREE.MeshLambertMaterial(p);
  m.name = key;
  m.userData.shared = true;
  if (opts.uvScale) m.userData.uvScale = opts.uvScale;
  if (opts.uvFit) m.userData.uvFit = true;
  matCache.set(key, m);
  return m;
}

/** Plain glowing material (lamp bulbs, flames, screens). */
export function glow(color, intensity = 1) {
  return material(`glow|${color}|${intensity}`, { color, emissive: color, emissiveIntensity: intensity });
}

/** See-through material (curtains, glass, water). */
export function sheer(color, opacity = 0.5) {
  const m = material(`sheer|${color}|${opacity}`, { color, opacity, side: THREE.DoubleSide });
  // one pass for both sides (half the draw calls): the faces of one mesh share one color and
  // opacity, so the blending order between them does not change the picture
  m.forceSinglePass = true;
  return m;
}

// ---------- pixel helpers ----------

function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const STAR = ['...X...', '...X...', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', 'X.....X'];
const FLOWER = ['.X.X.', 'XXXXX', '.XOX.', 'XXXXX', '.X.X.'];
const CLOUD = ['..XX....', '.XXXXXX.', 'XXXXXXXX', '.XXXXXX.'];
const MOON = ['..XXX', '.XX..', 'XX...', 'XX...', '.XX..', '..XXX'];
export const SPRITES = { HEART, STAR, FLOWER, CLOUD, MOON };

/** Draw a character sprite at (x, y); colors: { X: '#..', O: '#..' }. */
export function sprite(ctx, rows, x, y, colors, scale = 1) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const col = colors[rows[r][c]];
      if (col) px(ctx, x + c * scale, y + r * scale, scale, scale, col);
    }
  }
}

function stitches(ctx, w, h, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < w; i += 3) {
    ctx.fillRect(i, 0, 2, 1);
    ctx.fillRect(i, h - 1, 2, 1);
  }
  for (let i = 0; i < h; i += 3) {
    ctx.fillRect(0, i, 1, 2);
    ctx.fillRect(w - 1, i, 1, 2);
  }
}

// ---------- quilts ----------

export const QUILT_PATTERNS = ['hearts', 'stars', 'dots', 'flowers', 'patchwork', 'gingham', 'clouds', 'moons', 'stripes', 'rainbow'];

/** Quilt / blanket fabric: one 16x16 tile covers half a block. */
export function quiltMat(color, pattern = 'hearts') {
  const key = `quilt|${color}|${pattern}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx, w, h, rand) => {
      const light = shade(color, 0.72);
      const mid = shade(color, 0.35);
      const dark = shade(color, -0.12);
      px(ctx, 0, 0, w, h, color);
      switch (pattern) {
        case 'hearts':
          sprite(ctx, HEART, 5, 5, { X: light });
          px(ctx, 0, 0, 1, 1, mid);
          break;
        case 'stars':
          sprite(ctx, STAR, 4, 4, { X: '#FFF4B8' });
          px(ctx, 1, 1, 1, 1, light);
          px(ctx, 13, 13, 1, 1, light);
          break;
        case 'dots':
          for (const [x, y] of [[3, 3], [11, 11]]) {
            px(ctx, x - 1, y, 4, 2, light);
            px(ctx, x, y - 1, 2, 4, light);
          }
          break;
        case 'flowers':
          sprite(ctx, FLOWER, 5, 5, { X: light, O: '#FFD95A' });
          px(ctx, 1, 13, 2, 1, mid);
          break;
        case 'patchwork': {
          const cols = [color, mixHex(color, '#FFE38F', 0.45), mixHex(color, '#A6D8FF', 0.45), light];
          px(ctx, 0, 0, 8, 8, cols[0]);
          px(ctx, 8, 0, 8, 8, cols[1]);
          px(ctx, 0, 8, 8, 8, cols[2]);
          px(ctx, 8, 8, 8, 8, cols[3]);
          sprite(ctx, ['.X.X.', 'XXXXX', '.XXX.', '..X..'], 1, 2, { X: light });
          px(ctx, 11, 11, 2, 2, cols[0]);
          ctx.fillStyle = dark;
          for (let i = 0; i < 16; i += 2) {
            ctx.fillRect(i, 7, 1, 1);
            ctx.fillRect(7, i, 1, 1);
          }
          break;
        }
        case 'gingham':
          for (let y = 0; y < 16; y += 8) {
            for (let x = 0; x < 16; x += 8) {
              px(ctx, x, y, 4, 4, mid);
              px(ctx, x + 4, y + 4, 4, 4, light);
              px(ctx, x, y + 4, 4, 4, color);
              px(ctx, x + 4, y, 4, 4, color);
            }
          }
          return; // no stitches on gingham
        case 'clouds':
          sprite(ctx, CLOUD, 4, 6, { X: '#FFFFFF' });
          px(ctx, 2, 2, 1, 1, light);
          break;
        case 'moons':
          sprite(ctx, MOON, 5, 5, { X: '#FFF4B8' });
          px(ctx, 12, 3, 1, 1, '#FFF4B8');
          px(ctx, 2, 12, 1, 1, light);
          break;
        case 'stripes':
          for (let x = 0; x < 16; x += 8) px(ctx, x, 0, 4, 16, light);
          return;
        case 'rainbow': {
          const bands = ['#FFB3BA', '#FFD9A8', '#FFF3B0', '#C6F4C2', '#B8E1FF', '#D9C8FF'];
          for (let i = 0; i < 8; i++) px(ctx, 0, i * 2, 16, 2, mixHex(bands[i % 6], color, 0.25));
          return;
        }
        default:
          break;
      }
      stitches(ctx, w, h, dark);
    }),
    uvScale: 2,
  });
}

// ---------- wood, fabric, tiles, stone ----------

/** Wood with soft warm grain in horizontal planks; 16 px per block. */
export function woodMat(color) {
  const key = `wood|${color}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx, w, h, rand) => {
      const warm = '#B98A5E';
      for (let b = 0; b < 4; b++) {
        const tone = mixHex(color, b % 2 ? '#FFFFFF' : warm, b % 2 ? 0.06 : 0.04);
        px(ctx, 0, b * 4, 16, 4, tone);
        px(ctx, 0, b * 4 + 3, 16, 1, mixHex(color, warm, 0.14));
        for (let i = 0; i < 2; i++) {
          const x = Math.floor(rand() * 12);
          px(ctx, x, b * 4 + 1 + Math.floor(rand() * 2), 3 + Math.floor(rand() * 4), 1, mixHex(color, warm, 0.09));
        }
        if (rand() < 0.5) px(ctx, Math.floor(rand() * 15), b * 4, 1, 1, mixHex(color, '#FFFFFF', 0.25));
      }
    }),
    uvScale: 1,
  });
}

/** Soft woven fabric (sofas, chairs, cushions). */
export function fabricMat(color) {
  const key = `fabric|${color}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx, w, h, rand) => {
      px(ctx, 0, 0, w, h, color);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if ((x + y) % 2 === 0) px(ctx, x, y, 1, 1, shade(color, 0.05));
          if (rand() < 0.06) px(ctx, x, y, 1, 1, shade(color, -0.05));
        }
      }
    }),
    uvScale: 2,
  });
}

/** Fluffy tufts (bath mats, beanbags, cloud beds). */
export function fluffyMat(color) {
  const key = `fluffy|${color}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx, w, h, rand) => {
      px(ctx, 0, 0, w, h, color);
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
        px(ctx, x, y, 2, 1, shade(color, rand() < 0.5 ? 0.18 : -0.06));
      }
    }),
    uvScale: 2,
  });
}

/** Shiny square tiles with grout (kitchens, bathrooms, showers). */
export function tileMat(color, grout = '#FFFFFF') {
  const key = `tile|${color}|${grout}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx) => {
      px(ctx, 0, 0, 16, 16, grout);
      for (const [x, y] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
        px(ctx, x, y, 7, 7, color);
        px(ctx, x + 1, y + 1, 2, 1, shade(color, 0.5));
        px(ctx, x + 1, y + 2, 1, 1, shade(color, 0.5));
        px(ctx, x, y + 6, 7, 1, shade(color, -0.07));
      }
    }),
    uvScale: 2,
  });
}

/** Pastel bricks (fireplaces). */
export function brickMat(color) {
  const key = `brick|${color}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx, w, h, rand) => {
      px(ctx, 0, 0, 16, 16, shade(color, 0.55));
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 4 : 0;
        for (let k = -1; k < 2; k++) {
          const x = off + k * 8;
          const c = shade(color, (rand() - 0.5) * 0.12);
          px(ctx, x, row * 4, 7, 3, c);
          px(ctx, x, row * 4, 7, 1, shade(c, 0.15));
        }
      }
    }),
    uvScale: 1,
  });
}

/** Rounded cobbles (wells, fountains). */
export function stoneMat(color) {
  const key = `stone|${color}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx, w, h, rand) => {
      px(ctx, 0, 0, 16, 16, shade(color, -0.2));
      const stones = [[0, 0, 7, 5], [8, 0, 8, 6], [0, 6, 5, 5], [6, 7, 6, 4], [13, 7, 3, 5], [0, 12, 8, 4], [9, 12, 7, 4]];
      for (const [x, y, sw, sh] of stones) {
        const c = shade(color, (rand() - 0.4) * 0.14);
        px(ctx, x, y, sw - 1, sh - 1, c);
        px(ctx, x, y, sw - 1, 1, shade(c, 0.18));
      }
    }),
    uvScale: 1,
  });
}

/** Towel / rug stripes. */
export function stripeMat(color, color2 = '#FFFFFF') {
  const key = `stripe|${color}|${color2}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx) => {
      px(ctx, 0, 0, 16, 16, color);
      px(ctx, 0, 3, 16, 2, color2);
      px(ctx, 0, 11, 16, 2, color2);
      px(ctx, 0, 7, 16, 1, shade(color, -0.08));
    }),
    uvScale: 2,
  });
}

/** Mirror / glass: soft blue with diagonal shine (whole image per face). */
export function mirrorMat(tint = '#D8F0FF') {
  const key = `mirror|${tint}`;
  return material(key, {
    map: paintTexture(key, 32, 48, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, shade(tint, 0.5));
      g.addColorStop(1, shade(tint, -0.1));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const [o, t] of [[6, 5], [16, 2]]) {
        ctx.beginPath();
        ctx.moveTo(o, 0);
        ctx.lineTo(o + t, 0);
        ctx.lineTo(o + t - 14, h);
        ctx.lineTo(o - 14, h);
        ctx.fill();
      }
    }, { repeat: false, smooth: true }),
    uvFit: true,
    emissive: '#FFFFFF',
    emissiveIntensity: 0.12,
  });
}

/** Animated water surface (shared; the furniture system scrolls it). */
export function waterMat() {
  const key = 'water|furniture';
  const t = paintTexture(key, 16, 16, (ctx, w, h, rand) => {
    px(ctx, 0, 0, 16, 16, '#7FD3F7');
    for (let i = 0; i < 14; i++) px(ctx, Math.floor(rand() * 14), Math.floor(rand() * 16), 2 + Math.floor(rand() * 3), 1, '#B9ECFF');
    px(ctx, 3, 4, 1, 1, '#FFFFFF');
    px(ctx, 11, 12, 1, 1, '#FFFFFF');
  });
  return material(key, { map: t, uvScale: 2, opacity: 0.82, emissive: '#3FA8E0', emissiveIntensity: 0.15 });
}

/** Falling water streams (sinks, showers): stripes that scroll downward. */
export function streamMat() {
  const key = 'stream|furniture';
  const t = paintTexture(key, 16, 16, (ctx, w, h, rand) => {
    ctx.clearRect(0, 0, 16, 16);
    for (let x = 0; x < 16; x += 2) {
      const y0 = Math.floor(rand() * 16);
      for (let k = 0; k < 7; k++) px(ctx, x, (y0 + k) % 16, 1, 1, k < 2 ? '#FFFFFF' : '#A9E4FF');
    }
  });
  return material(key, { map: t, uvScale: 3, opacity: 0.8, side: THREE.DoubleSide, emissive: '#8FDBFF', emissiveIntensity: 0.3 });
}

/** Scroll the shared water textures (called once per frame by the furniture system). */
export function animateWater(time) {
  const w = texCache.get('water|furniture');
  if (w) {
    w.offset.x = (time * 0.05) % 1;
    w.offset.y = (time * 0.03) % 1;
  }
  const s = texCache.get('stream|furniture');
  if (s) s.offset.y = (time * 1.6) % 1;
}

// ---------- paintings ----------

export const PAINTINGS = ['rainbow', 'flowers', 'kitty', 'sunset', 'heart', 'unicorn', 'castle', 'sea'];

/** A cute procedural painting (for picture frames), 32x32. */
export function paintingMat(index) {
  const kind = PAINTINGS[((index % PAINTINGS.length) + PAINTINGS.length) % PAINTINGS.length];
  const key = `painting|${kind}`;
  return material(key, {
    map: paintTexture(key, 32, 32, (ctx, w, h, rand) => drawPainting(ctx, kind, rand), { repeat: false }),
    uvFit: true,
  });
}

function drawPainting(ctx, kind, rand) {
  const sky = ctx.createLinearGradient(0, 0, 0, 32);
  const hills = (col, col2) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(8, 34, 18, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col2;
    ctx.beginPath();
    ctx.ellipse(28, 36, 16, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (kind) {
    case 'rainbow': {
      sky.addColorStop(0, '#9ED8FF');
      sky.addColorStop(1, '#E3F5FF');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 32, 32);
      const bands = ['#FF8FA3', '#FFB870', '#FFE070', '#9BE38A', '#7CC8FF', '#B79BFF'];
      bands.forEach((c, i) => {
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(16, 28, 15 - i * 2, Math.PI, 0);
        ctx.stroke();
      });
      sprite(ctx, CLOUD, 1, 22, { X: '#FFFFFF' }, 1);
      sprite(ctx, CLOUD, 23, 22, { X: '#FFFFFF' }, 1);
      hills('#8FDB7E', '#A8E68F');
      break;
    }
    case 'flowers': {
      ctx.fillStyle = '#FFF1D6';
      ctx.fillRect(0, 0, 32, 32);
      px(ctx, 12, 22, 8, 8, '#8FB8FF');
      px(ctx, 11, 21, 10, 2, '#A9C9FF');
      for (const [x, y, c] of [[9, 8, '#FF8FB8'], [16, 5, '#FFD95A'], [22, 9, '#C8A6FF'], [13, 12, '#FF9E8F'], [19, 13, '#9FE0FF']]) {
        px(ctx, x + 2, y + 4, 1, 22 - (y + 4), '#6CC468');
        sprite(ctx, FLOWER, x, y, { X: c, O: '#FFF4B8' }, 1);
      }
      break;
    }
    case 'kitty': {
      ctx.fillStyle = '#FFD6E8';
      ctx.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 6; i++) sprite(ctx, ['X.X', '.X.', 'X.X'], Math.floor(rand() * 28), Math.floor(rand() * 10), { X: '#FFFFFF' });
      const fur = '#FFB870';
      px(ctx, 8, 12, 16, 13, fur);
      px(ctx, 8, 9, 4, 4, fur);
      px(ctx, 20, 9, 4, 4, fur);
      px(ctx, 9, 10, 2, 2, '#FF9EB8');
      px(ctx, 21, 10, 2, 2, '#FF9EB8');
      px(ctx, 11, 16, 3, 3, '#3A1F4D');
      px(ctx, 18, 16, 3, 3, '#3A1F4D');
      px(ctx, 12, 16, 1, 1, '#FFFFFF');
      px(ctx, 19, 16, 1, 1, '#FFFFFF');
      px(ctx, 15, 19, 2, 1, '#FF7FA4');
      px(ctx, 14, 20, 1, 1, '#3A1F4D');
      px(ctx, 17, 20, 1, 1, '#3A1F4D');
      px(ctx, 9, 19, 2, 1, '#FF9EB8');
      px(ctx, 21, 19, 2, 1, '#FF9EB8');
      px(ctx, 6, 25, 20, 7, '#C8A6FF');
      break;
    }
    case 'sunset': {
      sky.addColorStop(0, '#B79BFF');
      sky.addColorStop(0.6, '#FFB3C6');
      sky.addColorStop(1, '#FFE0A8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#FFF0A0';
      ctx.beginPath();
      ctx.arc(16, 20, 7, 0, Math.PI * 2);
      ctx.fill();
      px(ctx, 0, 22, 32, 10, '#7FC8F0');
      for (let i = 0; i < 5; i++) px(ctx, 10 + (i % 2) * 3, 23 + i * 2, 12 - i * 2, 1, '#FFF0A0');
      px(ctx, 3, 5, 2, 1, '#FFFFFF');
      px(ctx, 24, 8, 3, 1, '#FFFFFF');
      break;
    }
    case 'heart': {
      ctx.fillStyle = '#E6DDFF';
      ctx.fillRect(0, 0, 32, 32);
      for (let y = 0; y < 32; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 32; x += 4) px(ctx, x, y, 1, 1, '#FFFFFF');
      sprite(ctx, HEART, 5, 6, { X: '#FF6FA8' }, 3);
      px(ctx, 9, 9, 3, 3, '#FFB8D6');
      break;
    }
    case 'unicorn': {
      sky.addColorStop(0, '#FFE3F0');
      sky.addColorStop(1, '#D9EEFF');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 32, 32);
      px(ctx, 9, 13, 14, 9, '#FFFFFF');
      px(ctx, 18, 7, 7, 8, '#FFFFFF');
      px(ctx, 22, 3, 2, 5, '#FFD95A');
      px(ctx, 10, 22, 2, 5, '#FFFFFF');
      px(ctx, 19, 22, 2, 5, '#FFFFFF');
      px(ctx, 15, 7, 3, 3, '#FF8FB8');
      px(ctx, 13, 9, 3, 4, '#B79BFF');
      px(ctx, 7, 13, 3, 6, '#7CC8FF');
      px(ctx, 22, 10, 1, 1, '#3A1F4D');
      px(ctx, 0, 27, 32, 5, '#9BE38A');
      break;
    }
    case 'castle': {
      sky.addColorStop(0, '#9ED8FF');
      sky.addColorStop(1, '#FFE3F0');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 32, 32);
      px(ctx, 7, 14, 18, 14, '#FFC4DD');
      px(ctx, 5, 9, 6, 19, '#FFB0D0');
      px(ctx, 21, 9, 6, 19, '#FFB0D0');
      for (const x of [5, 21]) {
        px(ctx, x, 5, 6, 4, '#B79BFF');
        px(ctx, x + 2, 3, 2, 2, '#B79BFF');
      }
      px(ctx, 14, 20, 4, 8, '#C8A6FF');
      px(ctx, 8, 16, 2, 3, '#FFFFFF');
      px(ctx, 22, 13, 2, 3, '#FFFFFF');
      px(ctx, 0, 28, 32, 4, '#9BE38A');
      px(ctx, 15, 8, 1, 6, '#3A1F4D');
      px(ctx, 16, 8, 3, 2, '#FF6FA8');
      break;
    }
    default: { // sea
      sky.addColorStop(0, '#BDEBFF');
      sky.addColorStop(1, '#7FD3F7');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 32, 32);
      px(ctx, 0, 14, 32, 18, '#5CBDEB');
      for (let i = 0; i < 6; i++) px(ctx, Math.floor(rand() * 28), 15 + Math.floor(rand() * 14), 4, 1, '#9FE0FF');
      px(ctx, 6, 20, 8, 5, '#FF9EB8');
      px(ctx, 2, 21, 4, 3, '#FF9EB8');
      px(ctx, 11, 21, 1, 1, '#3A1F4D');
      px(ctx, 20, 24, 6, 4, '#FFD95A');
      px(ctx, 17, 25, 3, 2, '#FFD95A');
      px(ctx, 24, 25, 1, 1, '#3A1F4D');
      for (const [x, y] of [[9, 12], [11, 8], [23, 18]]) px(ctx, x, y, 2, 2, '#FFFFFF');
      break;
    }
  }
}

/** Clock face: a round pastel dial with dots and hearts at 12/3/6/9 (transparent corners). */
export function clockFaceMat(color) {
  const key = `clockface|${color}`;
  return material(key, {
    map: paintTexture(key, 32, 32, (ctx) => {
      ctx.clearRect(0, 0, 32, 32);
      ctx.fillStyle = shade(color, 0.5);
      ctx.beginPath();
      ctx.arc(16, 16, 15.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFDF6';
      ctx.beginPath();
      ctx.arc(16, 16, 13.5, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = Math.round(16 + Math.sin(a) * 11), y = Math.round(16 - Math.cos(a) * 11);
        if (i % 3 === 0) sprite(ctx, ['X.X', 'XXX', '.X.'], x - 1, y - 1, { X: shade(color, -0.25) });
        else px(ctx, x, y, 1, 1, shade(color, -0.35));
      }
    }, { repeat: false }),
    uvFit: true,
    alphaTest: 0.5,
  });
}

/** Dark TV glass when the TV is off. */
export function screenOffMat() {
  const key = 'screen|off';
  return material(key, {
    map: paintTexture(key, 32, 20, (ctx) => {
      px(ctx, 0, 0, 32, 20, '#3B3358');
      px(ctx, 3, 2, 6, 1, '#5E5484');
      px(ctx, 3, 3, 3, 1, '#5E5484');
    }, { repeat: false }),
    uvFit: true,
  });
}
