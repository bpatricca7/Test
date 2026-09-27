// Kit: a tiny model builder that merges every static sub-mesh of a furniture piece into one
// mesh per material, so a detailed bed costs one or two draw calls instead of dozens. Plain
// colors and the shared pixel-art materials of paint.js all land on ONE atlas material
// (vertex colors + a texture array layer + a glow amount per vertex, see atlas.js); only
// see-through and one-off materials (TV screens, pictures, mirrors) get meshes of their own.
// Moving bits (door leaves, swing seats, clock hands...) go into named parts (child Kits) that
// end up as their own small Groups, reachable as model.userData.parts[name].
//
// Coordinates are block units in the model's own space: [0,w] x [0,h] x [0,d], front = +Z.
// A "paint" is a '#rrggbb' string (vertex color) or a THREE.Material (textured, emissive,
// transparent...). Textured materials may carry userData.uvScale (repeats per block unit,
// world-space UVs) or userData.uvFit (each face gets the whole image, 0..1).

import * as THREE from 'three';
import { ATLAS_MAT, atlasLook } from './atlas.js';

const NO_UD = {};
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
HIT_MAT.userData.shared = true;
const UNIT = new THREE.BoxGeometry(1, 1, 1);
UNIT.userData.shared = true;

const colorCache = new Map();
function linearColor(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex); // converted to the linear working space
    colorCache.set(hex, c);
  }
  return c;
}

const geoCache = new Map();
function cachedGeo(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

// box faces: [normal, 4 corner selectors (0 = min, 1 = max) for x,y,z, u axis, v axis]
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], u: [2, -1], v: [1, 1], key: 'px' },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], u: [2, 1], v: [1, 1], key: 'nx' },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], u: [0, 1], v: [2, -1], key: 'py' },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: [0, 1], v: [2, 1], key: 'ny' },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], u: [0, 1], v: [1, 1], key: 'pz' },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], u: [0, -1], v: [1, 1], key: 'nz' },
];
const FIT_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

class Bucket {
  constructor(material) {
    this.material = material;
    this.look = !!material.userData.atlas; // atlas material: per-vertex layer + glow
    this.vc = this.look || !!material.vertexColors;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.lk = [];
    this.idx = [];
    this.count = 0;
  }
}

const WHITE = new THREE.Color(1, 1, 1);

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

export class Kit {
  constructor() {
    this.buckets = new Map();
    this.parts = [];
    this.hitboxes = [];
    this.objects = [];
  }

  _bucket(material) {
    let b = this.buckets.get(material.uuid);
    if (!b) {
      b = new Bucket(material);
      this.buckets.set(material.uuid, b);
    }
    return b;
  }

  /** paint -> { b: bucket, color, ud: uv settings, layer, glow } (reused result object). */
  _resolve(paint) {
    const r = this._r || (this._r = { b: null, color: null, ud: NO_UD, layer: -1, glow: 0 });
    if (paint && paint.isMaterial) {
      const look = atlasLook(paint);
      if (look) {
        r.b = this._bucket(look.mat);
        r.color = look.color;
        r.layer = look.layer;
        r.glow = look.glow;
      } else {
        r.b = this._bucket(paint);
        r.color = WHITE;
        r.layer = -1;
        r.glow = 0;
      }
      r.ud = paint.userData || NO_UD;
      return r;
    }
    r.b = this._bucket(ATLAS_MAT);
    r.color = linearColor(paint || '#FFFFFF');
    r.ud = NO_UD;
    r.layer = -1;
    r.glow = 0;
    return r;
  }

  /**
   * Axis-aligned box with its MIN corner at (x, y, z). opts: { faces: { px,nx,py,ny,pz,nz:
   * paint | null (null = skip face) }, rot: [rx, ry, rz] radians about the box centre (or
   * about opts.pivot [x,y,z]) }.
   */
  box(w, h, d, paint, x = 0, y = 0, z = 0, opts = null) {
    const lo = [x, y, z], hi = [x + w, y + h, z + d];
    let mat = null;
    if (opts && opts.rot) {
      const p = opts.pivot || [x + w / 2, y + h / 2, z + d / 2];
      _e.set(opts.rot[0] || 0, opts.rot[1] || 0, opts.rot[2] || 0);
      _m.makeRotationFromEuler(_e);
      const t = new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]);
      t.multiply(_m).multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
      mat = t;
      _nm.getNormalMatrix(mat);
    }
    for (const f of FACES) {
      let fp = paint;
      if (opts && opts.faces && f.key in opts.faces) fp = opts.faces[f.key];
      if (fp === null) continue;
      const { b, color, ud, layer, glow } = this._resolve(fp);
      const fit = !!ud.uvFit;
      const s = ud.uvScale || 1;
      const base = b.count;
      for (let i = 0; i < 4; i++) {
        const c = f.c[i];
        _v.set(c[0] ? hi[0] : lo[0], c[1] ? hi[1] : lo[1], c[2] ? hi[2] : lo[2]);
        let uu, vv;
        if (fit) {
          uu = FIT_UV[i][0];
          vv = FIT_UV[i][1];
        } else {
          const a = [_v.x, _v.y, _v.z];
          uu = a[f.u[0]] * f.u[1] * s;
          vv = a[f.v[0]] * f.v[1] * s;
        }
        _n.set(f.n[0], f.n[1], f.n[2]);
        if (mat) {
          _v.applyMatrix4(mat);
          _n.applyMatrix3(_nm).normalize();
        }
        b.pos.push(_v.x, _v.y, _v.z);
        b.nor.push(_n.x, _n.y, _n.z);
        b.uv.push(uu, vv);
        if (b.vc) b.col.push(color.r, color.g, color.b);
        if (b.look) b.lk.push(layer, glow);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      b.count += 4;
    }
    return this;
  }

  /** Append any BufferGeometry transformed by matrix (Matrix4). */
  geo(geometry, paint, matrix = null) {
    const { b, color, ud, layer, glow } = this._resolve(paint);
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const s = ud.uvScale || 1;
    if (matrix) _nm.getNormalMatrix(matrix);
    const base = b.count;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (nor) _n.fromBufferAttribute(nor, i);
      else _n.set(0, 1, 0);
      if (matrix) {
        _v.applyMatrix4(matrix);
        _n.applyMatrix3(_nm).normalize();
      }
      b.pos.push(_v.x, _v.y, _v.z);
      b.nor.push(_n.x, _n.y, _n.z);
      if (uv) b.uv.push(uv.getX(i) * s, uv.getY(i) * s);
      else b.uv.push(0, 0);
      if (b.vc) b.col.push(color.r, color.g, color.b);
      if (b.look) b.lk.push(layer, glow);
    }
    if (geometry.index) {
      const ix = geometry.index;
      for (let i = 0; i < ix.count; i++) b.idx.push(base + ix.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
    }
    b.count += pos.count;
    return this;
  }

  _placed(geometry, paint, x, y, z, sx, sy, sz, rot) {
    _t.set(x, y, z);
    _s.set(sx, sy, sz);
    if (rot) _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    else _e.set(0, 0, 0);
    _q.setFromEuler(_e);
    const m = new THREE.Matrix4().compose(_t, _q, _s);
    return this.geo(geometry, paint, m);
  }

  /** Vertical cylinder, base centre at (x, y, z). opts.rot rotates about the base centre. */
  cyl(r, h, paint, x = 0, y = 0, z = 0, seg = 12, opts = null) {
    const g = cachedGeo('cyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg).translate(0, 0.5, 0));
    return this._placed(g, paint, x, y, z, r, h, r, opts && opts.rot);
  }

  /** Cone / frustum: bottom radius r0, top radius r1 (base centre at x,y,z). */
  cone(r0, r1, h, paint, x = 0, y = 0, z = 0, seg = 12, opts = null) {
    const k = Math.round((r1 / Math.max(1e-4, r0)) * 100) / 100;
    const open = !!(opts && opts.open);
    const g = cachedGeo(`cone${seg}|${k}|${open}`, () => new THREE.CylinderGeometry(k, 1, 1, seg, 1, open).translate(0, 0.5, 0));
    return this._placed(g, paint, x, y, z, r0, h, r0, opts && opts.rot);
  }

  /** Sphere (or ellipsoid with sy/sz) centred at (x, y, z). */
  ball(r, paint, x = 0, y = 0, z = 0, opts = null) {
    const seg = (opts && opts.seg) || 12;
    const g = cachedGeo('ball' + seg, () => new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7))));
    const o = opts || {};
    return this._placed(g, paint, x, y, z, r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1), o.rot);
  }

  /** Torus lying flat (ring around the Y axis) centred at (x, y, z). */
  torus(R, r, paint, x = 0, y = 0, z = 0, opts = null) {
    const k = Math.round((r / R) * 100) / 100;
    const g = cachedGeo('torus' + k, () => new THREE.TorusGeometry(1, k, 8, 20).rotateX(Math.PI / 2));
    return this._placed(g, paint, x, y, z, R, R, R, opts && opts.rot);
  }

  /** A thin square stick (thickness t) from point a to point b ([x,y,z] arrays). */
  stick(a, b, t, paint) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return this;
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(_UP, _v);
    _e.setFromQuaternion(_q);
    return this.box(t, len, t, paint, a[0] - t / 2, a[1], a[2] - t / 2, { rot: [_e.x, _e.y, _e.z], pivot: a });
  }

  /**
   * Pixel art from strings: rows[0] is the TOP row. Each char looks up a paint in `map`
   * ('.' or ' ' = empty). plane 'xy' stands up facing +Z (depth along z); 'xz' lies flat
   * (rows run toward +z, i.e. rows[0] is the back). Horizontal runs merge into one box.
   */
  pixels(rows, px, map, x = 0, y = 0, z = 0, { plane = 'xy', depth = px } = {}) {
    const H = rows.length;
    for (let r = 0; r < H; r++) {
      const row = rows[r];
      let c = 0;
      while (c < row.length) {
        const ch = row[c];
        if (ch === '.' || ch === ' ' || !map[ch]) { c++; continue; }
        let e = c + 1;
        while (e < row.length && row[e] === ch) e++;
        const len = (e - c) * px;
        if (plane === 'xy') this.box(len, px, depth, map[ch], x + c * px, y + (H - 1 - r) * px, z);
        else this.box(len, depth, px, map[ch], x + c * px, y, z + r * px);
        c = e;
      }
    }
    return this;
  }

  /** A moving part: a child Kit whose origin sits at pivot (x, y, z) in this kit's space. */
  part(name, x = 0, y = 0, z = 0, init = null) {
    const k = new Kit();
    this.parts.push({ name, kit: k, pos: [x, y, z], init });
    return k;
  }

  /** Invisible box that only widens the pick/outline box (e.g. a whole door frame). */
  hitbox(x0, y0, z0, x1, y1, z1) {
    this.hitboxes.push([x0, y0, z0, x1, y1, z1]);
    return this;
  }

  /** Add a ready-made Object3D (e.g. a mesh with its own per-entity material). */
  add(obj) {
    this.objects.push(obj);
    return this;
  }

  /** Build the merged Group. model.userData.parts = { name: Group }. */
  build(group = new THREE.Group(), parts = {}) {
    for (const b of this.buckets.values()) {
      if (!b.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      if (b.vc) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      if (b.look) g.setAttribute('fLook', new THREE.Float32BufferAttribute(b.lk, 2));
      g.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, b.material);
      if (b.material.transparent) mesh.renderOrder = 2;
      mesh.userData.batch = true; // static: placed pieces may merge it into a world batch (entities.js)
      group.add(mesh);
    }
    for (const o of this.objects) group.add(o);
    for (const hb of this.hitboxes) {
      const m = new THREE.Mesh(UNIT, HIT_MAT);
      m.scale.set(hb[3] - hb[0], hb[4] - hb[1], hb[5] - hb[2]);
      m.position.set((hb[0] + hb[3]) / 2, (hb[1] + hb[4]) / 2, (hb[2] + hb[5]) / 2);
      m.visible = false;
      m.userData.hitbox = true;
      group.add(m);
    }
    for (const p of this.parts) {
      const pg = new THREE.Group();
      pg.name = p.name;
      pg.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (p.init) {
        if (p.init.rot) pg.rotation.set(p.init.rot[0] || 0, p.init.rot[1] || 0, p.init.rot[2] || 0);
        if (p.init.scale) pg.scale.set(p.init.scale[0], p.init.scale[1], p.init.scale[2]);
        if (p.init.visible === false) pg.visible = false;
      }
      p.kit.build(pg, parts);
      parts[p.name] = pg;
      group.add(pg);
    }
    group.userData.parts = parts;
    return group;
  }
}

/** The moving parts of a placed entity's model (or {}). */
export function partsOf(entity) {
  const pivot = entity && entity.object3d;
  const model = pivot && pivot.children[0];
  return (model && model.userData.parts) || {};
}
