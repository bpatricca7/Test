// Deterministic animation helpers for the Riviera ad (no state, no Date, no Math.random).
window.AdLib = (() => {
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
  const lerp = (a, b, u) => a + (b - a) * u
  const seg = (t, a, b) => clamp((t - a) / (b - a))
  const PI = Math.PI
  const E = {
    linear: x => x,
    inQuad: x => x * x,
    outQuad: x => 1 - (1 - x) * (1 - x),
    inOutQuad: x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    inCubic: x => x * x * x,
    outCubic: x => 1 - Math.pow(1 - x, 3),
    inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outQuart: x => 1 - Math.pow(1 - x, 4),
    inOutQuart: x => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
    outQuint: x => 1 - Math.pow(1 - x, 5),
    inSine: x => 1 - Math.cos((x * PI) / 2),
    outSine: x => Math.sin((x * PI) / 2),
    inOutSine: x => -(Math.cos(PI * x) - 1) / 2,
    inExpo: x => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
    outExpo: x => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inOutExpo: x => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
    outBack: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) },
    outBackSoft: x => { const c1 = 1.1, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) },
    inBack: x => { const c1 = 1.70158, c3 = c1 + 1; return c3 * x * x * x - c1 * x * x },
  }
  // tween: value at t going v0->v1 between a and b
  const tw = (t, a, b, v0, v1, e = E.inOutSine) => lerp(v0, v1, e(seg(t, a, b)))
  // keyframes: [[t, v], [t, v, ease], ...]  ease belongs to the segment ending at that key
  function kf(t, keys) {
    if (t <= keys[0][0]) return keys[0][1]
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i]
      if (t <= k[0]) {
        const p = keys[i - 1]
        const u = (t - p[0]) / (k[0] - p[0] || 1e-9)
        return lerp(p[1], k[1], (k[2] || E.inOutSine)(clamp(u)))
      }
    }
    return keys[keys.length - 1][1]
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  // colour helpers
  function hexToRgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6 }
    return [h, s, l]
  }
  function hslToRgb(h, s, l) {
    if (s === 0) return [l * 255, l * 255, l * 255]
    const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
    return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
  }
  function shade(hex, dl) { const [r, g, b] = typeof hex === 'string' ? hexToRgb(hex) : hex; const [h, s, l] = rgbToHsl(r, g, b); const o = hslToRgb(h, s, clamp(l + dl)); return `rgb(${o.map(v => Math.round(v)).join(',')})` }
  function srgbToLab(r, g, b) {
    const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    const R = f(r), G = f(g), B = f(b)
    let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
    const g3 = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
    x = g3(x); y = g3(y); z = g3(z)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  }
  return { clamp, lerp, seg, E, tw, kf, mulberry32, hexToRgb, shade, srgbToLab, rgbToHsl, hslToRgb }
})()
