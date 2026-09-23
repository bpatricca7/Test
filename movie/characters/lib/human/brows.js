// Eyebrows made of individual hair strips lying on the skin. Each strip vertex
// is bound to the nearest skin vertex and follows the face deformation.

import * as THREE from 'three';
import { rayEnter, gradient, clamp, mix, sstep } from './sdf.js';

export const BROW_SHAPES = {
  maya: { inner: [0.0132, 0.0205], peak: [0.0405, 0.0322], tail: [0.0585, 0.0245], peakU: 0.62,
    th: [0.0062, 0.0042, 0.0016], count: 78, len: [0.0062, 0.0085, 0.0062], width: 0.00030, grey: 0.12 },
  sam: { inner: [0.0128, 0.0215], peak: [0.0400, 0.0300], tail: [0.0580, 0.0255], peakU: 0.58,
    th: [0.0078, 0.0056, 0.0024], count: 104, len: [0.0066, 0.0088, 0.0066], width: 0.00034, grey: 0 },
};

function browCurve(B, u) {
  // piecewise quadratic through inner -> peak -> tail
  if (u <= B.peakU) {
    const t = u / B.peakU;
    const x = mix(B.inner[0], B.peak[0], t);
    const y = mix(B.inner[1], B.peak[1], 1 - (1 - t) * (1 - t));
    return [x, y];
  }
  const t = (u - B.peakU) / (1 - B.peakU);
  return [mix(B.peak[0], B.tail[0], t), mix(B.peak[1], B.tail[1], t * t)];
}
function browThick(B, u) {
  return u <= B.peakU ? mix(B.th[0], B.th[1], u / B.peakU) : mix(B.th[1], B.th[2], (u - B.peakU) / (1 - B.peakU));
}

/** density of the brow band at a head-local point (for the skin tint), per side */
export function browDensity(B, x, y) {
  const ax = Math.abs(x);
  if (ax < B.inner[0] - 0.004 || ax > B.tail[0] + 0.004) return 0;
  // find u by x (monotonic)
  const u = clamp((ax - B.inner[0]) / (B.tail[0] - B.inner[0]));
  // refine: search nearest along the curve
  let best = 1e9, bu = u;
  for (let i = 0; i <= 24; i++) {
    const uu = i / 24;
    const c = browCurve(B, uu);
    const d = (c[0] - ax) ** 2 + (c[1] - y) ** 2;
    if (d < best) { best = d; bu = uu; }
  }
  const c = browCurve(B, bu);
  const th = browThick(B, bu);
  const dy = y - c[1];
  const along = sstep(-0.004, 0.002, ax - B.inner[0]) * (1 - sstep(-0.001, 0.004, ax - B.tail[0]));
  return Math.exp(-((dy / (th * 0.6)) ** 2)) * along;
}

export function createBrows(id, f, rig, rnd, colors) {
  const B = BROW_SHAPES[id];
  const verts = [], cols = [], tang = [], idx = [];
  const bind = [];
  const g3 = [0, 0, 0];
  const surf = (x, y, lift) => {
    const t = rayEnter(f, x, y, 0.2, 0, 0, -1, 0.3);
    const z = 0.2 - t;
    gradient(f, x, y, z, g3);
    return [x + g3[0] * lift, y + g3[1] * lift, z + g3[2] * lift, g3[0], g3[1], g3[2]];
  };
  const SEG = 3;
  for (const side of [1, -1]) {
    for (let i = 0; i < B.count; i++) {
      // sample u with more strands where the brow is thick
      let u;
      for (let tries = 0; tries < 8; tries++) { u = rnd(); if (rnd() < browThick(B, u) / B.th[0]) break; }
      const c = browCurve(B, u);
      const th = browThick(B, u);
      const v = (rnd() - 0.5) * 1.1;
      // direction: inner head grows up, the body grows outward; lower hairs angle up, upper down
      const baseAng = mix(1.35, 0.12, sstep(0.0, 0.32, u)) - sstep(B.peakU - 0.1, 1, u) * 0.38;
      const ang = baseAng - v * 0.55 + (rnd() - 0.5) * 0.3;
      const len = (u < 0.3 ? mix(B.len[0], B.len[1], u / 0.3) : mix(B.len[1], B.len[2], (u - 0.3) / 0.7)) * (0.75 + 0.45 * rnd());
      const x0 = c[0] - Math.cos(ang) * len * 0.35, y0 = c[1] + v * th - Math.sin(ang) * len * 0.35;
      const grey = rnd() < B.grey;
      const colr = grey ? colors.grey : colors.brow;
      const shade = 0.75 + 0.5 * rnd();
      const base = verts.length / 3;
      const dirx = Math.cos(ang) * side, diry = Math.sin(ang);
      for (let s = 0; s <= SEG; s++) {
        const q = s / SEG;
        const px = (x0 * side) + dirx * len * q, py = y0 + diry * len * q - 0.0006 * q * q * (u > 0.4 ? 1 : 0);
        const lift = 0.00032 + 0.0005 * q;
        const P = surf(px, py, lift);
        // ribbon width across the strand, in the skin plane
        const nx = P[3], ny = P[4], nz = P[5];
        let wx = ny * 0 - nz * diry, wy = nz * dirx - nx * 0, wz = nx * diry - ny * dirx;
        const wl = Math.hypot(wx, wy, wz) || 1; wx /= wl; wy /= wl; wz /= wl;
        const wd = B.width * (1 - 0.85 * q) * 0.5;
        verts.push(P[0] - wx * wd, P[1] - wy * wd, P[2] - wz * wd, P[0] + wx * wd, P[1] + wy * wd, P[2] + wz * wd);
        for (let k = 0; k < 2; k++) {
          cols.push(colr[0] * shade, colr[1] * shade, colr[2] * shade);
          tang.push(dirx, diry, 0);
        }
      }
      for (let s = 0; s < SEG; s++) {
        const a = base + 2 * s;
        if (side > 0) idx.push(a, a + 1, a + 3, a, a + 3, a + 2); else idx.push(a, a + 3, a + 1, a, a + 2, a + 3);
      }
    }
  }
  // bind each strand vertex to the nearest skin vertex (brow region only)
  const rest = rig.rest;
  const cand = [];
  for (let v = 0; v < rest.length / 3; v++) if (rest[3 * v + 1] > 0.004 && rest[3 * v + 2] > 0.04 && Math.abs(rest[3 * v]) < 0.07) cand.push(v);
  for (let i = 0; i < verts.length; i += 3) {
    let best = 1e9, bv = 0;
    for (const v of cand) {
      const d = (rest[3 * v] - verts[i]) ** 2 + (rest[3 * v + 1] - verts[i + 1]) ** 2 + (rest[3 * v + 2] - verts[i + 2]) ** 2;
      if (d < best) { best = d; bv = v; }
    }
    bind.push(bv);
  }
  const restV = Float32Array.from(verts);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(verts), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('hairTangent', new THREE.Float32BufferAttribute(tang, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  function update() {
    const out = rig.out, P = g.attributes.position.array;
    for (let i = 0; i < bind.length; i++) {
      const v = 3 * bind[i], o = 3 * i;
      P[o] = restV[o] + out[v] - rest[v];
      P[o + 1] = restV[o + 1] + out[v + 1] - rest[v + 1];
      P[o + 2] = restV[o + 2] + out[v + 2] - rest[v + 2];
    }
    g.attributes.position.needsUpdate = true;
  }
  return { geometry: g, update };
}
