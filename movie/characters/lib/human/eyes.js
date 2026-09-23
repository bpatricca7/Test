// Eyeballs (baked iris texture, lid shadow), corneas (wet additive layer) and
// eyelashes that ride the lid rotation of the vertex they grow from.

import * as THREE from 'three';
import { bakeIrisTexture, makeEyeballMaterial, makeCorneaMaterial } from './materials.js';
import { mix, clamp } from './sdf.js';

export const IRIS = {
  maya: { irisR: 0.55, pupil: 0.36, base: '#6b3f1c', inner: '#a8702e', outer: '#3b2010', collar: 'rgba(200,150,80,0.35)',
    limbal: 'rgba(28,14,6,0.92)', fibreLight: 'rgba(210,160,95,A)', fibreDark: 'rgba(40,20,8,A)' },
  sam: { irisR: 0.56, pupil: 0.37, base: '#4a2a14', inner: '#8a5a26', outer: '#26140a', collar: 'rgba(170,120,60,0.35)',
    limbal: 'rgba(18,9,4,0.94)', fibreLight: 'rgba(180,130,70,A)', fibreDark: 'rgba(25,12,5,A)' },
};

export function createEyes(id, L, rnd) {
  const R = L.eyeRadius;
  const tex = bakeIrisTexture({ ...IRIS[id], rnd });
  const eyes = {};
  for (const [key, side, C] of [['L', 1, L.eyeL], ['R', -1, L.eyeR]]) {
    const pivot = new THREE.Object3D();
    pivot.position.set(C[0], C[1], C[2]);
    const g = new THREE.SphereGeometry(R, 44, 30);
    g.rotateX(Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, 0.5 + pos.getX(i) / (2 * R), 0.5 + pos.getY(i) / (2 * R));
    }
    const mat = makeEyeballMaterial(tex);
    mat.userData.uniforms.uSide.value = side;
    mat.userData.uniforms.uR.value = R;
    const ball = new THREE.Mesh(g, mat);
    ball.name = 'eyeball' + key;
    // cornea: a thin glassy cap with a bulge over the iris
    const cg = new THREE.SphereGeometry(R + 0.0002, 44, 14, 0, Math.PI * 2, 0, 1.15);
    cg.rotateX(Math.PI / 2);
    const cp = cg.attributes.position;
    const irisR = IRIS[id].irisR;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const r = Math.hypot(x, y) / R;
      const k = r < irisR * 1.08 ? Math.pow(1 - (r / (irisR * 1.08)) ** 2, 1.5) : 0;
      const s = 1 + 0.045 * k;
      cp.setXYZ(i, x * s, y * s, z * s);
    }
    cg.computeVertexNormals();
    const cornea = new THREE.Mesh(cg, makeCorneaMaterial());
    cornea.renderOrder = 2;
    pivot.add(ball, cornea);
    eyes[key] = { pivot, ball, cornea, mat, side, C };
  }
  const setGaze = (key, yaw, pitch) => {
    const e = eyes[key];
    e.pivot.rotation.set(-pitch, yaw, 0, 'YXZ');
    e.pivot.updateMatrix();
    e.mat.userData.uniforms.uGaze.value.setFromMatrix4(e.pivot.matrix);
  };
  return { eyes, setGaze, tex };
}

/**
 * Eyelashes: tapered 3-sided tubes. Each lash is bound to the lid margin
 * (ring 0) and follows the rotation+offset of its root.
 */
export function createLashes(hm, rig, L, persona, rnd) {
  const P = rig.rest;
  const lashes = []; // {r0, r1, f, pts:[...rest points], side}
  const verts = [];
  const tris = [];
  const SEG = 3, SIDES = 3;
  for (const [key, side, C] of [['L', 1, L.eyeL], ['R', -1, L.eyeR]]) {
    const ring = hm.eyeRings[key][0];
    const ME = hm.ME;
    const addLash = (ja, jb, f, len, curl, width, lower, spread) => {
      const a = ring[ja], b = ring[jb];
      const root = [mix(P[3 * a], P[3 * b], f), mix(P[3 * a + 1], P[3 * b + 1], f), mix(P[3 * a + 2], P[3 * b + 2], f)];
      // local frame at the root
      const N = [root[0] - C[0], root[1] - C[1], root[2] - C[2]];
      const nl = Math.hypot(...N); N[0] /= nl; N[1] /= nl; N[2] /= nl;
      const T = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]];
      const tl = Math.hypot(...T) || 1; T[0] /= tl; T[1] /= tl; T[2] /= tl;
      // U = N x T oriented upward for the upper lid
      let U = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]];
      if ((U[1] < 0) !== lower) U = U.map(q => -q);
      const pts = [];
      for (let s = 0; s <= SEG; s++) {
        const u = s / SEG;
        const out = 0.9 * u, up = curl * u * u - 0.12 * u;
        pts.push([
          root[0] + len * (N[0] * out + U[0] * up) + T[0] * spread * u * len,
          root[1] + len * (N[1] * out + U[1] * up) + T[1] * spread * u * len,
          root[2] + len * (N[2] * out + U[2] * up) + T[2] * spread * u * len + 0.0004 * u,
        ]);
      }
      const base = verts.length / 3;
      for (let s = 0; s <= SEG; s++) {
        const u = s / SEG;
        const wdt = width * Math.pow(1 - u, 0.7) + 0.00001;
        const p = pts[s];
        // tube cross-section in the plane spanned by T and U
        for (let k = 0; k < SIDES; k++) {
          const a2 = k / SIDES * Math.PI * 2;
          const ox = Math.cos(a2) * wdt, oy = Math.sin(a2) * wdt;
          verts.push(p[0] + T[0] * ox + U[0] * oy, p[1] + T[1] * ox + U[1] * oy, p[2] + T[2] * ox + U[2] * oy);
        }
      }
      for (let s = 0; s < SEG; s++) for (let k = 0; k < SIDES; k++) {
        const k1 = (k + 1) % SIDES;
        const i0 = base + s * SIDES + k, i1 = base + s * SIDES + k1, i2 = base + (s + 1) * SIDES + k1, i3 = base + (s + 1) * SIDES + k;
        tris.push(i0, i2, i1, i0, i3, i2);
      }
      lashes.push({ a, b, f, side, C, n: (SEG + 1) * SIDES, base });
    };
    // upper lid: j from 0 (outer corner) to ME/2 (inner corner)
    const nUp = persona.lashCount || 46;
    for (let i = 0; i < nUp; i++) {
      const tt = 0.05 + 0.9 * (i + 0.5 * rnd()) / nUp; // along the lid, outer -> inner
      const jf = tt * ME / 2;
      const ja = Math.floor(jf), jb = Math.min(ja + 1, ME / 2);
      const outerness = 1 - tt;
      const len = persona.lashLen * (0.55 + 0.6 * Math.sin(Math.PI * Math.pow(outerness, 0.8)) * (0.75 + 0.25 * outerness)) * (0.85 + 0.3 * rnd());
      addLash(ja, jb, jf - ja, len, 0.55 + 0.25 * rnd(), persona.lashW * (0.8 + 0.4 * rnd()), false, (outerness - 0.45) * 0.35 + (rnd() - 0.5) * 0.12);
    }
    const nLo = persona.lowerLashes || 16;
    for (let i = 0; i < nLo; i++) {
      const tt = 0.15 + 0.75 * (i + 0.5 * rnd()) / nLo;
      const jf = ME / 2 + tt * ME / 2;
      const ja = Math.floor(jf) % ME, jb = (ja + 1) % ME;
      const outerness = tt;
      const len = persona.lashLen * 0.34 * (0.6 + 0.7 * outerness) * (0.8 + 0.4 * rnd());
      addLash(ja, jb, jf - Math.floor(jf), len, 0.25, persona.lashW * 0.6, true, (outerness - 0.5) * 0.3);
    }
  }
  const restV = Float32Array.from(verts);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(verts), 3));
  g.setIndex(tris);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: persona.lashColor || 0x140d0a, roughness: 0.55 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'lashes';
  mesh.frustumCulled = false;

  function update() {
    const out = rig.out, rest = rig.rest, ang = rig.lidAngle;
    const pos = g.attributes.position.array;
    for (const l of lashes) {
      const a = l.a, b = l.b;
      const th = mix(ang[a], ang[b], l.f);
      const ca = Math.cos(th), sa = Math.sin(th);
      // translation residual of the root after removing the lid rotation
      const rx = mix(rest[3 * a], rest[3 * b], l.f), ry = mix(rest[3 * a + 1], rest[3 * b + 1], l.f), rz = mix(rest[3 * a + 2], rest[3 * b + 2], l.f);
      const ox = mix(out[3 * a], out[3 * b], l.f), oy = mix(out[3 * a + 1], out[3 * b + 1], l.f), oz = mix(out[3 * a + 2], out[3 * b + 2], l.f);
      const C = l.C;
      const ryr = ry - C[1], rzr = rz - C[2];
      const dx = ox - rx, dy = oy - (C[1] + ryr * ca + rzr * sa), dz = oz - (C[2] - ryr * sa + rzr * ca);
      for (let i = 0; i < l.n; i++) {
        const o = 3 * (l.base + i);
        const y = restV[o + 1] - C[1], z = restV[o + 2] - C[2];
        pos[o] = restV[o] + dx;
        pos[o + 1] = C[1] + y * ca + z * sa + dy;
        pos[o + 2] = C[2] - y * sa + z * ca + dz;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }
  return { mesh, update };
}
