// 6-DOF rigid-body physics and propulsion for the Apollo spacecraft.
//
//  * Point-mass lunar gravity (MOON.mu), evaluated at the vehicle CG.
//  * Main engines (DPS / APS / SPS): ignition only when armed with propellant, start transient
//    (~0.3 s thrust rise), shutdown tail-off, DPS throttle servo lag (first-order, 0.25 s) with the
//    10 % minimum setting, mdot = F / (Isp g0). The force acts along mainEngine.thrustDir through
//    the CG (the trim gimbal keeps it there); mainEngine.gimbal / .thrustLine give the actual trim
//    angles and nozzle direction for effects.
//  * RCS: every jet of vessel.rcs.jets applies thrust * duty along forceDir at its nozzle; the
//    torque is (pos - cg) x F. Jets burn RCS propellant (Isp 290 s).
//  * Rotational dynamics: Euler's equations with the gyroscopic term, full 3x3 inertia tensor
//    (needed for the docked stack), quaternion integration with renormalisation.
//  * Translation: velocity-Verlet (symplectic, 2nd order) when free-flying — orbits stay put at
//    1000x warp with 1-s steps — and symplectic Euler while in ground contact (stiff springs).
//
// State convention: vessel.pos is the BODY ORIGIN in MCI (what the render models use),
// vessel.vel is the velocity of the vessel's CENTRE OF GRAVITY. Integration happens about the
// CG; the origin is recomputed from the CG and the attitude after every step.

import * as THREE from 'three';
import { MOON, G0, LM, CSM } from '../core/constants.js';
import { invert3, mul3, setDiag } from './massprops.js';

export const ENGINE = {
  START_TIME: 0.3, // s, thrust rise from ignition command to full commanded thrust
  STOP_TAU: 0.09, // s, exponential tail-off after shutdown (thrust < 3 % after ~0.3 s)
  THROTTLE_TAU: 0.25, // s, DPS throttle actuator first-order lag
  GIMBAL_LIMIT: 6 * Math.PI / 180, // trim gimbal range (DPS +-6 deg, SPS similar)
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _cgW = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Point-mass lunar gravity acceleration at MCI position p (writes out). */
export function gravityAt(p, out) {
  const r2 = p.lengthSq();
  const k = -MOON.mu / (r2 * Math.sqrt(r2));
  return out.copy(p).multiplyScalar(k);
}

/** Local gravity magnitude at radius r. */
export const localG = (r) => MOON.mu / (r * r);

/** Create the per-vessel private physics state (vessel.phys). */
export function createPhysState() {
  return {
    eng: { state: 'off', f: 0, thr: 0 }, // main engine state machine
    thrust: 0, // current main-engine thrust (N)
    force: new THREE.Vector3(), // non-gravitational force this step (world, N)
    torque: new THREE.Vector3(), // torque about CG this step (carrier body frame, N m)
    rcsForce: 0, // total RCS thrust magnitude this step (N)
    rcsActive: false,
    sleeping: false, // resting on the surface, integration frozen
    sleepTimer: 0,
    I: new Float64Array(9), // inertia tensor (row-major, own body frame)
    Iinv: new Float64Array(9),
    contactForce: new THREE.Vector3(), // ground reaction (world)
    anyContact: false,
  };
}

/**
 * Advance the main-engine state machine and consume propellant.
 * Sets mainEngine.throttle (actual fraction of maxThrust), .firing, .gimbal, .thrustLine.
 * @param {object} v vessel
 * @param {number} h step (s)
 * @param {object} events EventBus (engine on/off, messages)
 * @param {THREE.Vector3} cg CG in the vessel body frame used for the trim gimbal
 * @returns {number} thrust (N)
 */
export function updateEngine(v, h, events, cg = v.cg) {
  const e = v.mainEngine;
  const s = v.phys.eng;
  const fixed = e.minThrottle >= e.maxThrottle - 1e-6;
  const cmd = Math.min(Math.max(e.throttleCmd || 0, 0), e.maxThrottle);
  const want = cmd > 1e-4 && e.armed && v.propellant.main > 0 && !v.crashed;
  const target = fixed ? e.maxThrottle : Math.max(e.minThrottle, cmd);

  if (want && (s.state === 'off' || s.state === 'stopping')) {
    if (s.state === 'off') {
      s.thr = target; // the throttle valves are pre-positioned before the start
      events.emit('engine', { vessel: v.id, engine: e.name, on: true });
    }
    s.state = 'starting';
  } else if (!want && (s.state === 'starting' || s.state === 'running')) {
    s.state = 'stopping';
    events.emit('engine', { vessel: v.id, engine: e.name, on: false });
  }
  if (fixed) s.thr = e.maxThrottle;
  else if (s.state !== 'stopping') s.thr += (target - s.thr) * (1 - Math.exp(-h / ENGINE.THROTTLE_TAU));

  if (s.state === 'starting') {
    s.f += h / ENGINE.START_TIME;
    if (s.f >= 1) {
      s.f = 1;
      s.state = 'running';
    }
  } else if (s.state === 'stopping') {
    s.f *= Math.exp(-h / ENGINE.STOP_TAU);
    if (s.f < 0.01) {
      s.f = 0;
      s.state = 'off';
    }
  }
  // smooth thrust rise (chamber pressure build-up)
  const rise = s.state === 'starting' ? s.f * s.f * (3 - 2 * s.f) : s.f;
  let thrust = v.propellant.main > 0 ? e.maxThrust * s.thr * rise : 0; // dry tanks: no tail-off thrust
  // propellant
  if (thrust > 0) {
    const dm = (thrust / (e.isp * G0)) * h;
    if (dm >= v.propellant.main) {
      thrust *= v.propellant.main / dm;
      v.propellant.main = 0;
      // flame-out: the chamber empties at once. Announce it only on the transition (a shutdown
      // already commanded that runs the tanks dry during its tail-off is not a depletion).
      const wasOn = s.state === 'starting' || s.state === 'running';
      s.state = 'off';
      s.f = 0;
      if (wasOn) {
        events.emit('engine', { vessel: v.id, engine: e.name, on: false });
        events.emit('message', { text: `${e.name} shutdown — propellant depleted`, level: 'alarm' });
      }
    } else v.propellant.main -= dm;
    if (v.type === 'LM' && v.staged) v.propellant.ascent = v.propellant.main;
  }
  e.throttle = thrust / e.maxThrust;
  e.firing = s.state !== 'off';
  v.phys.thrust = thrust;

  // trim gimbal: DPS and SPS gimbal so that the thrust line passes through the CG
  if (!e.thrustLine) e.thrustLine = e.thrustDir.clone();
  if (!fixed) {
    const d = _v1.copy(cg).sub(e.nozzleThroat);
    const L = ENGINE.GIMBAL_LIMIT;
    if (Math.abs(e.thrustDir.y) > 0.5) {
      // thrust along +Y (LM): angles about X and Z
      e.gimbal.set(clamp(Math.atan2(d.z, d.y), -L, L), clamp(Math.atan2(-d.x, d.y), -L, L));
      e.thrustLine.set(-Math.sin(e.gimbal.y), Math.cos(e.gimbal.y), 0).applyAxisAngle(_v2.set(1, 0, 0), e.gimbal.x);
    } else {
      // thrust along -Z (CSM): angles about X (pitch) and Y (yaw)
      e.gimbal.set(clamp(Math.atan2(d.y, -d.z), -L, L), clamp(Math.atan2(-d.x, -d.z), -L, L));
      e.thrustLine.set(-Math.sin(e.gimbal.y), 0, -Math.cos(e.gimbal.y)).applyAxisAngle(_v2.set(1, 0, 0), e.gimbal.x);
    }
  } else {
    e.gimbal.set(0, 0);
    e.thrustLine.copy(e.thrustDir);
  }
  return thrust;
}

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

/**
 * Apply every RCS jet of vessel `v` into force/torque accumulators expressed in a carrier
 * body frame. For a free vessel the carrier is the vessel itself (R = identity, t = 0).
 * For the docked LM the carrier is the CSM: p_carrier = R p_LM + t.
 * @param {object} v vessel
 * @param {number} h step (s) — propellant consumption
 * @param {number} scale effective duty scale (1 normally; < 1 for long coast steps)
 * @param {THREE.Vector3} cg CG in the carrier frame (torque reference)
 * @param {THREE.Vector3} Fc force accumulator (carrier frame)
 * @param {THREE.Vector3} Tc torque accumulator (carrier frame)
 * @param {THREE.Matrix3|null} R rotation LM->carrier (null = identity)
 * @param {THREE.Vector3|null} t translation LM->carrier
 * @returns {number} total jet thrust (N)
 */
export function applyRcs(v, h, scale, cg, Fc, Tc, R = null, t = null) {
  const jets = v.rcs.jets;
  let total = 0;
  const isp = v.type === 'LM' ? LM.rcs.isp : CSM.rcs.isp;
  const hasProp = v.propellant.rcs > 0;
  for (let i = 0; i < jets.length; i++) {
    const j = jets[i];
    let lvl = j.cmd > 0 ? (j.cmd < 1 ? j.cmd : 1) : 0;
    if (!hasProp || v.crashed) lvl = 0;
    j.level = lvl;
    // cumulative firing time: lets effects/audio catch 14-ms minimum-impulse pulses that start
    // and end between two rendered frames
    if (lvl > 0) j.onTime = (j.onTime || 0) + lvl * h;
    if (lvl <= 0) continue;
    const F = j.thrust * lvl * scale;
    total += F;
    const dir = _v1.copy(j.forceDir);
    const pos = _v2.copy(j.pos);
    if (R) {
      dir.applyMatrix3(R);
      pos.applyMatrix3(R).add(t);
    }
    Fc.addScaledVector(dir, F);
    pos.sub(cg);
    Tc.add(_v3.crossVectors(pos, dir).multiplyScalar(F));
  }
  if (total > 0) {
    v.propellant.rcs = Math.max(0, v.propellant.rcs - (total / (isp * G0)) * h);
  }
  v.phys.rcsForce = total;
  v.phys.rcsActive = total > 0;
  return total;
}

/**
 * Integrate one rigid body over h.
 * @param {object} b body: {pos, quat, angVel (body), vel (CG, world), cg (body), mass, I, Iinv,
 *                   F (world non-grav force), T (body torque about CG)}
 * @param {number} h step (s)
 * @param {boolean} stiff true while in ground contact (symplectic Euler; forces from springs)
 */
export function integrateRigid(b, h, stiff) {
  const cgW = _cgW.copy(b.cg).applyQuaternion(b.quat).add(b.pos);
  const invM = 1 / b.mass;
  const g = gravityAt(cgW, _v1);
  if (stiff) {
    b.vel.addScaledVector(g, h).addScaledVector(b.F, invM * h);
    cgW.addScaledVector(b.vel, h);
  } else {
    // velocity Verlet (kick-drift-kick); non-gravitational force held constant over the step
    b.vel.addScaledVector(g, h / 2).addScaledVector(b.F, (invM * h) / 2);
    cgW.addScaledVector(b.vel, h);
    gravityAt(cgW, g);
    b.vel.addScaledVector(g, h / 2).addScaledVector(b.F, (invM * h) / 2);
  }
  // rotation — Euler's equations with the gyroscopic term, sub-stepped for fast spins
  const w = b.angVel;
  const n = Math.min(64, Math.max(1, Math.ceil((w.length() * h) / 0.02)));
  const hk = h / n;
  for (let k = 0; k < n; k++) {
    const Iw = mul3(b.I, w, _v2);
    const gyro = _v3.crossVectors(w, Iw);
    const tq = _v2.copy(b.T).sub(gyro);
    const wdot = mul3(b.Iinv, tq, _v3);
    w.addScaledVector(wdot, hk);
    integrateQuat(b.quat, w, hk);
  }
  // origin from CG
  b.pos.copy(b.cg).applyQuaternion(b.quat).negate().add(cgW);
}

/** q <- q * exp(w h / 2) for a body-frame angular velocity w; renormalised. */
export function integrateQuat(q, w, h) {
  const wm = Math.hypot(w.x, w.y, w.z);
  if (wm < 1e-12) return q;
  const half = (wm * h) / 2;
  const s = Math.sin(half) / wm;
  _q.set(w.x * s, w.y * s, w.z * s, Math.cos(half));
  q.multiply(_q).normalize();
  return q;
}

/** Fill a phys tensor (diagonal) from vessel.inertia. */
export function setDiagInertia(ph, inertia) {
  setDiag(ph.I, inertia);
  invert3(ph.I, ph.Iinv);
}

/** World position of the CG of vessel v (writes out). */
export function cgWorld(v, out) {
  return out.copy(v.cg).applyQuaternion(v.quat).add(v.pos);
}

/** World velocity of body point pBody (body frame) of a free vessel. */
export function pointVelocity(v, pBody, out) {
  // v_p = v_cg + w x (r_p - r_cg), all in world
  const r = _v1.copy(pBody).sub(v.cg).applyQuaternion(v.quat);
  const wW = _v2.copy(v.angVel).applyQuaternion(v.quat);
  return out.crossVectors(wW, r).add(v.vel);
}
