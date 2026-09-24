// Sculpted hair.
//  maya: a curly mass swept back into a loose bun. SDF = scalp offset + hundreds
//        of elongated curl clumps (smooth-unioned), + a coiled bun, polygonized
//        with surface nets; escaped ringlets are helical tubes. Grey streaks are
//        coloured per clump.
//  sam:  short two-strand twists: tapered tubes with a spiral groove texture,
//        rooted on the scalp, over a faded short-hair base painted on the skin.

import * as THREE from 'three';
import { surfaceNets, gradient, smin, smax, ellipsoidR, torus, clamp, mix, sstep, project, rayExit } from './sdf.js';
import { makeHairMaterial } from './materials.js';
import { hairline, hairlineY } from './head.js';

const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

/** spiral/strand normal+colour tile for hair tubes and clumps */
function strandTexture(rnd, { twists = 2, N = 256 } = {}) {
  const col = new Uint8Array(N * N * 4), nrm = new Uint8Array(N * N * 4);
  const h = new Float32Array(N * N);
  const fib = new Float32Array(64 * 64); for (let i = 0; i < fib.length; i++) fib[i] = rnd();
  const samp = (x, y) => { const xi = ((Math.floor(x) % 64) + 64) % 64, yi = ((Math.floor(y) % 64) + 64) % 64; return fib[yi * 64 + xi]; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    // spiral strands: phase along v with twist
    const ph = (u * twists + v * 2.0) % 1;
    const strand = Math.pow(Math.sin(Math.PI * ph), 0.6);
    const fine = samp(x * 1.0, y * 0.12) * 0.5 + samp(x * 2.0 + 13, y * 0.25) * 0.5;
    h[y * N + x] = strand * 0.8 + fine * 0.35;
    const k = 0.62 + 0.38 * strand + (fine - 0.5) * 0.25;
    const i = 4 * (y * N + x);
    col[i] = col[i + 1] = col[i + 2] = Math.round(255 * clamp(k)); col[i + 3] = 255;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hl = h[y * N + (x + N - 1) % N], hr = h[y * N + (x + 1) % N], hd = h[((y + N - 1) % N) * N + x], hu = h[((y + 1) % N) * N + x];
    const nx = -(hr - hl) * 1.6, ny = -(hu - hd) * 1.6, l = Math.hypot(nx, ny, 1);
    const i = 4 * (y * N + x);
    nrm[i] = (nx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (ny / l * 0.5 + 0.5) * 255; nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  const mk = (d, srgb) => { const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  return { map: mk(col, true), normalMap: mk(nrm, false) };
}

/** a tube along a polyline with radius per point; returns arrays */
function tube(pts, radii, sides, out, color, uvScaleV = 1, twistTan = true) {
  const base = out.P.length / 3;
  const n = pts.length;
  let prevN = null;
  let vAcc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const t = (i < n - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
    if (i > 0) vAcc += p.distanceTo(pts[i - 1]);
    let nn;
    if (!prevN) { nn = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); nn.addScaledVector(t, -nn.dot(t)).normalize(); }
    else { nn = prevN.clone().addScaledVector(t, -prevN.dot(t)).normalize(); }
    prevN = nn;
    const bn = new THREE.Vector3().crossVectors(t, nn);
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * Math.PI * 2;
      const dir = nn.clone().multiplyScalar(Math.cos(a)).addScaledVector(bn, Math.sin(a));
      const q = p.clone().addScaledVector(dir, radii[i]);
      out.P.push(q.x, q.y, q.z); out.N.push(dir.x, dir.y, dir.z);
      out.UV.push(k / sides, vAcc * uvScaleV);
      out.T.push(t.x, t.y, t.z);
      const c = typeof color === 'function' ? color(i / (n - 1)) : color;
      out.C.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
    const a = base + i * (sides + 1) + k, b = a + 1, c = a + sides + 1, d = c + 1;
    out.I.push(a, c, b, b, c, d);
  }
  // tip cap
  const tip = pts[n - 1];
  const ti = out.P.length / 3;
  const tdir = pts[n - 1].clone().sub(pts[n - 2]).normalize();
  const tp = tip.clone().addScaledVector(tdir, radii[n - 1] * 0.8);
  out.P.push(tp.x, tp.y, tp.z); out.N.push(tdir.x, tdir.y, tdir.z); out.UV.push(0.5, vAcc * uvScaleV); out.T.push(tdir.x, tdir.y, tdir.z);
  const c = typeof color === 'function' ? color(1) : color; out.C.push(c[0], c[1], c[2]);
  const last = base + (n - 1) * (sides + 1);
  for (let k = 0; k < sides; k++) out.I.push(last + k, ti, last + k + 1);
}

function geomFrom(out) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.UV, 2));
  g.setAttribute('hairTangent', new THREE.Float32BufferAttribute(out.T, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.C, 3));
  g.setIndex(out.I);
  return g;
}

// ------------------------------------------------------------------ maya ---
export function createMayaHair(H, rnd) {
  const f = H.f, L = H.landmarks;
  const dark = lin(0x1c140f), dark2 = lin(0x2c1e15), grey1 = lin(0x6e6862), grey2 = lin(0x8e8880), grey = grey1;
  const group = new THREE.Group(); group.name = 'hairMaya';
  // bun placement: high at the back of the head
  const bunC = new THREE.Vector3(0.0, 0.084, -0.094);
  const bunAxis = new THREE.Vector3(0, 0.55, -1).normalize(); // points out of the head
  // hair region mask (1 = hair)
  const mask = (x, y, z) => hairline('maya', x, y, z);
  // sweep direction: from the hairline back toward the bun, along the scalp
  const sweep = (x, y, z, out) => {
    const d = new THREE.Vector3(bunC.x - x, bunC.y - y, bunC.z - z);
    out.copy(d).normalize();
    return out;
  };
  // locks: from hairline points, swept over the scalp to the bun; curl clumps
  // placed along each lock with a lateral wave (curly hair pulled back)
  const clumps = [];
  const g3 = [0, 0, 0];
  const tmp = new THREE.Vector3();
  const Oc = [0, 0.012, -0.012];
  const surf = (p, off) => {
    // project p radially from the head centre onto the scalp, then lift
    const d = new THREE.Vector3(p.x - Oc[0], p.y - Oc[1], p.z - Oc[2]).normalize();
    const t = rayExit(f, Oc[0], Oc[1], Oc[2], d.x, d.y, d.z, 0.3);
    const q = new THREE.Vector3(Oc[0] + d.x * t, Oc[1] + d.y * t, Oc[2] + d.z * t);
    gradient(f, q.x, q.y, q.z, g3);
    const n = new THREE.Vector3(g3[0], g3[1], g3[2]);
    return { p: q.addScaledVector(n, off), n };
  };
  const lockStarts = [];
  const NL = 64;
  for (let i = 0; i < NL; i++) {
    const az = -Math.PI + (i + 0.5) / NL * Math.PI * 2;
    const x = Math.sin(az), z = Math.cos(az);
    const hy = hairlineY('maya', x, z);
    // find the scalp point at the hairline height along this azimuth
    let best = null;
    for (let k = 0; k < 24; k++) {
      const el = -0.2 + k * 0.05;
      const q = surf(new THREE.Vector3(Oc[0] + x * 0.1, Oc[1] + el * 0.1, Oc[2] + z * 0.1), 0);
      if (q.p.y >= hy + 0.002) { best = q.p; break; }
    }
    if (best) lockStarts.push({ p: best, az });
  }
  // interior locks from the crown/top
  for (let i = 0; i < 18; i++) {
    const az = -Math.PI + (i + 0.5) / 18 * Math.PI * 2;
    const q = surf(new THREE.Vector3(Oc[0] + Math.sin(az) * 0.05, Oc[1] + 0.1, Oc[2] + Math.cos(az) * 0.05 + 0.02), 0);
    lockStarts.push({ p: q.p, az, inner: true });
  }
  let lockId = 0;
  for (const ls of lockStarts) {
    lockId++;
    const p0 = ls.p;
    const target = bunC.clone().addScaledVector(bunAxis, -0.012);
    const len = p0.distanceTo(target);
    const nClumps = Math.max(4, Math.round(len / 0.0055));
    const front = Math.cos(ls.az) > 0.3;
    // colour per lock: grey streak from the left temple, greying at the temples, a few grey strands
    const streak = Math.exp(-(((ls.az - 0.95) / 0.22) ** 2));
    const temple = Math.exp(-(((Math.abs(ls.az) - 1.1) / 0.3) ** 2)) * 0.35;
    const isGreyLock = rnd() < 0.06 + streak * 0.9 + temple * 0.5;
    const tone = rnd();
    const phase = rnd() * Math.PI * 2;
    for (let k = 0; k < nClumps; k++) {
      const u = k / (nClumps - 1);
      const lin3 = p0.clone().lerp(target, u);
      const thick = mix(0.0035, 0.009, sstep(0.0, 0.5, u)) * (ls.inner ? 1.1 : 1) * (front ? 0.85 : 1);
      const q = surf(lin3, thick);
      // direction of travel along the surface
      const ahead = surf(p0.clone().lerp(target, Math.min(1, u + 0.05)), thick).p;
      const dir = ahead.clone().sub(q.p); dir.addScaledVector(q.n, -dir.dot(q.n)); if (dir.lengthSq() < 1e-10) dir.set(0, 0, -1); dir.normalize();
      const side = new THREE.Vector3().crossVectors(q.n, dir).normalize();
      const wave = Math.sin(u * len / 0.016 * Math.PI * 2 + phase) * 0.0028 * sstep(0, 0.15, u);
      const pos = q.p.clone().addScaledVector(side, wave).addScaledVector(q.n, 0.0012 * Math.cos(u * len / 0.016 * Math.PI * 2 + phase));
      const cdir = dir.clone().addScaledVector(side, Math.cos(u * len / 0.016 * Math.PI * 2 + phase) * 0.6).normalize();
      const grey = isGreyLock && (rnd() < 0.8);
      const col = grey ? (tone < 0.5 ? grey1 : grey2) : (rnd() < 0.3 ? dark2 : dark);
      clumps.push({ x: pos.x, y: pos.y, z: pos.z, n: q.n, s: cdir, r: 0.0046 + 0.0012 * rnd(), len: 0.0055, col, lock: lockId });
    }
  }
  // bun coils: clumps arranged along a spiral on a torus
  const bunX = new THREE.Vector3().crossVectors(bunAxis, new THREE.Vector3(1, 0, 0)).normalize();
  const bunY = new THREE.Vector3().crossVectors(bunAxis, bunX).normalize();
  const bunClumps = [];
  for (let i = 0; i < 150; i++) {
    const a = i / 150 * Math.PI * 2 * 3.0 + rnd() * 0.3;
    const layer = i / 150;
    const R = 0.028 - 0.014 * layer;
    const h = 0.012 * layer + 0.004;
    const p = bunC.clone().addScaledVector(bunX, Math.cos(a) * R).addScaledVector(bunY, Math.sin(a) * R).addScaledVector(bunAxis, h);
    const tan = bunX.clone().multiplyScalar(-Math.sin(a)).addScaledVector(bunY, Math.cos(a)).normalize();
    const nrm = p.clone().sub(bunC).normalize();
    const g = rnd();
    const col = g < 0.16 ? (g < 0.07 ? grey2 : grey1) : (rnd() < 0.5 ? dark : dark2);
    const c = { x: p.x, y: p.y, z: p.z, n: nrm, s: tan, r: 0.0085 + 0.003 * rnd(), len: 0.014, col, bun: true };
    bunClumps.push(c);
  }
  const all = clumps.concat(bunClumps);
  // spatial hash for the SDF
  const HS = 0.02;
  const hgrid = new Map();
  for (const c of all) {
    const R = c.len + 0.006;
    for (let a = Math.floor((c.x - R) / HS); a <= Math.floor((c.x + R) / HS); a++)
      for (let b = Math.floor((c.y - R) / HS); b <= Math.floor((c.y + R) / HS); b++)
        for (let d = Math.floor((c.z - R) / HS); d <= Math.floor((c.z + R) / HS); d++) {
          const k = a * 73856093 ^ b * 19349663 ^ d * 83492791; let arr = hgrid.get(k); if (!arr) hgrid.set(k, arr = []); arr.push(c);
        }
  }
  const clumpD = (x, y, z) => {
    const k = Math.floor(x / HS) * 73856093 ^ Math.floor(y / HS) * 19349663 ^ Math.floor(z / HS) * 83492791;
    const arr = hgrid.get(k);
    let d = 1;
    if (!arr) return d;
    for (const c of arr) {
      // elongated ellipsoid along the sweep: capsule-ish distance
      const px = x - c.x, py = y - c.y, pz = z - c.z;
      const along = px * c.s.x + py * c.s.y + pz * c.s.z;
      const a = clamp(along, -c.len * 0.6, c.len * 0.6);
      const qx = px - c.s.x * a, qy = py - c.s.y * a, qz = pz - c.s.z * a;
      const dd = Math.hypot(qx, qy, qz) - c.r;
      d = smin(d, dd, 0.0022);
    }
    return d;
  };
  const scalpOff = (x, y, z) => f(x, y, z) - 0.0022;
  const hairSDF = (x, y, z) => {
    const m = mask(x, y, z);
    // base shell hugging the scalp under the clumps, cut at the hairline
    let d = smax(scalpOff(x, y, z) - 0.0035 * m, (0.4 - m) * 0.02, 0.002);
    d = smin(d, clumpD(x, y, z), 0.003);
    // keep hair off the face and ears
    return d;
  };
  const min = [-0.1, -0.085, -0.145], max = [0.1, 0.155, 0.105];
  const vs = 0.0031;
  const res = [0, 1, 2].map(i => Math.round((max[i] - min[i]) / vs) + 1);
  const m = surfaceNets(hairSDF, min, max, res, { snap: 1 });
  const n = m.positions.length / 3;
  // attributes: colour from the nearest clump, tangent from its sweep direction
  const C = new Float32Array(n * 3), T = new Float32Array(n * 3), UV = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = m.positions[3 * i], y = m.positions[3 * i + 1], z = m.positions[3 * i + 2];
    const k = Math.floor(x / HS) * 73856093 ^ Math.floor(y / HS) * 19349663 ^ Math.floor(z / HS) * 83492791;
    const arr = hgrid.get(k);
    let best = null, bd = 1e9;
    if (arr) for (const c of arr) { const d = (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2; if (d < bd) { bd = d; best = c; } }
    const col = best ? best.col : dark;
    // occlusion toward the scalp: deeper = darker
    const depth = clamp((f(x, y, z) - 0.002) / 0.012);
    const ao = 0.45 + 0.55 * depth;
    C[3 * i] = col[0] * ao; C[3 * i + 1] = col[1] * ao; C[3 * i + 2] = col[2] * ao;
    const s = best ? best.s : sweep(x, y, z, tmp);
    T[3 * i] = s.x; T[3 * i + 1] = s.y; T[3 * i + 2] = s.z;
    // uv: along the sweep and around, for the strand texture
    UV[2 * i] = (x * 0.8 + z * 0.3) * 60; UV[2 * i + 1] = (y * 0.6 - z * 0.8) * 60;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('hairTangent', new THREE.BufferAttribute(T, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  g.setIndex(m.indices);
  g.computeVertexNormals();
  const st = strandTexture(rnd, { twists: 3 });
  const mat = makeHairMaterial({ roughness: 0.7, spec: 0x3a3028, shift: 0.1, normalMap: st.normalMap, normalScale: 0.8 });
  const mass = new THREE.Mesh(g, mat);
  mass.name = 'hairMass';
  group.add(mass);

  // escaped ringlets: helix tubes near the temples, ears and nape
  const out = { P: [], N: [], UV: [], T: [], C: [], I: [] };
  const rings = [
    [0.058, 0.036, 0.03, 0.05, 1], [-0.06, 0.034, 0.028, 0.046, 0], [0.066, 0.02, 0.0, 0.04, 0],
    [0.03, -0.055, -0.078, 0.04, 0], [-0.028, -0.056, -0.08, 0.036, 0], [0.012, 0.11, -0.13, 0.04, 1], [-0.02, 0.1, -0.138, 0.035, 0],
  ];
  const ringlets = [];
  for (const [x, y, z, len, gr] of rings) {
    // root on the hair surface near (x,y,z)
    const p = [x, y, z]; project(hairSDF, p, 6);
    gradient(hairSDF, p[0], p[1], p[2], g3);
    const nrm = new THREE.Vector3(...g3);
    const down = new THREE.Vector3(0, -1, 0).addScaledVector(nrm, 0.5).normalize();
    const pts = [], radii = [];
    const turns = 3 + rnd() * 1.5, R = 0.004 + 0.001 * rnd();
    const ax = new THREE.Vector3().crossVectors(down, nrm).normalize();
    const ay = new THREE.Vector3().crossVectors(down, ax).normalize();
    for (let i = 0; i <= 26; i++) {
      const u = i / 26;
      const a = u * turns * Math.PI * 2;
      const q = new THREE.Vector3(...p).addScaledVector(nrm, -0.002).addScaledVector(down, u * len)
        .addScaledVector(ax, Math.cos(a) * R * sstep(0, 0.2, u)).addScaledVector(ay, Math.sin(a) * R * sstep(0, 0.2, u));
      pts.push(q); radii.push(0.0022 * (1 - 0.4 * u) + 0.0005);
    }
    const col = gr ? grey2 : dark2;
    const start = out.P.length / 3;
    tube(pts, radii, 5, out, u => col.map(q => q * (0.8 + 0.3 * u)), 40);
    ringlets.push({ start, end: out.P.length / 3, root: new THREE.Vector3(...p) });
  }
  const rg = geomFrom(out);
  const ringMesh = new THREE.Mesh(rg, makeHairMaterial({ roughness: 0.65, spec: 0x3a3028, map: st.map, normalMap: st.normalMap }));
  ringMesh.name = 'ringlets';
  group.add(ringMesh);
  const restRing = Float32Array.from(rg.attributes.position.array);
  // secondary: bun pivot and ringlet sway (applied by human.js)
  function sway(dx, dy, dz) {
    const P = rg.attributes.position.array;
    for (const r of ringlets) {
      for (let i = r.start; i < r.end; i++) {
        const o = 3 * i;
        const dist = Math.hypot(restRing[o] - r.root.x, restRing[o + 1] - r.root.y, restRing[o + 2] - r.root.z);
        const w = Math.min(1, dist / 0.05) ** 1.5;
        P[o] = restRing[o] + dx * w; P[o + 1] = restRing[o + 1] + dy * w * 0.3; P[o + 2] = restRing[o + 2] + dz * w;
      }
    }
    rg.attributes.position.needsUpdate = true;
  }
  // bun follow-through: vertices near the bun rotate about its attachment
  const restMass = Float32Array.from(g.attributes.position.array), restN = Float32Array.from(g.attributes.normal.array);
  const pivot = bunC.clone().addScaledVector(bunAxis, -0.02);
  const bw = new Float32Array(n);
  const bunIdx = [];
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(restMass[3 * i] - bunC.x, restMass[3 * i + 1] - bunC.y, restMass[3 * i + 2] - bunC.z);
    bw[i] = sstep(0.058, 0.03, d);
    if (bw[i] > 0) bunIdx.push(i);
  }
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), qi = new THREE.Quaternion();
  function bunSway(ax, az) {
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (const i of bunIdx) {
      const w = bw[i];
      e.set(ax * w, 0, az * w); q.setFromEuler(e);
      v.set(restMass[3 * i] - pivot.x, restMass[3 * i + 1] - pivot.y, restMass[3 * i + 2] - pivot.z).applyQuaternion(q);
      P[3 * i] = v.x + pivot.x; P[3 * i + 1] = v.y + pivot.y; P[3 * i + 2] = v.z + pivot.z;
      v.set(restN[3 * i], restN[3 * i + 1], restN[3 * i + 2]).applyQuaternion(q);
      N[3 * i] = v.x; N[3 * i + 1] = v.y; N[3 * i + 2] = v.z;
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  }
  return { group, sway, bunSway, tris: m.indices.length / 3 + out.I.length / 3, bunC, sdf: hairSDF };
}

// ------------------------------------------------------------------- sam ---
export function createSamHair(H, rnd) {
  const f = H.f;
  const group = new THREE.Group(); group.name = 'hairSam';
  const out = { P: [], N: [], UV: [], T: [], C: [], I: [] };
  const base = lin(0x16100c), base2 = lin(0x22170f), tipC = lin(0x3a2616);
  const g3 = [0, 0, 0];
  const O = [0, 0.0, -0.01];
  const roots = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  const NC = 9000;
  const sp = 0.0074;
  for (let i = 0; i < NC; i++) {
    const yy = 1 - 2 * (i + 0.5) / NC, r = Math.sqrt(1 - yy * yy), th = ga * i;
    const d = [Math.cos(th) * r, yy, Math.sin(th) * r];
    const t = rayExit(f, O[0], O[1], O[2], d[0], d[1], d[2], 0.3);
    const x = O[0] + d[0] * t, y = O[1] + d[1] * t, z = O[2] + d[2] * t;
    // twists on the top; sides and back are faded short
    const topY = hairlineY('samTop', x, z);
    if (y < topY || y < 0.03) continue;
    if (roots.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 < sp * sp)) continue;
    roots.push([x, y, z]);
  }
  for (const [x, y, z] of roots) {
    gradient(f, x, y, z, g3);
    const nrm = new THREE.Vector3(...g3);
    // twists stand up, lean back a touch and droop at the sides
    const dir = nrm.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, 0.75, -0.18)).normalize();
    const topY = hairlineY('samTop', x, z);
    const inner = sstep(topY, topY + 0.035, y);
    const len = (0.012 + 0.022 * inner + 0.006 * rnd()) * (z > 0.05 ? 0.9 : 1);
    const pts = [], radii = [];
    const bend = new THREE.Vector3((rnd() - 0.5) * 0.35, -0.2 - 0.3 * (1 - inner), (rnd() - 0.5) * 0.3 - 0.1);
    const segs = 6;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const q = new THREE.Vector3(x, y, z).addScaledVector(nrm, -0.003).addScaledVector(dir, (len + 0.003) * u).addScaledVector(bend, len * u * u * 0.6);
      pts.push(q);
      radii.push(0.0043 * (1 - 0.28 * u) + 0.0004 * Math.sin(u * 20));
    }
    const shade = 0.8 + 0.4 * rnd();
    tube(pts, radii, 6, out, u => { const c = u < 0.8 ? (rnd() < 0.5 ? base : base2) : tipC; return [c[0] * shade, c[1] * shade, c[2] * shade].map((q, k) => mix(q, tipC[k] * shade, sstep(0.6, 1, u) * 0.6)); }, 55);
  }
  const g = geomFrom(out);
  const st = strandTexture(rnd, { twists: 2 });
  const mat = makeHairMaterial({ roughness: 0.7, spec: 0x2e2620, shift: 0.08, map: st.map, normalMap: st.normalMap, normalScale: 1.2 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'twists';
  group.add(mesh);
  // twists jiggle a touch: the whole mass rotates slightly about the crown
  const piv = new THREE.Group();
  group.remove(mesh); piv.add(mesh); group.add(piv);
  piv.position.set(0, 0.07, -0.01); mesh.position.set(0, -0.07, 0.01);
  function bunSway(ax, az) { piv.rotation.set(ax * 0.35, 0, az * 0.35); }
  return { group, sway: () => {}, bunSway, tris: out.I.length / 3, count: roots.length };
}
