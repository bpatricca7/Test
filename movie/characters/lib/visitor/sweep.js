// The Visitor: generalized-cylinder sweeps along joint chains.
//
// A limb is a smooth centripetal Catmull-Rom curve through its joints with
// an elliptical, shaped cross-section. Cross-section frames come from a
// per-segment "front" vector blended across the joints, so twists and bends
// stay smooth. Capped ends are closed with hemispherical ring spacing.

const TAU = Math.PI * 2;

export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const bump = (th, c, w) => { const d = angDiff(th, c) / w; return Math.exp(-d * d); };

// smooth interpolation of keyed profiles [[u, a, b, ...], ...]
export function profile(keys, u, out) {
  const n = keys.length;
  if (u <= keys[0][0]) { for (let c = 1; c < keys[0].length; c++) out[c - 1] = keys[0][c]; return out; }
  if (u >= keys[n - 1][0]) { for (let c = 1; c < keys[n - 1].length; c++) out[c - 1] = keys[n - 1][c]; return out; }
  let k = 0;
  while (k < n - 2 && u > keys[k + 1][0]) k++;
  const k0 = keys[Math.max(0, k - 1)], k1 = keys[k], k2 = keys[k + 1], k3 = keys[Math.min(n - 1, k + 2)];
  const t = (u - k1[0]) / (k2[0] - k1[0]);
  const t2 = t * t, t3 = t2 * t;
  const d1 = k2[0] - k1[0];
  for (let c = 1; c < k1.length; c++) {
    // Catmull-Rom with non-uniform spacing, tangents clamped to avoid overshoot
    const m1 = k1 === k0 ? 0 : ((k2[c] - k0[c]) / (k2[0] - k0[0])) * d1;
    const m2 = k3 === k2 ? 0 : ((k3[c] - k1[c]) / (k3[0] - k1[0])) * d1;
    out[c - 1] = (2 * t3 - 3 * t2 + 1) * k1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[c] + (t3 - t2) * m2;
  }
  return out;
}

function crPoint(P0, P1, P2, P3, u, out) {
  const d01 = Math.max(1e-5, Math.sqrt(Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2])));
  const d12 = Math.max(1e-5, Math.sqrt(Math.hypot(P2[0] - P1[0], P2[1] - P1[1], P2[2] - P1[2])));
  const d23 = Math.max(1e-5, Math.sqrt(Math.hypot(P3[0] - P2[0], P3[1] - P2[1], P3[2] - P2[2])));
  const t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
  const tt = t1 + u * d12;
  for (let c = 0; c < 3; c++) {
    const A1 = ((t1 - tt) * P0[c] + (tt - t0) * P1[c]) / (t1 - t0);
    const A2 = ((t2 - tt) * P1[c] + (tt - t1) * P2[c]) / (t2 - t1);
    const A3 = ((t3 - tt) * P2[c] + (tt - t2) * P3[c]) / (t3 - t2);
    const B1 = ((t2 - tt) * A1 + (tt - t0) * A2) / (t2 - t0);
    const B2 = ((t3 - tt) * A2 + (tt - t1) * A3) / (t3 - t1);
    out[c] = ((t2 - tt) * B1 + (tt - t1) * B2) / (t2 - t1);
  }
  return out;
}

// scratch
const C = [], T = [], F = [], S = [], CF = [];
const e0 = [0, 0, 0], e3 = [0, 0, 0], tmp = [0, 0, 0], rad = [0, 0, 0, 0];

/**
 * pts: [[x,y,z], ...] joints; fronts: [[x,y,z], ...] one per segment (theta = 0 direction)
 * prof(u, s, L, out) -> out[0] = r along front, out[1] = r along side, out[2..] free
 * shape(theta, u, out) -> radial multiplier (optional)
 * opts: { capStart: n rings, capEnd: n rings, blend: joint blend fraction }
 */
export function sweep(buf, patch, pts0, fronts0, prof, shape, opts = {}) {
  const { nu, nv, cols, off } = patch;
  const P = buf.pos;
  let pts = pts0, fronts = fronts0;
  if (opts.tight) {
    // keep bones straight: extra points near each interior joint, so the curve only fillets the joint
    pts = [pts0[0]]; fronts = [];
    const r = opts.tight;
    for (let k = 0; k < pts0.length - 1; k++) {
      const a = pts0[k], b = pts0[k + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const d = Math.min(r, L * 0.3) / (L || 1);
      if (k > 0) { pts.push([a[0] + (b[0] - a[0]) * d, a[1] + (b[1] - a[1]) * d, a[2] + (b[2] - a[2]) * d]); fronts.push(fronts0[k]); }
      if (k < pts0.length - 2) { pts.push([b[0] + (a[0] - b[0]) * d, b[1] + (a[1] - b[1]) * d, b[2] + (a[2] - b[2]) * d]); fronts.push(fronts0[k]); }
      pts.push(b); fronts.push(fronts0[k]);
    }
  }
  const n = pts.length;
  // segment chord lengths
  const len = [], cum = [0];
  for (let k = 0; k < n - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    len.push(Math.max(1e-5, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    cum.push(cum[k] + len[k]);
  }
  const L = cum[n - 1];
  // ring arc positions with hemispherical caps
  const cs = opts.capStart || 0, ce = opts.capEnd || 0;
  let rr = cs ? prof(0.0, 0, L, rad) : null;
  const cLen0 = cs ? (opts.capLenStart || Math.max(rr[0], rr[1])) : 0;
  rr = ce ? prof(1.0, L, L, rad) : null;
  const cLen1 = ce ? (opts.capLenEnd || Math.max(rr[0], rr[1])) : 0;
  const body = nv - cs - ce;
  for (let j = 0; j < nv; j++) {
    let s, cf = 1;
    if (j < cs) { const ph = (j / cs) * Math.PI / 2; s = cLen0 * (1 - Math.cos(ph)); cf = Math.sin(ph); }
    else if (j >= nv - ce) { const q = nv - 1 - j; const ph = (q / ce) * Math.PI / 2; s = L - cLen1 * (1 - Math.cos(ph)); cf = Math.sin(ph); }
    else {
      const x = body > 1 ? (j - cs) / (body - 1) : 0;
      s = cLen0 + x * (L - cLen0 - cLen1);
      if (cs && j === cs) cf = 1;
    }
    S[j] = s; CF[j] = cf;
  }
  // centres and blended fronts
  const blend = opts.blend ?? 0.3;
  for (let j = 0; j < nv; j++) {
    const s = Math.min(L - 1e-7, Math.max(0, S[j]));
    let k = 0;
    while (k < n - 2 && s > cum[k + 1]) k++;
    const u = (s - cum[k]) / len[k];
    const P0 = k > 0 ? pts[k - 1] : (e0[0] = 2 * pts[0][0] - pts[1][0], e0[1] = 2 * pts[0][1] - pts[1][1], e0[2] = 2 * pts[0][2] - pts[1][2], e0);
    const P3 = k + 2 < n ? pts[k + 2] : (e3[0] = 2 * pts[n - 1][0] - pts[n - 2][0], e3[1] = 2 * pts[n - 1][1] - pts[n - 2][1], e3[2] = 2 * pts[n - 1][2] - pts[n - 2][2], e3);
    C[j] = crPoint(P0, pts[k], pts[k + 1], P3, u, C[j] || [0, 0, 0]);
    const f = F[j] || (F[j] = [0, 0, 0]);
    let fa = fronts[k], fb = fronts[k], w = 0;
    if (u < blend && k > 0) { fa = fronts[k - 1]; w = 0.5 + 0.5 * (u / blend); w = w * w * (3 - 2 * w); f[0] = fa[0] + (fb[0] - fa[0]) * w; f[1] = fa[1] + (fb[1] - fa[1]) * w; f[2] = fa[2] + (fb[2] - fa[2]) * w; }
    else if (u > 1 - blend && k < n - 2) { fb = fronts[k + 1]; w = 0.5 * ((u - (1 - blend)) / blend); w = w * w * (3 - 2 * w); f[0] = fa[0] + (fb[0] - fa[0]) * w; f[1] = fa[1] + (fb[1] - fa[1]) * w; f[2] = fa[2] + (fb[2] - fa[2]) * w; }
    else { f[0] = fa[0]; f[1] = fa[1]; f[2] = fa[2]; }
  }
  // tangents
  for (let j = 0; j < nv; j++) {
    const a = C[Math.max(0, j - 1)], b = C[Math.min(nv - 1, j + 1)];
    const t = T[j] || (T[j] = [0, 0, 0]);
    t[0] = b[0] - a[0]; t[1] = b[1] - a[1]; t[2] = b[2] - a[2];
    let l = Math.hypot(t[0], t[1], t[2]);
    if (l < 1e-9) {
      // collapsed ring neighbours: fall back to the chord
      const k = Math.min(n - 2, Math.max(0, j === 0 ? 0 : n - 2));
      t[0] = pts[k + 1][0] - pts[k][0]; t[1] = pts[k + 1][1] - pts[k][1]; t[2] = pts[k + 1][2] - pts[k][2];
      l = Math.hypot(t[0], t[1], t[2]);
    }
    t[0] /= l; t[1] /= l; t[2] /= l;
  }
  // rings
  const cosT = sweep._cos || (sweep._cos = {}), key = nu;
  if (!cosT[key]) { const c = new Float32Array(nu), s = new Float32Array(nu); for (let i = 0; i < nu; i++) { c[i] = Math.cos(i / nu * TAU); s[i] = Math.sin(i / nu * TAU); } cosT[key] = [c, s]; }
  const [ct, st] = cosT[key];
  for (let j = 0; j < nv; j++) {
    const s = S[j], u = L > 0 ? s / L : 0;
    const rp = prof(u, s, L, rad);
    const rz = rp[0] * CF[j], rx = rp[1] * CF[j];
    const t = T[j], f = F[j], c = C[j];
    // A1 = front orthogonalised to the tangent, A2 = T x A1
    let d = f[0] * t[0] + f[1] * t[1] + f[2] * t[2];
    let a1x = f[0] - t[0] * d, a1y = f[1] - t[1] * d, a1z = f[2] - t[2] * d;
    let l = Math.hypot(a1x, a1y, a1z);
    if (l < 1e-6) { // front parallel to tangent: pick any perpendicular
      const ax = Math.abs(t[0]) < 0.9 ? 1 : 0, ay = 1 - ax;
      d = ax * t[0] + ay * t[1];
      a1x = ax - t[0] * d; a1y = ay - t[1] * d; a1z = -t[2] * d;
      l = Math.hypot(a1x, a1y, a1z);
    }
    a1x /= l; a1y /= l; a1z /= l;
    const a2x = t[1] * a1z - t[2] * a1y, a2y = t[2] * a1x - t[0] * a1z, a2z = t[0] * a1y - t[1] * a1x;
    const row = off + j * cols;
    for (let i = 0; i < nu; i++) {
      const th = i / nu * TAU;
      const m = shape ? shape(th, u, s) : 1;
      const cz = ct[i] * rz * m, sx = st[i] * rx * m;
      const o = (row + i) * 3;
      P[o] = c[0] + a1x * cz + a2x * sx;
      P[o + 1] = c[1] + a1y * cz + a2y * sx;
      P[o + 2] = c[2] + a1z * cz + a2z * sx;
    }
  }
  buf.seam(patch);
  return L;
}

// static texture coords for a sweep patch: u around (whole tiles), v along, in texture tiles
export function sweepTex(buf, patch, circ, length, tile = 0.3, part = 0, extra = null) {
  const { nu, nv, cols, off } = patch;
  const nT = Math.max(1, Math.round(circ / tile));
  const vScale = nT / circ;
  for (let j = 0; j < nv; j++) for (let i = 0; i < cols; i++) {
    const o = off + j * cols + i;
    buf.tex[o * 3] = (i / nu) * nT;
    buf.tex[o * 3 + 1] = (j / (nv - 1)) * length * vScale;
    buf.tex[o * 3 + 2] = 0;
    buf.info[o * 4] = part;
    buf.info[o * 4 + 1] = 0;
    buf.info[o * 4 + 2] = 1;
    buf.info[o * 4 + 3] = extra ? extra(i / nu, j / (nv - 1)) : 0;
  }
}
