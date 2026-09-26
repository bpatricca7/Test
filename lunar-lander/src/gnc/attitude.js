// Attitude autopilot targets (vessel.gnc.autopilot).
//
// Pointing modes swing the vehicle's THRUST axis onto a reference direction by the shortest path
// (roll about the axis left free): LM +Y (DPS/APS thrust axis), CSM -Z (SPS thrust axis / nose).
//   PROGRADE / RETROGRADE   along / against the velocity (MCI; the Moon does not rotate)
//   RADIAL_OUT / RADIAL_IN  along / against the local vertical
//   NORMAL / ANTINORMAL     along / against the orbital angular momentum r x v
//   TARGET                  docking port axis at the other vessel's docking port (LM +Y drogue,
//                           CSM -Z probe)
// Full-attitude modes:
//   LOCAL_VERTICAL  LM: upright (+Y up), windows (-Z) along-track.
//                   CSM: nose (-Z) along-track, heads up (+Y) = radial out.
//   GUIDANCE        attitude commanded by the active guidance program (gnc/programs.js).
//   KILLROT         null all rates (then the DAP captures an attitude hold).

import * as THREE from 'three';
import { LM, CSM } from '../core/constants.js';
import { quatFromUpForward, quatFromForwardUp } from '../core/frames.js';

export const AUTOPILOT_MODES = ['OFF', 'KILLROT', 'PROGRADE', 'RETROGRADE', 'RADIAL_OUT', 'RADIAL_IN', 'NORMAL', 'ANTINORMAL', 'LOCAL_VERTICAL', 'TARGET', 'GUIDANCE'];

const AXIS_LM = new THREE.Vector3(0, 1, 0);
const AXIS_CSM = new THREE.Vector3(0, 0, -1);
const _r = new THREE.Vector3();
const _h = new THREE.Vector3();
const _f = new THREE.Vector3();

/** Thrust / pointing axis of a vessel in its body frame. */
export function thrustAxis(v) {
  return v.type === 'LM' ? AXIS_LM : AXIS_CSM;
}

/** CG position in MCI (writes out). */
export function cgPos(v, out) {
  return out.copy(v.cg).applyQuaternion(v.quat).add(v.pos);
}

/**
 * Compute the DAP target for an attitude autopilot mode.
 * @param {string} mode vessel.gnc.autopilot
 * @param {object} v vessel
 * @param {object} other the other vessel (TARGET mode)
 * @param {object} out reusable target object
 * @returns {null|{axis?:THREE.Vector3, dir?:THREE.Vector3, quat?:THREE.Quaternion, rate?:THREE.Vector3}}
 */
export function autopilotTarget(mode, v, other, out) {
  out.quat = null;
  out.axis = null;
  out.rate = null;
  out.deadband = undefined;
  out.dir = out.dir || new THREE.Vector3();
  const r = cgPos(v, _r);
  const vel = v.vel;
  switch (mode) {
    case 'KILLROT':
      out.rate = (out._zero || (out._zero = new THREE.Vector3())).set(0, 0, 0);
      return out;
    case 'PROGRADE':
    case 'RETROGRADE':
      if (vel.lengthSq() < 1e-6) return null;
      out.dir.copy(vel).normalize();
      if (mode === 'RETROGRADE') out.dir.negate();
      out.axis = thrustAxis(v);
      return out;
    case 'RADIAL_OUT':
    case 'RADIAL_IN':
      out.dir.copy(r).normalize();
      if (mode === 'RADIAL_IN') out.dir.negate();
      out.axis = thrustAxis(v);
      return out;
    case 'NORMAL':
    case 'ANTINORMAL':
      _h.crossVectors(r, vel);
      if (_h.lengthSq() < 1e-6) return null;
      out.dir.copy(_h).normalize();
      if (mode === 'ANTINORMAL') out.dir.negate();
      out.axis = thrustAxis(v);
      return out;
    case 'TARGET': {
      // docking port axis (on the centreline) at the other vehicle's docking port
      if (!other || v.docked || other.crashed) return null;
      const theirPort = other.type === 'LM' ? LM.docking.port : CSM.docking.port;
      out.dir.copy(theirPort).applyQuaternion(other.quat).add(other.pos).sub(v.pos);
      if (out.dir.lengthSq() < 1e-6) return null;
      out.dir.normalize();
      out.axis = v.type === 'LM' ? AXIS_LM : AXIS_CSM;
      return out;
    }
    case 'LOCAL_VERTICAL': {
      const up = _h.copy(r).normalize();
      // along-track: horizontal velocity; with no velocity keep the current heading
      _f.copy(vel).addScaledVector(up, -vel.dot(up));
      if (_f.lengthSq() < 0.01) _f.set(0, 0, -1).applyQuaternion(v.quat).addScaledVector(up, -_f.dot(up));
      if (_f.lengthSq() < 1e-8) _f.set(1, 0, 0).applyQuaternion(v.quat);
      out.quat = out._q || (out._q = new THREE.Quaternion());
      if (v.type === 'LM') quatFromUpForward(up, _f, out.quat);
      else quatFromForwardUp(_f, up, out.quat);
      return out;
    }
    default:
      return null;
  }
}
