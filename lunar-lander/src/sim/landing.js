// Touchdown state machine, crash handling, and LM staging (ascent stage separation).
//
// Touchdown sequence (LM with the descent stage):
//   air -> (first pad contact: record sink rate / ground speed) -> contact
//   contact: track tilt, 'Engine stop.' callout when the DPS shuts down, hint if the engine keeps
//            running 1.5 s after contact, tip-over detection, lift-off detection
//   -> settled once >= 3 pads are loaded, the engine is off and the vehicle is still for 1 s:
//      the body sleeps (perfectly stable), landed = true, game.result is evaluated and
//      'touchdown' is emitted; a good landing earns "Houston, Tranquility Base here..."
//
// Staging: STAGE (ABORT STAGE) or a P12 ignition on the surface fires the explosive bolts and
// guillotine: the descent stage is left behind (stays on the surface, or falls ballistically
// after an in-flight abort) and the mainEngine object becomes the APS.

import * as THREE from 'three';
import { LM, MISSION } from '../core/constants.js';
import { MOON } from '../core/constants.js';
import { terrainHeight } from '../world/moon.js';
import { GEAR, buildResult, tiltDeg, radialSpeed, horizSpeed, newTouchdownState, releasePads } from './contact.js';
import { gravityAt, integrateQuat } from './physics.js';
import { updateVesselMassProps } from './massprops.js';
import { fmtSpeed } from './units.js';

/** Impact classification: beyond these the gear/hull detail is irrelevant — it was an impact. */
export const IMPACT = {
  SPEED: 10, // m/s total speed
  SINK: 6.1, // m/s sink rate: twice the 10 ft/s gear design limit
};

/**
 * Player-facing crash reason for a contact.js crash record, in the player's units.
 * High-energy impacts read as impacts (with total and vertical speed); gear failures in the
 * 1.5-6 m/s band quote the vehicle's sink rate at touchdown, not the local pad-normal speed.
 */
export function impactReason(S, v, crash) {
  const game = S.game;
  const sink = Math.max(0, -radialSpeed(v), v.phys?.td?.phase !== 'air' ? v.phys?.td?.vSpeed || 0 : 0);
  const tot = Math.max(v.vel.length(), sink);
  const hs = horizSpeed(v);
  if (tot > IMPACT.SPEED || sink > IMPACT.SINK) {
    if (hs > 2 * sink && hs > IMPACT.SPEED) return `Impact with the surface at ${fmtSpeed(game, tot, 0)} (${fmtSpeed(game, sink, 0)} vertical)`;
    return `Hit the surface at ${fmtSpeed(game, tot, 1)}${hs > 1 ? ` (${fmtSpeed(game, hs, 1)} across)` : ''}`;
  }
  const across = hs > 0.5 ? `, ${fmtSpeed(game, hs, 1)} across` : '';
  if (crash?.kind === 'gear') return `Landing gear collapsed — ${crash.pad} strut bottomed (touchdown at ${fmtSpeed(game, sink, 1)} down${across})`;
  if (crash?.kind === 'hull') return `The ${crash.what} struck the surface at ${fmtSpeed(game, crash.speed, 1)}`;
  return crash?.reason || 'Impact with the surface';
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function originAltitude(v) {
  const r = v.pos.length();
  _a.copy(v.pos).divideScalar(r);
  return r - MOON.radius - terrainHeight(_a.x, _a.y, _a.z);
}

/** Immediately shut down the main engine and all jets (crash / freeze). */
export function killPropulsion(v, ev) {
  const e = v.mainEngine;
  const s = v.phys.eng;
  if (s.state !== 'off') ev.emit('engine', { vessel: v.id, engine: e.name, on: false });
  s.state = 'off';
  s.f = 0;
  e.throttle = 0;
  e.firing = false;
  v.phys.thrust = 0;
  for (const j of v.rcs.jets) j.level = 0;
}

/**
 * Declare a crash (or tip-over).
 * @param {object} S sim internals {game, ev}
 * @param {object} v vessel
 * @param {'crashed'|'tipped'} outcome
 * @param {string} reason
 * @param {boolean} freeze stop the body dead (high-energy impact)
 */
export function crashVessel(S, v, outcome, reason, freeze) {
  if (v.crashed) return;
  const { game, ev } = S;
  v.crashed = true;
  v.crashReason = reason;
  v.landed = false;
  killPropulsion(v, ev);
  if (freeze) {
    v.vel.set(0, 0, 0);
    v.angVel.set(0, 0, 0);
    v.phys.sleeping = true;
    v.phys.frozen = true;
  }
  if (v.type === 'LM') {
    game.result = buildResult(v, game, outcome, reason);
  } else {
    game.result = { vessel: v.id, outcome: 'crashed', reason, vSpeed: Math.max(0, -radialSpeed(v)), hSpeed: horizSpeed(v), tiltDeg: 0, maxTiltDeg: 0, fuelKg: 0, fuelSeconds: 0, distanceToTarget: NaN, met: game.time.met, rating: 'hard', score: 0 };
  }
  ev.emit('crash', { vessel: v.id, reason, outcome });
  ev.emit('message', { text: outcome === 'tipped' ? `${v.name} tipped over — ${reason}` : `${v.name} crashed — ${reason}`, level: 'alarm', duration: 8 });
}

/**
 * Per-substep touchdown logic for a free LM (after integration).
 * @param {object} S sim internals
 * @param {object} v LM
 * @param {number} h step
 * @param {{padCount:number, near:boolean}} c contact summary from lmContact
 */
export function updateLanding(S, v, h, c) {
  const { game, ev } = S;
  const ph = v.phys;
  const td = ph.td;
  const met = game.time.met;
  const e = v.mainEngine;
  const still = v.vel.length() < GEAR.SETTLE_SPEED && v.angVel.length() < GEAR.SETTLE_RATE;

  if (v.crashed) {
    // a tipped LM keeps tumbling until it comes to rest, then sleeps
    td.settleTimer = still ? td.settleTimer + h : 0;
    if (td.settleTimer > GEAR.SETTLE_TIME) {
      ph.sleeping = true;
      v.vel.set(0, 0, 0);
      v.angVel.set(0, 0, 0);
    }
    return;
  }
  if (v.staged) {
    // ascent stage resting on its structure (no gear): just let it sleep when still
    td.settleTimer = still && ph.anyContact && !e.firing ? td.settleTimer + h : 0;
    if (td.settleTimer > GEAR.SETTLE_TIME) {
      ph.sleeping = true;
      v.vel.set(0, 0, 0);
      v.angVel.set(0, 0, 0);
    }
    return;
  }

  const pads = c.padCount;
  if (e.firing) td.lastFiringMet = met;
  if (td.phase === 'air') {
    if (pads > 0) {
      td.phase = 'contact';
      td.firstPadMet = met;
      td.vSpeed = Math.max(0, -radialSpeed(v));
      td.hSpeed = horizSpeed(v);
      td.maxTilt = tiltDeg(v);
      td.airTimer = 0;
      td.settleTimer = 0;
      td.wasFiringAtContact = e.firing;
      if (!v.gear.probeContact) {
        v.gear.probeContact = true;
        v.cw.lights['LUNAR CONTACT'] = true;
        ev.emit('contact', { vessel: v.id });
      }
    }
    return;
  }

  // ---- in contact / settled
  const tilt = tiltDeg(v);
  if (tilt > td.maxTilt) td.maxTilt = tilt;
  if (tilt > GEAR.TIP_DEG) {
    crashVessel(S, v, 'tipped', `tilt ${tilt.toFixed(0)}° after touchdown at ${fmtSpeed(game, td.hSpeed, 1)} ground speed`, false);
    return;
  }
  // lift-off (hop or bounce)
  if (pads === 0) {
    td.airTimer += h;
    // a bounce is not a lift-off: require a sustained climb clear of the surface
    const ga = td.airTimer > 0.5 ? originAltitude(v) : 0;
    if ((td.airTimer > 1.5 && ga > 1.0) || ga > 5) {
      liftoff(v);
      return;
    }
  } else td.airTimer = 0;

  if (!e.firing && td.engineStopMet == null) {
    td.engineStopMet = met;
    if (td.lastFiringMet != null && met - td.lastFiringMet < 5) ev.emit('callout', { text: 'Engine stop.', voice: true, who: 'LMP' });
  } else if (e.firing) td.engineStopMet = null;
  if (e.firing && !td.hintShown && met - td.firstPadMet > 1.5 && e.throttle < 0.6) {
    td.hintShown = true;
    ev.emit('message', { text: 'Engine stop — press X', level: 'warn', duration: 5 });
  }

  // Residual rocking on the gear: once the vehicle is nearly at rest on two or more pads with the
  // engine off, strut friction, honeycomb hysteresis and regolith deformation bleed off the last
  // centimetres per second within about half a second (the spring-damper pads alone ring for ~10 s).
  if (pads >= 2 && !e.firing && v.vel.length() < 0.15 && v.angVel.length() < 0.03) {
    const k = Math.exp(-h / 0.35);
    v.vel.multiplyScalar(k);
    v.angVel.multiplyScalar(k);
  }

  // settle -> sleep -> landed
  td.settleTimer = pads >= 3 && !e.firing && still ? td.settleTimer + h : 0;
  if (td.settleTimer >= GEAR.SETTLE_TIME) {
    ph.sleeping = true;
    v.vel.set(0, 0, 0);
    v.angVel.set(0, 0, 0);
    v.landed = true;
    td.phase = 'settled';
    if (!td.resultDone) {
      td.resultDone = true;
      evaluateLanding(S, v);
    }
  }
}

function liftoff(v) {
  v.landed = false;
  v.phys.td = newTouchdownState();
  v.gear.probeContact = false;
  v.cw.lights['LUNAR CONTACT'] = false;
  releasePads(v);
}

/** Evaluate and publish the landing result for a settled LM. */
function evaluateLanding(S, v) {
  const { game, ev } = S;
  const td = v.phys.td;
  const lim = MISSION.touchdown;
  const tilt = tiltDeg(v);
  const hard = td.vSpeed > lim.maxVSpeed || td.hSpeed > lim.maxHSpeed || tilt > lim.maxTiltDeg || td.bottomed || td.hullHard;
  const res = buildResult(v, game, hard ? 'hard' : 'landed');
  if (hard) {
    const why = [];
    if (td.vSpeed > lim.maxVSpeed) why.push(`sink rate ${fmtSpeed(game, td.vSpeed, 1)}`);
    if (td.hSpeed > lim.maxHSpeed) why.push(`ground speed ${fmtSpeed(game, td.hSpeed, 1)}`);
    if (tilt > lim.maxTiltDeg) why.push(`tilt ${tilt.toFixed(0)}°`);
    if (td.bottomed) why.push('gear strut bottomed');
    if (td.hullHard) why.push(`${td.hullWhat} touched the surface`);
    res.reason = why.join(', ');
  }
  game.result = res;
  ev.emit('touchdown', {
    vessel: v.id,
    vSpeed: res.vSpeed,
    hSpeed: res.hSpeed,
    tiltDeg: res.tiltDeg,
    rating: res.rating,
    distanceToTarget: res.distanceToTarget,
    outcome: res.outcome,
    score: res.score,
  });
  if (res.outcome === 'landed') {
    ev.emit('message', { text: `Touchdown — ${res.rating === 'perfect' ? 'perfect landing' : 'good landing'} (${fmtSpeed(game, res.vSpeed, 2)} down, ${fmtSpeed(game, res.hSpeed, 2)} across)`, level: 'good', duration: 6 });
    const at = Math.max(game.time.met + 1.0, (td.engineStopMet ?? game.time.met) + 3.0);
    S.schedule(at, () => ev.emit('callout', { text: 'Houston, Tranquility Base here. The Eagle has landed.', voice: true, who: 'CDR' }));
    S.schedule(at + 6.5, () => ev.emit('callout', { text: "Roger, Twan... Tranquility, we copy you on the ground. You got a bunch of guys about to turn blue. We're breathing again. Thanks a lot.", voice: true, who: 'CAPCOM' }));
  } else {
    ev.emit('message', { text: `Hard landing — ${res.reason}`, level: 'warn', duration: 8 });
  }
}

// ------------------------------------------------------------------ staging

/**
 * Separate the LM ascent stage (ABORT STAGE / ascent from the surface).
 * @param {object} S sim internals {game, ev}
 * @param {object} v LM vessel
 * @returns {boolean} true if staged
 */
export function stageLM(S, v) {
  const { ev } = S;
  if (v.type !== 'LM') return false;
  if (v.staged) {
    ev.emit('message', { text: 'Ascent stage already separated', level: 'info' });
    return false;
  }
  if (v.docked) {
    ev.emit('message', { text: 'Cannot stage while docked', level: 'warn' });
    return false;
  }
  if (v.crashed) return false;
  const onSurface = v.landed || v.phys.sleeping;
  if (v.phys.eng.state !== 'off') killPropulsion(v, ev);
  const oldCgW = _a.copy(v.cg).applyQuaternion(v.quat).add(v.pos);
  const wW = _b.copy(v.angVel).applyQuaternion(v.quat);
  // the descent stage keeps flying with the body's current motion (origin velocity)
  const originVel = new THREE.Vector3().crossVectors(wW, new THREE.Vector3().copy(v.pos).sub(oldCgW)).add(v.vel);
  v.descentStage = {
    pos: v.pos.clone(),
    quat: v.quat.clone(),
    vel: onSurface ? new THREE.Vector3() : originVel,
    angVel: onSurface ? new THREE.Vector3() : v.angVel.clone(),
    landed: onSurface,
    falling: !onSurface,
    crashed: false,
    propellant: Math.max(0, v.propellant.main),
  };
  // mainEngine becomes the APS (same object, fields copied)
  const e = v.mainEngine;
  const A = LM.aps;
  e.name = A.name;
  e.maxThrust = A.maxThrust;
  e.isp = A.isp;
  e.minThrottle = A.minThrottle;
  e.maxThrottle = A.maxThrottle;
  e.thrustDir.copy(A.thrustDir);
  e.nozzleExit.copy(A.nozzleExit);
  e.nozzleExitRadius = A.nozzleExitRadius;
  e.nozzleThroat.copy(A.nozzleThroat);
  if (e.thrustLine) e.thrustLine.copy(A.thrustDir);
  e.throttle = 0;
  e.firing = false;
  e.gimbal.set(0, 0);
  v.phys.eng = { state: 'off', f: 0, thr: 0 };
  v.propellant.main = v.propellant.ascent;
  v.propellant.mainMax = v.propellant.ascentMax;
  v.staged = true;
  v.cw.lights['DES QTY'] = false;
  releasePads(v);
  // new mass properties; the CG moves up into the ascent stage — keep its true velocity
  updateVesselMassProps(v);
  const newCgW = new THREE.Vector3().copy(v.cg).applyQuaternion(v.quat).add(v.pos);
  v.vel.add(new THREE.Vector3().crossVectors(wW, newCgW.sub(oldCgW)));
  v.phys.td = newTouchdownState();
  if (onSurface) {
    v.phys.onPad = true; // resting on the descent stage until the APS lifts it
    v.phys.sleeping = true;
    v.vel.set(0, 0, 0);
    v.angVel.set(0, 0, 0);
    v.landed = true;
  } else {
    v.phys.sleeping = false;
    v.landed = false;
  }
  ev.emit('stage', { vessel: v.id });
  ev.emit('message', { text: onSurface ? 'Ascent stage separated — descent stage remains as the launch platform' : 'ABORT STAGE — ascent stage separated', level: onSurface ? 'info' : 'warn' });
  return true;
}

/** Ballistic fall of a descent stage jettisoned in flight; it comes to rest on the ground. */
export function updateDescentStage(S, ds, h) {
  if (!ds || !ds.falling) return;
  ds.vel.addScaledVector(gravityAt(ds.pos, _a), h);
  ds.pos.addScaledVector(ds.vel, h);
  integrateQuat(ds.quat, ds.angVel, h);
  // lowest point: footpad plane ~ origin; also the far pad tips
  const r = ds.pos.length();
  _a.copy(ds.pos).divideScalar(r);
  const alt = r - MOON.radius - terrainHeight(_a.x, _a.y, _a.z);
  if (alt <= 0) {
    const speed = ds.vel.length();
    ds.pos.copy(_a).multiplyScalar(MOON.radius + terrainHeight(_a.x, _a.y, _a.z));
    ds.vel.set(0, 0, 0);
    ds.angVel.set(0, 0, 0);
    ds.falling = false;
    ds.landed = true;
    ds.crashed = speed > 3;
    ds.impactSpeed = speed;
    S.ev.emit('message', { text: ds.crashed ? `Descent stage impacted the surface at ${fmtSpeed(S.game, speed, 0)}` : 'Descent stage came to rest on the surface', level: 'info' });
  }
}
