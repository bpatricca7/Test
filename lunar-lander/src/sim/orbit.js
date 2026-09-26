// Orbital mechanics helpers used by scenario setup and tests.
//
// Everything is two-body Keplerian motion about a point-mass Moon (MOON.mu) in the
// Moon-Centred Inertial frame (the Moon does not rotate in this simulator, so a ground
// track repeats exactly every revolution).
//
// "Track" helpers describe positions along the Apollo 11 approach great circle: the
// circle through Tranquility Base whose direction of travel at the site is due WEST
// (Apollo flew retrograde, near-equatorial lunar orbits and approached the site from
// the east with the Sun low behind the LM). The arc angle `phi` (rad) is measured along
// the direction of travel: phi < 0 before (east of) the site, phi > 0 past (west of) it.

import * as THREE from 'three';
import { MOON } from '../core/constants.js';
import { SITE_DIR, localENU } from '../core/frames.js';

const _enu = localENU(SITE_DIR);
/** Unit vector pointing due west at the landing site (MCI). */
export const SITE_WEST = _enu.east.clone().negate();
/** Orbit-plane normal (angular momentum direction) of the westbound approach orbit. */
export const TRACK_NORMAL = new THREE.Vector3().crossVectors(SITE_DIR, SITE_WEST).normalize();

/** Unit MCI direction of the ground-track point at arc angle `phi` (rad, + = downrange/west). */
export function trackDir(phi, out = new THREE.Vector3()) {
  return out.copy(SITE_DIR).multiplyScalar(Math.cos(phi)).addScaledVector(SITE_WEST, Math.sin(phi));
}

/** Unit direction of travel (local horizontal) at arc angle `phi`. */
export function trackTravel(phi, out = new THREE.Vector3()) {
  return out.copy(SITE_DIR).multiplyScalar(-Math.sin(phi)).addScaledVector(SITE_WEST, Math.cos(phi));
}

/** Arc angle (rad) of an MCI position projected onto the approach plane (-PI..PI]. */
export function trackAngle(pos) {
  return Math.atan2(pos.dot(SITE_WEST), pos.dot(SITE_DIR));
}

/** Circular-orbit state on the approach plane at arc angle `phi` and radius `r`. */
export function circularTrackState(phi, r, mu = MOON.mu) {
  const up = trackDir(phi);
  const travel = trackTravel(phi);
  return {
    pos: up.clone().multiplyScalar(r),
    vel: travel.clone().multiplyScalar(Math.sqrt(mu / r)),
    up,
    travel,
  };
}

/** Mean motion (rad/s) of a circular orbit of radius r. */
export const meanMotion = (r, mu = MOON.mu) => Math.sqrt(mu / (r * r * r));

// Stumpff functions for the universal-variable Kepler solver.
function stumpC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24 + (z * z) / 720;
}
function stumpS(z) {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/**
 * Propagate a two-body state by `dt` seconds (may be negative) with the universal-variable
 * formulation (valid for elliptic, parabolic and hyperbolic orbits).
 * @param {THREE.Vector3} r0 position (m, MCI)
 * @param {THREE.Vector3} v0 velocity (m/s, MCI)
 * @param {number} dt seconds
 * @returns {{pos: THREE.Vector3, vel: THREE.Vector3}}
 */
export function keplerPropagate(r0, v0, dt, mu = MOON.mu) {
  const r0m = r0.length();
  const v0m2 = v0.lengthSq();
  const vr0 = r0.dot(v0) / r0m;
  const alpha = 2 / r0m - v0m2 / mu; // 1/a
  const smu = Math.sqrt(mu);
  let chi = alpha > 1e-12 ? smu * alpha * dt : smu * dt / r0m;
  for (let i = 0; i < 60; i++) {
    const z = alpha * chi * chi;
    const C = stumpC(z);
    const S = stumpS(z);
    const F = (r0m * vr0 / smu) * chi * chi * C + (1 - alpha * r0m) * chi * chi * chi * S + r0m * chi - smu * dt;
    const dF = (r0m * vr0 / smu) * chi * (1 - alpha * chi * chi * S) + (1 - alpha * r0m) * chi * chi * C + r0m;
    const d = F / dF;
    chi -= d;
    if (Math.abs(d) < 1e-9) break;
  }
  const z = alpha * chi * chi;
  const C = stumpC(z);
  const S = stumpS(z);
  const f = 1 - (chi * chi / r0m) * C;
  const g = dt - (chi * chi * chi / smu) * S;
  const pos = r0.clone().multiplyScalar(f).addScaledVector(v0, g);
  const rm = pos.length();
  const fd = (smu / (rm * r0m)) * (alpha * chi * chi * chi * S - chi);
  const gd = 1 - (chi * chi / rm) * C;
  const vel = r0.clone().multiplyScalar(fd).addScaledVector(v0, gd);
  return { pos, vel };
}

/**
 * State at periapsis of an orbit in the approach plane with periapsis at arc angle `phiP`.
 * @param {number} phiP arc angle of periapsis (rad)
 * @param {number} rp periapsis radius (m)
 * @param {number} ra apoapsis radius (m)
 */
export function periapsisTrackState(phiP, rp, ra, mu = MOON.mu) {
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(mu * (2 / rp - 1 / a));
  return {
    pos: trackDir(phiP).multiplyScalar(rp),
    vel: trackTravel(phiP).multiplyScalar(vp),
    a,
    period: 2 * Math.PI * Math.sqrt((a * a * a) / mu),
  };
}

/** Specific orbital energy (J/kg). */
export const orbitalEnergy = (pos, vel, mu = MOON.mu) => vel.lengthSq() / 2 - mu / pos.length();
