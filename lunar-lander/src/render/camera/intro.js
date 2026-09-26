// Mission-start establishing shot ("intro"): a short cinematic move around the active spacecraft
// that hands over to the mission's own camera. Pure math (three.js vectors only) — the camera
// module owns the timing, input skipping and the hand-over.
//
// The shot is planned once, in the local horizon frame of the spacecraft (up = radial):
//   - a side-lit angle: the camera sweeps from ~100° to ~52° off the Sun's azimuth while it
//     dollies in (rim light first, then the side facing the camera lit, the shadow side modelling
//     the shape);
//   - elevation from the altitude: near the surface a little above the spacecraft (the sunlit
//     ground behind it); in orbit so that the curved lunar horizon crosses the lower frame;
//   - the side (left / right of the Sun) that brings the Earth closer to the frame; when the
//     Earth is above the horizon and within ~100° of the final view, the shot opens on the Earth and
//     tilts down onto the spacecraft ("Earth, then Eagle"), widening from a telephoto framing.
// Timeline (fractions of the duration T): the sweep runs 0..1 with an ease-out; the tilt from the
// Earth completes by ~55 %. The hand-over is done by the caller.

import * as THREE from 'three';
import { MOON, EARTH } from '../../core/constants.js';

const D2R = Math.PI / 180;
const EARTH_FOV = 14; // deg: opening telephoto framing of the Earth
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Ease-out cubic (fast start, gentle landing on the end pose). */
export const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
/** Smoothstep ease-in-out. */
export const easeInOut = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Smootherstep: lingers at both ends (a whip pan through the empty sky between Earth and spacecraft). */
export const easeInOut5 = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (6 * t - 15) + 10);
};

/** Horizontal unit component of `dir` in the plane normal to `up` (fallback when ~vertical). */
function horizontal(dir, up, fallback, out) {
  out.copy(dir).addScaledVector(up, -dir.dot(up));
  if (out.lengthSq() < 1e-6) out.copy(fallback).addScaledVector(up, -fallback.dot(up));
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0).addScaledVector(up, -up.x);
  return out.normalize();
}

/** Unit direction from the focus to the camera for azimuth az (from `ref`, toward `right`) and elevation el. */
export function introDir(ref, right, up, az, el, out = new THREE.Vector3()) {
  const ce = Math.cos(el);
  return out.copy(ref).multiplyScalar(Math.cos(az) * ce).addScaledVector(right, Math.sin(az) * ce).addScaledVector(up, Math.sin(el));
}

/** True when the Earth (along +X, far away) is above the lunar limb as seen from `pos` (MCI). */
export function earthVisible(pos) {
  const e = _a.set(EARTH.distance, 0, 0).sub(pos).normalize();
  const t = -pos.dot(e); // closest approach of the ray to the Moon's centre
  if (t < 0) return true;
  const d2 = pos.lengthSq() - t * t;
  return d2 > MOON.radius * MOON.radius;
}

/**
 * Plan the shot.
 * @param {{pos: THREE.Vector3, radius: number, dist: number}} focus exterior aim point of the spacecraft
 * @param {THREE.Vector3} sunDir unit vector toward the Sun (MCI)
 * @param {THREE.Vector3} fwd the spacecraft's forward axis (MCI; fallback reference)
 * @param {number} altitude m above the terrain
 * @param {{fov?: number}} [opt]
 */
export function planIntro(focus, sunDir, fwd, altitude, opt = {}) {
  const up = new THREE.Vector3().copy(focus.pos).normalize();
  const ref = horizontal(sunDir, up, fwd, new THREE.Vector3()); // Sun azimuth on the horizon
  const right = new THREE.Vector3().crossVectors(up, ref).normalize();
  const fov = opt.fov ?? 50;

  // elevation of the camera above the spacecraft's horizontal plane
  const r = focus.pos.length();
  const dip = Math.acos(Math.min(1, MOON.radius / r)) / D2R; // horizon depression (deg)
  let el0;
  let el1;
  if (altitude < 3000) {
    el0 = 4;
    el1 = 11;
  } else {
    // horizon ~12° below the centre of the frame at the end of the move
    el1 = THREE.MathUtils.clamp(dip - 12, -6, 16);
    el0 = el1 - 7;
  }
  const d1 = Math.max(focus.dist * 1.25, focus.radius * 4.2);
  const d0 = d1 * 2.6;

  // pick the side that brings the Earth into (or nearest to) the final frame
  const earthDir = new THREE.Vector3(EARTH.distance, 0, 0).sub(focus.pos).normalize();
  const earthUp = earthVisible(focus.pos);
  let best = null;
  for (const side of [1, -1]) {
    const az1 = side * 52 * D2R;
    const view = introDir(ref, right, up, az1, el1 * D2R, _b).negate(); // camera -> focus
    const ang = Math.acos(THREE.MathUtils.clamp(view.dot(earthDir), -1, 1)) / D2R;
    if (!best || ang < best.ang) best = { side, ang };
  }
  const side = best.side;
  const tiltFromEarth = earthUp && best.ang > fov * 0.42 && best.ang < 100;
  return {
    up,
    ref,
    right,
    side,
    az0: side * 100 * D2R,
    az1: side * 52 * D2R,
    el0: el0 * D2R,
    el1: el1 * D2R,
    d0,
    d1,
    fov,
    earthDir,
    earthInFrame: earthUp && best.ang <= fov * 0.42,
    tiltFromEarth,
  };
}

/**
 * Camera pose at fraction u (0..1) of the shot, relative to the (moving) focus.
 * @param {object} plan from planIntro
 * @param {number} u
 * @param {THREE.Vector3} focusPos current aim point (MCI)
 * @param {{pos: THREE.Vector3, quat: THREE.Quaternion, fov: number}} out pos in MCI
 * @param {(fwd: THREE.Vector3, up: THREE.Vector3, q: THREE.Quaternion) => THREE.Quaternion} lookQuat
 * @param {number} [pushIn] 0..1 extra dolly toward the spacecraft (cockpit hand-over)
 */
export function introPose(plan, u, focusPos, out, lookQuat, pushIn = 0) {
  const k = easeOut(u);
  const az = plan.az0 + (plan.az1 - plan.az0) * k;
  const el = plan.el0 + (plan.el1 - plan.el0) * k;
  let d = Math.exp(Math.log(plan.d0) + (Math.log(plan.d1) - Math.log(plan.d0)) * k);
  if (pushIn > 0) d *= 1 - 0.55 * easeInOut(pushIn);
  const dir = introDir(plan.ref, plan.right, plan.up, az, el, _a);
  out.pos.copy(focusPos).addScaledVector(dir, d);
  // aim: the spacecraft, after an opening tilt down from the Earth
  const aim = _b.copy(dir).negate();
  out.fov = plan.fov;
  if (plan.tiltFromEarth) {
    // open on a telephoto view of the Earth, then widen while tilting down onto the spacecraft
    const s = easeInOut5((u - 0.06) / 0.52);
    const tilt = _c.copy(plan.earthDir).lerp(aim, s).normalize();
    aim.copy(tilt);
    out.fov = EARTH_FOV + (plan.fov - EARTH_FOV) * easeInOut((u - 0.04) / 0.5);
  }
  lookQuat(aim, plan.up, out.quat);
  return out;
}
