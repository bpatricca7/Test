// Convex polyhedra from half-spaces, and planar-feature helpers (frames, insets).
//
// The LM ascent stage is a faceted, angular shell; describing it as an intersection of planes lets
// us put facets EXACTLY where constants.js says (the triangular windows lie in their own planes).

import * as THREE from 'three';
import { boxUV } from './geom.js';

const EPS = 1e-7;

/**
 * Plane helper: outward normal n (normalised here) through point p. Inside is n·x <= n·p.
 * @param {THREE.Vector3} n
 * @param {THREE.Vector3} p
 * @param {string} [tag] material/tag for the facet this plane creates
 */
export function plane(n, p, tag = null) {
  const nn = n.clone().normalize();
  return { n: nn, d: nn.dot(p), tag };
}

/**
 * Intersection of half-spaces, clipped from an axis-aligned bounding box.
 * @param {Array<{n: THREE.Vector3, d: number, tag: string|null}>} planes
 * @param {THREE.Box3} bounds starting box (should enclose the result)
 * @param {string} boxTag tag for faces that remain from the bounding box
 * @returns {Array<{pts: THREE.Vector3[], n: THREE.Vector3, tag: string|null}>} faces, CCW seen from outside
 */
export function clipPolyhedron(planes, bounds, boxTag = null) {
  const { min: a, max: b } = bounds;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  let faces = [
    { pts: [P(a.x, a.y, a.z), P(a.x, a.y, b.z), P(a.x, b.y, b.z), P(a.x, b.y, a.z)], tag: boxTag, n: P(-1, 0, 0) },
    { pts: [P(b.x, a.y, a.z), P(b.x, b.y, a.z), P(b.x, b.y, b.z), P(b.x, a.y, b.z)], tag: boxTag, n: P(1, 0, 0) },
    { pts: [P(a.x, a.y, a.z), P(b.x, a.y, a.z), P(b.x, a.y, b.z), P(a.x, a.y, b.z)], tag: boxTag, n: P(0, -1, 0) },
    { pts: [P(a.x, b.y, a.z), P(a.x, b.y, b.z), P(b.x, b.y, b.z), P(b.x, b.y, a.z)], tag: boxTag, n: P(0, 1, 0) },
    { pts: [P(a.x, a.y, a.z), P(a.x, b.y, a.z), P(b.x, b.y, a.z), P(b.x, a.y, a.z)], tag: boxTag, n: P(0, 0, -1) },
    { pts: [P(a.x, a.y, b.z), P(b.x, a.y, b.z), P(b.x, b.y, b.z), P(a.x, b.y, b.z)], tag: boxTag, n: P(0, 0, 1) },
  ];
  for (const pl of planes) {
    const next = [];
    const cap = [];
    for (const f of faces) {
      const out = [];
      const pts = f.pts;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        const dp = pl.n.dot(p) - pl.d;
        const dq = pl.n.dot(q) - pl.d;
        if (dp <= EPS) out.push(p);
        if (Math.abs(dp) <= EPS) cap.push(p);
        if ((dp < -EPS && dq > EPS) || (dp > EPS && dq < -EPS)) {
          const t = dp / (dp - dq);
          const x = p.clone().lerp(q, t);
          out.push(x);
          cap.push(x);
        }
      }
      if (out.length >= 3) next.push({ pts: out, tag: f.tag, n: f.n });
    }
    // dedupe cap points
    const uniq = [];
    for (const p of cap) if (!uniq.some((u) => u.distanceToSquared(p) < 1e-10)) uniq.push(p);
    if (uniq.length >= 3) {
      const c = new THREE.Vector3();
      uniq.forEach((p) => c.add(p));
      c.multiplyScalar(1 / uniq.length);
      const u = new THREE.Vector3().subVectors(uniq[0], c).normalize();
      const v = new THREE.Vector3().crossVectors(pl.n, u);
      uniq.sort((p, q) => {
        const ap = Math.atan2(v.dot(new THREE.Vector3().subVectors(p, c)), u.dot(new THREE.Vector3().subVectors(p, c)));
        const aq = Math.atan2(v.dot(new THREE.Vector3().subVectors(q, c)), u.dot(new THREE.Vector3().subVectors(q, c)));
        return ap - aq;
      });
      next.push({ pts: uniq, tag: pl.tag, n: pl.n.clone() });
    }
    faces = next;
  }
  // drop degenerate faces
  return faces.filter((f) => polygonArea(f.pts) > 1e-8);
}

function polygonArea(pts) {
  const acc = new THREE.Vector3();
  for (let i = 1; i < pts.length - 1; i++) {
    acc.add(new THREE.Vector3().subVectors(pts[i], pts[0]).cross(new THREE.Vector3().subVectors(pts[i + 1], pts[0])));
  }
  return acc.length() / 2;
}

/** Fan-triangulate planar faces into a flat-shaded geometry with box UVs (metres). */
export function facesToGeometry(faces, uvScale = 1, uvOffset = null) {
  const pos = [];
  const nrm = [];
  for (const f of faces) {
    const p = f.pts;
    for (let i = 1; i < p.length - 1; i++) {
      for (const q of [p[0], p[i], p[i + 1]]) {
        pos.push(q.x, q.y, q.z);
        nrm.push(f.n.x, f.n.y, f.n.z);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return boxUV(g, uvScale, uvOffset);
}

/**
 * Triangulate a planar face with polygonal holes (all CCW seen from outside, coplanar).
 * @returns {THREE.BufferGeometry} flat-shaded, box UVs
 */
export function faceWithHoles(face, holes, uvOffset = null) {
  const n = face.n;
  const o = face.pts[0];
  const u = new THREE.Vector3().subVectors(face.pts[1], o).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const to2 = (p) => new THREE.Vector2(u.dot(new THREE.Vector3().subVectors(p, o)), v.dot(new THREE.Vector3().subVectors(p, o)));
  const contour = face.pts.map(to2);
  const hs = holes.map((h) => h.map(to2));
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = [...face.pts, ...holes.flat()];
  const pos = [];
  const nrm = [];
  for (const [a, b, c] of tris) {
    let A = all[a];
    let B = all[b];
    let C = all[c];
    const fn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    if (fn.dot(n) < 0) [B, C] = [C, B];
    for (const q of [A, B, C]) {
      pos.push(q.x, q.y, q.z);
      nrm.push(n.x, n.y, n.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return boxUV(g, 1, uvOffset);
}

/** Group faces by tag -> geometry map. `tagFn(face)` can override the tag (e.g. by normal). */
export function facesByTag(faces, tagFn = null, uvOffset = null) {
  const groups = new Map();
  for (const f of faces) {
    const t = (tagFn ? tagFn(f) : f.tag) || 'default';
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(f);
  }
  const out = {};
  for (const [t, list] of groups) out[t] = facesToGeometry(list, 1, uvOffset);
  return out;
}

/**
 * Offset a planar convex polygon (CCW seen from +n) outward by w (negative = inward).
 * @returns {THREE.Vector3[]}
 */
export function offsetPolygon(pts, n, w) {
  const out = [];
  const k = pts.length;
  for (let i = 0; i < k; i++) {
    const prev = pts[(i - 1 + k) % k];
    const cur = pts[i];
    const nxt = pts[(i + 1) % k];
    const e1 = new THREE.Vector3().subVectors(cur, prev).normalize();
    const e2 = new THREE.Vector3().subVectors(nxt, cur).normalize();
    const m1 = new THREE.Vector3().crossVectors(e1, n).normalize();
    const m2 = new THREE.Vector3().crossVectors(e2, n).normalize();
    const s = 1 + m1.dot(m2);
    out.push(cur.clone().addScaledVector(m1.add(m2), w / Math.max(s, 0.05)));
  }
  return out;
}

/**
 * Window/hatch frame: a ring between polygon `inner` and its outward offset by `width`, raised by
 * `depth` along n (front face + inner reveal + outer wall). Returns a geometry.
 */
export function frameRing(inner, n, width, depth, back = 0) {
  const outer = offsetPolygon(inner, n, width);
  const fi = inner.map((p) => p.clone().addScaledVector(n, depth));
  const fo = outer.map((p) => p.clone().addScaledVector(n, depth));
  const bi = inner.map((p) => p.clone().addScaledVector(n, -back));
  const bo = outer.map((p) => p.clone().addScaledVector(n, -back));
  const pos = [];
  const quad = (a, b, c, d) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };
  const k = inner.length;
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    quad(fi[i], fo[i], fo[j], fi[j]); // front face (CCW from outside: inner->outer->outer->inner)
    quad(bi[i], fi[i], fi[j], bi[j]); // inner reveal (faces the window centre)
    quad(fo[i], bo[i], bo[j], fo[j]); // outer wall
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return boxUV(g, 1);
}

/** Planar polygon pushed along n by `off` (e.g. glass), CCW from outside. */
export function insetPolygonGeo(pts, n, off = 0) {
  const p = pts.map((q) => q.clone().addScaledVector(n, off));
  const pos = [];
  for (let i = 1; i < p.length - 1; i++) pos.push(p[0].x, p[0].y, p[0].z, p[i].x, p[i].y, p[i].z, p[i + 1].x, p[i + 1].y, p[i + 1].z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) {
    nrm[i] = n.x;
    nrm[i + 1] = n.y;
    nrm[i + 2] = n.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return boxUV(g, 1);
}
