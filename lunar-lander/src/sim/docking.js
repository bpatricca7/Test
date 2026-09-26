// Docked-stack dynamics, docking capture and undocking.
//
// Docked geometry (contract): LM +Y = CSM +Z, LM +X = CSM +X, and the LM drogue port
// (LM.docking.port) meets the CSM docking ring (CSM.docking.port). In CSM body coordinates:
//     p_CSM = R_rel * p_LM + T_REL,   R_rel = rotation of +90 deg about X,  T_REL = (0, 0, -9.40)
//
// While docked the two spacecraft are ONE rigid body. The CSM body frame is the carrier frame
// of the integrator (its pos / quat / angVel are integrated); the LM is slaved to the fixed
// relative transform. Combined mass, CG and inertia tensor (parallel-axis theorem) are rebuilt
// every step from the two vessels' current mass properties, and each vessel receives
// `vessel.stack = { mass, cg, inertia }` expressed in its OWN body axes for the GNC.
//
// Docking: automatic probe/drogue capture when the CSM probe tip reaches the drogue within
// tolerances (closing < 0.35 m/s — the Apollo probe was designed for 0.1-1.0 ft/s — lateral
// < 0.3 m, misalignment < 10 deg). Capture merges the two bodies conserving linear and angular
// momentum; the probe then retracts (nitrogen-powered, ~6 s), pulling the LM into the
// hard-docked position, and the 12 ring latches ripple-fire ('dock' event).
// vessel.probeExtension (CSM, 0 = retracted .. 1 = extended) follows the retraction for the model.
// Undocking: the probe's extension spring pushes the vehicles apart at ~0.1 m/s.

import * as THREE from 'three';
import { LM, CSM } from '../core/constants.js';
import { addRotatedDiag, addPointMass, invert3 } from './massprops.js';
import { pointVelocity } from './physics.js';

export const DOCK = {
  CAPTURE_AXIAL: 0.25, // m: probe tip within this distance of the drogue port plane
  CAPTURE_LATERAL: 0.3, // m: from the drogue axis
  CAPTURE_CLOSING: 0.35, // m/s max closing speed (design envelope 0.1-1.0 ft/s, a little margin)
  CAPTURE_MISALIGN_DEG: 10,
  RETRACT_TIME: 6.0, // s probe retraction from capture to hard dock (latches fire at the end)
  SEP_SPEED: 0.1, // m/s relative separation speed at undocking
  RESTITUTION: 0.3, // bounce of a failed probe contact
};

/** LM body -> CSM body rotation (docked). */
export const REL_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
export const REL_MAT = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(REL_QUAT));
/** LM body origin in the CSM body frame when hard-docked. */
export const REL_POS = CSM.docking.port.clone().sub(LM.docking.port.clone().applyQuaternion(REL_QUAT));

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Create the stack state object (S.stack) for a docked pair. */
export function createStack() {
  return {
    mass: 0,
    cg: new THREE.Vector3(), // CSM body frame
    I: new Float64Array(9), // about the stack CG, CSM body frame (row-major)
    Iinv: new Float64Array(9),
    vel: new THREE.Vector3(), // stack CG velocity (MCI)
    relQ: REL_QUAT.clone(), // current LM->CSM relative attitude (capture interpolates it)
    relT: REL_POS.clone(),
    capture: null, // {t, q0, t0} while the probe retracts
    probeExtension: 0, // 1 at capture -> 0 at hard dock
  };
}

/** Rebuild combined mass properties (CSM frame) and write vessel.stack for both vessels. */
export function updateStackProps(st, csm, lm) {
  const mc = csm.mass;
  const ml = lm.mass;
  const M = mc + ml;
  const cgL = _a.copy(lm.cg).applyQuaternion(REL_QUAT).add(REL_POS); // LM CG in CSM frame (hard-dock geometry)
  st.mass = M;
  st.cg.copy(csm.cg).multiplyScalar(mc).addScaledVector(cgL, ml).divideScalar(M);
  const I = st.I;
  I.fill(0);
  I[0] = csm.inertia.x;
  I[4] = csm.inertia.y;
  I[8] = csm.inertia.z;
  addPointMass(I, mc, _b.copy(csm.cg).sub(st.cg));
  addRotatedDiag(I, REL_MAT, lm.inertia);
  addPointMass(I, ml, _b.copy(cgL).sub(st.cg));
  invert3(I, st.Iinv);
  // per-vessel views
  if (!csm.stack) csm.stack = { mass: 0, cg: new THREE.Vector3(), inertia: new THREE.Vector3() };
  if (!lm.stack) lm.stack = { mass: 0, cg: new THREE.Vector3(), inertia: new THREE.Vector3() };
  csm.stack.mass = M;
  csm.stack.cg.copy(st.cg);
  csm.stack.inertia.set(I[0], I[4], I[8]);
  lm.stack.mass = M;
  lm.stack.cg.copy(st.cg).sub(REL_POS).applyQuaternion(_q.copy(REL_QUAT).invert());
  // R^T I R diagonal: LM x = CSM x, LM y = CSM z, LM z = -CSM y
  lm.stack.inertia.set(I[0], I[8], I[4]);
  return st;
}

/** Place the LM on the CSM using the stack's current relative transform and copy the motion. */
export function slaveLM(st, csm, lm) {
  lm.quat.copy(csm.quat).multiply(st.relQ);
  lm.pos.copy(st.relT).applyQuaternion(csm.quat).add(csm.pos);
  // body rates: LM = R_rel^T w_csm
  lm.angVel.copy(csm.angVel).applyQuaternion(_q.copy(st.relQ).invert());
  // CG velocities from the rigid-body motion of the stack
  const wW = _w.copy(csm.angVel).applyQuaternion(csm.quat);
  const Cw = _c.copy(st.cg).applyQuaternion(csm.quat).add(csm.pos);
  for (const v of [csm, lm]) {
    const cgW = _d.copy(v.cg).applyQuaternion(v.quat).add(v.pos).sub(Cw);
    v.vel.crossVectors(wW, cgW).add(st.vel);
  }
}

/**
 * Probe/drogue geometry between the CSM probe tip and the LM drogue.
 * @returns {{axial:number, lateral:number, closing:number, misalignDeg:number, range:number}}
 */
export function dockingGeometry(csm, lm, out = {}) {
  const tip = _a.copy(CSM.docking.probeTip).applyQuaternion(csm.quat).add(csm.pos);
  // tip in LM body frame
  const p = _b.copy(tip).sub(lm.pos).applyQuaternion(_q.copy(lm.quat).invert());
  out.axial = p.y - LM.docking.port.y; // > 0: tip still outside the drogue plane
  out.lateral = Math.hypot(p.x, p.z);
  out.range = Math.hypot(out.axial, out.lateral);
  // relative velocity of the tip w.r.t. the drogue point
  const vt = pointVelocity(csm, CSM.docking.probeTip, _c);
  const vp = pointVelocity(lm, LM.docking.port, _d);
  vt.sub(vp);
  const yL = _w.set(0, 1, 0).applyQuaternion(lm.quat);
  out.closing = -vt.dot(yL);
  const fwdC = _b.set(0, 0, -1).applyQuaternion(csm.quat);
  out.misalignDeg = (Math.acos(Math.max(-1, Math.min(1, -fwdC.dot(yL)))) * 180) / Math.PI;
  return out;
}

/**
 * Merge two free vessels into a docked stack conserving momentum.
 * @param {object} csm
 * @param {object} lm
 * @param {boolean} capture true: soft capture (probe retracts over DOCK.RETRACT_TIME)
 */
export function mergeStack(csm, lm, capture) {
  const st = createStack();
  // momentum before (world)
  const mc = csm.mass;
  const ml = lm.mass;
  const M = mc + ml;
  const cC = new THREE.Vector3().copy(csm.cg).applyQuaternion(csm.quat).add(csm.pos);
  const cL = new THREE.Vector3().copy(lm.cg).applyQuaternion(lm.quat).add(lm.pos);
  const C = cC.clone().multiplyScalar(mc).addScaledVector(cL, ml).divideScalar(M);
  const V = csm.vel.clone().multiplyScalar(mc).addScaledVector(lm.vel, ml).divideScalar(M);
  const L = new THREE.Vector3();
  for (const [v, c] of [[csm, cC], [lm, cL]]) {
    // spin: R I R^T w  (world)
    const wB = v.angVel;
    const Iw = new THREE.Vector3(v.inertia.x * wB.x, v.inertia.y * wB.y, v.inertia.z * wB.z).applyQuaternion(v.quat);
    L.add(Iw);
    const r = c.clone().sub(C);
    const p = v.vel.clone().sub(V).multiplyScalar(v.mass);
    L.add(new THREE.Vector3().crossVectors(r, p));
  }
  // record the captured relative pose (LM in CSM frame) for the probe retraction
  const qInvC = csm.quat.clone().invert();
  const q0 = qInvC.clone().multiply(lm.quat);
  const t0 = lm.pos.clone().sub(csm.pos).applyQuaternion(qInvC);
  updateStackProps(st, csm, lm);
  st.vel.copy(V);
  // stack angular velocity in CSM body frame: w = I^-1 (R^T L)
  const Lb = L.applyQuaternion(qInvC);
  const e = st.Iinv;
  csm.angVel.set(e[0] * Lb.x + e[1] * Lb.y + e[2] * Lb.z, e[3] * Lb.x + e[4] * Lb.y + e[5] * Lb.z, e[6] * Lb.x + e[7] * Lb.y + e[8] * Lb.z);
  // move the CSM origin so that the stack CG stays where it was
  const cgNowW = st.cg.clone().applyQuaternion(csm.quat).add(csm.pos);
  csm.pos.add(C.sub(cgNowW));
  if (capture) {
    st.capture = { t: 0, q0, t0 };
    st.probeExtension = 1;
    st.relQ.copy(q0);
    st.relT.copy(t0);
  }
  csm.docked = lm.docked = true;
  csm.dockedTo = 'LM';
  lm.dockedTo = 'CSM';
  slaveLM(st, csm, lm);
  return st;
}

/** Advance the probe retraction; returns true on the step the hard dock completes. */
export function advanceCapture(st, h) {
  const c = st.capture;
  if (!c) return false;
  c.t += h;
  const s = Math.min(1, c.t / DOCK.RETRACT_TIME);
  const e = s * s * (3 - 2 * s);
  st.relQ.slerpQuaternions(c.q0, REL_QUAT, e);
  st.relT.lerpVectors(c.t0, REL_POS, e);
  st.probeExtension = 1 - e;
  if (s >= 1) {
    st.capture = null;
    st.relQ.copy(REL_QUAT);
    st.relT.copy(REL_POS);
    return true;
  }
  return false;
}

/**
 * Separate the stack: each vessel keeps the stack's rigid motion plus the spring separation.
 * @param {object} st stack
 */
export function splitStack(st, csm, lm, sepSpeed = DOCK.SEP_SPEED) {
  slaveLM(st, csm, lm);
  const yL = _a.set(0, 1, 0).applyQuaternion(lm.quat); // LM +Y points at the CSM
  const M = csm.mass + lm.mass;
  lm.vel.addScaledVector(yL, (-sepSpeed * csm.mass) / M);
  csm.vel.addScaledVector(yL, (sepSpeed * lm.mass) / M);
  csm.docked = lm.docked = false;
  csm.dockedTo = lm.dockedTo = null;
  csm.stack = null;
  lm.stack = null;
}

/** Relative-velocity bounce of a failed probe contact (no capture). */
export function bounce(csm, lm) {
  const yL = _a.set(0, 1, 0).applyQuaternion(lm.quat);
  const rel = _b.copy(csm.vel).sub(lm.vel);
  const closing = -rel.dot(yL);
  if (closing <= 0) return 0;
  const J = ((1 + DOCK.RESTITUTION) * closing) / (1 / csm.mass + 1 / lm.mass);
  csm.vel.addScaledVector(yL, J / csm.mass);
  lm.vel.addScaledVector(yL, -J / lm.mass);
  return closing;
}

