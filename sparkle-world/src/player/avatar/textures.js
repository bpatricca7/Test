// Canvas textures for the avatar, painted procedurally and shared through a small
// ref-counted cache (key -> texture). acquire() paints on first use; release() lets an
// unused texture be evicted later (least recently used first), so rebuilding looks is fast
// and never leaks GPU memory. Painters are also exported for the Studio's 2D previews.

import * as THREE from 'three';
import { mulberry32, hashString, shade, mixHex, rgba, hexToRgb } from '../../core/util.js';
import { RAINBOW } from '../wardrobe-data.js';

const MAX_IDLE = 48;
const cache = new Map(); // key -> { tex, refs, used }
let clock = 0;

function makeTexture(canvas, { repeat = false, pixel = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (pixel) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
  } else {
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  t.anisotropy = 4;
  t.userData.shared = true; // disposeObject() must leave cached textures alone
  return t;
}

/** Get (painting on first use) a cached texture and take a reference. */
export function acquire(key, w, h, paint, opts) {
  let e = cache.get(key);
  if (!e) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d'), w, h);
    e = { tex: makeTexture(c, opts), refs: 0, used: 0 };
    cache.set(key, e);
  }
  e.refs++;
  e.used = ++clock;
  return e.tex;
}

export function release(key) {
  const e = cache.get(key);
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs === 0) evict();
}

function evict() {
  let idle = 0;
  for (const e of cache.values()) if (e.refs === 0) idle++;
  if (idle <= MAX_IDLE) return;
  const list = [...cache.entries()].filter(([, e]) => e.refs === 0).sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < idle - MAX_IDLE; i++) {
    const [key, e] = list[i];
    e.tex.dispose();
    cache.delete(key);
  }
}

export function cacheStats() {
  let refs = 0;
  for (const e of cache.values()) refs += e.refs;
  return { textures: cache.size, refs };
}

// ---------- shapes ----------

export function heartPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s * 0.1, y + s * 0.22, x - s * 0.5, y + s * 0.02, x - s * 0.5, y - s * 0.2);
  g.bezierCurveTo(x - s * 0.5, y - s * 0.46, x - s * 0.12, y - s * 0.52, x, y - s * 0.24);
  g.bezierCurveTo(x + s * 0.12, y - s * 0.52, x + s * 0.5, y - s * 0.46, x + s * 0.5, y - s * 0.2);
  g.bezierCurveTo(x + s * 0.5, y + s * 0.02, x + s * 0.1, y + s * 0.22, x, y + s * 0.35);
  g.closePath();
}

export function starPath(g, x, y, R, r = R * 0.45, points = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

function rrect(g, x, y, w, h, r) {
  const [a, b, c, d] = Array.isArray(r) ? r : [r, r, r, r];
  g.beginPath();
  g.moveTo(x + a, y);
  g.lineTo(x + w - b, y);
  g.quadraticCurveTo(x + w, y, x + w, y + b);
  g.lineTo(x + w, y + h - c);
  g.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  g.lineTo(x + d, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - d);
  g.lineTo(x, y + a);
  g.quadraticCurveTo(x, y, x + a, y);
  g.closePath();
}

function sparkle4(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x + s * 0.18, y - s * 0.18, x + s, y);
  g.quadraticCurveTo(x + s * 0.18, y + s * 0.18, x, y + s);
  g.quadraticCurveTo(x - s * 0.18, y + s * 0.18, x - s, y);
  g.quadraticCurveTo(x - s * 0.18, y - s * 0.18, x, y - s);
  g.fill();
}

function flower(g, x, y, r, petal, center) {
  g.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.46, r * 0.36, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = center;
  g.beginPath();
  g.arc(x, y, r * 0.3, 0, Math.PI * 2);
  g.fill();
}

/** A chunky lightning bolt centred on (x, y), s tall. */
export function boltPath(g, x, y, s) {
  const pts = [[0.12, -0.5], [-0.26, 0.06], [-0.02, 0.06], [-0.14, 0.5], [0.26, -0.08], [0.02, -0.08], [0.16, -0.5]];
  g.beginPath();
  pts.forEach(([px, py], i) => (i ? g.lineTo(x + px * s, y + py * s) : g.moveTo(x + px * s, y + py * s)));
  g.closePath();
}

/** A friendly little dino silhouette (long neck, round back, tail), facing right, s wide. */
function dinoShape(g, x, y, s) {
  g.beginPath();
  g.ellipse(x - s * 0.05, y + s * 0.05, s * 0.3, s * 0.2, 0, 0, Math.PI * 2); // body
  g.fill();
  g.beginPath(); // tail
  g.moveTo(x - s * 0.3, y);
  g.quadraticCurveTo(x - s * 0.5, y + s * 0.05, x - s * 0.55, y - s * 0.12);
  g.quadraticCurveTo(x - s * 0.42, y + s * 0.18, x - s * 0.2, y + s * 0.18);
  g.closePath();
  g.fill();
  g.fillRect(x + s * 0.12, y - s * 0.32, s * 0.12, s * 0.38); // neck
  g.beginPath(); // head
  g.ellipse(x + s * 0.24, y - s * 0.32, s * 0.14, s * 0.09, 0, 0, Math.PI * 2);
  g.fill();
  for (const lx of [-0.2, 0.08]) g.fillRect(x + lx * s, y + s * 0.15, s * 0.09, s * 0.16); // legs
}

/** A small rocket pointing up, with a sparkle puff below (no flames). */
function rocketShape(g, x, y, s) {
  g.beginPath(); // body with a pointed nose
  g.moveTo(x, y - s * 0.5);
  g.quadraticCurveTo(x + s * 0.2, y - s * 0.25, x + s * 0.14, y + s * 0.22);
  g.lineTo(x - s * 0.14, y + s * 0.22);
  g.quadraticCurveTo(x - s * 0.2, y - s * 0.25, x, y - s * 0.5);
  g.fill();
  for (const side of [-1, 1]) { // fins
    g.beginPath();
    g.moveTo(x + side * s * 0.13, y);
    g.lineTo(x + side * s * 0.28, y + s * 0.3);
    g.lineTo(x + side * s * 0.1, y + s * 0.22);
    g.closePath();
    g.fill();
  }
  sparkle4(g, x, y + s * 0.42, s * 0.12);
}

// ---------- cloth ----------

/**
 * Fabric tile (repeats seamlessly). fabric: cotton | denim | knit | sparkle | satin | tulle.
 * Patterns are drawn in patternColor; 'rainbow' paints soft rainbow bands.
 */
export function paintCloth(g, W, H, { color, pattern = 'none', patternColor = '#FFFFFF', fabric = 'cotton' }) {
  const rand = mulberry32(hashString(color + fabric));
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  if (pattern === 'rainbow') {
    const n = RAINBOW.length;
    for (let i = 0; i < n; i++) {
      g.fillStyle = mixHex(RAINBOW[i], color, 0.18);
      g.fillRect(0, Math.floor((i * H) / n), W, Math.ceil(H / n) + 1);
    }
  }
  // fabric texture
  if (fabric === 'denim') {
    for (let y = -W; y < H + W; y += 4) {
      g.strokeStyle = rgba(shade(color, 0.22), 0.35);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y + W);
      g.stroke();
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rgba(rand() < 0.5 ? shade(color, 0.3) : shade(color, -0.2), 0.3);
      g.fillRect(rand() * W, rand() * H, 2, 1);
    }
  } else if (fabric === 'knit') {
    for (let x = 0; x < W; x += 8) {
      g.fillStyle = rgba(shade(color, -0.12), 0.35);
      g.fillRect(x, 0, 2, H);
      g.fillStyle = rgba(shade(color, 0.18), 0.3);
      g.fillRect(x + 4, 0, 2, H);
    }
    for (let y = 0; y < H; y += 6) {
      g.fillStyle = rgba(shade(color, -0.1), 0.18);
      g.fillRect(0, y, W, 1);
    }
  } else if (fabric === 'satin') {
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, rgba('#FFFFFF', 0));
    grd.addColorStop(0.35, rgba('#FFFFFF', 0.16));
    grd.addColorStop(0.5, rgba('#FFFFFF', 0.28));
    grd.addColorStop(0.65, rgba('#FFFFFF', 0.12));
    grd.addColorStop(1, rgba('#FFFFFF', 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  } else if (fabric === 'tulle') {
    for (let y = 2; y < H; y += 6) {
      for (let x = (y / 6) % 2 ? 1 : 4; x < W; x += 6) {
        g.fillStyle = rgba(shade(color, 0.35), 0.55);
        g.fillRect(x, y, 2, 2);
      }
    }
  } else {
    for (let i = 0; i < 380; i++) {
      g.fillStyle = rgba(rand() < 0.5 ? shade(color, 0.12) : shade(color, -0.08), 0.35);
      g.fillRect(Math.floor(rand() * W), Math.floor(rand() * H), 1, 1);
    }
  }
  // pattern motifs (kept inside the tile so it repeats cleanly)
  const pc = patternColor;
  const q = W / 4;
  if (pattern === 'hearts') {
    g.fillStyle = pc;
    for (const [x, y] of [[q, q], [3 * q, 3 * q]]) {
      heartPath(g, x, y, W * 0.26);
      g.fill();
    }
    g.fillStyle = rgba(pc, 0.55);
    for (const [x, y] of [[3 * q, q], [q, 3 * q]]) {
      heartPath(g, x, y, W * 0.12);
      g.fill();
    }
  } else if (pattern === 'stars') {
    g.fillStyle = pc;
    for (const [x, y] of [[q, q], [3 * q, 3 * q]]) {
      starPath(g, x, y + 2, W * 0.14);
      g.fill();
    }
    for (const [x, y] of [[3 * q, q], [q, 3 * q]]) sparkle4(g, x, y, W * 0.06);
  } else if (pattern === 'stripes') {
    g.fillStyle = pc;
    g.fillRect(0, H * 0.12, W, H * 0.16);
    g.fillRect(0, H * 0.62, W, H * 0.16);
    g.fillStyle = rgba(pc, 0.45);
    g.fillRect(0, H * 0.4, W, H * 0.04);
    g.fillRect(0, H * 0.9, W, H * 0.04);
  } else if (pattern === 'dots') {
    g.fillStyle = pc;
    for (const [x, y] of [[q, q], [3 * q, q], [2 * q, 2 * q + 2], [0, 2 * q + 2], [W, 2 * q + 2], [q, 3 * q + 4], [3 * q, 3 * q + 4]]) {
      g.beginPath();
      g.arc(x, y, W * 0.07, 0, Math.PI * 2);
      g.fill();
    }
  } else if (pattern === 'flowers') {
    flower(g, q, q, W * 0.16, pc, '#FFD43B');
    flower(g, 3 * q, 3 * q, W * 0.16, pc, '#FFD43B');
    g.fillStyle = '#7BD389';
    for (const [x, y, a] of [[3 * q, q, 0.6], [q, 3 * q, -0.6]]) {
      g.beginPath();
      g.ellipse(x, y, W * 0.07, W * 0.035, a, 0, Math.PI * 2);
      g.fill();
    }
  } else if (pattern === 'rainbow') {
    g.fillStyle = rgba(pc, 0.9);
    for (const [x, y] of [[q, q * 0.9], [3 * q, 2.9 * q]]) sparkle4(g, x, y, W * 0.06);
  } else if (pattern === 'plaid') {
    // two wide soft bands each way, a thin line through each (reads as flannel)
    const band = Math.round(W * 0.14);
    g.fillStyle = rgba(pc, 0.45);
    for (const p of [q - band / 2, 3 * q - band / 2]) {
      g.fillRect(0, p, W, band);
      g.fillRect(p, 0, band, H);
    }
    g.fillStyle = rgba(pc, 0.7);
    for (const p of [q - 1, 3 * q - 1]) {
      g.fillRect(0, p, W, 2);
      g.fillRect(p, 0, 2, H);
    }
  } else if (pattern === 'checks') {
    g.fillStyle = rgba(pc, 0.85);
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) if ((cx + cy) % 2) g.fillRect(cx * q, cy * q, q, q);
  } else if (pattern === 'bolts') {
    g.fillStyle = pc;
    for (const [x, y] of [[q, q], [3 * q, 3 * q]]) {
      boltPath(g, x, y, W * 0.32);
      g.fill();
    }
    g.fillStyle = rgba(pc, 0.55);
    for (const [x, y] of [[3 * q, q], [q, 3 * q]]) sparkle4(g, x, y, W * 0.05);
  } else if (pattern === 'dinos') {
    g.fillStyle = pc;
    dinoShape(g, q + 2, q + 2, W * 0.36);
    dinoShape(g, 3 * q + 2, 3 * q + 2, W * 0.36);
    g.fillStyle = rgba(pc, 0.5);
    for (const [x, y] of [[3 * q, q], [q, 3 * q]]) {
      g.beginPath();
      g.arc(x, y, W * 0.04, 0, Math.PI * 2);
      g.fill();
    }
  } else if (pattern === 'rockets') {
    for (const [x, y] of [[q, q], [3 * q, 3 * q]]) {
      g.fillStyle = pc;
      rocketShape(g, x, y, W * 0.36);
      g.fillStyle = color; // a round window
      g.beginPath();
      g.arc(x, y - W * 0.06, W * 0.035, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = rgba(pc, 0.7);
    for (const [x, y] of [[3 * q, q], [q, 3 * q]]) sparkle4(g, x, y, W * 0.06);
  }
  if (fabric === 'sparkle') {
    for (let i = 0; i < 150; i++) {
      const x = rand() * W, y = rand() * H;
      g.fillStyle = rgba(rand() < 0.5 ? '#FFFFFF' : shade(color, 0.5), 0.45 + rand() * 0.5);
      g.fillRect(x, y, 2, 2);
    }
    g.fillStyle = '#FFFFFF';
    for (let i = 0; i < 6; i++) sparkle4(g, 10 + rand() * (W - 20), 10 + rand() * (H - 20), 3 + rand() * 4);
  }
}

export function clothKey(o) {
  return `cloth|${o.color}|${o.pattern || 'none'}|${o.patternColor || ''}|${o.fabric || 'cotton'}`;
}

export function acquireCloth(o) {
  const key = clothKey(o);
  return { key, tex: acquire(key, 128, 128, (g, w, h) => paintCloth(g, w, h, o), { repeat: true }) };
}

// ---------- hair ----------

let strandTex = null;
/** Grey strand texture multiplied with the hair's vertex colors (with an "angel ring" shine). */
export function hairStrands() {
  if (strandTex) return strandTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  const rand = mulberry32(7);
  for (let x = 0; x < 64; x++) {
    const v = 0.86 + rand() * 0.14;
    const k = Math.round(v * 255);
    g.fillStyle = `rgb(${k},${k},${k})`;
    g.fillRect(x, 0, 1, 128);
  }
  for (let i = 0; i < 18; i++) {
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(Math.floor(rand() * 64), 0, 1, 128);
  }
  // shine band (v ~ 0.55..0.66 of the tile) with a soft wobble
  for (let x = 0; x < 64; x++) {
    const y0 = 70 + Math.sin(x * 0.3) * 2;
    const grd = g.createLinearGradient(0, y0 - 6, 0, y0 + 8);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x, y0 - 6, 1, 14);
  }
  strandTex = makeTexture(c, { repeat: true });
  return strandTex;
}

// ---------- face ----------

export const EYE_VARIANTS = ['open', 'left', 'right', 'blink', 'happy', 'sleep'];
export const MOUTH_VARIANTS = ['happy', 'grin', 'cat', 'open', 'o', 'sleep'];

/**
 * Big sparkly anime eyes (with brows, blush and freckles) on a transparent 256x128 canvas
 * that covers the upper face. o: { eyeColor, lashes, blush, freckles, skin, brow, variant }
 */
export function paintEyes(g, W, H, o) {
  g.clearRect(0, 0, W, H);
  const sx = W / 256, sy = H / 128;
  g.save();
  g.scale(sx, sy);
  const ink = '#3B2230';
  // cheeks
  if (o.blush) {
    for (const x of [44, 212]) {
      const grd = g.createRadialGradient(x, 104, 2, x, 104, 30);
      grd.addColorStop(0, 'rgba(255,105,150,0.55)');
      grd.addColorStop(1, 'rgba(255,105,150,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x, 104, 32, 15, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (o.freckles) {
    g.fillStyle = rgba(shade(o.skin, -0.35), 0.8);
    for (const [x, y] of [[30, 96], [40, 102], [50, 95], [36, 108], [226, 96], [216, 102], [206, 95], [220, 108], [120, 110], [136, 110]]) {
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const v = o.variant;
  for (const side of [-1, 1]) {
    const cx = 128 + side * 60, cy = 58;
    const outer = side; // outer corner direction
    // brows
    g.strokeStyle = o.brow;
    g.lineCap = 'round';
    g.beginPath();
    const by = v === 'happy' ? 12 : 15;
    if (o.brows === 'bold') {
      // thicker and flatter, the outer end a little lower
      g.lineWidth = 8.5;
      g.moveTo(cx - outer * 17, by + 3);
      g.quadraticCurveTo(cx + outer * 2, by - 2, cx + outer * 19, by + 6);
    } else {
      g.lineWidth = 5;
      g.moveTo(cx - outer * 17, by + 3);
      g.quadraticCurveTo(cx + outer * 2, by - 4, cx + outer * 19, by + 4);
    }
    g.stroke();
    if (v === 'blink' || v === 'sleep') {
      g.strokeStyle = ink;
      g.lineWidth = 6;
      g.beginPath();
      const yy = v === 'sleep' ? 66 : 62;
      g.moveTo(cx - 25, yy - 2);
      g.quadraticCurveTo(cx, yy + 14, cx + 25, yy - 2);
      g.stroke();
      if (o.lashes) {
        g.lineWidth = 3.5;
        for (const k of [0, 1]) {
          const bx = cx + outer * (20 - k * 9);
          g.beginPath();
          g.moveTo(bx, yy + 3 - k * 3);
          g.lineTo(bx + outer * 7, yy + 10 - k * 2);
          g.stroke();
        }
      }
      continue;
    }
    if (v === 'happy') {
      g.strokeStyle = ink;
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(cx - 23, 70);
      g.quadraticCurveTo(cx, 36, cx + 23, 70);
      g.stroke();
      if (o.lashes) {
        g.lineWidth = 3.5;
        g.beginPath();
        g.moveTo(cx + outer * 20, 58);
        g.lineTo(cx + outer * 29, 52);
        g.stroke();
      }
      continue;
    }
    const look = v === 'left' ? -9 : v === 'right' ? 9 : 0;
    // white
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, 28, 35, 0, 0, Math.PI * 2);
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.clip();
    // iris with a deep top and glowing bottom
    const ix = cx + look, iy = cy - 1;
    const grd = g.createLinearGradient(0, iy - 32, 0, iy + 32);
    grd.addColorStop(0, shade(o.eyeColor, -0.6));
    grd.addColorStop(0.42, shade(o.eyeColor, -0.1));
    grd.addColorStop(0.78, o.eyeColor);
    grd.addColorStop(1, shade(o.eyeColor, 0.45));
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(ix, iy, 23, 31, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = shade(o.eyeColor, -0.55);
    g.lineWidth = 2.5;
    g.stroke();
    // pupil
    g.fillStyle = shade(o.eyeColor, -0.75);
    g.beginPath();
    g.ellipse(ix, iy + 2, 11, 16, 0, 0, Math.PI * 2);
    g.fill();
    // glow arc at the bottom of the iris
    g.strokeStyle = rgba(shade(o.eyeColor, 0.7), 0.85);
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(ix, iy + 4, 16, 20, 0, Math.PI * 0.2, Math.PI * 0.8);
    g.stroke();
    // highlights
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.ellipse(ix + 9, iy - 13, 8.5, 11, -0.35, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(ix - 9, iy + 13, 4.2, 0, Math.PI * 2);
    g.fill();
    sparkle4(g, ix + 8, iy + 15, 5);
    g.restore();
    // lash line along the top
    g.strokeStyle = ink;
    g.lineCap = 'round';
    g.lineWidth = o.lashes ? 7 : 4.5;
    g.beginPath();
    g.ellipse(cx, cy + 1, 29, 36, 0, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    if (o.lashes) {
      g.lineWidth = 4;
      for (let k = 0; k < 3; k++) {
        const a = side > 0 ? Math.PI * (1.9 - k * 0.07) : Math.PI * (1.1 + k * 0.07);
        const px = cx + Math.cos(a) * 29, py = cy + 1 + Math.sin(a) * 36;
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + outer * 7, py - 2 - k, px + outer * (11 - k * 2), py - 8 + k * 2);
        g.stroke();
      }
      // lower lash tick
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(cx, cy, 28, 35, 0, side > 0 ? Math.PI * 0.06 : Math.PI * 0.8, side > 0 ? Math.PI * 0.2 : Math.PI * 0.94);
      g.stroke();
    }
  }
  g.restore();
}

/** A mouth color that reads on this skin (darker line on deeper skin tones). */
export function mouthInk(skin) {
  const [r, gg, b] = hexToRgb(skin);
  const luma = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
  return luma < 0.3 ? '#1E0710' : luma < 0.5 ? '#4A1226' : '#8E2F4A';
}

/** Mouth on a transparent 64x32 canvas. */
export function paintMouth(g, W, H, variant, ink = '#8E2F4A') {
  g.clearRect(0, 0, W, H);
  g.save();
  g.scale(W / 64, H / 32);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (variant === 'happy') {
    g.lineWidth = 4.5;
    g.beginPath();
    g.moveTo(19, 10);
    g.quadraticCurveTo(32, 26, 45, 10);
    g.stroke();
  } else if (variant === 'grin') {
    g.beginPath();
    g.moveTo(13, 8);
    g.lineTo(51, 8);
    g.quadraticCurveTo(50, 30, 32, 30);
    g.quadraticCurveTo(14, 30, 13, 8);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.fillRect(16, 9, 32, 5);
    g.fillStyle = '#FF7FA4';
    g.beginPath();
    g.ellipse(32, 25, 10, 5, 0, 0, Math.PI * 2);
    g.fill();
  } else if (variant === 'cat') {
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(15, 10);
    g.quadraticCurveTo(22, 22, 32, 12);
    g.quadraticCurveTo(42, 22, 49, 10);
    g.stroke();
  } else if (variant === 'open') {
    g.beginPath();
    g.ellipse(32, 15, 12, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#FF7FA4';
    g.beginPath();
    g.ellipse(32, 21, 8, 4.5, 0, 0, Math.PI * 2);
    g.fill();
  } else if (variant === 'o') {
    g.beginPath();
    g.ellipse(32, 15, 6, 7.5, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(26, 13);
    g.quadraticCurveTo(32, 18, 38, 13);
    g.stroke();
  }
  g.restore();
}

// ---------- glasses ----------

/** Glasses on a transparent canvas aligned with the eyes (same layout as paintEyes). */
export function paintGlasses(g, W, H, type, color) {
  g.clearRect(0, 0, W, H);
  g.save();
  g.scale(W / 256, H / 128);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const frame = color;
  for (const side of [-1, 1]) {
    const cx = 128 + side * 60, cy = 58;
    if (type === 'glasses') {
      g.fillStyle = 'rgba(210,235,255,0.22)';
      g.beginPath();
      g.ellipse(cx, cy, 40, 38, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.ellipse(cx + 14, cy - 16, 7, 12, -0.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = frame;
      g.lineWidth = 8;
      g.beginPath();
      g.ellipse(cx, cy, 40, 38, 0, 0, Math.PI * 2);
      g.stroke();
    } else if (type === 'sunglasses') {
      const grd = g.createLinearGradient(0, cy - 34, 0, cy + 34);
      grd.addColorStop(0, '#2C2340');
      grd.addColorStop(1, '#6B5A9A');
      g.fillStyle = grd;
      rrect(g, cx - 42, cy - 30, 84, 62, [16, 16, 28, 28]);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.moveTo(cx - 28, cy - 20);
      g.lineTo(cx - 14, cy - 20);
      g.lineTo(cx - 32, cy + 10);
      g.lineTo(cx - 38, cy + 2);
      g.closePath();
      g.fill();
      g.strokeStyle = frame;
      g.lineWidth = 8;
      rrect(g, cx - 42, cy - 30, 84, 62, [16, 16, 28, 28]);
      g.stroke();
    } else if (type === 'heart_glasses') {
      heartPath(g, cx, cy + 4, 92);
      g.fillStyle = rgba(shade(frame, 0.35), 0.72);
      g.fill();
      g.strokeStyle = frame;
      g.lineWidth = 8;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.ellipse(cx - 18, cy - 12, 6, 10, -0.6, 0, Math.PI * 2);
      g.fill();
    } else if (type === 'star_glasses') {
      starPath(g, cx, cy + 4, 50, 25);
      g.fillStyle = rgba(shade(frame, 0.4), 0.7);
      g.fill();
      g.strokeStyle = frame;
      g.lineWidth = 7;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      sparkle4(g, cx - 8, cy - 4, 7);
    }
  }
  // bridge
  g.strokeStyle = frame;
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(106, 54);
  g.quadraticCurveTo(128, 44, 150, 54);
  g.stroke();
  g.restore();
}

// ---------- wings ----------

/** Wing picture on a transparent canvas (left wing; mirrored by UVs for the right). */
export function paintWing(g, W, H, type, color, part = 'upper') {
  g.clearRect(0, 0, W, H);
  const light = shade(color, 0.55), deep = shade(color, -0.25);
  g.save();
  if (type === 'butterfly_wings') {
    g.beginPath();
    if (part === 'upper') {
      g.moveTo(4, H * 0.72);
      g.bezierCurveTo(W * 0.1, H * 0.05, W * 0.85, -H * 0.05, W * 0.96, H * 0.28);
      g.bezierCurveTo(W * 1.02, H * 0.55, W * 0.6, H * 0.85, 4, H * 0.8);
    } else {
      g.moveTo(4, H * 0.2);
      g.bezierCurveTo(W * 0.4, H * 0.05, W * 0.9, H * 0.35, W * 0.78, H * 0.75);
      g.bezierCurveTo(W * 0.65, H * 1.02, W * 0.2, H * 0.9, 4, H * 0.35);
    }
    g.closePath();
    const grd = g.createRadialGradient(4, H / 2, 4, 4, H / 2, W);
    grd.addColorStop(0, light);
    grd.addColorStop(0.55, color);
    grd.addColorStop(1, deep);
    g.fillStyle = grd;
    g.fill();
    g.clip();
    g.lineWidth = 12;
    g.strokeStyle = shade(color, -0.45);
    g.stroke();
    g.fillStyle = '#FFFFFF';
    for (let i = 0; i < 6; i++) {
      const a = part === 'upper' ? -0.9 + i * 0.3 : 0.1 + i * 0.28;
      g.beginPath();
      g.arc(4 + Math.cos(a) * W * 0.78, H / 2 + Math.sin(a) * H * 0.42, 4.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = shade(color, -0.4);
    g.beginPath();
    g.arc(W * 0.52, part === 'upper' ? H * 0.42 : H * 0.55, W * 0.11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#FFE58A';
    g.beginPath();
    g.arc(W * 0.52, part === 'upper' ? H * 0.42 : H * 0.55, W * 0.055, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(shade(color, -0.5), 0.5);
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(4, H / 2);
      g.lineTo(W * (0.6 + i * 0.1), H * (part === 'upper' ? 0.1 + i * 0.15 : 0.3 + i * 0.15));
      g.stroke();
    }
  } else {
    // fairy: glassy teardrop with glowing veins
    g.beginPath();
    if (part === 'upper') {
      g.moveTo(4, H * 0.75);
      g.bezierCurveTo(W * 0.15, H * 0.1, W * 0.75, -H * 0.02, W * 0.95, H * 0.1);
      g.bezierCurveTo(W * 1.0, H * 0.3, W * 0.55, H * 0.7, 4, H * 0.82);
    } else {
      g.moveTo(4, H * 0.18);
      g.bezierCurveTo(W * 0.55, H * 0.15, W * 0.85, H * 0.6, W * 0.7, H * 0.85);
      g.bezierCurveTo(W * 0.5, H * 1.0, W * 0.2, H * 0.6, 4, H * 0.3);
    }
    g.closePath();
    const grd = g.createRadialGradient(4, H / 2, 2, 4, H / 2, W);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.3, rgba(light, 0.85));
    grd.addColorStop(0.75, rgba(color, 0.85));
    grd.addColorStop(1, rgba(shade(color, -0.1), 0.9));
    g.fillStyle = grd;
    g.fill();
    g.clip();
    g.strokeStyle = rgba(shade(color, -0.2), 0.95);
    g.lineWidth = 9;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = rgba('#FFFFFF', 0.8);
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(4, H / 2);
      g.quadraticCurveTo(W * 0.4, H * (part === 'upper' ? 0.3 + i * 0.05 : 0.5 + i * 0.05), W * (0.6 + i * 0.1), H * (part === 'upper' ? 0.08 + i * 0.16 : 0.35 + i * 0.14));
      g.stroke();
    }
    const rand = mulberry32(hashString(color + part));
    g.fillStyle = '#FFFFFF';
    for (let i = 0; i < 9; i++) sparkle4(g, 12 + rand() * W * 0.7, 10 + rand() * H * 0.8, 2 + rand() * 4);
  }
  g.restore();
}

// ---------- tiny helpers used by builders ----------

/** Hex -> '#rrggbb' lighter/darker, re-exported so part builders need one import. */
export { shade, mixHex, hexToRgb };
