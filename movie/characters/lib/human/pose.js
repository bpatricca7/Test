// Pose solver: state -> bone rotations, in character space (root at the
// origin, facing +Z). Pure function of the state (deterministic, no history);
// secondary motion is layered on top by human.js from sampled past states.

import * as THREE from 'three';
import { BODY, FINGER_NAMES } from './rig.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const qAxis = (ax, ay, az, a) => new THREE.Quaternion().setFromAxisAngle(v3(ax, ay, az).normalize(), a);
const qEuler = (x, y, z, order = 'YXZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));

/** smooth deterministic wiggle: sum of incommensurate sines, roughly -1..1 */
export function wiggle(t, seed, speed = 1) {
  const s = seed * 12.9898;
  return (Math.sin(t * 0.73 * speed + s) * 0.5 + Math.sin(t * 1.37 * speed + s * 1.7) * 0.3 + Math.sin(t * 2.91 * speed + s * 2.3) * 0.2);
}

export const ARM_POSES = ['rest', 'desk', 'overEyes', 'point', 'gesture', 'raise', 'pocket', 'chin', 'shrug', 'hips', 'cross', 'reach', 'wave', 'lean', 'scratch', 'beat'];

// finger curls [index, middle, ring, pinky], thumb [curl, across], spread
const HANDS = {
  relaxed: { c: [0.28, 0.34, 0.4, 0.46], th: [0.2, 0.15], sp: 0.05 },
  flat: { c: [0.08, 0.08, 0.1, 0.12], th: [0.05, 0.0], sp: 0.12 },
  open: { c: [0.06, 0.05, 0.08, 0.1], th: [0.0, -0.1], sp: 0.35 },
  point: { c: [0.0, 0.95, 1.0, 1.0], th: [0.55, 0.55], sp: 0.0 },
  fist: { c: [0.95, 1.0, 1.0, 1.0], th: [0.7, 0.6], sp: 0.0 },
  loose: { c: [0.55, 0.62, 0.7, 0.78], th: [0.4, 0.35], sp: 0.02 },
  press: { c: [0.05, 0.6, 0.7, 0.75], th: [0.35, 0.3], sp: 0.05 },
  type: { c: [0.35, 0.4, 0.42, 0.46], th: [0.25, 0.1], sp: 0.1 },
  grip: { c: [0.5, 0.52, 0.55, 0.58], th: [0.35, 0.25], sp: 0.04 },
};

export function normalizeState(st = {}) {
  const S = {
    t: st.t || 0, position: st.position || [0, 0, 0], yaw: st.yaw || 0,
    sit: clamp(st.sit || 0), seatHeight: st.seatHeight ?? 0.47, recline: clamp(st.recline || 0),
    lean: clamp(st.lean || 0, -1, 1), twist: st.twist || 0,
    walk: { phase: st.walk?.phase || 0, amount: clamp(st.walk?.amount || 0), stride: st.walk?.stride ?? 0.34 },
    head: { yaw: st.head?.yaw || 0, pitch: st.head?.pitch || 0, roll: st.head?.roll || 0 },
    lookAt: st.lookAt || null, headFollow: st.headFollow ?? 0.4,
    armL: st.armL || {}, armR: st.armR || {},
    pointAt: st.pointAt || null, reachAt: st.reachAt || null, gesturePhase: st.gesturePhase || 0,
    energy: st.energy ?? 0.5, startle: clamp(st.startle || 0), nod: st.nod || 0, shake: st.shake || 0,
  };
  return S;
}

/**
 * Solve the skeleton for a state. Writes bone local transforms and returns
 * character-space world data for the head, eyes, hands etc.
 * ctx: { id, rig: {bones, J}, seed, eyeOffsets:[L,R] head-local, headOrigin }
 */
export function solvePose(S, ctx) {
  const { id, rig } = ctx;
  const B = BODY[id];
  const J = rig.J, bones = rig.bones;
  const t = S.t, E = S.energy;
  const seed = ctx.seed;
  // root transform (world) to convert world targets into character space
  const rootQ = qAxis(0, 1, 0, S.yaw);
  const rootP = v3(...S.position);
  const rootQi = rootQ.clone().invert();
  const toChar = w => v3(w[0], w[1], w[2]).sub(rootP).applyQuaternion(rootQi);

  const W = {}; // world (character space) transforms: {p, q}
  const L = {}; // local rotations
  const setLocal = (name, q, extraPos) => {
    const b = bones[name];
    const parent = b.parent && b.parent.isBone ? b.parent.name : null;
    const bl = b.userData.bindLocal;
    const lp = bl.clone(); if (extraPos) lp.add(extraPos);
    L[name] = { q: q.clone(), p: lp };
    if (!parent) { W[name] = { p: lp.clone(), q: q.clone() }; return; }
    const pw = W[parent];
    W[name] = { p: lp.clone().applyQuaternion(pw.q).add(pw.p), q: pw.q.clone().multiply(q) };
  };
  const setWorldQ = (name, qWorld, extraPos) => {
    const b = bones[name];
    const pw = W[b.parent.name];
    setLocal(name, pw.q.clone().invert().multiply(qWorld), extraPos);
  };

  // ---------------------------------------------------------------- walk
  const wk = S.walk, wa = wk.amount, ph = wk.phase;
  const stride = wk.stride;
  const gait = side => {
    // side +1 = left (plants at 0.25), -1 = right (0.75)
    const p0 = side > 0 ? 0.25 : 0.75;
    let u = ((ph - p0) % 1 + 1) % 1; // 0 at heel strike
    const stance = 0.62;
    let z, y = 0, pitch = 0, toe = 0;
    if (u < stance) {
      const s = u / stance;
      z = mix(0.62, -0.62, s) * stride;
      pitch = -0.22 * sstep(0.12, 0, s) + 0.45 * sstep(0.62, 1.0, s); // toes up at strike, heel up before toe-off
      toe = -0.5 * sstep(0.7, 1.0, s);
      y = 0.012 * sstep(0.62, 1.0, s) + 0.035 * sstep(0.88, 1.0, s);
    } else {
      const s = (u - stance) / (1 - stance);
      const e = s * s * (3 - 2 * s);
      z = mix(-0.62, 0.62, e) * stride;
      y = 0.047 + 0.075 * Math.sin(Math.PI * Math.min(1, s * 1.08)) * (stride / 0.34);
      y *= 1 - sstep(0.75, 1, s) * 0.62;
      pitch = mix(0.45, -0.22, sstep(0.0, 0.85, s)) * (1 - 0.3 * Math.sin(Math.PI * s));
      toe = mix(-0.5, 0.1, sstep(0, 0.35, s));
    }
    return { z, y, pitch, toe };
  };
  const bob = -Math.cos(4 * Math.PI * (ph - 0.25)); // -1 low at strikes, +1 high mid-stance
  const swayX = Math.sin(TAU * (ph - 0.25));
  const pelvisYawW = -0.13 * Math.cos(TAU * (ph - 0.25)) * wa;
  const hipDrop = 0.06 * Math.sin(TAU * (ph - 0.25)) * wa;

  // --------------------------------------------------------------- pelvis
  const sit = S.sit, rec = S.recline * sit;
  const hipsBind = J.hips;
  const standH = hipsBind.y - 0.008;
  // seated: hip joints ~9 cm above the seat, ~13 cm behind its front edge
  const seatHipY = S.seatHeight + (B.hip[1] > 0.9 ? 0.095 : 0.088) + (hipsBind.y - B.hip[1]);
  const seatHipZ = -0.13;
  let hipsPos = v3(0, mix(standH, seatHipY, sstep(0, 1, sit)), mix(hipsBind.z, seatHipZ, sstep(0, 1, sit)));
  // getting up/sitting down: the hips travel back before dropping
  hipsPos.z -= 0.08 * Math.sin(Math.PI * sit) * (1 - sit * 0.3);
  // recline: slide forward and slump
  hipsPos.z += 0.13 * rec; hipsPos.y -= 0.035 * rec;
  // walk
  hipsPos.y += (0.016 * bob - 0.012) * wa;
  hipsPos.x += 0.022 * swayX * wa;
  // idle weight shift (standing only)
  const idleAmt = (1 - sit) * (1 - wa) * (0.4 + 0.6 * E);
  const shift = wiggle(t, seed + 1, 0.35);
  hipsPos.x += 0.018 * shift * idleAmt;
  hipsPos.y -= 0.006 * Math.abs(shift) * idleAmt;
  // startle: a little hop down (knees give)
  hipsPos.y -= 0.03 * S.startle * (1 - sit);
  const pelvisTilt = 0.18 * sit + 0.25 * rec - 0.02 * wa; // + = tilt back (posterior)
  const hipsQ = qEuler(-pelvisTilt, pelvisYawW, hipDrop + 0.035 * shift * idleAmt);
  setLocal('root', new THREE.Quaternion());
  setLocal('hips', hipsQ, hipsPos.clone().sub(hipsBind));

  // --------------------------------------------------------------- spine
  const breathRate = 0.23 + 0.12 * E + 0.2 * S.startle;
  const breath = Math.sin(TAU * breathRate * t + seed);
  const breathAmp = 0.3 + 0.7 * E;
  const standUpLean = 0.55 * Math.sin(Math.PI * sit) * (sit < 1 ? 1 : 0);
  const leanF = S.lean * (S.lean > 0 ? 0.95 : 0.4) + standUpLean + 0.06 * wa + 0.12 * sit - 0.02;
  const reclineBack = -0.42 * rec;
  const tw = S.twist;
  const walkCounter = -pelvisYawW * 1.35;
  const idleSway = wiggle(t, seed + 3, 0.5) * 0.02 * idleAmt;
  const startleBack = -0.14 * S.startle;
  const spineQ = qEuler(leanF * 0.38 + reclineBack * 0.45 + pelvisTilt * 0.55 + startleBack * 0.3, tw * 0.3 + walkCounter * 0.4, idleSway - hipDrop * 0.6);
  setLocal('spine', spineQ);
  setLocal('hem', new THREE.Quaternion());
  const chestQ = qEuler(leanF * 0.42 + reclineBack * 0.4 + pelvisTilt * 0.2 - 0.012 * breath * breathAmp + startleBack * 0.5,
    tw * 0.45 + walkCounter * 0.6, idleSway * 0.6 - hipDrop * 0.3);
  setLocal('chest', chestQ, v3(0, 0.002 * breath * breathAmp, 0));

  // ---------------------------------------------------------- head, gaze
  const nodA = S.nod, shakeA = S.shake;
  let hy = S.head.yaw + shakeA * 0.22 * Math.sin(TAU * 2.2 * t);
  let hp = S.head.pitch + nodA * 0.14 * Math.sin(TAU * 2.0 * t);
  let hr = S.head.roll;
  // micro life
  const microA = (0.25 + 0.75 * E) * (1 - 0.8 * rec);
  hy += wiggle(t, seed + 5, 0.6) * 0.025 * microA;
  hp += wiggle(t, seed + 7, 0.55) * 0.02 * microA + 0.008 * breath * breathAmp;
  hr += wiggle(t, seed + 9, 0.4) * 0.018 * microA;
  // walking: head stays level-ish against the bob
  hp -= 0.03 * wa;
  // recline: head rests back and lolls
  hp += -0.1 * rec; hr += 0.22 * rec;
  // startle: head snaps back and down into the shoulders
  hp += -0.2 * S.startle;
  // lookAt: part of the way with the head
  const eyeMid = v3(0, B.headOrigin[1] - B.headBone[1], B.headOrigin[2] - B.headBone[2] + 0.058);
  let look = null;
  if (S.lookAt) {
    look = toChar(S.lookAt);
    // provisional neck/head frame with the current offsets to measure the needed turn
    setLocal('neck', qEuler(hp * 0.35 - leanF * 0.25 - reclineBack * 0.3, hy * 0.35, hr * 0.35));
    const neckW = W.neck;
    const headBaseP = bones.head.userData.bindLocal.clone().applyQuaternion(neckW.q).add(neckW.p);
    const eyeP = eyeMid.clone().applyQuaternion(neckW.q.clone().multiply(qEuler(hp * 0.65, hy * 0.65, hr * 0.65))).add(headBaseP);
    const d = look.clone().sub(eyeP).applyQuaternion(W.chest.q.clone().invert());
    const needYaw = Math.atan2(d.x, d.z);
    const needPitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    const f = clamp(S.headFollow, 0, 1);
    hy += clamp(needYaw * f - 0 * hy, -1.1, 1.1);
    hp += clamp(needPitch * f, -0.6, 0.6);
  }
  setLocal('neck', qEuler(hp * 0.35 - leanF * 0.25 - reclineBack * 0.3 + 0.1 * rec, hy * 0.35, hr * 0.35), v3(0, -0.01 * S.startle, 0));
  setLocal('head', qEuler(hp * 0.65 - leanF * 0.12, hy * 0.65, hr * 0.65));

  // ---------------------------------------------------------------- arms
  const headW = W.head;
  const hq = headW.q;
  // head-local points are measured from the eye-level head origin, not the head bone
  const hoff = v3(B.headOrigin[0] - B.headBone[0], B.headOrigin[1] - B.headBone[1], B.headOrigin[2] - B.headBone[2]);
  const hl = (x, y, z) => v3(x, y, z).add(hoff).applyQuaternion(hq).add(headW.p);
  const hdir = (x, y, z) => v3(x, y, z).applyQuaternion(hq).normalize();
  const cq = W.chest.q;
  const cdir = (x, y, z) => v3(x, y, z).applyQuaternion(cq).normalize();
  const coff = (x, y, z) => v3(x, y, z).applyQuaternion(cq);
  const cpt = (x, y, z) => v3(x, y, z).applyQuaternion(cq).add(W.chest.p);
  const armLen = B.upper + B.fore;
  const out = { hands: {} };
  const hipsW = W.hips;
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const wts = normWeights(S['arm' + k]);
    // clavicle: shrug, startle and breathing lift the shoulders
    const shrugW = wts.shrug || 0;
    const clavUp = 0.012 * breath * breathAmp + 0.2 * shrugW + 0.22 * S.startle + 0.05 * (wts.raise || 0) + 0.06 * (wts.wave || 0)
      + 0.05 * (wts.overEyes || 0) - 0.05 * (wts.lean || 0);
    const clavFwd = 0.08 * (wts.cross || 0) + 0.06 * (wts.desk || 0) + 0.1 * (wts.lean || 0) + 0.05 * (wts.point || 0) + 0.06 * (wts.reach || 0);
    // arms above the shoulder lift the clavicle (estimated from the pose targets)
    let elev = 0;
    {
      const sh0 = bones['clav' + k].userData.bindLocal.clone().applyQuaternion(W.chest.q).add(W.chest.p);
      const hi = (wts.raise || 0) * 0.9 + (wts.wave || 0) * 0.9 + (wts.scratch || 0) * 0.6 + (wts.overEyes || 0) * 0.45 + (wts.point || 0) * 0.3;
      if (S.pointAt && wts.point) { const d = toChar(S.pointAt).sub(sh0); elev = Math.max(0, Math.atan2(d.y, Math.hypot(d.x, d.z))) * wts.point; }
      elev = Math.max(elev, hi);
    }
    setLocal('clav' + k, qEuler(0, -s * clavFwd, s * (clavUp + 0.28 * elev)));
    const Sp = W['upper' + k] ? null : null; void Sp;
    // shoulder position (world) is the upper arm's position
    const shoulder = bones['upper' + k].userData.bindLocal.clone().applyQuaternion(W['clav' + k].q).add(W['clav' + k].p);
    // --- candidate poses: wrist target, finger dir F, palm normal P, elbow pole, hand shape
    const cands = [];
    const add = (w, wrist, F, P, pole, hand) => { if (w > 1e-4) cands.push({ w, wrist, F: F.normalize(), P: P.normalize(), pole: pole.normalize(), hand }); };
    // rest (standing hangs / seated on thighs / reclined on the armrest), with walk swing
    {
      const w = wts.rest;
      const swing = wa * 0.95 * (s > 0 ? 1 : -1) * Math.cos(TAU * (ph - 0.75));
      const sw = wiggle(t, seed + 11 + s, 0.45) * 0.012 * idleAmt;
      const stand = shoulder.clone().add(cdir(0, -1, 0).multiplyScalar(armLen * 0.955)).add(coff(s * 0.055 + sw, 0.0, 0.035));
      stand.add(coff(0, 0.03 * Math.abs(swing), 0.2 * swing));
      const lap = v3(s * 0.12, S.seatHeight + 0.16 + 0.03 * rec, 0.16 - 0.1 * rec);
      const arm = v3(s * 0.23, S.seatHeight + 0.2, 0.02 - 0.05 * rec);
      const seat = lap.lerp(arm, rec * 0.7);
      const wrist = stand.lerp(seat, sstep(0.2, 0.9, sit));
      const Fs = cdir(-s * 0.1, -1, 0.06 + 0.3 * swing), Ps = cdir(-s, -0.1, -0.15);
      const Fd = v3(-s * 0.15, -0.35, 1), Pd = v3(-s * 0.2, -1, 0.1);
      const F = Fs.lerp(Fd, sstep(0.2, 0.9, sit)), P = Ps.lerp(Pd, sstep(0.2, 0.9, sit));
      add(w, wrist, F, P, cdir(s * 0.5, 0, -1), 'relaxed');
    }
    // desk: hands resting on the desk top (world y 0.75) in front
    if (wts.desk) {
      const deskY = 0.75 - S.position[1] + 0.028;
      const fwd = cdir(0, 0, 1); fwd.y = 0; fwd.normalize();
      const side = v3(1, 0, 0).applyQuaternion(qAxis(0, 1, 0, Math.atan2(fwd.x, fwd.z)));
      const typ = Math.sin(t * 9.5 + s * 1.3 + seed) * 0.004 * E;
      const wrist = v3(W.chest.p.x, deskY + typ, W.chest.p.z).addScaledVector(fwd, 0.44).addScaledVector(side, s * 0.15);
      add(wts.desk, wrist, fwd.clone().add(v3(0, -0.12, 0)).addScaledVector(side, -s * 0.2), v3(0, -1, 0).addScaledVector(side, -s * 0.15), v3(s * 0.8, -0.3, -0.5), 'type');
    }
    // lean: both hands planted on the desk, taking weight
    if (wts.lean) {
      const deskY = 0.75 - S.position[1] + 0.03;
      const fwd = cdir(0, 0, 1); fwd.y = 0; fwd.normalize();
      const side = v3(1, 0, 0).applyQuaternion(qAxis(0, 1, 0, Math.atan2(fwd.x, fwd.z)));
      const reach = Math.min(armLen * 0.97, Math.hypot(shoulder.y - deskY, 0.001));
      const horiz = Math.sqrt(Math.max(0.01, (armLen * 0.97) ** 2 - (shoulder.y - deskY) ** 2)) * 0.8;
      void reach;
      const wrist = v3(shoulder.x, deskY, shoulder.z).addScaledVector(fwd, Math.min(0.5, horiz)).addScaledVector(side, s * 0.05);
      add(wts.lean, wrist, fwd.clone().addScaledVector(side, -s * 0.35), v3(0, -1, 0), v3(s * 1, 0, -0.7), 'flat');
    }
    // over the eyes: forearm across the face (asleep)
    if (wts.overEyes) {
      const wrist = hl(-s * 0.072, 0.012, 0.115);
      add(wts.overEyes, wrist, hdir(-s * 1, 0.25, 0.1), hdir(0, 0.35, 1), hdir(s * 1, -0.4, 0.5), 'relaxed');
    }
    // point at a world target with the index finger
    if (wts.point) {
      const tgt = S.pointAt ? toChar(S.pointAt) : cpt(0, 0.1, 2);
      const dir = tgt.clone().sub(shoulder).normalize();
      const wrist = shoulder.clone().addScaledVector(dir, armLen * 0.9);
      const Pp = v3(0, -1, 0).addScaledVector(dir, dir.y).normalize().addScaledVector(v3(-s, 0, 0), 0.35);
      add(wts.point, wrist, dir.clone(), Pp, v3(s * 0.7, -1, -0.3), 'point');
    }
    // reach a key / object
    if (wts.reach) {
      const tgt = S.reachAt ? toChar(S.reachAt) : cpt(s * 0.15, -0.3, 0.5);
      const d = tgt.clone().sub(shoulder);
      const len = Math.min(d.length(), armLen * 0.97);
      const dir = d.normalize();
      const wrist = shoulder.clone().addScaledVector(dir, len).add(v3(0, 0.035, 0)).addScaledVector(dir, -0.07);
      add(wts.reach, wrist, dir.clone().add(v3(0, -0.5, 0)), v3(0, -1, 0).addScaledVector(dir, 0.2), v3(s * 0.8, -0.6, -0.4), 'press');
    }
    // gesture: open-palm explaining beat
    if (wts.gesture) {
      const g = S.gesturePhase * TAU;
      const base = cpt(s * 0.19, -0.17, 0.3);
      base.add(coff(s * 0.035 * Math.sin(g), 0.045 * Math.cos(g) + 0.02, 0.03 * Math.sin(g + 0.8)));
      add(wts.gesture, base, cdir(s * 0.35, 0.25 + 0.15 * Math.sin(g), 1), cdir(-s * 0.35, 1, 0.15 * Math.cos(g)), cdir(s * 0.8, -1, -0.2), 'open');
    }
    // beat: quick emphatic downward chop, slow recovery
    if (wts.beat) {
      const g = ((S.gesturePhase % 1) + 1) % 1;
      const down = g < 0.22 ? Math.sin((g / 0.22) * Math.PI * 0.5) : Math.cos(((g - 0.22) / 0.78) * Math.PI * 0.5);
      const base = cpt(s * 0.17, -0.1 - 0.1 * down, 0.3 + 0.02 * down);
      add(wts.beat, base, cdir(s * 0.2, 0.1 - 0.35 * down, 1), cdir(-s * 1, 0.2, 0), cdir(s * 0.8, -1, -0.3), 'flat');
    }
    // raise: hand up, palm out
    if (wts.raise) {
      const wrist = shoulder.clone().add(coff(s * 0.16, 0.34, 0.12));
      add(wts.raise, wrist, cdir(s * 0.1, 1, 0.05), cdir(0, 0.05, 1), cdir(s * 1, -0.6, -0.3), 'open');
    }
    // wave: raise + side-to-side
    if (wts.wave) {
      const g = t * TAU * 1.6;
      const wrist = shoulder.clone().add(coff(s * (0.22 + 0.05 * Math.sin(g)), 0.3, 0.1));
      add(wts.wave, wrist, cdir(s * (0.1 + 0.5 * Math.sin(g)), 1, 0.05), cdir(0, 0.05, 1), cdir(s * 1, -0.6, -0.3), 'open');
    }
    // pocket: Sam's kangaroo pocket / Maya's cardigan pockets
    if (wts.pocket) {
      const kang = id === 'sam';
      const hipsP = hipsW.p;
      const hq2 = hipsW.q;
      const wrist = kang ? v3(s * 0.035, 0.1, 0.12).applyQuaternion(hq2).add(hipsP) : v3(s * 0.13, 0.02, 0.1).applyQuaternion(hq2).add(hipsP);
      const F = kang ? v3(-s * 0.9, -0.3, 0.1) : v3(-s * 0.2, -0.9, 0.2);
      const P = kang ? v3(0, 0, -1) : v3(-s, 0, -0.1);
      add(wts.pocket, wrist, F.applyQuaternion(hq2), P.applyQuaternion(hq2), cdir(s * 1, -0.4, -0.5), 'loose');
    }
    // chin: hand to chin, thinking
    if (wts.chin) {
      const wrist = hl(s * 0.018, -0.155, 0.075);
      add(wts.chin, wrist, hdir(-s * 0.15, 1, 0.25), hdir(-s * 0.2, 0.1, -1), cdir(s * 0.3, -1, 0.3), 'loose');
    }
    // shrug: palms up, forearms out
    if (wts.shrug) {
      const wrist = shoulder.clone().add(coff(s * 0.2, -0.24, 0.2));
      add(wts.shrug, wrist, cdir(s * 0.6, 0.05, 1), cdir(-s * 0.2, 1, 0), cdir(s * 0.3, -1, -0.4), 'open');
    }
    // hands on hips
    if (wts.hips) {
      const wrist = v3(s * 0.155, 0.09, -0.005).applyQuaternion(hipsW.q).add(hipsW.p);
      add(wts.hips, wrist, v3(-s * 0.35, -0.55, 0.75).applyQuaternion(hipsW.q), v3(-s * 1, 0, 0.05).applyQuaternion(hipsW.q), cdir(s * 1, 0, -0.25), 'flat');
    }
    // arms folded
    if (wts.cross) {
      const wrist = cpt(-s * 0.1, 0.0, 0.14 + (s > 0 ? 0.025 : 0));
      add(wts.cross, wrist, cdir(-s * 1, 0.15, -0.1), cdir(0, 0.1, -1), cdir(s * 0.6, -1, 0.3), 'grip');
    }
    // scratch the back of the head
    if (wts.scratch) {
      const sc = Math.sin(t * TAU * 3.2) * 0.008;
      const wrist = hl(s * 0.06 + sc, 0.075, -0.07);
      add(wts.scratch, wrist, hdir(-s * 0.35, 0.35, -1), hdir(-s * 0.6, -0.4, 0.6), cdir(s * 1, 0.3, 0.4), 'loose');
    }
    // startle: hands jerk up toward the chest
    if (S.startle > 0) {
      for (const c of cands) c.wrist.lerp(cpt(s * 0.14, -0.05, 0.22), 0.6 * S.startle);
    }
    // --- blend the candidates
    let wsum = 0;
    const wrist = v3(), F = v3(), P = v3(), pole = v3();
    const curls = [0, 0, 0, 0], th = [0, 0]; let sp = 0;
    for (const c of cands) {
      wsum += c.w;
      wrist.addScaledVector(c.wrist, c.w);
      F.addScaledVector(c.F, c.w); P.addScaledVector(c.P, c.w); pole.addScaledVector(c.pole, c.w);
      const hs = HANDS[c.hand];
      for (let i = 0; i < 4; i++) curls[i] += hs.c[i] * c.w;
      th[0] += hs.th[0] * c.w; th[1] += hs.th[1] * c.w; sp += hs.sp * c.w;
    }
    wrist.multiplyScalar(1 / wsum); pole.normalize();
    for (let i = 0; i < 4; i++) curls[i] /= wsum; th[0] /= wsum; th[1] /= wsum; sp /= wsum;
    // idle finger fidget
    const fid = wiggle(t, seed + 21 + s, 0.8) * 0.08 * E;
    for (let i = 0; i < 4; i++) curls[i] = clamp(curls[i] + fid * (0.5 + i * 0.2) - 0.25 * S.startle);
    // --- two-bone IK
    const a = B.upper, b = B.fore;
    const toW = wrist.clone().sub(shoulder);
    let dist = toW.length();
    const dmax = (a + b) * 0.999, dmin = Math.abs(a - b) + 0.02;
    const dc = clamp(dist, dmin, dmax);
    const u = toW.normalize();
    const pOrth = pole.clone().addScaledVector(u, -pole.dot(u));
    if (pOrth.lengthSq() < 1e-6) pOrth.set(0, 0, -1);
    pOrth.normalize();
    const cosA = clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const elbow = shoulder.clone().addScaledVector(u, a * cosA).addScaledVector(pOrth, a * sinA);
    const wristP = shoulder.clone().addScaledVector(u, dc);
    const n = new THREE.Vector3().crossVectors(u, pOrth).normalize();
    const armDir = J['armDir' + k];
    const nBind = new THREE.Vector3().crossVectors(armDir, v3(0, 0, -1)).normalize();
    const upperDir = elbow.clone().sub(shoulder).normalize();
    const foreDir = wristP.clone().sub(elbow).normalize();
    setWorldQ('upper' + k, frameQuat(armDir, nBind, upperDir, n));
    setWorldQ('fore' + k, frameQuat(armDir, nBind, foreDir, n));
    // hand orientation from F/P, bind hand frame: F=armDir, P=palm normal of the layout
    const Fh = F.normalize(); const Ph = P.clone().addScaledVector(Fh, -P.dot(Fh)).normalize();
    const hb = ctx.handBind[k];
    const handQ = frameQuat(hb.F, hb.P, Fh, Ph);
    // distribute forearm twist: the twist bone takes part of the hand's roll
    const foreQ = W['fore' + k].q;
    const rel = foreQ.clone().invert().multiply(handQ);
    const axisL = armDir.clone(); // forearm bind axis in its own (bind-aligned) frame
    const twistQ = swingTwistTwist(rel, axisL);
    const twistPart = new THREE.Quaternion().slerp(twistQ, 0.55);
    setLocal('twist' + k, twistPart);
    setWorldQ('hand' + k, handQ);
    // fingers
    const hl2 = ctx.handBind[k];
    FINGER_NAMES.forEach((fn, i) => {
      const c = curls[i];
      const spreadA = (i - 1.5) * sp * 0.12 * -s;
      const ax = hl2.T; // flexion axis: bending the finger toward the palm
      const flexSign = hl2.flexSign;
      const a0 = (0.12 + c * 1.35) * flexSign, a1 = (0.15 + c * 1.55) * flexSign, a2 = (0.1 + c * 0.95) * flexSign;
      setLocal(fn + 0 + k, qAxis(ax.x, ax.y, ax.z, a0).multiply(qAxis(hl2.P.x, hl2.P.y, hl2.P.z, spreadA)));
      setLocal(fn + 1 + k, qAxis(ax.x, ax.y, ax.z, a1));
      setLocal(fn + 2 + k, qAxis(ax.x, ax.y, ax.z, a2));
    });
    {
      const ax = hl2.thumbAxis, ax2 = hl2.P;
      const tc = th[0], tx = th[1];
      setLocal('thumb0' + k, qAxis(ax2.x, ax2.y, ax2.z, -s * tx * 0.5).multiply(qAxis(ax.x, ax.y, ax.z, tc * 0.35 * hl2.flexSign)));
      setLocal('thumb1' + k, qAxis(ax.x, ax.y, ax.z, (0.1 + tc * 0.7) * hl2.flexSign));
      setLocal('thumb2' + k, qAxis(ax.x, ax.y, ax.z, (0.1 + tc * 0.8) * hl2.flexSign));
    }
    out.hands[k] = { wrist: W['hand' + k].p.clone(), elbow, reach: dist / (a + b) };
  }

  // ---------------------------------------------------------------- legs
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const hipJ = bones['thigh' + k].userData.bindLocal.clone().applyQuaternion(hipsW.q).add(hipsW.p);
    const g = gait(s);
    // standing foot: under the hip, toes slightly out
    const standFoot = v3(s * (B.ankle[0] + 0.012), B.ankle[1], B.ankle[2] + 0.005);
    const walkFoot = v3(s * (B.ankle[0] - 0.012), B.ankle[1] + g.y, B.ankle[2] + g.z);
    // seated foot: planted in front of the seat; reclined: stretched out
    const seatFoot = v3(s * 0.115, B.ankle[1], 0.2 + 0.26 * rec);
    let foot = standFoot.clone().lerp(walkFoot, wa);
    foot.lerp(seatFoot, sstep(0.05, 0.85, sit));
    const legLen = BODY[id].hip[1] - BODY[id].ankle[1];
    const thighL = bones['shin' + k].userData.bindLocal.length(), shinL = bones['foot' + k].userData.bindLocal.length();
    void legLen;
    const toF = foot.clone().sub(hipJ);
    const dist = toF.length();
    const dc = clamp(dist, 0.1, (thighL + shinL) * 0.999);
    const u = toF.normalize();
    // knee pole: forward (+ follows the pelvis yaw), up when seated
    const pole = v3(s * 0.08, 0.3 * sit, 1).applyQuaternion(qAxis(0, 1, 0, pelvisYawW * 0.5)).normalize();
    const pOrth = pole.addScaledVector(u, -pole.dot(u)).normalize();
    const cosA = clamp((thighL * thighL + dc * dc - shinL * shinL) / (2 * thighL * dc), -1, 1);
    const knee = hipJ.clone().addScaledVector(u, thighL * cosA).addScaledVector(pOrth, thighL * Math.sqrt(1 - cosA * cosA));
    const ankle = hipJ.clone().addScaledVector(u, dc);
    const bindThighDir = J['shin' + k].clone().sub(J['thigh' + k]).normalize();
    const bindShinDir = J['foot' + k].clone().sub(J['shin' + k]).normalize();
    const nBind = new THREE.Vector3().crossVectors(bindThighDir, v3(0, 0, 1)).normalize();
    const n = new THREE.Vector3().crossVectors(u, pOrth).normalize();
    setWorldQ('thigh' + k, frameQuat(bindThighDir, nBind, knee.clone().sub(hipJ).normalize(), n));
    setWorldQ('shin' + k, frameQuat(bindShinDir, nBind, ankle.clone().sub(knee).normalize(), n));
    // foot: flat, yawed with the root (+ slight toe-out), pitched by the gait
    const fp = g.pitch * wa;
    const footYaw = s * 0.12 * (1 - wa * 0.5) + (sit > 0.5 ? s * 0.1 : 0);
    setWorldQ('foot' + k, qEuler(-fp, footYaw, 0));
    setLocal('toe' + k, qEuler(g.toe * wa, 0, 0));
    out['foot' + k] = ankle;
  }

  out.W = W; out.L = L;
  out.rootQ = rootQ; out.rootP = rootP;
  out.look = look;
  return out;
}

function normWeights(d) {
  const w = {};
  let sum = 0;
  for (const k of ARM_POSES) { const v = Math.max(0, d[k] || 0); if (v > 0) { w[k] = v; sum += v; } }
  if (sum < 1) { w.rest = (w.rest || 0) + (1 - sum); sum = 1; }
  for (const k in w) w[k] /= sum;
  return w;
}

/** rotation taking frame (d0, n0) to (d1, n1) */
export function frameQuat(d0, n0, d1, n1) {
  const b0 = new THREE.Vector3().crossVectors(d0, n0).normalize();
  const nn0 = new THREE.Vector3().crossVectors(b0, d0).normalize();
  const b1 = new THREE.Vector3().crossVectors(d1, n1).normalize();
  const nn1 = new THREE.Vector3().crossVectors(b1, d1).normalize();
  const m0 = new THREE.Matrix4().makeBasis(d0, nn0, b0);
  const m1 = new THREE.Matrix4().makeBasis(d1, nn1, b1);
  const m = m1.multiply(m0.transpose());
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function swingTwistTwist(q, axis) {
  const r = new THREE.Vector3(q.x, q.y, q.z);
  const p = axis.clone().multiplyScalar(r.dot(axis));
  const tw = new THREE.Quaternion(p.x, p.y, p.z, q.w);
  if (tw.lengthSq() < 1e-9) return new THREE.Quaternion();
  return tw.normalize();
}

/** write the solved local transforms into the bones */
export function applyPose(pose, rig) {
  for (const name in pose.L) {
    const b = rig.bones[name];
    b.quaternion.copy(pose.L[name].q);
    b.position.copy(pose.L[name].p);
  }
}
