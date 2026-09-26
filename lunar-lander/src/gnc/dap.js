// Digital AutoPilot (DAP) — RCS jet selection and the rotational control laws of the Apollo
// LM (LGC "Luminary" DAP) and CSM (CMC "Colossus" RCS DAP).
//
// Modes (vessel.gnc.rcsMode):
//   RATE   rate command / attitude hold. Hand-controller deflection commands a body rate
//          (LM 20 deg/s, fine 4 deg/s; CSM 7 deg/s, fine 0.7 deg/s). Releasing the stick nulls
//          the rates and then holds the attitude captured at that moment inside a deadband
//          (LM 0.3 deg, CSM 0.5 deg) using phase-plane switching logic. Attitude autopilots and
//          guidance steer through the same law (eigen-axis manoeuvres with rate/accel limits).
//   PULSE  minimum-impulse: every new deflection fires one 14-ms bit of the axis' jet pair;
//          holding the stick repeats the bit at 4 Hz after 0.5 s. No damping, no hold.
//   DIRECT all four jets of the axis full on while deflected. No damping, no hold.
//
// The law runs on a 100-ms DAP cycle, like the real LM DAP: each cycle computes jet ON-times
// (pulse-width modulation, minimum impulse bit 14 ms) from the rate error, the vehicle inertia
// and the torque of the selected jets; the on-time is then dispensed over the physics substeps
// as the per-substep duty jet.cmd (0..1). Rotation jets are chosen from the real jet geometry
// about the current CG (see buildJetSets): LM pitch/roll with up/down-firing couples, LM yaw with
// the horizontal jets, CSM pitch/yaw with the axial jets on opposite quads, CSM roll with the
// tangential jets. Two-jet couples are used for fine corrections (alternating between the A and
// B pairs), four-jet couples for large rate changes.
//
// Sign conventions (core/constants.js): +pitch cmd -> +wx, +yaw cmd (nose right) -> -wy,
// +roll cmd (right) -> -wz.

import * as THREE from 'three';
import { LM, CSM } from '../core/constants.js';

const D2R = Math.PI / 180;

/** Per-vehicle DAP tuning (SI, rad). */
export const DAP_CONFIG = {
  LM: {
    rateMax: 20 * D2R, // ACA full deflection, NORMAL scaling
    rateFine: 4 * D2R, // ACA full deflection, FINE scaling
    deadband: 0.3 * D2R, // attitude-hold deadband (LGC narrow deadband)
    holdRateMax: 2 * D2R, // max correction rate when outside the deadband
    autoRate: 5 * D2R, // attitude autopilot manoeuvre rate
    captureRate: 0.3 * D2R, // |w| below which the attitude is captured after release
    minImpulse: LM.rcs.minImpulseBit,
    cycle: 0.1, // DAP cycle (s)
    detent: 0.03, // hand-controller detent (fraction of full throw)
  },
  CSM: {
    rateMax: 7 * D2R,
    rateFine: 0.7 * D2R,
    deadband: 0.5 * D2R,
    holdRateMax: 1 * D2R,
    autoRate: 3 * D2R,
    captureRate: 0.2 * D2R,
    minImpulse: CSM.rcs.minImpulseBit,
    cycle: 0.1,
    detent: 0.03,
  },
};

const AX = ['x', 'y', 'z'];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ------------------------------------------------------------------ jet geometry

/**
 * Analyse a jet table about a CG: per-jet force/torque, rotation couples and translation sets.
 * @param {'LM'|'CSM'} type vehicle type (selects the jet families used for each axis)
 * @param {Array} jets vessel.rcs.jets
 * @param {THREE.Vector3} cg torque reference point in the vessel body frame
 * @returns {{force: THREE.Vector3[], torque: THREE.Vector3[], rot: Array, trans: Object, cg: THREE.Vector3}}
 *   rot[axis][0 = +, 1 = -] = { four: {idx, torque}, two: [{idx, torque}, ...] }
 *   trans['+x'|'-x'|'+y'|...] = {idx, force, torque}
 */
export function buildJetSets(type, jets, cg) {
  const force = jets.map((j) => j.forceDir.clone().multiplyScalar(j.thrust));
  const torque = jets.map((j, i) => new THREE.Vector3().subVectors(j.pos, cg).cross(force[i]));
  // Jet families per rotation axis (mimic the real vehicles)
  const family = (axis, j) => {
    const e = j.exhaustDir;
    if (type === 'LM') return axis === 1 ? Math.abs(e.y) < 0.1 : Math.abs(e.y) > 0.9; // yaw: horizontal jets
    return axis === 2 ? Math.abs(e.z) < 0.1 : Math.abs(e.z) > 0.9; // CSM roll: tangential jets
  };
  const sumTorque = (idx) => idx.reduce((s, i) => s.add(torque[i]), new THREE.Vector3());
  const sumForce = (idx) => idx.reduce((s, i) => s.add(force[i]), new THREE.Vector3());
  const rot = [];
  for (let a = 0; a < 3; a++) {
    const fam = [];
    let maxT = 0;
    jets.forEach((j, i) => {
      if (!family(a, j)) return;
      fam.push(i);
      maxT = Math.max(maxT, Math.abs(torque[i].getComponent(a)));
    });
    const signs = [];
    for (const s of [1, -1]) {
      const cand = fam.filter((i) => s * torque[i].getComponent(a) > 0.5 * maxT);
      const four = { idx: cand, torque: sumTorque(cand) };
      let two = [four];
      if (cand.length > 2) {
        // score every pair: residual force and cross-axis torque relative to the on-axis torque
        const pairs = [];
        for (let p = 0; p < cand.length; p++) {
          for (let q = p + 1; q < cand.length; q++) {
            const idx = [cand[p], cand[q]];
            const t = sumTorque(idx);
            const on = Math.abs(t.getComponent(a));
            const cross = Math.hypot(...[0, 1, 2].filter((k) => k !== a).map((k) => t.getComponent(k)));
            const f = sumForce(idx).length() / jets[cand[p]].thrust;
            pairs.push({ idx, torque: t, score: f + cross / (on || 1) });
          }
        }
        pairs.sort((x, y) => x.score - y.score);
        const best = pairs[0].score;
        const chosen = [];
        for (const p of pairs) {
          if (p.score > best + 0.05) break;
          if (chosen.some((c) => c.idx.some((i) => p.idx.includes(i)))) continue; // disjoint A/B pairs
          chosen.push(p);
        }
        two = chosen.map(({ idx, torque: t }) => ({ idx, torque: t }));
      }
      signs.push({ four, two });
    }
    rot.push(signs);
  }
  const trans = {};
  const dirs = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
  for (const [k, d] of Object.entries(dirs)) {
    const dv = new THREE.Vector3(...d);
    const idx = [];
    jets.forEach((j, i) => {
      if (j.forceDir.dot(dv) > 0.9) idx.push(i);
    });
    trans[k] = { idx, force: sumForce(idx), torque: sumTorque(idx) };
  }
  return { force, torque, rot, trans, cg: cg.clone() };
}

// ------------------------------------------------------------------ state

/** Per-vessel DAP state (private to gnc/). */
export function createDAPState() {
  return {
    rem: new Float64Array(32), // remaining jet ON-time in the current DAP cycle (s)
    transDuty: new Float64Array(32), // continuous translation duty this substep
    timer: 0, // time to the next DAP cycle
    phase: 'HOLD', // 'RATE' (stick) | 'DAMP' (rates nulling after release) | 'HOLD' | 'AUTO' | 'FREE'
    hold: null, // THREE.Quaternion attitude reference (body -> MCI) or null
    dampTime: 0,
    dampLimit: 6, // s: DAMP -> HOLD time-out (from the stopping time at release)
    sets: null,
    setsKey: '',
    alt: [0, 0, 0], // alternating A/B jet pair per axis
    pulse: [{ held: 0, next: 0, prev: 0 }, { held: 0, next: 0, prev: 0 }, { held: 0, next: 0, prev: 0 }],
    err: new THREE.Vector3(), // current attitude error (rad, body; rotation current -> target)
    rateCmd: new THREE.Vector3(), // current rate command (rad/s, body)
    lastTarget: null, // previous autopilot target quaternion (for the feed-forward rate)
    lastDir: null, // previous pointing direction (MCI) for axis targets
    ff: new THREE.Vector3(), // target-frame angular velocity (body, rad/s)
    impulses: 0, // jet firings counter (diagnostics)
    since: 0, // s since the previous DAP cycle
  };
}

/** Mass properties used for control: the docked stack when docked, else the vessel. */
export function controlMassProps(v) {
  const mp = v.docked && v.stack && v.stack.mass > 0 ? v.stack : v;
  if (mp.mass > 0 && mp.inertia && mp.inertia.x > 1) return mp;
  // sim not initialised yet: rough estimate from the constants
  if (v.type === 'LM') {
    return v.staged
      ? { mass: LM.ascentDryMass + LM.ascentPropMax, cg: LM.cgAscentDry, inertia: LM.inertiaAscent }
      : { mass: 15000, cg: new THREE.Vector3(0, 2.4, 0), inertia: LM.inertiaFull };
  }
  return { mass: 28000, cg: CSM.cgSMDry, inertia: CSM.inertiaFull };
}

function jetSets(v, st, mp) {
  const cg = mp.cg;
  const key = `${v.rcs.jets.length}:${(cg.x * 50) | 0}:${(cg.y * 50) | 0}:${(cg.z * 50) | 0}:${v.docked ? 1 : 0}`;
  if (!st.sets || st.setsKey !== key || st.setsJets !== v.rcs.jets) {
    st.sets = buildJetSets(v.type, v.rcs.jets, cg);
    st.setsKey = key;
    st.setsJets = v.rcs.jets;
  }
  return st.sets;
}

// ------------------------------------------------------------------ attitude errors

/**
 * Rotation vector (body frame, rad) that takes attitude qCur to qTgt (both body -> MCI).
 * @returns {THREE.Vector3} out
 */
export function quatError(qCur, qTgt, out = new THREE.Vector3()) {
  _q.copy(qCur).invert().multiply(qTgt); // body-frame rotation
  if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
  const s = Math.hypot(_q.x, _q.y, _q.z);
  if (s < 1e-12) return out.set(0, 0, 0);
  const ang = 2 * Math.atan2(s, _q.w);
  return out.set(_q.x, _q.y, _q.z).multiplyScalar(ang / s);
}

/**
 * Rotation vector (body frame, rad) that swings body axis `axisBody` onto the MCI direction
 * `dirWorld` by the shortest path (the roll about that axis is left free).
 */
export function axisError(qCur, axisBody, dirWorld, out = new THREE.Vector3()) {
  const d = _v.copy(dirWorld).normalize().applyQuaternion(_q.copy(qCur).invert());
  const c = Math.max(-1, Math.min(1, axisBody.dot(d)));
  out.crossVectors(axisBody, d);
  const s = out.length();
  const ang = Math.acos(c);
  if (s < 1e-9) {
    if (c > 0) return out.set(0, 0, 0);
    // anti-parallel: turn about a body axis perpendicular to the pointing axis (pitch)
    out.set(1, 0, 0);
    if (Math.abs(axisBody.x) > 0.9) out.set(0, 1, 0);
    return out.multiplyScalar(ang);
  }
  return out.multiplyScalar(ang / s);
}

// ------------------------------------------------------------------ helpers

/** Rate change produced by one minimum-impulse bit of the 2-jet couple on each axis (rad/s). */
function minBitRates(sets, I, minImp, out) {
  for (let a = 0; a < 3; a++) {
    const t = Math.abs(sets.rot[a][0].two[0].torque.getComponent(a));
    out[a] = (t * minImp) / I[a];
  }
  return out;
}

/** Axis angular acceleration available for braking (4-jet couple when there is one, rad/s^2). */
function brakeAccel(sets, I, a) {
  const r = sets.rot[a][0];
  const set = r.four && r.four.idx.length > 2 ? r.four : r.two[0];
  return Math.abs(set.torque.getComponent(a)) / I[a];
}

/** Attitude at which the current body rates will have been nulled at full braking. */
const _sv = new THREE.Vector3();
const _sq = new THREE.Quaternion();
function stopAttitude(v, sets, I, out) {
  const w = v.angVel;
  for (let a = 0; a < 3; a++) {
    const wa = w.getComponent(a);
    _sv.setComponent(a, (wa * Math.abs(wa)) / (2 * Math.max(1e-6, brakeAccel(sets, I, a))));
  }
  const ang = _sv.length();
  if (ang > 1e-9) _sq.setFromAxisAngle(_sv.divideScalar(ang), ang);
  else _sq.identity();
  return out.copy(v.quat).multiply(_sq);
}

/** Axis angular acceleration of the 2-jet couple (rad/s^2). */
function axisAccel(sets, I, a) {
  return Math.abs(sets.rot[a][0].two[0].torque.getComponent(a)) / I[a];
}

/**
 * Phase-plane target rate for attitude hold on one axis.
 * e: error (rad, rotation still needed), w: current rate, db: deadband, lc: limit-cycle drift rate,
 * wmax: max correction rate, alpha: available accel. Returns NaN to coast (no firing).
 */
function holdRate(e, w, db, lc, wmax, alpha, k = 0.5) {
  const ae = Math.abs(e);
  if (ae <= db) {
    // inside the deadband: coast, unless drifting faster than the limit-cycle rate
    if (Math.abs(w) <= lc * 1.6) return NaN;
    // drifting too fast: slow down to the limit-cycle rate in the same direction
    return Math.sign(w) * lc;
  }
  const over = ae - db;
  const r = Math.min(wmax, lc + Math.min(k * over, Math.sqrt(alpha * over)));
  return Math.sign(e) * r;
}

// ------------------------------------------------------------------ main step

const _mb = new Float64Array(3);
const _I = new Float64Array(3);
const _tq = new THREE.Vector3();

/**
 * One DAP substep for a vessel: writes vessel.rcs.jets[i].cmd.
 * @param {object} v vessel
 * @param {object} st DAP state (createDAPState)
 * @param {number} h physics substep (s)
 * @param {object} io {
 *    stick: THREE.Vector3 (pitch, yaw, roll -1..1, pilot convention) — zero when not flying,
 *    fine: boolean, trans: THREE.Vector3 (body-frame translation command -1..1 per axis),
 *    transDuty: number (duty of the translation jets, 0..1),
 *    target: null | {quat?: Quaternion} | {axis: Vector3 (body), dir: Vector3 (MCI)} | {rate: Vector3 (body, rad/s)},
 *    targetRate: max manoeuvre rate (rad/s), enabled: boolean (false = jets off) }
 */
export function dapStep(v, st, h, io) {
  const jets = v.rcs.jets;
  const cfg = DAP_CONFIG[v.type];
  const mp = controlMassProps(v);
  const sets = jetSets(v, st, mp);
  const mode = v.gnc.rcsMode || 'RATE';
  _I[0] = mp.inertia.x;
  _I[1] = mp.inertia.y;
  _I[2] = mp.inertia.z;

  // ---- translation (continuous while commanded)
  const td = st.transDuty;
  td.fill(0);
  _tq.set(0, 0, 0);
  if (io.enabled) {
    for (let a = 0; a < 3; a++) {
      const c = io.trans.getComponent(a);
      if (Math.abs(c) < 0.3) continue;
      const set = sets.trans[(c > 0 ? '+' : '-') + AX[a]];
      const duty = io.transDuty;
      for (const i of set.idx) td[i] = Math.max(td[i], duty);
      _tq.addScaledVector(set.torque, duty);
    }
  }

  // ---- rotation
  st.timer -= h;
  const stick = io.stick;
  const stickOn = io.enabled && (Math.abs(stick.x) > cfg.detent || Math.abs(stick.y) > cfg.detent || Math.abs(stick.z) > cfg.detent);

  if (!io.enabled) {
    st.rem.fill(0);
    st.phase = 'FREE';
    st.hold = null;
    st.err.set(0, 0, 0);
  } else if (mode === 'DIRECT') {
    st.rem.fill(0);
    st.phase = 'FREE';
    st.hold = null;
    st.err.set(0, 0, 0);
    for (let a = 0; a < 3; a++) {
      const d = pilotToBody(stick, a);
      if (Math.abs(d) < 0.5) continue;
      for (const i of sets.rot[a][d > 0 ? 0 : 1].four.idx) td[i] = 1;
    }
  } else if (mode === 'PULSE') {
    st.phase = 'FREE';
    st.hold = null;
    st.err.set(0, 0, 0);
    for (let a = 0; a < 3; a++) {
      const d = pilotToBody(stick, a);
      const p = st.pulse[a];
      const s = Math.abs(d) >= 0.5 ? Math.sign(d) : 0;
      let fire = false;
      if (s !== 0 && s !== p.prev) {
        fire = true;
        p.held = 0;
        p.next = 0.5;
      } else if (s !== 0) {
        p.held += h;
        if (p.held >= p.next) {
          fire = true;
          p.next += 0.25;
        }
      }
      p.prev = s;
      if (fire) {
        const couple = pickTwo(sets, st, a, s > 0 ? 0 : 1);
        for (const i of couple.idx) st.rem[i] += cfg.minImpulse;
        st.impulses++;
      }
    }
  } else if (st.timer <= 0) {
    // ---- RATE mode: one DAP cycle
    const T = Math.max(cfg.cycle, h);
    st.timer += T;
    if (st.timer < 0) st.timer = cfg.cycle;
    st.rem.fill(0);
    rateCycle(v, st, T, cfg, sets, stick, stickOn, io);
    st.since = 0;
  }

  // time since the last DAP cycle's samples, INCLUDING the substep that follows them
  st.since += h;

  // ---- dispense jet commands for this substep
  for (let i = 0; i < jets.length; i++) {
    let duty = 0;
    if (st.rem[i] > 0) {
      duty = Math.min(1, st.rem[i] / h);
      st.rem[i] = Math.max(0, st.rem[i] - duty * h);
    }
    jets[i].cmd = Math.min(1, duty + td[i]);
  }
}

/** Body-axis component (a = 0 x, 1 y, 2 z) of a pilot stick vector (pitch, yaw, roll). */
function pilotToBody(stick, a) {
  return a === 0 ? stick.x : a === 1 ? -stick.y : -stick.z;
}

function pickTwo(sets, st, a, si) {
  const two = sets.rot[a][si].two;
  if (two.length > 1) st.alt[a] = (st.alt[a] + 1) % two.length;
  return two[Math.min(st.alt[a], two.length - 1)];
}

/** RATE mode control law for one DAP cycle of length T. */
function rateCycle(v, st, T, cfg, sets, stick, stickOn, io) {
  const w = v.angVel;
  const I = _I;
  const mb = minBitRates(sets, I, cfg.minImpulse, _mb);
  const wt = st.rateCmd; // target rates (NaN = coast)
  const target = io.target;
  const fine = io.fine;

  // --- phase logic
  if (stickOn) {
    st.phase = 'RATE';
    st.hold = null;
    const wmax = fine ? cfg.rateFine : cfg.rateMax;
    for (let a = 0; a < 3; a++) {
      const d = pilotToBody(stick, a);
      const m = Math.abs(d) <= cfg.detent ? 0 : (Math.abs(d) - cfg.detent) / (1 - cfg.detent);
      wt.setComponent(a, Math.sign(d) * m * wmax);
    }
    st.err.set(0, 0, 0);
  } else if (target) {
    st.phase = 'AUTO';
    st.hold = null;
    autoRates(v, st, T, cfg, sets, target, io.targetRate || cfg.autoRate, mb);
  } else {
    if (st.phase === 'RATE' || st.phase === 'AUTO' || st.phase === 'FREE') {
      st.phase = 'DAMP';
      st.dampTime = 0;
      // time the jets need to null the current rates (low-authority vehicles such as the CSM
      // or the docked stack take well over 6 s to stop a fast rotation): capture the hold only
      // once the vehicle has stopped, so it does not brake past the reference and swing back
      let tStop = 0;
      for (let a = 0; a < 3; a++) tStop = Math.max(tStop, Math.abs(w.getComponent(a)) / Math.max(1e-6, brakeAccel(sets, I, a)));
      st.dampLimit = Math.max(6, 1.5 * tStop + 2);
    }
    if (st.phase === 'DAMP') {
      st.dampTime += T;
      wt.set(0, 0, 0);
      st.err.set(0, 0, 0);
      const slow = Math.abs(w.x) < cfg.captureRate && Math.abs(w.y) < cfg.captureRate && Math.abs(w.z) < cfg.captureRate;
      if (v.gnc.attHold !== false && (slow || st.dampTime > (st.dampLimit || 6))) {
        st.phase = 'HOLD';
        // still turning (time-out): hold where the rotation will stop, not where it is now
        st.hold = slow ? v.quat.clone() : stopAttitude(v, sets, I, st.hold || new THREE.Quaternion());
      }
    }
    if (st.phase === 'HOLD') {
      if (!st.hold || v.gnc.attHold === false) {
        st.phase = 'DAMP';
        st.hold = null;
      } else {
        quatError(v.quat, st.hold, st.err);
        const lc = limitCycleRate(mb);
        for (let a = 0; a < 3; a++) {
          const alpha = 0.5 * axisAccel(sets, I, a);
          wt.setComponent(a, holdRate(st.err.getComponent(a), w.getComponent(a), cfg.deadband, lc[a], cfg.holdRateMax, alpha));
        }
      }
    }
    if (st.phase === 'DAMP' && v.gnc.attHold === false) {
      // rate damping only: coast once the rates are small
      for (let a = 0; a < 3; a++) if (Math.abs(w.getComponent(a)) < Math.max(0.5 * mb[a], 0.02 * D2R)) wt.setComponent(a, NaN);
    }
  }
  fireToRates(v, st, T, cfg, sets, wt, mb);
}

const _lc = new Float64Array(3);
function limitCycleRate(mb) {
  for (let a = 0; a < 3; a++) _lc[a] = Math.max(0.02 * D2R, 0.75 * mb[a]);
  return _lc;
}

/** Target rates for an autopilot / guidance attitude target (eigen-axis manoeuvre, then hold). */
function autoRates(v, st, T, cfg, sets, target, wmax, mb) {
  const w = v.angVel;
  const wt = st.rateCmd;
  if (target.rate) {
    wt.copy(target.rate);
    st.err.set(0, 0, 0);
    return;
  }
  const e = target.quat ? quatError(v.quat, target.quat, st.err) : axisError(v.quat, target.axis, target.dir, st.err);
  // feed-forward: angular velocity of the target frame (differentiated, filtered)
  if (target.quat) {
    if (st.lastTarget && st.since > 1e-6) {
      quatError(st.lastTarget, target.quat, _w); // in the old target frame ~ body
      _w.divideScalar(st.since); // actual time since the previous target sample
      if (_w.length() > 0.05) _w.set(0, 0, 0); // a jump (new target), not a motion
      st.ff.lerp(_w, 0.3);
    } else st.ff.set(0, 0, 0);
    st.lastTarget = (st.lastTarget || new THREE.Quaternion()).copy(target.quat);
    st.lastDir = null;
  } else {
    // pointing target: angular velocity of the reference direction (e.g. orbital rate for
    // PROGRADE), expressed in the body frame
    if (st.lastDir && st.since > 1e-6) {
      _w.crossVectors(st.lastDir, target.dir).divideScalar(st.since).applyQuaternion(_q.copy(v.quat).invert());
      if (_w.length() > 0.05) _w.set(0, 0, 0);
      st.ff.lerp(_w, 0.3);
    } else st.ff.set(0, 0, 0);
    st.lastDir = (st.lastDir || new THREE.Vector3()).copy(target.dir).normalize();
    st.lastTarget = null;
  }
  const ang = e.length();
  const alphaMin = Math.min(axisAccel(sets, _I, 0), axisAccel(sets, _I, 1), axisAccel(sets, _I, 2)) * 0.5;
  const db = target.deadband ?? cfg.deadband;
  if (ang > 4 * db) {
    // eigen-axis manoeuvre with a sqrt (constant-decel) profile toward the target
    const over = ang - db;
    const r = Math.min(wmax, Math.sqrt(alphaMin * over), 0.6 * over + 0.05 * D2R);
    wt.copy(e).multiplyScalar(r / ang).add(st.ff);
  } else {
    const lc = limitCycleRate(mb);
    for (let a = 0; a < 3; a++) {
      const alpha = 0.5 * axisAccel(sets, _I, a);
      const ff = st.ff.getComponent(a);
      const r = holdRate(e.getComponent(a), w.getComponent(a) - ff, db, lc[a], Math.min(wmax, cfg.holdRateMax * 2), alpha);
      wt.setComponent(a, Number.isNaN(r) ? NaN : r + ff); // NaN = coast inside the deadband
    }
  }
}

/**
 * Deadbeat rate controller: jet ON-times that bring each axis rate to its target within one
 * cycle (limited by the available torque), including the torque of active translation jets.
 */
function fireToRates(v, st, T, cfg, sets, wt, mb) {
  const w = v.angVel;
  const I = _I;
  for (let a = 0; a < 3; a++) {
    const tgt = wt.getComponent(a);
    const trq = _tq.getComponent(a); // translation-jet disturbance torque (duty-weighted)
    let H; // required torque impulse (signed)
    if (Number.isNaN(tgt)) {
      if (Math.abs(trq) < 1e-6) continue;
      H = -trq * T; // just cancel the translation disturbance
    } else {
      const dw = tgt - w.getComponent(a);
      H = I[a] * dw - trq * T;
      if (Math.abs(dw) < Math.max(0.5 * mb[a], 0.004 * D2R) && Math.abs(trq) < 1e-6) continue;
    }
    const si = H > 0 ? 0 : 1;
    const need = Math.abs(H);
    const two = sets.rot[a][si].two[0];
    const t2 = Math.abs(two.torque.getComponent(a));
    let couple;
    let tau;
    if (need / t2 <= 0.8 * T || sets.rot[a][si].four.idx.length <= 2) {
      couple = pickTwo(sets, st, a, si);
      tau = Math.abs(couple.torque.getComponent(a));
    } else {
      couple = sets.rot[a][si].four;
      tau = Math.abs(couple.torque.getComponent(a));
    }
    if (tau <= 0) continue;
    let ton = need / tau;
    if (ton < cfg.minImpulse) {
      if (ton < 0.5 * cfg.minImpulse) continue;
      ton = cfg.minImpulse;
    }
    ton = Math.min(ton, T);
    for (const i of couple.idx) st.rem[i] = Math.min(T, st.rem[i] + ton);
    st.impulses++;
  }
}

/** Utility for tests / UI: total body torque (N m) of the current jet commands about the CG. */
export function commandedTorque(v, out = new THREE.Vector3()) {
  const mp = controlMassProps(v);
  out.set(0, 0, 0);
  for (const j of v.rcs.jets) {
    if (!(j.cmd > 0)) continue;
    _v.subVectors(j.pos, mp.cg).cross(_w.copy(j.forceDir).multiplyScalar(j.thrust * Math.min(1, j.cmd)));
    out.add(_v);
  }
  return out;
}

