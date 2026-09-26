// Terrain chunk generation: pure computation shared by the Web Workers and the main-thread fallback.
//
// A chunk is a (N x N)-vertex patch of one cube face at quadtree `level`, plus a skirt (one extra ring
// of vertices pulled down, and slightly outward under the neighbour) that hides cracks and T-junction
// pinholes between neighbours of different levels, from any viewing angle.
//
// Per vertex:
//   position  float32 xyz relative to the chunk centre (float32-safe; placed with the floating origin)
//   morph     float32 xyz: (parent-resolution position) - position, for geomorphing (no popping)
//   normal    int16 xyz (normalised) from the grid (central differences, MCI)
//   aux       float32: albedo, sun-horizon delta (rad), mare fraction, freshness
//
// SUN VISIBILITY: for every vertex we march along the direction of the Sun over the terrain and record
// the horizon elevation in that azimuth minus the Sun's elevation, clamped to +-0.08 rad. The fragment
// shader turns the interpolated value into a crisp, sub-vertex shadow edge (interpolating the horizon
// angle instead of a 0/1 visibility gives sharp shadows even at coarse LODs). Three tiers of samples:
//   near  — the chunk's own height grid, extended FINE_EXT cells toward the Sun so that neighbouring
//           chunks see casters near their shared edge identically (seamless shadows across chunks)
//   mid   — up to 3 chunk sizes toward the Sun: a coarser grid on a global per-level lattice
//   far   — beyond: 3x3 shared rays per chunk evaluated with terrainHeightLOD (features ~ s/6)
// Boulders are NOT in these grids: their long low-Sun shadows come from the rock shadow maps (rockShadow.js).

import { MOON } from '../../core/constants.js';
import { evalSurface, createSample, enumerateBoulders, SURFACE_FLAGS } from '../../world/moon.js';
import { FACES, faceDir, dirToFaceST, dirFace } from './cubeSphere.js';

const R = MOON.radius;
const HALF_PI_R = (Math.PI / 2) * R;
/** Clamp (rad) of the per-vertex horizon-minus-Sun-elevation value (only its zero crossing matters). */
export const SHADOW_CLAMP = 0.08;
const RELIEF_BOUND = 6500; // m: bound on terrain rising above a point (limits the shadow march)
const MID_RES = 12; // mid-grid cells per chunk width
const MID_REACH = 3; // chunk sizes covered by the near+mid tiers
const FINE_EXT = 8; // extra fine-grid cells toward the Sun
/** Quadtree levels whose chunks own the boulders of boulder-octave 0, 1, 2 (large, medium, small). */
export const BOULDER_LEVELS = [13, 14, 15];

const _o = createSample();
const _st = [0, 0];
const _d = [0, 0, 0];

/** Edge length (m) of a chunk at `level`. */
export const chunkSizeM = (level) => HALF_PI_R / (1 << level);

// A regular (s,t) grid of heights over a face-coordinate rectangle.
function makeGrid(f, sA, tA, dsd, ns, nt) {
  return { f, sA, tA, inv: 1 / dsd, ns, nt, h: new Float64Array(ns * nt) };
}
function gridSample(g, s, t) {
  const fx = (s - g.sA) * g.inv;
  const fy = (t - g.tA) * g.inv;
  if (fx < 0 || fy < 0 || fx > g.ns - 1 || fy > g.nt - 1) return NaN;
  let ix = Math.floor(fx);
  let iy = Math.floor(fy);
  if (ix > g.ns - 2) ix = g.ns - 2;
  if (iy > g.nt - 2) iy = g.nt - 2;
  const ax = fx - ix;
  const ay = fy - iy;
  const k = iy * g.ns + ix;
  const h = g.h;
  return (h[k] * (1 - ax) + h[k + 1] * ax) * (1 - ay) + (h[k + g.ns] * (1 - ax) + h[k + g.ns + 1] * ax) * ay;
}

/**
 * Generate one chunk (run to completion — used by the workers).
 * @param {{key:string, f:number, level:number, i:number, j:number, N:number, sun:number[], boulders:boolean}} req
 * @returns {object} typed arrays + metadata (all transferable)
 */
export function generateChunk(req) {
  const it = chunkJob(req);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * Resumable chunk generation: a generator that yields after every row of work, so the main-thread
 * fallback can time-slice it (`it.next()` until the budget is spent). Returns the result.
 */
export function* chunkJob(req) {
  const { f, level, i, j, N } = req;
  const sun = req.sun;
  const seg = N - 1;
  const cw = 2 / (1 << level);
  const s0 = -1 + i * cw;
  const t0 = -1 + j * cw;
  const size = chunkSizeM(level);
  const sp = size / seg; // vertex spacing (m)
  // features below ~3 vertex spacings are left to the shader; the finest level keeps every crater so the
  // mesh under the footpads matches what physics collides with (boulders are separate instanced rocks)
  const lod = level >= (req.maxLevel ?? 99) ? Math.min(3 * sp, 1.5) : 3 * sp;
  // (boulders are not part of the mesh, and their cast shadows come from the rock shadow maps, which
  // are crisp: the per-vertex horizon only sees the terrain itself)
  const flags = SURFACE_FLAGS.ALBEDO;
  const gd = cw / seg;
  // Fine grid = the vertices plus a 1-cell border (normals) plus FINE_EXT cells on the sides facing the
  // Sun, so that shadow casters just across a chunk edge are seen at the same resolution by both
  // neighbouring chunks (otherwise shadow boundaries would break along chunk edges).
  faceDir(f, s0 + cw / 2, t0 + cw / 2, _d);
  let sunS = 0;
  let sunT = 0;
  {
    const sd = sun[0] * _d[0] + sun[1] * _d[1] + sun[2] * _d[2];
    let tx = sun[0] - sd * _d[0];
    let ty = sun[1] - sd * _d[1];
    let tz = sun[2] - sd * _d[2];
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 1e-6 && sd > -0.2) {
      const e = Math.min(cw * 0.25, 0.01);
      tx = _d[0] + (tx / tl) * e;
      ty = _d[1] + (ty / tl) * e;
      tz = _d[2] + (tz / tl) * e;
      if (dirToFaceST(f, tx, ty, tz, _st)) {
        sunS = _st[0] - (s0 + cw / 2);
        sunT = _st[1] - (t0 + cw / 2);
        const m = Math.max(Math.abs(sunS), Math.abs(sunT)) || 1;
        sunS /= m;
        sunT /= m;
      }
    }
  }
  const extS = Math.max(0, Math.ceil(FINE_EXT * Math.abs(sunS) - 0.25));
  const extT = Math.max(0, Math.ceil(FINE_EXT * Math.abs(sunT) - 0.25));
  const bs = 1 + (sunS < 0 ? extS : 0); // border cells before the first vertex (s)
  const bt = 1 + (sunT < 0 ? extT : 0);
  const Gs = N + 2 + extS;
  const Gt = N + 2 + extT;
  const GG = Gs * Gt;
  const gk = (vi, vj) => (vj + bt) * Gs + (vi + bs);

  // ---- fine grid: directions, heights (mesh = no boulders; shadow grid = with boulders)
  const dirs = new Float64Array(GG * 3);
  const hMesh = new Float64Array(GG);
  const fine = makeGrid(f, s0 - bs * gd, t0 - bt * gd, gd, Gs, Gt);
  const alb = new Float32Array(N * N);
  const mare = new Float32Array(N * N);
  const frs = new Float32Array(N * N);
  let hmin = Infinity;
  let hmax = -Infinity;
  let hsum = 0;
  for (let gj = 0; gj < Gt; gj++) {
    for (let gi = 0; gi < Gs; gi++) {
      const k = gj * Gs + gi;
      faceDir(f, s0 + (gi - bs) * gd, t0 + (gj - bt) * gd, dirs, k * 3);
      const vi = gi - bs;
      const vj = gj - bt;
      const interior = vi >= 0 && vi < N && vj >= 0 && vj < N;
      evalSurface(dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2], lod, interior ? flags : flags & ~SURFACE_FLAGS.ALBEDO, _o);
      hMesh[k] = _o.hNoBoulder;
      fine.h[k] = _o.h;
      if (interior) {
        const v = vj * N + vi;
        alb[v] = _o.albedo;
        mare[v] = _o.mare;
        frs[v] = _o.fresh;
        if (_o.hNoBoulder < hmin) hmin = _o.hNoBoulder;
        if (_o.h > hmax) hmax = _o.h;
        hsum += _o.hNoBoulder;
      }
    }
    yield;
  }
  const havg = hsum / (N * N);
  // chunk centre (double precision; vertices are stored relative to it)
  faceDir(f, s0 + cw / 2, t0 + cw / 2, _d);
  const cr = R + havg;
  const cx = _d[0] * cr;
  const cy = _d[1] * cr;
  const cz = _d[2] * cr;

  const nV = N * N + 4 * N;
  const pos = new Float32Array(nV * 3);
  const morph = new Float32Array(nV * 3);
  const nrm = new Int16Array(nV * 3);
  const aux = new Float32Array(nV * 4);
  // absolute (double) positions of the grid, relative to the centre
  const P = new Float64Array(GG * 3);
  for (let k = 0; k < GG; k++) {
    const r = R + hMesh[k];
    P[k * 3] = dirs[k * 3] * r - cx;
    P[k * 3 + 1] = dirs[k * 3 + 1] * r - cy;
    P[k * 3 + 2] = dirs[k * 3 + 2] * r - cz;
  }
  let rad2 = 0;
  for (let vj = 0; vj < N; vj++) {
    for (let vi = 0; vi < N; vi++) {
      const v = vj * N + vi;
      const k = gk(vi, vj);
      pos[v * 3] = P[k * 3];
      pos[v * 3 + 1] = P[k * 3 + 1];
      pos[v * 3 + 2] = P[k * 3 + 2];
      const r2 = P[k * 3] ** 2 + P[k * 3 + 1] ** 2 + P[k * 3 + 2] ** 2;
      if (r2 > rad2) rad2 = r2;
      // normal: cross of central differences (U x V points outward)
      const kl = k - 1;
      const kr = k + 1;
      const kd = k - Gs;
      const ku = k + Gs;
      const ax = P[kr * 3] - P[kl * 3];
      const ay = P[kr * 3 + 1] - P[kl * 3 + 1];
      const az = P[kr * 3 + 2] - P[kl * 3 + 2];
      const bx = P[ku * 3] - P[kd * 3];
      const by = P[ku * 3 + 1] - P[kd * 3 + 1];
      const bz = P[ku * 3 + 2] - P[kd * 3 + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const nl = 32767 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nx *= nl;
      ny *= nl;
      nz *= nl;
      nrm[v * 3] = nx;
      nrm[v * 3 + 1] = ny;
      nrm[v * 3 + 2] = nz;
      aux[v * 4] = alb[v];
      aux[v * 4 + 2] = mare[v];
      aux[v * 4 + 3] = frs[v];
    }
  }

  // ---- geomorph targets: the parent's surface (features >= 2x lod) at the same vertices
  if (level > 0) {
    const cpos = new Float64Array(N * N * 3);
    const plod = 2 * lod;
    for (let vj = 0; vj < N; vj += 2) {
      for (let vi = 0; vi < N; vi += 2) {
        const k = gk(vi, vj);
        const x = dirs[k * 3];
        const y = dirs[k * 3 + 1];
        const z = dirs[k * 3 + 2];
        evalSurface(x, y, z, plod, 0, _o);
        const r = R + _o.h;
        const v = vj * N + vi;
        cpos[v * 3] = x * r - cx;
        cpos[v * 3 + 1] = y * r - cy;
        cpos[v * 3 + 2] = z * r - cz;
      }
      yield;
    }
    // odd vertices lie on the parent's triangle edges / diagonals: average the two parent vertices
    for (let vj = 0; vj < N; vj++) {
      for (let vi = 0; vi < N; vi++) {
        const oi = vi & 1;
        const oj = vj & 1;
        if (!oi && !oj) continue;
        const v = vj * N + vi;
        // (odd, even): along s; (even, odd): along t; (odd, odd): diagonal (vi-1,vj-1)-(vi+1,vj+1)
        const a = (vj - oj) * N + (vi - oi);
        const b = (vj + oj) * N + (vi + oi);
        cpos[v * 3] = 0.5 * (cpos[a * 3] + cpos[b * 3]);
        cpos[v * 3 + 1] = 0.5 * (cpos[a * 3 + 1] + cpos[b * 3 + 1]);
        cpos[v * 3 + 2] = 0.5 * (cpos[a * 3 + 2] + cpos[b * 3 + 2]);
      }
    }
    for (let v = 0; v < N * N; v++) {
      morph[v * 3] = cpos[v * 3] - pos[v * 3];
      morph[v * 3 + 1] = cpos[v * 3 + 1] - pos[v * 3 + 1];
      morph[v * 3 + 2] = cpos[v * 3 + 2] - pos[v * 3 + 2];
    }
  }

  // ---- sun horizon
  const { out: horizon, march } = yield* computeHorizon({ f, level, s0, t0, cw, size, sp, N, gk, dirs, fine, sun, hmin });
  for (let v = 0; v < N * N; v++) aux[v * 4 + 1] = horizon[v];

  // ---- skirts: edge vertices pulled down AND slightly outward (under the neighbour). The outward flare
  // closes the pixel-sized T-junction "sparkles" between chunks of different levels even when the
  // surface is seen from straight above, where vertical skirts are edge-on and cover nothing.
  const skirt = Math.min(size * 0.25, sp * 4 + 3 + size * 0.01);
  const flare = 0.75 * sp;
  let w = N * N;
  const edges = [];
  for (let q = 0; q < N; q++) edges.push([q, 0, 0, -1]); // bottom row (vj = 0): outward = -t
  for (let q = 0; q < N; q++) edges.push([N - 1, q, 1, 0]); // right column: outward = +s
  for (let q = 0; q < N; q++) edges.push([N - 1 - q, N - 1, 0, 1]); // top row (reversed): outward = +t
  for (let q = 0; q < N; q++) edges.push([0, N - 1 - q, -1, 0]); // left column (reversed): outward = -s
  for (const [vi, vj, os, ot] of edges) {
    const v = vj * N + vi;
    const k = gk(vi, vj);
    // outward tangent from the grid (central differences along s or t)
    const k1 = os !== 0 ? gk(vi + os, vj) : gk(vi, vj + ot);
    const k0 = os !== 0 ? gk(vi - os, vj) : gk(vi, vj - ot);
    let ox = P[k1 * 3] - P[k0 * 3];
    let oy = P[k1 * 3 + 1] - P[k0 * 3 + 1];
    let oz = P[k1 * 3 + 2] - P[k0 * 3 + 2];
    const ux = dirs[k * 3];
    const uy = dirs[k * 3 + 1];
    const uz = dirs[k * 3 + 2];
    const od = ox * ux + oy * uy + oz * uz; // keep it tangential
    ox -= od * ux;
    oy -= od * uy;
    oz -= od * uz;
    const ol = Math.hypot(ox, oy, oz) || 1;
    pos[w * 3] = pos[v * 3] - ux * skirt + (ox / ol) * flare;
    pos[w * 3 + 1] = pos[v * 3 + 1] - uy * skirt + (oy / ol) * flare;
    pos[w * 3 + 2] = pos[v * 3 + 2] - uz * skirt + (oz / ol) * flare;
    morph[w * 3] = morph[v * 3];
    morph[w * 3 + 1] = morph[v * 3 + 1];
    morph[w * 3 + 2] = morph[v * 3 + 2];
    for (let c = 0; c < 3; c++) nrm[w * 3 + c] = nrm[v * 3 + c];
    for (let c = 0; c < 4; c++) aux[w * 4 + c] = aux[v * 4 + c];
    w++;
  }

  // ---- boulders owned by this chunk (collidable rocks rendered as instances)
  let boulders = null;
  if (req.boulders) {
    const oi = BOULDER_LEVELS.indexOf(level);
    if (oi >= 0) boulders = collectBoulders(oi, f, s0, t0, cw, size, cx, cy, cz, march);
  }

  return {
    key: req.key,
    center: [cx, cy, cz],
    radius: Math.sqrt(rad2) + skirt + flare,
    hmin,
    hmax,
    size,
    pos,
    morph,
    nrm,
    aux,
    boulders,
  };
}

// Sun-horizon deltas for the N x N interior vertices (generator: yields per row).
function* computeHorizon(c) {
  const { f, level, s0, t0, cw, size, sp, N, gk, dirs, fine, sun, hmin } = c;
  const out = new Float32Array(N * N);
  const sx = sun[0];
  const sy = sun[1];
  const sz = sun[2];
  // chunk centre & tangential sun direction there
  faceDir(f, s0 + cw / 2, t0 + cw / 2, _d);
  const ux = _d[0];
  const uy = _d[1];
  const uz = _d[2];
  const sdc = sx * ux + sy * uy + sz * uz;
  const sunElC = Math.asin(Math.max(-1, Math.min(1, sdc)));
  const sunElMin = sunElC - (size / R) * 1.5;
  if (sunElMin > 1.35 || sunElC + (size / R) * 1.5 < -SHADOW_CLAMP) {
    // Sun near the zenith (no shadows) or the whole chunk is in the lunar night
    const cst = sunElC > 0 ? -SHADOW_CLAMP : SHADOW_CLAMP;
    out.fill(cst);
    return { out, march: () => cst };
  }
  const smaxGlobal = Math.min(160000, RELIEF_BOUND / Math.tan(Math.max(sunElMin - SHADOW_CLAMP, 0.006)));
  const reach = MID_REACH * size; // near + mid tiers
  // tangential direction at the centre
  let tx = sx - sdc * ux;
  let ty = sy - sdc * uy;
  let tz = sz - sdc * uz;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;

  // ---- mid grid (levels >= 4): swath from the chunk toward the Sun, at MID_RES cells per chunk
  let mid = null;
  if (level >= 4) {
    const th = Math.min(reach, 0.5 * smaxGlobal) / R;
    const ex = ux * Math.cos(th) + tx * Math.sin(th);
    const ey = uy * Math.cos(th) + ty * Math.sin(th);
    const ez = uz * Math.cos(th) + tz * Math.sin(th);
    if (dirToFaceST(f, ex, ey, ez, _st)) {
      const ds = _st[0] - (s0 + cw / 2);
      const dt = _st[1] - (t0 + cw / 2);
      const md = cw / MID_RES;
      // snapped to a global per-level lattice: neighbouring chunks sample identical mid-grid points
      const sA = Math.floor((s0 + Math.min(0, ds) - 2 * md + 1) / md) * md - 1;
      const sB = s0 + cw + Math.max(0, ds) + 2 * md;
      const tA = Math.floor((t0 + Math.min(0, dt) - 2 * md + 1) / md) * md - 1;
      const tB = t0 + cw + Math.max(0, dt) + 2 * md;
      if (sA > -1.7 && sB < 1.7 && tA > -1.7 && tB < 1.7) {
        const ns = Math.ceil((sB - sA) / md) + 1;
        const nt = Math.ceil((tB - tA) / md) + 1;
        mid = makeGrid(f, sA, tA, md, ns, nt);
        const mlod = 3 * (size / MID_RES);
        const mflags = 0;
        for (let b = 0; b < nt; b++) {
          for (let a = 0; a < ns; a++) {
            faceDir(f, sA + a * md, tA + b * md, _d);
            mid.h[b * ns + a] = evalSurface(_d[0], _d[1], _d[2], mlod, mflags, _o).h;
          }
          yield;
        }
      }
    }
  }

  // ---- far tier: 3x3 shared rays beyond `reach`
  const RAYS = 3;
  const farS = [];
  let s = reach;
  while (s < smaxGlobal) {
    farS.push(s);
    s *= 1.28;
  }
  const nFar = farS.length;
  const farH = new Float64Array(RAYS * RAYS * nFar);
  const farBase = new Float64Array(RAYS * RAYS * 3); // ray origin dirs
  const farT = new Float64Array(RAYS * RAYS * 3); // tangential sun dirs at the ray origins
  for (let rj = 0; rj < RAYS; rj++) {
    for (let ri = 0; ri < RAYS; ri++) {
      const r = rj * RAYS + ri;
      faceDir(f, s0 + ((ri + 0.5) / RAYS) * cw, t0 + ((rj + 0.5) / RAYS) * cw, _d);
      const bx = _d[0];
      const by = _d[1];
      const bz = _d[2];
      const sd = sx * bx + sy * by + sz * bz;
      let ax = sx - sd * bx;
      let ay = sy - sd * by;
      let az = sz - sd * bz;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al;
      ay /= al;
      az /= al;
      farBase.set([bx, by, bz], r * 3);
      farT.set([ax, ay, az], r * 3);
      // early out: once the ray is above any possible terrain for this chunk's lowest point
      for (let k = 0; k < nFar; k++) {
        const th = farS[k] / R;
        const c1 = Math.cos(th);
        const s1 = Math.sin(th);
        const px = bx * c1 + ax * s1;
        const py = by * c1 + ay * s1;
        const pz = bz * c1 + az * s1;
        farH[r * nFar + k] = evalSurface(px, py, pz, farS[k] / 6, 0, _o).h;
      }
      yield;
    }
  }

  // ---- march from one point toward the Sun: horizon elevation minus Sun elevation (clamped)
  const r1 = 1.3;
  const sStart = Math.max(0.3, 0.6 * sp);
  const direct = level < 4;
  // (x,y,z): unit direction, h0: height of the point, fu/fv: its fractional position in the chunk
  function march(x, y, z, h0, fu, fv) {
    const sd = sx * x + sy * y + sz * z;
    const sunEl = Math.asin(sd > 1 ? 1 : sd < -1 ? -1 : sd);
    if (sunEl < -SHADOW_CLAMP) return SHADOW_CLAMP;
    let ax = sx - sd * x;
    let ay = sy - sd * y;
    let az = sz - sd * z;
    const al = Math.hypot(ax, ay, az);
    if (al < 1e-6) return -SHADOW_CLAMP;
    ax /= al;
    ay /= al;
    az /= al;
    const target = Math.tan(sunEl + SHADOW_CLAMP); // horizon above this -> fully shadowed, stop
    const r0 = R + h0;
    let best = -1e9; // max tan(elevation) of the horizon
    const smax = Math.min(smaxGlobal, RELIEF_BOUND / Math.tan(Math.max(sunEl - SHADOW_CLAMP, 0.006)));
    // near + mid tiers
    for (let sm = sStart; sm < reach && sm < smax; sm *= r1) {
      const th = sm / R;
      const c1 = Math.cos(th);
      const s1 = Math.sin(th);
      const px = x * c1 + ax * s1;
      const py = y * c1 + ay * s1;
      const pz = z * c1 + az * s1;
      let H = NaN;
      if (dirToFaceST(f, px, py, pz, _st)) {
        H = gridSample(fine, _st[0], _st[1]);
        if (H !== H && mid) H = gridSample(mid, _st[0], _st[1]);
      }
      if (H !== H) {
        if (!direct && !mid) break;
        H = evalSurface(px, py, pz, Math.max(sm / 6, 3 * sp), 0, _o).h;
      }
      const rr = R + H;
      const tn = (rr * c1 - r0) / (rr * s1);
      if (tn > best) {
        best = tn;
        if (best > target) break;
      }
    }
    // far tier (shared rays), offset by this point's position along the sun direction
    if (best <= target && nFar > 0) {
      const ri = Math.max(0, Math.min(RAYS - 1, Math.floor(fu * RAYS)));
      const rj = Math.max(0, Math.min(RAYS - 1, Math.floor(fv * RAYS)));
      const r = rj * RAYS + ri;
      const bx = farBase[r * 3];
      const by = farBase[r * 3 + 1];
      const bz = farBase[r * 3 + 2];
      const off = ((x - bx) * farT[r * 3] + (y - by) * farT[r * 3 + 1] + (z - bz) * farT[r * 3 + 2]) * R;
      for (let q = 0; q < nFar; q++) {
        const sm = farS[q] - off;
        if (sm > smax) break;
        if (sm <= 0) continue;
        const th = sm / R;
        const rr = R + farH[r * nFar + q];
        const tn = (rr * Math.cos(th) - r0) / (rr * Math.sin(th));
        if (tn > best) {
          best = tn;
          if (best > target) break;
        }
      }
    }
    let d = Math.atan(best) - sunEl;
    if (d > SHADOW_CLAMP) d = SHADOW_CLAMP;
    if (d < -SHADOW_CLAMP) d = -SHADOW_CLAMP;
    return d;
  }

  // ---- per-vertex
  for (let vj = 0; vj < N; vj++) {
    for (let vi = 0; vi < N; vi++) {
      const k = gk(vi, vj);
      out[vj * N + vi] = march(dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2], fine.h[k], vi / N, vj / N);
    }
    yield;
  }
  return { out, march };
}

// Boulders whose centres fall inside this chunk. Packed float32, stride BOULDER_STRIDE:
// [x, y, z (base centre rel. chunk centre), r, H, variant, cos psi, sin psi, sun delta, tint 0..1,
//  ground slope east, ground slope north (m/m, over the rock's footprint), ground albedo, curvature 1/m]
export const BOULDER_STRIDE = 14;
function collectBoulders(oi, f, s0, t0, cw, size, cx, cy, cz, march) {
  const cell = [12, 5, 2.2][oi];
  const n = Math.ceil(size / (cell * 0.45)) + 2;
  const samples = new Float64Array(n * n * 3);
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) faceDir(f, s0 + ((a - 0.5) / (n - 2)) * cw, t0 + ((b - 0.5) / (n - 2)) * cw, samples, (b * n + a) * 3);
  }
  const list = [];
  const inside = (x, y, z) => {
    if (dirFace(x, y, z) !== f) return false;
    if (!dirToFaceST(f, x, y, z, _st)) return false;
    return _st[0] >= s0 && _st[0] < s0 + cw && _st[1] >= t0 && _st[1] < t0 + cw;
  };
  enumerateBoulders(oi, samples, inside, (b) => {
    // base height: full-detail surface without boulders at the centre (+ the soil albedo there)
    evalSurface(b.x, b.y, b.z, 0, SURFACE_FLAGS.ALBEDO, _o);
    const h0 = _o.h;
    const alb = _o.albedo;
    const r = R + h0;
    // ground slope across the rock's footprint (the renderer drapes the mesh like the collision profile)
    const bx = b.x;
    const by = b.y;
    const bz = b.z;
    const ex = b.ex;
    const ey = b.ey;
    const ez = b.ez;
    const nx = b.nx;
    const ny = b.ny;
    const nz = b.nz;
    let ge = 0;
    let gn = 0;
    let curv = 0;
    if (b.r > 0.12) {
      const d = b.r;
      const k = d / R;
      const hAt = (u, v) => {
        const x = bx + (ex * u + nx * v) * k;
        const y = by + (ey * u + ny * v) * k;
        const z = bz + (ez * u + nz * v) * k;
        const l = Math.hypot(x, y, z);
        return evalSurface(x / l, y / l, z / l, 0, 0, _o).h;
      };
      const he = hAt(1, 0);
      const hw = hAt(-1, 0);
      const hn = hAt(0, 1);
      const hs = hAt(0, -1);
      ge = Math.max(-0.7, Math.min(0.7, (he - hw) / (2 * d)));
      gn = Math.max(-0.7, Math.min(0.7, (hn - hs) / (2 * d)));
      // mean curvature (1/m): convex crater rims and bowls
      curv = Math.max(-0.4, Math.min(0.4, (he + hw + hn + hs - 4 * h0) / (2 * d * d)));
    }
    // sun horizon delta seen from half-way up the rock (its own march toward the Sun)
    dirToFaceST(f, bx, by, bz, _st);
    const hz = march(bx, by, bz, h0 + 0.5 * b.H, (_st[0] - s0) / cw, (_st[1] - t0) / cw);
    const tint = (((b.cps * 7.1 + b.sps * 3.3) % 1) + 1) % 1;
    list.push(bx * r - cx, by * r - cy, bz * r - cz, b.r, b.H, b.vi, b.cps, b.sps, hz, tint, ge, gn, alb, curv);
  });
  return list.length ? Float32Array.from(list) : null;
}
