// One draw call per pet: every vertex-colored part of a rig (body, head, legs, ears, tail,
// eyes...) is baked into ONE shared geometry and drawn as a SkinnedMesh whose "bones" are the
// rig's own pivots. Each part keeps its own bone, so animate() moves the pivots exactly as
// before (legs swing, ears flick, eyes blink by scale, hidden parts scale to 0) and the GPU
// moves the vertices. The merged geometry is cached per species + variant + options.
//
// A part mesh is swapped for an empty Object3D at the same place in the tree (the bone); the
// rig's references (eyes, their happy / sleepy eyes, the tongue) follow the swap. Meshes with
// their own material (the unicorn's glowing horn) stay as they are.

import * as THREE from 'three';
import { VC_MAT } from './kit.js';

const cache = new Map(); // key -> { geo, count }
const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();

function collect(rig) {
  const meshes = [];
  rig.jumper.traverse((o) => {
    if (o.isMesh && o.material === VC_MAT && !o.isSkinnedMesh) meshes.push(o);
  });
  return meshes;
}

function bake(meshes) {
  let nv = 0, ni = 0;
  for (const m of meshes) {
    const g = m.geometry;
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  meshes.forEach((m, bone) => {
    const g = m.geometry;
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    _m.copy(m.matrixWorld); // root space at rest (the root sits at the origin while baking)
    _n.getNormalMatrix(_m);
    for (let i = 0; i < P.count; i++) {
      const o = (vo + i) * 3;
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      pos[o] = _v.x; pos[o + 1] = _v.y; pos[o + 2] = _v.z;
      _v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize();
      nrm[o] = _v.x; nrm[o + 1] = _v.y; nrm[o + 2] = _v.z;
      col[o] = C.getX(i); col[o + 1] = C.getY(i); col[o + 2] = C.getZ(i);
      si[(vo + i) * 4] = bone;
      sw[(vo + i) * 4] = 1;
    }
    if (g.index) {
      const I = g.index;
      for (let i = 0; i < I.count; i++) idx[io + i] = I.getX(i) + vo;
      io += I.count;
    } else {
      for (let i = 0; i < P.count; i++) idx[io + i] = vo + i;
      io += P.count;
    }
    vo += P.count;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.shared = true;
  return geo;
}

/** Replace mesh m by an empty Object3D in the same spot of the tree; returns it. */
function swap(m) {
  const b = new THREE.Object3D();
  b.name = m.name || 'pet-bone';
  b.position.copy(m.position);
  b.quaternion.copy(m.quaternion);
  b.scale.copy(m.scale);
  b.visible = m.visible;
  const parent = m.parent;
  const i = parent.children.indexOf(m);
  parent.children[i] = b;
  b.parent = parent;
  m.parent = null;
  for (const c of m.children.slice()) b.add(c);
  return b;
}

/** Merge a freshly built rig (see buildRig). key identifies its geometry for the cache. */
export function mergeRig(rig, key) {
  const root = rig.root;
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const meshes = collect(rig);
  if (meshes.length < 2) return;
  let entry = cache.get(key);
  if (!entry || entry.count !== meshes.length) {
    entry = { geo: bake(meshes), count: meshes.length };
    cache.set(key, entry);
  }
  // meshes -> bones (and the rig's references with them)
  const map = new Map();
  const bones = meshes.map((m) => {
    const b = swap(m);
    map.set(m, b);
    return b;
  });
  const re = (o) => (o && map.has(o) ? map.get(o) : o);
  rig.eyes = rig.eyes.map((e) => {
    const b = re(e);
    b.userData.happy = re(e.userData.happy);
    b.userData.sleepy = re(e.userData.sleepy);
    return b;
  });
  rig.tongue = re(rig.tongue);
  root.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(entry.geo, VC_MAT);
  mesh.name = 'pet-skin';
  root.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  // object-level bounds (a skinned mesh would otherwise measure itself from bone matrices that
  // are not computed yet); a little extra room for hops, tricks and turned heads
  mesh.boundingBox = entry.geo.boundingBox.clone().expandByScalar(0.35);
  mesh.boundingSphere = entry.geo.boundingSphere.clone();
  mesh.boundingSphere.radius += 0.5;
  rig.skinned = mesh;
}

/** Free a merged rig's per-pet GPU data (its bone texture); the geometry is shared. */
export function disposeRig(rig) {
  if (rig && rig.skinned) {
    rig.skinned.skeleton.dispose();
    rig.skinned = null;
  }
}
