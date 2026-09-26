// Small shared helpers: seeded randomness, math and color utilities.

/** Seeded PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Cheap integer hash of 2-3 ints, useful for per-position variation without RNG state. */
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const randInt = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
export const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

/** Shortest signed angle difference a -> b in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

let uidCounter = 0;
/** Short unique id, e.g. for worlds: 'w' + time + random. */
export function makeId(prefix = 'id') {
  uidCounter = (uidCounter + 1) % 1296;
  return prefix + Date.now().toString(36) + uidCounter.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

// ---------- colors ----------

/** '#rrggbb' | '#rgb' -> [r, g, b] 0..255 */
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Mix two hex colors, t = 0 -> a, 1 -> b. */
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}

/** Lighten (amt > 0) or darken (amt < 0) a hex color by mixing with white/black. */
export function shade(hex, amt) {
  return amt >= 0 ? mixHex(hex, '#ffffff', amt) : mixHex(hex, '#000000', -amt);
}

/** Random slight variation of a hex color (for pixel-art noise). */
export function jitter(hex, rand, amount = 0.08) {
  return shade(hex, (rand() * 2 - 1) * amount);
}

/** CSS rgba() string from hex + alpha. */
export function rgba(hex, a = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Write sRGB components (0..1) of a hex color into an array-like target, no color management. */
export function hexToUnit(hex, out = [0, 0, 0]) {
  const [r, g, b] = hexToRgb(hex);
  out[0] = r / 255; out[1] = g / 255; out[2] = b / 255;
  return out;
}

/** Promise that resolves on the next animation frame (or soon, if frames are throttled). */
export function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(finish);
    setTimeout(finish, 100);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Escape text for safe insertion into HTML strings. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
