// LM-CABIN: the LPD reticle marks must agree with the GNC definition of the LPD angle.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LM } from '../src/core/constants.js';
import { computeLPD, lpdElevation, lpdAzimuth, lpdDirection, triangleNormal } from '../src/render/cockpit/lm/lpd.js';

// GNC's definition (src/gnc/guidance.js lpdAngles), re-stated here in body axes
function gncElev(p, eye) {
  const d = new THREE.Vector3().subVectors(p, eye);
  return (Math.atan2(-d.y, -d.z) * 180) / Math.PI;
}

test('every LPD mark lies on a constant-angle line equal to its label (GNC definition)', () => {
  const r = computeLPD();
  assert.ok(r.marks.length > 20, `expected many marks, got ${r.marks.length}`);
  for (const m of r.marks) {
    for (const p of [m.a, m.b, m.center]) {
      assert.ok(Math.abs(gncElev(p, LM.eyeCDR) - m.deg) < 1e-6, `mark ${m.deg}: point reads ${gncElev(p, LM.eyeCDR)}`);
      assert.ok(Math.abs(lpdElevation(p) - m.deg) < 1e-6);
    }
  }
});

test('marks lie on the inner pane, inside the CDR window triangle', () => {
  const r = computeLPD({ paneOffset: 0.006 });
  const n = triangleNormal(LM.windows.cdr);
  const d = n.dot(LM.windows.cdr[0]) - 0.006;
  for (const m of r.marks) {
    assert.ok(Math.abs(n.dot(m.a) - d) < 1e-9);
    assert.ok(Math.abs(n.dot(m.b) - d) < 1e-9);
  }
});

test('scale covers 0 deg down to the lower apex of the window, labelled every 10 deg', () => {
  const r = computeLPD();
  const degs = r.marks.map((m) => m.deg);
  assert.equal(degs[0], 0);
  assert.ok(r.maxVisible >= 50 && r.maxVisible <= 56, `max visible ${r.maxVisible}`);
  const labels = r.marks.filter((m) => m.label).map((m) => +m.label);
  assert.deepEqual(labels, [0, 10, 20, 30, 40, 50]);
  // centres sit on the chosen scale azimuth
  for (const m of r.marks) assert.ok(Math.abs(lpdAzimuth(m.center) - 21) < 1e-6);
});

test('lpdDirection matches the GNC ray convention', () => {
  const dir = lpdDirection(35, 10);
  const p = LM.eyeCDR.clone().addScaledVector(dir, 3);
  assert.ok(Math.abs(lpdElevation(p) - 35) < 1e-9);
  assert.ok(Math.abs(lpdAzimuth(p) - 10) < 1e-9);
});
