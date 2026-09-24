// Skeletons for the humans. Every bone has an identity rotation in the bind
// pose, so a bone's local rotation acts on the character axes (+X left,
// +Y up, +Z forward) of its parent frame. Arms are bound in a relaxed A-pose.

import * as THREE from 'three';

export const BODY = {
  maya: {
    height: 1.66,
    hips: [0, 0.905, -0.005], spine: [0, 1.005, -0.012], chest: [0, 1.165, -0.018], neck: [0, 1.365, -0.036],
    headBone: [0, 1.468, -0.03], headOrigin: [0, 1.542, -0.006],
    clav: [0.028, 1.322, 0.0], shoulder: [0.166, 1.326, -0.036],
    upper: 0.282, fore: 0.24, handLen: 0.084, armAngle: 40,
    hip: [0.086, 0.868, 0.0], knee: [0.088, 0.47, 0.012], ankle: [0.088, 0.078, -0.01], toe: [0.09, 0.012, 0.13],
    fingers: { len: [0.074, 0.081, 0.076, 0.061], r: 0.0082, thumb: [0.042, 0.032, 0.027], thumbR: 0.0098, palmW: 0.074 },
  },
  sam: {
    height: 1.80,
    hips: [0, 0.98, -0.006], spine: [0, 1.095, -0.014], chest: [0, 1.27, -0.02], neck: [0, 1.487, -0.04],
    headBone: [0, 1.595, -0.034], headOrigin: [0, 1.678, -0.008],
    clav: [0.03, 1.436, 0.0], shoulder: [0.186, 1.44, -0.04],
    upper: 0.31, fore: 0.268, handLen: 0.092, armAngle: 40,
    hip: [0.092, 0.942, 0.0], knee: [0.094, 0.512, 0.014], ankle: [0.094, 0.082, -0.012], toe: [0.096, 0.012, 0.148],
    fingers: { len: [0.081, 0.089, 0.084, 0.067], r: 0.0092, thumb: [0.046, 0.035, 0.03], thumbR: 0.0108, palmW: 0.082 },
  },
};

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** bind-space joint positions (world, character frame) */
export function bindJoints(id) {
  const B = BODY[id];
  const J = {};
  J.root = new THREE.Vector3();
  J.hips = V(B.hips); J.spine = V(B.spine); J.chest = V(B.chest); J.neck = V(B.neck); J.head = V(B.headBone);
  const ang = B.armAngle * Math.PI / 180;
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    J['clav' + k] = new THREE.Vector3(s * B.clav[0], B.clav[1], B.clav[2]);
    const sh = new THREE.Vector3(s * B.shoulder[0], B.shoulder[1], B.shoulder[2]);
    const dir = new THREE.Vector3(s * Math.sin(ang), -Math.cos(ang), 0);
    J['upper' + k] = sh;
    J['fore' + k] = sh.clone().addScaledVector(dir, B.upper);
    J['twist' + k] = J['fore' + k].clone().addScaledVector(dir, B.fore * 0.62);
    J['hand' + k] = J['fore' + k].clone().addScaledVector(dir, B.fore);
    J['armDir' + k] = dir;
    J['thigh' + k] = new THREE.Vector3(s * B.hip[0], B.hip[1], B.hip[2]);
    J['shin' + k] = new THREE.Vector3(s * B.knee[0], B.knee[1], B.knee[2]);
    J['foot' + k] = new THREE.Vector3(s * B.ankle[0], B.ankle[1], B.ankle[2]);
    J['toe' + k] = new THREE.Vector3(s * B.toe[0], B.toe[1] + 0.012, B.toe[2] - 0.06);
    J['toeTip' + k] = new THREE.Vector3(s * B.toe[0], B.toe[1], B.toe[2]);
  }
  return J;
}

/**
 * hand basis in the bind pose: F along the fingers, T toward the thumb,
 * P out of the palm. Fingers: knuckle base positions + segment lengths.
 */
export function handLayout(id, side) {
  const B = BODY[id];
  const J = bindJoints(id);
  const k = side > 0 ? 'L' : 'R';
  const F = J['armDir' + k].clone();
  const T = new THREE.Vector3(0, 0, 1);
  const P = new THREE.Vector3().crossVectors(F, T).multiplyScalar(side).normalize(); // palm faces the body
  // make P point inward (toward the body centre)
  if (P.x * side > 0) P.negate();
  const W = J['hand' + k].clone();
  const FG = B.fingers;
  const at = (f, t, p) => W.clone().addScaledVector(F, f).addScaledVector(T, t).addScaledVector(P, p);
  const knuckleF = [B.handLen * 0.98, B.handLen * 1.0, B.handLen * 0.97, B.handLen * 0.9];
  const knuckleT = [FG.palmW * 0.36, FG.palmW * 0.12, -FG.palmW * 0.12, -FG.palmW * 0.35];
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const L = FG.len[i];
    const segs = [L * 0.46, L * 0.30, L * 0.24];
    // slight fan: outer fingers splay a little
    const spread = [0.07, 0.015, -0.04, -0.1][i];
    const dir = F.clone().addScaledVector(T, spread).normalize();
    fingers.push({ base: at(knuckleF[i] - 0.004, knuckleT[i], -0.002), dir, segs, r: FG.r * [1, 1.04, 0.97, 0.86][i] });
  }
  // thumb: from the base of the palm, angled out toward T and down into the palm side
  const tdir = F.clone().multiplyScalar(0.62).addScaledVector(T, 0.68).addScaledVector(P, 0.38).normalize();
  const thumb = { base: at(0.018, FG.palmW * 0.3, 0.006), dir: tdir, segs: FG.thumb, r: FG.thumbR };
  return { F, T, P, W, fingers, thumb, side };
}

export const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'];

export function createSkeleton(id) {
  const J = bindJoints(id);
  const bones = {};
  const mk = (name, parentName, worldPos) => {
    const b = new THREE.Bone();
    b.name = name;
    const parent = parentName ? bones[parentName] : null;
    const pw = parentName ? bones[parentName].userData.bindWorld : new THREE.Vector3();
    b.position.copy(worldPos).sub(pw);
    b.userData.bindWorld = worldPos.clone();
    b.userData.bindLocal = b.position.clone();
    if (parent) parent.add(b);
    bones[name] = b;
    return b;
  };
  mk('root', null, J.root);
  mk('hips', 'root', J.hips);
  mk('spine', 'hips', J.spine);
  // secondary: hem swing (cardigan / hoodie), driven by springs in human.js
  mk('hem', 'hips', new THREE.Vector3(0, J.spine.y + 0.03, J.hips.z));
  mk('chest', 'spine', J.chest);
  mk('neck', 'chest', J.neck);
  mk('head', 'neck', J.head);
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    mk('clav' + k, 'chest', J['clav' + k]);
    mk('upper' + k, 'clav' + k, J['upper' + k]);
    mk('fore' + k, 'upper' + k, J['fore' + k]);
    mk('twist' + k, 'fore' + k, J['twist' + k]);
    mk('hand' + k, 'fore' + k, J['hand' + k]);
    const H = handLayout(id, s);
    H.fingers.forEach((fg, i) => {
      let p = fg.base.clone();
      let parent = 'hand' + k;
      for (let j = 0; j < 3; j++) {
        const nm = FINGER_NAMES[i] + j + k;
        mk(nm, parent, p.clone());
        parent = nm;
        p = p.clone().addScaledVector(fg.dir, fg.segs[j]);
      }
    });
    {
      let p = H.thumb.base.clone();
      let parent = 'hand' + k;
      for (let j = 0; j < 3; j++) {
        const nm = 'thumb' + j + k;
        mk(nm, parent, p.clone());
        parent = nm;
        p = p.clone().addScaledVector(H.thumb.dir, H.thumb.segs[j]);
      }
    }
    mk('thigh' + k, 'hips', J['thigh' + k]);
    mk('shin' + k, 'thigh' + k, J['shin' + k]);
    mk('foot' + k, 'shin' + k, J['foot' + k]);
    mk('toe' + k, 'foot' + k, J['toe' + k]);
  }
  const list = Object.values(bones);
  const skeleton = new THREE.Skeleton(list);
  return { bones, list, skeleton, J };
}

/** per-side hand frames for the pose solver */
export function handBindInfo(id) {
  const out = {};
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const H = handLayout(id, s);
    const T = new THREE.Vector3().crossVectors(H.F, H.P).normalize(); // flexion axis (curl toward the palm)
    const thumbAxis = new THREE.Vector3().crossVectors(H.thumb.dir, H.P).normalize();
    out[k] = { F: H.F.clone(), P: H.P.clone(), T, thumbAxis, flexSign: 1 };
  }
  return out;
}
