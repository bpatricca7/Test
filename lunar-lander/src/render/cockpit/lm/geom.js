// Geometry helpers for the LM crew compartment (LM-CABIN agent).
//
// Everything here works in the LM body frame (metres): +Y up (thrust axis), -Z forward (windows),
// +X right. The cabin is built from many small primitives that are merged per material by a Batch so
// the whole interior renders in a few dozen draw calls.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

/** Shorthand vector constructor. */
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------------------------ Batch
/**
 * Collects geometries per material key and merges them into one mesh per key.
 * Geometries are transformed by an optional matrix and reduced to position/normal/uv.
 */
export class Batch {
  constructor(name = 'batch') {
    this.name = name;
    this.parts = new Map();
  }

  /**
   * Add a geometry (consumed: it is disposed after merging).
   * @param {string} key material key
   * @param {THREE.BufferGeometry} g
   * @param {THREE.Matrix4} [m] transform to apply
   * @returns {THREE.BufferGeometry} g
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

  /** Add at a position/orientation given by an Object3D-like transform. */
  addAt(key, g, pos, quat, scale) {
    const m = new THREE.Matrix4().compose(pos || V(), quat || new THREE.Quaternion(), scale || V(1, 1, 1));
    return this.add(key, g, m);
  }

  /** Number of triangles collected so far. */
  triangles() {
    let n = 0;
    for (const list of this.parts.values()) for (const g of list) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    return n;
  }

  /**
   * Merge and build meshes.
   * @param {(key: string) => THREE.Material} materialFor
   * @param {{castShadow?: boolean, receiveShadow?: boolean}} [o]
   * @returns {THREE.Group}
   */
  build(materialFor, o = {}) {
    const grp = new THREE.Group();
    grp.name = this.name;
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const geo = mergeGeometries(list);
      const mat = materialFor(key);
      const mesh = new THREE.Mesh(geo, mat);
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

/**
 * Merge geometries (indexed or not) with position/normal/uv into one indexed geometry.
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

// ------------------------------------------------------------------------------------ frames
/**
 * Matrix placing a local XY-plane object (face toward +Z) at `origin` with local +X = right,
 * +Y = up, +Z = normal (orthonormalised).
 */
export function frameMatrix(origin, right, up) {
  const x = right.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, up).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

/** Apply a matrix4 to an Object3D (position/quaternion/scale). */
export function applyFrame(obj, m) {
  m.decompose(obj.position, obj.quaternion, obj.scale);
  return obj;
}

// ------------------------------------------------------------------------------------ primitives
/** Box centred at the origin. */
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Box spanning two corners. */
export function boxFromTo(a, b) {
  const g = new THREE.BoxGeometry(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Rounded box (extruded rounded rect along Z) centred at the origin. */
export function roundBox(w, h, d, r = 0.01, seg = 3) {
  const s = new THREE.Shape();
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const b = Math.min(r * 0.6, d / 3);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, d - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.9, bevelSegments: 2, curveSegments: seg });
  g.translate(0, 0, -(d - 2 * b) / 2);
  return planarUVxy(g, 1);
}

/** Cylinder between two points (radius rA at a, rB at b). */
export function cylBetween(a, b, rA, rB = rA, seg = 12, open = false) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rB, rA, len, seg, 1, open);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), _v.subVectors(b, a).normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * Tube along a smooth curve through `points`.
 * @param {THREE.Vector3[]} points
 * @param {number} r radius
 * @param {object} [o] { seg (tubular segments, default ~ 40/m), radial=8, closed=false, tension=0.5, uvLen (m per u) }
 */
export function tube(points, r, o = {}) {
  const curve = new THREE.CatmullRomCurve3(points, !!o.closed, 'catmullrom', o.tension ?? 0.5);
  const len = curve.getLength();
  const seg = o.seg ?? Math.max(4, Math.ceil(len * (o.density ?? 40)));
  const g = new THREE.TubeGeometry(curve, seg, r, o.radial ?? 8, !!o.closed);
  // u along the length in metres / uvLen, v around
  const uv = g.attributes.uv;
  const k = len / (o.uvLen ?? 0.05);
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * k);
  return g;
}

/** Catenary-ish sagging points between a and b (for cables/hoses). */
export function sag(a, b, drop, n = 10, sideways = V()) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    const s = 4 * t * (1 - t);
    p.y -= drop * s;
    p.addScaledVector(sideways, s);
    pts.push(p);
  }
  return pts;
}

/** Lathe around +Y from [[r, y], ...] profile. */
export function lathe(profile, seg = 24, phiStart = 0, phiLen = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-5, r), y)), seg, phiStart, phiLen);
}

/** Planar XY uv projection in metres * scale. */
export function planarUVxy(g, scale = 1) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * scale;
    uv[i * 2 + 1] = p.getY(i) * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Box-projected uv (by dominant normal axis), metres * scale. Works on non-indexed or indexed. */
export function boxUV(g, scale = 1) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let w;
    if (ax >= ay && ax >= az) [u, w] = [p.getZ(i), p.getY(i)];
    else if (ay >= az) [u, w] = [p.getX(i), p.getZ(i)];
    else [u, w] = [p.getX(i), p.getY(i)];
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = w * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ------------------------------------------------------------------------------------ polygons
/** Orthonormal in-plane basis (u, v) for a plane normal n (u roughly horizontal when possible). */
export function planeBasis(n) {
  const ref = Math.abs(n.y) < 0.95 ? V(0, 1, 0) : V(0, 0, -1);
  const u = new THREE.Vector3().crossVectors(ref, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { u, v };
}

/**
 * Triangulated planar polygon with holes. Vertices are 3D points on a plane with normal `n`
 * (the side the triangles face). UVs are planar metres * uvScale in the (u, v) basis.
 * @param {THREE.Vector3[]} outer
 * @param {THREE.Vector3[][]} holes
 * @param {THREE.Vector3} n facing direction
 * @param {number} [uvScale=1]
 */
export function polygonGeometry(outer, holes, n, uvScale = 1) {
  const { u, v } = planeBasis(n);
  const to2 = (p) => new THREE.Vector2(p.dot(u), p.dot(v));
  let o2 = outer.map(to2);
  let h2 = (holes || []).map((h) => h.map(to2));
  // ShapeUtils wants outer CCW, holes CW (in the u,v basis where u×v = n)
  if (THREE.ShapeUtils.isClockWise(o2)) {
    o2 = o2.reverse();
    outer = outer.slice().reverse();
  }
  const hs = (holes || []).map((h, i) => {
    if (!THREE.ShapeUtils.isClockWise(h2[i])) {
      h2[i] = h2[i].reverse();
      return h.slice().reverse();
    }
    return h;
  });
  const tris = THREE.ShapeUtils.triangulateShape(o2, h2);
  const all3 = [...outer, ...hs.flat()];
  const all2 = [...o2, ...h2.flat()];
  const pos = new Float32Array(all3.length * 3);
  const nor = new Float32Array(all3.length * 3);
  const uv = new Float32Array(all3.length * 2);
  all3.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], i * 3);
    nor.set([n.x, n.y, n.z], i * 3);
    uv.set([all2[i].x * uvScale, all2[i].y * uvScale], i * 2);
  });
  const idx = [];
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Extrude a planar 3D polygon along -n by `depth` (a slab whose front face is the polygon).
 * Returns a closed geometry (front, back, sides) with planar/box uvs.
 */
export function slabFromPolygon(pts, n, depth, uvScale = 1) {
  const back = pts.map((p) => p.clone().addScaledVector(n, -depth));
  const parts = [polygonGeometry(pts, [], n, uvScale), polygonGeometry(back.slice().reverse(), [], n.clone().negate(), uvScale)];
  parts.push(ribbon(pts, back, true, uvScale));
  return mergeGeometries(parts);
}

/** Quad strip between two equal-length polylines (a[i] -> b[i]); flat shaded per quad. */
export function ribbon(a, b, closed = false, uvScale = 1) {
  const pos = [];
  const uv = [];
  const n = a.length;
  let acc = 0;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    const l = a[i].distanceTo(a[j]);
    const d = a[i].distanceTo(b[i]);
    const quad = [a[i], a[j], b[j], a[i], b[j], b[i]];
    const uq = [[acc, 0], [acc + l, 0], [acc + l, d], [acc, 0], [acc + l, d], [acc, d]];
    for (let k = 0; k < 6; k++) {
      pos.push(quad[k].x, quad[k].y, quad[k].z);
      uv.push(uq[k][0] * uvScale, uq[k][1] * uvScale);
    }
    acc += l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Offset a planar polygon outward (positive d) in its plane (simple miter, convex/mild shapes). */
export function offsetPolygon(pts, n, d) {
  const m = pts.length;
  const ccw = signedArea(pts, n) > 0;
  const s = ccw ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + m) % m];
    const b = pts[(i + 1) % m];
    const e1 = _v.subVectors(p, a).normalize().clone();
    const e2 = new THREE.Vector3().subVectors(b, p).normalize();
    // outward normals of the two edges (in plane)
    const o1 = new THREE.Vector3().crossVectors(e1, n).multiplyScalar(s);
    const o2 = new THREE.Vector3().crossVectors(e2, n).multiplyScalar(s);
    const bis = o1.clone().add(o2).normalize();
    const cos = Math.max(0.25, bis.dot(o1));
    return p.clone().addScaledVector(bis, d / cos);
  });
}

/** Signed area of a planar polygon relative to normal n (positive = CCW seen from +n). */
export function signedArea(pts, n) {
  const acc = V();
  for (let i = 0; i < pts.length; i++) acc.add(_n.crossVectors(pts[i], pts[(i + 1) % pts.length]));
  return acc.dot(n) / 2;
}

/** Circle / regular polygon of points in a plane (centre c, basis u, v). */
export function circlePts(c, u, v, r, n = 32, a0 = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out.push(c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r));
  }
  return out;
}

// ------------------------------------------------------------------------------------ convex hull
/**
 * Convex polyhedron = intersection of half-spaces {p : n·p <= d}, clipped from a bounding box.
 * @param {Array<{n: THREE.Vector3, d: number, tag?: string}>} planes outward normals
 * @param {THREE.Box3} bounds
 * @returns {Array<{tag: string, n: THREE.Vector3, d: number, verts: THREE.Vector3[]}>} faces, verts CCW
 *   seen from outside (along +n)
 */
export function convexPolyhedron(planes, bounds) {
  const { min, max } = bounds;
  const c = (x, y, z) => V(x ? max.x : min.x, y ? max.y : min.y, z ? max.z : min.z);
  let faces = [
    { tag: 'box', n: V(-1, 0, 0), d: -min.x, verts: [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)] },
    { tag: 'box', n: V(1, 0, 0), d: max.x, verts: [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)] },
    { tag: 'box', n: V(0, -1, 0), d: -min.y, verts: [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)] },
    { tag: 'box', n: V(0, 1, 0), d: max.y, verts: [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)] },
    { tag: 'box', n: V(0, 0, -1), d: -min.z, verts: [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)] },
    { tag: 'box', n: V(0, 0, 1), d: max.z, verts: [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)] },
  ];
  const EPS = 1e-9;
  for (const pl of planes) {
    const n = pl.n.clone().normalize();
    const d = pl.d / pl.n.length();
    const cut = [];
    const next = [];
    for (const f of faces) {
      const out = [];
      const vs = f.verts;
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i];
        const b = vs[(i + 1) % vs.length];
        const da = n.dot(a) - d;
        const db = n.dot(b) - d;
        if (da <= EPS) out.push(a);
        if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
          const p = a.clone().lerp(b, da / (da - db));
          out.push(p);
          cut.push(p);
        } else if (Math.abs(da) <= EPS) cut.push(a);
      }
      if (out.length >= 3) next.push({ ...f, verts: dedupe(out) });
    }
    const capPts = dedupe(cut);
    if (capPts.length >= 3) {
      // order the cap CCW around the plane normal
      const ctr = capPts.reduce((s, p) => s.add(p), V()).divideScalar(capPts.length);
      const { u, v } = planeBasis(n);
      capPts.sort((p, q) => Math.atan2(_v.subVectors(p, ctr).dot(v), _v.dot(u)) - Math.atan2(_n.subVectors(q, ctr).dot(v), _n.dot(u)));
      next.push({ tag: pl.tag || 'plane', n, d, verts: capPts });
    }
    faces = next.filter((f) => f.verts.length >= 3);
  }
  return faces;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.some((q) => q.distanceToSquared(p) < 1e-12)) out.push(p);
  return out;
}

/** Plane through point p with outward normal n: {n, d, tag}. */
export function planeAt(n, p, tag) {
  const nn = n.clone().normalize();
  return { n: nn, d: nn.dot(p), tag };
}

/** Intersection of the line p + t*dir with plane {n, d}; returns t (or NaN). */
export function rayPlane(p, dir, n, d) {
  const den = n.dot(dir);
  if (Math.abs(den) < 1e-12) return NaN;
  return (d - n.dot(p)) / den;
}

/** Point-in-triangle test (3D, same plane) with barycentrics. */
export function inTriangle(p, a, b, c, margin = 0) {
  const v0 = _v.subVectors(c, a);
  const v1 = _n.subVectors(b, a);
  const v2 = new THREE.Vector3().subVectors(p, a);
  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d02 = v0.dot(v2);
  const d11 = v1.dot(v1);
  const d12 = v1.dot(v2);
  const inv = 1 / (d00 * d11 - d01 * d01);
  const u = (d11 * d02 - d01 * d12) * inv;
  const w = (d00 * d12 - d01 * d02) * inv;
  return u >= margin && w >= margin && u + w <= 1 - margin;
}

/** Normal matrix helper (for transforming directions by a Matrix4). */
export function transformDir(dir, m) {
  return dir.applyMatrix3(_m3.setFromMatrix4(m)).normalize();
}

/** Flip a geometry inside out (reverse winding and negate normals). */
export function invert(g) {
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
      for (let i = 0; i < p.count; i += 3) {
        for (let k = 0; k < at.itemSize; k++) {
          const t = at.array[(i + 1) * at.itemSize + k];
          at.array[(i + 1) * at.itemSize + k] = at.array[(i + 2) * at.itemSize + k];
          at.array[(i + 2) * at.itemSize + k] = t;
        }
      }
    }
  }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return g;
}
