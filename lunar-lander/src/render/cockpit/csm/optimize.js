// Triangle-budget optimiser for the Command Module cabin (CSM-CABIN agent).
//
// The cockpit kit builds its hardware (toggle switches, circuit breakers, knobs, bezels...) at a
// resolution meant for close-up inspection of a single panel. The CM carries ~540 toggles and ~270
// breakers, which at kit resolution is >350k triangles for parts that are 3-10 px wide on screen.
// This pass rebuilds such parametric geometries (Lathe / Cylinder / Sphere / Torus / Extrude) at a
// resolution matched to their size, WITHOUT touching the kit's shared geometries (the LM cabin keeps
// using them): each mesh simply gets a reduced copy (cached per source geometry).
//
// How a reduced copy keeps the original placement: the kit rotates / translates / scales its
// geometries after construction. We rebuild the geometry from its `parameters` at the ORIGINAL
// resolution, fit the affine map original = M · fresh (least squares over all vertices; exact for
// rotate/translate/scale), check the residual (non-affine edits such as vertex displacement are
// detected and skipped), then build the reduced version and apply the same M. UVs are carried the
// same way (either the constructor's own parametric UVs, an affine function of them, or an affine
// function of position, e.g. the kit's planar panel UVs); anything else is left untouched.
//
// Resolution rule: a curve of radius r drawn with n segments deviates by r·(1 − cos(π/n)) from the
// true circle; n is chosen so that this sagitta stays below `tol` (0.3 mm by default: ~0.25 px at the
// crew's eye distance). Lathe profiles are simplified with Douglas–Peucker at the same tolerance
// (switch-bushing threads, knurls and fillets smaller than that are invisible).
//
// Distance LOD: instanced banks (toggles, breakers) get a "near" and a "far" reduced geometry; the
// cabin swaps them per frame from the eye distance to the bank (see updateLOD).
import * as THREE from 'three';

const TOL_NEAR = 0.0003;
const TOL_FAR = 0.0007;
/** Banks whose centre is farther than this from the eye use the far geometry (m). */
export const LOD_DISTANCE = 1.05;

/** Segments needed for an arc of `arc` rad and radius r at sagitta tolerance tol. */
function segsFor(r, tol, arc = Math.PI * 2) {
  if (!(r > 0)) return 3;
  const c = 1 - tol / r;
  const step = c <= -1 ? Math.PI : 2 * Math.acos(Math.max(-1, Math.min(1, c)));
  return Math.max(1, Math.ceil(Math.abs(arc) / Math.max(1e-6, step)));
}

/** Douglas–Peucker simplification of a 2D polyline (Vector2[]), keeping endpoints. */
function simplify(pts, tol) {
  if (pts.length <= 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a];
    const Bp = pts[b];
    const dx = Bp.x - A.x;
    const dy = Bp.y - A.y;
    const L = Math.hypot(dx, dy) || 1e-12;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / L;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol && bi > 0) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Largest radius-like size of the curves of a shape (and its holes), with needed curve divisions. */
function extrudeDivisions(shapes, tol) {
  let need = 1;
  const list = Array.isArray(shapes) ? shapes : [shapes];
  for (const s of list) {
    for (const path of [s, ...(s.holes || [])]) {
      for (const c of path.curves || []) {
        if (c.isEllipseCurve) {
          // Path.getPoints uses 2·divisions points for an ellipse arc
          const r = Math.max(c.xRadius, c.yRadius);
          need = Math.max(need, Math.ceil(segsFor(r, tol, c.aEndAngle - c.aStartAngle) / 2));
        } else if (c.isQuadraticBezierCurve || c.isCubicBezierCurve) {
          // rounded corner: radius ≈ control-point distance, quarter turn
          const r = c.v0.distanceTo(c.v1);
          need = Math.max(need, segsFor(r, tol, Math.PI / 2));
        } else if (!(c.isLineCurve)) {
          return null; // splines etc.: leave alone
        }
      }
    }
  }
  return need;
}

/**
 * Build a same-type geometry from `params` with an optional resolution override.
 * @returns {THREE.BufferGeometry|null}
 */
function rebuild(type, p, level) {
  switch (type) {
    case 'LatheGeometry': {
      if (!level) return new THREE.LatheGeometry(p.points, p.segments, p.phiStart, p.phiLength);
      const pts = simplify(p.points, level.tol);
      const rmax = Math.max(...pts.map((q) => q.x));
      const seg = Math.min(p.segments, Math.max(level.minSeg, segsFor(rmax, level.tol, p.phiLength)));
      return new THREE.LatheGeometry(pts, seg, p.phiStart, p.phiLength);
    }
    case 'CylinderGeometry': {
      const r = Math.max(p.radiusTop, p.radiusBottom);
      const seg = level ? Math.min(p.radialSegments, Math.max(level.minSeg, segsFor(r, level.tol, p.thetaLength))) : p.radialSegments;
      return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, seg, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength);
    }
    case 'SphereGeometry': {
      let w = p.widthSegments;
      let h = p.heightSegments;
      if (level) {
        w = Math.min(w, Math.max(level.minSeg, segsFor(p.radius, level.tol, p.phiLength)));
        h = Math.min(h, Math.max(Math.ceil(level.minSeg / 2), segsFor(p.radius, level.tol, p.thetaLength)));
      }
      return new THREE.SphereGeometry(p.radius, w, h, p.phiStart, p.phiLength, p.thetaStart, p.thetaLength);
    }
    case 'TorusGeometry': {
      let rs = p.radialSegments;
      let ts = p.tubularSegments;
      if (level) {
        rs = Math.min(rs, Math.max(4, segsFor(p.tube, level.tol)));
        ts = Math.min(ts, Math.max(level.minSeg, segsFor(p.radius + p.tube, level.tol, p.arc)));
      }
      return new THREE.TorusGeometry(p.radius, p.tube, rs, ts, p.arc);
    }
    case 'ExtrudeGeometry': {
      const o = { ...p.options };
      if (o.extrudePath) return null;
      if (level) {
        const need = extrudeDivisions(p.shapes, level.tol);
        if (need == null) return null;
        o.curveSegments = Math.min(o.curveSegments ?? 12, Math.max(1, need));
        o.bevelSegments = Math.min(o.bevelSegments ?? 3, 1);
      }
      return new THREE.ExtrudeGeometry(p.shapes, o);
    }
    default:
      return null;
  }
}

/** Least-squares affine fit dst ≈ M · [src, 1] (per component), with normalisation. */
function fitAffine(src, dst, srcDim, dstDim) {
  const n = src.count;
  const mu = new Float64Array(srcDim);
  for (let i = 0; i < n; i++) for (let k = 0; k < srcDim; k++) mu[k] += src.getComponent(i, k) / n;
  let s = 0;
  for (let i = 0; i < n; i++) for (let k = 0; k < srcDim; k++) s = Math.max(s, Math.abs(src.getComponent(i, k) - mu[k]));
  if (!(s > 0)) return null;
  const D = srcDim + 1;
  const A = new Float64Array(D * D);
  const Bm = new Float64Array(dstDim * D);
  const q = new Float64Array(D);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < srcDim; k++) q[k] = (src.getComponent(i, k) - mu[k]) / s;
    q[srcDim] = 1;
    for (let a = 0; a < D; a++) {
      for (let b = 0; b < D; b++) A[a * D + b] += q[a] * q[b];
      for (let c = 0; c < dstDim; c++) Bm[c * D + a] += dst.getComponent(i, c) * q[a];
    }
  }
  const Ainv = invert(A, D);
  if (!Ainv) return null;
  // M' (dstDim × D) = B · A⁻¹ in normalised coordinates
  const Mn = new Float64Array(dstDim * D);
  for (let c = 0; c < dstDim; c++) for (let b = 0; b < D; b++) {
    let acc = 0;
    for (let a = 0; a < D; a++) acc += Bm[c * D + a] * Ainv[a * D + b];
    Mn[c * D + b] = acc;
  }
  // back to raw coordinates: q' = (x − μ)/s  →  M = [Mn[:, :k]/s | Mn[:, k] − Σ Mn[:, j] μ_j / s]
  const M = new Float64Array(dstDim * D);
  for (let c = 0; c < dstDim; c++) {
    let off = Mn[c * D + srcDim];
    for (let k = 0; k < srcDim; k++) {
      M[c * D + k] = Mn[c * D + k] / s;
      off -= (Mn[c * D + k] * mu[k]) / s;
    }
    M[c * D + srcDim] = off;
  }
  // residual
  let err = 0;
  let scale = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < dstDim; c++) {
      let v = M[c * D + srcDim];
      for (let k = 0; k < srcDim; k++) v += M[c * D + k] * src.getComponent(i, k);
      const d = dst.getComponent(i, c);
      err = Math.max(err, Math.abs(v - d));
      scale = Math.max(scale, Math.abs(d));
    }
  }
  return { M, D, err, scale };
}

/** Gauss–Jordan inverse of a small dense matrix (row-major), null if singular. */
function invert(A, n) {
  const m = new Float64Array(n * 2 * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) m[r * 2 * n + c] = A[r * n + c];
    m[r * 2 * n + n + r] = 1;
  }
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r * 2 * n + c]) > Math.abs(m[piv * 2 * n + c])) piv = r;
    if (Math.abs(m[piv * 2 * n + c]) < 1e-12) return null;
    if (piv !== c) for (let k = 0; k < 2 * n; k++) [m[c * 2 * n + k], m[piv * 2 * n + k]] = [m[piv * 2 * n + k], m[c * 2 * n + k]];
    const d = m[c * 2 * n + c];
    for (let k = 0; k < 2 * n; k++) m[c * 2 * n + k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r * 2 * n + c];
      if (f) for (let k = 0; k < 2 * n; k++) m[r * 2 * n + k] -= f * m[c * 2 * n + k];
    }
  }
  const out = new Float64Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[r * n + c] = m[r * 2 * n + n + c];
  return out;
}

/** Apply an affine map (from fitAffine) to an attribute, producing a new Float32 attribute. */
function mapAttr(src, fit, dstDim) {
  const out = new Float32Array(src.count * dstDim);
  const srcDim = fit.D - 1;
  for (let i = 0; i < src.count; i++) {
    for (let c = 0; c < dstDim; c++) {
      let v = fit.M[c * fit.D + srcDim];
      for (let k = 0; k < srcDim; k++) v += fit.M[c * fit.D + k] * src.getComponent(i, k);
      out[i * dstDim + c] = v;
    }
  }
  return new THREE.BufferAttribute(out, dstDim);
}

/**
 * Reduced copy of a parametric geometry that keeps its placement and UV mapping, or null if the
 * geometry is not parametric / was edited non-affinely / would not get cheaper.
 * @param {THREE.BufferGeometry} g
 * @param {{tol: number, minSeg: number}} level
 */
export function reduceGeometry(g, level) {
  const type = g.type;
  const p = g.parameters;
  if (!p || !g.attributes.position) return null;
  if (type === 'SphereGeometry' && p.radius > 0.03) return null; // big textured balls (FDAI) stay smooth
  let fresh;
  try {
    fresh = rebuild(type, p, null);
  } catch {
    return null;
  }
  if (!fresh || fresh.attributes.position.count !== g.attributes.position.count) return null;
  const fit = fitAffine(fresh.attributes.position, g.attributes.position, 3, 3);
  if (!fit || fit.err > 1e-6 + 1e-4 * fit.scale) {
    fresh.dispose();
    return null;
  }
  const small = rebuild(type, p, level);
  if (!small) {
    fresh.dispose();
    return null;
  }
  const triOf = (x) => (x.index ? x.index.count : x.attributes.position.count) / 3;
  if (triOf(small) >= triOf(g) * 0.92) {
    fresh.dispose();
    small.dispose();
    return null;
  }
  // UVs: parametric (unchanged), affine of the parametric ones, or affine of position
  let uv = null;
  if (g.attributes.uv) {
    const u0 = g.attributes.uv;
    const uf = fresh.attributes.uv;
    const f1 = uf ? fitAffine(uf, u0, 2, 2) : null;
    if (f1 && f1.err < 1e-4 + 1e-4 * f1.scale) uv = mapAttr(small.attributes.uv, f1, 2);
    else {
      const f2 = fitAffine(fresh.attributes.position, u0, 3, 2);
      if (f2 && f2.err < 1e-4 + 1e-4 * f2.scale) uv = mapAttr(small.attributes.position, f2, 2);
      else {
        fresh.dispose();
        small.dispose();
        return null;
      }
    }
  }
  const m = new THREE.Matrix4().set(
    fit.M[0], fit.M[1], fit.M[2], fit.M[3],
    fit.M[4], fit.M[5], fit.M[6], fit.M[7],
    fit.M[8], fit.M[9], fit.M[10], fit.M[11],
    0, 0, 0, 1,
  );
  small.applyMatrix4(m);
  if (uv) small.setAttribute('uv', uv);
  else small.deleteAttribute('uv');
  // keep only the attributes the original had (e.g. no uv2), drop the parametric description
  for (const k of Object.keys(small.attributes)) if (!g.attributes[k]) small.deleteAttribute(k);
  small.computeBoundingSphere();
  small.computeBoundingBox();
  small.name = (g.name || type) + ':reduced';
  fresh.dispose();
  return small;
}

/**
 * Replace the parametric geometries under `root` with reduced copies; instanced banks get near/far
 * LOD variants. Call once after the cabin is built (root at the identity transform).
 * @param {THREE.Object3D} root
 * @returns {{lods: Array<{mesh: THREE.InstancedMesh, near: THREE.BufferGeometry, far: THREE.BufferGeometry, center: THREE.Vector3}>, before: number, after: number}}
 */
export function optimizeCabin(root) {
  const near = { tol: TOL_NEAR, minSeg: 8 };
  const far = { tol: TOL_FAR, minSeg: 6 };
  const cacheN = new Map();
  const cacheF = new Map();
  const get = (cache, g, lv) => {
    if (!cache.has(g.uuid)) cache.set(g.uuid, reduceGeometry(g, lv));
    return cache.get(g.uuid);
  };
  const lods = [];
  const replaced = [];
  let before = 0;
  let after = 0;
  const tris = (g, o) => ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.isSkinnedMesh || o.morphTargetInfluences) return;
    const g = o.geometry;
    before += tris(g, o);
    const gn = get(cacheN, g, near);
    if (gn) {
      replaced.push({ mesh: o, original: g });
      o.geometry = gn;
    }
    if (o.isInstancedMesh && o.count > 4) {
      const gf = get(cacheF, g, far);
      if (gf && gn) {
        // bank centre in cabin coordinates
        const c = new THREE.Vector3();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          c.add(p.setFromMatrixPosition(m.premultiply(o.matrixWorld).premultiply(inv)));
        }
        c.multiplyScalar(1 / o.count);
        lods.push({ mesh: o, near: gn, far: gf, center: c });
      }
    }
    after += tris(o.geometry, o);
  });
  return {
    lods,
    before: Math.round(before),
    after: Math.round(after),
    enabled: true,
    /** Debug: switch back to the kit's full-resolution geometries (false) or to the reduced ones. */
    setEnabled(on) {
      this.enabled = !!on;
      for (const r of replaced) r.mesh.geometry = on ? get(cacheN, r.original, near) : r.original;
      for (const l of lods) l.disabled = !on;
    },
  };
}

/**
 * Swap LOD geometries from the eye position (cabin coordinates).
 * @param {Array} lods from optimizeCabin
 * @param {THREE.Vector3} eye
 */
export function updateLOD(lods, eye) {
  for (const l of lods) {
    if (l.disabled) continue;
    const g = l.center.distanceTo(eye) > LOD_DISTANCE ? l.far : l.near;
    if (l.mesh.geometry !== g) l.mesh.geometry = g;
  }
}
