// GNC — hands-off P66 AUTO (the LGC's P65-like automatic approach and landing), the crew of the
// vessel the player is not flying answering the DSKY, and the player's units in GNC texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameState } from '../src/core/state.js';
import { createSim } from '../src/sim/sim.js';
import { createGNC } from '../src/gnc/gnc.js';
import { P66AUTO, p66ApproachSpeed, CREW_PRO_DELAY, doiUnavailable } from '../src/gnc/programs.js';
import { buildCallout } from '../src/gnc/callouts.js';

const R2D = 180 / Math.PI;

function makeSim(scenario, settings = {}) {
  const game = createGameState({ scenario: null, warp: 1 });
  Object.assign(game.settings, settings);
  const gnc = createGNC(game);
  const sim = createSim(game, { gnc });
  const events = [];
  for (const t of ['program', 'message', 'callout', 'contact', 'touchdown', 'crash']) game.events.on(t, (p) => events.push({ t, p, met: game.time.met }));
  sim.loadScenario(scenario);
  const step = () => sim.step(1 / 60, { ignoreWarp: true });
  return { game, gnc, sim, events, step };
}

/** Horizontal distance (m) from the LM to its landing target. */
function targetDistance(lm) {
  const u = lm.pos.clone().normalize();
  const s = lm.gnc.targetDir.clone().multiplyScalar(lm.pos.length()).sub(lm.pos);
  return s.addScaledVector(u, -s.dot(u)).length();
}

/** Fly the LM hands-off to the ground and record the approach. */
function flyToTouchdown(ctx, max = 240) {
  const { game, step } = ctx;
  const lm = game.vessels.LM;
  const t0 = game.time.met;
  const fuel0 = lm.propellant.main;
  const rec = { maxTilt: 0, maxTiltLow: 0, captured: false, maxDistAfterCapture: 0, climb: 0 };
  for (let i = 0; i < max * 60 && !lm.landed && !lm.crashed; i++) {
    step();
    const u = lm.pos.clone().normalize();
    const tilt = Math.acos(Math.min(1, new THREE.Vector3(0, 1, 0).applyQuaternion(lm.quat).dot(u))) * R2D;
    const alt = lm.tel.gearAltitude;
    if (!lm.gear.probeContact) {
      rec.maxTilt = Math.max(rec.maxTilt, tilt);
      if (alt < 40) rec.maxTiltLow = Math.max(rec.maxTiltLow, tilt);
    }
    const d = targetDistance(lm);
    if (!rec.captured && d < 10) rec.captured = true;
    if (rec.captured) rec.maxDistAfterCapture = Math.max(rec.maxDistAfterCapture, d);
    if (lm.tel.vSpeed > 0.3) rec.climb += lm.tel.vSpeed / 60; // metres climbed (vertical speed up)
  }
  rec.time = game.time.met - t0;
  rec.fuelUsed = fuel0 - lm.propellant.main;
  rec.fuel0 = fuel0;
  return rec;
}

function assertGoodLanding(game, rec, label, { maxTime, maxFuelFrac }) {
  const lm = game.vessels.LM;
  const r = game.result;
  assert.equal(lm.landed, true, `${label}: ${lm.crashReason || 'did not land'}`);
  assert.ok(['good', 'perfect'].includes(r.rating), `${label}: rating ${r.rating} (${r.reason})`);
  assert.ok(r.distanceToTarget < 3, `${label}: touchdown ${r.distanceToTarget.toFixed(1)} m from the target`);
  assert.ok(r.vSpeed < 1.5, `${label}: sink ${r.vSpeed.toFixed(2)} m/s`);
  assert.ok(r.hSpeed < 0.3, `${label}: drift ${r.hSpeed.toFixed(2)} m/s`);
  assert.ok(r.tiltDeg < 3 && r.maxTiltDeg < 3, `${label}: tilt ${r.tiltDeg.toFixed(1)} deg (max ${r.maxTiltDeg.toFixed(1)})`);
  assert.ok(rec.time < maxTime, `${label}: ${rec.time.toFixed(0)} s to touchdown`);
  assert.ok(rec.fuelUsed < maxFuelFrac * rec.fuel0, `${label}: ${rec.fuelUsed.toFixed(0)} of ${rec.fuel0.toFixed(0)} kg of descent propellant used`);
  // smooth: no orbiting around the target, gentle attitudes near the ground, no climbing
  assert.ok(rec.maxDistAfterCapture < 12, `${label}: drifted back out to ${rec.maxDistAfterCapture.toFixed(1)} m after reaching the target`);
  assert.ok(rec.maxTiltLow < 12.5, `${label}: tilt up to ${rec.maxTiltLow.toFixed(1)} deg below 40 m`);
  assert.ok(rec.maxTilt < 16.5, `${label}: tilt up to ${rec.maxTilt.toFixed(1)} deg`);
  assert.ok(rec.climb < 1, `${label}: climbed ${rec.climb.toFixed(1)} m`);
}

// ------------------------------------------------------------------ approach profile

test('P66 AUTO approach speed profile: zero at the target, continuous, braking-feasible', () => {
  assert.equal(p66ApproachSpeed(0), 0);
  let prev = 0;
  let maxDecel = 0;
  for (let d = 0.05; d < 800; d += 0.05) {
    const v = p66ApproachSpeed(d);
    assert.ok(v >= prev - 1e-9, `monotonic at ${d.toFixed(2)} m`);
    assert.ok(v - prev < 0.02, `continuous at ${d.toFixed(2)} m`);
    if (v < P66AUTO.vMax) maxDecel = Math.max(maxDecel, (v * (v - prev)) / 0.05); // v dv/dd
    prev = v;
  }
  assert.ok(maxDecel <= P66AUTO.aBrake * 1.02, `profile deceleration ${maxDecel.toFixed(3)} m/s^2`);
  assert.equal(p66ApproachSpeed(5000), P66AUTO.vMax);
});

// ------------------------------------------------------------------ closed loop

test('Low Gate hands-off: P66 AUTO flies to the target and lands softly (~80 s)', () => {
  const ctx = makeSim('lowgate');
  const { game, events } = ctx;
  const lm = game.vessels.LM;
  assert.equal(lm.gnc.program, 'P66');
  assert.equal(lm.gnc.autopilot, 'GUIDANCE', 'Low Gate starts hands-off (P66 AUTO)');
  const rec = flyToTouchdown(ctx);
  assertGoodLanding(game, rec, 'lowgate', { maxTime: 95, maxFuelFrac: 0.6 });
  const contact = events.find((e) => e.t === 'contact');
  const stop = events.find((e) => e.t === 'message' && /ENGINE STOP pushed/.test(e.p.text));
  assert.ok(contact && stop && stop.met >= contact.met && stop.met - contact.met < 5.1, 'ENGINE STOP after the contact light');
});

test('hover 150 m east of the site, player switches to Columbia: the LGC lands Eagle on the target', () => {
  const ctx = makeSim('hover');
  const { game, events, step } = ctx;
  const lm = game.vessels.LM;
  step();
  assert.ok(Math.abs(targetDistance(lm) - 150) < 5 && Math.abs(lm.tel.gearAltitude - 60) < 3, 'hover start state');
  game.events.emit('action', { name: 'SWITCH_VESSEL' });
  assert.equal(game.activeId, 'CSM');
  assert.equal(lm.gnc.program, 'P66');
  assert.equal(lm.gnc.autopilot, 'GUIDANCE');
  assert.equal(ctx.gnc.stateOf(lm).descent.rodAuto, true);
  const rec = flyToTouchdown(ctx);
  assertGoodLanding(game, rec, 'hover', { maxTime: 95, maxFuelFrac: 0.5 });
  // messages about Eagle while the player flies Columbia carry her name
  const stop = events.find((e) => e.t === 'message' && /ENGINE STOP pushed/.test(e.p.text));
  assert.match(stop.p.text, /^Eagle: /);
});

test('P66 AUTO: the pilot takes over with the hand controller (LGC keeps the ROD) or the ROD switch (LGC keeps the attitude)', () => {
  const { game, gnc, step } = makeSim('lowgate');
  const lm = game.vessels.LM;
  step();
  lm.ctrl.pitch = 0.3;
  step();
  lm.ctrl.pitch = 0;
  assert.equal(lm.gnc.autopilot, 'OFF');
  assert.equal(gnc.stateOf(lm).descent.rodAuto, true);
  game.events.emit('action', { name: 'PRO' }); // hand it back
  assert.equal(lm.gnc.autopilot, 'GUIDANCE');
  game.events.emit('action', { name: 'ROD_UP' });
  assert.equal(gnc.stateOf(lm).descent.rodAuto, false);
  const rod = lm.gnc.rodCmd;
  for (let i = 0; i < 120; i++) step();
  assert.equal(lm.gnc.rodCmd, rod, 'the ROD is the pilot\'s');
  assert.equal(lm.gnc.autopilot, 'GUIDANCE');
});

// ------------------------------------------------------------------ crew of the other vessel

test("Columbia Solo: Eagle's crew answer the V99 themselves ~2 s after it flashes; no 'press Space' for Eagle", () => {
  const { game, events, step } = makeSim('csm');
  const lm = game.vessels.LM;
  const tig = lm.gnc.tig;
  let flash = null;
  let ack = null;
  let ign = null;
  while (game.time.met < tig + 3) {
    step();
    if (flash == null && lm.agc.verb === '99') flash = game.time.met;
    if (flash != null && ack == null && !lm.agc.flashVerbNoun) ack = game.time.met;
    if (ign == null && lm.mainEngine.firing) ign = game.time.met;
  }
  assert.ok(flash != null && Math.abs(flash - (tig - 5)) < 0.1, 'V99 N62 at TIG-5');
  assert.ok(Math.abs(ack - flash - CREW_PRO_DELAY) < 0.1, `crew PRO ${(ack - flash).toFixed(2)} s after the flash`);
  assert.ok(ign != null && ign - tig < 0.2, 'DPS ignition on time');
  const msgs = events.filter((e) => e.t === 'message').map((e) => e.p.text);
  assert.ok(msgs.some((m) => /^Eagle: V99 N62 — Armstrong and Aldrin pressed PRO/.test(m)), msgs.join(' | '));
  assert.ok(!msgs.some((m) => /Space/.test(m)), 'no Space prompt for the vessel the player is not flying');
  assert.ok(msgs.filter((m) => /DPS ignition/.test(m)).every((m) => m.startsWith('Eagle: ')), 'Eagle messages prefixed');
});

test('player leaves Eagle while V99 N62 flashes: the crew press PRO 2 s later, ignition on time', () => {
  const { game, events, step } = makeSim('pdi');
  const lm = game.vessels.LM;
  const tig = lm.gnc.tig;
  while (game.time.met < tig - 4.5) step();
  assert.equal(lm.agc.flashVerbNoun, true);
  const sw = game.time.met;
  game.events.emit('action', { name: 'SWITCH_VESSEL' });
  let ack = null;
  while (game.time.met < tig + 1) {
    step();
    if (ack == null && !lm.agc.flashVerbNoun) ack = game.time.met;
  }
  assert.ok(Math.abs(ack - sw - CREW_PRO_DELAY) < 0.1, `crew PRO ${(ack - sw).toFixed(2)} s after the switch`);
  assert.equal(lm.mainEngine.firing, true);
  const after = events.filter((e) => e.t === 'message' && e.met > sw).map((e) => e.p.text);
  assert.ok(!after.some((m) => /Space/.test(m)), after.join(' | '));
});

// ------------------------------------------------------------------ units

test("GNC texts follow the player's units", () => {
  // DOI refusal near Columbia
  for (const [units, re] of [
    ['imperial', /\d+ ft\) — separate at least 164 ft/],
    ['metric', /\d+ m\) — separate at least 50 m/],
  ]) {
    const { game, gnc, step } = makeSim('undock', { units });
    game.events.emit('action', { name: 'UNDOCK' });
    for (let i = 0; i < 120; i++) step();
    const lm = game.vessels.LM;
    assert.match(doiUnavailable(lm, gnc.stateOf(lm), game), re);
  }
  // live-telemetry landing callouts
  const s = { altFt: 400 / 0.3048, downFps: 3 / 0.3048, fwdFps: 0, rightFps: 0, n: 0 };
  assert.equal(buildCallout({ ...s, metric: true }, {}), '400 metres, down at 3.');
  assert.equal(buildCallout({ ...s, altFt: 400, downFps: 9 }, {}), '400 feet, down at 9.');
});
