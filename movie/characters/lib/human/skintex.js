// Baked skin textures for the head.
//
// UVs: an azimuthal-equidistant projection of the direction from a point
// inside the head (the face sits in the middle of the map at ~4.5 texels/mm).
// The bake rasterizes the head mesh into UV space and evaluates procedural skin
// per texel from the interpolated 3D position: pigment mottling, redness zones,
// freckles/spots/moles, stubble, lip lines, pores, age wrinkles (crow's feet,
// forehead, glabella, nasolabial folds, neck), the lid crease. Height becomes a
// tangent-space normal map; roughness goes in the colour map's alpha.

import * as THREE from 'three';
import { clamp, mix, sstep } from './sdf.js';

export const UV_O = [0, -0.02, -0.02];
const UV_TMAX = 2.75;

// the projection axis tilts up so its singular antipode sits at the nape
const TILT = 0.62;
const CT = Math.cos(TILT), ST = Math.sin(TILT);
export function headUV(x, y, z) {
  const dx = x - UV_O[0], dy0 = y - UV_O[1], dz0 = z - UV_O[2];
  const dy = dy0 * CT - dz0 * ST, dz = dy0 * ST + dz0 * CT;
  const l = Math.hypot(dx, dy, dz) || 1;
  const th = Math.acos(clamp(dz / l, -1, 1));
  const r = Math.min(Math.tanh(0.75 * th) / Math.tanh(0.75 * UV_TMAX), 0.999);
  const ph = Math.atan2(dy, dx);
  return [0.5 + 0.5 * r * Math.cos(ph), 0.5 + 0.5 * r * Math.sin(ph)];
}

// ------------------------------------------------------------ noise tiles ---
function makeTile(rnd, T) { const a = new Float32Array(T * T); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; }
function tsamp(tile, T, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const x0 = ((xi % T) + T) % T, y0 = ((yi % T) + T) % T, x1 = (x0 + 1) % T, y1 = (y0 + 1) % T;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = tile[y0 * T + x0], b = tile[y0 * T + x1], c = tile[y1 * T + x0], d = tile[y1 * T + x1];
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function tfbm(tile, T, x, y, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * tsamp(tile, T, x, y); n += a; x = x * 2.03 + 17.3; y = y * 2.03 + 5.1; a *= 0.5; }
  return s / n;
}
/** a tile of soft pits (pores) */
function makePoreTile(rnd, T, count, rMin, rMax) {
  const a = new Float32Array(T * T);
  for (let i = 0; i < count; i++) {
    const cx = rnd() * T, cy = rnd() * T, r = rMin + (rMax - rMin) * rnd(), d = 0.5 + 0.5 * rnd();
    const R = Math.ceil(r * 2.2);
    for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
      const px = ((Math.floor(cx) + xx) % T + T) % T, py = ((Math.floor(cy) + yy) % T + T) % T;
      const dd = ((Math.floor(cx) + xx - cx) ** 2 + (Math.floor(cy) + yy - cy) ** 2) / (r * r);
      a[py * T + px] -= d * Math.exp(-dd * 1.6);
    }
  }
  return a;
}

// ------------------------------------------------------------- the bake ---
/**
 * mesh: {positions, normals, indices, uv, color(regional linear rgb per vertex), bake(per-vertex 0/1)}
 * F: feature params per character
 */
export function bakeHeadSkin({ positions, normals, indices, uvs, colors, bakeMask, N = 2048 }, F, L, mouth, rnd) {
  const T = 256;
  const tileA = makeTile(rnd, T), tileB = makeTile(rnd, T);
  const PT = 512;
  const pores = makePoreTile(rnd, PT, F.poreCount || 26000, 0.55, 1.35);
  const col = new Float32Array(N * N * 3);
  const rough = new Float32Array(N * N);
  const height = new Float32Array(N * N);
  const scaleU = new Float32Array(N * N), scaleV = new Float32Array(N * N);
  const covered = new Uint8Array(N * N);

  // spots / freckles / moles: explicit lists in head-local space
  const spots = [];
  for (let i = 0; i < (F.spots || 0); i++) {
    // upper cheeks and temples, both sides
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (0.022 + rnd() * 0.035), y = -0.03 + rnd() * 0.035;
    spots.push({ x, y, r: 0.0004 + rnd() * 0.0007, d: 0.25 + rnd() * 0.35 });
  }
  for (const m of (F.moles || [])) spots.push({ x: m[0], y: m[1], r: m[2], d: m[3] });
  const spotAt = (x, y, z) => {
    if (z < 0.03 || y > 0.01 || y < -0.06) return 0;
    let s = 0;
    for (const sp of spots) {
      const d2 = ((x - sp.x) ** 2 + (y - sp.y) ** 2) / (sp.r * sp.r);
      if (d2 < 9) s = Math.max(s, sp.d * Math.exp(-d2 * 1.4));
    }
    return s;
  };

  const E = L.eyeL;
  const age = F.age || 0;
  const w = mouth.w;
  // distance helpers
  const segDist = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax, vy = by - ay; const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
    return [Math.hypot(px - ax - vx * t, py - ay - vy * t), t];
  };
  const groove = (d, wdt) => Math.exp(-((d / wdt) ** 2));

  // per texel feature evaluation
  function texel(i, x, y, z, nx, ny, nz, cr, cg, cb, u, v) {
    const ax = Math.abs(x);
    const tu = u * N, tv = v * N;
    if (z < -0.005 || y > 0.085) {
      // back of the head / scalp: pores and mottling only
      const pr0 = tsamp(pores, PT, tu, tv);
      const m0 = tfbm(tileB, T, tu * 0.02, tv * 0.02, 3) - 0.5;
      const k0 = 1 + m0 * 0.14;
      col[3 * i] = cr * k0; col[3 * i + 1] = cg * k0; col[3 * i + 2] = cb * k0;
      height[i] = pr0 * 0.00002;
      rough[i] = 0.6 + m0 * 0.1;
      return;
    }
    let h = 0;
    let dark = 0; // multiplicative darkening
    let red = 0;
    const front = sstep(0.0, 0.05, z);
    // --- pores: bigger on the nose and cheeks, finer on the forehead, none on lips
    const lipDy = y - mouth.lineY(clamp(x, -w, w));
    const onLip = (ax < w * 1.02 && z > 0.07) ? sstep(0.0012, 0.0, Math.abs(lipDy) - (lipDy > 0 ? mouth.upH(clamp(x, -w, w)) : mouth.loH(clamp(x, -w, w)))) : 0;
    const noseZ = Math.exp(-((x / 0.016) ** 2) - (((y + 0.02) / 0.02) ** 2)) * sstep(0.07, 0.09, z);
    const cheekZ = Math.exp(-(((ax - 0.036) / 0.02) ** 2) - (((y + 0.03) / 0.02) ** 2)) * front;
    const poreAmt = (0.55 + 0.6 * noseZ + 0.45 * cheekZ) * (1 - onLip) * front + 0.25 * (1 - front);
    const pr = tsamp(pores, PT, tu * 1.0, tv * 1.0);
    h += pr * 0.000028 * poreAmt;
    // micro grain / crosshatch
    const g1 = tsamp(tileA, T, tu * 0.9, tv * 0.9) - 0.5, g2 = tsamp(tileB, T, tu * 0.45 + tv * 0.45, tv * 0.45 - tu * 0.45) - 0.5;
    h += (g1 * 0.000008 + g2 * 0.000010) * (1 - 0.7 * onLip);
    // --- lips: vertical lines, slightly darker in the grooves
    if (onLip > 0) {
      const s = x / w;
      const ph = s * (F.lipLines || 34) + 0.35 * Math.sin(lipDy * 900 + s * 7) + 0.6 * (tsamp(tileA, T, s * 40, lipDy * 4000) - 0.5);
      const ln = Math.pow(Math.abs(Math.sin(ph * Math.PI)), 6);
      const across = lipDy > 0 ? sstep(0, 0.4, lipDy / (mouth.upH(clamp(x, -w, w)) + 1e-4)) : sstep(0, 0.35, -lipDy / (mouth.loH(clamp(x, -w, w)) + 1e-4));
      h -= ln * 0.00003 * onLip * (0.4 + 0.6 * across);
      dark += ln * 0.12 * onLip;
      // lower lip catches a soft highlight: lighter centre
      if (lipDy < 0) dark -= 0.1 * onLip * Math.exp(-((x / (w * 0.5)) ** 2)) * sstep(0.2, 0.6, -lipDy / (mouth.loH(clamp(x, -w, w)) + 1e-4));
    }
    // --- lid crease (upper lid fold) and fine lid lines
    {
      const ex = ax - E[0], ey = y - E[1], ez = z - E[2];
      const r = Math.hypot(ex, ey, ez);
      const el = Math.atan2(ey, ez);
      if (r < 0.03 && ez > 0 && Math.abs(ex) < 0.02) {
        const creaseEl = 0.72 + 0.12 * (ex / 0.02) ** 2;
        const c = groove(el - creaseEl, 0.05) * sstep(0.02, 0.012, Math.abs(ex));
        h -= c * 0.00012; dark += c * 0.18;
        if (age > 0) h -= age * 0.000012 * Math.pow(Math.abs(Math.sin((el - 0.4) * 55)), 3) * sstep(0.35, 0.5, el) * sstep(0.75, 0.6, el);
      }
      // under-eye lines (age) and tear trough
      if (age > 0 && ez > -0.005 && Math.abs(ex) < 0.02) {
        const d = Math.hypot(ex * 0.9, ey + 0.0155 + 0.00002 / (0.0004 + ex * ex) * 0);
        const ue = groove(Math.hypot(ex, (ey + 0.0152 - 0.12 * ex * ex / 0.02)) - 0.0, 0.0012) * sstep(0.02, 0.008, Math.abs(ex));
        void d;
        h -= age * ue * 0.00006; dark += age * ue * 0.05;
      }
      // crow's feet: rays out from the outer corner
      if (age > 0) {
        const cx = E[0] + 0.0145, cy = E[1] + 0.001;
        const du = ax - cx, dv = y - cy;
        const rr = Math.hypot(du, dv);
        if (du > -0.002 && rr < 0.024 && rr > 0.0025) {
          const ang = Math.atan2(dv, Math.max(du, 1e-5));
          let cf = 0;
          for (const [a0, st] of [[-0.75, 0.8], [-0.35, 1], [0.05, 1], [0.42, 0.85], [0.8, 0.5]]) {
            const wig = a0 + 0.025 * Math.sin(rr * 420 + a0 * 10);
            cf = Math.max(cf, st * groove((ang - wig) * rr, 0.00035) * sstep(0.02, 0.008, rr));
          }
          cf *= sstep(0.0025, 0.006, rr) * sstep(0.024, 0.012, rr);
          h -= age * cf * 0.00005; dark += age * cf * 0.035;
        }
      }
    }
    // --- forehead lines (age) and glabella
    if (age > 0 && z > 0.02) {
      let fl = 0;
      for (const [yy, st] of [[0.046, 0.8], [0.057, 1], [0.068, 0.7]]) {
        const wav = yy + 0.0018 * Math.sin(x * 55 + yy * 300) + 0.004 * (x / 0.05) ** 2;
        fl = Math.max(fl, st * groove(y - wav, 0.00055) * sstep(0.052, 0.025, ax));
      }
      h -= age * fl * 0.00006; dark += age * fl * 0.05;
      const gl = groove(ax - 0.0045, 0.0006) * sstep(0.011, 0.016, y) * sstep(0.034, 0.024, y);
      h -= age * gl * 0.00006; dark += age * gl * 0.04;
    }
    if ((F.foreheadLine || 0) > 0 && z > 0.02) {
      const fl = groove(y - 0.055 - 0.0015 * Math.sin(x * 50), 0.0006) * sstep(0.045, 0.02, ax);
      h -= F.foreheadLine * fl * 0.00004;
    }
    // --- nasolabial folds: from the nose wing to beside the mouth corner
    {
      const [d, t] = segDist(ax, y, 0.0165, -0.029, 0.0305, -0.066);
      const bend = d - 0.0012 * Math.sin(t * Math.PI);
      const nf = groove(bend, 0.0014 + 0.0012 * t) * sstep(1.02, 0.85, t) * front;
      h -= nf * 0.00018 * (F.nasolabial || 1); dark += nf * 0.09 * (F.nasolabial || 1);
      // marionette hint
      if (age > 0) {
        const [d2, t2] = segDist(ax, y, w + 0.002, mouth.lineY(w) - 0.002, w + 0.004, mouth.lineY(w) - 0.016);
        const mf = groove(d2, 0.001) * sstep(1, 0.6, t2);
        h -= age * mf * 0.00006; dark += age * mf * 0.04;
      }
    }
    // --- chin: a soft mentolabial crease
    {
      const mcY = mouth.lineY(0) - mouth.loH(0) - 0.0068;
      const mc = groove(y - mcY - 0.004 * (x / 0.02) ** 2, 0.0015) * sstep(0.02, 0.008, ax) * front;
      h -= mc * 0.00008;
    }
    // --- neck lines
    if ((F.neckLines || 0) > 0 && y < -0.11 && z > -0.02) {
      let nl = 0;
      for (const yy of [-0.128, -0.152]) nl = Math.max(nl, groove(y - yy - 0.006 * (x / 0.05) ** 2, 0.0008));
      h -= F.neckLines * nl * 0.00006; dark += F.neckLines * nl * 0.04;
    }
    // --- stubble
    if ((F.stubble || 0) > 0) {
      const beard = sstep(-0.035, -0.045, y + 0.25 * Math.max(0, ax - 0.03)) * sstep(0.075, 0.05, ax + Math.max(0, -z) * 0.5)
        * (1 - sstep(-0.13, -0.15, y)) * sstep(-0.035, -0.01, z);
      const mous = Math.exp(-(((y - mouth.lineY(0) - 0.012) / 0.005) ** 2)) * sstep(0.03, 0.02, ax) * sstep(0.07, 0.085, z);
      const lipClear = 1 - onLip;
      const dens = clamp(Math.max(beard, mous * 0.9)) * lipClear;
      if (dens > 0) {
        const dots = tsamp(pores, PT, tu * 1.7 + 91, tv * 1.7 + 37);
        const st = sstep(-0.25, -0.75, dots) * dens;
        dark += F.stubble * (0.18 * dens + 0.45 * st);
        h += st * 0.00002 * F.stubble;
      }
    }
    // --- pigment: mottling, spots, moles
    const mott = tfbm(tileB, T, tu * 0.02, tv * 0.02, 4) - 0.5;
    const fine = tfbm(tileA, T, tu * 0.18, tv * 0.18, 3) - 0.5;
    dark += -mott * 0.16 - fine * 0.07;
    const sp = spotAt(x, y, z);
    dark += sp * 0.55;
    red += (F.redness || 0) * (0.6 * noseZ + 0.4 * cheekZ) * (0.7 + 0.6 * tfbm(tileA, T, tu * 0.06, tv * 0.06, 2));
    // colour
    let r = cr, g = cg, b = cb;
    const k = clamp(1 - dark, 0.25, 1.3);
    r *= k * (1 + red * 0.18); g *= k * (1 - red * 0.06); b *= k * (1 - red * 0.08);
    // spots/moles are warmer/cooler dark browns
    col[3 * i] = r; col[3 * i + 1] = g; col[3 * i + 2] = b;
    height[i] = h;
    // roughness: T-zone and lips smoother, pores and stubble rougher
    let ro = 0.62 - 0.14 * noseZ - 0.08 * sstep(0.03, 0.06, y) * front - 0.22 * onLip + 0.06 * cheekZ;
    ro += (tfbm(tileB, T, tu * 0.3, tv * 0.3, 2) - 0.5) * 0.12 - pr * 0.08 * poreAmt;
    rough[i] = clamp(ro, 0.15, 0.95);
  }

  // ---- rasterize
  const P = positions, Nn = normals;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (!bakeMask[a] || !bakeMask[b] || !bakeMask[c]) continue;
    const ua = uvs[2 * a] * N, va = uvs[2 * a + 1] * N, ub = uvs[2 * b] * N, vb = uvs[2 * b + 1] * N, uc = uvs[2 * c] * N, vc = uvs[2 * c + 1] * N;
    const area = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
    if (Math.abs(area) < 1e-9) continue;
    // triangles wrapping around the back pole of the projection span the disc: skip
    if (Math.max(Math.abs(ub - ua), Math.abs(uc - ua), Math.abs(vb - va), Math.abs(vc - va)) > N * 0.06) continue;
    // world units per texel along u and v for this triangle (Jacobian)
    const e1 = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]];
    const e2 = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]];
    const du1 = ub - ua, dv1 = vb - va, du2 = uc - ua, dv2 = vc - va;
    const inv = 1 / (du1 * dv2 - du2 * dv1);
    const dPdu = [(e1[0] * dv2 - e2[0] * dv1) * inv, (e1[1] * dv2 - e2[1] * dv1) * inv, (e1[2] * dv2 - e2[2] * dv1) * inv];
    const dPdv = [(e2[0] * du1 - e1[0] * du2) * inv, (e2[1] * du1 - e1[1] * du2) * inv, (e2[2] * du1 - e1[2] * du2) * inv];
    const su = Math.hypot(...dPdu), sv = Math.hypot(...dPdv);
    const x0 = Math.max(0, Math.floor(Math.min(ua, ub, uc))), x1 = Math.min(N - 1, Math.ceil(Math.max(ua, ub, uc)));
    const y0 = Math.max(0, Math.floor(Math.min(va, vb, vc))), y1 = Math.min(N - 1, Math.ceil(Math.max(va, vb, vc)));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const qx = px + 0.5, qy = py + 0.5;
      let w0 = ((ub - qx) * (vc - qy) - (uc - qx) * (vb - qy)) / area;
      let w1 = ((uc - qx) * (va - qy) - (ua - qx) * (vc - qy)) / area;
      let w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      const i = py * N + px;
      if (covered[i]) continue;
      covered[i] = 1;
      w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
      const s = w0 + w1 + w2; w0 /= s; w1 /= s; w2 /= s;
      const x = P[3 * a] * w0 + P[3 * b] * w1 + P[3 * c] * w2;
      const y = P[3 * a + 1] * w0 + P[3 * b + 1] * w1 + P[3 * c + 1] * w2;
      const z = P[3 * a + 2] * w0 + P[3 * b + 2] * w1 + P[3 * c + 2] * w2;
      const cr = colors[3 * a] * w0 + colors[3 * b] * w1 + colors[3 * c] * w2;
      const cg = colors[3 * a + 1] * w0 + colors[3 * b + 1] * w1 + colors[3 * c + 1] * w2;
      const cb = colors[3 * a + 2] * w0 + colors[3 * b + 2] * w1 + colors[3 * c + 2] * w2;
      scaleU[i] = su; scaleV[i] = sv;
      texel(i, x, y, z, 0, 0, 0, cr, cg, cb, qx / N, qy / N);
    }
  }
  // ---- dilate a few texels so filtering never pulls in the background
  for (let pass = 0; pass < 4; pass++) {
    const add = [];
    for (let py = 1; py < N - 1; py++) for (let px = 1; px < N - 1; px++) {
      const i = py * N + px;
      if (covered[i]) continue;
      let n = 0, r = 0, g = 0, b = 0, h = 0, ro = 0, su = 0, sv = 0;
      for (const j of [i - 1, i + 1, i - N, i + N]) if (covered[j] === 1) {
        n++; r += col[3 * j]; g += col[3 * j + 1]; b += col[3 * j + 2]; h += height[j]; ro += rough[j]; su += scaleU[j]; sv += scaleV[j];
      }
      if (n) add.push([i, r / n, g / n, b / n, h / n, ro / n, su / n, sv / n]);
    }
    for (const [i, r, g, b, h, ro, su, sv] of add) {
      col[3 * i] = r; col[3 * i + 1] = g; col[3 * i + 2] = b; height[i] = h; rough[i] = ro; scaleU[i] = su; scaleV[i] = sv; covered[i] = 1;
    }
  }
  // ---- pack colour (sRGB) + roughness
  const cdata = new Uint8Array(N * N * 4);
  const toS = c => { c = clamp(c, 0, 1); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };
  // uncovered texels (the projection's rim/pole) take the mean colour of the outer ring
  let fr = 0, fg = 0, fb = 0, fn = 0;
  for (let py = 0; py < N; py += 2) for (let px = 0; px < N; px += 2) {
    const i = py * N + px; if (covered[i] !== 1) continue;
    const r = Math.hypot(px / N - 0.5, py / N - 0.5) * 2;
    if (r < 0.82 || r > 0.97) continue;
    fr += col[3 * i]; fg += col[3 * i + 1]; fb += col[3 * i + 2]; fn++;
  }
  if (fn) { fr /= fn; fg /= fn; fb /= fn; }
  for (let i = 0; i < N * N; i++) {
    if (!covered[i]) { cdata[4 * i] = toS(fr); cdata[4 * i + 1] = toS(fg); cdata[4 * i + 2] = toS(fb); cdata[4 * i + 3] = 150; continue; }
    cdata[4 * i] = toS(col[3 * i]); cdata[4 * i + 1] = toS(col[3 * i + 1]); cdata[4 * i + 2] = toS(col[3 * i + 2]);
    cdata[4 * i + 3] = Math.round(rough[i] * 255);
  }
  // neutral patch (white, mid roughness) for interior/ear UVs in the top-right corner
  for (let py = N - 24; py < N; py++) for (let px = N - 24; px < N; px++) {
    const i = py * N + px; cdata[4 * i] = cdata[4 * i + 1] = cdata[4 * i + 2] = 255; cdata[4 * i + 3] = 140; covered[i] = 2;
  }
  // ---- normals from height
  const ndata = new Uint8Array(N * N * 4);
  const strength = F.normalStrength || 1;
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const i = py * N + px;
    let nx = 0, ny = 0;
    if (covered[i] === 1 && px > 0 && px < N - 1 && py > 0 && py < N - 1) {
      const hl = covered[i - 1] === 1 ? height[i - 1] : height[i], hr = covered[i + 1] === 1 ? height[i + 1] : height[i];
      const hd = covered[i - N] === 1 ? height[i - N] : height[i], hu = covered[i + N] === 1 ? height[i + N] : height[i];
      const su = Math.max(scaleU[i], 1e-6), sv = Math.max(scaleV[i], 1e-6);
      nx = -(hr - hl) / (2 * su) * strength;
      ny = -(hu - hd) / (2 * sv) * strength;
    }
    const l = Math.hypot(nx, ny, 1);
    ndata[4 * i] = Math.round((nx / l * 0.5 + 0.5) * 255);
    ndata[4 * i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
    ndata[4 * i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    ndata[4 * i + 3] = 255;
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4; t.needsUpdate = true;
    return t;
  };
  return { map: mk(cdata, true), normalMap: mk(ndata, false) };
}

export const NEUTRAL_UV = [1 - 12 / 2048, 1 - 12 / 2048];
