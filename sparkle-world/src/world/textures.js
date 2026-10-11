// Block textures: every registered tile painter is painted once (deterministically, seeded by
// its key) into a 16x16 layer of one DataArrayTexture. Also draws block icons for the UI.

import * as THREE from 'three';
import { mulberry32, hashString, hexToRgb } from '../core/util.js';

const TILE = 16;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function paintMissing(ctx) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      ctx.fillStyle = ((x >> 2) + (y >> 2)) & 1 ? '#FF7FD0' : '#FFE0F4';
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** Multiply a canvas by a tint color, keeping its alpha. */
function applyTint(ctx, tint) {
  const img = ctx.getImageData(0, 0, TILE, TILE);
  const [tr, tg, tb] = Array.isArray(tint) ? tint.map((v) => (v <= 1 ? v * 255 : v)) : hexToRgb(tint);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (d[i] * tr) / 255;
    d[i + 1] = (d[i + 1] * tg) / 255;
    d[i + 2] = (d[i + 2] * tb) / 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Paint one tile into a cached 16x16 canvas. The painter gets a fresh context and a
 * RNG seeded from the tile key, so textures are identical on every run.
 */
export function paintTileCanvas(registry, tileKey, tint = null) {
  if (!registry._tileCanvases) registry._tileCanvases = new Map();
  const cacheKey = tint ? `${tileKey}@${String(tint)}` : tileKey;
  let canvas = registry._tileCanvases.get(cacheKey);
  if (canvas) return canvas;
  canvas = makeCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const painter = registry.painters.get(tileKey);
  if (painter) {
    try {
      painter(ctx, mulberry32(hashString(tileKey)));
    } catch (err) {
      console.error(`[textures] painter "${tileKey}" failed`, err);
      paintMissing(ctx);
    }
  } else {
    if (tileKey) console.warn(`[textures] no painter for tile "${tileKey}"`);
    paintMissing(ctx);
  }
  if (tint) applyTint(ctx, tint);
  registry._tileCanvases.set(cacheKey, canvas);
  return canvas;
}

/**
 * Copy a tile canvas into layer `layer` of the array data. Rows are flipped (array textures
 * cannot flipY) and fully transparent pixels get the tile's average color so mipmaps and
 * cutout edges do not grow dark fringes.
 */
function copyTile(canvas, data, layer) {
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, TILE, TILE).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] > 127) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
  }
  if (n) { r /= n; g /= n; b /= n; }
  const base = layer * TILE * TILE * 4;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const si = (y * TILE + x) * 4;
      const di = base + ((TILE - 1 - y) * TILE + x) * 4;
      const a = src[si + 3];
      if (a === 0) {
        data[di] = r; data[di + 1] = g; data[di + 2] = b; data[di + 3] = 0;
      } else {
        data[di] = src[si]; data[di + 1] = src[si + 1]; data[di + 2] = src[si + 2]; data[di + 3] = a;
      }
    }
  }
}

/**
 * Build the block DataArrayTexture from every tile used by a registered block (plus all
 * registered painters), then finalize the block registry's lookup tables.
 */
export function buildBlockTexture(registry) {
  const layers = new Map(); // cacheKey -> layer
  const order = [null]; // layer 0 = missing texture
  const want = (tileKey, tint) => {
    const k = tint ? `${tileKey}@${String(tint)}` : tileKey;
    if (!layers.has(k)) {
      layers.set(k, order.length);
      order.push([tileKey, tint || null]);
    }
    return layers.get(k);
  };
  for (const key of registry.painters.keys()) want(key, null);
  for (const def of registry.defs) {
    if (!def.tiles || def.shape === 'air') continue;
    for (let f = 0; f < 6; f++) {
      const t = registry.faceTile(def, f);
      if (t) want(t, def.tint);
    }
  }

  const depth = order.length;
  const data = new Uint8Array(depth * TILE * TILE * 4);
  const missing = makeCanvas(TILE, TILE);
  paintMissing(missing.getContext('2d'));
  copyTile(missing, data, 0);
  for (let i = 1; i < depth; i++) {
    const [tileKey, tint] = order[i];
    copyTile(paintTileCanvas(registry, tileKey, tint), data, i);
  }

  const texture = new THREE.DataArrayTexture(data, TILE, TILE, depth);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  const layerOf = (tileKey, tint) => {
    if (!tileKey) return 0;
    const k = tint ? `${tileKey}@${String(tint)}` : tileKey;
    return layers.get(k) ?? 0;
  };
  const animated = (tileKey) => !!registry.tileOptions.get(tileKey)?.animated;
  registry.finalize(layerOf, animated);
  return { texture, layerOf, depth };
}

// ---------- UI icons ----------

const ICON = 96;

function shadedFace(tileCanvas, darken, heightFrac) {
  const c = makeCanvas(TILE, TILE);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const h = Math.max(1, Math.round(TILE * heightFrac));
  // side faces show the bottom part of the tile when the block is shorter than a cube
  ctx.drawImage(tileCanvas, 0, TILE - h, TILE, h, 0, 0, TILE, h);
  if (darken > 0) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(40,20,60,${darken})`;
    ctx.fillRect(0, 0, TILE, TILE);
  }
  return { canvas: c, rows: h };
}

/** Draw a small isometric cube (or flat sprite) for a block and return a PNG data URL. */
export function drawBlockIcon(registry, def) {
  const canvas = makeCanvas(ICON, ICON);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tile = (face) => paintTileCanvas(registry, registry.faceTile(def, face), def.tint);

  if (def.shape === 'cross') {
    ctx.drawImage(tile(0), ICON * 0.1, ICON * 0.1, ICON * 0.8, ICON * 0.8);
    return canvas.toDataURL('image/png');
  }

  const h = def.shape === 'slab' ? 0.5 : def.shape === 'carpet' ? 0.15 : def.shape === 'liquid' ? 0.9 : 1;
  const S = ICON;
  const ax = (0.44 * S) / TILE; // tile x-axis step
  const ay = (0.22 * S) / TILE;
  const side = 0.44 * S; // full cube side height
  const drop = side * (1 - h);
  const left = 0.06 * S, midY = 0.28 * S + drop, cx = 0.5 * S;
  const topY = 0.06 * S + drop;
  if (def.translucent) ctx.globalAlpha = 0.85;

  // top face
  ctx.setTransform(ax, -ay, ax, ay, left, midY);
  ctx.drawImage(tile(2), 0, 0);
  // left face (+Z side of the cube in world terms)
  const lf = shadedFace(tile(4), 0.14, h);
  ctx.setTransform(ax, ay, 0, (side * h) / lf.rows, left, midY);
  ctx.drawImage(lf.canvas, 0, 0, TILE, lf.rows, 0, 0, TILE, lf.rows);
  // right face
  const rf = shadedFace(tile(0), 0.3, h);
  ctx.setTransform(ax, -ay, 0, (side * h) / rf.rows, cx, topY + 0.44 * S);
  ctx.drawImage(rf.canvas, 0, 0, TILE, rf.rows, 0, 0, TILE, rf.rows);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas.toDataURL('image/png');
}
