// Procedural textures for the LM crew compartment (no external assets).
//
// Each generator returns { map, bump } (THREE.CanvasTexture, RepeatWrapping). UV convention: the
// cabin geometry carries planar/box UVs in METRES, so `repeat` = 1 / (tile size in m).
import * as THREE from 'three';
import { rng } from '../kit/index.js';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // generation reads pixels back (noise, folds): keep the canvas CPU-side. Later getContext('2d')
  // calls return this same context.
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

function tex(c, tileM, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileM, 1 / tileM);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Fill an ImageData-backed canvas with per-pixel noise added to what is already drawn. */
function noise(g, w, h, amp, seed, mono = true) {
  const img = g.getImageData(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amp;
    img.data[i] += n;
    img.data[i + 1] += mono ? n : (r() - 0.5) * amp;
    img.data[i + 2] += mono ? n : (r() - 0.5) * amp;
  }
  g.putImageData(img, 0, 0);
}

/** Low-frequency blotches (paint mottling / grime). */
function blotches(g, w, h, n, seed, color, rMin, rMax, alpha) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = rMin + r() * (rMax - rMin);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, color.replace('A', (alpha * (0.4 + r() * 0.6)).toFixed(3)));
    gr.addColorStop(1, color.replace('A', '0'));
    g.fillStyle = gr;
    // draw wrapped copies so the tile stays seamless
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
  }
}

function cached(key, f) {
  if (!cache.has(key)) cache.set(key, f());
  return cache.get(key);
}

/**
 * Grey painted aluminium lining panels: seams on a 0.5 m tile, rivet rows along the seams, a few
 * Dzus fasteners, mottled satin paint. Tile = 0.5 m.
 */
export function liningTextures() {
  return cached('lining', () => {
    const S = 1024;
    const tile = 0.5;
    const px = S / tile;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#727470';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, 30, 11, 'rgba(60,62,58,A)', 40, 160, 0.10);
    blotches(g, S, S, 20, 12, 'rgba(170,172,165,A)', 40, 140, 0.08);
    const b = canvas(S / 2, S / 2);
    const gb = b.getContext('2d');
    gb.fillStyle = 'rgb(128,128,128)';
    gb.fillRect(0, 0, S / 2, S / 2);
    // seams: panel edge at the tile border (both canvases)
    const seam = (x0, y0, x1, y1) => {
      g.strokeStyle = 'rgba(30,31,30,0.8)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      gb.strokeStyle = 'rgb(40,40,40)';
      gb.lineWidth = 2;
      gb.beginPath();
      gb.moveTo(x0 / 2, y0 / 2);
      gb.lineTo(x1 / 2, y1 / 2);
      gb.stroke();
    };
    seam(1, 0, 1, S);
    seam(0, 1, S, 1);
    seam(S * 0.5, 0, S * 0.5, S); // a second, lighter seam (doubler strip)
    // rivets every 2.5 cm along the seams, 1.2 cm off
    const r = rng(5);
    const rivet = (x, y) => {
      const gr = g.createRadialGradient(x - 1, y - 1, 0, x, y, 5);
      gr.addColorStop(0, '#b9bab5');
      gr.addColorStop(0.6, '#8a8b86');
      gr.addColorStop(1, 'rgba(50,50,48,0.8)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, 4.2, 0, Math.PI * 2);
      g.fill();
      const gg = gb.createRadialGradient(x / 2, y / 2, 0, x / 2, y / 2, 2.6);
      gg.addColorStop(0, 'rgb(200,200,200)');
      gg.addColorStop(1, 'rgb(128,128,128)');
      gb.fillStyle = gg;
      gb.beginPath();
      gb.arc(x / 2, y / 2, 2.6, 0, Math.PI * 2);
      gb.fill();
    };
    const step = 0.025 * px;
    for (let s = step / 2; s < S; s += step) {
      rivet(0.012 * px, s);
      rivet(S - 0.012 * px, s);
      rivet(s, 0.012 * px);
      rivet(s, S - 0.012 * px);
      rivet(S * 0.5 - 0.009 * px, s);
      rivet(S * 0.5 + 0.009 * px, s);
    }
    // Dzus fasteners on the panel faces
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const X = x * S + (r() - 0.5) * 6;
      const Y = y * S + (r() - 0.5) * 6;
      g.fillStyle = '#6c6e6a';
      g.beginPath();
      g.arc(X, Y, 9, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#2b2c2a';
      g.lineWidth = 2.2;
      const a = r() * Math.PI;
      g.beginPath();
      g.moveTo(X - Math.cos(a) * 7, Y - Math.sin(a) * 7);
      g.lineTo(X + Math.cos(a) * 7, Y + Math.sin(a) * 7);
      g.stroke();
      gb.fillStyle = 'rgb(170,170,170)';
      gb.beginPath();
      gb.arc(X / 2, Y / 2, 4.5, 0, Math.PI * 2);
      gb.fill();
    }
    // scuffs (soft, low contrast: at 20 cm a hard stroke reads as a stray pen mark)
    g.globalAlpha = 0.09;
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = r() < 0.5 ? '#5a5b58' : '#b5b6b0';
      g.lineWidth = 2 + r() * 3;
      const x = r() * S;
      const y = r() * S;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 20);
      g.stroke();
    }
    g.globalAlpha = 1;
    noise(g, S, S, 10, 3);
    noise(gb, S / 2, S / 2, 6, 4);
    return { map: tex(c, tile), bump: tex(b, tile, false) };
  });
}

/**
 * Beige Beta-cloth covered, quilted insulation blanket: stitch lines on a 0.1 m grid, puffy cells,
 * fine weave. Tile = 0.3 m.
 */
export function quiltTextures(color = '#d9d1bd') {
  return cached('quilt' + color, () => {
    const S = 512;
    const tile = 0.3;
    const cell = S / 3;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
    const b = canvas(S, S);
    const gb = b.getContext('2d');
    gb.fillStyle = 'rgb(60,60,60)';
    gb.fillRect(0, 0, S, S);
    const r = rng(21);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const x = i * cell + cell / 2 + (r() - 0.5) * 6;
        const y = j * cell + cell / 2 + (r() - 0.5) * 6;
        // puff (height) — elliptical, slightly irregular
        const gr = gb.createRadialGradient(x, y, 0, x, y, cell * 0.62);
        gr.addColorStop(0, 'rgb(235,235,235)');
        gr.addColorStop(0.55, 'rgb(190,190,190)');
        gr.addColorStop(1, 'rgb(60,60,60)');
        gb.fillStyle = gr;
        gb.fillRect(i * cell, j * cell, cell, cell);
        // shading: puffs catch light on top, darker toward the seams
        const gc = g.createRadialGradient(x - cell * 0.12, y - cell * 0.12, 0, x, y, cell * 0.7);
        gc.addColorStop(0, 'rgba(255,255,250,0.10)');
        gc.addColorStop(1, 'rgba(70,60,40,0.22)');
        g.fillStyle = gc;
        g.fillRect(i * cell, j * cell, cell, cell);
      }
    }
    // stitch lines (dashed)
    g.strokeStyle = 'rgba(110,98,76,0.9)';
    g.lineWidth = 1.6;
    g.setLineDash([5, 4]);
    gb.strokeStyle = 'rgb(20,20,20)';
    gb.lineWidth = 3;
    for (let k = 0; k <= 3; k++) {
      const p = k * cell;
      for (const [ctx] of [[g], [gb]]) {
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, S);
        ctx.moveTo(0, p);
        ctx.lineTo(S, p);
        ctx.stroke();
      }
    }
    g.setLineDash([]);
    // weave: fine cross-hatch
    g.globalAlpha = 0.07;
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    for (let k = 0; k < S; k += 3) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, S);
      g.stroke();
      g.beginPath();
      g.moveTo(0, k + 1);
      g.lineTo(S, k + 1);
      g.stroke();
    }
    g.globalAlpha = 1;
    blotches(g, S, S, 14, 22, 'rgba(120,105,80,A)', 20, 90, 0.12);
    noise(g, S, S, 14, 23);
    noise(gb, S, S, 18, 24);
    return { map: tex(c, tile), bump: tex(b, tile, false) };
  });
}

/**
 * Beta-cloth fabric for stowage bags / PLSS covers: a fine basket weave, soft broad folds (the cloth
 * is stretched over its container, so folds are long, shallow and roughly parallel), a stitched seam
 * and faint handling grime. The folds are sums of sine waves with INTEGER frequencies per tile, so the
 * tile is seamless. Tile = 0.25 m.
 */
export function clothTextures(color = '#e2dccb', seed = 31) {
  return cached('cloth' + color + seed, () => {
    const S = 512;
    const tile = 0.25;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
    const b = canvas(S, S);
    const gb = b.getContext('2d');
    const r = rng(seed);
    // ---- folds: height field h(x, y) in -1..1
    const waves = [];
    const main = r() < 0.5 ? [1, 0] : [0, 1]; // dominant fold direction
    for (let k = 0; k < 5; k++) {
      const n = main[0] * (1 + Math.floor(r() * 3)) + Math.floor(r() * 2);
      const m = main[1] * (1 + Math.floor(r() * 3)) + Math.floor(r() * 2);
      waves.push({ n: n || 1, m, a: 0.5 / (k + 1) + 0.15 * r(), ph: r() * 6.283, wn: Math.floor(r() * 5) - 2, wm: Math.floor(r() * 5) - 2, wph: r() * 6.283 });
    }
    const hf = new Float32Array(S * S);
    let hMax = 1e-6;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x / S) * 6.2832;
        const v = (y / S) * 6.2832;
        let h = 0;
        for (const w of waves) h += w.a * Math.sin(w.n * u + w.m * v + w.ph + 0.8 * Math.sin(w.wn * u + w.wm * v + w.wph));
        hf[y * S + x] = h;
        hMax = Math.max(hMax, Math.abs(h));
      }
    }
    const col = g.getImageData(0, 0, S, S);
    const bump = gb.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const h = hf[i] / hMax;
        // slope toward the upper-left light gives the soft shading of the folds in the albedo
        const sl = (hf[y * S + ((x + 1) % S)] - hf[y * S + ((x - 1 + S) % S)] + hf[((y + 1) % S) * S + x] - hf[((y - 1 + S) % S) * S + x]) / hMax;
        const k = 1 + 0.03 * h - 0.3 * sl;
        col.data[i * 4] *= k;
        col.data[i * 4 + 1] *= k;
        col.data[i * 4 + 2] *= k;
        const bv = 128 + 60 * h;
        bump.data[i * 4] = bump.data[i * 4 + 1] = bump.data[i * 4 + 2] = bv;
        bump.data[i * 4 + 3] = 255;
      }
    }
    g.putImageData(col, 0, 0);
    gb.putImageData(bump, 0, 0);
    // ---- basket weave (2 x 2 px threads) in both maps
    for (let y = 0; y < S; y += 2) {
      for (let x = 0; x < S; x += 2) {
        const over = ((x >> 1) + (y >> 1)) & 1;
        g.fillStyle = over ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        g.fillRect(x, y, 2, 2);
        gb.fillStyle = over ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
        gb.fillRect(x, y, 2, 2);
      }
    }
    // ---- seam with stitches
    g.strokeStyle = 'rgba(120,108,85,0.6)';
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(0, S * 0.08);
    g.lineTo(S, S * 0.08);
    g.stroke();
    g.setLineDash([]);
    gb.strokeStyle = 'rgba(60,60,60,0.8)';
    gb.lineWidth = 3;
    gb.beginPath();
    gb.moveTo(0, S * 0.08);
    gb.lineTo(S, S * 0.08);
    gb.stroke();
    // ---- faint handling grime
    blotches(g, S, S, 8, seed + 1, 'rgba(110,100,80,A)', 30, 110, 0.07);
    noise(g, S, S, 7, seed + 2);
    noise(gb, S, S, 8, seed + 3);
    return { map: tex(c, tile), bump: tex(b, tile, false) };
  });
}

/** Cabin floor: grey painted honeycomb panel with a grid of screw heads and scuffs. Tile = 0.4 m. */
export function floorTextures() {
  return cached('floor', () => {
    const S = 512;
    const tile = 0.4;
    const px = S / tile;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#6f716d';
    g.fillRect(0, 0, S, S);
    const b = canvas(S, S);
    const gb = b.getContext('2d');
    gb.fillStyle = 'rgb(128,128,128)';
    gb.fillRect(0, 0, S, S);
    blotches(g, S, S, 30, 41, 'rgba(40,40,38,A)', 20, 90, 0.25);
    const r = rng(42);
    // panel joints
    g.strokeStyle = 'rgba(25,25,25,0.9)';
    g.lineWidth = 3;
    g.strokeRect(1, 1, S - 2, S - 2);
    gb.strokeStyle = 'rgb(40,40,40)';
    gb.lineWidth = 3;
    gb.strokeRect(1, 1, S - 2, S - 2);
    // screws around the edge
    for (let s = 0.03 * px; s < S; s += 0.08 * px) {
      for (const [x, y] of [[0.015 * px, s], [S - 0.015 * px, s], [s, 0.015 * px], [s, S - 0.015 * px]]) {
        g.fillStyle = '#9c9e98';
        g.beginPath();
        g.arc(x, y, 3.4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#333';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - 2, y);
        g.lineTo(x + 2, y);
        g.moveTo(x, y - 2);
        g.lineTo(x, y + 2);
        g.stroke();
      }
    }
    // boot scuffs
    for (let i = 0; i < 80; i++) {
      g.strokeStyle = r() < 0.6 ? 'rgba(40,40,38,0.35)' : 'rgba(170,170,165,0.25)';
      g.lineWidth = 1 + r() * 3;
      const x = r() * S;
      const y = r() * S;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30, x + (r() - 0.5) * 70, y + (r() - 0.5) * 40);
      g.stroke();
    }
    // lunar dust (after EVA the floor was grimy): faint dark grey powder
    blotches(g, S, S, 16, 43, 'rgba(55,55,55,A)', 10, 50, 0.3);
    noise(g, S, S, 14, 44);
    noise(gb, S, S, 16, 45);
    return { map: tex(c, tile), bump: tex(b, tile, false) };
  });
}

/** Corrugated hose: bands around the tube (u along the length). uvLen 0.05 m -> 1 texture repeat. */
export function hoseTextures(color) {
  return cached('hose' + color, () => {
    const W = 256;
    const H = 32;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    const b = canvas(W, H);
    const gb = b.getContext('2d');
    const ribs = 7; // per 5 cm
    for (let i = 0; i < W; i++) {
      const ph = Math.sin((i / W) * ribs * Math.PI * 2);
      const v = Math.round(128 + ph * 110);
      gb.fillStyle = `rgb(${v},${v},${v})`;
      gb.fillRect(i, 0, 1, H);
      g.fillStyle = `rgba(${ph > 0 ? '255,255,255' : '0,0,0'},${Math.abs(ph) * 0.12})`;
      g.fillRect(i, 0, 1, H);
    }
    noise(g, W, H, 10, 51);
    const m = new THREE.CanvasTexture(c);
    const bb = new THREE.CanvasTexture(b);
    m.colorSpace = THREE.SRGBColorSpace;
    for (const t of [m, bb]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
    }
    return { map: m, bump: bb };
  });
}

/** Wire bundle: many parallel conductors (u along the length) with lacing ties every 5 cm. */
export function wireTextures() {
  return cached('wire', () => {
    const W = 256;
    const H = 128;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const b = canvas(W, H);
    const gb = b.getContext('2d');
    const r = rng(61);
    const cols = ['#e7e3d6', '#dcd8cb', '#cfcbbd', '#e9e6dc', '#bdb8a8', '#d8d2c0'];
    for (let y = 0; y < H; y += 4) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(0, y, W, 4);
      g.fillStyle = 'rgba(0,0,0,0.14)';
      g.fillRect(0, y + 3, W, 1);
      gb.fillStyle = 'rgb(170,170,170)';
      gb.fillRect(0, y, W, 3);
      gb.fillStyle = 'rgb(60,60,60)';
      gb.fillRect(0, y + 3, W, 1);
    }
    // lacing ties (waxed flat lacing tape, natural colour, knot shadow either side) — one per repeat
    g.fillStyle = 'rgba(40,36,30,0.55)';
    g.fillRect(W * 0.5 - 5, 0, 10, H);
    g.fillStyle = '#a79d86';
    g.fillRect(W * 0.5 - 3, 0, 6, H);
    gb.fillStyle = 'rgb(230,230,230)';
    gb.fillRect(W * 0.5 - 3, 0, 6, H);
    noise(g, W, H, 10, 62);
    const m = new THREE.CanvasTexture(c);
    const bb = new THREE.CanvasTexture(b);
    m.colorSpace = THREE.SRGBColorSpace;
    for (const t of [m, bb]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
    }
    return { map: m, bump: bb };
  });
}

/** Velcro pile (dark grey, fuzzy). Tile = 0.05 m. */
export function velcroTextures() {
  return cached('velcro', () => {
    // Apollo hook-and-loop pile: off-white / beige nylon felt with a fuzzy loop texture, slightly
    // soiled where hands press on it (same appearance as the CSM's patches)
    const S = 128;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#c9c1ab';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, 6, 73, 'rgba(120,108,84,A)', 10, 34, 0.22); // handling grime
    blotches(g, S, S, 5, 74, 'rgba(236,232,220,A)', 8, 26, 0.18);
    // loop pile: short random fibre strokes, light and dark
    const r = rng(75);
    for (let i = 0; i < 1400; i++) {
      const x = r() * S;
      const y = r() * S;
      const a = r() * Math.PI * 2;
      const l = 1 + r() * 2.5;
      g.strokeStyle = r() < 0.55 ? `rgba(245,241,230,${(0.25 + r() * 0.35).toFixed(2)})` : `rgba(96,88,70,${(0.18 + r() * 0.25).toFixed(2)})`;
      g.lineWidth = 0.6 + r() * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    noise(g, S, S, 22, 71);
    const b = canvas(S, S);
    const gb = b.getContext('2d');
    gb.fillStyle = 'rgb(128,128,128)';
    gb.fillRect(0, 0, S, S);
    noise(gb, S, S, 150, 72);
    return { map: tex(c, 0.05), bump: tex(b, 0.05, false) };
  });
}

/**
 * Floodlight lens: frosted prismatic diffuser (warm off-white, a grid of small pyramid prisms, frost
 * noise, darker gasket at the rim). Clamped, one image per lens face (BoxGeometry face UVs 0..1).
 */
export function floodLensTextures() {
  return cached('floodLens', () => {
    const W = 64;
    const H = 160;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#e6dcc6';
    g.fillRect(0, 0, W, H);
    // prism grid: each cell lit on one diagonal half, shaded on the other
    const cw = 8;
    const ch = 8;
    for (let y = 0; y < H; y += ch) {
      for (let x = 0; x < W; x += cw) {
        g.fillStyle = 'rgba(255,250,236,0.35)';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + cw, y);
        g.lineTo(x + cw / 2, y + ch / 2);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(120,104,80,0.16)';
        g.beginPath();
        g.moveTo(x, y + ch);
        g.lineTo(x + cw, y + ch);
        g.lineTo(x + cw / 2, y + ch / 2);
        g.closePath();
        g.fill();
      }
    }
    noise(g, W, H, 26, 91);
    blotches(g, W, H, 4, 92, 'rgba(150,130,96,A)', 6, 18, 0.12); // dust / heat discolouration
    // rim gasket
    g.strokeStyle = 'rgba(60,56,50,0.8)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, W - 3, H - 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { map: t };
  });
}

/** Black anodised aluminium with faint brushed grain (window frames, brackets). Tile = 0.2 m. */
export function anodizedTextures() {
  return cached('anod', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#18191a';
    g.fillRect(0, 0, S, S);
    const r = rng(81);
    blotches(g, S, S, 14, 82, 'rgba(70,70,70,A)', 10, 60, 0.12);
    void r;
    noise(g, S, S, 6, 83);
    return { map: tex(c, 0.2), bump: null };
  });
}
