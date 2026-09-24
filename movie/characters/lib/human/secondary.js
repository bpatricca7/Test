// Secondary motion (overlap and follow-through), deterministic.
//
// motion.js samples the character's own recent poses (skeleton only, no mesh
// work); here damped springs whose anchors ride on bones (head top, chest,
// hips) are integrated through them. The springs' lag, in the anchor bone's
// frame, drives the bun/ringlets, headphones, hood, drawstrings and the
// cardigan/hoodie hem. Without samples the same channels get procedural
// motion from the walk phase, gesture phase, startle and layered noise.

import * as THREE from 'three';
import { fbm } from './noise.js';

const H = 0.05, SUB = 6;

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
 * samples: [{S, pose}] oldest first (poses solved at t - k*H), may be empty.
 * returns { head, chest, hips }: Vector3 lag of each spring in its bone frame (m).
 */
export function computeSecondary(state, S, pose, ctx, samples = []) {
  const res = {};
  const names = Object.keys(CHANNELS);
  if (samples.length >= 2) {
    const all = samples.concat([{ S, pose }]);
    for (const nm of names) {
      const ch = CHANNELS[nm];
      const A = all.map(sm => anchorWorld(sm.pose, sm.S, ch, new THREE.Vector3()));
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
      const W = pose.W[ch.bone];
      _q.setFromAxisAngle(_v.set(0, 1, 0), S.yaw);
      const qb = _q.clone().multiply(W.q).invert();
      lag.applyQuaternion(qb);
      if (lag.length() > 0.12) lag.setLength(0.12);
      res[nm] = lag;
    }
    res.sampled = true;
    return res;
  }
  // procedural fallback: gait bounce, gesture beats, startle jolt, idle drift
  const wa = S.walk.amount, ph = S.walk.phase;
  const bounce = Math.sin(4 * Math.PI * (ph - 0.32)) * wa;
  const sway = Math.sin(2 * Math.PI * (ph - 0.3)) * wa;
  const g = fbm(S.gesturePhase, 5, 0.9, 2);
  for (const nm of names) {
    const amp = nm === 'head' ? 1 : nm === 'chest' ? 0.8 : 0.6;
    res[nm] = new THREE.Vector3(
      amp * (0.006 * sway + 0.002 * fbm(S.t, 31 + amp * 10, 0.5, 3) * S.energy),
      amp * (-0.008 * bounce - 0.012 * S.startle),
      amp * (-0.01 * wa + 0.0012 * g - 0.006 * S.startle + 0.002 * fbm(S.t, 53 + amp * 10, 0.45, 3) * S.energy),
    );
  }
  return res;
}
