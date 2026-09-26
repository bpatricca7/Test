// Geometry helpers for the procedural Lunar Module.
//
// Every helper returns a NON-INDEXED BufferGeometry with exactly `position`, `normal`, `uv`
// so that everything can be merged per material (one draw call per material per group).
// UVs are in metres (textures tile per metre; materials set their own repeat) unless noted.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { rng } from './textures.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Keep only position/normal/uv, make non-indexed, compute missing normals / uvs. */
export function clean(g, { flat = false, uvScale = 1 } = {}) {
  let geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  geo.morphAttributes = {};
  if (flat || !geo.attributes.normal) {
    geo.deleteAttribute('normal');
    geo.computeVertexNormals();
  }
  if (!geo.attributes.uv) boxUV(geo, uvScale);
  geo.clearGroups();
  return geo;
}

/**
 * Box-projected UVs (per triangle, dominant normal axis), in metres * scale, with an optional
 * random offset so repeated parts do not show identical texture.
 */
export function boxUV(geo, scale = 1, offset = null) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ou = offset ? offset[0] : 0;
  const ov = offset ? offset[1] : 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    _n.subVectors(c, b).cross(_v.subVectors(a, b));
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    for (let k = 0; k < 3; k++) {
      _v.fromBufferAttribute(p, i + k);
      let u;
      let w;
      if (ax >= ay && ax >= az) {
        u = _v.z * Math.sign(_n.x || 1);
        w = _v.y;
      } else if (ay >= az) {
        u = _v.x;
        w = _v.z * Math.sign(_n.y || 1);
      } else {
        u = -_v.x * Math.sign(_n.z || 1);
        w = _v.y;
      }
      uv[(i + k) * 2] = u * scale + ou;
      uv[(i + k) * 2 + 1] = w * scale + ov;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Apply a matrix and return the geometry. */
export function xf(geo, m) {
  geo.applyMatrix4(m);
  return geo;
}

/** Matrix placing local +Y along direction `dir`, origin at `pos`. */
export function alignY(pos, dir, roll = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, _v.copy(dir).normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
  return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
}

/** Cylinder / cone frustum from a to b (radii ra at a, rb at b). */
export function tube(a, b, ra, rb = ra, seg = 12, caps = true) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, !caps);
  g.translate(0, len / 2, 0);
  g.applyMatrix4(alignY(a, d));
  return clean(g);
}

/** Wrapped (lumpy) tube for blanket-wrapped struts: radius wobbles along the length. */
export function wrappedTube(a, b, r, seg = 12, rings = 16, amp = 0.012, seed = 1) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, rings, false);
  const p = g.attributes.position;
  const rr = rng(seed);
  const ph = [rr() * 6, rr() * 6, rr() * 6, rr() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const rad = Math.hypot(x, z);
    if (rad < 1e-6) continue;
    const ang = Math.atan2(z, x);
    const t = y / len;
    // end rings stay tight (tape), middle bulges and wrinkles
    const edge = Math.min(1, Math.min(t + 0.5, 0.5 - t) * 12);
    const w = 1 + edge * (amp / r) * (Math.sin(ang * 3 + t * 9 + ph[0]) * 0.6 + Math.sin(ang * 5 - t * 23 + ph[1]) * 0.4 + Math.sin(t * 41 + ph[2]) * 0.5 + Math.sin(ang * 2 + t * 5 + ph[3]) * 0.5);
    p.setX(i, x * w);
    p.setZ(i, z * w);
  }
  g.computeVertexNormals();
  g.translate(0, len / 2, 0);
  g.applyMatrix4(alignY(a, d));
  // uv: wrap around (u) x length (v), in metres
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r, uv.getY(i) * len);
  return clean(g);
}

/** Lathe around +Y from a profile [[r, y], ...]. uv: u = arc length (m), v = profile length (m). */
export function lathe(profile, seg = 32, phi0 = 0, phiLen = Math.PI * 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  const g = new THREE.LatheGeometry(pts, seg, phi0, phiLen);
  const uv = g.attributes.uv;
  // metres along the profile
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const rMax = Math.max(...pts.map((p) => p.x));
  for (let i = 0; i < uv.count; i++) {
    const vi = Math.round(uv.getY(i) * (pts.length - 1));
    uv.setXY(i, uv.getX(i) * phiLen * rMax, acc[Math.min(vi, acc.length - 1)]);
  }
  return clean(g);
}

/** Axis-aligned box centred at c with size s (Vector3s), optional matrix. */
export function box(c, s, m = null, uvScale = 1) {
  const g = new THREE.BoxGeometry(s.x, s.y, s.z);
  g.translate(c.x, c.y, c.z);
  if (m) g.applyMatrix4(m);
  return boxUV(clean(g), uvScale, [c.x * 0.37, c.z * 0.53]);
}

/** Convex hull of points with flat faces and box UVs. */
export function hull(points, uvScale = 1, offset = null) {
  const g = new ConvexGeometry(points);
  const geo = clean(g, { flat: true });
  return boxUV(geo, uvScale, offset);
}

/** Flat planar polygon (points in order, CCW seen from the front), fan-triangulated. */
export function polygon(pts, uvScale = 1) {
  const pos = [];
  const c = new THREE.Vector3();
  pts.forEach((p) => c.add(p));
  c.multiplyScalar(1 / pts.length);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    pos.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return boxUV(g, uvScale);
}

/** Thin plate: polygon extruded along its normal by `t` (both faces + rim). */
export function plate(pts, t = 0.01, uvScale = 1) {
  const n = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0])).normalize();
  const back = pts.map((p) => p.clone().addScaledVector(n, -t));
  return hull([...pts, ...back], uvScale);
}

/**
 * Blanket panel: a bilinear quad p0 (bottom-left) p1 (bottom-right) p2 (top-right) p3 (top-left),
 * subdivided nu x nv, pillowed outward by `bulge` (m), tucked in at the edges by `tuck`, and
 * wrinkled by low-frequency noise of amplitude `wrinkle`. Smooth normals (the foil normal map adds
 * the fine crinkles). uv in metres with a random offset.
 */
export function blanket(p0, p1, p2, p3, opts = {}) {
  const { nu = 12, nv = 10, bulge = 0.04, tuck = 0.012, wrinkle = 0.012, seed = 1, uvScale = 1, sag = 0 } = opts;
  const r = rng(seed * 7919 + 13);
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)).normalize();
  const wU = p0.distanceTo(p1);
  const wV = p0.distanceTo(p3);
  const waves = [];
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI;
    const f = (2.5 + r() * 7) * (k < 3 ? 1 : 2.2);
    waves.push({ kx: Math.cos(a) * f, ky: Math.sin(a) * f * 1.4, ph: r() * 6.28, amp: (0.5 + r()) / (k < 3 ? 1 : 2.5) });
  }
  const ou = r() * 3;
  const ov = r() * 3;
  const verts = [];
  const uvs = [];
  const P = new THREE.Vector3();
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    const t = j / nv;
    for (let i = 0; i <= nu; i++) {
      const s = i / nu;
      A.lerpVectors(p0, p1, s);
      B.lerpVectors(p3, p2, s);
      P.lerpVectors(A, B, t);
      const pil = Math.pow(Math.sin(Math.PI * s) * Math.sin(Math.PI * t), 0.6);
      const edge = Math.min(s, 1 - s, t, 1 - t);
      let w = 0;
      for (const wv of waves) w += Math.sin(s * wU * wv.kx + t * wV * wv.ky + wv.ph) * wv.amp;
      const off = bulge * pil + wrinkle * w * Math.min(1, edge * 8) * 0.35 - tuck * (1 - Math.min(1, edge * 10));
      P.addScaledVector(n, off);
      // hanging blankets sag slightly at the bottom middle
      if (sag) P.y -= sag * Math.sin(Math.PI * s) * (1 - t) * (1 - t);
      verts.push(P.x, P.y, P.z);
      uvs.push(s * wU * uvScale + ou, t * wV * uvScale + ov);
    }
  }
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return clean(g);
}

/**
 * Ring of blanket panels following a closed polygon outline (list of Vector3 at the bottom, with
 * the same outline at height yTop). Useful for the octagonal descent stage walls.
 */
export function blanketStrip(bottom, top, opts = {}) {
  const out = [];
  for (let i = 0; i < bottom.length - 1; i++) {
    out.push(blanket(bottom[i], bottom[i + 1], top[i + 1], top[i], { ...opts, seed: (opts.seed || 1) * 31 + i }));
  }
  return out;
}

/**
 * Parabolic dish (paraboloid) opening toward +Y with rim radius R and depth D. The returned surface
 * is the concave FRONT (normals up/inward); use flip() for the back. Vertex at the origin.
 */
export function dish(R, D, seg = 28, rings = 6) {
  const prof = [];
  for (let i = rings; i >= 0; i--) {
    const r = (i / rings) * R;
    prof.push([r, (D * r * r) / (R * R)]);
  }
  return lathe(prof, seg);
}

/** Reverse the winding and normals of a non-indexed geometry (back faces of thin shells). */
export function flip(geo) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n, uv]) {
      if (!a) continue;
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.array[(i + 1) * a.itemSize + k];
        a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
        a.array[(i + 2) * a.itemSize + k] = t;
      }
    }
  }
  for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return geo;
}

/** Merge many cleaned geometries (skips empty). */
export function merge(list) {
  const geos = list.filter((g) => g && g.attributes.position.count > 0);
  if (!geos.length) return null;
  return mergeGeometries(geos, false);
}

/**
 * Batch: collects geometries per material key, then builds one mesh per material.
 *   const b = new Batch(); b.add('gold', geo); ... b.build(materials, parentGroup)
 */
export class Batch {
  constructor(name = '') {
    this.name = name;
    this.map = new Map();
  }
  add(key, geo) {
    if (!geo) return this;
    if (Array.isArray(geo)) {
      geo.forEach((g) => this.add(key, g));
      return this;
    }
    if (!this.map.has(key)) this.map.set(key, []);
    this.map.get(key).push(geo);
    return this;
  }
  /** Build meshes; returns the list of meshes added to `parent`. */
  build(materials, parent) {
    const meshes = [];
    for (const [key, list] of this.map) {
      const mat = materials[key];
      if (!mat) throw new Error(`LM model: unknown material '${key}'`);
      const geo = merge(list);
      if (!geo) continue;
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const m = new THREE.Mesh(geo, mat);
      m.name = `${this.name}:${key}`;
      m.castShadow = mat.userData.noShadow !== true;
      m.receiveShadow = true;
      parent.add(m);
      meshes.push(m);
    }
    return meshes;
  }
}

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
