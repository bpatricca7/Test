// Coordinate-frame helpers shared by every module.
//
// MCI (Moon-Centred Inertial): +Z north pole, +X lon 0, +Y lon 90E. Non-rotating Moon.
// Render space = MCI translated so the camera sits at the origin (floating origin);
// axes are identical, so directions (sunDir, normals, quaternions) are the same in both.
//
// All functions take/return THREE.Vector3 / THREE.Quaternion (JS doubles).
// Functions with an `out` argument write into it and return it (no allocation).

import * as THREE from 'three';
import { MOON, LANDING_SITE, SUN_ELEVATION_AT_SITE_DEG, SUN_AZIMUTH_AT_SITE_DEG } from './constants.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Unit direction (or point at `radius`) for latitude/longitude in degrees. */
export function latLonToVec(latDeg, lonDeg, radius = 1, out = new THREE.Vector3()) {
  const la = latDeg * D2R;
  const lo = lonDeg * D2R;
  const c = Math.cos(la);
  return out.set(c * Math.cos(lo) * radius, c * Math.sin(lo) * radius, Math.sin(la) * radius);
}

/** {lat, lon (deg, -180..180], r} of an MCI position. */
export function vecToLatLon(p) {
  const r = p.length();
  return { lat: Math.asin(THREE.MathUtils.clamp(p.z / r, -1, 1)) * R2D, lon: Math.atan2(p.y, p.x) * R2D, r };
}

/**
 * Local topocentric frame at MCI position `p`: east, north, up (unit vectors, MCI axes).
 * At the poles east is taken as +Y rotated consistently.
 */
export function localENU(p, east = new THREE.Vector3(), north = new THREE.Vector3(), up = new THREE.Vector3()) {
  up.copy(p).normalize();
  east.set(-up.y, up.x, 0);
  if (east.lengthSq() < 1e-12) east.set(0, 1, 0);
  east.normalize();
  north.crossVectors(up, east).normalize();
  return { east, north, up };
}

/** Body axes of an attitude quaternion (body -> MCI): right(+X), up(+Y), forward(-Z). */
export function bodyAxes(q, right = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3()) {
  right.set(1, 0, 0).applyQuaternion(q);
  up.set(0, 1, 0).applyQuaternion(q);
  forward.set(0, 0, -1).applyQuaternion(q);
  return { right, up, forward };
}

/**
 * Quaternion (body -> MCI) whose body -Z (forward) points along `forward` and body +Y is
 * as close as possible to `up`. Both are MCI vectors (need not be unit / orthogonal).
 */
export function quatFromForwardUp(forward, up, out = new THREE.Quaternion()) {
  const z = _a.copy(forward).normalize().negate(); // body +Z = -forward
  const x = _b.crossVectors(up, z);
  if (x.lengthSq() < 1e-12) x.set(1, 0, 0).cross(z);
  if (x.lengthSq() < 1e-12) x.set(0, 1, 0).cross(z);
  x.normalize();
  const y = _c.crossVectors(z, x).normalize();
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Quaternion (body -> MCI) whose body +Y points along `up` and body -Z is as close as
 * possible to `forward`. Use for the LM (thrust axis = +Y).
 */
export function quatFromUpForward(up, forward, out = new THREE.Quaternion()) {
  const y = _a.copy(up).normalize();
  const x = _b.crossVectors(y, _c.copy(forward).negate()); // x = y × z, z = -forward
  if (x.lengthSq() < 1e-12) x.set(1, 0, 0);
  x.normalize();
  const z = _c.crossVectors(x, y).normalize();
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Attitude of a body relative to the local horizon at `pos`, in degrees:
 *   heading: compass direction of body forward (-Z) projected on the horizon (0 = N, 90 = E)
 *   pitch:   elevation of body forward above the horizon (-90..90)
 *   roll:    bank angle, positive = right side down (-180..180)
 * Also returns `tiltFromVertical`: angle between body +Y and local up (0 = upright LM).
 */
export function horizonAttitude(pos, quat) {
  const { east, north, up } = localENU(pos, new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  const { right, up: bUp, forward } = bodyAxes(quat, new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  const fUp = forward.dot(up);
  const pitch = Math.asin(THREE.MathUtils.clamp(fUp, -1, 1)) * R2D;
  let heading = Math.atan2(forward.dot(east), forward.dot(north)) * R2D;
  if (heading < 0) heading += 360;
  // roll: angle of body right relative to the horizontal "right" of the forward vector
  const hr = new THREE.Vector3().crossVectors(forward, up); // horizontal right of forward
  let roll = 0;
  if (hr.lengthSq() > 1e-10) {
    hr.normalize();
    const hu = new THREE.Vector3().crossVectors(hr, forward).normalize(); // "level" up
    roll = Math.atan2(-right.dot(hu), right.dot(hr)) * R2D;
  }
  const tiltFromVertical = Math.acos(THREE.MathUtils.clamp(bUp.dot(up), -1, 1)) * R2D;
  return { heading, pitch, roll, tiltFromVertical };
}

/** Unit Sun direction in MCI (from the Moon toward the Sun). Constant. */
export const SUN_DIR = (() => {
  const site = latLonToVec(LANDING_SITE.latDeg, LANDING_SITE.lonDeg);
  const { east, north, up } = localENU(site);
  const el = SUN_ELEVATION_AT_SITE_DEG * D2R;
  const az = SUN_AZIMUTH_AT_SITE_DEG * D2R;
  const horiz = north.clone().multiplyScalar(Math.cos(az)).addScaledVector(east, Math.sin(az));
  return horiz.multiplyScalar(Math.cos(el)).addScaledVector(up, Math.sin(el)).normalize();
})();

/** Landing site: unit direction and reference-sphere point (terrain height NOT included). */
export const SITE_DIR = latLonToVec(LANDING_SITE.latDeg, LANDING_SITE.lonDeg);

/**
 * Keplerian summary of an orbit about the Moon from MCI state.
 * Altitudes are above MOON.radius. Returns Infinity/NaN fields for hyperbolic/degenerate cases.
 */
export function orbitSummary(pos, vel, mu = MOON.mu) {
  const r = pos.length();
  const v2 = vel.lengthSq();
  const h = new THREE.Vector3().crossVectors(pos, vel);
  const hMag = h.length();
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);
  const eVec = new THREE.Vector3()
    .crossVectors(vel, h)
    .multiplyScalar(1 / mu)
    .sub(pos.clone().multiplyScalar(1 / r));
  const e = eVec.length();
  const rp = hMag * hMag / mu / (1 + e);
  const ra = e < 1 ? a * (1 + e) : Infinity;
  const inc = Math.acos(THREE.MathUtils.clamp(h.z / (hMag || 1), -1, 1)) * R2D;
  const period = e < 1 ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity;
  const vr = pos.dot(vel) / r;
  // true anomaly
  let nu = 0;
  if (e > 1e-9) {
    nu = Math.acos(THREE.MathUtils.clamp(eVec.dot(pos) / (e * r), -1, 1));
    if (vr < 0) nu = 2 * Math.PI - nu;
  }
  return {
    a,
    e,
    inclinationDeg: inc,
    periapsisAlt: rp - MOON.radius,
    apoapsisAlt: ra - MOON.radius,
    period,
    speed: Math.sqrt(v2),
    radialSpeed: vr,
    trueAnomalyDeg: nu * R2D,
    h,
    eVec,
  };
}

/** Circular orbital speed at radius r. */
export const circularSpeed = (r, mu = MOON.mu) => Math.sqrt(mu / r);

/**
 * Great-circle ground distance (m, on the reference sphere) and initial bearing (deg from north)
 * from MCI point a to MCI point b.
 */
export function groundRangeBearing(a, b) {
  const ua = _a.copy(a).normalize();
  const ub = _b.copy(b).normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(ua.dot(ub), -1, 1));
  const { east, north } = localENU(ua, new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  const d = _c.copy(ub).addScaledVector(ua, -ua.dot(ub));
  let bearing = Math.atan2(d.dot(east), d.dot(north)) * R2D;
  if (bearing < 0) bearing += 360;
  return { range: ang * MOON.radius, bearing };
}

export { D2R, R2D };
