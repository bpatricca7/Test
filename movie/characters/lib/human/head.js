// Assembles a complete head: sculpted skin mesh + face rig, eyes, lashes,
// brows, ears, teeth, tongue. Everything lives in head-local space.

import * as THREE from 'three';
import { buildHeadSDF, HEAD_PARAMS } from './headsdf.js';
import { buildHeadMesh } from './headmesh.js';
import { createFaceRig } from './face.js';
import { createEyes, createLashes } from './eyes.js';
import { createMouthParts } from './mouth.js';
import { createEars } from './ears.js';
import { createBrows, browDensity, BROW_SHAPES } from './brows.js';
import { makeSkinMaterial, makeHairMaterial, srgb } from './materials.js';
import { gradient, fieldAO, clamp, mix, sstep } from './sdf.js';

const lin = hex => { const c = srgb(hex); return [c.r, c.g, c.b]; };
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export const SKIN = {
  maya: {
    base: 0x8a563a, cheek: 0x985640, forehead: 0x8e5c40, under: 0x6f4533, lid: 0x7a4a38, nose: 0x925840,
    lip: 0x6e3a33, lipIn: 0x9a4b48, rim: 0xa8645c, scalp: 0x2a1b14, neck: 0x7e4e34, brow: 0x2c1a12,
    browHair: 0x1d120c, grey: 0x9a918a, fuzz: 0x40302a, wrap: [0.55, 0.25, 0.16],
  },
  sam: {
    base: 0x5a3622, cheek: 0x603823, forehead: 0x5e3a25, under: 0x4a2c1d, lid: 0x4f2f20, nose: 0x5f3824,
    lip: 0x4a2a24, lipIn: 0x7c3c3a, rim: 0x8a4a44, scalp: 0x15100c, neck: 0x533120, brow: 0x1c120c,
    browHair: 0x120b08, grey: 0x777069, fuzz: 0x2e2420, wrap: [0.6, 0.26, 0.17],
  },
};

export const PERSONA = {
  maya: { lashLen: 0.0078, lashW: 0.00016, lashCount: 48, lowerLashes: 18, lashColor: 0x120c09, smileAsym: 0.18, browAsym: 0.12,
    lidDroop: 0.12, teeth: 0xe9e1d2, gum: 0x9c4c4a, tongue: 0xb05654 },
  sam: { lashLen: 0.0066, lashW: 0.00017, lashCount: 44, lowerLashes: 16, lashColor: 0x0d0907, smileAsym: -0.2, browAsym: -0.1,
    lidDroop: 0.0, teeth: 0xefe9de, gum: 0x8e4442, tongue: 0xa84e4e },
};

export function createHead(id, { rnd, log } = {}) {
  const P = HEAD_PARAMS[id];
  const H = buildHeadSDF(P);
  const L = H.landmarks;
  const hm = buildHeadMesh(H, id, { log });
  const rig = createFaceRig(hm, H);
  const n = hm.positions.length / 3;
  const S = SKIN[id];
  const C = {};
  for (const k in S) if (typeof S[k] === 'number') C[k] = lin(S[k]);
  const B = BROW_SHAPES[id];
  const mo = H.mouth;

  // ---------------------------------------------------------- skin colours
  const colorFn = (x, y, z, region) => {
    let c = C.base;
    const ax = Math.abs(x);
    // forehead and temples a bit lighter/yellower, neck deeper
    c = mix3(c, C.forehead, sstep(0.02, 0.06, y) * 0.8);
    c = mix3(c, C.neck, sstep(-0.1, -0.15, y));
    // cheeks warm
    const ch = Math.exp(-(((ax - 0.036) / 0.018) ** 2) - (((y + 0.025) / 0.016) ** 2)) * sstep(0.03, 0.06, z);
    c = mix3(c, C.cheek, ch * 0.75);
    // nose
    const ns = Math.exp(-((x / 0.012) ** 2) - (((y + 0.02) / 0.014) ** 2)) * sstep(0.08, 0.095, z);
    c = mix3(c, C.nose, ns * 0.7);
    // under-eye and lids
    const E = L.eyeL;
    const ue = Math.exp(-(((ax - E[0]) / 0.014) ** 2) - (((y + 0.013) / 0.006) ** 2)) * sstep(0.05, 0.065, z);
    c = mix3(c, C.under, ue * 0.55);
    const lidz = Math.exp(-(((ax - E[0]) / 0.016) ** 2) - (((y - 0.009) / 0.006) ** 2)) * sstep(0.055, 0.068, z);
    c = mix3(c, C.lid, lidz * 0.6);
    // brow base tint
    const bd = browDensity(B, x, y) * sstep(0.05, 0.07, z);
    c = mix3(c, C.brow, bd * 0.45);
    // scalp under the hair
    if (region !== 'ear') {
      const hl = hairline(id, x, y, z);
      c = mix3(c, C.scalp, hl);
    }
    return c;
  };

  const pos = hm.positions;
  const col = new Float32Array(n * 3), wet = new Float32Array(n), ao = new Float32Array(n);
  const g3 = [0, 0, 0];
  const M = hm.meta;
  for (let v = 0; v < n; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
    let c = colorFn(x, y, z);
    let wt = 0;
    const k = M.kind[v], r = M.ring[v];
    // lips: vermilion by the analytic lip heights
    const Xc = clamp(x, -mo.w, mo.w);
    const dy = y - mo.lineY(Xc);
    const hh = dy >= 0 ? mo.upH(Xc) : mo.loH(Xc);
    const inZone = k === 3 || k === 4 || k === 5;
    if (inZone || (Math.abs(x) < mo.w * 1.1 && Math.abs(dy) < 0.012 && z > 0.06)) {
      const edge = 0.00045;
      const lipT = sstep(hh + edge, hh - edge, Math.abs(dy)) * sstep(mo.w * 1.02, mo.w * 0.9, Math.abs(x));
      if (k === 3 && r <= 1) { c = mix3(C.lip, C.lipIn, 0.55); wt = 0.8; }
      else { c = mix3(c, C.lip, lipT); wt = 0.32 * lipT; }
    }
    if (k === 4 || k === 5) {
      const deep = k === 5 ? 1 : clamp((-r - 1) / 3);
      c = mix3(C.lipIn, [0.03, 0.008, 0.008], Math.pow(deep, 0.6));
      wt = 0.9 - 0.4 * deep;
    }
    if (k === 2) { c = C.rim; wt = 0.95; }
    if (k === 1 && r <= 1) { c = mix3(c, C.rim, r === 0 ? 0.35 : 0.1); wt = r === 0 ? 0.5 : 0.1; }
    // caruncle: pink at the inner corners of the lid rims
    if (k === 2 || (k === 1 && r === 0)) {
      const t = M.lidT[v];
      if (t < 0.08) { c = mix3(c, lin(0xc27670), sstep(0.08, 0.0, t)); wt = 0.95; }
    }
    // lash line darkening on the upper lid margin
    if (k === 1 && r <= 1 && M.upper[v] >= 0.5) c = mix3(c, C.brow, r === 0 ? 0.55 : 0.25);
    // nose tip and forehead are a little oily
    wt = Math.max(wt, 0.12 * Math.exp(-((x / 0.012) ** 2) - (((y + 0.024) / 0.01) ** 2)) * sstep(0.095, 0.105, z));
    // cavity AO from the field
    let a = 1;
    if (k === 0 || k === 1 || k === 3) {
      gradient(H.f, x, y, z, g3);
      a = fieldAO(H.f, x, y, z, g3[0], g3[1], g3[2], 0.009, 4);
      a = 0.3 + 0.7 * a;
    } else if (k === 4 || k === 5) a = 0.2;
    else if (k === 2) a = 0.55;
    col[3 * v] = c[0]; col[3 * v + 1] = c[1]; col[3 * v + 2] = c[2];
    wet[v] = wt; ao[v] = a;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('wet', new THREE.BufferAttribute(wet, 1));
  geo.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  geo.setIndex(hm.indices);
  geo.computeVertexNormals();
  const skinMat = makeSkinMaterial({ wrap: S.wrap, fuzz: S.fuzz });
  const skin = new THREE.Mesh(geo, skinMat);
  skin.name = 'skinHead';
  skin.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'head_' + id;
  group.add(skin);

  // eyes
  const eyes = createEyes(id, L, rnd);
  group.add(eyes.eyes.L.pivot, eyes.eyes.R.pivot);
  const persona = PERSONA[id];
  const lashes = createLashes(hm, rig, L, persona, rnd);
  group.add(lashes.mesh);
  const brows = createBrows(id, H.f, rig, rnd, { brow: lin(S.browHair), grey: lin(S.grey) });
  const browMat = makeHairMaterial({ roughness: 0.6, spec: 0x6a5a4a, side: THREE.DoubleSide });
  const browMesh = new THREE.Mesh(brows.geometry, browMat);
  browMesh.frustumCulled = false;
  group.add(browMesh);
  // ears
  const ears = createEars(H, skinMat, (x, y, z) => C.base.map((q, i) => q * (0.92 + 0.08 * i / 2)), id === 'sam' ? 1.04 : 0.97);
  for (const e of ears.ears) group.add(e);
  // mouth interior
  const mouth = createMouthParts(H, persona);
  group.add(mouth.upperGroup);
  const jaw = new THREE.Group();
  jaw.position.set(...rig.jawPivot);
  mouth.lowerGroup.position.set(-rig.jawPivot[0], -rig.jawPivot[1], -rig.jawPivot[2]);
  jaw.add(mouth.lowerGroup);
  group.add(jaw);

  // neck vertices blend back toward the torso when the head turns
  const neckW = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const y = pos[3 * v + 1], z = pos[3 * v + 2];
    neckW[v] = sstep(-0.095, -0.19, y + 0.25 * Math.max(0, z - 0.02));
  }
  const neckPivot = new THREE.Vector3(0, -0.075, -0.025);
  const qInv = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), ident = new THREE.Quaternion();

  const lidU = new Float32Array(8), lidL = new Float32Array(8);
  function sampleLids(key, side) {
    // current margin elevation per lateral position, resampled to 8 slots
    const ring = hm.eyeRings[key][0], ME = hm.ME, E = rig.eyes[key], out = rig.out, R = L.eyeRadius;
    const up = [], lo = [];
    for (let j = 0; j < ME; j++) {
      const v = ring[j];
      const x = (out[3 * v] - E.C[0]) * side / R;
      const psi = Math.atan2(out[3 * v + 1] - E.C[1], out[3 * v + 2] - E.C[2]);
      if (j <= ME / 2) up.push([x, psi]);
      if (j >= ME / 2 || j === 0) lo.push([x, psi]);
    }
    up.sort((a, b) => a[0] - b[0]); lo.sort((a, b) => a[0] - b[0]);
    const res = (arr, outArr) => {
      for (let i = 0; i < 8; i++) {
        const xn = -1 + 2 * i / 7;
        let val;
        if (xn <= arr[0][0]) val = arr[0][1];
        else if (xn >= arr[arr.length - 1][0]) val = arr[arr.length - 1][1];
        else {
          let k = 1; while (arr[k][0] < xn) k++;
          const a = arr[k - 1], b = arr[k];
          val = mix(a[1], b[1], (xn - a[0]) / (b[0] - a[0] || 1));
        }
        outArr[i] = val;
      }
    };
    res(up, lidU); res(lo, lidL);
    const U = eyes.eyes[key].mat.userData.uniforms;
    U.uLidU.value.set(lidU); U.uLidL.value.set(lidL);
  }

  const gazeLimits = { yaw: 0.6, up: 0.42, down: 0.5 };
  /**
   * c: controls from faceControls(); gaze: {L:{yaw,pitch}, R:{...}} in radians;
   * neckQ: rotation of the head relative to the torso (for the neck blend)
   */
  function setFace(c, gaze, neckQ) {
    for (const key of ['L', 'R']) {
      const gz = gaze[key];
      const yaw = clamp(gz.yaw, -gazeLimits.yaw, gazeLimits.yaw);
      const pitch = clamp(gz.pitch, -gazeLimits.down, gazeLimits.up);
      eyes.setGaze(key, yaw, pitch);
      c.eyes[key].pitch = pitch;
    }
    const out = rig.deform(c);
    // neck counter-rotation
    if (neckQ) {
      qInv.copy(neckQ).invert();
      for (let v = 0; v < n; v++) {
        const w = neckW[v];
        if (w <= 0) continue;
        tmpQ.copy(ident).slerp(qInv, w);
        tmpV.set(out[3 * v] - neckPivot.x, out[3 * v + 1] - neckPivot.y, out[3 * v + 2] - neckPivot.z).applyQuaternion(tmpQ);
        out[3 * v] = tmpV.x + neckPivot.x; out[3 * v + 1] = tmpV.y + neckPivot.y; out[3 * v + 2] = tmpV.z + neckPivot.z;
      }
    }
    geo.attributes.position.array.set(out);
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    lashes.update();
    brows.update();
    // jaw-borne parts
    const ang = clamp(c.jaw || 0, -0.1, 1.2) * rig.JAW_MAX;
    jaw.rotation.x = ang;
    jaw.position.z = rig.jawPivot[2] + 0.002 * (c.jaw || 0);
    mouth.updateTongue(c);
    const open = clamp((c.jaw || 0) * 1.6 + (c.upperUp || 0) * 0.3 + (c.lowerDown || 0) * 0.3 - (c.seal || 0) * 0.5);
    for (const m of mouth.mats) m.userData.uniforms.uOpen.value = open;
    sampleLids('L', 1); sampleLids('R', -1);
  }

  return { group, skin, skinMat, H, L, hm, rig, eyes, lashes, brows, ears, mouth, jaw, setFace, colorFn, C, persona,
    tris: hm.indices.length / 3 };
}

/** where the hair covers the scalp (1 = under hair) */
export function hairline(id, x, y, z) {
  if (id === 'maya') {
    // soft hairline around the forehead, temples and nape
    const front = sstep(0.056, 0.068, y + 0.18 * Math.max(0, -z + 0.06) - 0.05 * (x / 0.07) ** 2 * 0);
    const temple = sstep(0.03, 0.05, y + 0.3 * Math.max(0, 0.05 - z));
    const back = sstep(0.03, -0.01, z) * sstep(-0.075, -0.05, y);
    return clamp(Math.max(front * sstep(0.08, 0.02, z) + (z < 0.02 ? temple : 0), back));
  }
  // sam: a short hairline with a slight fade at the sides
  const front = sstep(0.06, 0.072, y + 0.12 * Math.max(0, 0.06 - z));
  const side = sstep(0.012, 0.03, y + 0.22 * Math.max(0, 0.04 - z)) * sstep(0.05, 0.0, z);
  const back = sstep(0.02, -0.02, z) * sstep(-0.07, -0.045, y);
  return clamp(Math.max(front, side * 0.85, back * 0.85));
}
