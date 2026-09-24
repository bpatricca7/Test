// Lofted, skinned geometry: rings of vertices swept along a path of stations.
// UVs are in metres (u around, v along) so tiling fabric textures keep a
// physical scale. Skin weights come from a callback per vertex.

import * as THREE from 'three';

/**
 * stations: [{ c: Vector3, X: Vector3, Z: Vector3, shape: theta => [dx, dz], mat?: int }]
 * opts: { M, th0, th1 (partial ring), capStart, capEnd, rRef, weights(i, th, P) -> [[bone, w]...],
 *         color(i, th, P) -> [r,g,b], offset(i, th) -> radial add, seamBack (put the wrap seam at the back) }
 */
export function loft(stations, opts) {
  const M = opts.M || 32;
  const partial = opts.th0 !== undefined;
  const th0 = partial ? opts.th0 : (opts.seamBack === false ? 0 : Math.PI);
  const cols = partial ? M : M + 1; // closed rings duplicate the seam column for UVs
  const P = [], UV = [], SI = [], SW = [], C = [], idx = [];
  const groups = [];
  const rRef = opts.rRef || 0.1;
  let vAcc = 0;
  let prevC = null;
  const ringStart = [];
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    if (prevC) vAcc += st.c.distanceTo(prevC);
    prevC = st.c;
    ringStart.push(P.length / 3);
    const t0 = partial ? (typeof opts.th0 === 'function' ? opts.th0(i) : opts.th0) : th0;
    const t1 = partial ? (typeof opts.th1 === 'function' ? opts.th1(i) : opts.th1) : th0 + Math.PI * 2;
    for (let j = 0; j < cols; j++) {
      const th = t0 + (t1 - t0) * j / (partial ? M - 1 : M);
      let [dx, dz] = st.shape(th, i);
      if (opts.offset) {
        const o = opts.offset(i, th);
        if (o) { const l = Math.hypot(dx, dz) || 1; dx += dx / l * o; dz += dz / l * o; }
      }
      const p = st.c.clone().addScaledVector(st.X, dx).addScaledVector(st.Z, dz);
      P.push(p.x, p.y, p.z);
      UV.push((th - (partial ? 0 : th0)) * rRef, vAcc);
      const w = opts.weights(i, th, p, j);
      pushWeights(SI, SW, w);
      const c = opts.color ? opts.color(i, th, p) : [1, 1, 1];
      C.push(c[0], c[1], c[2]);
    }
  }
  const matOf = i => stations[i].mat || 0;
  // quads, grouped by material
  const byMat = {};
  for (let i = 0; i < stations.length - 1; i++) {
    const m = matOf(i);
    (byMat[m] = byMat[m] || []);
    const a0 = ringStart[i], b0 = ringStart[i + 1];
    const segs = partial ? M - 1 : M;
    for (let j = 0; j < segs; j++) {
      const a = a0 + j, b = a0 + j + 1, c = b0 + j + 1, d = b0 + j;
      if (opts.flip) byMat[m].push(a, c, b, a, d, c); else byMat[m].push(a, b, c, a, c, d);
    }
  }
  // caps
  const cap = (ri, flip, m) => {
    const st = stations[ri];
    const ci = P.length / 3;
    P.push(st.c.x, st.c.y, st.c.z);
    UV.push(0, ri === 0 ? 0 : vAcc);
    pushWeights(SI, SW, opts.weights(ri, 0, st.c, -1));
    const c = opts.color ? opts.color(ri, 0, st.c) : [1, 1, 1];
    C.push(c[0], c[1], c[2]);
    const a0 = ringStart[ri];
    (byMat[m] = byMat[m] || []);
    for (let j = 0; j < M; j++) {
      const a = a0 + j, b = a0 + j + 1;
      if (flip !== !!opts.flip) byMat[m].push(ci, b, a); else byMat[m].push(ci, a, b);
    }
  };
  if (opts.capStart && !partial) cap(0, false, matOf(0));
  if (opts.capEnd && !partial) cap(stations.length - 1, true, matOf(stations.length - 2));
  for (const m of Object.keys(byMat).sort()) {
    groups.push({ start: idx.length, count: byMat[m].length, materialIndex: +m });
    idx.push(...byMat[m]);
  }
  return { P, UV, SI, SW, C, idx, groups, ringStart, cols, stations };
}

function pushWeights(SI, SW, w) {
  // keep the 4 largest
  const arr = w.filter(q => q[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  let s = 0; for (const q of arr) s += q[1];
  for (let k = 0; k < 4; k++) {
    if (k < arr.length) { SI.push(arr[k][0]); SW.push(arr[k][1] / (s || 1)); } else { SI.push(0); SW.push(0); }
  }
}

/** merge several loft parts into one BufferGeometry (optionally with groups) */
export function toGeometry(parts, { keepGroups = true } = {}) {
  const P = [], UV = [], SI = [], SW = [], C = [], idx = [];
  const groups = [];
  for (const part of parts) {
    const base = P.length / 3;
    P.push(...part.P); UV.push(...part.UV); SI.push(...part.SI); SW.push(...part.SW); C.push(...part.C);
    for (const g of part.groups) {
      const start = idx.length;
      for (let i = g.start; i < g.start + g.count; i++) idx.push(part.idx[i] + base);
      groups.push({ start, count: g.count, materialIndex: g.materialIndex });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(idx);
  if (keepGroups) {
    // merge adjacent groups with the same material
    const merged = [];
    for (const gr of groups.sort((a, b) => a.materialIndex - b.materialIndex || a.start - b.start)) merged.push(gr);
    // rebuild index so each material is contiguous
    const byM = {};
    for (const gr of merged) (byM[gr.materialIndex] = byM[gr.materialIndex] || []).push(gr);
    const idx2 = [];
    for (const m of Object.keys(byM).sort((a, b) => a - b)) {
      const start = idx2.length;
      for (const gr of byM[m]) for (let i = gr.start; i < gr.start + gr.count; i++) idx2.push(idx[i]);
      g.addGroup(start, idx2.length - start, +m);
    }
    g.setIndex(idx2);
  }
  g.computeVertexNormals();
  smoothSeams(g);
  return g;
}

/** average normals of coincident vertices (loft wrap seams) */
export function smoothSeams(g) {
  const P = g.attributes.position.array, N = g.attributes.normal.array;
  const map = new Map();
  const q = 1e5;
  for (let i = 0; i < P.length / 3; i++) {
    const k = Math.round(P[3 * i] * q) + ',' + Math.round(P[3 * i + 1] * q) + ',' + Math.round(P[3 * i + 2] * q);
    let a = map.get(k); if (!a) map.set(k, a = []); a.push(i);
  }
  for (const a of map.values()) {
    if (a.length < 2) continue;
    let x = 0, y = 0, z = 0;
    for (const i of a) { x += N[3 * i]; y += N[3 * i + 1]; z += N[3 * i + 2]; }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of a) { N[3 * i] = x / l; N[3 * i + 1] = y / l; N[3 * i + 2] = z / l; }
  }
}

export const sgnpow = (x, p) => Math.sign(x) * Math.pow(Math.abs(x), p);

/** superellipse with separate front/back depth */
export function torsoShape(a, bF, bB, n = 2.4) {
  const e = 2 / n;
  return th => {
    const s = Math.sin(th), c = Math.cos(th);
    return [a * sgnpow(s, e), (c >= 0 ? bF : bB) * sgnpow(c, e)];
  };
}
