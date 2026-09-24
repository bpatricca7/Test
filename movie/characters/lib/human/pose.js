// Pose solver: state -> bone rotations, in character space (root at the
// origin, facing +Z). A pure function of (state, fx): `fx` carries the
// time-filtered channels that motion.js derives from sampled past (and
// near-future) states: the lagging head turn, the hand-target springs, the
// torso's reaction to starts and stops, world-locked footprints, the startle
// profile and the direction of a sit/stand transition. Without fx the solver
// falls back to the analytic versions of all of these.
//
// Idle life is layered smooth noise (noise.js), never plain sines.

import * as THREE from 'three';
import { BODY, FINGER_NAMES } from './rig.js';
import { fbm, events, breathShape } from './noise.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const qAxis = (ax, ay, az, a) => new THREE.Quaternion().setFromAxisAngle(v3(ax, ay, az).normalize(), a);
const qEuler = (x, y, z, order = 'YXZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));

/** smooth deterministic wiggle, roughly -1..1 (layered gradient noise) */
export function wiggle(t, seed, speed = 1) { return fbm(t, Math.floor(seed * 7.13) + 3, 0.32 * speed, 3); }

export const ARM_POSES = ['rest', 'desk', 'overEyes', 'point', 'gesture', 'raise', 'pocket', 'chin', 'shrug', 'hips', 'cross', 'reach', 'wave', 'lean', 'scratch', 'beat'];

// finger curls [index, middle, ring, pinky], thumb [curl, across], spread
const HANDS = {
  relaxed: { c: [0.24, 0.36, 0.44, 0.52], th: [0.2, 0.15], sp: 0.06 },
  flat: { c: [0.08, 0.1, 0.12, 0.15], th: [0.05, 0.0], sp: 0.12 },
  open: { c: [0.05, 0.08, 0.12, 0.16], th: [0.0, -0.1], sp: 0.35 },
  point: { c: [0.0, 0.95, 1.0, 1.0], th: [0.55, 0.55], sp: 0.0 },
  fist: { c: [0.95, 1.0, 1.0, 1.0], th: [0.7, 0.6], sp: 0.0 },
  loose: { c: [0.5, 0.62, 0.72, 0.8], th: [0.4, 0.35], sp: 0.02 },
  press: { c: [0.05, 0.6, 0.7, 0.75], th: [0.35, 0.3], sp: 0.05 },
  type: { c: [0.32, 0.4, 0.44, 0.5], th: [0.25, 0.1], sp: 0.1 },
  grip: { c: [0.48, 0.52, 0.56, 0.6], th: [0.35, 0.25], sp: 0.04 },
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
    speechEnergy: st.speechEnergy ?? null,
  };
  return S;
}

// ------------------------------------------------------------ idle life ---
/**
 * Layered-noise idle: weight shifts between the feet (slow, with plateaus),
 * breathing (varying depth and rate; a fast shallow rhythm crossfades in with
 * fear), occasional posture resets.
 */
export function idleLife(t, seed, E, fear = 0) {
  const w = Math.tanh(4.2 * fbm(t, seed + 1, 0.065, 2));
  const sway = fbm(t, seed + 2, 0.28, 3);
  const ph1 = 0.235 * t + 0.9 * fbm(t, seed + 4, 0.022, 2);
  const depth = 0.8 + 0.28 * fbm(t, seed + 5, 0.07, 2);
  const ph2 = 0.62 * t + 0.35 * fbm(t, seed + 6, 0.05, 2);
  const f = clamp(fear);
  const breath = mix(breathShape(ph1) * depth, 0.4 + 0.45 * breathShape(ph2), f);
  const amp = (0.45 + 0.55 * E) * (1 + 0.5 * f);
  let straighten = 0, shoulder = 0, headAdj = 0;
  for (const ev of events(t, seed + 9, 8.5, 2.4)) {
    const env = sstep(0, 0.4, ev.tau) * (1 - sstep(0.8, 2.4, ev.tau));
    straighten += env * (0.4 + 0.6 * ev.r(0));
    shoulder += env * (ev.r(1) - 0.3);
    headAdj += env * (ev.r(2) - 0.5);
  }
  return { w, sway, breath, bc: (breath - 0.5) * amp, amp, straighten, shoulder, headAdj };
}

// ---------------------------------------------------------------- gait ---
export const STANCE = 0.62;
const HEEL_Z = -0.055, BALL_Z = 0.08;
/** ankle offset (dy, dz) from its rest spot above the footprint for foot pitch
 *  phi (+ heel up, rolling over the ball; - toes up, rocking on the heel) */
export function pivotAnkle(phi, ankleH) {
  const c = Math.cos(phi), s = Math.sin(phi);
  if (phi >= 0) {
    const y = ankleH * c + BALL_Z * s, z = ankleH * s - BALL_Z * c;
    return [y - ankleH, BALL_Z + z];
  }
  const y = ankleH * c + HEEL_Z * s, z = ankleH * s - HEEL_Z * c;
  return [y - ankleH, HEEL_Z + z];
}
// gait keyframes over the foot's cycle u (0 = heel strike, STANCE = toe-off),
// interpolated with a cyclic Catmull-Rom so velocities stay continuous
const PITCH_K = [[0, -0.26], [0.09, -0.02], [0.16, 0], [0.34, 0], [0.46, 0.1], [0.56, 0.36], [0.62, 0.6], [0.67, 0.66], [0.74, 0.42], [0.82, 0.12], [0.9, -0.04], [0.96, -0.2]];
const LIFT_K = [[0, 0], [0.56, 0], [0.62, 0.002], [0.67, 0.02], [0.73, 0.045], [0.8, 0.052], [0.87, 0.04], [0.94, 0.014], [0.985, 0.002]];
const TOE_K = [[0, 0], [0.4, 0], [0.5, -0.12], [0.56, -0.36], [0.62, -0.6], [0.67, -0.5], [0.74, -0.18], [0.82, 0], [0.95, 0.04]];
function cyc(K, u) {
  const n = K.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (K[k][0] <= u) i = k;
  const at = j => { const m = ((j % n) + n) % n; const wrap = Math.floor(j / n); return [K[m][0] + wrap, K[m][1]]; };
  const p1 = at(i), p2 = at(i + 1), p0 = at(i - 1), p3 = at(i + 2);
  const uu = u < p1[0] ? u + 1 : u;
  const f = clamp((uu - p1[0]) / Math.max(1e-6, p2[0] - p1[0]));
  const d1 = (p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0]) * (p2[0] - p1[0]);
  const d2 = (p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0]) * (p2[0] - p1[0]);
  const f2 = f * f, f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * p1[1] + (f3 - 2 * f2 + f) * d1 + (-2 * f3 + 3 * f2) * p2[1] + (f3 - f2) * d2;
}
/** foot profile at gait fraction u (0 = heel strike): stance roll, swing arc, toe bend */
export function footProfile(u, stride, amt) {
  const sc = Math.min(1.4, stride / 0.34);
  const pitch = cyc(PITCH_K, u) * amt, toe = cyc(TOE_K, u) * amt;
  const lift = Math.max(0, cyc(LIFT_K, u)) * sc * amt * (u >= STANCE ? 1 : 0);
  if (u < STANCE) {
    const s = u / STANCE;
    return { stance: true, s, printZ: mix(0.62, -0.62, s) * stride, pitch, lift: 0, toe };
  }
  const sp = (u - STANCE) / (1 - STANCE);
  return { stance: false, s: sp, printZ: mix(-0.62, 0.62, sstep(0, 1, sp)) * stride, pitch, lift, toe };
}
/** gait fraction of one foot (0 = its heel strike) */
export const gaitU = (phase, side) => { const p0 = side > 0 ? 0.25 : 0.75; return (((phase - p0) % 1) + 1) % 1; };

/** standing footprint (char space) with the idle weight shift: {x, z, yaw, pitch} */
function standPrint(id, side, life, idleAmt) {
  const B = BODY[id];
  const unw = clamp(-side * life.w) * idleAmt; // this foot is unweighted
  return { x: side * (B.ankle[0] + 0.012 + 0.014 * unw), z: B.ankle[2] + 0.005 + 0.04 * unw, yaw: side * (0.12 + 0.08 * unw), pitch: 0.16 * unw };
}
/**
 * Where a foot's print is (char space) for state S at gait fraction uRef
 * (stance only), blending standing and walking by the walk amount.
 */
export function footprintAt(S, ctx, side, uRef) {
  const B = BODY[ctx.id];
  const E = S.energy;
  const idleAmt = (1 - S.sit) * (1 - S.walk.amount) * (0.35 + 0.65 * E);
  const life = idleLife(S.t, ctx.seed, E, 0);
  const sp = standPrint(ctx.id, side, life, idleAmt);
  const wa = S.walk.amount;
  const f = footProfile(uRef, S.walk.stride, 1);
  const wx = side * (B.ankle[0] - 0.012), wz = B.ankle[2] + f.printZ;
  return { x: mix(sp.x, wx, wa), z: mix(sp.z, wz, wa), yaw: mix(sp.yaw, side * 0.06, wa) };
}

/**
 * Solve the skeleton for a state. Writes bone local transforms and returns
 * character-space world data for the head, eyes, hands etc.
 * fx.mode: 'full' (default) | 'raw' (torso, head, hand targets; no IK) | 'anchor' (torso and head only)
 */
export function solvePose(S, ctx, fx = {}) {
  const { id, rig } = ctx;
  const mode = fx.mode || 'full';
  const B = BODY[id];
  const J = rig.J, bones = rig.bones;
  const t = S.t, E = S.energy;
  const seed = ctx.seed;
  const rootQ = qAxis(0, 1, 0, S.yaw);
  const rootP = v3(...S.position);
  const rootQi = rootQ.clone().invert();
  const toChar = w => v3(w[0], w[1], w[2]).sub(rootP).applyQuaternion(rootQi);

  const W = {}; // character-space world transforms: {p, q}
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
  const out = { hands: {}, wT: {}, look: null, gaze: null };

  // ------------------------------------------------------------ channels
  const st = fx.startle || { body: S.startle, arms: S.startle, tremor: 0, face: S.startle };
  const fear = fx.fear ?? st.body;
  const life = idleLife(t, seed, E, fear);

  // ---------------------------------------------------------------- walk
  const wk = S.walk, wa = wk.amount, ph = wk.phase;
  const stepVar = 1 + 0.12 * fbm(t, seed + 41, 0.7, 2); // stride-to-stride variation
  const bob = -Math.cos(4 * Math.PI * (ph - 0.25 - 0.03)); // low just after each heel strike
  const swayX = Math.sin(TAU * (ph - 0.25));
  const pelvisYawW = -0.12 * Math.cos(TAU * (ph - 0.25)) * wa * stepVar;
  const hipDrop = 0.055 * Math.sin(TAU * (ph - 0.25)) * wa * stepVar; // swing side drops

  // --------------------------------------------------------------- pelvis
  const sit = S.sit, rec = S.recline * sit;
  const recH = fx.recHead ?? rec; // the head lags the shoulders out of a recline
  const hipsBind = J.hips;
  const standH = hipsBind.y - 0.008;
  const seatHipY = S.seatHeight + (B.hip[1] > 0.9 ? 0.095 : 0.088) + (hipsBind.y - B.hip[1]);
  const seatHipZ = -0.13;
  const sitDir = fx.sitDir || 0;
  let hipY, hipZ, riseLean, pushW = 0;
  if (sitDir < 0 && sit > 0 && sit < 1) {
    // standing up: lean over the feet first, push up, then straighten
    const q = 1 - sit;
    hipY = mix(seatHipY, standH, sstep(0.22, 0.97, q));
    hipZ = mix(seatHipZ, hipsBind.z, sstep(0.04, 0.8, q)) + 0.045 * Math.sin(Math.PI * clamp(q / 0.9));
    const wq = q < 0.32 ? 0.5 * q / 0.32 : 0.5 + 0.5 * (q - 0.32) / 0.68;
    riseLean = 0.72 * Math.sin(Math.PI * wq);
    pushW = q < 0.62 ? Math.sin(Math.PI * q / 0.62) ** 2 : 0;
  } else if (sitDir > 0 && sit > 0 && sit < 1) {
    // sitting down: hips reach back, a controlled lowering, lean to balance
    const q = sit;
    hipY = mix(standH, seatHipY, sstep(0.1, 1.0, q));
    hipZ = mix(hipsBind.z, seatHipZ, sstep(0.0, 0.55, q)) - 0.035 * Math.sin(Math.PI * q);
    riseLean = 0.5 * Math.sin(Math.PI * q);
  } else {
    hipY = mix(standH, seatHipY, sstep(0, 1, sit));
    hipZ = mix(hipsBind.z, seatHipZ, sstep(0, 1, sit)) - 0.06 * Math.sin(Math.PI * sit);
    riseLean = 0.5 * Math.sin(Math.PI * sit);
  }
  const hipsPos = v3(0, hipY, hipZ);
  hipsPos.z += 0.13 * rec; hipsPos.y -= 0.035 * rec;
  hipsPos.y += (0.017 * bob - 0.013) * wa * stepVar;
  hipsPos.x += 0.022 * swayX * wa;
  const idleAmt = (1 - sit) * (1 - wa) * (0.35 + 0.65 * E);
  hipsPos.x += (0.04 * life.w + 0.006 * life.sway) * idleAmt;
  hipsPos.y -= 0.008 * Math.abs(life.w) * idleAmt;
  hipsPos.y -= 0.032 * st.body * (1 - sit);
  hipsPos.y -= fx.dip || 0;
  if (fx.rootLag) { const lx = clamp(fx.rootLag.x, -0.08, 0.08), lz = clamp(fx.rootLag.z, -0.08, 0.08); hipsPos.x += lx; hipsPos.z += lz; hipsPos.y -= 0.25 * Math.hypot(lx, lz); }
  const pelvisTilt = 0.18 * sit + 0.25 * rec - 0.02 * wa;
  const pelvisRoll = hipDrop + 0.075 * life.w * idleAmt;
  setLocal('root', new THREE.Quaternion());
  setLocal('hips', qEuler(-pelvisTilt, pelvisYawW, pelvisRoll), hipsPos.clone().sub(hipsBind));

  // --------------------------------------------------------------- spine
  const bc = life.bc;
  const trem = st.tremor || 0;
  const tr = k => trem * fbm(t, seed + 60 + k, 9.5, 2);
  const seatedIdle = sit * (1 - rec) * (0.3 + 0.7 * E);
  const leanF = S.lean * (S.lean > 0 ? 0.95 : 0.4) + riseLean + 0.06 * wa + 0.12 * sit - 0.02 + (fx.lean || 0)
    - 0.04 * life.straighten * (idleAmt + seatedIdle) + 0.012 * fbm(t, seed + 12, 0.15, 2) * seatedIdle;
  const reclineBack = -0.42 * rec;
  const tw = S.twist;
  const walkCounter = -pelvisYawW * 1.35;
  const idleSway = life.sway * 0.012 * idleAmt;
  const startleBack = -0.14 * st.body;
  const contra = -0.075 * life.w * idleAmt; // shoulders tilt against the hips
  const spineRoll = idleSway - hipDrop * 0.6 + contra * 0.9 + 0.02 * tr(1);
  const chestRoll = idleSway * 0.6 - hipDrop * 0.3 + contra * 0.6 + 0.02 * tr(2);
  setLocal('spine', qEuler(leanF * 0.38 + reclineBack * 0.45 + pelvisTilt * 0.55 + startleBack * 0.3 + 0.03 * tr(3), tw * 0.3 + walkCounter * 0.4, spineRoll));
  setLocal('hem', new THREE.Quaternion());
  setLocal('chest', qEuler(leanF * 0.42 + reclineBack * 0.4 + pelvisTilt * 0.2 - 0.03 * bc + startleBack * 0.5, tw * 0.45 + walkCounter * 0.6, chestRoll),
    v3(0, 0.004 * bc, 0.002 * bc));

  // ---------------------------------------------------------- head, gaze
  const hs = fx.head || S.head;
  let hy = hs.yaw, hp = hs.pitch, hr = hs.roll;
  // director nods / shakes, with a drifting rate so they never read as metronomic
  hy += S.shake * 0.22 * Math.sin(TAU * (2.2 * t + 0.2 * fbm(t, seed + 31, 0.4, 2)));
  hp += S.nod * 0.14 * Math.sin(TAU * (2.0 * t + 0.2 * fbm(t, seed + 32, 0.4, 2)));
  const microA = (0.25 + 0.75 * E) * (1 - 0.8 * rec);
  hy += fbm(t, seed + 5, 0.42, 3) * 0.024 * microA + 0.035 * life.headAdj * idleAmt;
  hp += fbm(t, seed + 7, 0.38, 3) * 0.02 * microA + 0.012 * bc;
  hr += fbm(t, seed + 9, 0.3, 3) * 0.018 * microA;
  // walking: the head stays stabilised (counter the torso's gait yaw and roll)
  hy += 0.35 * pelvisYawW * 0.9;
  hr -= 0.75 * (pelvisRoll + spineRoll + chestRoll) * (wa + idleAmt);
  hp -= 0.03 * wa;
  hp += -0.1 * recH; hr += 0.22 * recH;
  hp += -0.2 * st.body + 0.04 * tr(4); hy += 0.04 * tr(5);
  hp += fx.emph || 0;
  const eyeMid = v3(0, B.headOrigin[1] - B.headBone[1], B.headOrigin[2] - B.headBone[2] + 0.058);
  const neckPitch = p => p * 0.35 - leanF * 0.25 + 0.226 * recH;
  if (fx.look) {
    hy += fx.look.yaw; hp += fx.look.pitch;
  } else if (S.lookAt) {
    const look = toChar(S.lookAt);
    setLocal('neck', qEuler(neckPitch(hp), hy * 0.35, hr * 0.35));
    const neckW = W.neck;
    const headBaseP = bones.head.userData.bindLocal.clone().applyQuaternion(neckW.q).add(neckW.p);
    const eyeP = eyeMid.clone().applyQuaternion(neckW.q.clone().multiply(qEuler(hp * 0.65, hy * 0.65, hr * 0.65))).add(headBaseP);
    const d = look.clone().sub(eyeP).applyQuaternion(W.chest.q.clone().invert());
    const needYaw = Math.atan2(d.x, d.z);
    const needPitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    const f = clamp(S.headFollow, 0, 1);
    out.gaze = { yaw: needYaw, pitch: needPitch };
    out.look = { yaw: clamp(needYaw * f, -1.1, 1.1), pitch: clamp(needPitch * f, -0.6, 0.6) };
    hy += out.look.yaw; hp += out.look.pitch;
  }
  if (!out.look) out.look = { yaw: 0, pitch: 0 };
  setLocal('neck', qEuler(neckPitch(hp), hy * 0.35, hr * 0.35), v3(0, -0.01 * st.body, 0));
  setLocal('head', qEuler(hp * 0.65 - leanF * 0.12, hy * 0.65, hr * 0.65));
  out.W = W; out.L = L; out.rootQ = rootQ; out.rootP = rootP;
  if (mode === 'anchor') return out;

  // ---------------------------------------------------------------- arms
  const headW = W.head;
  const hq = headW.q;
  const hoff = v3(B.headOrigin[0] - B.headBone[0], B.headOrigin[1] - B.headBone[1], B.headOrigin[2] - B.headBone[2]);
  const hl = (x, y, z) => v3(x, y, z).add(hoff).applyQuaternion(hq).add(headW.p);
  const hdir = (x, y, z) => v3(x, y, z).applyQuaternion(hq).normalize();
  const cq = W.chest.q;
  const cqi = cq.clone().invert();
  const cdir = (x, y, z) => v3(x, y, z).applyQuaternion(cq).normalize();
  const coff = (x, y, z) => v3(x, y, z).applyQuaternion(cq);
  const cpt = (x, y, z) => v3(x, y, z).applyQuaternion(cq).add(W.chest.p);
  const armLen = B.upper + B.fore;
  const hipsW = W.hips;
  const thighL = bones['shinL'].userData.bindLocal.length(), shinL = bones['footL'].userData.bindLocal.length();
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const wts = normWeights(S['arm' + k]);
    const shrugW = wts.shrug || 0;
    const clavUp = 0.02 * bc + 0.2 * shrugW + 0.22 * st.body + 0.05 * (wts.raise || 0) + 0.06 * (wts.wave || 0)
      + 0.05 * (wts.overEyes || 0) - 0.05 * (wts.lean || 0) + 0.03 * life.shoulder * idleAmt + 0.03 * tr(6 + s);
    const clavFwd = 0.08 * (wts.cross || 0) + 0.06 * (wts.desk || 0) + 0.1 * (wts.lean || 0) + 0.05 * (wts.point || 0) + 0.06 * (wts.reach || 0)
      - 0.03 * life.straighten * idleAmt + 0.06 * pushW;
    let elev = 0;
    {
      const sh0 = bones['clav' + k].userData.bindLocal.clone().applyQuaternion(W.chest.q).add(W.chest.p);
      const hi = (wts.raise || 0) * 0.9 + (wts.wave || 0) * 0.9 + (wts.scratch || 0) * 0.6 + (wts.overEyes || 0) * 0.45 + (wts.point || 0) * 0.3;
      if (S.pointAt && wts.point) { const d = toChar(S.pointAt).sub(sh0); elev = Math.max(0, Math.atan2(d.y, Math.hypot(d.x, d.z))) * wts.point; }
      elev = Math.max(elev, hi);
    }
    setLocal('clav' + k, qEuler(0, -s * clavFwd, s * (clavUp + 0.28 * elev)));
    const shoulder = bones['upper' + k].userData.bindLocal.clone().applyQuaternion(W['clav' + k].q).add(W['clav' + k].p);
    const cands = [];
    const add = (w, wrist, F, P, pole, hand) => { if (w > 1e-4) cands.push({ w, wrist, F: F.normalize(), P: P.normalize(), pole: pole.normalize(), hand }); };
    // rest: standing hang (swinging from the shoulder when walking) / seated on the thighs / reclined
    {
      let w = wts.rest;
      const swing = wa * 0.95 * stepVar * (s > 0 ? 1 : -1) * Math.cos(TAU * (ph - 0.75 - 0.05));
      const sw = fbm(t, seed + 11 + s, 0.3, 3) * 0.012 * idleAmt;
      const ang = 0.42 * swing;
      const hang = armLen * (0.955 - 0.045 * Math.max(0, swing));
      const dirS = cdir(s * 0.07 + sw, -Math.cos(ang), Math.sin(ang) + 0.045);
      const stand = shoulder.clone().addScaledVector(dirS, hang).add(coff(s * 0.012, 0.0, 0.0));
      const lap = v3(s * 0.12, S.seatHeight + 0.16 + 0.03 * rec, 0.16 - 0.1 * rec);
      const arm = v3(s * 0.23, S.seatHeight + 0.2, 0.02 - 0.05 * rec);
      const seat = lap.lerp(arm, rec * 0.7);
      const ks = sstep(0.2, 0.9, sit);
      const wrist = stand.lerp(seat, ks);
      // sitting down: the hands come forward for balance
      if (sitDir > 0) wrist.add(coff(0, 0.05, 0.1).multiplyScalar(Math.sin(Math.PI * sit)));
      const Fs = cdir(-s * 0.1, -1, 0.06 + 0.35 * swing), Ps = cdir(-s, -0.1, -0.15);
      const Fd = v3(-s * 0.15, -0.35, 1), Pd = v3(-s * 0.2, -1, 0.1);
      const F = Fs.lerp(Fd, ks), P = Ps.lerp(Pd, ks);
      // standing up: hands push off the knees
      if (pushW > 0) {
        const pw = w * pushW; w -= pw;
        const kneeY = seatHipY + 0.06 + 0.5 * (hipsPos.y - seatHipY);
        const knee = v3(s * 0.1, kneeY + 0.035, 0.25 - 0.1 * (1 - sit));
        add(pw, knee, v3(-s * 0.1, -0.5, 1), v3(0, -1, 0.1), cdir(s * 1, -0.2, -0.6), 'flat');
      }
      add(w, wrist, F, P, cdir(s * 0.5, -0.1, -1), 'relaxed');
    }
    if (wts.desk) {
      const deskY = 0.75 - S.position[1] + 0.028;
      const fwd = cdir(0, 0, 1); fwd.y = 0; fwd.normalize();
      const side = v3(1, 0, 0).applyQuaternion(qAxis(0, 1, 0, Math.atan2(fwd.x, fwd.z)));
      const typ = Math.max(0, fbm(t, seed + 70 + s, 4.5, 2)) * 0.008 * E;
      const wrist = v3(W.chest.p.x, deskY + typ, W.chest.p.z).addScaledVector(fwd, 0.44).addScaledVector(side, s * 0.15);
      add(wts.desk, wrist, fwd.clone().add(v3(0, -0.12, 0)).addScaledVector(side, -s * 0.2), v3(0, -1, 0).addScaledVector(side, -s * 0.15), v3(s * 0.8, -0.3, -0.5), 'type');
    }
    if (wts.lean) {
      const deskY = 0.75 - S.position[1] + 0.03;
      const fwd = cdir(0, 0, 1); fwd.y = 0; fwd.normalize();
      const side = v3(1, 0, 0).applyQuaternion(qAxis(0, 1, 0, Math.atan2(fwd.x, fwd.z)));
      const horiz = Math.sqrt(Math.max(0.01, (armLen * 0.97) ** 2 - (shoulder.y - deskY) ** 2)) * 0.8;
      const wrist = v3(shoulder.x, deskY, shoulder.z).addScaledVector(fwd, Math.min(0.5, horiz)).addScaledVector(side, s * 0.05);
      add(wts.lean, wrist, fwd.clone().addScaledVector(side, -s * 0.35), v3(0, -1, 0), v3(s * 1, 0, -0.7), 'flat');
    }
    if (wts.overEyes) {
      const wrist = hl(-s * 0.072, 0.012, 0.115);
      add(wts.overEyes, wrist, hdir(-s * 1, 0.25, 0.1), hdir(0, 0.35, 1), hdir(s * 1, -0.4, 0.5), 'relaxed');
    }
    if (wts.point) {
      const tgt = S.pointAt ? toChar(S.pointAt) : cpt(0, 0.1, 2);
      const dir = tgt.clone().sub(shoulder).normalize();
      const wrist = shoulder.clone().addScaledVector(dir, armLen * 0.9);
      const Pp = v3(0, -1, 0).addScaledVector(dir, dir.y).normalize().addScaledVector(v3(-s, 0, 0), 0.35);
      add(wts.point, wrist, dir.clone(), Pp, v3(s * 0.7, -1, -0.3), 'point');
    }
    if (wts.reach) {
      const tgt = S.reachAt ? toChar(S.reachAt) : cpt(s * 0.15, -0.3, 0.5);
      const d = tgt.clone().sub(shoulder);
      const len = Math.min(d.length(), armLen * 0.97);
      const dir = d.normalize();
      const wrist = shoulder.clone().addScaledVector(dir, len).add(v3(0, 0.035, 0)).addScaledVector(dir, -0.07);
      add(wts.reach, wrist, dir.clone().add(v3(0, -0.5, 0)), v3(0, -1, 0).addScaledVector(dir, 0.2), v3(s * 0.8, -0.6, -0.4), 'press');
    }
    if (wts.gesture) {
      // open-palm explaining: a looping path whose shape drifts (never a clean ellipse)
      const g = S.gesturePhase * TAU;
      const n1 = fbm(S.gesturePhase, seed + 80 + s, 0.7, 2), n2 = fbm(S.gesturePhase, seed + 83 + s, 0.9, 2);
      const base = cpt(s * 0.19, -0.17, 0.3);
      base.add(coff(s * (0.035 * Math.sin(g) + 0.02 * n1), 0.045 * Math.cos(g) + 0.02 + 0.015 * n2, 0.03 * Math.sin(g + 0.8) + 0.015 * n1));
      add(wts.gesture, base, cdir(s * 0.35, 0.25 + 0.15 * Math.sin(g) + 0.1 * n2, 1), cdir(-s * 0.35, 1, 0.15 * Math.cos(g)), cdir(s * 0.8, -1, -0.2), 'open');
    }
    if (wts.beat) {
      const g = ((S.gesturePhase % 1) + 1) % 1;
      const down = g < 0.18 ? Math.sin((g / 0.18) * Math.PI * 0.5) : Math.pow(Math.cos(((g - 0.18) / 0.82) * Math.PI * 0.5), 1.4);
      const base = cpt(s * 0.17, -0.1 - 0.1 * down, 0.3 + 0.02 * down);
      add(wts.beat, base, cdir(s * 0.2, 0.1 - 0.35 * down, 1), cdir(-s * 1, 0.2, 0), cdir(s * 0.8, -1, -0.3), 'flat');
    }
    if (wts.raise) {
      const wrist = shoulder.clone().add(coff(s * 0.16, 0.34, 0.12)).add(coff(0.01 * fbm(t, seed + 90, 0.5), 0.01 * fbm(t, seed + 91, 0.4), 0));
      add(wts.raise, wrist, cdir(s * 0.1, 1, 0.05), cdir(0, 0.05, 1), cdir(s * 1, -0.6, -0.3), 'open');
    }
    if (wts.wave) {
      const gp = t * 1.6 + 0.15 * fbm(t, seed + 92, 0.5, 2);
      const g = gp * TAU;
      const wrist = shoulder.clone().add(coff(s * (0.22 + 0.05 * Math.sin(g)), 0.3, 0.1));
      add(wts.wave, wrist, cdir(s * (0.1 + 0.5 * Math.sin(g - 0.5)), 1, 0.05), cdir(0, 0.05, 1), cdir(s * 1, -0.6, -0.3), 'open');
    }
    if (wts.pocket) {
      const kang = id === 'sam';
      const hq2 = hipsW.q;
      const wrist = kang ? v3(s * 0.035, 0.1, 0.12).applyQuaternion(hq2).add(hipsW.p) : v3(s * 0.13, 0.02, 0.1).applyQuaternion(hq2).add(hipsW.p);
      const F = kang ? v3(-s * 0.9, -0.3, 0.1) : v3(-s * 0.2, -0.9, 0.2);
      const P = kang ? v3(0, 0, -1) : v3(-s, 0, -0.1);
      add(wts.pocket, wrist, F.applyQuaternion(hq2), P.applyQuaternion(hq2), cdir(s * 1, -0.4, -0.5), 'loose');
    }
    if (wts.chin) {
      const wrist = hl(s * 0.018, -0.155, 0.075);
      add(wts.chin, wrist, hdir(-s * 0.15, 1, 0.25), hdir(-s * 0.2, 0.1, -1), cdir(s * 0.3, -1, 0.3), 'loose');
    }
    if (wts.shrug) {
      const wrist = shoulder.clone().add(coff(s * 0.2, -0.24, 0.2));
      add(wts.shrug, wrist, cdir(s * 0.6, 0.05, 1), cdir(-s * 0.2, 1, 0), cdir(s * 0.3, -1, -0.4), 'open');
    }
    if (wts.hips) {
      const wrist = v3(s * 0.155, 0.09, -0.005).applyQuaternion(hipsW.q).add(hipsW.p);
      add(wts.hips, wrist, v3(-s * 0.35, -0.55, 0.75).applyQuaternion(hipsW.q), v3(-s * 1, 0, 0.05).applyQuaternion(hipsW.q), cdir(s * 1, 0, -0.25), 'flat');
    }
    if (wts.cross) {
      const wrist = cpt(-s * 0.1, 0.0, 0.14 + (s > 0 ? 0.025 : 0));
      add(wts.cross, wrist, cdir(-s * 1, 0.15, -0.1), cdir(0, 0.1, -1), cdir(s * 0.6, -1, 0.3), 'grip');
    }
    if (wts.scratch) {
      const sc = fbm(t, seed + 95, 3.2, 2) * 0.01;
      const wrist = hl(s * 0.06 + sc, 0.075, -0.07);
      add(wts.scratch, wrist, hdir(-s * 0.35, 0.35, -1), hdir(-s * 0.6, -0.4, 0.6), cdir(s * 1, 0.3, 0.4), 'loose');
    }
    // startle: the hands jerk up toward the chest (a beat after the shoulders)
    if (st.arms > 0) {
      for (const c of cands) c.wrist.lerp(cpt(s * 0.15, -0.06, 0.24), 0.6 * st.arms);
    }
    // --- blend: directions from the shoulder (natural arcs), distances linearly
    let wsum = 0;
    const dsum = v3(), F = v3(), P = v3(), pole = v3(), lin = v3();
    let rsum = 0;
    const curls = [0, 0, 0, 0], th = [0, 0]; let sp = 0;
    for (const c of cands) {
      wsum += c.w;
      const d = c.wrist.clone().sub(shoulder);
      const r = d.length();
      dsum.addScaledVector(d.multiplyScalar(1 / Math.max(r, 1e-6)), c.w); rsum += r * c.w;
      lin.addScaledVector(c.wrist, c.w);
      F.addScaledVector(c.F, c.w); P.addScaledVector(c.P, c.w); pole.addScaledVector(c.pole, c.w);
      const hsh = HANDS[c.hand];
      for (let i = 0; i < 4; i++) curls[i] += hsh.c[i] * c.w;
      th[0] += hsh.th[0] * c.w; th[1] += hsh.th[1] * c.w; sp += hsh.sp * c.w;
    }
    lin.multiplyScalar(1 / wsum);
    const dl = dsum.length() / wsum;
    let wrist = dl > 0.35 ? shoulder.clone().addScaledVector(dsum.normalize(), rsum / wsum) : lin;
    pole.normalize();
    for (let i = 0; i < 4; i++) curls[i] /= wsum; th[0] /= wsum; th[1] /= wsum; sp /= wsum;
    // relaxed-finger life: each finger drifts on its own, slowly
    const fl = 0.4 + 0.6 * E;
    for (let i = 0; i < 4; i++) curls[i] = clamp(curls[i] + 0.05 * fl * fbm(t, seed + 21 + i * 3 + (s > 0 ? 0 : 40), 0.22, 2) - 0.3 * st.arms);
    th[0] = clamp(th[0] + 0.05 * fl * fbm(t, seed + 35 + s, 0.18, 2), -0.2, 1);
    sp = Math.max(0, sp + 0.03 * fl * fbm(t, seed + 37 + s, 0.2, 2) + 0.25 * st.arms);
    out.wT[k] = wrist.clone().sub(W.chest.p).applyQuaternion(cqi);
    if (mode === 'raw') continue;
    // filtered hand target (springs over the recent past: arcs, deceleration, a little overshoot)
    if (fx.wrist && fx.wrist[k]) wrist = fx.wrist[k].clone().applyQuaternion(cq).add(W.chest.p);
    // hands trail their motion (wrist drag) and flick through at the end
    if (fx.wristV && fx.wristV[k]) {
      const vW = fx.wristV[k].clone().applyQuaternion(cq);
      const Fn = F.clone().normalize();
      const vp = vW.addScaledVector(Fn, -vW.dot(Fn));
      if (vp.length() > 1.6) vp.setLength(1.6);
      F.copy(Fn).addScaledVector(vp, -0.2);
    }
    // --- two-bone IK
    const a = B.upper, b = B.fore;
    const toW = wrist.clone().sub(shoulder);
    const dist = toW.length();
    const dmax = (a + b) * 0.999, dmin = Math.abs(a - b) + 0.02;
    const dc = clamp(dist, dmin, dmax);
    const u = toW.normalize();
    // elbows hang down and a little out and back
    pole.addScaledVector(v3(s * 0.3, -0.5, -0.25), 0.35).normalize();
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
    setWorldQ('upper' + k, frameQuat(armDir, nBind, elbow.clone().sub(shoulder).normalize(), n));
    setWorldQ('fore' + k, frameQuat(armDir, nBind, wristP.clone().sub(elbow).normalize(), n));
    const Fh = F.normalize(); const Ph = P.clone().addScaledVector(Fh, -P.dot(Fh)).normalize();
    const hb = ctx.handBind[k];
    const handQ = frameQuat(hb.F, hb.P, Fh, Ph);
    const foreQ = W['fore' + k].q;
    const rel = foreQ.clone().invert().multiply(handQ);
    const twistQ = swingTwistTwist(rel, armDir.clone());
    setLocal('twist' + k, new THREE.Quaternion().slerp(twistQ, 0.55));
    setWorldQ('hand' + k, handQ);
    const hl2 = ctx.handBind[k];
    FINGER_NAMES.forEach((fn, i) => {
      const c = curls[i];
      const spreadA = (i - 1.5) * sp * 0.12 * -s;
      const ax = hl2.T;
      const flexSign = hl2.flexSign;
      // distal joints curl a touch more than the knuckle on the outer fingers
      const a0 = (0.12 + c * 1.3) * flexSign, a1 = (0.15 + c * (1.5 + 0.08 * i)) * flexSign, a2 = (0.1 + c * (0.9 + 0.06 * i)) * flexSign;
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
  if (mode === 'raw') return out;

  // ---------------------------------------------------------------- legs
  const ankleH = B.ankle[1];
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const hipJ = bones['thigh' + k].userData.bindLocal.clone().applyQuaternion(hipsW.q).add(hipsW.p);
    // footprint (char space x/z + yaw), foot pitch, swing lift, toe bend
    const sp0 = standPrint(id, s, life, idleAmt);
    let px = sp0.x, pz = sp0.z, pyaw = sp0.yaw, pitch = sp0.pitch, lift = 0, toe = -0.8 * sp0.pitch;
    const lock = fx.feet && fx.feet[k];
    if (lock) {
      const p = toChar([lock.x, 0, lock.z]);
      const lw = lock.w;
      px = mix(px, p.x, lw); pz = mix(pz, p.z, lw); pyaw = mix(pyaw, lock.yaw - S.yaw, lw);
      pitch = mix(pitch, lock.pitch, lw); lift = lock.lift * lw; toe = mix(toe, lock.toe, lw);
    } else if (wa > 0) {
      const f = footProfile(gaitU(ph, s), wk.stride, 1);
      px = mix(px, s * (B.ankle[0] - 0.012), wa); pz = mix(pz, B.ankle[2] + f.printZ, wa); pyaw = mix(pyaw, s * 0.06, wa);
      pitch = mix(pitch, f.pitch, wa); lift = f.lift * wa; toe = mix(toe, f.toe, wa);
    }
    // seated: planted in front of the seat; reclined: stretched out
    const ks = sstep(0.05, 0.85, sit);
    if (ks > 0) {
      px = mix(px, s * 0.115, ks); pz = mix(pz, 0.2 + 0.26 * rec, ks); pyaw = mix(pyaw, s * 0.22, ks);
      pitch *= 1 - ks; lift *= 1 - ks; toe *= 1 - ks;
    }
    const [dy, dz] = pivotAnkle(pitch, ankleH);
    const fq = qAxis(0, 1, 0, pyaw);
    const foot = v3(0, ankleH + dy + lift, dz).applyQuaternion(fq).add(v3(px, 0, pz));
    const toF = foot.clone().sub(hipJ);
    const dist = toF.length();
    const dc = clamp(dist, 0.1, (thighL + shinL) * 0.999);
    const u = toF.normalize();
    const pole = v3(s * 0.08, 0.3 * sit, 1).applyQuaternion(qAxis(0, 1, 0, pelvisYawW * 0.5 + pyaw * 0.6)).normalize();
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
    // the foot: yawed with its print, pitched by the roll (+ = heel up)
    setWorldQ('foot' + k, fq.clone().multiply(qAxis(1, 0, 0, pitch)));
    setLocal('toe' + k, qAxis(1, 0, 0, clamp(toe, -0.7, 0.3)));
    out['foot' + k] = ankle;
  }
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
