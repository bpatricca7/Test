// The Visitor: the head.
//
// The skull is a signed distance function (smooth unions of ellipsoids and a
// tapered jaw, carved eye sockets). The head mesh is a sphere-topology grid
// whose "pole" is the mouth: row K is the lip line (a slit when closed),
// rows above it spread out over the face in confocal ellipses around the slit
// (mapped onto the skull by a gnomonic ray-cast from the skull centre), then
// in polar rings over the cranium to a pole at the back of the head; rows
// below K roll in behind the lips and form the mouth cavity. That makes the
// mouth a real opening that can part, widen, round and press, while the rest
// of the face stays a single smooth surface.
//
// The eyelids are part of the skull: the skin bulges over each almond eyeball
// (a closed-lid shape) and the shader cuts the almond opening per pixel with
// analytic lid edges (see eyeOpen() in shaders.js), so lid margins, lash lines
// and folds stay crisp at any distance and blinks close the opening.
//
// Head space: origin at the skull centre at eye level, +X the Visitor's left,
// +Y up, +Z forward (out of the face). HS scales head space into root space.

const TAU = Math.PI * 2;

function sdEll(x, y, z, rx, ry, rz) {
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }
function sdRoundCone(px, py, pz, a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
// rotation matrix (row-major 3x3) R = Ry(yaw) * Rx(pitch) * Rz(roll): local -> parent
export function euler3(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Rx*Rz
  const a = [cr, -sr, 0, cp * sr, cp * cr, -sp, sp * sr, sp * cr, cp];
  // Ry * (Rx*Rz)
  return [
    cy * a[0] + sy * a[6], cy * a[1] + sy * a[7], cy * a[2] + sy * a[8],
    a[3], a[4], a[5],
    -sy * a[0] + cy * a[6], -sy * a[1] + cy * a[7], -sy * a[2] + cy * a[8],
  ];
}

// ---------------------------------------------------------------------------
// the skull
// ---------------------------------------------------------------------------
export const HEAD = {
  cran: { c: [0, 0.03, -0.045], r: [0.084, 0.097, 0.128], tilt: 0.5 },
  face: { c: [0, -0.03, 0.016], r: [0.068, 0.07, 0.066] },
  jawA: [0, -0.04, 0.028], jawB: [0, -0.099, 0.05], jawRa: 0.047, jawRb: 0.016,
  cheek: { c: [0.047, -0.036, 0.045], r: [0.024, 0.018, 0.026] },
  brow: { c: [0, 0.075, -0.01], r: [0.07, 0.03, 0.05] },
  muzzle: { c: [0, -0.062, 0.06], r: [0.026, 0.019, 0.022] },
  temple: { c: [0.083, 0.004, 0.012], r: [0.018, 0.026, 0.03] },
  // eye (left; the right is mirrored): almond ellipsoid, yawed out, outer corner up
  eye: { c: [0.041, 0.009, 0.06], r: [0.034, 0.0205, 0.017], yaw: 0.65, roll: 0.1, pitch: -0.14 },
  lid: { grow: 1.07, k: 0.01, sock: [1.14, 1.35, 1.15], sockK: 0.014 },    // skin over the eyeball: the lids are this bulge, cut open in the shader
  mouthDir: [0, -0.064, 0.086],
  W0: 0.0158,          // half-width of the mouth slit
};
export const HS = 1.14;   // head scale (head space -> root space)

export function makeSkull(opt = {}) {
  const H = HEAD;
  const cr = Math.cos(H.cran.tilt), sr = Math.sin(H.cran.tilt);
  const eyes = [1, -1].map(side => {
    const e = H.eye;
    const R = euler3(side * e.yaw, e.pitch, side * e.roll);
    return { side, c: [side * e.c[0], e.c[1], e.c[2]], R, r: e.r.slice() };
  });
  const eL = eyes[0];
  const lidG = H.lid.grow;
  // local coords of point in eye frame (left eye; callers mirror x)
  function eyeLocal(e, x, y, z) {
    const dx = x - e.c[0], dy = y - e.c[1], dz = z - e.c[2], R = e.R;
    return [R[0] * dx + R[3] * dy + R[6] * dz, R[1] * dx + R[4] * dy + R[7] * dz, R[2] * dx + R[5] * dy + R[8] * dz];
  }
  function sdf(x, y, z) {
    const ax = Math.abs(x);
    // cranium, long axis tilted up at the back
    let cx = x - H.cran.c[0], cy = y - H.cran.c[1], cz = z - H.cran.c[2];
    const ly = cy * cr + cz * sr, lz = -cy * sr + cz * cr;
    let d = sdEll(cx, ly, lz, H.cran.r[0], H.cran.r[1], H.cran.r[2]);
    d = smin(d, sdEll(x - H.face.c[0], y - H.face.c[1], z - H.face.c[2], ...H.face.r), 0.04);
    d = smin(d, sdRoundCone(x, y, z, H.jawA, H.jawB, H.jawRa, H.jawRb), 0.03);
    d = smin(d, sdEll(ax - H.cheek.c[0], y - H.cheek.c[1], z - H.cheek.c[2], ...H.cheek.r), 0.022);
    d = smin(d, sdEll(x - H.brow.c[0], y - H.brow.c[1], z - H.brow.c[2], ...H.brow.r), 0.03);
    d = smin(d, sdEll(x - H.muzzle.c[0], y - H.muzzle.c[1], z - H.muzzle.c[2], ...H.muzzle.r), 0.016);
    d = smax(d, -sdEll(ax - H.temple.c[0], y - H.temple.c[1], z - H.temple.c[2], ...H.temple.r), 0.02);
    // the lids: skin bulging over the almond eyeball (mirrored); the opening is cut per-pixel
    if (opt.noEyes) return d;
    const l = eyeLocal(eL, ax, y, z);
    const sg = H.lid.sock;
    d = smax(d, -sdEll(l[0], l[1], l[2], eL.r[0] * sg[0], eL.r[1] * sg[1], eL.r[2] * sg[2]), H.lid.sockK);
    d = smin(d, sdEll(l[0], l[1], l[2], eL.r[0] * lidG, eL.r[1] * lidG, eL.r[2] * lidG), H.lid.k);
    return d;
  }
  function sdEye(x, y, z) {
    const l = eyeLocal(eL, Math.abs(x), y, z);
    return sdEll(l[0], l[1], l[2], eL.r[0], eL.r[1], eL.r[2]);
  }
  const sdfWithEyes = (x, y, z) => Math.min(sdf(x, y, z), sdEye(x, y, z));
  // first exit of the ray O + t*d (unit d) from the skull
  function raycast(dx, dy, dz) {
    let t = 0.02, prev = 0.02;
    let v = sdf(dx * t, dy * t, dz * t);
    for (let i = 0; i < 400 && v < 0; i++) {
      prev = t;
      t += Math.max(0.0008, -v * 0.7);
      v = sdf(dx * t, dy * t, dz * t);
    }
    let lo = prev, hi = t;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) * 0.5;
      if (sdf(dx * m, dy * m, dz * m) < 0) lo = m; else hi = m;
    }
    return (lo + hi) * 0.5;
  }
  return { sdf, sdfWithEyes, sdEye, raycast, eyes };
}

// ---------------------------------------------------------------------------
// visemes -> mouth parameters
// ---------------------------------------------------------------------------
const VIS = {
  sil: {},
  PP: { press: 1, jaw: 0.03 },
  FF: { jaw: 0.14, tuck: 1, lift: 0.35 },
  TH: { jaw: 0.24, lift: 0.2, tongue: 1 },
  DD: { jaw: 0.3, lift: 0.25, wide: 0.12, tongue: 0.5 },
  kk: { jaw: 0.4, lift: 0.2, wide: 0.05 },
  CH: { jaw: 0.24, round: 0.55, pout: 0.75, lift: 0.4 },
  SS: { jaw: 0.1, wide: 0.5, lift: 0.3 },
  nn: { jaw: 0.24, wide: 0.12, lift: 0.18, tongue: 0.6 },
  RR: { jaw: 0.26, round: 0.5, pout: 0.45, lift: 0.2 },
  aa: { jaw: 1.0, lift: 0.55, wide: 0.12 },
  E: { jaw: 0.52, wide: 0.62, lift: 0.4 },
  I: { jaw: 0.3, wide: 0.9, lift: 0.3 },
  O: { jaw: 0.72, round: 0.9, pout: 0.6, lift: 0.35 },
  U: { jaw: 0.3, round: 1.0, pout: 1.0, lift: 0.1 },
};
export const VISEMES = Object.keys(VIS);

export function mouthParams(visemes, extra = {}) {
  const m = { jaw: 0, lift: 0, wide: 0, round: 0, pout: 0, press: 0, tuck: 0, tongue: 0, smile: 0 };
  if (visemes) {
    let sum = 0;
    for (const k of VISEMES) sum += Math.max(0, visemes[k] || 0);
    const norm = sum > 1 ? 1 / sum : 1;
    for (const k of VISEMES) {
      const w = Math.max(0, visemes[k] || 0) * norm;
      if (!w) continue;
      const p = VIS[k];
      for (const q in p) m[q] += p[q] * w;
    }
  }
  m.jaw += extra.jaw || 0;
  m.smile += extra.smile || 0;
  return m;
}

// ---------------------------------------------------------------------------
// the head mesh
// ---------------------------------------------------------------------------
export function buildHead(skull, NA = 112) {
  const H = HEAD;
  const A = norm3(H.mouthDir);
  const ex = [1, 0, 0];
  const ey = cross3(A, ex);  // up-forward in the face
  const D = skull.raycast(A[0], A[1], A[2]);   // distance to the mouth surface along A
  const W0 = H.W0;

  // rows: K inner mouth rows (deepest first), lip line, gnomonic rows, polar rows, back pole
  const K = 9;
  const bs = [0];
  while (bs[bs.length - 1] < D * 0.98) { const b = bs[bs.length - 1]; bs.push(b + 0.00055 + 0.072 * b); }
  const alphas = [];
  let al = Math.atan(bs[bs.length - 1] / D);
  while (al < Math.PI - 0.02) {
    const deg = al * 180 / Math.PI;
    const step = deg < 88 ? 0.024 : 0.024 + (deg - 88) / 92 * 0.07;
    al += step;
    alphas.push(Math.min(al, Math.PI));
  }
  alphas[alphas.length - 1] = Math.PI;
  const NG = bs.length, NP = alphas.length;
  const nv = K + NG + NP;
  const cols = NA + 1;
  const nVerts = cols * nv;
  const rest = new Float32Array(nVerts * 3);
  const planar = new Float32Array(nVerts * 2);   // rest mouth-plane coords (gnomonic rows)
  const rowB = new Float32Array(nv);             // b of each gnomonic row (-1 elsewhere)
  rowB.fill(-1);
  const thetas = new Float32Array(NA + 1);
  for (let i = 0; i <= NA; i++) thetas[i] = (i % NA) / NA * TAU;

  const dirTo = (X, Y, out) => {
    const x = A[0] * D + X * ex[0] + Y * ey[0], y = A[1] * D + X * ex[1] + Y * ey[1], z = A[2] * D + X * ex[2] + Y * ey[2];
    const l = Math.hypot(x, y, z);
    out[0] = x / l; out[1] = y / l; out[2] = z / l;
    return out;
  };
  const d3 = [0, 0, 0];
  for (let g = 0; g < NG; g++) {
    const j = K + g, b = bs[g], a = Math.sqrt(b * b + W0 * W0);
    rowB[j] = b;
    for (let i = 0; i < NA; i++) {
      const th = thetas[i];
      const X = a * Math.cos(th), Y = b * Math.sin(th);
      const k = j * cols + i;
      planar[k * 2] = X; planar[k * 2 + 1] = Y;
      dirTo(X, Y, d3);
      const t = skull.raycast(d3[0], d3[1], d3[2]);
      rest[k * 3] = d3[0] * t; rest[k * 3 + 1] = d3[1] * t; rest[k * 3 + 2] = d3[2] * t;
    }
  }
  for (let q = 0; q < NP; q++) {
    const j = K + NG + q, a = alphas[q], ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < NA; i++) {
      const th = thetas[i], c = Math.cos(th), s = Math.sin(th);
      const dx = A[0] * ca + (c * ex[0] + s * ey[0]) * sa;
      const dy = A[1] * ca + (c * ex[1] + s * ey[1]) * sa;
      const dz = A[2] * ca + (c * ex[2] + s * ey[2]) * sa;
      const l = Math.hypot(dx, dy, dz);
      const t = skull.raycast(dx / l, dy / l, dz / l);
      const k = (j * cols + i) * 3;
      rest[k] = dx / l * t; rest[k + 1] = dy / l * t; rest[k + 2] = dz / l * t;
    }
  }

  // look-up table of the skull surface around the mouth (gnomonic plane)
  const LX0 = -0.046, LY0 = -0.046, LS = 0.00075, LNX = 124, LNY = 116;
  const lut = new Float32Array(LNX * LNY);
  for (let y = 0; y < LNY; y++) for (let x = 0; x < LNX; x++) {
    dirTo(LX0 + x * LS, LY0 + y * LS, d3);
    lut[y * LNX + x] = skull.raycast(d3[0], d3[1], d3[2]);
  }
  function surf(X, Y, out) {
    let fx = (X - LX0) / LS, fy = (Y - LY0) / LS;
    fx = Math.max(0, Math.min(LNX - 1.001, fx)); fy = Math.max(0, Math.min(LNY - 1.001, fy));
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const o = iy * LNX + ix;
    const t = (lut[o] * (1 - tx) + lut[o + 1] * tx) * (1 - ty) + (lut[o + LNX] * (1 - tx) + lut[o + LNX + 1] * tx) * ty;
    dirTo(X, Y, out);
    out[0] *= t; out[1] *= t; out[2] *= t;
    return out;
  }

  // per-vertex jaw weight and lip falloff (gnomonic rows only)
  const jawW = new Float32Array(nVerts);
  for (let g = 0; g < NG; g++) {
    const j = K + g;
    for (let i = 0; i < NA; i++) {
      const k = j * cols + i;
      const X = planar[k * 2], Y = planar[k * 2 + 1];
      const s = Math.sin(thetas[i]);
      const below = Math.pow(Math.max(0, -s), 0.6);
      const rho = Math.hypot(X, Y);
      const lat = 1 - smooth01(0.028, 0.058, Math.abs(X));
      const far = 1 - smooth01(0.07, 0.125, rho);
      jawW[k] = below * lat * far;
    }
  }
  // back of the jaw (below the ear line) moves a little too, via the rest positions
  for (let j = K + NG; j < nv; j++) for (let i = 0; i < NA; i++) jawW[j * cols + i] = 0;

  const lipRows = [];
  for (let g = 0; g < NG; g++) if (bs[g] <= 0.034) lipRows.push(K + g);

  // ambient occlusion baked from the skull + eyeballs
  const ao = new Float32Array(nVerts);
  {
    const tmpN = restNormals(rest, NA, cols, nv);
    for (let j = 0; j < nv; j++) for (let i = 0; i < NA; i++) {
      const k = j * cols + i;
      if (j < K) { ao[k] = 0.25; continue; }
      const px = rest[k * 3], py = rest[k * 3 + 1], pz = rest[k * 3 + 2];
      const nx = tmpN[k * 3], ny = tmpN[k * 3 + 1], nz = tmpN[k * 3 + 2];
      let occ = 0;
      for (const [h, w] of [[0.003, 0.35], [0.007, 0.3], [0.014, 0.22], [0.026, 0.13]]) {
        const d = skull.sdfWithEyes(px + nx * h, py + ny * h, pz + nz * h);
        occ += w * Math.max(0, (h - d) / h);
      }
      ao[k] = Math.max(0.15, 1 - occ * 1.25);
    }
    for (let j = 0; j < nv; j++) ao[j * cols + NA] = ao[j * cols];
  }

  return {
    NA, cols, nv, K, NG, NP, nVerts, rest, planar, rowB, thetas, jawW, lipRows, ao,
    A, ex, ey, D, W0, surf, bs,
    mouthCenter: [A[0] * D, A[1] * D, A[2] * D],
  };
}

function smooth01(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

function restNormals(P, NA, cols, nv) {
  const N = new Float32Array(P.length);
  const at = (i, j) => (j * cols + i) * 3;
  for (let j = 0; j < nv; j++) {
    const jp = Math.min(j + 1, nv - 1), jm = Math.max(j - 1, 0);
    for (let i = 0; i < NA; i++) {
      const a = at((i + 1) % NA, j), b = at((i - 1 + NA) % NA, j), c = at(i, jp), d = at(i, jm);
      const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2];
      const vx = P[c] - P[d], vy = P[c + 1] - P[d + 1], vz = P[c + 2] - P[d + 2];
      // flipped (dv x du) = outward for this parameterisation
      let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
      let l = Math.hypot(nx, ny, nz);
      const o = at(i, j);
      if (l < 1e-12) { nx = P[o]; ny = P[o + 1]; nz = P[o + 2]; l = Math.hypot(nx, ny, nz) || 1; }
      N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
    }
  }
  return N;
}

// ---------------------------------------------------------------------------
// per-frame deformation of the head (head space, written to `out`)
// ---------------------------------------------------------------------------
const tmpA = [0, 0, 0];
export function deformHead(hd, m, out) {
  const { NA, cols, nv, K, rest, planar, rowB, thetas, jawW, lipRows, A, W0, surf } = hd;
  out.set(rest);
  const kx = 1 + 0.26 * m.wide - 0.36 * m.round + 0.08 * m.smile;
  const lift = 0.0036 * m.lift + 0.0016 * m.round;
  // lip rows: re-project deformed mouth-plane coords onto the skull
  for (const j of lipRows) {
    const b = rowB[j];
    const fl = Math.exp(-((b / 0.0095) ** 2));           // lip region falloff
    const fw = Math.exp(-((b / 0.016) ** 2));            // width falloff (reaches the cheeks)
    const bulge = -0.0009 * Math.exp(-((b / 0.0009) ** 2)) + 0.0021 * Math.exp(-(((b - 0.0026) / 0.0019) ** 2)) - 0.00045 * Math.exp(-(((b - 0.0056) / 0.0011) ** 2));
    for (let i = 0; i < NA; i++) {
      const k = j * cols + i;
      let X = planar[k * 2], Y = planar[k * 2 + 1];
      const s = Math.sin(thetas[i]);
      const up = s > 1e-6, down = s < -1e-6;
      const xn = Math.max(-1, Math.min(1, X / (W0 * 1.05)));
      const shape = Math.pow(Math.max(0, 1 - xn * xn), 0.55 - 0.25 * m.round);
      X *= 1 + (kx - 1) * fw;
      // resting curve: corners tucked up very slightly, more when smiling
      Y += (0.0003 + 0.0028 * m.smile) * xn * xn * fw - 0.0006 * m.smile * fl;
      if (up) Y += lift * shape * fl;
      if (down) Y += (0.0032 * m.tuck + 0.0006 * m.press) * shape * fl;
      surf(X, Y, tmpA);
      // lips: upper a little fuller in the middle (cupid's bow), lower fuller overall
      const lipShape = up ? (1 - 0.3 * xn * xn) * (1 + 0.12 * Math.exp(-(((Math.abs(xn) - 0.3) / 0.18) ** 2))) : (1.15 - 0.45 * xn * xn);
      let dz = bulge * (1 - 0.55 * m.press) * lipShape * (1 + 0.5 * m.pout);
      dz += 0.0055 * m.pout * fl * (0.4 + 0.6 * shape);
      if (down) dz -= 0.0026 * m.tuck * fl * shape;
      if (up) dz += 0.0005 * m.tuck * fl * shape;
      dz -= 0.0006 * m.press * fl;
      // corner dimples (commissures)
      const cx = Math.abs(X) - W0 * kx;
      dz -= 0.0009 * Math.exp(-((cx / 0.0022) ** 2) - ((Y / 0.0028) ** 2)) * (1 - 0.6 * m.round);
      // philtrum: a soft groove with two ridges above the upper lip
      if (up && b > 0.0035) {
        const ph = Math.exp(-(((b - 0.0085) / 0.004) ** 2));
        dz += ph * (-0.0004 * Math.exp(-((X / 0.0026) ** 2)) + 0.00015 * Math.exp(-(((Math.abs(X) - 0.0036) / 0.0018) ** 2)));
      }
      const o = k * 3;
      out[o] = tmpA[0] + A[0] * dz; out[o + 1] = tmpA[1] + A[1] * dz; out[o + 2] = tmpA[2] + A[2] * dz;
    }
  }
  // jaw: rotate the lower face about a hinge behind the cheeks
  const ang = 0.135 * m.jaw + 0.012 * m.tongue;
  if (ang > 1e-5) {
    const py = -0.035, pz = -0.035;
    for (let j = K; j < K + hd.NG; j++) {
      for (let i = 0; i < NA; i++) {
        const k = j * cols + i, w = jawW[k];
        if (w <= 0) continue;
        const a = ang * w, c = Math.cos(a), sn = Math.sin(a);
        const o = k * 3, y = out[o + 1] - py, z = out[o + 2] - pz;
        out[o + 1] = py + y * c - z * sn;
        out[o + 2] = pz + y * sn + z * c;
      }
    }
  }
  // the mouth cavity, from the (deformed) lip line inward
  const j0 = K;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < NA; i++) { const o = (j0 * cols + i) * 3; cx += out[o]; cy += out[o + 1]; cz += out[o + 2]; }
  cx /= NA; cy /= NA; cz /= NA;
  const SC = [0.97, 1.08, 1.2, 1.28, 1.26, 1.12, 0.85, 0.45, 0.0];
  const DP = [0.0011, 0.0028, 0.005, 0.0078, 0.011, 0.0142, 0.0172, 0.0195, 0.021];
  const EX = [0.0003, 0.0012, 0.0026, 0.0038, 0.0044, 0.0042, 0.0032, 0.0016, 0];
  // the axis tilts down with the jaw
  const ca = Math.cos(ang * 0.5), sa = Math.sin(ang * 0.5);
  const ax = A[0], ay = A[1] * ca - A[2] * sa, az = A[1] * sa + A[2] * ca;
  for (let r = 0; r < K; r++) {
    const j = K - 1 - r;           // row just inside the lip first
    const sc = SC[r], dp = DP[r], exr = EX[r];
    for (let i = 0; i < NA; i++) {
      const o0 = (j0 * cols + i) * 3, o = (j * cols + i) * 3;
      const s = Math.sin(thetas[i]);
      const lx = out[o0] - cx, ly = out[o0 + 1] - cy, lz = out[o0 + 2] - cz;
      out[o] = cx + lx * sc - ax * dp;
      out[o + 1] = cy + ly * sc - ay * dp + s * exr * 0.9;
      out[o + 2] = cz + lz * sc - az * dp + s * exr * 0.35;
    }
  }
  for (let j = 0; j < nv; j++) { const a = j * cols * 3, b = (j * cols + NA) * 3; out[b] = out[a]; out[b + 1] = out[a + 1]; out[b + 2] = out[a + 2]; }
  return out;
}
