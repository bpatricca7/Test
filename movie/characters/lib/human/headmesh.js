// Builds the face/head mesh from the head SDF.
//
// Topology is designed, not polygonized: structured edge-loop zones around
// each eye (the lid margins, which continue inward as the lid rim and a
// tuck behind the lids) and around the mouth (lip rings that roll inward into
// a closed mouth bag). The rest of the head is a Poisson-disk point set
// ray-cast onto the SDF and triangulated with a spherical Delaunay (the convex
// hull of the directions from the head centre), stitched to the zones' outer
// loops. Every morph/deformer then acts on this one fixed vertex set.

import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import * as THREE from 'three';
import { rayExit, rayEnter, gradient, clamp, mix, sstep } from './sdf.js';

const DEG = Math.PI / 180;

export const LID_SHAPES = {
  maya: { phiIn: -53, phiOut: 55, thIn: -3, thOut: 2.5, U: 23, tU: 0.45, Lo: 21, tL: 0.58 },
  sam: { phiIn: -53, phiOut: 55, thIn: -3, thOut: 1.5, U: 27, tU: 0.47, Lo: 23, tL: 0.56 },
};

function bump(t, tp, p = 0.75) {
  if (t <= 0 || t >= 1) return 0;
  const w = Math.pow(t, Math.log(0.5) / Math.log(tp));
  return Math.pow(Math.sin(Math.PI * w), p);
}

/** lid geometry helper shared with the rig */
export function makeLids(shape) {
  const S = shape;
  const phiAt = t => mix(S.phiIn, S.phiOut, t) * DEG;
  const thC = t => mix(S.thIn, S.thOut, t) * DEG;
  const thU = t => thC(t) + S.U * DEG * bump(t, S.tU, 0.7);
  const thL = t => thC(t) - S.Lo * DEG * bump(t, S.tL, 0.8);
  return { phiAt, thC, thU, thL, S };
}

export function buildHeadMesh(H, id, opt = {}) {
  const f = H.f, L = H.landmarks;
  const lids = makeLids(LID_SHAPES[id]);
  const pos = [];
  const M = { kind: [], side: [], ring: [], seg: [], upper: [], lidT: [], mx: [] };
  const tris = [];
  const addV = (x, y, z, kind, side = 0, ring = 0, seg = 0, upper = 0, lidT = 0, mx = 0) => {
    pos.push(x, y, z);
    M.kind.push(kind); M.side.push(side); M.ring.push(ring); M.seg.push(seg); M.upper.push(upper);
    M.lidT.push(lidT); M.mx.push(mx);
    return pos.length / 3 - 1;
  };
  const zones = [];

  // ---------------------------------------------------------------- eyes ---
  const ME = opt.eyeSegs || 72, KE = 11;
  const R = L.eyeRadius, Rs = L.shellR;
  const outerE = opt.eyeOuter || { dx: 0.0015, dy: 0.0035, inner: 0.0215, outer: 0.0215, up: 0.026, down: 0.0205 };
  for (const side of [1, -1]) {
    const C = side > 0 ? L.eyeL : L.eyeR;
    const dir = (phi, th) => [side * Math.sin(phi) * Math.cos(th), Math.sin(th), Math.cos(phi) * Math.cos(th)];
    // ring 0 (lid margin) in eye angles; its frontal projection seeds the outer rings
    const margin = [];
    for (let j = 0; j < ME; j++) {
      const a = 2 * Math.PI * j / ME;
      const t = 0.5 + 0.5 * Math.cos(a);
      const up = Math.sin(a) >= 0;
      margin.push({ phi: lids.phiAt(t), th: up ? lids.thU(t) : lids.thL(t), t, a,
        up: up ? (Math.abs(Math.sin(a)) < 1e-6 ? 0.5 : 1) : 0 });
    }
    // chart: frontal projection, mirrored so +u is lateral
    const chart = p => [(p[0] - C[0]) * side, p[1] - C[1], p[2]];
    const ringXY = (k, j) => {
      const m = margin[j];
      const d = dir(m.phi, m.th);
      const u0 = d[0] * side * Rs, v0 = d[1] * Rs;
      const ca = Math.cos(m.a), sa = Math.sin(m.a);
      const uK = outerE.dx + (ca >= 0 ? outerE.outer : outerE.inner) * ca;
      const vK = outerE.dy + (sa >= 0 ? outerE.up : outerE.down) * sa;
      const g = Math.pow(k / KE, 1.45);
      return [mix(u0, uK, g), mix(v0, vK, g)];
    };
    const rings = {};
    for (let k = -3; k <= KE; k++) {
      rings[k] = [];
      for (let j = 0; j < ME; j++) {
        const m = margin[j];
        const kind = k < 0 ? 2 : 1;
        if (k <= 0) {
          let phi = m.phi, th = m.th, rho = Rs;
          if (k < 0) {
            // tuck under the lid, sliding along the eyeball
            const q1 = ringXY(1, j), d0 = dir(phi, th);
            let ox = q1[0] - d0[0] * side * Rs, oy = q1[1] - d0[1] * Rs;
            const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
            const push = [0, 0, 5 * DEG, 14 * DEG][-k];
            phi += ox * push; th += oy * push;
            rho = [0, R + 0.00055, R + 0.0003, R + 0.00022][-k];
          }
          const d = dir(phi, th);
          if (k === 0) rho = Math.max(Rs, Math.min(Rs + 0.0008, rayExit(f, C[0], C[1], C[2], d[0], d[1], d[2], 0.05)));
          rings[k].push(addV(C[0] + d[0] * rho, C[1] + d[1] * rho, C[2] + d[2] * rho, kind, side, k, j, m.up, m.t));
        } else {
          const [u, v] = ringXY(k, j);
          const x = C[0] + u * side, y = C[1] + v;
          const tt = rayEnter(f, x, y, 0.2, 0, 0, -1, 0.35);
          rings[k].push(addV(x, y, 0.2 - tt, kind, side, k, j, m.up, m.t));
        }
      }
    }
    for (let k = -3; k < KE; k++) {
      for (let j = 0; j < ME; j++) {
        const j1 = (j + 1) % ME;
        const a = rings[k][j], b = rings[k][j1], c = rings[k + 1][j1], d = rings[k + 1][j];
        tris.push(a, b, c, a, c, d);
      }
    }
    zones.push({ name: side > 0 ? 'eyeL' : 'eyeR', rings, K: KE, M: ME, chart, front: q => q[2] > 0.03 });
  }

  // --------------------------------------------------------------- mouth ---
  const MM = opt.mouthSegs || 96;
  const mo = H.mouth, w = mo.w;
  const aUp = [0, 0.13, 0.32, 0.56, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
  const bUp = [0, 0, 0, 0, 0, 0.0003, 0.0015, 0.0031, 0.0052, 0.0077, 0.0106, 0.0138];
  const aLo = aUp;
  const bLo = [0, 0, 0, 0, 0, 0.0003, 0.0016, 0.0034, 0.0057, 0.0085, 0.0118, 0.0156];
  const eK = [0, 0.0004, 0.0009, 0.0015, 0.0022, 0.003, 0.004, 0.0052, 0.0066, 0.0083, 0.0103, 0.0126];
  const KM = aUp.length - 1;
  const mouthRings = {};
  const chartM = (k, j) => {
    const a = 2 * Math.PI * j / MM;
    const ca = Math.cos(a), sa = Math.sin(a);
    const X = (w + eK[k]) * ca;
    const Xc = clamp(X, -w, w);
    const up = sa >= 0;
    const V = up ? aUp[k] * mo.upH(Xc) + bUp[k] : aLo[k] * mo.loH(Xc) + bLo[k];
    const s = Math.pow(Math.abs(sa), 0.85) * (up ? 1 : -1);
    return [X, mo.lineY(Xc) + s * V, up ? (Math.abs(sa) < 1e-6 ? 0.5 : 1) : 0];
  };
  for (let k = 0; k <= KM; k++) {
    mouthRings[k] = [];
    for (let j = 0; j < MM; j++) {
      const [X, Y, up] = chartM(k, j);
      let z;
      if (k === 0) {
        const t = rayEnter(f, X, Y, 0.2, 0, 0, -1, 0.3);
        z = t < 0 ? mo.lineZ(X) : 0.2 - t;
      } else {
        const t = rayEnter(f, X, Y, 0.2, 0, 0, -1, 0.3);
        z = 0.2 - t;
      }
      mouthRings[k].push(addV(X, Y, z, 3, 0, k, j, up, 0, X / w));
    }
  }
  // the mouth bag: lips roll in, then a pouch behind the teeth
  const bag = [
    [0.00055, 0.0018, 1.0], [0.0034, 0.0034, 1.02], [0.0098, 0.0052, 1.06, 0.0085, 0.0062],
    [0.0128, 0.0125, 1.1], [0.0100, 0.024, 1.0], [0.0042, 0.032, 0.62],
  ];
  const z0 = mo.lineZ(0);
  for (let b = 1; b <= bag.length; b++) {
    const [dyU, dz, sc, dyL = dyU, dzL = dz] = bag[b - 1];
    mouthRings[-b] = [];
    for (let j = 0; j < MM; j++) {
      const a = 2 * Math.PI * j / MM;
      const ca = Math.cos(a), sa = Math.sin(a);
      const up = sa >= 0;
      const X = w * sc * ca;
      const Xc = clamp(X / sc, -w, w);
      const taper = Math.pow(Math.abs(sa), 0.7);
      const dy = (up ? dyU : -dyL) * taper;
      const zz = b <= 2 ? mo.lineZ(Xc) - (up ? dz : dzL) : Math.min(mo.lineZ(Xc), z0 - 0.004) - (up ? dz : dzL) * (0.75 + 0.25 * taper);
      mouthRings[-b].push(addV(X, mo.lineY(Xc) + dy, zz, 4, 0, -b, j, up ? (Math.abs(sa) < 1e-6 ? 0.5 : 1) : 0, 0, X / w));
    }
  }
  const nb = bag.length;
  const capV = addV(0, mo.lineY(0) + 0.001, z0 - 0.036, 5, 0, -nb - 1, 0, 0.5, 0, 0);
  for (let k = -nb; k < KM; k++) {
    for (let j = 0; j < MM; j++) {
      const j1 = (j + 1) % MM;
      const a = mouthRings[k][j], b = mouthRings[k][j1], c = mouthRings[k + 1][j1], d = mouthRings[k + 1][j];
      tris.push(a, b, c, a, c, d);
    }
  }
  for (let j = 0; j < MM; j++) tris.push(capV, mouthRings[-nb][(j + 1) % MM], mouthRings[-nb][j]);
  zones.push({ name: 'mouth', rings: mouthRings, K: KM, M: MM, chart: p => [p[0], p[1], p[2]], front: q => q[2] > 0.03, first: [mouthRings[0][0], mouthRings[0][1], mouthRings[1][1]], zoneTriStart: 0 });

  // fix winding of each structured zone against the SDF gradient
  {
    const g = [0, 0, 0];
    // per-zone triangles are contiguous: eyes then mouth; check each block
    const blocks = [];
    let start = 0;
    const eyeTris = (KE + 3) * ME * 2 * 3;
    blocks.push([0, eyeTris, zones[0]]); blocks.push([eyeTris, 2 * eyeTris, zones[1]]);
    blocks.push([2 * eyeTris, tris.length, zones[2]]);
    for (const [s0, s1, zn] of blocks) {
      // test a triangle on ring K-1..K (outer skin) of this zone
      const K = zn.K;
      const a = zn.rings[K - 1][Math.floor(zn.M / 4)], b = zn.rings[K - 1][Math.floor(zn.M / 4) + 1], c = zn.rings[K][Math.floor(zn.M / 4) + 1];
      const n = triNormal(pos, a, b, c);
      const cx = (pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3, cy = (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3, cz = (pos[3 * a + 2] + pos[3 * b + 2] + pos[3 * c + 2]) / 3;
      gradient(f, cx, cy, cz, g);
      if (n[0] * g[0] + n[1] * g[1] + n[2] * g[2] < 0) {
        for (let i = s0; i < s1; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; }
      }
      start = s1;
    }
  }

  // ---------------------------------------------------------- background ---
  const O = opt.center || [0, -0.02, -0.02];
  const hAt = opt.spacing || defaultSpacing;
  // zone keep-out: point-in-polygon against each zone's outer ring in its chart
  // all stitching tests use the same chart as the Delaunay: gnomonic directions from O
  const chartO = p => { const dz = p[2] - O[2]; return [(p[0] - O[0]) / dz, (p[1] - O[1]) / dz, dz]; };
  for (const zn of zones) { zn.chart = chartO; zn.front = q => q[2] > 0.03; }
  const polys = zones.map(zn => zn.rings[zn.K].map(v => zn.chart([pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]])));
  const inPoly = (poly, q) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const inZone = p => zones.some((zn, i) => { const q = zn.chart(p); return zn.front(q) && inPoly(polys[i], q); });

  // Poisson hash
  const CELL = 0.003;
  const grid = new Map();
  const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  const gAdd = (x, y, z, idx) => {
    const k = key(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL));
    let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(idx);
  };
  const tooClose = (x, y, z, r) => {
    const n = Math.ceil(r / CELL);
    const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL), ck = Math.floor(z / CELL);
    const r2 = r * r;
    for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) for (let k = ck - n; k <= ck + n; k++) {
      const a = grid.get(key(i, j, k)); if (!a) continue;
      for (const v of a) {
        const dx = pos[3 * v] - x, dy = pos[3 * v + 1] - y, dz = pos[3 * v + 2] - z;
        if (dx * dx + dy * dy + dz * dz < r2) return true;
      }
    }
    return false;
  };
  const fence = new Set();
  const outerRing = new Map(); // vertex -> zone index
  zones.forEach((zn, zi) => {
    for (const v of zn.rings[zn.K]) { gAdd(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2], v); outerRing.set(v, zi); }
    for (const v of zn.rings[zn.K - 1]) fence.add(v);
  });
  // candidates: a Fibonacci sphere of directions, denser over the face
  const cands = [];
  const fib = (n, keep) => {
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), th = ga * i;
      const d = [Math.cos(th) * r, y, Math.sin(th) * r];
      if (keep(d)) cands.push(d);
    }
  };
  fib(opt.nCoarse || 26000, d => !(d[2] > 0.35 && d[1] > -0.75 && d[1] < 0.55));
  fib(opt.nFine || 70000, d => d[2] > 0.35 && d[1] > -0.75 && d[1] < 0.55);
  // deterministic shuffle
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
  const bgStart = pos.length / 3;
  for (const d of cands) {
    const t = rayExit(f, O[0], O[1], O[2], d[0], d[1], d[2], 0.4);
    if (t >= 0.399) continue;
    const x = O[0] + d[0] * t, y = O[1] + d[1] * t, z = O[2] + d[2] * t;
    if (opt.cutY != null && y < opt.cutY) continue;
    const p = [x, y, z];
    if (inZone(p)) continue;
    const h = hAt(p, L);
    if (tooClose(x, y, z, h * 0.88)) continue;
    const v = addV(x, y, z, 0);
    gAdd(x, y, z, v);
  }
  const bgEnd = pos.length / 3;

  // spherical Delaunay of directions from O
  const hullIdx = [];
  for (let v = bgStart; v < bgEnd; v++) hullIdx.push(v);
  for (const v of outerRing.keys()) hullIdx.push(v);
  for (const v of fence) hullIdx.push(v);
  const pts = hullIdx.map(v => {
    const q = new THREE.Vector3(pos[3 * v] - O[0], pos[3 * v + 1] - O[1], pos[3 * v + 2] - O[2]).normalize();
    q.vid = v;
    return q;
  });
  const hull = new ConvexHull().setFromPoints(pts);
  let removed = 0;
  for (const face of hull.faces) {
    const e = face.edge;
    const a = e.tail().point.vid, b = e.head().point.vid, c = e.next.head().point.vid;
    if (fence.has(a) || fence.has(b) || fence.has(c)) { removed++; continue; }
    const za = outerRing.get(a), zb = outerRing.get(b), zc = outerRing.get(c);
    const zi = za !== undefined && (za === zb || za === zc) ? za : (zb !== undefined && zb === zc ? zb : undefined);
    if (zi !== undefined) {
      const zn = zones[zi];
      const cen = [(pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3, (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3, (pos[3 * a + 2] + pos[3 * b + 2] + pos[3 * c + 2]) / 3];
      if (inPoly(polys[zi], zn.chart(cen))) { removed++; continue; }
    }
    tris.push(a, b, c);
  }

  // report / patch holes: boundary edges other than the lid tucks and the neck
  const edgeCount = new Map();
  const ek = (a, b) => a < b ? a * 100000 + b : b * 100000 + a;
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[i + e], b = tris[i + (e + 1) % 3];
      const k = ek(a, b);
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }
  let bad = 0, nonManifold = 0;
  const boundary = [];
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[i + e], b = tris[i + (e + 1) % 3];
      const c = edgeCount.get(ek(a, b));
      if (c === 1) {
        const lidTuck = M.kind[a] === 2 && M.kind[b] === 2 && M.ring[a] === -3 && M.ring[b] === -3;
        if (!lidTuck) { bad++; boundary.push([a, b]); }
      } else if (c > 2) nonManifold++;
    }
  }
  const filled = fillHoles(boundary, tris, pos, O);
  relax(pos, tris, M.kind, f, opt.relaxIters ?? 5);
  if (opt.log) opt.log(`head mesh ${id}: verts ${pos.length / 3}, tris ${tris.length / 3}, bg ${bgEnd - bgStart}, hull-removed ${removed}, open edges ${bad} (filled ${filled}), non-manifold ${nonManifold}`);

  return {
    positions: new Float32Array(pos), indices: tris, meta: M, zones, lids,
    mouthRings, eyeRings: { L: zones[0].rings, R: zones[1].rings }, KE, ME, KM, MM, bagRings: nb,
  };
}

// umbrella smoothing of the background vertices, re-projected onto the SDF
function relax(pos, tris, kind, f, iters) {
  const n = pos.length / 3;
  const nbr = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  const g = [0, 0, 0];
  const tmp = new Float64Array(pos.length);
  for (let it = 0; it < iters; it++) {
    for (let v = 0; v < n; v++) {
      if (kind[v] !== 0) continue;
      let x = 0, y = 0, z = 0, c = 0;
      for (const u of nbr[v]) { x += pos[3 * u]; y += pos[3 * u + 1]; z += pos[3 * u + 2]; c++; }
      if (!c) continue;
      tmp[3 * v] = mix(pos[3 * v], x / c, 0.6); tmp[3 * v + 1] = mix(pos[3 * v + 1], y / c, 0.6); tmp[3 * v + 2] = mix(pos[3 * v + 2], z / c, 0.6);
    }
    for (let v = 0; v < n; v++) {
      if (kind[v] !== 0) continue;
      let x = tmp[3 * v], y = tmp[3 * v + 1], z = tmp[3 * v + 2];
      for (let k = 0; k < 3; k++) {
        const d = f(x, y, z);
        gradient(f, x, y, z, g);
        x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
      }
      pos[3 * v] = x; pos[3 * v + 1] = y; pos[3 * v + 2] = z;
    }
  }
}

function triNormal(pos, a, b, c) {
  const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
  const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

// fill small holes: first close triangular gaps, then walk remaining loops
function fillHoles(boundary, tris, pos, O) {
  if (!boundary.length) return 0;
  const out = new Map(); // a -> [b] for boundary edges a->b as they appear in triangles
  for (const [a, b] of boundary) { if (!out.has(a)) out.set(a, []); out.get(a).push(b); }
  const used = new Set();
  const ek = (a, b) => a + ',' + b;
  let filled = 0;
  for (const [a, b] of boundary) {
    if (used.has(ek(a, b))) continue;
    for (const c of out.get(b) || []) {
      if (used.has(ek(b, c))) continue;
      if ((out.get(c) || []).includes(a) && !used.has(ek(c, a))) {
        tris.push(a, c, b);
        used.add(ek(a, b)); used.add(ek(b, c)); used.add(ek(c, a));
        filled++;
        break;
      }
    }
  }
  // longer loops: follow reversed edges b->a
  const next = new Map();
  for (const [a, b] of boundary) if (!used.has(ek(a, b))) { if (!next.has(b)) next.set(b, []); next.get(b).push(a); }
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let v = start, guard = 0;
    while (guard++ < 80) {
      loop.push(v); seen.add(v);
      const nx = (next.get(v) || []).find(u => !seen.has(u) || u === start);
      if (nx === undefined) break;
      if (nx === start) { v = start; break; }
      v = nx;
    }
    if (v !== start || loop.length < 3 || loop.length > 60) continue;
    for (let i = 1; i < loop.length - 1; i++) tris.push(loop[0], loop[i], loop[i + 1]);
    filled++;
  }
  return filled;
}

export function defaultSpacing(p, L) {
  const [x, y, z] = p;
  // face mask
  const face = sstep(0.0, 0.045, z) * (1 - sstep(0.05, 0.068, Math.abs(x))) * (1 - sstep(0.06, 0.085, y)) * sstep(-0.13, -0.1, y);
  const nose = (1 - sstep(0.012, 0.024, Math.abs(x))) * sstep(0.07, 0.085, z) * (1 - sstep(-0.005, 0.01, y)) * sstep(-0.045, -0.035, y);
  const scalp = sstep(0.06, 0.09, y) + sstep(-0.02, -0.06, z) * sstep(-0.04, 0.0, y);
  const neck = 1 - sstep(-0.13, -0.1, y);
  let h = 0.0036;
  h = mix(h, 0.0056, clamp(scalp));
  h = mix(h, 0.0045, clamp(neck) * (1 - face));
  h = mix(h, 0.0023, face);
  h = mix(h, 0.0017, nose);
  return h;
}
