// CSM cabin layout tests (CSM-CABIN agent): pure geometry of src/render/cockpit/csm/layout.js.
// Run: node --test test/csmCabin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CSM } from '../src/core/constants.js';
import {
  innerRadius, outerRadius, rayCone, WALL_OFFSET, windowFrame, windowFrames, windowPocket, mdcSections, sidePanels,
  lebFrames, stationEye, CONTROLLERS, AFT_Z, FWD_Z, MDC,
} from '../src/render/cockpit/csm/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Every obstacle rectangle of the console & side panels (faces and the MDC box tops). */
function obstacles() {
  const S = mdcSections();
  const list = [S.P1, S.P2, S.P3];
  const P = sidePanels();
  list.push(P.P8, P.P5, P.P15, P.P16);
  return list;
}

/** Sample points on a window aperture (centre + shrunk corners). */
function windowSamples(id, shrink = 0.35) {
  const f = windowFrame(id);
  const pts = [f.origin.clone()];
  for (const [u, v] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) pts.push(f.point((u * f.w * shrink) / 2, (v * f.h * shrink) / 2, 0));
  return pts;
}

test('inner wall sits ~0.12 m (normal) inside the mould line', () => {
  for (const z of [-0.2, -0.8, -1.5]) {
    const dr = outerRadius(z) - innerRadius(z);
    assert.ok(Math.abs(dr * Math.cos(CSM.cm.coneHalfAngle) - CSM.cm.wallThickness) < 1e-9);
  }
  assert.ok(Math.abs(WALL_OFFSET - 0.143) < 0.002);
});

test('rayCone finds the inner wall', () => {
  const p = V(0, 0, -1);
  const t = rayCone(p, V(1, 0, 0));
  assert.ok(Math.abs(t - innerRadius(-1)) < 1e-9);
});

test('window frames are orthonormal and centred on the mould line', () => {
  for (const [id, f] of Object.entries(windowFrames())) {
    assert.ok(Math.abs(f.x.length() - 1) < 1e-9 && Math.abs(f.y.length() - 1) < 1e-9 && Math.abs(f.z.length() - 1) < 1e-9, id);
    assert.ok(Math.abs(f.x.dot(f.y)) < 1e-9 && Math.abs(f.x.dot(f.z)) < 1e-9 && Math.abs(f.y.dot(f.z)) < 1e-9, id);
    // outward normal as in the constants
    assert.ok(f.z.dot(CSM.windows[id].normal.clone().normalize()) > 0.999, id);
    const r = Math.hypot(f.origin.x, f.origin.y);
    assert.ok(Math.abs(r - outerRadius(f.origin.z)) < 0.02, `${id} centre on mould line (${r} vs ${outerRadius(f.origin.z)})`);
  }
});

test('window pockets reach the inner wall', () => {
  for (const id of Object.keys(CSM.windows)) {
    const f = windowFrame(id);
    const pk = windowPocket(f, 0, 24);
    for (const q of pk.inner) {
      const r = Math.hypot(q.x, q.y);
      assert.ok(Math.abs(r - innerRadius(q.z)) < 0.01, `${id} inner rim on inner cone`);
      assert.ok(q.z < AFT_Z && q.z > FWD_Z, `${id} inner rim within the conical wall`);
    }
    assert.ok(Math.min(...pk.depth) > 0.05 && Math.max(...pk.depth) < 0.6, `${id} pocket depth ${Math.min(...pk.depth)}..${Math.max(...pk.depth)}`);
  }
});

test("CDR's lines of sight to the left rendezvous window and the hatch window are clear", () => {
  const eye = CSM.eyeCDR;
  const obs = obstacles();
  for (const id of ['rendezvousLeft', 'hatch', 'sideLeft']) {
    for (const p of windowSamples(id)) {
      const d = V(0, 0, 0).subVectors(p, eye);
      const L = d.length();
      d.normalize();
      for (const o of obs) {
        const t = o.intersect(eye, d, 0.0);
        assert.ok(!(t < L), `${id}: sightline blocked by a panel at t=${t}`);
      }
    }
  }
});

test('LMP sees the right rendezvous window, everyone sees the hatch window', () => {
  const obs = obstacles();
  const cases = [[CSM.eyeLMP, 'rendezvousRight'], [CSM.eyeLMP, 'hatch'], [CSM.eyeCMP, 'hatch'], [CSM.eyeLMP, 'sideRight']];
  for (const [eye, id] of cases) {
    const p = windowFrame(id).origin;
    const d = V(0, 0, 0).subVectors(p, eye);
    const L = d.length();
    d.normalize();
    for (const o of obs) assert.ok(!(o.intersect(eye, d) < L), `${id} blocked`);
  }
});

test('MDC faces the crew and sits inside the pressure vessel, ~0.65 m in front of the faces', () => {
  const S = mdcSections();
  for (const k of ['P1', 'P2', 'P3']) {
    const f = S[k];
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const p = f.point(u * f.w, v * f.h, 0);
      assert.ok(Math.hypot(p.x, p.y) < innerRadius(p.z) - 0.02, `${k} corner inside the cabin`);
    }
    const toEye = V(0, 0, 0).subVectors(CSM.eyeCMP, f.origin).normalize();
    assert.ok(f.z.dot(toEye) > 0.5, `${k} faces the crew`);
  }
  const d = S.P2.origin.distanceTo(CSM.eyeCMP);
  assert.ok(d > 0.55 && d < 0.8, `MDC distance ${d}`);
  // panel 1 in front of the CDR, panel 3 in front of the LMP
  assert.ok(S.P1.origin.x < -0.5 && S.P3.origin.x > 0.5);
  // overall width close to the constants
  const w = S.P3.point(S.P3.w / 2, 0, 0).x - S.P1.point(-S.P1.w / 2, 0, 0).x;
  assert.ok(Math.abs(w - CSM.mainDisplayConsole.width) < 0.12, `MDC chord width ${w}`);
  assert.ok(MDC.depth > 0.1);
});

test('LEB, side consoles, controllers and the RV eye are inside the cabin', () => {
  const inside = (p, m = 0.0) => Math.hypot(p.x, p.y) < innerRadius(p.z) - m && p.z < AFT_Z && p.z > FWD_Z;
  const L = lebFrames();
  for (const f of [L.GN, L.LK, L.CL, ...Object.values(sidePanels())]) {
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const p = f.point(u * f.w, v * f.h, 0);
      assert.ok(inside(p), `panel corner ${p.toArray().map((x) => x.toFixed(2))} inside`);
    }
  }
  for (const c of Object.values(CONTROLLERS)) assert.ok(inside(c.base, 0.3));
  const rv = stationEye('RV');
  assert.ok(inside(rv, 0.05), 'RV eye inside');
  // RV eye is in front of the MDC (crew side)
  const S = mdcSections();
  for (const k of ['P1', 'P2']) {
    const q = S[k].local(rv);
    if (Math.abs(q.x) < S[k].w / 2 && Math.abs(q.y) < S[k].h / 2) assert.ok(q.z > 0.05, `RV eye in front of ${k}`);
  }
});
