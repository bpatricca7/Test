// IO agent: camera math, stations and audio text helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { lookQuat, orbitOffset, horizontalDir, slerpAboutAxis, framingFov, headLookQuat, smoothK, wrapAngle, D2R } from '../src/render/camera/math.js';
import { STATIONS, getStation, nextStation, mapStation } from '../src/render/camera/stations.js';
import { LM, CSM } from '../src/core/constants.js';
import { spokenText, pickVoice, speechDuration } from '../src/audio/speech.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('lookQuat looks along forward with a level horizon', () => {
  const up = V(0, 0, 1);
  const fwd = V(1, 0.2, -0.3);
  const q = lookQuat(fwd, up);
  const camFwd = V(0, 0, -1).applyQuaternion(q);
  const camRight = V(1, 0, 0).applyQuaternion(q);
  const camUp = V(0, 1, 0).applyQuaternion(q);
  near(camFwd.dot(fwd.clone().normalize()), 1);
  near(camRight.dot(up), 0); // no roll: right stays horizontal
  assert.ok(camUp.dot(up) > 0); // never upside down
  // degenerate: looking straight up still gives a valid rotation
  const q2 = lookQuat(V(0, 0, 1), up);
  near(q2.length(), 1);
});

test('orbitOffset: behind + elevation, positive azimuth to the right', () => {
  const back = V(0, 0, 1);
  const up = V(0, 1, 0);
  const o = orbitOffset(back, up, 0, 16 * D2R, 25);
  near(o.length(), 25);
  near(Math.asin(o.y / 25), 16 * D2R);
  const r = orbitOffset(back, up, 30 * D2R, 0, 10);
  assert.ok(r.x > 0, 'az > 0 moves toward +X (right of an observer facing -Z)');
});

test('horizontalDir and slerpAboutAxis stay on the horizon', () => {
  const up = V(0, 0, 1);
  const out = V();
  assert.equal(horizontalDir(V(0, 0, 5), up, out), false);
  assert.equal(horizontalDir(V(3, 4, 7), up, out), true);
  near(out.length(), 1);
  near(out.z, 0);
  const cur = V(1, 0, 0);
  slerpAboutAxis(cur, V(0, 1, 0), up, 0.5);
  near(cur.x, Math.SQRT1_2);
  near(cur.y, Math.SQRT1_2);
  near(cur.z, 0);
});

test('framing, head look, smoothing helpers', () => {
  const f = framingFov(5, 170, 0.3);
  assert.ok(f > 5 && f < 20, `fov ${f}`);
  assert.equal(framingFov(5, 0), 60);
  const q = headLookQuat(30 * D2R, 0);
  const d = V(0, 0, -1).applyQuaternion(q);
  assert.ok(d.x > 0, 'yaw + looks right');
  const q2 = headLookQuat(0, 20 * D2R);
  assert.ok(V(0, 0, -1).applyQuaternion(q2).y > 0, 'pitch + looks up');
  near(smoothK(0, 0.1), 0);
  assert.equal(smoothK(1, 0), 1);
  near(wrapAngle(3 * Math.PI), Math.PI);
});

test('stations: eye points come from the constants, docking views map across', () => {
  assert.ok(getStation('LM', 'CDR').eye.equals(LM.eyeCDR));
  assert.ok(getStation('LM', 'LMP').eye.equals(LM.eyeLMP));
  assert.ok(getStation('CSM', 'CMP').eye.equals(CSM.eyeCMP));
  assert.equal(getStation('CSM', 'nope').id, 'CDR');
  assert.equal(nextStation('LM', 'OVERHEAD'), 'CDR');
  assert.equal(nextStation('CSM', 'LMP'), 'RV');
  assert.equal(mapStation('LM', 'RV'), 'OVERHEAD');
  assert.equal(mapStation('CSM', 'OVERHEAD'), 'RV');
  assert.equal(mapStation('LM', 'CMP'), 'CDR');
  // overhead view looks up through the overhead window
  const s = getStation('LM', 'OVERHEAD');
  const look = V(0, 0, -1).applyQuaternion(s.base);
  near(look.y, 1);
  assert.ok(s.eye.y < LM.windows.overhead.center.y);
  // RV eye: looking along -Z passes through the rendezvous window centre
  const rv = getStation('CSM', 'RV');
  const w = CSM.windows.rendezvousLeft.center;
  near(rv.eye.x, w.x);
  near(rv.eye.y, w.y);
  assert.ok(rv.eye.z > w.z);
  for (const list of Object.values(STATIONS)) for (const st of list) assert.ok(st.fov >= 25 && st.fov <= 100);
});

test('speech text rewrites for the synthesiser', () => {
  assert.equal(spokenText('100 feet, 3 1/2 down, 9 forward.'), '100 feet, 3 and a half down, 9 forward.');
  assert.equal(spokenText('Roger. 1202 alarm.'), 'Roger. twelve oh 2 alarm.');
  assert.equal(spokenText('Program alarm — 1201'), 'Program alarm , twelve oh 1');
  assert.ok(speechDuration('one two three four') > 1);
  const voices = [
    { name: 'a', lang: 'de-DE', localService: true },
    { name: 'b', lang: 'en-GB', localService: true },
    { name: 'c', lang: 'en-US', localService: true },
    { name: 'd', lang: 'en-US', localService: true },
  ];
  assert.equal(pickVoice(voices, 0).name, 'c');
  assert.equal(pickVoice(voices, 1).name, 'd');
  assert.equal(pickVoice([], 0), null);
  assert.equal(pickVoice([{ name: 'x', lang: 'fr-FR' }], 2).name, 'x');
});

test('cabin vibration: engine rumble, ignition jolt and RCS thumps stay subtle and bounded', async () => {
  const { createShake } = await import('../src/render/camera/shake.js');
  const { createLM } = await import('../src/core/state.js');
  const lm = createLM();
  lm.mass = 15000;
  const q = new THREE.Quaternion();
  const sh = createShake();
  const dt = 1 / 60;
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    sh.update(dt, [lm], q);
    peak = Math.max(peak, sh.rotation.length());
  }
  assert.equal(peak, 0, 'quiet coast: no vibration');
  lm.mainEngine.firing = true; // ignition (off -> on)
  lm.mainEngine.throttle = 0.6;
  let ign = 0;
  for (let i = 0; i < 30; i++) {
    sh.update(dt, [lm], q);
    ign = Math.max(ign, sh.rotation.length());
  }
  let steady = 0;
  for (let i = 0; i < 180; i++) {
    sh.update(dt, [lm], q);
    if (i > 90) steady = Math.max(steady, sh.rotation.length());
  }
  assert.ok(ign > steady, `ignition jolt ${ign} > steady ${steady}`);
  assert.ok(steady > 0.0002 && steady < 0.01, `steady rumble ${(steady * 180) / Math.PI} deg`);
  // RCS: fire a yaw couple, then let it ring down
  lm.mainEngine.firing = false;
  lm.mainEngine.throttle = 0;
  for (let i = 0; i < 240; i++) sh.update(dt, [lm], q);
  const before = sh.rotation.length();
  for (const j of lm.rcs.jets.filter((j) => j.id.endsWith('X')).slice(0, 2)) j.level = 1;
  let kick = 0;
  for (let i = 0; i < 20; i++) {
    sh.update(dt, [lm], q);
    kick = Math.max(kick, sh.rotation.length());
  }
  assert.ok(kick > before + 0.0002, `RCS thump ${kick}`);
  assert.ok(kick < 0.03, 'bounded');
});

test('cockpit glances: presets aim at the LM panels and the DSKY', async () => {
  const { panelLayout } = await import('../src/render/cockpit/lm/layout.js');
  const { glancesOf, aimAt } = await import('../src/render/camera/stations.js');
  const P = panelLayout();
  const cdr = getStation('LM', 'CDR');
  const g = Object.fromEntries(glancesOf(cdr).map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(g), ['OUT', 'PANEL', 'DSKY']);
  // default view: out of the window, far enough down that the X-pointer shows at the bottom
  assert.equal(cdr.pitch, g.OUT.pitch);
  assert.ok(cdr.pitch <= -20 && cdr.pitch >= -30);
  // the DSKY glance looks straight at panel 4 (from the leaning eye)
  const eye = cdr.eye.clone().add(g.DSKY.lean);
  const toP4 = aimAt(eye, P.p4.frame.center);
  near(g.DSKY.yaw, toP4.yaw, 6);
  near(g.DSKY.pitch, toP4.pitch, 6);
  // ... with the head tilted so the DSKY reads upright
  const qd = headLookQuat(g.DSKY.yaw * D2R, g.DSKY.pitch * D2R).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), g.DSKY.roll * D2R));
  const upCam = P.p4.frame.up.clone().applyQuaternion(qd.clone().invert());
  assert.ok(Math.abs(upCam.x) < 0.02 && upCam.y > 0.5, `DSKY up in view ${upCam.toArray()}`);
  const rightCam = P.p4.frame.right.clone().applyQuaternion(qd.clone().invert());
  assert.ok(rightCam.x > 0.5, 'not mirrored');
  // the flight-display glance keeps panel 1B (FDAI, tapes) and the DSKY within its field of view
  const dir = (yaw, pitch) => V(0, 0, -1).applyQuaternion(headLookQuat(yaw * D2R, pitch * D2R));
  const look = dir(g.PANEL.yaw, g.PANEL.pitch);
  for (const p of [P.p1B.frame.center, P.p4.frame.center]) {
    const ang = look.angleTo(p.clone().sub(cdr.eye)) / D2R;
    assert.ok(ang < g.PANEL.fov / 2, `panel within ${ang.toFixed(1)} deg`);
  }
  // LMP mirrors the CDR
  const lmp = glancesOf(getStation('LM', 'LMP'));
  near(lmp[1].yaw, -g.PANEL.yaw);
  near(lmp[2].yaw, -g.DSKY.yaw, 1e-6);
  for (const list of Object.values(STATIONS)) for (const st of list) for (const x of glancesOf(st)) assert.ok(x.fov >= 25 && x.fov <= 100);
});

test('cockpit glances: GLANCE action cycles presets, leans the head and resets', async () => {
  const { createGameState } = await import('../src/core/state.js');
  const { createSim } = await import('../src/sim/sim.js');
  const { createCameras } = await import('../src/render/cameras.js');
  const game = createGameState({ scenario: null, warp: 1, camera: 'iva', vessel: null });
  const sim = createSim(game, { gnc: { update() {}, reset() {} } });
  const cams = createCameras(game, null);
  sim.loadScenario('lowgate');
  game.view.mode = 'iva';
  cams.update(1 / 60);
  const eye0 = game.view.cameraMCI.clone();
  assert.equal(cams.glanceId, 'OUT');
  game.events.emit('action', { name: 'GLANCE' });
  assert.equal(cams.glanceId, 'PANEL');
  assert.match(game.view.label, /Flight displays/);
  game.events.emit('action', { name: 'GLANCE' });
  assert.equal(game.view.glance, 'DSKY');
  for (let i = 0; i < 90; i++) cams.update(1 / 60);
  // the head turned down-right toward the DSKY and leaned 10 cm
  const fwd = V(0, 0, -1).applyQuaternion(game.view.quat).applyQuaternion(game.active.quat.clone().invert());
  assert.ok(fwd.y < -0.8 && fwd.x > 0.1, `looking down-right ${fwd.toArray()}`);
  const moved = game.view.cameraMCI.distanceTo(eye0);
  assert.ok(moved > 0.05, `leaned ${moved}`);
  game.events.emit('action', { name: 'GLANCE' });
  assert.equal(cams.glanceId, 'OUT');
  game.events.emit('action', { name: 'GLANCE', id: 'DSKY' });
  game.events.emit('action', { name: 'RESET_VIEW' });
  assert.equal(cams.glanceId, 'OUT');
  assert.doesNotMatch(game.view.label, /DSKY/);
  // a station without presets: glance() stays on its only view
  cams.setStation('OVERHEAD');
  assert.equal(cams.glance(), 'OUT');
});
