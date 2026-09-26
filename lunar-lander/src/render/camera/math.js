// Pure camera math (no DOM, no scene): orbit frames, smoothing, framing. Unit-tested in
// test/io.cameras.test.js. All vectors are THREE.Vector3 in MCI unless stated otherwise.

import * as THREE from 'three';

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Exponential smoothing factor for time constant tau (s) over dt: x += (target - x) * k. */
export function smoothK(dt, tau) {
  if (!(tau > 0)) return 1;
  return 1 - Math.exp(-Math.max(0, dt) / tau);
}

/** Smoothstep 0..1. */
export function smoothstep(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** Wrap an angle (rad) to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a === 0 ? Math.PI : a - Math.PI;
}

/**
 * Camera orientation (MCI quaternion; camera looks along its local -Z, local +Y is image-up)
 * looking along `forward` with the image "up" as close as possible to `up`. Horizon-locked when
 * `up` is the local vertical. Falls back to an arbitrary perpendicular when degenerate.
 */
export function lookQuat(forward, up, out = new THREE.Quaternion()) {
  const z = _a.copy(forward).normalize().negate();
  const x = _b.crossVectors(up, z);
  if (x.lengthSq() < 1e-12) {
    x.set(0, 1, 0).cross(z);
    if (x.lengthSq() < 1e-12) x.set(1, 0, 0).cross(z);
  }
  x.normalize();
  const y = _c.crossVectors(z, x).normalize();
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Project `v` onto the plane perpendicular to unit `n` and normalise. Returns false (out left
 * unchanged) when the projection is degenerate.
 */
export function horizontalDir(v, n, out) {
  const d = v.dot(n);
  _a.copy(v).addScaledVector(n, -d);
  const l = _a.length();
  if (l < 1e-9) return false;
  out.copy(_a).multiplyScalar(1 / l);
  return true;
}

/**
 * Rotate the horizontal unit vector `cur` toward the horizontal unit vector `target` about the
 * unit axis `up` by the fraction k of the angle between them (keeps it horizontal and unit).
 */
export function slerpAboutAxis(cur, target, up, k, out = cur) {
  const ang = Math.atan2(_a.crossVectors(cur, target).dot(up), cur.dot(target));
  _q.setFromAxisAngle(up, ang * k);
  return out.copy(cur).applyQuaternion(_q);
}

/**
 * Offset of an orbit camera around its target in a horizon-locked frame.
 * @param {THREE.Vector3} back unit horizontal vector pointing from the target toward "behind"
 * @param {THREE.Vector3} up   unit local vertical
 * @param {number} az azimuth (rad) around `up`; + swings the camera toward the right of an
 *                    observer at the target facing away from the camera (-back)
 * @param {number} el elevation above the horizontal plane (rad)
 * @param {number} dist metres
 */
export function orbitOffset(back, up, az, el, dist, out = new THREE.Vector3()) {
  // right-hand rotation about +up: with back = +Z and up = +Y, az > 0 moves the camera toward +X,
  // the right-hand side of someone at the target looking along -Z
  _q.setFromAxisAngle(up, az);
  _a.copy(back).applyQuaternion(_q);
  return out.copy(_a).multiplyScalar(Math.cos(el) * dist).addScaledVector(up, Math.sin(el) * dist);
}

/**
 * Vertical field of view (deg) that frames an object of radius `r` at distance `d` so it fills
 * `fill` of the screen height, clamped to [minDeg, maxDeg].
 */
export function framingFov(r, d, fill = 0.45, minDeg = 3, maxDeg = 60) {
  if (!(d > 0)) return maxDeg;
  const f = 2 * Math.atan(r / (d * fill)) * R2D;
  return Math.min(maxDeg, Math.max(minDeg, f));
}

/** Head-look quaternion (camera local): yaw + = look right, pitch + = look up. */
export function headLookQuat(yawRad, pitchRad, out = new THREE.Quaternion()) {
  const e = new THREE.Euler(pitchRad, -yawRad, 0, 'YXZ');
  return out.setFromEuler(e);
}
