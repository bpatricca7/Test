// LM exterior model: geometry contract checks (runs in node, no DOM/WebGL).
//   node --test test/lm-model.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LM, LAYERS, lmRcsJets, lmFootpads } from '../src/core/constants.js';
import { legGeometry } from '../src/render/models/lm/descent.js';
import { createLMModel } from '../src/render/models/lm/lmModel.js';

const model = createLMModel({ scene: new THREE.Scene(), quality: 'low' });

function meshesOf(root) {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
}

function worldVerts(mesh) {
  mesh.updateWorldMatrix(true, false);
  const p = mesh.geometry.attributes.position;
  const v = [];
  for (let i = 0; i < p.count; i++) v.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
  return v;
}

test('gear stroke axis matches the physics (pad -> upper strut attachment)', () => {
  for (const pad of lmFootpads()) {
    const leg = LM.gear.legs.find((l) => l.id === pad.id);
    const G = legGeometry(leg.dir);
    const top = leg.dir.clone().multiplyScalar(LM.gear.strutTopRadius).setY(LM.gear.strutTopY);
    const expected = top.sub(pad.pos).normalize();
    assert.ok(G.stroke.distanceTo(expected) < 1e-9, `${pad.id} stroke`);
    assert.ok(G.pad.distanceTo(pad.pos) < 1e-9, `${pad.id} pad centre`);
    // the primary strut axis passes through the pad's ball joint and ends at the top fitting height
    assert.ok(Math.abs(G.T.y - LM.gear.strutTopY) < 1e-9);
    assert.ok(G.S.y > 0.9 && G.S.y < 1.6, 'outer cylinder lower end in a sane place');
  }
});

test('footpads sit on y = 0 with the right radius', () => {
  const pads = meshesOf(model.root).filter((m) => m.material.name === 'LM footpad foil');
  assert.equal(pads.length, 4);
  for (const m of pads) {
    const v = worldVerts(m);
    const minY = Math.min(...v.map((p) => p.y));
    assert.ok(Math.abs(minY) < 1e-4, `pad bottom at y=0 (got ${minY})`);
    const c = v.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / v.length);
    const r = Math.max(...v.map((p) => Math.hypot(p.x - c.x, p.z - c.z)));
    assert.ok(Math.abs(r - LM.gear.padRadius) < 0.01, `pad radius ${r}`);
    assert.ok(Math.abs(Math.hypot(c.x, c.z) - LM.gear.padCenterRadius) < 0.02, 'pad centre radius');
  }
});

test('every RCS nozzle exit is exactly at its jet position', () => {
  const quads = meshesOf(model.root).filter((m) => m.name.startsWith('rcsQuads:'));
  const verts = quads.flatMap(worldVerts);
  for (const j of lmRcsJets()) {
    // exit lip vertices: on the exit plane, ~0.07 m from the jet axis
    const onPlane = verts.filter((p) => {
      const d = p.clone().sub(j.pos);
      const along = d.dot(j.exhaustDir);
      const radial = d.addScaledVector(j.exhaustDir, -along).length();
      return Math.abs(along) < 0.003 && radial > 0.05 && radial < 0.08;
    });
    assert.ok(onPlane.length >= 16, `${j.id}: nozzle exit ring found (${onPlane.length} verts)`);
  }
});

test('window glass lies on the constants triangles', () => {
  const glass = meshesOf(model.root).find((m) => m.material.name === 'LM window glass');
  const v = worldVerts(glass);
  for (const tri of [LM.windows.cdr, LM.windows.lmp]) {
    const n = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0])).normalize();
    for (const corner of tri) {
      const best = Math.min(...v.map((p) => p.distanceTo(corner.clone().addScaledVector(n, 0.004))));
      assert.ok(best < 1e-4, `window corner ${corner.toArray()} (err ${best})`);
    }
  }
});

test('budgets: triangles and meshes', () => {
  const s = model.stats();
  assert.ok(s.triangles < 150000, `triangles ${s.triangles}`);
  assert.ok(s.meshes < 70, `meshes ${s.meshes}`);
});

test('layers and IVA ghosting', () => {
  const all = meshesOf(model.root);
  assert.ok(all.every((m) => m.layers.isEnabled(LAYERS.VESSEL)));
  model.setIVA(true);
  for (const m of all) {
    const want = m.userData.ivaVisible ? LAYERS.VESSEL : LAYERS.GHOST;
    assert.ok(m.layers.isEnabled(want) && m.layers.mask === 1 << want, `${m.name} on layer ${want}`);
  }
  assert.ok(all.some((m) => m.userData.ivaVisible), 'RCS quads stay visible through the windows');
  model.setIVA(false);
  assert.ok(all.every((m) => m.layers.mask === 1 << LAYERS.VESSEL));
});

test('update: floating origin, gear stroke, staging', () => {
  const scene = new THREE.Scene();
  const m = createLMModel({ scene, quality: 'low' });
  scene.add(m.root);
  const v = {
    pos: new THREE.Vector3(1737400 + 10, 5, -3),
    quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
    cg: LM.cgDescentDry.clone(),
    staged: false,
    descentStage: null,
    landed: false,
    tel: { altitude: 1000 },
    gear: { pads: lmFootpads().map((p) => ({ ...p, compression: p.id === 'fwd' ? 0.5 : 0 })) },
  };
  const frame = { origin: new THREE.Vector3(1737400, 0, 0), time: 0 };
  m.update(frame, v);
  assert.ok(m.root.position.distanceTo(new THREE.Vector3(10, 5, -3)) < 1e-9);
  assert.ok(m.root.quaternion.angleTo(v.quat) < 1e-9);
  // forward pad moved up along its stroke axis by 0.5 m
  const fwd = m.root.getObjectByName('LM gear fwd lower');
  const G = legGeometry(new THREE.Vector3(0, 0, -1));
  assert.ok(fwd.position.distanceTo(G.stroke.clone().multiplyScalar(0.5)) < 1e-9);
  // staging: descent stage leaves root and follows vessel.descentStage
  v.staged = true;
  v.descentStage = { pos: new THREE.Vector3(1737400 + 2, 0, 0), quat: new THREE.Quaternion(), landed: true };
  m.update(frame, v);
  assert.equal(m.root.getObjectByName('LM descent stage'), undefined);
  assert.ok(m.descentRoot.getObjectByName('LM descent stage'));
  assert.ok(m.descentRoot.visible);
  assert.ok(m.descentRoot.position.distanceTo(new THREE.Vector3(2, 0, 0)) < 1e-9);
  // probes fold on a landed descent stage
  const probe = m.descentRoot.getObjectByName('LM contact probe aft');
  assert.ok(probe.quaternion.angleTo(new THREE.Quaternion()) > 1.0);
  // un-staging (scenario reload) puts it back
  v.staged = false;
  m.update(frame, v);
  assert.ok(m.root.getObjectByName('LM descent stage'));
  assert.equal(m.descentRoot.visible, false);
});
