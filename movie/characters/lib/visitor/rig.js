// The Visitor: the pose solver. Pure function of the state (plus `past` for
// follow-through), producing joint positions and frames in root-local space
// (root on the floor between the feet, facing +Z, +X is the Visitor's left).

import { euler3 } from './head.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);

// --- tiny vector / matrix helpers (arrays) ---------------------------------
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
// row-major 3x3
export const mmul = (A, B) => [
  A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
  A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
  A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8]];
export const mv = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const mtv = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
const col = (M, c) => [M[c], M[3 + c], M[6 + c]];
const rot = (pitch, yaw, roll) => euler3(yaw, pitch, roll);
function basis(X, Y, Z) { return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]; }
// rotate v about unit axis k by angle a
function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v), x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

// two-bone IK: returns the middle joint
function ik2(A, T, la, lb, pole) {
  let d = sub(T, A);
  let dl = len(d);
  const maxd = la + lb - 1e-4, mind = Math.abs(la - lb) + 0.02;
  const u = mul(d, 1 / (dl || 1));
  dl = clamp(dl, mind, maxd);
  let v = sub(pole, mul(u, dot(pole, u)));
  if (len(v) < 1e-6) v = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  v = norm(v);
  const ca = clamp((la * la + dl * dl - lb * lb) / (2 * la * dl), -1, 1);
  const sa = Math.sqrt(1 - ca * ca);
  return { mid: add(A, add(mul(u, la * ca), mul(v, la * sa))), end: add(A, mul(u, dl)) };
}

// ---------------------------------------------------------------------------
// follow-through: 2nd-order spring responses of signals over the recent past
// ---------------------------------------------------------------------------
const TAUS = [];
for (let k = 0; k <= 15; k++) TAUS.push(k * 0.08);
function kernel(f, z) {
  const w = TAU * f, wd = w * Math.sqrt(1 - z * z);
  const h = TAUS.map(t => Math.exp(-z * w * t) * Math.sin(wd * t + 1e-3));
  // trapezoid weights; normalise to unit DC gain
  const s = h.reduce((a, b, i) => a + b * (i === 0 || i === h.length - 1 ? 0.5 : 1), 0);
  return h.map((x, i) => x * (i === 0 || i === h.length - 1 ? 0.5 : 1) / s);
}
const K_SOFT = kernel(0.85, 0.5), K_WHIP = kernel(1.5, 0.28);

function signals(s) {
  const p = s.position || [0, 0, 0];
  const yaw = s.yaw || 0;
  const la = s.lookAt;
  let ly = 0, lp = 0;
  if (la) {
    const dx = la[0] - p[0], dz = la[2] - p[2];
    ly = Math.atan2(dx, dz) - yaw; ly = Math.atan2(Math.sin(ly), Math.cos(ly));
    lp = -Math.atan2(la[1] - 1.88 * (1 - 0.16 * (s.crouch || 0)), Math.hypot(dx, dz));
  }
  const hf = s.headFollow ?? 0.5;
  const h = s.head || {};
  return [p[0], p[2], yaw, s.crouch || 0, s.raiseHand || 0, s.gesture || 0, s.reach || 0, s.lean || 0,
    (h.yaw || 0) + hf * ly, (h.pitch || 0) + hf * lp, (h.roll || 0) + (s.tilt || 0), (s.walk && s.walk.amount) || 0];
}
const NSIG = 12;

export function followThrough(state) {
  const x = signals(state);
  const out = { soft: x.slice(), whip: x.slice(), x };
  if (typeof state.past !== 'function') return out;
  const ys = new Array(NSIG).fill(0), yw = new Array(NSIG).fill(0);
  for (let k = 0; k < TAUS.length; k++) {
    let sk = x;
    if (k > 0) { try { const ps = state.past(TAUS[k]); if (ps) sk = signals(ps); } catch (e) { sk = x; } }
    // unwrap yaw relative to now
    const dyaw = Math.atan2(Math.sin(sk[2] - x[2]), Math.cos(sk[2] - x[2]));
    for (let i = 0; i < NSIG; i++) {
      const v = i === 2 ? x[2] + dyaw : sk[i];
      ys[i] += K_SOFT[k] * v; yw[i] += K_WHIP[k] * v;
    }
  }
  out.soft = ys; out.whip = yw;
  return out;
}

// ---------------------------------------------------------------------------
// skeleton constants
// ---------------------------------------------------------------------------
export const SK = {
  pelvisY: 0.965,
  spine: [[0, 0.11, 0.004], [0, 0.13, 0.016], [0, 0.125, 0.008], [0, 0.105, -0.012], [0, 0.07, -0.014]],
  neck: [[0, 0.14, 0.006], [0, 0.135, 0.02]],
  headFromAtlas: [0, 0.106, 0.036],
  shoulder: [0.166, 0.018, -0.01], clav: [0.055, 0.036, 0.0],
  upperArm: 0.335, foreArm: 0.325,
  hips: [[0.09, -0.036, 0.004], [-0.09, -0.036, 0.004], [0, -0.062, -0.075]],
  thigh: 0.41, shin: 0.43, meta: 0.245, toe: 0.085,
  feet: [[0.19, 0, 0.1], [-0.19, 0, 0.1], [0, 0, -0.2]],
  fingers: [
    // [thumb-side offset, along palm, palm-normal offset, spread (rad, + toward thumb), lengths]
    [0.02, 0.028, 0.006, 0.72, [0.034, 0.027, 0.022]],
    [0.003, 0.086, 0.0, 0.04, [0.05, 0.04, 0.033]],
    [-0.016, 0.078, 0.0, -0.16, [0.045, 0.036, 0.029]],
  ],
  plantOrder: [0, 1, 2],   // L at phase 0, R at 1/3, C at 2/3
};

// ---------------------------------------------------------------------------
// the pose
// ---------------------------------------------------------------------------
export function solvePose(st, ft, toLocal) {
  const t = st.t || 0;
  const crouch = clamp(st.crouch || 0);
  const lean = clamp(st.lean || 0, -1, 1);
  const walk = st.walk || null;
  const wAmt = walk ? clamp(walk.amount ?? 1) : 0;
  const wPh = walk ? (walk.phase || 0) : 0;
  const stride = walk ? (walk.stride ?? 0.25) : 0;
  const raise = clamp(st.raiseHand || 0);
  const gesture = clamp(st.gesture || 0);
  const gPh = st.gesturePhase ?? t * 0.9;
  const reach = clamp(st.reach || 0);
  const soft = ft.soft, whip = ft.whip, X = ft.x;
  // lags (0 without past)
  const lagCrouch = whip[3] - X[3];
  const lagRaise = whip[4] - X[4];
  const lagGest = whip[5] - X[5];
  const lagHY = whip[8] - X[8], lagHP = whip[9] - X[9];
  const lagWalk = soft[11] - X[11];
  // root motion lag in root-local axes
  const yaw = st.yaw || 0;
  const dxw = soft[0] - X[0], dzw = soft[1] - X[1];
  const fwdLag = dxw * Math.sin(yaw) + dzw * Math.cos(yaw);
  const sideLag = dxw * Math.cos(yaw) - dzw * Math.sin(yaw);
  const yawLag = soft[2] - X[2];

  // ---- idle life ----
  const breathe = Math.sin(t * TAU / 5.3);
  const floatY = 0.006 * Math.sin(t * 1.21 + 0.3) + 0.003 * Math.sin(t * 0.53 + 1.9);
  const swayX = 0.011 * Math.sin(t * 0.71 + 1.0) + 0.004 * Math.sin(t * 1.63 + 0.2);
  const swayZ = 0.008 * Math.sin(t * 0.57 + 2.1);

  // ---- tripod gait ----
  // each leg plants at phase k/3 and swings for SWING of the cycle before that
  const SWING = 0.3;
  const travel = 3 * stride;
  const feet = [], footLift = [];
  for (let leg = 0; leg < 3; leg++) {
    const base = SK.feet[leg];
    const f = [base[0] * (1 + 0.2 * crouch), 0, base[2] + (leg === 2 ? -0.06 : 0.02) * crouch];
    let lift = 0;
    if (wAmt > 0) {
      const q = fract(wPh - SK.plantOrder[leg] / 3);   // 0 at plant
      let z;
      if (q < 1 - SWING) z = travel * (0.5 - q / (1 - SWING));
      else {
        const s = (q - (1 - SWING)) / SWING;
        const e = s * s * (3 - 2 * s);
        z = travel * (-0.5 + e);
        lift = Math.sin(Math.PI * s);
      }
      f[2] += z * wAmt;
      f[1] += 0.075 * lift * wAmt;
      lift *= wAmt;
    }
    feet.push(f); footLift.push(lift);
  }
  // body weight shifts away from the swinging foot
  let wsx = 0, wsz = 0, bob = 0;
  if (wAmt > 0) {
    for (let leg = 0; leg < 3; leg++) { wsx -= footLift[leg] * SK.feet[leg][0] * 0.12; wsz -= footLift[leg] * SK.feet[leg][2] * 0.08; }
    const q3 = fract(wPh * 3);
    bob = -0.014 * wAmt * Math.exp(-(((q3 - 0.08) / 0.12) ** 2)) + 0.008 * wAmt * Math.sin(TAU * (q3 - 0.25));
  }

  // ---- pelvis ----
  const pelvis = [
    swayX * (1 - 0.5 * wAmt) + wsx + 0.25 * sideLag,
    SK.pelvisY + floatY + bob - 0.345 * crouch - 0.02 * Math.max(0, lagCrouch) + 0.004 * breathe,
    -0.02 + swayZ + wsz - 0.045 * crouch - 0.05 * lean + 0.3 * fwdLag,
  ];
  const pRoll = -swayX * 1.4 - wsx * 2.5 + 0.02 * Math.sin(t * 0.41);
  const pYaw = 0.03 * Math.sin(t * 0.33) + (wAmt ? 0.06 * wAmt * Math.sin(TAU * wPh) : 0) - 0.3 * yawLag;
  const pPitch = 0.1 * crouch + 0.05 * lean;
  let R = rot(pPitch, pYaw, pRoll);
  const Rpelvis = R;

  // ---- spine ----
  const leanA = 0.34 * lean + 0.2 * crouch + 0.05 * wAmt - 2.0 * fwdLag + 0.4 * lagWalk * 0;
  const spinePitch = [0.28, 0.34, 0.26, 0.12, 0.0].map(w => w * leanA);
  const spine = [pelvis], spineR = [R];
  let p = pelvis;
  for (let k = 0; k < SK.spine.length; k++) {
    const counterRoll = -pRoll * (k < 3 ? 0.45 : 0.2) + (k === 2 ? 0.015 * Math.sin(t * 0.37 + 1) : 0);
    const counterYaw = -pYaw * 0.4 + (k === 3 ? -0.04 * wAmt * Math.sin(TAU * wPh) : 0);
    const bpitch = spinePitch[k] + (k === 2 ? -0.012 * breathe : 0) + (k === 3 ? -0.008 * breathe : 0);
    R = mmul(R, rot(bpitch, counterYaw * 0.35, counterRoll * 0.4));
    p = add(p, mv(R, SK.spine[k]));
    spine.push(p); spineR.push(R);
  }
  const upperR = spineR[4], upperP = spine[4];
  const neckBase = spine[5];

  // ---- head aim ----
  const hs = st.head || {};
  const tilt = st.tilt || 0;
  let aimYaw = 0, aimPitch = 0;
  const follow = st.headFollow ?? 0.5;
  const estHead = [neckBase[0], neckBase[1] + 0.37, neckBase[2] + 0.05];
  let lookLocal = null;
  if (st.lookAt) {
    lookLocal = toLocal(st.lookAt);
    const d = sub(lookLocal, estHead);
    aimYaw = Math.atan2(d[0], d[2]);
    aimPitch = -Math.atan2(d[1], Math.hypot(d[0], d[2]));
  }
  const idleYaw = 0.035 * Math.sin(t * 0.31 + 0.4) + 0.014 * Math.sin(t * 0.83 + 2.2);
  const idlePitch = 0.02 * Math.sin(t * 0.43 + 1.1) + 0.008 * Math.sin(t * 1.1);
  const idleRoll = 0.03 * Math.sin(t * 0.27 + 2.0);
  const hYaw = clamp(follow * aimYaw + (hs.yaw || 0) + idleYaw + 0.25 * (whip[8] - X[8]) * 0, -1.3, 1.3);
  const hPitch = clamp(follow * aimPitch + (hs.pitch || 0) + idlePitch, -0.6, 0.8);
  const hRoll = clamp((hs.roll || 0) + tilt + idleRoll, -0.6, 0.6);
  // residual relative to the chest, distributed over neck base, mid and head
  const chestPitch = spinePitch.reduce((a, b) => a + b, 0) + pPitch;
  const resP = hPitch - chestPitch, resY = hYaw - pYaw * 0.6, resR = hRoll - (pRoll * 0.3);
  const neckW = [0.32, 0.3, 0.38];
  // the neck extends forward in the crouch (heron-like) and settles with a small overshoot
  const reachNeck = 0.16 * crouch + 0.08 * Math.max(0, lagCrouch) + 0.05 * lean;
  const neck = [neckBase], neckR = [];
  let Rn = mmul(upperR, rot(-0.06 + reachNeck * 1.0 + resP * neckW[0], resY * neckW[0], resR * 0.25));
  neckR.push(Rn);
  let np = add(neckBase, mv(Rn, SK.neck[0]));
  neck.push(np);
  Rn = mmul(Rn, rot(0.02 - reachNeck * 0.6 + resP * neckW[1], resY * neckW[1], resR * 0.3));
  neckR.push(Rn);
  np = add(np, mv(Rn, SK.neck[1]));
  neck.push(np);
  // head: absolute target orientation (stabilised like a bird's), relative only in yaw to the pelvis
  const Rhead = mmul(rot(0, pYaw * 0.6, 0), euler3(hYaw - pYaw * 0.6, hPitch, hRoll));
  const headC = add(np, mv(Rhead, SK.headFromAtlas));
  const atlas = np;

  // ---- arms ----
  const arms = [];
  for (const side of [1, -1]) {
    const S0 = add(upperP, mv(upperR, [side * SK.shoulder[0], SK.shoulder[1] + 0.003 * breathe, SK.shoulder[2]]));
    const clav = add(upperP, mv(upperR, [side * SK.clav[0], SK.clav[1], SK.clav[2]]));
    // pose layers: [weight, wrist (upper-frame offset from shoulder), pole, finger dir, palm normal, curl, spread]
    const layers = [];
    const isR = side < 0;
    const wRaise = isR ? raise : 0;
    const wRaiseHand = isR ? clamp(raise + 0.6 * lagRaise, 0, 1.15) : 0;
    const wGest = gesture * (isR ? 0.4 * (1 - raise) : 1);
    let wReach = 0, reachT = null;
    if (reach > 0 && st.reachAt) {
      reachT = toLocal(st.reachAt);
      const wantLeft = reachT[0] >= 0;
      wReach = (wantLeft === !isR) ? reach * (isR ? 1 - raise : 1) : 0;
    }
    const wRest = Math.max(0, 1 - wRaise - wGest - wReach);
    // rest: hanging long and loose, a slow drift
    const swing = wAmt * 0.05 * Math.sin(TAU * wPh + (isR ? Math.PI : 0) + 0.6);
    const drift = [0.008 * Math.sin(t * 0.47 + side), 0.004 * Math.sin(t * 0.61 + 2 * side), 0.012 * Math.sin(t * 0.39 + 1.3 * side) + swing];
    layers.push([wRest, [side * 0.062 + drift[0], -0.628 + drift[1] + 0.05 * crouch, 0.05 + drift[2] + 0.06 * crouch],
      [side * 0.25, -0.1, -1], [side * 0.06, -1, 0.14], [-side, 0.0, -0.25], [0.32, 0.42, 0.3], 0.0]);
    if (wRaise > 0) {
      layers.push([wRaise, [side * 0.335, 0.285, 0.1], [side * 1, -0.75, -0.35], [side * 0.1, 1, 0.02], [0.08 * -side, 0.0, 1], [0.05, 0.05, 0.03], 0.22 + 0.12 * Math.max(0, lagRaise)]);
    }
    if (wGest > 0) {
      const ph = gPh * 1.55 + (isR ? 1.9 : 0);
      const g = [side * (0.2 + 0.07 * Math.sin(ph)), -0.3 + 0.06 * Math.sin(2 * ph + 0.5), 0.3 + 0.06 * Math.cos(ph)];
      const roll = 0.35 * Math.sin(ph + 0.8);
      const fd = norm([side * (0.35 + 0.15 * Math.sin(ph)), 0.12 + 0.1 * Math.cos(ph), 1]);
      const pn = norm([side * (0.25 + roll), 0.8, 0.45 - 0.3 * roll]);
      const wave = k => 0.22 + 0.28 * Math.sin(ph * 1.4 - k * 0.8);
      layers.push([wGest, g, [side * 0.9, -1, -0.2], fd, pn, [wave(0), wave(1), wave(2)], 0.12 + 0.1 * Math.sin(ph * 0.7)]);
    }
    if (wReach > 0) {
      // target in the upper frame, relative to the shoulder
      const rel = mtv(upperR, sub(reachT, S0));
      const rl = len(rel);
      const r = mul(rel, Math.min(1, 0.62 / (rl || 1)));
      const fd = norm(rel);
      layers.push([wReach, r, [side * 0.7, -1, -0.3], fd, [0, -1, 0.2], [0.12, 0.16, 0.1], 0.1]);
    }
    let W = [0, 0, 0], pole = [0, 0, 0], fdir = [0, 0, 0], pnrm = [0, 0, 0], curl = [0, 0, 0], spread = 0, wsum = 0;
    for (const L of layers) {
      const w = L[0]; if (w <= 0) continue;
      wsum += w;
      W = madd(W, L[1], w); pole = madd(pole, L[2], w); fdir = madd(fdir, norm(L[3]), w); pnrm = madd(pnrm, norm(L[4]), w);
      curl = madd(curl, L[5], w); spread += L[6] * w;
    }
    W = mul(W, 1 / wsum); curl = mul(curl, 1 / wsum); spread /= wsum;
    // the hand trails the arm a little on the raise (drag), then overshoots
    if (isR && raise > 0) {
      const extra = clamp(wRaiseHand - raise, -0.3, 0.3);
      fdir = madd(fdir, [0, 1, 0], extra * 0.6);
      pnrm = madd(pnrm, [0, 0, 1], extra * 0.4);
    }
    // finger drag from gesture/raise motion
    const drag = clamp(-(isR ? lagRaise : 0) * 0.8 - lagGest * 0.6, -0.3, 0.4);
    curl = curl.map((c, k) => clamp(c + drag * (0.6 + 0.2 * k) + 0.05 * Math.sin(t * 0.83 + k * 1.3 + side), -0.1, 1.2));
    const Wl = add(S0, mv(upperR, W));
    const polel = mv(upperR, norm(pole));
    const sol = ik2(S0, Wl, SK.upperArm, SK.foreArm, polel);
    const E = sol.mid, Wr = sol.end;
    const fore = norm(sub(Wr, E));
    // hand frame
    let Y = norm(add(mul(norm(mv(upperR, fdir)), 0.72), mul(fore, 0.28)));
    let Z = mv(upperR, norm(pnrm));
    Z = norm(sub(Z, mul(Y, dot(Z, Y))));
    const Xh = cross(Y, Z);
    const thumb = mul(Xh, -side);
    // fingers
    const fingers = [];
    SK.fingers.forEach((fd, k) => {
      const [tx, ty, tz, spr, lens] = fd;
      const base = add(Wr, add(add(mul(thumb, tx), mul(Y, ty)), mul(Z, tz)));
      const sp = spr + spread * (k === 0 ? 0.5 : k === 1 ? 0.05 : -1.0);
      let d = norm(add(mul(Y, Math.cos(sp)), mul(thumb, Math.sin(sp))));
      if (k === 0) d = norm(add(d, mul(Z, 0.35)));   // opposable
      let n = norm(sub(Z, mul(d, dot(Z, d))));
      const pts = [add(base, mul(d, -0.018)), base];
      const fronts = [n.slice(), n.slice()];
      let q = base;
      const c = curl.map((x, i) => x * (k === 0 ? 0.7 : 1) * (i === 0 ? 0.8 : 1));
      for (let i = 0; i < 3; i++) {
        const a = c[i];
        const d2 = norm(add(mul(d, Math.cos(a)), mul(n, Math.sin(a))));
        n = norm(sub(mul(n, Math.cos(a)), mul(d, Math.sin(a))));
        d = d2;
        q = add(q, mul(d, lens[i]));
        pts.push(q);
        fronts.push(n.slice());
      }
      fingers.push({ pts, fronts });
    });
    arms.push({ side, clav, S: S0, E, W: Wr, hand: { X: Xh, Y, Z, thumb }, fingers });
  }

  // ---- legs ----
  const legs = [];
  for (let leg = 0; leg < 3; leg++) {
    const hip = add(pelvis, mv(Rpelvis, SK.hips[leg]));
    const inner = add(pelvis, mv(Rpelvis, [SK.hips[leg][0] * 0.35, 0.02, SK.hips[leg][2] * 0.5]));
    const ball = [feet[leg][0], feet[leg][1] + 0.022, feet[leg][2]];
    const lift = footLift[leg];
    const beta = 0.4 + 0.5 * crouch + 0.55 * lift;
    const outward = leg === 2 ? [0, 0, -1] : [Math.sign(SK.feet[leg][0]) * 0.18, 0, 0.98];
    const legFwd = leg === 2 ? [0, 0, 1] : norm([Math.sign(SK.feet[leg][0]) * 0.12, 0, 1]);
    const metaDir = norm([legFwd[0] * -Math.sin(beta), Math.cos(beta), legFwd[2] * -Math.sin(beta)]);
    let ankle = add(ball, mul(metaDir, SK.meta));
    const pole = leg === 2 ? [0, 0.1, 1] : [Math.sign(SK.feet[leg][0]) * 0.22, 0.05, 1];
    const sol = ik2(hip, ankle, SK.thigh, SK.shin, pole);
    ankle = sol.end;
    const knee = sol.mid;
    // toe: flat on the floor when planted, pointing down in the swing
    const toePitch = 0.6 * lift;
    const toeDir = norm([legFwd[0], -0.18 - toePitch, legFwd[2]]);
    const toe = add(ball, mul(toeDir, SK.toe));
    legs.push({ inner, hip, knee, ankle, ball, toe, fwd: legFwd, lift, outward });
  }

  // ---- crest follow-through (head space bend: [lateral, vertical]) ----
  const crestBend = [
    clamp(-0.5 * lagHY + 0.9 * sideLag + 0.012 * Math.sin(t * 0.9 + 0.5), -0.12, 0.12),
    clamp(0.35 * lagHP - 0.15 * lagCrouch + 1.2 * fwdLag + 0.01 * Math.sin(t * 1.13), -0.12, 0.12),
  ];

  return {
    t, pelvis, Rpelvis, spine, spineR, neck, neckR, atlas, Rhead, headC, arms, legs,
    breathe, crestBend, lookLocal, crouch, wAmt,
  };
}
