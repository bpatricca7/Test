// Pure instrument logic (no DOM): FDAI ball orientation, tape scales, timer formatting,
// cross-pointer velocities. Unit-tested in test/instruments.test.js.
import * as THREE from 'three';
import { localENU } from '../../../core/frames.js';
import { FT } from '../../../core/constants.js';

const _E = new THREE.Vector3();
const _N = new THREE.Vector3();
const _U = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/**
 * FDAI ball orientation. The ball mesh is a THREE.SphereGeometry whose local axes are
 * (x = East, y = Up, z = North) of the local-vertical frame at the vessel (so the texture's
 * azimuth az = 360u - 90 and elevation el = 180v - 90). The returned quaternion rotates it so that
 * the ball point facing the viewer (+Z of the instrument) is the direction of the vehicle's
 * forward axis (-Z body), and instrument +Y is body +Y (instrument = body with z mirrored; the
 * two reflections cancel, so this is a proper rotation).
 * @param {THREE.Vector3} pos vessel MCI position
 * @param {THREE.Quaternion} quat body -> MCI
 * @param {THREE.Quaternion} [out]
 * @returns {{quat: THREE.Quaternion, up: THREE.Vector3}} up = local up in instrument coordinates
 */
export function fdaiBallQuaternion(pos, quat, out = new THREE.Quaternion()) {
  localENU(pos, _E, _N, _U);
  _qi.copy(quat).invert();
  _E.applyQuaternion(_qi);
  _U.applyQuaternion(_qi);
  _N.applyQuaternion(_qi);
  _E.z = -_E.z;
  _U.z = -_U.z;
  _N.z = -_N.z;
  _m.makeBasis(_E, _U, _N);
  out.setFromRotationMatrix(_m);
  return { quat: out, up: _U };
}

/** Ball-local unit vector for a texture direction (azimuth from north toward east, elevation), deg. */
export function fdaiBallLocal(azDeg, elDeg, out = new THREE.Vector3()) {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

/**
 * Piecewise-linear tape scale. segs: [[from, to, mmPerUnit, minor, major, labelEvery, fmt]] for
 * positive values; negative values mirror the positive scale (rate tapes).
 * @returns {{segs, T(v) -> mm}} T is continuous and strictly increasing.
 */
export function tapeScale(segs) {
  const starts = [];
  let acc = 0;
  for (const s of segs) {
    starts.push(acc);
    acc += (s[1] - s[0]) * s[2];
  }
  const T = (v) => {
    const a = Math.abs(v);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (a <= s[1] || i === segs.length - 1) return Math.sign(v) * (starts[i] + (Math.min(a, s[1]) - s[0]) * s[2]);
    }
    return 0;
  };
  return { segs, T };
}

const K = (v) => (v >= 1000 ? `${v / 1000}K` : `${v}`);
/** The LM tape scales (altitude ft, rate ft/s, range nmi). */
export const TAPES = {
  alt: tapeScale([
    [0, 1000, 0.1, 20, 100, 100, (v) => `${v}`],
    [1000, 10000, 0.02, 200, 1000, 1000, (v) => `${v}`],
    [10000, 100000, 0.002, 2000, 10000, 10000, K],
    [100000, 1000000, 0.0004, 10000, 50000, 50000, K],
  ]),
  rate: tapeScale([
    [0, 60, 1.6, 2, 10, 10, (v) => `${v}`],
    [60, 200, 0.4, 10, 50, 50, (v) => `${v}`],
    [200, 2000, 0.05, 100, 500, 500, (v) => `${v}`],
  ]),
  range: tapeScale([
    [0, 1, 40, 0.1, 0.5, 0.2, (v) => (v < 1 ? `.${Math.round(v * 10)}` : `${v}`)],
    [1, 10, 8, 0.5, 1, 1, (v) => `${v}`],
    [10, 100, 0.8, 5, 10, 10, (v) => `${v}`],
    [100, 400, 0.2, 10, 50, 50, (v) => `${v}`],
  ]),
};

/** Mission timer text 'HHH:MM:SS' for a MET in seconds (hours wrap at 1000). */
export function formatMET(met) {
  const t = Math.max(0, Math.floor(met || 0));
  const h = Math.floor(t / 3600) % 1000;
  const m = Math.floor(t / 60) % 60;
  const s = t % 60;
  return `${String(h).padStart(3, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Event timer text 'MM:SS' for a (possibly negative) duration in seconds (wraps at 60 min). */
export function formatMMSS(secs) {
  const t = Math.max(0, Math.floor(Math.abs(secs || 0))) % 3600;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
/**
 * Cross-pointer velocities (ft/s) along the vehicle body axes: forward (-Z body) and lateral
 * (+X body, right). vel is MCI (surface-relative: the Moon does not rotate).
 * @returns {{fwd: number, lat: number}}
 */
export function crossPointerVelocities(vel, quat) {
  _f.set(0, 0, -1).applyQuaternion(quat);
  _r.set(1, 0, 0).applyQuaternion(quat);
  return { fwd: vel.dot(_f) / FT, lat: vel.dot(_r) / FT };
}
