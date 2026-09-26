// Procedural texture generation for the CSM exterior (pure typed-array code: runs in a Web Worker,
// in the main thread, or in node). No DOM, no three.js.
//
// Two non-tiling "skin atlases", both mapped U = around the vehicle (seam on -Y, see profile.js) and
// V = along the profile:
//   * CM foil  (V = arclength along CM_FOIL_PROFILE, 0 at the aft rim): aluminized Mylar tape laid in
//     gores from the base toward the apex, each gore slightly tilted / wrinkled so reflections break up
//     like the real Columbia; tape seams; the side-hatch outline; CM RCS ports; flush S-band antennas;
//     window cut-outs (alpha = 0 -> alphaTest holes) with a brown ablator margin.
//   * SM skin  (V = (z - zFront) / length): aluminium honeycomb panels with sector joints, rivet rows,
//     the fuel-cell and ECS radiators (white Z-93 paint with coolant tubes), black/white RCS quad
//     panels, service panels and faint RCS plume staining.
// Each atlas yields three RGBA8 maps: albedo (sRGB), ORM (R = ambient occlusion, G = roughness,
// B = metalness — three.js channel layout) and a tangent-space normal map (U = +X, V = +Y).

import { CM_FOIL_PROFILE, CM_FOIL_ARC, cmProfileAtV, cmVofZ, SM_LAYOUT, CM_FEATURES } from './profile.js';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ noise
function hash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Seeded PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise, periodic in x with integer period px (lattice units). Returns -1..1. */
function vnoise(x, y, px, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const xa = ((x0 % px) + px) % px;
  const xb = (xa + 1) % px;
  const a = hash(xa, y0, seed);
  const b = hash(xb, y0, seed);
  const c = hash(xa, y0 + 1, seed);
  const d = hash(xb, y0 + 1, seed);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

/** Fractal noise periodic in x (period px at the base octave; each octave doubles it). */
function fbm(x, y, px, oct, seed, gain = 0.5) {
  let s = 0;
  let amp = 1;
  let norm = 0;
  let p = px;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(x, y, p, seed + o * 17);
    norm += amp;
    amp *= gain;
    x *= 2;
    y *= 2;
    p *= 2;
  }
  return s / norm;
}


/** Periodic fbm tile (size x size, `cells` lattice cells across at the base octave). Values -1..1. */
function noiseTile(size, cells, oct, seed, gain = 0.5) {
  const t = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      let amp = 1;
      let nrm = 0;
      let c = cells;
      for (let o = 0; o < oct; o++) {
        const x = (i / size) * c;
        const y = (j / size) * c;
        // periodic in both axes: wrap the lattice in y as well by folding through vnoise's x-period
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const xa = x0 % c;
        const xb = (x0 + 1) % c;
        const ya = y0 % c;
        const yb = (y0 + 1) % c;
        const sd = seed + o * 17;
        const a = hash(xa, ya, sd);
        const b = hash(xb, ya, sd);
        const cc = hash(xa, yb, sd);
        const d = hash(xb, yb, sd);
        s += amp * ((a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy) * 2 - 1);
        nrm += amp;
        amp *= gain;
        c *= 2;
      }
      t[j * size + i] = s / nrm;
    }
  }
  return t;
}

/** Coarse field (Wc x Hc) of fn(u, v), sampled bilinearly with wrap in U. */
function coarseField(Wc, Hc, fn) {
  const f = new Float32Array(Wc * Hc);
  for (let j = 0; j < Hc; j++) for (let i = 0; i < Wc; i++) f[j * Wc + i] = fn(i / Wc, (j + 0.5) / Hc);
  return (u, v) => {
    const x = u * Wc;
    let y = v * Hc - 0.5;
    y = y < 0 ? 0 : y > Hc - 1 ? Hc - 1 : y;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const xa = ((x0 % Wc) + Wc) % Wc;
    const xb = (xa + 1) % Wc;
    const y1 = Math.min(Hc - 1, y0 + 1);
    const a = f[y0 * Wc + xa];
    const b = f[y0 * Wc + xb];
    const c = f[y1 * Wc + xa];
    const d = f[y1 * Wc + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
// linear -> sRGB byte lookup (4096 steps)
const SRGB_LUT = (() => {
  const t = new Uint8Array(4097);
  for (let k = 0; k <= 4096; k++) {
    const c = k / 4096;
    t[k] = Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
  }
  return t;
})();
const srgbByte = (c) => SRGB_LUT[c <= 0 ? 0 : c >= 1 ? 4096 : (c * 4096) | 0];

// ------------------------------------------------------------------ canvas-like float surface
/**
 * Float working surface for one atlas: per-pixel albedo (linear RGB), roughness, metalness, AO,
 * height (m), extra slope (tilt) and alpha. Metric: metres per pixel along U depends on the row
 * (cone radius), along V is constant.
 */
class Surface {
  constructor(W, H, rowRadius, lengthV) {
    this.W = W;
    this.H = H;
    const N = W * H;
    this.alb = new Float32Array(N * 3);
    this.rough = new Float32Array(N);
    this.metal = new Float32Array(N);
    this.ao = new Float32Array(N).fill(1);
    this.h = new Float32Array(N);
    this.tu = new Float32Array(N); // extra slope along U (dh/dx), unitless
    this.tv = new Float32Array(N);
    this.alpha = new Uint8Array(N).fill(255);
    this.rowR = rowRadius; // Float32Array(H): radius of each row (m)
    this.mV = lengthV / H; // metres per pixel along V
  }
  mU(j) {
    return (TAU * this.rowR[j]) / this.W;
  }
  /**
   * Visit pixels around (u, v) (texture coords 0..1) within +-(hu, hv) metres, wrapping in U.
   * fn(i, dx, dy) receives the pixel index and the metric offset (m) from the centre.
   */
  around(u, v, hu, hv, fn) {
    const { W, H } = this;
    const jc = v * H - 0.5;
    const j0 = Math.max(0, Math.floor(jc - hv / this.mV) - 1);
    const j1 = Math.min(H - 1, Math.ceil(jc + hv / this.mV) + 1);
    for (let j = j0; j <= j1; j++) {
      const mu = this.mU(j);
      const ic = u * W - 0.5;
      const span = Math.ceil(hu / mu) + 1;
      const dy = (j - jc) * this.mV;
      for (let k = -span; k <= span; k++) {
        const ii = Math.round(ic) + k;
        const i = ((ii % W) + W) % W;
        const dx = (ii - ic) * mu;
        fn(j * W + i, dx, dy);
      }
    }
  }
  setAlb(i, r, g, b, k = 1) {
    const o = i * 3;
    this.alb[o] += (r - this.alb[o]) * k;
    this.alb[o + 1] += (g - this.alb[o + 1]) * k;
    this.alb[o + 2] += (b - this.alb[o + 2]) * k;
  }
  mix(i, k, { r, g, b, rough, metal, ao, h, hAdd }) {
    if (k <= 0) return;
    if (r !== undefined) this.setAlb(i, r, g, b, k);
    if (rough !== undefined) this.rough[i] += (rough - this.rough[i]) * k;
    if (metal !== undefined) this.metal[i] += (metal - this.metal[i]) * k;
    if (ao !== undefined) this.ao[i] += (ao - this.ao[i]) * k;
    if (h !== undefined) this.h[i] += (h - this.h[i]) * k;
    if (hAdd !== undefined) this.h[i] += hAdd * k;
  }
  /** Encode into the three RGBA8 maps. `normalScale` multiplies all slopes. */
  encode(normalScale = 1) {
    const { W, H } = this;
    const N = W * H;
    const albedo = new Uint8Array(N * 4);
    const orm = new Uint8Array(N * 4);
    const normal = new Uint8Array(N * 4);
    for (let j = 0; j < H; j++) {
      const mu = this.mU(j);
      const jm = Math.max(0, j - 1);
      const jp = Math.min(H - 1, j + 1);
      const invMu = 1 / (2 * mu);
      const invMv = 1 / ((jp - jm || 1) * this.mV);
      for (let i = 0; i < W; i++) {
        const p = j * W + i;
        const o = p * 4;
        albedo[o] = srgbByte(this.alb[p * 3]);
        albedo[o + 1] = srgbByte(this.alb[p * 3 + 1]);
        albedo[o + 2] = srgbByte(this.alb[p * 3 + 2]);
        albedo[o + 3] = this.alpha[p];
        orm[o] = clamp01(this.ao[p]) * 255 + 0.5;
        orm[o + 1] = clamp01(this.rough[p]) * 255 + 0.5;
        orm[o + 2] = clamp01(this.metal[p]) * 255 + 0.5;
        orm[o + 3] = 255;
        const il = i === 0 ? W - 1 : i - 1;
        const ir = i === W - 1 ? 0 : i + 1;
        const dhx = (this.h[j * W + ir] - this.h[j * W + il]) * invMu;
        const dhy = (this.h[jp * W + i] - this.h[jm * W + i]) * invMv;
        const nx = -(dhx + this.tu[p]) * normalScale;
        const ny = -(dhy + this.tv[p]) * normalScale;
        const il2 = 127.5 / Math.sqrt(nx * nx + ny * ny + 1);
        normal[o] = nx * il2 + 128;
        normal[o + 1] = ny * il2 + 128;
        normal[o + 2] = il2 + 128;
        normal[o + 3] = 255;
      }
    }
    return { albedo, orm, normal, width: W, height: H };
  }
}

// ------------------------------------------------------------------ polygon helpers
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToPoly(x, y, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const ex = bx - ax;
    const ey = by - ay;
    const t = clamp01(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1));
    d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return d;
}
/** Signed distance (m) to a rounded box of half extents (hx, hy) and corner radius rc. */
function sdRoundBox(x, y, hx, hy, rc) {
  const qx = Math.abs(x) - (hx - rc);
  const qy = Math.abs(y) - (hy - rc);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
}

// ================================================================== CM foil
/**
 * Generate the CM foil atlas.
 * @param {{width:number, height:number, seed?:number, holes?: number[][][]}} opts
 *   holes: window footprints as lists of [u, v] (from profile.windowPocket().footprintUV)
 * @returns {{albedo:Uint8Array, orm:Uint8Array, normal:Uint8Array, width:number, height:number}}
 */
export function generateCMFoil({ width: W = 2048, height: H = 1024, seed = 11, holes = [] } = {}) {
  const rowR = new Float32Array(H);
  const rowZ = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    const p = cmProfileAtV((j + 0.5) / H);
    rowR[j] = p.r;
    rowZ[j] = p.z;
  }
  const S = new Surface(W, H, rowR, CM_FOIL_ARC.length);
  const R = rng(seed);

  // ---- tape gores: NG strips around the vehicle, each running base -> apex
  const NG = 150;
  const gore = [];
  for (let g = 0; g < NG; g++) {
    gore.push({
      tint: 0.88 + R() * 0.1, // overall brightness of this strip
      warm: (R() - 0.5) * 0.03,
      rough: 0.14 + R() * 0.12 + R() * R() * 0.12,
      tu: (R() - 0.5) * 0.08, // constant tilt across the strip
      tv: (R() - 0.5) * 0.05,
      ph: R() * 100,
      wav: 0.6 + R() * 1.2, // wrinkle wavelength scale
      crinkle: 0.3 + R() * R() * 1.2,
    });
  }
  // tape lengths: circumferential overlaps at a few stations (staggered per gore)
  const tapeJoints = [0.28, 0.52, 0.74];
  const jointZ = CM_FEATURES.forwardJointZ;
  const vJoint = cmVofZ(jointZ);

  // per-gore profiles along the strip (waviness, slowly varying tilt) and shared noise fields
  const lfG = new Float32Array(NG * H);
  const tuG = new Float32Array(NG * H);
  const tvG = new Float32Array(NG * H);
  for (let g = 0; g < NG; g++) {
    const G = gore[g];
    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H;
      lfG[g * H + j] = fbm(g * 0.37, v * 9 * G.wav + G.ph, 1e6, 3, seed + 3);
      tuG[g * H + j] = vnoise(g * 3.1, v * 6 + G.ph, 1e6, seed + 21);
      tvG[g * H + j] = vnoise(g * 5.3, v * 4 + G.ph, 1e6, seed + 23);
    }
  }
  const crinkle = noiseTile(256, 40, 3, seed + 7, 0.55);
  const blotchF = coarseField(384, 96, (u, v) => fbm(u * 24, v * 5, 24, 4, seed + 9));
  // patchy wrinkle tilts independent of the strips (the tape never lies perfectly flat)
  const patchU = coarseField(1024, 384, (u, v) => fbm(u * 160, v * 30, 160, 3, seed + 51, 0.6));
  const patchV = coarseField(1024, 384, (u, v) => fbm(u * 160 + 7.3, v * 30 + 3.1, 160, 3, seed + 53, 0.6));

  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const mu = S.mU(j);
    const fwdShield = v > vJoint;
    for (let i = 0; i < W; i++) {
      const p = j * W + i;
      const u = (i + 0.5) / W;
      const gf = u * NG;
      const g = Math.floor(gf) % NG;
      const G = gore[g];
      const f = gf - Math.floor(gf); // 0..1 across the strip
      // wrinkles: low-frequency waviness along the strip + fine crinkle
      const lf = lfG[g * H + j];
      const cr = crinkle[(j & 255) * 256 + (i & 255)];
      const blotch = blotchF(u, v);
      S.h[p] = lf * 0.004 + cr * 0.0003 * G.crinkle + blotch * 0.002;
      // strip tilt varies slowly along its length
      S.tu[p] = G.tu + tuG[g * H + j] * 0.04 + patchU(u, v) * 0.13;
      S.tv[p] = G.tv + tvG[g * H + j] * 0.03 + patchV(u, v) * 0.11;
      // overlap seam at the strip edge (one side), slight ridge + darker, rougher line
      const seamW = Math.min(0.35, 0.0035 / ((mu * W) / NG)); // 3.5 mm overlap, as a fraction of the strip
      const e = f < seamW ? 1 - f / seamW : 0;
      const b = G.tint * (1 - e * 0.2) * (0.97 + blotch * 0.03);
      S.alb[p * 3] = b * (0.95 + G.warm);
      S.alb[p * 3 + 1] = b * 0.955;
      S.alb[p * 3 + 2] = b * (0.95 - G.warm) * 1.0;
      S.rough[p] = G.rough + e * 0.15 + Math.max(0, blotch) * 0.05;
      S.metal[p] = 1;
      S.h[p] += e * 0.00006;
      // circumferential tape overlaps (staggered)
      for (const tj of tapeJoints) {
        const vj = tj + (hash(g, 7, seed) - 0.5) * 0.08;
        const d = Math.abs(v - vj) * CM_FOIL_ARC.length;
        if (d < 0.004) {
          const k = 1 - d / 0.004;
          S.h[p] += 0.00005 * k;
          S.rough[p] += 0.08 * k;
          S.alb[p * 3] *= 1 - 0.1 * k;
          S.alb[p * 3 + 1] *= 1 - 0.1 * k;
          S.alb[p * 3 + 2] *= 1 - 0.1 * k;
        }
      }
      // forward heat shield: slightly different tape lot (smoother, a touch warmer)
      if (fwdShield) {
        S.rough[p] *= 0.85;
        S.alb[p * 3] *= 1.01;
        S.alb[p * 3 + 2] *= 0.97;
      }
      // the aft-most few cm and the forward-most (tunnel) edge: tape wraps over a dark bond line
      const sM = v * CM_FOIL_ARC.length;
      const eM = (1 - v) * CM_FOIL_ARC.length;
      const edge = Math.max(1 - sM / 0.012, 1 - eM / 0.01);
      if (edge > 0) S.mix(p, edge, { r: 0.12, g: 0.09, b: 0.06, rough: 0.6, metal: 0.2, ao: 0.6 });
    }
  }

  // ---- joint between the crew-compartment and forward heat shields (circumferential groove)
  S.around(0.5, vJoint, Math.PI * cmProfileAtV(vJoint).r - 0.005, 0.012, (i, dx, dy) => {
    const d = Math.abs(dy);
    if (d > 0.008) return;
    const k = 1 - d / 0.008;
    S.mix(i, k, { r: 0.08, g: 0.07, b: 0.06, rough: 0.7, metal: 0.3, ao: 0.4, hAdd: -0.0015 * k });
  });

  // ---- side hatch: rounded outline groove, hatch window surround handled by the holes
  {
    const h = CM_FEATURES.hatch;
    const vTop = cmVofZ(h.zTop);
    const vBot = cmVofZ(h.zBottom);
    const vc = (vTop + vBot) / 2;
    const hy = ((vTop - vBot) / 2) * CM_FOIL_ARC.length;
    const hx = h.widthM / 2;
    const uc = (h.az * D2R + Math.PI) / TAU;
    S.around(uc, vc, hx + 0.03, hy + 0.03, (i, dx, dy) => {
      const d = sdRoundBox(dx, dy, hx, hy, 0.09);
      const a = Math.abs(d);
      if (a < 0.006) {
        const k = 1 - a / 0.006;
        S.mix(i, k, { r: 0.05, g: 0.045, b: 0.04, rough: 0.8, metal: 0.1, ao: 0.3, hAdd: -0.002 * k });
      } else if (d < 0 && d > -0.03) {
        // the hatch skin is a separate tape job: a faint tone change inside the outline
        S.alb[i * 3] *= 0.985;
        S.alb[i * 3 + 1] *= 0.985;
      }
      // latch-handle access cover (small rounded rectangle, lower right of the hatch)
      const ax = dx - hx * 0.62;
      const ay = dy + hy * 0.72;
      const d2 = Math.abs(sdRoundBox(ax, ay, 0.05, 0.035, 0.01));
      if (d2 < 0.003) S.mix(i, 1 - d2 / 0.003, { r: 0.1, g: 0.09, b: 0.08, rough: 0.7, hAdd: -0.0008 });
      // boost-cover attach bolts along the hatch outline (tiny dimples)
      if (d > 0.012 && d < 0.02) {
        const per = Math.atan2(dy, dx) * 24;
        const fr = per - Math.floor(per);
        if (fr < 0.12) S.mix(i, 0.7, { r: 0.25, g: 0.24, b: 0.23, rough: 0.5, hAdd: -0.0004 });
      }
    });
  }

  // ---- CM RCS engine ports: dark scarfed openings with a brown ablator surround
  for (const [az, z] of CM_FEATURES.rcsPorts) {
    const uc = (az * D2R + Math.PI) / TAU;
    const vc = cmVofZ(z);
    S.around(uc, vc, 0.08, 0.08, (i, dx, dy) => {
      const rr = Math.hypot(dx / 0.036, dy / 0.046);
      if (rr < 1) {
        S.mix(i, 1, { r: 0.012, g: 0.011, b: 0.01, rough: 0.9, metal: 0, ao: 0.15, h: -0.003 * (1 - rr * rr) });
      } else if (rr < 1.25) {
        const k = 1 - smooth(1.12, 1.25, rr);
        S.mix(i, k, { r: 0.1, g: 0.075, b: 0.055, rough: 0.5, metal: 0.4, ao: 0.6, hAdd: 0.0006 * k });
      } else if (rr < 1.8) {
        S.ao[i] = Math.min(S.ao[i], 0.7 + (rr - 1.25) * 0.55);
      }
    });
  }

  // ---- flush-mounted S-band omni antennas (square dielectric windows)
  for (const [az, z] of CM_FEATURES.omni) {
    const uc = (az * D2R + Math.PI) / TAU;
    const vc = cmVofZ(z);
    S.around(uc, vc, 0.08, 0.08, (i, dx, dy) => {
      const d = sdRoundBox(dx, dy, 0.055, 0.055, 0.012);
      if (d < 0) S.mix(i, 1, { r: 0.23, g: 0.2, b: 0.16, rough: 0.55, metal: 0.05, ao: 0.9 });
      else if (d < 0.004) S.mix(i, 1 - d / 0.004, { r: 0.05, g: 0.05, b: 0.05, rough: 0.7, hAdd: -0.0006 });
    });
  }

  // ---- vents / dump nozzles
  for (const [az, z, rad] of CM_FEATURES.vents) {
    const uc = (az * D2R + Math.PI) / TAU;
    const vc = cmVofZ(z);
    S.around(uc, vc, rad * 2, rad * 2, (i, dx, dy) => {
      const rr = Math.hypot(dx, dy) / rad;
      if (rr < 1) S.mix(i, 1, { r: 0.02, g: 0.02, b: 0.02, rough: 0.9, metal: 0, ao: 0.3, h: -0.002 });
      else if (rr < 1.6) S.mix(i, 1 - (rr - 1) / 0.6, { r: 0.35, g: 0.34, b: 0.32, rough: 0.35, metal: 1 });
    });
  }

  // ---- window cut-outs: alpha holes + a 16 mm brown ablator margin
  for (const poly of holes) {
    // unwrap U around the first vertex, convert to metres around the centroid
    const u0 = poly[0][0];
    const pts = poly.map(([u, v]) => [u - Math.round(u - u0), v]);
    const cu = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cv = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const jc = Math.min(H - 1, Math.floor(cv * H));
    const mu = S.mU(jc) * W; // metres per unit U at the centroid row
    const ml = CM_FOIL_ARC.length;
    const polyM = pts.map(([u, v]) => [(u - cu) * mu, (v - cv) * ml]);
    let ext = 0;
    for (const [x, y] of polyM) ext = Math.max(ext, Math.abs(x), Math.abs(y));
    const cuW = ((cu % 1) + 1) % 1;
    S.around(cuW, cv, ext + 0.04, ext + 0.04, (i, dx, dy) => {
      const inside = pointInPoly(dx, dy, polyM);
      const d = distToPoly(dx, dy, polyM);
      if (inside) {
        S.alpha[i] = 0;
        S.mix(i, 1, { r: 0.1, g: 0.07, b: 0.05, rough: 0.7, metal: 0 });
      } else if (d < 0.016) {
        const k = 1 - smooth(0.011, 0.016, d);
        S.mix(i, k, { r: 0.13, g: 0.085, b: 0.05, rough: 0.6, metal: 0.25, ao: 0.6, hAdd: -0.001 * k });
      } else if (d < 0.04) {
        S.ao[i] = Math.min(S.ao[i], 0.75 + (d - 0.016) * 10);
      }
    });
  }

  return S.encode(1);
}

// ================================================================== SM skin
/**
 * Generate the SM skin atlas (cylinder r = SM radius, V = (z - zFront) / length).
 * @param {{width:number, height:number, seed?:number, quadAzimuths:number[]}} opts quad azimuths in degrees
 * @returns {{albedo:Uint8Array, orm:Uint8Array, normal:Uint8Array, width:number, height:number}}
 */
export function generateSMSkin({ width: W = 2048, height: H = 1024, seed = 5, quadAzimuths = [] } = {}) {
  const L = SM_LAYOUT;
  const len = L.zRear - L.zFront;
  const rowR = new Float32Array(H).fill(L.radius);
  const S = new Surface(W, H, rowR, len);
  const R = rng(seed);
  const circ = TAU * L.radius;
  const uOf = (azDeg) => ((((azDeg * D2R + Math.PI) / TAU) % 1) + 1) % 1;
  const vOf = (z) => (z - L.zFront) / len;
  const azOfU = (u) => u * 360 - 180; // degrees, -180..180

  // panel layout: sectors x rings -> per-panel finish
  const bounds = [...L.sectorBoundaries].sort((a, b) => a - b);
  const zR = [L.zFront, ...L.rings, L.zRear];
  const panelFinish = new Map();
  const finishOf = (sec, ring) => {
    const key = sec * 16 + ring;
    if (!panelFinish.has(key)) {
      panelFinish.set(key, {
        b: 0.62 + R() * 0.1, // brightness of the aluminium finish
        rough: 0.34 + R() * 0.16,
        metal: 0.45 + R() * 0.25,
        cool: (R() - 0.5) * 0.03,
        ph: R() * 50,
      });
    }
    return panelFinish.get(key);
  };

  // ---- base aluminium panels
  const n1F = coarseField(512, 256, (u, v) => fbm(u * 40, v * 16, 40, 4, seed + 1));
  const fine = noiseTile(256, 28, 2, seed + 2);
  const streak = noiseTile(256, 64, 2, seed + 4);
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const z = L.zFront + v * len;
    let ring = 0;
    while (ring < zR.length - 2 && z > zR[ring + 1]) ring++;
    for (let i = 0; i < W; i++) {
      const p = j * W + i;
      const u = (i + 0.5) / W;
      const az = ((azOfU(u) % 360) + 360) % 360;
      let sec = 0;
      while (sec < bounds.length && az >= bounds[sec]) sec++;
      sec %= bounds.length;
      const F = finishOf(sec, ring);
      const n1 = n1F(u, v + F.ph * 0.013);
      const n2 = fine[(j & 255) * 256 + (i & 255)];
      // honeycomb panel "oil-canning": broad soft undulation, plus rolled streaks along z
      S.h[p] = n1 * 0.0005 + streak[(j & 7) * 256 + (i & 255)] * 0.00003;
      const b = F.b * (1 + n1 * 0.02 + n2 * 0.01);
      S.alb[p * 3] = b * (1 - F.cool);
      S.alb[p * 3 + 1] = b;
      S.alb[p * 3 + 2] = b * (1 + F.cool * 1.2) * 1.02;
      S.rough[p] = F.rough + n2 * 0.03 + Math.max(0, n1) * 0.04;
      S.metal[p] = F.metal;
    }
  }

  const seam = (i, k, depth = 0.0012) =>
    S.mix(i, k, { r: 0.12, g: 0.12, b: 0.13, rough: 0.6, metal: 0.4, ao: 0.45, hAdd: -depth * k });

  // ---- sector joints (longitudinal radial-beam lines) with fastener rows either side
  for (const b of bounds) {
    S.around(uOf(b), 0.5, 0.05, len / 2 + 0.01, (i, dx, dy) => {
      const d = Math.abs(dx);
      if (d < 0.004) seam(i, 1 - d / 0.004);
      const zz = dy + len / 2;
      if (d > 0.018 && d < 0.026) {
        const fr = (zz / 0.05) % 1;
        if (fr < 0.25) S.mix(i, 0.8, { r: 0.45, g: 0.45, b: 0.46, rough: 0.3, hAdd: 0.0003 });
      }
      // radial beam cap strip: a slightly different finish 3 cm either side
      if (d < 0.03) S.rough[i] = Math.min(1, S.rough[i] + 0.08);
    });
  }
  // ---- circumferential joints
  for (const zz of L.rings) {
    S.around(0.5, vOf(zz), circ / 2 + 0.01, 0.03, (i, dx, dy) => {
      const d = Math.abs(dy);
      if (d < 0.0035) seam(i, 1 - d / 0.0035);
      if (d > 0.014 && d < 0.02) {
        const fr = ((dx + circ) / 0.045) % 1;
        if (fr < 0.25) S.mix(i, 0.8, { r: 0.45, g: 0.45, b: 0.46, rough: 0.3, hAdd: 0.0003 });
      }
    });
  }
  // forward and aft edges: slight darkening (fairing lip, aft skirt)
  for (let j = 0; j < H; j++) {
    const z = L.zFront + ((j + 0.5) / H) * len;
    const k = Math.max(1 - (z - L.zFront) / 0.03, 1 - (L.zRear - z) / 0.03, 0);
    if (k <= 0) continue;
    for (let i = 0; i < W; i++) S.mix(j * W + i, k, { r: 0.2, g: 0.2, b: 0.21, rough: 0.6, ao: 0.6 });
  }

  // ---- radiators: white Z-93 paint over aluminium with coolant tubes
  const radiator = (azC, widthDeg, z0, z1, tubePitch, header) => {
    const hw = (widthDeg * D2R * L.radius) / 2;
    const hh = (z1 - z0) / 2;
    S.around(uOf(azC), vOf((z0 + z1) / 2), hw + 0.02, hh + 0.02, (i, dx, dy) => {
      const d = sdRoundBox(dx, dy, hw, hh, 0.01);
      if (d > 0.006) return;
      if (d > 0) {
        seam(i, 1 - d / 0.006, 0.0008);
        return;
      }
      const n = fbm((dx + 10) * 3, (dy + 10) * 3, 1e6, 3, seed + 31);
      const w = 0.83 + n * 0.03;
      S.mix(i, 1, { r: w, g: w * 0.995, b: w * 0.975, rough: 0.72 + n * 0.08, metal: 0.0, ao: 1 });
      // tubes (vertical, along z)
      const t = ((dx + hw) / tubePitch) % 1;
      const tube = Math.max(0, 1 - Math.abs(t - 0.5) / 0.14);
      S.h[i] = tube * 0.0016 + n * 0.0002;
      S.ao[i] = 0.92 + tube * 0.08;
      // header manifolds at both ends
      if (header && (Math.abs(dy - hh + 0.04) < 0.018 || Math.abs(dy + hh - 0.04) < 0.018)) {
        S.h[i] = 0.003;
        S.mix(i, 0.5, { r: 0.7, g: 0.7, b: 0.68, rough: 0.5 });
      }
      // edge darkening (panel frame)
      if (d > -0.012) S.mix(i, 0.5, { r: 0.55, g: 0.55, b: 0.55, rough: 0.5 });
    });
  };
  for (const c of L.eps.centres) radiator(c, L.eps.width, L.eps.z0, L.eps.z1, 0.045, true);
  for (const c of L.ecs.centres) radiator(c, L.ecs.width, L.ecs.z0, L.ecs.z1, 0.06, true);

  // ---- RCS quad panels: black thermal-control panel with a white centre under the housing,
  // white margin stripes; faint plume staining fore and aft of the F/A nozzles.
  const Q = L.quadPanel;
  for (const qa of quadAzimuths) {
    const hw = Q.halfWidthDeg * D2R * L.radius;
    const hh = (Q.z1 - Q.z0) / 2;
    const zc = (Q.z0 + Q.z1) / 2;
    S.around(uOf(qa), vOf(zc), hw + 0.3, hh + 0.9, (i, dx, dy) => {
      const d = sdRoundBox(dx, dy, hw, hh, 0.02);
      if (d < 0) {
        // outer black band / white inner field / black square under the housing
        const inner = sdRoundBox(dx, dy, hw - 0.07, hh - 0.07, 0.015);
        const core = sdRoundBox(dx, dy, 0.16, 0.16, 0.01);
        let c = 0.02;
        let rough = 0.8;
        if (inner < 0) {
          c = 0.8;
          rough = 0.7;
        }
        if (core < 0) {
          c = 0.03;
          rough = 0.85;
        }
        const n = fbm((dx + 5) * 8, (dy + 5) * 8, 1e6, 2, seed + 41) * 0.02;
        S.mix(i, 1, { r: c + n, g: c + n, b: c + n * 1.1, rough, metal: 0, ao: 1, h: 0 });
        if (Math.abs(inner) < 0.003 || Math.abs(core) < 0.003) S.h[i] = -0.0008;
      } else if (d < 0.005) {
        seam(i, 1 - d / 0.005, 0.001);
      }
      // plume staining beyond the panel along +-z (F jets exhaust forward, A jets aft)
      const ax = Math.abs(dx);
      if (ax < 0.18 && Math.abs(dy) > hh) {
        const along = Math.abs(dy) - hh;
        const k = Math.exp(-along / 0.35) * Math.exp(-(ax * ax) / 0.006) * 0.35;
        if (k > 0.01) S.mix(i, k, { r: 0.45, g: 0.38, b: 0.28, rough: 0.7, metal: 0.2 });
      }
    });
  }

  // ---- small service panels (fill / drain, vents, access)
  for (const [az, z, wM, hM] of L.service) {
    S.around(uOf(az), vOf(z), wM / 2 + 0.03, hM / 2 + 0.03, (i, dx, dy) => {
      const d = sdRoundBox(dx, dy, wM / 2, hM / 2, 0.012);
      if (Math.abs(d) < 0.0035) seam(i, 1 - Math.abs(d) / 0.0035, 0.0009);
      if (d < 0) {
        S.rough[i] = Math.min(1, S.rough[i] * 1.2 + 0.05);
        // corner screws
        const sx = Math.abs(dx) - (wM / 2 - 0.02);
        const sy = Math.abs(dy) - (hM / 2 - 0.02);
        if (Math.hypot(sx, sy) < 0.006) S.mix(i, 1, { r: 0.3, g: 0.3, b: 0.3, rough: 0.4, hAdd: 0.0004 });
      }
    });
  }

  // ---- scimitar antenna footprints (dark mounting pads)
  for (const s of L.scimitars) {
    for (const zz of [s.z0 + 0.04, s.z1 - 0.04]) {
      S.around(uOf(s.az), vOf(zz), 0.05, 0.05, (i, dx, dy) => {
        const d = sdRoundBox(dx, dy, 0.03, 0.035, 0.008);
        if (d < 0) S.mix(i, 1, { r: 0.1, g: 0.1, b: 0.1, rough: 0.6, metal: 0.3, ao: 0.7 });
      });
    }
  }

  // slight darkening beneath the umbilical fairing and HGA root (ambient occlusion)
  const occl = (az, z, rx, ry, k0) => {
    S.around(uOf(az), vOf(z), rx * 2, ry * 2, (i, dx, dy) => {
      const k = Math.exp(-(dx * dx) / (rx * rx) - (dy * dy) / (ry * ry)) * k0;
      S.ao[i] *= 1 - k;
    });
  };
  occl(L.umbilical.az, 0.25, 0.25, 0.3, 0.5);
  occl(L.hga.az, 4.8, 0.3, 0.2, 0.45);
  for (const qa of quadAzimuths) occl(qa, 1.35, 0.22, 0.25, 0.35);

  return S.encode(1);
}

/**
 * Worker/main-thread dispatcher.
 * @param {string} kind 'cmFoil' | 'smSkin'
 * @param {object} opts generator options
 */
export function generate(kind, opts) {
  if (kind === 'cmFoil') return generateCMFoil(opts);
  if (kind === 'smSkin') return generateSMSkin(opts);
  throw new Error(`unknown CSM texture kind ${kind}`);
}

export { CM_FOIL_PROFILE };
