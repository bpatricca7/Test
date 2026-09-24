// Baked, tiling fabric textures (colour + normal from height), all procedural.
// Each tile covers `tile` metres; lofted garments carry UVs in metres.

import * as THREE from 'three';

function tex(data, N, srgb, repeat = true) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** height (Float32 N*N, wrapping) -> tangent-space normal map; texel = world metres per texel */
function normalFromHeight(h, N, texel, strength = 1) {
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const l = h[y * N + (x + N - 1) % N], r = h[y * N + (x + 1) % N];
    const dn = h[((y + N - 1) % N) * N + x], up = h[((y + 1) % N) * N + x];
    const nx = -(r - l) / (2 * texel) * strength, ny = -(up - dn) / (2 * texel) * strength;
    const len = Math.hypot(nx, ny, 1);
    d[4 * i] = (nx / len * 0.5 + 0.5) * 255; d[4 * i + 1] = (ny / len * 0.5 + 0.5) * 255; d[4 * i + 2] = (1 / len * 0.5 + 0.5) * 255; d[4 * i + 3] = 255;
  }
  return d;
}

const toS = c => { c = Math.min(1, Math.max(0, c)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };
const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

function valueTile(rnd, T) { const a = new Float32Array(T * T); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; }
function samp(a, T, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const x0 = ((xi % T) + T) % T, y0 = ((yi % T) + T) % T, x1 = (x0 + 1) % T, y1 = (y0 + 1) % T;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (a[y0 * T + x0] * (1 - sx) + a[y0 * T + x1] * sx) * (1 - sy) + (a[y1 * T + x0] * (1 - sx) + a[y1 * T + x1] * sx) * sy;
}

function finish(N, col, h, tile, strength, rough) {
  const cd = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    cd[4 * i] = toS(col[3 * i]); cd[4 * i + 1] = toS(col[3 * i + 1]); cd[4 * i + 2] = toS(col[3 * i + 2]);
    cd[4 * i + 3] = rough ? Math.round(rough[i] * 255) : 255;
  }
  return { map: tex(cd, N, true), normalMap: tex(normalFromHeight(h, N, tile / N, strength), N, false), tile };
}

/**
 * Stockinette knit: columns of V-shaped loops. `stitches` across the tile.
 */
export function knitTexture({ color, color2, heather = 0.12, stitches = 14, rows = 18, tile = 0.065, N = 512, rib = false, rnd }) {
  const c1 = lin(color), c2 = lin(color2 || color);
  const col = new Float32Array(N * N * 3), h = new Float32Array(N * N);
  const T = 64, fib = valueTile(rnd, T), yarn = valueTile(rnd, T);
  const sw = N / stitches, sh = N / rows;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const cx = x / sw, cy = y / sh;
    const col_i = Math.floor(cx), fx = cx - col_i; // 0..1 across the stitch column
    const row_i = Math.floor(cy), fy = cy - row_i;
    let height, shade;
    if (!rib) {
      // each stitch: two slanted legs forming a V (\ /), legs bulge
      const leg = fx < 0.5 ? fx * 2 : (1 - fx) * 2; // 0 at the column edges, 1 at the centre
      const slant = fx < 0.5 ? (fx - fy * 0.5 - 0.25) : (fx + fy * 0.5 - 0.75);
      const along = Math.abs(slant) * 3.2;
      const loop = Math.max(0, 1 - along * along);
      const edgeGap = Math.pow(Math.sin(Math.PI * fy), 0.35);
      height = loop * edgeGap * (0.65 + 0.35 * Math.sin(Math.PI * leg));
      // plies twist along the leg
      height += 0.12 * Math.sin((fy * 7 + fx * 3) * Math.PI) * loop;
      shade = 0.6 + 0.4 * height;
    } else {
      // 2x2 rib: raised knit columns separated by sunken purl columns
      const period = 0.5; // two stitch columns per rib
      const r = ((cx * period) % 1 + 1) % 1;
      const ribH = Math.pow(Math.sin(Math.PI * Math.min(1, r * 2)), 0.8) * (r < 0.5 ? 1 : 0.15);
      const v = Math.abs(fx - 0.5) * 2;
      height = ribH * (0.75 + 0.25 * Math.sin(Math.PI * fy)) * (0.85 + 0.15 * (1 - v));
      shade = 0.55 + 0.45 * height;
    }
    const fibre = samp(fib, T, x * 0.9, y * 0.35) - 0.5;
    const heat = samp(yarn, T, col_i * 1.7 + row_i * 0.23, row_i * 0.61) ; // per-stitch yarn colour
    height += fibre * 0.08;
    const k = shade * (1 + fibre * 0.18);
    const m = heat < heather ? 1 : heat > 1 - heather * 0.5 ? 0.5 : 0;
    for (let c = 0; c < 3; c++) col[3 * i + c] = (c1[c] * (1 - m) + c2[c] * m) * k;
    h[i] = height * 0.0011;
  }
  return finish(N, col, h, tile, 1.0);
}

/** plain cotton weave (shirt): fine over-under with slub variation */
export function weaveTexture({ color, tile = 0.02, N = 256, threads = 36, rnd }) {
  const c1 = lin(color);
  const col = new Float32Array(N * N * 3), h = new Float32Array(N * N);
  const T = 64, sl = valueTile(rnd, T);
  const p = N / threads;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const ix = Math.floor(x / p), iy = Math.floor(y / p);
    const fx = x / p - ix, fy = y / p - iy;
    const over = (ix + iy) % 2 === 0;
    const warp = Math.sin(Math.PI * fx), weft = Math.sin(Math.PI * fy);
    const height = over ? warp * (0.6 + 0.4 * weft) : weft * (0.6 + 0.4 * warp);
    const slub = samp(sl, T, x * 0.05, y * 0.6) - 0.5;
    const k = 0.86 + 0.14 * height + slub * 0.05;
    for (let c = 0; c < 3; c++) col[3 * i + c] = c1[c] * k;
    h[i] = height * 0.00012;
  }
  return finish(N, col, h, tile, 1.0);
}

/**
 * Twill: diagonal wales. Denim uses an indigo warp over a white weft with
 * slubby warp yarns; wool trousers use a tonal twill.
 */
export function twillTexture({ warp, weft, tile = 0.03, N = 512, threads = 64, denim = false, rnd }) {
  const cw = lin(warp), cf = lin(weft);
  const col = new Float32Array(N * N * 3), h = new Float32Array(N * N);
  const T = 128, sl = valueTile(rnd, T), sp = valueTile(rnd, T);
  const p = N / threads;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const ix = Math.floor(x / p), iy = Math.floor(y / p);
    const fx = x / p - ix, fy = y / p - iy;
    // 3/1 twill: warp floats over 3 wefts, stepping one each row
    const warpUp = ((ix - iy) % 4 + 4) % 4 !== 3;
    const bulge = warpUp ? Math.sin(Math.PI * fx) * 0.9 : Math.sin(Math.PI * fy) * 0.55;
    const slub = samp(sl, T, ix * 0.37, y * 0.02) - 0.5; // warp yarns vary along their length
    let c = warpUp ? cw : cf;
    let k = 0.78 + 0.22 * bulge + slub * (denim ? 0.35 : 0.1);
    if (denim && !warpUp) k *= 1.05;
    // occasional white fleck (denim)
    const fleck = denim ? Math.max(0, samp(sp, T, x * 0.5, y * 0.5) - 0.86) * 4 : 0;
    for (let q = 0; q < 3; q++) col[3 * i + q] = c[q] * k * (1 - fleck) + cf[q] * fleck;
    h[i] = bulge * 0.00018;
  }
  return finish(N, col, h, tile, 1.0);
}

/** brushed fleece/jersey: a fine jersey knit with a soft fuzzy tone */
export function fleeceTexture({ color, tile = 0.03, N = 256, rnd, rib = false }) {
  const c1 = lin(color);
  const col = new Float32Array(N * N * 3), h = new Float32Array(N * N);
  const T = 64, a = valueTile(rnd, T), b = valueTile(rnd, T);
  const cols = rib ? 18 : 40, rows = 52;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const fx = (x / N * cols) % 1, fy = (y / N * rows) % 1;
    let height;
    if (rib) height = Math.pow(Math.sin(Math.PI * ((x / N * cols * 0.5) % 1)), 1.2) * 0.8 + 0.2 * Math.sin(Math.PI * fy);
    else {
      const v = fx < 0.5 ? fx * 2 : (1 - fx) * 2;
      height = 0.5 + 0.5 * Math.sin(Math.PI * v) * Math.sin(Math.PI * fy * 1.0);
    }
    const fuzz = samp(a, T, x * 0.8, y * 0.8) - 0.5, blot = samp(b, T, x * 0.04, y * 0.04) - 0.5;
    height += fuzz * 0.35;
    const k = 0.84 + 0.16 * height + blot * 0.08;
    for (let c = 0; c < 3; c++) col[3 * i + c] = c1[c] * k;
    h[i] = height * (rib ? 0.0007 : 0.00016);
  }
  return finish(N, col, h, tile, 1.0);
}

/** leather / rubber / canvas for shoes */
export function leatherTexture({ color, tile = 0.04, N = 256, rnd, grain = 1 }) {
  const c1 = lin(color);
  const col = new Float32Array(N * N * 3), h = new Float32Array(N * N);
  const T = 64, a = valueTile(rnd, T), b = valueTile(rnd, T);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    let v = 0, amp = 1, f = 0.12;
    for (let o = 0; o < 4; o++) { v += amp * samp(a, T, x * f, y * f); amp *= 0.5; f *= 2.1; }
    const cell = Math.abs(samp(b, T, x * 0.25, y * 0.25) - 0.5) * 2;
    const height = (v / 1.9) * 0.6 + (1 - cell) * 0.4;
    const k = 0.9 + 0.1 * height;
    for (let c = 0; c < 3; c++) col[3 * i + c] = c1[c] * k;
    h[i] = height * 0.00008 * grain;
  }
  return finish(N, col, h, tile, 1.0);
}

/** hard plastic / rubber with fine texture */
export function plainTexture({ color, tile = 0.05, N = 64, rnd, bump = 0.00002 }) {
  const c1 = lin(color);
  const col = new Float32Array(N * N * 3), h = new Float32Array(N * N);
  const T = 32, a = valueTile(rnd, T);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const n = samp(a, T, x * 0.5, y * 0.5);
    for (let c = 0; c < 3; c++) col[3 * i + c] = c1[c] * (0.95 + 0.05 * n);
    h[i] = n * bump;
  }
  return finish(N, col, h, tile, 1.0);
}

/**
 * Cloth material: tiling fabric textures in metre-UVs, times vertex colour
 * (macro variation: fades, seams, wear). A sheen-like rim softens it.
 */
export function makeClothMaterial(ft, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: ft.map, normalMap: ft.normalMap, roughness: opts.roughness ?? 0.85, metalness: 0,
    vertexColors: opts.vertexColors ?? true, side: opts.side ?? THREE.FrontSide,
  });
  mat.normalScale = new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1);
  const rep = 1 / ft.tile;
  for (const t of [ft.map, ft.normalMap]) t.repeat.set(rep, rep);
  mat.userData.uniforms = { uSheen: { value: new THREE.Color(opts.sheen ?? 0x000000) } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSheen;')
      .replace('#include <opaque_fragment>', `
{
  vec3 Vv = normalize( vViewPosition );
  float rim = pow( 1.0 - saturate( dot( normal, Vv ) ), 2.5 );
  outgoingLight += uSheen * rim * ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) * 2.0;
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'human-cloth';
  return mat;
}
