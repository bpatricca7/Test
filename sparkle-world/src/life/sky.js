// Sky pieces drawn around the camera and pinned to the far plane: the gradient dome (with the
// soft sun, sunrise/sunset glow, the moon halo, a pastel night nebula and the rainbow), a cute
// sleepy moon with phases, twinkling pastel stars and shooting stars. daynight.js drives them.

import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';

// ---------- dome ----------

const domeUniforms = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uDuskColor;
uniform vec3 uGlowColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uDay;
uniform float uNight;
uniform float uDusk;
uniform float uOvercast;
uniform float uTime;
uniform float uRainbow;
uniform vec3 uRainbowC;
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;

// the smooth gradient and the sunrise/sunset band are per vertex (a finely divided sphere);
// the fragment shader only adds the small bright things
const domeVert = domeUniforms + /* glsl */ `
varying vec3 vDir;
varying vec3 vCol;
void main() {
  vec3 d = normalize(position);
  vDir = position;
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.26, up));
  col = mix(col, uTop, smoothstep(0.16, 0.9, up));
  float sd = dot(d, uSunDir);
  float toward = 0.5 + 0.5 * sd;
  float band = exp(-max(h, 0.0) * 6.0) * smoothstep(-0.16, 0.0, h);
  col = mix(col, uDuskColor, clamp(uDusk * band * (0.3 + 0.7 * toward * toward), 0.0, 1.0));
  float s5 = max(sd, 0.0);
  s5 = s5 * s5 * s5 * s5 * s5;
  col += uGlowColor * uDusk * s5 * 0.28 * (0.4 + 0.6 * band);
#ifdef NIGHT
  // pastel nebula band (soft and low-frequency, so per vertex is plenty)
  if (uNight > 0.01) {
    vec3 N = normalize(vec3(0.42, 0.3, 0.86));
    float dn = dot(d, N);
    float nb = exp(-dn * dn * 9.0) * smoothstep(0.02, 0.35, h);
    float n = vnoise(d * 4.3) * 0.62 + vnoise(d * 9.0 + 3.1) * 0.38;
    vec3 neb = mix(vec3(0.55, 0.36, 0.92), vec3(1.0, 0.5, 0.8), vnoise(d * 2.2 + 7.0));
    col += neb * nb * n * n * 0.34 * uNight * (1.0 - uOvercast);
  }
#endif
  vCol = col;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w); // pinned to the far plane
}`;

const domeFrag = domeUniforms + /* glsl */ `
varying vec3 vDir;
varying vec3 vCol;

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = vCol;
  float h = d.y;

  // soft sun with glow (a hazy bright patch when overcast)
  if (uDay > 0.001) {
    float s = max(dot(d, uSunDir), 0.0);
    if (s > 0.6) {
      float ls = log2(s);
      float vis = uDay * (1.0 - 0.9 * uOvercast);
      float disc = smoothstep(0.99845, 0.99885, s);
      float halo = exp2(ls * 1400.0) * 0.55 + exp2(ls * 90.0) * 0.30 + exp2(ls * 10.0) * 0.10;
      col += uGlowColor * (halo * vis + exp2(ls * 14.0) * 0.14 * uOvercast * uDay);
      col = mix(col, uSunColor, disc * vis);
    }
  }

#ifdef NIGHT
  if (uNight > 0.01) {
    // moon halo
    float m = max(dot(d, uMoonDir), 0.0);
    if (m > 0.7) {
      float lm = log2(m);
      col += vec3(0.62, 0.6, 1.0) * (exp2(lm * 260.0) * 0.32 + exp2(lm * 18.0) * 0.09) * uNight * (1.0 - 0.75 * uOvercast);
    }
  }
#endif

#ifdef RAINBOW
  // the rainbow: a big pastel bow with sparkles
  if (uRainbow > 0.001) {
    float ang = acos(clamp(dot(d, uRainbowC), -1.0, 1.0));
    float x = (ang - 0.56) / 0.15;
    float a = smoothstep(0.0, 0.16, x) * smoothstep(1.0, 0.84, x) * smoothstep(-0.01, 0.06, h);
    vec3 rb = hsv((1.0 - clamp(x, 0.0, 1.0)) * 0.8, 0.52, 1.0);
    col = mix(col, rb, a * 0.8 * uRainbow);
    col += vec3(0.05, 0.05, 0.06) * smoothstep(0.56, 0.3, ang) * smoothstep(-0.01, 0.06, h) * uRainbow;
    if (a > 0.01) {
      vec3 q = d * 150.0;
      float hs = hash3(floor(q));
      if (hs > 0.955) {
        vec3 f = fract(q) - 0.5;
        float sp = smoothstep(0.42, 0.0, length(f));
        float tw = 0.5 + 0.5 * sin(uTime * 3.5 + hs * 90.0);
        col += vec3(1.0) * sp * tw * tw * a * uRainbow;
      }
    }
  }
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

export function createDome(scene) {
  const c = () => new THREE.Color();
  const u = {
    uTop: { value: c() }, uMid: { value: c() }, uHorizon: { value: c() },
    uDuskColor: { value: c() }, uGlowColor: { value: c() }, uSunColor: { value: c() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uDay: { value: 1 }, uNight: { value: 0 }, uDusk: { value: 0 }, uOvercast: { value: 0 },
    uTime: { value: 0 }, uRainbow: { value: 0 }, uRainbowC: { value: new THREE.Vector3(0, -0.1, -1).normalize() },
  };
  // small shader variants (night extras, rainbow) instead of uniform branches: some GPUs (and
  // the software renderer the tests use) pay for every branch on every sky pixel
  const variants = new Map();
  const material = (night, rainbow) => {
    const key = (night ? 1 : 0) + (rainbow ? 2 : 0);
    let m = variants.get(key);
    if (!m) {
      const defines = {};
      if (night) defines.NIGHT = 1;
      if (rainbow) defines.RAINBOW = 1;
      m = new THREE.ShaderMaterial({ uniforms: u, defines, vertexShader: domeVert, fragmentShader: domeFrag, side: THREE.BackSide, depthWrite: false });
      variants.set(key, m);
    }
    return m;
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 48), material(false, false));
  // drawn after the opaque world (depth-tested at the far plane), so only sky pixels are shaded
  dome.renderOrder = 1000;
  dome.frustumCulled = false;
  dome.name = 'sky';
  dome.userData.envWarm = true;
  scene.add(dome);
  return {
    mesh: dome,
    uniforms: u,
    /** Every variant, created now (so they can be compiled ahead of time). */
    allVariants: () => [material(false, false), material(true, false), material(false, true), material(true, true)],
    /** Pick the variant for the current sky (call once per frame after setting uniforms). */
    choose() {
      const m = material(u.uNight.value > 0.005, u.uRainbow.value > 0.001);
      if (dome.material !== m) dome.material = m;
    },
  };
}

// ---------- stars ----------

const starVert = /* glsl */ `
attribute float phase;
attribute float big;
attribute vec3 tint;
uniform float uTime;
uniform float uPixel;
varying float vTw;
varying float vBig;
varying vec3 vTint;
void main() {
  vTw = 0.5 + 0.5 * sin(uTime * (1.2 + phase * 2.4) + phase * 40.0);
  vTw = 0.35 + 0.65 * vTw * vTw;
  vBig = big;
  vTint = tint;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float y = normalize(wp.xyz - cameraPosition).y;
  vTw *= smoothstep(0.0, 0.2, y);
  if (y < 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; } // below the horizon: skip
  vec4 mv = viewMatrix * wp;
  gl_PointSize = (2.6 + phase * 2.6 + big * 10.0) * uPixel;
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.9999;
}`;

const starFrag = /* glsl */ `
uniform float uNight;
varying float vTw;
varying float vBig;
varying vec3 vTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  float core = smoothstep(0.5, 0.18, r) * 0.7 + smoothstep(0.22, 0.0, r) * 0.6;
  if (vBig > 0.5) {
    core = smoothstep(0.16, 0.0, r);
    float rays = max(0.0, 1.0 - abs(c.x) * 14.0) * smoothstep(0.5, 0.0, abs(c.y))
               + max(0.0, 1.0 - abs(c.y) * 14.0) * smoothstep(0.5, 0.0, abs(c.x));
    core = max(core, rays * 0.9) + smoothstep(0.5, 0.0, r) * 0.25;
  }
  float a = core * vTw * uNight;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vTint, a);
}`;

export function createStars(scene) {
  const rand = mulberry32(20260926);
  const N = 760;
  const pos = new Float32Array(N * 3), phase = new Float32Array(N), big = new Float32Array(N), tint = new Float32Array(N * 3);
  const tints = [[1, 0.98, 0.9], [1, 0.95, 0.75], [1, 0.85, 0.95], [0.85, 0.92, 1], [0.92, 0.86, 1]];
  for (let i = 0; i < N; i++) {
    // uniform on the sphere; the rotating sky brings every part up over the night
    const y = rand() * 2 - 1;
    const a = rand() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * 450;
    pos[i * 3 + 1] = y * 450;
    pos[i * 3 + 2] = Math.sin(a) * r * 450;
    phase[i] = rand();
    big[i] = rand() < 0.05 ? 1 : 0;
    const t = tints[Math.floor(rand() * tints.length)];
    tint[i * 3] = t[0]; tint[i * 3 + 1] = t[1]; tint[i * 3 + 2] = t[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('big', new THREE.BufferAttribute(big, 1));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const uniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uPixel: { value: 1 } };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: starVert, fragmentShader: starFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  points.renderOrder = -999;
  // the star sphere turns around a tilted axis once per day
  const pivot = new THREE.Group();
  pivot.rotation.x = 0.55;
  pivot.add(points);
  pivot.name = 'stars';
  pivot.userData.envWarm = points.userData.envWarm = true;
  scene.add(pivot);
  return { pivot, points, uniforms };
}

// ---------- moon ----------

const moonVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99995, p.w);
}`;

const moonFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uPhase;
uniform float uAlpha;
varying vec2 vUv;
const float QUAD = 1.9;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * QUAD;
  float r = length(p);
  float disc = smoothstep(1.0, 0.97, r);
  vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
  float ph = uPhase * 6.2831853;
  vec3 L = vec3(sin(ph), 0.0, -cos(ph));
  float lit = smoothstep(-0.1, 0.12, dot(n, L));
  vec4 tex = texture2D(uMap, clamp(p * 0.5 + 0.5, 0.0, 1.0));
  vec3 dark = tex.rgb * vec3(0.36, 0.36, 0.58);
  vec3 col = mix(dark, tex.rgb, lit);
  float glow = exp(-max(r - 1.0, 0.0) * 3.2) * (1.0 - disc) * 0.28 * (0.5 + 0.5 * uPhase * 2.0 * (1.0 - uPhase) * 2.0);
  float a = max(disc, glow);
  vec3 outCol = disc > 0.001 ? col : vec3(0.85, 0.82, 1.0);
  gl_FragColor = vec4(outCol, a * uAlpha);
}`;

function paintMoon(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const R = size / 2;
  g.translate(R, R);
  const grad = g.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.1, 0, 0, R);
  grad.addColorStop(0, '#FFFDF0');
  grad.addColorStop(0.7, '#FFF3CF');
  grad.addColorStop(1, '#F8E3B4');
  g.fillStyle = grad;
  g.fillRect(-R, -R, size, size);
  // soft craters
  const craters = [[-0.42, -0.38, 0.17], [0.38, -0.5, 0.11], [0.52, 0.28, 0.14], [-0.55, 0.36, 0.1], [0.05, 0.62, 0.09], [0.12, -0.72, 0.07]];
  for (const [x, y, r] of craters) {
    g.fillStyle = 'rgba(226,196,140,0.45)';
    g.beginPath(); g.arc(x * R, y * R, r * R, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,252,236,0.8)';
    g.beginPath(); g.arc(x * R - r * R * 0.18, y * R - r * R * 0.2, r * R * 0.62, 0, Math.PI * 2); g.fill();
  }
  // a sleepy little face
  g.lineCap = 'round';
  g.strokeStyle = '#A9805E';
  g.lineWidth = size * 0.028;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * R * 0.28, -R * 0.02, R * 0.12, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
  }
  g.beginPath();
  g.arc(0, R * 0.2, R * 0.1, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  g.fillStyle = 'rgba(255,140,170,0.45)';
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(sx * R * 0.46, R * 0.2, R * 0.12, R * 0.075, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // raw sRGB, written straight out like the sky
  return t;
}

export function createMoon(scene) {
  const uniforms = { uMap: { value: paintMoon() }, uPhase: { value: 0.5 }, uAlpha: { value: 0 } };
  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({ uniforms, vertexShader: moonVert, fragmentShader: moonFrag, transparent: true, depthWrite: false }),
  );
  moon.renderOrder = -998;
  moon.frustumCulled = false;
  moon.name = 'moon';
  moon.userData.envWarm = true;
  scene.add(moon);
  return { mesh: moon, uniforms };
}

// ---------- shooting stars ----------

const shootVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99993, p.w);
}`;

const shootFrag = /* glsl */ `
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float along = vUv.x;
  float across = abs(vUv.y * 2.0 - 1.0);
  float tail = pow(along, 2.2) * (1.0 - across * across);
  float head = smoothstep(0.5, 0.0, length(vec2((1.0 - along) * 5.0, across)));
  float a = (tail * 0.8 + head) * uAlpha;
  vec3 col = mix(vec3(1.0, 0.7, 0.9), vec3(1.0, 1.0, 0.95), along);
  gl_FragColor = vec4(col, a);
}`;

export function createShootingStar(scene) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(12);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2));
  geo.setIndex([0, 2, 1, 2, 3, 1]);
  const uniforms = { uAlpha: { value: 0 } };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: shootVert, fragmentShader: shootFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -997;
  mesh.visible = false;
  mesh.userData.envWarm = true;
  scene.add(mesh);

  const a = new THREE.Vector3(), axis = new THREE.Vector3(), head = new THREE.Vector3(), tail = new THREE.Vector3();
  const side = new THREE.Vector3(), tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  const s = { t: 0, dur: 1, active: false, speed: 0.5, len: 0.2 };
  return {
    mesh,
    get active() { return s.active; },
    /** Launch one from a random spot in the upper sky (or in view of a camera at lookYaw). */
    launch(rand = Math.random, lookYaw = null) {
      const aimed = lookYaw !== null;
      const az = aimed ? Math.atan2(Math.cos(lookYaw), Math.sin(lookYaw)) + (rand() - 0.5) * 0.5 : rand() * Math.PI * 2;
      const el = aimed ? 0.45 + rand() * 0.2 : 0.55 + rand() * 0.55;
      a.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      // travel sideways and a little down
      tmp.set(-Math.sin(az), -0.35 - rand() * 0.3, Math.cos(az)).multiplyScalar(rand() < 0.5 ? 1 : -1);
      tmp.y = -Math.abs(tmp.y);
      axis.crossVectors(a, tmp).normalize();
      s.t = 0;
      s.dur = 0.9 + rand() * 0.5;
      s.speed = 0.42 + rand() * 0.2;
      s.len = 0.32;
      s.active = true;
      mesh.visible = true;
    },
    update(dt, cam) {
      if (!s.active) return;
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.active = false;
        mesh.visible = false;
        uniforms.uAlpha.value = 0;
        return;
      }
      const ang = s.speed * s.t;
      q.setFromAxisAngle(axis, ang);
      head.copy(a).applyQuaternion(q);
      q.setFromAxisAngle(axis, Math.max(0, ang - s.len * Math.min(1, k * 3)));
      tail.copy(a).applyQuaternion(q);
      head.multiplyScalar(420).add(cam);
      tail.multiplyScalar(420).add(cam);
      side.subVectors(head, tail).cross(tmp.subVectors(head, cam)).normalize();
      const wHead = 3.4, wTail = 0.6;
      pos[0] = tail.x - side.x * wTail; pos[1] = tail.y - side.y * wTail; pos[2] = tail.z - side.z * wTail;
      pos[3] = tail.x + side.x * wTail; pos[4] = tail.y + side.y * wTail; pos[5] = tail.z + side.z * wTail;
      pos[6] = head.x - side.x * wHead; pos[7] = head.y - side.y * wHead; pos[8] = head.z - side.z * wHead;
      pos[9] = head.x + side.x * wHead; pos[10] = head.y + side.y * wHead; pos[11] = head.z + side.z * wHead;
      geo.attributes.position.needsUpdate = true;
      uniforms.uAlpha.value = Math.min(1, k * 6) * Math.min(1, (1 - k) * 3);
    },
    stop() {
      s.active = false;
      mesh.visible = false;
    },
  };
}
