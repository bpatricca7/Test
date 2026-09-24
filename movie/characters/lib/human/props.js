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
export function createHeadphones(id, rnd) {
  const B = BODY[id];
  const group = new THREE.Group(); group.name = 'headphones';
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.1 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xc8502a, roughness: 0.4 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.9 });
  const meshMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.9 });
  // chest-local frame (relative to the chest bone): cups rest on the collarbones
  const ny = B.neck[1] - B.chest[1];
  let tris = 0;
  const add = (g, m) => { const me = new THREE.Mesh(g, m); me.castShadow = true; group.add(me); tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; return me; };
  for (const s of [1, -1]) {
    const cup = new THREE.Group();
    cup.position.set(s * 0.078, ny - 0.03, 0.04);
    // cushions face up/in toward the neck, the shells out/down
    cup.rotation.set(-1.15, 0, s * 0.55);
    const shellG = new THREE.CylinderGeometry(0.043, 0.047, 0.026, 28, 1); shellG.scale(1, 1, 0.86);
    const sm = new THREE.Mesh(shellG, shellMat); sm.position.y = -0.008; cup.add(sm);
    const capG = new THREE.CylinderGeometry(0.03, 0.036, 0.006, 24); const cap = new THREE.Mesh(capG, accent); cap.position.y = -0.023; cup.add(cap);
    const padG = new THREE.TorusGeometry(0.034, 0.011, 10, 28); padG.rotateX(Math.PI / 2); padG.scale(1, 0.75, 0.88);
    const pad = new THREE.Mesh(padG, padMat); pad.position.y = 0.01; cup.add(pad);
    const clothG = new THREE.CircleGeometry(0.028, 20); clothG.rotateX(-Math.PI / 2);
    const cl = new THREE.Mesh(clothG, meshMat); cl.position.y = 0.006; cup.add(cl);
    // yoke fork
    const yoke = new THREE.TorusGeometry(0.046, 0.0028, 6, 20, Math.PI); yoke.rotateY(Math.PI / 2);
    const yk = new THREE.Mesh(yoke, metal); yk.position.y = -0.004; yk.rotation.z = 0; cup.add(yk);
    group.add(cup);
    for (const c of cup.children) { c.castShadow = true; tris += c.geometry.index ? c.geometry.index.count / 3 : 0; }
  }
  // headband: arcs round the back of the neck, padded in the middle
  const bandPts = [];
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI * 0.62 + i / 16 * Math.PI * 1.24;
    bandPts.push(V3(Math.sin(a) * 0.084, ny + 0.008 + 0.03 * Math.cos(a) * 0.3, -0.035 - Math.cos(a) * 0.06 + 0.052));
  }
  const bc = new THREE.CatmullRomCurve3(bandPts);
  add(new THREE.TubeGeometry(bc, 40, 0.0055, 8), shellMat);
  const padC = new THREE.CatmullRomCurve3(bandPts.slice(4, 13));
  const bp = new THREE.TubeGeometry(padC, 24, 0.0085, 8); bp.scale(1, 0.8, 1);
  add(bp, padMat);
  // cable from the left cup down into the pocket
  const cable = new THREE.CatmullRomCurve3([V3(0.085, ny - 0.07, 0.07), V3(0.08, ny - 0.14, 0.11), V3(0.05, ny - 0.26, 0.125), V3(0.03, ny - 0.36, 0.13)]);
  add(new THREE.TubeGeometry(cable, 30, 0.0018, 5), shellMat);
  return { group, tris };
}

// ---------------------------------------------------- hood/drawstrings ---
export function createHood(id, mats) {
  const B = BODY[id];
  const group = new THREE.Group(); group.name = 'hood';
  const ny = B.neck[1] - B.chest[1];
  // a rolled hood lying round the back of the neck: loft of fat ovals along a U path
  const path = [];
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI * 0.72 + i / 24 * Math.PI * 1.44;
    const back = Math.cos(a); // 1 at the back
    path.push({ p: V3(Math.sin(a) * (0.082 + 0.02 * back), ny - 0.012 + 0.005 * back - 0.03 * (1 - back) , -0.03 - back * 0.07 + (1 - back) * 0.06), a, back });
  }
  const P = [], N = [], UV = [], idx = [];
  const sides = 12;
  for (let i = 0; i < path.length; i++) {
    const cur = path[i], nxt = path[Math.min(i + 1, path.length - 1)], prv = path[Math.max(i - 1, 0)];
    const T = nxt.p.clone().sub(prv.p).normalize();
    const up = V3(0, 1, 0);
    const X = new THREE.Vector3().crossVectors(T, up).normalize();
    const Y = new THREE.Vector3().crossVectors(X, T).normalize();
    const bulk = 0.014 + 0.028 * Math.pow(cur.back, 1.5);
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * Math.PI * 2;
      const r1 = bulk * 1.25, r2 = bulk * 0.75;
      const dir = X.clone().multiplyScalar(Math.cos(a) * r1).addScaledVector(Y, Math.sin(a) * r2);
      // the back of the hood droops down the upper back
      if (Math.sin(a) < 0 && cur.back > 0.3) dir.y -= 0.05 * cur.back * cur.back * (-Math.sin(a));
      const p = cur.p.clone().add(dir);
      P.push(p.x, p.y, p.z); UV.push(k / sides * 0.25, i / path.length * 0.6);
    }
  }
  for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < sides; k++) {
    const a = i * (sides + 1) + k, b = a + 1, c = a + sides + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(P.length).fill(0.92), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const hood = new THREE.Mesh(g, mats.hoodie);
  hood.castShadow = true; hood.receiveShadow = true;
  group.add(hood);
  // drawstrings from eyelets at the front of the neckline, with aglets
  const strings = [];
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xe9e2cc, roughness: 0.8 });
  const agMat = new THREE.MeshStandardMaterial({ color: 0xb8b4a8, roughness: 0.3, metalness: 0.7 });
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 0.028, ny - 0.035, 0.085);
    const len = 0.2 + (s > 0 ? 0.03 : 0);
    const c = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(s * 0.004, -len * 0.3, 0.012), V3(s * 0.006, -len * 0.7, 0.02), V3(s * 0.004, -len, 0.022)]);
    piv.add(new THREE.Mesh(new THREE.TubeGeometry(c, 16, 0.0022, 5), cordMat));
    const ag = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.018, 6), agMat);
    ag.position.set(s * 0.004, -len - 0.008, 0.022);
    piv.add(ag);
    // eyelet
    const ey = new THREE.Mesh(new THREE.TorusGeometry(0.004, 0.0012, 5, 10), agMat);
    ey.position.set(0, 0.004, -0.002);
    piv.add(ey);
    group.add(piv);
    strings.push(piv);
  }
  return { group, strings, tris: idx.length / 3 + 2 * (16 * 5 * 2 + 30) };
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
