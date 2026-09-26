// Telemetry (vessel.tel), caution & warning lights and propellant callouts.
//
// All functions are allocation-free in the hot path: telemetry is refreshed for both
// vessels after every physics substep.
//
// Added telemetry fields (beyond core/state.js createTelemetry):
//   gearAltitude   LM: height of the footpad plane (body origin) above the terrain (m)
//   bingoSeconds   LM descent: seconds of hover propellant above the 20-s bingo reserve
//   hoverThrottle  LM: throttle fraction that balances local gravity
//   gLocal         local gravity (m/s^2)
//   mass, thrust   current mass (own, or stack when docked) and main-engine thrust (N)
//   relTarget.dock {axial, lateral, closing, misalignDeg, range} CSM probe tip vs LM drogue

import * as THREE from 'three';
import { MOON, LM, G0 } from '../core/constants.js';
import { terrainHeight } from '../world/moon.js';
import { dockingGeometry } from './docking.js';

const R2D = 180 / Math.PI;
const _cg = new THREE.Vector3();
const _u = new THREE.Vector3();
const _e = new THREE.Vector3();
const _n = new THREE.Vector3();
const _h = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Radar antenna (LR, bottom of the descent stage) in LM body coordinates. */
const LR_ANTENNA = new THREE.Vector3(0, LM.descentStage.yBottom, 0.6);

function enuAt(p) {
  _u.copy(p).normalize();
  _e.set(-_u.y, _u.x, 0);
  if (_e.lengthSq() < 1e-12) _e.set(0, 1, 0);
  _e.normalize();
  _n.crossVectors(_u, _e);
}

/**
 * Fill every field of vessel.tel.
 * @param {object} v vessel
 * @param {object} other the other vessel (relative target)
 * @param {object|null} stack docked stack state (sim) or null
 */
export function updateTelemetry(v, other, stack) {
  const t = v.tel;
  _cg.copy(v.cg).applyQuaternion(v.quat).add(v.pos);
  const r = _cg.length();
  enuAt(_cg);
  const th = terrainHeight(_u.x, _u.y, _u.z);
  t.terrainHeight = th;
  t.altitudeRef = r - MOON.radius;
  t.altitude = r - MOON.radius - th;
  const vel = v.vel;
  t.velENU.set(vel.dot(_e), vel.dot(_n), vel.dot(_u));
  t.vSpeed = t.velENU.z;
  t.hSpeed = Math.hypot(t.velENU.x, t.velENU.y);
  t.lat = Math.asin(Math.max(-1, Math.min(1, _u.z))) * R2D;
  t.lon = Math.atan2(_u.y, _u.x) * R2D;
  let trk = Math.atan2(t.velENU.x, t.velENU.y) * R2D;
  if (trk < 0) trk += 360;
  t.heading = trk;

  // attitude relative to the local horizon (same definitions as frames.horizonAttitude)
  const right = _a.set(1, 0, 0).applyQuaternion(v.quat);
  const fwd = _f.set(0, 0, -1).applyQuaternion(v.quat);
  const bUp = _b.set(0, 1, 0).applyQuaternion(v.quat);
  const att = t.attitude || (t.attitude = {});
  att.pitch = Math.asin(Math.max(-1, Math.min(1, fwd.dot(_u)))) * R2D;
  let hd = Math.atan2(fwd.dot(_e), fwd.dot(_n)) * R2D;
  if (hd < 0) hd += 360;
  att.heading = hd;
  _h.crossVectors(fwd, _u);
  if (_h.lengthSq() > 1e-10) {
    _h.normalize();
    _r.crossVectors(_h, fwd).normalize();
    att.roll = Math.atan2(-right.dot(_r), right.dot(_h)) * R2D;
  } else att.roll = 0;
  att.tiltFromVertical = Math.acos(Math.max(-1, Math.min(1, bUp.dot(_u)))) * R2D;

  // orbit summary (two-body, about the reference sphere)
  const mu = MOON.mu;
  const v2 = vel.lengthSq();
  _h.crossVectors(_cg, vel);
  const hm = _h.length();
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);
  const ecc = Math.sqrt(Math.max(0, 1 + (2 * energy * hm * hm) / (mu * mu)));
  const rp = (hm * hm) / mu / (1 + ecc);
  t.periapsisAlt = rp - MOON.radius;
  const bound = energy < 0; // (a radial, e = 1 trajectory is still bound)
  t.apoapsisAlt = bound ? a * (1 + Math.min(ecc, 1)) - MOON.radius : Infinity;
  t.period = bound ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity;
  t.orbitalSpeed = Math.sqrt(v2);
  t.inclinationDeg = Math.acos(Math.max(-1, Math.min(1, _h.z / (hm || 1)))) * R2D;
  t.eccentricity = ecc;
  t.semiMajorAxis = a;

  // propulsion
  const g = mu / (r * r);
  t.gLocal = g;
  const mass = v.docked && v.stack ? v.stack.mass : v.mass;
  t.mass = mass;
  const e = v.mainEngine;
  const thrust = e.throttle * e.maxThrust;
  t.thrust = thrust;
  const ph = v.phys;
  if (ph && ph.sleeping) t.accel = v.landed ? g : 0;
  else t.accel = ph ? ph.force.length() / mass : thrust / mass;
  t.twr = thrust / (mass * g);
  t.maxTwr = (e.maxThrust * e.maxThrottle) / (mass * g);
  t.fuelFraction = v.propellant.mainMax > 0 ? Math.max(0, v.propellant.main) / v.propellant.mainMax : 0;
  t.rcsFraction = v.propellant.rcsMax > 0 ? Math.max(0, v.propellant.rcs) / v.propellant.rcsMax : 0;
  const thr = e.firing && e.throttle > 0 ? e.throttle : e.minThrottle;
  t.burnTimeLeft = Math.max(0, v.propellant.main) / ((e.maxThrust * thr) / (e.isp * G0));

  // landing site / guidance target
  const tgt = v.gnc.targetDir;
  const tl = tgt.length() || 1;
  const c = Math.max(-1, Math.min(1, _u.dot(tgt) / tl));
  t.rangeToSite = Math.acos(c) * MOON.radius;
  _a.copy(tgt).divideScalar(tl).addScaledVector(_u, -c);
  let brg = Math.atan2(_a.dot(_e), _a.dot(_n)) * R2D;
  if (brg < 0) brg += 360;
  t.bearingToSite = brg;

  // LM specifics
  if (v.type === 'LM') {
    // footpad plane altitude (body origin)
    const ro = v.pos.length();
    _a.copy(v.pos).divideScalar(ro);
    // (high up, the terrain under the CG is good enough for the footpad plane)
    t.gearAltitude = ro - MOON.radius - (t.altitude > 1000 ? th : terrainHeight(_a.x, _a.y, _a.z));
    t.hoverThrottle = (mass * g) / (e.maxThrust || 1);
    const hoverMdot = (mass * g) / (e.isp * G0);
    t.bingoSeconds = v.staged ? NaN : Math.max(0, v.propellant.main) / hoverMdot - 20;
    t.radarAltitude = radarAltitude(v, t, bUp);
  } else {
    t.radarAltitude = NaN;
  }

  // relative target
  if (other) {
    const rt = t.relTarget || (t.relTarget = { range: 0, rangeRate: 0, pos: new THREE.Vector3(), dock: {} });
    const d = _a.copy(other.pos).sub(v.pos);
    rt.range = d.length();
    const dv = _b.copy(other.vel).sub(vel);
    rt.rangeRate = rt.range > 1e-6 ? d.dot(dv) / rt.range : 0;
    rt.pos.copy(d).applyQuaternion(_q.copy(v.quat).invert());
    const csm = v.type === 'CSM' ? v : other;
    const lm = v.type === 'LM' ? v : other;
    if (rt.range < 5000) dockingGeometry(csm, lm, rt.dock);
    else {
      rt.dock.axial = rt.dock.lateral = rt.dock.range = rt.range;
      rt.dock.closing = -rt.rangeRate;
      rt.dock.misalignDeg = NaN;
    }
  }
}

/**
 * Landing radar altitude: slant range along the beam (body -Y from the antenna) to the terrain,
 * converted to altitude with the attitude and referenced to the footpad plane (reads ~0 at
 * touchdown). NaN when above 15 km, tilted > 60 deg from vertical, or after staging.
 */
function radarAltitude(v, t, bUp) {
  if (v.staged || t.altitude > 15000) return NaN;
  const cosT = bUp.dot(_u);
  if (cosT < 0.5) return NaN;
  const A = _r.copy(LR_ANTENNA).applyQuaternion(v.quat).add(v.pos);
  const beam = _h.copy(bUp).negate();
  // iterate along the beam to the terrain it actually hits
  const ra = A.length();
  _b.copy(A).divideScalar(ra);
  let s = (ra - MOON.radius - terrainHeight(_b.x, _b.y, _b.z)) / cosT;
  for (let i = 0; i < 2; i++) {
    _b.copy(A).addScaledVector(beam, s);
    const rb = _b.length();
    _b.divideScalar(rb);
    const hp = rb - MOON.radius - terrainHeight(_b.x, _b.y, _b.z);
    s += hp / cosT;
    if (Math.abs(hp) < 0.01) break;
  }
  return Math.max(0, s * cosT - LR_ANTENNA.y * cosT);
}

// ------------------------------------------------------------------ caution & warning

let _init = false;
function setLight(v, name, on, ev, alarm) {
  const was = !!v.cw.lights[name];
  v.cw.lights[name] = on;
  if (on && !was && alarm && !_init) {
    v.cw.masterAlarm = true;
    v.cw.lights['MASTER ALARM'] = true;
    ev.emit('alarm', { code: name, text: alarm, vessel: v.id });
  }
}

const DESCENT_PROGRAMS = new Set(['P63', 'P64', 'P65', 'P66', 'P67']);

/**
 * Caution & warning lights and the Apollo-style propellant callouts.
 * @param {object} v vessel
 * @param {{emit: Function}} ev emitter
 * @param {boolean} [init] scenario start: set the lights without triggering the master alarm
 */
export function updateCaution(v, ev, init = false) {
  _init = init;
  try {
    cautionImpl(v, ev);
  } finally {
    _init = false;
  }
}

function cautionImpl(v, ev) {
  const p = v.propellant;
  const cw = v.phys.cw || (v.phys.cw = { said60: false, said30: false, saidBingo: false, qtyCallout: false });
  if (v.type === 'LM') {
    if (!v.staged) {
      const low = p.main / LM.descentPropMax < 0.056;
      setLight(v, 'DES QTY', low, ev, 'DES QTY — descent propellant low level (5.6 %)');
      if (low && !cw.qtyCallout && !v.landed && v.mainEngine.firing) {
        cw.qtyCallout = true;
        ev.emit('callout', { text: 'Quantity light.', voice: true, who: 'LMP' });
      }
      setLight(v, 'ASC QTY', false, ev);
    } else {
      setLight(v, 'DES QTY', false, ev);
      setLight(v, 'ASC QTY', p.main / LM.ascentPropMax < 0.1, ev, 'ASC QTY — ascent propellant low');
    }
    setLight(v, 'RCS', p.rcs / p.rcsMax < 0.1, ev, 'RCS — RCS propellant low');
    // landing radar data-good lights (ALT / VEL on until the radar locks on)
    const noRadar = !v.staged && !v.landed && DESCENT_PROGRAMS.has(v.gnc.program) && !Number.isFinite(v.tel.radarAltitude);
    setLight(v, 'ALT', noRadar, ev);
    setLight(v, 'VEL', noRadar, ev);

    // Houston's fuel callouts: seconds of hover propellant above the 20-s bingo reserve
    const descent = !v.staged && !v.landed && !v.crashed && v.mainEngine.firing;
    const b = v.tel.bingoSeconds;
    if (descent && Number.isFinite(b)) {
      if (b <= 60 && !cw.said60 && b > 30) {
        cw.said60 = true;
        ev.emit('callout', { text: 'Sixty seconds.', voice: true, who: 'CAPCOM' });
        ev.emit('message', { text: '60 seconds to BINGO fuel', level: 'warn' });
      } else if (b <= 30 && !cw.said30 && b > 0) {
        cw.said60 = cw.said30 = true;
        ev.emit('callout', { text: 'Thirty seconds.', voice: true, who: 'CAPCOM' });
        ev.emit('message', { text: '30 seconds to BINGO fuel — land or abort', level: 'alarm' });
      } else if (b <= 0 && !cw.saidBingo) {
        cw.said60 = cw.said30 = cw.saidBingo = true;
        ev.emit('message', { text: 'BINGO fuel — 20 s of hover left: land now or ABORT STAGE', level: 'alarm' });
      }
    }
  } else {
    setLight(v, 'SPS QTY', p.main / p.mainMax < 0.05, ev, 'SPS QTY — SPS propellant low');
    setLight(v, 'SM RCS A', p.rcs / p.rcsMax < 0.1, ev, 'SM RCS — propellant low');
  }
}
