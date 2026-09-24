// Deterministic 1D noise and event helpers for "captured, not keyed" motion.
// Everything is a pure function of (t, seed): no Math.random, no state.

const TAU = Math.PI * 2;

/** integer hash -> [0, 1) */
export function hash01(i, seed = 0) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((seed * 1000003) | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 1D gradient (Perlin) noise, roughly -1..1, C2-smooth */
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const g0 = hash01(i, seed) * 2 - 1, g1 = hash01(i + 1, seed) * 2 - 1;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const n0 = g0 * f, n1 = g1 * (f - 1);
  return 2.2 * (n0 + (n1 - n0) * u);
}

/** fractal noise: `oct` octaves starting at `freq` (Hz when x is time), roughly -1..1 */
export function fbm(t, seed = 0, freq = 1, oct = 3) {
  let a = 1, s = 0, n = 0, f = freq;
  for (let o = 0; o < oct; o++) {
    s += a * noise1(t * f + o * 17.31, seed + o * 101);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n * 1.25;
}

/** time derivative of fbm (numerical), for velocity-driven effects */
export function fbmD(t, seed, freq, oct = 3) {
  const h = 1e-3;
  return (fbm(t + h, seed, freq, oct) - fbm(t - h, seed, freq, oct)) / (2 * h);
}

/**
 * Sparse random events on a jittered grid: returns the events active at t
 * as [{ tau, k, r(i) }] where tau = t - event time and r(i) gives stable
 * per-event random numbers. `cell` = mean spacing, `len` = how long an event lasts.
 */
export function events(t, seed, cell, len, jitter = 0.8) {
  const out = [];
  const k0 = Math.floor(t / cell);
  const back = Math.ceil(len / cell) + 1;
  for (let k = k0 - back; k <= k0; k++) {
    const te = (k + (1 - jitter) * 0.5 + jitter * hash01(k, seed)) * cell;
    const tau = t - te;
    if (tau >= 0 && tau < len) out.push({ tau, k, r: i => hash01(k * 31 + i, seed + 77) });
  }
  return out;
}

/**
 * Piecewise-constant random steps with fast smooth transitions (saccade-like):
 * returns the value in -1..1 (per `dim`), switching roughly every `cell` s over `ramp` s.
 */
export function steps(t, seed, cell, ramp, dim = 1) {
  const k0 = Math.floor(t / cell);
  const at = k => (k + 0.15 + 0.7 * hash01(k, seed)) * cell;
  let k = k0;
  if (at(k) > t) k--;
  const tau = t - at(k);
  const e = tau >= ramp ? 1 : (() => { const x = tau / ramp; return x * x * (3 - 2 * x); })();
  const val = (kk, d) => hash01(kk * 7 + d, seed + 13) * 2 - 1;
  const out = [];
  for (let d = 0; d < dim; d++) out.push(val(k - 1, d) + (val(k, d) - val(k - 1, d)) * e);
  return dim === 1 ? out[0] : out;
}

/** breathing waveform on a cycle fraction x (0..1): quicker inhale, slower exhale, a pause */
export function breathShape(x) {
  x = ((x % 1) + 1) % 1;
  const s = (a, b, v) => { const q = Math.min(1, Math.max(0, (v - a) / (b - a))); return q * q * (3 - 2 * q); };
  return x < 0.4 ? s(0, 0.4, x) : 1 - s(0.4, 0.93, x);
}

export { TAU };
