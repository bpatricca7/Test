// Tests for the CSM exterior model's pure geometry / texture logic (CSM-MODEL agent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CSM, csmRcsJets } from '../src/core/constants.js';
import {
  coneRadius, cmOuterRadius, cmVofZ, cmProfileAtV, CM_FOIL_PROFILE, windowPocket, heightAboveCM,
  spsInnerProfile, spsInnerRadius, uOfAzimuth, azimuthOf,
} from '../src/render/models/csm/profile.js';
import { generateCMFoil, generateSMSkin } from '../src/render/models/csm/texgen.js';
import { PartBuilder } from '../src/render/models/csm/geom.js';
import { buildSM, buildSPS } from '../src/render/models/csm/sm.js';
import { buildCM, buildProbe } from '../src/render/models/csm/cm.js';

const spec = (w) => ({ center: w.center.toArray(), normal: w.normal.toArray(), up: w.up.toArray(), width: w.width, height: w.height, round: !!w.round });

test('CM outer mould line matches constants', () => {
  assert.ok(Math.abs(coneRadius(0) - CSM.cm.baseRadius) < 1e-9);
  assert.ok(Math.abs(coneRadius(CSM.cm.coneTopZ) - CSM.cm.coneTopRadius) < 2e-3);
  const last = CM_FOIL_PROFILE[CM_FOIL_PROFILE.length - 1];
  assert.equal(last[1], CSM.cm.shoulderZ);
  assert.ok(Math.abs(cmOuterRadius(-1.0) - coneRadius(-1.0)) < 1e-9);
  // the profile is monotonic in z (aft -> forward), so V is monotonic too
  for (let i = 1; i < CM_FOIL_PROFILE.length; i++) assert.ok(CM_FOIL_PROFILE[i][1] <= CM_FOIL_PROFILE[i - 1][1]);
  let prev = -1;
  for (let z = -0.02; z > -2.55; z -= 0.05) {
    const v = cmVofZ(z);
    assert.ok(v > prev);
    prev = v;
    const p = cmProfileAtV(v);
    assert.ok(Math.abs(p.z - z) < 1e-6, `round trip at z=${z}`);
  }
});

test('every CSM window centre lies on the CM skin and its pocket is below the foil', () => {
  for (const [name, w] of Object.entries(CSM.windows)) {
    const h = heightAboveCM(w.center.toArray());
    assert.ok(Math.abs(h) < 0.01, `${name} centre is ${h} m off the skin`);
    const p = windowPocket(spec(w), { recess: 0.02 });
    for (const q of p.frameRim) assert.ok(heightAboveCM(q) < -0.015, `${name} frame rim above the foil`);
    for (const q of p.lipRim) assert.ok(Math.abs(heightAboveCM(q)) < 2e-3, `${name} lip not on the foil`);
    for (const [u, v] of p.footprintUV) assert.ok(u >= 0 && u < 1 && v > 0 && v < 1, `${name} footprint UV out of range`);
  }
  // the rendezvous windows are forward-looking scoops: deeper than the flush side windows
  const rv = windowPocket(spec(CSM.windows.rendezvousLeft));
  const side = windowPocket(spec(CSM.windows.sideLeft));
  assert.ok(rv.shift > side.shift);
});

test('texture U convention: seam on -Y, hatch (+Y) at u = 0.5, quads at the right azimuth', () => {
  assert.ok(Math.abs(uOfAzimuth(azimuthOf(0, 1)) - 0.5) < 1e-12);
  assert.ok(Math.abs(uOfAzimuth(azimuthOf(1, 0)) - 0.75) < 1e-12);
  assert.ok(uOfAzimuth(azimuthOf(0, -1)) < 1e-9 || uOfAzimuth(azimuthOf(0, -1)) > 1 - 1e-9);
});

test('SPS bell reaches the exit plane and radius from constants and widens monotonically', () => {
  const prof = spsInnerProfile();
  const last = prof[prof.length - 1];
  assert.ok(Math.abs(last[0] - CSM.sps.nozzleExitRadius) < 1e-9);
  assert.ok(Math.abs(last[1] - CSM.sps.nozzleExit.z) < 1e-9);
  assert.ok(Math.abs(spsInnerRadius(CSM.sps.nozzleThroat.z, prof) - 0.145) < 1e-6);
  for (let z = 5.35; z < 7.8; z += 0.1) assert.ok(spsInnerRadius(z + 0.05, prof) >= spsInnerRadius(z, prof));
});

test('foil atlas has window holes (alpha 0) and valid normals; SM atlas has quad panels', () => {
  const holes = Object.values(CSM.windows).map((w) => windowPocket(spec(w)).footprintUV);
  const W = 256;
  const H = 128;
  const cm = generateCMFoil({ width: W, height: H, holes });
  assert.equal(cm.albedo.length, W * H * 4);
  let transparent = 0;
  for (let i = 3; i < cm.albedo.length; i += 4) if (cm.albedo[i] === 0) transparent++;
  assert.ok(transparent > 20, `only ${transparent} hole pixels`);
  assert.ok(transparent < W * H * 0.05);
  for (let i = 0; i < cm.normal.length; i += 4) assert.ok(cm.normal[i + 2] > 128, 'normal map z must point out');
  const sm = generateSMSkin({ width: W, height: H, quadAzimuths: CSM.rcs.quadAngles.map((a) => (a * 180) / Math.PI) });
  // a quad panel's outer black band (quad A, azimuth 7.25 deg, z = 1.0)
  const u = uOfAzimuth((7.25 * Math.PI) / 180);
  const v = (1.0 - CSM.sm.zFront) / (CSM.sm.zRear - CSM.sm.zFront);
  const i = (Math.floor(v * H) * W + Math.floor(u * W)) * 4;
  assert.ok(sm.albedo[i] < 60, `quad panel should be dark, got ${sm.albedo[i]}`);
});

test('RCS quad nozzles are built exactly at the csmRcsJets() exit positions', () => {
  const mats = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? (t[k] ||= new THREE.MeshBasicMaterial()) : undefined), has: () => true });
  const B = new PartBuilder(mats);
  buildSM(B);
  const g = new THREE.Group();
  const meshes = B.build(g);
  const noz = meshes.find((m) => m.name === 'CSM nozzle');
  assert.ok(noz, 'nozzle mesh');
  const pos = noz.geometry.attributes.position;
  const p = new THREE.Vector3();
  for (const j of csmRcsJets()) {
    let hits = 0;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      // exit-lip vertices: on the exit plane of this jet, 4-6.5 cm from its axis
      const d = p.clone().sub(j.pos);
      const axial = d.dot(j.exhaustDir);
      const radial = d.addScaledVector(j.exhaustDir, -axial).length();
      if (Math.abs(axial) < 1e-3 && radial > 0.04 && radial < 0.065) hits++;
    }
    assert.ok(hits >= 20, `jet ${j.id} has no nozzle exit at its position`);
  }
});

test('model part builders produce a reasonable triangle budget', () => {
  const mats = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? (t[k] ||= new THREE.MeshBasicMaterial()) : undefined), has: () => true });
  const pockets = Object.values(CSM.windows).map((w) => windowPocket(spec(w)));
  const B = new PartBuilder(mats);
  buildCM(B, pockets);
  buildSM(B);
  buildSPS(B);
  buildProbe(B, B);
  const g = new THREE.Group();
  let tris = 0;
  for (const m of B.build(g)) tris += m.geometry.attributes.position.count / 3;
  assert.ok(tris > 20000 && tris < 150000, `${tris} triangles`);
});
