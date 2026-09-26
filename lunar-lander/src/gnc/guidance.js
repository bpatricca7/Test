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
import { MOON, MISSION, FT, LM } from '../core/constants.js';
import { terrainHeight } from '../world/moon.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

// ------------------------------------------------------------------ targets

/**
 * High Gate as targeted by the LGC. The approach phase (P64) is flown so that the landing site
 * stays at an almost constant LPD angle of ~45-49 deg, inside the CDR's window reticle (which
 * ends at ~53 deg), from the pitch-over to Low Gate — the purpose of the Apollo approach-phase
 * design. With the High Gate speed of 150 m/s that needs ~10 km of range-to-go: from 7.9 km the
 * braking to Low Gate would need 40-47 deg of pitch-back and the site would sit below the window.
 */
export const HIGH_GATE = { ...MISSION.highGate, downrange: Math.min(MISSION.highGate.downrange, -10000) };

/**
 * Descent phase targets (site frame: x up, y cross, z downrange; m, m/s, m/s^2, m/s^3).
 * The braking phase (P63) ends at High Gate, the approach phase (P64) at Low Gate
 * (HIGH_GATE above, core/constants.js MISSION.lowGate).
 */
export const DESCENT_TARGETS = {
  braking: {
    r: new THREE.Vector3(HIGH_GATE.altitude, 0, HIGH_GATE.downrange),
    v: new THREE.Vector3(HIGH_GATE.vSpeed, 0, HIGH_GATE.hSpeed),
    // acceleration at High Gate: a firmer deceleration than the approach phase needs, so that
    // the approach phase begins with the historical pitch-over toward the upright (~54 -> ~30 deg)
    a: new THREE.Vector3(0.0, 0, -2.2),
    jz: 0.005, // tuned: FTP to ~PDI+6:24, High Gate at ~PDI+8:22 (Apollo 11: 6:24 / 8:27)
    endTgo: 4, // s: P63 -> P64 when the time-to-go falls below this
  },
  approach: {
    r: new THREE.Vector3(MISSION.lowGate.altitude, 0, MISSION.lowGate.downrange),
    v: new THREE.Vector3(MISSION.lowGate.vSpeed, 0, MISSION.lowGate.hSpeed),
    a: new THREE.Vector3(0.1, 0, -0.45),
    // downrange jerk at Low Gate: spreads the braking evenly over the phase (constant ~30 deg
    // pitch-back, site fixed in the window) instead of front-loading it
    jz: 0.012,
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
 * falls below ~60 %, then throttling in the 10..65 % range (the 65..92.5 % region eroded the
 * nozzle and was never used). After throttle recovery the LGC stays throttleable: a command
 * above 65 % saturates at 65 %; only a sustained demand above 90 % (two guidance cycles in a
 * row, e.g. an abort-like situation) returns the engine to FTP.
 * @param {object} st {ftp: boolean, throttledDown?: boolean, high?: number}
 * @param {number} cmd commanded thrust fraction
 * @returns {number} throttle command
 */
export function dpsThrottle(st, cmd) {
  if (st.ftp) {
    if (cmd < 0.6) {
      st.ftp = false;
      st.throttledDown = true;
      st.high = 0;
    }
  } else if (cmd > 0.9) {
    st.high = (st.high || 0) + 1;
    if (st.high >= 2 || !st.throttledDown) st.ftp = true;
  } else {
    st.high = 0;
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
 * Azimuth (deg, + = right of the CDR's design eye) of the LPD scale line etched on the CDR's
 * window. In P64 the LGC yaws the LM about its thrust axis so that the landing site lies on this
 * line, where the reticle marks are (render/cockpit/lm/lpd.js draws the scale at the same azimuth).
 */
export const LPD_AZIMUTH = Number.isFinite(LM.lpdAzimuthDeg) ? LM.lpdAzimuthDeg : 21;

/**
 * Body forward (-Z) direction that puts a target point at LPD azimuth `azDeg` while the body +Y
 * (thrust) axis is `upDir`: a yaw about the thrust axis, which leaves the thrust vector unchanged.
 * @param {THREE.Vector3} upDir unit MCI thrust-axis direction
 * @param {THREE.Vector3} eyeMCI eye position (MCI)
 * @param {THREE.Vector3} pointMCI target point (MCI)
 * @param {number} azDeg desired azimuth (deg, + right)
 * @param {THREE.Vector3} out forward direction (unit, perpendicular to upDir)
 * @returns {THREE.Vector3|null} out, or null when the point is (nearly) on the thrust axis
 */
export function lpdForward(upDir, eyeMCI, pointMCI, azDeg, out) {
  const s = _a.copy(pointMCI).sub(eyeMCI);
  const sLen = s.length();
  const sp = s.addScaledVector(upDir, -s.dot(upDir)); // component perpendicular to the thrust axis
  const rho = sp.length();
  if (!(rho > 1e-6 * Math.max(1, sLen))) return null;
  sp.divideScalar(rho);
  // body components of the line of sight: dx = rho sin(phi), dz = -rho cos(phi), dy = s.u;
  // azimuth atan2(dx, hypot(dy, dz)) = az  <=>  sin(phi) = sin(az) |s| / rho
  const sinPhi = Math.max(-1, Math.min(1, (Math.sin((azDeg * Math.PI) / 180) * sLen) / rho));
  const cosPhi = Math.sqrt(1 - sinPhi * sinPhi);
  // forward = the perpendicular line of sight rotated about the thrust axis by +phi
  const ux = _c.crossVectors(upDir, sp);
  return out.copy(sp).multiplyScalar(cosPhi).addScaledVector(ux, sinPhi).normalize();
}

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

// ------------------------------------------------------------------ orbit coast (DOI / PDI timing)

/** Arc angle of the PDI point before the landing site along the ground track (rad, < 0). */
export const PDI_ARC = -MISSION.pdiRangeToSite / MOON.radius;

/**
 * Arc angle (rad, -pi..pi) of MCI position `pos` along the orbit of angular-momentum direction
 * `hHat`, measured from the landing site's projection on the orbit plane in the direction of
 * motion (negative = uprange of the site, approaching it).
 */
export function orbitArc(pos, hHat, siteDir) {
  const sp = _a.copy(siteDir).addScaledVector(hHat, -siteDir.dot(hHat));
  if (sp.lengthSq() < 1e-12) return 0;
  sp.normalize();
  const r = _b.copy(pos).normalize();
  const y = _c.crossVectors(sp, r).dot(hHat);
  return Math.atan2(y, sp.dot(r));
}

/** Point on the orbit plane at arc angle psi from the site's projection (unit MCI). */
export function arcPoint(hHat, siteDir, psi, out = new THREE.Vector3()) {
  const sp = _a.copy(siteDir).addScaledVector(hHat, -siteDir.dot(hHat)).normalize();
  const t = _b.crossVectors(hHat, sp);
  return out.copy(sp).multiplyScalar(Math.cos(psi)).addScaledVector(t, Math.sin(psi)).normalize();
}

const _kp = new THREE.Vector3();
const _kv = new THREE.Vector3();
const _k = [0, 1, 2, 3].map(() => ({ r: new THREE.Vector3(), v: new THREE.Vector3() }));
const _tr = new THREE.Vector3();
function accelAt(p, out) {
  const r2 = p.lengthSq();
  return out.copy(p).multiplyScalar(-MOON.mu / (r2 * Math.sqrt(r2)));
}
function rk4(p, v, h) {
  const k = _k;
  k[0].r.copy(v);
  accelAt(p, k[0].v);
  k[1].r.copy(v).addScaledVector(k[0].v, h / 2);
  accelAt(_tr.copy(p).addScaledVector(k[0].r, h / 2), k[1].v);
  k[2].r.copy(v).addScaledVector(k[1].v, h / 2);
  accelAt(_tr.copy(p).addScaledVector(k[1].r, h / 2), k[2].v);
  k[3].r.copy(v).addScaledVector(k[2].v, h);
  accelAt(_tr.copy(p).addScaledVector(k[2].r, h), k[3].v);
  p.addScaledVector(k[0].r, h / 6).addScaledVector(k[1].r, h / 3).addScaledVector(k[2].r, h / 3).addScaledVector(k[3].r, h / 6);
  v.addScaledVector(k[0].v, h / 6).addScaledVector(k[1].v, h / 3).addScaledVector(k[2].v, h / 3).addScaledVector(k[3].v, h / 6);
}

/**
 * Coast (two-body) from (pos, vel) until the arc angle reaches `psi` for the first time at least
 * `minT` s from now. Returns {t, pos, vel} (new vectors) or null within `maxT`.
 */
export function coastToArc(pos, vel, siteDir, psi, minT = 0, maxT = 20000) {
  const hHat = new THREE.Vector3().crossVectors(pos, vel).normalize();
  const p = _kp.copy(pos);
  const v = _kv.copy(vel);
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  let t = 0;
  let prev = wrap(orbitArc(p, hHat, siteDir) - psi);
  const h = 5;
  while (t < maxT) {
    const p0 = p.clone();
    const v0 = v.clone();
    rk4(p, v, h);
    t += h;
    const cur = wrap(orbitArc(p, hHat, siteDir) - psi);
    // crossing zero upward (motion increases the arc angle); ignore the +-pi wrap
    if (prev < 0 && cur >= 0 && cur - prev < 1) {
      const f = -prev / (cur - prev);
      const tc = t - h + f * h;
      if (tc >= minT) {
        rk4(p0, v0, f * h);
        return { t: tc, pos: p0, vel: v0 };
      }
    }
    prev = cur;
  }
  return null;
}

/**
 * Descent orbit insertion: horizontal retrograde velocity change at radius |pos| that puts the
 * perilune (half an orbit later) at radius rp. Returns the required velocity vector (MCI).
 */
export function doiTargetVelocity(pos, vel, rp, out = new THREE.Vector3()) {
  const ra = pos.length();
  const hHat = _a.crossVectors(pos, vel).normalize();
  const travel = _b.crossVectors(hHat, pos).normalize();
  const vh = Math.sqrt((2 * MOON.mu * rp) / (ra * (ra + rp)));
  return out.copy(travel).multiplyScalar(vh);
}
