// Shared space pieces for journey.js and ending.js: the Milky Way (as a star
// sky seen from the Sun, or as a spiral seen from outside), screen-space glow
// ribbons for beams and orbits, soft sprites, and small camera-math helpers.

// ---------------------------------------------------------------------------
// math
// ---------------------------------------------------------------------------

/** cubic Hermite through keys [[t, value, slope], ...]; linear outside */
export function hermite(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1] + keys[0][2] * (t - keys[0][0]);
  if (t >= keys[n - 1][0]) return keys[n - 1][1] + keys[n - 1][2] * (t - keys[n - 1][0]);
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const [t0, v0, m0] = keys[i], [t1, v1, m1] = keys[i + 1];
  const h = t1 - t0, s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1;
}

/** yaw/pitch/roll (degrees) -> quaternion, relative to a camera looking down -Z */
export function yprQuat(THREE, yaw, pitch, roll, out) {
  const d = Math.PI / 180;
  const e = new THREE.Euler(pitch * d, yaw * d, roll * d, 'YXZ');
  return (out || new THREE.Quaternion()).setFromEuler(e);
}

/** unit direction from galactic longitude/latitude (deg), galaxy-local frame */
export function galDir(l, b) {
  const d = Math.PI / 180;
  // toward the centre from the Sun is -Z (Sun sits on +Z); l = 90 deg is -X,
  // the direction the disc turns (it rotates by RotY(-angle))
  return [-Math.cos(b * d) * Math.sin(l * d), Math.sin(b * d), -Math.cos(b * d) * Math.cos(l * d)];
}

// ---------------------------------------------------------------------------
// the galaxy (galaxy-local frame: plane XZ, north +Y, centre at origin, ly)
// ---------------------------------------------------------------------------

export const SUN_R = 26000;
export const SUN_LOCAL = [0, 0, SUN_R];
export const M13_DIST = 25000;
export const M13_LB = [59, 46];

let GAL = null;

function starColor(rnd, out) {
  // rough main-sequence mix: many warm stars, a few hot blue ones
  const r = rnd();
  if (r < 0.12) { out[0] = 0.62; out[1] = 0.74; out[2] = 1.0; }
  else if (r < 0.35) { out[0] = 0.86; out[1] = 0.9; out[2] = 1.0; }
  else if (r < 0.65) { out[0] = 1.0; out[1] = 0.94; out[2] = 0.84; }
  else if (r < 0.88) { out[0] = 1.0; out[1] = 0.82; out[2] = 0.62; }
  else { out[0] = 1.0; out[1] = 0.66; out[2] = 0.45; }
  return out;
}

export function galaxyData(U) {
  if (GAL) return GAL;
  const rnd = U.mulberry32(25000);
  const g = () => U.gauss(rnd);
  const P = [], C = [], L = [], K = [];
  const push = (x, y, z, r, gg, b, l, k) => { P.push(x, y, z); C.push(r, gg, b); L.push(l); K.push(k); };
  const tmp = [0, 0, 0];
  const pitch = Math.tan(16 * Math.PI / 180), r0 = 4200;
  const armAngle = (r, off) => off - Math.log(r / r0) / pitch;

  // bar + bulge
  const bar = 0.5;
  for (let i = 0; i < 26000; i++) {
    let x = g() * 4300, y = g() * 1300, z = g() * 1700;
    const cx = Math.cos(bar), sx = Math.sin(bar);
    [x, z] = [x * cx - z * sx, x * sx + z * cx];
    const w = rnd();
    push(x, y, z, 1.0, 0.62 + 0.14 * w, 0.32 + 0.16 * w, 0.30 * Math.exp(g() * 0.4), 0);
  }
  for (let i = 0; i < 14000; i++) {
    const s = 2300 * Math.pow(rnd(), 0.35) + Math.abs(g()) * 900;
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
    push(s * Math.sin(ph) * Math.cos(th), s * Math.cos(ph) * 0.62, s * Math.sin(ph) * Math.sin(th),
      1.0, 0.70, 0.42, 0.32 * Math.exp(g() * 0.4), 0);
  }

  // clump centres along the arms
  const arms = [[0, 0.36], [Math.PI, 0.36], [Math.PI * 0.5, 0.14], [Math.PI * 1.5, 0.14]];
  const pickArm = () => { let r = rnd(); for (const a of arms) { if (r < a[1]) return a[0]; r -= a[1]; } return 0; };
  const armR = () => { for (;;) { const r = 3800 - 13500 * Math.log(1 - rnd() * 0.97); if (r < 54000) return r; } };
  const clumps = [];
  for (let i = 0; i < 2200; i++) {
    const r = armR(), off = pickArm();
    const a = armAngle(r, off) + g() * 0.09;
    const rr = r + g() * 700;
    clumps.push([rr * Math.cos(a), rr * Math.sin(a), 350 + rnd() * 700, r]);
  }
  // arm stars
  for (let i = 0; i < 100000; i++) {
    let x, z, r;
    if (rnd() < 0.55) {
      const c = clumps[Math.floor(rnd() * clumps.length)];
      x = c[0] + g() * c[2]; z = c[1] + g() * c[2]; r = c[3];
    } else {
      r = armR();
      const a = armAngle(r, pickArm());
      const spread = 1300 + 0.06 * r;
      const rr = r + g() * spread * 0.6;
      const aa = a + g() * spread / Math.max(r, 3000);
      x = rr * Math.cos(aa); z = rr * Math.sin(aa);
    }
    const y = g() * (180 + 0.004 * r);
    const w = rnd();
    let cr, cg, cb;
    if (w < 0.55) { cr = 0.55; cg = 0.70; cb = 1.0; }
    else if (w < 0.85) { cr = 0.80; cg = 0.87; cb = 1.0; }
    else { cr = 1.0; cg = 0.9; cb = 0.78; }
    push(x, y, z, cr, cg, cb, 0.8 * Math.exp(g() * 0.55), 0);
  }
  // HII regions: pink knots on the arms
  for (let i = 0; i < 3000; i++) {
    const c = clumps[Math.floor(rnd() * 700)];
    push(c[0] + g() * 260, g() * 90, c[1] + g() * 260, 1.0, 0.36, 0.55, 1.6 * Math.exp(g() * 0.5), 0);
  }
  // old smooth disc
  for (let i = 0; i < 40000; i++) {
    let r;
    for (;;) { r = -11000 * Math.log(1 - rnd() * 0.99); if (r < 50000 && r > 1500) break; }
    const a = rnd() * Math.PI * 2;
    push(r * Math.cos(a), g() * 650, r * Math.sin(a), 1.0, 0.86, 0.68, 0.55 * Math.exp(g() * 0.4), 0);
  }

  // M13, exaggerated so it reads as a ball at galaxy scale
  const d13 = galDir(M13_LB[0], M13_LB[1]);
  const m13 = [SUN_LOCAL[0] + d13[0] * M13_DIST, SUN_LOCAL[1] + d13[1] * M13_DIST, SUN_LOCAL[2] + d13[2] * M13_DIST];
  const plummer = (a) => {
    for (;;) {
      const u = rnd() * 0.97 + 0.001;
      const r = a / Math.sqrt(Math.pow(u, -2 / 3) - 1);
      if (r < a * 6) return r;
    }
  };
  for (let i = 0; i < 5000; i++) {
    const r = plummer(1300), th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
    const w = rnd();
    push(m13[0] + r * Math.sin(ph) * Math.cos(th), m13[1] + r * Math.cos(ph), m13[2] + r * Math.sin(ph) * Math.sin(th),
      1.0, 0.88 + 0.08 * w, 0.70 + 0.2 * w, 0.09 * Math.exp(g() * 0.35), 2);
  }
  // a dozen other halo clusters
  for (let k = 0; k < 14; k++) {
    const rr = 12000 + rnd() * 38000, th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
    const cx = rr * Math.sin(ph) * Math.cos(th), cy = rr * Math.cos(ph) * 0.8, cz = rr * Math.sin(ph) * Math.sin(th);
    for (let i = 0; i < 160; i++) {
      const r = plummer(300), a = rnd() * Math.PI * 2, b = Math.acos(2 * rnd() - 1);
      push(cx + r * Math.sin(b) * Math.cos(a), cy + r * Math.cos(b), cz + r * Math.sin(b) * Math.sin(a), 1.0, 0.86, 0.66, 0.22, 3);
    }
  }
  // stars around the Sun: log-uniform in distance, they make the night sky
  for (let i = 0; i < 12000; i++) {
    const d = 4 * Math.exp(rnd() * Math.log(3000 / 4));
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
    const flat = 1 - 0.75 * U.smooth(150, 1200, d);
    starColor(rnd, tmp);
    const lum = 0.10 * Math.exp(g() * 1.1) * Math.pow(d / 4, 0.55);
    push(SUN_LOCAL[0] + d * Math.sin(ph) * Math.cos(th), SUN_LOCAL[1] + d * Math.cos(ph) * flat,
      SUN_LOCAL[2] + d * Math.sin(ph) * Math.sin(th), tmp[0], tmp[1], tmp[2], lum, 1);
  }

  // dust: along the inner edge of the arms, plus a ring round the bar
  const D = [], DS = [], DA = [];
  for (let i = 0; i < 16000; i++) {
    let x, z, r;
    if (rnd() < 0.7) {
      r = armR();
      if (r > 42000) continue;
      const a = armAngle(r, arms[Math.floor(rnd() * 2)][0]);
      const rr = r - 900 + g() * 450;
      const aa = a + 0.10 + g() * 450 / Math.max(r, 3000);
      x = rr * Math.cos(aa); z = rr * Math.sin(aa);
    } else {
      r = 4500 + rnd() * 6500;
      const a = rnd() * Math.PI * 2;
      x = r * Math.cos(a) * 1.15; z = r * Math.sin(a) * 0.85;
      const cx = Math.cos(bar), sx = Math.sin(bar);
      [x, z] = [x * cx - z * sx, x * sx + z * cx];
    }
    D.push(x, g() * 110, z);
    DS.push(260 + rnd() * 380);
    DA.push(0.22 + rnd() * 0.28);
  }

  GAL = {
    pos: new Float32Array(P), col: new Float32Array(C), lum: new Float32Array(L), kind: new Float32Array(K),
    count: L.length, m13,
    dust: { pos: new Float32Array(D), size: new Float32Array(DS), alpha: new Float32Array(DA), count: DS.length },
  };
  return GAL;
}

const STAR_VERT = /* glsl */`
attribute vec3 color;
attribute float lum;
attribute float kind;
uniform vec3 uEye;
uniform mat3 uRot;
uniform float uK;
uniform float uExp;
uniform float uLocal;
uniform float uGal;
uniform float uSize;
uniform float uMaxI;
varying vec3 vCol;
void main() {
  vec3 rel = position - uEye;
  float d = max(length(rel), 1e-6);
  vec3 dv = mat3(viewMatrix) * (uRot * (rel / d));
  gl_Position = projectionMatrix * vec4(dv * uK, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;
  float flux = lum / max(d * d, 4.0) * uExp;
  flux *= kind == 1.0 ? uLocal : uGal;
  float big = max(flux / uMaxI, 1.0);
  float size = uSize * min(pow(big, 0.35), 3.2);
  gl_PointSize = size;
  // keep the integrated light roughly right when the dot is capped or small
  vCol = color * min(flux, uMaxI) * pow(big, 0.12);
  if (flux < 0.002) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const STAR_FRAG = /* glsl */`
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r2 * 3.2), 1.0);
}`;

const DUST_VERT = /* glsl */`
attribute float size;
attribute float alpha;
uniform vec3 uEye;
uniform mat3 uRot;
uniform float uK;
uniform float uPx;
uniform float uAmt;
varying float vA;
void main() {
  vec3 rel = position - uEye;
  float d = max(length(rel), 1e-6);
  vec3 dv = mat3(viewMatrix) * (uRot * (rel / d));
  gl_Position = projectionMatrix * vec4(dv * uK, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;
  float px = size / d * uPx;
  float cap = 32.0;
  gl_PointSize = clamp(px, 1.0, cap);
  vA = alpha * uAmt * smoothstep(0.8, 3.0, px) * min(1.0, cap / px) * smoothstep(size * 2.0, size * 5.0, d);
  if (vA < 0.004) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const DUST_FRAG = /* glsl */`
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, vA * exp(-r2 * 2.5));
}`;

/**
 * Galaxy points drawn by direction from an eye point (galaxy-local ly), so
 * they work both as a sky seen from the Sun and as a spiral from far away,
 * whatever the scene's world units. Draw first; they ignore depth.
 */
export function createGalaxySky(env) {
  const { THREE, U, H } = env;
  const G = galaxyData(U);
  if (!G.geom) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(G.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(G.col, 3));
    geo.setAttribute('lum', new THREE.BufferAttribute(G.lum, 1));
    geo.setAttribute('kind', new THREE.BufferAttribute(G.kind, 1));
    G.geom = geo;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(G.dust.pos, 3));
    dg.setAttribute('size', new THREE.BufferAttribute(G.dust.size, 1));
    dg.setAttribute('alpha', new THREE.BufferAttribute(G.dust.alpha, 1));
    G.dgeom = dg;
  }
  const uni = {
    uEye: { value: new THREE.Vector3(...SUN_LOCAL) },
    uRot: { value: new THREE.Matrix3() },
    uK: { value: 10 },
    uExp: { value: 1 },
    uLocal: { value: 1 },
    uGal: { value: 1 },
    uSize: { value: 2.2 },
    uMaxI: { value: 1.2 },
  };
  const pts = new THREE.Points(G.geom, new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  const dustU = {
    uEye: uni.uEye, uRot: uni.uRot, uK: uni.uK,
    uPx: { value: (H / 2) / Math.tan(20 * Math.PI / 180) },
    uAmt: { value: 1 },
  };
  const dust = new THREE.Points(G.dgeom, new THREE.ShaderMaterial({
    uniforms: dustU, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  dust.frustumCulled = false;
  dust.renderOrder = -9;
  return {
    points: pts, dust, uniforms: uni, dustUniforms: dustU, data: G,
    /** keep the points between the camera's near and far planes */
    fit(camera) { uni.uK.value = Math.sqrt(camera.near * camera.far); },
  };
}

// ---------------------------------------------------------------------------
// screen-space ribbons: thin anti-aliased glowing lines of constant pixel width
// ---------------------------------------------------------------------------

const RIB_VERT = /* glsl */`
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aCA;
attribute vec4 aCB;
uniform vec2 uRes;
uniform float uHalf;
uniform float uNear;
varying vec4 vCol;
varying float vD;
void main() {
  vec4 a = modelViewMatrix * vec4(aA, 1.0);
  vec4 b = modelViewMatrix * vec4(aB, 1.0);
  vec4 ca = aCA, cb = aCB;
  float nz = -uNear * 1.01;
  if (a.z > nz && b.z > nz) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vCol = vec4(0.0); vD = 0.0; return; }
  if (a.z > nz) { float k = (nz - a.z) / (b.z - a.z); a = mix(a, b, k); ca = mix(aCA, aCB, k); }
  if (b.z > nz) { float k = (nz - b.z) / (a.z - b.z); b = mix(b, a, k); cb = mix(aCB, aCA, k); }
  vec4 pa = projectionMatrix * a, pb = projectionMatrix * b;
  vec2 sa = pa.xy / pa.w * uRes * 0.5, sb = pb.xy / pb.w * uRes * 0.5;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  bool atA = position.x < 0.5;
  vec4 p = atA ? pa : pb;
  vec2 s = (atA ? sa : sb) + nrm * position.y * uHalf;
  gl_Position = vec4(s / (uRes * 0.5) * p.w, p.z, p.w);
  vCol = atA ? ca : cb;
  vD = position.y * uHalf;
}`;

const RIB_FRAG = /* glsl */`
uniform float uCore;
uniform float uSigma;
uniform float uGlowAmt;
uniform float uOpacity;
varying vec4 vCol;
varying float vD;
void main() {
  float d = abs(vD);
  float core = 1.0 - smoothstep(uCore - 0.5, uCore + 0.7, d);
  float glow = exp(-d * d / (2.0 * uSigma * uSigma));
  gl_FragColor = vec4(vCol.rgb * vCol.a * (core + glow * uGlowAmt) * uOpacity, 1.0);
}`;

export function createRibbons(env, maxSeg, opts = {}) {
  const { THREE, W, H } = env;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const A = new Float32Array(maxSeg * 3), B = new Float32Array(maxSeg * 3);
  const CA = new Float32Array(maxSeg * 4), CB = new Float32Array(maxSeg * 4);
  const aA = new THREE.InstancedBufferAttribute(A, 3), aB = new THREE.InstancedBufferAttribute(B, 3);
  const aCA = new THREE.InstancedBufferAttribute(CA, 4), aCB = new THREE.InstancedBufferAttribute(CB, 4);
  for (const x of [aA, aB, aCA, aCB]) x.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aA', aA); geo.setAttribute('aB', aB);
  geo.setAttribute('aCA', aCA); geo.setAttribute('aCB', aCB);
  geo.instanceCount = 0;
  const core = opts.core ?? 0.6, sigma = opts.sigma ?? 2.5;
  const uni = {
    uRes: { value: new THREE.Vector2(W, H) },
    uHalf: { value: opts.half ?? Math.max(core + 1.5, sigma * 3) },
    uNear: { value: 0.1 },
    uCore: { value: core },
    uSigma: { value: sigma },
    uGlowAmt: { value: opts.glow ?? 0.35 },
    uOpacity: { value: 1 },
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: RIB_VERT, fragmentShader: RIB_FRAG,
    transparent: true, depthWrite: false, depthTest: opts.depthTest ?? false, blending: THREE.AdditiveBlending,
  }));
  mesh.frustumCulled = false;
  let n = 0;
  return {
    mesh, uniforms: uni,
    begin() { n = 0; },
    /** add a segment a->b (arrays/vec3), colours rgba at each end */
    seg(a, b, ca, cb) {
      if (n >= maxSeg) return;
      A[n * 3] = a.x ?? a[0]; A[n * 3 + 1] = a.y ?? a[1]; A[n * 3 + 2] = a.z ?? a[2];
      B[n * 3] = b.x ?? b[0]; B[n * 3 + 1] = b.y ?? b[1]; B[n * 3 + 2] = b.z ?? b[2];
      CA.set(ca, n * 4); CB.set(cb || ca, n * 4);
      n++;
    },
    end(camera) {
      geo.instanceCount = n;
      for (const x of [aA, aB, aCA, aCB]) { x.needsUpdate = true; x.addUpdateRange(0, n * x.itemSize); }
      if (camera) uni.uNear.value = camera.near;
      mesh.visible = n > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// sprites
// ---------------------------------------------------------------------------

/** radial glare texture: hot core, soft halo, faint spikes */
export function makeGlareTexture(THREE, size = 256, spikes = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const h = size / 2;
  const g = x.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.04, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.1, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.025)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  if (spikes) {
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < spikes; i++) {
      x.save();
      x.translate(h, h);
      x.rotate(i * Math.PI / spikes + 0.3);
      const sg = x.createLinearGradient(-h, 0, h, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.22)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = sg;
      x.fillRect(-h, -0.8, size, 1.6);
      x.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** camera-facing sprite whose on-screen size is set in pixels each frame */
export function createGlare(env, tex, color, opts = {}) {
  const { THREE, H } = env;
  const mat = new THREE.SpriteMaterial({
    map: tex, color: new THREE.Color(...color), transparent: true, depthWrite: false,
    depthTest: opts.depthTest ?? false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const s = new THREE.Sprite(mat);
  s.frustumCulled = false;
  s.renderOrder = opts.order ?? 20;
  const tmp = new THREE.Vector3();
  return {
    sprite: s, material: mat,
    /** place at world pos p with diameter px (pixels) and intensity */
    set(camera, p, px, intensity, aspect = 1) {
      s.position.copy(p);
      const d = tmp.copy(p).sub(camera.position).length();
      const w = px / ((H / 2) * camera.projectionMatrix.elements[5]) * d;
      s.scale.set(w * aspect, w, 1);
      mat.opacity = 1;
      mat.color.setRGB(color[0] * intensity, color[1] * intensity, color[2] * intensity);
      s.visible = intensity > 0.0005 && px > 0.1;
    },
  };
}

// generic soft glow points whose attributes are filled by the caller
const GP_VERT = /* glsl */`
attribute float size;
attribute vec4 rgba;
varying vec4 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size;
  vC = rgba;
  if (rgba.a <= 0.0 || size <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;
const GP_FRAG = /* glsl */`
uniform float uSharp;
varying vec4 vC;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC.rgb * vC.a * exp(-r2 * uSharp), 1.0);
}`;

export function createGlowPoints(env, n, opts = {}) {
  const { THREE } = env;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), size = new Float32Array(n), rgba = new Float32Array(n * 4);
  const aP = new THREE.BufferAttribute(pos, 3), aS = new THREE.BufferAttribute(size, 1), aC = new THREE.BufferAttribute(rgba, 4);
  for (const x of [aP, aS, aC]) x.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aP); geo.setAttribute('size', aS); geo.setAttribute('rgba', aC);
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uSharp: { value: opts.sharp ?? 3.0 } }, vertexShader: GP_VERT, fragmentShader: GP_FRAG,
    transparent: true, depthWrite: false, depthTest: opts.depthTest ?? false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  return {
    points: pts, pos, size, rgba,
    commit(count = n) {
      geo.setDrawRange(0, count);
      aP.needsUpdate = aS.needsUpdate = aC.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// diffuse galaxy light: the same points splatted top-down into a texture once,
// then drawn as a plane in the disc so the spiral glows between its stars
// ---------------------------------------------------------------------------

const GLOW_EXT = 62000;
let GLOWTEX = null;

const GB_VERT = /* glsl */`
attribute vec3 color;
attribute float lum;
attribute float kind;
uniform float uExt;
uniform float uPx;
varying vec3 vC;
void main() {
  if (kind > 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; vC = vec3(0.0); return; }
  gl_Position = vec4(position.x / uExt, position.z / uExt, 0.0, 1.0);
  gl_PointSize = uPx;
  vC = color * lum;
}`;
const GB_FRAG = /* glsl */`
varying vec3 vC;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC * exp(-r2 * 3.0) * 0.033, 1.0);
}`;
const GBD_VERT = /* glsl */`
attribute float size;
attribute float alpha;
uniform float uExt;
uniform float uRes;
varying float vA;
void main() {
  gl_Position = vec4(position.x / uExt, position.z / uExt, 0.0, 1.0);
  gl_PointSize = max(2.0, size / uExt * uRes * 1.4);
  vA = alpha;
}`;

export function bakeGalaxyGlow(env) {
  if (GLOWTEX) return GLOWTEX;
  const { THREE, renderer, U } = env;
  const G = galaxyData(U);
  const res = 2048;
  const rt = new THREE.WebGLRenderTarget(res, res, {
    type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(G.pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(G.col, 3));
  geo.setAttribute('lum', new THREE.BufferAttribute(G.lum, 1));
  geo.setAttribute('kind', new THREE.BufferAttribute(G.kind, 1));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uExt: { value: GLOW_EXT }, uPx: { value: 14 } },
    vertexShader: GB_VERT, fragmentShader: GB_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.BufferAttribute(G.dust.pos, 3));
  dgeo.setAttribute('size', new THREE.BufferAttribute(G.dust.size, 1));
  dgeo.setAttribute('alpha', new THREE.BufferAttribute(G.dust.alpha, 1));
  const dust = new THREE.Points(dgeo, new THREE.ShaderMaterial({
    uniforms: { uExt: { value: GLOW_EXT }, uRes: { value: res } },
    vertexShader: GBD_VERT, fragmentShader: DUST_FRAG,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  dust.frustumCulled = false;
  dust.renderOrder = 1;
  const sc = new THREE.Scene();
  sc.add(pts, dust);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const prev = renderer.getRenderTarget();
  const prevC = new THREE.Color(); renderer.getClearColor(prevC);
  const prevA = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(sc, cam);
  renderer.setRenderTarget(prev);
  renderer.setClearColor(prevC, prevA);
  geo.dispose(); dgeo.dispose();
  GLOWTEX = rt.texture;
  return GLOWTEX;
}

const GP_PLANE_VERT = /* glsl */`
uniform float uExt;
varying vec2 vUv;
varying vec3 vWP;
varying vec3 vWN;
void main() {
  vUv = position.xz / uExt * 0.5 + 0.5;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GP_PLANE_FRAG = /* glsl */`
uniform sampler2D uTex;
uniform float uAmt;
varying vec2 vUv;
varying vec3 vWP;
varying vec3 vWN;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  c *= mix(0.18, 1.0, smoothstep(0.0, 0.18, length(vUv - 0.5)));
  float mu = abs(dot(normalize(cameraPosition - vWP), vWN));
  float k = min(1.0 / max(mu, 0.05), 1.6);
  vec2 e = abs(vUv - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.85, 1.0, max(e.x, e.y));
  gl_FragColor = vec4(c * uAmt * k * edge, 1.0);
}`;

/** plane in the galaxy-local XZ disc; set mesh.matrix (galaxy-local -> world) */
export function createGalaxyGlow(env) {
  const { THREE } = env;
  const tex = bakeGalaxyGlow(env);
  const g = new THREE.PlaneGeometry(GLOW_EXT * 2, GLOW_EXT * 2, 1, 1);
  g.rotateX(-Math.PI / 2);
  const uni = { uTex: { value: tex }, uAmt: { value: 1 }, uExt: { value: GLOW_EXT } };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: GP_PLANE_VERT, fragmentShader: GP_PLANE_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = -9.5;
  return { mesh, uniforms: uni };
}
