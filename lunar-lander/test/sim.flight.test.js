// Flight-level sim behaviour with the real GNC: engine depletion, ABORT STAGE / insertion
// handover, vessel switching, time warp around ignitions, crash wording and units.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameState } from '../src/core/state.js';
import { createSim, WARP_IGN } from '../src/sim/sim.js';
import { createGNC } from '../src/gnc/gnc.js';
import { DOCK } from '../src/sim/docking.js';
import { fmtSpeed, fmtOrbit } from '../src/sim/units.js';

function makeGame(scenario, settings = {}) {
  const game = createGameState({ scenario: null, warp: 1 });
  Object.assign(game.settings, settings);
  const gnc = createGNC(game);
  const sim = createSim(game, { gnc });
  const events = [];
  for (const t of ['message', 'engine', 'crash', 'touchdown', 'program', 'stage', 'vessel']) game.events.on(t, (p) => events.push({ t, p, met: game.time.met }));
  sim.loadScenario(scenario);
  const act = (name, o = {}) => game.events.emit('action', { name, ...o });
  return { game, gnc, sim, events, act, lm: game.vessels.LM, csm: game.vessels.CSM };
}

/** Advance `seconds` of simulated time in 60-Hz frames (1x unless `warp`). */
function run(sim, seconds, { warp = false, dt = 1 / 60, until } = {}) {
  let t = 0;
  while (t < seconds - 1e-9) {
    t += sim.step(dt, warp ? {} : { ignoreWarp: true });
    if (until && until()) break;
  }
  return t;
}

test('running the DPS dry: exactly one shutdown message and one engine-off event', () => {
  const { sim, lm, events } = makeGame('hover');
  lm.propellant.main = 3;
  run(sim, 3);
  assert.equal(lm.propellant.main, 0);
  assert.equal(lm.mainEngine.firing, false);
  assert.equal(events.filter((e) => e.t === 'message' && /depleted/.test(e.p.text)).length, 1);
  assert.equal(events.filter((e) => e.t === 'engine' && e.p.on === false).length, 1);
});

test('ABORT STAGE from a hover: P71 reaches orbit and the APS stays off after insertion', () => {
  const { sim, lm, act, events } = makeGame('hover');
  run(sim, 1);
  act('STAGE');
  assert.equal(lm.staged, true);
  assert.equal(lm.gnc.program, 'P71');
  assert.equal(lm.ctrl.throttle, 0, 'TTCA lever to OFF (it only ever set the DPS)');
  run(sim, 470, { dt: 1 / 30, until: () => lm.gnc.program === 'P00' });
  run(sim, 30, { dt: 1 / 30 });
  assert.ok(events.some((e) => e.t === 'message' && /Insertion/.test(e.p.text)), 'insertion');
  assert.equal(lm.gnc.program, 'P00');
  assert.equal(lm.mainEngine.firing, false, 'no relight in P00');
  assert.ok(lm.propellant.main > 20, `ascent propellant kept: ${lm.propellant.main}`);
  assert.ok(lm.tel.periapsisAlt > 10e3 && lm.tel.apoapsisAlt < 120e3, `orbit ${lm.tel.apoapsisAlt} x ${lm.tel.periapsisAlt}`);
  assert.equal(events.filter((e) => e.t === 'engine' && e.p.engine === 'APS' && e.p.on).length, 1, 'one APS ignition');
});

test('switching away from a manual hover keeps Eagle flying (lever kept, LGC takes P66 AUTO)', () => {
  const { sim, lm, act, game } = makeGame('hover');
  run(sim, 1);
  const lever = lm.ctrl.throttle;
  assert.ok(lever > 0.2);
  act('SWITCH_VESSEL');
  assert.equal(game.activeId, 'CSM');
  assert.equal(lm.gnc.program, 'P66');
  assert.equal(lm.gnc.autopilot, 'GUIDANCE');
  run(sim, 15);
  assert.equal(lm.crashed, false);
  assert.equal(lm.mainEngine.firing, true);
  assert.ok(lm.tel.gearAltitude > 5, `still flying at ${lm.tel.gearAltitude}`);
});

test('switching away does not move the throttle lever of a manual burn', () => {
  const { lm, act, game } = makeGame('csm');
  const csm = game.vessels.CSM;
  csm.ctrl.throttle = 0.7;
  csm.ctrl.pitch = 0.5;
  game.activeId = 'CSM';
  act('SWITCH_VESSEL', { to: 'LM' });
  assert.equal(csm.ctrl.throttle, 0.7, 'friction lever');
  assert.equal(csm.ctrl.pitch, 0, 'spring-loaded stick back in detent');
  assert.equal(game.activeId, 'LM');
  assert.ok(lm);
});

test('time warp stops 10 s before PDI and a missed ignition never restores 1000x', () => {
  const { sim, game, lm, act, events } = makeGame('pdi');
  for (let i = 0; i < 6; i++) act('WARP_UP');
  assert.equal(game.time.warp, 1000);
  const tig = lm.gnc.tig;
  assert.ok(Number.isFinite(tig));
  // 6 s of wall clock: 10x down to TIG-10 s, then real time
  for (let i = 0; i < 6 * 60; i++) sim.step(1 / 60);
  assert.equal(game.time.warp, 1, 'request reset');
  assert.equal(game.time.warpActual, 1);
  assert.ok(events.some((e) => e.t === 'message' && /Time warp stopped/.test(e.p.text)));
  assert.ok(game.time.met < tig - WARP_IGN.STOP + 6.5, 'real time inside the ignition window');
  // let TIG pass unanswered, for 20 s more of wall clock
  for (let i = 0; i < 20 * 60; i++) sim.step(1 / 60);
  assert.equal(lm.mainEngine.firing, false);
  assert.ok(game.time.met - tig < 15, `still at real time after the missed TIG: ${game.time.met - tig}`);
  assert.ok(!events.some((e) => e.t === 'message' && /restored/.test(e.p.text)));
  // requesting warp inside the window is refused
  act('WARP_UP');
  assert.equal(game.time.warp, 1);
});

test('high-energy impacts read as impacts, gear failures quote the sink rate (player units)', () => {
  const drop = (vs, hs, units) => {
    const { sim, lm, act, game } = makeGame('hover', { units });
    act('ENGINE_STOP');
    lm.ctrl.throttle = 0;
    const up = lm.pos.clone().normalize();
    lm.pos.addScaledVector(up, -(lm.tel.gearAltitude - 0.3));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(lm.quat);
    lm.vel.copy(up).multiplyScalar(-vs).addScaledVector(fwd, hs);
    run(sim, 3, { until: () => lm.crashed });
    return { lm, game };
  };
  const a = drop(140, 1281, 'imperial');
  assert.equal(a.lm.crashed, true);
  assert.match(a.lm.crashReason, /^Impact with the surface at [\d,]+ ft\/s \(\d+ ft\/s vertical\)$/);
  const b = drop(4.5, 0, 'imperial');
  assert.match(b.lm.crashReason, /Landing gear collapsed .*ft\/s down/);
  const c = drop(4.5, 0, 'metric');
  assert.match(c.lm.crashReason, /m\/s down/);
});

test('unit helpers', () => {
  const imp = { settings: { units: 'imperial' } };
  const met = { settings: { units: 'metric' } };
  assert.equal(fmtSpeed(imp, 0.6096, 2), '2.0 ft/s');
  assert.equal(fmtSpeed(met, 0.52, 2), '0.52 m/s');
  assert.equal(fmtSpeed(imp, 390.5, 0), '1,281 ft/s');
  assert.equal(fmtOrbit(imp, 88e3, 16.7e3), '47.5 × 9.0 nmi');
  assert.equal(fmtOrbit(met, 88e3, 16.7e3), '88.0 × 16.7 km');
});

test('docking capture envelope follows the Apollo probe (about 1 ft/s)', () => {
  assert.ok(DOCK.CAPTURE_CLOSING <= 0.4 && DOCK.CAPTURE_CLOSING >= 0.3);
  assert.ok(DOCK.RETRACT_TIME >= 4);
});

test('Final Descent hands-off: the LGC eases the ROD off so Eagle is not lost', () => {
  const { sim, lm, game } = makeGame('lowgate');
  run(sim, 90, { dt: 1 / 30, until: () => lm.crashed || (lm.landed && lm.phys.sleeping) });
  assert.equal(lm.crashed, false, lm.crashReason || '');
  assert.ok(game.result && ['landed', 'hard'].includes(game.result.outcome), game.result?.outcome);
});
