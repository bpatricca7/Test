// Geometry kit for the set: parts are placed in nested local frames, given
// world-scaled UVs where needed, and merged into one mesh per material.

import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function makeKit(THREE) {
  const V3 = THREE.Vector3;
  const bins = new Map();                 // material -> [geometry]
  let frame = new THREE.Matrix4();
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), te = new THREE.Euler(), ts = new V3(), tp = new V3();

  const mat4 = (pos = [0, 0, 0], rot = [0, 0, 0], sc = [1, 1, 1]) =>
    new THREE.Matrix4().compose(new V3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], rot[3] || 'XYZ')), new V3(...(typeof sc === 'number' ? [sc, sc, sc] : sc)));

  /** run fn with parts placed relative to (pos, rot) inside the current frame */
  function at(pos, rot, fn, sc = 1) {
    const prev = frame;
    frame = prev.clone().multiply(mat4(pos, rot, sc));
    fn();
    frame = prev;
  }
  // indexed geometry: SwiftShader has no post-transform cache for non-indexed draws
  function clean(g) {
    let h = g;
    for (const k of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(k)) h.deleteAttribute(k);
    h.morphAttributes = {};
    if (!h.attributes.uv) h.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    if (!h.attributes.normal) h.computeVertexNormals();
    if (!h.index) h = mergeVertices(h);
    h.clearGroups();
    return h;
  }
  /** world box-projected UVs: s = metres per texture tile (u, v) */
  function worldUV(g, su = 1, sv = su, off = [0, 0]) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
      let u, v;
      if (ny >= nx && ny >= nz) { u = p.getX(i); v = p.getZ(i); }
      else if (nx >= nz) { u = p.getZ(i) * Math.sign(n.getX(i) || 1) * -1; v = p.getY(i); }
      else { u = p.getX(i) * Math.sign(n.getZ(i) || 1); v = p.getY(i); }
      uv.setXY(i, u / su + off[0], v / sv + off[1]);
    }
    uv.needsUpdate = true;
    return g;
  }
  /**
   * add a geometry: placed at (pos, rot, sc) in the current frame.
   * opts.uv: 'world' (tile size opts.tile [su, sv]) keeps the texture at physical scale.
   */
  function add(mat, geo, pos = [0, 0, 0], rot = [0, 0, 0], sc = 1, opts = {}) {
    let g = clean(geo);
    g.applyMatrix4(frame.clone().multiply(mat4(pos, rot, sc)));
    if (opts.uv === 'world') worldUV(g, ...(opts.tile || [1, 1]), opts.off || [0, 0]);
    if (opts.flip) { /* noop, reserved */ }
    let b = bins.get(mat);
    if (!b) bins.set(mat, b = []);
    b.push(g);
    return g;
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const rbox = (w, h, d, r = 0.01, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const cyl = (rt, rb, h, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  /** a cylinder between two points */
  function rod(a, b, r, seg = 8) {
    const A = new V3(...a), B = new V3(...b);
    const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg, 1, false);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize()));
    const m = A.clone().add(B).multiplyScalar(0.5);
    g.translate(m.x, m.y, m.z);
    return g;
  }
  /** set the UVs of one face group of a BoxGeometry (face 0..5: +x -x +y -y +z -z) to a rect of an atlas */
  function boxFaceUV(g, face, u0, v0, u1, v1) {
    const uv = g.attributes.uv;
    const i = face * 4;
    // BoxGeometry face vertex order: (0,1) (1,1) (0,0) (1,0) in uv
    uv.setXY(i, u0, v1); uv.setXY(i + 1, u1, v1); uv.setXY(i + 2, u0, v0); uv.setXY(i + 3, u1, v0);
    uv.needsUpdate = true;
    return g;
  }
  function boxUVAll(g, u0, v0, u1, v1) { for (let f = 0; f < 6; f++) boxFaceUV(g, f, u0, v0, u1, v1); return g; }
  /** a flat quad (PlaneGeometry) with a uv rect of an atlas */
  function quad(w, h, uvr = [0, 0, 1, 1], seg = [1, 1]) {
    const g = new THREE.PlaneGeometry(w, h, seg[0], seg[1]);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uvr[0] + uv.getX(i) * (uvr[2] - uvr[0]), uvr[1] + uv.getY(i) * (uvr[3] - uvr[1]));
    return g;
  }
  /** merge everything added so far into meshes under parent */
  function build(parent, flags = new Map()) {
    const meshes = new Map();
    for (const [mat, geos] of bins) {
      const g = mergeGeometries(geos);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      const f = flags.get(mat) || {};
      m.castShadow = !!f.cast;
      m.receiveShadow = f.receive !== false;
      if (f.renderOrder !== undefined) m.renderOrder = f.renderOrder;
      parent.add(m);
      meshes.set(mat, m);
    }
    bins.clear();
    return meshes;
  }
  return { at, add, build, box, rbox, cyl, rod, quad, boxFaceUV, boxUVAll, worldUV, mat4, clean, get frame() { return frame; } };
}
