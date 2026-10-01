// Deterministic motion engine. Every visual is a pure function of time `t` (seconds),
// so the same frame renders identically in the live preview and in the frame-by-frame export.

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, p) => a + (b - a) * p;
/** Progress (0..1) of `t` across the window [a, b]. */
export const range = (t, a, b) => clamp((t - a) / (b - a));

export const E = {
  linear: (x) => x,
  inCubic: (x) => x ** 3,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  outQuint: (x) => 1 - (1 - x) ** 5,
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) =>
    x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
  outBack: (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
};

/** Damped spring step response: 0 at t<=0, settles at 1 with a little overshoot. */
export function spring(t, freq = 3.2, damping = 0.52) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * freq;
  const wd = w * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
}

/**
 * Keyframe interpolation. frames = [[t, value, easing?], ...]; value may be a number or array.
 * The easing on frame i shapes the segment that ends at frame i.
 */
export function kf(t, frames, ease = E.inOutCubic) {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1, e] = frames[i];
    const [t0, v0] = frames[i - 1];
    if (t <= t1) {
      const p = (e || ease)(t1 === t0 ? 1 : (t - t0) / (t1 - t0));
      return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], p)) : lerp(v0, v1, p);
    }
  }
  return frames[frames.length - 1][1];
}

/** Tiny hyperscript: h('div', {class, style, text}, ...children). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

/** Absolutely positioned box helper. */
export const box = (x, y, w, hgt, extra = {}) => ({
  left: `${x}px`, top: `${y}px`, width: `${w}px`, height: hgt == null ? undefined : `${hgt}px`, ...extra,
});

/** Only touch the DOM when a style value actually changes (keeps 1000s of updates/frame cheap). */
export function css(el, styles) {
  const cache = (el.__css ||= {});
  for (const k in styles) {
    const v = styles[k];
    if (cache[k] !== v) {
      cache[k] = v;
      el.style[k] = v;
    }
  }
}
export function text(el, s) {
  if (el.__text !== s) {
    el.__text = s;
    el.textContent = s;
  }
}
export function toggle(el, cls, on) {
  if (!!el.__cls?.[cls] !== on) {
    (el.__cls ||= {})[cls] = on;
    el.classList.toggle(cls, on);
  }
}

/** Seeded PRNG so "random" details are identical on every render. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Typed-text helper: characters revealed between t0 and t1. */
export function typed(t, str, t0, t1) {
  const n = Math.round(range(t, t0, t1) * str.length);
  return str.slice(0, n);
}

/** Audio cue sheet consumed by audio/score.py. Times are absolute seconds. */
export const cues = [];
export function cue(t, type, extra = {}) {
  cues.push({ t: Math.round(t * 1000) / 1000, type, ...extra });
}
/** One 'type' cue per character across [t0, t1]. */
export function typeCues(t0, t1, n, kind = 'type') {
  for (let i = 0; i < n; i++) cue(t0 + ((t1 - t0) * i) / Math.max(1, n), kind);
}
