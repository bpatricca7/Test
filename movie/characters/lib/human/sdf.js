// Signed-distance-field toolkit for sculpting the characters procedurally.
// Every SDF is a plain function (x, y, z) => distance (negative inside).
// Allocation-free so a few million evaluations stay fast in JS.

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// ---- primitives -----------------------------------------------------------

export function sphere(cx, cy, cz, r) {
  return (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
}

// ellipsoid (IQ's bound); good enough for smooth unions and projection
export function ellipsoid(cx, cy, cz, rx, ry, rz) {
  return (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const qx = px / rx, qy = py / ry, qz = pz / rz;
    const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
  };
}

// rotated ellipsoid: axes given by yaw (about y) and pitch (about x) and roll (about z)
export function ellipsoidR(cx, cy, cz, rx, ry, rz, yaw = 0, pitch = 0, roll = 0) {
  const e = ellipsoid(0, 0, 0, rx, ry, rz);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  return (x, y, z) => {
    let px = x - cx, py = y - cy, pz = z - cz;
    // inverse yaw
    let tx = cyw * px - syw * pz, tz = syw * px + cyw * pz; px = tx; pz = tz;
    // inverse pitch
    let ty = cp * py + sp * pz; tz = -sp * py + cp * pz; py = ty; pz = tz;
    // inverse roll
    tx = cr * px + sr * py; ty = -sr * px + cr * py; px = tx; py = ty;
    return e(px, py, pz);
  };
}

// capsule / round cone between two points with radii ra, rb (IQ's round cone)
export function roundCone(ax, ay, az, bx, by, bz, ra, rb) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - ax, pay = y - ay, paz = z - az;
    const yv = pax * bax + pay * bay + paz * baz;
    const zv = yv - l2;
    const cx = pax * l2 - bax * yv, cy = pay * l2 - bay * yv, cz = paz * l2 - baz * yv;
    const x2 = cx * cx + cy * cy + cz * cz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
  };
}

export function capsule(ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  return (x, y, z) => {
    const pax = x - ax, pay = y - ay, paz = z - az;
    const h = clamp((pax * bax + pay * bay + paz * baz) / l2);
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
  };
}

// torus in the plane perpendicular to y (after optional rotation by pitch about x)
export function torus(cx, cy, cz, R, r, pitch = 0) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return (x, y, z) => {
    const px = x - cx; let py = y - cy, pz = z - cz;
    const ty = cp * py + sp * pz, tz = -sp * py + cp * pz;
    const q = Math.hypot(px, tz) - R;
    return Math.hypot(q, ty) - r;
  };
}

// polyline capsule chain with per-point radii (smoothly unioned)
export function chain(pts, radii, k = 0.004) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    segs.push(roundCone(a[0], a[1], a[2], b[0], b[1], b[2], radii[i], radii[i + 1]));
  }
  return unionS(segs, k);
}

// ---- operators ------------------------------------------------------------

export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

export function unionS(list, k) {
  return (x, y, z) => {
    let d = list[0](x, y, z);
    for (let i = 1; i < list.length; i++) d = smin(d, list[i](x, y, z), k);
    return d;
  };
}

// ---- queries --------------------------------------------------------------

const EPS = 0.00025;
export function gradient(f, x, y, z, out, e = EPS) {
  const dx = f(x + e, y, z) - f(x - e, y, z);
  const dy = f(x, y + e, z) - f(x, y - e, z);
  const dz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(dx, dy, dz) || 1;
  out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
  return out;
}

/** march from an inside point along a direction to where the field first turns positive */
export function rayExit(f, ox, oy, oz, dx, dy, dz, maxT = 0.5, minStep = 0.0004) {
  let t = 0, prevT = 0;
  let d = f(ox, oy, oz);
  if (d > 0) return 0;
  while (t < maxT) {
    const step = Math.max(-d * 0.7, minStep);
    prevT = t;
    t += step;
    d = f(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d > 0) {
      let a = prevT, b = t;
      for (let i = 0; i < 16; i++) {
        const m = (a + b) * 0.5;
        if (f(ox + dx * m, oy + dy * m, oz + dz * m) > 0) b = m; else a = m;
      }
      return (a + b) * 0.5;
    }
  }
  return maxT;
}

/** march from an outside point along a direction to where the field first turns negative */
export function rayEnter(f, ox, oy, oz, dx, dy, dz, maxT = 0.5, minStep = 0.0003) {
  let t = 0, prevT = 0;
  let d = f(ox, oy, oz);
  if (d < 0) return 0;
  while (t < maxT) {
    const step = Math.max(d * 0.8, minStep);
    prevT = t;
    t += step;
    d = f(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d < 0) {
      let a = prevT, b = t;
      for (let i = 0; i < 16; i++) {
        const m = (a + b) * 0.5;
        if (f(ox + dx * m, oy + dy * m, oz + dz * m) < 0) b = m; else a = m;
      }
      return (a + b) * 0.5;
    }
  }
  return -1;
}

/** project a point onto the zero set by Newton steps along the gradient */
export function project(f, p, iters = 6) {
  const g = [0, 0, 0];
  for (let i = 0; i < iters; i++) {
    const d = f(p[0], p[1], p[2]);
    if (Math.abs(d) < 1e-6) break;
    gradient(f, p[0], p[1], p[2], g);
    p[0] -= g[0] * d; p[1] -= g[1] * d; p[2] -= g[2] * d;
  }
  return p;
}

// ---- surface nets polygonizer ---------------------------------------------
// Returns indexed quads split into triangles; vertices sit inside each sign-change
// cell (mass point of edge crossings) and are then snapped onto the surface.
export function surfaceNets(f, min, max, res, { snap = 2 } = {}) {
  const nx = res[0], ny = res[1], nz = res[2];
  const sx = (max[0] - min[0]) / (nx - 1), sy = (max[1] - min[1]) / (ny - 1), sz = (max[2] - min[2]) / (nz - 1);
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * sz;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * sy;
      for (let i = 0; i < nx; i++) field[i + nx * (j + ny * k)] = f(min[0] + i * sx, y, z);
    }
  }
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const vmap = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const o = corners[c];
      v[c] = field[idx(i + o[0], j + o[1], k + o[2])];
      if (v[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of edges) {
      const va = v[a], vb = v[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const A = corners[a], B = corners[b];
      ax += A[0] + (B[0] - A[0]) * t; ay += A[1] + (B[1] - A[1]) * t; az += A[2] + (B[2] - A[2]) * t;
      n++;
    }
    vmap[cidx(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + ax / n) * sx, min[1] + (j + ay / n) * sy, min[2] + (k + az / n) * sz);
  }
  const ind = [];
  // faces for each grid edge with a sign change
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = field[idx(i, j, k)], b = field[idx(i + 1, j, k)];
    if ((a < 0) === (b < 0)) continue;
    const q = [cidx(i, j - 1, k - 1), cidx(i, j, k - 1), cidx(i, j, k), cidx(i, j - 1, k)].map(c => vmap[c]);
    pushQuad(ind, q, a < 0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = field[idx(i, j, k)], b = field[idx(i, j + 1, k)];
    if ((a < 0) === (b < 0)) continue;
    const q = [cidx(i - 1, j, k - 1), cidx(i - 1, j, k), cidx(i, j, k), cidx(i, j, k - 1)].map(c => vmap[c]);
    pushQuad(ind, q, a < 0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = field[idx(i, j, k)], b = field[idx(i, j, k + 1)];
    if ((a < 0) === (b < 0)) continue;
    const q = [cidx(i - 1, j - 1, k), cidx(i, j - 1, k), cidx(i, j, k), cidx(i - 1, j, k)].map(c => vmap[c]);
    pushQuad(ind, q, a < 0);
  }
  const P = new Float32Array(pos);
  if (snap) {
    const p = [0, 0, 0];
    for (let i = 0; i < P.length; i += 3) {
      p[0] = P[i]; p[1] = P[i + 1]; p[2] = P[i + 2];
      project(f, p, snap);
      P[i] = p[0]; P[i + 1] = p[1]; P[i + 2] = p[2];
    }
  }
  return { positions: P, indices: ind };
}

function pushQuad(ind, q, flip) {
  if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[3] < 0) return;
  if (flip) ind.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  else ind.push(q[0], q[2], q[1], q[0], q[3], q[2]);
}

/** a cheap ambient-occlusion estimate from the field: how much the surface is enclosed */
export function fieldAO(f, x, y, z, nx, ny, nz, dist = 0.01, steps = 4) {
  let occ = 0, w = 1, tot = 0;
  for (let i = 1; i <= steps; i++) {
    const h = dist * i / steps;
    const d = f(x + nx * h, y + ny * h, z + nz * h);
    occ += w * Math.max(0, h - d);
    tot += w * h;
    w *= 0.6;
  }
  return clamp(1 - occ / tot);
}
