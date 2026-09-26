// Mass properties (mass, centre of gravity, inertia) of the LM, the CSM and the docked stack.
//
// Everything is derived from the component masses / CG positions / inertias in
// core/constants.js, so propellant consumption moves the CG and changes the moments of
// inertia continuously during a burn.
//
// LM model (component build-up):
//   descent stage  = descent dry structure + descent propellant
//   ascent stage   = ascent dry (crew, equipment) + ascent propellant + RCS propellant
//   Each stage has its own inertia about its own CG; the total adds the parallel-axis term
//   between the two stage CGs. The descent-stage inertia at full load is DERIVED from
//   LM.inertiaFull so that the fully fuelled LM reproduces the constants exactly.
// CSM model: inertia interpolated linearly with propellant mass between CSM.inertiaEmpty and
//   CSM.inertiaFull (constants), CG from the CM / SM / SPS propellant / RCS propellant.
// Docked stack: one rigid body, inertia tensor built with the parallel-axis theorem in the
//   CSM body frame (the "carrier" frame used by the physics integrator).

import * as THREE from 'three';
import { LM, CSM } from '../core/constants.js';

// Fraction of the stage's own full-load inertia that remains with empty tanks.
const LM_DESCENT_DRY_INERTIA_FRAC = 0.32; // propellant (8.2 t in 4 tanks at ~1.2 m radius) dominates
const LM_ASCENT_DRY_INERTIA_FRAC = 0.72; // ascent tanks sit close to the CG

/** Mass & CG of the LM ascent stage (dry + ascent propellant + RCS propellant). */
function ascentStageMass(ascProp, rcsProp, outCg) {
  const m = LM.ascentDryMass + ascProp + rcsProp;
  outCg
    .copy(LM.cgAscentDry)
    .multiplyScalar(LM.ascentDryMass)
    .addScaledVector(LM.cgAscentProp, ascProp)
    .addScaledVector(LM.cgRcsProp, rcsProp)
    .divideScalar(m);
  return m;
}

function descentStageMass(descProp, outCg) {
  const m = LM.descentDryMass + descProp;
  outCg.copy(LM.cgDescentDry).multiplyScalar(LM.descentDryMass).addScaledVector(LM.cgDescentProp, descProp).divideScalar(m);
  return m;
}

/** Parallel-axis inertia (diagonal) of two point masses about their common CG. */
function pairParallel(m1, c1, m2, c2, out) {
  const mu = (m1 * m2) / (m1 + m2);
  const dx = c1.x - c2.x;
  const dy = c1.y - c2.y;
  const dz = c1.z - c2.z;
  return out.set(mu * (dy * dy + dz * dz), mu * (dx * dx + dz * dz), mu * (dx * dx + dy * dy));
}

// Derive the descent stage's own inertia (about its CG) at full load from LM.inertiaFull.
const _cgA = new THREE.Vector3();
const _cgD = new THREE.Vector3();
const _pp = new THREE.Vector3();
const DESCENT_INERTIA_FULL = (() => {
  const ma = ascentStageMass(LM.ascentPropMax, LM.rcsPropMax, _cgA);
  const md = descentStageMass(LM.descentPropMax, _cgD);
  pairParallel(ma, _cgA, md, _cgD, _pp);
  const I = LM.inertiaFull.clone().sub(LM.inertiaAscent).sub(_pp);
  // guard against inconsistent constants: never below 15% of the full value
  I.x = Math.max(I.x, 0.15 * LM.inertiaFull.x);
  I.y = Math.max(I.y, 0.15 * LM.inertiaFull.y);
  I.z = Math.max(I.z, 0.15 * LM.inertiaFull.z);
  return I;
})();

/** Fully fuelled masses, handy for tests / UI. */
export const LM_FULL_MASS = LM.descentDryMass + LM.descentPropMax + LM.ascentDryMass + LM.ascentPropMax + LM.rcsPropMax;
export const LM_ASCENT_FULL_MASS = LM.ascentDryMass + LM.ascentPropMax + LM.rcsPropMax;
export const CSM_EMPTY_MASS = CSM.cmDryMass + CSM.smDryMass;
export const CSM_FULL_MASS = CSM_EMPTY_MASS + CSM.spsPropMax + CSM.rcsPropMax;

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

/**
 * Compute LM mass, CG and principal inertia from its propellant state.
 * Unstaged: propellant.main = descent, propellant.ascent = ascent. Staged: propellant.main = ascent.
 * @param {object} v LM vessel
 * @param {{mass:number, cg:THREE.Vector3, inertia:THREE.Vector3}} out
 */
export function lmMassProps(v, out = { mass: 0, cg: new THREE.Vector3(), inertia: new THREE.Vector3() }) {
  const p = v.propellant;
  const asc = Math.max(0, v.staged ? p.main : p.ascent);
  const rcs = Math.max(0, p.rcs);
  const ma = ascentStageMass(asc, rcs, _cgA);
  const ascFrac = Math.min(1, (asc + rcs) / (LM.ascentPropMax + LM.rcsPropMax));
  const Ia = _t1.copy(LM.inertiaAscent).multiplyScalar(LM_ASCENT_DRY_INERTIA_FRAC + (1 - LM_ASCENT_DRY_INERTIA_FRAC) * ascFrac);
  if (v.staged) {
    out.mass = ma;
    out.cg.copy(_cgA);
    out.inertia.copy(Ia);
    return out;
  }
  const desc = Math.max(0, p.main);
  const md = descentStageMass(desc, _cgD);
  const descFrac = Math.min(1, desc / LM.descentPropMax);
  const Id = _t2.copy(DESCENT_INERTIA_FULL).multiplyScalar(LM_DESCENT_DRY_INERTIA_FRAC + (1 - LM_DESCENT_DRY_INERTIA_FRAC) * descFrac);
  pairParallel(ma, _cgA, md, _cgD, _pp);
  out.mass = ma + md;
  out.cg.copy(_cgA).multiplyScalar(ma).addScaledVector(_cgD, md).divideScalar(out.mass);
  out.inertia.copy(Ia).add(Id).add(_pp);
  return out;
}

/** Mass properties of the LM descent stage alone (after staging), for the falling stage. */
export function descentStageProps(descProp) {
  const cg = new THREE.Vector3();
  const mass = descentStageMass(descProp, cg);
  const inertia = DESCENT_INERTIA_FULL.clone().multiplyScalar(LM_DESCENT_DRY_INERTIA_FRAC + (1 - LM_DESCENT_DRY_INERTIA_FRAC) * Math.min(1, descProp / LM.descentPropMax));
  return { mass, cg, inertia };
}

/**
 * Compute CSM mass, CG and principal inertia from its propellant state.
 * @param {object} v CSM vessel
 */
export function csmMassProps(v, out = { mass: 0, cg: new THREE.Vector3(), inertia: new THREE.Vector3() }) {
  const sps = Math.max(0, v.propellant.main);
  const rcs = Math.max(0, v.propellant.rcs);
  const m = CSM.cmDryMass + CSM.smDryMass + sps + rcs;
  out.mass = m;
  out.cg
    .copy(CSM.cgCM)
    .multiplyScalar(CSM.cmDryMass)
    .addScaledVector(CSM.cgSMDry, CSM.smDryMass)
    .addScaledVector(CSM.cgSpsProp, sps)
    .addScaledVector(CSM.cgRcsProp, rcs)
    .divideScalar(m);
  const t = Math.min(1, Math.max(0, (m - CSM_EMPTY_MASS) / (CSM_FULL_MASS - CSM_EMPTY_MASS)));
  out.inertia.copy(CSM.inertiaEmpty).lerp(CSM.inertiaFull, t);
  return out;
}

/** Mass properties of either vessel type (writes nothing to the vessel). */
export function vesselMassProps(v, out) {
  return v.type === 'LM' ? lmMassProps(v, out) : csmMassProps(v, out);
}

/** Write mass, cg, inertia of a vessel from its propellant state. */
export function updateVesselMassProps(v) {
  vesselMassProps(v, v);
  return v;
}

// ------------------------------------------------------------------ 3x3 matrix helpers
// Row-major arrays of 9 numbers; small and allocation-free for the integrator.

/** out = R * diag(d) * R^T  (+ out if accumulate), R given as a THREE.Matrix3 (column-major elements). */
export function addRotatedDiag(out, R, d) {
  const e = R.elements; // column-major: e[col*3+row]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] += e[i] * e[j] * d.x + e[3 + i] * e[3 + j] * d.y + e[6 + i] * e[6 + j] * d.z;
    }
  }
  return out;
}

/** out += m * (|r|^2 I - r r^T)  (parallel-axis term for a point mass at offset r). */
export function addPointMass(out, m, r) {
  const r2 = r.x * r.x + r.y * r.y + r.z * r.z;
  out[0] += m * (r2 - r.x * r.x);
  out[1] -= m * r.x * r.y;
  out[2] -= m * r.x * r.z;
  out[3] -= m * r.y * r.x;
  out[4] += m * (r2 - r.y * r.y);
  out[5] -= m * r.y * r.z;
  out[6] -= m * r.z * r.x;
  out[7] -= m * r.z * r.y;
  out[8] += m * (r2 - r.z * r.z);
  return out;
}

/** Inverse of a symmetric 3x3 (row-major) into out. */
export function invert3(m, out) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const id = 1 / det;
  out[0] = A * id;
  out[1] = -(b * i - c * h) * id;
  out[2] = (b * f - c * e) * id;
  out[3] = B * id;
  out[4] = (a * i - c * g) * id;
  out[5] = -(a * f - c * d) * id;
  out[6] = C * id;
  out[7] = -(a * h - b * g) * id;
  out[8] = (a * e - b * d) * id;
  return out;
}

/** out = M * v (row-major 3x3). */
export function mul3(m, v, out) {
  const x = v.x;
  const y = v.y;
  const z = v.z;
  return out.set(m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z);
}

/** Set a row-major 3x3 to diag(d). */
export function setDiag(out, d) {
  out.fill(0);
  out[0] = d.x;
  out[4] = d.y;
  out[8] = d.z;
  return out;
}
