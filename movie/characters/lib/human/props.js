// Accessories: Maya's round tortoiseshell glasses (lenses reflect the main
// monitor analytically), cardigan buttons + patch pockets, shirt collar and
// watch; Sam's hood, drawstrings, kangaroo pocket and over-ear headphones
// around the neck with a cable.

import * as THREE from 'three';
import { envTexture } from './materials.js';
import { BODY } from './rig.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------ helpers ---
/** copy skin weights from the nearest vertex of a skinned reference geometry */
export function skinFromNearest(geo, refs) {
  const P = geo.attributes.position.array;
  const n = P.length / 3;
  const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
  const CS = 0.03;
  const grid = new Map();
  const entries = [];
  for (const r of refs) {
    const RP = r.attributes.position.array, RI = r.attributes.skinIndex.array, RW = r.attributes.skinWeight.array;
    for (let i = 0; i < RP.length / 3; i++) {
      if (RW[4 * i] + RW[4 * i + 1] + RW[4 * i + 2] + RW[4 * i + 3] < 0.5) continue;
      const k = `${Math.floor(RP[3 * i] / CS)},${Math.floor(RP[3 * i + 1] / CS)},${Math.floor(RP[3 * i + 2] / CS)}`;
      let a = grid.get(k); if (!a) grid.set(k, a = []);
      a.push(entries.length);
      entries.push([RP[3 * i], RP[3 * i + 1], RP[3 * i + 2], RI, RW, i]);
    }
  }
  for (let v = 0; v < n; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(z / CS);
    let best = -1, bd = 1e9;
    for (let r = 1; r <= 3 && best < 0; r++) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
        const arr = grid.get(`${cx + a},${cy + b},${cz + c}`); if (!arr) continue;
        for (const e of arr) { const E = entries[e]; const d = (E[0] - x) ** 2 + (E[1] - y) ** 2 + (E[2] - z) ** 2; if (d < bd) { bd = d; best = e; } }
      }
    }
    if (best < 0) { SW[4 * v] = 1; continue; }
    const E = entries[best];
    for (let k = 0; k < 4; k++) { SI[4 * v + k] = E[3][4 * E[5] + k]; SW[4 * v + k] = E[4][4 * E[5] + k]; }
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  return geo;
}

function tubeGeometry(curve, segs, radius, radial, closed = false) {
  return new THREE.TubeGeometry(curve, segs, radius, radial, closed);
}

function mottleTexture(rnd, base, dark, N = 256, blobs = 180) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, N, N);
  for (let i = 0; i < blobs; i++) {
    const x = rnd() * N, y = rnd() * N, r = 4 + rnd() * 18;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, dark); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.globalAlpha = 0.35 + 0.5 * rnd();
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.4 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2); g.fill(); }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ----------------------------------------------------------- glasses ---
export function createGlasses(L, rnd) {
  const group = new THREE.Group(); group.name = 'glasses';
  const E = L.eyeL, R = L.eyeRadius;
  const lz = E[2] + R + 0.0125, ly = E[1] + 0.0012, lx = E[0] + 0.0005;
  const rimR = 0.0212;
  const shell = makeTortoise(rnd);
  const rimGeoms = [];
  for (const s of [1, -1]) {
    // rim: a slightly squared circle, rectangular-ish tube
    const pts = [];
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      const r = rimR * (1 + 0.035 * Math.cos(4 * a));
      pts.push(V3(s * lx + Math.cos(a) * r, ly + Math.sin(a) * r * 0.97, lz - 0.0025 * (Math.cos(a) * s * 0.5 + 0.5) - 0.001 * Math.sin(a)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const g = tubeGeometry(curve, 96, 0.00175, 7, true);
    g.scale(1, 1, 1);
    rimGeoms.push(g);
    // lens
    const lg = new THREE.CircleGeometry(rimR * 1.02, 40);
    const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i);
      lp.setZ(i, -(x * x + y * y) * 1.2);
    }
    lg.translate(s * lx, ly, lz - 0.0006);
    lg.computeVertexNormals();
    const lens = new THREE.Mesh(lg, makeLensMaterial());
    lens.renderOrder = 3;
    lens.name = 'lens';
    group.add(lens);
    // temple arm: hinge at the outer rim, back over the ear, then down behind it
    const hx = s * (lx + rimR + 0.001);
    const armPts = [V3(hx, ly + 0.004, lz - 0.003), V3(s * 0.066, ly + 0.008, lz - 0.02), V3(s * 0.074, ly + 0.012, 0.02),
      V3(s * 0.076, 0.012, -0.012), V3(s * 0.073, 0.004, -0.024), V3(s * 0.068, -0.012, -0.03)];
    const ac = new THREE.CatmullRomCurve3(armPts);
    rimGeoms.push(tubeGeometry(ac, 32, 0.0013, 6));
    // hinge block
    const hb = new THREE.BoxGeometry(0.004, 0.006, 0.006); hb.translate(hx, ly + 0.004, lz - 0.003);
    rimGeoms.push(hb.toNonIndexed ? hb : hb);
    // nose pad
    const np = new THREE.SphereGeometry(0.0022, 8, 6); np.scale(0.6, 1.2, 1); np.translate(s * 0.0095, ly - 0.006, lz - 0.008);
    rimGeoms.push(np);
  }
  // keyhole bridge
  const bc = new THREE.CatmullRomCurve3([V3(lx - rimR * 0.62, ly + rimR * 0.62, lz), V3(0.006, ly + 0.012, lz + 0.0015), V3(0, ly + 0.0128, lz + 0.002),
    V3(-0.006, ly + 0.012, lz + 0.0015), V3(-lx + rimR * 0.62, ly + rimR * 0.62, lz)]);
  rimGeoms.push(tubeGeometry(bc, 24, 0.0016, 6));
  for (const g of rimGeoms) {
    const m = new THREE.Mesh(g, shell);
    m.castShadow = true;
    group.add(m);
  }
  const lenses = group.children.filter(c => c.name === 'lens');
  return { group, lenses, tris: rimGeoms.reduce((a, g) => a + (g.index ? g.index.count / 3 : g.attributes.position.count / 3), 0) };
}

function makeTortoise(rnd) {
  const map = mottleTexture(rnd, '#9a5a22', 'rgba(35,15,6,0.95)', 256, 220);
  map.repeat.set(3, 1);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.28, metalness: 0.0, envMap: envTexture(), envMapIntensity: 0.6 });
}

/** glass lens: fresnel reflection + an analytic reflection of the main monitor */
export function makeLensMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, envMap: envTexture(), envMapIntensity: 0.35, side: THREE.DoubleSide });
  mat.userData.uniforms = {
    uScrC: { value: new THREE.Vector3(-0.5, 1.12, -1.7) }, uScrR: { value: new THREE.Vector3(1, 0, 0) }, uScrU: { value: new THREE.Vector3(0, 1, 0) },
    uScrSize: { value: new THREE.Vector2(0.62, 0.35) }, uScrColor: { value: new THREE.Color(0.35, 0.75, 1.0) }, uScrI: { value: 0.9 },
    uScrTex: { value: null }, uUseTex: { value: 0 },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNrm;
uniform vec3 uScrC, uScrR, uScrU; uniform vec2 uScrSize; uniform vec3 uScrColor; uniform float uScrI;
uniform sampler2D uScrTex; uniform float uUseTex;`)
      .replace('#include <opaque_fragment>', `
{
  vec3 V = normalize(vWPos - cameraPosition);
  vec3 Nw = normalize(vWNrm);
  if (dot(Nw, V) > 0.0) Nw = -Nw;
  vec3 Rw = reflect(V, Nw);
  vec3 sn = normalize(cross(uScrR, uScrU));
  float den = dot(Rw, sn);
  float fres = 0.04 + 0.96 * pow(1.0 - abs(dot(Nw, -V)), 5.0);
  if (abs(den) > 1e-4) {
    float tt = dot(uScrC - vWPos, sn) / den;
    if (tt > 0.0) {
      vec3 hit = vWPos + Rw * tt - uScrC;
      vec2 uv = vec2(dot(hit, uScrR) / uScrSize.x, dot(hit, uScrU) / uScrSize.y) + 0.5;
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        vec3 sc = uUseTex > 0.5 ? texture2D(uScrTex, uv).rgb : uScrColor;
        float edge = smoothstep(0.0, 0.04, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
        outgoingLight += sc * uScrI * (0.25 + fres) * edge;
      }
    }
  }
  outgoingLight += vec3(0.012, 0.014, 0.016);
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'human-lens';
  return mat;
}

// ---------------------------------------------------------- headphones ---
/** over-ear headphones around the neck; built in chest-bone space from the torso surface */
export function createHeadphones(id, rnd, torsoAt) {
  const B = BODY[id];
  const C0 = V3(...B.chest);
  const group = new THREE.Group(); group.name = 'headphones';
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.42, metalness: 0.15 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd0582c, roughness: 0.38 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa4aab2, roughness: 0.28, metalness: 0.9 });
  const meshMat = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.9 });
  let tris = 0;
  const count = g => { tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; return g; };
  const yCup = B.neck[1] - 0.012;
  const cups = [];
  for (const s of [1, -1]) {
    const cup = new THREE.Group();
    cup.position.set(s * 0.088, yCup - C0.y, B.neck[2] + 0.035 - C0.z);
    // cushions face each other across the neck, tipped up a little
    const up = V3(-s * 0.85, 0.42, 0.1).normalize();
    cup.quaternion.setFromUnitVectors(V3(0, 1, 0), up);
    const shellG = count(new THREE.CylinderGeometry(0.043, 0.047, 0.03, 28, 1)); shellG.scale(1, 1, 0.86);
    const sm = new THREE.Mesh(shellG, shellMat); sm.position.y = -0.011; cup.add(sm);
    const cap = new THREE.Mesh(count(new THREE.CylinderGeometry(0.03, 0.035, 0.006, 24)), accent); cap.position.y = -0.028; cup.add(cap);
    const logo = new THREE.Mesh(count(new THREE.CylinderGeometry(0.011, 0.011, 0.002, 12)), metal); logo.position.y = -0.032; cup.add(logo);
    const padG = count(new THREE.TorusGeometry(0.034, 0.012, 10, 30)); padG.rotateX(Math.PI / 2); padG.scale(1, 0.72, 0.86);
    const pad = new THREE.Mesh(padG, padMat); pad.position.y = 0.009; cup.add(pad);
    const cl = new THREE.Mesh(count(new THREE.CircleGeometry(0.027, 20).rotateX(-Math.PI / 2)), meshMat); cl.position.y = 0.004; cup.add(cl);
    const yoke = count(new THREE.TorusGeometry(0.049, 0.0028, 6, 20, Math.PI)); yoke.rotateY(Math.PI / 2);
    const yk = new THREE.Mesh(yoke, metal); yk.position.y = -0.006; cup.add(yk);
    cup.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.add(cup);
    cups.push(cup);
  }
  // headband: from each cup's yoke, up over the shoulders and round the back of the neck
  const nb = V3(...B.neck);
  const bandPts = [];
  for (let i = 0; i <= 18; i++) {
    const a = -Math.PI * 0.62 + i / 18 * Math.PI * 1.24; // 0 = back of the neck
    const r = 0.092 - 0.006 * Math.cos(a);
    bandPts.push(V3(Math.sin(a) * r, nb.y + 0.03 + 0.012 * Math.cos(a) - C0.y, nb.z - Math.cos(a) * r * 0.95 + 0.02 - C0.z));
  }
  const bc = new THREE.CatmullRomCurve3(bandPts);
  const bandG = count(new THREE.TubeGeometry(bc, 44, 0.005, 8)); bandG.scale(1, 1, 1);
  group.add(new THREE.Mesh(bandG, shellMat));
  const padC = new THREE.CatmullRomCurve3(bandPts.slice(5, 14));
  const bp = count(new THREE.TubeGeometry(padC, 26, 0.0085, 8));
  group.add(new THREE.Mesh(bp, padMat));
  // cable: left cup, down the chest into the kangaroo pocket
  const c0 = cups[0].position;
  const [, dzP, czP] = torsoAt(B.hips[1] + 0.19, 0.12);
  const cable = new THREE.CatmullRomCurve3([c0.clone().add(V3(0.01, -0.03, 0.0)), c0.clone().add(V3(0.004, -0.09, 0.01)),
    V3(0.05, B.hips[1] + 0.32 - C0.y, czP + dzP + 0.015 - C0.z), V3(0.035, B.hips[1] + 0.2 - C0.y, czP + dzP + 0.01 - C0.z)]);
  group.add(new THREE.Mesh(count(new THREE.TubeGeometry(cable, 36, 0.0017, 5)), shellMat));
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group, tris };
}

// ---------------------------------------------------- hood/drawstrings ---
/** hood pouch draped on the upper back + neckline roll (bind space, skinned later) */
export function createHoodGeoms(id, torsoAt) {
  const B = BODY[id];
  const yN = B.neck[1];
  // pouch: a patch over the back of the torso, bulging, with folds
  const P = [], UV = [], C = [], idx = [];
  const nu = 20, nv = 14;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv; // 0 bottom .. 1 top (neck)
    const y = yN - 0.24 + 0.24 * v + 0.012;
    const halfW = 0.95 - 0.28 * Math.pow(1 - v, 2);
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu - 0.5) * 2;
      const th = Math.PI + u * halfW;
      const bulge = 0.01 + 0.03 * Math.sin(Math.PI * Math.min(1, v * 1.25)) * Math.pow(1 - u * u, 0.6) + 0.004 * Math.sin(u * 7 + v * 5) * (1 - u * u);
      const edge = Math.min(1, (1 - Math.abs(u)) * 5) * Math.min(1, v * 6);
      const [dx, dz, cz] = torsoAt(y, th, 0.004 + bulge * edge);
      P.push(dx, y - 0.012 * (1 - edge), cz + dz);
      UV.push(u * 0.3, y);
      const k = 0.86 + 0.14 * edge - 0.08 * (0.5 + 0.5 * Math.sin(u * 7 + v * 5)) * (1 - u * u);
      C.push(k, k, k);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const pouch = new THREE.BufferGeometry();
  pouch.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  pouch.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  pouch.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  pouch.setIndex(idx);
  pouch.computeVertexNormals();
  // neckline roll: round the neck, crossing to a V at the front
  const rP = [], rUV = [], rC = [], rI = [];
  const NA = 40, NS = 10;
  const ring = [];
  for (let i = 0; i <= NA; i++) {
    const a = -Math.PI * 0.9 + i / NA * Math.PI * 1.8; // 0 = back
    const front = Math.max(0, -Math.cos(a));
    const y = yN - 0.004 - 0.055 * front * front;
    const th = Math.PI - a;
    // sit on the torso surface around the neck opening, lying flatter at the front
    const r = 0.013 + 0.01 * (1 - front);
    const [dx, dz, cz] = torsoAt(y, th, r * (0.3 + 0.5 * front));
    const k = 0.82 + 0.18 * front;
    ring.push({ p: V3(dx * k, y + r * 0.3 * (1 - front), cz + dz * (0.9 + 0.1 * front)), r });
  }
  for (let i = 0; i <= NA; i++) {
    const cur = ring[i], prv = ring[Math.max(0, i - 1)], nxt = ring[Math.min(NA, i + 1)];
    const T = nxt.p.clone().sub(prv.p).normalize();
    const X = new THREE.Vector3().crossVectors(T, V3(0, 1, 0)).normalize();
    const Y = new THREE.Vector3().crossVectors(X, T).normalize();
    for (let k = 0; k <= NS; k++) {
      const a2 = k / NS * Math.PI * 2;
      const q = cur.p.clone().addScaledVector(X, Math.cos(a2) * cur.r * 1.2).addScaledVector(Y, Math.sin(a2) * cur.r * 0.8 + cur.r * 0.5);
      rP.push(q.x, q.y, q.z); rUV.push(a2 * cur.r, i / NA * 0.42); rC.push(0.95, 0.95, 0.95);
    }
  }
  for (let i = 0; i < NA; i++) for (let k = 0; k < NS; k++) {
    const a = i * (NS + 1) + k, b = a + 1, c = a + NS + 1, d = c + 1;
    rI.push(a, c, b, b, c, d);
  }
  const roll = new THREE.BufferGeometry();
  roll.setAttribute('position', new THREE.Float32BufferAttribute(rP, 3));
  roll.setAttribute('uv', new THREE.Float32BufferAttribute(rUV, 2));
  roll.setAttribute('color', new THREE.Float32BufferAttribute(rC, 3));
  roll.setIndex(rI);
  roll.computeVertexNormals();
  return { pouch, roll, tris: idx.length / 3 + rI.length / 3, rollFront: ring[Math.floor(NA / 2)].p };
}

/** drawstrings hanging from eyelets on the neckline, in chest-bone space */
export function createDrawstrings(id, torsoAt) {
  const B = BODY[id];
  const C0 = V3(...B.chest);
  const group = new THREE.Group(); group.name = 'drawstrings';
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.85 });
  const agMat = new THREE.MeshStandardMaterial({ color: 0xbab6aa, roughness: 0.3, metalness: 0.75 });
  const strings = [];
  for (const s of [1, -1]) {
    const y0 = B.neck[1] - 0.06;
    const [dx0, dz0, cz0] = torsoAt(y0, s * 0.2, 0);
    const piv = new THREE.Group();
    const top = V3(dx0, y0, cz0 + dz0 + 0.004);
    piv.position.copy(top).sub(C0);
    const len = 0.21 + (s > 0 ? 0.035 : 0);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const y = y0 - len * i / 8;
      const [dx, dz, cz] = torsoAt(y, s * (0.2 + 0.05 * i / 8), 0.006);
      pts.push(V3(dx, y, cz + dz).sub(top));
    }
    const c = new THREE.CatmullRomCurve3(pts);
    piv.add(new THREE.Mesh(new THREE.TubeGeometry(c, 20, 0.0026, 6), cordMat));
    const end = pts[pts.length - 1];
    const ag = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0026, 0.02, 8), agMat);
    ag.position.copy(end).add(V3(0, -0.01, 0));
    piv.add(ag);
    const ey = new THREE.Mesh(new THREE.TorusGeometry(0.0045, 0.0013, 5, 12), agMat);
    ey.position.set(0, 0.004, 0.001);
    piv.add(ey);
    piv.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.add(piv);
    strings.push(piv);
  }
  return { group, strings, tris: 2 * (20 * 6 * 2 + 40) };
}

/** kangaroo pocket patch in bind space (skinned via nearest torso vertices) */
export function createKangaroo(id, torsoSection) {
  const B = BODY[id];
  const y0 = B.hips[1] + 0.02, y1 = B.hips[1] + 0.2;
  const P = [], UV = [], idx = [];
  const nu = 18, nv = 10;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const y = y0 + (y1 - y0) * v;
    // opening slants: the patch narrows toward the top
    const half = 0.5 - 0.16 * sstep(0.35, 1, v);
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu - 0.5) * 2 * half; // -half..half of the front arc (radians-ish)
      const th = u * 1.25;
      const [dx, dz, cz] = torsoSection(y, th);
      const off = 0.006 + 0.004 * Math.sin(Math.PI * v) ;
      const l = Math.hypot(dx, dz) || 1;
      P.push(dx + dx / l * off, y, cz + dz + dz / l * off);
      UV.push(u * 0.3, y);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  const col = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const edge = i === 0 || i === nu || j === nv ? 0.72 : 1;
    col.push(edge, edge, edge);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** cardigan buttons + patch pockets (Maya) in bind space */
export function createCardiganBits(openAtY, sectionAt) {
  const geoms = { buttons: [], pockets: [] };
  // buttons down her right band (x < 0)
  for (let i = 0; i < 5; i++) {
    const y = 1.23 - i * 0.075;
    const th = Math.PI * 2 - openAtY(y);
    const [dx, dz, cz] = sectionAt(y, th, 0.019);
    const out = V3(dx, 0, dz).normalize();
    const b = new THREE.CylinderGeometry(0.0072, 0.0072, 0.003, 16);
    b.rotateX(Math.PI / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), out);
    b.applyQuaternion(q);
    b.translate(dx + out.x * 0.002 + 0.004, y, cz + dz + out.z * 0.002);
    geoms.buttons.push(b);
  }
  // patch pockets at hip level, both sides
  for (const s of [1, -1]) {
    const P = [], UV = [], idx = [];
    const nu = 8, nv = 8;
    for (let j = 0; j <= nv; j++) {
      const y = 0.9 + 0.12 * j / nv;
      for (let i = 0; i <= nu; i++) {
        const th = s * (0.55 + 0.55 * i / nu);
        const [dx, dz, cz] = sectionAt(y, th, 0.022);
        P.push(dx, y, cz + dz); UV.push(th * 0.17, y);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (s > 0) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    const col = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const e = j === nv ? 0.85 : (i === 0 || i === nu || j === 0) ? 0.8 : 1; col.push(e, e, e); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    geoms.pockets.push(g);
  }
  return geoms;
}

/** a watch on Maya's left wrist (bind space, skinned to the twist bone) */
export function createWatch(J, twistIdx) {
  const wrist = J.handL.clone().addScaledVector(J.armDirL, -0.035);
  const dir = J.armDirL.clone();
  const group = [];
  const band = new THREE.TorusGeometry(0.029, 0.0045, 6, 28);
  band.scale(1, 1, 0.9);
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), dir);
  band.applyQuaternion(q); band.translate(wrist.x, wrist.y, wrist.z);
  const face = new THREE.CylinderGeometry(0.012, 0.012, 0.005, 20);
  // on the back of the wrist (away from the palm): palm faces -x for the left arm in bind
  const back = V3(Math.cos(40 * Math.PI / 180), Math.sin(40 * Math.PI / 180), 0);
  const q2 = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), back);
  face.applyQuaternion(q2);
  const fp = wrist.clone().addScaledVector(back, 0.029);
  face.translate(fp.x, fp.y, fp.z);
  for (const g of [band, face]) {
    const n = g.attributes.position.count;
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(n * 4).map((_, i) => i % 4 === 0 ? twistIdx : 0), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(n * 4).map((_, i) => i % 4 === 0 ? 1 : 0), 4));
  }
  return { band, face };
}

/** Maya's shirt collar: a stand with a fold-down fall and points at the front (bind space) */
export function createShirtCollar(id, torsoAt) {
  const B = BODY[id];
  const yN = B.neck[1] + 0.036;
  const P = [], UV = [], C = [], idx = [];
  const NA = 36, NS = 6;
  for (let i = 0; i <= NA; i++) {
    const a = -Math.PI * 0.86 + i / NA * Math.PI * 1.72; // 0 = back
    const front = Math.max(0, -Math.cos(a));
    const y = yN - 0.03 * front * front;
    const [dx, dz, cz] = torsoAt(y, Math.PI - a, 0);
    const k = 0.74 + 0.2 * front;
    const base = V3(dx * k, y, cz + dz * k);
    const out = V3(dx, 0, dz).normalize();
    const stand = 0.021 - 0.008 * front;
    const fall = 0.03 + 0.028 * Math.pow(front, 3);
    // cross-section: base -> stand top -> fold -> fall tip
    const sec = [
      base.clone(),
      base.clone().add(V3(0, stand * 0.55, 0)).addScaledVector(out, 0.001),
      base.clone().add(V3(0, stand, 0)).addScaledVector(out, 0.002),
      base.clone().add(V3(0, stand + 0.003, 0)).addScaledVector(out, 0.007),
      base.clone().add(V3(0, stand - fall * 0.45, 0)).addScaledVector(out, 0.012 + 0.004 * front),
      base.clone().add(V3(0, stand - fall, 0)).addScaledVector(out, 0.015 + 0.012 * front),
    ];
    for (let k2 = 0; k2 < NS; k2++) { P.push(sec[k2].x, sec[k2].y, sec[k2].z); UV.push(i / NA * 0.4, k2 / NS * 0.05); const e = k2 === NS - 1 ? 0.9 : 1; C.push(e, e, e); }
  }
  for (let i = 0; i < NA; i++) for (let k = 0; k < NS - 1; k++) {
    const a = i * NS + k, b = a + 1, c = a + NS, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
