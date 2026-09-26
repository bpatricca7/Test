// GNC — crew procedures across programs: manual liftoff after staging, the latching ENGINE STOP,
// attitude hold after long rotations, the LPD geometry in P64 and the undock -> DOI -> PDI flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../src/core/state.js';
import { createSim } from '../src/sim/sim.js';
import { createGNC } from '../src/gnc/gnc.js';
import { LPD_AZIMUTH } from '../src/gnc/guidance.js';

const R2D = 180 / Math.PI;

function makeSim(scenario) {
  const game = createGameState({ scenario: null, warp: 1 });
  const gnc = createGNC(game);
  const sim = createSim(game, { gnc });
  const events = [];
  for (const t of ['program', 'message', 'contact', 'touchdown', 'crash', 'stage']) game.events.on(t, (p) => events.push({ t, p, met: game.time.met }));
  sim.loadScenario(scenario);
  const step = (s) => {
    for (let i = 0; i < Math.round(s * 60); i++) sim.step(1 / 60, { ignoreWarp: true });
  };
  const act = (name, o = {}) => game.events.emit('action', { name, ...o });
  return { game, gnc, sim, events, step, act };
}

test('landed: STAGE before the P12 TIG, then throttle up -> manual liftoff', () => {
  const { game, step, act, events } = makeSim('landed');
  const lm = game.vessels.LM;
  step(1);
  act('STAGE');
  step(0.5);
  assert.equal(lm.gnc.program, 'P00');
  assert.equal(lm.gnc.throttleMode, 'MANUAL');
  assert.ok(events.some((e) => e.t === 'message' && /manual liftoff/.test(e.p.text)));
  lm.ctrl.throttle = 1;
  step(8);
  assert.ok(lm.mainEngine.firing, 'APS firing');
  assert.ok(lm.tel.altitude > 20, `ascent stage climbing (${lm.tel.altitude.toFixed(1)} m)`);
});

test('landed: STAGE, then PRO loads P12 and the guided ascent fires at its TIG', () => {
  const { game, step, act } = makeSim('landed');
  const lm = game.vessels.LM;
  step(1);
  act('STAGE');
  step(0.5);
  act('PRO');
  assert.equal(lm.gnc.program, 'P12');
  for (let i = 0; i < 20 * 60 && !lm.mainEngine.firing; i++) {
    if (lm.agc.flashVerbNoun) act('PRO');
    step(1 / 60);
  }
  step(6);
  assert.ok(lm.mainEngine.firing && lm.tel.vSpeed > 5, `P12 ascent (vs ${lm.tel.vSpeed.toFixed(1)} m/s)`);
});

test('ENGINE STOP latches: the throttle lever cannot relight the engine until it is reset', () => {
  const { game, step, act, events } = makeSim('hover');
  const lm = game.vessels.LM;
  step(1);
  lm.ctrl.throttle = 0;
  act('ENGINE_STOP');
  step(1);
  assert.equal(lm.mainEngine.firing, false);
  lm.ctrl.throttle = 0.4;
  step(2);
  assert.equal(lm.mainEngine.firing, false, 'latched: no relight from the lever');
  assert.ok(events.some((e) => e.t === 'message' && /ENGINE STOP is latched/.test(e.p.text)), 'the crew is told why');
  lm.ctrl.throttle = 0;
  act('ENGINE_STOP'); // second push: reset
  lm.ctrl.throttle = 0.4;
  step(2);
  assert.equal(lm.mainEngine.firing, true, 'reset: the engine restarts');
});

test('attitude hold after a long rotation: no swing-back for the CSM and the docked stack', () => {
  for (const [label, undock, who] of [
    ['CSM', true, 'CSM'],
    ['stack (LM)', false, 'LM'],
  ]) {
    const { game, gnc, step, act } = makeSim('undock');
    if (undock) {
      act('UNDOCK');
      step(15);
    }
    act('SWITCH_VESSEL', { to: who });
    act('AUTOPILOT', { mode: 'OFF' });
    step(2);
    const v = game.active;
    v.ctrl.pitch = 1;
    step(10);
    v.ctrl.pitch = 0;
    const q0 = v.quat.clone();
    let maxAng = 0;
    let minRate = 0;
    for (let i = 0; i < 40 * 60; i++) {
      step(1 / 60);
      maxAng = Math.max(maxAng, q0.angleTo(v.quat) * R2D);
      minRate = Math.min(minRate, v.angVel.x * R2D);
    }
    const back = maxAng - q0.angleTo(v.quat) * R2D;
    assert.equal(gnc.stateOf(v).dap.phase, 'HOLD', label);
    assert.ok(back < 0.7, `${label}: swings back ${back.toFixed(2)} deg after stopping`);
    assert.ok(minRate > -0.1, `${label}: reverse rate ${minRate.toFixed(2)} deg/s`);
  }
});

test('P64 (High Gate scenario): the LGC yaws Eagle so the site lies on the LPD reticle line', () => {
  const { game, step } = makeSim('highgate');
  const lm = game.vessels.LM;
  step(20);
  assert.equal(lm.gnc.program, 'P64');
  assert.ok(Math.abs(lm.gnc.lpdAzimuth - LPD_AZIMUTH) < 3, `LPD azimuth ${lm.gnc.lpdAzimuth.toFixed(1)} deg`);
  assert.ok(lm.mainEngine.throttleCmd < 0.66, 'throttleable range, no FTP surge');
});

test('Lunar Orbit: undock, separate, PRO loads P40 DOI; the LGC then flies PDI and lands', () => {
  const { game, gnc, sim, step, act, events } = makeSim('undock');
  const lm = game.vessels.LM;
  const csm = game.vessels.CSM;
  act('UNDOCK');
  step(5);
  act('PRO');
  assert.notEqual(lm.gnc.program, 'P40', 'too close to Columbia: refused');
  lm.ctrl.transFwd = -1;
  step(4);
  lm.ctrl.transFwd = 0;
  while (lm.pos.distanceTo(csm.pos) < 55) step(5);
  act('PRO');
  assert.equal(lm.gnc.program, 'P40');
  const S = gnc.stateOf(lm);
  step(1 / 60);
  assert.ok(S.burn.dvMag > 18 && S.burn.dvMag < 28, `DOI delta-V ${S.burn.dvMag.toFixed(1)} m/s (Apollo 11: 23.3)`);
  assert.ok(Number.isFinite(lm.gnc.tig), 'TIG published for the warp limiter / displays');
  // generous step cap: at 1000x the sim stops each step at its wall-clock budget, so a loaded machine
  // needs more steps for the same coast
  for (let k = 0; k < 4000000 && !lm.landed && !lm.crashed; k++) {
    if (lm.agc.flashVerbNoun) act('PRO');
    const tig = lm.gnc.tig;
    game.time.warp = (!Number.isFinite(tig) || tig - game.time.met > 60) && !lm.mainEngine.firing && lm.tel.altitude > 20000 ? 1000 : 1;
    sim.step(1 / 60);
  }
  const progs = events.filter((e) => e.t === 'program' && e.p.vessel === 'LM').map((e) => e.p.program);
  for (const p of ['P40', 'P63', 'P64', 'P66', 'P68']) assert.ok(progs.includes(p), `${p} flown (${progs.join(' ')})`);
  const done = events.find((e) => e.t === 'message' && /DOI complete/.test(e.p.text));
  assert.ok(done, 'DOI complete message');
  // default units: Apollo's nautical miles
  const peri = +/× ([\d.]+) nmi/.exec(done.p.text)[1] * 1.852;
  assert.ok(peri > 11 && peri < 19, `descent orbit perilune ${peri} km`);
  assert.equal(lm.landed, true, lm.crashReason || 'landed');
  assert.ok(game.result.distanceToTarget < 100, `touchdown ${game.result.distanceToTarget.toFixed(0)} m from the site`);
});
