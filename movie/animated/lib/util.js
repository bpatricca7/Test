// Shared helpers for every scene. Everything is deterministic: no clocks, no
// Math.random — scenes are pure functions of film time.

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = t => Math.pow(clamp(t), 3);
/** progress 0..1 of t through [a, b] */
export const prog = (t, a, b) => clamp((t - a) / (b - a));
/** 0 -> 1 over fin after a, 1 -> 0 over fout before b */
export const window01 = (t, a, b, fin, fout) =>
  (fin > 0 ? smooth(a, a + fin, t) : (t >= a ? 1 : 0)) * (fout > 0 ? 1 - smooth(b - fout, b, t) : (t <= b ? 1 : 0));

export function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- CPU value noise (matches GLSL_NOISE below closely enough for terrain) ---
function hash3(x, y, z) {
  let px = (x * 0.3183099 + 0.1) % 1, py = (y * 0.3183099 + 0.1) % 1, pz = (z * 0.3183099 + 0.1) % 1;
  if (px < 0) px += 1; if (py < 0) py += 1; if (pz < 0) pz += 1;
  px *= 17; py *= 17; pz *= 17;
  const v = px * py * pz * (px + py + pz);
  return v - Math.floor(v);
}
export function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash3(ix + a, iy + b, iz + c);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy),
    l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
export function fbm3(x, y, z, oct = 6) {
  let s = 0, a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise3(x, y, z);
    x = x * 2.02 + 1.7; y = y * 2.02 + 9.2; z = z * 2.02 + 3.1;
    a *= 0.5;
  }
  return s;
}

// --- GLSL value noise + fbm, paste into shaders ---
export const GLSL_NOISE = /* glsl */`
float hash13(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    s += a * vnoise(p);
    p = p * 2.02 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
`;

/** a soft round sprite texture for Points (white, alpha falloff) */
export function makeGlowTexture(THREE, size = 64, hard = 0.25) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hard, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** audio envelope value (0..1) at film time t, e.g. envAt(ENV, 'voice_rms', t) */
export function envAt(ENV, key, t) {
  if (!ENV || !ENV[key]) return 0;
  const arr = ENV[key];
  const f = t * ENV.fps;
  const i = Math.floor(f);
  if (i < 0 || i >= arr.length - 1) return 0;
  return lerp(arr[i], arr[i + 1], f - i);
}
