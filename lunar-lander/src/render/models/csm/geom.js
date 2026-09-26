// Geometry helpers for the procedural CSM.
//
// Every helper returns a NON-INDEXED BufferGeometry with exactly `position`, `normal` and `uv`, so
// parts can be merged per material (one draw call per material per group) by `PartBuilder`.
// Unless stated otherwise UVs are in metres.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** Keep only position/normal/uv, non-indexed, with normals and (box-projected) UVs present. */
export function clean(g, { flat = false } = {}) {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  geo.morphAttributes = {};
  if (flat || !geo.attributes.normal) {
    geo.deleteAttribute('normal');
    geo.computeVertexNormals();
  }
  if (!geo.attributes.uv) {
    const p = geo.attributes.position;
    const uv = new Float32Array(p.count * 2);
    const n = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i));
      const ay = Math.abs(n.getY(i));
      const az = Math.abs(n.getZ(i));
      let u;
      let v;
      if (ax >= ay && ax >= az) [u, v] = [p.getY(i), p.getZ(i)];
      else if (ay >= az) [u, v] = [p.getX(i), p.getZ(i)];
      else [u, v] = [p.getX(i), p.getY(i)];
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  geo.clearGroups();
  return geo;
}

/**
 * Surface of revolution about the body Z axis.
 *
 * @param {number[][]} profile [r, z] points. The outward normal is (-dz, dr) in the (r, z) half-plane
 *   (i.e. traverse aft -> forward / centre -> rim for an outward-facing skin); pass `flip` to reverse.
 * @param {object} [o]
 * @param {number} [o.segments=64] segments around
 * @param {number} [o.az0=-PI] start azimuth (rad, from +Y toward +X)
 * @param {number} [o.az1=PI] end azimuth
 * @param {'frac'|'metres'} [o.v='metres'] V along the profile: normalised arclength or metres
 * @param {'frac'|'metres'} [o.u='frac'] U around: fraction of the sweep (0..1) or metres at radius uR
 * @param {number} [o.uR=1] radius used for metre U
 * @param {number} [o.crease=35] degrees between segment normals above which the edge is hard
 * @param {boolean} [o.flip=false] reverse the facing (inside surfaces)
 * @returns {THREE.BufferGeometry}
 */
export function lathe(profile, o = {}) {
  const segs = o.segments ?? 64;
  const az0 = o.az0 ?? -Math.PI;
  const az1 = o.az1 ?? Math.PI;
  const flip = !!o.flip;
  const crease = Math.cos(((o.crease ?? 35) * Math.PI) / 180);
  const n = profile.length;
  // segment normals in (r, z)
  const sn = [];
  const len = [0];
  for (let i = 0; i < n - 1; i++) {
    const dr = profile[i + 1][0] - profile[i][0];
    const dz = profile[i + 1][1] - profile[i][1];
    const l = Math.hypot(dr, dz) || 1;
    sn.push([-dz / l, dr / l]);
    len.push(len[i] + l);
  }
  const total = len[n - 1] || 1;
  const vOf = (i) => (o.v === 'frac' ? len[i] / total : len[i]);
  // per segment-end normals (smooth unless the crease angle is exceeded)
  const endN = (i, seg) => {
    const own = sn[seg];
    const other = seg === i ? sn[i - 1] : sn[i];
    if (!other) return own;
    if (own[0] * other[0] + own[1] * other[1] < crease) return own;
    const a = [own[0] + other[0], own[1] + other[1]];
    const l = Math.hypot(a[0], a[1]) || 1;
    return [a[0] / l, a[1] / l];
  };
  const pos = [];
  const nor = [];
  const uvs = [];
  const sgn = flip ? -1 : 1;
  for (let s = 0; s < n - 1; s++) {
    const [r0, z0] = profile[s];
    const [r1, z1] = profile[s + 1];
    if (Math.abs(r0 - r1) < 1e-9 && Math.abs(z0 - z1) < 1e-9) continue;
    const nA = endN(s, s);
    const nB = endN(s + 1, s);
    for (let k = 0; k < segs; k++) {
      const a0 = az0 + ((az1 - az0) * k) / segs;
      const a1 = az0 + ((az1 - az0) * (k + 1)) / segs;
      const u0 = o.u === 'metres' ? a0 * (o.uR ?? 1) : k / segs;
      const u1 = o.u === 'metres' ? a1 * (o.uR ?? 1) : (k + 1) / segs;
      const P = (r, z, a) => [r * Math.sin(a), r * Math.cos(a), z];
      const N = (nn, a) => [nn[0] * Math.sin(a) * sgn, nn[0] * Math.cos(a) * sgn, nn[1] * sgn];
      const q = [
        [P(r0, z0, a0), N(nA, a0), [u0, vOf(s)]],
        [P(r0, z0, a1), N(nA, a1), [u1, vOf(s)]],
        [P(r1, z1, a1), N(nB, a1), [u1, vOf(s + 1)]],
        [P(r1, z1, a0), N(nB, a0), [u0, vOf(s + 1)]],
      ];
      // winding: front face must agree with the normal
      const tri = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const t of tri) {
        pos.push(...q[t][0]);
        nor.push(...q[t][1]);
        uvs.push(...q[t][2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  fixWinding(g);
  return g;
}

/**
 * Make every triangle's winding agree with its (averaged) vertex normals — robust against the
 * handedness of whatever produced it.
 */
export function fixWinding(g) {
  const p = g.attributes.position;
  const nn = g.attributes.normal;
  const uv = g.attributes.uv;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    const fn = b.sub(a).cross(c.sub(a));
    n.set(0, 0, 0);
    for (let k = 0; k < 3; k++) n.x += nn.getX(i + k), n.y += nn.getY(i + k), n.z += nn.getZ(i + k);
    if (fn.dot(n) < 0) {
      // swap vertices 1 and 2
      for (const attr of [p, nn, uv]) {
        if (!attr) continue;
        for (let k = 0; k < attr.itemSize; k++) {
          const t = attr.array[(i + 1) * attr.itemSize + k];
          attr.array[(i + 1) * attr.itemSize + k] = attr.array[(i + 2) * attr.itemSize + k];
          attr.array[(i + 2) * attr.itemSize + k] = t;
        }
      }
    }
  }
  return g;
}

/** Basis matrix whose columns are (tangent, radial, +Z) at azimuth a, translated to (a, r, z). */
export function frameAt(a, r, z, out = new THREE.Matrix4()) {
  const s = Math.sin(a);
  const c = Math.cos(a);
  // columns: X = tangent (cos a, -sin a, 0), Y = radial (sin a, cos a, 0), Z = (0, 0, 1)
  return out.set(c, s, 0, r * s, -s, c, 0, r * c, 0, 0, 1, z, 0, 0, 0, 1);
}

/** Apply a matrix and return the geometry (cleaned). */
export function xf(g, m) {
  g.applyMatrix4(m);
  return g;
}

/** Axis-aligned box (in local coordinates) centred at c with size s. */
export function box(c, s, m = null) {
  const g = clean(new THREE.BoxGeometry(s[0], s[1], s[2]));
  g.translate(c[0], c[1], c[2]);
  if (m) g.applyMatrix4(m);
  return g;
}

/** Rounded box (bevelled) centred at c with size s and corner radius rad. */
export function roundBox(c, s, rad, m = null) {
  const shape = new THREE.Shape();
  const w = s[0] / 2;
  const h = s[1] / 2;
  const r = Math.min(rad, w * 0.9, h * 0.9);
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  const bev = Math.min(r * 0.6, s[2] * 0.3);
  const g = new THREE.ExtrudeGeometry(shape, { depth: s[2] - 2 * bev, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(s[2] - 2 * bev) / 2);
  const out = clean(g);
  out.translate(c[0], c[1], c[2]);
  if (m) out.applyMatrix4(m);
  return out;
}

/**
 * Cylinder / cone frustum between two points.
 * @param {THREE.Vector3|number[]} a start
 * @param {THREE.Vector3|number[]} b end
 * @param {number} ra radius at a
 * @param {number} rb radius at b
 * @param {number} [segs=12]
 * @param {boolean} [caps=true]
 */
export function tube(a, b, ra, rb = ra, segs = 12, caps = true) {
  const A = Array.isArray(a) ? new THREE.Vector3(...a) : a;
  const B = Array.isArray(b) ? new THREE.Vector3(...b) : b;
  const d = _v.subVectors(B, A);
  const L = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, L, segs, 1, !caps);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  _m.compose(A, q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return clean(g);
}

/** Sphere (or part) at c. */
export function sphere(c, r, ws = 12, hs = 8, phi0 = 0, phiLen = TAU, th0 = 0, thLen = Math.PI) {
  const g = new THREE.SphereGeometry(r, ws, hs, phi0, phiLen, th0, thLen);
  g.translate(c[0], c[1], c[2]);
  return clean(g);
}

/** Torus around the local Z axis at c (major radius R, tube radius r). */
export function torusZ(c, R, r, radial = 8, tubular = 48) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular);
  g.translate(c[0], c[1], c[2]);
  return clean(g);
}

/**
 * Flat polygon ring (triangle strip) between two closed outlines of equal length (Vector-like arrays),
 * facing `normal` (winding fixed to agree with it).
 */
export function ribbon(outerPts, innerPts, normal, closed = true) {
  const pos = [];
  const nor = [];
  const uvs = [];
  const n = outerPts.length;
  let acc = 0;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const a = outerPts[i];
    const b = outerPts[j];
    const c = innerPts[j];
    const d = innerPts[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const hA = Math.hypot(a[0] - d[0], a[1] - d[1], a[2] - d[2]);
    const hB = Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]);
    const nn = typeof normal === 'function' ? normal(i) : normal;
    const quad = [[a, [acc, hA]], [b, [acc + seg, hB]], [c, [acc + seg, 0]], [d, [acc, 0]]];
    for (const t of [0, 1, 2, 0, 2, 3]) {
      pos.push(...quad[t][0]);
      nor.push(nn[0], nn[1], nn[2]);
      uvs.push(...quad[t][1]);
    }
    acc += seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return fixWinding(g);
}

/**
 * Wall between two closed outlines (e.g. a window glass rim and the foil lip) with per-quad flat
 * normals pointing toward `inside` = false (outward from the outline centroid) or inward.
 */
export function wall(loopA, loopB, { inward = true, centre } = {}) {
  const pos = [];
  const nor = [];
  const uvs = [];
  const n = loopA.length;
  const C = centre;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = new THREE.Vector3(...loopA[i]);
    const b = new THREE.Vector3(...loopA[j]);
    const c = new THREE.Vector3(...loopB[j]);
    const d = new THREE.Vector3(...loopB[i]);
    const fnorm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const toC = new THREE.Vector3(...C).sub(mid);
    if ((fnorm.dot(toC) > 0) !== inward) fnorm.negate();
    const seg = a.distanceTo(b);
    const quad = [[a, [acc, 0]], [b, [acc + seg, 0]], [c, [acc + seg, b.distanceTo(c)]], [d, [acc, a.distanceTo(d)]]];
    for (const t of [0, 1, 2, 0, 2, 3]) {
      pos.push(quad[t][0].x, quad[t][0].y, quad[t][0].z);
      nor.push(fnorm.x, fnorm.y, fnorm.z);
      uvs.push(...quad[t][1]);
    }
    acc += seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return fixWinding(g);
}

/** Triangle fan over a closed planar outline (convex), facing `normal`. UV = planar (metres). */
export function fan(pts, normal, uAxis, vAxis) {
  const pos = [];
  const nor = [];
  const uvs = [];
  const c = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  const uvOf = (p) => [
    (p[0] - c[0]) * uAxis[0] + (p[1] - c[1]) * uAxis[1] + (p[2] - c[2]) * uAxis[2],
    (p[0] - c[0]) * vAxis[0] + (p[1] - c[1]) * vAxis[1] + (p[2] - c[2]) * vAxis[2],
  ];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    for (const p of [c, a, b]) {
      pos.push(...p);
      nor.push(...normal);
      uvs.push(...uvOf(p));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return fixWinding(g);
}

/**
 * Collects geometries per material key and merges them into one mesh per material.
 */
export class PartBuilder {
  constructor(materials) {
    this.M = materials;
    this.parts = new Map();
  }
  /** Add one or more geometries under material key `key`. */
  add(key, ...geos) {
    if (!this.M[key]) throw new Error(`CSM model: unknown material '${key}'`);
    if (!this.parts.has(key)) this.parts.set(key, []);
    for (const g of geos.flat()) if (g) this.parts.get(key).push(clean(g));
    return this;
  }
  /**
   * Merge into meshes added to `group`.
   * @param {THREE.Group} group
   * @param {object} [userData] copied onto every mesh
   * @returns {THREE.Mesh[]}
   */
  build(group, userData = {}) {
    const meshes = [];
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.M[key]);
      mesh.name = `CSM ${key}`;
      Object.assign(mesh.userData, userData);
      mesh.castShadow = !this.M[key].userData.noShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}
