// Geometry for the avatar: a small builder that merges many boxes / chamfered boxes /
// spheres / cones / quads into ONE non-indexed BufferGeometry per (bone, material), with
// per-vertex colors (linear) and "world" UVs so cloth patterns flow across neighbouring
// parts. Parts are authored in avatar space (standing pose, origin at the feet, facing +Z);
// the builder subtracts the bone's rest origin.
//
// Flare: a ring-based, deformable skirt surface (pleats, jagged tulle hems, sway, flare,
// sitting drape) updated in place every frame without allocations.

import * as THREE from 'three';

export const TILE = 0.3; // cloth pattern tile size in world units

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ctr = new THREE.Vector3();
const _p = new THREE.Vector3();
const _col = new THREE.Color();
const _pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

const colorCache = new Map();
/** Linear THREE.Color for a hex string (cached; do not mutate). */
export function lin(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

export class GeoBuilder {
  /**
   * origin: the bone's rest pivot in avatar space. uv: 'world' | 'hair'.
   */
  constructor(origin = [0, 0, 0], { uv = 'world', uvScale = 1 / TILE } = {}) {
    this.origin = origin;
    this.uvMode = uv;
    this.uvScale = uvScale;
    this.pos = [];
    this.nrm = [];
    this.uvs = [];
    this.cols = [];
    this.m = new THREE.Matrix4();
    this.nm = new THREE.Matrix3();
    this.stack = [];
    this.under = 1; // color multiplier for downward faces
  }

  // ----- transform stack (applied to everything drawn afterwards) -----

  save() {
    this.stack.push(this.m.clone());
    return this;
  }

  restore() {
    const m = this.stack.pop();
    if (m) this.m.copy(m);
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  translate(x, y, z) {
    this.m.multiply(_m.makeTranslation(x, y, z));
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  rotate(x, y, z, order = 'XYZ') {
    _e.set(x, y, z, order);
    this.m.multiply(_m.makeRotationFromEuler(_e));
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  /** Rotate about a pivot point. */
  rotateAt(px, py, pz, x, y, z, order) {
    this.translate(px, py, pz);
    this.rotate(x, y, z, order);
    this.translate(-px, -py, -pz);
    return this;
  }

  scale(x, y, z) {
    this.m.multiply(_m.makeScale(x, y, z));
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  // ----- low level -----

  _xf(v) {
    return v.applyMatrix4(this.m);
  }

  _color(color, p, n) {
    if (typeof color === 'function') return color(p, n);
    if (color && color.isColor) return color;
    return lin(color || '#FFFFFF');
  }

  _uv(p, n, out) {
    const s = this.uvScale;
    const x = p.x, y = p.y, z = p.z;
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ay >= ax && ay >= az) {
      if (this.uvMode === 'hair') {
        out[0] = x * s;
        out[1] = 0.18 + z * 0.25;
      } else {
        out[0] = x * s;
        out[1] = (n.y > 0 ? -z : z) * s;
      }
    } else if (ax >= az) {
      out[0] = (n.x > 0 ? -z : z) * s;
      out[1] = y * (this.uvMode === 'hair' ? 1.1 : s);
    } else {
      out[0] = (n.z > 0 ? x : -x) * s;
      out[1] = y * (this.uvMode === 'hair' ? 1.1 : s);
    }
    return out;
  }

  _push(p, n, uv, c) {
    const o = this.origin;
    this.pos.push(p.x - o[0], p.y - o[1], p.z - o[2]);
    this.nrm.push(n.x, n.y, n.z);
    this.uvs.push(uv[0], uv[1]);
    const k = n.y < -0.6 ? this.under : 1;
    this.cols.push(c.r * k, c.g * k, c.b * k);
  }

  /**
   * Flat polygon (convex, 3-6 points, avatar-space [x,y,z] arrays). Winding is fixed up so
   * the face points away from `center` (when given) - handy for generated solids.
   */
  poly(points, color, { center = null, uvs = null } = {}) {
    const n = points.length;
    for (let i = 0; i < n; i++) this._xf(_pts[i].set(points[i][0], points[i][1], points[i][2]));
    _a.subVectors(_pts[1], _pts[0]);
    _b.subVectors(_pts[2], _pts[0]);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-14 && n > 3) {
      _b.subVectors(_pts[3], _pts[0]);
      _n.crossVectors(_a, _b);
    }
    _n.normalize();
    let flip = false;
    if (center) {
      _ctr.set(center[0], center[1], center[2]).applyMatrix4(this.m);
      _c.set(0, 0, 0);
      for (let i = 0; i < n; i++) _c.add(_pts[i]);
      _c.multiplyScalar(1 / n).sub(_ctr);
      if (_c.dot(_n) < 0) {
        flip = true;
        _n.negate();
      }
    }
    const uvTmp = [0, 0];
    const order = [];
    for (let i = 1; i < n - 1; i++) {
      if (flip) order.push(0, i + 1, i);
      else order.push(0, i, i + 1);
    }
    for (const idx of order) {
      const p = _pts[idx];
      const c = this._color(color, p, _n);
      if (uvs) {
        uvTmp[0] = uvs[idx][0];
        uvTmp[1] = uvs[idx][1];
      } else this._uv(p, _n, uvTmp);
      this._push(p, _n, uvTmp, c);
    }
    return this;
  }

  /** Axis-aligned box from min to max corner (in the current transform). */
  box(x0, y0, z0, x1, y1, z1, color) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const P = (x, y, z) => [x, y, z];
    this.poly([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], color);
    this.poly([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], color);
    this.poly([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)], color);
    this.poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], color);
    this.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], color);
    this.poly([P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], color);
    return this;
  }

  /** Box by centre + size. */
  cube(cx, cy, cz, w, h, d, color) {
    return this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, color);
  }

  /** Box with softly chamfered edges (c = bevel size). */
  cbox(x0, y0, z0, x1, y1, z1, c, color) {
    const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
    c = Math.min(c, hx * 0.9, hy * 0.9, hz * 0.9);
    if (c <= 0.001) return this.box(x0, y0, z0, x1, y1, z1, color);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const ctr = [cx, cy, cz];
    const vX = (sx, sy, sz) => [cx + sx * hx, cy + sy * (hy - c), cz + sz * (hz - c)];
    const vY = (sx, sy, sz) => [cx + sx * (hx - c), cy + sy * hy, cz + sz * (hz - c)];
    const vZ = (sx, sy, sz) => [cx + sx * (hx - c), cy + sy * (hy - c), cz + sz * hz];
    const o = { center: ctr };
    for (const s of [-1, 1]) {
      this.poly([vX(s, -1, -1), vX(s, -1, 1), vX(s, 1, 1), vX(s, 1, -1)], color, o);
      this.poly([vY(-1, s, -1), vY(1, s, -1), vY(1, s, 1), vY(-1, s, 1)], color, o);
      this.poly([vZ(-1, -1, s), vZ(1, -1, s), vZ(1, 1, s), vZ(-1, 1, s)], color, o);
    }
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        this.poly([vX(a, b, -1), vX(a, b, 1), vY(a, b, 1), vY(a, b, -1)], color, o); // along z
        this.poly([vY(-1, a, b), vY(1, a, b), vZ(1, a, b), vZ(-1, a, b)], color, o); // along x
        this.poly([vX(a, -1, b), vX(a, 1, b), vZ(a, 1, b), vZ(a, -1, b)], color, o); // along y
      }
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      this.poly([vX(sx, sy, sz), vY(sx, sy, sz), vZ(sx, sy, sz)], color, o);
    }
    return this;
  }

  /** Centre + size chamfered box. */
  ccube(cx, cy, cz, w, h, d, c, color) {
    return this.cbox(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, c, color);
  }

  /** Quad with explicit UVs (0..1), points in order around the face; front = CCW. */
  quad(p0, p1, p2, p3, color, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    return this.poly([p0, p1, p2, p3], color, { uvs });
  }

  /** Smooth ellipsoid (for balloons, pearls, scoops, pompoms). */
  sphere(cx, cy, cz, rx, ry, rz, color, wSeg = 10, hSeg = 7) {
    const P = (i, j) => {
      const th = (i / wSeg) * Math.PI * 2, ph = (j / hSeg) * Math.PI;
      const sx = Math.sin(ph) * Math.cos(th), sy = Math.cos(ph), sz = Math.sin(ph) * Math.sin(th);
      return [sx, sy, sz];
    };
    const uvTmp = [0, 0];
    for (let j = 0; j < hSeg; j++) {
      for (let i = 0; i < wSeg; i++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        const tris = j === 0 ? [[a, c, d]] : j === hSeg - 1 ? [[a, b, c]] : [[a, b, c], [a, c, d]];
        for (const tri of tris) {
          for (const v of tri) {
            _p.set(cx + v[0] * rx, cy + v[1] * ry, cz + v[2] * rz);
            this._xf(_p);
            _n.set(v[0] / rx, v[1] / ry, v[2] / rz).applyMatrix3(this.nm).normalize();
            const col = this._color(color, _p, _n);
            this._uv(_p, _n, uvTmp);
            this._push(_p, _n, uvTmp, col);
          }
        }
      }
    }
    return this;
  }

  /** Flat-shaded cone/pyramid: base centre (cx,cy,cz), radius r, height h along +y. */
  cone(cx, cy, cz, r, h, color, seg = 8, r2 = 0) {
    const ring = (y, rad) => {
      const out = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2 + Math.PI / seg;
        out.push([cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad]);
      }
      return out;
    };
    const lo = ring(cy, r), hi = r2 > 0 ? ring(cy + h, r2) : null;
    const ctr = [cx, cy + h * 0.45, cz];
    const o = { center: ctr };
    const bot = [cx, cy, cz], top = [cx, cy + h, cz];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      if (hi) {
        this.poly([lo[i], lo[j], hi[j], hi[i]], color, o);
        this.poly([top, hi[i], hi[j]], color, o);
      } else this.poly([lo[i], lo[j], top], color, o);
      this.poly([bot, lo[j], lo[i]], color, o);
    }
    return this;
  }

  /** Flat-shaded cylinder (y up) as a cone with equal radii. */
  cyl(cx, cy, cz, r, h, color, seg = 8) {
    return this.cone(cx, cy, cz, r, h, color, seg, r);
  }

  /** Smooth torus in the XZ plane (rotate the builder to stand it up). */
  torus(cx, cy, cz, R, r, color, seg = 16, tube = 6) {
    const uvTmp = [0, 0];
    const V = (i, j, out, nOut) => {
      const u = (i / seg) * Math.PI * 2, v = (j / tube) * Math.PI * 2;
      const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
      out.set(cx + (R + r * cv) * cu, cy + r * sv, cz + (R + r * cv) * su);
      nOut.set(cv * cu, sv, cv * su);
    };
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const N = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < tube; j++) {
        V(i, j, P[0], N[0]); V(i + 1, j, P[1], N[1]); V(i + 1, j + 1, P[2], N[2]); V(i, j + 1, P[3], N[3]);
        for (const k of [0, 2, 1, 0, 3, 2]) {
          _p.copy(P[k]);
          this._xf(_p);
          _n.copy(N[k]).applyMatrix3(this.nm).normalize();
          const col = this._color(color, _p, _n);
          this._uv(_p, _n, uvTmp);
          this._push(_p, _n, uvTmp, col);
        }
      }
    }
    return this;
  }

  get empty() {
    return this.pos.length === 0;
  }

  build() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.cols, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A skirt / dress surface: rings from the waist down. rings: [{ y, rx, rz, z? }] (avatar
 * space, top first). opts: { seg, pleat (0..0.15 in/out folds), jag (hem zigzag height),
 * scallop, color (hex or fn(y) -> hex) , origin (bone pivot), uvScale, inset }
 * deform({ flare, swayX, swayZ, sit, lift }) bends it in place.
 */
export class Flare {
  constructor(rings, opts = {}) {
    const seg = opts.seg || 16;
    const pleat = opts.pleat || 0;
    const jag = opts.jag || 0;
    const scallop = opts.scallop || 0;
    const origin = opts.origin || [0, 0, 0];
    const uvS = opts.uvScale || 1 / TILE;
    const colorFn = typeof opts.color === 'function' ? opts.color : () => opts.color || '#FFFFFF';
    this.yTop = opts.range ? opts.range[0] : rings[0].y;
    this.yBot = opts.range ? opts.range[1] : rings[rings.length - 1].y;
    const H = Math.max(0.01, this.yTop - this.yBot);
    // ring vertex positions
    const ringPts = rings.map((r, k) => {
      const out = [];
      const last = k === rings.length - 1;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const fold = pleat && k > 0 ? (i % 2 ? 1 - pleat * Math.min(1, k) : 1) : 1;
        let y = r.y;
        if (last && jag) y += i % 2 ? jag : 0;
        if (last && scallop) y += Math.abs(Math.sin((i / seg) * Math.PI * seg * 0.5)) * scallop;
        out.push({ x: Math.sin(a) * r.rx * fold, y, z: Math.cos(a) * r.rz * fold + (r.z || 0), a });
      }
      return out;
    });
    const pos = [], uv = [], col = [], base = [], w = [], ca = [];
    const circ = (rings[0].rx + rings[0].rz) * Math.PI;
    for (let k = 0; k < rings.length - 1; k++) {
      const A = ringPts[k], B = ringPts[k + 1];
      for (let i = 0; i < seg; i++) {
        // quad: A[i], B[i], B[i+1], A[i+1]  (outside faces +r; CCW seen from outside)
        const quad = [A[i], B[i], B[i + 1], A[i + 1]];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          const v = quad[idx];
          base.push(v.x, v.y, v.z);
          pos.push(v.x - origin[0], v.y - origin[1], v.z - origin[2]);
          const ai = idx === 0 || idx === 1 ? i : i + 1;
          uv.push(((ai / seg) * circ) * uvS, v.y * uvS);
          const c = lin(colorFn(v.y, ai));
          col.push(c.r, c.g, c.b);
          w.push(Math.pow(Math.min(1, Math.max(0, (this.yTop - v.y) / H)), 1.15));
          ca.push(Math.cos(v.a));
        }
      }
    }
    this.origin = origin;
    this.base = new Float32Array(base);
    this.weight = new Float32Array(w);
    this.cosA = new Float32Array(ca);
    this.count = w.length;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(new Float32Array(pos), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geometry = g;
    this.H = H;
    this._last = [NaN, NaN, NaN, NaN, NaN];
    this.deform({ flare: 0, swayX: 0, swayZ: 0, sit: 0, lift: 0 });
    g.computeBoundingSphere();
    g.boundingSphere.radius += 0.4; // room for flaring
  }

  /** Bend the skirt: flare (outward), sway (bottom offset), sit (drape forward over thighs). */
  deform(p) {
    const L = this._last;
    if (Math.abs(L[0] - p.flare) < 0.003 && Math.abs(L[1] - p.swayX) < 0.002 && Math.abs(L[2] - p.swayZ) < 0.002 &&
      Math.abs(L[3] - p.sit) < 0.004 && Math.abs(L[4] - p.lift) < 0.002) return;
    L[0] = p.flare; L[1] = p.swayX; L[2] = p.swayZ; L[3] = p.sit; L[4] = p.lift;
    const b = this.base, w = this.weight, ca = this.cosA, o = this.origin;
    const out = this.posAttr.array;
    const yTop = this.yTop;
    const T = 0.3; // thigh length along which a seated skirt lies
    for (let i = 0, n = this.count; i < n; i++) {
      const i3 = i * 3;
      const wt = w[i];
      const r = 1 + p.flare * wt;
      let x = b[i3] * r + p.swayX * wt;
      let y = b[i3 + 1] + p.lift * wt * wt;
      let z = b[i3 + 2] * r + p.swayZ * wt;
      if (p.sit > 0.001) {
        const c = ca[i];
        const d = yTop - b[i3 + 1];
        if (c > 0) {
          const k = p.sit * c;
          const along = Math.min(d, T);
          const below = Math.max(0, d - T);
          const ty = yTop - 0.03 - below * 0.9;
          const tz = b[i3 + 2] * 0.8 + along * 1.05;
          y += (ty - y) * k;
          z += (tz - z) * k;
        } else {
          const k = p.sit * -c * 0.85;
          const ty = Math.max(yTop - 0.12, y);
          y += (ty - y) * k;
          z += (b[i3 + 2] * 1.25 - z) * k * 0.6;
        }
      }
      out[i3] = x - o[0];
      out[i3 + 1] = y - o[1];
      out[i3 + 2] = z - o[2];
    }
    // flat normals per triangle
    const nr = this.nrmAttr.array;
    for (let t = 0, n = this.count; t < n; t += 3) {
      const a = t * 3, bb = a + 3, c = a + 6;
      const e1x = out[bb] - out[a], e1y = out[bb + 1] - out[a + 1], e1z = out[bb + 2] - out[a + 2];
      const e2x = out[c] - out[a], e2y = out[c + 1] - out[a + 1], e2z = out[c + 2] - out[a + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (let k = 0; k < 9; k += 3) {
        nr[a + k] = nx;
        nr[a + k + 1] = ny;
        nr[a + k + 2] = nz;
      }
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }
}
