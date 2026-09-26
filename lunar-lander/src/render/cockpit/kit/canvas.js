// Canvas texture helpers and the Apollo panel "painter" (typography, lines, group boxes,
// fasteners, wear) shared by every kit component and instrument.
//
// A painter draws in METRES on a panel-sized canvas (origin = panel centre, +x right, +y up)
// into two textures at once:
//   color : the albedo map (sRGB)            — grey paint, white lettering, screws, wear
//   aux   : a linear "surface" map            — R = height (bump, 128 = flush), G = roughness,
//                                               B = integral-lighting mask (lettering that glows)
// The aux channels are written with additive / difference compositing so each call only touches
// the channel it means to (see `auxAdd`, `auxSub`).
import * as THREE from 'three';

/** Largest canvas edge used anywhere in the cockpit (GPU memory / upload budget). */
export const MAX_TEX = 2048;

/**
 * Apollo panel typography: a bold grotesque (the real panels used a condensed gothic engraving
 * face), all caps, condensed horizontally and slightly tracked. Fonts are system fonts only.
 */
export const FONT_STACK = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "Nimbus Sans", FreeSans, sans-serif';
/** Typewriter face for checklist cards and stowage labels. */
export const MONO_STACK = '"Courier New", Courier, "Liberation Mono", "Nimbus Mono PS", FreeMono, monospace';

/** Small deterministic PRNG (mulberry32). Returns a function -> [0, 1). */
export function rng(seed = 1) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit seed (for per-panel wear that is stable between runs). */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** CSS colour string from a three.js hex number or pass-through string. */
export function css(c) {
  if (typeof c === 'string') return c;
  return '#' + new THREE.Color(c).getHexString();
}

/**
 * Canvas-backed texture sized in metres.
 * @param {number} widthM
 * @param {number} heightM
 * @param {number} [pxPerM=2000] requested resolution; clamped so no edge exceeds MAX_TEX
 * @param {{srgb?: boolean}} [opts] srgb=false for data textures (aux maps)
 * @returns {{canvas: HTMLCanvasElement, g: CanvasRenderingContext2D, texture: THREE.CanvasTexture,
 *   pxPerM: number, widthM: number, heightM: number}}
 */
export function createCanvasTexture(widthM, heightM, pxPerM = 2000, opts = {}) {
  const s = Math.min(pxPerM, MAX_TEX / Math.max(widthM, heightM, 1e-6));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.min(MAX_TEX, Math.round(widthM * s)));
  canvas.height = Math.max(4, Math.min(MAX_TEX, Math.round(heightM * s)));
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  if (opts.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, g, texture, pxPerM: s, widthM, heightM };
}

/**
 * Draw Apollo-style condensed caps text in canvas pixels.
 * @param {CanvasRenderingContext2D} g
 * @param {string} text  may contain '\n' for multiple lines
 * @param {number} x
 * @param {number} y     vertical anchor (see opts.baseline)
 * @param {number} size  font size (em) in px
 * @param {object} [o] { align='center', baseline='middle'|'top'|'bottom', color, condense=0.84,
 *   weight='bold', tracking=0.04 (em), lineHeight=1.2, font=FONT_STACK, rotate=0 (rad), caps=true }
 */
export function drawText(g, text, x, y, size, o = {}) {
  const {
    align = 'center', baseline = 'middle', color = '#f2f2ee', condense = 0.84, weight = 'bold',
    tracking = 0.04, lineHeight = 1.2, font = FONT_STACK, rotate = 0, caps = true,
  } = o;
  const lines = String(caps ? String(text).toUpperCase() : text).split('\n');
  const lh = size * lineHeight;
  const cap = size * 0.72; // cap height of a grotesque
  g.save();
  g.translate(x, y);
  if (rotate) g.rotate(rotate);
  g.scale(condense, 1);
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = `${(tracking * size).toFixed(2)}px`;
  g.fillStyle = color;
  const n = lines.length;
  // baseline of the first line
  let y0;
  if (baseline === 'top') y0 = cap;
  else if (baseline === 'bottom') y0 = -(n - 1) * lh;
  else y0 = cap / 2 - ((n - 1) * lh) / 2;
  // letterSpacing adds space after the last glyph too: nudge centred text back by half of it
  const nudge = 'letterSpacing' in g ? (align === 'center' ? (tracking * size) / 2 : align === 'right' ? tracking * size : 0) : 0;
  for (let i = 0; i < n; i++) g.fillText(lines[i], nudge, y0 + i * lh);
  g.restore();
}

/** Width in px of `text` drawn by drawText with the same options (widest line). */
export function measureText(g, text, size, o = {}) {
  const { condense = 0.84, weight = 'bold', tracking = 0.04, font = FONT_STACK, caps = true } = o;
  g.save();
  g.font = `${weight} ${size}px ${font}`;
  if ('letterSpacing' in g) g.letterSpacing = `${(tracking * size).toFixed(2)}px`;
  let w = 0;
  for (const l of String(caps ? String(text).toUpperCase() : text).split('\n')) w = Math.max(w, g.measureText(l).width);
  g.restore();
  return w * condense;
}

// -------------------------------------------------------------------------------- noise pattern
let _grain = null;
/** 128 px tile of fine paint grain (alpha noise), shared. */
function grainTile() {
  if (_grain) return _grain;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  const r = rng(77);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r();
    const l = v > 0.5 ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = l;
    img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 22);
  }
  g.putImageData(img, 0, 0);
  _grain = c;
  return c;
}

/**
 * Panel painter: draws in metres into a colour canvas and an aux (height/roughness/glow) canvas.
 * @param {number} widthM
 * @param {number} heightM
 * @param {object} [o] { pxPerM=2600, color (panel paint), roughness=0.55, aux=true, auxScale=0.5 }
 */
export function createPainter(widthM, heightM, o = {}) {
  const pxPerM = o.pxPerM || 2600;
  const col = createCanvasTexture(widthM, heightM, pxPerM);
  // the aux map (bump / roughness / glow mask) is half resolution: drawn with the SAME pixel
  // coordinates as the colour canvas through a 0.5 scale transform
  const auxScale = o.auxScale ?? 0.5;
  const aux = o.aux === false ? null : createCanvasTexture(widthM, heightM, (col.canvas.width / widthM) * auxScale, { srgb: false });
  if (aux) {
    aux.g.setTransform(aux.canvas.width / col.canvas.width, 0, 0, aux.canvas.height / col.canvas.height, 0, 0);
  }
  const sx = col.canvas.width / widthM;
  const sy = col.canvas.height / heightM;
  const s = (sx + sy) / 2; // px per metre for lengths
  const g = col.g;
  const a = aux?.g;
  const X = (x) => (x + widthM / 2) * sx;
  const Y = (y) => (heightM / 2 - y) * sy;
  const baseRough = o.roughness ?? 0.55;

  const P = {
    widthM, heightM, pxPerM: s, color: col, aux, g, a, X, Y,
    /** metres -> px (lengths) */
    px: (m) => m * s,
    /** Fill the whole panel with paint + grain; resets the aux map (flush, base roughness). */
    fill(color, roughness = baseRough) {
      g.fillStyle = css(color);
      g.fillRect(0, 0, col.canvas.width, col.canvas.height);
      g.save();
      g.globalAlpha = 0.6;
      g.fillStyle = g.createPattern(grainTile(), 'repeat');
      g.fillRect(0, 0, col.canvas.width, col.canvas.height);
      g.restore();
      if (a) {
        a.fillStyle = `rgb(128,${Math.round(roughness * 255)},0)`;
        a.fillRect(0, 0, col.canvas.width, col.canvas.height); // full-res coordinates (scaled)
      }
    },
    /** Add to aux channels (r,g,b 0..255) inside a path drawn by `path(ctx)`. */
    auxAdd(r, gg, b, path) {
      if (!a) return;
      a.save();
      a.globalCompositeOperation = 'lighter';
      a.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      a.strokeStyle = a.fillStyle;
      path(a);
      a.restore();
    },
    /** Subtract from aux channels (clamped at 0 for well-formed input). */
    auxSub(r, gg, b, path) {
      if (!a) return;
      a.save();
      a.globalCompositeOperation = 'difference';
      a.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      a.strokeStyle = a.fillStyle;
      path(a);
      a.restore();
    },
    /**
     * Text in metres. size = font em height (m). opts: drawText options + glow (true: lit by
     * integral panel lighting — default for white lettering).
     */
    text(text, x, y, size, opts = {}) {
      const glow = opts.glow ?? (opts.color == null || /^#f|^#e|white/i.test(css(opts.color)));
      drawText(g, text, X(x), Y(y), size * s, opts);
      if (a && glow) {
        a.save();
        a.globalCompositeOperation = 'lighter';
        drawText(a, text, X(x), Y(y), size * s, { ...opts, color: 'rgb(0,0,255)' });
        a.restore();
      }
      // paint is slightly glossier than the satin panel
      if (a) {
        a.save();
        a.globalCompositeOperation = 'difference';
        drawText(a, text, X(x), Y(y), size * s, { ...opts, color: 'rgb(0,20,0)' });
        a.restore();
      }
    },
    /** Measured width (m) of text at size (m). */
    textWidth(text, size, opts = {}) {
      return measureText(g, text, size * s, opts) / s;
    },
    /** Straight line (metres). width default 0.0007 m, colour white paint. */
    line(x1, y1, x2, y2, width = 0.0007, color = '#f0f0ea', glow = true) {
      g.save();
      g.strokeStyle = css(color);
      g.lineWidth = Math.max(1, width * s);
      g.lineCap = 'square';
      g.beginPath();
      g.moveTo(X(x1), Y(y1));
      g.lineTo(X(x2), Y(y2));
      g.stroke();
      g.restore();
      if (glow) {
        P.auxAdd(0, 0, 255, (c) => {
          c.lineWidth = Math.max(1, width * s);
          c.lineCap = 'square';
          c.beginPath();
          c.moveTo(X(x1), Y(y1));
          c.lineTo(X(x2), Y(y2));
          c.stroke();
        });
      }
    },
    /** Polyline through [[x,y],...]. */
    polyline(pts, width = 0.0007, color = '#f0f0ea', glow = true, closed = false) {
      const path = (c) => {
        c.lineWidth = Math.max(1, width * s);
        c.lineJoin = 'miter';
        c.beginPath();
        pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
        if (closed) c.closePath();
        c.stroke();
      };
      g.save();
      g.strokeStyle = css(color);
      path(g);
      g.restore();
      if (glow) P.auxAdd(0, 0, 255, path);
    },
    /** Filled rectangle, centre x,y, size w,h (metres). opts: {radius, rough (0..1 absolute delta)} */
    rect(x, y, w, h, color, opts = {}) {
      g.save();
      g.fillStyle = css(color);
      g.beginPath();
      roundRectPath(g, X(x - w / 2), Y(y + h / 2), w * s, h * s, (opts.radius || 0) * s);
      g.fill();
      g.restore();
      if (opts.glow) P.auxAdd(0, 0, 255, (c) => { c.beginPath(); roundRectPath(c, X(x - w / 2), Y(y + h / 2), w * s, h * s, (opts.radius || 0) * s); c.fill(); });
    },
    /** Filled circle (metres). */
    circle(x, y, r, color) {
      g.save();
      g.fillStyle = css(color);
      g.beginPath();
      g.arc(X(x), Y(y), r * s, 0, Math.PI * 2);
      g.fill();
      g.restore();
    },
    /** Stroked circle / arc (angles in radians, canvas convention). */
    ring(x, y, r, width, color = '#f0f0ea', a0 = 0, a1 = Math.PI * 2, glow = true) {
      const path = (c) => {
        c.lineWidth = Math.max(1, width * s);
        c.beginPath();
        c.arc(X(x), Y(y), r * s, a0, a1);
        c.stroke();
      };
      g.save();
      g.strokeStyle = css(color);
      path(g);
      g.restore();
      if (glow) P.auxAdd(0, 0, 255, path);
    },
    /**
     * Apollo group box: white rule around a group of controls with the title set in a gap of the
     * top rule (style 'gap', LM & CM style) or in a white bar with dark lettering (style 'bar').
     * b: {x, y, w, h, title, titleSize=0.0036, lineWidth=0.0007, style='gap', radius=0, sides}
     */
    box(b) {
      const { x, y, w, h, title, titleSize = 0.0036, lineWidth = 0.0007, style = 'gap', color = '#f0f0ea' } = b;
      const l = x - w / 2;
      const r = x + w / 2;
      const t = y + h / 2;
      const bt = y - h / 2;
      const sides = b.sides || 'tlrb';
      if (title && style === 'bar') {
        const bh = titleSize * 1.55;
        P.rect(x, t - bh / 2, w, bh, color, { glow: false });
        P.text(title, x, t - bh / 2, titleSize, { color: '#202224', glow: false });
        if (sides.includes('l')) P.line(l, t, l, bt, lineWidth, color);
        if (sides.includes('r')) P.line(r, t, r, bt, lineWidth, color);
        if (sides.includes('b')) P.line(l, bt, r, bt, lineWidth, color);
        return;
      }
      if (title) {
        const tw = P.textWidth(title, titleSize) + titleSize * 1.1;
        if (sides.includes('t')) {
          P.line(l, t, x - tw / 2, t, lineWidth, color);
          P.line(x + tw / 2, t, r, t, lineWidth, color);
        }
        P.text(title, x, t, titleSize, { color });
      } else if (sides.includes('t')) P.line(l, t, r, t, lineWidth, color);
      if (sides.includes('l')) P.line(l, t, l, bt, lineWidth, color);
      if (sides.includes('r')) P.line(r, t, r, bt, lineWidth, color);
      if (sides.includes('b')) P.line(l, bt, r, bt, lineWidth, color);
    },
    /**
     * Fastener head. kind: 'phillips' (pan head, default), 'slot', 'dzus' (quarter-turn stud with a
     * large slotted head and a flush grommet), 'hex'. r = head radius (m).
     */
    screw(x, y, r = 0.0021, kind = 'phillips', rot = 0) {
      const cx = X(x);
      const cy = Y(y);
      const R = r * s;
      g.save();
      if (kind === 'dzus') {
        // grommet ring (flush, darker) + domed head
        g.fillStyle = 'rgba(20,20,20,0.55)';
        g.beginPath();
        g.arc(cx, cy, R * 1.28, 0, Math.PI * 2);
        g.fill();
      }
      const grd = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      grd.addColorStop(0, '#d9dad6');
      grd.addColorStop(0.55, '#9c9d99');
      grd.addColorStop(1, '#55575a');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = Math.max(1, R * 0.12);
      g.stroke();
      // recess
      g.translate(cx, cy);
      g.rotate(rot);
      g.fillStyle = '#1b1c1d';
      const sw = R * (kind === 'dzus' ? 0.26 : 0.22);
      if (kind === 'phillips') {
        g.fillRect(-R * 0.62, -sw / 2, R * 1.24, sw);
        g.fillRect(-sw / 2, -R * 0.62, sw, R * 1.24);
      } else if (kind === 'hex') {
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const an = (i / 6) * Math.PI * 2;
          g.lineTo(Math.cos(an) * R * 0.45, Math.sin(an) * R * 0.45);
        }
        g.fill();
      } else {
        g.fillRect(-R * 0.86, -sw / 2, R * 1.72, sw);
      }
      g.restore();
      // bump: domed head, recessed slot; metal is smoother
      if (a) {
        a.save();
        a.globalCompositeOperation = 'lighter';
        const hg = a.createRadialGradient(cx, cy, 0, cx, cy, R);
        hg.addColorStop(0, 'rgb(90,0,0)');
        hg.addColorStop(0.7, 'rgb(60,0,0)');
        hg.addColorStop(1, 'rgb(10,0,0)');
        a.fillStyle = hg;
        a.beginPath();
        a.arc(cx, cy, R, 0, Math.PI * 2);
        a.fill();
        a.restore();
        a.save();
        a.globalCompositeOperation = 'difference';
        a.fillStyle = 'rgb(0,70,0)';
        a.beginPath();
        a.arc(cx, cy, R, 0, Math.PI * 2);
        a.fill();
        a.translate(cx, cy);
        a.rotate(rot);
        a.fillStyle = 'rgb(120,0,0)';
        if (kind === 'phillips') {
          a.fillRect(-R * 0.62, -sw / 2, R * 1.24, sw);
          a.fillRect(-sw / 2, -R * 0.62, sw, R * 1.24);
        } else if (kind !== 'hex') a.fillRect(-R * 0.86, -sw / 2, R * 1.72, sw);
        a.restore();
      }
    },
    /** Engraved-looking recess ring (e.g. around a knob or hole): darker line + bump groove. */
    groove(x, y, r, width = 0.0006) {
      g.save();
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = width * s;
      g.beginPath();
      g.arc(X(x), Y(y), r * s, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      P.auxSub(50, 0, 0, (c) => {
        c.lineWidth = width * s;
        c.beginPath();
        c.arc(X(x), Y(y), r * s, 0, Math.PI * 2);
        c.stroke();
      });
    },
    /**
     * Subtle use & handling wear: rubbed paint near controls, faint scuffs, fingerprints (glossier
     * smudges), darker grime along the lower edge. amount 0..1, seed for repeatability.
     * hotspots: [[x,y],...] places where hands touch (switches) — more wear there.
     */
    wear(amount = 0.5, seed = 1, hotspots = []) {
      if (amount <= 0) return;
      const r = rng(seed);
      const W = col.canvas.width;
      const H = col.canvas.height;
      g.save();
      // grime gradient toward the bottom & edges (very faint)
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, 'rgba(255,255,255,0.0)');
      gr.addColorStop(1, `rgba(0,0,0,${0.06 * amount})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      // scuffs: short light/dark hairlines
      const nScuff = Math.round(30 * amount * (widthM * heightM) / 0.05 + 6);
      for (let i = 0; i < nScuff; i++) {
        const x0 = r() * W;
        const y0 = r() * H;
        const len = (0.002 + r() * 0.012) * s;
        const an = r() * Math.PI;
        g.strokeStyle = r() < 0.6 ? `rgba(255,255,255,${0.05 + r() * 0.07})` : `rgba(0,0,0,${0.05 + r() * 0.08})`;
        g.lineWidth = Math.max(0.6, (0.00015 + r() * 0.0002) * s);
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 + Math.cos(an) * len * 0.5 + (r() - 0.5) * len * 0.2, y0 + Math.sin(an) * len * 0.5, x0 + Math.cos(an) * len, y0 + Math.sin(an) * len);
        g.stroke();
      }
      // rubbed paint & fingerprints around hotspots
      for (const [hx, hy] of hotspots) {
        if (r() > 0.55 * amount + 0.2) continue;
        const cx = X(hx + (r() - 0.5) * 0.01);
        const cy = Y(hy + (r() - 0.5) * 0.01);
        const rad = (0.004 + r() * 0.006) * s;
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        rg.addColorStop(0, `rgba(255,255,255,${0.035 * amount})`);
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg;
        g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        if (a) {
          a.save();
          a.globalCompositeOperation = 'difference';
          const fg = a.createRadialGradient(cx, cy, 0, cx, cy, rad * 0.8);
          fg.addColorStop(0, `rgb(0,${Math.round(40 * amount)},0)`);
          fg.addColorStop(1, 'rgb(0,0,0)');
          a.fillStyle = fg;
          a.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
          a.restore();
        }
      }
      // random blotches of roughness (handling, cleaning)
      if (a) {
        a.save();
        const nb = Math.round(12 * amount + 4);
        for (let i = 0; i < nb; i++) {
          const cx = r() * W;
          const cy = r() * H;
          const rad = (0.01 + r() * 0.03) * s;
          const up = r() < 0.5;
          a.globalCompositeOperation = up ? 'lighter' : 'difference';
          const fg = a.createRadialGradient(cx, cy, 0, cx, cy, rad);
          fg.addColorStop(0, `rgb(0,${Math.round(18 * amount)},0)`);
          fg.addColorStop(1, 'rgb(0,0,0)');
          a.fillStyle = fg;
          a.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        }
        a.restore();
      }
      // chipped paint at the corners/edges (bare aluminium shows through)
      const nChip = Math.round(4 * amount + 1);
      for (let i = 0; i < nChip; i++) {
        const edge = Math.floor(r() * 4);
        const t = r();
        const m = 0.0015 * s;
        const cx = edge === 0 ? t * W : edge === 1 ? W - m : edge === 2 ? t * W : m;
        const cy = edge === 0 ? m : edge === 1 ? t * H : edge === 2 ? H - m : t * H;
        g.fillStyle = `rgba(185,186,182,${0.25 + r() * 0.3})`;
        g.beginPath();
        g.ellipse(cx, cy, (0.0004 + r() * 0.0012) * s, (0.0003 + r() * 0.0007) * s, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    },
    /** Darken the outer edge (paint wrapping over the bevel) and optional border stripe. */
    edge(o2 = {}) {
      const W = col.canvas.width;
      const H = col.canvas.height;
      const bw = (o2.width ?? 0) * s;
      if (bw > 0) {
        g.save();
        g.strokeStyle = css(o2.color ?? '#141516');
        g.lineWidth = bw * 2;
        g.strokeRect(0, 0, W, H);
        g.restore();
      }
      if (o2.inner) {
        const iw = (o2.innerWidth ?? 0.0006) * s;
        const off = bw + (o2.innerGap ?? 0.0012) * s;
        g.save();
        g.strokeStyle = css(o2.inner);
        g.lineWidth = iw;
        g.strokeRect(off, off, W - off * 2, H - off * 2);
        g.restore();
      }
      const e = 0.0025 * s;
      g.save();
      const strips = [
        [0, 0, 0, e, 0, 0, W, e], // top
        [0, H, 0, H - e, 0, H - e, W, e], // bottom
        [0, 0, e, 0, 0, 0, e, H], // left
        [W, 0, W - e, 0, W - e, 0, e, H], // right
      ];
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of strips) {
        const gr = g.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, 'rgba(0,0,0,0.28)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(rx, ry, rw, rh);
      }
      g.restore();
    },
    /** Mark both textures for upload. */
    commit() {
      col.texture.needsUpdate = true;
      if (aux) aux.texture.needsUpdate = true;
    },
  };
  if (o.color != null) P.fill(o.color, baseRough);
  return P;
}

/** Rounded-rectangle path in canvas px (x,y top-left). */
export function roundRectPath(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r <= 0) {
    g.rect(x, y, w, h);
    return;
  }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
