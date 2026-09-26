// Geometry helpers for the Command Module crew compartment (CSM-CABIN agent).
//
// Everything is in the CSM body frame (metres). Static parts are collected per material key in a
// Batch and merged into one mesh per key, so the whole interior renders in a few dozen draw calls.
import * as THREE from 'three';

/** Shorthand vector constructor. */
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V();
const _q = new THREE.Quaternion();
const Y = V(0, 1, 0);

// ------------------------------------------------------------------------------------ merge
/**
 * Merge geometries (indexed or not) into one indexed geometry with position/normal/uv.
 * Input geometries are disposed.
 * @param {THREE.BufferGeometry[]} list
 * @returns {THREE.BufferGeometry}
 */
export function mergeGeometries(list) {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
      if (u) {
        uv[(vo + i) * 2] = u.getX(i);
        uv[(vo + i) * 2 + 1] = u.getY(i);
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = vo + i;
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Triangle count of a geometry. */
export const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/**
 * Collects geometries per material key and merges them into one mesh per key.
 */
export class Batch {
  constructor(name = 'batch') {
    this.name = name;
    this.parts = new Map();
  }

  /**
   * Add a geometry (consumed). Optional matrix applied first.
   * @param {string} key material key
   * @param {THREE.BufferGeometry} g
   * @param {THREE.Matrix4} [m]
   */
  add(key, g, m) {
    if (!g) return g;
    if (m) g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
    return g;
  }

  /** Add with position / quaternion / scale. */
  addAt(key, g, pos, quat, scale) {
    return this.add(key, g, new THREE.Matrix4().compose(pos || V(), quat || new THREE.Quaternion(), scale || V(1, 1, 1)));
  }

  /** Merge into meshes (one per key). */
  build(materialFor, o = {}) {
    const grp = new THREE.Group();
    grp.name = this.name;
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const mat = materialFor(key);
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.name = `${this.name}:${key}`;
      mesh.castShadow = o.castShadow ?? true;
      mesh.receiveShadow = o.receiveShadow ?? true;
      if (mat?.userData?.noShadow) mesh.castShadow = false;
      grp.add(mesh);
    }
    this.parts.clear();
    return grp;
  }
}

// ------------------------------------------------------------------------------------ UVs
/** Planar UVs from local x/y scaled by 1/scale metres (tiling textures). */
export function planarUV(g, scale = 1, axis = 'xy', offset = [0, 0]) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const a = axis[0];
  const b = axis[1];
  for (let i = 0; i < p.count; i++) {
    const v = { x: p.getX(i), y: p.getY(i), z: p.getZ(i) };
    uv[i * 2] = v[a] / scale + offset[0];
    uv[i * 2 + 1] = v[b] / scale + offset[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Box-projected UVs (each face projects along its dominant normal axis), scale m per UV unit. */
export function boxUV(g, scale = 1) {
  const src = g.index ? g.toNonIndexed() : g;
  if (!src.attributes.normal) src.computeVertexNormals();
  const p = src.attributes.position;
  const n = src.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ax >= ay && ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else if (ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  src.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return src;
}

// ------------------------------------------------------------------------------------ primitives
/** Box centred at the origin. */
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Rounded rectangle Shape centred at the origin. */
export function roundRectShape(w, h, r, shape = new THREE.Shape()) {
  r = Math.max(0, Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5));
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/**
 * Rounded box (rounded rectangle in XY extruded along Z), centred, with planar XY UVs mapping
 * the w × h face to 0..1 (so a painted door texture fits exactly).
 */
export function roundBox(w, h, d, r = 0.008, bevel = null, seg = 3) {
  const b = Math.min(bevel ?? r * 0.6, d / 3, w / 4, h / 4);
  const s = roundRectShape(w - 2 * b, h - 2 * b, Math.max(0, r - b));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, d - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: seg });
  g.translate(0, 0, -(d - 2 * b) / 2);
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / w + 0.5;
    uv[i * 2 + 1] = p.getY(i) / h + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Cylinder between two points (radius rA at a, rB at b). */
export function cylBetween(a, b, rA, rB = rA, seg = 12, open = false) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rB, rA, len, seg, 1, open);
  _q.setFromUnitVectors(Y, _v.subVectors(b, a).normalize());
  g.applyQuaternion(_q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Box between two points (a beam of cross-section w × h; `up` orients the h side). */
export function beam(a, b, w, h, up = V(0, 1, 0)) {
  const d = V().subVectors(b, a);
  const len = d.length();
  const z = d.normalize();
  const x = V().crossVectors(up, z);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const y = V().crossVectors(z, x);
  const g = new THREE.BoxGeometry(w, h, len);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(V().addVectors(a, b).multiplyScalar(0.5)));
  return g;
}

/**
 * Tube along a smooth curve through `points`.
 * @param {THREE.Vector3[]} points
 * @param {number} r radius
 * @param {object} [o] { seg, radial=8, closed=false, tension=0.5, density (segments per m, 40) }
 */
export function tube(points, r, o = {}) {
  const curve = new THREE.CatmullRomCurve3(points, !!o.closed, 'catmullrom', o.tension ?? 0.5);
  const len = curve.getLength();
  const seg = o.seg ?? Math.max(4, Math.ceil(len * (o.density ?? 40)));
  const g = new THREE.TubeGeometry(curve, seg, r, o.radial ?? 8, !!o.closed);
  // u along the length in metres / uvLen
  const uv = g.attributes.uv;
  const k = len / (o.uvLen ?? 0.1);
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * k);
  return g;
}

/**
 * Corrugated hose along a curve (ribbed radius): used for the suit umbilicals.
 * @param {THREE.Vector3[]} points
 * @param {number} r mean radius
 * @param {number} [pitch=0.012] rib spacing (m)
 */
export function hose(points, r, pitch = 0.012, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const len = curve.getLength();
  const seg = Math.max(8, Math.ceil((len / pitch) * 2));
  const g = new THREE.TubeGeometry(curve, seg, r, radial, false);
  // ribs: displace alternate rings outward
  const p = g.attributes.position;
  const frames = curve.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const k = i % 2 === 0 ? 1.12 : 0.9;
    const c = curve.getPointAt(i / seg);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      _v.set(p.getX(idx), p.getY(idx), p.getZ(idx)).sub(c).multiplyScalar(k).add(c);
      p.setXYZ(idx, _v.x, _v.y, _v.z);
    }
  }
  void frames;
  g.computeVertexNormals();
  return g;
}

/** Lathe (surface of revolution around +Y) from [r, y] pairs. */
export function lathe(profile, seg = 24, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLength);
}

/** Extruded Shape (depth along +Z from 0), with planar UVs over the shape bbox or a scale. */
export function extrude(shape, depth, o = {}) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: !!o.bevel, bevelThickness: o.bevel || 0, bevelSize: o.bevel || 0, bevelSegments: 2, curveSegments: o.curve ?? 8 });
  return o.uvScale ? planarUV(g, o.uvScale) : g;
}

/**
 * Flat quad strip between two polylines of equal length (a[i] -> b[i]); optional UV v along the
 * strip and u by index / cumulative length. Normals computed.
 */
export function stripBetween(a, b, closed = false, uLen = 0.1) {
  const n = a.length;
  const m = closed ? n + 1 : n;
  const pos = new Float32Array(m * 2 * 3);
  const uv = new Float32Array(m * 2 * 2);
  let acc = 0;
  for (let i = 0; i < m; i++) {
    const k = i % n;
    if (i > 0) acc += a[k].distanceTo(a[(i - 1) % n]);
    pos.set([a[k].x, a[k].y, a[k].z], i * 6);
    pos.set([b[k].x, b[k].y, b[k].z], i * 6 + 3);
    uv.set([acc / uLen, 0, acc / uLen, 1], i * 4);
  }
  const idx = [];
  for (let i = 0; i < m - 1; i++) {
    const i0 = i * 2;
    idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Reverse triangle winding (flip facing) of a geometry in place, and its normals. */
export function flip(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    const p = g.attributes.position;
    for (const name of Object.keys(g.attributes)) {
      const at = g.attributes[name];
      const s = at.itemSize;
      for (let i = 0; i < p.count; i += 3) {
        for (let k = 0; k < s; k++) {
          const t = at.array[(i + 1) * s + k];
          at.array[(i + 1) * s + k] = at.array[(i + 2) * s + k];
          at.array[(i + 2) * s + k] = t;
        }
      }
    }
  }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return g;
}

/** Place a local geometry (XY face toward +Z) on a layout Frame with local offset (u, v, n). */
export function onFrame(g, frame, u = 0, v = 0, n = 0, extra) {
  const m = new THREE.Matrix4().makeBasis(frame.x, frame.y, frame.z).setPosition(frame.point(u, v, n));
  if (extra) m.multiply(extra);
  return g.applyMatrix4(m);
}

/** Apply a Frame's placement to an Object3D (local XY-plane object, face toward +Z). */
export function placeOnFrame(obj, frame, u = 0, v = 0, n = 0) {
  obj.position.copy(frame.point(u, v, n));
  obj.quaternion.copy(frame.quaternion());
  return obj;
}

/**
 * Convex polygon clip helpers for the pressure-vessel mesh (2D points [x, y]).
 * clipHalf keeps the part of `poly` on the side where (p - a) x (b - a) has sign `sign`.
 */
export function clipHalf(poly, a, b, keepLeft) {
  const out = [];
  const side = (p) => {
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    return keepLeft ? c : -c;
  };
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/**
 * Subtract a convex CCW polygon `hole` from a convex polygon `cell`: returns disjoint convex
 * pieces (cell ∩ outside(e_i) ∩ inside(e_0..e_{i-1})).
 */
export function subtractConvex(cell, hole) {
  const pieces = [];
  let rest = cell;
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i];
    const b = hole[(i + 1) % hole.length];
    const outside = clipHalf(rest, a, b, false);
    if (outside.length >= 3 && Math.abs(polyArea(outside)) > 1e-12) pieces.push(outside);
    rest = clipHalf(rest, a, b, true);
  }
  return pieces;
}

/** Signed area of a 2D polygon. */
export function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

/** Convex hull (CCW) of 2D points (monotone chain). */
export function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Point-in-convex-polygon (CCW). */
export function inConvex(poly, x, y) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}
