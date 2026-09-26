// Docked stack, docking capture, undocking, actions and time warp.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameState } from '../src/core/state.js';
import { createSim } from '../src/sim/sim.js';
import { LM, CSM } from '../src/core/constants.js';

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
const world = (v, p) => p.clone().applyQuaternion(v.quat).add(v.pos);
const axis = (v, x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(v.quat);

test('docked transform: LM +Y = CSM +Z, LM +X = CSM +X, ports coincide', () => {
  const { sim, game } = makeSim();
  sim.loadScenario('undock');
  const { LM: lm, CSM: csm } = game.vessels;
  assert.ok(lm.docked && csm.docked);
  run(sim, 5); // stays rigid while coasting
  assert.ok(world(lm, LM.docking.port).distanceTo(world(csm, CSM.docking.port)) < 1e-6);
  assert.ok(axis(lm, 0, 1, 0).distanceTo(axis(csm, 0, 0, 1)) < 1e-9);
  assert.ok(axis(lm, 1, 0, 0).distanceTo(axis(csm, 1, 0, 0)) < 1e-9);
  // stack mass properties seen from both vessels agree
  assert.ok(Math.abs(lm.stack.mass - (lm.mass + csm.mass)) < 1e-6);
  assert.equal(lm.stack.mass, csm.stack.mass);
  assert.ok(world(lm, lm.stack.cg).distanceTo(world(csm, csm.stack.cg)) < 1e-6);
  assert.ok(Math.abs(lm.stack.inertia.x - csm.stack.inertia.x) < 1e-6);
  assert.ok(Math.abs(lm.stack.inertia.y - csm.stack.inertia.z) < 1e-6);
  // both vessels share the same rigid motion
  assert.ok(lm.vel.distanceTo(csm.vel) < 1e-3);
});

test('LM jets rotate the docked stack', () => {
  const { sim, game } = makeSim((g) => {
    for (const j of g.vessels.LM.rcs.jets) j.cmd = ['Q1D', 'Q4D', 'Q2U', 'Q3U'].includes(j.id) ? 1 : 0;
  });
  sim.loadScenario('undock');
  run(sim, 2);
  const { LM: lm, CSM: csm } = game.vessels;
  assert.ok(lm.angVel.x > 0, 'LM pitches up');
  // same physical rotation expressed in both frames
  const wL = lm.angVel.clone().applyQuaternion(lm.quat);
  const wC = csm.angVel.clone().applyQuaternion(csm.quat);
  assert.ok(wL.distanceTo(wC) < 1e-9);
  // much slower than the LM alone (stack inertia)
  assert.ok(lm.angVel.x < (2 * 4 * 445 * 1.55) / lm.inertia.x * 0.5);
});

test('undocking: 0.1 m/s spring separation, momentum conserved', () => {
  const { sim, game, events } = makeSim();
  sim.loadScenario('undock');
  const { LM: lm, CSM: csm } = game.vessels;
  const p0 = lm.vel.clone().multiplyScalar(lm.mass).addScaledVector(csm.vel, csm.mass);
  game.events.emit('action', { name: 'UNDOCK' });
  assert.equal(lm.docked, false);
  assert.equal(lm.stack, null);
  assert.ok(events.some((e) => e.t === 'undock'));
  assert.ok(events.some((e) => e.t === 'callout' && /wings/.test(e.p.text)));
  const p1 = lm.vel.clone().multiplyScalar(lm.mass).addScaledVector(csm.vel, csm.mass);
  assert.ok(p1.distanceTo(p0) / (lm.mass + csm.mass) < 1e-9);
  const rel = lm.vel.clone().sub(csm.vel);
  const yL = axis(lm, 0, 1, 0);
  assert.ok(Math.abs(-rel.dot(yL) - 0.1) < 1e-6, `sep ${-rel.dot(yL)}`);
  const d0 = world(lm, LM.docking.port).distanceTo(world(csm, CSM.docking.port));
  run(sim, 10);
  const d1 = world(lm, LM.docking.port).distanceTo(world(csm, CSM.docking.port));
  assert.ok(Math.abs(d1 - d0 - 1.0) < 0.05, `separation after 10 s: ${d1 - d0}`);
  assert.equal(lm.docked, false, 'no immediate re-capture');
});

test('automatic docking: slow aligned approach -> capture -> hard dock', () => {
  const { sim, game, events } = makeSim();
  sim.loadScenario('docking');
  const { LM: lm, CSM: csm } = game.vessels;
  assert.equal(lm.staged, true);
  // move to 1 m short of the drogue, closing at 0.3 m/s along the CSM nose axis
  // (from 15 m out, orbital relative motion would drift the probe off-axis without corrections)
  csm.pos.addScaledVector(axis(csm, 0, 0, -1), 14);
  csm.vel.addScaledVector(axis(csm, 0, 0, -1), 0.3);
  let t = 0;
  while (!lm.docked && t < 10) t += sim.step(1 / 60, { ignoreWarp: true });
  assert.ok(lm.docked, 'captured');
  assert.ok(events.some((e) => e.t === 'callout' && e.p.text === 'Capture.'));
  run(sim, 1.5);
  assert.ok(events.some((e) => e.t === 'dock'), 'hard dock');
  assert.ok(world(lm, LM.docking.port).distanceTo(world(csm, CSM.docking.port)) < 1e-6);
  assert.ok(axis(lm, 0, 1, 0).distanceTo(axis(csm, 0, 0, 1)) < 1e-9);
  // one rigid body: the CG velocities differ only by w x r
  const wW = csm.angVel.clone().applyQuaternion(csm.quat);
  const r = world(lm, lm.cg).sub(world(csm, csm.cg));
  const expected = new THREE.Vector3().crossVectors(wW, r);
  assert.ok(lm.vel.clone().sub(csm.vel).distanceTo(expected) < 1e-9);
});

test('fast approach bounces off without capture', () => {
  const { sim, game, events } = makeSim();
  sim.loadScenario('docking');
  const { LM: lm, CSM: csm } = game.vessels;
  csm.vel.addScaledVector(axis(csm, 0, 0, -1), 1.0);
  run(sim, 25);
  assert.equal(lm.docked, false);
  assert.ok(events.some((e) => e.t === 'message' && /no capture/.test(e.p.text)));
});

test('time warp: levels, limits under thrust and in ground contact', () => {
  let cmd = 0;
  const { sim, game } = makeSim((g) => {
    g.vessels.LM.mainEngine.throttleCmd = cmd;
  });
  sim.loadScenario('undock');
  for (let i = 0; i < 6; i++) game.events.emit('action', { name: 'WARP_UP' });
  assert.equal(game.time.warp, 1000);
  sim.step(1 / 60);
  assert.equal(game.time.warpActual, 1000);
  cmd = 0.5;
  const dt = sim.step(1 / 60);
  assert.ok(dt <= 1 / 60 * 1000 + 1e-9);
  sim.step(1 / 60);
  assert.equal(game.time.warpActual, 10, 'limited while the DPS fires');
  cmd = 0;
  run(sim, 1);
  sim.step(1 / 60);
  assert.equal(game.time.warpActual, 1000, 'restored');
  game.events.emit('action', { name: 'WARP_DOWN' });
  assert.equal(game.time.warp, 100);
  game.events.emit('action', { name: 'WARP_RESET' });
  assert.equal(game.time.warp, 1);
  // ground contact -> 1x
  sim.loadScenario('hover');
  game.time.warp = 100;
  sim.step(1 / 60);
  assert.equal(game.time.warpActual, 10, 'below 5 km');
});

test('SWITCH_VESSEL, PAUSE and RESTART actions', () => {
  const { sim, game, events } = makeSim();
  sim.loadScenario('undock');
  const lm = game.vessels.LM;
  lm.ctrl.pitch = 0.7;
  game.events.emit('action', { name: 'SWITCH_VESSEL' });
  assert.equal(game.activeId, 'CSM');
  assert.equal(lm.ctrl.pitch, 0);
  assert.ok(events.some((e) => e.t === 'vessel' && e.p.id === 'CSM'));
  game.events.emit('action', { name: 'SWITCH_VESSEL', to: 'LM' });
  assert.equal(game.activeId, 'LM');
  game.events.emit('action', { name: 'PAUSE' });
  assert.equal(game.time.paused, true);
  game.events.emit('action', { name: 'PAUSE' });
  assert.equal(game.time.paused, false);
  const met0 = game.time.met;
  run(sim, 2);
  game.events.emit('action', { name: 'RESTART' });
  assert.equal(game.time.met, met0);
  assert.ok(game.vessels.LM.docked);
});

test('every scenario loads with sane, documented initial conditions', () => {
  const { sim, game } = makeSim();
  for (const sc of sim.scenarios) {
    for (const k of ['id', 'title', 'subtitle', 'description', 'difficulty', 'activeId', 'camera']) assert.ok(sc[k], `${sc.id}.${k}`);
    sim.loadScenario(sc.id);
    assert.equal(game.scenarioId, sc.id);
    for (const v of Object.values(game.vessels)) {
      for (const [k, x] of Object.entries(v.tel)) if (typeof x === 'number' && k !== 'radarAltitude' && k !== 'bingoSeconds') assert.ok(!Number.isNaN(x), `${sc.id} ${v.id}.tel.${k} is NaN`);
      assert.ok(v.tel.altitude > -1, `${sc.id} ${v.id} below ground`);
    }
    run(sim, 0.5);
    assert.ok(!game.vessels.LM.crashed && !game.vessels.CSM.crashed, `${sc.id} crashed`);
  }
  assert.deepEqual(sim.scenarios.map((s) => s.id).slice(0, 7), ['pdi', 'highgate', 'lowgate', 'hover', 'undock', 'landed', 'csm']);
});
