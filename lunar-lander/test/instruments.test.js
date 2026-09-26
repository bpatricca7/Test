// INSTRUMENTS: pure instrument logic (FDAI ball orientation, tape scales, timers, X-pointer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fdaiBallQuaternion, fdaiBallLocal, TAPES, tapeScale, formatMET, formatMMSS, crossPointerVelocities } from '../src/render/cockpit/instruments/math.js';
import { SITE_DIR, localENU, quatFromUpForward } from '../src/core/frames.js';
import { MOON, FT } from '../src/core/constants.js';

const D = Math.PI / 180;
const pos = SITE_DIR.clone().multiplyScalar(MOON.radius + 1000);
const { east: E, north: N, up: U } = localENU(pos);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const nearV = (v, x, y, z, eps = 1e-6) => {
  near(v.x, x, eps);
  near(v.y, y, eps);
  near(v.z, z, eps);
};
/** LM attitude: heading (deg from north), pitch (forward elevation, deg), roll (right side down, deg). */
function lmQuat(headingDeg, pitchDeg, rollDeg = 0) {
  const h = headingDeg * D;
  const p = pitchDeg * D;
  const r = rollDeg * D;
  const f0 = N.clone().multiplyScalar(Math.cos(h)).addScaledVector(E, Math.sin(h));
  const right0 = new THREE.Vector3().crossVectors(f0, U);
  const fwd = f0.clone().multiplyScalar(Math.cos(p)).addScaledVector(U, Math.sin(p));
  const up = U.clone().multiplyScalar(Math.cos(p)).addScaledVector(f0, -Math.sin(p));
  const up2 = up.clone().multiplyScalar(Math.cos(r)).addScaledVector(right0, Math.sin(r));
  return quatFromUpForward(up2, fwd);
}
/** Instrument-space position of a ball texture direction. */
const shown = (q, az, el) => fdaiBallLocal(az, el).applyQuaternion(q);

test('FDAI: upright LM facing north shows north on the horizon at the centre', () => {
  const { quat } = fdaiBallQuaternion(pos, lmQuat(0, 0));
  nearV(shown(quat, 0, 0), 0, 0, 1);
  nearV(shown(quat, 0, 90), 0, 1, 0); // zenith up
  nearV(shown(quat, 90, 0), 1, 0, 0); // east to the right
});

test('FDAI: pitch up 30 deg puts elevation +30 at the centre (horizon moves down)', () => {
  const { quat } = fdaiBallQuaternion(pos, lmQuat(0, 30));
  nearV(shown(quat, 0, 30), 0, 0, 1);
  assert.ok(shown(quat, 0, 0).y < 0, 'horizon below centre');
});

test('FDAI: heading 270 (flying west) shows azimuth 270 at the centre, larger azimuths to the right', () => {
  const { quat } = fdaiBallQuaternion(pos, lmQuat(270, 0));
  nearV(shown(quat, 270, 0), 0, 0, 1);
  assert.ok(shown(quat, 280, 0).x > 0);
  assert.ok(shown(quat, 260, 0).x < 0);
});

test('FDAI: roll right tilts the local up to the left (attitude-indicator convention)', () => {
  const { quat, up } = fdaiBallQuaternion(pos, lmQuat(0, 0, 20));
  near(quat.length(), 1);
  assert.ok(up.x < 0, 'up leans left');
  near(Math.atan2(-up.x, up.y) / D, 20, 1e-6);
});

test('tape scales are continuous, increasing and odd', () => {
  for (const sc of Object.values(TAPES)) {
    let prev = -Infinity;
    for (let v = 0; v <= sc.segs[sc.segs.length - 1][1]; v += sc.segs[0][3] * 0.5) {
      const t = sc.T(v);
      assert.ok(t > prev || v === 0, `monotonic at ${v}`);
      prev = t;
    }
    for (const s of sc.segs) {
      near(sc.T(s[1] - 1e-9), sc.T(s[1] + 1e-9), 1e-5); // continuous at the joints
      near(sc.T(-s[1] * 0.7), -sc.T(s[1] * 0.7));
    }
  }
  const s = tapeScale([[0, 10, 2, 1, 5, 5, String]]);
  near(s.T(5), 10);
});

test('timer formatting', () => {
  assert.equal(formatMET(102 * 3600 + 33 * 60 + 5.9), '102:33:05');
  assert.equal(formatMET(-4), '000:00:00');
  assert.equal(formatMMSS(-75), '01:15');
  assert.equal(formatMMSS(3599), '59:59');
  assert.equal(formatMMSS(3600), '00:00');
});

test('cross-pointer velocities are along body forward (-Z) and right (+X), in ft/s', () => {
  const q = lmQuat(270, 0);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const v = fwd.clone().multiplyScalar(3 * FT).addScaledVector(right, -2 * FT);
  const r = crossPointerVelocities(v, q);
  near(r.fwd, 3);
  near(r.lat, -2);
});

// ------------------------------------------------------------------------------ kit rendering state
import { createSwitchBank } from '../src/render/cockpit/kit/switches.js';
import { createBreakerBank } from '../src/render/cockpit/kit/breakers.js';
import { LIGHTING, registerLamp, setLampLevel, setLampExposure, LAMP_EXPOSURE_REF } from '../src/render/cockpit/kit/materials.js';

test('kit instanced banks carry their own shadow depth materials (plain vs instanceColor)', () => {
  const bank = createSwitchBank({ switches: [{ x: 0, y: 0 }, { x: 0.02, y: 0, guard: 'red' }, { x: 0.04, y: 0, cover: 'red' }] });
  const cbs = createBreakerBank({ breakers: [{ x: 0, y: 0 }, { x: 0.02, y: 0, popped: true }] });
  const meshes = [...bank.object.children, ...cbs.object.children].filter((o) => o.isInstancedMesh && o.castShadow);
  assert.ok(meshes.length >= 8);
  const plain = new Set();
  const colored = new Set();
  for (const m of meshes) {
    const d = m.customDepthMaterial;
    assert.ok(d?.isMeshDepthMaterial, `${m.material.name} has a depth material`);
    (m.instanceColor ? colored : plain).add(d);
  }
  assert.equal(plain.size, 1);
  assert.equal(colored.size, 1);
  assert.notEqual([...plain][0], [...colored][0]);
  // follows instanceColor added later; an explicit assignment still wins
  const lever = bank.object.children.find((o) => !o.instanceColor);
  lever.setColorAt(0, new THREE.Color(1, 0, 0));
  assert.equal(lever.customDepthMaterial, [...colored][0]);
  const own = new THREE.MeshDepthMaterial();
  lever.customDepthMaterial = own;
  assert.equal(lever.customDepthMaterial, own);
});

test('lamp exposure compensation: nominal at the reference exposure, dimmer in a dark-adapted cabin', () => {
  const m = registerLamp(new THREE.MeshStandardMaterial(), 1);
  setLampLevel(m, 1);
  setLampExposure({ multiplier: LAMP_EXPOSURE_REF, valid: true });
  near(m.emissiveIntensity, LIGHTING.lamps, 0.02);
  setLampExposure({ multiplier: 80, valid: true });
  const exposedDark = m.emissiveIntensity * 80;
  assert.ok(m.emissiveIntensity < 0.3, 'dimmed in absolute terms');
  assert.ok(exposedDark > LAMP_EXPOSURE_REF && exposedDark < 25, `still brighter on screen, not burnt out (${exposedDark})`);
  setLampExposure({ multiplier: 80, valid: false }); // invalid read-back: unchanged
  assert.ok(m.emissiveIntensity < 0.3);
  setLampExposure({ multiplier: LAMP_EXPOSURE_REF, valid: true });
  setLampLevel(m, 0);
  assert.equal(m.emissiveIntensity, 0);
});
