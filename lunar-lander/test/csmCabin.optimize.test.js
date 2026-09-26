// CSM cabin triangle-budget optimiser tests (CSM-CABIN agent): src/render/cockpit/csm/optimize.js.
// Run: node --test test/csmCabin.optimize.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { reduceGeometry, optimizeCabin, updateLOD, LOD_DISTANCE, mergeStatic } from '../src/render/cockpit/csm/optimize.js';

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const box = (g) => {
  g.computeBoundingBox();
  return g.boundingBox;
};
const near = { tol: 0.0003, minSeg: 8 };

/** A kit-like switch bushing: threaded lathe profile, rotated onto +Z and moved. */
function bushing() {
  const pts = [new THREE.Vector2(0.0001, 0.0024)];
  for (let i = 0; i <= 6; i++) {
    const z = 0.0024 + (0.0044 * i) / 6;
    pts.push(new THREE.Vector2(0.00305, z));
    if (i < 6) pts.push(new THREE.Vector2(0.00285, z + 0.00037));
  }
  pts.push(new THREE.Vector2(0.0029, 0.0072), new THREE.Vector2(0.0024, 0.0074), new THREE.Vector2(0.0001, 0.0074));
  return new THREE.LatheGeometry(pts, 16).rotateX(Math.PI / 2).translate(0.01, -0.02, 0.003);
}

test('lathe: fewer triangles, same placement and extent', () => {
  const g = bushing();
  const r = reduceGeometry(g, near);
  assert.ok(r, 'reduced');
  assert.ok(tris(r) < tris(g) * 0.5, `${tris(r)} vs ${tris(g)}`);
  const a = box(g);
  const b = box(r);
  // within the tolerance (plus the faceting of fewer segments)
  for (const k of ['x', 'y', 'z']) {
    assert.ok(Math.abs(a.min[k] - b.min[k]) < 0.0006, `min.${k}`);
    assert.ok(Math.abs(a.max[k] - b.max[k]) < 0.0006, `max.${k}`);
  }
  assert.ok(r.attributes.normal && r.attributes.uv, 'normal + uv kept');
});

test('non-uniform scale and rotation are reproduced (flattened lever)', () => {
  const L = [[0.0001, -0.0012], [0.0011, -0.0012], [0.0011, 0.0022], [0.0017, 0.0026], [0.00172, 0.0043], [0.00118, 0.0048], [0.00118, 0.0072], [0.00135, 0.0102], [0.0017, 0.0132], [0.00205, 0.0158], [0.00218, 0.0172], [0.00212, 0.0182], [0.00185, 0.0191], [0.0013, 0.0198], [0.0006, 0.02015], [0.0001, 0.0202]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(L, 14).rotateX(Math.PI / 2);
  g.scale(1.12, 0.86, 1);
  const r = reduceGeometry(g, near);
  assert.ok(r);
  const a = box(g);
  const b = box(r);
  assert.ok(Math.abs(a.max.z - b.max.z) < 0.0004 && Math.abs(a.min.z - b.min.z) < 0.0004, 'length along +Z kept');
  assert.ok(Math.abs(a.max.x - b.max.x) < 0.0005 && Math.abs(a.max.y - b.max.y) < 0.0005, 'flattened section kept');
});

test('non-affine edits are detected and left alone', () => {
  const g = new THREE.CylinderGeometry(0.01, 0.01, 0.05, 32);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 + 0.3 * Math.sin(p.getY(i) * 200)));
  assert.equal(reduceGeometry(g, near), null);
});

test('planar UVs (affine in position) follow the reduced geometry', () => {
  // kit panel style: rounded plate with a round hole, uv = x/w + 0.5, y/h + 0.5
  const w = 0.3;
  const h = 0.2;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + 0.003, -h / 2);
  s.lineTo(w / 2 - 0.003, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + 0.003);
  s.lineTo(w / 2, h / 2);
  s.lineTo(-w / 2, h / 2);
  s.lineTo(-w / 2, -h / 2 + 0.003);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + 0.003, -h / 2);
  const hole = new THREE.Path();
  hole.moveTo(0.01, 0);
  hole.lineTo(0.03, 0);
  hole.quadraticCurveTo(0.032, 0, 0.032, 0.002);
  hole.lineTo(0.032, 0.02);
  hole.lineTo(0.01, 0.02);
  hole.lineTo(0.01, 0);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 2, curveSegments: 10 });
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  const r = reduceGeometry(g, near);
  assert.ok(r, 'reduced');
  assert.ok(tris(r) < tris(g));
  const rp = r.attributes.position;
  const ru = r.attributes.uv;
  for (let i = 0; i < rp.count; i += 7) {
    assert.ok(Math.abs(ru.getX(i) - (rp.getX(i) / w + 0.5)) < 1e-4, 'u = x/w + 0.5');
    assert.ok(Math.abs(ru.getY(i) - (rp.getY(i) / h + 0.5)) < 1e-4, 'v = y/h + 0.5');
  }
});

test('big spheres (instrument balls) are not touched', () => {
  assert.equal(reduceGeometry(new THREE.SphereGeometry(0.08, 64, 32), near), null);
});

test('optimizeCabin: instanced banks get near/far LOD, shared source geometry untouched', () => {
  const root = new THREE.Group();
  const src = bushing();
  const srcTris = tris(src);
  const mk = (x) => {
    const m = new THREE.InstancedMesh(src, new THREE.MeshBasicMaterial(), 10);
    for (let i = 0; i < 10; i++) m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x + i * 0.03, 0, 0));
    root.add(m);
    return m;
  };
  const a = mk(0);
  const b = mk(3);
  const o = optimizeCabin(root);
  assert.equal(tris(src), srcTris, 'kit geometry itself is not modified');
  assert.ok(o.after < o.before * 0.5);
  assert.equal(o.lods.length, 2);
  updateLOD(o.lods, new THREE.Vector3(0.1, 0, 0));
  const lodA = o.lods.find((l) => l.mesh === a);
  const lodB = o.lods.find((l) => l.mesh === b);
  assert.equal(a.geometry, lodA.near);
  assert.ok(lodB.center.distanceTo(new THREE.Vector3(0.1, 0, 0)) > LOD_DISTANCE);
  assert.equal(b.geometry, lodB.far);
  assert.ok(tris(lodB.far) <= tris(lodB.near));
  o.setEnabled(false);
  assert.equal(a.geometry, src);
});

test('mergeStatic: static meshes sharing a material become one mesh in root space; dynamic parts untouched', () => {
  const root = new THREE.Group();
  root.position.set(5, -2, 1); // build transform is irrelevant: geometry is baked relative to the root
  const grey = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const greyTwin = new THREE.MeshStandardMaterial({ color: 0x808080 }); // same parameters -> shared
  const lit = new THREE.MeshStandardMaterial({ color: 0x808080 });
  lit.userData.lampBase = 1; // registered material: must keep its identity
  const glass = new THREE.MeshStandardMaterial({ transparent: true });
  const panel = new THREE.Group();
  panel.position.set(0.3, 0.1, -0.2);
  panel.rotation.set(0.3, -0.5, 0.2);
  root.add(panel);
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), grey);
  a.position.set(0.05, 0, 0);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1).toNonIndexed(), greyTwin);
  b.position.set(-0.05, 0.02, 0);
  b.scale.set(-1, 1, 1); // mirrored: winding must be fixed
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), lit);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), glass);
  const knob = new THREE.Group();
  const k1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), grey);
  knob.add(k1);
  panel.add(a, b, c, g, knob);
  for (const m of [a, b, c]) m.castShadow = m.receiveShadow = true;
  k1.castShadow = k1.receiveShadow = true;
  root.updateMatrixWorld(true);
  const worldA = new THREE.Box3().setFromObject(a);
  const worldB = new THREE.Box3().setFromObject(b);
  const r = mergeStatic(root, { dynamic: new Set([knob]) });
  assert.equal(r.merged.length, 1, 'one merged mesh (grey + its twin)');
  const m = r.merged[0];
  assert.equal(m.parent, root);
  assert.equal(m.material, grey);
  assert.ok(m.castShadow && m.receiveShadow);
  assert.equal(a.parent, null);
  assert.equal(b.parent, null);
  assert.equal(c.parent, panel, 'registered material left alone');
  assert.equal(g.parent, panel, 'transparent left alone');
  assert.equal(k1.parent, knob, 'dynamic subtree left alone');
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  const want = worldA.clone().union(worldB);
  assert.ok(box.min.distanceTo(want.min) < 1e-5 && box.max.distanceTo(want.max) < 1e-5, 'baked in place');
  // every triangle still faces outward (mirrored copy re-wound): face normal agrees with the vertex normals
  const p = m.geometry.attributes.position;
  const n = m.geometry.attributes.normal;
  const ix = m.geometry.index;
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const va = new THREE.Vector3();
  let bad = 0;
  for (let i = 0; i < ix.count; i += 3) {
    const [i0, i1, i2] = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
    va.fromBufferAttribute(p, i0);
    e1.fromBufferAttribute(p, i1).sub(va);
    e2.fromBufferAttribute(p, i2).sub(va);
    const fn = e1.cross(e2);
    if (fn.dot(new THREE.Vector3().fromBufferAttribute(n, i0)) <= 0) bad++;
  }
  assert.equal(bad, 0, 'winding consistent with normals');
  assert.equal(r.meshesAfter, r.meshesBefore - 1);
});
