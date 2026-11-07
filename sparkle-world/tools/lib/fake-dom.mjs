// A stand-in DOM for running the game's modules in Node (no browser): `document`, `window`,
// ImageData and a small but real 2D canvas. The canvas actually paints (fillRect, paths with
// lines / curves / arcs / ellipses, fill, stroke, clip, linear and radial gradients,
// transforms, globalAlpha, drawImage, get/putImageData), so tile painters, furniture and gift
// paper textures, avatar eyes and TV screens all end up with their real pixels in
// canvas._data (RGBA, row 0 at the top). Text is not drawn.
//
// Importing this module installs the globals only when `document` is not there yet, so a tool
// that sets up its own stand-ins first keeps them. Used by tools/lib/standin-game.mjs and
// tools/sceneview.mjs.

class FakeImageData {
  constructor(data, w, h) {
    if (typeof data === 'number') { h = w; w = data; data = new Uint8ClampedArray(Math.max(1, w * h) * 4); }
    this.data = data; this.width = w; this.height = h;
  }
}

const NAMED = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', pink: '#ffc0cb',
  gold: '#ffd700', orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', transparent: 'rgba(0,0,0,0)',
};

/** CSS color -> [r, g, b, a] (0..255). Hex (3/4/6/8), rgb(a), hsl(a), a few names. */
export function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0, 255];
  c = c.trim().toLowerCase();
  if (NAMED[c]) c = NAMED[c];
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/i.exec(c))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const v = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
  }
  if ((m = /^rgba?\(([^)]+)\)$/i.exec(c))) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map((s) => (s.endsWith('%') ? parseFloat(s) * 2.55 : Number(s)));
    const a = p.length > 3 ? (p[3] <= 1 ? p[3] * 255 : p[3]) : 255;
    return [p[0] | 0, p[1] | 0, p[2] | 0, Math.round(a)];
  }
  if ((m = /^hsla?\(([^)]+)\)$/i.exec(c))) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map((s) => parseFloat(s));
    const h = (((p[0] % 360) + 360) % 360) / 360, s = p[1] / 100, l = p[2] / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, pp = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
    const a = p.length > 3 ? (p[3] <= 1 ? p[3] * 255 : p[3]) : 255;
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255), Math.round(a)];
  }
  return [128, 128, 128, 255];
}

class Gradient {
  constructor(kind, a) { this.kind = kind; this.a = a; this.stops = []; }
  addColorStop(t, c) { this.stops.push([Number(t) || 0, parseColor(c)]); this.stops.sort((x, y) => x[0] - y[0]); }
  /** Color at a canvas point (already in gradient space). */
  at(x, y) {
    const s = this.stops;
    if (!s.length) return [0, 0, 0, 0];
    let t;
    if (this.kind === 'linear') {
      const [x0, y0, x1, y1] = this.a;
      const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy || 1;
      t = ((x - x0) * dx + (y - y0) * dy) / L;
    } else {
      const [x0, y0, r0, x1, y1, r1] = this.a;
      // simple concentric approximation (the painters use concentric or near-concentric ones)
      const d = Math.hypot(x - x1, y - y1);
      t = (d - r0) / ((r1 - r0) || 1);
      void x0; void y0;
    }
    if (t <= s[0][0]) return s[0][1];
    if (t >= s[s.length - 1][0]) return s[s.length - 1][1];
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i][0]) {
        const [ta, ca] = s[i - 1], [tb, cb] = s[i];
        const k = (t - ta) / ((tb - ta) || 1);
        return [0, 1, 2, 3].map((j) => ca[j] + (cb[j] - ca[j]) * k);
      }
    }
    return s[s.length - 1][1];
  }
}

const ident = () => [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const inv = (m) => { const d = m[0] * m[3] - m[1] * m[2] || 1e-9; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };

/** A 2D context that really paints into an RGBA buffer. */
function makeContext(canvas) {
  let w = 0, h = 0, data = null;
  const ensure = () => {
    const cw = Math.max(1, canvas.width | 0), ch = Math.max(1, canvas.height | 0);
    if (data && cw === w && ch === h) return;
    const nd = new Uint8ClampedArray(cw * ch * 4);
    data = nd; w = cw; h = ch;
  };
  ensure();
  let st = { fill: '#000000', stroke: '#000000', lineWidth: 1, alpha: 1, m: ident(), clip: null, comp: 'source-over' };
  const stack = [];
  let path = []; // subpaths: arrays of [x, y] in device space
  let cur = null;
  const tp = (x, y) => { const m = st.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
  const scaleOf = () => Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2])) || 1;
  const segN = (r) => Math.max(8, Math.min(64, Math.ceil(r * scaleOf() * 1.5)));
  const lastPt = () => (cur && cur.length ? cur[cur.length - 1] : null);
  const userLast = { x: 0, y: 0 };
  const start = (x, y) => { cur = [tp(x, y)]; path.push(cur); userLast.x = x; userLast.y = y; };
  const line = (x, y) => { if (!cur) start(x, y); else { cur.push(tp(x, y)); userLast.x = x; userLast.y = y; } };

  function paintStyle(style) {
    if (style && style instanceof Gradient) {
      const im = inv(st.m);
      return (px, py) => { const x = im[0] * px + im[2] * py + im[4], y = im[1] * px + im[3] * py + im[5]; return style.at(x, y); };
    }
    const c = parseColor(typeof style === 'string' ? style : '#000000');
    return () => c;
  }

  function blend(i, c, cov) {
    const a = (c[3] / 255) * st.alpha * cov * (st.clip ? st.clip[i >> 2] / 255 : 1);
    if (a <= 0) return;
    if (st.comp === 'destination-out') { data[i + 3] = data[i + 3] * (1 - a); return; }
    if (st.comp === 'source-atop') {
      const da = data[i + 3] / 255;
      if (da <= 0) return;
      data[i] += (c[0] - data[i]) * a; data[i + 1] += (c[1] - data[i + 1]) * a; data[i + 2] += (c[2] - data[i + 2]) * a;
      return;
    }
    const da = data[i + 3] / 255, oa = a + da * (1 - a);
    if (oa <= 0) return;
    data[i] = (c[0] * a + data[i] * da * (1 - a)) / oa;
    data[i + 1] = (c[1] * a + data[i + 1] * da * (1 - a)) / oa;
    data[i + 2] = (c[2] * a + data[i + 2] * da * (1 - a)) / oa;
    data[i + 3] = oa * 255;
  }

  /** Coverage (0..1, 4x4 samples, nonzero rule) of polygons per pixel, then cb(i, cov, x, y). */
  function raster(polys, cb) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polys) for (const [x, y] of p) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (!isFinite(minX)) return;
    const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(w - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
    if (x0 > x1 || y0 > y1) return;
    const edges = [];
    for (const p of polys) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; if (a[1] !== b[1]) edges.push(a, b); }
    const S = 4, cover = new Float32Array(x1 - x0 + 1);
    for (let y = y0; y <= y1; y++) {
      cover.fill(0);
      for (let sy = 0; sy < S; sy++) {
        const yy = y + (sy + 0.5) / S;
        const xs = [];
        for (let e = 0; e < edges.length; e += 2) {
          const a = edges[e], b = edges[e + 1];
          if ((a[1] <= yy && b[1] > yy) || (b[1] <= yy && a[1] > yy)) xs.push([a[0] + ((yy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), b[1] > a[1] ? 1 : -1]);
        }
        if (!xs.length) continue;
        xs.sort((p, q) => p[0] - q[0]);
        let wind = 0;
        for (let k = 0; k < xs.length - 1; k++) {
          wind += xs[k][1];
          if (!wind) continue;
          const xa = xs[k][0], xb = xs[k + 1][0];
          for (let sx = 0; sx < S; sx++) {
            const off = (sx + 0.5) / S;
            const from = Math.max(x0, Math.ceil(xa - off)), to = Math.min(x1, Math.ceil(xb - off) - 1);
            for (let x = from; x <= to; x++) cover[x - x0] += 1 / (S * S);
          }
        }
      }
      for (let x = x0; x <= x1; x++) { const c = cover[x - x0]; if (c > 0) cb((y * w + x) * 4, Math.min(1, c), x + 0.5, y + 0.5); }
    }
  }

  function strokePolys() {
    const hw = (st.lineWidth * scaleOf()) / 2;
    const polys = [];
    const circle = (cx, cy) => { const n = Math.max(8, Math.ceil(hw * 4)); const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push([cx + Math.cos(a) * hw, cy + Math.sin(a) * hw]); } return p; };
    for (const sp of path) {
      for (let i = 0; i + 1 < sp.length; i++) {
        const [ax, ay] = sp[i], [bx, by] = sp[i + 1];
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        const nx = (-dy / L) * hw, ny = (dx / L) * hw;
        polys.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
        if (hw > 0.6) polys.push(circle(bx, by));
      }
      if (sp.closed && sp.length > 2) {
        const [ax, ay] = sp[sp.length - 1], [bx, by] = sp[0];
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
        if (L > 1e-6) { const nx = (-dy / L) * hw, ny = (dx / L) * hw; polys.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]); }
      }
    }
    return polys;
  }

  // each stroke polygon is filled on its own (union by max coverage) so overlaps do not cancel
  function fillPolysUnion(polys, style) {
    const cov = new Float32Array(w * h);
    for (const p of polys) raster([p], (i, c) => { const k = i >> 2; if (c > cov[k]) cov[k] = c; });
    const paint = paintStyle(style);
    for (let k = 0; k < cov.length; k++) if (cov[k] > 0) blend(k * 4, paint((k % w) + 0.5, Math.floor(k / w) + 0.5), cov[k]);
  }

  function arcPts(cx, cy, rx, ry, rot, a0, a1, ccw) {
    let span = a1 - a0;
    if (!ccw && span < 0) span = (span % (Math.PI * 2)) + Math.PI * 2;
    if (ccw && span > 0) span = (span % (Math.PI * 2)) - Math.PI * 2;
    if (!ccw && a1 - a0 >= Math.PI * 2) span = Math.PI * 2;
    if (ccw && a0 - a1 >= Math.PI * 2) span = -Math.PI * 2;
    const n = segN(Math.max(rx, ry));
    const steps = Math.max(2, Math.ceil((Math.abs(span) / (Math.PI * 2)) * n));
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      line(cx + x * cr - y * sr, cy + x * sr + y * cr);
    }
  }

  const ctx = {
    canvas,
    get fillStyle() { return st.fill; }, set fillStyle(v) { st.fill = v; },
    get strokeStyle() { return st.stroke; }, set strokeStyle(v) { st.stroke = v; },
    get lineWidth() { return st.lineWidth; }, set lineWidth(v) { st.lineWidth = Number(v) || 1; },
    get globalAlpha() { return st.alpha; }, set globalAlpha(v) { st.alpha = Math.max(0, Math.min(1, Number(v))); },
    get globalCompositeOperation() { return st.comp; }, set globalCompositeOperation(v) { st.comp = v; },
    save() { stack.push({ ...st, m: st.m.slice() }); },
    restore() { if (stack.length) st = stack.pop(); },
    setTransform(a, b, c, d, e, f) { if (typeof a === 'object' && a) st.m = [a.a ?? 1, a.b ?? 0, a.c ?? 0, a.d ?? 1, a.e ?? 0, a.f ?? 0]; else st.m = [a, b, c, d, e, f].map(Number); },
    resetTransform() { st.m = ident(); },
    transform(a, b, c, d, e, f) { st.m = mul(st.m, [a, b, c, d, e, f]); },
    translate(x, y) { st.m = mul(st.m, [1, 0, 0, 1, x, y]); },
    scale(x, y) { st.m = mul(st.m, [x, 0, 0, y ?? x, 0, 0]); },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); st.m = mul(st.m, [c, s, -s, c, 0, 0]); },
    beginPath() { path = []; cur = null; },
    moveTo(x, y) { start(x, y); },
    lineTo(x, y) { line(x, y); },
    closePath() { if (cur && cur.length) { cur.closed = true; const f = cur[0]; cur = [f]; path.push(cur); } },
    rect(x, y, ww, hh) { start(x, y); line(x + ww, y); line(x + ww, y + hh); line(x, y + hh); cur.closed = true; cur = null; },
    roundRect(x, y, ww, hh, r = 0) {
      const rr = Math.min(Math.abs(Array.isArray(r) ? r[0] || 0 : r), Math.abs(ww) / 2, Math.abs(hh) / 2);
      if (!rr) { ctx.rect(x, y, ww, hh); return; }
      cur = null;
      arcPts(x + ww - rr, y + rr, rr, rr, 0, -Math.PI / 2, 0, false);
      arcPts(x + ww - rr, y + hh - rr, rr, rr, 0, 0, Math.PI / 2, false);
      arcPts(x + rr, y + hh - rr, rr, rr, 0, Math.PI / 2, Math.PI, false);
      arcPts(x + rr, y + rr, rr, rr, 0, Math.PI, Math.PI * 1.5, false);
      cur.closed = true; cur = null;
    },
    arc(x, y, r, a0, a1, ccw = false) { arcPts(x, y, r, r, 0, a0, a1, ccw); },
    ellipse(x, y, rx, ry, rot, a0, a1, ccw = false) { arcPts(x, y, rx, ry, rot, a0, a1, ccw); },
    arcTo(x1, y1, x2, y2) { line(x1, y1); void x2; void y2; },
    quadraticCurveTo(cx, cy, x, y) {
      const p0 = { ...userLast };
      for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; line(u * u * p0.x + 2 * u * t * cx + t * t * x, u * u * p0.y + 2 * u * t * cy + t * t * y); }
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p0 = { ...userLast };
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        line(u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y);
      }
    },
    fill() {
      ensure();
      const polys = path.filter((p) => p.length > 2);
      const paint = paintStyle(st.fill);
      raster(polys, (i, cov, x, y) => blend(i, paint(x, y), cov));
    },
    stroke() { ensure(); fillPolysUnion(strokePolys(), st.stroke); },
    clip() {
      ensure();
      const mask = new Uint8ClampedArray(w * h);
      raster(path.filter((p) => p.length > 2), (i, cov) => { mask[i >> 2] = cov * 255; });
      if (st.clip) for (let k = 0; k < mask.length; k++) mask[k] = (mask[k] * st.clip[k]) / 255;
      st.clip = mask;
    },
    fillRect(x, y, ww, hh) {
      ensure();
      const m = st.m;
      if (m[1] === 0 && m[2] === 0 && !(st.fill instanceof Gradient)) {
        // axis-aligned fast path with partial-pixel coverage
        let ax = m[0] * x + m[4], bx = m[0] * (x + ww) + m[4], ay = m[3] * y + m[5], by = m[3] * (y + hh) + m[5];
        if (ax > bx) [ax, bx] = [bx, ax];
        if (ay > by) [ay, by] = [by, ay];
        const c = parseColor(typeof st.fill === 'string' ? st.fill : '#000');
        for (let yy = Math.max(0, Math.floor(ay)); yy < Math.min(h, Math.ceil(by)); yy++) {
          const cy = Math.min(by, yy + 1) - Math.max(ay, yy);
          for (let xx = Math.max(0, Math.floor(ax)); xx < Math.min(w, Math.ceil(bx)); xx++) {
            const cx = Math.min(bx, xx + 1) - Math.max(ax, xx);
            blend((yy * w + xx) * 4, c, cx * cy);
          }
        }
        return;
      }
      const save = path, sc = cur;
      path = []; ctx.rect(x, y, ww, hh); ctx.fill(); path = save; cur = sc;
    },
    strokeRect(x, y, ww, hh) { const save = path; path = []; ctx.rect(x, y, ww, hh); ctx.stroke(); path = save; },
    clearRect(x, y, ww, hh) {
      ensure();
      const m = st.m;
      const ax = Math.max(0, Math.floor(m[0] * x + m[4])), ay = Math.max(0, Math.floor(m[3] * y + m[5]));
      const bx = Math.min(w, Math.ceil(m[0] * (x + ww) + m[4])), by = Math.min(h, Math.ceil(m[3] * (y + hh) + m[5]));
      for (let yy = ay; yy < by; yy++) data.fill(0, (yy * w + ax) * 4, (yy * w + bx) * 4);
    },
    createLinearGradient(x0, y0, x1, y1) { return new Gradient('linear', [x0, y0, x1, y1]); },
    createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient('radial', [x0, y0, r0, x1, y1, r1]); },
    createPattern() { return '#808080'; },
    getImageData(x, y, ww, hh) {
      ensure();
      const out = new Uint8ClampedArray(Math.max(1, ww * hh) * 4);
      for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < ww; xx++) {
        const sx = xx + x, sy = yy + y;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const s = (sy * w + sx) * 4, d = (yy * ww + xx) * 4;
        out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
      }
      return new globalThis.ImageData(out, ww, hh);
    },
    putImageData(img, x = 0, y = 0) {
      ensure();
      for (let yy = 0; yy < img.height; yy++) for (let xx = 0; xx < img.width; xx++) {
        const tx = xx + x, ty = yy + y;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const s = (yy * img.width + xx) * 4, d = (ty * w + tx) * 4;
        data[d] = img.data[s]; data[d + 1] = img.data[s + 1]; data[d + 2] = img.data[s + 2]; data[d + 3] = img.data[s + 3];
      }
    },
    createImageData(ww, hh) { if (typeof ww === 'object') { hh = ww.height; ww = ww.width; } return new globalThis.ImageData(ww, hh); },
    drawImage(src, ...a) {
      ensure();
      const sd = src && (src._data || (src.getContext && src.getContext('2d')._data) || (src.data && src.width && src.data));
      if (!sd) return;
      const SW = src.width, SH = src.height;
      let sx = 0, sy = 0, sw = SW, sh = SH, dx, dy, dw, dh;
      if (a.length <= 4) { [dx, dy, dw = SW, dh = SH] = a; } else { [sx, sy, sw, sh, dx, dy, dw, dh] = a; }
      const m = mul(st.m, [dw / sw, 0, 0, dh / sh, dx - (sx * dw) / sw, dy - (sy * dh) / sh]);
      const im = inv(m);
      const corners = [[sx, sy], [sx + sw, sy], [sx, sy + sh], [sx + sw, sy + sh]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
      const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])))), x1 = Math.min(w - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])))), y1 = Math.min(h - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const u = im[0] * (x + 0.5) + im[2] * (y + 0.5) + im[4], v = im[1] * (x + 0.5) + im[3] * (y + 0.5) + im[5];
        if (u < sx || v < sy || u >= sx + sw || v >= sy + sh) continue;
        const ui = Math.min(SW - 1, Math.floor(u)), vi = Math.min(SH - 1, Math.floor(v));
        const s = (vi * SW + ui) * 4;
        blend((y * w + x) * 4, [sd[s], sd[s + 1], sd[s + 2], sd[s + 3]], 1);
      }
    },
    measureText: (t) => ({ width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    fillText() {}, strokeText() {}, setLineDash() {}, getLineDash: () => [],
    isPointInPath: () => false,
    get _data() { ensure(); return data; },
  };
  return new Proxy(ctx, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && /^[a-z]/.test(k) ? () => ({ addColorStop() {} }) : undefined)),
    set: (t, k, v) => { if (k in t) t[k] = v; else t[k] = v; return true; },
  });
}

/** A canvas element whose 2D context paints for real. */
export function paintingCanvas(w = 16, h = 16) {
  const c = { width: w, height: h, style: {}, className: '', _ctx: null, addEventListener() {}, removeEventListener() {}, toDataURL: () => 'data:image/png;base64,AAAA', toBlob(cb) { cb && cb(null); } };
  c.getContext = (kind) => {
    if (kind && kind !== '2d') return null;
    if (!c._ctx) c._ctx = makeContext(c);
    return c._ctx;
  };
  Object.defineProperty(c, '_data', { get: () => c.getContext('2d')._data });
  return c;
}

class FakeEl {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.style = { setProperty() {} }; this.dataset = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  appendChild(c) { this.children.push(c); return c; }
  append() {} prepend() {} remove() {} setAttribute() {} getAttribute() { return null; } addEventListener() {} removeEventListener() {}
  querySelector() { return null; } querySelectorAll() { return []; } insertAdjacentHTML() {} animate() { return { finished: Promise.resolve(), cancel() {} }; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; }
}

export const installed = !globalThis.document;
if (installed) {
  globalThis.ImageData = globalThis.ImageData || FakeImageData;
  globalThis.window = globalThis;
  globalThis.addEventListener = globalThis.addEventListener || (() => {});
  globalThis.removeEventListener = globalThis.removeEventListener || (() => {});
  globalThis.document = {
    hidden: false,
    createElement: (tag) => (tag === 'canvas' ? paintingCanvas() : new FakeEl(tag)),
    createElementNS: (ns, tag) => (tag === 'canvas' ? paintingCanvas() : new FakeEl(tag)),
    head: new FakeEl('head'), body: new FakeEl('body'),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  };
} else {
  globalThis.ImageData = globalThis.ImageData || FakeImageData;
}
