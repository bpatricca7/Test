// Ambient life around the player: little flapping pastel butterflies by day near flowers,
// glowing fireflies at night, cherry petals drifting under cherry trees, a falling leaf now and
// then, bubbles over water and snow glints in the sun. A spot scanner samples columns around
// the player a few at a time so nothing scans the whole world. Rendering is instanced (2 draw
// calls for all butterflies, 1 for fireflies); nothing is allocated per frame.

import * as THREE from 'three';

const CAT = { none: 0, flower: 1, cherry: 2, leaves: 3, water: 4, snow: 5, ground: 6 };
const CAP = 48;

// ---------- where are the flowers? ----------

class SpotScanner {
  constructor(game) {
    this.game = game;
    this.lists = [];
    for (let c = 0; c < 7; c++) this.lists.push({ xyz: new Float32Array(CAP * 3), n: 0, next: 0 });
    this.catOf = null;
  }

  reset() {
    for (const l of this.lists) { l.n = 0; l.next = 0; }
  }

  _categories() {
    const reg = this.game.registry.blocks;
    const cat = new Uint8Array(256);
    for (const def of reg.all()) {
      const k = def.key;
      let c = CAT.none;
      if (/^flower_|mushroom|tulip|rose|daisy|sunflower/.test(k)) c = CAT.flower;
      else if (k === 'leaves_cherry') c = CAT.cherry;
      else if (/leaves/.test(k)) c = CAT.leaves;
      else if (def.shape === 'liquid' && /water/.test(k)) c = CAT.water;
      else if (k === 'snow' || k === 'snow_leaves') c = CAT.snow;
      else if (def.solid && def.shape === 'cube') c = CAT.ground;
      cat[def.id] = c;
    }
    this.catOf = cat;
  }

  _add(c, x, y, z) {
    const l = this.lists[c];
    const i = l.next;
    l.xyz[i * 3] = x; l.xyz[i * 3 + 1] = y; l.xyz[i * 3 + 2] = z;
    l.next = (i + 1) % CAP;
    if (l.n < CAP) l.n++;
  }

  /** Sample `n` random columns within radius r of (cx, cz). */
  scan(cx, cz, r = 22, n = 36) {
    const w = this.game.world;
    if (!w) return;
    if (!this.catOf) this._categories();
    const b = w.blocks, sx = w.sx, sz = w.sz, sy = w.sy;
    for (let k = 0; k < n; k++) {
      const x = Math.floor(cx + (Math.random() * 2 - 1) * r), z = Math.floor(cz + (Math.random() * 2 - 1) * r);
      if (x < 0 || z < 0 || x >= sx || z >= sz) continue;
      let y = sy - 1;
      let id = 0;
      for (; y > 0; y--) { id = b[(y * sz + z) * sx + x]; if (id) break; }
      if (!id) continue;
      const c = this.catOf[id];
      if (!c) continue;
      if (c === CAT.cherry || c === CAT.leaves) {
        // the underside of the canopy, where petals and leaves let go
        let y2 = y;
        while (y2 > 1 && b[((y2 - 1) * sz + z) * sx + x] === id) y2--;
        this._add(c, x, y2 - 0.1, z);
      } else {
        this._add(c, x, y, z);
        if (c === CAT.flower) this._add(CAT.ground, x, y - 1, z);
      }
    }
  }

  /** A random remembered spot of a category between minD and maxD from p; fills out. */
  pick(c, p, maxD, out, minD = 0) {
    const l = this.lists[c];
    if (!l.n) return false;
    for (let t = 0; t < 6; t++) {
      const i = Math.floor(Math.random() * l.n);
      const x = l.xyz[i * 3], y = l.xyz[i * 3 + 1], z = l.xyz[i * 3 + 2];
      const dx = x + 0.5 - p.x, dz = z + 0.5 - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > maxD * maxD || d2 < minD * minD) continue;
      out[0] = x; out[1] = y; out[2] = z;
      return true;
    }
    return false;
  }
}

// ---------- butterflies ----------

const PAIRS = [['#FF9ECF', '#B69CFF'], ['#B69CFF', '#7CCBFF'], ['#7CCBFF', '#8EE8C8'], ['#FFE066', '#FF8CC6'], ['#8EE8C8', '#FFE066'], ['#FFB38A', '#C79CFF']];

function wingTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // u (x) = hinge -> tip, v (y) = front -> back. red = main tint, blue = accent, green = white
  const lobe = (fill, pad) => {
    g.fillStyle = fill;
    g.beginPath();
    // upper (front) wing: a big round lobe
    g.moveTo(4, 60);
    g.bezierCurveTo(10 - pad, 6 - pad, 104 + pad, -4 - pad, 122 + pad, 30);
    g.bezierCurveTo(126 + pad, 52, 92, 68 + pad, 4, 66);
    g.closePath();
    g.fill();
    // lower (back) wing: smaller and rounder
    g.beginPath();
    g.moveTo(4, 62);
    g.bezierCurveTo(70 + pad, 58, 104 + pad, 88, 88 + pad, 112 + pad);
    g.bezierCurveTo(70, 130 + pad, 20 - pad, 118 + pad, 4, 70);
    g.closePath();
    g.fill();
  };
  lobe('rgb(150,0,70)', 0); // rim (darker tint + a touch of accent)
  g.save();
  g.translate(7, 5);
  g.scale(0.9, 0.9);
  lobe('rgb(255,0,0)', 0);
  g.restore();
  // accent swirls and white polka dots
  const dot = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  dot(80, 28, 15, 'rgb(40,40,255)');
  dot(80, 28, 7, 'rgb(0,255,0)');
  dot(50, 92, 11, 'rgb(40,40,255)');
  dot(50, 92, 5, 'rgb(0,255,0)');
  dot(108, 36, 4, 'rgb(0,255,0)');
  dot(100, 18, 3, 'rgb(0,255,0)');
  dot(72, 104, 3.5, 'rgb(0,255,0)');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const wingVert = /* glsl */ `
attribute vec4 iPos;    // xyz, yaw
attribute vec4 iWing;   // flap angle, side, scale, -
attribute vec3 iColor;
attribute vec3 iAccent;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vAccent;
varying float vShade;
void main() {
  vUv = vec2(position.x, 1.0 - (position.z + 0.6) / 1.2);
  vColor = iColor;
  vAccent = iAccent;
  float a = iWing.x;
  vec3 w = vec3(position.x * cos(a) * iWing.y, position.x * sin(a), position.z) * iWing.z;
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 r = vec3(w.x * c + w.z * s, w.y, -w.x * s + w.z * c);
  vShade = 0.82 + 0.18 * cos(a);
  gl_Position = projectionMatrix * viewMatrix * vec4(iPos.xyz + r, 1.0);
}`;

const wingFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uLight;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vAccent;
varying float vShade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.5) discard;
  vec3 col = vColor * t.r + vAccent * t.b + vec3(t.g);
  gl_FragColor = vec4(min(col, vec3(1.0)) * vShade * uLight, 1.0);
}`;

const bodyVert = /* glsl */ `
attribute vec4 iPos;  // xyz, yaw
attribute float iScale;
varying float vShade;
void main() {
  vec3 w = position * iScale;
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 r = vec3(w.x * c + w.z * s, w.y, -w.x * s + w.z * c);
  vec3 n = vec3(normal.x * c + normal.z * s, normal.y, -normal.x * s + normal.z * c);
  vShade = 0.7 + 0.3 * max(0.0, dot(n, normalize(vec3(0.3, 1.0, 0.4))));
  gl_Position = projectionMatrix * viewMatrix * vec4(iPos.xyz + r, 1.0);
}`;

const bodyFrag = /* glsl */ `
uniform float uLight;
varying float vShade;
void main() { gl_FragColor = vec4(vec3(0.6, 0.45, 0.64) * vShade * uLight, 1.0); }`;

/** A slim body with two antennae (local +z = head). */
function bodyGeometry() {
  const pos = [], nrm = [], idx = [];
  const addBox = (cx, cy, cz, hx, hy, hz, tilt = 0, yaw = 0) => {
    const base = pos.length / 3;
    const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const ct = Math.cos(tilt), st = Math.sin(tilt), cy2 = Math.cos(yaw), sy2 = Math.sin(yaw);
    const tf = (x, y, z) => {
      // tilt around x (antenna leaning up), then yaw around y
      const y1 = y * ct - z * st, z1 = y * st + z * ct;
      return [x * cy2 + z1 * sy2, y1, -x * sy2 + z1 * cy2];
    };
    let v = 0;
    for (const [nx, ny, nz] of faces) {
      const u = ny !== 0 ? [1, 0, 0] : [0, 1, 0];
      const w = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = nx * hx + (u[0] * a + w[0] * b) * hx;
        const ly = ny * hy + (u[1] * a + w[1] * b) * hy;
        const lz = nz * hz + (u[2] * a + w[2] * b) * hz;
        const p = tf(lx, ly, lz), n = tf(nx, ny, nz);
        pos.push(cx + p[0], cy + p[1], cz + p[2]);
        nrm.push(n[0], n[1], n[2]);
      }
      idx.push(base + v, base + v + 1, base + v + 2, base + v, base + v + 2, base + v + 3);
      v += 4;
    }
  };
  addBox(0, 0, -0.02, 0.022, 0.022, 0.13);
  addBox(0, 0.005, 0.13, 0.03, 0.03, 0.03);
  addBox(-0.018, 0.05, 0.19, 0.006, 0.006, 0.07, -0.8, -0.4);
  addBox(0.018, 0.05, 0.19, 0.006, 0.006, 0.07, -0.8, 0.4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function createButterflies(scene, max) {
  const wingGeo = new THREE.InstancedBufferGeometry();
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.6, 1, 0, -0.6, 0, 0, 0.6, 1, 0, 0.6]), 3));
  wingGeo.setIndex([0, 2, 1, 1, 2, 3]);
  const wPos = new Float32Array(max * 2 * 4), wWing = new Float32Array(max * 2 * 4), wCol = new Float32Array(max * 2 * 3), wAcc = new Float32Array(max * 2 * 3);
  const aWPos = new THREE.InstancedBufferAttribute(wPos, 4).setUsage(THREE.DynamicDrawUsage);
  const aWWing = new THREE.InstancedBufferAttribute(wWing, 4).setUsage(THREE.DynamicDrawUsage);
  const aWCol = new THREE.InstancedBufferAttribute(wCol, 3);
  const aWAcc = new THREE.InstancedBufferAttribute(wAcc, 3);
  wingGeo.setAttribute('iPos', aWPos);
  wingGeo.setAttribute('iWing', aWWing);
  wingGeo.setAttribute('iColor', aWCol);
  wingGeo.setAttribute('iAccent', aWAcc);
  wingGeo.instanceCount = 0;
  const uniforms = { uMap: { value: wingTexture() }, uLight: { value: 1 } };
  const wings = new THREE.Mesh(wingGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: wingVert, fragmentShader: wingFrag, side: THREE.DoubleSide }));
  wings.frustumCulled = false;
  wings.name = 'butterfly-wings';

  const bodyGeo = new THREE.InstancedBufferGeometry().copy(bodyGeometry());
  const bPos = new Float32Array(max * 4), bScale = new Float32Array(max);
  const aBPos = new THREE.InstancedBufferAttribute(bPos, 4).setUsage(THREE.DynamicDrawUsage);
  const aBScale = new THREE.InstancedBufferAttribute(bScale, 1).setUsage(THREE.DynamicDrawUsage);
  bodyGeo.setAttribute('iPos', aBPos);
  bodyGeo.setAttribute('iScale', aBScale);
  bodyGeo.instanceCount = 0;
  const body = new THREE.Mesh(bodyGeo, new THREE.ShaderMaterial({ uniforms: { uLight: uniforms.uLight }, vertexShader: bodyVert, fragmentShader: bodyFrag }));
  body.frustumCulled = false;
  body.name = 'butterfly-bodies';
  wings.userData.envWarm = body.userData.envWarm = true;
  scene.add(wings, body);

  const list = [];
  for (let i = 0; i < max; i++) {
    list.push({
      on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hx: 0, hy: 0, hz: 0, tx: 0, ty: 0, tz: 0,
      yaw: 0, t: 0, ph: Math.random() * 10, rest: 0, landing: false, scale: 0, leaving: false, size: 1,
    });
  }
  const setColors = (i, pair) => {
    const hex = (h, arr, o) => { const n = parseInt(h.slice(1), 16); arr[o] = ((n >> 16) & 255) / 255; arr[o + 1] = ((n >> 8) & 255) / 255; arr[o + 2] = (n & 255) / 255; };
    for (let s = 0; s < 2; s++) {
      hex(pair[0], wCol, (i * 2 + s) * 3);
      hex(pair[1], wAcc, (i * 2 + s) * 3);
    }
    aWCol.needsUpdate = aWAcc.needsUpdate = true;
  };
  return { list, wings, body, uniforms, setColors, aWPos, aWWing, aBPos, aBScale, wPos, wWing, bPos, bScale, wingGeo, bodyGeo };
}

// ---------- fireflies ----------

const flyVert = /* glsl */ `
attribute vec4 fData; // brightness, size, -, -
attribute vec3 fColor;
uniform float uScale;
varying float vB;
varying vec3 vCol;
void main() {
  vB = fData.x;
  vCol = fColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(fData.y * uScale / max(0.1, -mv.z), 128.0);
  gl_Position = projectionMatrix * mv;
  if (vB < 0.01) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const flyFrag = /* glsl */ `
varying float vB;
varying vec3 vCol;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.34, 0.05, r);
  float halo = smoothstep(1.0, 0.0, r);
  float a = min(1.0, core * 1.2 + halo * halo * 0.75) * vB;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vCol, vec3(1.0), core * 0.7) * a, a);
}`;

function createFireflies(scene, max) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), data = new Float32Array(max * 4), col = new Float32Array(max * 3);
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aData = new THREE.BufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('fData', aData);
  geo.setAttribute('fColor', aCol);
  const uniforms = { uScale: { value: 600 } };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: flyVert, fragmentShader: flyFrag,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  points.frustumCulled = false;
  points.renderOrder = 11;
  points.name = 'fireflies';
  points.userData.envWarm = true;
  scene.add(points);
  const list = [];
  for (let i = 0; i < max; i++) list.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hx: 0, hy: 0, hz: 0, tx: 0, ty: 0, tz: 0, retarget: 0, ph: Math.random() * 20, fade: 0, leaving: false });
  return { list, points, uniforms, pos, data, col, aPos, aData, aCol };
}

const FIREFLY_COLORS = [[1, 0.95, 0.55], [0.88, 1, 0.55], [1, 0.86, 0.5]];
const FAIRY_COLORS = [[1, 0.7, 0.92], [0.7, 0.9, 1], [0.85, 0.75, 1], [0.7, 1, 0.9]];

// ---------- install ----------

export function installAmbient(game) {
  const scanner = new SpotScanner(game);
  const MAXB = 8, MAXF = 36;
  const bf = createButterflies(game.scene, MAXB);
  const ff = createFireflies(game.scene, MAXF);
  const spot = [0, 0, 0];
  const v3 = new THREE.Vector3();
  const timers = { butterfly: 1, firefly: 0.5, petal: 0.3, leaf: 1.5, bubble: 0.5, glint: 0.2 };
  let clock = 0;
  game.ambient = {
    scanner, butterflies: bf, fireflies: ff,
    /** Debug / fun: call a butterfly (or a firefly) to the block at x, y, z. */
    spawnButterfly: (x, y, z) => spawnButterfly(x, y, z),
    spawnFirefly: (x, y, z, fairy = false) => spawnFirefly(x, y, z, fairy),
    count: () => ({ butterflies: bf.list.filter((b) => b.on).length, fireflies: ff.list.filter((f) => f.on).length }),
  };

  const solidAt = (x, y, z) => {
    const w = game.world;
    const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return id !== 0 && game.registry.blocks.props.solid[id] === 1;
  };

  // --- butterflies ---
  const pickTarget = (b) => {
    if (Math.random() < 0.3) {
      b.tx = b.hx + 0.5; b.ty = b.hy + 0.72; b.tz = b.hz + 0.5;
      b.landing = true;
      return;
    }
    b.landing = false;
    for (let t = 0; t < 4; t++) {
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 2.6;
      b.tx = b.hx + 0.5 + Math.cos(a) * r;
      b.tz = b.hz + 0.5 + Math.sin(a) * r;
      b.ty = b.hy + 1 + Math.random() * 1.8;
      if (!solidAt(b.tx, b.ty, b.tz)) return;
    }
    b.tx = b.hx + 0.5; b.ty = b.hy + 2.5; b.tz = b.hz + 0.5;
  };

  const spawnButterfly = (x, y, z) => {
    const b = bf.list.find((q) => !q.on);
    if (!b) return false;
    const i = bf.list.indexOf(b);
    b.on = true; b.leaving = false; b.scale = 0; b.rest = 0; b.t = 0;
    b.hx = x; b.hy = y; b.hz = z;
    b.x = x + 0.5; b.y = y + 1.2; b.z = z + 0.5;
    b.vx = b.vy = b.vz = 0;
    b.size = 0.8 + Math.random() * 0.45;
    bf.setColors(i, PAIRS[Math.floor(Math.random() * PAIRS.length)]);
    pickTarget(b);
    return true;
  };

  const updateButterflies = (dt, p, keep, light) => {
    let n = 0;
    for (let i = 0; i < bf.list.length; i++) {
      const b = bf.list[i];
      if (b.on) {
        b.t += dt;
        const dxp = b.x - p.x, dzp = b.z - p.z;
        if (!keep || dxp * dxp + dzp * dzp > 34 * 34) b.leaving = true;
        if (b.leaving) {
          b.scale -= dt * 0.8;
          b.ty = b.y + 3;
          b.rest = 0;
          if (b.scale <= 0) b.on = false;
        } else b.scale = Math.min(1, b.scale + dt * 1.5);
      }
      if (!b.on) {
        // parked: a zero-size instance draws nothing
        bf.wWing[i * 8 + 2] = bf.wWing[i * 8 + 6] = 0;
        bf.bScale[i] = 0;
        continue;
      }
      n++;
      let flap;
      if (b.rest > 0) {
        b.rest -= dt;
        flap = 1.05 + 0.35 * Math.sin(b.t * 2.4 + b.ph);
        if (b.rest <= 0) pickTarget(b);
      } else {
        const dx = b.tx - b.x, dy = b.ty - b.y, dz = b.tz - b.z;
        const d = Math.hypot(dx, dy, dz);
        const sp = b.leaving ? 2.2 : b.landing && d < 1.2 ? 0.7 : 1.5;
        const k = Math.min(1, 2.6 * dt);
        b.vx += ((dx / (d || 1)) * sp - b.vx) * k;
        b.vy += ((dy / (d || 1)) * sp - b.vy) * k;
        b.vz += ((dz / (d || 1)) * sp - b.vz) * k;
        b.x += b.vx * dt;
        b.y += (b.vy + Math.sin(b.t * 6 + b.ph) * 0.9) * dt;
        b.z += b.vz * dt;
        if (Math.abs(b.vx) + Math.abs(b.vz) > 0.05) {
          const want = Math.atan2(b.vx, b.vz);
          const dyaw = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
          b.yaw += dyaw * Math.min(1, 5 * dt);
        }
        flap = 0.25 + 0.95 * (0.5 + 0.5 * Math.sin(b.t * 19 + b.ph));
        if (d < 0.25 && !b.leaving) {
          if (b.landing) { b.rest = 2 + Math.random() * 4; b.x = b.tx; b.y = b.ty; b.z = b.tz; b.vx = b.vy = b.vz = 0; }
          else pickTarget(b);
        }
        if (solidAt(b.x, b.y, b.z)) b.y += dt * 3;
      }
      const s = b.scale * b.size * 0.4;
      for (let side = 0; side < 2; side++) {
        const j = i * 2 + side;
        bf.wPos[j * 4] = b.x; bf.wPos[j * 4 + 1] = b.y; bf.wPos[j * 4 + 2] = b.z; bf.wPos[j * 4 + 3] = b.yaw;
        bf.wWing[j * 4] = flap; bf.wWing[j * 4 + 1] = side ? 1 : -1; bf.wWing[j * 4 + 2] = s;
      }
      bf.bPos[i * 4] = b.x; bf.bPos[i * 4 + 1] = b.y; bf.bPos[i * 4 + 2] = b.z; bf.bPos[i * 4 + 3] = b.yaw;
      bf.bScale[i] = b.scale * b.size * 1.25;
    }
    const show = n > 0;
    bf.wingGeo.instanceCount = show ? bf.list.length * 2 : 0;
    bf.bodyGeo.instanceCount = show ? bf.list.length : 0;
    bf.wings.visible = bf.body.visible = show;
    bf.uniforms.uLight.value = light;
    if (show || bf._was) bf.aWPos.needsUpdate = bf.aWWing.needsUpdate = bf.aBPos.needsUpdate = bf.aBScale.needsUpdate = true;
    bf._was = show;
    return n;
  };

  // --- fireflies ---
  const spawnFirefly = (x, y, z, fairy) => {
    const f = ff.list.find((q) => !q.on);
    if (!f) return false;
    const i = ff.list.indexOf(f);
    f.on = true; f.leaving = false; f.fade = 0;
    f.hx = x + 0.5; f.hy = y + 1; f.hz = z + 0.5;
    f.x = f.hx + (Math.random() - 0.5) * 2; f.y = f.hy + Math.random() * 1.5; f.z = f.hz + (Math.random() - 0.5) * 2;
    f.retarget = 0;
    const c = (fairy ? FAIRY_COLORS : FIREFLY_COLORS)[Math.floor(Math.random() * (fairy ? FAIRY_COLORS.length : FIREFLY_COLORS.length))];
    ff.col[i * 3] = c[0]; ff.col[i * 3 + 1] = c[1]; ff.col[i * 3 + 2] = c[2];
    ff.aCol.needsUpdate = true;
    return true;
  };

  const updateFireflies = (dt, p, keep) => {
    let n = 0;
    for (let i = 0; i < ff.list.length; i++) {
      const f = ff.list[i];
      if (!f.on) { ff.data[i * 4] = 0; continue; }
      const dxp = f.x - p.x, dzp = f.z - p.z;
      if (!keep || dxp * dxp + dzp * dzp > 28 * 28) f.leaving = true;
      f.fade = f.leaving ? f.fade - dt * 0.6 : Math.min(1, f.fade + dt * 0.5);
      if (f.fade <= 0 && f.leaving) { f.on = false; ff.data[i * 4] = 0; continue; }
      f.retarget -= dt;
      if (f.retarget <= 0) {
        f.retarget = 1.5 + Math.random() * 2.5;
        f.tx = f.hx + (Math.random() - 0.5) * 5;
        f.ty = f.hy + 0.2 + Math.random() * 2;
        f.tz = f.hz + (Math.random() - 0.5) * 5;
      }
      const k = Math.min(1, 0.8 * dt);
      f.vx += ((f.tx - f.x) * 0.35 - f.vx) * k;
      f.vy += ((f.ty - f.y) * 0.35 - f.vy) * k;
      f.vz += ((f.tz - f.z) * 0.35 - f.vz) * k;
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      ff.pos[i * 3] = f.x; ff.pos[i * 3 + 1] = f.y; ff.pos[i * 3 + 2] = f.z;
      const blink = 0.5 + 0.5 * Math.sin(clock * 1.9 + f.ph);
      ff.data[i * 4] = f.fade * (0.25 + 0.75 * blink * blink);
      ff.data[i * 4 + 1] = 0.7;
      n++;
    }
    ff.points.visible = n > 0;
    if (n || ff._was) { ff.aPos.needsUpdate = ff.aData.needsUpdate = true; }
    ff._was = n > 0;
    return n;
  };

  const reset = () => {
    scanner.reset();
    for (const b of bf.list) b.on = false;
    for (const f of ff.list) f.on = false;
    ff.data.fill(0);
    ff.aData.needsUpdate = true;
    bf.wingGeo.instanceCount = bf.bodyGeo.instanceCount = 0;
  };

  game.addSystem({
    name: 'ambient',
    onWorldLoad: reset,
    onWorldUnload: reset,
    update(dt) {
      if (game.mode !== 'play' || !game.world || !game.player) {
        bf.wings.visible = bf.body.visible = ff.points.visible = false;
        return;
      }
      clock += dt;
      const p = game.player.position;
      const low = game.profile.settings.quality === 'low';
      const tod = game.timeOfDay || { daylight: 1, night: 0 };
      const fx = game.weather ? game.weather.fx : null;
      const wet = fx ? Math.max(fx.rain, fx.snow) : 0;
      const biome = game.world.meta.biome;
      const fairy = biome === 'fairy';
      scanner.scan(p.x, p.z, 22, low ? 18 : 36);

      // butterflies: sunny days near flowers
      const bfOk = tod.daylight > 0.55 && wet < 0.3;
      const bfMax = low ? 4 : MAXB;
      const nb = updateButterflies(dt, p, bfOk, 0.55 + 0.45 * tod.daylight);
      if ((timers.butterfly -= dt) <= 0) {
        timers.butterfly = 1.2 + Math.random() * 1.5;
        if (bfOk && nb < bfMax && scanner.pick(CAT.flower, p, 20, spot, 3)) spawnButterfly(spot[0], spot[1], spot[2]);
      }

      // fireflies: warm little lights at night (pastel fairy lights in the Fairy Forest)
      const ffOk = (tod.night > 0.45 || (fairy && tod.daylight < 0.7)) && wet < 0.4;
      ff.uniforms.uScale.value = game.renderer.domElement.height / (2 * Math.tan((game.camera.fov * Math.PI) / 360));
      const nf = updateFireflies(dt, p, ffOk);
      if ((timers.firefly -= dt) <= 0) {
        timers.firefly = 0.25 + Math.random() * 0.4;
        const want = low ? 14 : fairy ? MAXF : 26;
        if (ffOk && nf < want && (scanner.pick(CAT.flower, p, 18, spot, 2) || scanner.pick(CAT.ground, p, 16, spot, 3))) {
          spawnFirefly(spot[0], spot[1], spot[2], fairy);
        }
      }

      const P = game.particles;
      if (!P) return;
      // cherry petals drifting down
      if ((timers.petal -= dt) <= 0) {
        timers.petal = (low ? 0.6 : 0.3) + Math.random() * 0.2;
        if (scanner.pick(CAT.cherry, p, 18, spot)) {
          v3.set(spot[0] + 0.5 + (Math.random() - 0.5) * 2.5, spot[1], spot[2] + 0.5 + (Math.random() - 0.5) * 2.5);
          P.emit('petal', v3, { count: 1, spread: 0.2 });
        }
      }
      // a leaf now and then
      if ((timers.leaf -= dt) <= 0) {
        timers.leaf = 1.6 + Math.random() * 2;
        if (scanner.pick(CAT.leaves, p, 14, spot)) {
          v3.set(spot[0] + Math.random(), spot[1], spot[2] + Math.random());
          P.emit('leaf', v3, { count: 1, spread: 0.2 });
        }
      }
      // bubbles popping up on ponds
      if ((timers.bubble -= dt) <= 0) {
        timers.bubble = 0.45 + Math.random() * 0.5;
        if (scanner.pick(CAT.water, p, 12, spot)) {
          v3.set(spot[0] + 0.2 + Math.random() * 0.6, spot[1] + 0.9, spot[2] + 0.2 + Math.random() * 0.6);
          P.emit('bubble', v3, { count: 1 + Math.floor(Math.random() * 2), scale: 0.6, spread: 0.3, speed: 0.4 });
        }
      }
      // glints on snow in the sun
      if ((timers.glint -= dt) <= 0) {
        timers.glint = low ? 0.25 : 0.1;
        if (tod.daylight > 0.3 && (!fx || fx.overcast < 0.5) && scanner.pick(CAT.snow, p, 14, spot)) {
          v3.set(spot[0] + Math.random(), spot[1] + 1.04, spot[2] + Math.random());
          P.emit('glint', v3, { count: 1, spread: 0, scale: 0.8 + Math.random() * 0.6 });
        }
      }
    },
  });
}
