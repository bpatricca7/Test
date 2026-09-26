// Guidance mathematics for the LM powered descent (P63/P64/P66) and powered ascent (P12/P71).
//
// DESCENT — Apollo "quadratic" / E-guidance (A. R. Klumpp, "Apollo Lunar Descent Guidance",
// 1974) in a landing-site-centred Cartesian frame (Moon-fixed = inertial here, the simulated
// Moon does not rotate):
//     x = up (radial through the target), y = cross-range, z = downrange (direction of approach)
// Each phase has a target state (position RT, velocity VT, acceleration AT, and the downrange
// component of the jerk JTZ). The reference trajectory is the quartic polynomial in time that
// joins the current state to the target; its current acceleration is
//     ACG = AT - 6 (VT + V) / T + 12 (RT - R) / T^2              (T = time-to-go > 0)
// and T is chosen so that the downrange jerk of that polynomial equals JTZ:
//     JTZ T^3 - 6 ATZ T^2 + (18 VTZ + 6 VZ) T - 24 (RTZ - RZ) = 0
// The thrust acceleration command is ACG - g (g = lunar gravity vector in the frame). Guidance
// runs on a 2-second cycle, as in the LGC.
//
// ASCENT — explicit linear-acceleration ("E-guidance") steering to the insertion target
// (radius, radial rate, horizontal velocity, in the target orbital plane) with the time-to-go
// from the rocket equation, cut-off when the velocity-to-be-gained is exhausted.

import * as THREE from 'three';
import { MOON, MISSION, FT } from '../core/constants.js';
import { terrainHeight } from '../world/moon.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

// ------------------------------------------------------------------ targets

/**
 * Descent phase targets (site frame: x up, y cross, z downrange; m, m/s, m/s^2, m/s^3).
 * The braking phase (P63) ends at High Gate, the approach phase (P64) at Low Gate
 * (core/constants.js MISSION.highGate / lowGate).
 */
export const DESCENT_TARGETS = {
  braking: {
    r: new THREE.Vector3(MISSION.highGate.altitude, 0, MISSION.highGate.downrange),
    v: new THREE.Vector3(MISSION.highGate.vSpeed, 0, MISSION.highGate.hSpeed),
    // acceleration at High Gate: a firmer deceleration than the approach phase needs, so that
    // the approach phase begins with the historical pitch-over toward the upright
    a: new THREE.Vector3(0.0, 0, -2.2),
    jz: 0.005, // tuned: FTP to ~PDI+6:15, High Gate at ~PDI+8:30 (Apollo 11: 6:24 / 8:27)
    endTgo: 4, // s: P63 -> P64 when the time-to-go falls below this
  },
  approach: {
    r: new THREE.Vector3(MISSION.lowGate.altitude, 0, MISSION.lowGate.downrange),
    v: new THREE.Vector3(MISSION.lowGate.vSpeed, 0, MISSION.lowGate.hSpeed),
    a: new THREE.Vector3(0.1, 0, -0.45),
    jz: 0.0,
    endTgo: 3,
  },
};

/** Apollo 11 ascent insertion target (relative to the landing-site radius). */
export const ASCENT_TARGET = {
  altitude: 60000 * FT, // 18.3 km
  vRadial: 32 * FT, // +9.75 m/s
  vHorizontal: 5535 * FT, // 1,687 m/s
  verticalRise: 10, // s
};

// ------------------------------------------------------------------ site frame

/**
 * Landing-site-centred guidance frame.
 * @param {THREE.Vector3} targetDir unit MCI direction of the landing target
 * @param {THREE.Vector3} travel direction of approach (MCI; projected on the local horizontal)
 * @param {object} [out]
 * @returns {{origin, up, cross, down, siteRadius}}
 */
export function makeSiteFrame(targetDir, travel, out = {}) {
  out.up = (out.up || new THREE.Vector3()).copy(targetDir).normalize();
  out.down = (out.down || new THREE.Vector3()).copy(travel).addScaledVector(out.up, -travel.dot(out.up));
  if (out.down.lengthSq() < 1e-12) out.down.set(-out.up.y, out.up.x, 0);
  out.down.normalize();
  out.cross = (out.cross || new THREE.Vector3()).crossVectors(out.down, out.up).normalize(); // y = z x x
  const u = out.up;
  out.siteHeight = terrainHeight(u.x, u.y, u.z);
  out.siteRadius = MOON.radius + out.siteHeight;
  out.origin = (out.origin || new THREE.Vector3()).copy(u).multiplyScalar(out.siteRadius);
  return out;
}

/** MCI position -> frame coordinates (x up, y cross, z downrange). */
export function toFramePos(F, p, out) {
  const d = _a.copy(p).sub(F.origin);
  return out.set(d.dot(F.up), d.dot(F.cross), d.dot(F.down));
}

/** MCI direction/vector -> frame components. */
export function toFrameVec(F, d, out) {
  return out.set(d.dot(F.up), d.dot(F.cross), d.dot(F.down));
}

/** Frame components -> MCI vector. */
export function fromFrameVec(F, f, out) {
  return out.copy(F.up).multiplyScalar(f.x).addScaledVector(F.cross, f.y).addScaledVector(F.down, f.z);
}

/** Lunar gravity at MCI position p (m/s^2 vector, writes out). */
export function gravity(p, out) {
  const r2 = p.lengthSq();
  return out.copy(p).multiplyScalar(-MOON.mu / (r2 * Math.sqrt(r2)));
}

// ------------------------------------------------------------------ quadratic guidance

/**
 * Time-to-go from the downrange jerk condition (positive root, bracketed Newton).
 * @param {number} rz current downrange position
 * @param {number} vz current downrange velocity
 * @param {object} tgt phase target {r, v, a, jz}
 * @param {number} guess previous time-to-go (s)
 */
export function solveTgo(rz, vz, tgt, guess = 60) {
  const J = tgt.jz;
  const A = tgt.a.z;
  const V = tgt.v.z;
  const D = tgt.r.z - rz;
  const f = (T) => J * T * T * T - 6 * A * T * T + (18 * V + 6 * vz) * T - 24 * D;
  const df = (T) => 3 * J * T * T - 12 * A * T + 18 * V + 6 * vz;
  if (D <= 0) return 0.5; // past the target
  // bracket a sign change f(lo) < 0 < f(hi) (f(0) = -24 D < 0)
  let lo = 0;
  let hi = Math.max(1, guess);
  let n = 0;
  while (f(hi) < 0 && n++ < 60) {
    lo = hi;
    hi *= 1.6;
  }
  if (f(hi) < 0) return hi; // no root (should not happen with sane targets)
  let T = Math.min(Math.max(guess, lo), hi);
  for (let i = 0; i < 40; i++) {
    const fv = f(T);
    if (fv < 0) lo = T;
    else hi = T;
    const d = df(T);
    let Tn = d > 1e-9 ? T - fv / d : 0.5 * (lo + hi);
    if (!(Tn > lo && Tn < hi)) Tn = 0.5 * (lo + hi);
    if (Math.abs(Tn - T) < 1e-4) return Tn;
    T = Tn;
  }
  return T;
}

/**
 * Commanded (kinematic) acceleration of the quartic reference trajectory.
 * @param {THREE.Vector3} r current position (frame)
 * @param {THREE.Vector3} v current velocity (frame)
 * @param {object} tgt phase target {r, v, a}
 * @param {number} T time-to-go (s)
 * @param {THREE.Vector3} out
 */
export function quadraticAccel(r, v, tgt, T, out) {
  const T2 = T * T;
  out.copy(tgt.a);
  out.addScaledVector(_b.copy(tgt.v).add(v), -6 / T);
  out.addScaledVector(_c.copy(tgt.r).sub(r), 12 / T2);
  return out;
}

/**
 * Throttle logic of the DPS: fixed throttle position (FTP, max) until the commanded thrust
 * falls below ~60 %, then throttling in the 10..65 % range; back to FTP if the command
 * exceeds 65 %.
 * @param {object} st {ftp: boolean}
 * @param {number} cmd commanded thrust fraction
 * @returns {number} throttle command
 */
export function dpsThrottle(st, cmd) {
  if (st.ftp) {
    if (cmd < 0.6) {
      st.ftp = false;
      st.throttledDown = true;
    }
  } else if (cmd > 0.65) {
    st.ftp = true;
  }
  return st.ftp ? 1.0 : Math.min(0.65, Math.max(0.1, cmd));
}

// ------------------------------------------------------------------ P66

/**
 * P66 rate-of-descent throttle law: thrust = m (g - centrifugal + (vcmd - v)/tau) / cos(tilt),
 * lag-compensated (the vertical speed is predicted one throttle-lag ahead).
 * @param {object} s {mass, g, vUp, hSpeed, r, accUp, cosTilt, vCmd, maxThrust}
 * @returns {number} throttle fraction (unclamped)
 */
export function rodThrottle(s) {
  const tau = 1.5;
  const lag = 0.25; // DPS throttle actuator lag (s)
  const vPred = s.vUp + s.accUp * lag;
  const cent = (s.hSpeed * s.hSpeed) / s.r;
  const aUp = s.g - cent + (s.vCmd - vPred) / tau;
  const cosT = Math.max(0.5, s.cosTilt);
  return (s.mass * aUp) / cosT / s.maxThrust;
}

// ------------------------------------------------------------------ ascent

/**
 * Ascent steering (P12 / P71): thrust direction to reach the insertion target.
 * @param {object} s {pos, vel (MCI CG), mass, thrust (N), ve (m/s), planeNormal (unit MCI),
 *   targetRadius, vRadial, vHorizontal}
 * @param {object} out {dir: Vector3 (MCI unit thrust direction), tgo, vgo, vgoVec}
 */
export function ascentSteer(s, out) {
  const rMag = s.pos.length();
  const rh = _a.copy(s.pos).divideScalar(rMag);
  const n = s.planeNormal;
  const hd = _b.crossVectors(n, rh).normalize(); // downrange horizontal (direction of travel)
  const vr = s.vel.dot(rh);
  const vh = s.vel.dot(hd);
  const vc = s.vel.dot(n);
  const c = s.pos.dot(n); // out-of-plane distance
  const aF = s.thrust / s.mass;
  // velocity to be gained
  const dvh = s.vHorizontal - vh;
  const dvr = s.vRadial - vr;
  const gEff = MOON.mu / (rMag * rMag) - (vh * vh) / rMag;
  let vgo = Math.hypot(dvh, dvr, vc);
  // gravity-loss estimate: the radial velocity lost to (net) gravity during the burn
  const tau = s.ve / aF;
  let tgo = tau * (1 - Math.exp(-vgo / s.ve));
  for (let i = 0; i < 3; i++) {
    vgo = Math.hypot(dvh, dvr + Math.max(0, gEff) * tgo * 0.5, vc);
    tgo = tau * (1 - Math.exp(-vgo / s.ve));
  }
  const T = Math.max(tgo, 1);
  // radial: linear-acceleration profile meeting radius and radial rate at T
  const dR = s.targetRadius - rMag - vr * T;
  let ar = gEff + (6 * dR) / (T * T) - (2 * dvr) / T;
  // cross-range: null out-of-plane position and velocity (limited)
  let ac = (6 * (-c - vc * T)) / (T * T) + (2 * vc) / T;
  ac = Math.max(-0.15 * aF, Math.min(0.15 * aF, ac));
  ar = Math.max(-0.8 * aF, Math.min(0.97 * aF, ar));
  const ah2 = aF * aF - ar * ar - ac * ac;
  const ah = ah2 > 0 ? Math.sqrt(ah2) : 0;
  out.dir = (out.dir || new THREE.Vector3()).copy(rh).multiplyScalar(ar).addScaledVector(hd, ah).addScaledVector(n, ac).normalize();
  out.tgo = tgo;
  out.vgo = vgo;
  out.vh = vh;
  out.vr = vr;
  out.alt = rMag;
  out.downrange = out.downrange || new THREE.Vector3();
  out.downrange.copy(hd);
  out.vgoVec = (out.vgoVec || new THREE.Vector3()).copy(hd).multiplyScalar(dvh).addScaledVector(rh, dvr).addScaledVector(n, -vc);
  return out;
}

// ------------------------------------------------------------------ LPD geometry

/**
 * Landing point designator angles of an MCI point seen from the CDR's design eye.
 * @returns {{elev:number, az:number, range:number}} elev: deg below body -Z (in the body
 *   Y-Z plane, what the window reticle is marked in), az: deg to the right.
 */
export function lpdAngles(quat, eyeMCI, pointMCI, out = {}) {
  const d = _a.copy(pointMCI).sub(eyeMCI);
  out.range = d.length();
  d.applyQuaternion(quatInv(quat));
  out.elev = (Math.atan2(-d.y, -d.z) * 180) / Math.PI;
  out.az = (Math.atan2(d.x, Math.hypot(d.y, d.z)) * 180) / Math.PI;
  return out;
}

const _qi = new THREE.Quaternion();
function quatInv(q) {
  return _qi.copy(q).invert();
}

/**
 * Intersect the line of sight at LPD angles (elev below -Z, az right) from the eye with the
 * terrain. Returns the unit MCI direction of the ground point, or null if it does not hit.
 */
export function lpdRay(quat, eyeMCI, elevDeg, azDeg, out = new THREE.Vector3()) {
  const e = (elevDeg * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  const dir = _b.set(Math.sin(az), -Math.sin(e) * Math.cos(az), -Math.cos(e) * Math.cos(az)).applyQuaternion(quat);
  const up = _c.copy(eyeMCI).normalize();
  const dn = dir.dot(up);
  if (dn > -0.02) return null; // at or above the horizon
  const eyeAlt = eyeMCI.length() - MOON.radius - terrainHeight(up.x, up.y, up.z);
  let s = eyeAlt / -dn;
  for (let i = 0; i < 12; i++) {
    const p = _a.copy(eyeMCI).addScaledVector(dir, s);
    const r = p.length();
    p.divideScalar(r);
    const alt = r - MOON.radius - terrainHeight(p.x, p.y, p.z);
    if (Math.abs(alt) < 0.05) break;
    s += alt / -dn;
    if (s < 0) return null;
  }
  return out.copy(eyeMCI).addScaledVector(dir, s).normalize();
}
