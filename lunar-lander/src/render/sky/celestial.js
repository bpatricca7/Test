// Celestial frames for the sky: stars, Milky Way, Earth rotation.
//
// Owned by the SKY-FX agent. Pure math (three.js vectors/matrices only, no scene), shared by the
// sky renderer, the Earth texture worker and the tests.
//
// The simulator's MCI frame (core/frames.js) is Moon-centred and non-rotating: +Z = lunar north pole,
// +X = toward the Earth (lon 0), with the Sun fixed at SUN_DIR. We tie it to the real sky at the
// moment of the Apollo 11 landing (1969-07-20 20:17:40 UTC):
//   * the lunar equator is within 1.5 deg of the ecliptic, so MCI +Z ~ north ecliptic pole;
//   * the azimuth about +Z is fixed by requiring the real Sun (ecliptic longitude of date) to lie
//     along SUN_DIR. The Earth then sits at ecliptic longitude ~15 deg as seen from the Moon, which is
//     the real Sun-Moon-Earth geometry of that afternoon (Moon ~6 days old, Earth ~40 % lit).
// Star positions (J2000 RA/Dec) are rotated into MCI through the ecliptic. The Earth spins with
// Greenwich sidereal time computed from the mission clock (MET counted from lift-off at
// 1969-07-16 13:32:00 UTC), so the right continents face the Moon at the right time of day.

import * as THREE from 'three';
import { SUN_DIR } from '../../core/frames.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Julian date of the Apollo 11 lift-off, 1969-07-16 13:32:00 UTC (MET/GET = 0). */
export const LAUNCH_JD = 2440418.5 + (13 + 32 / 60) / 24;
/** Landing time (GET 102:45:40) — reference epoch that ties MCI to the celestial sphere. */
export const LANDING_MET = 102 * 3600 + 45 * 60 + 40;

const mod360 = (a) => ((a % 360) + 360) % 360;

/** Julian date for a mission elapsed time (s). */
export function jdFromMET(met) {
  return LAUNCH_JD + met / 86400;
}

/** Greenwich mean sidereal time (deg) for a Julian date (IAU 1982, adequate to ~0.1 s). */
export function gmstDeg(jd) {
  const d = jd - 2451545.0;
  const T = d / 36525;
  return mod360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T);
}

/** Apparent geocentric ecliptic longitude of the Sun (deg), low-precision (~0.01 deg). */
export function sunEclipticLonDeg(jd) {
  const n = jd - 2451545.0;
  const L = mod360(280.46 + 0.9856474 * n);
  const g = mod360(357.528 + 0.9856003 * n) * D2R;
  return mod360(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
}

/** Mean obliquity of the ecliptic (deg). */
export function obliquityDeg(jd) {
  return 23.439291 - 0.0130042 * ((jd - 2451545.0) / 36525);
}

const EPOCH_JD = jdFromMET(LANDING_MET);
const EPS = obliquityDeg(EPOCH_JD) * D2R;
const COS_E = Math.cos(EPS);
const SIN_E = Math.sin(EPS);
/** Rotation about +Z (rad) taking ecliptic longitude to MCI azimuth: phi = lambda + ECL_TO_MCI. */
export const ECL_TO_MCI = Math.atan2(SUN_DIR.y, SUN_DIR.x) - sunEclipticLonDeg(EPOCH_JD) * D2R;
const COS_R = Math.cos(ECL_TO_MCI);
const SIN_R = Math.sin(ECL_TO_MCI);

/**
 * Equatorial (J2000 axes) unit vector -> MCI unit vector (the Sun direction ties the two frames).
 * @param {number} x @param {number} y @param {number} z equatorial components
 * @param {THREE.Vector3} out
 */
export function eqVecToMCI(x, y, z, out = new THREE.Vector3()) {
  // equatorial -> ecliptic (rotate about X by +eps)
  const ye = COS_E * y + SIN_E * z;
  const ze = -SIN_E * y + COS_E * z;
  // ecliptic -> MCI (rotate about Z by ECL_TO_MCI)
  return out.set(COS_R * x - SIN_R * ye, SIN_R * x + COS_R * ye, ze);
}

/** MCI unit vector -> equatorial (J2000 axes) unit vector. */
export function mciVecToEq(v, out = new THREE.Vector3()) {
  const xe = COS_R * v.x + SIN_R * v.y;
  const ye = -SIN_R * v.x + COS_R * v.y;
  const ze = v.z;
  return out.set(xe, COS_E * ye - SIN_E * ze, SIN_E * ye + COS_E * ze);
}

/** Right ascension (hours) & declination (deg) -> MCI unit vector. */
export function raDecToMCI(raHours, decDeg, out = new THREE.Vector3()) {
  const a = raHours * 15 * D2R;
  const d = decDeg * D2R;
  const c = Math.cos(d);
  return eqVecToMCI(c * Math.cos(a), c * Math.sin(a), Math.sin(d), out);
}

// Equatorial (J2000) -> galactic rotation (rows), Hipparcos definition.
const EQ2GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
];

/** Galactic (l, b in deg) -> MCI unit vector. */
export function galToMCI(lDeg, bDeg, out = new THREE.Vector3()) {
  const l = lDeg * D2R;
  const b = bDeg * D2R;
  const gx = Math.cos(b) * Math.cos(l);
  const gy = Math.cos(b) * Math.sin(l);
  const gz = Math.sin(b);
  const M = EQ2GAL;
  // eq = M^T g
  return eqVecToMCI(
    M[0][0] * gx + M[1][0] * gy + M[2][0] * gz,
    M[0][1] * gx + M[1][1] * gy + M[2][1] * gz,
    M[0][2] * gx + M[1][2] * gy + M[2][2] * gz,
    out,
  );
}

/** Galactic latitude (deg) of an MCI unit vector. */
export function galacticLatDeg(v) {
  const e = mciVecToEq(v, _t);
  const M = EQ2GAL;
  return Math.asin(THREE.MathUtils.clamp(M[2][0] * e.x + M[2][1] * e.y + M[2][2] * e.z, -1, 1)) * R2D;
}
const _t = new THREE.Vector3();

/**
 * Matrix3 taking MCI vectors to galactic cartesian (x -> l=0,b=0 ; z -> north galactic pole).
 * Used by the Milky Way shader.
 */
export function mciToGalacticMatrix(out = new THREE.Matrix3()) {
  const cols = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((u) => {
    const e = mciVecToEq(u, new THREE.Vector3());
    const M = EQ2GAL;
    return new THREE.Vector3(
      M[0][0] * e.x + M[0][1] * e.y + M[0][2] * e.z,
      M[1][0] * e.x + M[1][1] * e.y + M[1][2] * e.z,
      M[2][0] * e.x + M[2][1] * e.y + M[2][2] * e.z,
    );
  });
  // column j = image of MCI basis vector j
  return out.set(cols[0].x, cols[1].x, cols[2].x, cols[0].y, cols[1].y, cols[2].y, cols[0].z, cols[1].z, cols[2].z);
}

/**
 * Matrix3 taking MCI directions to Earth-fixed (ECEF) directions at mission time `met`:
 * x = Greenwich meridian on the equator, z = north pole, y = 90 deg E. Precession since J2000 is
 * ignored (0.4 deg); the Earth spins at the sidereal rate with the mission clock.
 */
export function mciToEarthFixedMatrix(met, out = new THREE.Matrix3()) {
  const g = gmstDeg(jdFromMET(met)) * D2R;
  const cg = Math.cos(g);
  const sg = Math.sin(g);
  const cols = [0, 1, 2].map((i) => {
    const e = mciVecToEq(new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0), new THREE.Vector3());
    return new THREE.Vector3(cg * e.x + sg * e.y, -sg * e.x + cg * e.y, e.z);
  });
  return out.set(cols[0].x, cols[1].x, cols[2].x, cols[0].y, cols[1].y, cols[2].y, cols[0].z, cols[1].z, cols[2].z);
}

/** {lat, lon} (deg) on the Earth of the point whose outward normal is the MCI direction `n` at `met`. */
export function earthLatLonOf(n, met) {
  const m = mciToEarthFixedMatrix(met);
  const p = n.clone().normalize().applyMatrix3(m);
  return { lat: Math.asin(THREE.MathUtils.clamp(p.z, -1, 1)) * R2D, lon: Math.atan2(p.y, p.x) * R2D };
}
