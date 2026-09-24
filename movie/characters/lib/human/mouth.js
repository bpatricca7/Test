// Teeth, gums and tongue. Upper teeth ride the skull; lower teeth and the
// tongue ride the jaw. Each is a loft along the dental arch; the `depth`
// attribute lets the interior shader darken what lies deep in the mouth.

import * as THREE from 'three';
import { makeInteriorMaterial, srgb } from './materials.js';
import { mix, clamp, sstep } from './sdf.js';

// tooth widths along the arch from the midline (m): central, lateral, canine, premolars, molars
const TEETH_UP = [0.0044, 0.0034, 0.0039, 0.0035, 0.0035, 0.0050, 0.0048];
const TEETH_LO = [0.0028, 0.0030, 0.0035, 0.0036, 0.0035, 0.0050, 0.0048];
const H_UP = [0.0098, 0.0084, 0.0098, 0.0078, 0.0074, 0.0066, 0.0062];
const H_LO = [0.0080, 0.0084, 0.0092, 0.0080, 0.0076, 0.0066, 0.0062];

function archPoint(a, b, s) {
  // ellipse arch x = a sin(p), z = -b (1 - cos p); parameter by approx arc length s
  // (invert numerically)
  let p = 0, acc = 0, px = 0, pz = 0;
  const dp = 0.004;
  const sgn = Math.sign(s) || 1; const target = Math.abs(s);
  while (acc < target && p < 2.2) {
    const nx = a * Math.sin(p + dp), nz = -b * (1 - Math.cos(p + dp));
    acc += Math.hypot(nx - px, nz - pz);
    px = nx; pz = nz; p += dp;
  }
  // tangent and outward normal (in xz)
  const tx = a * Math.cos(p), tz = -b * Math.sin(p);
  const tl = Math.hypot(tx, tz);
  return { x: sgn * px, z: pz, tx: sgn * tx / tl, tz: tz / tl, nx: sgn * (-tz / tl) * -1, nz: tx / tl, p };
}

/**
 * one arch of teeth as a single loft; `upper` teeth hang down from the gum,
 * lower teeth stand up.
 */
function buildArch({ upper, a, b, zFront, yEdge, widths, heights, thick, segsPerTooth = 6 }) {
  const stations = [];
  let s = 0;
  const all = [];
  for (let i = 0; i < widths.length; i++) all.push(widths[i]);
  // stations from the right molar to the left molar
  const bounds = [0];
  for (const wd of all) bounds.push(bounds[bounds.length - 1] + wd);
  const sMax = bounds[bounds.length - 1];
  const N = all.length * segsPerTooth;
  for (let i = -N; i <= N; i++) {
    const sv = (i / N) * sMax;
    const as = Math.abs(sv);
    let ti = 0; while (ti < all.length - 1 && as > bounds[ti + 1]) ti++;
    const local = (as - bounds[ti]) / all[ti]; // 0..1 across the tooth
    stations.push({ s: sv, ti, local });
  }
  const verts = [], depth = [], cols = [], idx = [];
  const SECT = 10;
  for (const st of stations) {
    const ap = archPoint(a, b, st.s);
    const H = heights[st.ti] * (1 - 0.14 * Math.pow(Math.abs(st.local * 2 - 1), 3));
    const cornerRound = Math.pow(Math.abs(st.local * 2 - 1), 4);
    const groove = Math.exp(-(((st.local - 0) / 0.08) ** 2)) + Math.exp(-(((st.local - 1) / 0.08) ** 2));
    const T = thick[st.ti];
    // outward normal in xz: from the arch centre outward (front = +z at the midline)
    const onx = Math.sin(ap.p) * Math.sign(st.s || 1), onz = Math.cos(ap.p);
    const x0 = ap.x - onx * groove * 0.0003, z0 = zFront + ap.z - onz * groove * 0.0003;
    const dir = upper ? 1 : -1; // gum side (root) direction in y
    const edge = yEdge + dir * cornerRound * 0.0009 + (upper ? 0 : 0);
    // cross-section: labial face from edge to root, over the root, lingual face back to edge
    const sect = [];
    for (let k = 0; k < SECT; k++) {
      const u = k / SECT;
      let yy, oo;
      if (u < 0.4) { const q = u / 0.4; yy = edge + dir * H * q; oo = 0.0003 * Math.sin(q * Math.PI) - 0.0006 * q * q; }
      else if (u < 0.5) { const q = (u - 0.4) / 0.1; yy = edge + dir * H * (1 + 0.1 * Math.sin(q * Math.PI)); oo = -T * q; }
      else if (u < 0.9) { const q = (u - 0.5) / 0.4; yy = edge + dir * H * (1 - q); oo = -T * (1 - 0.65 * q * q) ; }
      else { const q = (u - 0.9) / 0.1; yy = edge - dir * 0.0003 * Math.sin(q * Math.PI); oo = -T * 0.35 * (1 - q); }
      sect.push([x0 + onx * oo, yy, z0 + onz * oo]);
    }
    const base = verts.length / 3;
    for (let k = 0; k < SECT; k++) {
      verts.push(...sect[k]);
      const d = clamp((-ap.z) / 0.024);
      depth.push(d);
      const g = 1 - 0.35 * groove;
      cols.push(0.93 * g, 0.9 * g, 0.84 * g);
    }
  }
  const ns = stations.length;
  for (let i = 0; i < ns - 1; i++) for (let k = 0; k < SECT; k++) {
    const k1 = (k + 1) % SECT;
    const a0 = i * SECT + k, a1 = i * SECT + k1, b0 = (i + 1) * SECT + k, b1 = (i + 1) * SECT + k1;
    if (upper) idx.push(a0, b1, a1, a0, b0, b1); else idx.push(a0, a1, b1, a0, b1, b0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildGum({ upper, a, b, zFront, yEdge, height, sMax, thick }) {
  const verts = [], depth = [], idx = [];
  const N = 40, SECT = 8;
  const dir = upper ? 1 : -1;
  for (let i = -N; i <= N; i++) {
    const sv = i / N * sMax;
    const ap = archPoint(a, b, sv);
    const onx = Math.sin(ap.p) * Math.sign(sv || 1), onz = Math.cos(ap.p);
    for (let k = 0; k < SECT; k++) {
      const u = k / (SECT - 1);
      const ang = u * Math.PI;
      const yy = yEdge + dir * (height * 0.5 - Math.cos(ang) * height * 0.5);
      const oo = 0.0012 * Math.sin(ang) - thick * u;
      verts.push(ap.x + onx * oo, yy, zFront + ap.z + onz * oo);
      depth.push(clamp(-ap.z / 0.024));
    }
  }
  for (let i = 0; i < 2 * N; i++) for (let k = 0; k < SECT - 1; k++) {
    const a0 = i * SECT + k, a1 = a0 + 1, b0 = a0 + SECT, b1 = b0 + 1;
    if (upper) idx.push(a0, a1, b1, a0, b1, b0); else idx.push(a0, b1, a1, a0, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createMouthParts(H, persona) {
  const mo = H.mouth;
  const ly = mo.lineY(0), lz = mo.lineZ(0);
  const upperGroup = new THREE.Group(), lowerGroup = new THREE.Group();
  const teethMat = makeInteriorMaterial(srgb(persona.teeth || 0xece6da), 0.32, { vertexColors: true, env: 0.35 });
  const gumMat = makeInteriorMaterial(srgb(persona.gum || 0xa0504e), 0.4, { env: 0.2 });
  const tongueMat = makeInteriorMaterial(srgb(persona.tongue || 0xb45a58), 0.34, { env: 0.3 });
  const zU = lz - 0.0046, yU = ly - 0.0016;
  const aU = 0.0235, bU = 0.029;
  const thickU = [0.0026, 0.0026, 0.0034, 0.006, 0.0068, 0.0085, 0.0085];
  const up = new THREE.Mesh(buildArch({ upper: true, a: aU, b: bU, zFront: zU, yEdge: yU, widths: TEETH_UP, heights: H_UP, thick: thickU }), teethMat);
  const sMaxU = TEETH_UP.reduce((p, q) => p + q, 0);
  const gumU = new THREE.Mesh(buildGum({ upper: true, a: aU + 0.0008, b: bU, zFront: zU + 0.0006, yEdge: yU + 0.0078, height: 0.006, sMax: sMaxU, thick: 0.007 }), gumMat);
  upperGroup.add(up, gumU);
  // lower arch sits behind the upper incisors, its edge hidden by the overbite
  const zL = zU - 0.0028, yL = yU + 0.0022;
  const aL = 0.0215, bL = 0.027;
  const thickL = [0.0024, 0.0024, 0.0032, 0.0058, 0.0066, 0.0085, 0.0085];
  const lo = new THREE.Mesh(buildArch({ upper: false, a: aL, b: bL, zFront: zL, yEdge: yL, widths: TEETH_LO, heights: H_LO, thick: thickL }), teethMat);
  const sMaxL = TEETH_LO.reduce((p, q) => p + q, 0);
  const gumL = new THREE.Mesh(buildGum({ upper: false, a: aL + 0.0008, b: bL, zFront: zL + 0.0006, yEdge: yL - 0.0068, height: 0.006, sMax: sMaxL, thick: 0.007 }), gumMat);
  lowerGroup.add(lo, gumL);

  // tongue: loft along a centreline from the back (u=0) to the tip (u=1)
  const NU = 14, NV = 12;
  const tg = new THREE.BufferGeometry();
  const tpos = new Float32Array((NU * NV + 1) * 3);
  const tdepth = new Float32Array(NU * NV + 1);
  const tidx = [];
  for (let i = 0; i < NU - 1; i++) for (let k = 0; k < NV; k++) {
    const k1 = (k + 1) % NV;
    tidx.push(i * NV + k, i * NV + k1, (i + 1) * NV + k1, i * NV + k, (i + 1) * NV + k1, (i + 1) * NV + k);
  }
  const tipC = NU * NV;
  for (let k = 0; k < NV; k++) tidx.push((NU - 1) * NV + k, (NU - 1) * NV + (k + 1) % NV, tipC);
  for (let i = 0; i < NU; i++) for (let k = 0; k < NV; k++) tdepth[i * NV + k] = clamp(1 - i / (NU - 1) * 1.05);
  tdepth[tipC] = 0;
  tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
  tg.setAttribute('depth', new THREE.BufferAttribute(tdepth, 1));
  tg.setIndex(tidx);
  const tongue = new THREE.Mesh(tg, tongueMat);
  tongue.frustumCulled = false;
  lowerGroup.add(tongue);

  const tipRest = [0, yL - 0.004, zL - 0.0045];
  const backRest = [0, yL - 0.012, zL - 0.046];
  function updateTongue(c) {
    const tipUp = clamp(c.tipUp || 0), out = clamp(c.tongueOut || 0), back = clamp(c.back || 0);
    // tip target
    const tip = [0,
      tipRest[1] + tipUp * 0.0095 + out * 0.0032,
      tipRest[2] + tipUp * 0.0005 + out * 0.0125];
    const mid = [0, mix(tipRest[1], backRest[1], 0.5) + back * 0.009 - tipUp * 0.001 + 0.002, mix(tip[2], backRest[2], 0.45)];
    const bk = [0, backRest[1] + back * 0.006, backRest[2]];
    for (let i = 0; i < NU; i++) {
      const u = i / (NU - 1);
      // quadratic bezier back -> mid -> tip, with the tip curling up
      const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), cc = u * u;
      const cy = a * bk[1] + b * mid[1] + cc * tip[1];
      const cz = a * bk[2] + b * mid[2] + cc * tip[2];
      const width = 0.0175 * Math.sin(Math.PI * (0.18 + 0.82 * Math.pow(u, 0.9)) ) * (1 - 0.35 * u * u) + 0.002;
      const thick = 0.0052 * (1 - 0.55 * u * u) + 0.0012;
      for (let k = 0; k < NV; k++) {
        const ang = k / NV * Math.PI * 2;
        const sx = Math.cos(ang), sy = Math.sin(ang);
        const flat = sy > 0 ? 0.75 : 1.0;
        const o = 3 * (i * NV + k);
        tpos[o] = sx * width;
        tpos[o + 1] = cy + sy * thick * flat - 0.0008 * sx * sx;
        tpos[o + 2] = cz;
      }
    }
    tpos[3 * tipC] = 0; tpos[3 * tipC + 1] = tip[1]; tpos[3 * tipC + 2] = tip[2] + 0.0035;
    tg.attributes.position.needsUpdate = true;
    tg.computeVertexNormals();
  }
  updateTongue({});
  const mats = [teethMat, gumMat, tongueMat];
  return { upperGroup, lowerGroup, updateTongue, mats };
}
