// Small, dependency-free animation toolkit. Everything is a pure function of time
// so any frame can be rendered on its own (which lets us render in parallel chunks).

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const invLerp = (a, b, x) => clamp((x - a) / (b - a));
export const remap = (x, a, b, c, d) => lerp(c, d, invLerp(a, b, x));
export const smoothstep = (a, b, x) => {
  const k = invLerp(a, b, x);
  return k * k * (3 - 2 * k);
};
export const pulse = (t, a, b, fadeIn = 0.2, fadeOut = 0.2) =>
  Math.min(smoothstep(a, a + fadeIn, t), 1 - smoothstep(b - fadeOut, b, t));

export const ease = {
  linear: (k) => k,
  inQuad: (k) => k * k,
  outQuad: (k) => 1 - (1 - k) * (1 - k),
  inOutQuad: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  inCubic: (k) => k * k * k,
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
  outSine: (k) => Math.sin((k * Math.PI) / 2),
  inSine: (k) => 1 - Math.cos((k * Math.PI) / 2),
  outBack: (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2),
  inBack: (k, s = 1.70158) => (s + 1) * k * k * k - s * k * k,
  outElastic: (k) => {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    return Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (k) => {
    const n = 7.5625, d = 2.75;
    if (k < 1 / d) return n * k * k;
    if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
    if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
    return n * (k -= 2.625 / d) * k + 0.984375;
  },
};

// Keyframe track: keys = [[time, value, easeName?], ...] sorted by time.
// value may be a number or an array of numbers. The ease on a key shapes the
// segment that *arrives* at that key.
export function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  let i = 1;
  while (keys[i][0] < t) i++;
  const [t0, v0] = keys[i - 1];
  const [t1, v1, e] = keys[i];
  const f = e ? (typeof e === 'function' ? e : ease[e]) : ease.inOutSine;
  const k = f((t - t0) / (t1 - t0));
  if (Array.isArray(v0)) return v0.map((a, j) => lerp(a, v1[j], k));
  return lerp(v0, v1, k);
}

// Deterministic randomness.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash1 = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

// Smooth 1D value noise in [-1, 1] (for handheld camera and idle wobbles).
export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
}
export const fbm1 = (x) => noise1(x) * 0.6 + noise1(x * 2.1 + 5.2) * 0.3 + noise1(x * 4.3 + 1.7) * 0.1;

// 2D value noise for terrain heights (matches the GLSL version in terrain.js).
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

// Blink pattern: returns 0..1 lid closure, deterministic from time.
export function autoBlink(t, seed = 0, every = 3.4) {
  const slot = Math.floor((t + seed * 1.37) / every);
  const offset = hash1(slot + seed * 13.1) * (every - 0.4);
  const local = t + seed * 1.37 - slot * every - offset;
  if (local < 0 || local > 0.18) return 0;
  return Math.sin((local / 0.18) * Math.PI);
}

// Position along a polyline path (array of [x,z]) with arc-length param 0..1.
export function pathAt(points, k) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dz);
    segs.push(len);
    total += len;
  }
  let d = clamp(k) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const f = segs[i] > 0 ? d / segs[i] : 0;
      const a = points[i], b = points[i + 1];
      return { x: lerp(a[0], b[0], f), z: lerp(a[1], b[1], f), heading: Math.atan2(b[0] - a[0], b[1] - a[1]), dist: clamp(k) * total, total };
    }
    d -= segs[i];
  }
  return { x: points[0][0], z: points[0][1], heading: 0, dist: 0, total };
}

// Catmull-Rom through 3D points (arrays), k in 0..1 (uniform per segment).
export function spline(points, k) {
  const n = points.length - 1;
  const f = clamp(k) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n, i + 2)];
  return p1.map((_, j) => {
    const a = p0[j], b = p1[j], c = p2[j], d = p3[j];
    return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  });
}

export const angleLerp = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};
