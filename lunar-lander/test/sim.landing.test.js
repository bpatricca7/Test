// Landing gear, touchdown evaluation, crashes and staging.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameState } from '../src/core/state.js';
import { createSim } from '../src/sim/sim.js';
import { LM } from '../src/core/constants.js';

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
/** Hover scenario, engine off, gear `gearAlt` m above the ground, moving down at vs and forward at hs. */
function dropLM(vs, hs = 0, gearAlt = 0.05) {
  const ctx = makeSim((g) => {
    g.vessels.LM.mainEngine.throttleCmd = g.vessels.LM.ctrl.throttle;
  });
  ctx.sim.loadScenario('hover');
  const lm = ctx.game.vessels.LM;
  lm.ctrl.throttle = 0;
  const up = upOf(lm);
  lm.pos.addScaledVector(up, -(lm.tel.gearAltitude - gearAlt));
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(lm.quat);
  lm.vel.copy(up).multiplyScalar(-vs).addScaledVector(fwd, hs);
  return { ...ctx, lm };
}

test('the LM rests on its gear without drifting or sinking (60 s)', () => {
  const { sim, lm, game } = dropLM(0, 0, 0.02);
  run(sim, 5);
  assert.equal(lm.landed, true, 'settled and landed');
  const p0 = lm.pos.clone();
  const q0 = lm.quat.clone();
  const alt0 = lm.tel.gearAltitude;
  run(sim, 60);
  assert.ok(lm.pos.distanceTo(p0) < 0.01, `drift ${lm.pos.distanceTo(p0)} m`);
  assert.ok(Math.abs(lm.tel.gearAltitude - alt0) < 0.001, 'no sinking');
  assert.ok(q0.angleTo(lm.quat) < 1e-4, 'no rotation');
  assert.ok(lm.gear.pads.filter((p) => p.contact).length >= 3);
  assert.equal(game.result.outcome, 'landed');
});

test('the landed scenario is settled, stable and ready for P12', () => {
  const { sim, game } = makeSim();
  sim.loadScenario('landed');
  const lm = game.vessels.LM;
  assert.equal(lm.landed, true);
  assert.equal(lm.gnc.program, 'P12');
  assert.equal(lm.gear.probeContact, true);
  assert.ok(lm.gear.pads.every((p) => p.compression > 0));
  const p0 = lm.pos.clone();
  run(sim, 30);
  assert.ok(lm.pos.distanceTo(p0) < 0.01);
  assert.ok(Math.abs(lm.tel.gearAltitude) < 0.5);
  assert.equal(game.result, null);
});

test('1 m/s touchdown -> landed (soft, gear strokes a little)', () => {
  const { sim, lm, game, events } = dropLM(1.0);
  run(sim, 6);
  assert.ok(game.result, 'result set');
  assert.equal(game.result.outcome, 'landed');
  assert.ok(['perfect', 'good'].includes(game.result.rating));
  assert.ok(Math.abs(game.result.vSpeed - 1.0) < 0.15, `vSpeed ${game.result.vSpeed}`);
  assert.equal(lm.landed, true);
  assert.equal(lm.crashed, false);
  assert.ok(events.some((e) => e.t === 'touchdown'));
  assert.ok(game.result.score > 50 && game.result.score <= 100);
  assert.ok(lm.gear.pads.every((p) => p.compression < 0.2));
});

test('5 m/s touchdown -> crash (gear collapses) and 3.5 m/s -> hard', () => {
  const a = dropLM(5.0);
  run(a.sim, 4);
  assert.ok(a.game.result);
  assert.equal(a.game.result.outcome, 'crashed');
  assert.equal(a.lm.crashed, true);
  assert.ok(a.events.some((e) => e.t === 'crash'));
  const b = dropLM(3.5);
  run(b.sim, 6);
  assert.ok(b.game.result);
  assert.ok(['hard', 'crashed'].includes(b.game.result.outcome), b.game.result.outcome);
  assert.equal(b.game.result.rating, 'hard');
});

test('contact probes light LUNAR CONTACT before the pads touch', () => {
  const { sim, lm, events } = dropLM(0.5, 0, 1.5);
  run(sim, 0.5);
  assert.equal(lm.gear.probeContact, true);
  assert.equal(lm.cw.lights['LUNAR CONTACT'], true);
  assert.ok(events.some((e) => e.t === 'callout' && e.p.text === 'Contact light.'));
  assert.ok(lm.gear.pads.every((p) => !p.contact));
});

test('high ground speed at touchdown tips the LM over', () => {
  const { sim, game } = dropLM(1.0, 4.0);
  run(sim, 12);
  assert.ok(game.result);
  assert.equal(game.result.outcome, 'tipped');
  assert.ok(game.result.hSpeed > 3.5, `first-contact ground speed ${game.result.hSpeed}`);
  const b = dropLM(0.8, 2.0);
  run(b.sim, 12);
  assert.equal(b.game.result.outcome, 'hard', 'beyond the 1.2 m/s lateral limit but upright');
});

test('ascent-stage separation on the surface: masses, APS, descent stage left behind', () => {
  let cmd = 0;
  const { sim, game, events } = makeSim((g) => {
    g.vessels.LM.mainEngine.throttleCmd = cmd;
  });
  sim.loadScenario('landed');
  const lm = game.vessels.LM;
  const padPos = lm.pos.clone();
  cmd = 1; // P12 is loaded: an ignition command on the surface stages automatically
  run(sim, 0.05);
  assert.equal(lm.staged, true);
  assert.ok(events.some((e) => e.t === 'stage'));
  assert.equal(lm.mainEngine.name, 'APS');
  assert.equal(lm.mainEngine.maxThrust, LM.aps.maxThrust);
  assert.equal(lm.propellant.mainMax, LM.ascentPropMax);
  const expectedMass = LM.ascentDryMass + lm.propellant.main + lm.propellant.rcs;
  assert.ok(Math.abs(lm.mass - expectedMass) < 0.2, `mass ${lm.mass} vs ${expectedMass}`);
  assert.ok(lm.descentStage && lm.descentStage.landed);
  assert.ok(lm.descentStage.pos.distanceTo(padPos) < 1e-9);
  run(sim, 10);
  assert.ok(lm.tel.gearAltitude > 20, `climbing: ${lm.tel.gearAltitude}`);
  assert.ok(lm.tel.vSpeed > 5);
  assert.ok(lm.descentStage.pos.distanceTo(padPos) < 1e-9, 'descent stage stays put');
  assert.equal(lm.landed, false);
});

test('ABORT STAGE in flight: descent stage falls and comes to rest, ascent stage climbs', () => {
  const { sim, game } = makeSim((g) => {
    const lm = g.vessels.LM;
    lm.mainEngine.throttleCmd = lm.ctrl.throttle;
  });
  sim.loadScenario('hover');
  const lm = game.vessels.LM;
  game.events.emit('action', { name: 'STAGE' });
  assert.equal(lm.staged, true);
  assert.ok(lm.descentStage.falling);
  run(sim, 12);
  assert.equal(lm.descentStage.falling, false);
  assert.ok(lm.tel.altitude > 80, `ascent stage climbing ${lm.tel.altitude}`);
});
