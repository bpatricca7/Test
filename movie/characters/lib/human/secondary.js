// Secondary motion (overlap and follow-through), deterministic.
//
// If the state carries `past(dt)`, we sample the character's own pose over the
// last ~0.9 s (skeleton solve only, no mesh work) and integrate damped springs
// whose anchors ride on bones (head top, chest, hips). The springs' lag, in the
// anchor bone's frame, drives the bun/ringlets, headphones, hood, drawstrings,
// the cardigan/hoodie hem and a head settle. Without `past`, the same channels
// get procedural motion from the walk phase, gesture phase, startle and t.

import * as THREE from 'three';
import { solvePose, normalizeState, wiggle } from './pose.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const H = 0.06, NS = 15, SUB = 6;

export const CHANNELS = {
  head: { bone: 'head', local: new THREE.Vector3(0, 0.16, -0.04), freq: 2.4, damp: 0.28 },
  chest: { bone: 'chest', local: new THREE.Vector3(0, 0.12, 0.1), freq: 1.9, damp: 0.24 },
  hips: { bone: 'hips', local: new THREE.Vector3(0, -0.08, 0.12), freq: 1.7, damp: 0.3 },
};

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

function anchorWorld(pose, S, ch, out) {
  const W = pose.W[ch.bone];
  out.copy(ch.local).applyQuaternion(W.q).add(W.p);
  _q.setFromAxisAngle(_v.set(0, 1, 0), S.yaw);
  out.applyQuaternion(_q).add(_v.set(S.position[0], S.position[1], S.position[2]));
  return out;
}

/**
 * returns { head, chest, hips }: Vector3 lag of each spring in its bone frame
 * (metres), plus `jolt` (0..1 transient) for the head settle.
 */
export function computeSecondary(state, S, pose, ctx) {
  const res = {};
  const names = Object.keys(CHANNELS);
  if (typeof state.past === 'function') {
    // sample past poses, oldest first
    const samples = [];
    for (let k = NS - 1; k >= 1; k--) {
      let st;
      try { st = state.past(k * H); } catch (e) { st = null; }
      if (!st) continue;
      const Sk = normalizeState(st);
      samples.push({ S: Sk, pose: solvePose(Sk, ctx) });
    }
    samples.push({ S, pose });
    if (samples.length >= 3) {
      for (const nm of names) {
        const ch = CHANNELS[nm];
        const A = samples.map(sm => anchorWorld(sm.pose, sm.S, ch, new THREE.Vector3()));
        const w = 2 * Math.PI * ch.freq, z = ch.damp;
        const x = A[0].clone();
        const v = A[1].clone().sub(A[0]).multiplyScalar(1 / H);
        const acc = new THREE.Vector3(), av = new THREE.Vector3(), ap = new THREE.Vector3();
        const dt = H / SUB;
        for (let i = 0; i < A.length - 1; i++) {
          av.copy(A[i + 1]).sub(A[i]).multiplyScalar(1 / H);
          for (let s = 0; s < SUB; s++) {
            ap.copy(A[i]).lerp(A[i + 1], (s + 1) / SUB);
            acc.copy(ap).sub(x).multiplyScalar(w * w).addScaledVector(av.clone().sub(v), 2 * z * w);
            v.addScaledVector(acc, dt);
            x.addScaledVector(v, dt);
          }
        }
        const lag = x.sub(A[A.length - 1]);
        // into the bone frame (now)
        const W = pose.W[ch.bone];
        _q.setFromAxisAngle(_v.set(0, 1, 0), S.yaw);
        const qb = _q.clone().multiply(W.q).invert();
        lag.applyQuaternion(qb);
        // keep it sane
        if (lag.length() > 0.12) lag.setLength(0.12);
        res[nm] = lag;
      }
      res.sampled = true;
    }
  }
  if (!res.sampled) {
    // procedural fallback: gait bounce, gesture beats, startle jolt, idle drift
    const wa = S.walk.amount, ph = S.walk.phase;
    const bounce = Math.sin(4 * Math.PI * (ph - 0.32)) * wa;
    const sway = Math.sin(2 * Math.PI * (ph - 0.3)) * wa;
    const g = S.gesturePhase * 2 * Math.PI;
    const gw = 0.4;
    for (const nm of names) {
      const amp = nm === 'head' ? 1 : nm === 'chest' ? 0.8 : 0.6;
      res[nm] = new THREE.Vector3(
        amp * (0.006 * sway + 0.002 * wiggle(S.t, 3.1 + amp, 0.7) * S.energy),
        amp * (-0.008 * bounce - 0.012 * S.startle),
        amp * (-0.01 * wa + 0.003 * Math.sin(g) * gw - 0.006 * S.startle + 0.002 * wiggle(S.t, 5.3 + amp, 0.6) * S.energy),
      );
    }
  }
  return res;
}
