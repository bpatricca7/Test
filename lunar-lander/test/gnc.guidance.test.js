// GNC — powered descent (P63/P64/P66), ascent (P12) and the ignition / PRO logic, closed loop
// with the simulator's physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameState } from '../src/core/state.js';
import { LM, FT, MISSION } from '../src/core/constants.js';
import { createSim } from '../src/sim/sim.js';
import { createGNC } from '../src/gnc/gnc.js';
import { solveTgo, quadraticAccel, DESCENT_TARGETS, dpsThrottle, rodThrottle, LPD_AZIMUTH } from '../src/gnc/guidance.js';

function makeSim(scenario, settings = {}) {
  const game = createGameState({ scenario: null, warp: 1 });
  Object.assign(game.settings, settings);
  const gnc = createGNC(game);
  const sim = createSim(game, { gnc });
  const events = [];
  for (const t of ['program', 'callout', 'message', 'alarm', 'touchdown', 'crash', 'stage']) game.events.on(t, (p) => events.push({ t, p, met: game.time.met }));
  sim.loadScenario(scenario);
  return { game, gnc, sim, events };
}

/** Step at 60 Hz until `until()` is true or `max` seconds elapse. Returns elapsed seconds. */
function runUntil(sim, game, max, until, each) {
  const t0 = game.time.met;
  for (let i = 0; i < max * 60; i++) {
    sim.step(1 / 60, { ignoreWarp: true });
    if (each) each();
    if (until && until()) break;
  }
  return game.time.met - t0;
}

// ------------------------------------------------------------------ pure math

test('quadratic guidance: the quartic reference trajectory meets the target', () => {
  // integrate r'' = ACG (recomputed continuously) from a braking-like state to the target
  const tgt = { r: new THREE.Vector3(2300, 0, -7900), v: new THREE.Vector3(-45, 0, 150), a: new THREE.Vector3(0, 0, -2.2), jz: 0.005 };
  const r = new THREE.Vector3(9000, 0, -45000);
  const v = new THREE.Vector3(-40, 0, 430);
  const a = new THREE.Vector3();
  let T = solveTgo(r.z, v.z, tgt, 100);
  assert.ok(T > 60 && T < 400, `tgo ${T}`);
  const dt = 0.01;
  while (T > 0.05) {
    quadraticAccel(r, v, tgt, T, a);
    v.addScaledVector(a, dt);
    r.addScaledVector(v, dt);
    T -= dt;
  }
  // (discrete 10-ms integration of a law whose gains grow as 1/T^2 near the end)
  assert.ok(r.distanceTo(tgt.r) < 10, `position miss ${r.distanceTo(tgt.r).toFixed(2)} m of 37 km`);
  assert.ok(v.distanceTo(tgt.v) < 1, `velocity miss ${v.distanceTo(tgt.v).toFixed(2)} m/s`);
});

test('time-to-go root satisfies the downrange jerk condition', () => {
  const tgt = DESCENT_TARGETS.braking;
  const T = solveTgo(-470000, 1690, tgt, 500);
  const f = tgt.jz * T ** 3 - 6 * tgt.a.z * T ** 2 + (18 * tgt.v.z + 6 * 1690) * T - 24 * (tgt.r.z + 470000);
  assert.ok(Math.abs(f) < 1e-3 * 24 * 470000, `residual ${f}`);
  assert.ok(T > 400 && T < 700, `braking tgo ${T.toFixed(0)} s`);
});

test('DPS throttle logic: FTP until the command drops below ~60 %, then throttling 10-65 %', () => {
  const st = { ftp: true };
  assert.equal(dpsThrottle(st, 1.4), 1);
  assert.equal(dpsThrottle(st, 0.62), 1);
  assert.equal(dpsThrottle(st, 0.57), 0.57);
  assert.equal(st.throttledDown, true);
  assert.equal(dpsThrottle(st, 0.05), 0.1);
  assert.equal(dpsThrottle(st, 0.64), 0.64);
  assert.equal(dpsThrottle(st, 0.8), 0.65, 'after throttle recovery: saturate at 65 %, no FTP surge');
  assert.equal(dpsThrottle(st, 0.95), 0.65, 'one high cycle is not enough');
  assert.equal(dpsThrottle(st, 0.5), 0.5);
  assert.equal(dpsThrottle(st, 0.95), 0.65);
  assert.equal(dpsThrottle(st, 0.97), 1, 'sustained demand above 90 % -> FTP');
});

test('P66 law: hover thrust at the commanded rate, more thrust when sinking too fast', () => {
  const base = { mass: 7000, g: 1.62, vUp: -1, hSpeed: 0, r: 1737000, accUp: 0, cosTilt: 1, vCmd: -1, maxThrust: LM.dps.maxThrust };
  const hover = rodThrottle(base);
  assert.ok(Math.abs(hover - (7000 * 1.62) / LM.dps.maxThrust) < 1e-6);
  assert.ok(rodThrottle({ ...base, vUp: -3 }) > hover);
  assert.ok(rodThrottle({ ...base, cosTilt: Math.cos(0.2) }) > hover, 'tilt compensation');
});

// ------------------------------------------------------------------ closed loop

test('full automatic descent from PDI: P63 -> P64 -> P66 reaches Low Gate near the target with fuel margin, then lands', () => {
  const { game, sim, events } = makeSim('pdi');
  const lm = game.vessels.LM;
  const tig = lm.gnc.tig;
  const pdi = { hg: null, lg: null, thrDown: null };
  let pro = false;
  let lgState = null;
  const p64 = { maxLpd: 0, maxAzErr: 0, maxThr: 0, n: 0 };
  let contactMet = null;
  game.events.on('contact', () => (contactMet ??= game.time.met));
  runUntil(sim, game, 900, () => lm.landed || lm.crashed, () => {
    if (!pro && game.time.met > tig - 4) {
      game.events.emit('action', { name: 'PRO' });
      pro = true;
    }
    if (pdi.thrDown == null && lm.gnc.throttleState === 'THROTTLE') pdi.thrDown = game.time.met - tig;
    if (pdi.hg == null && lm.gnc.program === 'P64') pdi.hg = game.time.met - tig;
    if (lm.gnc.program === 'P64' && Number.isFinite(lm.gnc.lpdAngle)) {
      p64.maxThr = Math.max(p64.maxThr, lm.mainEngine.throttleCmd);
      if (game.time.met - tig - pdi.hg > 10) {
        // after the pitch-over the site stays on the CDR's window reticle (scale line at 21 deg)
        p64.maxLpd = Math.max(p64.maxLpd, lm.gnc.lpdAngle);
        p64.maxAzErr = Math.max(p64.maxAzErr, Math.abs(lm.gnc.lpdAzimuth - LPD_AZIMUTH));
        p64.n++;
      }
    }
    if (pdi.lg == null && lm.gnc.program === 'P66') {
      pdi.lg = game.time.met - tig;
      lgState = { alt: lm.tel.altitude, range: lm.tel.rangeToSite, vs: lm.tel.vSpeed, hs: lm.tel.hSpeed, prop: lm.propellant.main };
    }
  });
  const progs = events.filter((e) => e.t === 'program' && e.p.vessel === 'LM').map((e) => e.p.program);
  assert.deepEqual(progs.slice(0, 3), ['P64', 'P66', 'P68']);
  // Apollo 11: throttle-down PDI+6:24, High Gate PDI+8:27, Low Gate ~PDI+10:15
  assert.ok(pdi.thrDown > 330 && pdi.thrDown < 450, `throttle-down at PDI+${pdi.thrDown?.toFixed(0)} s`);
  assert.ok(pdi.hg > 450 && pdi.hg < 570, `High Gate at PDI+${pdi.hg?.toFixed(0)} s`);
  assert.ok(pdi.lg > 560 && pdi.lg < 700, `Low Gate at PDI+${pdi.lg?.toFixed(0)} s`);
  assert.ok(lgState.alt > 90 && lgState.alt < 250, `Low Gate altitude ${lgState.alt.toFixed(0)} m`);
  assert.ok(Math.abs(lgState.range - Math.abs(MISSION.lowGate.downrange)) < 250, `Low Gate range ${lgState.range.toFixed(0)} m`);
  assert.ok(lgState.vs < 0 && lgState.vs > -10 && lgState.hs < 30, `Low Gate velocity ${lgState.vs.toFixed(1)} / ${lgState.hs.toFixed(1)}`);
  assert.ok(p64.n > 100 && p64.maxLpd < 52, `P64 LPD angle up to ${p64.maxLpd.toFixed(1)} deg (window reticle ends at ~53)`);
  assert.ok(p64.maxAzErr < 3, `LPD azimuth off the reticle line by up to ${p64.maxAzErr.toFixed(1)} deg`);
  assert.ok(p64.maxThr < 0.66, `P64 throttle stays in the throttleable range (max ${(p64.maxThr * 100).toFixed(0)} %)`);
  const margin = lgState.prop / LM.descentPropMax;
  assert.ok(margin >= 0.05, `descent propellant at Low Gate ${(margin * 100).toFixed(1)} %`);
  // hands-off P66 lands softly near the target
  assert.equal(lm.landed, true, lm.crashReason || 'landed');
  assert.notEqual(game.result.outcome, 'hard');
  assert.ok(game.result.distanceToTarget < 100, `touchdown ${game.result.distanceToTarget.toFixed(0)} m from the target`);
  // ENGINE STOP a few seconds after the contact light, with the pads just above the surface
  const stop = events.find((e) => e.t === 'message' && /ENGINE STOP pushed/.test(e.p.text));
  assert.ok(stop && contactMet != null && stop.met - contactMet < 5.1, `engine stop ${(stop?.met - contactMet).toFixed(2)} s after contact light`);
  assert.ok(game.result.vSpeed < 1.5, `touchdown sink ${game.result.vSpeed.toFixed(2)} m/s`);
  assert.ok(game.result.hSpeed < 0.3 && game.result.tiltDeg < 3, `touchdown drift ${game.result.hSpeed.toFixed(2)} m/s, tilt ${game.result.tiltDeg.toFixed(1)} deg`);
  assert.ok(['good', 'perfect'].includes(game.result.rating), game.result.rating);
  // Buzz Aldrin style callouts were made from the live telemetry
  const calls = events.filter((e) => e.t === 'callout').map((e) => e.p.text);
  assert.ok(calls.some((c) => /feet, (down|coming down|\d)/.test(c)), 'altitude/rate callouts');
  assert.ok(calls.some((c) => /go for powered descent/.test(c)), 'MCC go for PDI');
  assert.ok(calls.some((c) => /Delta-H/.test(c)), 'radar lock delta-H callout');
});

test('no PRO at V99: no ignition; a late PRO ignites after a short ullage', () => {
  const { game, sim, events } = makeSim('pdi');
  const lm = game.vessels.LM;
  const tig = lm.gnc.tig;
  runUntil(sim, game, 60, () => game.time.met > tig - 4);
  assert.equal(lm.agc.verb, '99');
  assert.equal(lm.agc.noun, '62');
  assert.equal(lm.agc.flashVerbNoun, true);
  // ullage: the four down-firing jets
  const ull = lm.rcs.jets.filter((j) => j.cmd > 0.9).map((j) => j.id).sort();
  assert.deepEqual(ull, ['Q1D', 'Q2D', 'Q3D', 'Q4D']);
  runUntil(sim, game, 20, () => game.time.met > tig + 10);
  assert.equal(lm.mainEngine.firing, false, 'no ignition without PRO');
  assert.ok(events.some((e) => e.t === 'message' && /No ignition/.test(e.p.text)));
  game.events.emit('action', { name: 'PRO' });
  runUntil(sim, game, 5, () => lm.mainEngine.firing);
  assert.equal(lm.mainEngine.firing, true, 'late ignition');
  assert.ok(Math.abs(lm.mainEngine.throttleCmd - 0.1) < 1e-9, '10 % ignition throttle');
});

test('P66 holds the commanded rate of descent within 0.2 m/s (pilot on attitude hold)', () => {
  const { game, sim } = makeSim('lowgate');
  const lm = game.vessels.LM;
  assert.equal(lm.gnc.program, 'P66');
  game.events.emit('action', { name: 'AUTOPILOT', mode: 'OFF' }); // the pilot holds the attitude
  for (let i = 0; i < 10; i++) game.events.emit('action', { name: 'ROD_UP' }); // -5 m/s + 10 ft/s
  const cmd = lm.gnc.rodCmd;
  assert.ok(Math.abs(cmd - (-5 + 10 * FT)) < 1e-9);
  runUntil(sim, game, 6);
  let worst = 0;
  runUntil(sim, game, 20, () => lm.tel.altitude < 25, () => (worst = Math.max(worst, Math.abs(lm.tel.vSpeed - cmd))));
  assert.ok(worst < 0.2, `worst rate error ${worst.toFixed(3)} m/s`);
});

test('P64: LPD angle on the DSKY, redesignation moves the target; stick input switches to P66', () => {
  const { game, sim } = makeSim('highgate');
  const lm = game.vessels.LM;
  runUntil(sim, game, 3);
  assert.equal(lm.agc.noun, '64');
  assert.ok(lm.gnc.lpdAngle > 25 && lm.gnc.lpdAngle < 70, `LPD ${lm.gnc.lpdAngle}`);
  assert.match(lm.agc.r1, /^\+\d\d \d\d$/);
  const t0 = lm.gnc.targetDir.clone();
  const range0 = lm.tel.rangeToSite;
  game.events.emit('action', { name: 'LPD', dx: 0, dy: 2 }); // two clicks: farther
  const moved = t0.angleTo(lm.gnc.targetDir) * 1737400;
  assert.ok(moved > 100 && moved < 2000, `redesignated by ${moved.toFixed(0)} m`);
  sim.updateTelemetry();
  assert.ok(lm.tel.rangeToSite > range0 + 100, 'new target is farther downrange');
  lm.ctrl.pitch = 0.2;
  runUntil(sim, game, 0.2);
  lm.ctrl.pitch = 0;
  assert.equal(lm.gnc.program, 'P66');
  assert.equal(lm.gnc.autopilot, 'OFF');
  assert.ok(Math.abs(lm.gnc.rodCmd - lm.tel.vSpeed) < 1.5, 'ROD initialised to the current vertical speed');
});

test('historical 1202 alarm: PROG light, master alarm, guidance continues, reset clears', () => {
  const { game, sim, events } = makeSim('pdi', { historicalAlarms: true });
  const lm = game.vessels.LM;
  const tig = lm.gnc.tig;
  let pro = false;
  runUntil(sim, game, 420, () => events.some((e) => e.t === 'alarm' && e.p.code === '1202'), () => {
    if (!pro && game.time.met > tig - 4) {
      game.events.emit('action', { name: 'PRO' });
      pro = true;
    }
  });
  assert.equal(lm.agc.lights.prog, true);
  assert.equal(lm.cw.masterAlarm, true);
  runUntil(sim, game, 1);
  assert.equal(lm.agc.noun, '09', 'V05 N09 alarm display');
  assert.equal(lm.agc.r1.trim(), '01202');
  assert.equal(lm.mainEngine.firing, true, 'guidance continues');
  game.events.emit('action', { name: 'MASTER_ALARM_RESET' });
  assert.equal(lm.cw.masterAlarm, false);
  assert.equal(lm.agc.lights.prog, false);
});

test('P12 ascent from Tranquility Base reaches orbit (perilune > 15 km)', () => {
  const { game, sim, events } = makeSim('landed');
  const lm = game.vessels.LM;
  const tig = lm.gnc.tig;
  let pro = false;
  let cut = null;
  runUntil(sim, game, 800, () => lm.gnc.program === 'P00', () => {
    if (!pro && game.time.met > tig - 4) {
      game.events.emit('action', { name: 'PRO' });
      pro = true;
    }
    if (cut == null && !lm.mainEngine.firing && lm.staged && game.time.met > tig + 20) cut = game.time.met - tig;
    if (lm.mainEngine.firing && game.time.met > tig + 100) lm.ctrl.throttle = 0.6; // lever left up: P12 ignores it
  });
  assert.equal(lm.staged, true);
  assert.ok(events.some((e) => e.t === 'stage'));
  assert.ok(cut > 380 && cut < 520, `APS burn ${cut?.toFixed(0)} s (Apollo 11: 435 s)`);
  assert.ok(lm.tel.periapsisAlt > 15000, `perilune ${(lm.tel.periapsisAlt / 1000).toFixed(1)} km`);
  assert.ok(lm.tel.apoapsisAlt > 60000 && lm.tel.apoapsisAlt < 110000, `apolune ${(lm.tel.apoapsisAlt / 1000).toFixed(1)} km`);
  assert.equal(lm.gnc.autopilot, 'LOCAL_VERTICAL');
  // insertion message in the player's (default: Apollo) units; the lever is zeroed at cut-off so
  // the manual throttle of P00 cannot relight the APS
  const ins = events.find((e) => e.t === 'message' && /^Insertion/.test(e.p.text));
  assert.match(ins.p.text, /Orbit [\d.]+ × [\d.]+ nmi$/);
  assert.equal(lm.ctrl.throttle, 0);
  runUntil(sim, game, 1);
  assert.equal(lm.agc.noun, '44');
  assert.equal(lm.mainEngine.firing, false, 'no relight in P00');
});

test('CSM: P00 with V16 N44, P47 thrust monitor while translating', () => {
  const { game, sim } = makeSim('csm');
  const c = game.vessels.CSM;
  runUntil(sim, game, 2);
  assert.equal(c.agc.prog, '00');
  assert.equal(c.agc.verb, '16');
  assert.equal(c.agc.noun, '44');
  // 60 nmi circular: apolune/perilune ~ 0600 (x0.1 nmi)
  const apo = +c.agc.r1 / 10;
  assert.ok(apo > 55 && apo < 66, `N44 apolune ${apo} nmi`);
  c.ctrl.transFwd = 1;
  runUntil(sim, game, 5);
  c.ctrl.transFwd = 0;
  assert.equal(c.gnc.program, 'P47');
  assert.equal(c.agc.noun, '83');
  const dvx = +c.agc.r1 / 10; // ft/s, Apollo +X (forward)
  const expect = ((4 * 445) / c.mass) * 5 / FT;
  assert.ok(Math.abs(dvx - expect) < 0.25 * expect, `N83 dVx ${dvx} ft/s (expect ~${expect.toFixed(1)})`);
});
