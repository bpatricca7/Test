// Flight dynamics: orbits, hover throttle, RCS torques, engines, mass properties.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameState } from '../src/core/state.js';
import { createSim } from '../src/sim/sim.js';
import { LM, CSM, MOON, G0 } from '../src/core/constants.js';
import { lmMassProps, LM_FULL_MASS } from '../src/sim/massprops.js';
import { keplerPropagate, orbitalEnergy } from '../src/sim/orbit.js';
import { createLM } from '../src/core/state.js';

// ---- helpers

/**
 * Create a game + sim with a scripted GNC stand-in.
 * @param {(game: object, h: number) => void} [control] called once per substep before physics
 */
function makeSim(control) {
  const game = createGameState({ scenario: null, warp: 1, camera: null, vessel: null });
  const events = [];
  for (const t of ['message', 'callout', 'touchdown', 'crash', 'engine', 'contact', 'alarm', 'dock', 'undock', 'stage', 'vessel']) {
    game.events.on(t, (p) => events.push({ t, p, met: game.time.met }));
  }
  const gnc = {
    update(h) {
      if (control) control(game, h);
    },
    reset() {},
  };
  const sim = createSim(game, { gnc });
  return { game, sim, events };
}

/** Advance the sim by `seconds` of 60-Hz frames (1x). */
function run(sim, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  let t = 0;
  for (let i = 0; i < n; i++) t += sim.step(dt, { ignoreWarp: true });
  return t;
}

/** Radial unit vector at a vessel. */
const upOf = (v) => v.pos.clone().normalize();


test('fully fuelled LM mass properties reproduce the constants', () => {
  const lm = createLM();
  const mp = lmMassProps(lm);
  assert.ok(Math.abs(mp.mass - LM_FULL_MASS) < 1e-9);
  assert.ok(Math.abs(mp.inertia.x - LM.inertiaFull.x) < 1e-6);
  assert.ok(Math.abs(mp.inertia.y - LM.inertiaFull.y) < 1e-6);
  assert.ok(Math.abs(mp.inertia.z - LM.inertiaFull.z) < 1e-6);
  // CG between the two stages, close to the centreline
  assert.ok(mp.cg.y > 2.2 && mp.cg.y < 4.4, `cg.y ${mp.cg.y}`);
  assert.ok(Math.abs(mp.cg.x) < 1e-9 && Math.abs(mp.cg.z) < 0.1);
});

test('111 km circular orbit holds altitude within +-50 m for 2 h at 1000x', () => {
  const { game, sim } = makeSim();
  sim.loadScenario('undock'); // docked stack in the 111-km orbit, no GNC activity
  const csm = game.vessels.CSM;
  game.time.warp = 1000;
  const r0 = csm.tel.altitudeRef;
  const cgW = () => csm.cg.clone().applyQuaternion(csm.quat).add(csm.pos);
  const e0 = orbitalEnergy(cgW(), game.vessels.CSM.vel);
  let lo = Infinity;
  let hi = -Infinity;
  let t = 0;
  let frames = 0;
  while (t < 7200) {
    t += sim.step(1 / 60);
    frames++;
    lo = Math.min(lo, csm.tel.altitudeRef);
    hi = Math.max(hi, csm.tel.altitudeRef);
  }
  assert.equal(game.time.warpActual, 1000);
  assert.ok(frames < 500, `warp not applied (${frames} frames)`);
  assert.ok(hi - r0 < 50 && r0 - lo < 50, `altitude band ${lo.toFixed(1)}..${hi.toFixed(1)} (start ${r0.toFixed(1)})`);
  const e1 = orbitalEnergy(cgW(), csm.vel);
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-6, `energy drift ${(e1 - e0) / e0}`);
});

test('Verlet coast matches the analytic Kepler solution', () => {
  const { game, sim } = makeSim();
  sim.loadScenario('undock');
  const csm = game.vessels.CSM;
  const cg0 = csm.cg.clone().applyQuaternion(csm.quat).add(csm.pos);
  const ref = keplerPropagate(cg0, csm.vel.clone(), 3600);
  game.time.warp = 1000;
  let t = 0;
  while (t < 3600 - 1e-6) t += sim.step(Math.min(1 / 60, (3600 - t) / 1000));
  const cg1 = csm.cg.clone().applyQuaternion(csm.quat).add(csm.pos);
  assert.ok(cg1.distanceTo(ref.pos) < 100, `position error ${cg1.distanceTo(ref.pos).toFixed(1)} m after 1 h`);
});

test('hover throttle m*g/Fmax holds the LM level', () => {
  const { game, sim } = makeSim((g) => {
    const lm = g.vessels.LM;
    lm.mainEngine.throttleCmd = lm.ctrl.throttle;
  });
  sim.loadScenario('hover');
  const lm = game.vessels.LM;
  const r = lm.cg.clone().applyQuaternion(lm.quat).add(lm.pos).length();
  const expected = (lm.mass * MOON.mu / (r * r)) / LM.dps.maxThrust;
  assert.ok(Math.abs(lm.tel.hoverThrottle - expected) < 1e-9);
  assert.ok(Math.abs(lm.ctrl.throttle - expected) < 2e-3, `scenario throttle ${lm.ctrl.throttle} vs ${expected}`);
  const alt0 = lm.tel.altitude;
  run(sim, 3);
  assert.ok(Math.abs(lm.tel.vSpeed) < 0.03, `vSpeed ${lm.tel.vSpeed}`);
  assert.ok(Math.abs(lm.tel.altitude - alt0) < 0.05, `altitude change ${lm.tel.altitude - alt0}`);
  assert.equal(lm.mainEngine.firing, true);
});

test('DPS: start transient, throttle lag, minimum throttle, propellant flow', () => {
  let cmd = 0;
  const { game, sim, events } = makeSim((g) => {
    g.vessels.LM.mainEngine.throttleCmd = cmd;
  });
  sim.loadScenario('undock');
  sim.undock();
  run(sim, 0.5);
  const lm = game.vessels.LM;
  const e = lm.mainEngine;
  cmd = 0.05; // below the 10 % minimum
  run(sim, 0.1);
  assert.ok(e.firing && e.throttle > 0 && e.throttle < 0.1, `start transient ${e.throttle}`);
  assert.ok(events.some((x) => x.t === 'engine' && x.p.on && x.p.engine === 'DPS'));
  run(sim, 1);
  assert.ok(Math.abs(e.throttle - 0.1) < 1e-3, `min throttle ${e.throttle}`);
  cmd = 1;
  run(sim, 0.25);
  assert.ok(e.throttle > 0.5 && e.throttle < 0.8, `lagging throttle ${e.throttle}`);
  run(sim, 2);
  assert.ok(e.throttle > 0.99);
  const p0 = lm.propellant.main;
  run(sim, 1);
  const mdot = LM.dps.maxThrust / (LM.dps.isp * G0);
  assert.ok(Math.abs(p0 - lm.propellant.main - mdot) < 0.05, `flow ${p0 - lm.propellant.main} vs ${mdot}`);
  cmd = 0;
  run(sim, 0.5);
  assert.equal(e.firing, false);
  assert.equal(e.throttle, 0);
});

/** Drive a set of jets (by id) at full duty for `seconds`, starting from rest. */
function jetTest(scenario, vesselId, jetIds, seconds) {
  const { game, sim } = makeSim((g) => {
    for (const j of g.vessels[vesselId].rcs.jets) j.cmd = jetIds.includes(j.id) ? 1 : 0;
  });
  sim.loadScenario(scenario);
  if (game.vessels.LM.docked) sim.undock();
  const v = game.vessels[vesselId];
  v.angVel.set(0, 0, 0);
  run(sim, seconds);
  return v;
}

test('LM RCS pitch-up couple (Q1D, Q4D, Q2U, Q3U) gives +wx of the right size', () => {
  const lm = jetTest('undock', 'LM', ['Q1D', 'Q4D', 'Q2U', 'Q3U'], 1);
  assert.ok(lm.angVel.x > 0, `wx ${lm.angVel.x}`);
  // expected: 4 jets x 445 N x 1.55 m lever (the up/down forces are parallel to the body Y axis)
  const expected = (4 * LM.rcs.thrust * LM.rcs.quadRadius) / lm.inertia.x;
  assert.ok(Math.abs(lm.angVel.x - expected) / expected < 0.02, `wx ${lm.angVel.x} expected ${expected}`);
  assert.ok(Math.abs(lm.angVel.y) < 0.02 * expected && Math.abs(lm.angVel.z) < 0.02 * expected);
});

test('LM RCS yaw and roll jets produce the documented signs', () => {
  // roll right (right side down) = -wz: push the right side down (Q1U, Q2U exhaust up) and left up (Q3D, Q4D)
  const lmR = jetTest('undock', 'LM', ['Q1U', 'Q2U', 'Q3D', 'Q4D'], 0.5);
  assert.ok(lmR.angVel.z < 0, `roll wz ${lmR.angVel.z}`);
  // yaw right (nose right) = -wy: front quads push +X... front pushed right = nose right
  // Q4X exhausts -X at the front-left quad -> pushes +X at the front; Q2X exhausts +X at the aft-right -> pushes -X aft
  const lmY = jetTest('undock', 'LM', ['Q4X', 'Q2X'], 0.5);
  assert.ok(lmY.angVel.y < 0, `yaw wy ${lmY.angVel.y}`);
});

test('CSM RCS pitch-up (quad A aft-push, quad C forward-push) gives +wx', () => {
  const csm = jetTest('undock', 'CSM', ['AF', 'CA'], 1);
  assert.ok(csm.angVel.x > 0, `wx ${csm.angVel.x}`);
  const lever = CSM.rcs.quadRadius * Math.cos(CSM.rcs.quadAngles[0]);
  const expected = (2 * CSM.rcs.thrust * lever) / csm.inertia.x;
  assert.ok(Math.abs(csm.angVel.x - expected) / expected < 0.1, `wx ${csm.angVel.x} expected ${expected}`);
});

test('translation jets change velocity by F/m and burn F/(Isp g0)', () => {
  const { game, sim } = makeSim((g) => {
    for (const j of g.vessels.LM.rcs.jets) j.cmd = ['Q1D', 'Q2D', 'Q3D', 'Q4D'].includes(j.id) ? 1 : 0;
  });
  sim.loadScenario('undock');
  sim.undock();
  run(sim, 0.2);
  const lm = game.vessels.LM;
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(lm.quat);
  const csmVel = game.vessels.CSM.vel.clone();
  const v0 = lm.vel.clone().sub(csmVel).dot(up);
  const rcs0 = lm.propellant.rcs;
  run(sim, 2);
  const dv = lm.vel.clone().sub(game.vessels.CSM.vel).dot(up) - v0;
  const expected = (4 * 445 * 2) / lm.mass;
  assert.ok(Math.abs(dv - expected) / expected < 0.03, `dv ${dv} vs ${expected}`);
  const used = rcs0 - lm.propellant.rcs;
  assert.ok(Math.abs(used - (4 * 445 * 2) / (290 * G0)) < 0.01, `rcs used ${used}`);
  void upOf;
});
