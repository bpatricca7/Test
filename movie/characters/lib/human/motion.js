// Performance filter: turns the director's keyed state into motion that feels
// captured. It samples the character's own recent (and near-future) states
// through `state.past(dt)` (dt < 0 looks ahead; the film's performance is a
// pure function of t) and derives, deterministically:
//  - a head that follows gaze shifts ~0.1 s after the eyes, with weight;
//  - hand targets on springs (arcs, deceleration, a little overshoot, wrist drag);
//  - world-locked footprints: heel strike, roll, toe-off, no sliding;
//  - the torso's lean into a first step and its settle after the last;
//  - sit/stand direction, a lagging head out of a recline;
//  - a startle with an ~80 ms attack, a slower release and a tremor;
//  - blinks on big gaze shifts and on the startle, slightly asymmetric;
//  - a viseme window for co-articulated lip-sync, and speech emphasis.
// Without `past` every channel falls back to the plain state.

import * as THREE from 'three';
import { solvePose, normalizeState, footprintAt, footProfile, gaitU, STANCE } from './pose.js';
import { fbm, steps } from './noise.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const angLerp = (a, b, u) => { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * u; };

export const H = 0.05, NS = 17; // coarse history: 0.8 s at 20 Hz
const VIS_WIN = [-0.1, -0.07, -0.045, -0.022, 0.022, 0.045, 0.07, 0.1];
const OPEN = { sil: 0, PP: 0, FF: 0.1, TH: 0.2, DD: 0.25, kk: 0.3, CH: 0.15, SS: 0.08, nn: 0.2, RR: 0.18, aa: 1, E: 0.55, I: 0.3, O: 0.65, U: 0.25 };

/**
 * Damped spring driven through a uniformly sampled input (arrays of numbers).
 * follow=false: the spring lags and overshoots (mass on a spring);
 * follow=true: it also tracks the input velocity (only transients remain).
 * Returns per-sample positions X and velocities V.
 */
function springSeq(seq, freq, damp, follow = false) {
  const n = seq.length, dim = seq[0].length;
  const w = 2 * Math.PI * freq;
  const x = seq[0].slice(), v = new Array(dim).fill(0);
  if (n > 1 && follow) for (let d = 0; d < dim; d++) v[d] = (seq[1][d] - seq[0][d]) / H;
  const X = [x.slice()], V = [v.slice()];
  const SUB = 5, dt = H / SUB;
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < SUB; s++) {
      const f = (s + 1) / SUB;
      for (let d = 0; d < dim; d++) {
        const tgt = seq[i][d] + (seq[i + 1][d] - seq[i][d]) * f;
        const tv = follow ? (seq[i + 1][d] - seq[i][d]) / H : 0;
        const acc = w * w * (tgt - x[d]) + 2 * damp * w * (tv - v[d]);
        v[d] += acc * dt; x[d] += v[d] * dt;
      }
    }
    X.push(x.slice()); V.push(v.slice());
  }
  return { X, V };
}

/** a blink shape at time tau since its onset: fast close, short hold, slower open */
export function blinkShape(tau, close = 0.05, hold = 0.03, open = 0.15) {
  if (tau < 0) return 0;
  if (tau < close) return sstep(0, close, tau);
  if (tau < close + hold) return 1;
  return 1 - sstep(close + hold, close + hold + open, tau);
}

export function computePerformance(state, S, ctx) {
  const has = typeof state.past === 'function';
  const cache = new Map();
  const pastQ = dt => {
    if (Math.abs(dt) < 1e-6) return { st: state, S };
    const key = Math.round(dt * 1e5);
    if (cache.has(key)) return cache.get(key);
    let st = null;
    if (has) { try { st = state.past(dt); } catch (e) { st = null; } }
    const r = st ? { st, S: normalizeState(st) } : null;
    cache.set(key, r);
    return r;
  };
  const seed = ctx.seed;
  const t = S.t;

  // ------------------------------------------------------ gather samples
  const smp = []; // oldest first; the last one is now
  if (has) {
    for (let k = NS - 1; k >= 1; k--) {
      const q = pastQ(k * H);
      if (!q) { smp.length = 0; continue; }
      smp.push({ dt: k * H, st: q.st, S: q.S });
    }
  }
  smp.push({ dt: 0, st: state, S });
  const n = smp.length;
  const cur = n - 1;
  const fut = has ? pastQ(-0.2) : null; // a glimpse of the next 0.2 s

  // ------------------------------------------------ startle (onset-based)
  let onset = null, A = 0;
  if (has && S.startle > 0.001) {
    let dt = 0, prevDt = 0;
    A = S.startle;
    for (let i = 0; i < 25; i++) {
      prevDt = dt; dt += 0.1;
      const q = pastQ(dt);
      const v = q ? q.S.startle : 0;
      if (v <= 0.002) break;
      A = Math.max(A, v);
    }
    let lo = prevDt, hi = dt; // startle > 0 at t-lo, ~0 at t-hi
    for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; const q = pastQ(m); if (q && q.S.startle > 0.002) lo = m; else hi = m; }
    onset = (lo + hi) / 2; // seconds ago
    for (const d of [-0.06, -0.12]) { const q = pastQ(d); if (q) A = Math.max(A, q.S.startle); }
  }
  const startleAt = (dtAgo, raw) => {
    if (onset === null || raw <= 0.0005) return { body: raw, arms: raw, tremor: 0, face: raw, tau: -1 };
    const tau = onset - dtAgo;
    if (tau < 0) return { body: 0, arms: 0, tremor: 0, face: 0, tau };
    const x = tau > 0.1 ? clamp(raw / Math.max(A, 1e-3)) : 1;
    return {
      body: A * sstep(0, 0.08, tau) * Math.pow(x, 1.6),
      arms: A * sstep(0.03, 0.13, tau) * Math.pow(x, 1.3),
      face: A * sstep(0, 0.06, tau) * Math.pow(x, 1.1),
      tremor: A * sstep(0.05, 0.14, tau) * x * 0.8,
      tau,
    };
  };
  const rawStartleMax = Math.max(...smp.map(q => q.S.startle));
  for (const q of smp) {
    q.stl = startleAt(q.dt, q.S.startle);
    const ey = q.st.eyes || {}, br = q.st.brows || {};
    q.fear = clamp(Math.max(q.stl.body, 0.6 * rawStartleMax, 0.5 * (ey.wide || 0), 0.3 * Math.max(0, br.raise || 0)));
  }

  // ---------------------------------------------------- sit/stand direction
  const futSit = fut ? fut.S.sit : S.sit;
  for (let i = 0; i < n; i++) {
    const a = smp[Math.max(0, i - 2)].S.sit;
    const b = i + 2 < n ? smp[i + 2].S.sit : (i === cur ? futSit : smp[cur].S.sit);
    const d = b - a;
    smp[i].sitDir = Math.abs(d) > 1e-4 ? Math.sign(d) : 0;
  }

  // ------------------------------------------------------------ raw solves
  for (const q of smp) {
    q.raw = solvePose(q.S, ctx, { mode: 'raw', startle: q.stl, sitDir: q.sitDir, fear: q.fear });
  }

  // --------------------------------------------------------------- springs
  // director head angles: a little mass
  const headS = springSeq(smp.map(q => [q.S.head.yaw, q.S.head.pitch, q.S.head.roll]), 3.2, 0.75);
  // gaze-driven head turn: starts ~0.1 s after the eyes, weighted
  const lookS = springSeq(smp.map(q => [q.raw.look.yaw, q.raw.look.pitch]), 1.7, 0.82);
  const LOOK_DELAY = 2;
  // hand targets (chest space)
  const wrS = { L: springSeq(smp.map(q => q.raw.wT.L.toArray()), 2.6, 0.68), R: springSeq(smp.map(q => q.raw.wT.R.toArray()), 2.6, 0.68) };
  // the head comes out of a recline after the shoulders
  const recS = springSeq(smp.map(q => [q.S.recline * q.S.sit]), 1.3, 0.9);
  const REC_DELAY = 3;
  // torso: pitches forward when a walk brakes, settles with a small overshoot
  const vel = smp.map((q, i) => {
    if (i === 0) return 0;
    const p0 = smp[i - 1].S.position, p1 = q.S.position;
    const yaw = q.S.yaw;
    return ((p1[0] - p0[0]) * Math.sin(yaw) + (p1[2] - p0[2]) * Math.cos(yaw)) / H;
  });
  if (n > 1) vel[0] = vel[1];
  const drive = vel.map((v, i) => {
    if (i === 0) return [0];
    const a = (v - vel[i - 1]) / H;
    return [a * vel[i - 1] < 0 ? -a : 0];
  });
  const pend = pendulum(drive);
  // the body carries momentum: the hips lag the root when it starts and overshoot when it stops
  const rootS = springSeq(smp.map(q => [q.S.position[0], q.S.position[2]]), 1.6, 0.7, true);
  const lagAt = i => {
    const q = smp[i].S, x = rootS.X[i][0] - q.position[0], z = rootS.X[i][1] - q.position[2];
    const cy = Math.cos(q.yaw), sy = Math.sin(q.yaw);
    return { x: cy * x - sy * z, z: sy * x + cy * z };
  };
  // speech emphasis: louder-than-recent syllables
  const energyOf = q => {
    if (q.S.speechEnergy !== null && q.S.speechEnergy !== undefined) return q.S.speechEnergy;
    const vis = q.st.visemes || {};
    let e = 0; for (const k in OPEN) e += (vis[k] || 0) * OPEN[k];
    return e;
  };
  const en = smp.map(energyOf);
  const mean = en.reduce((a, b) => a + b, 0) / n;
  const emphRaw = en.map((e, i) => {
    const lo = Math.max(0, i - 8);
    let m = 0; for (let j = lo; j <= i; j++) m += en[j]; m /= i - lo + 1;
    return [clamp((e - Math.max(m, mean * 0.8) - 0.08) * 2.2)];
  });
  const emphS = springSeq(emphRaw, 2.2, 0.55);

  const lookAtIdx = i => lookS.X[Math.max(0, i - LOOK_DELAY)];
  const recAtIdx = i => recS.X[Math.max(0, i - REC_DELAY)][0];
  const fxAt = (i, mode) => ({
    mode,
    head: { yaw: headS.X[i][0], pitch: headS.X[i][1], roll: headS.X[i][2] },
    look: has && n > 1 ? { yaw: lookAtIdx(i)[0], pitch: lookAtIdx(i)[1] } : null,
    recHead: has && n > 1 ? clamp(recAtIdx(i)) : undefined,
    lean: pend[i],
    dip: 0.02 * clamp(Math.abs(pend[i]) / 0.07),
    rootLag: lagAt(i),
    emph: 0.05 * emphS.X[i][0],
    sitDir: smp[i].sitDir, startle: smp[i].stl, fear: smp[i].fear,
  });

  // anticipation: lean into the first step (future vs past speed)
  let ant = 0;
  if (fut) {
    const p0 = S.position, pf = fut.S.position, yaw = S.yaw;
    const vF = ((pf[0] - p0[0]) * Math.sin(yaw) + (pf[2] - p0[2]) * Math.cos(yaw)) / 0.2;
    const ip = Math.max(0, cur - 6);
    const pp = smp[ip].S.position;
    const vP = ((p0[0] - pp[0]) * Math.sin(yaw) + (p0[2] - pp[2]) * Math.cos(yaw)) / Math.max(H, (cur - ip) * H);
    ant = 0.07 * clamp(vF - vP, -1, 1);
  }

  // ------------------------------------------------------- anchor solves
  const samples = [];
  if (n > 1) {
    for (let i = 0; i < cur; i++) samples.push({ S: smp[i].S, pose: solvePose(smp[i].S, ctx, fxAt(i, 'anchor')) });
  }

  // --------------------------------------------------- the current frame
  const fx = fxAt(cur, 'full');
  fx.lean += ant;
  if (n > 1) {
    fx.wrist = { L: new THREE.Vector3(...wrS.L.X[cur]), R: new THREE.Vector3(...wrS.R.X[cur]) };
    fx.wristV = { L: new THREE.Vector3(...wrS.L.V[cur]), R: new THREE.Vector3(...wrS.R.V[cur]) };
  } else {
    fx.look = null; fx.head = null;
  }
  // world-locked feet
  if (n > 1) fx.feet = lockFeet(S, smp, pastQ, ctx);

  // ------------------------------------------------------------- face
  const face = {};
  // micro-saccades and slow drift while fixating
  {
    const [sy, sp] = steps(t, seed + 301, 0.62, 0.03, 2);
    face.gazeOff = { yaw: 0.011 * sy + 0.004 * fbm(t, seed + 305, 0.35, 2), pitch: 0.008 * sp + 0.003 * fbm(t, seed + 307, 0.3, 2) };
  }
  // blinks: the director's, slightly asymmetric; plus on big gaze shifts and on a startle
  {
    const base = clamp(state.blink || 0);
    let bR = base;
    if (has && (base > 0 || (smp[cur - 1] && (smp[cur - 1].st.blink || 0) > 0))) {
      const q = pastQ(0.012);
      bR = q ? clamp(q.st.blink || 0) * 0.97 : base;
    }
    let turn = 0, turnR = 0;
    if (n > 2 && S.lookAt) {
      // find a gaze jump of more than ~20 degrees in the last 0.3 s
      for (let i = cur; i >= Math.max(1, cur - 6); i--) {
        const g1 = smp[i].raw.gaze, g0 = smp[i - 1].raw.gaze;
        if (!g1 || !g0) continue;
        const d = Math.hypot(g1.yaw - g0.yaw, g1.pitch - g0.pitch);
        if (d > 0.35) {
          // bisect the moment of the jump on the target direction
          const eye = new THREE.Vector3(...S.position).add(new THREE.Vector3(0, 1.5, 0));
          const dirAt = dt => { const q = pastQ(dt); const L = q && q.S.lookAt; return L ? new THREE.Vector3(L[0], L[1], L[2]).sub(eye).normalize() : null; };
          const d0 = dirAt(smp[i - 1].dt), d1 = dirAt(smp[i].dt);
          let lo = smp[i].dt, hi = smp[i - 1].dt; // jump between t-hi and t-lo
          if (d0 && d1) {
            const half = d0.angleTo(d1) * 0.5;
            for (let it = 0; it < 5; it++) { const m = (lo + hi) / 2; const dm = dirAt(m); if (dm && dm.angleTo(d0) > half) lo = m; else hi = m; }
          }
          const tau = (lo + hi) / 2 - 0.03;
          turn = blinkShape(tau, 0.05, 0.03, 0.15) * clamp((d - 0.3) / 0.2);
          turnR = blinkShape(tau - 0.01, 0.05, 0.03, 0.15) * clamp((d - 0.3) / 0.2) * 0.97;
          break;
        }
      }
    }
    let stb = 0, stbR = 0;
    const tau = smp[cur].stl.tau;
    if (tau >= 0 && A > 0.2) { stb = blinkShape(tau, 0.035, 0.04, 0.13); stbR = blinkShape(tau - 0.008, 0.035, 0.04, 0.13); }
    face.blinkL = Math.max(base, turn, stb);
    face.blinkR = Math.max(bR, turnR, stbR);
  }
  face.startle = smp[cur].stl.face;
  face.fear = smp[cur].fear;
  face.emph = emphS.X[cur][0];
  // viseme window for co-articulation (only while speaking)
  {
    const talking = q => { const v = q && q.st.visemes; if (!v) return false; let s = 0; for (const k in v) if (k !== 'sil') s += v[k] || 0; return s > 0.01; };
    const any = talking(smp[cur]) || (n > 2 && (talking(smp[cur - 1]) || talking(smp[cur - 2]))) || (has && talking(pastQ(-0.1)));
    face.visWindow = [{ dt: 0, vis: state.visemes || {} }];
    if (any && has) {
      for (const off of VIS_WIN) {
        const q = pastQ(-off);
        if (q) face.visWindow.push({ dt: off, vis: q.st.visemes || {} });
      }
    }
  }
  return { fx, samples, face, has: has && n > 1 };
}

/** torso pendulum driven by braking: forward pitch, small overshoot back */
function pendulum(drive) {
  const w = 2 * Math.PI * 1.1, z = 0.35, g = 0.64;
  let th = 0, v = 0;
  const out = [0];
  const SUB = 5, dt = H / SUB;
  for (let i = 1; i < drive.length; i++) {
    const u = drive[i][0];
    for (let s = 0; s < SUB; s++) {
      const acc = -w * w * th - 2 * z * w * v + g * u;
      v += acc * dt; th += v * dt;
    }
    out.push(clamp(th, -0.12, 0.12));
  }
  return out;
}

/**
 * Feet planted in the world: the stance foot stays where it struck; the
 * swing foot travels from its last print to the next one (looked up in the
 * future), with heel strike, roll and toe-off from footProfile.
 */
function lockFeet(S, smp, pastQ, ctx) {
  const cur = smp.length - 1;
  if (cur < 1) return null;
  const walking = q => q && q.walk.amount > 1e-3;
  let any = false;
  for (const q of smp) if (walking(q.S)) any = true;
  if (!any) return null;
  // the walk running now, or (for 0.4 s after it ends) the one that just ended: its last swing still lands
  let Sw = S, dtW = 0, r = null;
  if (walking(S)) {
    const Sp = smp[cur - 1].S, qf = pastQ(-H);
    if (walking(Sp)) r = (S.walk.phase - Sp.walk.phase) / H;
    else if (qf && walking(qf.S)) r = (qf.S.walk.phase - S.walk.phase) / H;
  } else {
    let j = -1;
    for (let i = cur - 1; i >= Math.max(1, cur - 8); i--) if (walking(smp[i].S) && walking(smp[i - 1].S)) { j = i; break; }
    if (j < 0) return null;
    Sw = smp[j].S; dtW = smp[j].dt; r = (Sw.walk.phase - smp[j - 1].S.walk.phase) / H;
  }
  if (r === null || Math.abs(r) < 0.05 || Math.abs(r) > 6) return null;
  const fwd = r > 0, ar = Math.abs(r);
  const post = dtW > 0;
  const ph = Sw.walk.phase + r * dtW;
  // when did this walk start / end (bisected, so the re-timed first and last steps glide)
  const bisect = (a, b, isWalkAtA) => { // walking state flips between a and b seconds ago
    for (let it = 0; it < 6; it++) { const m = (a + b) / 2; const q = pastQ(m); const w = !!(q && walking(q.S)); if (w === isWalkAtA) a = m; else b = m; }
    return (a + b) / 2;
  };
  let startAgo = null, Sstart = null;
  for (let i = cur; i >= 1; i--) {
    if (walking(smp[i].S) && !walking(smp[i - 1].S)) { startAgo = bisect(smp[i].dt, smp[i - 1].dt, true); Sstart = smp[i - 1].S; break; }
  }
  let endAgo = null;
  if (post) {
    for (let i = cur; i >= 1; i--) if (!walking(smp[i].S) && walking(smp[i - 1].S)) { endAgo = bisect(smp[i - 1].dt, smp[i].dt, true); break; }
    if (endAgo === null) endAgo = dtW;
    // endAgo: seconds since the walk ended (bisect returns the flip time)
  }
  const q03 = pastQ(0.3);
  const wa = Math.max(S.walk.amount, 0.6 * (q03 ? q03.S.walk.amount : 0));
  const stateAt = dt => { const q = pastQ(dt); return q ? q.S : S; };
  // a print sits under the hip at mid-stance: take the root where it is then
  const uMid = STANCE / 2;
  const worldPrint = (Sr, side) => {
    const c = footprintAt(Sr, ctx, side, uMid);
    const cy = Math.cos(Sr.yaw), sy = Math.sin(Sr.yaw);
    return { x: Sr.position[0] + cy * c.x + sy * c.z, z: Sr.position[2] - sy * c.x + cy * c.z, yaw: Sr.yaw + c.yaw };
  };
  const settle = post ? clamp(1 - (endAgo || 0) / 0.3) : 1;
  const feet = {};
  for (const [k, side] of [['L', 1], ['R', -1]]) {
    const u = gaitU(ph, side);
    const prof = footProfile(u, Sw.walk.stride, wa);
    const inStance = u < STANCE;
    const stanceAgo = fwd ? u / ar : (STANCE - u) / ar;             // since this stance began
    const swingAgo = fwd ? (u - STANCE) / ar : (1 - u) / ar;        // since this swing began
    const landIn = fwd ? (1 - u) / ar : (u - STANCE) / ar;          // until this swing lands
    if (inStance || (post && swingAgo < endAgo)) {
      // planted; a stance that began before the walk keeps the standing print; after the walk nothing lifts again
      let P;
      if (inStance && startAgo !== null && stanceAgo >= startAgo) P = worldPrint(Sstart, side);
      else if (inStance) P = worldPrint(stateAt((u - uMid) / r), side);
      else P = worldPrint(stateAt(swingAgo + (fwd ? (STANCE - uMid) / ar : uMid / ar)), side);
      const pr = inStance ? prof : footProfile(STANCE * 0.999, Sw.walk.stride, wa);
      feet[k] = { x: P.x, z: P.z, yaw: P.yaw, pitch: pr.pitch * settle, lift: 0, toe: pr.toe * settle, w: 1 };
    } else {
      let P, e;
      const dtNext = fwd ? (u - 1 - uMid) / r : (u - uMid) / r;
      const N = worldPrint(stateAt(dtNext), side);
      if (startAgo !== null && swingAgo >= startAgo) {
        // the first step: lift off from where the foot stood when the walk began
        P = worldPrint(Sstart, side);
        e = sstep(0, 1, startAgo / Math.max(1e-3, startAgo + landIn));
      } else {
        const dtPrev = fwd ? (u - uMid) / r : (u - uMid - 1) / r;
        const prevStanceAgo = swingAgo + STANCE / ar;
        P = startAgo !== null && prevStanceAgo >= startAgo ? worldPrint(Sstart, side) : worldPrint(stateAt(dtPrev), side);
        const sp = (u - STANCE) / (1 - STANCE);
        e = sstep(0, 1, fwd ? sp : 1 - sp);
      }
      feet[k] = { x: mix(P.x, N.x, e), z: mix(P.z, N.z, e), yaw: angLerp(P.yaw, N.yaw, e), pitch: prof.pitch, lift: prof.lift, toe: prof.toe, w: 1 };
    }
  }
  return feet;
}
